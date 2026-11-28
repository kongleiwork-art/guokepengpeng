import fs from 'node:fs';
import path from 'node:path';
import { selectedFabricSwatch } from '../data/materialPack.ts';

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

export async function readMaterialArtwork(id: string, absPath: string, dollDesign?: string) {
  const crop = selectedFabricSwatch(id, dollDesign)?.crop;
  if (!crop) return fs.promises.readFile(absPath);
  const { default: sharp } = await import('sharp');
  return sharp(absPath).extract(crop).webp({ quality: 92 }).toBuffer();
}
