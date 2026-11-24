import { GoogleGenAI, ThinkingLevel } from '@google/genai';
import { config, isChatCloudConfigured } from '../config.ts';

export interface ChatPersonaContext {
  id: string;
  name: string;
  mbti: string;
  cognitiveAxis?: string;
  speechStyle?: string;
  materialHint?: string;
  prompt: string;
  openingLine: string;
}

export interface ChatMemoryItem {
  type: string;
  value: string;
  source: string;
}

export interface ChatHistoryMessage {
  role: 'user' | 'assistant';
  content: string;
}

export interface ChatStreamInput {
  dollName: string;
  dollKind: 'demo' | 'personal';
  persona: ChatPersonaContext;
  memories: ChatMemoryItem[];
  history: ChatHistoryMessage[];
  userText: string;
  requestId: string;
  signal?: AbortSignal;
}

export type ChatStreamEvent =
  | { type: 'delta'; text: string }
  | { type: 'done'; providerRequestId?: string }
  | { type: 'error'; code: string; message: string };

export interface ChatProvider {
  readonly mode: 'mock' | 'cloud';
  streamChat(input: ChatStreamInput): AsyncGenerator<ChatStreamEvent, void, unknown>;
}

const MEMORY_TYPE_LABELS: Record<string, string> = {
  user_nickname: '用户称呼',
  doll_name: '娃娃名字',
  persona: '选定人格',
  accessories: '选定手作材料与配饰',
  fact: '用户明确要求记住的事',
};

export function buildSystemPrompt(input: ChatStreamInput): string {
  const memoryLines =
    input.memories.length > 0
      ? input.memories
          .map((m) => `- ${MEMORY_TYPE_LABELS[m.type] || m.type}：${m.value}`)
          .join('\n')
      : '- 暂无已保存的明确记忆';

  return [
    `你是“果壳碰碰”文创工坊里的天然果实手作娃娃，你的名字是「${input.dollName}」。`,
    `你的核心 MBTI 人格是 ${input.persona.mbti}（${input.persona.name}）。`,
    input.persona.cognitiveAxis ? `认知功能轴：${input.persona.cognitiveAxis}。` : '',
    input.persona.materialHint ? `你的实体手作材质设定：${input.persona.materialHint}。` : '',
    '',
    '【人格内核与强烈辨识度约束（必须严格遵守，禁止退化为泛化温吞客服腔）】',
    `核心人格指引：${input.persona.prompt}`,
    input.persona.speechStyle ? `语言风格、口癖与禁忌：${input.persona.speechStyle}` : '',
    `你的经典开场语气参考：「${input.persona.openingLine}」`,
    '',
    '【已保存的明确记忆（仅来自用户实际输入或创建选择，请自然融入对话，不要生硬背诵清单）】',
    memoryLines,
    '',
    '【对话硬规则】',
    `1. 每一轮回复都必须鲜明体现 ${input.persona.mbti}（${input.persona.name}）的思维方式、句式节奏与情感温度，让用户一眼就能听出你与其他 15 种 MBTI 娃娃的明显差别。`,
    '2. 禁止自称“AI”“语言模型”或使用机械客服话术（如“有什么我可以帮您”）。你就是一只住进对方桌面/书包、通过 NFC 碰一碰苏醒的天然果实小娃娃。',
    '3. 如果记忆中有用户称呼，请自然称呼对方；若对方聊到你身上的果实/毛线/配饰或让你记住的事，基于上述记忆真诚呼应。',
    '4. 绝不把未告知的事实编造为“既定记忆”。',
    '5. 中文回复自然紧凑，长度控制在 2–4 句，既有鲜明 MBTI 性格锐度又有手作陪伴温度。',
  ]
    .filter(Boolean)
    .join('\n');
}

function trimHistory(history: ChatHistoryMessage[], maxMessages: number): ChatHistoryMessage[] {
  if (history.length <= maxMessages) return history;
  return history.slice(history.length - maxMessages);
}

class CloudChatProvider implements ChatProvider {
  readonly mode = 'cloud' as const;

