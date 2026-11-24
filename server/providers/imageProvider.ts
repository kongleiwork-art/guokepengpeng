import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { GoogleGenAI } from '@google/genai';
import {
  config,
  IMAGE_MODEL_BY_TIER,
  isImageCloudConfigured,
  type ImageModelTier,
} from '../config.ts';
import { FALLBACK_TEMPLATES, getAccessoryLabels } from '../data/seed.ts';
import type { MaterialRecord } from '../db.ts';

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
  providerRequestId: string;
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

function saveGeneratedAsset(versionId: string, ext: string, data: Buffer): string {
  const safeExt = ext.replace(/[^a-z0-9]/gi, '').toLowerCase() || 'png';
  const filename = `${versionId}.${safeExt}`;
  const outPath = path.join(config.storagePath, 'generated', filename);
  fs.writeFileSync(outPath, data);
  return `/api/assets/generated/${filename}`;
}

function getDisplayLabels(input: ImageGenerateInput): string[] {
  if (input.selectedMaterials.length > 0) {
    return input.selectedMaterials.map((m) => m.label);
  }
  return getAccessoryLabels(input.accessoryIds);
}

class CloudImageProvider implements ImageProvider {
  readonly mode = 'cloud' as const;

  async generate(input: ImageGenerateInput, signal: AbortSignal): Promise<ImageGenerateResult> {
    if (!isImageCloudConfigured()) {
      throw Object.assign(
        new Error('真实生图服务未配置密钥（请在 Settings > Secrets 配置 GEMINI_API_KEY 或 IMAGE_API_KEY）'),
        { code: 'PROVIDER_NOT_CONFIGURED' }
      );
    }

    const startedAt = Date.now();
    const prompt = buildDollImagePrompt(input);

    if (config.imageApiBase) {
      return this.generateViaOpenAICompatible(input, prompt, startedAt, signal);
    }
    return this.generateViaGemini(input, prompt, startedAt, signal);
  }

  private async generateViaGemini(
    input: ImageGenerateInput,
    prompt: string,
    startedAt: number,
    signal: AbortSignal
  ): Promise<ImageGenerateResult> {
    const apiKey = config.imageApiKey || config.geminiApiKey;
    const ai = new GoogleGenAI({
      apiKey,
      httpOptions: {
        headers: {
          'User-Agent': 'aistudio-build',
        },
      },
    });

    const targetModel = input.imageModel || IMAGE_MODEL_BY_TIER[input.imageModelTier] || IMAGE_MODEL_BY_TIER.fast;

    const abortPromise = new Promise<never>((_, reject) => {
      if (signal.aborted) {
        reject(Object.assign(new Error('生图任务已超时或取消'), { code: 'GENERATION_TIMEOUT' }));
        return;
      }
      signal.addEventListener(
        'abort',
        () => reject(Object.assign(new Error('生图任务超过超时上限'), { code: 'GENERATION_TIMEOUT' })),
        { once: true }
      );
    });

    let response;
    try {
      response = await Promise.race([
        ai.models.generateContent({
          model: targetModel,
          contents: {
            parts: [
              {
                inlineData: {
                  data: input.photoBuffer.toString('base64'),
                  mimeType: input.photoMime,
                },
              },
              { text: prompt },
            ],
          },
          config: {
            imageConfig: {
              aspectRatio: '3:4',
              ...(input.imageModelTier === 'hd' ? { imageSize: '1K' } : {}),
            },
          },
        }),
        abortPromise,
      ]);
    } catch (err: unknown) {
      const rawMsg = err instanceof Error ? err.message : String(err);
      if (rawMsg.includes('GENERATION_TIMEOUT') || signal.aborted) {
        throw Object.assign(new Error('Nano 图像生成超过超时上限，可重试或使用预设模板兜底'), {
          code: 'GENERATION_TIMEOUT',
        });
      }
      if (
        rawMsg.includes('429') ||
        rawMsg.includes('RESOURCE_EXHAUSTED') ||
        rawMsg.includes('403') ||
        rawMsg.includes('PERMISSION_DENIED') ||
        rawMsg.includes('billing')
      ) {
        throw Object.assign(
          new Error(
            `Google Nano 模型（${targetModel}）需要已开通计费的 Gemini API Key。请在 Settings > Secrets 配置有效密钥，或先点击下方「预设模板兜底」或在 /dev 控制台切换演示模式。`
          ),
          { code: 'PROVIDER_QUOTA_OR_BILLING' }
        );
      }
      throw Object.assign(new Error(`Google Nano 出图调用失败：${rawMsg.slice(0, 200)}`), {
        code: 'PROVIDER_ERROR',
      });
    }

    const parts = response.candidates?.[0]?.content?.parts ?? [];
    for (const part of parts) {
      if (part.inlineData?.data) {
        const mime = part.inlineData.mimeType ?? 'image/png';
        const ext = mime.includes('jpeg') ? 'jpg' : mime.includes('webp') ? 'webp' : 'png';
        const imgBuf = Buffer.from(part.inlineData.data, 'base64');
        const resultUrl = saveGeneratedAsset(input.versionId, ext, imgBuf);
        const labels = getDisplayLabels(input);
        return {
          resultUrl,
          resultKind: 'generated',
          provider: 'cloud',
          providerRequestId: `nano_${input.imageModelTier}_${crypto.randomBytes(5).toString('hex')}`,
          latencyMs: Date.now() - startedAt,
          suggestedName: `${input.personaName.slice(0, 2)}小果`,
          keywords: [input.personaMbti, ...labels.slice(0, 2)],
        };
      }
    }

    throw Object.assign(new Error(`Google Nano（${targetModel}）未返回图像数据，请稍后重试`), {
      code: 'PROVIDER_ERROR',
    });
  }

