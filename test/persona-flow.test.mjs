import assert from 'node:assert/strict';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';
import { readMaterialArtwork } from '../server/utils/assetFiles.ts';
import { SCENARIO_QUESTIONS, FOLLOW_UP_QUESTIONS } from '../server/data/mbtiQuestions.ts';
import { runMbtiGuideTurn } from '../server/providers/mbtiGuideEngine.ts';
import { PERSONA_SEEDS } from '../server/data/seed.ts';
import { MATERIAL_PACK, materialConstructionHint } from '../server/data/materialPack.ts';
import { composePhotoMaterials, recommendedMaterialIds } from '../src/lib/materialCategories.ts';
import { getMaterialAmounts } from '../server/data/materialAmounts.ts';
import { measureFacePixels, portraitPoseHint } from '../src/lib/portraitQuality.ts';

function answersFor(mbti) {
  return SCENARIO_QUESTIONS.map(({ id, axis, aDirection }) => ({
    questionId: id, choice: (mbti.includes(axis[0]) ? 1 : -1) === aDirection ? 'a' : 'b',
  }));
}

test('16 个角色在重放、返回改答和重复提交后按同一套固定规则计分', () => {
  for (const role of PERSONA_SEEDS) {
    const answers = answersFor(role.mbti);
    const result = runMbtiGuideTurn(answers, MATERIAL_PACK);
    assert.equal(result.status, 'completed');
    assert.equal(result.report.primaryPersonaId, role.id);
    assert.deepEqual(result.report.candidates[0].suggestedMaterialIds, role.recommendedMaterials);
    assert.equal(result.answered, 12);
    assert.equal(result.total, 12);
    assert.deepEqual(runMbtiGuideTurn([...answers, answers[0]], MATERIAL_PACK), result);
    assert.deepEqual(runMbtiGuideTurn([...answers].reverse(), MATERIAL_PACK), result);
    assert.ok(role.recommendedMaterials.every(id => MATERIAL_PACK.some(item => item.id === id && item.referenceImageUrl)));
    assert.equal(role.recommendedMaterials.length, 4);
    assert.ok(role.recommendedMaterials.every(id => getMaterialAmounts(id).every(amount => amount.size || amount.unit === '克')));
    const beforeLast = runMbtiGuideTurn(answers.slice(0, -1), MATERIAL_PACK);
    assert.equal(beforeLast.nextQuestion.id, answers.at(-1).questionId);
    assert.throws(() => runMbtiGuideTurn([...answers, { ...answers[0], choice: 'both' }], MATERIAL_PACK), { status: 400 });
  }
});

test('只有倾向接近的维度会补问，中性答案不强行归型', () => {
  const answers = answersFor('ISFP').map((item, i) => SCENARIO_QUESTIONS[i].axis === 'EI' ? { ...item, choice: 'both' } : item);
  const pending = runMbtiGuideTurn(answers, MATERIAL_PACK);
  assert.equal(pending.total, 13);
  assert.equal(pending.nextQuestion.id, FOLLOW_UP_QUESTIONS.find(q => q.axis === 'EI').id);
  const result = runMbtiGuideTurn([...answers, { questionId: pending.nextQuestion.id, choice: 'both' }], MATERIAL_PACK);
  assert.equal(result.report.primaryPersonaId, undefined);
  assert.deepEqual(result.report.candidates.map(item => item.mbti).sort(), ['ESFP', 'ISFP']);
  const neutral = [...SCENARIO_QUESTIONS, ...FOLLOW_UP_QUESTIONS].map(({ id }) => ({ questionId: id, choice: 'both' }));
  assert.deepEqual(runMbtiGuideTurn(neutral, MATERIAL_PACK).report.candidates, []);
  assert.throws(() => runMbtiGuideTurn([neutral.at(-1)], MATERIAL_PACK), { status: 400 });
  assert.throws(() => runMbtiGuideTurn([{ questionId: 'invalid', choice: 'a' }], MATERIAL_PACK), { status: 400 });
  assert.equal(runMbtiGuideTurn([], MATERIAL_PACK).status, 'questioning');
});

