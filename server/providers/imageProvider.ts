import fs from 'node:fs';
import path from 'node:path';
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

export interface ImageGenerateInput {
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
  strictMaterialConstraint: boolean;
  imageModelTier: ImageModelTier;
  imageModel: string;
  simulateFail?: boolean;
}

export interface ImageGenerateResult {
  resultUrl: string;
  resultKind: 'generated' | 'mock';
  provider: string;
  providerRequestId: string | null;
  latencyMs: number;
  suggestedName?: string;
  keywords?: string[];
}

export interface ImageProvider {
  readonly mode: 'mock' | 'cloud' | 'rdk';
  generate(input: ImageGenerateInput, signal: AbortSignal): Promise<ImageGenerateResult>;
}

export function buildDollImagePrompt(input: ImageGenerateInput): string {
  const matLines =
    input.selectedMaterials.length > 0
      ? input.selectedMaterials
          .map((m) => `- ${m.label} (${m.material}): ${m.visualHint}`)
          .join('\n')
      : `- Natural dried nut shell doll base with cotton-linen cloth body (${input.personaMaterialHint})`;

  const strictRules = input.strictMaterialConstraint
    ? 'STRICT CRAFTABILITY RULE: Every visible component of this doll MUST be physically buildable in a real campus craft workshop using ONLY the selected real materials above (natural dried nut shells, wool yarn, woven cotton/linen fabric, wooden beads, twine, brass bells, dried flowers). Do NOT invent sci-fi holograms, glowing neon crystals, glass wings, metallic armor, or uncraftable fantasy props.'
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
    strictRules,
    'Art direction: visible delicate watercolor washes, fine colored-pencil stitch lines, tiny glossy dark bead eyes, gentle coral-peach rosy cheeks, soft grounded watercolor shadow beneath feet, pure crisp white background, single centered full-body doll, zero text, zero letters, zero watermark.',
  ].join('\n');
}

function resolveLocalAssetFile(urlPath: string): { absPath: string; mime: string } | null {
  const clean = urlPath.replace(/^\/+/, '');
  const candidates = [
    path.resolve(process.cwd(), clean),
    path.resolve(process.cwd(), 'public', clean),
  ];
  for (const absPath of candidates) {
    if (fs.existsSync(absPath)) {
      const ext = path.extname(absPath).toLowerCase();
      const mime = ext === '.png' ? 'image/png' : ext === '.webp' ? 'image/webp' : 'image/jpeg';
      return { absPath, mime };
    }
  }
  return null;
}

async function saveGeneratedAsset(versionId: string, ext: string, data: Buffer, mime: string): Promise<string> {
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

    const startedAt = Date.now();
    const prompt = buildDollImagePrompt(input);

    const ai = new GoogleGenAI({
      apiKey: config.geminiApiKey,
      vertexai: false,
      httpOptions: { baseUrl: config.geminiImageBaseUrl, apiVersion: 'v1beta', timeout: config.imageTimeoutMs, retryOptions: { attempts: 1 } },
    });
    const targetModel = input.imageModel || IMAGE_MODELS.gemini[input.imageModelTier];
    let response;
    try {
      response = await ai.models.generateContent({
        model: targetModel,
        contents: [{
          role: 'user',
          parts: [
            { inlineData: { data: input.photoBuffer.toString('base64'), mimeType: input.photoMime } },
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
        resultUrl: await saveGeneratedAsset(input.versionId, image.ext, bytes, image.mimeType),
        resultKind: 'generated',
        provider: 'cloud',
        providerRequestId: response.sdkHttpResponse?.headers?.['x-request-id'] || response.responseId || null,
        latencyMs: Date.now() - startedAt,
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
    const startedAt = Date.now();
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
      latencyMs: Date.now() - startedAt,
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

    const startedAt = Date.now();
    const form = new FormData();
    form.set('model', input.imageModel);
    form.set('prompt', buildDollImagePrompt(input));
    form.set('size', '1024x1536');
    form.set('quality', input.imageModelTier === 'hd' ? 'high' : 'low');
    form.set('output_format', 'webp');
    const photo = new Blob([Uint8Array.from(input.photoBuffer)], { type: input.photoMime });
    form.append('image[]', photo, 'reference.' + (input.photoMime.split('/')[1] || 'jpg'));

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
    const resultUrl = await saveGeneratedAsset(input.versionId, image.ext, bytes, image.mimeType);
    return {
      resultUrl,
      resultKind: 'generated',
      provider: 'cloud',
      providerRequestId: response.headers.get('x-request-id'),
      latencyMs: Date.now() - startedAt,
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
