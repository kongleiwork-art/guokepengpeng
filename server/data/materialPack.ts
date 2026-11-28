import type { MaterialCategory, MaterialRecord } from '../../src/lib/types.ts';

type MaterialArtwork = [id: string, label: string, material: string, visualHint: string];

const artwork: [category: MaterialCategory, items: MaterialArtwork[]][] = [
  ['fabric_outfit', [
    ['cloud_cotton', '云朵棉面料', '云朵棉', '奶油色软布，垂坠处有宽圆褶皱'],
    ['organza_mesh', '欧根纱镭射网纱', '欧根纱网布', '黄绿色半透纱，表面有纵向亮纹'],
    ['satin_gradient', '琉璃丝缎渐变面料', '丝缎', '粉、蓝、紫与米白缎面，带柔和光泽'],
    ['fabric_scraps', '碎布头边角料', '拼布边角料', '细碎印花和锯齿裁边的彩色布片'],
    ['green_gauze', '绿色古风纱布', '纱布', '浅苔绿纱布，适合衣摆、围巾和披肩'],
    ['fabric_pieces', '大块布头', '混色布料', '藏蓝、深灰、米白、酒红及印花布块'],
  ]],
  ['nut_body', [
    ['egg_shell', '凤凰蛋鸡蛋壳', '蛋壳', '光滑奶白椭圆壳，边缘有小开口'],
    ['half_bowl', '进口干果半碗壳', '干果壳', '浅黄圆壳，内侧深棕且有颗粒纹路'],
    ['doll_blank', '印尼果壳娃娃半成品', '果壳半成品', '编织纹壳盖和棕黄圆果实，适合作小娃娃主体'],
    ['water_bell', '印尼水铃桐', '水铃桐果壳', '棕褐纵纹，果口有起伏'],
    ['panji', '印尼黑果Panji', '黑果果壳', '浅棕外壳带细褶，深棕内壁'],
    ['plant_bowl', '天然植物半碗壳', '植物干壳', '浅米色圆碗形，边缘顺滑'],
    ['walnut', '核桃壳', '核桃壳', '木棕色纵向皱纹，剖面有多个浅凹腔'],
    ['large_pod', '榼藤大豆荚', '榼藤豆荚', '棕黄厚荚，边缘深棕，可见分节'],
    ['double_pod', '榼藤豆荚单双', '榼藤豆荚', '暖金棕的单节和双节豆荚壳'],
  ]],
  ['fruit_body', [
    ['pala', 'pala花豆蔻', 'pala 花豆蔻', '红棕光泽椭圆壳，部分切面呈碗状'],
    ['five_eye_fruit', '五眼果', '五眼果', '浅米色椭圆果核，带数个深色孔眼'],
    ['rangoon_creeper', '使君子五棱子', '使君子果', '深棕尖头果实，长轴有清晰棱线'],
    ['eucalyptus', '尤加利果（僵尸果）', '尤加利果', '嫩绿短筒状果杯，杯口可见棕色三瓣'],
    ['cross_fruit', '十字果铭座', '十字果', '灰棕果皮裂成数瓣，有短柄'],
    ['citrus', '小青柠柠檬片', '青柠', '深绿果皮围住橙黄放射状果瓣'],
    ['capped_acorn', '带帽橡果', '橡果', '暖棕果身搭配浅棕颗粒状果帽'],
    ['peace_bean', '平安豆罗汉豆', '平安豆', '红褐色光滑圆形豆体'],
    ['football_acorn', '橡子足球果十字果', '橡子', '深棕椭圆果实配浅驼色纹理果帽'],
    ['ring_cup', '毛果青冈橡果帽', '橡果帽', '棕色杯状果帽，外侧有一圈圈凸纹'],
    ['soap_pod', '皂荚果猪牙皂', '猪牙皂果荚', '深棕细长弧形荚，像向上弯起的小舟'],
    ['soap_bean', '皂角豆', '皂角豆', '椭圆豆体呈棕色或浅琥珀色'],
    ['mini_pumpkin', '迷你小南瓜', '迷你南瓜', '黄橙色多瓣纹理，轮廓圆而扁'],
    ['mini_acorn', '迷你橡果小山捻', '小山捻', '淡金色有纵纹的小果，参考图有红色圆形配件'],
    ['camphor_slice', '香樟木片', '香樟木', '中心浅米色可见年轮，边沿保留树皮'],
  ]],
  ['yarn_hair', [
    ['mixed_yarn', '手混毛线', '手混毛线', '粉、蓝、浅绿混色纤维绕成松散团状'],
    ['teddy_wig', '泰迪卷娃娃假发（多色）', '泰迪卷假发', '小团贴头卷发，多种自然色和柔和彩色'],
    ['teddy_wool', '泰迪卷羊毛圈圈', '圈圈羊毛', '黄、蓝、灰、绿等绒密小卷，能表现短卷发'],
    ['mohair_silk', '苏利马海毛真丝细线', '马海毛真丝线', '线团细软蓬松，有红、蓝、紫和灰棕色'],
  ]],
  ['marine_charm', [
    ['seashell_mix', '小贝壳海螺混装', '贝壳与海螺', '米白螺旋海螺、有肋纹扇贝与橙色星状件'],
    ['sea_decor', '海星贝壳装饰', '海洋造型饰件', '浅蓝、粉紫等虹彩贝壳和海星小饰件'],
    ['starfish_bead', '海星造型珠', '海星造型珠', '奶油黄和蜜棕色的小五角星形珠'],
    ['micro_shells', '迷你海螺与海星', '微型海洋饰件', '白色、粉色和卡其色的微型螺旋壳'],
  ]],
  ['hardware_charm', [
    ['leaf_vine', '仿真叶子布艺藤条', '布艺仿真藤', '明绿短叶沿软藤分布，适合缠绕或当围饰'],
    ['moss_mat', '仿真苔藓草皮', '仿真苔藓', '鲜绿绒状苔面，可作小片底座点缀'],
    ['animal_buttons', '动物木头纽扣', '木扣', '动物、星星和圆形木扣，有木纹和扣孔'],
    ['resin_glasses', '卡通树脂眼镜配件', '树脂', '棕米色圆框与方框的迷你眼镜'],
    ['moss_sprite', '小黑苔藓精灵', '黑色精灵饰件', '圆润黑色小团，配一对醒目的白眼睛'],
    ['check_bows', '布艺格子小蝴蝶结', '格纹布', '暖红、米白、棕色格纹的小蝴蝶结'],
    ['resin_eyes', '树脂斗鸡眼小眼睛', '树脂眼睛', '白底黑瞳的双眼，含眯眼等表情组合'],
    ['color_check_bows', '格纹蝴蝶结合集', '彩色格纹布', '黄、蓝、粉与淡紫的细格纹蝴蝶结'],
    ['coconut_buttons', '椰壳纽扣复古混装', '椰壳纽扣', '棕色天然花纹，含圆形和花形等复古扣'],
    ['toy_eyes_nose', '玩偶黑色眼睛鼻子', '玩偶五官配件', '亮黑圆眼、椭圆鼻和三角鼻，用于娃娃五官'],
    ['matte_bows', '磨砂蝴蝶结', '磨砂饰件', '粉、白、浅灰蓝与黑色的低光泽蝴蝶结'],
    ['warm_bows', '美拉德粉棕蝴蝶结', '布带', '粉棕、米白和砖红的布带蝴蝶结'],
    ['mini_bows', '迷你蝴蝶结多色', '彩色细织带', '红、紫、绿、黄等细窄织带蝴蝶结'],
    ['screw_eyes', '铁质羊眼钉', '金属', '带螺纹的圆头小挂圈'],
    ['waxed_cord', '韩国蜡线', '蜡线', '黑色、棕色和酒红色的光洁细蜡线'],
    ['suede_cord', '鹿皮绒麂皮绳', '麂皮绒绳', '多色细绳卷，表面有柔软绒感'],
    ['hemp_twine', '麻绳', '麻纤维绳', '暖卡其色麻绳，表面可见平行纤维纹理'],
  ]],
];

