import { materialPart } from '../../src/lib/materialCategories.ts';
import { config } from '../config.ts';
import { getMaterialAmounts } from '../data/materialAmounts.ts';
import type { MaterialRecord } from '../db.ts';
import { requestStepFunJson } from './stepfun.ts';

export function materialReviewUnavailable() {
  return Object.assign(new Error('暂时无法完成材料核对，请稍后重试'), { code: 'MATERIAL_REVIEW_UNAVAILABLE' });
}

export async function verifyGeneratedMaterials(
  image: { bytes: Buffer; mimeType: string },
  materials: MaterialRecord[],
): Promise<void> {
  const materialList = materials.map(({ id, label, category, visualHint, amounts }) => {
    const quantities = (amounts ?? getMaterialAmounts(id))
      .map(({ part, quantity, unit }) => `${part ?? ''}${quantity}${unit}`).join('、');
    return `- ${label}（${materialPart(id, category)}，${quantities}）。${visualHint}`;
  }).join('\n');
  const review = await requestStepFunJson<{ matches?: unknown; unmatchedParts?: unknown }>(
    '你负责成品材料验收。对照清单查找明显多出、缺少、用错材料或数量不符的部件，' +
      '包括眼睛、鼻子、纽扣和四肢。忽略背景和阴影，厘米规格以备料清单为准。' +
      '只返回 JSON，含 matches（布尔值）和 unmatchedParts（简短问题列表，无问题返回空数组）。',
    [
      { type: 'text', text: materialList },
      { type: 'image_url', image_url: { url: `data:${image.mimeType};base64,${image.bytes.toString('base64')}`, detail: 'low' } },
    ],
    config.stepfunVisionModel,
    { maxTokens: 900, attemptTimeoutsMs: [18_000, 36_000] },
  ).catch((error: unknown) => {
    console.warn('[image] material review failed', (error as { code?: string })?.code);
    throw materialReviewUnavailable();
  });

  if (typeof review.matches !== 'boolean' || !Array.isArray(review.unmatchedParts) ||
      review.unmatchedParts.some(part => typeof part !== 'string')) {
    throw materialReviewUnavailable();
  }
  if (!review.matches || review.unmatchedParts.length > 0) {
    const parts = review.unmatchedParts.map(part => part.trim().slice(0, 35)).filter(Boolean).slice(0, 3);
    const message = parts.length ? `成品与备料清单有出入（${parts.join('、')}）` : '这次生成的娃娃部件和选材不一致，请重试或调整选材';
    throw Object.assign(new Error(message), { code: 'MATERIAL_MISMATCH' });
  }
}
