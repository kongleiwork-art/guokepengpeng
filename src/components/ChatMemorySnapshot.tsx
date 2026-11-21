import { useMemo, useState } from 'react';
import { AnimatePresence, motion } from 'motion/react';
import { BookmarkPlus, BookOpen, ChevronDown, Volume2 } from 'lucide-react';
import type { ChatMessage, DollDetail, MemoryItem } from '../lib/types';
import { haptic } from '../lib/haptics';

interface ChatMemorySnapshotProps {
  doll: DollDetail;
  memories: MemoryItem[];
  messages: ChatMessage[];
  speakingId: string | null;
  onSpeakExcerpt?: (id: string, text: string) => void;
  onOpenRememberComposer?: () => void;
}

interface SnapshotKeyword {
  id: string;
  label: string;
  category: string;
  isUserDefined: boolean;
}

interface DialogueExchange {
  id: string;
  userLine: string | null;
  dollLine: string;
  createdAt: string;
  matchedKeyword: string | null;
}

type EmotionKey = 'joy' | 'curious' | 'warm' | 'melancholy' | 'calm';

interface EmotionSpec {
  key: EmotionKey;
  label: string;
  atmosphereHint: string;
  coreHex: string;
  washHex: string;
  rimHex: string;
  textColor: string;
  pattern: RegExp;
}

interface EmotionBrushPoint {
  id: string;
  emotion: EmotionSpec;
  snippet: string;
  turnLabel: string;
  shapeVariant: 0 | 1 | 2;
}

const EMOTION_SPECS: readonly EmotionSpec[] = [
  {
    key: 'joy',
    label: '愉悦',
    atmosphereHint: '明朗轻快',
    coreHex: '#E09F4B',
    washHex: '#F3CF8D',
    rimHex: '#C6822E',
    textColor: '#9A631D',
    pattern:
      /开心|高兴|愉悦|太好了|哈哈|嘻嘻|喜欢|幸福|灿烂|晴朗|惊喜|真棒|甜蜜|微笑|暖暖|期待|祝贺|厉害|真好|闪闪|雀跃/g,
  },
  {
    key: 'curious',
    label: '好奇',
    atmosphereHint: '灵动探索',
    coreHex: '#4E9484',
    washHex: '#9CD2C3',
    rimHex: '#356E61',
    textColor: '#2F6559',
    pattern:
      /好奇|为什么|怎么|吗[？?]?|呢[？?]?|咦|哇|有趣|探索|想知道|猜一猜|故事|秘密|灵感|发现|新鲜|试试|什么|原来/g,
  },
  {
    key: 'warm',
    label: '温柔',
    atmosphereHint: '安宁陪伴',
    coreHex: '#D58778',
    washHex: '#F1C1B6',
    rimHex: '#B66657',
    textColor: '#9C5143',
    pattern:
      /陪你|慢慢|安心|抱抱|没关系|辛苦|休息|晚安|早安|温柔|轻声|记住|约定|懂你|照顾|喝茶|微风|月光|一直都在|别怕/g,
  },
  {
    key: 'melancholy',
    label: '忧伤',
    atmosphereHint: '微雨怀思',
    coreHex: '#698CA6',
    washHex: '#ADC7DB',
    rimHex: '#4E6F88',
    textColor: '#47657D',
    pattern:
      /难过|忧伤|孤单|失落|好累|疲惫|叹气|眼泪|遗憾|想念|下雨|委屈|低落|可惜|心疼|别难过|撑不住|寂寞|酸涩/g,
  },
  {
    key: 'calm',
    label: '沉思',
    atmosphereHint: '静谧留白',
    coreHex: '#8E7FA4',
    washHex: '#C5B9D6',
    rimHex: '#6E5F84',
    textColor: '#66577B',
    pattern:
      /思考|平静|安静|沉淀|也许|或许|时间|记忆|发呆|放空|深呼吸|静静|夜晚|星空|窗边|独处|沉静|思绪/g,
  },
] as const;

const EMOTION_BY_KEY: Record<EmotionKey, EmotionSpec> = {
  joy: EMOTION_SPECS[0],
  curious: EMOTION_SPECS[1],
  warm: EMOTION_SPECS[2],
  melancholy: EMOTION_SPECS[3],
  calm: EMOTION_SPECS[4],
};

