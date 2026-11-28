import { dollMaterialPart } from '../../src/lib/materialCategories.ts';
import { MATERIAL_PACK_BY_ID, materialConstructionHint } from '../data/materialPack.ts';
import { resolveLocalAssetFile } from '../utils/assetFiles.ts';
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
  dollDesign?: string,
): Promise<void> {
  const materialList = materials.map(({ id, label, category, visualHint, amounts }) => {
    const quantities = (amounts ?? getMaterialAmounts(id))
      .map(({ part, quantity, unit }) => `${part ?? ''}${quantity}${unit}`).join('、');
    return `- ${label}（${dollMaterialPart({ id, category }, materials)}，${quantities}）。${visualHint}。${materialConstructionHint(id, dollDesign)}`;
  }).join('\n');
  let review: { matches?: unknown; unmatchedParts?: unknown };
  try {
    const { default: sharp } = await import('sharp');
    const preview = await sharp(image.bytes, { limitInputPixels: 16_777_216 })
      .resize({ width: 640, height: 640, fit: 'inside', withoutEnlargement: true })
      .flatten({ background: '#ffffff' })
      .jpeg({ quality: 80 })
      .toBuffer();
    const tile = 144;
    const columns = Math.min(materials.length, materials.length <= 4 ? 2 : 3);
    const thumbnails = await Promise.all(materials.map(async (item, index) => {
      const url = MATERIAL_PACK_BY_ID.get(item.id)?.referenceImageUrl;
      const file = url && resolveLocalAssetFile(url);
      if (!file) throw materialReviewUnavailable();
      const input = await sharp(file.absPath).resize(tile, tile, { fit: 'contain', background: '#ffffff' }).png().toBuffer();
      return { input, left: index % columns * tile, top: Math.floor(index / columns) * tile };
    }));
    const reference = await sharp({ create: { width: columns * tile, height: Math.ceil(materials.length / columns) * tile,
      channels: 3, background: '#ffffff' } }).composite(thumbnails).jpeg({ quality: 75 }).toBuffer();
    review = await requestStepFunJson(
      '你负责成品材料验收。对照清单查找明显多出、缺少、用错材料或数量不符的部件，' +
        '第一幅图是成品，第二幅是清单实材图册，按清单顺序从左至右逐行排列。逐项核对质地、所选布样花色和可数的件数。' +
        '天然壳斗上的纱线线圈、素布上的额外印花、无法分别数清的两段麻绳均按不符处理。' +
        '特别核查衣服、徽章、五官、纽扣和四肢。只忽略空白背景与阴影。画面中清单外的背景道具、徽章或额外衣服都属于出入。厘米规格以备料清单为准。' +
        '只返回 JSON，含 matches（布尔值）和 unmatchedParts（最多三条简短问题，无问题返回空数组）。',
      [
        { type: 'text', text: materialList },
        { type: 'image_url', image_url: { url: `data:image/jpeg;base64,${preview.toString('base64')}`, detail: 'low' } },
        { type: 'image_url', image_url: { url: `data:image/jpeg;base64,${reference.toString('base64')}`, detail: 'low' } },
      ],
      config.stepfunVisionModel,
      { maxTokens: 1700, attemptTimeoutsMs: [22_000, 35_000] },
    );
  } catch (error: unknown) {
    console.warn('[image] material review failed', (error as { code?: string })?.code);
    throw materialReviewUnavailable();
  }

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
