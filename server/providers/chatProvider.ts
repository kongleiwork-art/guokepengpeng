import { config, isChatCloudConfigured } from '../config.ts';
import { requestStepFun, stepFunError } from './stepfun.ts';

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
        message: '阶跃星辰对话尚未配置 STEPFUN_API_KEY',
      };
      return;
    }

    const systemInstruction = buildSystemPrompt(input);
    const trimmedHistory = trimHistory(input.history, config.chatContextMaxMessages);

    yield* this.streamStepFun(systemInstruction, trimmedHistory, input);
  }

  private async *streamStepFun(
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
    if (input.signal?.aborted) onExternalAbort();
    input.signal?.addEventListener('abort', onExternalAbort, { once: true });

    try {
      const response = await requestStepFun({
        stream: true,
        max_tokens: 600,
        messages: [
          { role: 'system', content: systemInstruction },
          ...history,
          { role: 'user', content: input.userText },
        ],
      }, AbortSignal.any([controller.signal, AbortSignal.timeout(45000)]));

      if (!response.ok || !response.body) throw stepFunError(response.status);

      let providerReqId = response.headers.get('x-request-id') || undefined;
      let completed = false;
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
          if (payload === '[DONE]') {
            completed = true;
            break;
          }
          try {
            const parsed = JSON.parse(payload);
            providerReqId ||= typeof parsed?.id === 'string' ? parsed.id : undefined;
            const choice = parsed?.choices?.[0];
            if (choice?.finish_reason === 'stop') completed = true;
            const delta = choice?.delta?.content;
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
        if (completed) {
          await reader.cancel().catch(() => {});
          break;
        }
      }

      if (!completed || !firstTokenReceived) {
        yield { type: 'error', code: 'PROVIDER_INCOMPLETE', message: '阶跃星辰对话回复未完整返回，请重试' };
        return;
      }
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
      const e = err as { code?: string; message?: string };
      yield {
        type: 'error',
        code: e.code || 'PROVIDER_ERROR',
        message: e.code && e.message ? e.message : '阶跃星辰对话连接中断，请重试',
      };
    } finally {
      clearTimeout(timer);
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
