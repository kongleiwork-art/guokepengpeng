import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { AnimatePresence, motion } from 'motion/react';
import { ArrowRight, ChevronRight, Plus } from 'lucide-react';
import { api } from '../lib/api';
import type { CardSummary, DollSummary, OutputJob } from '../lib/types';
import { SafeImage } from '../components/SafeImage';
import { WatercolorWorksSkeleton } from '../components/WatercolorLoader';
import { NutShellAlbum } from '../components/NutShellAlbum';
import { haptic } from '../lib/haptics';

const JOB_STATUS_TEXT: Record<string, string> = {
  queued: '排队中',
  running: '模拟执行中',
  succeeded: '模拟完成',
  failed: '执行失败',
};

const EASE_STUDIO = [0.22, 1, 0.36, 1] as const;

type WorksTab = 'album' | 'dolls' | 'cards' | 'jobs';

export function MyWorksPage() {
  const [dolls, setDolls] = useState<DollSummary[]>([]);
  const [demoDolls, setDemoDolls] = useState<DollSummary[]>([]);
  const [cards, setCards] = useState<CardSummary[]>([]);
  const [jobs, setJobs] = useState<OutputJob[]>([]);
  const [loading, setLoading] = useState(true);
  const [activeTab, setActiveTab] = useState<WorksTab>('album');

  useEffect(() => {
    let active = true;
    (async () => {
      try {
        await api.initSession();
        const [dList, cList, jList] = await Promise.all([
          api.listDolls(),
          api.listCards(),
          api.listPlotJobs(),
        ]);
        if (!active) return;
        setDolls(dList.filter((d) => d.kind === 'personal'));
        setDemoDolls(dList.filter((d) => d.kind === 'demo'));
        setCards(cList);
        setJobs(jList);
      } finally {
        if (active) setLoading(false);
      }
    })();
    return () => {
      active = false;
    };
  }, []);

  const handleDollRenamed = (dollId: string, newName: string) => {
    setDolls((prev) => prev.map((d) => (d.id === dollId ? { ...d, name: newName } : d)));
  };

  const tabs: { key: WorksTab; label: string }[] = [
    { key: 'album', label: '相册' },
    { key: 'dolls', label: `娃娃 (${dolls.length})` },
    { key: 'cards', label: `卡片 (${cards.length})` },
    { key: 'jobs', label: `出图 (${jobs.length})` },
  ];

  return (
    <div className="max-w-[1160px] mx-auto px-3.5 sm:px-8 py-3 sm:py-6 space-y-3.5 sm:space-y-5">
      {/* Compact Native App Header + Segmented Switcher */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2.5 sm:gap-4">
        <div
          role="tablist"
          aria-label="个人收藏分类"
          className="ios-segmented grid grid-cols-4 flex-1 sm:max-w-[440px]"
        >
          {tabs.map((tab) => {
            const active = activeTab === tab.key;
            return (
              <button
                key={tab.key}
                type="button"
                role="tab"
                aria-selected={active}
                onClick={() => {
                  haptic('selection');
                  setActiveTab(tab.key);
                }}
                className={`relative py-2 px-1.5 text-[12px] font-medium rounded-[10px] transition-colors whitespace-nowrap ${
                  active ? 'text-[#382A22]' : 'text-[#7D6C5F]'
                }`}
              >
                {active && (
                  <motion.span
                    layoutId="works-tab-thumb"
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
          className="hidden sm:inline-flex items-center justify-center gap-1.5 px-4 py-2 text-xs font-medium btn-ink-tinted whitespace-nowrap shrink-0"
        >
          <Plus className="w-3.5 h-3.5" strokeWidth={2.2} />
          <span>定制新角色</span>
        </Link>
      </div>

      {loading ? (
        <WatercolorWorksSkeleton />
      ) : (
        <AnimatePresence mode="wait">
          {activeTab === 'album' && (
            <motion.div
              key="tab-album"
              initial={{ opacity: 0, y: 6 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -4 }}
              transition={{ duration: 0.2, ease: EASE_STUDIO }}
            >
              <NutShellAlbum
                personalDolls={dolls}
                demoDolls={demoDolls}
                cards={cards}
                onDollRenamed={handleDollRenamed}
              />
            </motion.div>
          )}

          {activeTab === 'dolls' && (
            <motion.section
              key="tab-dolls"
              initial={{ opacity: 0, y: 6 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -4 }}
              transition={{ duration: 0.2, ease: EASE_STUDIO }}
            >
              {dolls.length === 0 ? (
                <div className="studio-card rounded-[20px] p-6 flex flex-col sm:flex-row sm:items-center justify-between gap-4">
                  <div className="space-y-1">
                    <h2 className="font-editorial text-base font-semibold text-[#382A22]">
                      尚未绑定个人娃娃
                    </h2>
                    <p className="text-xs text-[#6E5C50]">
                      前往定制台上传照片即可制作你的第一只专属果壳角色。
                    </p>
                  </div>
                  <Link
                    to="/create"
                    onClick={() => haptic('medium')}
                    className="inline-flex items-center justify-center px-5 py-2.5 text-xs font-medium btn-capsule-primary whitespace-nowrap shrink-0"
                  >
                    去定制角色
                  </Link>
                </div>
              ) : (
                <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 sm:gap-5">
                  {dolls.map((d, index) => {
                    const stageCls = `specimen-stage-${index % 4}`;
                    return (
                      <motion.article
                        key={d.id}
                        initial={{ opacity: 0, y: 8 }}
                        animate={{ opacity: 1, y: 0 }}
                        transition={{ duration: 0.26, delay: index * 0.035, ease: EASE_STUDIO }}
                        className="group studio-card studio-card-hover rounded-[20px] overflow-hidden flex flex-col"
                      >
                        <Link
                          to={`/d/${d.id}`}
                          onClick={() => haptic('selection')}
                          className={`relative block photo-mat-frame ${stageCls} pt-2.5 pb-3 px-2.5 sm:px-3.5 overflow-hidden`}
                        >
                          <div className="relative z-10 flex items-baseline justify-between px-1 pb-1">
                            <span className="font-atelier-num italic text-[12.5px] text-[#8E7C6E]">
                              Private · 0{index + 1}
                            </span>
                            <span className="text-[10.5px] font-mono text-[#3D7267] font-medium">
                              {d.persona.mbti}
                            </span>
                          </div>
                          <div className="relative aspect-[4/4.2] flex items-center justify-center">
                            <span className="doll-pedestal-shadow" aria-hidden="true" />
                            <SafeImage
                              src={d.avatarUrl}
                              alt={d.name}
                              className="relative z-10 w-full h-full object-contain doll-hover-sway drop-shadow-[0_10px_14px_rgba(56,42,34,0.08)]"
                            />
                          </div>
                        </Link>
                        <div className="p-3 sm:p-3.5 border-t border-[#EFE7DB] bg-[#FFFDF9] flex-1 flex flex-col justify-between gap-2.5">
                          <div className="min-w-0">
                            <h3 className="font-editorial text-[14.5px] sm:text-[16px] font-semibold text-[#382A22] truncate">
                              {d.name}
                            </h3>
                            <div className="text-[10.5px] text-[#8E7C6E] truncate mt-0.5">
                              {d.persona.name}
                            </div>
                          </div>
                          <div className="flex items-center justify-between gap-2 pt-2 border-t border-[#F4EDE2]">
                            <Link
                              to={`/d/${d.id}/chat`}
                              onClick={() => haptic('light')}
                              className="inline-flex items-center justify-center px-3 py-1 text-[11.5px] font-medium btn-ink-tinted whitespace-nowrap"
                            >
                              聊一聊
                            </Link>
                            <Link
                              to={`/d/${d.id}`}
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
                </div>
              )}
            </motion.section>
          )}

          {activeTab === 'cards' && (
            <motion.section
              key="tab-cards"
              initial={{ opacity: 0, y: 6 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -4 }}
              transition={{ duration: 0.2, ease: EASE_STUDIO }}
            >
              {cards.length === 0 ? (
                <div className="studio-card rounded-[20px] p-6 text-xs text-[#9A887B]">
                  暂无定制卡片记录。
                </div>
              ) : (
                <div className="studio-card rounded-[20px] divide-y divide-[#EAE2D6] overflow-hidden">
                  {cards.map((c) => {
                    const latest = c.versions[c.versions.length - 1];
                    const isBusy =
                      latest && (latest.status === 'queued' || latest.status === 'running');
                    return (
                      <Link
                        key={c.id}
                        to={isBusy ? `/create/processing?cardId=${c.id}` : `/card/${c.id}`}
                        onClick={() => haptic('selection')}
                        className="p-3.5 sm:p-4 flex items-center justify-between gap-3 transition-colors hover:bg-[#FAF7F2]/70"
                      >
                        <div className="flex items-center gap-3 min-w-0">
                          <div className="w-11 h-14 rounded-xl overflow-hidden border border-[#EAE2D6] bg-white p-1 shrink-0 flex items-center justify-center">
                            <SafeImage
                              src={latest?.resultUrl}
                              alt={c.personaName}
                              className="w-full h-full object-contain"
                              fallbackTitle="生成中"
                            />
                          </div>
                          <div className="min-w-0 space-y-0.5">
                            <div className="text-[11px] text-[#9A887B] flex items-center gap-1.5">
                              <span className="font-mono font-semibold text-[#4A8276]">
                                {c.personaMbti}
                              </span>
                              <span aria-hidden="true">·</span>
                              <span>{c.boundDollId ? '已绑定锁定' : '未绑定'}</span>
                              <span aria-hidden="true">·</span>
                              <span className="font-mono tabular-nums">
                                {c.generationAttempts}/{c.maxAttempts}次
                              </span>
                            </div>
                            <div className="text-sm font-semibold text-[#382A22] truncate">
                              给 {c.userNickname} 的{c.personaName}
                            </div>
                          </div>
                        </div>

                        <span className="inline-flex items-center gap-1 text-xs font-medium text-[#4A8276] whitespace-nowrap shrink-0">
                          <span>{isBusy ? '进度' : '详情'}</span>
                          <ArrowRight className="w-3.5 h-3.5" />
                        </span>
                      </Link>
                    );
                  })}
                </div>
              )}
            </motion.section>
          )}

          {activeTab === 'jobs' && (
            <motion.section
              key="tab-jobs"
              initial={{ opacity: 0, y: 6 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -4 }}
              transition={{ duration: 0.2, ease: EASE_STUDIO }}
            >
              {jobs.length === 0 ? (
                <div className="studio-card rounded-[20px] p-6 text-xs text-[#9A887B]">
                  尚未提交过模拟出图任务。
                </div>
              ) : (
                <>
                  <div className="md:hidden studio-card rounded-[20px] divide-y divide-[#EAE2D6] overflow-hidden">
                    {jobs.map((j) => (
                      <div key={j.jobId} className="p-3.5 space-y-1.5 text-xs">
                        <div className="flex items-center justify-between gap-2">
                          <span className="font-mono font-medium text-[#382A22] truncate">
                            {j.jobId}
                          </span>
                          <span
                            className={`font-medium shrink-0 ${
                              j.status === 'succeeded'
                                ? 'text-[#4A8276]'
                                : j.status === 'failed'
                                ? 'text-[#B84A39]'
                                : 'text-[#B58233]'
                            }`}
                          >
                            {JOB_STATUS_TEXT[j.status] || j.status}
                          </span>
                        </div>
                        <div className="flex items-center justify-between gap-2 text-[11px] text-[#6E5C50]">
                          <span>
                            纸张 <span className="font-mono text-[#382A22]">{j.paperSize}</span> ·{' '}
                            {j.mode}
                          </span>
                          <Link
                            to={`/card/${j.cardId}`}
                            className="font-mono font-medium text-[#4A8276] btn-icon-ghost"
                          >
                            {j.cardVersionId}
                          </Link>
                        </div>
                      </div>
                    ))}
                  </div>

                  <div className="hidden md:block overflow-hidden studio-card rounded-[20px]">
                    <table className="w-full text-left text-xs">
                      <thead className="border-b border-[#EAE2D6] text-[#9A887B] bg-[#FAF7F2]">
                        <tr>
                          <th className="px-4 py-3 font-medium">任务 ID</th>
                          <th className="px-4 py-3 font-medium">锁定版本</th>
                          <th className="px-4 py-3 font-medium">纸张</th>
                          <th className="px-4 py-3 font-medium">模式 / 实体执行</th>
                          <th className="px-4 py-3 font-medium">状态</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-[#F0E9DF]">
                        {jobs.map((j) => (
                          <tr key={j.jobId}>
                            <td className="px-4 py-3 font-mono text-[#382A22]">{j.jobId}</td>
                            <td className="px-4 py-3 font-mono">
                              <Link
                                to={`/card/${j.cardId}`}
                                className="btn-icon-ghost text-[#4A8276]"
                              >
                                {j.cardVersionId}
                              </Link>
                            </td>
                            <td className="px-4 py-3 font-mono text-[#382A22]">{j.paperSize}</td>
                            <td className="px-4 py-3 text-[#6E5C50]">
                              {j.mode} · {j.physicalExecuted ? '实体已执行' : '未执行实体出图'}
                            </td>
                            <td
                              className={`px-4 py-3 font-medium ${
                                j.status === 'succeeded'
                                  ? 'text-[#4A8276]'
                                  : j.status === 'failed'
                                  ? 'text-[#B84A39]'
                                  : 'text-[#B58233]'
                              }`}
                            >
                              {JOB_STATUS_TEXT[j.status] || j.status}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </>
              )}
            </motion.section>
          )}
        </AnimatePresence>
      )}
    </div>
  );
}
