import { useEffect, useMemo, useState } from 'react';
import { AnimatePresence, motion } from 'motion/react';
import { MessageCircle, Sparkles } from 'lucide-react';
import { api } from '../lib/api';
import type { ChatMessage, MemoryItem } from '../lib/types';
import { haptic } from '../lib/haptics';

type EmotionKey = 'healing' | 'joy' | 'calm' | 'curious' | 'reflect';

interface EmotionMeta {
  key: EmotionKey;
  label: string;
  color: string;
  softBg: string;
  keywords: readonly string[];
}

const EMOTIONS: readonly EmotionMeta[] = [
  {
    key: 'healing',
    label: '温暖治愈',
    color: '#5B9A8B',
    softBg: '#EAF5F1',
    keywords: ['温暖', '治愈', '谢谢', '安心', '放松', '温柔', '抱抱', '茶', '陪', '喜欢', '舒服', '加油', '晚安'],
  },
  {
    key: 'joy',
    label: '明朗欢喜',
    color: '#D8A24A',
    softBg: '#FBF4E4',
    keywords: ['开心', '高兴', '哈哈', '太好了', '棒', '快乐', '喜欢', '晴', '惊喜', '发现', '好玩', '庆祝', '耶'],
  },
  {
    key: 'calm',
    label: '安静陪伴',
    color: '#88A6B8',
    softBg: '#EEF4F7',
    keywords: ['安静', '慢慢', '休息', '微风', '发呆', '云', '雨', '平淡', '日常', '喝水', '散步', '早安', '今天'],
  },
  {
    key: 'curious',
    label: '灵动好奇',
    color: '#D48A72',
    softBg: '#FBF0EB',
    keywords: ['为什么', '怎么', '想法', '灵感', '试试', '打算', '计划', '如果', '好奇', '主意', '设计', '创作', '？', '?'],
  },
  {
    key: 'reflect',
    label: '倾诉释怀',
    color: '#9F8BC2',
    softBg: '#F4F0FA',
    keywords: ['累', '烦', '焦虑', '压力', '难过', '纠结', '担心', '迷茫', '叹气', '辛苦', '委屈', '忙', '不想'],
  },
] as const;

const DIARY_MOOD_TO_EMOTION: Record<string, EmotionKey> = {
  sunny: 'joy',
  breeze: 'calm',
  cozy: 'healing',
  dreamy: 'reflect',
  spark: 'curious',
};

const DIARY_MOODS_STORAGE_KEY = 'nutshell_diary_moods_v1';

interface DayPoint {
  dateKey: string;
  shortLabel: string;
  isToday: boolean;
  dialogues: number;
  interactions: number;
  emotions: Record<EmotionKey, number>;
  dominantEmotion: EmotionKey;
}

interface GrowthAnalytics {
  days: DayPoint[];
  totalDialogues: number;
  totalInteractions: number;
  avgPerActiveDay: string;
  memoryCount: number;
  emotionShares: Array<{ meta: EmotionMeta; count: number; percent: number }>;
  dominant: EmotionMeta;
  hasRealChats: boolean;
}