function detectLineEmotion(text: string, mbti: string): EmotionSpec {
  let bestKey: EmotionKey | null = null;
  let bestScore = 0;

  for (const spec of EMOTION_SPECS) {
    const matches = text.match(spec.pattern);
    const score = matches ? matches.length : 0;
    if (score > bestScore) {
      bestScore = score;
      bestKey = spec.key;
    }
  }

  if (bestKey) return EMOTION_BY_KEY[bestKey];

  // Subtle punctuation & MBTI fallback when a reply has few explicit emotion words
  if (/[？?]/.test(text)) return EMOTION_BY_KEY.curious;
  if (/[！!]/.test(text)) return EMOTION_BY_KEY.joy;
  if (mbti.includes('NF')) return EMOTION_BY_KEY.warm;
  if (mbti.includes('NT')) return EMOTION_BY_KEY.calm;
  if (mbti.includes('EP') || mbti.includes('EN')) return EMOTION_BY_KEY.joy;
  return EMOTION_BY_KEY.warm;
}

function analyzeDialogueEmotions(
  messages: ChatMessage[],
  doll: DollDetail
): {
  points: EmotionBrushPoint[];
  dominant: EmotionSpec;
  summarySpecs: Array<{ spec: EmotionSpec; count: number }>;
  isInitial: boolean;
} {
  const aiMessages = messages.filter(
    (m) => m.role === 'assistant' && m.status === 'completed' && m.content.trim().length > 0
  );

  if (aiMessages.length === 0) {
    const initialSpec = detectLineEmotion(doll.persona.openingLine, doll.persona.mbti);
    const companionKey: EmotionKey =
      initialSpec.key === 'warm' ? 'curious' : 'warm';
    const companionSpec = EMOTION_BY_KEY[companionKey];
    return {
      points: [
        {
          id: 'opening_0',
          emotion: initialSpec,
          snippet: compactPhrase(doll.persona.openingLine, 22),
          turnLabel: '初遇扉页',
          shapeVariant: 0,
        },
        {
          id: 'opening_1',
          emotion: companionSpec,
          snippet: `${doll.persona.name} · ${doll.persona.mbti}`,
          turnLabel: '人格底色',
          shapeVariant: 1,
        },
      ],
      dominant: initialSpec,
      summarySpecs: [{ spec: initialSpec, count: 1 }],
      isInitial: true,
    };
  }

  const recentSlice = aiMessages.slice(-5);
  const startTurnNumber = Math.max(1, aiMessages.length - recentSlice.length + 1);
  const counts = new Map<EmotionKey, number>();

  const points: EmotionBrushPoint[] = recentSlice.map((msg, idx) => {
    const spec = detectLineEmotion(msg.content, doll.persona.mbti);
    counts.set(spec.key, (counts.get(spec.key) ?? 0) + 1);
    return {
      id: msg.id,
      emotion: spec,
      snippet: compactPhrase(msg.content, 24),
      turnLabel: `第 ${startTurnNumber + idx} 轮`,
      shapeVariant: (idx % 3) as 0 | 1 | 2,
    };
  });

  const summarySpecs = Array.from(counts.entries())
    .sort((a, b) => b[1] - a[1])
    .map(([key, count]) => ({ spec: EMOTION_BY_KEY[key], count }));

  // Tie-break toward the most recent reply's emotion
  const latestSpec = points[points.length - 1].emotion;
  const topCount = summarySpecs[0]?.count ?? 1;
  const latestCount = counts.get(latestSpec.key) ?? 0;
  const dominant = latestCount >= topCount ? latestSpec : summarySpecs[0].spec;

  return {
    points,
    dominant,
    summarySpecs,
    isInitial: false,
  };
}

/**
 * Hand-crafted organic watercolor brushstroke dab SVG.
 * Renders a layered translucent pigment wash with soft outer bleed and richer center core.
 */
