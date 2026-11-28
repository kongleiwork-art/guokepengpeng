import assert from 'node:assert/strict';
import test from 'node:test';
import { ApiError, streamDollChat } from '../src/lib/api.ts';
import { startTaskPolling } from '../src/lib/taskPolling.ts';
import { speakDollLine, stopDollVoice, watchDollVoice } from '../src/lib/dollVoice.ts';

test('更换、结束和手动停止娃娃语音都会释放配乐音量', (t) => {
  const originalWindow = globalThis.window;
  const timers = new Map();
  let timer = 0;
  globalThis.window = {
    setTimeout(fn) { timers.set(++timer, fn); return timer; },
    clearTimeout(id) { timers.delete(id); },
  };
  const levels = [];
  const unsubscribe = watchDollVoice(speaking => levels.push(speaking));
  t.after(() => {
    unsubscribe();
    stopDollVoice();
    if (originalWindow === undefined) delete globalThis.window;
    else globalThis.window = originalWindow;
  });
  speakDollLine('one', '来坐坐。');
  speakDollLine('two', '我听着呢。');
  assert.equal(timers.size, 1);
  timers.get(timer)();
  speakDollLine('three', '下次见。');
  stopDollVoice();
  assert.deepEqual(levels, [false, true, false, true, false, true, false]);
});

test('聊天连接早退会保留片段并通知重试', async (t) => {
  t.mock.method(globalThis, 'fetch', async () => new Response(
    'event: delta\r\ndata: {"text":"收到一半"}\r\n\r\n',
    { headers: { 'Content-Type': 'text/event-stream' } },
  ));
  const events = [];
  await streamDollChat('demo-acorn', { text: '你好', clientMessageId: 'interrupted-message' }, {
    onDelta: text => events.push(text),
    onDone: () => events.push('done'),
    onError: error => events.push(error.code),
  });
  assert.deepEqual(events, ['收到一半', 'CHAT_INTERRUPTED']);
});

test('生图状态查询短暂失败后继续查询同一任务', { timeout: 4000 }, async () => {
  let attempts = 0;
  const failures = [];
  let stop;
  try {
    await new Promise(resolve => {
      stop = startTaskPolling(async () => {
        attempts++;
        if (attempts === 1) throw new ApiError(503, 'DB_UNAVAILABLE', '稍后重试');
        resolve();
        return false;
      }, (err, retrying) => failures.push([err.code, retrying]));
    });
  } finally {
    stop?.();
  }
  assert.equal(attempts, 2);
  assert.deepEqual(failures, [['DB_UNAVAILABLE', true]]);
});
