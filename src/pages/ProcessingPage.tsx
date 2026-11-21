import { useEffect, useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { motion } from 'motion/react';
import { ArrowRight, PenTool, XCircle } from 'lucide-react';
import { api, ApiError, generateIdempotencyKey } from '../lib/api';
import type { CardDetail } from '../lib/types';

const STATUS_LABELS: Record<string, string> = {
  queued: '正在排队等待生成队列',
  running: '正在绘制专属果壳娃娃形象',
  succeeded: '绘制完成，即将进入作品详情',
  failed: '生成未能完成',
  cancelled: '已取消排队任务',
};

export function ProcessingPage() {
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();
  const cardId = searchParams.get('cardId') || '';

  const [card, setCard] = useState<CardDetail | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [cancelNotice, setCancelNotice] = useState<string | null>(null);
  const [cancelling, setCancelling] = useState(false);
  const [elapsedSec, setElapsedSec] = useState(0);

  useEffect(() => {
    if (!cardId) {
      setError('链接缺少 cardId 参数，无法恢复生成任务。');
      return;
    }

    let stopped = false;
    let pollTimer: ReturnType<typeof setTimeout> | null = null;

    const poll = async () => {
      try {
        const detail = await api.getCard(cardId);
        if (stopped) return;
        setCard(detail);
        setError(null);

        const activeVer =
          detail.versions.find((v) => v.id === detail.activeVersionId) ||
          detail.versions[detail.versions.length - 1];

        if (!activeVer) return;

        if (activeVer.status === 'succeeded') {
          setTimeout(() => {
            if (!stopped) navigate(`/card/${cardId}`, { replace: true });
          }, 500);
          return;
        }

        if (activeVer.status === 'queued' || activeVer.status === 'running') {
          pollTimer = setTimeout(poll, 1000);
        }
      } catch (err) {
        if (stopped) return;
        setError(err instanceof Error ? err.message : '查询生成状态失败');
      }
    };

    void poll();

    const clock = setInterval(() => {
      setElapsedSec((s) => s + 1);
    }, 1000);

    return () => {
      stopped = true;
      if (pollTimer) clearTimeout(pollTimer);
      clearInterval(clock);
    };
  }, [cardId, navigate]);

  const activeVersion =
    card?.versions.find((v) => v.id === card.activeVersionId) ||
    card?.versions[card.versions.length - 1];

  const handleCancelQueued = async () => {
    if (!activeVersion || cancelling) return;
    setCancelling(true);
    setCancelNotice(null);
    try {
      await api.cancelVersion(activeVersion.id, generateIdempotencyKey('cancel'));
      const refreshed = await api.getCard(cardId);
      setCard(refreshed);
      setCancelNotice('已成功取消排队中的生成任务。');
    } catch (err) {
      if (err instanceof ApiError) {
        setCancelNotice(`[${err.code}] ${err.message}`);
      } else {
        setCancelNotice(err instanceof Error ? err.message : '取消失败');
      }
    } finally {
      setCancelling(false);
    }
  };

  if (error) {
    return (
      <div className="max-w-[680px] mx-auto px-4 sm:px-8 py-8 sm:py-16">
        <div className="studio-card rounded-[20px] p-6 sm:p-8 space-y-4">
          <h1 className="font-editorial text-2xl font-semibold text-[#382A22]">无法恢复任务进度</h1>
          <p className="text-sm text-[#6E5C50]">{error}</p>
          <Link to="/create" className="inline-block text-sm font-medium btn-icon-ghost">
            返回定制台
          </Link>
        </div>
      </div>
    );
  }

  const isInFlight = activeVersion?.status === 'queued' || activeVersion?.status === 'running';

  return (
    <div className="max-w-[700px] mx-auto px-4 sm:px-8 py-6 sm:py-16">
      <motion.div
        initial={{ opacity: 0, y: 14 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.4, ease: [0.22, 1, 0.36, 1] }}
        className="studio-card rounded-[20px] p-5 sm:p-8 space-y-6 sm:space-y-7"
      >
        <div className="space-y-2">
          <div className="text-[11px] font-mono tracking-wider uppercase text-[#9A887B] flex flex-wrap items-center gap-2">
            <span>TASK · {cardId}</span>
            {activeVersion && (
              <>
                <span aria-hidden="true">/</span>
                <span>V{activeVersion.versionNumber}</span>
                <span aria-hidden="true">/</span>
                <span>{activeVersion.provider}</span>
              </>
            )}
          </div>
          <h1 className="font-editorial text-2xl sm:text-3xl font-semibold text-[#382A22]">
            {activeVersion
              ? STATUS_LABELS[activeVersion.status] || activeVersion.status
              : '正在同步任务状态…'}
          </h1>
          <p className="text-xs sm:text-sm text-[#6E5C50]">
            支持刷新页面自动恢复当前进度，不会重复提交或扣减生成次数。
          </p>
        </div>

        <div className="p-5 rounded-xl studio-inset space-y-4">
          <div className="flex items-center justify-between gap-4">
            <div className="flex items-center gap-3">
              {isInFlight ? (
                <motion.div
                  animate={{ rotate: [-10, 10, -10], y: [0, -2, 0] }}
                  transition={{ duration: 1.5, repeat: Infinity, ease: 'easeInOut' }}
                  className="text-[#4A8276]"
                >
                  <PenTool className="w-4 h-4" />
                </motion.div>
              ) : activeVersion?.status === 'failed' || activeVersion?.status === 'cancelled' ? (
                <XCircle className="w-4 h-4 text-[#B84A39]" />
              ) : null}
              <span className="text-sm font-medium text-[#382A22]">
                {card
                  ? `给 ${card.userNickname} 定制 · ${card.persona.mbti} ${card.persona.name}`
                  : '读取任务信息中…'}
              </span>
            </div>
            <span className="text-sm font-mono tabular-nums text-[#6E5C50]">
              {activeVersion?.latencyMs != null
                ? `${(activeVersion.latencyMs / 1000).toFixed(1)}s`
                : `${elapsedSec}s`}
            </span>
          </div>

          {isInFlight && (
            <div className="h-1 rounded-full bg-[#E8E0D4] overflow-hidden">
              <div className="h-full w-2/5 rounded-full bg-[#4A8276] watercolor-bar" />
            </div>
          )}

          {activeVersion?.errorCode && (
            <div className="p-3 rounded-lg bg-[#FDF2F0] border border-[#E5B8B0] text-xs text-[#9E3D2E]">
              <span className="font-mono font-medium mr-1.5">[{activeVersion.errorCode}]</span>
              <span>{activeVersion.errorMessage || '生成未成功，可在作品页重新生成或选择模板兜底'}</span>
            </div>
          )}

          {cancelNotice && (
            <div className="p-3 rounded-lg bg-white border border-[#EAE2D6] text-xs text-[#382A22]">
              {cancelNotice}
            </div>
          )}
        </div>

        <div className="flex flex-col sm:flex-row sm:flex-wrap sm:items-center justify-between gap-3 pt-4 border-t border-[#EAE2D6]">
          {isInFlight && activeVersion ? (
            <button
              type="button"
              onClick={handleCancelQueued}
              disabled={cancelling}
              className="py-1.5 text-xs font-medium btn-icon-danger whitespace-nowrap text-left sm:text-center"
            >
              {activeVersion.status === 'queued'
                ? cancelling
                  ? '正在取消…'
                  : '取消排队任务'
                : '尝试取消（执行中将返回 409 冲突）'}
            </button>
          ) : (
            <span className="text-xs text-[#9A887B]">
              任务已结束，可前往作品详情查看版本或绑定角色。
            </span>
          )}

          <Link
            to={`/card/${cardId}`}
            className="w-full sm:w-auto group inline-flex items-center justify-center gap-1.5 px-6 py-2.5 text-sm font-medium btn-capsule-primary whitespace-nowrap"
          >
            <span>查看作品详情</span>
            <ArrowRight className="w-4 h-4 transition-transform duration-200 group-hover:translate-x-1" />
          </Link>
        </div>
      </motion.div>
    </div>
  );
}
