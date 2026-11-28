import fs from 'node:fs';
import crypto from 'node:crypto';
import { ApiError, GoogleGenAI, Modality } from '@google/genai';
import {
  config,
  IMAGE_MODELS,
  isImageCloudConfigured,
  type ImageModelTier,
  type ImageVendor,
} from '../config.ts';
import { FALLBACK_TEMPLATES, getAccessoryLabels } from '../data/seed.ts';
import type { MaterialRecord } from '../db.ts';
import { inspectImageBuffer } from '../utils/imageValidation.ts';
import { writeMedia } from '../mediaStore.ts';
import { materialConstructionHint } from '../data/materialPack.ts';
import { readMaterialArtwork, resolveLocalAssetFile } from '../utils/assetFiles.ts';
import { dollMaterialPart } from '../../src/lib/materialCategories.ts';
import { formatMaterialAmount } from '../../src/lib/materialAmounts.ts';
import { getMaterialAmounts } from '../data/materialAmounts.ts';

export interface DollBrief {
  photoStyle?: string;
  dollDesign?: string;
}

export interface ImageGenerateInput extends DollBrief {
  cardId: string;
  versionId: string;
  versionNumber: number;
  photoBuffer: Buffer;
  photoMime: string;
  userNickname: string;
  personaId: string;
  personaName: string;
  personaMbti: string;
  personaMaterialHint: string;
  personaVisualTrait?: string;
  accessoryIds: string[];
  selectedMaterials: MaterialRecord[];
  useExactMaterialReferences?: boolean;
  strictMaterialConstraint: boolean;
  imageModelTier: ImageModelTier;
  imageModel: string;
  simulateFail?: boolean;
}

type ImageGenerateResultInfo = {
  provider: string;
  providerRequestId: string | null;
  suggestedName?: string;
  keywords?: string[];
};

export type ImageGenerateResult = ImageGenerateResultInfo & (
  | { resultKind: 'generated'; image: { bytes: Buffer; ext: string; mimeType: string } }
  | { resultKind: 'mock'; resultUrl: string }
);

export interface ImageProvider {
  readonly mode: 'mock' | 'cloud' | 'rdk';
  generate(input: ImageGenerateInput, signal: AbortSignal): Promise<ImageGenerateResult>;
}

