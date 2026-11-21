import { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { AnimatePresence, motion } from 'motion/react';
import {
  ArrowRight,
  Bookmark,
  ChevronLeft,
  ChevronRight,
  MessageCircle,
  Sparkles,
} from 'lucide-react';
import { api } from '../lib/api';
import type { ChatMessage, DollSummary, MemoryItem } from '../lib/types';
import { SafeImage } from './SafeImage';
import { haptic } from '../lib/haptics';

export type CalendarMoodId = 'sunny' | 'breeze' | 'cozy' | 'dreamy' | 'spark';

export interface CalendarMoodPalette {
  id: CalendarMoodId;
  label: string;
  dotColor: string;
  haloColor: string;
  tintBg: string;
  tintBorder: string;
}

const WEEKDAY_HEADERS = ['一', '二', '三', '四', '五', '六', '日'] as const;
const EASE_ORGANIC = [0.22, 1, 0.36, 1] as const;

const MEMORY_TYPE_LABEL: Record<string, string> = {
  user_nickname: '你的称呼',
  doll_name: '娃娃名称',
  persona: '选定人格',
  accessories: '手作配饰',
  fact: '明确记忆',
};

interface DollDayChatDigest {
  doll: DollSummary;
  userTurns: number;
  lastUserText: string;
  lastAssistantText: string;
  lastTime: string;
}

interface DayMemoryEntry {
  doll: DollSummary;
  memory: MemoryItem;
}

interface DaySummaryRecord {
  chats: DollDayChatDigest[];
  memories: DayMemoryEntry[];
}

function toLocalDateKey(date: Date): string {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

function parseDateKeyLabel(key: string): string {
  const [yStr, mStr, dStr] = key.split('-');
  const y = Number(yStr);
  const m = Number(mStr);
  const d = Number(dStr);
  if (!y || !m || !d) return key;
  const dt = new Date(y, m - 1, d);
  const wk = ['日', '一', '二', '三', '四', '五', '六'][dt.getDay()];
  return `${m}月${d}日 · 周${wk}`;
}

function formatClock(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
}

function truncateExcerpt(text: string, maxLen = 42): string {
  const clean = text.replace(/\s+/g, ' ').trim();
  if (clean.length <= maxLen) return clean;
  return `${clean.slice(0, maxLen)}…`;
}

interface NutShellDiaryCalendarProps {
  todayKey: string;
  checkedSet: Set<string>;
  dailyMoods: Record<string, CalendarMoodId>;
  moodPaletteMap: Record<CalendarMoodId, CalendarMoodPalette>;
  renderMoodIcon: (id: CalendarMoodId, size?: number) => React.ReactNode;
}

export function NutShellDiaryCalendar({
  todayKey,
  checkedSet,
  dailyMoods,
  moodPaletteMap,
  renderMoodIcon,
}: NutShellDiaryCalendarProps) {
  const navigate = useNavigate();

  const initialDate = useMemo(() => {
    const [y, m] = todayKey.split('-').map(Number);
    return { year: y || new Date().getFullYear(), month: (m || new Date().getMonth() + 1) - 1 };
  }, [todayKey]);

  const [viewYear, setViewYear] = useState(initialDate.year);
  const [viewMonth, setViewMonth] = useState(initialDate.month); // 0-indexed
  const [monthDir, setMonthDir] = useState<1 | -1>(1);
  const [selectedKey, setSelectedKey] = useState<string>(todayKey);

  const [loadingLogs, setLoadingLogs] = useState(true);
  const [dayRecords, setDayRecords] = useState<Record<string, DaySummaryRecord>>({});
  const [primaryDoll, setPrimaryDoll] = useState<DollSummary | null>(null);

  // Fetch real dialogue & memory archive across user's dolls once when calendar opens
  useEffect(() => {
    let cancelled = false;
    setLoadingLogs(true);

    (async () => {
      try {
        await api.initSession();
        const dolls = await api.listDolls();
        if (cancelled) return;

        // Prioritize user's personal dolls first, then gallery dolls (cap at 8 for speed)
        const prioritized = [
          ...dolls.filter((d) => d.kind === 'personal'),
          ...dolls.filter((d) => d.kind !== 'personal'),
        ].slice(0, 8);

        setPrimaryDoll(prioritized[0] || null);

        const perDollResults = await Promise.all(
          prioritized.map(async (doll) => {
            const [msgRes, memList] = await Promise.all([
              api.getMessages(doll.id, 60).catch(() => ({ items: [] as ChatMessage[], nextCursor: null })),
              api.getMemories(doll.id).catch(() => [] as MemoryItem[]),
            ]);
            return { doll, messages: msgRes.items, memories: memList };
          })
        );

        if (cancelled) return;

        const map: Record<string, DaySummaryRecord> = {};
        const ensureDay = (k: string): DaySummaryRecord => {
          if (!map[k]) map[k] = { chats: [], memories: [] };
          return map[k];
        };

        for (const { doll, messages, memories } of perDollResults) {
          // Group messages by local YYYY-MM-DD for this doll
          const byDate = new Map<string, ChatMessage[]>();
          for (const msg of messages) {
            const dt = new Date(msg.createdAt);
            if (Number.isNaN(dt.getTime())) continue;
            const k = toLocalDateKey(dt);
            const arr = byDate.get(k);
            if (arr) arr.push(msg);
            else byDate.set(k, [msg]);
          }

          byDate.forEach((msgs, dateKey) => {
            const userMsgs = msgs.filter((m) => m.role === 'user' && m.content.trim());
            const assistantMsgs = msgs.filter(
              (m) => m.role === 'assistant' && m.status === 'completed' && m.content.trim()
            );
            if (userMsgs.length === 0 && assistantMsgs.length === 0) return;

            const lastUser = userMsgs[userMsgs.length - 1];
            const lastAssistant = assistantMsgs[assistantMsgs.length - 1];
            const lastItem = msgs[msgs.length - 1];

            ensureDay(dateKey).chats.push({
              doll,
              userTurns: Math.max(userMsgs.length, assistantMsgs.length),
              lastUserText: lastUser ? truncateExcerpt(lastUser.content, 38) : '',
              lastAssistantText: lastAssistant ? truncateExcerpt(lastAssistant.content, 48) : '',
              lastTime: lastItem ? formatClock(lastItem.createdAt) : '',
            });
          });

          for (const mem of memories) {
            const dt = new Date(mem.createdAt);
            if (Number.isNaN(dt.getTime())) continue;
            const k = toLocalDateKey(dt);
            ensureDay(k).memories.push({ doll, memory: mem });
          }
        }

        setDayRecords(map);
      } catch {
        // Keep local check-in & mood stamps functional even if network fails
      } finally {
        if (!cancelled) setLoadingLogs(false);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, []);

  const isViewingCurrentMonth =
    viewYear === initialDate.year && viewMonth === initialDate.month;

  const shiftMonth = (delta: -1 | 1) => {
    haptic('selection');
    setMonthDir(delta);
    const next = new Date(viewYear, viewMonth + delta, 1);
    setViewYear(next.getFullYear());
    setViewMonth(next.getMonth());
  };

  const jumpToToday = () => {
    haptic('selection');
    setMonthDir(
      viewYear > initialDate.year ||
        (viewYear === initialDate.year && viewMonth > initialDate.month)
        ? -1
        : 1
    );
    setViewYear(initialDate.year);
    setViewMonth(initialDate.month);
    setSelectedKey(todayKey);
  };

  // Build Monday-first calendar cells for the active month
  const { cells, monthStampCount, monthMoodCount } = useMemo(() => {
    const firstDay = new Date(viewYear, viewMonth, 1);
    const daysInMonth = new Date(viewYear, viewMonth + 1, 0).getDate();
    const jsWeekday = firstDay.getDay(); // 0=Sun..6=Sat
    const leadingBlanks = jsWeekday === 0 ? 6 : jsWeekday - 1;

    const list: Array<{
      key: string;
      dayNum: number;
      inMonth: boolean;
    }> = [];

    for (let i = 0; i < leadingBlanks; i += 1) {
      list.push({ key: `blank-${viewYear}-${viewMonth}-${i}`, dayNum: 0, inMonth: false });
    }

    let stamps = 0;
    let moods = 0;

    for (let d = 1; d <= daysInMonth; d += 1) {
      const dateObj = new Date(viewYear, viewMonth, d);
      const key = toLocalDateKey(dateObj);
      if (checkedSet.has(key)) stamps += 1;
      if (dailyMoods[key]) moods += 1;
      list.push({ key, dayNum: d, inMonth: true });
    }

    return { cells: list, monthStampCount: stamps, monthMoodCount: moods };
  }, [viewYear, viewMonth, checkedSet, dailyMoods]);

  const selectedMoodId = dailyMoods[selectedKey];
  const selectedMood = selectedMoodId ? moodPaletteMap[selectedMoodId] : null;
  const selectedChecked = checkedSet.has(selectedKey);
  const selectedRecord = dayRecords[selectedKey];
  const hasSelectedLogs =
    Boolean(selectedRecord) &&
    (selectedRecord.chats.length > 0 || selectedRecord.memories.length > 0);

  return (
    <div className="pt-3 border-t border-dashed border-[#E8DEC9] space-y-3">
      {/* Month Switcher Bar */}
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-baseline gap-2 min-w-0">
          <h3 className="font-editorial text-[14.5px] font-semibold text-[#382A22] tabular-nums">
            {viewYear}年 {viewMonth + 1}月
          </h3>
          <span className="text-[11px] text-[#8E7B6D] truncate">
            印章 {monthStampCount} 枚{monthMoodCount > 0 ? ` · 心情 ${monthMoodCount}` : ''}
          </span>
        </div>

        <div className="flex items-center gap-1 shrink-0">
          {!isViewingCurrentMonth && (
            <button
              type="button"
              onClick={jumpToToday}
              className="px-2 py-0.5 text-[10.5px] font-medium btn-ink-tinted mr-1"
            >
              回到本月
            </button>
          )}
          <button
            type="button"
            onClick={() => shiftMonth(-1)}
            aria-label="上一个月"
            className="w-7 h-7 rounded-full inline-flex items-center justify-center btn-icon-ghost hover:bg-[#F3ECE2]"
          >
            <ChevronLeft className="w-4 h-4" />
          </button>
          <button
            type="button"
            onClick={() => shiftMonth(1)}
            aria-label="下一个月"
            className="w-7 h-7 rounded-full inline-flex items-center justify-center btn-icon-ghost hover:bg-[#F3ECE2]"
          >
            <ChevronRight className="w-4 h-4" />
          </button>
        </div>
      </div>

      {/* Responsive 2-Column on Desktop (Month Grid + Selected Day Memory Summary) */}
      <div className="grid grid-cols-1 md:grid-cols-12 gap-3 items-start">
        {/* Monthly Calendar Paper Sheet */}
        <div className="md:col-span-7 rounded-2xl bg-white/82 border border-[#EBE2D5] p-2.5 sm:p-3 space-y-2">
          {/* Weekday Header Row */}
          <div className="grid grid-cols-7 gap-1 text-center">
            {WEEKDAY_HEADERS.map((w) => (
              <span key={w} className="text-[10px] font-medium text-[#9A887B] py-0.5">
                {w}
              </span>
            ))}
          </div>

          {/* Animated Month Grid */}
          <AnimatePresence mode="wait" initial={false}>
            <motion.div
              key={`${viewYear}-${viewMonth}`}
              initial={{ opacity: 0, x: monthDir * 14 }}
              animate={{ opacity: 1, x: 0 }}
              exit={{ opacity: 0, x: monthDir * -14 }}
              transition={{ duration: 0.22, ease: EASE_ORGANIC }}
              className="grid grid-cols-7 gap-1"
            >
              {cells.map((cell) => {
                if (!cell.inMonth) {
                  return <div key={cell.key} className="h-9 sm:h-10" aria-hidden="true" />;
                }

                const isToday = cell.key === todayKey;
                const isSelected = cell.key === selectedKey;
                const moodId = dailyMoods[cell.key];
                const mood = moodId ? moodPaletteMap[moodId] : null;
                const isChecked = checkedSet.has(cell.key);
                const rec = dayRecords[cell.key];
                const hasLogs =
                  Boolean(rec) && (rec.chats.length > 0 || rec.memories.length > 0);

                return (
                  <button
                    key={cell.key}
                    type="button"
                    onClick={() => {
                      haptic('selection');
                      setSelectedKey(cell.key);
                    }}
                    aria-pressed={isSelected}
                    aria-label={`${cell.key}${mood ? ` 心情${mood.label}` : isChecked ? ' 已签到' : ''}${hasLogs ? ' 有对话记忆' : ''}`}
                    className={`relative h-9 sm:h-10 rounded-xl flex flex-col items-center justify-center gap-0.5 transition-all select-none ${
                      isSelected
                        ? 'bg-[#ECF5F2] border border-[#4A8276]/55 text-[#255449] shadow-[0_2px_8px_rgba(74,130,118,0.14)]'
                        : isToday
                          ? 'bg-[#FAF7F2] border border-dashed border-[#4A8276]/70 text-[#2E6156]'
                          : 'border border-transparent hover:bg-[#FAF7F2] text-[#4B3B31]'
                    }`}
                  >
                    <span
                      className={`text-[11.5px] leading-none font-mono tabular-nums ${
                        isSelected || isToday ? 'font-semibold' : 'font-normal'
                      }`}
                    >
                      {cell.dayNum}
                    </span>

                    {/* Watercolor Stamp Dot Row */}
                    <span className="h-2.5 flex items-center justify-center gap-0.5">
                      {mood ? (
                        /* Completed mood check-in: Watercolor ink stamp dot with soft pigment halo */
                        <span
                          className="relative inline-flex items-center justify-center w-2.5 h-2.5"
                          title={`心情印章：${mood.label}`}
                        >
                          <span
                            className="absolute inset-0 rounded-full blur-[1px]"
                            style={{ backgroundColor: mood.haloColor }}
                          />
                          <span
                            className="relative w-[7px] h-[7px] rounded-full shadow-[inset_0_0.5px_1px_rgba(255,255,255,0.5)]"
                            style={{ backgroundColor: mood.dotColor }}
                          />
                        </span>
                      ) : isChecked ? (
                        /* Checked-in without mood sticker: Botanical sage watercolor stamp dot */
                        <span
                          className="relative inline-flex items-center justify-center w-2.5 h-2.5"
                          title="已浇水签到"
                        >
                          <span className="absolute inset-0 rounded-full bg-[#4A8276]/22 blur-[1px]" />
                          <span className="relative w-[6px] h-[6px] rounded-full bg-[#4A8276]" />
                        </span>
                      ) : null}

                      {hasLogs && (
                        <span
                          className="w-[4.5px] h-[4.5px] rounded-full bg-[#C9963B]"
                          title="当日有对话或记忆"
                        />
                      )}
                    </span>
                  </button>
                );
              })}
            </motion.div>
          </AnimatePresence>

          {/* Subtle Stationery Legend */}
          <div className="flex flex-wrap items-center justify-between gap-2 pt-1.5 border-t border-[#F2EAE0] text-[10px] text-[#9A887B]">
            <div className="flex items-center gap-3">
              <span className="inline-flex items-center gap-1">
                <span className="w-2 h-2 rounded-full bg-[#69A897] ring-2 ring-[#69A897]/20" />
                <span>心情水彩印章</span>
              </span>
              <span className="inline-flex items-center gap-1">
                <span className="w-1.5 h-1.5 rounded-full bg-[#C9963B]" />
                <span>对话记忆</span>
              </span>
            </div>
            <span>点选日期查看摘要</span>
          </div>
        </div>

        {/* Selected Day Dialogue & Memory Summary Panel */}
        <div className="md:col-span-5 rounded-2xl bg-[#FFFEFC]/90 border border-[#EBE2D5] p-3 space-y-2.5 min-h-[196px] flex flex-col justify-between">
          <AnimatePresence mode="wait" initial={false}>
            <motion.div
              key={selectedKey}
              initial={{ opacity: 0, y: 5 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -4 }}
              transition={{ duration: 0.2, ease: EASE_ORGANIC }}
              className="space-y-2.5 flex-1"
            >
              {/* Date Title + Watercolor Stamp Status */}
              <div className="flex items-center justify-between gap-2 pb-2 border-b border-[#F0E7DB]">
                <div>
                  <div className="text-[12.5px] font-semibold text-[#382A22]">
                    {parseDateKeyLabel(selectedKey)}
                  </div>
                  <div className="text-[10.5px] text-[#9A887B]">
                    {selectedKey === todayKey ? '今日手帐页' : '历史手帐记录'}
                  </div>
                </div>

                {selectedMood ? (
                  <span
                    className={`inline-flex items-center gap-1 pl-1 pr-2 py-0.5 rounded-full border text-[10.5px] font-medium text-[#4A3B31] ${selectedMood.tintBg} ${selectedMood.tintBorder}`}
                  >
                    {renderMoodIcon(selectedMood.id, 15)}
                    <span>{selectedMood.label}</span>
                  </span>
                ) : selectedChecked ? (
                  <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-[#ECF5F2] border border-[#C6DFD7] text-[10.5px] font-medium text-[#2E6156]">
                    <Sparkles className="w-3 h-3" />
                    <span>已签到</span>
                  </span>
                ) : (
                  <span className="text-[10.5px] text-[#B0A194]">未盖章</span>
                )}
              </div>

              {/* Body: Loading / Real Dialogue & Memory Digest / Quiet Day */}
              {loadingLogs ? (
                <div className="space-y-2 py-1">
                  <div className="h-12 rounded-xl wc-wash" />
                  <div className="h-10 rounded-xl wc-wash" />
                </div>
              ) : hasSelectedLogs && selectedRecord ? (
                <div className="space-y-2.5">
                  {/* Dialogue Summaries by Doll */}
                  {selectedRecord.chats.length > 0 && (
                    <div className="space-y-2">
                      <div className="inline-flex items-center gap-1 text-[10.5px] font-medium text-[#4A8276]">
                        <MessageCircle className="w-3 h-3" />
                        <span>对话摘要 ({selectedRecord.chats.length} 位娃娃)</span>
                      </div>
                      <div className="space-y-1.5">
                        {selectedRecord.chats.map((chat) => (
                          <button
                            key={chat.doll.id}
                            type="button"
                            onClick={() => {
                              haptic('light');
                              navigate(`/d/${chat.doll.id}/chat`);
                            }}
                            className="w-full text-left p-2 rounded-xl bg-[#FAF7F2] hover:bg-[#F2F8F6] border border-[#EDE4D8] hover:border-[#BDD8CF] transition-colors group space-y-1"
                          >
                            <div className="flex items-center justify-between gap-2">
                              <div className="flex items-center gap-1.5 min-w-0">
                                <span className="w-5 h-5 rounded-full bg-white border border-[#E6DDD0] p-0.5 overflow-hidden shrink-0">
                                  <SafeImage
                                    src={chat.doll.avatarUrl}
                                    alt={chat.doll.name}
                                    className="w-full h-full object-contain"
                                  />
                                </span>
                                <span className="text-[11.5px] font-semibold text-[#382A22] truncate">
                                  {chat.doll.name}
                                </span>
                                <span className="text-[10px] text-[#9A887B] shrink-0 tabular-nums">
                                  {chat.userTurns} 轮
                                </span>
                              </div>
                              <span className="inline-flex items-center gap-0.5 text-[10.5px] font-medium text-[#4A8276] shrink-0">
                                <span>查看对话</span>
                                <ArrowRight className="w-3 h-3 transition-transform group-hover:translate-x-0.5" />
                              </span>
                            </div>
                            {chat.lastUserText && (
                              <p className="text-[11px] text-[#7D6C5E] line-clamp-1">
                                你：{chat.lastUserText}
                              </p>
                            )}
                            {chat.lastAssistantText && (
                              <p className="text-[11px] text-[#4A3B31] line-clamp-2 leading-snug">
                                「{chat.lastAssistantText}」
                              </p>
                            )}
                          </button>
                        ))}
                      </div>
                    </div>
                  )}

                  {/* Recorded Memory Entries for This Date */}
                  {selectedRecord.memories.length > 0 && (
                    <div className="space-y-1.5">
                      <div className="inline-flex items-center gap-1 text-[10.5px] font-medium text-[#9A7432]">
                        <Bookmark className="w-3 h-3" />
                        <span>当日记忆 ({selectedRecord.memories.length})</span>
                      </div>
                      <ul className="space-y-1">
                        {selectedRecord.memories.slice(0, 3).map(({ doll, memory }) => (
                          <li key={memory.id}>
                            <button
                              type="button"
                              onClick={() => {
                                haptic('light');
                                navigate(`/d/${doll.id}/chat`);
                              }}
                              className="w-full text-left px-2.5 py-1.5 rounded-xl bg-[#FDF9F0] hover:bg-[#FAF2E1] border border-[#EFE2C8] transition-colors flex items-center justify-between gap-2"
                            >
                              <div className="min-w-0">
                                <span className="text-[10px] text-[#A27B38] font-medium mr-1.5">
                                  {doll.name} · {MEMORY_TYPE_LABEL[memory.type] || '记忆'}
                                </span>
                                <span className="text-[11px] text-[#4A3B31] break-words">
                                  {truncateExcerpt(memory.value, 28)}
                                </span>
                              </div>
                              <ArrowRight className="w-3 h-3 text-[#A27B38] shrink-0" />
                            </button>
                          </li>
                        ))}
                      </ul>
                    </div>
                  )}
                </div>
              ) : (
                <div className="py-4 text-center space-y-2.5">
                  <p className="text-[11.5px] text-[#8E7B6D] leading-relaxed">
                    {selectedMood
                      ? `这天贴下了「${selectedMood.label}」水彩印章，暂未记录具体对话摘要。`
                      : selectedChecked
                        ? '这天完成了一次温柔浇水，暂未留存对话摘要。'
                        : '这一页还是留白的棉纸，暂未留下对话记忆。'}
                  </p>
                  {primaryDoll && (
                    <button
                      type="button"
                      onClick={() => {
                        haptic('light');
                        navigate(`/d/${primaryDoll.id}/chat`);
                      }}
                      className="inline-flex items-center gap-1 px-3 py-1 text-[11px] font-medium btn-ink-tinted"
                    >
                      <MessageCircle className="w-3 h-3" />
                      <span>去和 {primaryDoll.name} 记下一笔</span>
                    </button>
                  )}
                </div>
              )}
            </motion.div>
          </AnimatePresence>
        </div>
      </div>
    </div>
  );
}
