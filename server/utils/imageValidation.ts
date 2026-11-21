export interface ValidatedImage {
  mimeType: 'image/jpeg' | 'image/png' | 'image/webp';
  ext: 'jpg' | 'png' | 'webp';
  width: number;
  height: number;
}

export const MAX_PHOTO_BYTES = 2 * 1024 * 1024; // 2 MB

function parsePngDimensions(buf: Buffer): { width: number; height: number } | null {
  if (buf.length < 24) return null;
  const sig = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  if (!buf.subarray(0, 8).equals(sig)) return null;
  if (buf.subarray(12, 16).toString('ascii') !== 'IHDR') return null;
  const width = buf.readUInt32BE(16);
  const height = buf.readUInt32BE(20);
  if (width <= 0 || height <= 0 || width > 16384 || height > 16384) return null;
  return { width, height };
}

function parseJpegDimensions(buf: Buffer): { width: number; height: number } | null {
  if (buf.length < 4 || buf[0] !== 0xff || buf[1] !== 0xd8) return null;
  let offset = 2;
  while (offset + 4 <= buf.length) {
    if (buf[offset] !== 0xff) return null;
    while (offset < buf.length && buf[offset] === 0xff) offset++;
    if (offset >= buf.length) break;
    const marker = buf[offset++];
    // Standalone markers without length
    if (marker === 0xd8 || marker === 0xd9 || (marker >= 0xd0 && marker <= 0xd7) || marker === 0x01) {
      if (marker === 0xd9) break;
      continue;
    }
    if (offset + 2 > buf.length) break;
    const segmentLength = buf.readUInt16BE(offset);
    if (segmentLength < 2 || offset + segmentLength > buf.length) return null;

    // SOF0..SOF3, SOF5..SOF7, SOF9..SOF11, SOF13..SOF15
    const isSof =
      (marker >= 0xc0 && marker <= 0xc3) ||
      (marker >= 0xc5 && marker <= 0xc7) ||
      (marker >= 0xc9 && marker <= 0xcb) ||
      (marker >= 0xcd && marker <= 0xcf);
    if (isSof) {
      if (offset + 7 > buf.length) return null;
      const height = buf.readUInt16BE(offset + 3);
      const width = buf.readUInt16BE(offset + 5);
      if (width <= 0 || height <= 0 || width > 16384 || height > 16384) return null;
      return { width, height };
    }
    offset += segmentLength;
  }
  return null;
}

function parseWebpDimensions(buf: Buffer): { width: number; height: number } | null {
  if (buf.length < 30) return null;
  if (buf.subarray(0, 4).toString('ascii') !== 'RIFF') return null;
  if (buf.subarray(8, 12).toString('ascii') !== 'WEBP') return null;
  const chunkHeader = buf.subarray(12, 16).toString('ascii');
  if (chunkHeader === 'VP8 ' && buf.length >= 30) {
    // Lossy VP8 bitstream
    if (buf[23] !== 0x9d || buf[24] !== 0x01 || buf[25] !== 0x2a) return null;
    const width = buf.readUInt16LE(26) & 0x3fff;
    const height = buf.readUInt16LE(28) & 0x3fff;
    if (width <= 0 || height <= 0) return null;
    return { width, height };
  }
  if (chunkHeader === 'VP8L' && buf.length >= 25) {
    if (buf[20] !== 0x2f) return null;
    const bits = buf.readUInt32LE(21);
    const width = (bits & 0x3fff) + 1;
    const height = ((bits >> 14) & 0x3fff) + 1;
    if (width <= 0 || height <= 0) return null;
    return { width, height };
  }
  if (chunkHeader === 'VP8X' && buf.length >= 30) {
    const width = 1 + (buf[24] | (buf[25] << 8) | (buf[26] << 16));
    const height = 1 + (buf[27] | (buf[28] << 8) | (buf[29] << 16));
    if (width <= 0 || height <= 0) return null;
    return { width, height };
  }
  return null;
}

export function validateImageBuffer(buf: Buffer): ValidatedImage {
  if (!buf || buf.length === 0) {
    throw Object.assign(new Error('上传的图片文件为空'), { code: 'UNSUPPORTED_IMAGE', status: 400 });
  }
  if (buf.length > MAX_PHOTO_BYTES) {
    throw Object.assign(new Error('图片体积超过 2 MB 上限，请压缩后再试'), {
      code: 'IMAGE_TOO_LARGE',
      status: 413,
    });
  }

  const png = parsePngDimensions(buf);
  if (png) {
    return { mimeType: 'image/png', ext: 'png', ...png };
  }

  const jpeg = parseJpegDimensions(buf);
  if (jpeg) {
    return { mimeType: 'image/jpeg', ext: 'jpg', ...jpeg };
  }

  const webp = parseWebpDimensions(buf);
  if (webp) {
    return { mimeType: 'image/webp', ext: 'webp', ...webp };
  }

  throw Object.assign(
    new Error('图片格式不受支持或文件内容无法解码，请上传有效的 JPEG、PNG 或 WebP 图片'),
    { code: 'UNSUPPORTED_IMAGE', status: 400 }
  );
}
