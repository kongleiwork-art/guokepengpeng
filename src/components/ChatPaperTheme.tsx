import { useEffect, useRef, useState } from 'react';
import { AnimatePresence, motion } from 'motion/react';
import { Check } from 'lucide-react';
import { haptic } from '../lib/haptics';

export type ChatPaperTextureId = 'washi' | 'linen' | 'cotton';
export type ChatSeasonId = 'spring' | 'summer' | 'autumn' | 'winter';
export type ChatSeasonMode = 'auto' | ChatSeasonId;
export type ChatDayPhaseId = 'morning' | 'noon' | 'night';
export type ChatDayPhaseMode = 'auto' | ChatDayPhaseId;

export interface ChatPaperThemeOption {
  id: ChatPaperTextureId;
  label: string;
  craftNote: string;
  baseTint: string;
  overlayClass: string;
  seasonPaperClass: string;
  swatchDotBg: string;
}

export interface ChatSeasonMeta {
  id: ChatSeasonId;
  label: string;
  shortLabel: string;
  lightNote: string;
  filterClass: string;
  accentColor: string;
  swatchTint: string;
}

export interface ChatDayPhaseMeta {
  id: ChatDayPhaseId;
  label: string;
  shortLabel: string;
  lightNote: string;
  phaseClass: string;
  accentColor: string;
  swatchOverlay: string;
}

export const CHAT_PAPER_THEMES: readonly ChatPaperThemeOption[] = [
  {
    id: 'washi',
    label: '和纸',
    craftNote: '桑皮纤纹',
    baseTint: '#FCF9F3',
    overlayClass: 'chat-texture-washi',
    seasonPaperClass: 'season-paper-washi',
    swatchDotBg: '#F6EFE2',
  },
  {
    id: 'linen',
    label: '亚麻',
    craftNote: '细密经纬',
    baseTint: '#F6F1E7',
    overlayClass: 'chat-texture-linen',
    seasonPaperClass: 'season-paper-linen',
    swatchDotBg: '#ECE3D3',
  },
  {
    id: 'cotton',
    label: '棉布',
    craftNote: '柔韧斜纹',
    baseTint: '#F9F7F3',
    overlayClass: 'chat-texture-cotton',
    seasonPaperClass: 'season-paper-cotton',
    swatchDotBg: '#F1EDE6',
  },
] as const;

export const CHAT_SEASONS: readonly ChatSeasonMeta[] = [
  {
    id: 'spring',
    label: '春 · 柔绿光',
    shortLabel: '春',
    lightNote: '春芽柔绿光',
    filterClass: 'chat-season-spring',
    accentColor: '#5B9A7D',
    swatchTint: 'radial-gradient(circle at 30% 28%, rgba(118,184,150,0.34), transparent 72%)',
  },
  {
    id: 'summer',
    label: '夏 · 清风辉',
    shortLabel: '夏',
    lightNote: '夏荫清风辉',
    filterClass: 'chat-season-summer',
    accentColor: '#5A9E99',
    swatchTint: 'radial-gradient(circle at 30% 28%, rgba(116,186,182,0.34), transparent 72%)',
  },
  {
    id: 'autumn',
    label: '秋 · 暖金光',
    shortLabel: '秋',
    lightNote: '秋阳暖金光',
    filterClass: 'chat-season-autumn',
    accentColor: '#C9963B',
    swatchTint: 'radial-gradient(circle at 30% 28%, rgba(226,174,88,0.38), transparent 72%)',
  },
  {
    id: 'winter',
    label: '冬 · 雪霁光',
    shortLabel: '冬',
    lightNote: '冬窗雪霁光',
    filterClass: 'chat-season-winter',
    accentColor: '#7698AF',
    swatchTint: 'radial-gradient(circle at 30% 28%, rgba(164,192,210,0.34), transparent 72%)',
  },
] as const;

export const CHAT_DAY_PHASES: readonly ChatDayPhaseMeta[] = [
  {
    id: 'morning',
    label: '早晨 · 柔和暖光',
    shortLabel: '晨',
    lightNote: '早晨柔和暖光',
    phaseClass: 'chat-day-morning',
    accentColor: '#C68B3E',
    swatchOverlay: 'linear-gradient(140deg, rgba(244,198,132,0.28), transparent 68%)',
  },
  {
    id: 'noon',
    label: '正午 · 清透光',
    shortLabel: '午',
    lightNote: '正午清透光',
    phaseClass: 'chat-day-noon',
    accentColor: '#4A8276',
    swatchOverlay: 'radial-gradient(circle at 50% 10%, rgba(255,255,255,0.45), transparent 72%)',
  },
  {
    id: 'night',
    label: '夜晚 · 静谧冷光',
    shortLabel: '夜',
    lightNote: '夜晚静谧冷光',
    phaseClass: 'chat-day-night',
    accentColor: '#5C7B99',
    swatchOverlay: 'linear-gradient(160deg, rgba(102,132,168,0.28), rgba(78,98,128,0.14))',
  },
] as const;