function WatercolorBrushDot({
  emotion,
  variant = 0,
  size = 16,
  active = false,
}: {
  emotion: EmotionSpec;
  variant?: 0 | 1 | 2;
  size?: number;
  active?: boolean;
}) {
  const outerPaths: readonly [string, string, string] = [
    'M12.2 2.4 C17.6 1.8, 22.1 6.3, 21.6 11.9 C21.1 17.5, 16.4 22.1, 10.8 21.5 C5.2 20.9, 1.9 16.2, 2.5 10.6 C3.1 5.0, 7.6 2.9, 12.2 2.4 Z',
    'M10.4 2.2 C16.3 1.9, 21.9 5.5, 22.0 11.4 C22.1 17.3, 17.6 21.8, 11.8 21.9 C6.0 22.0, 2.1 17.4, 2.3 11.6 C2.5 5.8, 5.4 2.5, 10.4 2.2 Z',
    'M13.1 2.5 C18.5 3.1, 22.2 7.8, 21.3 13.2 C20.4 18.6, 15.6 22.2, 10.2 21.4 C4.8 20.6, 1.8 15.8, 2.8 10.4 C3.8 5.0, 8.2 1.9, 13.1 2.5 Z',
  ];
  const innerPaths: readonly [string, string, string] = [
    'M11.8 5.6 C15.6 5.2, 18.4 8.2, 18.0 11.9 C17.6 15.6, 14.5 18.4, 10.8 18.0 C7.1 17.6, 5.2 14.5, 5.7 10.9 C6.2 7.3, 8.4 6.0, 11.8 5.6 Z',
    'M11.2 5.4 C15.1 5.3, 18.5 7.9, 18.4 11.7 C18.3 15.5, 15.2 18.3, 11.4 18.2 C7.6 18.1, 5.3 15.1, 5.6 11.4 C5.9 7.7, 7.8 5.5, 11.2 5.4 Z',
    'M12.4 5.8 C16.0 6.2, 18.4 9.2, 17.7 12.7 C17.0 16.2, 13.9 18.5, 10.4 17.8 C6.9 17.1, 5.2 14.0, 6.0 10.5 C6.8 7.0, 9.2 5.4, 12.4 5.8 Z',
  ];

  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      aria-hidden="true"
      className={`shrink-0 transition-transform duration-200 ${active ? 'scale-115' : ''}`}
      style={{
        filter: active
          ? `drop-shadow(0 2px 5px ${emotion.coreHex}55)`
          : `drop-shadow(0 1px 2px ${emotion.coreHex}30)`,
      }}
    >
      {/* Translucent wet-edge outer watercolor bloom */}
      <path d={outerPaths[variant]} fill={emotion.washHex} fillOpacity="0.62" />
      {/* Richer organic brush pigment body */}
      <path d={innerPaths[variant]} fill={emotion.coreHex} fillOpacity="0.82" />
      {/* Delicate wet-paper edge accent */}
      <path
        d={outerPaths[variant]}
        stroke={emotion.rimHex}
        strokeOpacity={active ? '0.58' : '0.28'}
        strokeWidth={active ? '1.15' : '0.75'}
      />
      {/* Tiny sunlit specular highlight inside pigment */}
      <ellipse cx="9.6" cy="9.2" rx="2.1" ry="1.3" fill="#FFFFFF" fillOpacity="0.34" />
    </svg>
  );
}

const MEMORY_CATEGORY_MAP: Record<string, string> = {
  user_nickname: '称呼',
  doll_name: '昵称',
  persona: '人格',
  accessories: '配饰',
  fact: '约定',
};

function compactPhrase(raw: string, maxLen = 11): string {
  const cleaned = raw
    .replace(/^(记住|请记住|记得|帮我记住)[：:\s]*/u, '')
    .replace(/[。！？!?；;，,、]+$/u, '')
    .trim();
  if (!cleaned) return '';
  return cleaned.length > maxLen ? `${cleaned.slice(0, maxLen)}…` : cleaned;
}

