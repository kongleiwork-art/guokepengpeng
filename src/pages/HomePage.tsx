import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { AnimatePresence, motion } from 'motion/react';
import { ChevronRight, MessageCircle, Plus } from 'lucide-react';
import { api } from '../lib/api';
import type { CardSummary, DollSummary } from '../lib/types';
import { SafeImage } from '../components/SafeImage';
import { WatercolorCardGridSkeleton } from '../components/WatercolorLoader';
import { NutShellDiaryCheckIn } from '../components/NutShellDiaryCheckIn';
import { haptic } from '../lib/haptics';

const EASE_STUDIO = [0.22, 1, 0.36, 1] as const;

const STAGE_CLASSES = [
  'specimen-stage-0',
  'specimen-stage-1',
  'specimen-stage-2',
  'specimen-stage-3',
] as const;

export function HomePage() {
  const [dolls, setDolls] = useState<DollSummary[]>([]);
  const [cards, setCards] = useState<CardSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [activeShelf, setActiveShelf] = useState<'resident' | 'personal'>('resident');

  useEffect(() => {
    let active = true;
    (async () => {
      try {
        await api.initSession();
        const [dollList, cardList] = await Promise.all([api.listDolls(), api.listCards()]);
        if (!active) return;
        setDolls(dollList);
        setCards(cardList);
      } catch (err) {
        if (!active) return;
        setError(err instanceof Error ? err.message : '加载展馆数据失败');
      } finally {
        if (active) setLoading(false);
      }
    })();
    return () => {
      active = false;
    };
  }, []);

  const demoDolls = dolls.filter((d) => d.kind === 'demo');
  const personalDolls = dolls.filter((d) => d.kind === 'personal');
  const unboundCards = cards.filter((c) => !c.boundDollId);
  const personalTotal = personalDolls.length + unboundCards.length;

  return (
    <div className="max-w-[1160px] mx-auto px-3.5 sm:px-8 py-3 sm:py-6 space-y-3.5 sm:space-y-5">
      {/* Compact 果壳日记 Daily Check-in + Watercolor Mood Stickers + Monthly Calendar */}
      <NutShellDiaryCheckIn
        personalDollCount={personalDolls.length}
        draftCardCount={unboundCards.length}
      />

      {error && (
        <div className="p-3 rounded-xl border border-[#E5B8B0] bg-[#FDF2F0] text-xs text-[#9E3D2E]">
          {error}
        </div>
      )}

      {/* Native iOS Segmented Switcher: Resident Collection <-> Personal Shelf */}
      <div className="flex items-center justify-between gap-2.5 pt-0.5">
        <div
          role="tablist"
          aria-label="展馆分类"
          className="ios-segmented grid grid-cols-2 flex-1 sm:flex-none sm:w-[296px]"
        >
          {(
            [
              { key: 'resident', label: `常驻系列 (${demoDolls.length || 4})` },
              { key: 'personal', label: `我的收藏 (${personalTotal})` },
            ] as const
          ).map((tab) => {
            const active = activeShelf === tab.key;
            return (
              <button
                key={tab.key}
                type="button"
                role="tab"
                aria-selected={active}
                onClick={() => {
                  haptic('selection');
                  setActiveShelf(tab.key);
                }}
                className={`relative py-2 px-3 text-[12.5px] font-medium rounded-[11px] transition-colors whitespace-nowrap ${
                  active ? 'text-[#382A22]' : 'text-[#7D6C5F]'
                }`}
              >
                {active && (
                  <motion.span
                    layoutId="home-shelf-thumb"
                    transition={{ type: 'spring', stiffness: 460, damping: 34 }}
                    className="absolute inset-0 ios-segmented-thumb"
                  />
                )}
                <span className="relative z-10">{tab.label}</span>
              </button>
            );
          })}
        </div>

        <Link
          to="/create"
          onClick={() => haptic('medium')}
          className="inline-flex items-center justify-center gap-1.5 px-3.5 sm:px-4 py-2 text-[12.5px] font-medium btn-ink-tinted whitespace-nowrap shrink-0"
        >
          <Plus className="w-3.5 h-3.5" strokeWidth={2.2} />
          <span>定制角色</span>
        </Link>
      </div>

      {/* Focused Single-Screen Gallery View */}
      {loading ? (
        <WatercolorCardGridSkeleton count={4} />
      ) : (
        <AnimatePresence mode="wait">
          {activeShelf === 'resident' ? (
            <motion.section
              key="shelf-resident"
              initial={{ opacity: 0, y: 6 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -4 }}
              transition={{ duration: 0.22, ease: EASE_STUDIO }}
              aria-label="常驻手作娃娃"
              className="grid grid-cols-2 lg:grid-cols-4 gap-3 sm:gap-5"
            >
              {demoDolls.map((doll, idx) => {
                const stageCls = STAGE_CLASSES[idx % STAGE_CLASSES.length];
                return (
                  <motion.article
                    key={doll.id}
                    initial={{ opacity: 0, y: 10 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{
                      duration: 0.3,
                      delay: idx * 0.04,
                      ease: EASE_STUDIO,
                    }}
                    className="group flex flex-col rounded-[20px] studio-card studio-card-hover overflow-hidden"
                  >
                    {/* Specimen Watercolor Light Stage */}
                    <Link
                      to={`/d/${doll.id}`}
                      onClick={() => haptic('selection')}
                      className={`relative block photo-mat-frame ${stageCls} pt-2.5 pb-3 px-2.5 sm:px-3.5 overflow-hidden focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#4A8276]`}
                    >
                      <div className="relative z-10 flex items-baseline justify-between px-1 pb-1">
                        <span className="font-atelier-num italic text-[13px] text-[#8E7C6E]">
                          No. 0{idx + 1}
                        </span>
                        <span className="text-[10.5px] font-mono tracking-wide text-[#3D7267] font-medium">
                          {doll.persona.mbti}
                        </span>
                      </div>

                      <div className="relative aspect-[4/4.05] sm:aspect-[4/4.45] flex items-center justify-center">
                        <span className="doll-pedestal-shadow" aria-hidden="true" />
                        <SafeImage
                          src={doll.avatarUrl}
                          alt={`${doll.name} — ${doll.persona.name}`}
                          className="relative z-10 w-full h-full object-contain doll-hover-sway drop-shadow-[0_10px_14px_rgba(56,42,34,0.08)]"
                          fallbackTitle={doll.name}
                        />
                      </div>
                    </Link>

                    {/* Specimen Archival Caption Bar */}
                    <div className="px-3 sm:px-3.5 py-2.5 sm:py-3 border-t border-[#EFE7DB] bg-[#FFFDF9] flex-1 flex flex-col justify-between gap-2">
                      <Link
                        to={`/d/${doll.id}`}
                        onClick={() => haptic('selection')}
                        className="min-w-0 block focus-visible:outline-none"
                      >
                        <div className="flex items-center justify-between gap-1.5">
                          <h3 className="font-editorial text-[14.5px] sm:text-[16px] font-semibold text-[#382A22] truncate group-hover:text-[#2D5E53] transition-colors">
                            {doll.name}
                          </h3>
                          <ChevronRight className="w-3.5 h-3.5 text-[#968477] group-hover:text-[#4A8276] shrink-0 transition-transform duration-200 group-hover:translate-x-0.5" />
                        </div>
                        <p className="text-[10.5px] sm:text-[11px] text-[#8E7C6E] truncate mt-0.5">
                          {doll.persona.name}
                          {doll.persona.materialHint ? ` · ${doll.persona.materialHint}` : ''}
                        </p>
                      </Link>

                      <div className="flex items-center justify-between gap-2 pt-2 border-t border-[#F4EDE2]">
                        <Link
                          to={`/d/${doll.id}/chat`}
                          onClick={() => haptic('light')}
                          className="inline-flex items-center gap-1 text-[11.5px] font-medium text-[#356B5F] hover:text-[#244F45] transition-colors whitespace-nowrap"
                        >
                          <MessageCircle className="w-3.5 h-3.5" strokeWidth={1.9} />
                          <span>轻聊几句</span>
                        </Link>
                        <Link
                          to={`/d/${doll.id}`}
                          onClick={() => haptic('selection')}
                          className="text-[11px] text-[#968477] hover:text-[#382A22] transition-colors whitespace-nowrap"
                        >
                          档案
                        </Link>
                      </div>
                    </div>
                  </motion.article>
                );
              })}
            </motion.section>
          ) : (
            <motion.section
              key="shelf-personal"
              initial={{ opacity: 0, y: 6 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -4 }}
              transition={{ duration: 0.22, ease: EASE_STUDIO }}
              aria-label="我的专属收藏"
            >
              {personalTotal === 0 ? (
                <div className="studio-card atelier-passport rounded-[22px] p-6 sm:p-8 flex flex-col sm:flex-row sm:items-center justify-between gap-5">
                  <div className="space-y-1.5 max-w-lg">
                    <div className="font-atelier-num italic text-[13px] text-[#4A8276]">
                      Personal Edition · Atelier Bench
                    </div>
                    <h2 className="font-editorial text-lg sm:text-xl font-semibold text-[#382A22]">
                      还没有定制过专属果壳娃娃
                    </h2>
                    <p className="text-xs sm:text-sm text-[#6E5C50] leading-relaxed">
                      上传参考照片并选定 MBTI 人格与手作配饰，生成专属水彩果壳角色并绑定固定链接，随时续聊你们的共同记忆。
                    </p>
                  </div>
                  <Link
                    to="/create"
                    onClick={() => haptic('medium')}
                    className="inline-flex items-center justify-center gap-1.5 px-6 py-2.5 text-sm font-medium btn-capsule-primary whitespace-nowrap shrink-0"
                  >
                    <Plus className="w-4 h-4" strokeWidth={2.2} />
                    <span>去定制一只</span>
                  </Link>
                </div>
              ) : (
                <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 sm:gap-5">
                  {personalDolls.map((doll, idx) => {
                    const stageCls = STAGE_CLASSES[(idx + 1) % STAGE_CLASSES.length];
                    return (
                      <motion.article
                        key={doll.id}
                        initial={{ opacity: 0, y: 8 }}
                        animate={{ opacity: 1, y: 0 }}
                        transition={{ duration: 0.26, delay: idx * 0.035, ease: EASE_STUDIO }}
                        className="group studio-card studio-card-hover rounded-[20px] overflow-hidden flex flex-col"
                      >
                        <Link
                          to={`/d/${doll.id}`}
                          onClick={() => haptic('selection')}
                          className={`relative block photo-mat-frame ${stageCls} pt-2.5 pb-3 px-2.5 sm:px-3.5 overflow-hidden`}
                        >
                          <div className="relative z-10 flex items-baseline justify-between px-1 pb-1">
                            <span className="font-atelier-num italic text-[12.5px] text-[#8E7C6E]">
                              Private · 0{idx + 1}
                            </span>
                            <span className="text-[10.5px] font-mono text-[#3D7267] font-medium">
                              {doll.persona.mbti}
                            </span>
                          </div>
                          <div className="relative aspect-[4/4.05] sm:aspect-[4/4.45] flex items-center justify-center">
                            <span className="doll-pedestal-shadow" aria-hidden="true" />
                            <SafeImage
                              src={doll.avatarUrl}
                              alt={doll.name}
                              className="relative z-10 w-full h-full object-contain doll-hover-sway drop-shadow-[0_10px_14px_rgba(56,42,34,0.08)]"
                              fallbackTitle={doll.name}
                            />
                          </div>
                        </Link>
                        <div className="p-3 sm:p-3.5 border-t border-[#EFE7DB] flex-1 flex flex-col justify-between gap-2.5 bg-[#FFFDF9]">
                          <div className="min-w-0">
                            <h3 className="font-editorial text-[14.5px] sm:text-[16px] font-semibold text-[#382A22] truncate">
                              {doll.name}
                            </h3>
                            <div className="text-[10.5px] text-[#8E7C6E] truncate mt-0.5">
                              {doll.persona.name}
                            </div>
                          </div>
                          <div className="flex items-center justify-between gap-2 pt-2 border-t border-[#F4EDE2]">
                            <Link
                              to={`/d/${doll.id}/chat`}
                              onClick={() => haptic('light')}
                              className="inline-flex items-center justify-center px-3 py-1 text-[11.5px] font-medium btn-ink-tinted whitespace-nowrap"
                            >
                              聊一聊
                            </Link>
                            <Link
                              to={`/d/${doll.id}`}
                              onClick={() => haptic('selection')}
                              className="inline-flex items-center gap-0.5 text-[11.5px] font-medium btn-icon-ghost whitespace-nowrap"
                            >
                              <span>档案</span>
                              <ChevronRight className="w-3.5 h-3.5" />
                            </Link>
                          </div>
                        </div>
                      </motion.article>
                    );
                  })}

                  {unboundCards.map((card, idx) => {
                    const latest = card.versions[card.versions.length - 1];
                    const isBusy = latest && (latest.status === 'queued' || latest.status === 'running');
                    const stageCls = STAGE_CLASSES[(idx + 2) % STAGE_CLASSES.length];
                    return (
                      <motion.div
                        key={card.id}
                        initial={{ opacity: 0, y: 8 }}
                        animate={{ opacity: 1, y: 0 }}
                        transition={{ duration: 0.26, delay: idx * 0.035, ease: EASE_STUDIO }}
                      >
                        <Link
                          to={isBusy ? `/create/processing?cardId=${card.id}` : `/card/${card.id}`}
                          onClick={() => haptic('selection')}
                          className="group studio-card studio-card-hover rounded-[20px] overflow-hidden flex flex-col h-full"
                        >
                          <div className={`relative photo-mat-frame ${stageCls} pt-2.5 pb-3 px-2.5 sm:px-3.5 overflow-hidden`}>
                            <div className="relative z-10 flex items-baseline justify-between px-1 pb-1">
                              <span className="font-atelier-num italic text-[12.5px] text-[#8E7C6E]">
                                Draft · {card.versions.length}V
                              </span>
                              <span className="text-[10.5px] font-mono text-[#3D7267] font-medium">
                                {card.personaMbti}
                              </span>
                            </div>
                            <div className="relative aspect-[4/4.05] sm:aspect-[4/4.45] flex items-center justify-center">
                              <span className="doll-pedestal-shadow" aria-hidden="true" />
                              <SafeImage
                                src={latest?.resultUrl}
                                alt={`未绑定创作 ${card.personaName}`}
                                className="relative z-10 w-full h-full object-contain doll-hover-sway"
                                fallbackTitle={isBusy ? '绘制中' : '待绑定'}
                              />
                            </div>
                          </div>
                          <div className="px-3 sm:px-3.5 py-2.5 sm:py-3 border-t border-[#EFE7DB] flex items-center justify-between gap-2 bg-[#FFFDF9]">
                            <div className="min-w-0">
                              <h3 className="font-editorial text-[14px] font-semibold text-[#382A22] truncate">
                                {card.userNickname} · {card.personaName}
                              </h3>
                              <div className="text-[10.5px] text-[#4A8276] font-medium mt-0.5">
                                {isBusy ? '查看绘制进度' : '前往绑定激活'}
                              </div>
                            </div>
                            <ChevronRight className="w-4 h-4 text-[#4A8276] shrink-0 transition-transform duration-200 group-hover:translate-x-0.5" />
                          </div>
                        </Link>
                      </motion.div>
                    );
                  })}
                </div>
              )}
            </motion.section>
          )}
        </AnimatePresence>
      )}
    </div>
  );
}
