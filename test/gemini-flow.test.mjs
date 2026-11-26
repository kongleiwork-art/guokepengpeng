import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { createServer } from 'node:http';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { createInterface } from 'node:readline';
import test from 'node:test';
import { setTimeout as delay } from 'node:timers/promises';

const project = new URL('../', import.meta.url);
const photo = await readFile(new URL('src/assets/images/doll_acorn_enfp_1795174377785.jpg', project));
const output = await readFile(new URL('src/assets/images/doll_chestnut_intj_1795174377952.jpg', project));
const acornArtwork = await readFile(new URL('public/assets/materials/capped_acorn.webp', project));
const cottonArtwork = await readFile(new URL('public/assets/materials/cloud_cotton.webp', project));
const walnutArtwork = await readFile(new URL('public/assets/materials/walnut.webp', project));

async function startApp(t, dir, settings) {
  const child = spawn(process.execPath, ['server.ts'], {
    cwd: project,
    env: {
      ...process.env, NODE_ENV: 'production', HOST: '127.0.0.1', PORT: '0',
      DATABASE_URL: path.join(dir, 'test.sqlite'), STORAGE_PATH: path.join(dir, 'files'),
      SESSION_SECRET: '', DEMO_ADMIN_TOKEN: '', IMAGE_API_KEY: '', CHAT_PROVIDER: 'mock',
      STEPFUN_API_KEY: '', STEPFUN_VISION_MODEL: '', ...settings,
    },
    stdio: ['ignore', 'pipe', 'inherit'],
  });
  const closed = once(child, 'close');
  const stop = async () => { child.kill(); await closed; };
  t.after(stop);
  for await (const line of createInterface({ input: child.stdout })) {
    const base = line.match(/listening on (http:\/\/127\.0\.0\.1:\d+)/)?.[1];
    if (base) return { base, stop };
  }
  throw new Error('应用未完成初始化');
}

async function json(response, expected = 200) {
  const body = await response.json();
  assert.equal(response.status, expected, JSON.stringify(body.error));
  return body.data;
}