function extractSharedKeywords(doll: DollDetail, memories: MemoryItem[]): SnapshotKeyword[] {
  const seen = new Set<string>();
  const result: SnapshotKeyword[] = [];

  const pushUnique = (item: SnapshotKeyword) => {
    const key = item.label.toLowerCase();
    if (!item.label || seen.has(key)) return;
    seen.add(key);
    result.push(item);
  };

  const priorityOrder: Record<string, number> = {
    user_nickname: 1,
    fact: 2,
    accessories: 3,
    doll_name: 4,
    persona: 5,
  };

  const sortedMemories = [...memories].sort((a, b) => {
    const pa = priorityOrder[a.type] ?? 6;
    const pb = priorityOrder[b.type] ?? 6;
    if (pa !== pb) return pa - pb;
    return new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime();
  });

  for (const m of sortedMemories) {
    const category = MEMORY_CATEGORY_MAP[m.type] || '记忆';
    if (m.type === 'accessories') {
      const parts = m.value
        .split(/[、,，/]+/)
        .map((s) => compactPhrase(s, 9))
        .filter(Boolean);
      for (const part of parts.slice(0, 3)) {
        pushUnique({
          id: `${m.id}_${part}`,
          label: part,
          category,
          isUserDefined: true,
        });
      }
      continue;
    }

    const label = compactPhrase(m.value, m.type === 'user_nickname' ? 8 : 11);
    if (label) {
      pushUnique({
        id: m.id,
        label,
        category,
        isUserDefined: true,
      });
    }
  }

  if (result.length < 3) {
    pushUnique({
      id: 'persona_mbti',
      label: `${doll.persona.mbti} ${doll.persona.name}`,
      category: '人格',
      isUserDefined: false,
    });
    if (doll.persona.materialHint) {
      pushUnique({
        id: 'persona_material',
        label: compactPhrase(doll.persona.materialHint, 10),
        category: '手作',
        isUserDefined: false,
      });
    }
  }

  return result;
}

function extractRecentMemoir(
  messages: ChatMessage[],
  keywords: SnapshotKeyword[]
): {
  exchanges: DialogueExchange[];
  totalCompletedTurns: number;
  highlightKeyword: string | null;
} {
  const completed = messages.filter(
    (m) => m.status === 'completed' && m.content.trim().length > 0
  );

  const grouped = new Map<string, { user?: ChatMessage; assistant?: ChatMessage }>();
  const order: string[] = [];

  for (const msg of completed) {
    const key = msg.clientMessageId || msg.id;
    if (!grouped.has(key)) {
      grouped.set(key, {});
      order.push(key);
    }
    const entry = grouped.get(key)!;
    if (msg.role === 'user') entry.user = msg;
    if (msg.role === 'assistant') entry.assistant = msg;
  }

  const userKeywordNeedles = keywords
    .filter((k) => k.isUserDefined)
    .map((k) => k.label.replace(/…$/, ''))
    .filter((s) => s.length >= 2);

  const allExchanges: DialogueExchange[] = [];
  for (const key of order) {
    const pair = grouped.get(key);
    if (!pair?.assistant) continue;
    const combinedText = `${pair.user?.content ?? ''} ${pair.assistant.content}`;
    let matchedKeyword: string | null = null;
    for (const needle of userKeywordNeedles) {
      if (combinedText.includes(needle)) {
        matchedKeyword = needle;
        break;
      }
    }
    if (!matchedKeyword && pair.user?.content && /记住|记得|约好|喜欢/.test(pair.user.content)) {
      matchedKeyword = '共同约定';
    }

    allExchanges.push({
      id: pair.assistant.id,
      userLine: pair.user?.content ?? null,
      dollLine: pair.assistant.content,
      createdAt: pair.assistant.createdAt,
      matchedKeyword,
    });
  }

  if (allExchanges.length === 0) {
    return { exchanges: [], totalCompletedTurns: 0, highlightKeyword: null };
  }

  let keyIdx = -1;
  for (let i = allExchanges.length - 1; i >= 0; i -= 1) {
    if (allExchanges[i].matchedKeyword) {
      keyIdx = i;
      break;
    }
  }

  let selected: DialogueExchange[];
  if (keyIdx !== -1) {
    const start = Math.max(0, keyIdx - 1);
    selected = allExchanges.slice(start, keyIdx + 1);
  } else {
    selected = allExchanges.slice(-2);
  }

  const highlightKeyword =
    selected[selected.length - 1]?.matchedKeyword || selected[0]?.matchedKeyword || null;

  return {
    exchanges: selected,
    totalCompletedTurns: allExchanges.length,
    highlightKeyword,
  };
}

function formatMemoirTime(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return '刚刚';
  const month = date.getMonth() + 1;
  const day = date.getDate();
  const hh = String(date.getHours()).padStart(2, '0');
  const mm = String(date.getMinutes()).padStart(2, '0');
  return `${month}月${day}日 ${hh}:${mm}`;
}