test('照片配色和选定角色使用同一份在库材料与部件表', () => {
  const role = PERSONA_SEEDS.find(item => item.mbti === 'ISTJ');
  const plan = composePhotoMaterials(role.recommendedMaterials, 'kit_green_gauze', MATERIAL_PACK, '浅苔绿');
  assert.match(plan.dollDesign, /绿色古风纱布选浅苔绿/);
  assert.match(materialConstructionHint('kit_fabric_pieces', '大块布头选酒红色。'), /纯色酒红色/);
  assert.match(materialConstructionHint('kit_hemp_twine'), /两段独立麻绳/);
  assert.deepEqual(plan.suggestedMaterialIds, ['kit_double_pod', 'kit_green_gauze', 'kit_coconut_buttons', 'kit_toy_eyes_nose']);
  assert.deepEqual(plan.materialPlan.map(item => item.id), plan.suggestedMaterialIds);
  for (const material of plan.materialPlan) assert.ok(plan.dollDesign.includes(material.label));
  const limited = MATERIAL_PACK.filter(item => !['kit_double_pod', 'kit_coconut_buttons', 'kit_fabric_pieces'].includes(item.id));
  assert.deepEqual(recommendedMaterialIds(role.recommendedMaterials, limited),
    ['kit_capped_acorn', 'kit_cloud_cotton', 'kit_hemp_twine', 'kit_toy_eyes_nose']);
});

test('抓拍质检分别识别曝光、虚焦、侧脸、倾斜、闭眼和多人', () => {
  const pixels = luminance => {
    const bytes = new Uint8ClampedArray(96 * 96 * 4);
    for (let i = 0; i < 96 * 96; i++) bytes.fill(luminance(i), i * 4, i * 4 + 3);
    return bytes;
  };
  assert.match(measureFacePixels(pixels(() => 25), 96).hint, /暗/);
  assert.match(measureFacePixels(pixels(() => 250), 96).hint, /强/);
  assert.match(measureFacePixels(pixels(() => 120), 96).hint, /模糊/);
  assert.equal(measureFacePixels(pixels(i => i % 2 ? 115 : 140), 96).hint, '');
  const pose = (eyeY, noseX, faces = 1, closed = false) => {
    const points = [];
    points[33] = { x: 0.4, y: 0.4 };
    points[263] = { x: 0.6, y: eyeY };
    points[1] = { x: noseX, y: 0.55 };
    const categories = ['eyeBlinkLeft', 'eyeBlinkRight'].map(categoryName => ({ categoryName, score: closed ? 0.9 : 0.04 }));
    return portraitPoseHint({ faceLandmarks: Array(faces).fill(points), faceBlendshapes: [{ categories }] }, 500, 500);
  };
  assert.equal(pose(0.4, 0.5), '');
  assert.match(pose(0.52, 0.5), /摆正/);
  assert.match(pose(0.4, 0.59), /正前方/);
  assert.match(pose(0.4, 0.5, 2), /一位/);
  assert.match(pose(0.4, 0.5, 1, true), /睁开/);
});

test('指定色样时发送材料包里的那一块布，保留原版多色图册供自由选材', async () => {
  const file = fileURLToPath(new URL('../public/assets/materials/fabric_pieces.webp', import.meta.url));
  const full = await readMaterialArtwork('kit_fabric_pieces', file);
  assert.equal((await sharp(full).metadata()).width, 480);
  for (const color of ['酒红色', '深灰色', '藏蓝色']) {
    const crop = await readMaterialArtwork('kit_fabric_pieces', file, '大块布头选' + color + '。');
    const info = await sharp(crop).metadata();
    assert.ok(info.width < 240 && info.height < 150);
    assert.equal(info.format, 'webp');
    const pixels = await sharp(crop).removeAlpha().raw().toBuffer();
    for (let y = 0; y < info.height; y++) {
      for (let x = 0; x < info.width; x++) {
        if (x !== 0 && x !== info.width - 1 && y !== 0 && y !== info.height - 1) continue;
        const offset = (y * info.width + x) * 3;
        assert.ok(Math.min(...pixels.subarray(offset, offset + 3)) > 205, color + '裁边应完整且不混入相邻布样');
      }
    }
  }
});
