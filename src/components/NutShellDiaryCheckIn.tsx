import { useEffect, useMemo, useRef, useState } from 'react';
import { AnimatePresence, motion } from 'motion/react';
import { CalendarDays, Check, Droplets, Sparkles } from 'lucide-react';
import { haptic } from '../lib/haptics';
import {
  NutShellDiaryCalendar,
  type CalendarMoodPalette,
} from './NutShellDiaryCalendar';

const STORAGE_KEY = 'nutshell_diary_checkins_v1';
const MOODS_STORAGE_KEY = 'nutshell_diary_moods_v1';
const WEEKDAY_LABELS = ['一', '二', '三', '四', '五', '六', '日'] as const;
const EASE_ORGANIC = [0.22, 1, 0.36, 1] as const;

export type MoodStickerId = 'sunny' | 'breeze' | 'cozy' | 'dreamy' | 'spark';

interface MoodStickerMeta {
  id: MoodStickerId;
  label: string;
  note: string;
  tintBg: string;
  tintBorder: string;
  washPrimary: string;
  washSecondary: string;
  ringColor: string;
  dropletColor: string;
}

const MOOD_STICKERS: readonly MoodStickerMeta[] = [
  {
    id: 'sunny',
    label: '晴朗',
    note: '今天像晒过太阳的棉纸一样明朗，把好心情贴在日期旁。',
    tintBg: 'bg-[#FFF8EC]',
    tintBorder: 'border-[#EAD6B3]',
    washPrimary: 'rgba(241, 195, 116, 0.34)',
    washSecondary: 'rgba(248, 221, 168, 0.22)',
    ringColor: 'rgba(209, 155, 68, 0.42)',
    dropletColor: '#E5B25D',
  },
  {
    id: 'breeze',
    label: '惬意',
    note: '薄荷微风轻轻拂过手帐页，不紧不慢地享受此刻。',
    tintBg: 'bg-[#EFF7F4]',
    tintBorder: 'border-[#C5DED6]',
    washPrimary: 'rgba(116, 178, 160, 0.30)',
    washSecondary: 'rgba(176, 218, 206, 0.22)',
    ringColor: 'rgba(74, 130, 118, 0.42)',
    dropletColor: '#69A897',
  },
  {
    id: 'cozy',
    label: '治愈',
    note: '捧一杯温热茶水，和果壳小家伙一起慢慢放松下来。',
    tintBg: 'bg-[#FDF4F0]',
    tintBorder: 'border-[#EBD2C8]',
    washPrimary: 'rgba(231, 174, 150, 0.32)',
    washSecondary: 'rgba(245, 211, 194, 0.22)',
    ringColor: 'rgba(196, 128, 102, 0.4)',
    dropletColor: '#DA9B82',
  },
  {
    id: 'dreamy',
    label: '放空',
    note: '留一点紫雾般的安静空隙，让思绪随水彩慢慢晕开。',
    tintBg: 'bg-[#F6F3FA]',
    tintBorder: 'border-[#DDD3E8]',
    washPrimary: 'rgba(174, 152, 206, 0.30)',
    washSecondary: 'rgba(211, 196, 232, 0.22)',
    ringColor: 'rgba(134, 112, 168, 0.38)',
    dropletColor: '#A790C8',
  },
  {
    id: 'spark',
    label: '灵动',
    note: '捕捉到闪闪发光的小灵感，悄悄夹进今天的果壳日记。',
    tintBg: 'bg-[#FBF7EC]',
    tintBorder: 'border-[#E6D6AE]',
    washPrimary: 'rgba(227, 179, 84, 0.32)',
    washSecondary: 'rgba(154, 196, 182, 0.20)',
    ringColor: 'rgba(198, 146, 56, 0.4)',
    dropletColor: '#D8A64A',
  },
] as const;

const MICRO_DROPLETS = [
  { id: 'd1', x: -20, y: -12, size: 4.5, delay: 0.34 },
  { id: 'd2', x: 24, y: -14, size: 3.5, delay: 0.4 },
  { id: 'd3', x: 18, y: 14, size: 4, delay: 0.44 },
] as const;

const DAILY_NOTES = [
  '今天也为桌上的果壳小家伙留了一格温柔时刻。',
  '水彩慢慢晕开，小嫩芽听见了你的今日问候。',
  '把日常的一点小确幸，悄悄收进果壳手帐里。',
  '阳光落在木纹纸页上，新叶子又舒展了一点。',
  '不必匆忙，和手作娃娃慢慢记录今天的步调。',
] as const;

