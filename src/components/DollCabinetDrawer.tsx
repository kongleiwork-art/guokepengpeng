import { useCallback, useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { AnimatePresence, LayoutGroup, motion } from 'motion/react';
import {
  ArrowDown,
  AudioLines,
  Check,
  Clock3,
  Edit3,
  MessageCircle,
  Plus,
  RotateCcw,
  Sparkles,
  TrendingUp,
  Volume2,
  X,
} from 'lucide-react';
import { api } from '../lib/api';
import type { CardSummary, DollSummary } from '../lib/types';
import { SafeImage } from './SafeImage';
import { SoundwaveGlyph } from './DollVoiceButton';
import { DollGrowthCurve } from './DollGrowthCurve';
import { haptic } from '../lib/haptics';
import { speakDollLine, stopDollVoice } from '../lib/dollVoice';

const VOICE_TAG_STORAGE_KEY = 'nutshell_doll_voice_tags_v1';

const PRESET_VOICE_TAGS = [
  '松风轻语',
  '朝露清音',
  '木铃叮咚',
  '棉云软声',
  '晴午暖调',
  '雨窗低吟',
] as const;

interface VoiceTagRecord {
  tag: string;
  sampleLine: string;
  updatedAt: string;
}

type VoiceTagMap = Record<string, VoiceTagRecord>;
type SortBy = 'time' | 'voice_tag';
type SortDir = 'desc' | 'asc';
type TimeFilter = 'all' | 'today' | 'week' | 'older';

const TIME_FILTER_OPTIONS: ReadonlyArray<{ key: TimeFilter; label: string }> = [
  { key: 'all', label: '全部时间' },
  { key: 'today', label: '今天' },
  { key: 'week', label: '近 7 天' },
  { key: 'older', label: '更早' },
];

const APPLE_SPRING_LAYOUT = {
  type: 'spring' as const,
  stiffness: 420,
  damping: 34,
  mass: 0.86,
};

interface CabinetItem {
  key: string;
  name: string;
  avatarUrl: string;
  mbti: string;
  personaName: string;
  defaultLine: string;
  origin: 'personal' | 'card' | 'demo';
  chatTo: string | null;
  detailTo: string;
  createdAt: string;
  washVariant: 0 | 1 | 2;
}

function getDefaultVoiceTag(mbti: string): string {
  const code = (mbti || '').toUpperCase();
  if (code.startsWith('ENF') || code.startsWith('ESF')) return '晴午暖调';
  if (code.startsWith('INF') || code.startsWith('ISF')) return '松风轻语';
  if (code.startsWith('INT') || code.startsWith('IST')) return '雨窗低吟';
  if (code.startsWith('ENT') || code.startsWith('EST')) return '木铃叮咚';
  return '朝露清音';
}

function loadVoiceTags(): VoiceTagMap {
  if (typeof window === 'undefined') return {};
  try {
    const raw = window.localStorage.getItem(VOICE_TAG_STORAGE_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw);
    if (parsed && typeof parsed === 'object') {
      return parsed as VoiceTagMap;
    }
  } catch {
    // ignore corrupted storage
  }
  return {};
}

function saveVoiceTags(map: VoiceTagMap): void {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.setItem(VOICE_TAG_STORAGE_KEY, JSON.stringify(map));
  } catch {
    // ignore storage quota errors
  }
}

function formatShortDate(iso: string): string {
  try {
    const d = new Date(iso);
    if (Number.isNaN(d.getTime())) return '';
    return `${d.getMonth() + 1}月${d.getDate()}日`;
  } catch {
    return '';
  }
}

function getTimestamp(iso: string): number {
  const t = Date.parse(iso);
  return Number.isNaN(t) ? 0 : t;
}

function matchesTimeFilter(iso: string, filter: TimeFilter): boolean {
  if (filter === 'all') return true;
  const ts = getTimestamp(iso);
  if (!ts) return filter === 'older';
  const now = new Date();
  const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
  const sevenDaysAgo = startOfToday - 6 * 24 * 60 * 60 * 1000;
  if (filter === 'today') return ts >= startOfToday;
  if (filter === 'week') return ts >= sevenDaysAgo;
  return ts < sevenDaysAgo;
}

interface DollCabinetDrawerProps {
  open: boolean;
  onClose: () => void;
}

