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

export async function writeUrlToNfcTag(url: string): Promise<{ ok: boolean; message: string; copied?: boolean }> {
  const validTagUrl = isIphoneBackgroundReadCompatible(url) && /^https:\/\/[^/]+\/nfc\/[a-z0-9_-]{2,64}$/i.test(url);
  if (!validTagUrl) return { ok: false, message: '请选择完整的 NFC HTTPS 短链接' };
  if (!isWebNfcSupported()) {
    if (isIosDevice()) {
      try {
        await navigator.clipboard.writeText(url);
        return {
          ok: true,
          copied: true,
          message:
            '已复制链接。打开 NFC Tools，选「写」→「添加记录」→「URL/URI」，粘贴链接后将 iPhone 顶部贴近标签写入。写完后读回同一张标签核对。',
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

export async function readUrlFromNfcTag(expectedUrl: string, timeoutMs = 15000): Promise<{
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
      const record = records[0];
      if (records.length !== 1 || record?.recordType !== 'url' || !record.data) {
        resolve({ ok: false, message: '标签应只包含一条 NDEF URL 记录' });
        return;
      }
      const url = decoder.decode(record.data);
      resolve(url === expectedUrl
        ? { ok: true, url, message: '读回的 URL 与此标签一致' }
        : { ok: false, url, message: '读回的 URL 与此标签不一致：' + url });

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