export function buildDollImagePrompt(input: ImageGenerateInput, materialImageLabels: string[] = []): string {
  if (input.useExactMaterialReferences) {
    return [
      'Create one small, visibly hand-assembled craft doll on a clean white studio background.',
      'The material list below is exhaustive. Use every selected material and add no other visible parts, props, paint, fabrics, or accessories. Leave out a feature if there is no selected material for it.',
      'Each input image is an approved material from the list. Preserve its shape, texture, and palette. Use one of the shown variants if a reference shows several.',
      'Show the actual cut and assembled pieces as a straight-on craft photograph. A shell cap must keep its dry botanical surface. Individual cuts of cord must be countable. Use the exact chosen fabric swatch, including its plain or patterned finish.',
      'A limbless or faceless craft ornament is valid. Keep the shell body directly on the surface when no limb part is listed. Omit eyes, a mouth, limbs, footwear, straps, and hardware unless the materials and listed uses support them.',
      `The doll’s character is ${input.personaMbti} (${input.personaName}). Express this through arrangement and pose within the allowed parts.`,
      ...input.selectedMaterials.map((material, index) => {
        const amounts = (material.amounts ?? getMaterialAmounts(material.id)).map(formatMaterialAmount).join('。');
        return `Input image ${index + 1}: ${material.label} (${material.material}). Part: ${dollMaterialPart(material, input.selectedMaterials)}. Details: ${material.visualHint}. ${materialConstructionHint(material.id, input.dollDesign)} Preparation for one doll: ${amounts}`;
      }),
      input.dollDesign ? `Arrangement inspiration only, subject to the material list: ${input.dollDesign}` : '',
      'Keep the assembly feasible for hand craft. Show the whole doll and its material textures with gentle studio light. No text, graphic overlays, or watermark.',
    ].filter(Boolean).join('\n');
  }

  const matLines =
    input.selectedMaterials.length > 0
      ? input.selectedMaterials
          .map((m) => `- ${m.label} (${m.material}): ${m.visualHint}`)
          .join('\n')
      : `- Natural dried nut shell doll base with cotton-linen cloth body (${input.personaMaterialHint})`;

  const strictRules = input.strictMaterialConstraint
    ? 'STRICT CRAFTABILITY RULE: Use the selected real materials above for the doll’s visible body, outfit and accessories. Keep the construction feasible for hand assembly in a craft workshop. Avoid invented fantasy props and materials unavailable in this selection.'
    : 'Prefer real tactile craft textures (natural nut shells, wool yarn, cotton-linen cloth, wooden beads, dried botanicals) while keeping a charming handmade toy silhouette.';

  const mbtiVisual =
    input.personaVisualTrait ||
    `Distinct ${input.personaMbti} (${input.personaName}) posture, charming expression, and hand-stitched outfit silhouette.`;

  return [
    'Hand-painted Japanese zakka watercolor and colored-pencil storybook character illustration of an adorable miniature handmade natural nut-shell and fabric doll centered on a pure clean white studio paper background.',
    'Inspiration from reference photo: softly borrow the person’s hair silhouette/tone vibe, smile warmth, and general color mood—transformed completely into a tactile 12cm handmade nut-craft doll (NOT a realistic human portrait).',
    `16-MBTI Personality Visual Mapping (${input.personaMbti} · ${input.personaName}): ${mbtiVisual}`,
    'Selected Real Craft Workshop Materials to Render Faithfully:',
    matLines,
    ...(materialImageLabels.length ? [
      'Input image 1 is the portrait. Use the following material illustrations for the shape, proportions, colors and texture of the selected miniature components. If a swatch shows variants, use one appropriate variant on the doll.',
      ...materialImageLabels.map((label, index) => `Input image ${index + 2}: ${label}`),
    ] : []),
    strictRules,
    input.photoStyle || input.dollDesign
      ? 'Use the following studio notes as visual inspiration. Follow the selected doll role and available materials when adapting these notes.'
      : '',
    input.photoStyle ? `Reference photo palette and styling notes: ${input.photoStyle}` : '',
    input.dollDesign ? `Prepared miniature doll design notes: ${input.dollDesign}` : '',
    'Art direction: visible delicate watercolor washes, fine colored-pencil stitch lines, tiny glossy dark bead eyes, gentle coral-peach rosy cheeks, soft grounded watercolor shadow beneath feet, pure crisp white background, single centered full-body doll, zero text, zero letters, zero watermark.',
  ].filter(Boolean).join('\n');
}

async function loadMaterialReferenceImages(input: ImageGenerateInput, legacyLimit = 6) {
  const files = input.selectedMaterials.flatMap(({ id, label, referenceImageUrl }) => {
    const file = referenceImageUrl ? resolveLocalAssetFile(referenceImageUrl) : null;
    return file ? [{ id, label, ...file }] : [];
  });
  if (input.useExactMaterialReferences && (files.length === 0 || files.length !== input.selectedMaterials.length)) {
    throw Object.assign(new Error('所选材料的参考图不齐，请重新选材'), { code: 'MATERIAL_REFERENCES_REQUIRED' });
  }
  const selected = input.useExactMaterialReferences ? files : files.slice(0, legacyLimit);
  return Promise.all(selected.map(async ({ id, label, mime, absPath }) => ({
    id, label, mime, data: await readMaterialArtwork(id, absPath, input.dollDesign),
  })));
}

export async function saveGeneratedAsset(versionId: string, ext: string, data: Buffer, mime: string): Promise<string> {
  const safeExt = ext.replace(/[^a-z0-9]/gi, '').toLowerCase() || 'png';
  const filename = `${versionId}.${safeExt}`;
  await writeMedia(`generated/${filename}`, data, mime);
  return `/api/assets/generated/${filename}`;
}

function getDisplayLabels(input: ImageGenerateInput): string[] {
  if (input.selectedMaterials.length > 0) {
    return input.selectedMaterials.map((m) => m.label);
  }
  return getAccessoryLabels(input.accessoryIds);
}