test('Gemini 参考图创作、绑定与首次初始化后重启', { timeout: 30000 }, async (t) => {
  const dir = await mkdtemp(path.join(tmpdir(), 'nutshell-gemini-'));
  const calls = [];
  const gemini = createServer(async (req, res) => {
    const chunks = [];
    for await (const chunk of req) chunks.push(chunk);
    calls.push({ path: req.url, key: req.headers['x-goog-api-key'], ...JSON.parse(Buffer.concat(chunks)) });
    const parts = calls.length === 2 ? [{ text: '没有图像' }] : [
      { thought: true, inlineData: { mimeType: 'image/jpeg', data: photo.toString('base64') } },
      { inlineData: { mimeType: 'image/jpeg', data: output.toString('base64') } },
    ];
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ responseId: 'fixture-' + calls.length, candidates: [{ content: { parts } }] }));
  });
  gemini.listen(0, '127.0.0.1');
  await once(gemini, 'listening');
  t.after(() => new Promise((resolve) => gemini.close(resolve)));
  const settings = { IMAGE_PROVIDER: '', IMAGE_VENDOR: 'gemini', GEMINI_API_KEY: 'fixture', GEMINI_IMAGE_MODEL: 'gemini-2.5-flash-image',
    GEMINI_IMAGE_BASE_URL: 'http://127.0.0.1:' + gemini.address().port };
  const app = await startApp(t, dir, settings);
  let base = app.base;
  const session = await fetch(base + '/api/session', { method: 'POST' });
  const cookie = session.headers.getSetCookie()[0].split(';')[0];
  const owner = (url, opts = {}) => fetch(base + url, { ...opts, headers: { ...opts.headers, Cookie: cookie } });
  const post = (url, body) => owner(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });

  const personas = await json(await owner('/api/personas'));
  assert.equal(personas.length, 16);
  assert.equal(personas.filter((p) => p.featured).length, 4);
  const dolls = await json(await owner('/api/dolls'));
  assert.equal(dolls.length, 4);
  for (const doll of dolls) assert.equal((await owner(doll.avatarUrl)).headers.get('content-type'), 'image/jpeg');
  assert.equal((await json(await owner('/api/templates'))).length, 4);
  const materials = await json(await owner('/api/accessories'));
  assert.ok(!materials.some((item) => item.id === 'hat_gingham'));
  assert.ok((await json(await owner('/api/materials'))).items.some((item) => item.id === 'hat_gingham'));
  assert.equal(materials.filter(item => item.referenceImageUrl).length, 55);
  const acorn = materials.find(item => item.id === 'kit_capped_acorn');
  assert.equal(acorn.category, 'fruit_body');
  assert.deepEqual(Buffer.from(await (await owner(acorn.referenceImageUrl)).arrayBuffer()), acornArtwork);

  const form = new FormData();
  form.set('photo', new Blob([photo], { type: 'image/jpeg' }), 'reference.jpg');
  form.set('personaId', 'persona_enfp');
  form.set('userNickname', '小林');
  form.set('accessoryIds', JSON.stringify(['hat_gingham', 'kit_capped_acorn']));
  const submit = () => owner('/api/cards', { method: 'POST', headers: { 'Idempotency-Key': 'first' }, body: form });
  const incomplete = await submit();
  assert.equal(incomplete.status, 400);
  assert.equal((await incomplete.json()).error.code, 'MATERIAL_REFERENCES_REQUIRED');
  assert.equal(calls.length, 0);
  form.set('accessoryIds', JSON.stringify(['kit_capped_acorn', 'kit_walnut', 'kit_cloud_cotton']));
  const card = await json(await submit(), 202);
  assert.equal((await json(await submit(), 202)).versionId, card.versionId);

  async function finished(versionId) {
    for (let i = 0; i < 100; i++) {
      const version = await json(await owner('/api/card-versions/' + versionId));
      if (!['queued', 'running'].includes(version.status)) return version;
      await delay(50);
    }
    throw new Error('生成任务超时');
  }
  const first = await finished(card.versionId);
  assert.equal(first.status, 'succeeded', first.errorMessage);
  assert.equal(first.resultKind, 'generated');
  assert.equal(first.providerRequestId, 'fixture-1');
  const call = calls[0];
  assert.equal(call.path, '/v1beta/models/gemini-2.5-flash-image:generateContent');
  assert.equal(call.key, 'fixture');
  assert.deepEqual(call.contents[0].parts[0].inlineData, { mimeType: 'image/webp', data: acornArtwork.toString('base64') });
  assert.deepEqual(call.contents[0].parts[1].inlineData, { mimeType: 'image/webp', data: walnutArtwork.toString('base64') });
  assert.deepEqual(call.contents[0].parts[2].inlineData, { mimeType: 'image/webp', data: cottonArtwork.toString('base64') });
  assert.match(call.contents[0].parts[3].text, /Input image 2: 核桃壳.*Part: 身体/);
  assert.ok(call.generationConfig.responseModalities.includes('IMAGE'));
  assert.equal(call.generationConfig.imageConfig.aspectRatio, '3:4');
  assert.deepEqual(Buffer.from(await (await owner(first.resultUrl)).arrayBuffer()), output);
  assert.equal((await fetch(base + first.resultUrl)).status, 404);

  const cardUrl = '/api/cards/' + card.cardId;
  const redraw = async () => finished((await json(await post(cardUrl + '/redraw', {}), 202)).versionId);
  const failed = await redraw();
  assert.equal(failed.errorCode, 'PROVIDER_ERROR');
  assert.equal(failed.resultUrl, null);
  const other = await redraw();
  assert.equal(other.status, 'succeeded');
  const bound = await json(await post(cardUrl + '/bind', { versionId: first.id, dollName: '栗子' }), 201);
  assert.equal((await fetch(base + first.resultUrl)).status, 200);
  assert.equal((await fetch(base + other.resultUrl)).status, 404);
  assert.equal(calls.length, 3);

  await app.stop();
  const restarted = await startApp(t, dir, { GEMINI_API_KEY: '', IMAGE_PROVIDER: 'cloud' });
  base = restarted.base;
  assert.equal((await json(await owner(cardUrl))).boundDollId, bound.dollId);
  assert.equal((await json(await owner('/api/dolls'))).length, 5);
  assert.equal((await json(await owner('/api/personas'))).length, 16);
  const unconfigured = await owner('/api/cards', { method: 'POST', body: form });
  assert.equal(unconfigured.status, 503);
  assert.equal((await unconfigured.json()).error.code, 'PROVIDER_NOT_CONFIGURED');
  assert.equal((await owner('/api/demo/status')).status, 503);
  await restarted.stop();
  await rm(dir, { recursive: true, force: true });
});
test('公开预览在接收照片前关闭创作，NFC 入口直达聊天', { timeout: 20000 }, async (t) => {
  const dir = await mkdtemp(path.join(tmpdir(), 'nutshell-preview-'));
  const { base } = await startApp(t, dir, { IMAGE_GENERATION_ENABLED: 'false', STEPFUN_VISION_MODEL: '' });
  t.after(() => rm(dir, { recursive: true, force: true }));

  assert.deepEqual(await json(await fetch(base + '/api/capabilities')), {
    imageGenerationEnabled: false, photoMbtiEnabled: false,
  });
  for (const alias of ['acorn', 'chestnut', 'walnut', 'hazelnut']) {
    const hit = await fetch(base + '/nfc/' + alias, { redirect: 'manual' });
    assert.equal(hit.status, 302);
    assert.equal(hit.headers.get('location'), '/d/demo-' + alias + '/chat?entry=nfc&alias=' + alias);
    assert.equal(hit.headers.get('set-cookie'), null);
  }
  assert.equal((await fetch(base + '/nfc/unbound', { redirect: 'manual' })).status, 404);

  const form = new FormData();
  form.set('photo', new Blob([photo], { type: 'image/jpeg' }), 'preview.jpg');
  for (const [url, status, code] of [
    ['/api/cards', 403, 'CREATION_CLOSED'],
    ['/api/cards/card_never_created/redraw', 403, 'CREATION_CLOSED'],
    ['/api/mbti/recommend', 409, 'PHOTO_MBTI_UNAVAILABLE'],
  ]) {
    const response = await fetch(base + url, { method: 'POST', body: form });
    assert.equal(response.status, status);
    assert.equal(response.headers.get('set-cookie'), null);
    assert.equal((await response.json()).error.code, code);
  }

  const quiz = await json(await fetch(base + '/api/mbti/recommend', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ quizAnswers: { energy: 'E', perception: 'N', judgment: 'F', lifestyle: 'P' } }),
  }));
  assert.equal(quiz.primaryMbti, 'ENFP');
});