function WatercolorMoodIcon({ id, size = 28 }: { id: MoodStickerId; size?: number }) {
  switch (id) {
    case 'sunny':
      return (
        <svg width={size} height={size} viewBox="0 0 36 36" fill="none" aria-hidden="true">
          <circle cx="18" cy="18" r="13.5" fill="#F4CE8A" fillOpacity="0.32" />
          <circle cx="18" cy="18" r="8.2" fill="#F1C374" fillOpacity="0.88" stroke="#9C7139" strokeWidth="1.2" />
          <circle cx="15.5" cy="17.3" r="0.9" fill="#6E4C27" />
          <circle cx="20.5" cy="17.3" r="0.9" fill="#6E4C27" />
          <path d="M16.4 19.8C17.2 20.6 18.8 20.6 19.6 19.8" stroke="#8C5932" strokeWidth="1.15" strokeLinecap="round" />
          <path
            d="M18 5.2V7.6M18 28.4V30.8M5.2 18H7.6M28.4 18H30.8M8.9 8.9L10.6 10.6M25.4 25.4L27.1 27.1M27.1 8.9L25.4 10.6M10.6 25.4L8.9 27.1"
            stroke="#C79647"
            strokeWidth="1.35"
            strokeLinecap="round"
          />
        </svg>
      );
    case 'breeze':
      return (
        <svg width={size} height={size} viewBox="0 0 36 36" fill="none" aria-hidden="true">
          <circle cx="18" cy="18" r="13.5" fill="#8CC4B4" fillOpacity="0.24" />
          <path
            d="M11 24.5C11.5 16.5 16.5 10.5 25.5 10C25 18.5 19.5 24 11 24.5Z"
            fill="#7DB7A7"
            fillOpacity="0.85"
            stroke="#3E7266"
            strokeWidth="1.25"
            strokeLinejoin="round"
          />
          <path d="M10.5 25.5C14.5 21.5 18.5 17.5 23 13.2" stroke="#3E7266" strokeWidth="1.2" strokeLinecap="round" />
          <circle cx="23.5" cy="23.5" r="2.2" fill="#B7DDD2" stroke="#4A8276" strokeWidth="1" />
        </svg>
      );
    case 'cozy':
      return (
        <svg width={size} height={size} viewBox="0 0 36 36" fill="none" aria-hidden="true">
          <circle cx="18" cy="18.5" r="13.5" fill="#E8B29C" fillOpacity="0.26" />
          <path
            d="M11 16.5H23.5V22.2C23.5 25.2 21 27.2 17.25 27.2C13.5 27.2 11 25.2 11 22.2V16.5Z"
            fill="#E7B39C"
            fillOpacity="0.88"
            stroke="#8B5A46"
            strokeWidth="1.25"
            strokeLinejoin="round"
          />
          <path
            d="M23.5 18.2H25.2C26.7 18.2 27.8 19.2 27.8 20.6C27.8 22 26.7 23 25.2 23H23.5"
            stroke="#8B5A46"
            strokeWidth="1.25"
            strokeLinecap="round"
          />
          <path
            d="M14.8 13.5C14.4 11.8 15.8 10.8 15.4 9.2M19.5 13.2C19.1 11.5 20.5 10.5 20.1 8.9"
            stroke="#B67F68"
            strokeWidth="1.2"
            strokeLinecap="round"
          />
        </svg>
      );
    case 'dreamy':
      return (
        <svg width={size} height={size} viewBox="0 0 36 36" fill="none" aria-hidden="true">
          <circle cx="18" cy="18" r="13.5" fill="#B9A6D6" fillOpacity="0.25" />
          <path
            d="M21.8 10.2C16.8 10.4 12.8 14.4 12.8 19.4C12.8 24.4 16.8 27.8 21.8 27.4C23.7 27.2 25.4 26.4 26.6 25.1C22.4 25.3 19.1 22.3 19.1 18.2C19.1 14.8 20.6 12 22.8 10.3C22.5 10.2 22.1 10.2 21.8 10.2Z"
            fill="#AE98CE"
            fillOpacity="0.88"
            stroke="#6B5987"
            strokeWidth="1.2"
            strokeLinejoin="round"
          />
          <circle cx="24.5" cy="13.5" r="1.4" fill="#D9A84E" />
          <circle cx="11.5" cy="12.8" r="1" fill="#9E89BF" />
        </svg>
      );
    case 'spark':
      return (
        <svg width={size} height={size} viewBox="0 0 36 36" fill="none" aria-hidden="true">
          <circle cx="18" cy="18" r="13.5" fill="#E6C97E" fillOpacity="0.26" />
          <circle cx="18" cy="11.5" r="3.4" fill="#FAF4E8" stroke="#A68246" strokeWidth="1.1" />
          <circle cx="24.2" cy="16" r="3.4" fill="#FAF4E8" stroke="#A68246" strokeWidth="1.1" />
          <circle cx="21.8" cy="23.2" r="3.4" fill="#FAF4E8" stroke="#A68246" strokeWidth="1.1" />
          <circle cx="14.2" cy="23.2" r="3.4" fill="#FAF4E8" stroke="#A68246" strokeWidth="1.1" />
          <circle cx="11.8" cy="16" r="3.4" fill="#FAF4E8" stroke="#A68246" strokeWidth="1.1" />
          <circle cx="18" cy="18" r="3.8" fill="#E3B354" stroke="#9B722E" strokeWidth="1.15" />
        </svg>
      );
  }
}