class GeminiImageProvider implements ImageProvider {
  readonly mode = 'cloud' as const;

  async generate(input: ImageGenerateInput, signal: AbortSignal): Promise<ImageGenerateResult> {
    if (!isImageCloudConfigured('gemini')) {
      throw Object.assign(
        new Error('Nano Banana 生图尚未配置 GEMINI_API_KEY'),
        { code: 'PROVIDER_NOT_CONFIGURED' }
      );
    }

    const targetModel = input.imageModel || IMAGE_MODELS.gemini[input.imageModelTier];
    const references = await loadMaterialReferenceImages(
      input, targetModel.startsWith('gemini-2.5-flash-image') ? 2 : 6,
    );
    const prompt = buildDollImagePrompt(input, references.map(({ label }) => label));

    const ai = new GoogleGenAI({
      apiKey: config.geminiApiKey,
      vertexai: false,
      httpOptions: { baseUrl: config.geminiImageBaseUrl, apiVersion: 'v1beta', timeout: config.imageTimeoutMs, retryOptions: { attempts: 1 } },
    });
    let response;
    try {
      response = await ai.models.generateContent({
        model: targetModel,
        contents: [{
          role: 'user',
          parts: [
            ...(input.useExactMaterialReferences ? [] : [
              { inlineData: { data: input.photoBuffer.toString('base64'), mimeType: input.photoMime } },
            ]),
            ...references.map(({ data, mime }) => ({
              inlineData: { data: data.toString('base64'), mimeType: mime },
            })),
            { text: prompt },
          ],
        }],
        config: {
          abortSignal: signal,
          responseModalities: [Modality.TEXT, Modality.IMAGE],
          imageConfig: {
            aspectRatio: '3:4',
            ...(input.imageModelTier === 'hd' ? { imageSize: '1K' } : {}),
          },
        },
      });
    } catch (err: unknown) {
      if (signal.aborted || !(err instanceof ApiError) || err.status >= 500) {
        throw unknownImageStatus('Nano Banana');
      }
      if (err instanceof ApiError && (err.status === 403 || err.status === 429)) {
        throw Object.assign(
          new Error(`Gemini 生图请求失败（HTTP ${err.status}），请检查模型权限、配额和计费设置`),
          { code: 'PROVIDER_QUOTA_OR_BILLING' }
        );
      }
      throw Object.assign(new Error('Gemini 生图调用失败，请稍后重试'), { code: 'PROVIDER_ERROR' });
    }
    signal.throwIfAborted();

    for (const part of response.candidates?.[0]?.content?.parts ?? []) {
      const inline = part.inlineData;
      if (part.thought || !inline?.data) continue;
      const bytes = Buffer.from(inline.data, 'base64');
      const image = inspectImageBuffer(bytes);
      if (!image || image.mimeType !== inline.mimeType) continue;

      return {
        resultKind: 'generated',
        image: { bytes, ext: image.ext, mimeType: image.mimeType },
        provider: 'cloud',
        providerRequestId: response.sdkHttpResponse?.headers?.['x-request-id'] || response.responseId || null,
        suggestedName: `${input.personaName.slice(0, 2)}小果`,
        keywords: [input.personaMbti, ...getDisplayLabels(input).slice(0, 2)],
      };
    }

    throw Object.assign(new Error(`Gemini（${targetModel}）未返回可保存的成品图`), { code: 'PROVIDER_ERROR' });
  }
}

