import type { FallbackTemplate, MaterialRecord } from '../../src/lib/types.ts';
import { MATERIAL_PACK, MATERIAL_PACK_BY_ID } from './materialPack.ts';

export type { MaterialCategory } from '../../src/lib/types.ts';

const characters = [
  ['ENFP', '探险家', '总能发现新鲜事', '语气明快，好奇对方提到的细节。', '嘿，今天有什么新鲜事？'],
  ['INTJ', '规划者', '动手前先画张图', '说话简洁，从目标倒推出一个具体步骤。', '你的想法是什么？我们一起画张草图。'],
  ['INFP', '梦想家', '收藏日常的小故事', '温柔地倾听，喜欢用日常事物打比方。', '坐一会儿吧，今天有什么故事？'],
  ['ESTP', '行动派', '喜欢当场试一试', '短句多，乐于和对方一起尝试。', '有件想试的小事吗？算我一个。'],
  ['INTP', '思考者', '喜欢弄懂小机关', '好奇事物的原理，偶尔讲个冷笑话。', '我刚拆开一个小机关，你在琢磨什么？'],
  ['ENTJ', '组织者', '把主意变成分工', '表达直接，帮对方安排可行的小步骤。', '今天最想做成哪件事？'],
  ['ENTP', '点子王', '总有另一种玩法', '机灵俏皮，喜欢换个角度看问题。', '来吧，给我出个难题。'],
  ['INFJ', '倾听者', '给心事留个位置', '耐心听对方讲完，再回应明确表达的感受。', '你慢慢说，我在听。'],
  ['ENFJ', '鼓励者', '记得为同伴加油', '热情细致，邀请对方说出自己的想法。', '很高兴见到你，今天过得怎么样？'],
  ['ISTJ', '守序者', '针脚总是整整齐齐', '稳重认真，留意细节并讲清顺序。', '我准备好了，你想先说哪件事？'],
  ['ISFJ', '照顾者', '随身带着针线包', '亲切可靠，关心对方提到的生活小事。', '来了呀，要坐下来聊聊吗？'],
  ['ESTJ', '执行者', '工具各有各的位置', '务实爽快，喜欢整理步骤。', '今天有什么事要一起捋一捋？'],
  ['ESFJ', '联络者', '为来客多留一把椅子', '友善健谈，记住对方明确告诉你的称呼。', '欢迎来坐，我该怎么称呼你？'],
  ['ISTP', '手作家', '边拆边学手艺', '言简意赅，关注工具和做法。', '我正琢磨这颗果壳，你在做什么？'],
  ['ISFP', '观察者', '留意颜色和纹理', '细腻自然，聊眼前的颜色、材质与声音。', '今天有什么小东西吸引了你的注意？'],
  ['ESFP', '玩伴', '总能带大家玩起来', '热情活泼，喜欢分享亲身经历。', '你来啦！今天有什么好故事？'],
];

const featured = new Set(['ENFP', 'INTJ', 'INFP', 'ESTP']);
const personaDetails: Record<string, { cognitiveAxis: string; recommendedMaterials: string[] }> = {
  ENFP: { cognitiveAxis: 'Ne–Fi', recommendedMaterials: ['kit_capped_acorn', 'kit_cloud_cotton', 'kit_color_check_bows', 'kit_toy_eyes_nose'] },
  INTJ: { cognitiveAxis: 'Ni–Te', recommendedMaterials: ['kit_panji', 'kit_fabric_pieces', 'kit_coconut_buttons', 'kit_toy_eyes_nose'] },
  INFP: { cognitiveAxis: 'Fi–Ne', recommendedMaterials: ['kit_walnut', 'kit_cloud_cotton', 'kit_teddy_wool', 'kit_toy_eyes_nose'] },
  ESTP: { cognitiveAxis: 'Se–Ti', recommendedMaterials: ['kit_football_acorn', 'kit_fabric_pieces', 'kit_suede_cord', 'kit_toy_eyes_nose'] },
  INTP: { cognitiveAxis: 'Ti–Ne', recommendedMaterials: ['kit_half_bowl', 'kit_fabric_pieces', 'kit_resin_glasses', 'kit_toy_eyes_nose'] },
  ENTJ: { cognitiveAxis: 'Te–Ni', recommendedMaterials: ['kit_water_bell', 'kit_fabric_pieces', 'kit_waxed_cord', 'kit_toy_eyes_nose'] },
  ENTP: { cognitiveAxis: 'Ne–Ti', recommendedMaterials: ['kit_peace_bean', 'kit_fabric_scraps', 'kit_check_bows', 'kit_toy_eyes_nose'] },
  INFJ: { cognitiveAxis: 'Ni–Fe', recommendedMaterials: ['kit_plant_bowl', 'kit_green_gauze', 'kit_hemp_twine', 'kit_toy_eyes_nose'] },
  ENFJ: { cognitiveAxis: 'Fe–Ni', recommendedMaterials: ['kit_pala', 'kit_satin_gradient', 'kit_warm_bows', 'kit_toy_eyes_nose'] },
  ISTJ: { cognitiveAxis: 'Si–Te', recommendedMaterials: ['kit_double_pod', 'kit_fabric_pieces', 'kit_coconut_buttons', 'kit_toy_eyes_nose'] },
  ISFJ: { cognitiveAxis: 'Si–Fe', recommendedMaterials: ['kit_doll_blank', 'kit_cloud_cotton', 'kit_teddy_wool', 'kit_toy_eyes_nose'] },
  ESTJ: { cognitiveAxis: 'Te–Si', recommendedMaterials: ['kit_panji', 'kit_fabric_pieces', 'kit_waxed_cord', 'kit_toy_eyes_nose'] },
  ESFJ: { cognitiveAxis: 'Fe–Si', recommendedMaterials: ['kit_five_eye_fruit', 'kit_fabric_scraps', 'kit_mini_bows', 'kit_toy_eyes_nose'] },
  ISTP: { cognitiveAxis: 'Ti–Se', recommendedMaterials: ['kit_large_pod', 'kit_fabric_pieces', 'kit_hemp_twine', 'kit_toy_eyes_nose'] },
  ISFP: { cognitiveAxis: 'Fi–Se', recommendedMaterials: ['kit_capped_acorn', 'kit_green_gauze', 'kit_hemp_twine', 'kit_toy_eyes_nose'] },
  ESFP: { cognitiveAxis: 'Se–Fi', recommendedMaterials: ['kit_mini_pumpkin', 'kit_satin_gradient', 'kit_color_check_bows', 'kit_toy_eyes_nose'] },
};