function toLocalDateKey(date: Date): string {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

function loadCheckedDates(): string[] {
  if (typeof window === 'undefined') return [];
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return Array.from(new Set(parsed.filter((v): v is string => typeof v === 'string'))).sort();
  } catch {
    return [];
  }
}

function saveCheckedDates(dates: string[]): void {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(dates));
  } catch {
    // ignore storage quota failures
  }
}

function loadDailyMoods(): Record<string, MoodStickerId> {
  if (typeof window === 'undefined') return {};
  try {
    const raw = window.localStorage.getItem(MOODS_STORAGE_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== 'object') return {};
    return parsed as Record<string, MoodStickerId>;
  } catch {
    return {};
  }
}

function saveDailyMoods(moods: Record<string, MoodStickerId>): void {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.setItem(MOODS_STORAGE_KEY, JSON.stringify(moods));
  } catch {
    // ignore storage quota failures
  }
}

function computeStreak(datesSet: Set<string>, today: Date): number {
  let streak = 0;
  const cursor = new Date(today.getFullYear(), today.getMonth(), today.getDate());
  if (!datesSet.has(toLocalDateKey(cursor))) {
    cursor.setDate(cursor.getDate() - 1);
  }
  while (datesSet.has(toLocalDateKey(cursor))) {
    streak += 1;
    cursor.setDate(cursor.getDate() - 1);
  }
  return streak;
}

function getGrowthStage(totalDays: number, checkedToday: boolean): {
  title: string;
  level: 0 | 1 | 2 | 3;
} {
  if (!checkedToday && totalDays === 0) {
    return { title: '静待破土', level: 0 };
  }
  if (totalDays >= 7) {
    return { title: '繁花初绽', level: 3 };
  }
  if (totalDays >= 3) {
    return { title: '抽枝展叶', level: 2 };
  }
  return { title: '破土萌芽', level: 1 };
}

interface NutShellDiaryCheckInProps {
  personalDollCount?: number;
  draftCardCount?: number;
}