const STORAGE_KEY = 'nutshell_chat_paper_texture';
const SEASON_STORAGE_KEY = 'nutshell_chat_season_mode';
const DAY_PHASE_STORAGE_KEY = 'nutshell_chat_day_phase_mode';

/**
 * Automatically detects the meteorological season from the user's local clock.
 * Spring: Mar–May | Summer: Jun–Aug | Autumn: Sep–Nov | Winter: Dec–Feb
 */
export function detectCurrentSeason(date: Date = new Date()): ChatSeasonId {
  const month = date.getMonth() + 1;
  if (month >= 3 && month <= 5) return 'spring';
  if (month >= 6 && month <= 8) return 'summer';
  if (month >= 9 && month <= 11) return 'autumn';
  return 'winter';
}

/**
 * Automatically detects the day/night phase from the user's local clock.
 * Morning: 05:00–10:59 | Noon: 11:00–17:59 | Night: 18:00–04:59
 */
export function detectCurrentDayPhase(date: Date = new Date()): ChatDayPhaseId {
  const hour = date.getHours();
  if (hour >= 5 && hour < 11) return 'morning';
  if (hour >= 11 && hour < 18) return 'noon';
  return 'night';
}

export function resolveChatSeason(mode: ChatSeasonMode = 'auto', date?: Date): ChatSeasonMeta {
  const resolvedId = mode === 'auto' ? detectCurrentSeason(date) : mode;
  return CHAT_SEASONS.find((s) => s.id === resolvedId) || CHAT_SEASONS[2];
}

export function resolveChatDayPhase(
  mode: ChatDayPhaseMode = 'auto',
  date?: Date
): ChatDayPhaseMeta {
  const resolvedId = mode === 'auto' ? detectCurrentDayPhase(date) : mode;
  return CHAT_DAY_PHASES.find((p) => p.id === resolvedId) || CHAT_DAY_PHASES[1];
}

export function loadChatPaperTexture(): ChatPaperTextureId {
  if (typeof window === 'undefined') return 'washi';
  try {
    const saved = window.localStorage.getItem(STORAGE_KEY);
    if (saved === 'washi' || saved === 'linen' || saved === 'cotton') {
      return saved;
    }
  } catch {
    // ignore storage restrictions
  }
  return 'washi';
}

export function saveChatPaperTexture(texture: ChatPaperTextureId): void {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.setItem(STORAGE_KEY, texture);
  } catch {
    // ignore storage restrictions
  }
}

export function loadChatSeasonMode(): ChatSeasonMode {
  if (typeof window === 'undefined') return 'auto';
  try {
    const saved = window.localStorage.getItem(SEASON_STORAGE_KEY);
    if (
      saved === 'auto' ||
      saved === 'spring' ||
      saved === 'summer' ||
      saved === 'autumn' ||
      saved === 'winter'
    ) {
      return saved;
    }
  } catch {
    // ignore storage restrictions
  }
  return 'auto';
}

export function saveChatSeasonMode(mode: ChatSeasonMode): void {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.setItem(SEASON_STORAGE_KEY, mode);
  } catch {
    // ignore storage restrictions
  }
}

export function loadChatDayPhaseMode(): ChatDayPhaseMode {
  if (typeof window === 'undefined') return 'auto';
  try {
    const saved = window.localStorage.getItem(DAY_PHASE_STORAGE_KEY);
    if (
      saved === 'auto' ||
      saved === 'morning' ||
      saved === 'noon' ||
      saved === 'night'
    ) {
      return saved;
    }
  } catch {
    // ignore storage restrictions
  }
  return 'auto';
}

export function saveChatDayPhaseMode(mode: ChatDayPhaseMode): void {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.setItem(DAY_PHASE_STORAGE_KEY, mode);
  } catch {
    // ignore storage restrictions
  }
}

export function getChatPaperTheme(id: ChatPaperTextureId): ChatPaperThemeOption {
  return CHAT_PAPER_THEMES.find((t) => t.id === id) || CHAT_PAPER_THEMES[0];
}