function toDateKey(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

function emptyEmotionCounts(): Record<EmotionKey, number> {
  return { healing: 0, joy: 0, calm: 0, curious: 0, reflect: 0 };
}

function defaultEmotionForMbti(mbti: string): EmotionKey {
  const code = (mbti || '').toUpperCase();
  if (code.startsWith('ENF') || code.startsWith('ESF')) return 'joy';
  if (code.startsWith('INF') || code.startsWith('ISF')) return 'healing';
  if (code.startsWith('ENT') || code.startsWith('EST')) return 'curious';
  if (code.startsWith('INT') || code.startsWith('IST')) return 'calm';
  return 'healing';
}

function classifyMessageEmotion(content: string, fallback: EmotionKey): EmotionKey {
  const text = content || '';
  let bestKey: EmotionKey = fallback;
  let bestScore = 0;

  for (const emo of EMOTIONS) {
    let score = 0;
    for (const kw of emo.keywords) {
      if (text.includes(kw)) score += 1;
    }
    if (score > bestScore) {
      bestScore = score;
      bestKey = emo.key;
    }
  }
  return bestKey;
}

function loadDiaryMoods(): Record<string, string> {
  if (typeof window === 'undefined') return {};
  try {
    const raw = window.localStorage.getItem(DIARY_MOODS_STORAGE_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === 'object' ? (parsed as Record<string, string>) : {};
  } catch {
    return {};
  }
}

function pickDominantEmotion(counts: Record<EmotionKey, number>, fallback: EmotionKey): EmotionKey {
  let best: EmotionKey = fallback;
  let max = 0;
  for (const emo of EMOTIONS) {
    if (counts[emo.key] > max) {
      max = counts[emo.key];
      best = emo.key;
    }
  }
  return best;
}

function buildGrowthAnalytics(
  messages: ChatMessage[],
  memories: MemoryItem[],
  dollCreatedAt: string,
  mbti: string,
  voiceTagUpdatedAt?: string
): GrowthAnalytics {
  const fallbackEmotion = defaultEmotionForMbti(mbti);
  const diaryMoods = loadDiaryMoods();

  const now = new Date();
  const days: DayPoint[] = [];
  const dayMap = new Map<string, DayPoint>();

  for (let offset = 6; offset >= 0; offset -= 1) {
    const d = new Date(now.getFullYear(), now.getMonth(), now.getDate() - offset);
    const key = toDateKey(d);
    const point: DayPoint = {
      dateKey: key,
      shortLabel: offset === 0 ? '今日' : `${d.getMonth() + 1}/${d.getDate()}`,
      isToday: offset === 0,
      dialogues: 0,
      interactions: 0,
      emotions: emptyEmotionCounts(),
      dominantEmotion: fallbackEmotion,
    };
    days.push(point);
    dayMap.set(key, point);
  }

  let totalDialogues = 0;
  const totalEmotions = emptyEmotionCounts();

  // Count real user messages as dialogue turns and classify emotion from both user + assistant messages
  for (const msg of messages) {
    const d = new Date(msg.createdAt);
    const key = Number.isNaN(d.getTime()) ? days[6].dateKey : toDateKey(d);
    const bucket = dayMap.get(key);
    const emo = classifyMessageEmotion(msg.content, fallbackEmotion);

    if (msg.role === 'user') {
      totalDialogues += 1;
      totalEmotions[emo] += 1;
      if (bucket) {
        bucket.dialogues += 1;
        bucket.interactions += 2;
        bucket.emotions[emo] += 1;
      }
    } else if (msg.role === 'assistant' && msg.content.trim()) {
      totalEmotions[emo] += 0.5;
      if (bucket) {
        bucket.interactions += 1;
        bucket.emotions[emo] += 0.5;
      }
    }
  }

  // Count memory entries & voice tag edits as real companion interactions
  for (const mem of memories) {
    const d = new Date(mem.createdAt);
    if (!Number.isNaN(d.getTime())) {
      const bucket = dayMap.get(toDateKey(d));
      if (bucket) {
        bucket.interactions += 1;
        bucket.emotions.healing += 0.5;
        totalEmotions.healing += 0.5;
      }
    }
  }

  if (voiceTagUpdatedAt) {
    const d = new Date(voiceTagUpdatedAt);
    if (!Number.isNaN(d.getTime())) {
      const bucket = dayMap.get(toDateKey(d));
      if (bucket) {
        bucket.interactions += 1;
        bucket.emotions.curious += 0.5;
        totalEmotions.curious += 0.5;
      }
    }
  }

  // Include doll creation milestone if within 7-day window
  const created = new Date(dollCreatedAt);
  if (!Number.isNaN(created.getTime())) {
    const bucket = dayMap.get(toDateKey(created));
    if (bucket && bucket.interactions === 0) {
      bucket.interactions += 1;
      bucket.emotions[fallbackEmotion] += 0.5;
    }
  }

  // Blend in user's NutShell Diary moods for days within window
  for (const day of days) {
    const diaryMood = diaryMoods[day.dateKey];
    if (diaryMood && DIARY_MOOD_TO_EMOTION[diaryMood]) {
      const mapped = DIARY_MOOD_TO_EMOTION[diaryMood];
      day.emotions[mapped] += 0.8;
      totalEmotions[mapped] += 0.8;
      if (day.interactions === 0) {
        day.interactions += 0.6;
      }
    }
    day.dominantEmotion = pickDominantEmotion(day.emotions, fallbackEmotion);
  }

  // Ensure emotion distribution always renders gracefully even on a brand-new doll
  const rawTotalEmo = Object.values(totalEmotions).reduce((a, b) => a + b, 0);
  if (rawTotalEmo === 0) {
    totalEmotions[fallbackEmotion] = 1;
  }

  const finalTotalEmo = Object.values(totalEmotions).reduce((a, b) => a + b, 0);
  const emotionShares = EMOTIONS.map((meta) => {
    const count = totalEmotions[meta.key];
    return {
      meta,
      count,
      percent: finalTotalEmo > 0 ? Math.round((count / finalTotalEmo) * 100) : 0,
    };
  })
    .filter((e) => e.count > 0)
    .sort((a, b) => b.count - a.count);

  const totalInteractions = Math.round(days.reduce((sum, d) => sum + d.interactions, 0));
  const activeDays = days.filter((d) => d.interactions > 0).length;
  const avgPerActiveDay = activeDays > 0 ? (totalInteractions / activeDays).toFixed(1) : '0.0';
  const dominant = emotionShares[0]?.meta || EMOTIONS[0];

  return {
    days,
    totalDialogues,
    totalInteractions,
    avgPerActiveDay,
    memoryCount: memories.length,
    emotionShares,
    dominant,
    hasRealChats: totalDialogues > 0,
  };
}

/**
 * Generates a smooth SVG cubic bezier path through data coordinates.
 */
function buildSmoothSplinePath(pts: Array<{ x: number; y: number }>): string {
  if (pts.length === 0) return '';
  if (pts.length === 1) return `M ${pts[0].x} ${pts[0].y}`;
  let d = `M ${pts[0].x.toFixed(1)} ${pts[0].y.toFixed(1)}`;
  for (let i = 0; i < pts.length - 1; i += 1) {
    const p0 = pts[Math.max(0, i - 1)];
    const p1 = pts[i];
    const p2 = pts[i + 1];
    const p3 = pts[Math.min(pts.length - 1, i + 2)];

    const cp1x = p1.x + (p2.x - p0.x) / 6;
    const cp1y = p1.y + (p2.y - p0.y) / 6;
    const cp2x = p2.x - (p3.x - p1.x) / 6;
    const cp2y = p2.y - (p3.y - p1.y) / 6;

    d += ` C ${cp1x.toFixed(1)} ${cp1y.toFixed(1)}, ${cp2x.toFixed(1)} ${cp2y.toFixed(1)}, ${p2.x.toFixed(1)} ${p2.y.toFixed(1)}`;
  }
  return d;
}

interface DollGrowthCurveProps {
  dollId: string;
  dollName: string;
  mbti: string;
  createdAt: string;
  canFetchRemote: boolean;
  voiceTagUpdatedAt?: string;
  onStartChat?: () => void;
}

export function DollGrowthCurve({
  dollId,
  dollName,
  mbti,
  createdAt,
  canFetchRemote,
  voiceTagUpdatedAt,
  onStartChat,
}: DollGrowthCurveProps) {
  const [loading, setLoading] = useState(canFetchRemote);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [memories, setMemories] = useState<MemoryItem[]>([]);
  const [viewMode, setViewMode] = useState<'trend' | 'emotion'>('trend');
  const [selectedDayIdx, setSelectedDayIdx] = useState<number>(6);

  useEffect(() => {
    if (!canFetchRemote) {
      setLoading(false);
      return;
    }
    let cancelled = false;
    setLoading(true);
    Promise.all([
      api.getMessages(dollId, 100).catch(() => ({ items: [] as ChatMessage[], nextCursor: null })),
      api.getMemories(dollId).catch(() => [] as MemoryItem[]),
    ])
      .then(([msgRes, memList]) => {
        if (cancelled) return;
        setMessages(msgRes.items);
        setMemories(memList);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [dollId, canFetchRemote]);

  const analytics = useMemo(
    () => buildGrowthAnalytics(messages, memories, createdAt, mbti, voiceTagUpdatedAt),
    [messages, memories, createdAt, mbti, voiceTagUpdatedAt]
  );

  const selectedDay = analytics.days[selectedDayIdx] || analytics.days[6];
  const selectedEmoMeta =
    EMOTIONS.find((e) => e.key === selectedDay.dominantEmotion) || EMOTIONS[0];

  // SVG chart geometry (viewBox 292 x 104)
  const chartW = 292;
  const chartH = 104;
  const padX = 18;
  const padTop = 16;
  const padBottom = 22;
  const plotH = chartH - padTop - padBottom;
  const stepX = (chartW - padX * 2) / Math.max(1, analytics.days.length - 1);

  const maxInteraction = Math.max(
    4,
    ...analytics.days.map((d) => Math.ceil(d.interactions))
  );
  const maxDialogue = Math.max(2, ...analytics.days.map((d) => d.dialogues));

  const curvePts = analytics.days.map((d, idx) => {
    const x = padX + idx * stepX;
    const ratio = d.interactions / maxInteraction;
    const y = padTop + plotH - ratio * (plotH - 6);
    return { x, y, day: d };
  });

  const linePath = buildSmoothSplinePath(curvePts);
  const baseY = padTop + plotH;
  const areaPath =
    curvePts.length > 0
      ? `${linePath} L ${curvePts[curvePts.length - 1].x.toFixed(1)} ${baseY} L ${curvePts[0].x.toFixed(1)} ${baseY} Z`
      : '';

  if (loading) {
    return (
      <div className="mt-2.5 p-3 rounded-2xl bg-white/80 border border-[#E7DEC8]/90 space-y-2.5">
        <div className="grid grid-cols-3 gap-2">
          {[0, 1, 2].map((i) => (
            <div key={i} className="h-11 rounded-xl wc-wash" />
          ))}
        </div>
        <div className="h-24 rounded-xl wc-wash" />
      </div>
    );
  }

  return (
    <div className="mt-2.5 p-3 rounded-2xl bg-[#FFFEFC]/92 border border-[#E6DDD0] shadow-[inset_0_1px_0_rgba(255,255,255,0.95)] space-y-3">
      {/* Header Row: Title + Compact 2-Mode Switch */}
      <div className="flex items-center justify-between gap-2">
        <div className="inline-flex items-center gap-1.5 min-w-0">
          <Sparkles className="w-3.5 h-3.5 text-[#4A8276] shrink-0" />
          <span className="font-editorial text-[12.5px] font-semibold text-[#382A22] truncate">
            {dollName}的成长曲线
          </span>
        </div>

        <div className="inline-flex items-center p-0.5 rounded-full bg-[#F3EDE3] border border-[#E8DFD1] shrink-0">
          {(
            [
              { key: 'trend', label: '互动频率' },
              { key: 'emotion', label: '情感分布' },
            ] as const
          ).map((tab) => {
            const active = viewMode === tab.key;
            return (
              <button
                key={tab.key}
                type="button"
                onClick={() => {
                  haptic('selection');
                  setViewMode(tab.key);
                }}
                className={`relative px-2.5 py-0.5 text-[10.5px] font-medium rounded-full transition-colors ${
                  active ? 'text-[#28584D]' : 'text-[#847264] hover:text-[#382A22]'
                }`}
              >
                {active && (
                  <motion.span
                    layoutId={`growth-tab-${dollId}`}
                    transition={{ type: 'spring', stiffness: 460, damping: 34 }}
                    className="absolute inset-0 rounded-full bg-white shadow-[0_1px_3px_rgba(56,42,34,0.1)]"
                  />
                )}
                <span className="relative z-10">{tab.label}</span>
              </button>
            );
          })}
        </div>
      </div>

      {/* 3 Compact Stationery KPI Metrics */}
      <div className="grid grid-cols-3 gap-1.5">
        <div className="px-2.5 py-2 rounded-xl bg-[#FAF7F2] border border-[#EFE7DB]">
          <div className="text-[10px] text-[#9A887B]">对话次数</div>
          <div className="text-[14px] font-semibold font-mono tabular-nums text-[#382A22] mt-0.5">
            {analytics.totalDialogues}
            <span className="text-[10px] font-sans font-normal text-[#8E7B6D] ml-0.5">轮</span>
          </div>
        </div>
        <div className="px-2.5 py-2 rounded-xl bg-[#F3FAF7] border border-[#D8EAE3]">
          <div className="text-[10px] text-[#5C867B]">近7日互动</div>
          <div className="text-[14px] font-semibold font-mono tabular-nums text-[#2B5C51] mt-0.5">
            {analytics.totalInteractions}
            <span className="text-[10px] font-sans font-normal text-[#5C867B] ml-0.5">次</span>
          </div>
        </div>
        <div className="px-2.5 py-2 rounded-xl bg-[#FAF7F2] border border-[#EFE7DB] min-w-0">
          <div className="text-[10px] text-[#9A887B]">主情感倾向</div>
          <div className="inline-flex items-center gap-1 mt-1 max-w-full">
            <span
              className="w-2 h-2 rounded-full shrink-0"
              style={{ backgroundColor: analytics.dominant.color }}
            />
            <span className="text-[11px] font-medium text-[#382A22] truncate">
              {analytics.dominant.label}
            </span>
          </div>
        </div>
      </div>

      {/* Visualization Canvas */}
      <AnimatePresence mode="wait" initial={false}>
        {viewMode === 'trend' ? (
          <motion.div
            key="trend"
            initial={{ opacity: 0, y: 4 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -4 }}
            transition={{ duration: 0.2 }}
            className="space-y-2"
          >
            {/* Active Day Tooltip Strip */}
            <div className="flex items-center justify-between gap-2 px-2.5 py-1.5 rounded-xl bg-[#FAF7F2]/90 border border-[#EFE7DB] text-[10.5px]">
              <div className="flex items-center gap-1.5 text-[#5C4B40] min-w-0">
                <span className="font-mono font-semibold text-[#382A22]">
                  {selectedDay.shortLabel}
                </span>
                <span className="text-[#D4C7B8]" aria-hidden="true">·</span>
                <span className="tabular-nums">对话 {selectedDay.dialogues} 轮</span>
                <span className="text-[#D4C7B8]" aria-hidden="true">·</span>
                <span className="tabular-nums text-[#4A8276]">
                  互动 {Math.round(selectedDay.interactions)} 次
                </span>
              </div>
              <span
                className="inline-flex items-center gap-1 px-1.5 py-[1px] rounded-full text-[10px] font-medium shrink-0"
                style={{
                  backgroundColor: selectedEmoMeta.softBg,
                  color: '#46372D',
                }}
              >
                <span
                  className="w-1.5 h-1.5 rounded-full"
                  style={{ backgroundColor: selectedEmoMeta.color }}
                />
                <span>{selectedEmoMeta.label}</span>
              </span>
            </div>

            {/* Watercolor Spline Curve + Dialogue Bars SVG */}
            <div className="relative rounded-xl bg-[#FDFBF7] border border-[#EFE7DB] px-1 pt-1 pb-0.5">
              <svg
                viewBox={`0 0 ${chartW} ${chartH}`}
                className="w-full h-[108px] overflow-visible select-none"
                role="img"
                aria-label={`${dollName}近7日交互频率与对话次数曲线`}
              >
                <defs>
                  <linearGradient id={`wc-area-${dollId}`} x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor="#4A8276" stopOpacity="0.28" />
                    <stop offset="72%" stopColor="#88C0B2" stopOpacity="0.08" />
                    <stop offset="100%" stopColor="#FAF7F2" stopOpacity="0" />
                  </linearGradient>
                </defs>

                {/* Faint Hand-Ruled Stationery Grid Lines */}
                {[0.25, 0.62, 1].map((ratio, idx) => {
                  const y = padTop + plotH * ratio;
                  return (
                    <line
                      key={idx}
                      x1={padX - 6}
                      x2={chartW - padX + 6}
                      y1={y}
                      y2={y}
                      stroke="#E9E0D3"
                      strokeWidth="0.8"
                      strokeDasharray={idx === 2 ? undefined : '2.5 3.5'}
                    />
                  );
                })}

                {/* Warm Gold Dialogue Count Mini-Bars */}
                {curvePts.map((pt, idx) => {
                  const barH =
                    pt.day.dialogues > 0
                      ? Math.max(6, (pt.day.dialogues / maxDialogue) * (plotH * 0.56))
                      : 0;
                  if (barH <= 0) return null;
                  const active = idx === selectedDayIdx;
                  return (
                    <motion.rect
                      key={`bar-${pt.day.dateKey}`}
                      x={pt.x - 4}
                      width={8}
                      rx={4}
                      initial={{ height: 0, y: baseY }}
                      animate={{ height: barH, y: baseY - barH }}
                      transition={{ duration: 0.45, delay: idx * 0.04, ease: [0.22, 1, 0.36, 1] }}
                      fill="#C9963B"
                      fillOpacity={active ? 0.45 : 0.24}
                    />
                  );
                })}

                {/* Soft Watercolor Area Wash Under Curve */}
                {areaPath && (
                  <motion.path
                    d={areaPath}
                    fill={`url(#wc-area-${dollId})`}
                    initial={{ opacity: 0 }}
                    animate={{ opacity: 1 }}
                    transition={{ duration: 0.55 }}
                  />
                )}

                {/* Animated Botanical Ink Growth Curve */}
                {linePath && (
                  <motion.path
                    d={linePath}
                    fill="none"
                    stroke="#4A8276"
                    strokeWidth="2"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    initial={{ pathLength: 0, opacity: 0.4 }}
                    animate={{ pathLength: 1, opacity: 1 }}
                    transition={{ duration: 0.72, ease: [0.22, 1, 0.36, 1] }}
                  />
                )}

                {/* Interactive Day Nodes + Axis Labels */}
                {curvePts.map((pt, idx) => {
                  const active = idx === selectedDayIdx;
                  return (
                    <g
                      key={pt.day.dateKey}
                      onClick={() => {
                        haptic('selection');
                        setSelectedDayIdx(idx);
                      }}
                      onMouseEnter={() => setSelectedDayIdx(idx)}
                      className="cursor-pointer"
                    >
                      {/* Generous invisible hit area for mobile taps */}
                      <rect
                        x={pt.x - stepX / 2}
                        y={0}
                        width={stepX}
                        height={chartH}
                        fill="transparent"
                      />
                      {active && (
                        <line
                          x1={pt.x}
                          x2={pt.x}
                          y1={pt.y}
                          y2={baseY}
                          stroke="#4A8276"
                          strokeOpacity="0.32"
                          strokeWidth="1"
                          strokeDasharray="2 2"
                        />
                      )}
                      {active && (
                        <circle
                          cx={pt.x}
                          cy={pt.y}
                          r={6.5}
                          fill="#4A8276"
                          fillOpacity="0.16"
                        />
                      )}
                      <circle
                        cx={pt.x}
                        cy={pt.y}
                        r={active ? 3.6 : 2.5}
                        fill={active ? '#4A8276' : '#FFFFFF'}
                        stroke="#4A8276"
                        strokeWidth={active ? 1.8 : 1.5}
                      />
                      <text
                        x={pt.x}
                        y={chartH - 5}
                        textAnchor="middle"
                        fontSize="9"
                        fill={active || pt.day.isToday ? '#356B5F' : '#9A887B'}
                        fontWeight={active || pt.day.isToday ? 600 : 400}
                      >
                        {pt.day.shortLabel}
                      </text>
                    </g>
                  );
                })}
              </svg>

              {/* Micro Legend */}
              <div className="flex items-center justify-between px-2 pb-1.5 text-[10px] text-[#9A887B]">
                <div className="flex items-center gap-3">
                  <span className="inline-flex items-center gap-1">
                    <span className="w-2.5 h-[2px] rounded-full bg-[#4A8276]" />
                    <span>交互频率</span>
                  </span>
                  <span className="inline-flex items-center gap-1">
                    <span className="w-2 h-2 rounded-xs bg-[#C9963B]/45" />
                    <span>对话轮次</span>
                  </span>
                </div>
                <span className="font-mono tabular-nums">日均 {analytics.avgPerActiveDay}</span>
              </div>
            </div>
          </motion.div>
        ) : (
          <motion.div
            key="emotion"
            initial={{ opacity: 0, y: 4 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -4 }}
            transition={{ duration: 0.2 }}
            className="space-y-2.5"
          >
            {/* Overall Emotion Tag Distribution Ribbon */}
            <div className="space-y-1.5">
              <div className="flex items-center justify-between text-[10.5px] text-[#7D6C5E]">
                <span>情感标签占比</span>
                <span>共记录 {analytics.memoryCount} 条专属记忆</span>
              </div>
              <div className="h-2.5 w-full rounded-full overflow-hidden bg-[#F1EAE0] flex gap-[1.5px] p-[1.5px]">
                {analytics.emotionShares.map((item) => (
                  <motion.div
                    key={item.meta.key}
                    initial={{ width: 0 }}
                    animate={{ width: `${Math.max(8, item.percent)}%` }}
                    transition={{ duration: 0.5, ease: [0.22, 1, 0.36, 1] }}
                    className="h-full rounded-full"
                    style={{ backgroundColor: item.meta.color }}
                    title={`${item.meta.label} ${item.percent}%`}
                  />
                ))}
              </div>
              <div className="flex flex-wrap gap-1.5 pt-0.5">
                {analytics.emotionShares.map((item) => (
                  <span
                    key={item.meta.key}
                    className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-medium text-[#4A3B31] border border-black/5"
                    style={{ backgroundColor: item.meta.softBg }}
                  >
                    <span
                      className="w-1.5 h-1.5 rounded-full"
                      style={{ backgroundColor: item.meta.color }}
                    />
                    <span>{item.meta.label}</span>
                    <span className="font-mono tabular-nums text-[#7C6A5D]">{item.percent}%</span>
                  </span>
                ))}
              </div>
            </div>

            {/* 7-Day Emotion Shift Mini Stacked Columns */}
            <div className="rounded-xl bg-[#FDFBF7] border border-[#EFE7DB] px-2.5 py-2 space-y-1.5">
              <div className="text-[10px] text-[#9A887B]">近 7 日情感分布变化</div>
              <div className="grid grid-cols-7 gap-1.5 items-end h-[58px] pt-1">
                {analytics.days.map((day, idx) => {
                  const total = EMOTIONS.reduce((sum, e) => sum + day.emotions[e.key], 0);
                  const active = idx === selectedDayIdx;
                  return (
                    <button
                      key={day.dateKey}
                      type="button"
                      onClick={() => {
                        haptic('selection');
                        setSelectedDayIdx(idx);
                      }}
                      className="flex flex-col items-center justify-end gap-1 h-full group"
                    >
                      <div
                        className={`w-3.5 rounded-full overflow-hidden flex flex-col-reverse justify-start transition-transform ${
                          active ? 'scale-110 ring-1 ring-[#4A8276]/40' : ''
                        }`}
                        style={{
                          height: total > 0 ? `${Math.min(40, Math.max(12, total * 9))}px` : '6px',
                          backgroundColor: total > 0 ? 'transparent' : '#ECE4D8',
                        }}
                      >
                        {total > 0 &&
                          EMOTIONS.filter((e) => day.emotions[e.key] > 0).map((e) => (
                            <span
                              key={e.key}
                              style={{
                                height: `${(day.emotions[e.key] / total) * 100}%`,
                                backgroundColor: e.color,
                              }}
                              className="w-full block"
                            />
                          ))}
                      </div>
                      <span
                        className={`text-[9px] leading-none ${
                          active || day.isToday ? 'text-[#356B5F] font-semibold' : 'text-[#9A887B]'
                        }`}
                      >
                        {day.shortLabel}
                      </span>
                    </button>
                  );
                })}
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Gentle Coaching Prompt when No Chats Yet */}
      {!analytics.hasRealChats && onStartChat && (
        <div className="flex items-center justify-between gap-2 pt-0.5 text-[10.5px] text-[#8A7769]">
          <span>和她开启第一轮对话后，曲线会实时记录成长轨迹</span>
          <button
            type="button"
            onClick={onStartChat}
            className="inline-flex items-center gap-1 font-medium text-[#356B5F] hover:underline shrink-0"
          >
            <MessageCircle className="w-3 h-3" />
            <span>去聊聊</span>
          </button>
        </div>
      )}
    </div>
  );
}
