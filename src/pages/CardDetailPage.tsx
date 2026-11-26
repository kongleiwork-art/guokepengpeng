import { useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { AnimatePresence, motion } from 'motion/react';
import {
  ArrowLeft,
  Check,
  Copy,
  Download,
  Layers,
  Lock,
  MessageSquare,
  Printer,
  RefreshCw,
} from 'lucide-react';
import { api, ApiError, generateIdempotencyKey } from '../lib/api';
import { startTaskPolling } from '../lib/taskPolling';
import type { CardDetail, FallbackTemplate, OutputJob } from '../lib/types';
import { SafeImage } from '../components/SafeImage';
import { MaterialPlanList } from '../components/MaterialPlanList';
import { WatercolorCardDetailSkeleton } from '../components/WatercolorLoader';
import { haptic } from '../lib/haptics';

const RESULT_KIND_TEXT: Record<string, string> = {
  generated: '真实模型生成',
  mock: 'Mock 模拟生成',
  template: '预设模板兜底',
};

const VERSION_STATUS_TEXT: Record<string, string> = {
  queued: '排队中',
  running: '生成中',
  succeeded: '成功',
  failed: '失败',
  cancelled: '已取消',
};

const JOB_STATUS_TEXT: Record<string, string> = {
  queued: '排队中',
  running: '模拟执行中',
  succeeded: '模拟完成',
  failed: '模拟失败',
};

const EASE_STUDIO = [0.22, 1, 0.36, 1] as const;

export function CardDetailPage() {
  const { cardId = '' } = useParams();
  const [card, setCard] = useState<CardDetail | null>(null);
  const [templates, setTemplates] = useState<FallbackTemplate[]>([]);
  const [jobs, setJobs] = useState<OutputJob[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [pollNotice, setPollNotice] = useState<string | null>(null);

  const [selectedVersionId, setSelectedVersionId] = useState<string>('');
  const [dollName, setDollName] = useState('');
  const [actionBusy, setActionBusy] = useState<string | null>(null);
  const [actionMsg, setActionMsg] = useState<{ kind: 'ok' | 'err'; text: string; selectMaterials?: boolean } | null>(null);

  const [showFallbackPicker, setShowFallbackPicker] = useState(false);

  const [paperSize, setPaperSize] = useState<'A6' | 'A5' | 'SQUARE_100'>('A6');
  const [copiedDollUrl, setCopiedDollUrl] = useState(false);
  const [mobileCardTab, setMobileCardTab] = useState<'versions' | 'actions'>('versions');

  const refreshCardAndJobs = async (signal?: AbortSignal) => {
    const [detail, jobList] = await Promise.all([api.getCard(cardId, signal), api.listPlotJobs(cardId, signal)]);
    if (signal?.aborted) return { detail, jobList };
    setCard(detail);
    setJobs(jobList);

    setSelectedVersionId((prev) => {
      if (prev && detail.versions.some((v) => v.id === prev)) return prev;
      if (detail.boundDoll?.cardVersionId) return detail.boundDoll.cardVersionId;
      const latestSucceeded = [...detail.versions].reverse().find((v) => v.status === 'succeeded');
      return latestSucceeded?.id || detail.activeVersionId || detail.versions[0]?.id || '';
    });

    if (!detail.boundDoll) {
      const sug = detail.versions.find((v) => v.suggestedName)?.suggestedName;
      if (sug) setDollName(current => current || sug);
    }
    return { detail, jobList };
  };

  useEffect(() => {
    setLoading(true);
    setError(null);
    setPollNotice(null);
    return startTaskPolling(async (signal) => {
      await api.initSession(signal);
      const [tpls] = await Promise.all([api.listTemplates(signal), refreshCardAndJobs(signal)]);
      if (!signal.aborted) {
        setTemplates(tpls);
        setPollNotice(null);
        setLoading(false);
      }
      return false;
    }, (err, retrying) => {
      if (retrying) setPollNotice('连接暂时中断，正在重新加载这件作品。');
      else {
        setError(err instanceof Error ? err.message : '加载作品详情失败');
        setLoading(false);
      }
    });
  }, [cardId]);

  const hasPendingTask = !loading && card?.id === cardId && (
    card.versions.some(v => v.status === 'queued' || v.status === 'running') ||
    jobs.some(j => j.status === 'queued' || j.status === 'running')
  );
  useEffect(() => {
    if (!hasPendingTask) return;
    return startTaskPolling(async (signal) => {
      await refreshCardAndJobs(signal);
      if (!signal.aborted) setPollNotice(null);
      return true;
    }, (err, retrying) => {
      setPollNotice(retrying ? '连接暂时中断，正在重新查询原任务。' : err instanceof Error ? err.message : '查询任务失败');
    }, 1000);
  }, [cardId, hasPendingTask]);

  const handleRedraw = async (simulateFail = false) => {
    if (!card || actionBusy) return;
    const latestCloudVersion = [...card.versions].reverse().find((version) => version.provider === 'cloud');
    const reviewedUnknown = latestCloudVersion?.errorCode === 'GENERATION_STATUS_UNKNOWN';
    if (reviewedUnknown && !window.confirm('请在生图服务商控制台核对上一次结果和费用。确认核对完成后再提交新的生成任务。')) return;
    haptic('light');
    setActionBusy('redraw');
    setActionMsg(null);
    try {
      const res = await api.redrawCard(card.id, generateIdempotencyKey('redraw'), { simulateFail, reviewedUnknown });
      setSelectedVersionId(res.versionId);
      await refreshCardAndJobs();
      setActionMsg({
        kind: 'ok',
        text: `已创建第 V${res.versionNumber} 版生成任务（旧版本已保留，不会覆盖）。`,
      });
    } catch (err) {
      const text = err instanceof ApiError ? `[${err.code}] ${err.message}` : '重生成请求失败';
      setActionMsg({ kind: 'err', text, selectMaterials: err instanceof ApiError && err.code === 'MATERIAL_SELECTION_REQUIRED' });
      if (err instanceof ApiError && err.code === 'QUEUE_UNAVAILABLE') {
        await refreshCardAndJobs().catch(() => {});
      }
    } finally {
      setActionBusy(null);
    }
  };

  const handleCancelVersion = async (versionId: string) => {
    if (actionBusy) return;
    setActionBusy('cancel');
    setActionMsg(null);
    try {
      await api.cancelVersion(versionId, generateIdempotencyKey('cancel'));
      await refreshCardAndJobs();
      setActionMsg({ kind: 'ok', text: '已取消排队中的生成版本。' });
    } catch (err) {
      const text = err instanceof ApiError ? `[${err.code}] ${err.message}` : '取消失败';
      setActionMsg({ kind: 'err', text });
    } finally {
      setActionBusy(null);
    }
  };

  const handleApplyFallback = async (templateId: string) => {
    if (!card || actionBusy) return;
    setActionBusy('fallback');
    setActionMsg(null);
    try {
      const ver = await api.applyFallback(card.id, templateId, generateIdempotencyKey('fallback'));
      setSelectedVersionId(ver.id);
      setShowFallbackPicker(false);
      await refreshCardAndJobs();
      setActionMsg({
        kind: 'ok',
        text: '已创建预设模板兜底版本（resultKind=template，不消耗模型生成次数）。',
      });
    } catch (err) {
      const text = err instanceof ApiError ? `[${err.code}] ${err.message}` : '启用模板兜底失败';
      setActionMsg({ kind: 'err', text });
    } finally {
      setActionBusy(null);
    }
  };

  const handleBind = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!card || !selectedVersionId || !dollName.trim() || actionBusy) return;
    haptic('medium');
    setActionBusy('bind');
    setActionMsg(null);
    try {
      const res = await api.bindCard(
        card.id,
        selectedVersionId,
        dollName.trim(),
        generateIdempotencyKey('bind')
      );
      await refreshCardAndJobs();
      haptic('success');
      setActionMsg({
        kind: 'ok',
        text: `已成功绑定个人娃娃「${dollName.trim()}」（ID: ${res.dollId}），本作品卡片已冻结锁定。`,
      });
    } catch (err) {
      const text = err instanceof ApiError ? `[${err.code}] ${err.message}` : '绑定个人娃娃失败';
      setActionMsg({ kind: 'err', text });
    } finally {
      setActionBusy(null);
    }
  };

  const handleSubmitPlotJob = async (simulateFail = false) => {
    if (!card || !selectedVersionId || actionBusy) return;
    haptic('medium');
    setActionBusy('plot');
    setActionMsg(null);
    try {
      const job = await api.createPlotJob(
        selectedVersionId,
        paperSize,
        generateIdempotencyKey('plot'),
        simulateFail
      );
      await refreshCardAndJobs();
      haptic('success');
      setActionMsg({
        kind: 'ok',
        text: `已提交模拟出图任务 ${job.jobId}（锁定版本 ${job.cardVersionId}，mode=mock，未执行实体出图）。`,
      });
    } catch (err) {
      const text = err instanceof ApiError ? `[${err.code}] ${err.message}` : '提交模拟出图失败';
      setActionMsg({ kind: 'err', text });
    } finally {
      setActionBusy(null);
    }
  };

  const handleCopyDollUrl = async () => {
    if (!card?.boundDoll) return;
    const url = card.boundDoll.dollUrl;
    try {
      await navigator.clipboard.writeText(url);
      haptic('success');
      setCopiedDollUrl(true);
      setTimeout(() => setCopiedDollUrl(false), 1800);
    } catch {
      setCopiedDollUrl(false);
    }
  };

  if (loading) {
    return <>
      {pollNotice && <p role="status" className="px-4 py-3 text-center text-xs text-[#875220]">{pollNotice}</p>}
      <WatercolorCardDetailSkeleton />
    </>;
  }

  if (error || !card) {
    return (
      <div className="max-w-[720px] mx-auto px-5 sm:px-8 py-16">
        <div className="studio-card rounded-2xl p-8 space-y-4">
          <h1 className="font-editorial text-2xl font-semibold text-[#382A22]">无法访问该作品</h1>
          <p className="text-sm text-[#6E5C50]">
            {error || '该作品不存在，或不属于当前浏览器会话（私有定制受会话隔离保护）。'}
          </p>
          <Link to="/create" className="inline-block text-sm font-medium btn-icon-ghost">
            去定制新的果壳娃娃
          </Link>
        </div>
      </div>
    );
  }

  const selectedVersion =
    card.versions.find((v) => v.id === selectedVersionId) ||
    card.versions[card.versions.length - 1];
  const hasRunningTask = card.versions.some((v) => v.status === 'queued' || v.status === 'running');
  const isLocked = Boolean(card.boundDollId);
  const canBindSelected =
    !isLocked && selectedVersion?.status === 'succeeded' && Boolean(selectedVersion.resultUrl);
  const canPlotSelected =
    selectedVersion?.status === 'succeeded' && Boolean(selectedVersion.resultUrl);

  const downloadHref = selectedVersion?.resultUrl
    ? selectedVersion.resultUrl.startsWith('/api/assets/generated/')
      ? `${selectedVersion.resultUrl}?download=1`
      : selectedVersion.resultUrl
    : null;

  return (
    <div className="max-w-[1160px] mx-auto px-3.5 sm:px-8 py-3 sm:py-6 space-y-3.5 sm:space-y-5">
      {/* Compact Header */}
      <div className="flex flex-wrap items-center justify-between gap-2.5 border-b border-[#EAE2D6] pb-3">
        <div className="space-y-1 min-w-0">
          <Link
            to="/works"
            className="hidden md:inline-flex group items-center gap-1.5 text-xs font-medium btn-icon-ghost"
          >
            <ArrowLeft className="w-3.5 h-3.5 transition-transform duration-200 group-hover:-translate-x-1" />
            <span>返回我的收藏</span>
          </Link>
          <div className="flex flex-wrap items-baseline gap-2">
            <h1 className="font-editorial text-lg sm:text-2xl font-semibold text-[#382A22] tracking-tight truncate">
              {card.boundDoll
                ? `${card.boundDoll.name}`
                : `给 ${card.userNickname} 的定制作品`}
            </h1>
            <span className="text-[11px] font-mono text-[#4A8276] font-semibold">
              {card.persona.mbti} · {card.persona.name}
            </span>
          </div>
        </div>

        <div className="flex items-center gap-2 text-[11px] font-mono text-[#9A887B]">
          {isLocked ? (
            <span className="inline-flex items-center gap-1 font-medium text-[#4A8276]">
              <Lock className="w-3.5 h-3.5" />
              <span>已绑定锁定</span>
            </span>
          ) : (
            <span className="tabular-nums">
              剩余重生成 {card.remainingAttempts}/{card.maxAttempts - 1}
            </span>
          )}
        </div>
      </div>

      {/* Mobile iOS Segmented Switcher: Versions <-> Bind & Plot */}
      <div className="lg:hidden ios-segmented grid grid-cols-2">
        {(
          [
            { key: 'versions' as const, label: `版本预览 (${card.versions.length})` },
            { key: 'actions' as const, label: isLocked ? '链接与出图' : '绑定与出图' },
          ] as const
        ).map((t) => {
          const active = mobileCardTab === t.key;
          return (
            <button
              key={t.key}
              type="button"
              onClick={() => {
                haptic('selection');
                setMobileCardTab(t.key);
              }}
              className={`relative py-2 px-3 text-[12.5px] font-medium rounded-[10px] transition-colors whitespace-nowrap ${
                active ? 'text-[#382A22]' : 'text-[#7D6C5F]'
              }`}
            >
              {active && (
                <motion.span
                  layoutId="card-seg-thumb"
                  transition={{ type: 'spring', stiffness: 460, damping: 34 }}
                  className="absolute inset-0 ios-segmented-thumb"
                />
              )}
              <span className="relative z-10">{t.label}</span>
            </button>
          );
        })}
      </div>

      {pollNotice && <p role="status" className="text-xs text-[#875220]">{pollNotice}</p>}
      <AnimatePresence>
        {actionMsg && (
          <motion.div
            initial={{ opacity: 0, y: -6 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -6 }}
            className={`p-3 rounded-xl border text-xs ${
              actionMsg.kind === 'ok'
                ? 'bg-[#ECF5F2]/70 border-[#4A8276]/35 text-[#382A22]'
                : 'bg-[#FDF2F0] border-[#E5B8B0] text-[#9E3D2E]'
            }`}
          >
            {actionMsg.text}
            {actionMsg.selectMaterials && <Link to="/create" className="ml-2 font-medium underline">重新定制选材</Link>}
          </motion.div>
        )}
      </AnimatePresence>

      <div className="grid grid-cols-1 lg:grid-cols-12 gap-4 sm:gap-6 items-start">
        {/* Left: Active Version Preview & Version Switcher */}
        <section
          className={`${
            mobileCardTab === 'actions' ? 'hidden lg:block' : 'block'
          } lg:col-span-6 space-y-4`}
        >
          <div className="studio-card rounded-[20px] overflow-hidden">
            <div className="h-[240px] sm:h-[320px] bg-white p-3.5 sm:p-4 flex items-center justify-center overflow-hidden">
              <AnimatePresence mode="wait">
                <motion.div
                  key={selectedVersion?.id || 'empty'}
                  initial={{ opacity: 0, scale: 0.98 }}
                  animate={{ opacity: 1, scale: 1 }}
                  exit={{ opacity: 0, scale: 0.98 }}
                  transition={{ duration: 0.22, ease: EASE_STUDIO }}
                  className="w-full h-full flex items-center justify-center"
                >
                  <SafeImage
                    src={selectedVersion?.resultUrl}
                    alt={`版本 V${selectedVersion?.versionNumber ?? ''}`}
                    className="w-full h-full object-contain"
                    fallbackTitle={
                      selectedVersion
                        ? `V${selectedVersion.versionNumber} · ${VERSION_STATUS_TEXT[selectedVersion.status] || selectedVersion.status}`
                        : '暂无图像'
                    }
                  />
                </motion.div>
              </AnimatePresence>
            </div>

            {selectedVersion && (
              <div className="p-5 space-y-3 border-t border-[#EAE2D6] bg-[#FFFEFC]">
                <div className="flex flex-wrap items-center justify-between gap-2 text-xs text-[#9A887B]">
                  <div className="flex flex-wrap items-center gap-1.5">
                    <span className="font-mono font-semibold text-[#382A22]">
                      V{selectedVersion.versionNumber}
                    </span>
                    <span aria-hidden="true">·</span>
                    <span>{VERSION_STATUS_TEXT[selectedVersion.status] || selectedVersion.status}</span>
                    <span aria-hidden="true">·</span>
                    <span>{RESULT_KIND_TEXT[selectedVersion.resultKind] || selectedVersion.resultKind}</span>
                    {selectedVersion.latencyMs !== null && (
                      <>
                        <span aria-hidden="true">·</span>
                        <span className="font-mono tabular-nums">
                          {(selectedVersion.latencyMs / 1000).toFixed(1)}s
                        </span>
                      </>
                    )}
                  </div>
                  <span className="font-mono text-[11px]">{selectedVersion.id}</span>
                </div>

                {selectedVersion.errorCode && (
                  <p className="text-xs text-[#9E3D2E] bg-[#FDF2F0] border border-[#E5B8B0] rounded-lg px-3.5 py-2.5">
                    <span className="font-mono font-medium mr-1">[{selectedVersion.errorCode}]</span>
                    {selectedVersion.errorMessage || '该版本生成失败'}
                  </p>
                )}

                <div className="flex flex-wrap items-center gap-5 pt-1">
                  {downloadHref && (
                    <a
                      href={downloadHref}
                      download={`nutshell_${selectedVersion.id}`}
                      className="group inline-flex items-center gap-1.5 text-xs font-medium btn-icon-ghost whitespace-nowrap"
                    >
                      <Download className="w-3.5 h-3.5 text-[#4A8276] transition-transform duration-200 group-hover:translate-y-0.5" />
                      <span>下载当前版本</span>
                    </a>
                  )}
                  {selectedVersion.status === 'queued' && (
                    <button
                      type="button"
                      onClick={() => handleCancelVersion(selectedVersion.id)}
                      disabled={actionBusy !== null}
                      className="text-xs font-medium btn-icon-danger whitespace-nowrap"
                    >
                      取消排队任务
                    </button>
                  )}
                </div>
              </div>
            )}
            {selectedVersion?.status === 'succeeded' && selectedVersion.resultKind === 'generated' &&
              card.materialPlan && card.materialPlan.length > 0 && (
                <div className="border-t border-[#EAE2D6] bg-[#F7F5EE] p-5">
                  <MaterialPlanList materials={card.materialPlan} />
                </div>
              )}
          </div>

          {/* Version History Strip */}
          <div className="studio-card rounded-[20px] p-4 sm:p-5 space-y-4">
            <div className="flex items-center justify-between gap-2">
              <div className="flex items-center gap-2 text-sm font-semibold text-[#382A22]">
                <Layers className="w-4 h-4 text-[#4A8276]" />
                <span>版本记录 ({card.versions.length})</span>
              </div>
              <span className="text-xs text-[#9A887B]">历史版本永久保留</span>
            </div>

            <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
              {card.versions.map((v) => {
                const isSelected = v.id === selectedVersion?.id;
                const isBoundVersion = card.boundDoll?.cardVersionId === v.id;
                return (
                  <motion.button
                    key={v.id}
                    type="button"
                    data-pressable="card"
                    whileHover={{ y: -2 }}
                    onClick={() => {
                      haptic('selection');
                      setSelectedVersionId(v.id);
                    }}
                    className={`text-left rounded-xl border p-2.5 transition-all ${
                      isSelected
                        ? 'border-[#4A8276] bg-[#ECF5F2]/40 ring-1 ring-[#4A8276]/25'
                        : 'border-[#EAE2D6] hover:border-[#CFC4B5] bg-white'
                    }`}
                  >
                    <div className="aspect-[3/4] rounded-lg overflow-hidden bg-white border border-[#F0E9DF] p-1.5 mb-2 flex items-center justify-center">
                      <SafeImage
                        src={v.resultUrl}
                        alt={`V${v.versionNumber}`}
                        className="w-full h-full object-contain"
                        fallbackTitle={VERSION_STATUS_TEXT[v.status] || v.status}
                      />
                    </div>
                    <div className="text-xs font-medium text-[#382A22] flex items-center justify-between">
                      <span className="font-mono">V{v.versionNumber}</span>
                      <span
                        className={`text-[11px] ${
                          isBoundVersion ? 'text-[#4A8276] font-medium' : 'text-[#9A887B]'
                        }`}
                      >
                        {isBoundVersion ? '已绑定' : VERSION_STATUS_TEXT[v.status]}
                      </span>
                    </div>
                    <div className="text-[11px] text-[#9A887B] truncate mt-0.5">
                      {RESULT_KIND_TEXT[v.resultKind] || v.resultKind}
                    </div>
                  </motion.button>
                );
              })}
            </div>

            {!isLocked && (
              <div className="pt-4 border-t border-[#EAE2D6] flex flex-wrap items-center gap-2.5">
                <button
                  type="button"
                  onClick={() => handleRedraw(false)}
                  disabled={
                    actionBusy !== null ||
                    hasRunningTask ||
                    card.remainingAttempts <= 0 ||
                    !card.photoAvailable
                  }
                  className="group inline-flex items-center justify-center gap-1.5 px-4 py-2 text-xs font-medium btn-ink-tinted whitespace-nowrap"
                >
                  <RefreshCw className="w-3.5 h-3.5 transition-transform duration-300 group-hover:rotate-180" />
                  <span>
                    {card.remainingAttempts > 0
                      ? `重新生成（剩 ${card.remainingAttempts} 次）`
                      : '已达生成次数上限'}
                  </span>
                </button>

                <button
                  type="button"
                  onClick={() => setShowFallbackPicker((v) => !v)}
                  disabled={actionBusy !== null || hasRunningTask}
                  className="px-4 py-2 text-xs font-medium btn-paper-soft whitespace-nowrap"
                >
                  预设模板兜底
                </button>
              </div>
            )}

            {!card.photoAvailable && !isLocked && (
              <p className="text-xs text-[#9A6838]">
                原始参考照片已到期清理（PHOTO_EXPIRED），已有生成结果继续保留；如需重生成请重新发起定制。
              </p>
            )}

            <AnimatePresence initial={false}>
              {showFallbackPicker && !isLocked && (
                <motion.div
                  initial={{ height: 0, opacity: 0 }}
                  animate={{ height: 'auto', opacity: 1 }}
                  exit={{ height: 0, opacity: 0 }}
                  transition={{ duration: 0.24, ease: EASE_STUDIO }}
                  className="overflow-hidden"
                >
                  <div className="pt-4 border-t border-[#EAE2D6] space-y-3">
                    <div className="text-xs font-medium text-[#382A22]">
                      选择预设水彩手作模板（单卡片最多保留一个模板版本）：
                    </div>
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                      {templates.map((tpl) => (
                        <motion.button
                          key={tpl.id}
                          type="button"
                          data-pressable="card"
                          whileHover={{ y: -1.5 }}
                          onClick={() => handleApplyFallback(tpl.id)}
                          disabled={actionBusy !== null}
                          className="flex items-center gap-3 p-2.5 rounded-xl border border-[#EAE2D6] bg-white hover:border-[#4A8276] text-left transition-colors"
                        >
                          <div className="w-12 h-16 rounded-lg overflow-hidden shrink-0 bg-white border border-[#F0E9DF] p-1 flex items-center justify-center">
                            <SafeImage
                              src={tpl.imageUrl}
                              alt={tpl.name}
                              className="w-full h-full object-contain"
                            />
                          </div>
                          <div className="min-w-0">
                            <div className="text-xs font-medium text-[#382A22] truncate">
                              {tpl.name}
                            </div>
                            <div className="text-[11px] text-[#9A887B] line-clamp-2 mt-0.5">
                              {tpl.description}
                            </div>
                          </div>
                        </motion.button>
                      ))}
                    </div>
                  </div>
                </motion.div>
              )}
            </AnimatePresence>
          </div>
        </section>

        {/* Right: Bind Personal Doll + Mock Output Job */}
        <section
          className={`${
            mobileCardTab === 'versions' ? 'hidden lg:block' : 'block'
          } lg:col-span-6 space-y-4`}
        >
          {/* Bind Module */}
          <div className="studio-card rounded-[20px] p-5 sm:p-6 space-y-5">
            {card.boundDoll ? (
              <>
                <div className="space-y-1.5">
                  <div className="text-[11px] font-mono uppercase tracking-wider text-[#4A8276]">
                    Personal Doll Bound
                  </div>
                  <h2 className="font-editorial text-2xl font-semibold text-[#382A22]">
                    {card.boundDoll.name}
                  </h2>
                  <p className="text-xs text-[#6E5C50] leading-relaxed">
                    已绑定版本 <span className="font-mono text-[#382A22]">{card.boundDoll.cardVersionId}</span>，称呼「{card.userNickname}」、人格「{card.persona.mbti} · {card.persona.name}」与配饰均已写入角色记忆。
                  </p>
                </div>

                <div className="flex flex-col sm:flex-row items-start sm:items-center gap-4 p-4 rounded-xl studio-inset">
                  {card.boundDoll.qrSvg && (
                    <motion.div
                      whileHover={{ scale: 1.03 }}
                      className="w-24 h-24 shrink-0 rounded-lg border border-[#EAE2D6] bg-white p-1.5 [&>svg]:w-full [&>svg]:h-full"
                      dangerouslySetInnerHTML={{ __html: card.boundDoll.qrSvg }}
                    />
                  )}
                  <div className="min-w-0 flex-1 space-y-2.5">
                    <div className="text-[11px] text-[#9A887B]">
                      角色固定链接（关闭再打开可恢复对话与记忆）
                    </div>
                    <div className="text-xs font-mono text-[#382A22] bg-white border border-[#EAE2D6] px-3 py-2 rounded-lg break-all">
                      {card.boundDoll.dollUrl}
                    </div>
                    <button
                      type="button"
                      onClick={handleCopyDollUrl}
                      className="inline-flex items-center gap-1.5 text-xs font-medium btn-icon-ghost"
                    >
                      <AnimatePresence mode="wait" initial={false}>
                        <motion.span
                          key={copiedDollUrl ? 'ok' : 'cp'}
                          initial={{ scale: 0.65, opacity: 0 }}
                          animate={{ scale: 1, opacity: 1 }}
                          exit={{ scale: 0.65, opacity: 0 }}
                          transition={{ duration: 0.14 }}
                          className="inline-flex text-[#4A8276]"
                        >
                          {copiedDollUrl ? (
                            <Check className="w-3.5 h-3.5" />
                          ) : (
                            <Copy className="w-3.5 h-3.5" />
                          )}
                        </motion.span>
                      </AnimatePresence>
                      <span>{copiedDollUrl ? '已复制固定链接' : '复制固定链接'}</span>
                    </button>
                  </div>
                </div>

                <div className="flex flex-wrap items-center gap-2.5">
                  <Link
                    to={`/d/${card.boundDoll.id}/chat`}
                    className="group inline-flex items-center justify-center gap-2 px-5 py-2.5 text-sm font-medium btn-capsule-primary whitespace-nowrap"
                  >
                    <MessageSquare className="w-4 h-4 transition-transform duration-200 group-hover:-rotate-6" />
                    <span>立即与 {card.boundDoll.name} 对话</span>
                  </Link>
                  <Link
                    to={`/d/${card.boundDoll.id}`}
                    className="text-center px-4 py-2.5 text-xs font-medium btn-paper-soft whitespace-nowrap"
                  >
                    打开角色档案
                  </Link>
                </div>
              </>
            ) : (
              <form onSubmit={handleBind} className="space-y-4">
                <div className="space-y-1.5">
                  <h2 className="font-editorial text-xl font-semibold text-[#382A22]">
                    绑定为专属个人娃娃
                  </h2>
                  <p className="text-xs text-[#6E5C50] leading-relaxed">
                    选定左侧满意的成功版本并命名。绑定采用一次绑定机制，完成后卡片将锁定并生成专属固定链接与二维码。
                  </p>
                </div>

                <div className="p-3.5 rounded-xl studio-inset text-xs text-[#6E5C50] flex items-center justify-between gap-2">
                  <span>当前选定版本</span>
                  <span className="font-mono font-medium text-[#382A22]">
                    {selectedVersion
                      ? `V${selectedVersion.versionNumber} (${selectedVersion.id})`
                      : '未选择'}
                  </span>
                </div>

                <div className="space-y-1.5">
                  <label htmlFor="dollNameInput" className="block text-xs font-medium text-[#382A22]">
                    角色名称
                  </label>
                  <input
                    id="dollNameInput"
                    type="text"
                    required
                    maxLength={32}
                    value={dollName}
                    onChange={(e) => setDollName(e.target.value)}
                    placeholder="例如：薄荷小栗"
                    className="w-full px-4 py-3 sm:py-2.5 text-[16px] sm:text-sm text-[#382A22] placeholder:text-[#B3A497] bg-[#FAF7F2] border border-[#E4DBCE] rounded-xl focus:outline-none focus:bg-white focus:ring-2 focus:ring-[#4A8276]/20 focus:border-[#4A8276]"
                  />
                </div>

                <button
                  type="submit"
                  disabled={!canBindSelected || !dollName.trim() || actionBusy !== null}
                  className="w-full py-3 px-5 text-sm font-medium btn-capsule-primary"
                >
                  {actionBusy === 'bind'
                    ? '正在创建个人娃娃…'
                    : canBindSelected
                    ? '确认绑定并生成固定链接'
                    : '请先选择一个生成成功的版本'}
                </button>
              </form>
            )}
          </div>

          {/* Mock Output Job Module */}
          <div className="studio-card rounded-[20px] p-5 sm:p-6 space-y-5">
            <div className="space-y-1.5">
              <div className="flex items-center gap-2">
                <Printer className="w-4 h-4 text-[#C9963B]" />
                <h2 className="font-editorial text-xl font-semibold text-[#382A22]">
                  模拟出图任务
                </h2>
              </div>
              <p className="text-xs text-[#6E5C50] leading-relaxed">
                锁定当前选定版本并提交模拟出图执行器。当前版本固定返回{' '}
                <span className="font-mono text-[#382A22]">mode=mock</span> 与{' '}
                <span className="font-mono text-[#382A22]">physicalExecuted=false</span>（不执行实体打印或机械臂绘图）。
              </p>
            </div>

            <div className="flex flex-wrap items-center justify-between gap-4">
              <div className="flex items-center gap-5 border-b border-[#EAE2D6]">
                {(['A6', 'A5', 'SQUARE_100'] as const).map((sz) => {
                  const active = paperSize === sz;
                  return (
                    <button
                      key={sz}
                      type="button"
                      onClick={() => {
                        haptic('selection');
                        setPaperSize(sz);
                      }}
                      className={`relative pb-1.5 text-xs font-mono font-medium transition-colors whitespace-nowrap ${
                        active ? 'text-[#382A22]' : 'text-[#9A887B] hover:text-[#382A22]'
                      }`}
                    >
                      {sz}
                      {active && (
                        <motion.span
                          layoutId="paper-size-ink"
                          transition={{ type: 'spring', stiffness: 440, damping: 34 }}
                          className="absolute left-0 right-0 -bottom-px h-[2px] bg-[#4A8276]"
                        />
                      )}
                    </button>
                  );
                })}
              </div>

              <button
                type="button"
                onClick={() => handleSubmitPlotJob(false)}
                disabled={!canPlotSelected || actionBusy !== null}
                className="inline-flex items-center justify-center gap-1.5 px-4 py-2 text-xs font-medium btn-stamp-water whitespace-nowrap"
              >
                <Printer className="w-3.5 h-3.5 text-[#3B7366]" />
                <span>{actionBusy === 'plot' ? '提交中…' : '提交模拟出图'}</span>
              </button>
            </div>

            {jobs.length > 0 && (
              <div className="space-y-2.5 pt-4 border-t border-[#EAE2D6]">
                <div className="text-xs font-medium text-[#382A22]">本卡片出图记录</div>
                <div className="space-y-2">
                  <AnimatePresence initial={false}>
                    {jobs.map((job) => (
                      <motion.div
                        key={job.jobId}
                        layout
                        initial={{ opacity: 0, y: 6 }}
                        animate={{ opacity: 1, y: 0 }}
                        transition={{ duration: 0.2 }}
                        className="p-3.5 rounded-xl studio-inset flex flex-wrap items-center justify-between gap-2 text-xs"
                      >
                        <div className="space-y-0.5">
                          <div className="font-mono text-[#382A22]">{job.jobId}</div>
                          <div className="text-[#9A887B]">
                            锁定版本 <span className="font-mono">{job.cardVersionId}</span> · 纸张{' '}
                            <span className="font-mono">{job.paperSize}</span> · mode={job.mode} ·
                            physicalExecuted={String(job.physicalExecuted)}
                          </div>
                        </div>
                        <span
                          className={`font-medium ${
                            job.status === 'succeeded'
                              ? 'text-[#4A8276]'
                              : job.status === 'failed'
                              ? 'text-[#B84A39]'
                              : 'text-[#B58233]'
                          }`}
                        >
                          {JOB_STATUS_TEXT[job.status] || job.status}
                        </span>
                      </motion.div>
                    ))}
                  </AnimatePresence>
                </div>
              </div>
            )}
          </div>
        </section>
      </div>
    </div>
  );
}
