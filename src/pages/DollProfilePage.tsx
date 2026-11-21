import { useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { AnimatePresence, motion } from 'motion/react';
import { ArrowLeft, Check, Copy, Download, MessageSquare, QrCode } from 'lucide-react';
import { api } from '../lib/api';
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
  const [doll, setDoll] = useState<DollDetail | null>(null);
  const [memories, setMemories] = useState<MemoryItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [mobileSection, setMobileSection] = useState<'overview' | 'memory'>('overview');

  useEffect(() => {
    let active = true;
    setLoading(true);
    setError(null);
    (async () => {
      try {
        await api.initSession();
        const [d, mems] = await Promise.all([api.getDoll(dollId), api.getMemories(dollId)]);
        if (!active) return;
        setDoll(d);
        setMemories(mems);
      } catch (err) {
        if (!active) return;
        setError(err instanceof Error ? err.message : '加载角色档案失败');
      } finally {
        if (active) setLoading(false);
      }
    })();
    return () => {
      active = false;
    };
  }, [dollId]);

  const handleCopyUrl = async () => {
    if (!doll) return;
    const shareUrl = `${window.location.origin}/d/${doll.id}`;
    try {
      await navigator.clipboard.writeText(shareUrl);
      haptic('success');
      setCopied(true);
      setTimeout(() => setCopied(false), 1800);
    } catch {
      setCopied(false);
    }
  };

  if (loading) {
    return <WatercolorProfileSkeleton />;
  }

  if (error || !doll) {
    return (
      <div className="max-w-[720px] mx-auto px-4 sm:px-8 py-8">
        <div className="studio-card rounded-2xl p-6 space-y-4">
          <h1 className="font-editorial text-xl font-semibold text-[#382A22]">
            未找到该角色档案
          </h1>
          <p className="text-sm text-[#6E5C50]">{error || '该固定链接对应的角色不存在或已被清理。'}</p>
          <Link to="/" className="inline-flex items-center gap-1.5 text-sm font-medium btn-icon-ghost">
            <ArrowLeft className="w-4 h-4" />
            <span>返回展馆</span>
          </Link>
        </div>
      </div>
    );
  }

  const browserFixedUrl = `${window.location.origin}/d/${doll.id}`;
  const downloadHref = doll.avatarUrl.startsWith('/api/assets/generated/')
    ? `${doll.avatarUrl}?download=1`
    : doll.avatarUrl;

  return (
    <div className="max-w-[1120px] mx-auto px-3.5 sm:px-8 py-3 sm:py-6 space-y-3.5 sm:space-y-5">
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
            { key: 'memory' as const, label: `记忆与凭证 (${memories.length})` },
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

            {/* Mobile merged identity + CTA right inside portrait card so everything fits in 1 screen */}
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

        {/* Right: Desktop Identity + Memories & NFC (Mobile shows Memories & NFC tab) */}
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
                <div className="text-xs text-[#8E7C6E] flex items-center gap-1.5">
                  <span className="font-mono font-semibold text-[#3D7267]">{doll.persona.mbti}</span>
                  <span aria-hidden="true">·</span>
                  <span>{doll.persona.name}</span>
                  <span aria-hidden="true">·</span>
                  <span>{doll.persona.materialHint}</span>
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

          {/* Fixed Link & NFC Passport Card */}
          <div className="studio-card atelier-passport rounded-[22px] p-4 sm:p-5 space-y-3.5">
            <div className="flex items-center justify-between gap-2">
              <div className="flex items-center gap-2">
                <QrCode className="w-4 h-4 text-[#4A8276]" />
                <div>
                  <span className="text-sm font-semibold text-[#382A22]">固定链接与 NFC 凭证</span>
                  <span className="hidden sm:inline font-atelier-num italic text-xs text-[#968477] ml-2">
                    Collector Passport
                  </span>
                </div>
              </div>
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

            <div className="flex items-center gap-3.5 p-3 rounded-2xl bg-[#FFFDF9]/85 border border-[#E7DEC9]">
              <div
                className="w-18 h-18 sm:w-20 sm:h-20 shrink-0 rounded-xl border border-[#EAE2D6] bg-white p-1.5 shadow-[0_2px_6px_rgba(56,42,34,0.05)] [&>svg]:w-full [&>svg]:h-full"
                dangerouslySetInnerHTML={{ __html: doll.qrSvg }}
                aria-label="角色固定链接二维码"
              />
              <div className="min-w-0 flex-1 space-y-1.5">
                <div className="text-[11px] font-mono text-[#382A22] bg-[#FAF6F0] border border-[#E6DDD0] px-2.5 py-1.5 rounded-lg break-all line-clamp-2">
                  {browserFixedUrl}
                </div>
                <p className="text-[11px] text-[#8E7C6E] leading-snug">
                  关闭重开可通过此固定入口续聊记忆，不同会话彼此隔离。
                </p>
              </div>
            </div>
          </div>
        </motion.div>
      </div>
    </div>
  );
}