export const MATERIAL_PACK = artwork.flatMap(([category, items]) =>
  items.map(([fileName, label, material, visualHint]) => ({
    id: 'kit_' + fileName,
    label,
    material,
    category,
    visualHint,
    referenceImageUrl: '/assets/materials/' + fileName + '.webp',
  }))
).map((item, index): MaterialRecord => ({
  ...item,
  sortOrder: index - 100,
  inStock: true,
}));

export const MATERIAL_PACK_BY_ID = new Map(MATERIAL_PACK.map((item) => [item.id, item]));

export const PALETTE_FABRICS: Record<string, { id: string; variant: string }> = {
  green: { id: 'kit_green_gauze', variant: '浅苔绿' },
  cream: { id: 'kit_cloud_cotton', variant: '奶油色' },
  dark: { id: 'kit_fabric_pieces', variant: '深灰色' },
  blue: { id: 'kit_fabric_pieces', variant: '藏蓝色' },
  warm: { id: 'kit_fabric_pieces', variant: '酒红色' },
  pastel: { id: 'kit_satin_gradient', variant: '柔和渐变色' },
  patterned: { id: 'kit_fabric_scraps', variant: '细碎印花' },
};

const CONSTRUCTION_HINTS: Record<string, string> = {
  kit_capped_acorn: '直接使用天然干橡果，保留果实尖端和连着果梗的木质壳斗。壳斗由细小干硬鳞片相叠，表面有植物纹理。',
  kit_fabric_pieces: '取图册中一整块布样，素色布与印花布是不同的选择。整片沿用同一布样，保留可见裁边，作为一层围布。',
  kit_hemp_twine: '两段独立麻绳各自固定在娃娃一侧，左右各露出一个自由剪口，可以从正面分别数出两段。',
};

export function materialConstructionHint(id: string, dollDesign?: string) {
  const label = MATERIAL_PACK_BY_ID.get(id)?.label;
  const swatch = Object.values(PALETTE_FABRICS).find(item =>
    item.id === id && label && dollDesign?.includes(label + '选' + item.variant + '。'));
  const color = swatch ? '采用图册中的' + (id === 'kit_fabric_pieces' ? '纯色' : '') + swatch.variant + '布样。' : '';
  return (CONSTRUCTION_HINTS[id] ?? '') + color;
}
