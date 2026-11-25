import { config, isChatCloudConfigured, isPhotoMbtiEnabled } from '../config.ts';
import { requestStepFunJson } from './stepfun.ts';
import { PERSONA_SEEDS } from '../data/seed.ts';
import type { MaterialRecord } from '../db.ts';
import { defaultMaterialIds, materialPart } from '../../src/lib/materialCategories.ts';

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
  photoStyle?: string;
  dollDesign?: string;
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
    suggestedMaterialIds: suggestedMaterialIds.length ? suggestedMaterialIds : defaultMaterialIds(inStockMaterials).slice(0, 3),
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

  if (hasPhoto && (!isPhotoMbtiEnabled() || input.providerMode !== 'cloud')) {
    throw Object.assign(new Error('照片推荐暂未开放，请使用 4 题快测'), {
      status: 409,
      code: 'PHOTO_MBTI_UNAVAILABLE',
    });
  }
  if (input.quizAnswers && (input.providerMode === 'mock' || !isChatCloudConfigured())) {
    return buildDeterministicQuizRecommendation(input.quizAnswers, input.inStockMaterials);
  }

  const personaCatalog = PERSONA_SEEDS.map(
    (p) => hasPhoto ? `${p.mbti} ${p.name}` : `${p.mbti}（${p.name}，${p.cognitiveAxis}）：${p.tagline}`
  ).join('\n');

  const materialsCatalog = input.inStockMaterials
    .map((m) => hasPhoto ? `${m.id}=${m.label}${m.referenceImageUrl ? '〔材料包〕' : ''}` : `${m.id}: ${m.label}（${m.material}）`)
    .join('\n');

  const quizDesc = hasQuiz && input.quizAnswers
    ? `用户 4 题快测选择：能量倾向=${input.quizAnswers.energy || '未选'}，感知方式=${input.quizAnswers.perception || '未选'}，决策方式=${input.quizAnswers.judgment || '未选'}，生活节奏=${input.quizAnswers.lifestyle || '未选'}。`
    : '将照片的可见风格作为虚构娃娃的角色灵感。';

  const promptText = [
    '你是“果壳碰碰”手作工坊的 MBTI 人格策展师。',
    hasPhoto
      ? '观察照片中可见的服饰、色彩和画面氛围，将它们转成虚构娃娃的风格。MBTI 描述娃娃角色，勿据外貌判断真人性格、身份、年龄或健康。'
      : '请结合用户的 4 题快测倾向，为其挑选最契合的天然果实手作娃娃 MBTI 人格。',
    quizDesc,
    '',
    '【可选的 16 型果壳人格】',
    personaCatalog,
    '',
    hasPhoto ? '【工坊可用材料，从以下 ID 中挑 2 到 5 项】' : '【工坊可用材料，从以下 ID 中挑 2 到 3 项】',
    materialsCatalog || '暂无在库材料',
    '',
    '要求：',
    '1. primaryMbti 必须是标准 4 字母 MBTI 大写代码之一；如果用户完成了全部 4 题快测，优先以快测结果为主，再用照片气质微调备选和推荐材料。',
    '2. alternateMbtis 返回 2 个与 primaryMbti 不同的备选 4 字母 MBTI。',
    '3. keywords 返回 3 个简短温暖的中文氛围词（每个 2–5 字）。',
    '4. reason 用 2 句自然、有手作温度的中文解释为什么这个果壳人格和Ta很搭。',
    '5. suggestedMaterialIds 必须全部来自上面列出的 ID。',
    hasPhoto ? '6. photoStyle 简述照片风格。dollDesign 用一句话说明所选材料分别做什么部位，只用 suggestedMaterialIds 对应的材料和它们已有的颜色。优先选一个果壳或果实作主体。照片仅提供角色灵感。' : '',
  ].join('\n');

  const content = hasPhoto
    ? [
        { type: 'text' as const, text: promptText },
        { type: 'image_url' as const, image_url: {
          url: `data:${input.photoMime};base64,${input.photoBuffer!.toString('base64')}`,
          detail: 'low' as const,
        } },
      ]
    : promptText;
  const outcome = await requestStepFunJson<{
    primaryMbti?: string;
    alternateMbtis?: string[];
    keywords?: string[];
    reason?: string;
    suggestedMaterialIds?: string[];
    photoStyle?: string;
    dollDesign?: string;
  }>(
    '只返回一个 JSON 对象，包含 primaryMbti、alternateMbtis、keywords、reason、suggestedMaterialIds。' +
      (hasPhoto ? '照片分析还要包含 photoStyle 和 dollDesign。' : ''),
    content,
    hasPhoto ? config.stepfunVisionModel : undefined,
  ).then((data) => ({ data })).catch((error) => {
    if (hasPhoto || !input.quizAnswers) throw error;
    return { fallback: buildDeterministicQuizRecommendation(input.quizAnswers, input.inStockMaterials) };
  });
  if ('fallback' in outcome) return outcome.fallback;

  const parsed = outcome.data;
  const chosenMbti = typeof parsed.primaryMbti === 'string' ? parsed.primaryMbti.trim().toUpperCase() : '';
  const photoStyle = typeof parsed.photoStyle === 'string' ? parsed.photoStyle.trim().slice(0, 120) : '';
  const dollDesign = typeof parsed.dollDesign === 'string' ? parsed.dollDesign.trim().slice(0, 180) : '';
  if (hasPhoto && (!VALID_MBTIS.has(chosenMbti) || !photoStyle || !dollDesign)) {
    throw Object.assign(new Error('照片分析返回的娃娃方案不完整，请重试'), {
      status: 502, code: 'PROVIDER_ERROR',
    });
  }
  const primary = personaByMbti(chosenMbti);
  const inStockSet = new Set(input.inStockMaterials.map((m) => m.id));

  const validAlts = (Array.isArray(parsed.alternateMbtis) ? parsed.alternateMbtis : [])
    .map((m) => String(m).toUpperCase().trim())
    .filter((m) => VALID_MBTIS.has(m) && m !== primary.mbti);

  while (validAlts.length < 2) {
    const candidate = PERSONA_SEEDS.find((p) => p.mbti !== primary.mbti && !validAlts.includes(p.mbti));
    if (!candidate) break;
    validAlts.push(candidate.mbti);
  }

  const recommendedMaterials = [...new Set((Array.isArray(parsed.suggestedMaterialIds) ? parsed.suggestedMaterialIds : [])
    .map(String)
    .filter((id) => inStockSet.has(id)))].slice(0, hasPhoto ? 5 : 3);
  const personaMaterials = primary.recommendedMaterials.filter((id) => inStockSet.has(id)).slice(0, 3);
  const fallbackMaterials = personaMaterials.length ? personaMaterials : defaultMaterialIds(input.inStockMaterials).slice(0, hasPhoto ? 5 : 3);
  const validMaterials = recommendedMaterials.length ? recommendedMaterials : fallbackMaterials;
  const fallbackDesign = validMaterials.flatMap(id => {
    const material = input.inStockMaterials.find(item => item.id === id);
    return material ? [`${material.label}做${materialPart(id, material.category)}`] : [];
  }).join('，');

  const keywords = (Array.isArray(parsed.keywords) ? parsed.keywords : [])
    .map((k) => String(k).trim())
    .filter(Boolean)
    .slice(0, 3);

  return {
    primaryMbti: primary.mbti,
    primaryPersonaId: primary.id,
    alternateMbtis: validAlts.slice(0, 2),
    keywords: keywords.length > 0 ? keywords : [primary.mbti, primary.name, '手作共鸣'],
    reason: (typeof parsed.reason === 'string' && parsed.reason.trim() || primary.tagline).slice(0, 240),
    suggestedMaterialIds: validMaterials,
    ...(hasPhoto ? { photoStyle, dollDesign: recommendedMaterials.length ? dollDesign : fallbackDesign } : {}),
    source: hasPhoto ? 'cloud_vision' : 'cloud_quiz',
  };
}