  private async generateViaOpenAICompatible(
    input: ImageGenerateInput,
    prompt: string,
    startedAt: number,
    signal: AbortSignal
  ): Promise<ImageGenerateResult> {
    const endpoint = `${config.imageApiBase.replace(/\/+$/, '')}/images/generations`;
    const response = await fetch(endpoint, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${config.imageApiKey}`,
      },
      body: JSON.stringify({
        model: input.imageModel || config.imageModel,
        prompt,
        size: '1024x1024',
        response_format: 'b64_json',
      }),
      signal,
    });

    if (!response.ok) {
      const text = await response.text().catch(() => '');
      throw Object.assign(
        new Error(`云端生图接口返回 HTTP ${response.status}${text ? `: ${text.slice(0, 120)}` : ''}`),
        { code: 'PROVIDER_ERROR' }
      );
    }

    const payload = (await response.json()) as {
      data?: Array<{ b64_json?: string; url?: string }>;
    };
    const item = payload.data?.[0];
    let imgBuf: Buffer | null = null;
    let ext = 'png';

    if (item?.b64_json) {
      imgBuf = Buffer.from(item.b64_json, 'base64');
    } else if (item?.url) {
      const dl = await fetch(item.url, { signal });
      if (!dl.ok) {
        throw Object.assign(new Error('下载供应商临时图像地址失败'), { code: 'PROVIDER_ERROR' });
      }
      const ct = dl.headers.get('content-type') || 'image/png';
      ext = ct.includes('jpeg') ? 'jpg' : ct.includes('webp') ? 'webp' : 'png';
      imgBuf = Buffer.from(await dl.arrayBuffer());
    }

    if (!imgBuf) {
      throw Object.assign(new Error('云端生图响应缺少有效图片内容'), { code: 'PROVIDER_ERROR' });
    }

    const resultUrl = saveGeneratedAsset(input.versionId, ext, imgBuf);
    const labels = getDisplayLabels(input);
    return {
      resultUrl,
      resultKind: 'generated',
      provider: 'cloud',
      providerRequestId: response.headers.get('x-request-id') || `cloud_img_${crypto.randomBytes(6).toString('hex')}`,
      latencyMs: Date.now() - startedAt,
      suggestedName: `${input.personaName.slice(0, 2)}小果`,
      keywords: [input.personaMbti, ...labels.slice(0, 2)],
    };
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

    const resultUrl = saveGeneratedAsset(input.versionId, 'svg', Buffer.from(svg, 'utf-8'));

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

const cloudImageProvider = new CloudImageProvider();
const mockImageProvider = new MockImageProvider();

export function getImageProvider(mode: 'mock' | 'cloud' = config.imageProvider): ImageProvider {
  return mode === 'cloud' ? cloudImageProvider : mockImageProvider;
}