export function NutShellDiaryCheckIn({
  personalDollCount = 0,
  draftCardCount = 0,
}: NutShellDiaryCheckInProps) {
  const [checkedDates, setCheckedDates] = useState<string[]>(() => loadCheckedDates());
  const [dailyMoods, setDailyMoods] = useState<Record<string, MoodStickerId>>(() => loadDailyMoods());
  const [justChecked, setJustChecked] = useState(false);
  const [moodDropSeq, setMoodDropSeq] = useState(0);
  const [moodBloom, setMoodBloom] = useState<{ mood: MoodStickerMeta; seq: number } | null>(null);

  const checkTimerRef = useRef<number | null>(null);
  const trayTimerRef = useRef<number | null>(null);
  const bloomTimerRef = useRef<number | null>(null);

  useEffect(() => {
    return () => {
      if (checkTimerRef.current !== null) window.clearTimeout(checkTimerRef.current);
      if (trayTimerRef.current !== null) window.clearTimeout(trayTimerRef.current);
      if (bloomTimerRef.current !== null) window.clearTimeout(bloomTimerRef.current);
    };
  }, []);

  const today = useMemo(() => new Date(), []);
  const todayKey = useMemo(() => toLocalDateKey(today), [today]);

  const checkedSet = useMemo(() => new Set(checkedDates), [checkedDates]);
  const checkedToday = checkedSet.has(todayKey);
  const todayMoodId = dailyMoods[todayKey];
  const todayMood = MOOD_STICKERS.find((m) => m.id === todayMoodId) ?? null;

  const [stickerTrayOpen, setStickerTrayOpen] = useState<boolean>(
    () => checkedSet.has(todayKey) && !dailyMoods[todayKey]
  );
  const [calendarOpen, setCalendarOpen] = useState(false);

  const moodPaletteMap = useMemo(() => {
    const map = {} as Record<MoodStickerId, CalendarMoodPalette>;
    for (const m of MOOD_STICKERS) {
      map[m.id] = {
        id: m.id,
        label: m.label,
        dotColor: m.dropletColor,
        haloColor: m.washPrimary,
        tintBg: m.tintBg,
        tintBorder: m.tintBorder,
      };
    }
    return map;
  }, []);

  const toggleCalendar = () => {
    haptic('selection');
    setCalendarOpen((prev) => {
      if (!prev) setStickerTrayOpen(false);
      return !prev;
    });
  };

  const streak = useMemo(() => computeStreak(checkedSet, today), [checkedSet, today]);
  const totalDays = checkedDates.length;
  const stage = useMemo(() => getGrowthStage(totalDays, checkedToday), [totalDays, checkedToday]);

  const weekDays = useMemo(() => {
    const jsDay = today.getDay(); // 0=Sun..6=Sat
    const mondayOffset = jsDay === 0 ? -6 : 1 - jsDay;
    const monday = new Date(today.getFullYear(), today.getMonth(), today.getDate() + mondayOffset);
    return WEEKDAY_LABELS.map((label, idx) => {
      const d = new Date(monday.getFullYear(), monday.getMonth(), monday.getDate() + idx);
      const key = toLocalDateKey(d);
      return {
        label,
        key,
        dayNum: d.getDate(),
        isToday: key === todayKey,
        checked: checkedSet.has(key),
      };
    });
  }, [checkedSet, today, todayKey]);

  const formattedDate = useMemo(() => {
    const m = today.getMonth() + 1;
    const d = today.getDate();
    const wk = ['日', '一', '二', '三', '四', '五', '六'][today.getDay()];
    return `${m}月${d}日 · 周${wk}`;
  }, [today]);

  const dailyNote = todayMood
    ? todayMood.note
    : DAILY_NOTES[(today.getDate() + totalDays) % DAILY_NOTES.length];

  const handleCheckIn = () => {
    if (checkedToday) {
      haptic('selection');
      return;
    }
    haptic('success');
    const next = Array.from(new Set([...checkedDates, todayKey])).sort();
    setCheckedDates(next);
    saveCheckedDates(next);
    setJustChecked(true);
    setStickerTrayOpen(true);
    if (checkTimerRef.current !== null) window.clearTimeout(checkTimerRef.current);
    checkTimerRef.current = window.setTimeout(() => setJustChecked(false), 2200);
  };

  const handlePickMood = (moodId: MoodStickerId) => {
    const chosen = MOOD_STICKERS.find((m) => m.id === moodId);
    if (!chosen) return;
    haptic('success');

    const next = { ...dailyMoods, [todayKey]: moodId };
    setDailyMoods(next);
    saveDailyMoods(next);

    const nextSeq = moodDropSeq + 1;
    setMoodDropSeq(nextSeq);
    setMoodBloom({ mood: chosen, seq: nextSeq });

    if (trayTimerRef.current !== null) window.clearTimeout(trayTimerRef.current);
    trayTimerRef.current = window.setTimeout(() => {
      setStickerTrayOpen(false);
    }, 240);

    if (bloomTimerRef.current !== null) window.clearTimeout(bloomTimerRef.current);
    bloomTimerRef.current = window.setTimeout(() => {
      setMoodBloom((curr) => (curr?.seq === nextSeq ? null : curr));
    }, 1650);
  };

  const hasSprouted = checkedToday || totalDays > 0;
  const showBlossom = stage.level >= 2 || checkedToday;

  return (
    <motion.section
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.34, ease: EASE_ORGANIC }}
      aria-label="果壳日记每日签到"
      className="studio-card wc-diary-surface rounded-[18px] sm:rounded-2xl p-3.5 sm:p-5 overflow-hidden relative space-y-3"
    >
      {/* Subtle persistent mood watercolor ambient wash on diary paper */}
      {todayMood && (
        <motion.div
          key={`ambient-${todayMood.id}`}
          aria-hidden="true"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ duration: 0.75, ease: EASE_ORGANIC }}
          className="pointer-events-none absolute inset-0 z-0"
          style={{
            background: `radial-gradient(circle at 22% 24%, ${todayMood.washSecondary} 0%, transparent 56%)`,
          }}
        />
      )}

      {/* Micro Watercolor Pigment Diffusion Wave on Mood Sticker Selection */}
      <AnimatePresence>
        {moodBloom && (
          <motion.div
            key={`card-bloom-${moodBloom.seq}`}
            aria-hidden="true"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.3 }}
            className="pointer-events-none absolute inset-0 z-0 overflow-hidden"
          >
            <motion.span
              initial={{ scale: 0.25, opacity: 0 }}
              animate={{ scale: [0.25, 1.35, 1.78], opacity: [0, 0.72, 0] }}
              transition={{ duration: 1.45, delay: 0.28, ease: EASE_ORGANIC }}
              className="absolute -top-10 left-[14%] sm:left-[18%] w-52 h-52 rounded-full blur-2xl"
              style={{
                background: `radial-gradient(circle, ${moodBloom.mood.washPrimary} 0%, ${moodBloom.mood.washSecondary} 48%, transparent 74%)`,
              }}
            />
            <motion.span
              initial={{ scale: 0.35, opacity: 0 }}
              animate={{ scale: [0.35, 1.25, 1.6], opacity: [0, 0.48, 0] }}
              transition={{ duration: 1.25, delay: 0.38, ease: 'easeOut' }}
              className="absolute -top-2 left-[19%] sm:left-[22%] w-36 h-36 rounded-full blur-xl"
              style={{
                background: `radial-gradient(circle, ${moodBloom.mood.washSecondary} 0%, transparent 70%)`,
              }}
            />
          </motion.div>
        )}
      </AnimatePresence>

      <div className="relative z-10 flex flex-col md:flex-row md:items-center justify-between gap-3.5 sm:gap-5">
        {/* Left: Botanical Sprout Emblem + Compact Diary Info */}
        <div className="flex items-center gap-3.5 sm:gap-4 min-w-0">
          {/* Interactive Botanical Acorn & Growing Sprout Medallion */}
          <div className="relative w-[60px] h-[60px] sm:w-[72px] sm:h-[72px] shrink-0 rounded-full bg-white/88 border border-[#E7DED1] shadow-[0_3px_12px_rgba(74,130,118,0.08)] flex items-center justify-center">
            {/* Soft watercolor dew ripple on check-in */}
            <AnimatePresence>
              {justChecked && (
                <>
                  <motion.span
                    key="dew-ring-1"
                    initial={{ scale: 0.65, opacity: 0.65 }}
                    animate={{ scale: 1.5, opacity: 0 }}
                    exit={{ opacity: 0 }}
                    transition={{ duration: 0.9, ease: 'easeOut' }}
                    className="absolute inset-0 rounded-full border-2 border-[#4A8276]/45 pointer-events-none"
                  />
                  <motion.span
                    key="dew-ring-2"
                    initial={{ scale: 0.75, opacity: 0.55 }}
                    animate={{ scale: 1.32, opacity: 0 }}
                    exit={{ opacity: 0 }}
                    transition={{ duration: 0.74, delay: 0.12, ease: 'easeOut' }}
                    className="absolute inset-0 rounded-full bg-[#4A8276]/15 pointer-events-none"
                  />
                </>
              )}
            </AnimatePresence>

            <svg
              viewBox="0 0 80 80"
              className="w-[50px] h-[50px] sm:w-[60px] sm:h-[60px] overflow-visible"
              fill="none"
              aria-hidden="true"
            >
              <ellipse cx="40" cy="64" rx="22" ry="5.5" fill="#4A8276" fillOpacity="0.11" />

              {/* Growing Botanical Stem */}
              <motion.path
                d="M40 50 C40 42, 39.5 34, 40.5 23"
                stroke="#4A8276"
                strokeWidth="2.5"
                strokeLinecap="round"
                initial={false}
                animate={{
                  pathLength: hasSprouted ? 1 : 0,
                  opacity: hasSprouted ? 1 : 0,
                }}
                transition={{ duration: 0.62, ease: EASE_ORGANIC }}
              />

              {/* Left Tender Watercolor Leaf */}
              <motion.path
                d="M40 37 C31 35, 25 29, 26 23 C33 23, 39 29, 40 37 Z"
                fill="#7EB3A4"
                fillOpacity="0.82"
                stroke="#4A8276"
                strokeWidth="1.5"
                strokeLinejoin="round"
                style={{ originX: '40px', originY: '37px' }}
                initial={false}
                animate={
                  hasSprouted
                    ? {
                        scale: 1,
                        rotate: justChecked ? [0, -7, 3, 0] : 0,
                        opacity: 1,
                      }
                    : { scale: 0, rotate: -22, opacity: 0 }
                }
                transition={{
                  scale: { type: 'spring', stiffness: 260, damping: 18, delay: 0.24 },
                  rotate: { duration: 0.9, delay: 0.3, ease: 'easeInOut' },
                  opacity: { duration: 0.3, delay: 0.2 },
                }}
              />

              {/* Right Tender Watercolor Leaf */}
              <motion.path
                d="M40.3 32 C49.5 30, 56 23.5, 54.5 17.5 C47.5 18, 41.5 24, 40.3 32 Z"
                fill="#5A9688"
                fillOpacity="0.86"
                stroke="#3D6E63"
                strokeWidth="1.5"
                strokeLinejoin="round"
                style={{ originX: '40px', originY: '32px' }}
                initial={false}
                animate={
                  hasSprouted
                    ? {
                        scale: 1,
                        rotate: justChecked ? [0, 8, -3, 0] : 0,
                        opacity: 1,
                      }
                    : { scale: 0, rotate: 24, opacity: 0 }
                }
                transition={{
                  scale: { type: 'spring', stiffness: 260, damping: 17, delay: 0.34 },
                  rotate: { duration: 0.95, delay: 0.38, ease: 'easeInOut' },
                  opacity: { duration: 0.3, delay: 0.3 },
                }}
              />

              {/* Tiny Warm-Gold Blossom / Dewdrop Bud at Tip */}
              <motion.circle
                cx="40.6"
                cy="19.5"
                r="3.2"
                fill="#D9A84E"
                stroke="#FAF7F2"
                strokeWidth="1"
                initial={false}
                animate={
                  showBlossom
                    ? { scale: justChecked ? [0, 1.35, 1] : 1, opacity: 1 }
                    : { scale: 0, opacity: 0 }
                }
                transition={{ duration: 0.55, delay: 0.45, ease: EASE_ORGANIC }}
              />

              {justChecked && (
                <>
                  <motion.circle
                    cx="24"
                    cy="17"
                    r="1.8"
                    fill="#D9A84E"
                    initial={{ opacity: 0, y: 6, scale: 0 }}
                    animate={{ opacity: [0, 1, 0], y: -5, scale: [0, 1.1, 0.7] }}
                    transition={{ duration: 0.95, delay: 0.25 }}
                  />
                  <motion.circle
                    cx="57"
                    cy="14"
                    r="1.5"
                    fill="#4A8276"
                    initial={{ opacity: 0, y: 6, scale: 0 }}
                    animate={{ opacity: [0, 1, 0], y: -6, scale: [0, 1.2, 0.7] }}
                    transition={{ duration: 0.9, delay: 0.35 }}
                  />
                </>
              )}

              {/* Warm Handcrafted Acorn Shell Base */}
              <motion.g
                animate={justChecked ? { y: [0, 1.5, 0] } : { y: 0 }}
                transition={{ duration: 0.45, ease: EASE_ORGANIC }}
              >
                <path
                  d="M27.5 52.5 C27.5 47.8, 33 45.2, 40 45.2 C47 45.2, 52.5 47.8, 52.5 52.5 Z"
                  fill="#B48C68"
                  stroke="#5C4435"
                  strokeWidth="1.5"
                  strokeLinejoin="round"
                />
                <path
                  d="M29.8 52.5 C29.8 59.5, 34.4 64.2, 40 65.4 C45.6 64.2, 50.2 59.5, 50.2 52.5 Z"
                  fill="#E8D2B5"
                  stroke="#5C4435"
                  strokeWidth="1.5"
                  strokeLinejoin="round"
                />
                <circle cx="35.8" cy="57.2" r="1.15" fill="#5C4435" />
                <circle cx="44.2" cy="57.2" r="1.15" fill="#5C4435" />
                <circle cx="40" cy="59" r="1.25" fill="#D16250" fillOpacity="0.85" />
              </motion.g>
            </svg>
          </div>

          {/* Diary Header, Date Card & Pasted Watercolor Mood Sticker */}
          <div className="min-w-0 flex-1 space-y-1">
            <div className="flex flex-wrap items-center gap-1.5">
              {/* Interactive Stationery Date Card (Tap to toggle Month Calendar) */}
              <button
                type="button"
                onClick={toggleCalendar}
                aria-expanded={calendarOpen}
                title="点击展开或收起月历视图"
                className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-lg border text-[10.5px] transition-colors ${
                  calendarOpen
                    ? 'bg-[#ECF5F2] border-[#4A8276]/45 text-[#28584D]'
                    : 'bg-white/85 border-[#E9DFD2] hover:border-[#C5D9D2]'
                }`}
              >
                <span className="font-mono uppercase tracking-[0.1em] text-[#4A8276] text-[9.5px]">
                  Diary
                </span>
                <span className="text-[#D4C7B8]" aria-hidden="true">·</span>
                <span className="text-[#6E5C50] font-medium">{formattedDate}</span>
              </button>

              {/* Feather-Light Drifting & Pasted Watercolor Mood Sticker beside Date Card */}
              <div className="relative inline-flex items-center">
                {/* Localized Watercolor Pigment Diffusion & Dew Droplets on Sticker Landing */}
                <AnimatePresence>
                  {moodBloom && (
                    <motion.span
                      key={`slot-bloom-${moodBloom.seq}`}
                      aria-hidden="true"
                      className="pointer-events-none absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 z-0"
                    >
                      {/* Expanding watercolor pigment halo */}
                      <motion.span
                        initial={{ scale: 0.2, opacity: 0 }}
                        animate={{ scale: [0.2, 1.55, 2.25], opacity: [0, 0.78, 0] }}
                        exit={{ opacity: 0 }}
                        transition={{ duration: 1.05, delay: 0.34, ease: EASE_ORGANIC }}
                        className="block w-14 h-14 -ml-7 -mt-7 rounded-full blur-[5px]"
                        style={{
                          background: `radial-gradient(circle, ${moodBloom.mood.washPrimary} 0%, ${moodBloom.mood.washSecondary} 54%, transparent 76%)`,
                        }}
                      />
                      {/* Delicate wet-edge watercolor ring */}
                      <motion.span
                        initial={{ scale: 0.45, opacity: 0 }}
                        animate={{ scale: [0.45, 1.4, 1.85], opacity: [0, 0.65, 0] }}
                        exit={{ opacity: 0 }}
                        transition={{ duration: 0.88, delay: 0.4, ease: 'easeOut' }}
                        className="absolute left-1/2 top-1/2 -ml-6 -mt-6 w-12 h-12 rounded-full border"
                        style={{ borderColor: moodBloom.mood.ringColor }}
                      />
                      {/* Micro watercolor mist droplets */}
                      {MICRO_DROPLETS.map((drop) => (
                        <motion.span
                          key={drop.id}
                          initial={{ x: 0, y: 0, scale: 0, opacity: 0 }}
                          animate={{
                            x: [0, drop.x * 0.65, drop.x],
                            y: [0, drop.y * 0.65, drop.y],
                            scale: [0, 1.15, 0.45],
                            opacity: [0, 0.85, 0],
                          }}
                          transition={{
                            duration: 0.78,
                            delay: drop.delay,
                            ease: EASE_ORGANIC,
                          }}
                          className="absolute left-0 top-0 rounded-full"
                          style={{
                            width: drop.size,
                            height: drop.size,
                            backgroundColor: moodBloom.mood.dropletColor,
                          }}
                        />
                      ))}
                    </motion.span>
                  )}
                </AnimatePresence>

                <AnimatePresence mode="wait">
                  {todayMood && (
                    <motion.button
                      key={`${todayMood.id}-${moodDropSeq}`}
                      type="button"
                      onClick={() => {
                        haptic('selection');
                        setCalendarOpen(false);
                        setStickerTrayOpen((v) => !v);
                      }}
                      title="点击更换今日心情贴纸"
                      initial={
                        moodDropSeq > 0
                          ? { opacity: 0, x: 16, y: -30, scale: 1.24, rotate: 12 }
                          : false
                      }
                      animate={
                        moodDropSeq > 0
                          ? {
                              opacity: [0, 0.96, 1, 1],
                              x: [16, -5, 2, 0],
                              y: [-30, -11, 2.5, 0],
                              scale: [1.24, 1.07, 0.95, 1],
                              rotate: [12, -8, 3.5, -1.8],
                            }
                          : { opacity: 1, x: 0, y: 0, scale: 1, rotate: -1.8 }
                      }
                      exit={{ opacity: 0, scale: 0.78, y: -6, rotate: 6, transition: { duration: 0.18 } }}
                      transition={
                        moodDropSeq > 0
                          ? {
                              duration: 0.76,
                              times: [0, 0.48, 0.78, 1],
                              ease: EASE_ORGANIC,
                            }
                          : { duration: 0.25 }
                      }
                      className={`relative z-10 inline-flex items-center gap-1 pl-1 pr-2 py-0.5 rounded-full border ${todayMood.tintBg} ${todayMood.tintBorder} shadow-[0_2px_8px_rgba(92,68,53,0.10)] active:scale-95 transition-transform`}
                    >
                      {/* Delicate washi-tape highlight strip appearing as sticker settles */}
                      <motion.span
                        aria-hidden="true"
                        initial={moodDropSeq > 0 ? { opacity: 0, scaleX: 0.4 } : false}
                        animate={{ opacity: 0.7, scaleX: 1 }}
                        transition={{ duration: 0.35, delay: moodDropSeq > 0 ? 0.52 : 0 }}
                        className="pointer-events-none absolute -top-1 left-1/2 -translate-x-1/2 w-4 h-[3px] rounded-full bg-white/85 shadow-[0_0.5px_1px_rgba(92,68,53,0.14)]"
                      />
                      <WatercolorMoodIcon id={todayMood.id} size={18} />
                      <span className="text-[10.5px] font-medium text-[#4D3D33]">
                        {todayMood.label}
                      </span>
                    </motion.button>
                  )}
                </AnimatePresence>
              </div>
            </div>

            <div className="flex flex-wrap items-baseline gap-2">
              <h2 className="font-editorial text-[16px] sm:text-[18px] font-semibold text-[#382A22] tracking-tight">
                果壳日记
              </h2>
              <span className="text-[11px] font-medium text-[#4A8276]">
                {stage.title}
                {streak > 0 ? ` · 连续 ${streak} 天` : ` · 累计 ${totalDays} 天`}
              </span>
            </div>

            <p className="text-[12px] text-[#6E5C50] leading-snug line-clamp-1 sm:line-clamp-2">
              {checkedToday
                ? dailyNote
                : `为小芽浇水签到，记录今日心情 · 专属 ${personalDollCount} 只${draftCardCount > 0 ? ` · 草稿 ${draftCardCount}` : ''}`}
            </p>
          </div>
        </div>

        {/* Right: Compact 7-Day Stamp Row + Check-in Button */}
        <div className="flex items-center justify-between md:flex-col md:items-end gap-2.5 pt-2.5 md:pt-0 border-t md:border-t-0 border-[#EFE6DA]/85 shrink-0">
          {/* 7-Day Stationery Stamp Strip */}
          <div className="flex items-center gap-1.5">
            {weekDays.map((day) => (
              <div key={day.key} className="flex flex-col items-center gap-0.5">
                <span
                  className={`text-[9.5px] font-medium ${
                    day.isToday ? 'text-[#4A8276]' : 'text-[#A29183]'
                  }`}
                >
                  {day.label}
                </span>
                <motion.div
                  animate={day.isToday && justChecked ? { scale: [1, 1.22, 1] } : { scale: 1 }}
                  transition={{ duration: 0.42, ease: EASE_ORGANIC }}
                  className={`w-6 h-6 rounded-full flex items-center justify-center text-[10px] font-mono transition-colors ${
                    day.checked
                      ? 'bg-[#4A8276] text-white shadow-[0_2px_5px_rgba(74,130,118,0.22)]'
                      : day.isToday
                      ? 'bg-white border border-dashed border-[#4A8276] text-[#4A8276] font-semibold'
                      : 'bg-white/75 border border-[#E8DFD2] text-[#A9988A]'
                  }`}
                  title={`${day.key}${day.checked ? ' 已签到' : ''}`}
                >
                  {day.checked ? <Check className="w-3 h-3" strokeWidth={2.4} /> : day.dayNum}
                </motion.div>
              </div>
            ))}
          </div>

          {/* Compact One-Tap Water / Check-in CTA + Month Calendar Toggle */}
          <div className="flex items-center gap-2.5 shrink-0">
            <button
              type="button"
              onClick={toggleCalendar}
              aria-expanded={calendarOpen}
              className={`inline-flex items-center gap-1 text-[11.5px] font-medium btn-icon-ghost whitespace-nowrap py-1 ${
                calendarOpen ? 'text-[#28584D]' : 'text-[#6E5C50]'
              }`}
            >
              <CalendarDays className="w-3.5 h-3.5 text-[#4A8276]" />
              <span>{calendarOpen ? '收起月历' : '月历'}</span>
            </button>

            {checkedToday ? (
              <>
                <span className="hidden sm:inline-flex items-center gap-1 text-[11px] font-medium text-[#4A8276]">
                  <Sparkles className="w-3 h-3" />
                  <span>已签到</span>
                </span>
                <button
                  type="button"
                  onClick={() => {
                    haptic('selection');
                    setCalendarOpen(false);
                    setStickerTrayOpen((v) => !v);
                  }}
                  className="text-[11.5px] font-medium btn-icon-ghost text-[#4A8276] whitespace-nowrap py-1"
                >
                  {stickerTrayOpen ? '收起贴纸' : todayMood ? '换贴纸' : '贴心情'}
                </button>
              </>
            ) : (
              <button
                type="button"
                onClick={handleCheckIn}
                className="inline-flex items-center justify-center gap-1.5 px-3.5 py-1.5 text-[12px] font-medium btn-stamp-water whitespace-nowrap shrink-0"
              >
                <Droplets className="w-3.5 h-3.5 text-[#3B7366]" />
                <span>浇水签到</span>
              </button>
            )}
          </div>
        </div>
      </div>

      {/* Watercolor Mood Sticker Tray (Unfolds gracefully after check-in) */}
      <AnimatePresence initial={false}>
        {checkedToday && stickerTrayOpen && (
          <motion.div
            key="mood-sticker-tray"
            initial={{ opacity: 0, height: 0 }}
            animate={{ opacity: 1, height: 'auto' }}
            exit={{ opacity: 0, height: 0 }}
            transition={{ duration: 0.28, ease: EASE_ORGANIC }}
            className="relative z-10 overflow-hidden"
          >
            <div className="pt-3 border-t border-dashed border-[#E8DEC9] space-y-2">
              <div className="flex items-center justify-between gap-2 text-[11px]">
                <span className="font-medium text-[#5C4B40]">
                  选一枚今日水彩贴纸，轻落贴在日期卡片旁
                </span>
                {todayMood && (
                  <span className="text-[#9A887B]">已贴「{todayMood.label}」</span>
                )}
              </div>

              <div className="grid grid-cols-5 gap-1.5 sm:gap-2.5">
                {MOOD_STICKERS.map((sticker, idx) => {
                  const selected = todayMoodId === sticker.id;
                  return (
                    <motion.button
                      key={sticker.id}
                      type="button"
                      data-pressable="card"
                      initial={{ opacity: 0, y: 5 }}
                      animate={{ opacity: 1, y: 0 }}
                      whileHover={{ y: -2, scale: 1.03 }}
                      whileTap={{ scale: 0.92, y: -4 }}
                      transition={{ duration: 0.26, delay: idx * 0.035, ease: EASE_ORGANIC }}
                      onClick={() => handlePickMood(sticker.id)}
                      className={`flex flex-col items-center justify-center gap-0.5 py-2 px-1 rounded-2xl border transition-colors ${
                        selected
                          ? `${sticker.tintBg} ${sticker.tintBorder} ring-1 ring-[#4A8276]/30`
                          : 'bg-white/80 border-[#ECE3D6] hover:border-[#CFC4B5]'
                      }`}
                    >
                      <WatercolorMoodIcon id={sticker.id} size={26} />
                      <span
                        className={`text-[10.5px] font-medium ${
                          selected ? 'text-[#382A22]' : 'text-[#7D6C5F]'
                        }`}
                      >
                        {sticker.label}
                      </span>
                    </motion.button>
                  );
                })}
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Monthly Calendar View with Watercolor Mood Stamp Dots & Daily Dialogue Summary */}
      <AnimatePresence initial={false}>
        {calendarOpen && (
          <motion.div
            key="diary-month-calendar"
            initial={{ opacity: 0, height: 0 }}
            animate={{ opacity: 1, height: 'auto' }}
            exit={{ opacity: 0, height: 0 }}
            transition={{ duration: 0.3, ease: EASE_ORGANIC }}
            className="relative z-10 overflow-hidden"
          >
            <NutShellDiaryCalendar
              todayKey={todayKey}
              checkedSet={checkedSet}
              dailyMoods={dailyMoods}
              moodPaletteMap={moodPaletteMap}
              renderMoodIcon={(id, size) => <WatercolorMoodIcon id={id} size={size} />}
            />
          </motion.div>
        )}
      </AnimatePresence>
    </motion.section>
  );
}
