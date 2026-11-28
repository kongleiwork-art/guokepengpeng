import { config, isPhotoMbtiEnabled } from '../config.ts';
import { requestStepFunJson } from './stepfun.ts';
import { PERSONA_SEEDS } from '../data/seed.ts';
import type { MaterialRecord } from '../db.ts';
import { composePhotoMaterials, isDollBodyMaterial, recommendedMaterialIds } from '../../src/lib/materialCategories.ts';
import type { MbtiQuizAnswers, MbtiRecommendation } from '../../src/lib/types.ts';

export type { MbtiQuizAnswers } from '../../src/lib/types.ts';

const PHOTO_STYLES = {
  natural: { label: '自然', personas: ['ISFP', 'ISTP', 'ESTP'], materials: ['kit_capped_acorn', 'kit_green_gauze', 'kit_hemp_twine'] },
  soft: { label: '柔和', personas: ['INFP', 'ISFJ', 'INFJ'], materials: ['kit_walnut', 'kit_cloud_cotton', 'kit_teddy_wool'] },
  playful: { label: '俏皮', personas: ['ENFP', 'ESFP', 'ENTP'], materials: ['kit_capped_acorn', 'kit_cloud_cotton', 'kit_color_check_bows'] },
  simple: { label: '利落', personas: ['INTJ', 'ISTJ', 'INTP'], materials: ['kit_panji', 'kit_fabric_pieces', 'kit_coconut_buttons'] },
  elegant: { label: '精致', personas: ['ENFJ', 'ESFJ', 'INFJ'], materials: ['kit_pala', 'kit_satin_gradient', 'kit_micro_shells'] },
};

function quizType(quiz?: MbtiQuizAnswers) {
  if (!quiz) return undefined;
  const mbti = [quiz.energy, quiz.perception, quiz.judgment, quiz.lifestyle].join('');
  return PERSONA_SEEDS.find(persona => persona.mbti === mbti);
}

function invalidInput(message: string): never {
  throw Object.assign(new Error(message), { status: 400, code: 'INVALID_INPUT' });
}

const PALETTE_FABRICS: Record<string, { id: string; variant: string }> = {
  green: { id: 'kit_green_gauze', variant: '浅苔绿' },
  cream: { id: 'kit_cloud_cotton', variant: '奶油色' },
  dark: { id: 'kit_fabric_pieces', variant: '深灰色' },
  blue: { id: 'kit_fabric_pieces', variant: '藏蓝色' },
  warm: { id: 'kit_fabric_pieces', variant: '酒红色' },
  pastel: { id: 'kit_satin_gradient', variant: '柔和渐变色' },
  patterned: { id: 'kit_fabric_scraps', variant: '细碎印花' },
};

