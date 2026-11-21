import { useEffect, useState } from 'react';
import { AnimatePresence, motion } from 'motion/react';
import { RefreshCw, RotateCcw, ShieldCheck } from 'lucide-react';
import { api, ApiError } from '../lib/api';
import type { DemoStatusPayload, SessionInfo } from '../lib/types';
import { haptic } from '../lib/haptics';

type DevTab = 'overview' | 'sessions' | 'logs';
const EASE_STUDIO = [0.22, 1, 0.36, 1] as const;

export function DevAdminPage() {
  const [adminToken, setAdminToken] = useState(
    () => sessionStorage.getItem('nutshell_admin_token') || ''
  );
  const [currentSession, setCurrentSession] = useState<SessionInfo | null>(null);
  const [status, setStatus] = useState<DemoStatusPayload | null>(null);
  const [activeTab, setActiveTab] = useState<DevTab>('overview');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [resettingId, setResettingId] = useState<string | null>(null);

  useEffect(() => {
    void api.initSession().then(setCurrentSession).catch(() => {});
  }, []);

  const loadStatus = async (tokenToUse: string) => {
    const trimmed = tokenToUse.trim();
    if (!trimmed) {
      setError('请输入 DEMO_ADMIN_TOKEN 后加载状态。');
      return;
    }
    setLoading(true);
    setError(null);
    setNotice(null);
    try {
      const data = await api.getDemoStatus(trimmed);
      sessionStorage.setItem('nutshell_admin_token', trimmed);
      setStatus(data);
    } catch (err) {
      setStatus(null);
      if (err instanceof ApiError) {
        setError(`[${err.code}] ${err.message}`);
      } else {
        setError(err instanceof Error ? err.message : '加载系统状态失败');
      }
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (adminToken) {
      void loadStatus(adminToken);
    }
  }, []);

  const handleAuthSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    haptic('light');
    void loadStatus(adminToken);
  };

  const handleResetSession = async (sessionId: string) => {
    if (!adminToken.trim() || resettingId) return;
    haptic('warning');
    setResettingId(sessionId);
    setNotice(null);
    setError(null);
    try {
      const res = await api.resetDemoSession(adminToken.trim(), sessionId);
      setNotice(`已清理会话 ${res.resetSessionId}；常驻角色与其他会话保持原状。`);
      const nextSess = await api.initSession();
      setCurrentSession(nextSess);
      await loadStatus(adminToken.trim());
    } catch (err) {
      if (err instanceof ApiError) {
        setError(`[${err.code}] ${err.message}`);
      } else {
        setError(err instanceof Error ? err.message : '重置会话失败');
      }
    } finally {
      setResettingId(null);
    }
  };

  return (
    <div className="max-w-[1160px] mx-auto px-3.5 sm:px-8 py-3 sm:py-6 space-y-3.5 sm:space-y-5">
      {/* Compact Admin Token Strip */}
      <form
        onSubmit={handleAuthSubmit}
        className="studio-card rounded-[18px] p-3.5 sm:p-4 flex flex-col sm:flex-row sm:items-center justify-between gap-2.5 sm:gap-4"
      >
        <div className="flex items-center gap-2.5 flex-1 min-w-0">
          <ShieldCheck className="w-4 h-4 text-[#4A8276] shrink-0" />
          <input
            id="adminToken"
            type="password"
            aria-label="管理员令牌"
            value={adminToken}
            onChange={(e) => setAdminToken(e.target.value)}
            placeholder="管理员令牌（默认：demo-admin-2026）"
            className="flex-1 min-w-0 px-3 py-2 text-[16px] sm:text-xs font-mono text-[#382A22] placeholder:text-[#B3A497] bg-[#FAF7F2] border border-[#E4DBCE] rounded-xl focus:outline-none focus:bg-white focus:ring-2 focus:ring-[#4A8276]/20 focus:border-[#4A8276]"
          />
        </div>

        <div className="flex items-center justify-between sm:justify-end gap-3 shrink-0">
          {currentSession && (
            <span className="text-[11px] font-mono text-[#9A887B] truncate max-w-[160px] sm:max-w-none">
              会话 {currentSession.sessionId}
            </span>
          )}
          <button
            type="submit"
            disabled={loading}
            className="inline-flex items-center justify-center gap-1.5 px-4 py-2 text-xs font-medium btn-ink-tinted whitespace-nowrap shrink-0"
          >
            <RefreshCw className={`w-3.5 h-3.5 ${loading ? 'animate-spin' : ''}`} />
            <span>{status ? '刷新' : '验证查看'}</span>
          </button>
        </div>
      </form>

      {error && (
        <div className="p-3 rounded-xl border border-[#E5B8B0] bg-[#FDF2F0] text-xs text-[#9E3D2E]">
          {error}
        </div>
      )}

      {notice && (
        <div className="p-3 rounded-xl border border-[#4A8276]/35 bg-[#ECF5F2]/70 text-xs text-[#382A22]">
          {notice}
        </div>
      )}

      {status && (
        <div className="space-y-3.5 sm:space-y-4">
          {/* Native iOS Segmented Control for Console Sections */}
          <div
            role="tablist"
            aria-label="控制台视图"
            className="ios-segmented grid grid-cols-3 sm:max-w-[380px]"
          >
            {(
              [
                { key: 'overview' as const, label: '服务概览' },
                { key: 'sessions' as const, label: `会话 (${status.activeSessions.length})` },
                { key: 'logs' as const, label: `日志 (${status.recentRuns.length})` },
              ] as const
            ).map((tab) => {
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
                  className={`relative py-2 px-2 text-[12px] font-medium rounded-[10px] transition-colors whitespace-nowrap ${
                    active ? 'text-[#382A22]' : 'text-[#7D6C5F]'
                  }`}
                >
                  {active && (
                    <motion.span
                      layoutId="dev-tab-thumb"
                      transition={{ type: 'spring', stiffness: 460, damping: 34 }}
                      className="absolute inset-0 ios-segmented-thumb"
                    />
                  )}
                  <span className="relative z-10">{tab.label}</span>
                </button>
              );
            })}
          </div>

          <AnimatePresence mode="wait">
            {activeTab === 'overview' && (
              <motion.div
                key="dev-overview"
                initial={{ opacity: 0, y: 6 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -4 }}
                transition={{ duration: 0.2, ease: EASE_STUDIO }}
                className="space-y-3.5 sm:space-y-4"
              >
                {/* 3 Compact Provider Cards */}
                <div className="grid grid-cols-1 md:grid-cols-3 gap-3 sm:gap-4">
                  <div className="studio-card rounded-[18px] p-4 space-y-2">
                    <div className="flex items-center justify-between text-[11px]">
                      <span className="text-[#9A887B]">对话服务</span>
                      <span className="font-medium text-[#4A8276]">
                        {status.providers.chat.configured ? '已就绪' : '未配置'}
                      </span>
                    </div>
                    <div className="font-editorial text-base font-semibold text-[#382A22]">
                      {status.providers.chat.mode === 'cloud' ? '云端模型 (cloud)' : '本地模拟 (mock)'}
                    </div>
                    <div className="text-[11px] font-mono text-[#6E5C50] flex items-center justify-between pt-2 border-t border-[#F0E9DF]">
                      <span className="truncate">{status.providers.chat.model}</span>
                      <span className="tabular-nums shrink-0">
                        {status.providers.chat.firstTokenTargetMs}ms
                      </span>
                    </div>
                  </div>

                  <div className="studio-card rounded-[18px] p-4 space-y-2">
                    <div className="flex items-center justify-between text-[11px]">
                      <span className="text-[#9A887B]">生图服务</span>
                      <span className="font-medium text-[#4A8276]">
                        {status.providers.image.configured ? '已就绪' : '未配置'}
                      </span>
                    </div>
                    <div className="font-editorial text-base font-semibold text-[#382A22]">
                      {status.providers.image.mode === 'cloud' ? '云端生图 (cloud)' : '本地模拟 (mock)'}
                    </div>
                    <div className="text-[11px] font-mono text-[#6E5C50] flex items-center justify-between pt-2 border-t border-[#F0E9DF]">
                      <span className="truncate">{status.providers.image.model}</span>
                      <span className="tabular-nums shrink-0">
                        {status.providers.image.performanceTargetMs / 1000}s
                      </span>
                    </div>
                  </div>

                  <div className="studio-card rounded-[18px] p-4 space-y-2">
                    <div className="flex items-center justify-between text-[11px]">
                      <span className="text-[#9A887B]">出图与库存</span>
                      <span className="font-mono text-[#6E5C50]">mock</span>
                    </div>
                    <div className="font-editorial text-base font-semibold text-[#382A22]">
                      常驻 {status.counts.demoDolls} · 个人 {status.counts.personalDolls} · 卡片{' '}
                      {status.counts.cards}
                    </div>
                    <div className="text-[11px] font-mono text-[#9A887B] pt-2 border-t border-[#F0E9DF]">
                      physicalExecuted=false
                    </div>
                  </div>
                </div>

                {/* Compact Metrics Pair */}
                <div className="grid grid-cols-1 lg:grid-cols-2 gap-3 sm:gap-4">
                  <div className="studio-card rounded-[18px] p-4 space-y-2.5">
                    <h2 className="font-editorial text-sm font-semibold text-[#382A22]">
                      对话性能统计
                    </h2>
                    {status.metrics.chat.length === 0 ? (
                      <p className="text-xs text-[#9A887B]">暂无对话记录。</p>
                    ) : (
                      <div className="divide-y divide-[#F0E9DF] text-xs font-mono">
                        {status.metrics.chat.map((m, idx) => (
                          <div key={idx} className="py-2 flex items-center justify-between gap-2">
                            <span className="text-[#382A22]">
                              {m.provider || '-'} · {m.status} ({m.cnt})
                            </span>
                            <span className="text-[#6E5C50] tabular-nums">
                              首字 {m.avg_ttft_ms != null ? `${Math.round(m.avg_ttft_ms)}ms` : '-'} /
                              总 {m.avg_total_ms != null ? `${Math.round(m.avg_total_ms)}ms` : '-'}
                            </span>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>

                  <div className="studio-card rounded-[18px] p-4 space-y-2.5">
                    <h2 className="font-editorial text-sm font-semibold text-[#382A22]">
                      生图与模板统计
                    </h2>
                    {status.metrics.image.length === 0 ? (
                      <p className="text-xs text-[#9A887B]">暂无生图或模板记录。</p>
                    ) : (
                      <div className="divide-y divide-[#F0E9DF] text-xs font-mono">
                        {status.metrics.image.map((m, idx) => (
                          <div key={idx} className="py-2 flex items-center justify-between gap-2">
                            <span className="text-[#382A22] truncate">
                              {m.provider} · {m.result_kind} ({m.cnt})
                            </span>
                            <span className="text-[#6E5C50] tabular-nums shrink-0">
                              {m.status} · {m.avg_ms != null ? `${(m.avg_ms / 1000).toFixed(1)}s` : '-'}
                            </span>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                </div>
              </motion.div>
            )}

            {activeTab === 'sessions' && (
              <motion.section
                key="dev-sessions"
                initial={{ opacity: 0, y: 6 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -4 }}
                transition={{ duration: 0.2, ease: EASE_STUDIO }}
                className="studio-card rounded-[18px] p-4 sm:p-5 space-y-3"
              >
                <div className="flex items-center justify-between gap-2">
                  <h2 className="font-editorial text-base font-semibold text-[#382A22]">
                    活跃会话管理
                  </h2>
                  <span className="text-[11px] text-[#9A887B]">仅清理指定演示会话</span>
                </div>

                {status.activeSessions.length === 0 ? (
                  <p className="text-xs text-[#9A887B]">当前无活跃会话。</p>
                ) : (
                  <div className="divide-y divide-[#EAE2D6]">
                    {status.activeSessions.map((s) => {
                      const isCurrent = currentSession?.sessionId === s.id;
                      const runningCount = s.running_versions + s.running_jobs;
                      return (
                        <div
                          key={s.id}
                          className="py-3 flex flex-col sm:flex-row sm:items-center justify-between gap-2 text-xs"
                        >
                          <div className="space-y-1 min-w-0">
                            <div className="flex items-center gap-2">
                              <span className="font-mono text-[#382A22] truncate">{s.id}</span>
                              {isCurrent && (
                                <span className="text-[11px] font-medium text-[#4A8276] shrink-0">
                                  本浏览器
                                </span>
                              )}
                            </div>
                            <div className="text-[11px] font-mono tabular-nums text-[#6E5C50]">
                              卡片 {s.card_count} · 娃娃 {s.personal_doll_count} · 消息{' '}
                              {s.message_count} ·{' '}
                              {runningCount > 0 ? (
                                <span className="text-[#B84A39]">{runningCount} 运行中</span>
                              ) : (
                                <span className="text-[#9A887B]">空闲</span>
                              )}
                            </div>
                          </div>

                          <button
                            type="button"
                            onClick={() => handleResetSession(s.id)}
                            disabled={resettingId !== null}
                            className="self-end sm:self-auto inline-flex items-center gap-1.5 text-xs font-medium btn-icon-ghost whitespace-nowrap"
                          >
                            <RotateCcw className="w-3.5 h-3.5 text-[#4A8276]" />
                            <span>{resettingId === s.id ? '重置中…' : '重置会话'}</span>
                          </button>
                        </div>
                      );
                    })}
                  </div>
                )}
              </motion.section>
            )}

            {activeTab === 'logs' && (
              <motion.section
                key="dev-logs"
                initial={{ opacity: 0, y: 6 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -4 }}
                transition={{ duration: 0.2, ease: EASE_STUDIO }}
                className="studio-card rounded-[18px] p-4 sm:p-5 space-y-3"
              >
                <h2 className="font-editorial text-base font-semibold text-[#382A22]">
                  近期运行记录 ({status.recentRuns.length})
                </h2>

                {status.recentRuns.length === 0 ? (
                  <p className="text-xs text-[#9A887B]">暂无运行日志。</p>
                ) : (
                  <div className="divide-y divide-[#EAE2D6]">
                    {status.recentRuns.slice(0, 12).map((log) => (
                      <div key={log.id} className="py-2.5 space-y-1 text-xs">
                        <div className="flex items-center justify-between gap-2">
                          <span className="font-mono text-[#382A22] truncate">
                            {log.kind} / {log.provider}
                            {log.result_kind ? ` (${log.result_kind})` : ''}
                          </span>
                          <span
                            className={`font-medium shrink-0 ${
                              log.status === 'failed' ? 'text-[#B84A39]' : 'text-[#4A8276]'
                            }`}
                          >
                            {log.status}
                          </span>
                        </div>
                        <div className="flex items-center justify-between gap-2 text-[11px] font-mono text-[#9A887B] tabular-nums">
                          <span>
                            {new Date(log.created_at).toLocaleTimeString('zh-CN', { hour12: false })}
                          </span>
                          <span>
                            {log.first_token_ms != null ? `${log.first_token_ms}ms / ` : ''}
                            {log.total_ms != null ? `${log.total_ms}ms` : '-'}
                          </span>
                        </div>
                        {(log.error_code || log.detail) && (
                          <div className="text-[11px] text-[#6E5C50] line-clamp-1">
                            {log.error_code ? `[${log.error_code}] ` : ''}
                            {log.detail || ''}
                          </div>
                        )}
                      </div>
                    ))}
                  </div>
                )}
              </motion.section>
            )}
          </AnimatePresence>
        </div>
      )}
    </div>
  );
}