function useLiveClock(enabled: boolean): Date {
  const [now, setNow] = useState<Date>(() => new Date());

  useEffect(() => {
    if (!enabled) return;
    setNow(new Date());
    const timer = window.setInterval(() => {
      setNow(new Date());
    }, 60_000);
    return () => window.clearInterval(timer);
  }, [enabled]);

  return now;
}

interface ChatPaperOverlayProps {
  texture: ChatPaperTextureId;
  seasonMode?: ChatSeasonMode;
  dayPhaseMode?: ChatDayPhaseMode;
}

/**
 * Lightweight translucent Japanese stationery paper texture overlay with
 * season-aware dynamic ambient light and day/night intensity modulation.
 * Uses pure CSS patterns & compositor-only animations without blocking pointer events.
 */
export function ChatPaperOverlay({
  texture,
  seasonMode = 'auto',
  dayPhaseMode = 'auto',
}: ChatPaperOverlayProps) {
  const liveNow = useLiveClock(seasonMode === 'auto' || dayPhaseMode === 'auto');
  const theme = getChatPaperTheme(texture);
  const season = resolveChatSeason(seasonMode, liveNow);
  const dayPhase = resolveChatDayPhase(dayPhaseMode, liveNow);

  return (
    <div
      aria-hidden="true"
      className={`pointer-events-none absolute inset-0 z-0 overflow-hidden lg:rounded-2xl ${dayPhase.phaseClass}`}
    >
      {/* Layer 1: Base Japanese Stationery Paper Texture */}
      <AnimatePresence mode="wait" initial={false}>
        <motion.div
          key={theme.id}
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.34, ease: [0.22, 1, 0.36, 1] }}
          className={`absolute inset-0 ${theme.overlayClass}`}
        />
      </AnimatePresence>

      {/* Layer 2: Season-Aware Dynamic Ambient Light (intensity modulated by day/night phase) */}
      <AnimatePresence mode="wait" initial={false}>
        <motion.div
          key={`${season.id}-${theme.id}`}
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.55, ease: [0.22, 1, 0.36, 1] }}
          className={`absolute inset-0 ${season.filterClass} ${theme.seasonPaperClass}`}
        >
          <span className="absolute -inset-[12%] season-glow-primary" />
          <span className="absolute -inset-[10%] season-glow-secondary" />
          <span className="absolute -top-[18%] -left-[12%] w-[124%] h-[92%] season-sunbeam-sweep" />
        </motion.div>
      </AnimatePresence>

      {/* Layer 3: Day/Night Atmospheric Light Veil (Morning Warm / Noon Crisp / Night Cool) */}
      <AnimatePresence mode="wait" initial={false}>
        <motion.div
          key={dayPhase.id}
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.65, ease: [0.22, 1, 0.36, 1] }}
          className="absolute inset-0"
        >
          <span className="absolute -inset-[6%] day-phase-veil day-phase-layer" />
        </motion.div>
      </AnimatePresence>
    </div>
  );
}

interface ChatPaperPickerProps {
  value: ChatPaperTextureId;
  onChange: (next: ChatPaperTextureId) => void;
  seasonMode?: ChatSeasonMode;
  onSeasonModeChange?: (next: ChatSeasonMode) => void;
  dayPhaseMode?: ChatDayPhaseMode;
  onDayPhaseModeChange?: (next: ChatDayPhaseMode) => void;
}

/**
 * Compact Apple-style frosted stationery paper swatch switcher with
 * Season-Aware & Day/Night Ambient Light controls.
 */
