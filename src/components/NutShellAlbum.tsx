import { useEffect, useMemo, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { AnimatePresence, motion } from 'motion/react';
import {
  Check,
  Download,
  ExternalLink,
  Pencil,
  Share2,
  X,
} from 'lucide-react';
import { api, ApiError } from '../lib/api';
import type { CardSummary, DollSummary } from '../lib/types';
import { SafeImage } from './SafeImage';
import { haptic } from '../lib/haptics';

const ALBUM_NAMES_KEY = 'nutshell_album_names_v1';
const LONG_PRESS_OPEN_MS = 420;
const EASE_STUDIO = [0.22, 1, 0.36, 1] as const;

export interface AlbumItem {
  key: string;
  title: string;
  subtitle: string;
  mbti: string;
  imageUrl: string;
  badge: string;
  dateLabel: string;
  aspectClass: string;
  sharePath: string;
  detailPath: string;
  detailLabel: string;
  source: 'generated' | 'resident';
  personalDollId?: string;
}

function loadCustomNames(): Record<string, string> {
  if (typeof window === 'undefined') return {};
  try {
    const raw = window.localStorage.getItem(ALBUM_NAMES_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === 'object' ? (parsed as Record<string, string>) : {};
  } catch {
    return {};
  }
}

function saveCustomNames(map: Record<string, string>): void {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.setItem(ALBUM_NAMES_KEY, JSON.stringify(map));
  } catch {
    // ignore storage errors
  }
}

function formatShortDate(iso?: string): string {
  if (!iso) return '手帐留存';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '手帐留存';
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${m}/${day}`;
}

const ASPECT_RHYTHM = ['aspect-[3/4]', 'aspect-[4/4.6]', 'aspect-[4/5.2]', 'aspect-[4/4.3]'] as const;

interface NutShellAlbumProps {
  personalDolls: DollSummary[];
  demoDolls: DollSummary[];
  cards: CardSummary[];
  onDollRenamed: (dollId: string, newName: string) => void;
}

export function NutShellAlbum({
  personalDolls,
  demoDolls,
  cards,
  onDollRenamed,
}: NutShellAlbumProps) {
  const [customNames, setCustomNames] = useState<Record<string, string>>(() => loadCustomNames());

  const dollById = useMemo(() => {
    const map = new Map<string, DollSummary>();
    for (const d of personalDolls) map.set(d.id, d);
    return map;
  }, [personalDolls]);

  const { generatedItems, residentItems } = useMemo(() => {
    const gen: AlbumItem[] = [];
    const coveredDollIds = new Set<string>();

    // 1. All succeeded generated card versions from user's customization cards
    for (const card of cards) {
      const boundDoll = card.boundDollId ? dollById.get(card.boundDollId) : undefined;
      const succeeded = [...card.versions]
        .filter((v) => v.status === 'succeeded' && v.resultUrl)
        .reverse();

      for (const ver of succeeded) {
        const isBoundVer = boundDoll && boundDoll.cardVersionId === ver.id;
        if (isBoundVer && boundDoll) {
          coveredDollIds.add(boundDoll.id);
        }
        const key = isBoundVer && boundDoll ? `doll_${boundDoll.id}` : `ver_${ver.id}`;
        const defaultTitle = isBoundVer && boundDoll
          ? boundDoll.name
          : ver.suggestedName || `${card.userNickname}的${card.personaName}`;
        const title = isBoundVer && boundDoll ? boundDoll.name : customNames[key] || defaultTitle;

        gen.push({
          key,
          title,
          subtitle: isBoundVer
            ? `${card.personaName} · 已绑定专属娃娃`
            : `${card.personaName} · V${ver.versionNumber}`,
          mbti: card.personaMbti,
          imageUrl: ver.resultUrl!,
          badge: isBoundVer ? '已绑定' : `V${ver.versionNumber}`,
          dateLabel: formatShortDate(ver.finishedAt || ver.createdAt || card.createdAt),
          aspectClass: ASPECT_RHYTHM[gen.length % ASPECT_RHYTHM.length],
          sharePath: isBoundVer && boundDoll ? `/d/${boundDoll.id}` : `/card/${card.id}`,
          detailPath: isBoundVer && boundDoll ? `/d/${boundDoll.id}` : `/card/${card.id}`,
          detailLabel: isBoundVer ? '打开角色档案' : '查看版本与绑定',
          source: 'generated',
          personalDollId: isBoundVer && boundDoll ? boundDoll.id : undefined,
        });
      }
    }

    // 2. Any personal dolls not covered above
    for (const d of personalDolls) {
      if (coveredDollIds.has(d.id)) continue;
      const key = `doll_${d.id}`;
      gen.push({
        key,
        title: d.name,
        subtitle: `${d.persona.name} · 个人专属`,
        mbti: d.persona.mbti,
        imageUrl: d.avatarUrl,
        badge: '个人娃娃',
        dateLabel: formatShortDate(d.createdAt),
        aspectClass: ASPECT_RHYTHM[gen.length % ASPECT_RHYTHM.length],
        sharePath: `/d/${d.id}`,
        detailPath: `/d/${d.id}`,
        detailLabel: '打开角色档案',
        source: 'generated',
        personalDollId: d.id,
      });
    }

    // 3. Studio resident watercolor collection (always available for browsing / keepsake notes)
    const res: AlbumItem[] = demoDolls.map((d, idx) => {
      const key = `demo_${d.id}`;
      return {
        key,
        title: customNames[key] || d.name,
        subtitle: `${d.persona.name} · ${d.persona.materialHint}`,
        mbti: d.persona.mbti,
        imageUrl: d.avatarUrl,
        badge: '常驻典藏',
        dateLabel: `NO.0${idx + 1}`,
        aspectClass: ASPECT_RHYTHM[(idx + 1) % ASPECT_RHYTHM.length],
        sharePath: `/d/${d.id}`,
        detailPath: `/d/${d.id}`,
        detailLabel: '前往角色档案',
        source: 'resident',
      };
    });

    return { generatedItems: gen, residentItems: res };
  }, [cards, customNames, demoDolls, dollById, personalDolls]);

  const [filter, setFilter] = useState<'all' | 'generated'>(() =>
    generatedItems.length > 0 ? 'generated' : 'all'
  );

  // If user just generated their first card and reloads, keep filter sensible
  const displayedItems =
    filter === 'generated' ? generatedItems : [...generatedItems, ...residentItems];

  const [activeItem, setActiveItem] = useState<AlbumItem | null>(null);
  const [modalMode, setModalMode] = useState<'actions' | 'rename'>('actions');
  const [renameInput, setRenameInput] = useState('');
  const [renameBusy, setRenameBusy] = useState(false);
  const [actionToast, setActionToast] = useState<string | null>(null);

  // Per-card long-press recognition refs (opens action sheet on ~420ms hold)
  const holdTimerRef = useRef<number | null>(null);
  const holdStartRef = useRef<{ x: number; y: number } | null>(null);
  const suppressClickRef = useRef(false);

  useEffect(() => {
    return () => {
      if (holdTimerRef.current !== null) {
        window.clearTimeout(holdTimerRef.current);
      }
    };
  }, []);

  const clearHoldTimer = () => {
    if (holdTimerRef.current !== null) {
      window.clearTimeout(holdTimerRef.current);
      holdTimerRef.current = null;
    }
    holdStartRef.current = null;
  };

  const openCardModal = (item: AlbumItem, viaLongPress = false) => {
    haptic(viaLongPress ? 'medium' : 'selection');
    setActiveItem(item);
    setModalMode('actions');
    setRenameInput(item.title);
    setActionToast(null);
  };

  const closeModal = () => {
    setActiveItem(null);
    setModalMode('actions');
    setActionToast(null);
  };

  const handleCardPointerDown = (e: React.PointerEvent, item: AlbumItem) => {
    if (e.button !== 0 && e.pointerType === 'mouse') return;
    clearHoldTimer();
    holdStartRef.current = { x: e.clientX, y: e.clientY };
    holdTimerRef.current = window.setTimeout(() => {
      suppressClickRef.current = true;
      openCardModal(item, true);
      window.setTimeout(() => {
        suppressClickRef.current = false;
      }, 300);
    }, LONG_PRESS_OPEN_MS);
  };

  const handleCardPointerMove = (e: React.PointerEvent) => {
    if (!holdStartRef.current) return;
    const dx = e.clientX - holdStartRef.current.x;
    const dy = e.clientY - holdStartRef.current.y;
    if (dx * dx + dy * dy > 100) {
      clearHoldTimer();
    }
  };

  const handleShare = async () => {
    if (!activeItem) return;
    const shareUrl = `${window.location.origin}${activeItem.sharePath}`;
    const shareTitle = `果壳碰碰 · ${activeItem.title}`;
    const shareText = `来看看我的果壳手帐娃娃「${activeItem.title}」(${activeItem.mbti})`;

    try {
      if (typeof navigator !== 'undefined' && typeof navigator.share === 'function') {
        await navigator.share({ title: shareTitle, text: shareText, url: shareUrl });
        haptic('success');
        setActionToast('已调起系统分享面板');
        return;
      }
    } catch (err) {
      // If user dismissed native share sheet, don't overwrite with error
      if (err instanceof Error && err.name === 'AbortError') return;
    }

    try {
      await navigator.clipboard.writeText(shareUrl);
      haptic('success');
      setActionToast('已复制分享链接，可直接发给好友');
    } catch {
      setActionToast(`分享链接：${shareUrl}`);
    }
  };

  const handleRenameSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!activeItem || renameBusy) return;
    const trimmed = renameInput.trim();
    if (!trimmed) return;

    setRenameBusy(true);
    setActionToast(null);

    try {
      if (activeItem.personalDollId) {
        await api.renameDoll(activeItem.personalDollId, trimmed);
        onDollRenamed(activeItem.personalDollId, trimmed);
      } else {
        const nextMap = { ...customNames, [activeItem.key]: trimmed };
        setCustomNames(nextMap);
        saveCustomNames(nextMap);
      }

      haptic('success');
      setActiveItem({ ...activeItem, title: trimmed });
      setModalMode('actions');
      setActionToast(`已重命名为「${trimmed}」`);
    } catch (err) {
      const msg =
        err instanceof ApiError ? `[${err.code}] ${err.message}` : '重命名失败，请稍后重试';
      setActionToast(msg);
    } finally {
      setRenameBusy(false);
    }
  };

  const downloadHref = activeItem
    ? activeItem.imageUrl.startsWith('/api/assets/generated/')
      ? `${activeItem.imageUrl}?download=1`
      : activeItem.imageUrl
    : '';

  return (
    <section className="space-y-3" aria-label="果壳相册">
      {/* Compact Album Filter Strip */}
      <div className="flex items-center justify-between gap-2">
        <span className="text-[11.5px] text-[#9A887B] truncate">
          轻点或长按卡片可分享与重命名
        </span>

        <div className="flex items-center gap-3.5 shrink-0">
          {(
            [
              { key: 'all', label: `全部 (${generatedItems.length + residentItems.length})` },
              { key: 'generated', label: `我的 (${generatedItems.length})` },
            ] as const
          ).map((tab) => {
            const active = filter === tab.key;
            return (
              <button
                key={tab.key}
                type="button"
                onClick={() => {
                  haptic('selection');
                  setFilter(tab.key);
                }}
                className={`relative pb-1 text-xs font-medium transition-colors whitespace-nowrap ${
                  active ? 'text-[#382A22]' : 'text-[#9A887B] hover:text-[#382A22]'
                }`}
              >
                {tab.label}
                {active && (
                  <motion.span
                    layoutId="album-filter-ink"
                    transition={{ type: 'spring', stiffness: 440, damping: 34 }}
                    className="absolute left-0 right-0 -bottom-0.5 h-[2px] bg-[#4A8276]"
                  />
                )}
              </button>
            );
          })}
        </div>
      </div>

      {/* Masonry Waterfall Layout */}
      {displayedItems.length === 0 ? (
        <div className="journal-album-card rounded-[20px] p-6 sm:p-8 flex flex-col sm:flex-row sm:items-center justify-between gap-4">
          <div className="space-y-1">
            <h3 className="font-editorial text-base font-semibold text-[#382A22]">
              你的专属相册还是空白纸页
            </h3>
            <p className="text-xs sm:text-sm text-[#6E5C50]">
              上传一张照片生成水彩果壳娃娃后，所有成功作品都会自动收入果壳相册。
            </p>
          </div>
          <Link
            to="/create"
            onClick={() => haptic('medium')}
            className="w-full sm:w-auto inline-flex items-center justify-center px-5 py-2.5 text-xs sm:text-sm font-medium btn-capsule-primary whitespace-nowrap shrink-0"
          >
            去定制第一张作品
          </Link>
        </div>
      ) : (
        <div className="columns-2 lg:columns-3 gap-3.5 sm:gap-5">
          {displayedItems.map((item, idx) => (
            <motion.article
              key={item.key}
              initial={{ opacity: 0, y: 12 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.34, delay: Math.min(idx * 0.04, 0.24), ease: EASE_STUDIO }}
              className="break-inside-avoid mb-3.5 sm:mb-5"
            >
              <button
                type="button"
                onPointerDown={(e) => handleCardPointerDown(e, item)}
                onPointerMove={handleCardPointerMove}
                onPointerUp={clearHoldTimer}
                onPointerCancel={clearHoldTimer}
                onPointerLeave={clearHoldTimer}
                onClick={() => {
                  if (suppressClickRef.current) return;
                  openCardModal(item, false);
                }}
                className="group w-full text-left studio-card-hover journal-album-card rounded-[20px] overflow-hidden block focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#4A8276]"
              >
                {/* Stationery Top Header Strip */}
                <div className="px-3 sm:px-4 pt-3 pb-1.5 flex items-center justify-between gap-2 text-[10px] sm:text-[11px] font-mono text-[#9A887B]">
                  <span>{item.dateLabel}</span>
                  <span className="text-[#4A8276] font-medium">{item.mbti}</span>
                </div>

                {/* Inner Cotton-Paper Artwork Frame */}
                <div className="px-2.5 sm:px-3.5">
                  <div
                    className={`${item.aspectClass} rounded-[14px] bg-white/95 border border-[#EFE7DC] p-2.5 sm:p-3.5 flex items-center justify-center overflow-hidden`}
                  >
                    <SafeImage
                      src={item.imageUrl}
                      alt={item.title}
                      className="w-full h-full object-contain doll-hover-sway"
                      fallbackTitle={item.title}
                    />
                  </div>
                </div>

                {/* Stationery Journal Caption Area */}
                <div className="px-3 sm:px-4 pt-3 pb-3.5 space-y-1.5">
                  <div className="flex items-start justify-between gap-2">
                    <h3 className="font-editorial text-[14.5px] sm:text-[16px] font-semibold text-[#382A22] leading-snug line-clamp-1">
                      {item.title}
                    </h3>
                    <span className="text-[10px] font-medium text-[#8B7A6C] shrink-0 pt-0.5">
                      {item.badge}
                    </span>
                  </div>
                  <p className="text-[11px] sm:text-xs text-[#7D6C5F] line-clamp-2 leading-relaxed">
                    {item.subtitle}
                  </p>
                  <div className="pt-2 border-t border-dashed border-[#EAE1D4] flex items-center justify-between text-[10.5px] text-[#9A887B]">
                    <span>长按 / 点击操作</span>
                    <span className="inline-flex items-center gap-2 text-[#4A8276]">
                      <Share2 className="w-3 h-3" />
                      <Pencil className="w-3 h-3" />
                    </span>
                  </div>
                </div>
              </button>
            </motion.article>
          ))}
        </div>
      )}

      {/* Centered Apple-Style Card Action & Rename Modal (No Sliding Bottom Sheet) */}
      <AnimatePresence>
        {activeItem && (
          <div
            className="fixed inset-0 z-50 flex items-center justify-center p-4"
            role="dialog"
            aria-modal="true"
            aria-label={`${activeItem.title} 相册操作`}
          >
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              transition={{ duration: 0.18 }}
              onClick={closeModal}
              className="absolute inset-0 bg-[#2C211A]/38 backdrop-blur-[3px]"
            />

            <motion.div
              initial={{ opacity: 0, scale: 0.94, y: 10 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.95, y: 6 }}
              transition={{ type: 'spring', stiffness: 420, damping: 32 }}
              className="relative w-full max-w-[360px] journal-album-card rounded-[24px] p-5 space-y-4 shadow-[0_24px_60px_rgba(44,33,26,0.22)]"
            >
              {/* Modal Top Bar */}
              <div className="flex items-center justify-between gap-3">
                <div className="text-[11px] font-mono uppercase tracking-[0.12em] text-[#4A8276]">
                  {activeItem.mbti} · {activeItem.badge}
                </div>
                <button
                  type="button"
                  onClick={closeModal}
                  aria-label="关闭弹窗"
                  className="w-7 h-7 btn-orb-glass flex items-center justify-center"
                >
                  <X className="w-3.5 h-3.5" />
                </button>
              </div>

              {/* Card Thumbnail & Title */}
              <div className="flex items-center gap-3.5 p-3 rounded-2xl bg-white/90 border border-[#EFE7DC]">
                <div className="w-16 h-20 rounded-xl bg-[#FAF7F2] border border-[#EFE7DC] p-1.5 shrink-0 flex items-center justify-center overflow-hidden">
                  <SafeImage
                    src={activeItem.imageUrl}
                    alt={activeItem.title}
                    className="w-full h-full object-contain"
                  />
                </div>
                <div className="min-w-0 flex-1 space-y-1">
                  <h3 className="font-editorial text-base font-semibold text-[#382A22] truncate">
                    {activeItem.title}
                  </h3>
                  <p className="text-xs text-[#7D6C5F] line-clamp-2">{activeItem.subtitle}</p>
                  <div className="text-[10px] font-mono text-[#9A887B]">{activeItem.dateLabel}</div>
                </div>
              </div>

              {actionToast && (
                <div className="px-3.5 py-2.5 rounded-xl bg-[#ECF5F2] border border-[#4A8276]/25 text-xs text-[#2E5D52] flex items-center gap-1.5">
                  <Check className="w-3.5 h-3.5 shrink-0 text-[#4A8276]" />
                  <span className="leading-snug">{actionToast}</span>
                </div>
              )}

              {modalMode === 'rename' ? (
                <form onSubmit={handleRenameSubmit} className="space-y-3">
                  <div className="space-y-1.5">
                    <label
                      htmlFor="albumRenameInput"
                      className="block text-xs font-medium text-[#382A22]"
                    >
                      新名称（1～32 字）
                    </label>
                    <input
                      id="albumRenameInput"
                      type="text"
                      autoFocus
                      required
                      maxLength={32}
                      value={renameInput}
                      onChange={(e) => setRenameInput(e.target.value)}
                      placeholder="例如：春日薄荷小栗"
                      className="w-full px-3.5 py-2.5 text-[16px] sm:text-sm text-[#382A22] bg-white border border-[#DFD5C7] rounded-xl focus:outline-none focus:ring-2 focus:ring-[#4A8276]/25 focus:border-[#4A8276]"
                    />
                    <p className="text-[11px] text-[#9A887B]">
                      {activeItem.personalDollId
                        ? '保存后将同步更新个人娃娃档案与角色记忆中的名称。'
                        : '将作为该手帐卡片的专属相册命名保存在本机。'}
                    </p>
                  </div>

                  <div className="flex items-center gap-2.5">
                    <button
                      type="button"
                      onClick={() => {
                        haptic('selection');
                        setModalMode('actions');
                      }}
                      className="flex-1 py-2.5 text-xs font-medium btn-paper-soft"
                    >
                      取消
                    </button>
                    <button
                      type="submit"
                      disabled={renameBusy || !renameInput.trim()}
                      className="flex-1 py-2.5 text-xs font-medium btn-capsule-primary"
                    >
                      {renameBusy ? '保存中…' : '确认重命名'}
                    </button>
                  </div>
                </form>
              ) : (
                <div className="space-y-2.5">
                  <div className="grid grid-cols-2 gap-2.5">
                    <button
                      type="button"
                      onClick={() => void handleShare()}
                      className="inline-flex items-center justify-center gap-1.5 py-2.5 px-3 text-xs font-medium btn-capsule-primary"
                    >
                      <Share2 className="w-3.5 h-3.5" />
                      <span>分享作品</span>
                    </button>
                    <button
                      type="button"
                      onClick={() => {
                        haptic('selection');
                        setRenameInput(activeItem.title);
                        setModalMode('rename');
                        setActionToast(null);
                      }}
                      className="inline-flex items-center justify-center gap-1.5 py-2.5 px-3 text-xs font-medium btn-paper-soft"
                    >
                      <Pencil className="w-3.5 h-3.5" />
                      <span>重命名</span>
                    </button>
                  </div>

                  <div className="pt-2.5 border-t border-[#EFE7DC] flex items-center justify-between gap-3">
                    <a
                      href={downloadHref}
                      download={`${activeItem.title}.png`}
                      onClick={() => haptic('light')}
                      className="inline-flex items-center gap-1.5 py-1.5 text-xs font-medium btn-icon-ghost"
                    >
                      <Download className="w-3.5 h-3.5 text-[#4A8276]" />
                      <span>保存原图</span>
                    </a>

                    <Link
                      to={activeItem.detailPath}
                      onClick={() => {
                        haptic('light');
                        closeModal();
                      }}
                      className="inline-flex items-center gap-1.5 py-1.5 text-xs font-medium btn-icon-ghost text-[#4A8276]"
                    >
                      <span>{activeItem.detailLabel}</span>
                      <ExternalLink className="w-3.5 h-3.5" />
                    </Link>
                  </div>
                </div>
              )}
            </motion.div>
          </div>
        )}
      </AnimatePresence>
    </section>
  );
}