export function ChatMemorySnapshot({
  doll,
  memories,
  messages,
  speakingId,
  onSpeakExcerpt,
  onOpenRememberComposer,
}: ChatMemorySnapshotProps) {
  const [expanded, setExpanded] = useState(false);
  const [focusedPointId, setFocusedPointId] = useState<string | null>(null);

  const keywords = useMemo(() => extractSharedKeywords(doll, memories), [doll, memories]);
  const memoir = useMemo(() => extractRecentMemoir(messages, keywords), [messages, keywords]);
  const emotionProfile = useMemo(
    () => analyzeDialogueEmotions(messages, doll),
    [messages, doll]
  );

  const previewKeywords = keywords.slice(0, 3);
  const previewBrushPoints = emotionProfile.points.slice(-3);
  const activePoint =
    emotionProfile.points.find((p) => p.id === focusedPointId) ??
    emotionProfile.points[emotionProfile.points.length - 1];

  const latestExchange = memoir.exchanges[memoir.exchanges.length - 1] ?? null;
  const memoirVoiceId = latestExchange ? `memoir_${latestExchange.id}` : 'memoir_opening';
  const isSpeakingMemoir = speakingId === memoirVoiceId;

  return (
    <div className="relative z-10 border-b border-[#EAE1D3]/85 bg-[#FFFDF9]/74 backdrop-blur-md">
      {/* Compact Top Snapshot Ribbon — Shared Keywords + Watercolor Emotion Preview */}
      <button
        type="button"
        onClick={() => {
          haptic('selection');
          setExpanded((v) => !v);
        }}
        aria-expanded={expanded}
        aria-label={
          expanded
            ? '收起记忆快照与关键对话回忆录'
            : `展开记忆快照，当前对话氛围：${emotionProfile.dominant.label}`
        }
        className="w-full px-4 sm:px-5 py-2.5 flex items-center justify-between gap-2.5 text-left transition-colors hover:bg-[#FAF5EC]/60 active:bg-[#F4EDE1]/70 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-[#4A8276]/40"
      >
        <div className="flex items-center gap-2 min-w-0 flex-1">
          <span className="inline-flex items-center gap-1.5 shrink-0 text-[#356B5F]">
            <BookOpen className="w-3.5 h-3.5" strokeWidth={1.85} />
            <span className="font-editorial text-[12px] font-semibold tracking-wide text-[#382A22]">
              记忆快照
            </span>
          </span>

          <span className="text-[#D4C7B5] shrink-0" aria-hidden="true">
            |
          </span>

          {/* Clean unboxed co-defined keywords */}
          <div className="min-w-0 flex-1 flex items-center gap-1.5 text-[11.5px] text-[#6E5C50] truncate">
            {previewKeywords.map((kw, idx) => (
              <span key={kw.id} className="inline-flex items-center gap-1.5 min-w-0 shrink-0">
                {idx > 0 && (
                  <span className="text-[#C8B9A6]" aria-hidden="true">
                    ·
                  </span>
                )}
                <span
                  className={
                    kw.isUserDefined
                      ? 'text-[#382A22] font-medium border-b border-[#4A8276]/35 pb-[1px]'
                      : 'text-[#8C7A6B]'
                  }
                >
                  {kw.label}
                </span>
              </span>
            ))}
            {keywords.length > previewKeywords.length && (
              <span className="text-[10.5px] font-mono tabular-nums text-[#9A887B] shrink-0">
                +{keywords.length - previewKeywords.length}
              </span>
            )}
          </div>
        </div>

        {/* Right: Watercolor Brushstroke Emotion Swatch Preview + Disclosure Chevron */}
        <div className="inline-flex items-center gap-2 shrink-0">
          <span
            className="inline-flex items-center gap-1"
            title={`近期氛围：${emotionProfile.dominant.label}（${emotionProfile.dominant.atmosphereHint}）`}
          >
            <span className="inline-flex items-center -space-x-1.5">
              {previewBrushPoints.map((pt) => (
                <WatercolorBrushDot
                  key={pt.id}
                  emotion={pt.emotion}
                  variant={pt.shapeVariant}
                  size={15}
                />
              ))}
            </span>
            <span
              className="text-[11px] font-medium whitespace-nowrap"
              style={{ color: emotionProfile.dominant.textColor }}
            >
              {emotionProfile.dominant.label}
            </span>
          </span>

          <ChevronDown
            className={`w-3.5 h-3.5 text-[#4A8276] transition-transform duration-250 ${
              expanded ? 'rotate-180' : ''
            }`}
          />
        </div>
      </button>

      {/* Expandable Archival Key Dialogue Memoir Slip */}
      <AnimatePresence initial={false}>
        {expanded && (
          <motion.div
            key="memoir-drawer"
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: 'auto', opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.28, ease: [0.22, 1, 0.36, 1] }}
            className="overflow-hidden"
          >
            <div className="px-4 sm:px-5 pb-4 pt-1 space-y-3.5">
              {/* Heirloom Stationery Memoir Slip */}
              <div className="rounded-[18px] p-3.5 sm:p-4 bg-[#FAF6EE]/92 border border-[#E5DBC9] shadow-[inset_0_1px_0_rgba(255,255,255,0.85),0_6px_18px_-10px_rgba(56,42,34,0.14)] space-y-3">
                {/* Memoir Header */}
                <div className="flex flex-wrap items-center justify-between gap-2 pb-2 border-b border-[#EAE0D0]">
                  <div className="flex items-center gap-2 min-w-0">
                    <span className="font-editorial text-[13px] font-semibold text-[#382A22]">
                      最近关键对话回忆录
                    </span>
                    {memoir.highlightKeyword && (
                      <>
                        <span className="text-[#C8B9A6]" aria-hidden="true">
                          ·
                        </span>
                        <span className="text-[11px] text-[#356B5F] font-medium truncate">
                          关键词「{memoir.highlightKeyword}」
                        </span>
                      </>
                    )}
                  </div>

                  <div className="flex items-center gap-2.5 text-[11px] text-[#968477]">
                    {latestExchange ? (
                      <span className="font-mono tabular-nums">
                        {formatMemoirTime(latestExchange.createdAt)}
                      </span>
                    ) : (
                      <span className="font-atelier-num italic text-[12.5px]">First Page</span>
                    )}
                    {onSpeakExcerpt && (
                      <button
                        type="button"
                        onClick={() => {
                          haptic('light');
                          const line = latestExchange
                            ? latestExchange.dollLine
                            : doll.persona.openingLine;
                          onSpeakExcerpt(memoirVoiceId, line);
                        }}
                        className={`inline-flex items-center gap-1 text-[11px] font-medium transition-colors ${
                          isSpeakingMemoir
                            ? 'text-[#2D6257]'
                            : 'text-[#6E5C50] hover:text-[#356B5F]'
                        }`}
                      >
                        <Volume2 className="w-3.5 h-3.5" />
                        <span>{isSpeakingMemoir ? '轻语中' : '轻听'}</span>
                      </button>
                    )}
                  </div>
                </div>

                {/* Watercolor Emotion Swatch Bar — Interactive Brushstroke Trace */}
                <div className="rounded-2xl px-3 py-2.5 bg-[#FFFDF9]/82 border border-[#EAE1D2]/90 space-y-2">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <div className="flex items-center gap-1.5 text-[11px]">
                      <span className="text-[#8E7C6E]">
                        {emotionProfile.isInitial ? '初遇氛围色盘' : '近期情感笔触'}
                      </span>
                      <span className="text-[#D2C4B0]" aria-hidden="true">
                        ·
                      </span>
                      <span
                        className="font-medium"
                        style={{ color: emotionProfile.dominant.textColor }}
                      >
                        {emotionProfile.dominant.label}（{emotionProfile.dominant.atmosphereHint}）
                      </span>
                    </div>

                    {/* Interactive sequence of organic watercolor brushstroke dots */}
                    <div
                      className="inline-flex items-center gap-1"
                      role="group"
                      aria-label="近期对话情感水彩笔触点"
                    >
                      {emotionProfile.points.map((pt) => {
                        const isFocused = activePoint?.id === pt.id;
                        return (
                          <button
                            key={pt.id}
                            type="button"
                            onClick={() => {
                              haptic('selection');
                              setFocusedPointId(pt.id);
                            }}
                            aria-label={`${pt.turnLabel}：${pt.emotion.label}`}
                            aria-pressed={isFocused}
                            className="p-0.5 rounded-full focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#4A8276]/40"
                          >
                            <WatercolorBrushDot
                              emotion={pt.emotion}
                              variant={pt.shapeVariant}
                              size={20}
                              active={isFocused}
                            />
                          </button>
                        );
                      })}
                    </div>
                  </div>

                  {/* Focused brushstroke note + subtle palette legend */}
                  {activePoint && (
                    <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1 text-[11px] text-[#7D6C5F] pt-1 border-t border-[#F1E8DA]">
                      <div className="min-w-0 truncate">
                        <span
                          className="font-medium mr-1.5"
                          style={{ color: activePoint.emotion.textColor }}
                        >
                          {activePoint.turnLabel} · {activePoint.emotion.label}
                        </span>
                        <span className="text-[#8E7C6E]">“{activePoint.snippet}”</span>
                      </div>
                      <div className="flex items-center gap-2 shrink-0 text-[10.5px] text-[#968477]">
                        {emotionProfile.summarySpecs.slice(0, 3).map(({ spec, count }) => (
                          <span key={spec.key} className="inline-flex items-center gap-1">
                            <WatercolorBrushDot emotion={spec} variant={0} size={11} />
                            <span>
                              {spec.label}
                              {emotionProfile.points.length > 1 && !emotionProfile.isInitial
                                ? ` ${count}`
                                : ''}
                            </span>
                          </span>
                        ))}
                      </div>
                    </div>
                  )}
                </div>

                {/* Dialogue Excerpt Body */}
                {memoir.exchanges.length > 0 ? (
                  <div className="space-y-2.5">
                    {memoir.exchanges.map((ex) => (
                      <div key={ex.id} className="space-y-1.5 text-[12.5px] leading-relaxed">
                        {ex.userLine && (
                          <div className="flex items-baseline gap-2 text-[#6E5C50]">
                            <span className="text-[10.5px] font-medium text-[#4A8276] shrink-0">
                              你
                            </span>
                            <p className="line-clamp-2 break-words">{ex.userLine}</p>
                          </div>
                        )}
                        <div className="flex items-baseline gap-2 text-[#382A22]">
                          <span className="text-[10.5px] font-editorial font-semibold text-[#8E6942] shrink-0">
                            {doll.name}
                          </span>
                          <p className="font-editorial line-clamp-3 break-words">
                            “{ex.dollLine}”
                          </p>
                        </div>
                      </div>
                    ))}
                  </div>
                ) : (
                  <blockquote className="atelier-pullquote px-3 py-2.5 text-[12.5px] leading-relaxed text-[#4B3B31]">
                    <span className="font-editorial">“{doll.persona.openingLine}”</span>
                    <div className="text-[11px] text-[#8E7C6E] mt-1">
                      你们还没有对话记录，发出一句问候或写下约定，这里会自动收录最近的关键对话回忆。
                    </div>
                  </blockquote>
                )}

                {/* Co-defined Keywords Full Ledger + Quick Add Action */}
                <div className="pt-2.5 border-t border-[#EAE0D0] flex flex-wrap items-center justify-between gap-2">
                  <div className="flex flex-wrap items-center gap-x-2.5 gap-y-1 text-[11px] text-[#7D6C5F]">
                    <span className="text-[#968477]">共同关键词：</span>
                    {keywords.slice(0, 6).map((kw, idx) => (
                      <span key={kw.id} className="inline-flex items-center gap-1">
                        {idx > 0 && (
                          <span className="text-[#D2C4B0] mr-1" aria-hidden="true">
                            /
                          </span>
                        )}
                        <span className="text-[#968477]">{kw.category}</span>
                        <span className="text-[#382A22] font-medium">{kw.label}</span>
                      </span>
                    ))}
                  </div>

                  {onOpenRememberComposer && (
                    <button
                      type="button"
                      onClick={() => {
                        haptic('light');
                        setExpanded(false);
                        onOpenRememberComposer();
                      }}
                      className="inline-flex items-center gap-1 text-[11px] font-medium text-[#356B5F] hover:text-[#234B42] transition-colors whitespace-nowrap shrink-0"
                    >
                      <BookmarkPlus className="w-3.5 h-3.5" />
                      <span>记下新约定</span>
                    </button>
                  )}
                </div>
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