export async function recommendMbti(input: {
  photoBuffer?: Buffer;
  photoMime?: string;
  quizAnswers?: MbtiQuizAnswers;
  personaId?: string;
  providerMode: 'mock' | 'cloud';
  inStockMaterials: MaterialRecord[];
}): Promise<MbtiRecommendation> {
  const { photoBuffer, photoMime, quizAnswers, personaId, inStockMaterials } = input;
  const fromQuiz = quizType(quizAnswers);
  if (!photoBuffer?.length || !photoMime) {
    if (!fromQuiz) invalidInput('请完成四道快测题后查看结果。');
    return {
      primaryMbti: fromQuiz.mbti, primaryPersonaId: fromQuiz.id,
      alternateMbtis: [
        fromQuiz.mbti.slice(0, 3) + (fromQuiz.mbti[3] === 'J' ? 'P' : 'J'),
        fromQuiz.mbti.slice(0, 2) + (fromQuiz.mbti[2] === 'T' ? 'F' : 'T') + fromQuiz.mbti[3],
      ],
      keywords: [fromQuiz.name, fromQuiz.mbti],
      reason: '按你的四项选择，娃娃角色是「' + fromQuiz.name + '」。' + fromQuiz.tagline + '。',
      suggestedMaterialIds: recommendedMaterialIds(fromQuiz.recommendedMaterials, inStockMaterials),
      source: 'quiz_rule',
    };
  }
  if (!isPhotoMbtiEnabled() || input.providerMode !== 'cloud') {
    throw Object.assign(new Error('照片推荐暂未开放，请使用情景测验或快测'), { status: 409, code: 'PHOTO_MBTI_UNAVAILABLE' });
  }
  const selected = personaId === undefined ? fromQuiz : PERSONA_SEEDS.find(persona => persona.id === personaId);
  if (personaId !== undefined && !selected) invalidInput('所选娃娃角色不存在，请重新选择。');
  if (!inStockMaterials.some(isDollBodyMaterial)) {
    throw Object.assign(new Error('工坊暂缺可作娃娃主体的果壳或果实，请稍后再试'), { status: 409, code: 'MATERIAL_SELECTION_REQUIRED' });
  }

  const roleInstruction = selected ? '' : ' 再返回 dollRole，从' +
    PERSONA_SEEDS.map(persona => persona.name).join('、') + '中任选一个作为虚构娃娃的创作角色。';
  const observation = await requestStepFunJson<{ style?: unknown; photoStyle?: unknown; palette?: unknown; dollRole?: unknown }>(
    '只观察主体可见的发型轮廓与上衣配色，用于虚构娃娃创作。忽略背景、文字、标识与道具。勿推断真人的性格、身份、年龄或健康。只返回 JSON。',
    [
      { type: 'text', text: '返回 style（natural 自然、soft 柔和、playful 俏皮、simple 利落、elegant 精致，选最接近的一项）、palette（上衣最接近 green、cream、dark、blue、warm（红橙）、pastel、patterned 哪一种，均不接近或看不清填 other）和 photoStyle（用 30 字以内中文描述可见的发型或配色，看不清的部分省略）。' + roleInstruction },
      { type: 'image_url', image_url: { url: `data:${photoMime};base64,${photoBuffer.toString('base64')}`, detail: 'low' } },
    ],
    config.stepfunVisionModel,
    // 两次请求和短暂退避需给 Vercel 的 60 秒 API 留出其他操作的时间。
    { maxTokens: 1280, attemptTimeoutsMs: [20_000, 28_000] },
  );
  const photoStyle = typeof observation.photoStyle === 'string' ? observation.photoStyle.trim().slice(0, 120) : '';
  if (!photoStyle) {
    throw Object.assign(new Error('照片分析返回的描述不完整，请重试'), { status: 502, code: 'PROVIDER_ERROR' });
  }

  const styleKey = typeof observation.style === 'string' ? observation.style.trim().toLowerCase() : '';
  const style = Object.hasOwn(PHOTO_STYLES, styleKey) ? PHOTO_STYLES[styleKey as keyof typeof PHOTO_STYLES] : PHOTO_STYLES.natural;
  const proposed = PERSONA_SEEDS.find(persona => persona.name === observation.dollRole);
  const primary = selected ?? proposed ?? PERSONA_SEEDS.find(persona => persona.mbti === style.personas[0])!;
  const palette = typeof observation.palette === 'string' ? observation.palette.trim().toLowerCase() : '';
  const swatch = Object.hasOwn(PALETTE_FABRICS, palette) ? PALETTE_FABRICS[palette] : undefined;
  const photoFabricId = swatch?.id ?? style.materials[1];
  const kit = selected || proposed ? primary.recommendedMaterials : [...style.materials, 'kit_toy_eyes_nose'];
  const { suggestedMaterialIds, dollDesign } = composePhotoMaterials(kit, photoFabricId, inStockMaterials, swatch?.variant);

  return {
    primaryMbti: primary.mbti, primaryPersonaId: primary.id,
    alternateMbtis: style.personas.filter(mbti => mbti !== primary.mbti).slice(0, 2),
    keywords: [style.label, primary.name],
    reason: selected
      ? '沿用你选定的「' + primary.name + '」，按照片的配色搭配在库布料。'
      : '从' + style.label + '的画面取一点灵感，把娃娃设定为「' + primary.name + '」。',
    suggestedMaterialIds, photoStyle, photoFabricId, photoFabricVariant: swatch?.variant, dollDesign, source: 'cloud_vision',
  };
}