test('预览支持单张照片分析和娃娃方案，同时保留生图限制', { timeout: 20000 }, async (t) => {
  const dir = await mkdtemp(path.join(tmpdir(), 'nutshell-photo-analysis-'));
  const requests = [];
  const provider = createServer(async (req, res) => {
    const chunks = [];
    for await (const chunk of req) chunks.push(chunk);
    requests.push(JSON.parse(Buffer.concat(chunks)));
    res.setHeader('Content-Type', 'application/json');
    res.end(JSON.stringify({ choices: [{ message: { content: JSON.stringify({
      style: 'soft',
      photoStyle: '画面有暖棕与浅米色。',
    }) } }] }));
  });
  provider.listen(0, '127.0.0.1');
  await once(provider, 'listening');
  t.after(() => new Promise(resolve => provider.close(resolve)));
  const { base } = await startApp(t, dir, {
    IMAGE_GENERATION_ENABLED: 'false',
    CHAT_PROVIDER: 'cloud',
    STEPFUN_API_KEY: 'fixture',
    STEPFUN_API_BASE: 'http://127.0.0.1:' + provider.address().port + '/v1',
    STEPFUN_VISION_MODEL: 'step-5-preview',
  });
  t.after(() => rm(dir, { recursive: true, force: true }));

  assert.deepEqual(await json(await fetch(base + '/api/capabilities')), {
    imageGenerationEnabled: false, photoMbtiEnabled: true,
  });
  const form = new FormData();
  form.set('photo', new Blob([photo], { type: 'image/jpeg' }), 'frame.jpg');
  const brief = await json(await fetch(base + '/api/mbti/recommend', { method: 'POST', body: form }));
  assert.equal(brief.source, 'cloud_vision');
  assert.equal(brief.primaryPersonaId, 'persona_infp');
  assert.deepEqual(brief.alternateMbtis, ['ISFJ', 'INFJ']);
  assert.match(brief.photoStyle, /暖棕/);
  assert.match(brief.dollDesign, /核桃壳做娃娃主体/);
  assert.deepEqual(brief.suggestedMaterialIds, ['kit_walnut', 'kit_cloud_cotton', 'kit_teddy_wool', 'kit_toy_eyes_nose']);
  assert.deepEqual(brief.materialPlan.map(item => item.id), brief.suggestedMaterialIds);
  assert.equal(requests[0].model, 'step-5-preview');
  assert.equal(requests[0].reasoning_effort, 'low');
  assert.equal(requests[0].max_tokens, 640);
  const prompt = requests[0].messages[1].content.find(part => part.type === 'text').text;
  assert.match(prompt, /photoStyle/);
  assert.doesNotMatch(prompt, /kit_|MBTI|dollDesign/);
  const submittedImage = requests[0].messages[1].content.find(part => part.type === 'image_url');
  assert.equal(submittedImage.image_url.url, 'data:image/jpeg;base64,' + photo.toString('base64'));

  const closed = await fetch(base + '/api/cards', { method: 'POST', body: form });
  assert.equal(closed.status, 403);
  assert.equal((await closed.json()).error.code, 'CREATION_CLOSED');
  assert.equal(requests.length, 1);
});