export const PERSONA_SEEDS = characters.map(([mbti, name, tagline, prompt, openingLine]) => {
  const details = personaDetails[mbti];
  const materialHint = details.recommendedMaterials.map(id => MATERIAL_PACK_BY_ID.get(id)!.label).join('、');
  return {
    id: 'persona_' + mbti.toLowerCase(), mbti, name, tagline, materialHint, prompt, openingLine,
    featured: Number(featured.has(mbti)),
    mbtiGroup: mbti[1] === 'N' ? mbti.slice(1, 3) : 'S' + mbti[3],
    speechStyle: prompt,
    visualTrait: materialHint,
    ...details,
  };
});

const materials: Omit<MaterialRecord, 'inStock' | 'sortOrder'>[] = [
  { id: 'hat_gingham', label: '格纹布帽', category: 'fabric_outfit', material: '棉布', visualHint: '格纹拼布，帽沿可见针脚' },
  { id: 'bell_copper', label: '小铜铃', category: 'hardware_charm', material: '黄铜', visualHint: '挂在腰侧的小黄铜铃' },
  { id: 'scarf', label: '苔绿手织围巾', category: 'fabric_outfit', material: '毛线', visualHint: '苔绿色粗针织纹，带短流苏' },
  { id: 'ribbon', label: '蝴蝶结', category: 'fabric_outfit', material: '缎带', visualHint: '窄缎带系成的小蝴蝶结' },
  { id: 'button', label: '木纽扣', category: 'hardware_charm', material: '原木', visualHint: '有木纹的双孔扣' },
  { id: 'glasses', label: '黄铜细框眼镜', category: 'hardware_charm', material: '黄铜', visualHint: '细黄铜丝弯成圆框' },
  { id: 'nutshell', label: '天然果壳', category: 'nut_body', material: '干燥果壳', visualHint: '保留果壳原有的凹凸纹路' },
  { id: 'wool_yarn', label: '卷曲羊毛线', category: 'yarn_hair', material: '羊毛', visualHint: '松散的短卷发束' },
  { id: 'wool_felt', label: '羊毛毡小外套', category: 'fabric_outfit', material: '羊毛毡', visualHint: '平整的毡布裁边与深色手缝线' },
  { id: 'twine', label: '编织细麻绳', category: 'hardware_charm', material: '黄麻', visualHint: '有清晰纤维纹理的编绳' },
  { id: 'dried_flower', label: '小朵干花', category: 'dried_botanical', material: '干燥花材', visualHint: '缝在布帽边缘的细小干花' },
];

export const DEFAULT_MATERIAL_SEEDS = materials.map((material, sortOrder) => ({
  ...material, sortOrder, inStock: true,
}));

const labels = new Map([...materials, ...MATERIAL_PACK].map(({ id, label }) => [id, label]));
export function getAccessoryLabels(ids: string[]): string[] {
  return ids.map((id) => labels.get(id) ?? id);
}

const portraits = [
  { nut: 'acorn', name: '薄荷橡果', mbti: 'ENFP', file: 'doll_acorn_enfp_1795174377785.jpg', description: '戴格纹帽的小小探险家' },
  { nut: 'chestnut', name: '紫雾栗子', mbti: 'INTJ', file: 'doll_chestnut_intj_1795174377952.jpg', description: '喜欢独自画草图的规划者' },
  { nut: 'walnut', name: '蜜桃胡桃', mbti: 'INFP', file: 'doll_walnut_infp_1795174377783.jpg', description: '口袋里装着故事的梦想家' },
  { nut: 'hazelnut', name: '焦糖榛子', mbti: 'ESTP', file: 'doll_hazelnut_estp_1795174378037.jpg', description: '走到哪儿都想试一试的行动派' },
];

export const DEMO_DOLL_SEEDS = portraits.map(({ nut, name, mbti, file }) => ({
  id: 'demo-' + nut, name, personaId: 'persona_' + mbti.toLowerCase(),
  avatarUrl: '/src/assets/images/' + file, nfcAlias: nut,
}));

export const FALLBACK_TEMPLATES: FallbackTemplate[] = portraits.map(({ nut, name, description, mbti, file }) => ({
  id: 'tpl_' + nut, name: name + ' · 预设版', description, recommendedMbti: [mbti],
  imageUrl: '/src/assets/images/' + file,
}));
