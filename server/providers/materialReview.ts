import { materialPart } from '../../src/lib/materialCategories.ts';
import { config } from '../config.ts';
import type { MaterialRecord } from '../db.ts';
import { requestStepFunJson } from './stepfun.ts';

export function materialReviewUnavailable() {
  return Object.assign(new Error('暂时无法完成材料核对，请稍后重试'), { code: 'MATERIAL_REVIEW_UNAVAILABLE' });
}

export async function verifyGeneratedMaterials(
  image: { bytes: Buffer; mimeType: string },
  materials: MaterialRecord[],
): Promise<void> {
  const materialList = materials.map(({ id, label, category, material, visualHint }) =>
    `- ${label}（${material}），用途：${materialPart(id, category)}。外观：${visualHint}`
  ).join('\n');
  const review = await requestStepFunJson<{ matches?: unknown; unmatchedParts?: unknown }>(
    '你负责成品材料验收。根据选定清单检查图片中的手工娃娃。' +
      '指出明显新增、缺失或与清单用途不符的部件。仔细检查枝条、手脚、鞋、眼鼻嘴和挂件是否有对应的选材。' +
      '以可见内容为准，忽略白背景、投影和小幅纹理变化。没选对应材料时可以没有五官或四肢。只返回 JSON。',
    [
      { type: 'text', text: `选定材料与用途\n${materialList}\n\n返回 matches（布尔值）和 unmatchedParts（问题部件的字符串数组）。` },
      { type: 'image_url', image_url: { url: `data:${image.mimeType};base64,${image.bytes.toString('base64')}`, detail: 'high' } },
    ],
    config.stepfunVisionModel,
  ).catch((error: unknown) => {
    console.warn('[image] material review failed', (error as { code?: string })?.code);
    throw materialReviewUnavailable();
  });

  if (typeof review.matches !== 'boolean' || !Array.isArray(review.unmatchedParts) ||
      review.unmatchedParts.some(part => typeof part !== 'string')) {
    throw materialReviewUnavailable();
  }
  if (!review.matches || review.unmatchedParts.length > 0) {
    throw Object.assign(new Error('这次生成的娃娃部件和选材不一致，请重试或调整选材'), { code: 'MATERIAL_MISMATCH' });
  }
}