  async *streamChat(input: ChatStreamInput): AsyncGenerator<ChatStreamEvent, void, unknown> {
    if (!isChatCloudConfigured()) {
      yield {
        type: 'error',
        code: 'PROVIDER_NOT_CONFIGURED',
        message: '真实对话模型未配置有效密钥（请设置 GEMINI_API_KEY 或 CHAT_API_KEY）',
      };
      return;
    }

    const systemInstruction = buildSystemPrompt(input);
    const trimmedHistory = trimHistory(input.history, config.chatContextMaxMessages);

    if (config.chatApiBase) {
      yield* this.streamOpenAICompatible(systemInstruction, trimmedHistory, input);
      return;
    }

    yield* this.streamGemini(systemInstruction, trimmedHistory, input);
  }

  private async *streamGemini(
    systemInstruction: string,
    history: ChatHistoryMessage[],
    input: ChatStreamInput
  ): AsyncGenerator<ChatStreamEvent, void, unknown> {
    const apiKey = config.chatApiKey || config.geminiApiKey;
    const ai = new GoogleGenAI({
      apiKey,
      httpOptions: {
        headers: {
          'User-Agent': 'aistudio-build',
        },
      },
    });

    const contents = [
      ...history.map((m) => ({
        role: m.role === 'assistant' ? 'model' : 'user',
        parts: [{ text: m.content }],
      })),
      {
        role: 'user',
        parts: [{ text: input.userText }],
      },
    ];

    let firstTokenTimer: ReturnType<typeof setTimeout> | null = null;
    let firstTokenReceived = false;
    let timedOut = false;

    const timeoutPromise = new Promise<never>((_, reject) => {
      firstTokenTimer = setTimeout(() => {
        if (!firstTokenReceived) {
          timedOut = true;
          reject(Object.assign(new Error('首字响应超时'), { code: 'CHAT_TIMEOUT' }));
        }
      }, config.chatFirstTokenTimeoutMs);
    });

    try {
      const supportsThinkingLevel =
        config.chatModel.startsWith('gemini-4') || config.chatModel.startsWith('gemini-3');
      const callStream = () =>
        ai.models.generateContentStream({
          model: config.chatModel,
          contents,
          config: {
            systemInstruction,
            ...(supportsThinkingLevel
              ? { thinkingConfig: { thinkingLevel: ThinkingLevel.LOW } }
              : {}),
          },
        });

      let stream;
      try {
        stream = await Promise.race([callStream(), timeoutPromise]);
      } catch (firstErr: unknown) {
        const msg = firstErr instanceof Error ? firstErr.message : String(firstErr);
        const isTransient503 = msg.includes('503') || msg.includes('UNAVAILABLE');
        if (isTransient503 && !timedOut && !input.signal?.aborted) {
          await new Promise((r) => setTimeout(r, 900));
          stream = await Promise.race([callStream(), timeoutPromise]);
        } else {
          throw firstErr;
        }
      }

      const iterator = stream[Symbol.asyncIterator]();

      while (true) {
        if (input.signal?.aborted) {
          return;
        }
        const nextPromise = iterator.next();
        const result = firstTokenReceived
          ? await nextPromise
          : await Promise.race([nextPromise, timeoutPromise]);

        if (result.done) break;
        const chunkText = result.value?.text ?? '';
        if (chunkText) {
          if (!firstTokenReceived) {
            firstTokenReceived = true;
            if (firstTokenTimer) clearTimeout(firstTokenTimer);
          }
          yield { type: 'delta', text: chunkText };
        }
      }

      if (firstTokenTimer) clearTimeout(firstTokenTimer);
      yield { type: 'done', providerRequestId: `gemini_${input.requestId}` };
    } catch (err: unknown) {
      if (firstTokenTimer) clearTimeout(firstTokenTimer);
      const errObj = err as { code?: string; status?: number; message?: string };
      if (timedOut || errObj?.code === 'CHAT_TIMEOUT') {
        yield {
          type: 'error',
          code: 'CHAT_TIMEOUT',
          message: `对话首字响应超过 ${config.chatFirstTokenTimeoutMs}ms 超时上限`,
        };
        return;
      }
      const rawMsg = errObj?.message || '云端对话服务调用失败';
      const friendlyMsg =
        rawMsg.includes('503') || rawMsg.includes('UNAVAILABLE')
          ? '云端对话模型当前处于高负载高峰（HTTP 503），请稍后点击重试'
          : rawMsg.includes('429') || rawMsg.includes('RESOURCE_EXHAUSTED')
          ? '云端对话模型触发配额限流（HTTP 429），请稍后重试'
          : rawMsg.slice(0, 220);
      yield {
        type: 'error',
        code: 'PROVIDER_ERROR',
        message: friendlyMsg,
      };
    }
  }

