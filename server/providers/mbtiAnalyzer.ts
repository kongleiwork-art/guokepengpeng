import { GoogleGenAI, ThinkingLevel, Type } from '@google/genai';
import { config, isChatCloudConfigured } from '../config.ts';
import { PERSONA_SEEDS } from '../data/seed.ts';
import type { MaterialRecord } from '../db.ts';

export interface MbtiQuizAnswers {
  energy?: 'E' | 'I';
  perception?: 'S' | 'N';
  judgment?: 'T' | 'F';
  lifestyle?: 'J' | 'P';
}

export interface MbtiRecommendationResult {
  primaryMbti: string;
  primaryPersonaId: string;
  alternateMbtis: string[];
  keywords: string[];
  reason: string;
  suggestedMaterialIds: string[];
  source: 'cloud_vision' | 'cloud_quiz' | 'quiz_rule';
}

const VALID_MBTIS = new Set(PERSONA_SEEDS.map((p) => p.mbti));

function personaByMbti(mbti: string) {
  const upper = (mbti || '').toUpperCase().trim();
  return PERSONA_SEEDS.find((p) => p.mbti === upper) ?? PERSONA_SEEDS[0];
}

function buildDeterministicQuizRecommendation(
  quiz: MbtiQuizAnswers,
  inStockMaterials: MaterialRecord[]
): MbtiRecommendationResult {
  const e = quiz.energy === 'I' ? 'I' : 'E';
  const n = quiz.perception === 'S' ? 'S' : 'N';
  const f = quiz.judgment === 'T' ? 'T' : 'F';
  const p = quiz.lifestyle === 'J' ? 'J' : 'P';
  const mbti = `${e}${n}${f}${p}`;
  const primary = personaByMbti(mbti);

  // Compute 2 nearest neighbors by flipping last two axes
  const flipLast = `${e}${n}${f}${p === 'J' ? 'P' : 'J'}`;
  const flipThird = `${e}${n}${f === 'T' ? 'F' : 'T'}${p}`;
  const alternates = [flipLast, flipThird].filter((m) => VALID_MBTIS.has(m) && m !== primary.mbti);

  const inStockSet = new Set(inStockMaterials.map((m) => m.id));
  const suggestedMaterialIds = primary.recommendedMaterials
    .filter((id) => inStockSet.has(id))
    .slice(0, 3);

  const axisNotes = [
    e === 'E' ? '外向松弛的互动能量' : '细腻安静的独处定力',
    n === 'N' ? '偏爱灵感联想与隐喻' : '看重真实手感与当下细节',
    f === 'F' ? '注重温度与情绪共鸣' : '习惯清晰逻辑与利落判断',
    p === 'J' ? '喜欢有章法的小确幸' : '享受随性自由的探索节奏',
  ];

  return {
    primaryMbti: primary.mbti,
    primaryPersonaId: primary.id,
    alternateMbtis: alternates.slice(0, 2),
    keywords: [primary.mbti, primary.name, primary.mbtiGroup === 'NF' ? '疗愈直觉' : primary.mbtiGroup === 'NT' ? '理性洞察' : primary.mbtiGroup === 'SJ' ? '温柔守护' : '自在行动'],
    reason: `根据你的 4 题选择，你呈现出${axisNotes.slice(0, 2).join('、')}，同时兼具${axisNotes.slice(2).join('与')}，与「${primary.name}（${primary.mbti}）」最为契合。`,
    suggestedMaterialIds,
    source: 'quiz_rule',
  };
}