test('照片识别超时后换新时限重试，连续超时后结束', async (t) => {
  const { config } = await import('../server/config.ts');
  const { requestStepFunJson } = await import('../server/providers/stepfun.ts');
  const isVercel = config.isVercel;
  config.isVercel = false;
  t.after(() => { config.isVercel = isVercel; });
  const attempts = [];
  const observation = { style: 'natural', photoStyle: '苔绿与浅棕的搭配。' };
  t.mock.method(globalThis, 'fetch', async (_url, { body, signal }) => {
    assert.equal(signal.aborted, false);
    attempts.push({ body, signal });
    if (attempts.length !== 2) await delay(5_000, undefined, { signal });
    return Response.json({ choices: [{ message: { content: JSON.stringify(observation) } }] });
  });

  const analyze = () => requestStepFunJson('返回 JSON', [
    { type: 'image_url', image_url: { url: 'data:image/jpeg;base64,' + photo.toString('base64'), detail: 'low' } },
  ], 'step-5-preview', { maxTokens: 640, attemptTimeoutsMs: [25, 35] });
  assert.deepEqual(await analyze(), observation);
  assert.equal(attempts.length, 2);
  assert.equal(attempts[0].signal.aborted, true);
  assert.notEqual(attempts[0].signal, attempts[1].signal);
  assert.equal(attempts[0].body, attempts[1].body);

  await assert.rejects(analyze(), { status: 504, code: 'PROVIDER_TIMEOUT' });
  assert.equal(attempts.length, 4);
  assert.equal(attempts[2].body, attempts[3].body);
});

