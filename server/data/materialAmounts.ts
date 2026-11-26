import type { MaterialAmount, MaterialSize } from '../../src/lib/types.ts';

function pick(unit: string, cm: number, kind: Exclude<MaterialSize['kind'], 'rectangle'> = 'length'): MaterialAmount {
  return { quantity: 1, unit, action: 'pick', size: { kind, cm } };
}

function cutSheet(lengthCm: number, widthCm: number, quantity = 1): MaterialAmount {
  return { quantity, unit: '片', action: 'cut', size: { kind: 'rectangle', lengthCm, widthCm } };
}

function cutLine(cm: number, quantity = 1): MaterialAmount {
  return { quantity, unit: '段', action: 'cut', size: { kind: 'length', cm } };
}

// Preparation estimates for one miniature doll, in centimeters or grams.
const amountsById: Record<string, MaterialAmount[]> = {
  kit_cloud_cotton: [cutSheet(12, 3)],
  kit_organza_mesh: [cutSheet(10, 5)],
  kit_satin_gradient: [cutSheet(10, 5)],
  kit_fabric_scraps: [cutSheet(3, 2, 2)],
  kit_green_gauze: [cutSheet(12, 5)],
  kit_fabric_pieces: [cutSheet(10, 6)],

  kit_egg_shell: [pick('个', 6, 'height')],
  kit_half_bowl: [pick('片', 5, 'diameter')],
  kit_doll_blank: [pick('件', 6, 'height')],
  kit_water_bell: [pick('颗', 4.5)],
  kit_panji: [pick('片', 4.5)],
  kit_plant_bowl: [pick('片', 5, 'diameter')],
  kit_walnut: [pick('瓣', 3.5)],
  kit_large_pod: [pick('片', 6)],
  kit_double_pod: [pick('片', 4)],

  kit_pala: [pick('颗', 3)],
  kit_five_eye_fruit: [pick('颗', 2.5)],
  kit_rangoon_creeper: [pick('颗', 3)],
  kit_eucalyptus: [pick('颗', 1.5)],
  kit_cross_fruit: [pick('颗', 2.5, 'width')],
  kit_citrus: [pick('片', 3, 'diameter')],
  kit_capped_acorn: [pick('颗', 2.5, 'height')],
  kit_peace_bean: [pick('颗', 2.5, 'width')],
  kit_football_acorn: [pick('颗', 3)],
  kit_ring_cup: [pick('个', 2, 'diameter')],
  kit_soap_pod: [pick('片', 6)],
  kit_soap_bean: [pick('颗', 1.5)],
  kit_mini_pumpkin: [pick('个', 4, 'width')],
  kit_mini_acorn: [pick('颗', 1.5, 'height')],
  kit_camphor_slice: [pick('片', 5, 'diameter')],

  kit_mixed_yarn: [cutLine(5, 6)],
  kit_teddy_wig: [pick('顶', 3, 'width')],
  kit_teddy_wool: [{ quantity: 0.5, unit: '克', action: 'pick' }],
  kit_mohair_silk: [cutLine(5, 8)],

  kit_seashell_mix: [pick('枚', 1.5)],
  kit_sea_decor: [pick('枚', 1.5, 'width')],
  kit_starfish_bead: [pick('粒', 1, 'width')],
  kit_micro_shells: [pick('枚', 0.8)],

  kit_leaf_vine: [cutLine(6)],
  kit_moss_mat: [cutSheet(4, 4)],
  kit_animal_buttons: [pick('枚', 0.8, 'width')],
  kit_resin_glasses: [pick('副', 2.2, 'width')],
  kit_moss_sprite: [pick('个', 1.5, 'width')],
  kit_check_bows: [pick('件', 2, 'width')],
  kit_resin_eyes: [{ ...pick('枚', 0.5, 'width'), quantity: 2, part: '眼睛' }],
  kit_color_check_bows: [pick('件', 2, 'width')],
  kit_coconut_buttons: [pick('枚', 0.8, 'diameter')],
  kit_toy_eyes_nose: [
    { ...pick('枚', 0.4, 'diameter'), quantity: 2, part: '眼睛' },
    { ...pick('枚', 0.5, 'width'), part: '鼻子' },
  ],
  kit_matte_bows: [pick('件', 1.5, 'width')],
  kit_warm_bows: [pick('件', 2, 'width')],
  kit_mini_bows: [pick('件', 1.2, 'width')],
  kit_screw_eyes: [pick('枚', 0.8)],
  kit_waxed_cord: [cutLine(12)],
  kit_suede_cord: [cutLine(12)],
  kit_hemp_twine: [cutLine(6, 2)],

  hat_gingham: [pick('顶', 3, 'width')],
  bell_copper: [pick('枚', 0.8, 'diameter')],
  scarf: [pick('条', 12)],
  ribbon: [pick('件', 2, 'width')],
  button: [pick('枚', 0.8, 'diameter')],
  glasses: [pick('副', 2.2, 'width')],
  nutshell: [pick('瓣', 3.5)],
  wool_yarn: [cutLine(5, 6)],
  wool_felt: [pick('件', 4, 'height')],
  twine: [cutLine(6, 2)],
  dried_flower: [pick('支', 4)],
};

export function getMaterialAmounts(id: string): MaterialAmount[] {
  return Object.hasOwn(amountsById, id) ? amountsById[id] : [{ quantity: 1, unit: '件', action: 'pick' }];
}
