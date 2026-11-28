import fs from 'node:fs';
import path from 'node:path';

export function resolveLocalAssetFile(urlPath: string): { absPath: string; mime: string } | null {
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
