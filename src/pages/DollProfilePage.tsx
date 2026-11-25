import { useEffect, useState } from 'react';
import { Link, useParams, useSearchParams } from 'react-router-dom';
import { AnimatePresence, motion } from 'motion/react';
import {
  ArrowLeft,
  Check,
  Copy,
  Download,
  KeyRound,
  MessageSquare,
  QrCode,
  Radio,
} from 'lucide-react';
import { api } from '../lib/api';
import { isIosDevice, isWebNfcSupported, writeUrlToNfcTag } from '../lib/webNfc';
import type { DollDetail, MemoryItem } from '../lib/types';
import { SafeImage } from '../components/SafeImage';
import { WatercolorProfileSkeleton } from '../components/WatercolorLoader';
import { haptic } from '../lib/haptics';

const MEMORY_LABELS: Record<string, string> = {
  user_nickname: '你的称呼',
  doll_name: '娃娃名称',
  persona: '选定人格',
  accessories: '手作配饰',
  fact: '明确记忆',
};

const EASE_STUDIO = [0.22, 1, 0.36, 1] as const;

export function DollProfilePage() {
  const { dollId = '' } = useParams();
  const [searchParams] = useSearchParams();
  const isNfcEntry = searchParams.get('entry') === 'nfc';

  const [doll, setDoll] = useState<DollDetail | null>(null);
  const [memories, setMemories] = useState<MemoryItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [mobileSection, setMobileSection] = useState<'overview' | 'memory'>('overview');

  // Web NFC write status
  const [writingNfc, setWritingNfc] = useState(false);
  const [nfcNotice, setNfcNotice] = useState<{ ok: boolean; text: string } | null>(null);

  // Cross-browser 6-char memory claim code sync
  const [claimCode, setClaimCode] = useState<string | null>(null);
  const [claimInput, setClaimInput] = useState('');
  const [claimStatus, setClaimStatus] = useState<string | null>(null);
  const [claimBusy, setClaimBusy] = useState(false);

  const loadDollData = async () => {
    setLoading(true);
    setError(null);
    try {
      await api.initSession();
      const [d, mems] = await Promise.all([api.getDoll(dollId), api.getMemories(dollId)]);
      setDoll(d);
      setMemories(mems);
      if (isNfcEntry) {
        haptic('success');
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : '加载角色档案失败');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void loadDollData();
  }, [dollId]);

  const resolvedShareUrl = doll?.dollUrl || `${window.location.origin}/d/${dollId}`;

  const handleCopyUrl = async () => {
    if (!doll) return;
    try {
      await navigator.clipboard.writeText(resolvedShareUrl);
      haptic('success');
      setCopied(true);
      setTimeout(() => setCopied(false), 1800);
    } catch {
      setCopied(false);
    }
  };

  const handleWriteNfcTag = async () => {
    if (!doll?.nfcUrl || doll.nfcWriteScope !== 'production' || writingNfc) return;
    haptic('medium');
    setWritingNfc(true);
    if (isWebNfcSupported()) {
      setNfcNotice({ ok: true, text: '请将空白 NTAG213/215 贴纸贴近手机背面 NFC 感应区…' });
    }
    const res = await writeUrlToNfcTag(doll.nfcUrl);
    setWritingNfc(false);
    setNfcNotice({ ok: res.ok, text: res.message });
    haptic(res.ok ? 'success' : 'warning');
  };

  const handleGenerateClaimCode = async () => {
    if (claimBusy) return;
    setClaimBusy(true);
    setClaimStatus(null);
    try {
      const res = await api.createSessionClaimCode();
      setClaimCode(res.code);
      haptic('success');
      setClaimStatus('口令 24 小时有效，在 Safari / 微信等其他浏览器输入即可同步全部记忆。');
    } catch (err) {
      setClaimStatus(err instanceof Error ? err.message : '生成记忆口令失败');
    } finally {
      setClaimBusy(false);
    }
  };

  const handleClaimSession = async (e: React.FormEvent) => {
    e.preventDefault();
    const cleaned = claimInput.trim().toUpperCase();
    if (!cleaned || claimBusy) return;
    setClaimBusy(true);
    setClaimStatus(null);
    try {
      await api.claimSessionByCode(cleaned);
      setClaimInput('');
      haptic('success');
      setClaimStatus('已同步记忆档案！正在刷新该角色记忆…');
      const mems = await api.getMemories(dollId);
      setMemories(mems);
      setClaimStatus('跨端记忆同步成功，现在可以无缝续聊了。');
    } catch (err) {
      setClaimStatus(err instanceof Error ? err.message : '记忆口令无效或已过期');
    } finally {
      setClaimBusy(false);
    }
  };

  if (loading) {
    return <WatercolorProfileSkeleton />;
  }

  if (error || !doll) {
    return (
      <div className="max-w-[720px] mx-auto px-4 sm:px-8 py-8">
        <div className="studio-card rounded-2xl p-6 space-y-4">
          <h1 className="font-editorial text-xl font-semibold text-[#382A22]">未找到该角色档案</h1>
          <p className="text-sm text-[#6E5C50]">
            {error || '该固定链接对应的角色不存在或已被清理。'}
          </p>
          <Link to="/" className="inline-flex items-center gap-1.5 text-sm font-medium btn-icon-ghost">
            <ArrowLeft className="w-4 h-4" />
            <span>返回展馆</span>
          </Link>
        </div>
      </div>
    );
  }

  const downloadHref = doll.avatarUrl.startsWith('/api/assets/generated/')
    ? `${doll.avatarUrl}?download=1`
    : doll.avatarUrl;

  return (
    <div className="max-w-[1120px] mx-auto px-3.5 sm:px-8 py-3 sm:py-6 space-y-3.5 sm:space-y-5">
      {/* NFC Bump Wake-Up Watercolor Ripple Ceremony Banner */}
      {isNfcEntry && (
        <motion.div
          initial={{ opacity: 0, y: -8, scale: 0.98 }}
          animate={{ opacity: 1, y: 0, scale: 1 }}
          transition={{ duration: 0.45, ease: EASE_STUDIO }}
          className="relative overflow-hidden rounded-[20px] border border-[#B8DBD0] bg-gradient-to-r from-[#ECF7F3] via-[#FAF7F2] to-[#F7EFE2] px-4 py-3 flex items-center justify-between gap-3 shadow-[0_8px_24px_-12px_rgba(74,130,118,0.3)]"
        >
          <div className="flex items-center gap-2.5 min-w-0">
            <span className="relative flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-[#4A8276]/15 text-[#356B5F]">
              <motion.span
                animate={{ scale: [1, 1.55, 1], opacity: [0.55, 0, 0.55] }}
                transition={{ duration: 2.2, repeat: Infinity, ease: 'easeInOut' }}
                className="absolute inset-0 rounded-full border border-[#4A8276]/50"
              />
              <Radio className="w-4 h-4 relative z-10" />
            </span>
            <div className="min-w-0">
              <div className="text-xs font-semibold text-[#2B5D52]">
                碰一碰感应成功 · 已唤醒「{doll.name}」
              </div>
              <p className="text-[11px] text-[#6E5C50] truncate">
                {memories.length > 0
                  ? `已自动续接 ${memories.length} 条专属记忆，点击下方马上续聊`
                  : '欢迎初次碰面，进入对话即可开启专属回忆录'}
              </p>
            </div>
          </div>
          <Link
            to={`/d/${doll.id}/chat`}
            onClick={() => haptic('medium')}
            className="px-3.5 py-1.5 text-xs font-medium btn-capsule-primary whitespace-nowrap shrink-0"
          >
            立刻续聊
          </Link>
        </motion.div>
      )}

      {/* Desktop-only Breadcrumb */}
      <div className="hidden md:flex items-center justify-between gap-4 border-b border-[#E8DFD2] pb-3">
        <Link
          to="/"
          className="group inline-flex items-center gap-1.5 text-xs font-medium btn-icon-ghost"
        >
          <ArrowLeft className="w-3.5 h-3.5 transition-transform duration-200 group-hover:-translate-x-1" />
          <span>返回角色展馆</span>
        </Link>
        <span className="font-atelier-num italic text-[13.5px] text-[#968477]">
          Atelier Dossier · {doll.id}
        </span>
      </div>

      {/* Mobile iOS Segmented Switcher: Portrait & Intro <-> Memories & NFC */}
      <div className="lg:hidden ios-segmented grid grid-cols-2">
        {(
          [
            { key: 'overview' as const, label: '角色名片' },
            { key: 'memory' as const, label: `记忆与 NFC (${memories.length})` },
          ] as const
        ).map((t) => {
          const active = mobileSection === t.key;
          return (
            <button
              key={t.key}
              type="button"
              onClick={() => {
                haptic('selection');
                setMobileSection(t.key);
              }}
              className={`relative py-2 px-3 text-[12.5px] font-medium rounded-[10px] transition-colors whitespace-nowrap ${
                active ? 'text-[#382A22]' : 'text-[#7D6C5F]'
              }`}
            >
              {active && (
                <motion.span
                  layoutId="profile-seg-thumb"
                  transition={{ type: 'spring', stiffness: 460, damping: 34 }}
                  className="absolute inset-0 ios-segmented-thumb"
                />
              )}
              <span className="relative z-10">{t.label}</span>
            </button>
          );
        })}
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-12 gap-4 sm:gap-6 items-start">
        {/* Left: Compact Portrait + Quick Identity Card */}
        <motion.div
          initial={{ opacity: 0, y: 8 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.3, ease: EASE_STUDIO }}
          className={`${
            mobileSection === 'memory' ? 'hidden lg:block' : 'block'
          } lg:col-span-5 group`}
        >
          <div className="studio-card rounded-[22px] overflow-hidden">
            <div className="relative photo-mat-frame specimen-stage-0 px-4 pt-3.5 pb-4 overflow-hidden">
              <div className="relative z-10 flex items-baseline justify-between pb-1">
                <span className="font-atelier-num italic text-[13px] text-[#8E7C6E]">
                  {doll.kind === 'personal' ? 'Personal Edition' : 'Studio Resident'}
                </span>
                <span className="text-[11px] font-mono tracking-wide text-[#3D7267] font-semibold">
                  {doll.persona.mbti}
                </span>
              </div>
              <div className="relative h-[220px] sm:h-[300px] lg:h-[348px] flex items-center justify-center">
                <span className="doll-pedestal-shadow" aria-hidden="true" />
                <SafeImage
                  src={doll.avatarUrl}
                  alt={doll.name}
                  className="relative z-10 w-full h-full object-contain doll-hover-sway drop-shadow-[0_14px_18px_rgba(56,42,34,0.09)]"
                  fallbackTitle={doll.name}
                />
              </div>
            </div>

            {/* Mobile merged identity + CTA */}
            <div className="lg:hidden p-4 border-t border-[#EFE7DB] space-y-3.5 bg-[#FFFDF9]">
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0">
                  <h1 className="font-editorial text-[22px] leading-tight font-semibold text-[#382A22] truncate">
                    {doll.name}
                  </h1>
                  <div className="text-[11.5px] text-[#8E7C6E] mt-0.5 truncate">
                    {doll.persona.name} · {doll.persona.materialHint}
                  </div>
                </div>
                <a
                  href={downloadHref}
                  download={`${doll.name}.png`}
                  className="inline-flex items-center gap-1 text-xs font-medium btn-icon-ghost whitespace-nowrap py-1 shrink-0"
                >
                  <Download className="w-3.5 h-3.5 text-[#4A8276]" />
                  <span>保存</span>
                </a>
              </div>

              <blockquote className="atelier-pullquote px-3.5 py-2.5 text-[13px] font-editorial leading-relaxed text-[#3E3028]">
                “{doll.persona.openingLine}”
              </blockquote>

              <div className="flex items-center gap-2">
                <Link
                  to={`/d/${doll.id}/chat`}
                  onClick={() => haptic('medium')}
                  className="flex-1 inline-flex items-center justify-center gap-1.5 px-5 py-2.5 text-sm font-medium btn-capsule-primary whitespace-nowrap"
                >
                  <MessageSquare className="w-4 h-4" />
                  <span>与 {doll.name} 对话</span>
                </Link>
                {doll.isOwner && doll.cardId && (
                  <Link
                    to={`/card/${doll.cardId}`}
                    onClick={() => haptic('light')}
                    className="px-4 py-2.5 text-xs font-medium btn-paper-soft whitespace-nowrap"
                  >
                    出图
                  </Link>
                )}
              </div>
            </div>

            {/* Desktop portrait footer */}
            <div className="hidden lg:flex px-4 py-3 border-t border-[#EFE7DB] items-center justify-between gap-3 bg-[#FFFDF9]">
              <span className="text-xs text-[#8E7C6E] truncate">
                <span className="font-atelier-num italic mr-1.5">Fig. 01</span>
                {doll.kind === 'personal' ? '个人专属定制（原图私密保护）' : '手作水彩常驻角色'}
              </span>
              <a
                href={downloadHref}
                download={`${doll.name}.png`}
                className="inline-flex items-center gap-1.5 text-xs font-medium btn-icon-ghost whitespace-nowrap py-1"
              >
                <Download className="w-3.5 h-3.5 text-[#4A8276]" />
                <span>保存原图</span>
              </a>
            </div>
          </div>
        </motion.div>

        {/* Right: Desktop Identity + Memories + NFC Passport & Cross-Browser Sync */}
        <motion.div
          initial={{ opacity: 0, y: 8 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.32, delay: 0.04, ease: EASE_STUDIO }}
          className={`${
            mobileSection === 'overview' ? 'hidden lg:block' : 'block'
          } lg:col-span-7 space-y-4`}
        >
          {/* Desktop Identity & Primary CTA Card */}
          <div className="hidden lg:block studio-card rounded-[22px] p-6 space-y-5">
            <div className="flex items-start justify-between gap-4">
              <div className="space-y-1.5">
                <div className="text-xs text-[#8E7C6E] flex flex-wrap items-center gap-1.5">
                  <span className="font-mono font-semibold text-[#3D7267]">{doll.persona.mbti}</span>
                  <span aria-hidden="true">·</span>
                  <span>{doll.persona.name}</span>
                  {doll.persona.cognitiveAxis && (
                    <>
                      <span aria-hidden="true">·</span>
                      <span className="font-mono text-[#7C6A5E]">{doll.persona.cognitiveAxis}</span>
                    </>
                  )}
                </div>
                <h1 className="font-editorial text-[32px] leading-tight font-semibold text-[#382A22]">
                  {doll.name}
                </h1>
              </div>

              <div className="flex items-center gap-2 shrink-0">
                <Link
                  to={`/d/${doll.id}/chat`}
                  onClick={() => haptic('medium')}
                  className="inline-flex items-center justify-center gap-1.5 px-5 py-2.5 text-sm font-medium btn-capsule-primary whitespace-nowrap"
                >
                  <MessageSquare className="w-4 h-4" />
                  <span>开始对话</span>
                </Link>
                {doll.isOwner && doll.cardId && (
                  <Link
                    to={`/card/${doll.cardId}`}
                    onClick={() => haptic('light')}
                    className="inline-flex items-center justify-center px-4 py-2.5 text-xs font-medium btn-paper-soft whitespace-nowrap"
                  >
                    版本与出图
                  </Link>
                )}
              </div>
            </div>

            <blockquote className="atelier-pullquote px-4 py-3.5 font-editorial text-[15px] leading-relaxed text-[#3E3028]">
              “{doll.persona.openingLine}”
            </blockquote>
          </div>

          {/* Session Memory Card */}
          <div className="studio-card rounded-[20px] p-4 sm:p-5 space-y-3">
            <div className="flex items-center justify-between">
              <h2 className="text-sm font-semibold text-[#382A22]">当前角色记忆</h2>
              <span className="text-xs font-mono tabular-nums text-[#9A887B]">
                {memories.length} 项
              </span>
            </div>
            {memories.length === 0 ? (
              <p className="text-xs text-[#9A887B] leading-relaxed">
                尚未录入记忆条目。进入对话后，你可以随时设定称呼或记录想让角色记住的事。
              </p>
            ) : (
              <dl className="divide-y divide-[#F0E9DF] sm:divide-y-0 sm:grid sm:grid-cols-2 sm:gap-2.5">
                {memories.map((m) => (
                  <div
                    key={m.id}
                    className="py-2 sm:px-3 sm:py-2 sm:rounded-xl sm:studio-inset flex sm:block items-baseline justify-between gap-3"
                  >
                    <dt className="text-[11px] text-[#4A8276] font-medium shrink-0">
                      {MEMORY_LABELS[m.type] || m.type}
                    </dt>
                    <dd className="text-[13px] text-[#382A22] sm:mt-0.5 break-words text-right sm:text-left">
                      {m.value}
                    </dd>
                  </div>
                ))}
              </dl>
            )}
          </div>

          {/* Fixed Link, Web NFC Direct Write & Cross-Browser Memory Claim Passport */}
          <div className="studio-card atelier-passport rounded-[22px] p-4 sm:p-5 space-y-4">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div className="flex items-center gap-2">
                <QrCode className="w-4 h-4 text-[#4A8276]" />
                <div>
                  <span className="text-sm font-semibold text-[#382A22]">固定链接与 NFC 凭证</span>
                  <span className="hidden sm:inline font-atelier-num italic text-xs text-[#968477] ml-2">
                    Collector Passport
                  </span>
                </div>
              </div>
              <div className="flex items-center gap-2">
                {doll.nfcWriteScope === 'production' && <button
                  type="button"
                  onClick={handleWriteNfcTag}
                  disabled={writingNfc}
                  className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium btn-ink-tinted whitespace-nowrap"
                >
                  <Radio className={`w-3.5 h-3.5 text-[#4A8276] ${writingNfc ? 'animate-pulse' : ''}`} />
                  <span>
                    {writingNfc
                      ? '请贴近标签…'
                      : isIosDevice()
                      ? 'iPhone 写签助手'
                      : '写入 NFC 标签'}
                  </span>
                </button>}
                <button
                  type="button"
                  onClick={handleCopyUrl}
                  className="inline-flex items-center gap-1.5 text-xs font-medium btn-icon-ghost whitespace-nowrap py-1"
                >
                  <AnimatePresence mode="wait" initial={false}>
                    <motion.span
                      key={copied ? 'check' : 'copy'}
                      initial={{ scale: 0.65, opacity: 0 }}
                      animate={{ scale: 1, opacity: 1 }}
                      exit={{ scale: 0.65, opacity: 0 }}
                      transition={{ duration: 0.14 }}
                      className="inline-flex text-[#4A8276]"
                    >
                      {copied ? <Check className="w-3.5 h-3.5" /> : <Copy className="w-3.5 h-3.5" />}
                    </motion.span>
                  </AnimatePresence>
                  <span>{copied ? '已复制' : '复制链接'}</span>
                </button>
              </div>
            </div>

            {nfcNotice && (
              <div
                className={`p-2.5 rounded-xl text-[11.5px] leading-relaxed border ${
                  nfcNotice.ok
                    ? 'border-[#C1E0D6] bg-[#ECF7F3] text-[#2A5A4F]'
                    : 'border-[#E5B8B0] bg-[#FDF2F0] text-[#9E3D2E]'
                }`}
              >
                {nfcNotice.text}
              </div>
            )}

            <div className="flex items-center gap-3.5 p-3 rounded-2xl bg-[#FFFDF9]/85 border border-[#E7DEC9]">
              <div
                className="w-18 h-18 sm:w-20 sm:h-20 shrink-0 rounded-xl border border-[#EAE2D6] bg-white p-1.5 shadow-[0_2px_6px_rgba(56,42,34,0.05)] [&>svg]:w-full [&>svg]:h-full"
                dangerouslySetInnerHTML={{ __html: doll.qrSvg }}
                aria-label="角色固定链接二维码"
              />
              <div className="min-w-0 flex-1 space-y-1.5">
                <div className="text-[11px] font-mono text-[#382A22] bg-[#FAF6F0] border border-[#E6DDD0] px-2.5 py-1.5 rounded-lg break-all line-clamp-2">
                  {resolvedShareUrl}
                </div>
                <p className="text-[11px] text-[#8E7C6E] leading-snug">
                  iPhone XS 及后续兼容机型亮屏时，用手机顶部贴近单条 URL 的 NFC 标签。也可以扫码打开。
                </p>
                {doll.nfcWriteScope === 'test' && (
                  <Link to="/dev" className="text-[11px] text-[#4A8276]">预览测试贴纸可在 NFC 工坊配置</Link>
                )}
              </div>
            </div>

            {/* Cross-Browser / Repeat-NFC-Tap 6-Char Claim Code */}
            <div className="pt-3 border-t border-[#EAE0D1] space-y-2.5">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div className="flex items-center gap-1.5 text-xs font-medium text-[#382A22]">
                  <KeyRound className="w-3.5 h-3.5 text-[#C9963B]" />
                  <span>跨浏览器续聊口令（微信 / Safari 记忆同步）</span>
                </div>
                <button
                  type="button"
                  onClick={handleGenerateClaimCode}
                  disabled={claimBusy}
                  className="text-xs font-medium text-[#4A8276] hover:underline whitespace-nowrap"
                >
                  {claimCode ? '重新生成口令' : '生成 6 位记忆口令'}
                </button>
              </div>

              {claimCode && (
                <div className="flex items-center justify-between gap-2 px-3 py-2 rounded-xl bg-[#FAF4E8] border border-[#E7D4B1]">
                  <span className="text-xs text-[#6E5C50]">我的同步口令：</span>
                  <span className="font-mono text-base font-bold tracking-[0.22em] text-[#382A22]">
                    {claimCode}
                  </span>
                </div>
              )}

              <form onSubmit={handleClaimSession} className="flex items-center gap-2">
                <input
                  type="text"
                  maxLength={6}
                  value={claimInput}
                  onChange={(e) => setClaimInput(e.target.value.toUpperCase())}
                  placeholder="换设备/浏览器后输入 6 位口令同步记忆"
                  className="flex-1 min-w-0 px-3 py-1.5 text-[14px] sm:text-xs font-mono tracking-wider uppercase bg-[#FAF7F2] border border-[#E4DBCE] rounded-xl focus:outline-none focus:bg-white focus:border-[#4A8276]"
                />
                <button
                  type="submit"
                  disabled={claimBusy || claimInput.trim().length < 6}
                  className="px-3.5 py-1.5 text-xs font-medium btn-paper-soft disabled:opacity-45 whitespace-nowrap"
                >
                  同步续聊
                </button>
              </form>

              {claimStatus && <p className="text-[11px] text-[#6E5C50]">{claimStatus}</p>}
            </div>
          </div>
        </motion.div>
      </div>
    </div>
  );
}
