import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { AnimatePresence, motion } from 'motion/react';
import type { ChatMessage, DollDetail, MemoryItem } from '../lib/types';
import { haptic } from '../lib/haptics';

export type MemoryBubbleTone = 'sage' | 'ochre' | 'blush';

export interface MemoryPhraseItem {
  id: string;
  phrase: string;
  sourceLabel: string;
  timeHint: string | null;
  tone: MemoryBubbleTone;
}

export interface ActiveMemoryBubble {
  uid: string;
  x: number;
  y: number;
  tapX: number;
  tapY: number;
  tilt: number;
  item: MemoryPhraseItem;
}

const EASE_FLOAT_IN = [0.22, 1, 0.36, 1] as const;
const EASE_FLOAT_OUT = [0.4, 0, 0.2, 1] as const;
const MAX_VISIBLE_BUBBLES = 3;
const AUTO_DISMISS_MS = 4400;

function trimClause(raw: string, maxLen = 30): string {
  const cleaned = raw
    .replace(/^[\s「“"『(（]+/u, '')
    .replace(/[\s」”"』)）]+$/u, '')
    .replace(/\s+/g, ' ')
    .trim();
  if (!cleaned) return '';
  return cleaned.length > maxLen ? `${cleaned.slice(0, maxLen)}…` : cleaned;
}

function formatShortTime(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return '方才';
  const now = new Date();
  const sameDay =
    date.getFullYear() === now.getFullYear() &&
    date.getMonth() === now.getMonth() &&
    date.getDate() === now.getDate();
  const hh = String(date.getHours()).padStart(2, '0');
  const mm = String(date.getMinutes()).padStart(2, '0');
  if (sameDay) return `${hh}:${mm}`;
  return `${date.getMonth() + 1}月${date.getDate()}日`;
}

function pickToneForText(text: string, role: 'user' | 'assistant' | 'memory'): MemoryBubbleTone {
  if (/喜欢|开心|晴朗|阳光|温暖|约定|茶|晚安|早安|微笑/.test(text)) return 'ochre';
  if (/陪你|温柔|想念|轻声|抱抱|慢慢|安心|心事/.test(text)) return 'blush';
  if (role === 'user') return 'sage';
  if (role === 'memory') return 'ochre';
  return 'sage';
}

function extractBestClauseFromText(text: string, keywords: string[]): string {
  const rawClauses = text
    .split(/[。！？!?；;\n]+/u)
    .map((c) => c.trim())
    .filter((c) => c.length >= 4);

  if (rawClauses.length === 0) {
    return trimClause(text, 28);
  }

  let bestClause = rawClauses[0];
  let bestScore = -1;

  for (const clause of rawClauses) {
    let score = 0;
    // Prefer natural poetic sentence length (8..26 chars)
    if (clause.length >= 8 && clause.length <= 26) score += 3;
    else if (clause.length >= 5 && clause.length <= 34) score += 1.5;

    // Boost clauses echoing shared keywords
    for (const kw of keywords) {
      if (kw.length >= 2 && clause.includes(kw)) {
        score += 4;
        break;
      }
    }

    // Boost emotional or conversational key phrases
    if (/记住|约定|喜欢|陪你|原来|其实|觉得|今天|晚安|想|如果|一起/.test(clause)) {
      score += 2;
    }

    if (score > bestScore) {
      bestScore = score;
      bestClause = clause;
    }
  }

  return trimClause(bestClause, 30);
}

/**
 * Extracts concise key phrases from recent dialogue turns and shared memories,
 * falling back gracefully to the doll's opening line & persona notes before first chat.
 */
export function buildMemoryPhrasePool(
  messages: ChatMessage[],
  memories: MemoryItem[],
  doll: DollDetail
): MemoryPhraseItem[] {
  const pool: MemoryPhraseItem[] = [];
  const seen = new Set<string>();

  const pushUnique = (item: MemoryPhraseItem) => {
    const normalized = item.phrase.toLowerCase();
    if (!item.phrase || seen.has(normalized)) return;
    seen.add(normalized);
    pool.push(item);
  };

  const keywordNeedles = memories
    .map((m) => m.value.replace(/^(记住|请记住)[：:\s]*/u, '').trim())
    .filter((s) => s.length >= 2);

  // 1. Recent completed dialogue messages (most recent first, up to 14 messages)
  const completed = messages
    .filter((m) => m.status === 'completed' && m.content.trim().length > 0)
    .slice(-14)
    .reverse();

  for (const msg of completed) {
    const clause = extractBestClauseFromText(msg.content, keywordNeedles);
    if (!clause) continue;
    pushUnique({
      id: `msg_${msg.id}`,
      phrase: clause,
      sourceLabel: msg.role === 'user' ? '你的话' : `${doll.name}轻语`,
      timeHint: formatShortTime(msg.createdAt),
      tone: pickToneForText(clause, msg.role),
    });
  }

  // 2. Shared user-defined memories
  for (const mem of memories.slice(-6).reverse()) {
    const cleanVal = trimClause(mem.value, 24);
    if (!cleanVal) continue;
    let formatted = cleanVal;
    let sourceLabel = '共同记忆';
    if (mem.type === 'user_nickname') {
      formatted = `唤你作「${cleanVal}」的约定`;
      sourceLabel = '专属称呼';
    } else if (mem.type === 'accessories') {
      formatted = `身上带着「${cleanVal}」的手作印记`;
      sourceLabel = '手作配饰';
    } else if (mem.type === 'fact') {
      sourceLabel = '记下的小事';
    }
    pushUnique({
      id: `mem_${mem.id}`,
      phrase: formatted,
      sourceLabel,
      timeHint: formatShortTime(mem.createdAt),
      tone: pickToneForText(formatted, 'memory'),
    });
  }

  // 3. Opening line & persona fallback so first-time visits feel alive immediately
  const openingClauses = doll.persona.openingLine
    .split(/[。！？!?；;\n]+/u)
    .map((c) => trimClause(c, 30))
    .filter((c) => c.length >= 4);

  if (openingClauses.length > 0) {
    openingClauses.forEach((clause, idx) => {
      pushUnique({
        id: `opening_${idx}`,
        phrase: clause,
        sourceLabel: `${doll.name}初遇`,
        timeHint: null,
        tone: idx % 2 === 0 ? 'ochre' : 'sage',
      });
    });
  } else {
    pushUnique({
      id: 'opening_full',
      phrase: trimClause(doll.persona.openingLine, 30),
      sourceLabel: `${doll.name}初遇`,
      timeHint: null,
      tone: 'ochre',
    });
  }

  if (doll.persona.materialHint && pool.length < 3) {
    pushUnique({
      id: 'persona_hint',
      phrase: trimClause(doll.persona.materialHint, 28),
      sourceLabel: '材质印象',
      timeHint: null,
      tone: 'blush',
    });
  }

  return pool;
}

export function useChatMemoryBubbles(
  messages: ChatMessage[],
  memories: MemoryItem[],
  doll: DollDetail | null
) {
  const [bubbles, setBubbles] = useState<ActiveMemoryBubble[]>([]);
  const cursorRef = useRef(0);
  const timersRef = useRef<Map<string, number>>(new Map());

  const phrasePool = useMemo(() => {
    if (!doll) return [];
    return buildMemoryPhrasePool(messages, memories, doll);
  }, [messages, memories, doll]);

  // Keep cursor valid if pool shrinks on doll change
  useEffect(() => {
    cursorRef.current = 0;
  }, [doll?.id]);

  // Cleanup all timers on unmount
  useEffect(() => {
    return () => {
      for (const timer of timersRef.current.values()) {
        window.clearTimeout(timer);
      }
      timersRef.current.clear();
    };
  }, []);

  const dismissBubble = useCallback((uid: string) => {
    const existing = timersRef.current.get(uid);
    if (existing) {
      window.clearTimeout(existing);
      timersRef.current.delete(uid);
    }
    setBubbles((prev) => prev.filter((b) => b.uid !== uid));
  }, []);

  const spawnAtPoint = useCallback(
    (clientX: number, clientY: number, container: HTMLElement) => {
      if (phrasePool.length === 0) return;

      const rect = container.getBoundingClientRect();
      const relX = clientX - rect.left;
      const relY = clientY - rect.top;

      // Keep watercolor bubble gracefully inside the chat canvas bounds
      const maxBubbleWidth = rect.width < 480 ? Math.min(238, rect.width - 28) : 264;
      const halfW = maxBubbleWidth / 2;
      const edgePad = 14;

      const clampedX = Math.max(
        halfW + edgePad,
        Math.min(Math.max(halfW + edgePad, rect.width - halfW - edgePad), relX)
      );
      const clampedY = Math.max(
        18,
        Math.min(Math.max(18, rect.height - 108), relY - 34)
      );

      const index = cursorRef.current % phrasePool.length;
      cursorRef.current += 1;
      const item = phrasePool[index];

      const uid = `mb_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
      const tilt = ((index % 3) - 1) * 1.15; // subtle -1.15deg, 0deg, +1.15deg paper slip slant

      haptic('selection');

      setBubbles((prev) => {
        const next = [
          ...prev,
          {
            uid,
            x: clampedX,
            y: clampedY,
            tapX: relX,
            tapY: relY,
            tilt,
            item,
          },
        ];
        // Trim oldest if exceeding max simultaneous bubbles
        if (next.length > MAX_VISIBLE_BUBBLES) {
          const removed = next.shift();
          if (removed) {
            const t = timersRef.current.get(removed.uid);
            if (t) {
              window.clearTimeout(t);
              timersRef.current.delete(removed.uid);
            }
          }
        }
        return next;
      });

      const timer = window.setTimeout(() => {
        timersRef.current.delete(uid);
        setBubbles((prev) => prev.filter((b) => b.uid !== uid));
      }, AUTO_DISMISS_MS);
      timersRef.current.set(uid, timer);
    },
    [phrasePool]
  );

  const handleCanvasClick = useCallback(
    (e: React.MouseEvent<HTMLDivElement>) => {
      // Ignore clicks when user was selecting text
      const selection = window.getSelection?.()?.toString().trim();
      if (selection) return;

      const target = e.target as HTMLElement | null;
      if (!target) return;

      // Only trigger when clicking blank canvas area (not messages, avatars, buttons, links, inputs)
      if (
        target.closest(
          'button, a, input, textarea, select, [data-memory-bubble-ignore="true"]'
        )
      ) {
        return;
      }

      spawnAtPoint(e.clientX, e.clientY, e.currentTarget);
    },
    [spawnAtPoint]
  );

  return {
    bubbles,
    handleCanvasClick,
    dismissBubble,
  };
}

const TONE_CLASS: Record<MemoryBubbleTone, string> = {
  sage: 'memory-wc-bubble-sage',
  ochre: 'memory-wc-bubble-ochre',
  blush: 'memory-wc-bubble-blush',
};

const TONE_ACCENT: Record<MemoryBubbleTone, string> = {
  sage: '#3E766A',
  ochre: '#9B6F32',
  blush: '#9C5B4D',
};

/**
 * Floating translucent watercolor-paper memory bubbles rendered inside the chat message canvas.
 */
export function ChatMemoryBubblesLayer({
  bubbles,
  onDismiss,
}: {
  bubbles: ActiveMemoryBubble[];
  onDismiss: (uid: string) => void;
}) {
  return (
    <div
      className="pointer-events-none absolute inset-0 z-20 overflow-hidden"
      aria-live="polite"
      aria-label="记忆气泡浮层"
    >
      <AnimatePresence>
        {bubbles.map((bubble) => {
          const accent = TONE_ACCENT[bubble.item.tone];
          return (
            <motion.div
              key={bubble.uid}
              initial={{ opacity: 1 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 1, transition: { duration: 0.52 } }}
            >
              {/* Delicate watercolor ink ripple at the exact tap coordinate */}
              <motion.span
                aria-hidden="true"
                initial={{ opacity: 0.55, scale: 0.25 }}
                animate={{ opacity: 0, scale: 2.3 }}
                exit={{ opacity: 0 }}
                transition={{ duration: 0.72, ease: EASE_FLOAT_IN }}
                className="pointer-events-none absolute w-8 h-8 rounded-full border"
                style={{
                  left: bubble.tapX - 16,
                  top: bubble.tapY - 16,
                  borderColor: `${accent}55`,
                  background: `radial-gradient(circle, ${accent}1F 0%, transparent 72%)`,
                }}
              />

              {/* Outer anchor wrapper (keeps -translate-x-1/2 separate from motion transforms) */}
              <div
                className="absolute -translate-x-1/2"
                style={{
                  left: bubble.x,
                  top: bubble.y,
                }}
              >
                <div className="memory-bubble-gentle-float">
                  <motion.button
                    type="button"
                    data-memory-bubble-ignore="true"
                    onClick={(e) => {
                      e.stopPropagation();
                      haptic('selection');
                      onDismiss(bubble.uid);
                    }}
                    initial={{ opacity: 0, scale: 0.76, y: 12, rotate: bubble.tilt * 1.4 }}
                    animate={{ opacity: 1, scale: 1, y: 0, rotate: bubble.tilt }}
                    exit={{
                      opacity: 0,
                      scale: 0.85,
                      y: -14,
                      transition: { duration: 0.5, ease: EASE_FLOAT_OUT },
                    }}
                    transition={{ duration: 0.42, ease: EASE_FLOAT_IN }}
                    whileTap={{ scale: 0.96 }}
                    aria-label={`记忆气泡：${bubble.item.phrase}，点击轻收`}
                    className={`pointer-events-auto memory-wc-bubble ${TONE_CLASS[bubble.item.tone]} text-left max-w-[238px] sm:max-w-[264px] px-3.5 py-2.5 rounded-[20px] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#4A8276]/45 cursor-pointer`}
                  >
                    {/* Quiet unboxed stationery header */}
                    <div className="flex items-center justify-between gap-2 text-[10.5px] mb-1">
                      <span className="inline-flex items-center gap-1.5 min-w-0">
                        <span
                          aria-hidden="true"
                          className="w-2 h-2 rounded-full shrink-0 opacity-75"
                          style={{
                            background: `radial-gradient(circle at 38% 38%, ${accent} 0%, ${accent}44 100%)`,
                          }}
                        />
                        <span
                          className="font-medium tracking-wide truncate"
                          style={{ color: accent }}
                        >
                          记忆气泡
                        </span>
                        <span className="text-[#C8B9A6]" aria-hidden="true">
                          ·
                        </span>
                        <span className="text-[#8C7A6B] truncate">{bubble.item.sourceLabel}</span>
                      </span>
                      {bubble.item.timeHint && (
                        <span className="font-mono tabular-nums text-[10px] text-[#A29182] shrink-0">
                          {bubble.item.timeHint}
                        </span>
                      )}
                    </div>

                    {/* Key dialogue phrase in editorial serif */}
                    <p className="font-editorial text-[13px] leading-[1.58] text-[#382A22] break-words">
                      “{bubble.item.phrase}”
                    </p>
                  </motion.button>
                </div>
              </div>
            </motion.div>
          );
        })}
      </AnimatePresence>
    </div>
  );
}