test('StepFun SSE、GPT 生图的材料验收、会话隔离和任务幂等', { timeout: 30000 }, async (t) => {
  const dir = await mkdtemp(path.join(tmpdir(), 'nutshell-providers-'));
  const calls = { chat: [], image: [], review: [] };
  let portraitAttempts = 0;
  const fixture = createServer(async (req, res) => {
    const chunks = [];
    for await (const chunk of req) chunks.push(chunk);
    const body = Buffer.concat(chunks);
    if (req.url === '/v1/chat/completions') {
      const payload = JSON.parse(body);
      if (payload.messages[0].content.includes('成品材料验收')) {
        calls.review.push(payload);
        const review = calls.review.length === 1
          ? { matches: true, unmatchedParts: [] }
          : { matches: false, unmatchedParts: ['木枝手脚'] };
        res.writeHead(200, { 'Content-Type': 'application/json' }).end(JSON.stringify({
          choices: [{ message: { content: JSON.stringify(review) } }],
        }));
        return;
      }
      calls.chat.push(payload);
      if (Array.isArray(payload.messages.at(-1).content)) {
        if (++portraitAttempts === 1) {
          res.writeHead(504).end();
          return;
        }
        res.writeHead(200, { 'Content-Type': 'application/json' }).end(JSON.stringify({
          choices: [{ message: { content: '{"style":"playful","photoStyle":"浅棕底上有俏皮的彩色细节"}' } }],
        }));
        return;
      }
      if (payload.messages.at(-1).content === '试试额度错误') {
        res.writeHead(402, { 'Content-Type': 'application/json' }).end('{}');
        return;
      }
      if (!payload.stream) {
        res.writeHead(200, { 'Content-Type': 'application/json' }).end(JSON.stringify({
          choices: [{ message: { content: JSON.stringify({
            primaryMbti: 'ENFP', reason: '一起试试新点子。', alternateMbtis: ['INFP', 'ENFJ'], keywords: ['好奇'],
            suggestedMaterialIds: ['kit_capped_acorn', 'kit_cloud_cotton', 'kit_capped_acorn'],
          }) } }],
        }));
        return;
      }
      res.writeHead(200, { 'Content-Type': 'text/event-stream' });
      res.write('data: {"id":"stepfun-fixture","choices":[{"delta":{"content":"你');
      await delay(70);
      res.write('好呀"}}]}\n\n');
      res.end('data: [DONE]\n\n');
      return;
    }
    if (req.url === '/v1/images/edits') {
      calls.image.push({ body, auth: req.headers.authorization, type: req.headers['content-type'] });
      if (calls.image.length > 2) {
        res.writeHead(500).end();
        return;
      }
      res.writeHead(200, { 'Content-Type': 'application/json', 'x-request-id': 'gpt-fixture' });
      res.end(JSON.stringify({ data: [{ b64_json: output.toString('base64') }] }));
      return;
    }
    res.writeHead(404).end();
  });
  fixture.listen(0, '127.0.0.1');
  await once(fixture, 'listening');
  t.after(() => new Promise((done) => fixture.close(done)));
  const endpoint = 'http://127.0.0.1:' + fixture.address().port + '/v1';
  const settings = {
    IMAGE_GENERATION_ENABLED: 'true', IMAGE_VENDOR: 'openai', IMAGE_PROVIDER: 'cloud',
    OPENAI_API_KEY: 'fixture', OPENAI_IMAGE_API_BASE: endpoint,
    CHAT_PROVIDER: 'cloud', STEPFUN_API_KEY: 'fixture', STEPFUN_API_BASE: endpoint,
    STEPFUN_VISION_MODEL: 'step-5-preview',
  };
  const { base } = await startApp(t, dir, settings);
  t.after(() => rm(dir, { recursive: true, force: true }));

  const visitor = 'vk_test_independent_owner_01';
  const owner = (url, options = {}) => fetch(base + url, {
    ...options, headers: { 'X-Visitor-Key': visitor, ...options.headers },
  });
  const post = (url, body, idem) => owner(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...(idem ? { 'Idempotency-Key': idem } : {}) },
    body: JSON.stringify(body),
  });

  const chatUrl = '/api/dolls/demo-acorn/chat';
  const chatData = { clientMessageId: 'stepfun-fixture', text: '你好，薄荷橡果' };
  const chat = await post(chatUrl, chatData);
  assert.match(chat.headers.get('content-type'), /text\/event-stream/);
  const sse = await chat.text();
  assert.match(sse, /event: delta\ndata: .*你好呀/);
  assert.match(sse, /event: done/);
  assert.match(await (await post(chatUrl, chatData)).text(), /"replayed":true/);
  assert.equal(calls.chat.length, 1);
  assert.equal(calls.chat[0].model, 'step-3.5-flash');
  assert.equal((await post(chatUrl, { ...chatData, text: '改写前一条' })).status, 409);
  assert.match(await (await post(chatUrl, { clientMessageId: 'quota-test', text: '试试额度错误' })).text(), /PROVIDER_QUOTA/);

  const memoryUrl = '/api/dolls/demo-acorn/memory';
  await json(await post(memoryUrl, { type: 'fact', value: '我喜欢松果' }), 201);
  assert.equal((await json(await owner(memoryUrl))).length, 1);
  assert.deepEqual(await json(await fetch(base + memoryUrl)), []);
  const quiz = await json(await post('/api/mbti/recommend', {
    quizAnswers: { energy: 'E', perception: 'N', judgment: 'F', lifestyle: 'P' },
  }));
  assert.equal(quiz.source, 'cloud_quiz');

  const portrait = new FormData();
  portrait.set('photo', new Blob([photo], { type: 'image/jpeg' }), 'reference.jpg');
  const brief = await json(await owner('/api/mbti/recommend', { method: 'POST', body: portrait }));
  assert.equal(brief.source, 'cloud_vision');
  assert.equal(portraitAttempts, 2);
  assert.deepEqual(calls.chat.filter(call => Array.isArray(call.messages.at(-1).content))[0], calls.chat.at(-1));
  assert.deepEqual(brief.suggestedMaterialIds, ['kit_capped_acorn', 'kit_cloud_cotton', 'kit_color_check_bows', 'kit_toy_eyes_nose']);
  assert.deepEqual(brief.materialPlan.map(item => item.id), brief.suggestedMaterialIds);
  assert.deepEqual(brief.materialPlan[0].amounts, [{
    quantity: 1, unit: '颗', action: 'pick', size: { kind: 'height', cm: 2.5 },
  }]);
  assert.deepEqual(brief.materialPlan[1].amounts, [{
    quantity: 1, unit: '片', action: 'cut', size: { kind: 'rectangle', lengthCm: 12, widthCm: 3 },
  }]);
  const catalog = await json(await owner('/api/accessories'));
  assert.ok(catalog.every(item => item.amounts.length > 0));
  assert.deepEqual(catalog.find(item => item.id === 'kit_hemp_twine').amounts, [{
    quantity: 2, unit: '段', action: 'cut', size: { kind: 'length', cm: 6 },
  }]);
  assert.equal(calls.image.length, 0);

  const create = (dollDesign = brief.dollDesign) => {
    const form = new FormData();
    form.set('photo', new Blob([photo], { type: 'image/jpeg' }), 'reference.jpg');
    form.set('userNickname', '展位测试');
    form.set('personaId', brief.primaryPersonaId);
    form.set('accessoryIds', JSON.stringify(brief.suggestedMaterialIds));
    form.set('photoStyle', brief.photoStyle);
    form.set('dollDesign', dollDesign);
    return owner('/api/cards', { method: 'POST', headers: { 'Idempotency-Key': 'same-card' }, body: form });
  };
  const [first, same] = await Promise.all([create().then((res) => json(res, 202)), create().then((res) => json(res, 202))]);
  assert.equal(first.versionId, same.versionId);
  assert.equal((await json(await owner('/api/cards'))).length, 1);
  assert.equal((await create('不同的娃娃方案')).status, 409);

  const waitFor = async (url) => {
    for (let attempt = 0; attempt < 100; attempt++) {
      const value = await json(await owner(url));
      if (!['queued', 'running'].includes(value.status)) return value;
      await delay(55);
    }
    throw new Error('任务超时');
  };
  const version = await waitFor('/api/card-versions/' + first.versionId);
  assert.equal(version.status, 'succeeded', version.errorMessage);
  const detail = await json(await owner('/api/cards/' + first.cardId));
  assert.deepEqual(detail.materialPlan.map(item => item.id), brief.suggestedMaterialIds);
  assert.deepEqual(detail.materialPlan.map(item => item.amounts), brief.materialPlan.map(item => item.amounts));
  assert.ok(detail.materialPlan.every(item => item.referenceImageUrl));
  assert.equal(calls.image.length, 1);
  assert.equal(calls.image[0].auth, 'Bearer fixture');
  assert.match(calls.image[0].type, /multipart\/form-data/);
  assert.ok(!calls.image[0].body.includes(photo));
  assert.ok(calls.image[0].body.includes(brief.photoStyle));
  assert.ok(calls.image[0].body.includes(brief.dollDesign));
  assert.ok(calls.image[0].body.includes('gpt-image-2.6-flare'));
  assert.ok(calls.image[0].body.includes('Input image 1: 带帽橡果'));
  assert.ok(calls.image[0].body.includes('Input image 2: 云朵棉面料'));
  assert.ok(calls.image[0].body.includes('裁 1 片，12 × 3 cm（长 × 宽）'));
  assert.ok(calls.image[0].body.includes('The material list below is exhaustive'));
  assert.ok(calls.image[0].body.includes(acornArtwork));
  assert.ok(calls.image[0].body.includes(cottonArtwork));
  assert.equal(calls.image[0].body.toString().match(/name="image\[\]"/g).length, brief.materialPlan.length);
  assert.equal(calls.review.length, 1);
  assert.equal(calls.review[0].model, 'step-5-preview');
  const [checklist, candidate] = calls.review[0].messages[1].content;
  assert.match(checklist.text, /带帽橡果.*头部/);
  assert.match(checklist.text, /云朵棉面料.*围巾或衣片/);
  assert.equal(candidate.image_url.url, 'data:image/jpeg;base64,' + output.toString('base64'));
  assert.equal((await fetch(base + version.resultUrl)).status, 404);
  assert.equal((await owner(version.resultUrl)).status, 200);

  const jobData = { cardVersionId: version.id, paperSize: 'A6' };
  const jobs = await Promise.all([post('/api/plot/jobs', jobData, 'same-plot'), post('/api/plot/jobs', jobData, 'same-plot')]);
  const [job, sameJob] = await Promise.all(jobs.map((res) => json(res, 202)));
  assert.equal(job.jobId, sameJob.jobId);
  const finished = await waitFor('/api/plot/jobs/' + job.jobId);
  assert.equal(finished.status, 'succeeded');
  assert.equal(finished.physicalExecuted, false);

  const redrawUrl = '/api/cards/' + first.cardId + '/redraw';
  const mismatch = await json(await post(redrawUrl, {}, 'gpt-material-mismatch'), 202);
  const rejected = await waitFor('/api/card-versions/' + mismatch.versionId);
  assert.equal(rejected.status, 'failed');
  assert.equal(rejected.errorCode, 'MATERIAL_MISMATCH');
  assert.equal(rejected.resultUrl, null);
  await assert.rejects(readFile(path.join(dir, 'files', 'generated', `${mismatch.versionId}.jpg`)), { code: 'ENOENT' });
  assert.equal(calls.review.length, 2);
  const redraw = await json(await post(redrawUrl, {}, 'gpt-unknown'), 202);
  const unknown = await waitFor('/api/card-versions/' + redraw.versionId);
  assert.equal(unknown.errorCode, 'GENERATION_STATUS_UNKNOWN');
  const blocked = await post(redrawUrl, {}, 'gpt-second-redraw');
  assert.equal(blocked.status, 409);
  assert.equal((await blocked.json()).error.code, 'GENERATION_REVIEW_REQUIRED');
  assert.equal(calls.image.length, 3);
  assert.ok(calls.image[1].body.includes(brief.dollDesign));
  assert.ok(calls.image[1].body.includes(acornArtwork));
});

