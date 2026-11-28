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
  kit_green_gauze: '单层围布',
  kit_satin_gradient: '单层围布',
  kit_fabric_pieces: '单层围布',
  kit_fabric_scraps: '拼布片',
  kit_waxed_cord: '系带',
  kit_suede_cord: '系带',
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

export function isDollBodyMaterial(material: Pick<AccessoryOption, 'id' | 'category'>): boolean {
  return material.id !== 'kit_camphor_slice' && (material.category === 'nut_body' || material.category === 'fruit_body');
}

export function recommendedMaterialIds(
  preferredIds: readonly string[] | undefined,
  materials: Pick<AccessoryOption, 'id' | 'category'>[],
): string[] {
  const preferred = (preferredIds ?? []).flatMap(id => {
    const material = materials.find(item => item.id === id);
    return material ? [material] : [];
  });
  const body = preferred.find(isDollBodyMaterial) ?? materials.find(item => item.id === 'kit_capped_acorn') ??
    materials.find(isDollBodyMaterial);
  const isFace = (item: { id: string }) => item.id === 'kit_toy_eyes_nose' || item.id === 'kit_resin_eyes';
  const fabric = preferred.find(item => item.category === 'fabric_outfit') ??
    materials.find(item => item.id === 'kit_cloud_cotton') ?? materials.find(item => item.category === 'fabric_outfit');
  const detail = preferred.find(item => !isDollBodyMaterial(item) && !isFace(item) && item.category !== 'fabric_outfit') ??
    materials.find(item => item.id === 'kit_hemp_twine');
  const face = preferred.find(isFace) ?? materials.find(item => item.id === 'kit_toy_eyes_nose') ?? materials.find(isFace);
  return [body, fabric, detail, face].flatMap(item => item ? [item.id] : []);
}

export function dollMaterialPart(item: Pick<AccessoryOption, 'id' | 'category'>, plan: Pick<AccessoryOption, 'id' | 'category'>[]) {
  if (isDollBodyMaterial(item) && plan.filter(isDollBodyMaterial).length === 1) return '娃娃主体';
  return materialPart(item.id, item.category);
}

export function describeDollMaterials(materials: AccessoryOption[]): string {
  return materials.map(item => item.label + '做' + dollMaterialPart(item, materials)).join('，') + (materials.length ? '。' : '');
}

export function composePhotoMaterials(roleKit: readonly string[], photoFabricId: string | undefined, stock: AccessoryOption[], variant?: string) {
  const fabric = stock.find(item => item.id === photoFabricId && item.category === 'fabric_outfit');
  const preferred = roleKit.map((id, index) => index === 1 && fabric ? fabric.id : id);
  const suggestedMaterialIds = recommendedMaterialIds(preferred, stock);
  const materialPlan = suggestedMaterialIds.map(id => stock.find(item => item.id === id)!);
  const fabricNote = fabric && variant && suggestedMaterialIds.includes(fabric.id) ? fabric.label + '选' + variant + '。' : '';
  return { suggestedMaterialIds, materialPlan, dollDesign: describeDollMaterials(materialPlan) + fabricNote };
}
