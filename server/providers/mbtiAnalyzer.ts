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

const PHOTO_STYLES = {
  natural: { label: '自然', personas: ['ISFP', 'ISTP', 'ESTP'], materials: ['kit_capped_acorn', 'kit_green_gauze', 'kit_hemp_twine'] },
  soft: { label: '柔和', personas: ['INFP', 'ISFJ', 'INFJ'], materials: ['kit_walnut', 'kit_cloud_cotton', 'kit_teddy_wool'] },
  playful: { label: '俏皮', personas: ['ENFP', 'ESFP', 'ENTP'], materials: ['kit_capped_acorn', 'kit_cloud_cotton', 'kit_color_check_bows'] },
  simple: { label: '利落', personas: ['INTJ', 'ISTJ', 'INTP'], materials: ['kit_panji', 'kit_fabric_pieces', 'kit_coconut_buttons'] },
  elegant: { label: '精致', personas: ['ENFJ', 'ESFJ', 'INFJ'], materials: ['kit_pala', 'kit_satin_gradient', 'kit_micro_shells'] },
};

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

async function recommendFromPhoto(
  photoBuffer: Buffer,
  photoMime: string,
  inStockMaterials: MaterialRecord[],
  quiz?: MbtiQuizAnswers,
): Promise<MbtiRecommendationResult> {
  if (inStockMaterials.length === 0) {
    throw Object.assign(new Error('工坊暂无可用材料，请稍后再试'), { status: 409, code: 'MATERIAL_SELECTION_REQUIRED' });
  }

  const observation = await requestStepFunJson<{ style?: unknown; photoStyle?: unknown }>(
    '只描述照片中可见的颜色、服饰或构图，用于虚构娃娃创作。勿推断真人的性格、身份、年龄或健康。只返回 JSON。',
    [
      { type: 'text', text: '返回 style（natural 自然、soft 柔和、playful 俏皮、simple 利落、elegant 精致，选最接近的一项）和 photoStyle（用 30 字以内的中文描述画面）。' },
      { type: 'image_url', image_url: { url: `data:${photoMime};base64,${photoBuffer.toString('base64')}`, detail: 'low' } },
    ],
    config.stepfunVisionModel,
    // 两次请求和短暂退避需给 Vercel 的 60 秒 API 留出其他操作的时间。
    { maxTokens: 640, attemptTimeoutsMs: [20_000, 28_000] },
  );
  const photoStyle = typeof observation.photoStyle === 'string' ? observation.photoStyle.trim().slice(0, 120) : '';
  if (!photoStyle) {
    throw Object.assign(new Error('照片分析返回的描述不完整，请重试'), { status: 502, code: 'PROVIDER_ERROR' });
  }

  const styleKey = typeof observation.style === 'string' ? observation.style.trim().toLowerCase() : '';
  const style = Object.hasOwn(PHOTO_STYLES, styleKey) ? PHOTO_STYLES[styleKey as keyof typeof PHOTO_STYLES] : PHOTO_STYLES.natural;
  const quizMbti = quiz?.energy && quiz.perception && quiz.judgment && quiz.lifestyle
    ? `${quiz.energy}${quiz.perception}${quiz.judgment}${quiz.lifestyle}` : undefined;
  const primary = personaByMbti(quizMbti ?? style.personas[0]);

  const [bodyId, ...decorations] = style.materials;
  const byId = new Map(inStockMaterials.map(material => [material.id, material]));
  const body = byId.get(bodyId) ?? byId.get('kit_capped_acorn') ?? inStockMaterials.find(material =>
    material.id !== 'kit_camphor_slice' && (material.category === 'nut_body' || material.category === 'fruit_body')
  );
  const chosen = [body, ...decorations.map(id => byId.get(id)), byId.get('kit_toy_eyes_nose')]
    .filter(material => material !== undefined);
  const materials = chosen.length ? chosen : inStockMaterials.slice(0, 2);
  const dollDesign = materials.map(material => {
    const part = material === body ? '娃娃主体' : materialPart(material.id, material.category);
    return `${material.label}做${part}`;
  }).join('，') + '。';

  return {
    primaryMbti: primary.mbti,
    primaryPersonaId: primary.id,
    alternateMbtis: style.personas.filter(mbti => mbti !== primary.mbti).slice(0, 2),
    keywords: [style.label, primary.name],
    reason: quizMbti
      ? `根据快测把娃娃设定为「${primary.name}」，再参考画面的搭配挑选材料。`
      : `从${style.label}的画面取一点灵感，把娃娃设定为「${primary.name}」。`,
    suggestedMaterialIds: materials.map(material => material.id),
    photoStyle,
    dollDesign,
    source: 'cloud_vision',
  };
}

