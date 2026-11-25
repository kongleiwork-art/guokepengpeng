import type { AccessoryOption, MaterialCategory } from './types.ts';

export const MATERIAL_CATEGORY_LABELS: Record<MaterialCategory, string> = {
  nut_body: '果壳',
  fruit_body: '果实',
  fabric_outfit: '布料',
  yarn_hair: '毛线',
  marine_charm: '海洋饰件',
  hardware_charm: '辅料',
  dried_botanical: '干花与植物',
};

const PART_BY_CATEGORY: Record<MaterialCategory, string> = {
  nut_body: '壳体',
  fruit_body: '果实部件',
  fabric_outfit: '服饰',
  yarn_hair: '发饰',
  marine_charm: '饰件',
  hardware_charm: '配件',
  dried_botanical: '点缀',
};

const PART_BY_MATERIAL: Record<string, string> = {
  kit_capped_acorn: '头部',
  kit_walnut: '身体',
  kit_cloud_cotton: '围巾或衣片',
  kit_hemp_twine: '绳臂或系带',
  kit_toy_eyes_nose: '眼睛和鼻子',
  kit_resin_eyes: '眼睛',
  kit_resin_glasses: '眼镜',
  kit_coconut_buttons: '纽扣',
  kit_animal_buttons: '纽扣',
  kit_screw_eyes: '挂环',
  kit_camphor_slice: '底座',
};

export function materialPart(id: string, category: MaterialCategory = 'hardware_charm'): string {
  return Object.hasOwn(PART_BY_MATERIAL, id) ? PART_BY_MATERIAL[id] : PART_BY_CATEGORY[category];
}

const DEFAULT_MATERIALS = [
  'kit_capped_acorn', 'kit_walnut', 'kit_cloud_cotton', 'kit_hemp_twine', 'kit_toy_eyes_nose',
];

export function defaultMaterialIds(materials: Pick<AccessoryOption, 'id' | 'category'>[]): string[] {
  const ids = new Set(materials.map(material => material.id));
  const design = DEFAULT_MATERIALS.filter(id => ids.has(id));
  if (design.length) return design;
  const body = materials.find(material => material.category === 'nut_body' || material.category === 'fruit_body');
  return [...new Set([...(body ? [body.id] : []), ...materials.slice(0, 2).map(material => material.id)])].slice(0, 2);
}