test('续聊口令只用一次，原浏览器和新浏览器都保留会话', { timeout: 10000 }, async (t) => {
  const dir = await mkdtemp(path.join(tmpdir(), 'nutshell-claim-'));
  const { base } = await startApp(t, dir, { IMAGE_PROVIDER: 'mock' });
  t.after(() => rm(dir, { recursive: true, force: true }));
  const original = 'vk_claim_original_browser';
  const receiving = 'vk_claim_receiving_browser';
  const post = (visitor, pathname, data = {}) => fetch(base + pathname, {
    method: 'POST', headers: { 'X-Visitor-Key': visitor, 'Content-Type': 'application/json' }, body: JSON.stringify(data),
  });
  const first = await json(await post(original, '/api/session'));
  const beforeClaim = await json(await post(receiving, '/api/session'));
  assert.notEqual(first.sessionId, beforeClaim.sessionId);

  const previous = await json(await post(original, '/api/session/claim-code'));
  const claim = await json(await post(original, '/api/session/claim-code'));
  assert.ok(Date.parse(claim.expiresAt) - Date.now() <= 600_000);
  await json(await post(receiving, '/api/session/claim', { code: previous.code }), 404);
  assert.equal((await json(await post(receiving, '/api/session/claim', { code: claim.code }))).sessionId, first.sessionId);
  await json(await post(receiving, '/api/session/claim', { code: claim.code }), 404);

  assert.equal((await json(await post(original, '/api/session'))).sessionId, first.sessionId);
  assert.equal((await json(await post(receiving, '/api/session'))).sessionId, first.sessionId);
  const legacy = 'vk_ephemeral_fallback_0001';
  assert.notEqual((await json(await post(legacy, '/api/session'))).sessionId,
    (await json(await post(legacy, '/api/session'))).sessionId);
});