export async function recommendMbti(input: {
  photoBuffer?: Buffer;
  photoMime?: string;
  quizAnswers?: MbtiQuizAnswers;
  providerMode: 'mock' | 'cloud';
  inStockMaterials: MaterialRecord[];
}): Promise<MbtiRecommendationResult> {
  const { photoBuffer, photoMime, quizAnswers, providerMode, inStockMaterials } = input;
  if (photoBuffer?.length && photoMime) {
    if (!isPhotoMbtiEnabled() || providerMode !== 'cloud') {
      throw Object.assign(new Error('照片推荐暂未开放，请使用 4 题快测'), {
        status: 409,
        code: 'PHOTO_MBTI_UNAVAILABLE',
      });
    }
    return recommendFromPhoto(photoBuffer, photoMime, inStockMaterials, quizAnswers);
  }

  if (!quizAnswers || !Object.values(quizAnswers).some(Boolean)) {
    throw Object.assign(new Error('请先上传自拍照片或完成 4 题快测后再进行人格推荐'), {
      status: 400,
      code: 'INVALID_INPUT',
    });
  }
  if (providerMode === 'mock' || !isChatCloudConfigured()) {
    return buildDeterministicQuizRecommendation(quizAnswers, inStockMaterials);
  }

  const personaCatalog = PERSONA_SEEDS.map(
    (p) => `${p.mbti}（${p.name}，${p.cognitiveAxis}）：${p.tagline}`
  ).join('\n');

  const materialsCatalog = inStockMaterials
    .map((m) => `${m.id}: ${m.label}（${m.material}）`)
    .join('\n');

  const promptText = [
    '你是“果壳碰碰”手作工坊的 MBTI 人格策展师。',
    '请结合用户的 4 题快测倾向，为其挑选最契合的天然果实手作娃娃 MBTI 人格。',
    `用户 4 题快测选择：能量倾向=${quizAnswers.energy || '未选'}，感知方式=${quizAnswers.perception || '未选'}，决策方式=${quizAnswers.judgment || '未选'}，生活节奏=${quizAnswers.lifestyle || '未选'}。`,
    '',
    '【可选的 16 型果壳人格】',
    personaCatalog,
    '',
    '【工坊可用材料，从以下 ID 中挑 2 到 3 项】',
    materialsCatalog || '暂无在库材料',
    '',
    '要求：',
    '1. primaryMbti 必须是标准 4 字母 MBTI 大写代码之一。如果用户完成了全部 4 题快测，优先以快测结果为主。',
    '2. alternateMbtis 返回 2 个与 primaryMbti 不同的备选 4 字母 MBTI。',
    '3. keywords 返回 3 个简短温暖的中文氛围词（每个 2–5 字）。',
    '4. reason 用 2 句自然、有手作温度的中文解释为什么这个果壳人格和Ta很搭。',
    '5. suggestedMaterialIds 必须全部来自上面列出的 ID。',
  ].join('\n');

  const outcome = await requestStepFunJson<{
    primaryMbti?: string;
    alternateMbtis?: string[];
    keywords?: string[];
    reason?: string;
    suggestedMaterialIds?: string[];
  }>(
    '只返回一个 JSON 对象，包含 primaryMbti、alternateMbtis、keywords、reason、suggestedMaterialIds。',
    promptText,
  ).then((data) => ({ data })).catch(() => ({ fallback: buildDeterministicQuizRecommendation(quizAnswers, inStockMaterials) }));
  if ('fallback' in outcome) return outcome.fallback;

  const parsed = outcome.data;
  const chosenMbti = typeof parsed.primaryMbti === 'string' ? parsed.primaryMbti.trim().toUpperCase() : '';
  const primary = personaByMbti(chosenMbti);
  const inStockSet = new Set(inStockMaterials.map((m) => m.id));

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
    .filter((id) => inStockSet.has(id)))].slice(0, 3);
  const personaMaterials = primary.recommendedMaterials.filter((id) => inStockSet.has(id)).slice(0, 3);
  const fallbackMaterials = personaMaterials.length ? personaMaterials : defaultMaterialIds(inStockMaterials).slice(0, 3);

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
    suggestedMaterialIds: recommendedMaterials.length ? recommendedMaterials : fallbackMaterials,
    source: 'cloud_quiz',
  };
}
