/**
 * Web NFC (NDEFReader) helper for writing and reading NTAG213/215 URL records
 * directly from Android Chrome over HTTPS (or localhost).
 */

interface NdefRecordLike {
  recordType: string;
  data?: DataView;
}

interface NdefReadingEventLike {
  message?: {
    records?: NdefRecordLike[];
  };
}

interface NdefReaderLike {
  write: (
    message: { records: Array<{ recordType: 'url'; data: string }> },
    options?: { overwrite?: boolean; signal?: AbortSignal }
  ) => Promise<void>;
  scan: (options?: { signal?: AbortSignal }) => Promise<void>;
  onreading: ((event: NdefReadingEventLike) => void) | null;
  onreadingerror: (() => void) | null;
}

type WindowWithNdef = Window & {
  NDEFReader?: new () => NdefReaderLike;
};

export function isWebNfcSupported(): boolean {
  return typeof window !== 'undefined' && typeof (window as WindowWithNdef).NDEFReader === 'function';
}

export function isIosDevice(): boolean {
  if (typeof navigator === 'undefined') return false;
  const ua = navigator.userAgent || '';
  const isClassicIos = /iPhone|iPad|iPod/i.test(ua);
  const isIpadOsDesktop =
    navigator.platform === 'MacIntel' && typeof navigator.maxTouchPoints === 'number' && navigator.maxTouchPoints > 1;
  return isClassicIos || isIpadOsDesktop;
}

export function isIphoneBackgroundReadCompatible(url: string): boolean {
  try {
    const parsed = new URL(url);
    const isLocal =
      parsed.hostname === 'localhost' ||
      parsed.hostname === '127.0.0.1' ||
      parsed.hostname.endsWith('.local');
    return parsed.protocol === 'https:' && !isLocal;
  } catch {
    return false;
  }
}

export async function writeUrlToNfcTag(url: string): Promise<{ ok: boolean; message: string; iosCopied?: boolean }> {
  if (!isWebNfcSupported()) {
    if (isIosDevice()) {
      try {
        await navigator.clipboard.writeText(url);
        return {
          ok: true,
          iosCopied: true,
          message:
            '已为你复制链接！由于苹果 iOS 禁止网页直接写卡，请切到免费 App「NFC Tools」→ 写 → 添加记录 → URL/URI → 粘贴并点「写」，用 iPhone 顶部贴近贴纸 1 秒完成（写完后任意 iPhone 碰一碰都可直接原生弹窗打开）。',
        };
      } catch {
        return {
          ok: false,
          message:
            '苹果 iOS 系统禁止网页直接写卡，请先复制下方链接，再用免费 App「NFC Tools」写入 NTAG213/215 贴纸（写完后 iPhone 亮屏顶部贴近即可直接原生弹窗唤醒）。',
        };
      }
    }
    return {
      ok: false,
      message:
        '当前浏览器不支持 Web NFC 直写（仅 Android Chrome + HTTPS 支持）。请使用手机 App「NFC Tools」（iPhone / Android 均免费）粘贴链接写入标签。',
    };
  }

  try {
    const NDEFReaderCtor = (window as WindowWithNdef).NDEFReader!;
    const ndef = new NDEFReaderCtor();
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 20000);
    try {
      await ndef.write(
        {
          records: [{ recordType: 'url', data: url }],
        },
        { overwrite: true, signal: controller.signal }
      );
      return {
        ok: true,
        message: '已成功将固定链接写入 NFC 贴纸！可以立刻再贴一次进行读回校验。',
      };
    } finally {
      clearTimeout(timer);
    }
  } catch (err) {
    const name = err instanceof Error ? err.name : '';
    const msg = err instanceof Error ? err.message : String(err);
    if (name === 'AbortError') {
      return { ok: false, message: '等待贴近 NFC 标签超时（20 秒），请将标签紧贴手机背面感应区再试。' };
    }
    if (name === 'NotAllowedError') {
      return { ok: false, message: '浏览器未授予 NFC 权限，请在地址栏允许 NFC 访问后重试。' };
    }
    return { ok: false, message: `写入失败：${msg}` };
  }
}

export async function readUrlFromNfcTag(timeoutMs = 15000): Promise<{
  ok: boolean;
  url?: string;
  message: string;
}> {
  if (!isWebNfcSupported()) {
    return {
      ok: false,
      message: '当前浏览器不支持 Web NFC 读回校验（需 Android Chrome + HTTPS）。',
    };
  }

  const NDEFReaderCtor = (window as WindowWithNdef).NDEFReader!;
  const ndef = new NDEFReaderCtor();
  const controller = new AbortController();

  return new Promise((resolve) => {
    const timer = setTimeout(() => {
      controller.abort();
      resolve({ ok: false, message: '等待贴近标签读回超时（15 秒），请重试。' });
    }, timeoutMs);

    ndef.onreading = (event) => {
      clearTimeout(timer);
      controller.abort();
      const records = event.message?.records ?? [];
      const decoder = new TextDecoder();
      for (const rec of records) {
        if (rec.recordType === 'url' && rec.data) {
          const decoded = decoder.decode(rec.data);
          resolve({ ok: true, url: decoded, message: `读回成功：${decoded}` });
          return;
        }
      }
      resolve({ ok: false, message: '读到空白标签或非 URL 记录。' });
    };

    ndef.onreadingerror = () => {
      clearTimeout(timer);
      controller.abort();
      resolve({ ok: false, message: '读取 NFC 标签出错，请换个位置再贴一次。' });
    };

    ndef.scan({ signal: controller.signal }).catch((err: unknown) => {
      clearTimeout(timer);
      const msg = err instanceof Error ? err.message : String(err);
      resolve({ ok: false, message: `无法启动 NFC 读卡：${msg}` });
    });
  });
}