export function ChatPaperPicker({
  value,
  onChange,
  seasonMode = 'auto',
  onSeasonModeChange,
  dayPhaseMode = 'auto',
  onDayPhaseModeChange,
}: ChatPaperPickerProps) {
  const [open, setOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement | null>(null);
  const liveNow = useLiveClock(open && (seasonMode === 'auto' || dayPhaseMode === 'auto'));
  const activeTheme = getChatPaperTheme(value);
  const autoSeason = resolveChatSeason('auto', liveNow);
  const activeSeason = resolveChatSeason(seasonMode, liveNow);
  const autoDayPhase = resolveChatDayPhase('auto', liveNow);
  const activeDayPhase = resolveChatDayPhase(dayPhaseMode, liveNow);

  useEffect(() => {
    if (!open) return;

    const handlePointerDown = (e: PointerEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    };

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        setOpen(false);
      }
    };

    document.addEventListener('pointerdown', handlePointerDown);
    document.addEventListener('keydown', handleKeyDown);
    return () => {
      document.removeEventListener('pointerdown', handlePointerDown);
      document.removeEventListener('keydown', handleKeyDown);
    };
  }, [open]);

  return (
    <div ref={containerRef} className="relative">
      <button
        type="button"
        onClick={() => {
          haptic('selection');
          setOpen((v) => !v);
        }}
        aria-expanded={open}
        aria-haspopup="menu"
        aria-label={`切换手帐纸张纹理，当前：${activeTheme.label} · ${activeSeason.lightNote} · ${activeDayPhase.lightNote}`}
        className={`inline-flex items-center gap-1.5 py-1.5 text-xs font-medium btn-icon-ghost whitespace-nowrap ${
          open ? 'text-[#356B5F]' : 'text-[#6E5C50]'
        }`}
      >
        <span
          aria-hidden="true"
          className={`relative w-3.5 h-3.5 rounded-full overflow-hidden border transition-colors ${
            open ? 'border-[#4A8276] ring-2 ring-[#4A8276]/20' : 'border-[#CFC3B2]'
          }`}
          style={{ backgroundColor: activeTheme.swatchDotBg }}
        >
          <span className={`absolute inset-0 ${activeTheme.overlayClass}`} />
          <span className="absolute inset-0" style={{ background: activeSeason.swatchTint }} />
          <span
            className="absolute inset-0"
            style={{ background: activeDayPhase.swatchOverlay }}
          />
        </span>
        <span>{activeTheme.label}</span>
      </button>

      <AnimatePresence>
        {open && (
          <motion.div
            role="menu"
            aria-label="选择手帐背景纸纹与季节昼夜光效"
            initial={{ opacity: 0, y: -6, scale: 0.96 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: -4, scale: 0.97 }}
            transition={{ duration: 0.2, ease: [0.22, 1, 0.36, 1] }}
            className="absolute right-0 top-full mt-2 z-40 w-[262px] rounded-[20px] p-3 border border-[#E4DACB]/90 bg-[#FFFDF9]/95 backdrop-blur-xl shadow-[0_14px_34px_-10px_rgba(56,42,34,0.22),0_2px_8px_rgba(56,42,34,0.06)] space-y-3"
          >
            <div>
              <div className="flex items-baseline justify-between px-0.5 mb-2.5">
                <span className="font-editorial text-[13px] font-semibold text-[#382A22]">
                  手帐纸纹
                </span>
                <span className="text-[10.5px] text-[#9A887B]">轻量透明叠层</span>
              </div>

              <div className="grid grid-cols-3 gap-2">
                {CHAT_PAPER_THEMES.map((theme) => {
                  const selected = theme.id === value;
                  return (
                    <button
                      key={theme.id}
                      type="button"
                      role="menuitemradio"
                      aria-checked={selected}
                      data-pressable="card"
                      onClick={() => {
                        haptic('selection');
                        onChange(theme.id);
                      }}
                      className={`group flex flex-col items-center gap-1.5 p-1.5 rounded-2xl border text-center transition-all duration-200 ${
                        selected
                          ? 'border-[#4A8276]/65 bg-[#ECF5F2]/75 shadow-[0_3px_10px_-3px_rgba(74,130,118,0.22)]'
                          : 'border-[#EAE2D6] bg-white/80 hover:border-[#C8BAA6] hover:bg-[#FAF7F2]'
                      }`}
                    >
                      <div
                        className="relative w-full h-11 rounded-xl overflow-hidden border border-[#E5DCCD]/80 shadow-[inset_0_1px_2px_rgba(56,42,34,0.04)]"
                        style={{ backgroundColor: theme.baseTint }}
                      >
                        <div className={`absolute inset-0 ${theme.overlayClass}`} />
                        <div
                          className="absolute inset-0"
                          style={{ background: activeSeason.swatchTint }}
                        />
                        <div
                          className="absolute inset-0"
                          style={{ background: activeDayPhase.swatchOverlay }}
                        />
                        {selected && (
                          <motion.span
                            initial={{ scale: 0.6, opacity: 0 }}
                            animate={{ scale: 1, opacity: 1 }}
                            className="absolute right-1.5 bottom-1.5 w-4 h-4 rounded-full bg-[#4A8276] text-white inline-flex items-center justify-center shadow-xs"
                          >
                            <Check className="w-2.5 h-2.5 stroke-[2.6]" />
                          </motion.span>
                        )}
                      </div>
                      <div className="leading-tight pb-0.5">
                        <div
                          className={`text-[12px] font-medium ${
                            selected ? 'text-[#2B5C51]' : 'text-[#382A22]'
                          }`}
                        >
                          {theme.label}
                        </div>
                        <div className="text-[10px] text-[#9A887B] mt-0.5">{theme.craftNote}</div>
                      </div>
                    </button>
                  );
                })}
              </div>
            </div>

            {/* Season-Aware Dynamic Light Filter Control */}
            <div className="pt-2.5 border-t border-[#EFE7DB] space-y-2">
              <div className="flex items-baseline justify-between gap-2 px-0.5">
                <span className="font-editorial text-[12px] font-semibold text-[#382A22]">
                  季节感知
                </span>
                <span
                  className="text-[10.5px] font-medium"
                  style={{ color: activeSeason.accentColor }}
                >
                  {seasonMode === 'auto'
                    ? `自动 · ${autoSeason.lightNote}`
                    : activeSeason.lightNote}
                </span>
              </div>

              {onSeasonModeChange && (
                <div
                  role="radiogroup"
                  aria-label="季节光效模式"
                  className="grid grid-cols-5 gap-1 p-1 rounded-xl bg-[#F3ECE2]/85 border border-[#E7DDD0]/75"
                >
                  {(
                    [
                      { key: 'auto' as const, label: '自动' },
                      ...CHAT_SEASONS.map((s) => ({ key: s.id, label: s.shortLabel })),
                    ] as const
                  ).map((item) => {
                    const active = seasonMode === item.key;
                    return (
                      <button
                        key={item.key}
                        type="button"
                        role="radio"
                        aria-checked={active}
                        onClick={() => {
                          haptic('selection');
                          onSeasonModeChange(item.key);
                        }}
                        className={`relative py-1 text-[11px] font-medium rounded-lg transition-colors whitespace-nowrap ${
                          active ? 'text-[#382A22]' : 'text-[#847264] hover:text-[#382A22]'
                        }`}
                      >
                        {active && (
                          <motion.span
                            layoutId="chat-season-mode-thumb"
                            transition={{ type: 'spring', stiffness: 460, damping: 34 }}
                            className="absolute inset-0 bg-white rounded-lg shadow-[0_1px_3px_rgba(56,42,34,0.1)]"
                          />
                        )}
                        <span className="relative z-10">{item.label}</span>
                      </button>
                    );
                  })}
                </div>
              )}
            </div>

            {/* Day/Night Alternating Light Intensity Control */}
            <div className="pt-2.5 border-t border-[#EFE7DB] space-y-2">
              <div className="flex items-baseline justify-between gap-2 px-0.5">
                <span className="font-editorial text-[12px] font-semibold text-[#382A22]">
                  昼夜光影
                </span>
                <span
                  className="text-[10.5px] font-medium"
                  style={{ color: activeDayPhase.accentColor }}
                >
                  {dayPhaseMode === 'auto'
                    ? `自动 · ${autoDayPhase.lightNote}`
                    : activeDayPhase.lightNote}
                </span>
              </div>

              {onDayPhaseModeChange && (
                <div
                  role="radiogroup"
                  aria-label="昼夜光影模式"
                  className="grid grid-cols-4 gap-1 p-1 rounded-xl bg-[#F3ECE2]/85 border border-[#E7DDD0]/75"
                >
                  {(
                    [
                      { key: 'auto' as const, label: '自动' },
                      ...CHAT_DAY_PHASES.map((p) => ({ key: p.id, label: p.shortLabel })),
                    ] as const
                  ).map((item) => {
                    const active = dayPhaseMode === item.key;
                    return (
                      <button
                        key={item.key}
                        type="button"
                        role="radio"
                        aria-checked={active}
                        onClick={() => {
                          haptic('selection');
                          onDayPhaseModeChange(item.key);
                        }}
                        className={`relative py-1 text-[11px] font-medium rounded-lg transition-colors whitespace-nowrap ${
                          active ? 'text-[#382A22]' : 'text-[#847264] hover:text-[#382A22]'
                        }`}
                      >
                        {active && (
                          <motion.span
                            layoutId="chat-day-phase-thumb"
                            transition={{ type: 'spring', stiffness: 460, damping: 34 }}
                            className="absolute inset-0 bg-white rounded-lg shadow-[0_1px_3px_rgba(56,42,34,0.1)]"
                          />
                        )}
                        <span className="relative z-10">{item.label}</span>
                      </button>
                    );
                  })}
                </div>
              )}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