test('旧卡重生成受严格材料核对和并发、日额度限制', { timeout: 15000 }, async (t) => {
  const dir = await mkdtemp(path.join(tmpdir(), 'nutshell-admission-'));
  const imageBodies = [];
  let reviews = 0;
  let releaseFirstImage;
  const firstImageCanFinish = new Promise(resolve => { releaseFirstImage = resolve; });
  const provider = createServer(async (req, res) => {
    const chunks = [];
    for await (const chunk of req) chunks.push(chunk);
    res.setHeader('Content-Type', 'application/json');
    if (req.url === '/v1/images/edits') {
      imageBodies.push(Buffer.concat(chunks));
      if (imageBodies.length === 1) await firstImageCanFinish;
      res.end(JSON.stringify({ data: [{ b64_json: output.toString('base64') }] }));
    } else {
      reviews++;
      res.end(JSON.stringify({ choices: [{ message: { content: '{"matches":true,"unmatchedParts":[]}' } }] }));
    }
  });
  provider.listen(0, '127.0.0.1');
  await once(provider, 'listening');
  t.after(() => new Promise(done => provider.close(done)));
  const endpoint = 'http://127.0.0.1:' + provider.address().port + '/v1';
  const { base } = await startApp(t, dir, {
    IMAGE_PROVIDER: 'cloud', IMAGE_VENDOR: 'openai', OPENAI_API_KEY: 'fixture', OPENAI_IMAGE_API_BASE: endpoint,
    STEPFUN_API_KEY: 'fixture', STEPFUN_VISION_MODEL: 'step-5-preview', STEPFUN_API_BASE: endpoint,
    IMAGE_DAILY_LIMIT: '2', IMAGE_QUEUE_LIMIT: '1', DEMO_ADMIN_TOKEN: 'fixture-admin',
  });
  t.after(() => rm(dir, { recursive: true, force: true }));
  const visitor = 'vk_old_card_creation_owner';
  const owner = (pathname, init = {}, whom = visitor) => fetch(base + pathname, {
    ...init, headers: { 'X-Visitor-Key': whom, ...init.headers },
  });
  const setStrict = async (value) => json(await owner('/api/demo/settings', {
    method: 'PATCH', headers: { Authorization: 'Bearer fixture-admin', 'Content-Type': 'application/json' },
    body: JSON.stringify({ strictMaterialConstraint: value }),
  }));
  const create = (whom, key) => {
    const form = new FormData();
    form.set('photo', new Blob([photo], { type: 'image/jpeg' }), 'sample.jpg');
    form.set('userNickname', '工坊测试');
    form.set('personaId', 'persona_enfp');
    form.set('accessoryIds', JSON.stringify(['kit_capped_acorn', 'kit_cloud_cotton']));
    return owner('/api/cards', { method: 'POST', headers: { 'Idempotency-Key': key }, body: form }, whom);
  };
  const finish = async (versionId) => {
    for (let attempt = 0; attempt < 50; attempt++) {
      const version = await json(await owner('/api/card-versions/' + versionId));
      if (!['queued', 'running'].includes(version.status)) {
        assert.equal(version.status, 'succeeded', version.errorMessage);
        return;
      }
      await delay(80);
    }
    throw new Error('生成任务没有完成');
  };

  await setStrict(false);
  const first = await json(await create(visitor, 'old-card'), 202);
  try {
    const concurrent = await create('vk_other_queue_visitor', 'other-card');
    assert.equal(concurrent.status, 429);
    assert.equal((await concurrent.json()).error.code, 'IMAGE_QUEUE_FULL');
  } finally {
    releaseFirstImage();
  }
  await finish(first.versionId);
  assert.ok(imageBodies[0].includes(photo));
  await setStrict(true);
  const redraw = () => owner('/api/cards/' + first.cardId + '/redraw', {
    method: 'POST', headers: { 'Idempotency-Key': 'strict-redraw' },
  });
  const regenerated = await json(await redraw(), 202);
  await finish(regenerated.versionId);
  assert.ok(!imageBodies[1].includes(photo));
  assert.equal(reviews, 1);
  assert.equal((await json(await redraw(), 202)).versionId, regenerated.versionId);
  const overBudget = await create('vk_other_queue_visitor', 'new-card');
  assert.equal(overBudget.status, 429);
  assert.equal((await overBudget.json()).error.code, 'IMAGE_RATE_LIMIT');
  assert.equal(imageBodies.length, 2);
});