function escapeXml(str: string): string {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

class MockImageProvider implements ImageProvider {
  readonly mode = 'mock' as const;

  async generate(input: ImageGenerateInput, signal: AbortSignal): Promise<ImageGenerateResult> {
    const delayMs = 1500 + (input.versionNumber % 3) * 300;

    await new Promise<void>((resolve, reject) => {
      const timer = setTimeout(resolve, delayMs);
      const onAbort = () => {
        clearTimeout(timer);
        reject(Object.assign(new Error('生图任务已超时或取消'), { code: 'GENERATION_TIMEOUT' }));
      };
      if (signal.aborted) {
        onAbort();
        return;
      }
      signal.addEventListener('abort', onAbort, { once: true });
    });

    if (input.simulateFail) {
      throw Object.assign(new Error('（Mock 模拟）生图服务返回临时失败，已计入生成次数'), {
        code: 'PROVIDER_ERROR',
      });
    }

    const matchedIdx = Math.max(
      0,
      FALLBACK_TEMPLATES.findIndex((t) => t.recommendedMbti.includes(input.personaMbti))
    );
    const pickedTemplate = FALLBACK_TEMPLATES[(matchedIdx + (input.versionNumber - 1)) % FALLBACK_TEMPLATES.length];
    const resolvedAsset = resolveLocalAssetFile(pickedTemplate.imageUrl);

    let embeddedDataUri = '';
    if (resolvedAsset) {
      const b64 = fs.readFileSync(resolvedAsset.absPath).toString('base64');
      embeddedDataUri = `data:${resolvedAsset.mime};base64,${b64}`;
    }

    const tapeColors = ['#B9DDD3', '#E8D2B5', '#D6CBE0'];
    const tapeColor = tapeColors[(input.versionNumber - 1) % tapeColors.length];
    const labels = getDisplayLabels(input);
    const accSummary = labels.length > 0 ? labels.slice(0, 3).join(' · ') : input.personaMaterialHint;

    const svg = `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" width="900" height="1060" viewBox="0 0 900 1060">
  <rect width="900" height="1060" fill="#FBF6EE"/>
  <rect x="44" y="54" width="812" height="960" rx="28" fill="#FFFDF9" stroke="#E4D6C4" stroke-width="2"/>
  <rect x="62" y="72" width="776" height="924" rx="20" fill="none" stroke="#E4D6C4" stroke-width="1.5" stroke-dasharray="6 6"/>
  <rect x="345" y="28" width="210" height="44" rx="6" fill="${tapeColor}" fill-opacity="0.82" transform="rotate(-1.5 450 50)"/>
  <defs>
    <clipPath id="portraitClip">
      <rect x="96" y="102" width="708" height="718" rx="18"/>
    </clipPath>
  </defs>
  <rect x="96" y="102" width="708" height="718" rx="18" fill="#FFFFFF"/>
  ${
    embeddedDataUri
      ? `<image href="${embeddedDataUri}" x="96" y="102" width="708" height="718" preserveAspectRatio="xMidYMid meet" clip-path="url(#portraitClip)"/>`
      : ''
  }
  <text x="98" y="878" font-family="Georgia, 'Noto Serif SC', serif" font-size="34" font-weight="600" fill="#523B2D">
    ${escapeXml(input.personaName)} · ${escapeXml(input.personaMbti)}
  </text>
  <text x="802" y="876" text-anchor="end" font-family="monospace" font-size="18" fill="#5E998C">
    V${input.versionNumber} · MOCK 手帐样张
  </text>
  <line x1="98" y1="902" x2="802" y2="902" stroke="#E8DCCB" stroke-width="1.5" stroke-dasharray="5 5"/>
  <text x="98" y="942" font-family="sans-serif" font-size="20" fill="#876E5D">
    定制给 ${escapeXml(input.userNickname)} · 在库材料：${escapeXml(accSummary)}
  </text>
  <text x="98" y="976" font-family="monospace" font-size="14" fill="#A69080">
    果壳碰碰手帐本 · 版本编号 ${escapeXml(input.versionId)}
  </text>
</svg>`;

    const resultUrl = await saveGeneratedAsset(input.versionId, 'svg', Buffer.from(svg, 'utf-8'), 'image/svg+xml');

    const nameSuggestions: Record<string, string> = {
      ENFP: '薄荷栗子',
      INTJ: '紫雾松果',
      INFP: '蜜桃小云',
      ESTP: '焦糖阿奔',
      INFJ: '青岚橡果',
      ENFJ: '向阳榛子',
      INTP: '松墨核桃',
      ENTP: '跳跳松子',
      ENTJ: '金穗松果',
      ISTJ: '方格栗壳',
      ISFJ: '暖绒栗子',
      ESTJ: '铜铃核桃',
      ESFJ: '蜜糖榛果',
      ISTP: '铆钉栗子',
      ISFP: '露草橡果',
      ESFP: '霓虹彩果',
    };

    return {
      resultUrl,
      resultKind: 'mock',
      provider: 'mock',
      providerRequestId: `mock_img_${crypto.randomBytes(6).toString('hex')}`,
      suggestedName: nameSuggestions[input.personaMbti] || `${input.personaName.slice(0, 2)}小果`,
      keywords: [input.personaMbti, ...labels.slice(0, 2)],
    };
  }
}

function unknownImageStatus(vendor: string): Error {
  return Object.assign(new Error(`${vendor} 任务状态未能确认，请先在服务商控制台核对结果与费用`), {
    code: 'GENERATION_STATUS_UNKNOWN',
  });
}

class OpenAIImageProvider implements ImageProvider {
  readonly mode = 'cloud' as const;

  async generate(input: ImageGenerateInput, signal: AbortSignal): Promise<ImageGenerateResult> {
    if (!isImageCloudConfigured('openai')) {
      throw Object.assign(new Error('GPT 生图尚未配置 OPENAI_API_KEY'), { code: 'PROVIDER_NOT_CONFIGURED' });
    }

    const references = await loadMaterialReferenceImages(input);
    const form = new FormData();
    form.set('model', input.imageModel);
    form.set('prompt', buildDollImagePrompt(input, references.map(({ label }) => label)));
    form.set('size', '1024x1536');
    form.set('quality', input.imageModelTier === 'hd' ? 'high' : 'low');
    form.set('output_format', 'webp');
    if (!input.useExactMaterialReferences) {
      const photo = new Blob([Uint8Array.from(input.photoBuffer)], { type: input.photoMime });
      form.append('image[]', photo, 'reference.' + (input.photoMime.split('/')[1] || 'jpg'));
    }
    for (const { id, mime, data } of references) {
      form.append('image[]', new Blob([Uint8Array.from(data)], { type: mime }), id + '.webp');
    }

    let response: Response;
    try {
      response = await fetch(config.openaiApiBase + '/images/edits', {
        method: 'POST',
        body: form,
        headers: { Authorization: 'Bearer ' + config.openaiImageKey },
        signal,
      });
    } catch {
      throw unknownImageStatus('OpenAI');
    }
    if (response.status >= 500 || response.status === 408) throw unknownImageStatus('OpenAI');
    if (!response.ok) {
      const quota = [401, 402, 403, 429].includes(response.status);
      throw Object.assign(new Error(`GPT 生图请求失败（HTTP ${response.status}）`), {
        code: quota ? 'PROVIDER_QUOTA_OR_BILLING' : 'PROVIDER_ERROR',
      });
    }

    const payload = await response.json().catch(() => { throw unknownImageStatus('OpenAI'); });
    const data = payload?.data?.[0]?.b64_json;
    const bytes = Buffer.from(typeof data === 'string' ? data : '', 'base64');
    const image = inspectImageBuffer(bytes);
    if (!image) {
      throw Object.assign(new Error('GPT 生图服务未返回可读取的图片'), { code: 'PROVIDER_ERROR' });
    }
    return {
      resultKind: 'generated',
      image: { bytes, ext: image.ext, mimeType: image.mimeType },
      provider: 'cloud',
      providerRequestId: response.headers.get('x-request-id'),
      suggestedName: `${input.personaName.slice(0, 2)}小果`,
      keywords: [input.personaMbti, ...getDisplayLabels(input).slice(0, 2)],
    };
  }
}

const geminiImageProvider = new GeminiImageProvider();
const openAIImageProvider = new OpenAIImageProvider();
const mockImageProvider = new MockImageProvider();

export function getImageProvider(mode: 'mock' | 'cloud', vendor: ImageVendor): ImageProvider {
  if (mode === 'mock') return mockImageProvider;
  return vendor === 'gemini' ? geminiImageProvider : openAIImageProvider;
}