  private async *streamOpenAICompatible(
    systemInstruction: string,
    history: ChatHistoryMessage[],
    input: ChatStreamInput
  ): AsyncGenerator<ChatStreamEvent, void, unknown> {
    const controller = new AbortController();
    let firstTokenReceived = false;
    let timedOut = false;

    const timer = setTimeout(() => {
      if (!firstTokenReceived) {
        timedOut = true;
        controller.abort();
      }
    }, config.chatFirstTokenTimeoutMs);

    const onExternalAbort = () => controller.abort();
    input.signal?.addEventListener('abort', onExternalAbort);

    try {
      const endpoint = `${config.chatApiBase.replace(/\/+$/, '')}/chat/completions`;
      const response = await fetch(endpoint, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${config.chatApiKey}`,
        },
        body: JSON.stringify({
          model: config.chatModel,
          stream: true,
          messages: [
            { role: 'system', content: systemInstruction },
            ...history.map((h) => ({ role: h.role, content: h.content })),
            { role: 'user', content: input.userText },
          ],
        }),
        signal: controller.signal,
      });

      if (!response.ok || !response.body) {
        clearTimeout(timer);
        const bodyText = await response.text().catch(() => '');
        yield {
          type: 'error',
          code: 'PROVIDER_ERROR',
          message: `对话接口返回 HTTP ${response.status}${bodyText ? `: ${bodyText.slice(0, 120)}` : ''}`,
        };
        return;
      }

      const providerReqId = response.headers.get('x-request-id') || `oai_${input.requestId}`;
      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let buffer = '';

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n');
        buffer = lines.pop() ?? '';

        for (const rawLine of lines) {
          const line = rawLine.trim();
          if (!line.startsWith('data:')) continue;
          const payload = line.slice(5).trim();
          if (payload === '[DONE]') continue;
          try {
            const parsed = JSON.parse(payload);
            const delta = parsed?.choices?.[0]?.delta?.content;
            if (typeof delta === 'string' && delta.length > 0) {
              if (!firstTokenReceived) {
                firstTokenReceived = true;
                clearTimeout(timer);
              }
              yield { type: 'delta', text: delta };
            }
          } catch {
            // Ignore partial SSE comment lines
          }
        }
      }

      clearTimeout(timer);
      yield { type: 'done', providerRequestId: providerReqId };
    } catch (err: unknown) {
      clearTimeout(timer);
      if (timedOut) {
        yield {
          type: 'error',
          code: 'CHAT_TIMEOUT',
          message: `对话首字响应超过 ${config.chatFirstTokenTimeoutMs}ms 超时上限`,
        };
        return;
      }
      const message = err instanceof Error ? err.message : '对话接口连接失败';
      yield { type: 'error', code: 'PROVIDER_ERROR', message };
    } finally {
      input.signal?.removeEventListener('abort', onExternalAbort);
    }
  }
}

class MockChatProvider implements ChatProvider {
  readonly mode = 'mock' as const;

  async *streamChat(input: ChatStreamInput): AsyncGenerator<ChatStreamEvent, void, unknown> {
    if (input.userText.includes('[SIMULATE_TIMEOUT]')) {
      await new Promise((r) => setTimeout(r, 300));
      yield {
        type: 'error',
        code: 'CHAT_TIMEOUT',
        message: '（Mock 模拟）对话首字响应超时，请点击重试验证幂等恢复',
      };
      return;
    }
    if (input.userText.includes('[SIMULATE_ERROR]')) {
      await new Promise((r) => setTimeout(r, 200));
      yield {
        type: 'error',
        code: 'PROVIDER_ERROR',
        message: '（Mock 模拟）上游对话服务临时异常',
      };
      return;
    }

    const nickname = input.memories.find((m) => m.type === 'user_nickname')?.value;
    const accessories = input.memories.find((m) => m.type === 'accessories')?.value;
    const facts = input.memories.filter((m) => m.type === 'fact').map((m) => m.value);

    const greeting = nickname ? `${nickname}，` : '';
    const personaPrefix: Record<string, string> = {
      ENFP: `等一下等一下！我是${input.dollName}，听你这么说我脑子里已经蹦出三个超好玩的点子啦！`,
      INTJ: `先看本质。我是${input.dollName}，我把你刚才说的关键变量拆成了两层：`,
      INFP: `嗯……我是${input.dollName}，你刚才那句话让我心里轻轻晃了一下，像落了一片安静的叶子。`,
      ESTP: `行，直接开整！我是${input.dollName}，别绕弯子，咱们马上就能试出结果。`,
      INFJ: `我听见你话里藏着的那一层情绪了。我是${input.dollName}，我们可以慢慢理清它。`,
      ENFJ: `我真开心你愿意跟我说这些！我是${input.dollName}，而且你身上那股认真劲儿真的很让人信赖。`,
      INTP: `有意思，这刚好戳中一个反直觉的机制。我是${input.dollName}，按逻辑推演的话：`,
      ENTP: `等等，如果把你刚才那个前提反过来想，会不会更有意思？我是${input.dollName}，咱们来碰个脑洞！`,
      ENTJ: `目标很明确。我是${input.dollName}，给你一个 1-2-3 推进方案，立刻能落地：`,
      ISTJ: `我记下来了，按步骤核对一遍最稳妥。我是${input.dollName}，先把确定的事项放好：`,
      ISFJ: `先喝口温水歇一歇，我一直都在呢。我是${input.dollName}，你说的细节我都会仔细收着。`,
      ESTJ: `收到，干脆按标准拆开办！我是${input.dollName}，今天把最核心的那一步先完成。`,
      ESFJ: `哎呀我最懂这种心情了！我是${input.dollName}，来来来，跟我说说大家都怎么反应的？`,
      ISTP: `懂了，少说虚的直接看怎么修。我是${input.dollName}，最省力的一招是：`,
      ISFP: `唔，这个画面感我很喜欢……我是${input.dollName}，像午后晒热了的棉布一样舒服。`,
      ESFP: `哇塞这个必须庆祝一下！我是${input.dollName}，快乐就是要趁热分享才对味！`,
    };
    const opening =
      personaPrefix[input.persona.mbti] ||
      `我是${input.dollName}（${input.persona.mbti} · ${input.persona.name}）。`;

    const parts: string[] = [greeting + opening];

    if (
      accessories &&
      (input.userText.includes('配饰') ||
        input.userText.includes('材料') ||
        input.userText.includes('搭配') ||
        input.userText.includes('记得') ||
        input.history.length === 0)
    ) {
      parts.push(`我一直好好戴着你当初为我挑的「${accessories}」，每次碰一碰都觉得很合拍。`);
    }

    if (
      facts.length > 0 &&
      (input.userText.includes('记得') ||
        input.userText.includes('记住') ||
        input.userText.includes('什么') ||
        input.history.length <= 2)
    ) {
      parts.push(`另外，我一直记着你特意交代过的事：「${facts[facts.length - 1]}」。`);
    } else if (input.userText.includes('我是谁') || input.userText.includes('叫什么')) {
      if (nickname) {
        parts.push(`我当然记得你叫${nickname}，我的名字是${input.dollName}，性格是 ${input.persona.mbti}。`);
      } else {
        parts.push(`你还没告诉我怎么称呼你呢，在记忆面板或者对话里告诉我，我就记住啦。`);
      }
    } else {
      parts.push(
        `关于你刚提到的“${input.userText.slice(0, 28)}${input.userText.length > 28 ? '…' : ''}”，以我 ${input.persona.name} 的视角来看，接下来很值得继续聊聊。`
      );
    }

    const fullText = parts.join('');
    const chunkSize = 4;
    for (let i = 0; i < fullText.length; i += chunkSize) {
      if (input.signal?.aborted) return;
      await new Promise((r) => setTimeout(r, 34));
      yield { type: 'delta', text: fullText.slice(i, i + chunkSize) };
    }

    yield { type: 'done', providerRequestId: `mock_chat_${input.requestId}` };
  }
}

const cloudChatProvider = new CloudChatProvider();
const mockChatProvider = new MockChatProvider();

export function getChatProvider(mode: 'mock' | 'cloud' = config.chatProvider): ChatProvider {
  return mode === 'cloud' ? cloudChatProvider : mockChatProvider;
}