export function DollCabinetDrawer({ open, onClose }: DollCabinetDrawerProps) {
  const navigate = useNavigate();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [dolls, setDolls] = useState<DollSummary[]>([]);
  const [cards, setCards] = useState<CardSummary[]>([]);
  const [scope, setScope] = useState<'generated' | 'all'>('generated');

  const [voiceTags, setVoiceTags] = useState<VoiceTagMap>(() => loadVoiceTags());
  const [sortBy, setSortBy] = useState<SortBy>('time');
  const [sortDir, setSortDir] = useState<SortDir>('desc');
  const [timeFilter, setTimeFilter] = useState<TimeFilter>('all');
  const [voiceTagFilter, setVoiceTagFilter] = useState<string>('all');

  const [speakingKey, setSpeakingKey] = useState<string | null>(null);
  const [editingKey, setEditingKey] = useState<string | null>(null);
  const [growthKey, setGrowthKey] = useState<string | null>(null);
  const [draftTag, setDraftTag] = useState('');
  const [draftLine, setDraftLine] = useState('');

  const fetchCollection = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      await api.initSession();
      const [dollList, cardList] = await Promise.all([api.listDolls(), api.listCards()]);
      setDolls(dollList);
      setCards(cardList);

      const hasGenerated =
        dollList.some((d) => d.kind === 'personal') ||
        cardList.some((c) => !c.boundDollId && c.versions.some((v) => v.status === 'succeeded' && v.resultUrl));
      setScope(hasGenerated ? 'generated' : 'all');
    } catch (err) {
      setError(err instanceof Error ? err.message : '暂时无法打开收藏柜');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (open) {
      void fetchCollection();
    } else {
      stopDollVoice();
      setSpeakingKey(null);
      setEditingKey(null);
      setGrowthKey(null);
    }
  }, [open, fetchCollection]);

  useEffect(() => {
    if (!open) return;
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        onClose();
      }
    };
    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
  }, [open, onClose]);

  const { generatedItems, allItems } = useMemo(() => {
    const personalDolls: CabinetItem[] = dolls
      .filter((d) => d.kind === 'personal')
      .map((d, idx) => ({
        key: d.id,
        name: d.name,
        avatarUrl: d.avatarUrl,
        mbti: d.persona.mbti,
        personaName: d.persona.name,
        defaultLine: d.persona.openingLine || d.persona.tagline,
        origin: 'personal' as const,
        chatTo: `/d/${d.id}/chat`,
        detailTo: `/d/${d.id}`,
        createdAt: d.createdAt,
        washVariant: (idx % 3) as 0 | 1 | 2,
      }));

    const unboundCards: CabinetItem[] = [];
    cards.forEach((c, idx) => {
      if (c.boundDollId) return;
      const active =
        c.versions.find((v) => v.id === c.activeVersionId && v.resultUrl) ||
        c.versions.find((v) => v.status === 'succeeded' && v.resultUrl);
      if (!active || !active.resultUrl) return;
      unboundCards.push({
        key: `card_${c.id}`,
        name: active.suggestedName || `${c.userNickname}的小娃娃`,
        avatarUrl: active.resultUrl,
        mbti: c.personaMbti,
        personaName: c.personaName,
        defaultLine: `你好呀，我是刚完成绘制的${active.suggestedName || c.personaName}，随时可以陪你说话。`,
        origin: 'card',
        chatTo: null,
        detailTo: `/card/${c.id}`,
        createdAt: c.createdAt,
        washVariant: ((personalDolls.length + idx) % 3) as 0 | 1 | 2,
      });
    });

    const demoDolls: CabinetItem[] = dolls
      .filter((d) => d.kind === 'demo')
      .map((d, idx) => ({
        key: d.id,
        name: d.name,
        avatarUrl: d.avatarUrl,
        mbti: d.persona.mbti,
        personaName: d.persona.name,
        defaultLine: d.persona.openingLine || d.persona.tagline,
        origin: 'demo' as const,
        chatTo: `/d/${d.id}/chat`,
        detailTo: `/d/${d.id}`,
        createdAt: d.createdAt,
        washVariant: (idx % 3) as 0 | 1 | 2,
      }));

    const generated = [...personalDolls, ...unboundCards];
    return {
      generatedItems: generated,
      allItems: [...generated, ...demoDolls],
    };
  }, [dolls, cards]);

  const scopedItems = scope === 'generated' ? generatedItems : allItems;

  const getVoiceMeta = useCallback(
    (item: CabinetItem) => {
      const saved = voiceTags[item.key];
      return {
        tag: saved?.tag || getDefaultVoiceTag(item.mbti),
        sampleLine: saved?.sampleLine || item.defaultLine,
        isCustom: Boolean(saved),
      };
    },
    [voiceTags]
  );

  // Build available voice tag chips with live counts for current scope
  const voiceTagStats = useMemo(() => {
    const counts = new Map<string, number>();
    for (const item of scopedItems) {
      const tag = getVoiceMeta(item).tag;
      counts.set(tag, (counts.get(tag) || 0) + 1);
    }
    return Array.from(counts.entries())
      .map(([tag, count]) => ({ tag, count }))
      .sort((a, b) => a.tag.localeCompare(b.tag, 'zh-Hans-CN'));
  }, [scopedItems, getVoiceMeta]);

  // Build acquisition-time bucket counts for current scope
  const timeBucketCounts = useMemo(() => {
    const counts: Record<TimeFilter, number> = {
      all: scopedItems.length,
      today: 0,
      week: 0,
      older: 0,
    };
    for (const item of scopedItems) {
      if (matchesTimeFilter(item.createdAt, 'today')) counts.today += 1;
      if (matchesTimeFilter(item.createdAt, 'week')) counts.week += 1;
      if (matchesTimeFilter(item.createdAt, 'older')) counts.older += 1;
    }
    return counts;
  }, [scopedItems]);

  // Keep voiceTagFilter valid when switching scope or editing tags
  useEffect(() => {
    if (
      voiceTagFilter !== 'all' &&
      !voiceTagStats.some((entry) => entry.tag === voiceTagFilter)
    ) {
      setVoiceTagFilter('all');
    }
  }, [voiceTagFilter, voiceTagStats]);

  // Filtered + sorted collection powering Apple-style FLIP list reordering
  const visibleItems = useMemo(() => {
    const filtered = scopedItems.filter((item) => {
      if (!matchesTimeFilter(item.createdAt, timeFilter)) return false;
      if (voiceTagFilter !== 'all' && getVoiceMeta(item).tag !== voiceTagFilter) return false;
      return true;
    });

    const sorted = [...filtered].sort((a, b) => {
      const factor = sortDir === 'asc' ? 1 : -1;
      if (sortBy === 'time') {
        const diff = getTimestamp(a.createdAt) - getTimestamp(b.createdAt);
        if (diff !== 0) return diff * factor;
        return a.name.localeCompare(b.name, 'zh-Hans-CN') * factor;
      }

      const tagA = getVoiceMeta(a).tag;
      const tagB = getVoiceMeta(b).tag;
      const tagDiff = tagA.localeCompare(tagB, 'zh-Hans-CN');
      if (tagDiff !== 0) return tagDiff * factor;

      // Secondary deterministic tie-break by newest acquisition time
      const timeDiff = getTimestamp(b.createdAt) - getTimestamp(a.createdAt);
      if (timeDiff !== 0) return timeDiff;
      return a.key.localeCompare(b.key);
    });

    return sorted;
  }, [scopedItems, timeFilter, voiceTagFilter, sortBy, sortDir, getVoiceMeta]);

  const hasActiveFilter = timeFilter !== 'all' || voiceTagFilter !== 'all';

  const handleSortPress = (nextSort: SortBy) => {
    haptic('selection');
    if (sortBy === nextSort) {
      setSortDir((prev) => (prev === 'desc' ? 'asc' : 'desc'));
    } else {
      setSortBy(nextSort);
      setSortDir(nextSort === 'time' ? 'desc' : 'asc');
    }
  };

  const handleResetFilters = () => {
    haptic('selection');
    setTimeFilter('all');
    setVoiceTagFilter('all');
  };

  const handleToggleVoice = (item: CabinetItem) => {
    if (speakingKey === item.key) {
      haptic('selection');
      stopDollVoice();
      setSpeakingKey(null);
      return;
    }
    haptic('light');
    const meta = getVoiceMeta(item);
    speakDollLine(item.key, meta.sampleLine, item.mbti, {
      onStart: () => setSpeakingKey(item.key),
      onEnd: () => setSpeakingKey((curr) => (curr === item.key ? null : curr)),
      onError: () => setSpeakingKey((curr) => (curr === item.key ? null : curr)),
    });
  };

  const handleStartEdit = (item: CabinetItem) => {
    haptic('selection');
    const meta = getVoiceMeta(item);
    setEditingKey(item.key);
    setDraftTag(meta.tag);
    setDraftLine(meta.sampleLine);
  };

  const handleSaveVoiceTag = (item: CabinetItem) => {
    const cleanTag = draftTag.trim() || getDefaultVoiceTag(item.mbti);
    const cleanLine = draftLine.trim() || item.defaultLine;
    const next: VoiceTagMap = {
      ...voiceTags,
      [item.key]: {
        tag: cleanTag.slice(0, 16),
        sampleLine: cleanLine.slice(0, 80),
        updatedAt: new Date().toISOString(),
      },
    };
    setVoiceTags(next);
    saveVoiceTags(next);
    setEditingKey(null);
    haptic('success');
  };

  const handleNavigate = (to: string) => {
    haptic('light');
    stopDollVoice();
    onClose();
    navigate(to);
  };

  return (
    <AnimatePresence>
      {open && (
        <div
          className="fixed inset-0 z-50 flex justify-end"
          role="dialog"
          aria-modal="true"
          aria-label="娃娃收藏柜"
        >
          {/* Warm Frosted Backdrop */}
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.24 }}
            onClick={() => {
              haptic('selection');
              onClose();
            }}
            className="absolute inset-0 bg-[#382A22]/24 backdrop-blur-[3px]"
          />

          {/* Slide-Over Stationery Cabinet Drawer */}
          <motion.aside
            initial={{ x: '100%' }}
            animate={{ x: 0 }}
            exit={{ x: '100%' }}
            transition={{ type: 'spring', stiffness: 360, damping: 34, mass: 0.9 }}
            className="relative z-10 w-[92vw] max-w-[430px] h-dvh bg-[#FAF7F2] border-l border-[#E6DDD0] shadow-[-16px_0_42px_-12px_rgba(56,42,34,0.22)] flex flex-col rounded-l-[28px] overflow-hidden"
          >
            {/* Subtle Watercolor Wash Top Header */}
            <div className="px-5 pt-5 pb-3.5 border-b border-[#EAE2D6]/90 bg-[#FFFDF9]/92 backdrop-blur-md space-y-3.5 shrink-0">
              <div className="flex items-start justify-between gap-3">
                <div>
                  <div className="inline-flex items-center gap-1.5 text-[11px] font-medium text-[#4A8276]">
                    <Sparkles className="w-3.5 h-3.5" />
                    <span>手作声纹手帐</span>
                  </div>
                  <h2 className="font-editorial text-[19px] font-semibold text-[#382A22] mt-0.5 tracking-tight">
                    娃娃收藏柜
                  </h2>
                </div>
                <button
                  type="button"
                  onClick={() => {
                    haptic('selection');
                    onClose();
                  }}
                  aria-label="关闭娃娃收藏柜"
                  className="w-8 h-8 inline-flex items-center justify-center btn-orb-glass shrink-0"
                >
                  <X className="w-4 h-4" />
                </button>
              </div>

              {/* Apple Segmented Scope Switcher */}
              <div className="ios-segmented grid grid-cols-2 gap-1">
                {(
                  [
                    { key: 'generated', label: `我的生成 (${generatedItems.length})` },
                    { key: 'all', label: `全部藏品 (${allItems.length})` },
                  ] as const
                ).map((tab) => {
                  const active = scope === tab.key;
                  return (
                    <button
                      key={tab.key}
                      type="button"
                      onClick={() => {
                        haptic('selection');
                        setScope(tab.key);
                      }}
                      className={`relative py-1.5 text-xs font-medium rounded-[10px] transition-colors ${
                        active ? 'text-[#2C5A50]' : 'text-[#7C6A5D] hover:text-[#382A22]'
                      }`}
                    >
                      {active && (
                        <motion.span
                          layoutId="cabinet-scope-thumb"
                          transition={{ type: 'spring', stiffness: 420, damping: 32 }}
                          className="absolute inset-0 ios-segmented-thumb"
                        />
                      )}
                      <span className="relative z-10">{tab.label}</span>
                    </button>
                  );
                })}
              </div>

              {/* Sort & Filter Bar (Acquisition Time & Exclusive Voice Tag) */}
              {scopedItems.length > 0 && (
                <div className="space-y-2.5 pt-0.5">
                  <div className="flex items-center justify-between gap-2">
                    <div className="flex items-center gap-1.5">
                      {(
                        [
                          {
                            key: 'time' as const,
                            label: '按获取时间',
                            icon: Clock3,
                            dirLabel: sortDir === 'desc' ? '新→旧' : '旧→新',
                          },
                          {
                            key: 'voice_tag' as const,
                            label: '按语音标签',
                            icon: AudioLines,
                            dirLabel: sortDir === 'asc' ? '正序' : '倒序',
                          },
                        ] as const
                      ).map((opt) => {
                        const active = sortBy === opt.key;
                        const Icon = opt.icon;
                        return (
                          <button
                            key={opt.key}
                            type="button"
                            onClick={() => handleSortPress(opt.key)}
                            aria-pressed={active}
                            className={`inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-[11.5px] font-medium transition-all duration-200 whitespace-nowrap ${
                              active
                                ? 'bg-[#ECF5F2] text-[#28584D] border border-[#4A8276]/35 shadow-[0_1px_4px_rgba(74,130,118,0.12)]'
                                : 'text-[#7A685B] hover:text-[#382A22] border border-transparent hover:bg-[#F4EFE7]/75'
                            }`}
                          >
                            <Icon className="w-3 h-3 shrink-0" />
                            <span>{opt.label}</span>
                            {active && (
                              <span className="inline-flex items-center gap-0.5 text-[10px] text-[#4A8276] ml-0.5">
                                <motion.span
                                  animate={{ rotate: sortDir === 'asc' ? 180 : 0 }}
                                  transition={{ type: 'spring', stiffness: 460, damping: 28 }}
                                  className="inline-flex"
                                >
                                  <ArrowDown className="w-3 h-3" />
                                </motion.span>
                                <span>{opt.dirLabel}</span>
                              </span>
                            )}
                          </button>
                        );
                      })}
                    </div>

                    {hasActiveFilter && (
                      <button
                        type="button"
                        onClick={handleResetFilters}
                        className="inline-flex items-center gap-1 text-[11px] font-medium btn-icon-ghost text-[#4A8276] shrink-0"
                      >
                        <RotateCcw className="w-3 h-3" />
                        <span>重置</span>
                      </button>
                    )}
                  </div>

                  {/* Contextual Single-Row Stationery Filter Chips */}
                  <div className="flex items-center gap-1.5 overflow-x-auto pb-0.5">
                    {sortBy === 'time' ? (
                      <>
                        {TIME_FILTER_OPTIONS.map((opt) => {
                          const active = timeFilter === opt.key;
                          const count = timeBucketCounts[opt.key];
                          return (
                            <button
                              key={opt.key}
                              type="button"
                              onClick={() => {
                                haptic('selection');
                                setTimeFilter(opt.key);
                              }}
                              aria-pressed={active}
                              className={`inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-[11px] transition-all whitespace-nowrap shrink-0 border ${
                                active
                                  ? 'bg-[#382A22] text-[#FAF7F2] border-[#382A22] font-medium'
                                  : 'bg-[#FAF7F2]/90 text-[#726053] border-[#E7DEC8]/90 hover:border-[#C9BAA5]'
                              }`}
                            >
                              <span>{opt.label}</span>
                              <span
                                className={`text-[10px] tabular-nums ${
                                  active ? 'text-[#D6E8E2]' : 'text-[#9A887B]'
                                }`}
                              >
                                {count}
                              </span>
                            </button>
                          );
                        })}
                        {voiceTagFilter !== 'all' && (
                          <button
                            type="button"
                            onClick={() => {
                              haptic('selection');
                              setVoiceTagFilter('all');
                            }}
                            className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-[11px] bg-[#ECF5F2] text-[#2C5A50] border border-[#4A8276]/35 whitespace-nowrap shrink-0"
                          >
                            <span>声纹：{voiceTagFilter}</span>
                            <X className="w-3 h-3" />
                          </button>
                        )}
                      </>
                    ) : (
                      <>
                        <button
                          type="button"
                          onClick={() => {
                            haptic('selection');
                            setVoiceTagFilter('all');
                          }}
                          aria-pressed={voiceTagFilter === 'all'}
                          className={`inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-[11px] transition-all whitespace-nowrap shrink-0 border ${
                            voiceTagFilter === 'all'
                              ? 'bg-[#382A22] text-[#FAF7F2] border-[#382A22] font-medium'
                              : 'bg-[#FAF7F2]/90 text-[#726053] border-[#E7DEC8]/90 hover:border-[#C9BAA5]'
                          }`}
                        >
                          <span>全部声纹</span>
                          <span
                            className={`text-[10px] tabular-nums ${
                              voiceTagFilter === 'all' ? 'text-[#D6E8E2]' : 'text-[#9A887B]'
                            }`}
                          >
                            {scopedItems.length}
                          </span>
                        </button>
                        {voiceTagStats.map(({ tag, count }) => {
                          const active = voiceTagFilter === tag;
                          return (
                            <button
                              key={tag}
                              type="button"
                              onClick={() => {
                                haptic('selection');
                                setVoiceTagFilter(active ? 'all' : tag);
                              }}
                              aria-pressed={active}
                              className={`inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-[11px] transition-all whitespace-nowrap shrink-0 border ${
                                active
                                  ? 'bg-[#ECF5F2] text-[#28584D] border-[#4A8276]/50 font-medium shadow-[0_1px_4px_rgba(74,130,118,0.14)]'
                                  : 'bg-[#FAF7F2]/90 text-[#726053] border-[#E7DEC8]/90 hover:border-[#C9BAA5]'
                              }`}
                            >
                              <span>{tag}</span>
                              <span
                                className={`text-[10px] tabular-nums ${
                                  active ? 'text-[#4A8276]' : 'text-[#9A887B]'
                                }`}
                              >
                                {count}
                              </span>
                            </button>
                          );
                        })}
                        {timeFilter !== 'all' && (
                          <button
                            type="button"
                            onClick={() => {
                              haptic('selection');
                              setTimeFilter('all');
                            }}
                            className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-[11px] bg-[#F4EFE7] text-[#5B4B40] border border-[#D8CCBA] whitespace-nowrap shrink-0"
                          >
                            <span>
                              时间：{TIME_FILTER_OPTIONS.find((t) => t.key === timeFilter)?.label}
                            </span>
                            <X className="w-3 h-3" />
                          </button>
                        )}
                      </>
                    )}
                  </div>
                </div>
              )}
            </div>

            {/* Scrollable Cabinet Shelf Area (Scrollbar hidden globally) */}
            <div className="flex-1 overflow-y-auto px-4 py-4 space-y-3.5">
              {loading ? (
                <div className="space-y-3">
                  {[0, 1, 2].map((i) => (
                    <div
                      key={i}
                      className="rounded-[22px] p-3.5 border border-[#EAE1D4] bg-[#FFFDF9] flex items-center gap-3.5"
                    >
                      <div className="w-[72px] h-[72px] rounded-2xl wc-wash shrink-0" />
                      <div className="flex-1 space-y-2.5">
                        <div className="h-4 w-28 wc-line" />
                        <div className="h-3 w-40 wc-line" />
                        <div className="h-6 w-32 wc-line" />
                      </div>
                    </div>
                  ))}
                </div>
              ) : error ? (
                <div className="rounded-2xl p-5 bg-[#FFFDF9] border border-[#E5C5BC] text-center space-y-2.5">
                  <p className="text-xs text-[#9E3D2E]">{error}</p>
                  <button
                    type="button"
                    onClick={() => void fetchCollection()}
                    className="px-4 py-1.5 text-xs font-medium btn-ink-tinted"
                  >
                    重新打开
                  </button>
                </div>
              ) : scopedItems.length === 0 ? (
                <div className="wc-cabinet-card wc-cabinet-wash-0 rounded-[24px] p-6 text-center space-y-3.5">
                  <div className="w-12 h-12 mx-auto rounded-full bg-[#ECF5F2] border border-[#CBE0D9] text-[#4A8276] flex items-center justify-center">
                    <Volume2 className="w-5 h-5" />
                  </div>
                  <div className="space-y-1">
                    <h3 className="font-editorial text-base font-semibold text-[#382A22]">
                      收藏柜里还在等你第一只小娃娃
                    </h3>
                    <p className="text-xs text-[#7D6C5E] leading-relaxed">
                      完成定制后，你的娃娃会自动收进这里，并可为她记录独一无二的专属语音标签。
                    </p>
                  </div>
                  <div className="flex items-center justify-center gap-2.5 pt-1">
                    <button
                      type="button"
                      onClick={() => handleNavigate('/create')}
                      className="inline-flex items-center gap-1.5 px-4 py-2 text-xs font-medium btn-capsule-primary"
                    >
                      <Plus className="w-3.5 h-3.5" />
                      <span>定制第一只娃娃</span>
                    </button>
                    {allItems.length > 0 && (
                      <button
                        type="button"
                        onClick={() => {
                          haptic('selection');
                          setScope('all');
                        }}
                        className="px-3.5 py-2 text-xs font-medium btn-paper-soft"
                      >
                        浏览全部藏品
                      </button>
                    )}
                  </div>
                </div>
              ) : visibleItems.length === 0 ? (
                <motion.div
                  key="filtered-empty"
                  initial={{ opacity: 0, scale: 0.97 }}
                  animate={{ opacity: 1, scale: 1 }}
                  className="wc-cabinet-card wc-cabinet-wash-1 rounded-[24px] p-6 text-center space-y-3"
                >
                  <p className="font-editorial text-[15px] font-semibold text-[#382A22]">
                    当前筛选条件下暂无娃娃
                  </p>
                  <p className="text-xs text-[#7D6C5E]">
                    可以切换时间范围或声纹标签，查看收藏柜中的其他作品。
                  </p>
                  <button
                    type="button"
                    onClick={handleResetFilters}
                    className="inline-flex items-center gap-1.5 px-4 py-1.5 text-xs font-medium btn-ink-tinted"
                  >
                    <RotateCcw className="w-3.5 h-3.5" />
                    <span>显示全部藏品</span>
                  </button>
                </motion.div>
              ) : (
                <LayoutGroup id="doll-cabinet-cards">
                  <div className="flex flex-col gap-3.5">
                    <AnimatePresence mode="popLayout" initial={false}>
                      {visibleItems.map((item) => {
                        const meta = getVoiceMeta(item);
                        const savedVoiceRecord = voiceTags[item.key];
                        const isSpeaking = speakingKey === item.key;
                        const isEditing = editingKey === item.key;
                        const isGrowthOpen = growthKey === item.key;
                        const washClass = `wc-cabinet-wash-${item.washVariant}`;

                        return (
                          <motion.article
                            key={item.key}
                            layout
                            initial={{ opacity: 0, scale: 0.96, y: 8 }}
                            animate={{ opacity: 1, scale: 1, y: 0 }}
                            exit={{ opacity: 0, scale: 0.94, transition: { duration: 0.18 } }}
                            transition={{
                              layout: APPLE_SPRING_LAYOUT,
                              opacity: { duration: 0.2 },
                              scale: { duration: 0.22 },
                            }}
                            className={`wc-cabinet-card ${washClass} rounded-[22px] p-3.5 space-y-3 transition-shadow duration-300 ${
                              isSpeaking
                                ? 'ring-1 ring-[#4A8276]/45 shadow-[0_10px_26px_-10px_rgba(74,130,118,0.28)]'
                                : ''
                            }`}
                          >
                        {/* Top Row: Watercolor Portrait + Identity + Quick Chat */}
                        <div className="flex items-start gap-3">
                          <button
                            type="button"
                            onClick={() => handleNavigate(item.detailTo)}
                            className="relative w-[74px] h-[74px] rounded-[18px] bg-white/85 border border-[#EAE1D3] p-1.5 shrink-0 overflow-hidden shadow-[0_2px_8px_rgba(56,42,34,0.05)] group"
                          >
                            <SafeImage
                              src={item.avatarUrl}
                              alt={item.name}
                              className="w-full h-full object-contain transition-transform duration-300 group-hover:scale-105"
                            />
                            <span
                              className={`absolute top-1 left-1 px-1.5 py-[1px] rounded-full text-[9px] font-medium ${
                                item.origin === 'demo'
                                  ? 'bg-[#F5EFE6]/90 text-[#867465]'
                                  : 'bg-[#ECF5F2]/95 text-[#2E6156]'
                              }`}
                            >
                              {item.origin === 'demo'
                                ? '馆藏'
                                : item.origin === 'card'
                                  ? '待绑定'
                                  : '定制'}
                            </span>
                          </button>

                          <div className="flex-1 min-w-0 pt-0.5">
                            <div className="flex items-center justify-between gap-2">
                              <div className="flex items-center gap-1.5 min-w-0">
                                <button
                                  type="button"
                                  onClick={() => handleNavigate(item.detailTo)}
                                  className="font-editorial text-[15px] font-semibold text-[#382A22] hover:text-[#356B5F] transition-colors truncate"
                                >
                                  {item.name}
                                </button>
                                <span className="text-[10.5px] font-mono text-[#4A8276] shrink-0">
                                  {item.mbti}
                                </span>
                              </div>

                              {item.chatTo ? (
                                <button
                                  type="button"
                                  onClick={() => handleNavigate(item.chatTo!)}
                                  className="inline-flex items-center gap-1 px-2.5 py-1 text-[11px] font-medium btn-ink-tinted shrink-0"
                                >
                                  <MessageCircle className="w-3 h-3" />
                                  <span>对话</span>
                                </button>
                              ) : (
                                <button
                                  type="button"
                                  onClick={() => handleNavigate(item.detailTo)}
                                  className="px-2.5 py-1 text-[11px] font-medium btn-paper-soft shrink-0"
                                >
                                  去绑定
                                </button>
                              )}
                            </div>

                            <div className="flex items-center gap-1.5 text-[11px] text-[#8E7B6D] mt-0.5">
                              <span className="truncate">{item.personaName}</span>
                              {item.createdAt && (
                                <>
                                  <span aria-hidden="true">·</span>
                                  <span
                                    className={`shrink-0 transition-colors ${
                                      sortBy === 'time' ? 'text-[#4A8276] font-medium' : ''
                                    }`}
                                  >
                                    {formatShortDate(item.createdAt)}
                                  </span>
                                </>
                              )}
                            </div>

                            <p className="text-[12px] text-[#5B4B40] leading-relaxed mt-1.5 line-clamp-2">
                              “{meta.sampleLine}”
                            </p>
                          </div>
                        </div>

                        {/* Exclusive Voice Tag & Growth Curve Ribbon */}
                        <div className="pt-2.5 border-t border-[#E8DFD1]/75">
                          <div className="flex items-center justify-between gap-2">
                            <div className="flex items-center gap-1.5 min-w-0">
                              <button
                                type="button"
                                onClick={() => handleToggleVoice(item)}
                                aria-pressed={isSpeaking}
                                title="点击试听专属语音标签"
                                className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-[11.5px] font-medium transition-all min-w-0 ${
                                  isSpeaking
                                    ? 'btn-voice-playing text-[#28584D]'
                                    : sortBy === 'voice_tag'
                                      ? 'btn-voice-idle text-[#2B5C51] ring-1 ring-[#4A8276]/28'
                                      : 'btn-voice-idle text-[#3D5C54]'
                                }`}
                              >
                                <SoundwaveGlyph compact playing={isSpeaking} />
                                <span className="truncate">{meta.tag}</span>
                              </button>
                            </div>

                            <div className="flex items-center gap-2.5 shrink-0">
                              <button
                                type="button"
                                onClick={() => {
                                  haptic('selection');
                                  if (!isGrowthOpen) setEditingKey(null);
                                  setGrowthKey(isGrowthOpen ? null : item.key);
                                }}
                                aria-expanded={isGrowthOpen}
                                aria-label={`查看 ${item.name} 的成长曲线`}
                                className={`inline-flex items-center gap-1 text-[11px] font-medium btn-icon-ghost shrink-0 py-1 ${
                                  isGrowthOpen ? 'text-[#2D6256]' : ''
                                }`}
                              >
                                <TrendingUp className="w-3.5 h-3.5" />
                                <span>{isGrowthOpen ? '收起曲线' : '成长曲线'}</span>
                              </button>

                              <button
                                type="button"
                                onClick={() => {
                                  if (isEditing) {
                                    setEditingKey(null);
                                  } else {
                                    setGrowthKey(null);
                                    handleStartEdit(item);
                                  }
                                }}
                                aria-label={`编辑 ${item.name} 的专属语音标签`}
                                className="inline-flex items-center gap-1 text-[11px] font-medium btn-icon-ghost shrink-0 py-1"
                              >
                                <Edit3 className="w-3 h-3" />
                                <span>{isEditing ? '收起' : meta.isCustom ? '改标签' : '记声纹'}</span>
                              </button>
                            </div>
                          </div>

                          {/* Inline Stationery Voice Tag Editor */}
                          <AnimatePresence initial={false}>
                            {isEditing && (
                              <motion.div
                                initial={{ height: 0, opacity: 0 }}
                                animate={{ height: 'auto', opacity: 1 }}
                                exit={{ height: 0, opacity: 0 }}
                                transition={{ duration: 0.22, ease: [0.22, 1, 0.36, 1] }}
                                className="overflow-hidden"
                              >
                                <div className="mt-2.5 p-2.5 rounded-2xl bg-white/85 border border-[#E5DBCC] space-y-2.5">
                                  <div className="flex flex-wrap gap-1.5">
                                    {PRESET_VOICE_TAGS.map((preset) => {
                                      const picked = draftTag.trim() === preset;
                                      return (
                                        <button
                                          key={preset}
                                          type="button"
                                          onClick={() => {
                                            haptic('selection');
                                            setDraftTag(preset);
                                          }}
                                          className={`px-2 py-0.5 rounded-full text-[10.5px] border transition-colors ${
                                            picked
                                              ? 'bg-[#ECF5F2] border-[#4A8276]/50 text-[#2B5C51] font-medium'
                                              : 'bg-[#FAF7F2] border-[#E6DDD0] text-[#7D6C5E] hover:border-[#C7B8A5]'
                                          }`}
                                        >
                                          {preset}
                                        </button>
                                      );
                                    })}
                                  </div>

                                  <div className="space-y-1.5">
                                    <input
                                      type="text"
                                      value={draftTag}
                                      onChange={(e) => setDraftTag(e.target.value)}
                                      maxLength={16}
                                      placeholder="自定义专属语音标签（如：桂花轻语）"
                                      className="w-full px-3 py-1.5 text-[13px] sm:text-xs bg-[#FAF7F2] border border-[#E4DACB] rounded-xl focus:outline-none focus:bg-white focus:border-[#4A8276]"
                                    />
                                    <textarea
                                      rows={2}
                                      value={draftLine}
                                      onChange={(e) => setDraftLine(e.target.value)}
                                      maxLength={80}
                                      placeholder="写一句给她的专属语音试听台词…"
                                      className="w-full resize-none px-3 py-1.5 text-[13px] sm:text-xs bg-[#FAF7F2] border border-[#E4DACB] rounded-xl focus:outline-none focus:bg-white focus:border-[#4A8276]"
                                    />
                                  </div>

                                  <div className="flex items-center justify-end gap-2">
                                    <button
                                      type="button"
                                      onClick={() => setEditingKey(null)}
                                      className="px-2.5 py-1 text-[11px] font-medium btn-icon-ghost"
                                    >
                                      取消
                                    </button>
                                    <button
                                      type="button"
                                      onClick={() => handleSaveVoiceTag(item)}
                                      className="inline-flex items-center gap-1 px-3 py-1 text-[11px] font-medium btn-capsule-primary"
                                    >
                                      <Check className="w-3 h-3" />
                                      <span>保存声纹标签</span>
                                    </button>
                                  </div>
                                </div>
                              </motion.div>
                            )}
                          </AnimatePresence>

                          {/* Expandable Growth Curve Data Visualization */}
                          <AnimatePresence initial={false}>
                            {isGrowthOpen && (
                              <motion.div
                                initial={{ height: 0, opacity: 0 }}
                                animate={{ height: 'auto', opacity: 1 }}
                                exit={{ height: 0, opacity: 0 }}
                                transition={{ duration: 0.26, ease: [0.22, 1, 0.36, 1] }}
                                className="overflow-hidden"
                              >
                                <DollGrowthCurve
                                  dollId={item.key}
                                  dollName={item.name}
                                  mbti={item.mbti}
                                  createdAt={item.createdAt}
                                  canFetchRemote={item.origin !== 'card'}
                                  voiceTagUpdatedAt={savedVoiceRecord?.updatedAt}
                                  onStartChat={
                                    item.chatTo
                                      ? () => handleNavigate(item.chatTo!)
                                      : () => handleNavigate(item.detailTo)
                                  }
                                />
                              </motion.div>
                            )}
                          </AnimatePresence>
                        </div>
                          </motion.article>
                        );
                      })}
                    </AnimatePresence>
                  </div>
                </LayoutGroup>
              )}
            </div>

            {/* Footer Quick Action */}
            <div className="px-4 py-3 border-t border-[#EAE2D6]/90 bg-[#FFFDF9]/92 backdrop-blur-md flex items-center justify-between gap-3 shrink-0 safe-pb">
              <span className="text-[11px] text-[#8E7B6D]">
                点击声纹标签即可轻听娃娃音色
              </span>
              <button
                type="button"
                onClick={() => handleNavigate('/create')}
                className="inline-flex items-center gap-1.5 px-3.5 py-1.5 text-xs font-medium btn-capsule-primary whitespace-nowrap shrink-0"
              >
                <Plus className="w-3.5 h-3.5" />
                <span>新定制娃娃</span>
              </button>
            </div>
          </motion.aside>
        </div>
      )}
    </AnimatePresence>
  );
}