export async function recommendMbti(input: {
  photoBuffer?: Buffer;
  photoMime?: string;
  quizAnswers?: MbtiQuizAnswers;
  providerMode: 'mock' | 'cloud';
  inStockMaterials: MaterialRecord[];
}): Promise<MbtiRecommendationResult> {
  const hasPhoto = Boolean(input.photoBuffer && input.photoBuffer.length > 0 && input.photoMime);
  const hasQuiz = Boolean(
    input.quizAnswers &&
      (input.quizAnswers.energy ||
        input.quizAnswers.perception ||
        input.quizAnswers.judgment ||
        input.quizAnswers.lifestyle)
  );

  if (!hasPhoto && !hasQuiz) {
    throw Object.assign(new Error('请先上传自拍照片或完成 4 题快测后再进行人格推荐'), {
      status: 400,
      code: 'INVALID_INPUT',
    });
  }

  // If in mock mode, handle deterministically (never pretend cloud ran)
  if (input.providerMode === 'mock') {
    if (hasQuiz && input.quizAnswers) {
      return buildDeterministicQuizRecommendation(input.quizAnswers, input.inStockMaterials);
    }
    // Photo-only mock mode: deterministically pick a persona from photo hash
    const hashByte = input.photoBuffer ? input.photoBuffer[0] + input.photoBuffer[input.photoBuffer.length - 1] : 0;
    const picked = PERSONA_SEEDS[hashByte % PERSONA_SEEDS.length];
    const alt1 = PERSONA_SEEDS[(hashByte + 3) % PERSONA_SEEDS.length].mbti;
    const alt2 = PERSONA_SEEDS[(hashByte + 7) % PERSONA_SEEDS.length].mbti;
    const inStockSet = new Set(input.inStockMaterials.map((m) => m.id));
    return {
      primaryMbti: picked.mbti,
      primaryPersonaId: picked.id,
      alternateMbtis: [alt1, alt2].filter((m) => m !== picked.mbti).slice(0, 2),
      keywords: [picked.mbti, picked.name, '演示模式推荐'],
      reason: `（当前处于本地演示模式）结合照片氛围，为你匹配了「${picked.name}（${picked.mbti}）」：${picked.tagline}`,
      suggestedMaterialIds: picked.recommendedMaterials.filter((id) => inStockSet.has(id)).slice(0, 3),
      source: 'quiz_rule',
    };
  }

  // Quiz-only works instantaneously & accurately via rule or cloud; if only quiz is given and cloud isn't configured, use deterministic quiz rule
  if (!hasPhoto && hasQuiz && input.quizAnswers && !isChatCloudConfigured()) {
    return buildDeterministicQuizRecommendation(input.quizAnswers, input.inStockMaterials);
  }

  if (!isChatCloudConfigured()) {
    throw Object.assign(
      new Error('云端视觉分析未配置有效 GEMINI_API_KEY，请在控制台切换模式或使用 4 题快测'),
      { status: 503, code: 'PROVIDER_NOT_CONFIGURED' }
    );
  }

  const apiKey = config.chatApiKey || config.geminiApiKey;
  const ai = new GoogleGenAI({
    apiKey,
    httpOptions: {
      headers: {
        'User-Agent': 'aistudio-build',
      },
    },
  });

  const personaCatalog = PERSONA_SEEDS.map(
    (p) => `${p.mbti}（${p.name}，${p.cognitiveAxis}）：${p.tagline}`
  ).join('\n');

  const materialsCatalog = input.inStockMaterials
    .map((m) => `${m.id}: ${m.label}（${m.material}）`)
    .join('\n');

  const quizDesc = hasQuiz && input.quizAnswers
    ? `用户 4 题快测选择：能量倾向=${input.quizAnswers.energy || '未选'}，感知方式=${input.quizAnswers.perception || '未选'}，决策方式=${input.quizAnswers.judgment || '未选'}，生活节奏=${input.quizAnswers.lifestyle || '未选'}。`
    : '用户未填写 4 题快测，仅提供照片气质作为手作娃娃人格灵感参考。';

  const promptText = [
    '你是“果壳碰碰”手作工坊的 MBTI 人格策展师。',
    hasPhoto
      ? '请以温暖、有趣、尊重的方式观察这张照片中的穿搭风格、色彩氛围、表情神态与气质（不做任何外貌评判或身份推断，仅将其转化为天然果实手作娃娃的性格灵感）。'
      : '请结合用户的 4 题快测倾向，为其挑选最契合的天然果实手作娃娃 MBTI 人格。',
    quizDesc,
    '',
    '【可选的 16 型果壳人格】',
    personaCatalog,
    '',
    '【当前工坊在库手作材料（仅可从以下 ID 中挑选 2–3 个推荐）】',
    materialsCatalog || '暂无在库材料',
    '',
    '要求：',
    '1. primaryMbti 必须是标准 4 字母 MBTI 大写代码之一；如果用户完成了全部 4 题快测，优先以快测结果为主，再用照片气质微调备选和推荐材料。',
    '2. alternateMbtis 返回 2 个与 primaryMbti 不同的备选 4 字母 MBTI。',
    '3. keywords 返回 3 个简短温暖的中文氛围词（每个 2–5 字）。',
    '4. reason 用 2 句自然、有手作温度的中文解释为什么这个果壳人格和Ta很搭。',
    '5. suggestedMaterialIds 必须严格从上面列出的在库材料 ID 中挑选 2–3 个。',
  ].join('\n');

  const parts: Array<{ text: string } | { inlineData: { data: string; mimeType: string } }> = [];
  if (hasPhoto && input.photoBuffer && input.photoMime) {
    parts.push({
      inlineData: {
        data: input.photoBuffer.toString('base64'),
        mimeType: input.photoMime,
      },
    });
  }
  parts.push({ text: promptText });

  const supportsThinkingLevel =
    config.chatModel.startsWith('gemini-4') || config.chatModel.startsWith('gemini-3');

  const response = await ai.models.generateContent({
    model: config.chatModel,
    contents: { parts },
    config: {
      ...(supportsThinkingLevel
        ? { thinkingConfig: { thinkingLevel: ThinkingLevel.LOW } }
        : {}),
      responseMimeType: 'application/json',
      responseSchema: {
        type: Type.OBJECT,
        properties: {
          primaryMbti: { type: Type.STRING },
          alternateMbtis: {
            type: Type.ARRAY,
            items: { type: Type.STRING },
          },
          keywords: {
            type: Type.ARRAY,
            items: { type: Type.STRING },
          },
          reason: { type: Type.STRING },
          suggestedMaterialIds: {
            type: Type.ARRAY,
            items: { type: Type.STRING },
          },
        },
        required: ['primaryMbti', 'alternateMbtis', 'keywords', 'reason', 'suggestedMaterialIds'],
      },
    },
  });

  const rawText = (response.text || '').trim();
  if (!rawText) {
    throw Object.assign(new Error('AI 人格分析未返回有效结果，请重试'), {
      status: 502,
      code: 'PROVIDER_ERROR',
    });
  }

  const parsed = JSON.parse(rawText) as {
    primaryMbti?: string;
    alternateMbtis?: string[];
    keywords?: string[];
    reason?: string;
    suggestedMaterialIds?: string[];
  };

  const primary = personaByMbti(parsed.primaryMbti || '');
  const inStockSet = new Set(input.inStockMaterials.map((m) => m.id));

  const validAlts = (Array.isArray(parsed.alternateMbtis) ? parsed.alternateMbtis : [])
    .map((m) => String(m).toUpperCase().trim())
    .filter((m) => VALID_MBTIS.has(m) && m !== primary.mbti);

  while (validAlts.length < 2) {
    const candidate = PERSONA_SEEDS.find((p) => p.mbti !== primary.mbti && !validAlts.includes(p.mbti));
    if (!candidate) break;
    validAlts.push(candidate.mbti);
  }

  let validMaterials = (Array.isArray(parsed.suggestedMaterialIds) ? parsed.suggestedMaterialIds : [])
    .map(String)
    .filter((id) => inStockSet.has(id))
    .slice(0, 3);

  if (validMaterials.length === 0) {
    validMaterials = primary.recommendedMaterials.filter((id) => inStockSet.has(id)).slice(0, 3);
  }

  const keywords = (Array.isArray(parsed.keywords) ? parsed.keywords : [])
    .map((k) => String(k).trim())
    .filter(Boolean)
    .slice(0, 3);

  return {
    primaryMbti: primary.mbti,
    primaryPersonaId: primary.id,
    alternateMbtis: validAlts.slice(0, 2),
    keywords: keywords.length > 0 ? keywords : [primary.mbti, primary.name, '手作共鸣'],
    reason: (parsed.reason || primary.tagline).trim().slice(0, 240),
    suggestedMaterialIds: validMaterials,
    source: hasPhoto ? 'cloud_vision' : 'cloud_quiz',
  };
}
