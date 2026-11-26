import { useEffect, useRef, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { AnimatePresence, motion } from 'motion/react';
import {
  ArrowLeft,
  Bookmark,
  BookmarkPlus,
  Check,
  Copy,
  MessageSquare,
  RefreshCw,
  Send,
  Trash2,
  WifiOff,
} from 'lucide-react';
import { api, ApiError, generateIdempotencyKey, streamDollChat } from '../lib/api';
import type { ChatMessage, DollDetail, MemoryItem } from '../lib/types';
import { SafeImage } from '../components/SafeImage';
import { WatercolorChatSkeleton } from '../components/WatercolorLoader';
import { BreezeLeavesOverlay, DollVoiceButton, SoundwaveGlyph } from '../components/DollVoiceButton';
import {
  ChatPaperOverlay,
  ChatPaperPicker,
  loadChatDayPhaseMode,
  loadChatPaperTexture,
  loadChatSeasonMode,
  saveChatDayPhaseMode,
  saveChatPaperTexture,
  saveChatSeasonMode,
  type ChatDayPhaseMode,
  type ChatPaperTextureId,
  type ChatSeasonMode,
} from '../components/ChatPaperTheme';
import { ChatMemorySnapshot } from '../components/ChatMemorySnapshot';
import { ChatMemoryBubblesLayer, useChatMemoryBubbles } from '../components/ChatMemoryBubbles';
import { haptic } from '../lib/haptics';
import { speakDollLine, stopDollVoice } from '../lib/dollVoice';

const MEMORY_TYPE_LABEL: Record<string, string> = {
  user_nickname: '你的称呼',
  doll_name: '娃娃名称',
  persona: '选定人格',
  accessories: '手作配饰',
  fact: '明确记忆',
};

const EASE_STUDIO = [0.22, 1, 0.36, 1] as const;

export function DollChatPage() {
  const { dollId = '' } = useParams();
  const [doll, setDoll] = useState<DollDetail | null>(null);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [memories, setMemories] = useState<MemoryItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [pageError, setPageError] = useState<string | null>(null);
  const loadedDollId = useRef<string | null>(null);
  const loadRevision = useRef(0);

  const [inputText, setInputText] = useState('');
  const [rememberToggle, setRememberToggle] = useState(false);
  const [rememberText, setRememberText] = useState('');
  const [sending, setSending] = useState(false);
  const [streamError, setStreamError] = useState<{
    code: string;
    message: string;
    retryClientMessageId?: string;
    retryText?: string;
    retryRememberText?: string;
  } | null>(null);

  const [newMemType, setNewMemType] = useState<'user_nickname' | 'fact'>('fact');
  const [newMemValue, setNewMemValue] = useState('');
  const [savingMem, setSavingMem] = useState(false);
  const [memNotice, setMemNotice] = useState<string | null>(null);
  const [mobileTab, setMobileTab] = useState<'chat' | 'memory'>('chat');

  const [copied, setCopied] = useState(false);
  const [isOffline, setIsOffline] = useState(() =>
    typeof navigator !== 'undefined' ? !navigator.onLine : false
  );
  const [speakingId, setSpeakingId] = useState<string | null>(null);
  const [autoVoice, setAutoVoice] = useState(false);
  const [paperTexture, setPaperTexture] = useState<ChatPaperTextureId>(() => loadChatPaperTexture());
  const [seasonMode, setSeasonMode] = useState<ChatSeasonMode>(() => loadChatSeasonMode());
  const [dayPhaseMode, setDayPhaseMode] = useState<ChatDayPhaseMode>(() => loadChatDayPhaseMode());
  const autoVoiceRef = useRef(false);
  const bottomRef = useRef<HTMLDivElement | null>(null);
  const abortRef = useRef<AbortController | null>(null);

  const {
    bubbles: memoryBubbles,
    handleCanvasClick: handleBlankCanvasClick,
    dismissBubble: dismissMemoryBubble,
  } = useChatMemoryBubbles(messages, memories, doll);

  useEffect(() => {
    autoVoiceRef.current = autoVoice;
  }, [autoVoice]);

  const handlePaperTextureChange = (next: ChatPaperTextureId) => {
    setPaperTexture(next);
    saveChatPaperTexture(next);
  };

  const handleSeasonModeChange = (next: ChatSeasonMode) => {
    setSeasonMode(next);
    saveChatSeasonMode(next);
  };

  const handleDayPhaseModeChange = (next: ChatDayPhaseMode) => {
    setDayPhaseMode(next);
    saveChatDayPhaseMode(next);
  };

  const cacheKey = `nutshell_doll_snapshot_${dollId}`;

  const loadData = async () => {
    const revision = ++loadRevision.current;
    setLoading(true);
    setPageError(null);
    try { localStorage.removeItem(`nutshell_chat_snapshot_${dollId}`); } catch { /* Storage can be disabled. */ }
    try {
      const [d, msgRes, mems] = await Promise.all([
        api.getDoll(dollId),
        api.getMessages(dollId, 60),
        api.getMemories(dollId),
      ]);
      if (loadRevision.current !== revision) return;
      loadedDollId.current = dollId;
      setDoll(d);
      setMessages(msgRes.items);
      setMemories(mems);
      setIsOffline(false);
      try {
        localStorage.setItem(cacheKey, JSON.stringify({ ...d, isOwner: false, cardUrl: null, cardId: null }));
      } catch {
        // Ignore storage quota issues
      }
    } catch (err) {
      if (loadRevision.current !== revision) return;
      if (err instanceof TypeError || (err instanceof ApiError && err.status >= 500)) {
        if (loadedDollId.current === dollId) {
          setIsOffline(true);
          return;
        }
        try {
          const cachedRaw = localStorage.getItem(cacheKey);
          const cached = cachedRaw ? JSON.parse(cachedRaw) as DollDetail : null;
          if (cached?.id === dollId) {
            setDoll(cached);
            setMessages([]);
            setMemories([]);
            setIsOffline(true);
            return;
          }
        } catch {
          // A cache error falls through to the request error.
        }
      }
      setPageError(err instanceof Error ? err.message : '加载对话空间失败');
    } finally {
      if (loadRevision.current === revision) setLoading(false);
    }
  };

  useEffect(() => {
    const onOnline = () => void loadData();
    const onOffline = () => setIsOffline(true);
    window.addEventListener('online', onOnline);
    window.addEventListener('offline', onOffline);
    stopDollVoice();
    setSpeakingId(null);
    void loadData();
    return () => {
      loadRevision.current++;
      window.removeEventListener('online', onOnline);
      window.removeEventListener('offline', onOffline);
      abortRef.current?.abort();
      stopDollVoice();
    };
  }, [dollId]);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages.length, sending]);

  const playDollVoice = (id: string, text: string, mbti?: string) => {
    speakDollLine(id, text, mbti ?? doll?.persona.mbti, {
      onStart: () => setSpeakingId(id),
      onEnd: () => setSpeakingId((curr) => (curr === id ? null : curr)),
      onError: () => setSpeakingId((curr) => (curr === id ? null : curr)),
    });
  };

  const toggleSpeak = (id: string, text: string) => {
    if (speakingId === id) {
      stopDollVoice();
      setSpeakingId(null);
      return;
    }
    playDollVoice(id, text);
  };

  const sendMessageInternal = async (
    text: string,
    clientMessageId: string,
    explicitRemember?: string,
    isRetry = false
  ) => {
    if (!doll || sending) return;
    stopDollVoice();
    setSpeakingId(null);
    setSending(true);
    setStreamError(null);

    const tempAssistantId = `temp_reply_${Date.now()}`;
    const nowIso = new Date().toISOString();

    setMessages((prev) => {
      const next = [...prev];
      if (!isRetry) {
        next.push({
          id: `temp_user_${clientMessageId}`,
          clientMessageId,
          replyAttempt: 0,
          role: 'user',
          content: text,
          status: 'completed',
          provider: null,
          firstTokenMs: null,
          totalMs: null,
          errorCode: null,
          createdAt: nowIso,
        });
      }
      next.push({
        id: tempAssistantId,
        clientMessageId,
        replyAttempt: isRetry ? 2 : 1,
        role: 'assistant',
        content: '',
        status: 'streaming',
        provider: null,
        firstTokenMs: null,
        totalMs: null,
        errorCode: null,
        createdAt: nowIso,
      });
      return next;
    });

    const controller = new AbortController();
    abortRef.current = controller;
    let streamedText = '';
    const markInterrupted = (err: { code: string; message: string }) => {
      setMessages(prev => prev.map(message => message.id === tempAssistantId ? {
        ...message, status: message.content ? 'incomplete' : 'failed', errorCode: err.code,
      } : message));
      setStreamError({
        code: err.code, message: err.message, retryClientMessageId: clientMessageId,
        retryText: text, retryRememberText: explicitRemember,
      });
    };

    try {
      await streamDollChat(
        doll.id,
        {
          text,
          clientMessageId,
          rememberText: explicitRemember || undefined,
        },
        {
          onMeta: (meta) => {
            setMessages((prev) =>
              prev.map((m) => (m.id === tempAssistantId ? { ...m, provider: meta.provider } : m))
            );
            if (meta.savedMemoryId) {
              void api.getMemories(doll.id).then(setMemories).catch(() => {});
            }
          },
          onDelta: (delta) => {
            streamedText += delta;
            setMessages((prev) =>
              prev.map((m) =>
                m.id === tempAssistantId
                  ? { ...m, content: m.content + delta, status: 'streaming' }
                  : m
              )
            );
          },
          onDone: (done) => {
            const finalId = done.assistantMessageId || tempAssistantId;
            setMessages((prev) =>
              prev.map((m) =>
                m.id === tempAssistantId
                  ? {
                      ...m,
                      id: finalId,
                      status: 'completed',
                      firstTokenMs: done.firstTokenMs ?? null,
                      totalMs: done.totalMs ?? null,
                    }
                  : m
              )
            );
            if (done.savedMemoryId) {
              void api.getMemories(doll.id).then(setMemories).catch(() => {});
            }
            if (autoVoiceRef.current && streamedText.trim()) {
              playDollVoice(finalId, streamedText, doll.persona.mbti);
            }
          },
          onError: markInterrupted,
        },
        controller.signal
      );
    } catch {
      if (!controller.signal.aborted) markInterrupted({ code: 'CHAT_INTERRUPTED', message: '回复连接已中断，可以重试这条消息' });
    } finally {
      setSending(false);
      abortRef.current = null;
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const trimmed = inputText.trim();
    if (!trimmed || sending) return;
    haptic('light');
    const clientMessageId = generateIdempotencyKey('msg');
    const rem = rememberToggle ? rememberText.trim() : '';
    setInputText('');
    setRememberText('');
    setRememberToggle(false);
    await sendMessageInternal(trimmed, clientMessageId, rem || undefined, false);
  };

  const handleRetryFailed = async (clientMessageId: string, originalText: string) => {
    const pendingMemory = streamError?.retryClientMessageId === clientMessageId ? streamError.retryRememberText : undefined;
    await sendMessageInternal(originalText, clientMessageId, pendingMemory, true);
  };

  const handleAddMemory = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!doll || !newMemValue.trim() || savingMem) return;
    setSavingMem(true);
    setMemNotice(null);
    try {
      const created = await api.addMemory(doll.id, newMemType, newMemValue.trim());
      setMemories((prev) => {
        if (newMemType === 'user_nickname') {
          return [...prev.filter((m) => m.type !== 'user_nickname'), created];
        }
        return [...prev, created];
      });
      setNewMemValue('');
      haptic('success');
      setMemNotice('已保存至角色记忆，下一轮对话立即生效。');
    } catch (err) {
      setMemNotice(err instanceof Error ? err.message : '保存记忆失败');
    } finally {
      setSavingMem(false);
    }
  };

  const handleDeleteMemory = async (memoryId: string) => {
    if (!doll) return;
    haptic('warning');
    try {
      await api.deleteMemory(doll.id, memoryId);
      setMemories((prev) => prev.filter((m) => m.id !== memoryId));
      setMemNotice('已移除该条记忆；后续请求将不再注入（若近期聊天原文仍含该内容，模型可能从历史读取）。');
    } catch (err) {
      setMemNotice(err instanceof Error ? err.message : '删除失败');
    }
  };

  const handleCopyFixedLink = async () => {
    if (!doll) return;
    try {
      await navigator.clipboard.writeText(`${window.location.origin}/d/${doll.id}`);
      haptic('success');
      setCopied(true);
      setTimeout(() => setCopied(false), 1800);
    } catch {
      setCopied(false);
    }
  };

  const renderMemoryPanelContent = () => (
    <div className="space-y-4">
      {memories.length === 0 ? (
        <p className="text-xs text-[#9A887B] py-1 leading-relaxed">
          当前暂无记忆条目。可以在下方设定你的称呼，或写下一件希望角色记住的小事。
        </p>
      ) : (
        <ul className="space-y-2">
          <AnimatePresence initial={false}>
            {memories.map((m) => (
              <motion.li
                key={m.id}
                layout
                initial={{ opacity: 0, y: -6, scale: 0.97 }}
                animate={{ opacity: 1, y: 0, scale: 1 }}
                exit={{ opacity: 0, x: 14, transition: { duration: 0.18 } }}
                transition={{ type: 'spring', stiffness: 380, damping: 28 }}
                className="p-3 rounded-xl studio-inset flex items-start justify-between gap-3"
              >
                <div className="min-w-0">
                  <div className="text-[11px] text-[#4A8276] font-medium">
                    {MEMORY_TYPE_LABEL[m.type] || m.type}
                  </div>
                  <div className="text-sm text-[#382A22] mt-0.5 break-words">{m.value}</div>
                </div>
                <motion.button
                  type="button"
                  whileHover={{ scale: 1.12 }}
                  whileTap={{ scale: 0.9 }}
                  onClick={() => handleDeleteMemory(m.id)}
                  aria-label={`删除记忆 ${m.value}`}
                  className="p-1.5 text-[#A49386] hover:text-[#B84A39] transition-colors shrink-0"
                >
                  <Trash2 className="w-3.5 h-3.5" />
                </motion.button>
              </motion.li>
            ))}
          </AnimatePresence>
        </ul>
      )}

      <form onSubmit={handleAddMemory} className="pt-3.5 border-t border-[#EAE2D6] space-y-3">
        <div className="flex items-center gap-5 border-b border-[#EAE2D6]">
          {(
            [
              { key: 'fact', label: '新增记忆' },
              { key: 'user_nickname', label: '设置称呼' },
            ] as const
          ).map((tab) => {
            const active = newMemType === tab.key;
            return (
              <button
                key={tab.key}
                type="button"
                onClick={() => {
                  haptic('selection');
                  setNewMemType(tab.key);
                }}
                className={`relative pb-2 text-xs font-medium transition-colors whitespace-nowrap ${
                  active ? 'text-[#382A22]' : 'text-[#9A887B] hover:text-[#382A22]'
                }`}
              >
                {tab.label}
                {active && (
                  <motion.span
                    layoutId="mem-type-ink"
                    transition={{ type: 'spring', stiffness: 440, damping: 34 }}
                    className="absolute left-0 right-0 -bottom-px h-[2px] bg-[#4A8276]"
                  />
                )}
              </button>
            );
          })}
        </div>

        <div className="flex items-center gap-2">
          <input
            type="text"
            value={newMemValue}
            onChange={(e) => setNewMemValue(e.target.value)}
            placeholder={
              newMemType === 'user_nickname' ? '例如：小林' : '例如：喜欢喝桂花乌龙茶'
            }
            maxLength={300}
            className="flex-1 min-w-0 px-3 py-2 text-[16px] sm:text-xs bg-[#FAF7F2] border border-[#E4DBCE] rounded-xl focus:outline-none focus:bg-white focus:ring-2 focus:ring-[#4A8276]/20 focus:border-[#4A8276]"
          />
          <button
            type="submit"
            disabled={savingMem || !newMemValue.trim()}
            className="px-4 py-2 text-xs font-medium btn-ink-tinted whitespace-nowrap shrink-0"
          >
            保存
          </button>
        </div>

        {memNotice && <p className="text-[11px] leading-relaxed text-[#6E5C50]">{memNotice}</p>}
      </form>
    </div>
  );

  if (loading) {
    return <WatercolorChatSkeleton />;
  }

  if (pageError || !doll) {
    return (
      <div className="max-w-[720px] mx-auto px-4 sm:px-8 py-12">
        <div className="studio-card rounded-2xl p-6 sm:p-8 space-y-4">
          <h1 className="font-editorial text-xl sm:text-2xl font-semibold text-[#382A22]">
            无法进入对话空间
          </h1>
          <p className="text-sm text-[#6E5C50]">{pageError || '未找到该角色'}</p>
          <Link to="/" className="inline-flex items-center gap-1.5 text-sm font-medium btn-icon-ghost">
            <ArrowLeft className="w-4 h-4" />
            <span>返回展馆</span>
          </Link>
        </div>
      </div>
    );
  }

  const userMessageMap = new Map<string, string>();
  for (const m of messages) {
    if (m.role === 'user') userMessageMap.set(m.clientMessageId, m.content);
  }

  return (
    <div className="max-w-[1200px] mx-auto md:px-8 md:py-7">
      {/* Desktop Breadcrumb (Mobile uses native iOS top nav bar) */}
      <div className="hidden md:flex flex-wrap items-center justify-between gap-3 mb-5">
        <div className="flex items-center gap-2.5 text-xs">
          <Link
            to={`/d/${doll.id}`}
            className="group inline-flex items-center gap-1.5 font-medium btn-icon-ghost"
          >
            <ArrowLeft className="w-3.5 h-3.5 transition-transform duration-200 group-hover:-translate-x-1" />
            <span>角色档案</span>
          </Link>
          <span className="text-[#D8CFC2]" aria-hidden="true">/</span>
          <span className="font-medium text-[#382A22]">{doll.name}</span>
          <span className="font-mono text-[#4A8276]">{doll.persona.mbti}</span>
        </div>

        <button
          type="button"
          onClick={handleCopyFixedLink}
          className="inline-flex items-center gap-1.5 text-xs font-medium btn-icon-ghost whitespace-nowrap"
        >
          <AnimatePresence mode="wait" initial={false}>
            <motion.span
              key={copied ? 'ok' : 'cp'}
              initial={{ scale: 0.65, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              exit={{ scale: 0.65, opacity: 0 }}
              transition={{ duration: 0.14 }}
              className="inline-flex text-[#4A8276]"
            >
              {copied ? <Check className="w-3.5 h-3.5" /> : <Copy className="w-3.5 h-3.5" />}
            </motion.span>
          </AnimatePresence>
          <span>{copied ? '已复制固定链接' : '复制固定链接'}</span>
        </button>
      </div>

      {/* Responsive Workspace: Natural Page Scroll (No Nested Scrollboxes or Sliding Drawers) */}
      <div className="grid grid-cols-1 lg:grid-cols-12 lg:gap-6 items-start">
        <section className="relative lg:col-span-8 bg-[#FDFBF8] lg:studio-card lg:rounded-2xl flex flex-col min-h-[calc(100dvh-3rem)] lg:min-h-[600px]">
          {/* Lightweight Translucent Japanese Stationery Paper Texture & Season/Day-Night Light Overlay */}
          <ChatPaperOverlay
            texture={paperTexture}
            seasonMode={seasonMode}
            dayPhaseMode={dayPhaseMode}
          />

          {/* Sticky Character Bar */}
          <div className="sticky top-12 md:top-16 lg:static z-20 px-4 sm:px-5 py-2.5 sm:py-3.5 border-b border-[#EAE2D6] flex items-center justify-between gap-2.5 sm:gap-3 ios-glass-bar lg:bg-[#FFFEFC]/92 lg:backdrop-blur-md lg:rounded-t-2xl">
            <div className="flex items-center gap-3 min-w-0">
              <div className="w-9 h-9 sm:w-11 sm:h-11 rounded-full sm:rounded-xl overflow-hidden border border-[#E5DACB] specimen-stage-0 p-0.5 shrink-0 shadow-[0_2px_6px_rgba(56,42,34,0.06)]">
                <SafeImage
                  src={doll.avatarUrl}
                  alt={doll.name}
                  className="w-full h-full object-contain"
                />
              </div>
              <div className="min-w-0">
                <div className="flex items-center gap-1.5">
                  <h1 className="font-editorial text-[15px] sm:text-base font-semibold text-[#382A22] truncate">
                    {doll.name}
                  </h1>
                  <span className="text-[11px] font-mono text-[#4A8276] shrink-0">
                    {doll.persona.mbti}
                  </span>
                </div>
                <p className="text-[11px] text-[#9A887B] truncate">{doll.persona.name}</p>
              </div>
            </div>

            <div className="flex items-center gap-2.5 sm:gap-3 shrink-0">
              {/* Japanese Stationery Paper Texture, Season & Day/Night Light Switcher */}
              <ChatPaperPicker
                value={paperTexture}
                onChange={handlePaperTextureChange}
                seasonMode={seasonMode}
                onSeasonModeChange={handleSeasonModeChange}
                dayPhaseMode={dayPhaseMode}
                onDayPhaseModeChange={handleDayPhaseModeChange}
              />

              {/* Gentle Doll Voice Auto-Read / Stop Control */}
              <button
                type="button"
                onClick={() => {
                  if (speakingId) {
                    haptic('selection');
                    stopDollVoice();
                    setSpeakingId(null);
                    return;
                  }
                  haptic('light');
                  setAutoVoice((prev) => !prev);
                }}
                aria-pressed={Boolean(speakingId) || autoVoice}
                aria-label={
                  speakingId
                    ? '停止当前娃娃语音'
                    : autoVoice
                      ? '关闭自动轻柔朗读'
                      : '开启新回复自动轻柔朗读'
                }
                className={`inline-flex items-center gap-1.5 py-1.5 text-xs font-medium btn-icon-ghost whitespace-nowrap ${
                  speakingId || autoVoice ? 'text-[#356B5F]' : 'text-[#6E5C50]'
                }`}
              >
                <SoundwaveGlyph compact playing={Boolean(speakingId)} />
                <span>
                  {speakingId ? '轻语中' : autoVoice ? '自动轻语' : '轻语'}
                </span>
                {autoVoice && !speakingId && (
                  <span
                    className="w-1.5 h-1.5 rounded-full bg-[#4A8276]"
                    aria-hidden="true"
                  />
                )}
              </button>

              {/* Mobile Clean Inline View Toggle: Chat <-> Memory (No Sliding Drawer) */}
              <button
                type="button"
                onClick={() => {
                  haptic('selection');
                  setMobileTab((t) => (t === 'chat' ? 'memory' : 'chat'));
                }}
                className="lg:hidden inline-flex items-center gap-1 py-1.5 text-xs font-medium btn-icon-ghost text-[#4A8276]"
              >
                {mobileTab === 'chat' ? (
                  <>
                    <Bookmark className="w-3.5 h-3.5" />
                    <span>记忆({memories.length})</span>
                  </>
                ) : (
                  <>
                    <MessageSquare className="w-3.5 h-3.5" />
                    <span>返回对话</span>
                  </>
                )}
              </button>

              <button
                type="button"
                onClick={handleCopyFixedLink}
                aria-label="复制固定链接"
                className="md:hidden inline-flex items-center justify-center p-1.5 btn-icon-ghost text-[#6E5C50]"
              >
                {copied ? (
                  <Check className="w-4 h-4 text-[#4A8276]" />
                ) : (
                  <Copy className="w-4 h-4" />
                )}
              </button>

              {doll.isOwner && doll.cardId && (
                <Link
                  to={`/card/${doll.cardId}`}
                  className="hidden sm:inline-flex text-xs font-medium btn-icon-ghost whitespace-nowrap"
                >
                  作品与出图 →
                </Link>
              )}
            </div>
          </div>

          {/* Warm Offline Fallback Banner */}
          {isOffline && (
            <div className="relative z-20 mx-3.5 sm:mx-5 mt-2.5 px-3.5 py-2 rounded-xl border border-[#E7D4B1] bg-[#FAF4E8] text-xs text-[#7A5622] flex items-center justify-between gap-2">
              <span className="inline-flex items-center gap-1.5">
                <WifiOff className="w-3.5 h-3.5 shrink-0" />
                <span>娃娃睡着了，连上网它就醒（当前可继续翻看已加载的对话与记忆）</span>
              </span>
              <button
                type="button"
                onClick={() => void loadData()}
                className="font-medium underline underline-offset-2 whitespace-nowrap shrink-0"
              >
                重试连接
              </button>
            </div>
          )}

          {/* Top Memory Snapshot — Shared Keywords & Expandable Key Dialogue Memoir */}
          <div className={mobileTab === 'memory' ? 'hidden lg:block' : 'block'}>
            <ChatMemorySnapshot
              doll={doll}
              memories={memories}
              messages={messages}
              speakingId={speakingId}
              onSpeakExcerpt={(id, text) => toggleSpeak(id, text)}
              onOpenRememberComposer={() => {
                setRememberToggle(true);
                bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
              }}
            />
          </div>

          {/* Mobile Inline Memory Panel (replaces sliding drawer) */}
          {mobileTab === 'memory' && (
            <div className="relative z-10 lg:hidden flex-1 p-4 space-y-4">
              <div className="studio-card rounded-[20px] p-4 space-y-4">
                <div className="flex items-center justify-between gap-2 border-b border-[#EAE2D6] pb-3">
                  <div>
                    <h2 className="font-editorial text-base font-semibold text-[#382A22]">
                      角色记忆档案 ({memories.length})
                    </h2>
                    <p className="text-[11px] text-[#9A887B] mt-0.5">
                      仅记录你明确确认的信息，透明可控
                    </p>
                  </div>
                </div>
                {renderMemoryPanelContent()}
              </div>
              <p className="px-1 text-[11px] text-[#9A887B] leading-relaxed">
                说明：删除记忆后，后续请求将不再注入该条目；若近期 20 条对话原文仍包含相同内容，角色仍可能从历史上下文中读取。
              </p>
            </div>
          )}

          {/* Messages Stream (Natural Document Flow, Blank-Space Tap Spawns Memory Bubbles) */}
          <div
            onClick={handleBlankCanvasClick}
            className={`relative z-10 ${
              mobileTab === 'memory' ? 'hidden lg:block' : 'block'
            } flex-1 px-4 sm:px-5 py-4 sm:py-6 space-y-4 sm:space-y-5`}
          >
            <ChatMemoryBubblesLayer
              bubbles={memoryBubbles}
              onDismiss={dismissMemoryBubble}
            />

            {/* Opening Line */}
            {(() => {
              const isOpeningSpeaking = speakingId === 'opening';
              return (
                <motion.div
                  initial={{ opacity: 0, y: 8 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ duration: 0.28, ease: EASE_STUDIO }}
                  className="flex items-start gap-2.5 max-w-[88%] sm:max-w-[84%]"
                >
                  <div
                    data-memory-bubble-ignore="true"
                    className="w-7 h-7 sm:w-8 sm:h-8 rounded-full sm:rounded-lg overflow-hidden border border-[#EAE2D6] bg-white p-0.5 shrink-0 mt-0.5"
                  >
                    <SafeImage src={doll.avatarUrl} alt={doll.name} className="w-full h-full object-contain" />
                  </div>
                  <div data-memory-bubble-ignore="true" className="space-y-1.5 min-w-0">
                    <div className="text-[11px] text-[#9A887B] flex items-center gap-1.5">
                      <span>{doll.name}</span>
                      {isOpeningSpeaking && (
                        <>
                          <span aria-hidden="true">·</span>
                          <span className="text-[#4A8276]">清风轻语中</span>
                        </>
                      )}
                    </div>
                    <div
                      className={`relative overflow-hidden px-3.5 py-2.5 sm:px-4 sm:py-3 rounded-[20px] rounded-tl-md text-[14.5px] sm:text-sm leading-relaxed transition-all duration-300 ${
                        isOpeningSpeaking
                          ? 'bg-[#F3FAF7] border border-[#4A8276]/45 text-[#2C463F] shadow-[0_6px_18px_rgba(74,130,118,0.12)]'
                          : 'chat-bubble-doll text-[#382A22]'
                      }`}
                    >
                      <BreezeLeavesOverlay active={isOpeningSpeaking} />
                      <span className="relative z-10">{doll.persona.openingLine}</span>
                    </div>
                    <div className="flex items-center gap-2">
                      <DollVoiceButton
                        playing={isOpeningSpeaking}
                        onToggle={() => toggleSpeak('opening', doll.persona.openingLine)}
                      />
                    </div>
                  </div>
                </motion.div>
              );
            })()}

            {messages.map((msg) => {
              if (msg.role === 'user') {
                return (
                  <motion.div
                    key={msg.id}
                    initial={{ opacity: 0, y: 8, scale: 0.98 }}
                    animate={{ opacity: 1, y: 0, scale: 1 }}
                    transition={{ type: 'spring', stiffness: 380, damping: 28 }}
                    className="flex justify-end"
                  >
                    <div data-memory-bubble-ignore="true" className="max-w-[84%]">
                      <div className="px-3.5 py-2.5 sm:px-4 sm:py-3 rounded-[20px] rounded-tr-md chat-bubble-user text-[#24463E] text-[14.5px] sm:text-sm leading-relaxed whitespace-pre-wrap">
                        {msg.content}
                      </div>
                    </div>
                  </motion.div>
                );
              }

              const isFailed = msg.status === 'failed' || msg.status === 'incomplete';
              const isSpeaking = speakingId === msg.id;
              const canSpeak = msg.status === 'completed' && Boolean(msg.content.trim());
              const originalUserText = userMessageMap.get(msg.clientMessageId) || '';

              return (
                <motion.div
                  key={msg.id}
                  initial={{ opacity: 0, y: 8, scale: 0.985 }}
                  animate={{ opacity: 1, y: 0, scale: 1 }}
                  transition={{ type: 'spring', stiffness: 360, damping: 28 }}
                  className="flex items-start gap-2.5 max-w-[88%] sm:max-w-[84%]"
                >
                  <div
                    data-memory-bubble-ignore="true"
                    className="w-7 h-7 sm:w-8 sm:h-8 rounded-full sm:rounded-lg overflow-hidden border border-[#EAE2D6] bg-white p-0.5 shrink-0 mt-0.5"
                  >
                    <SafeImage src={doll.avatarUrl} alt={doll.name} className="w-full h-full object-contain" />
                  </div>
                  <div data-memory-bubble-ignore="true" className="space-y-1.5 min-w-0">
                    <div className="text-[11px] text-[#9A887B] flex flex-wrap items-center gap-1.5">
                      <span>{doll.name}</span>
                      {msg.provider && (
                        <>
                          <span aria-hidden="true">·</span>
                          <span className="font-mono">{msg.provider}</span>
                        </>
                      )}
                      {msg.firstTokenMs !== null && (
                        <>
                          <span aria-hidden="true">·</span>
                          <span className="font-mono tabular-nums">{msg.firstTokenMs}ms</span>
                        </>
                      )}
                      {msg.status === 'streaming' && (
                        <>
                          <span aria-hidden="true">·</span>
                          <span className="text-[#4A8276]">正在输入…</span>
                        </>
                      )}
                      {isSpeaking && (
                        <>
                          <span aria-hidden="true">·</span>
                          <span className="text-[#4A8276]">清风轻语中</span>
                        </>
                      )}
                      {isFailed && (
                        <>
                          <span aria-hidden="true">·</span>
                          <span className="text-[#B84A39] font-medium">
                            {msg.status === 'incomplete' ? '回复中断' : '回复失败'}
                            {msg.errorCode ? ` (${msg.errorCode})` : ''}
                          </span>
                        </>
                      )}
                    </div>
                    <div
                      className={`relative overflow-hidden px-3.5 py-2.5 sm:px-4 sm:py-3 rounded-[20px] rounded-tl-md text-[14.5px] sm:text-sm leading-relaxed whitespace-pre-wrap transition-all duration-300 ${
                        isFailed
                          ? 'bg-[#FDF2F0] border border-[#E5B8B0] text-[#382A22]'
                          : isSpeaking
                            ? 'bg-[#F3FAF7] border border-[#4A8276]/45 text-[#2C463F] shadow-[0_6px_18px_rgba(74,130,118,0.12)]'
                            : 'chat-bubble-doll text-[#382A22]'
                      }`}
                    >
                      <BreezeLeavesOverlay active={isSpeaking} />
                      <div className="relative z-10">
                        {msg.content ||
                          (msg.status === 'streaming' ? (
                            <span className="inline-flex items-center gap-1 py-1">
                              {[0, 1, 2].map((dot) => (
                                <motion.span
                                  key={dot}
                                  animate={{ y: [0, -3, 0], opacity: [0.35, 1, 0.35] }}
                                  transition={{
                                    duration: 0.9,
                                    repeat: Infinity,
                                    delay: dot * 0.16,
                                  }}
                                  className="w-1.5 h-1.5 rounded-full bg-[#4A8276]"
                                />
                              ))}
                            </span>
                          ) : (
                            '（未收到完整回复内容）'
                          ))}
                      </div>
                    </div>

                    {(canSpeak || (isFailed && originalUserText && !sending)) && (
                      <div className="flex flex-wrap items-center gap-2">
                        {canSpeak && (
                          <DollVoiceButton
                            playing={isSpeaking}
                            onToggle={() => toggleSpeak(msg.id, msg.content)}
                          />
                        )}
                        {isFailed && originalUserText && !sending && (
                          <button
                            type="button"
                            onClick={() => handleRetryFailed(msg.clientMessageId, originalUserText)}
                            className="group inline-flex items-center gap-1.5 text-xs font-medium btn-icon-ghost py-1"
                          >
                            <RefreshCw className="w-3.5 h-3.5 text-[#4A8276] transition-transform duration-300 group-hover:rotate-180" />
                            <span>重试回复（不重复发送原消息）</span>
                          </button>
                        )}
                      </div>
                    )}
                  </div>
                </motion.div>
              );
            })}

            {streamError && (
              <motion.div
                data-memory-bubble-ignore="true"
                initial={{ opacity: 0, y: 6 }}
                animate={{ opacity: 1, y: 0 }}
                className="p-3.5 rounded-xl border border-[#E5B8B0] bg-[#FDF2F0] text-xs text-[#9E3D2E] flex flex-wrap items-center justify-between gap-2"
              >
                <div>
                  <span className="font-mono font-medium mr-1.5">[{streamError.code}]</span>
                  <span>{streamError.message}</span>
                </div>
                {streamError.retryClientMessageId && streamError.retryText && !sending && (
                  <button
                    type="button"
                    onClick={() =>
                      handleRetryFailed(streamError.retryClientMessageId!, streamError.retryText!)
                    }
                    className="font-medium btn-icon-danger whitespace-nowrap"
                  >
                    立即重试
                  </button>
                )}
              </motion.div>
            )}

            {/* Whisper-quiet blank-space interaction cue */}
            <div className="pt-4 pb-1 text-center select-none">
              <span className="text-[11px] tracking-wide text-[#ACA093]/85">
                轻点空白纸面，浮现近期记忆气泡
              </span>
            </div>

            <div ref={bottomRef} />
          </div>

          {/* Sticky Bottom Composer */}
          <form
            onSubmit={handleSubmit}
            className={`${
              mobileTab === 'memory' ? 'hidden lg:block' : 'block'
            } sticky bottom-0 z-20 px-3.5 sm:px-4 pt-2.5 safe-pb border-t border-[#EAE2D6] space-y-2 ios-glass-bar lg:bg-white/95 lg:rounded-b-2xl`}
          >
            <div className="flex items-center justify-between gap-2 px-0.5">
              <button
                type="button"
                onClick={() => {
                  haptic('selection');
                  setRememberToggle((v) => !v);
                }}
                className={`inline-flex items-center gap-1.5 text-xs font-medium transition-colors ${
                  rememberToggle ? 'text-[#3B6C61]' : 'text-[#6E5C50] hover:text-[#382A22]'
                }`}
              >
                <BookmarkPlus
                  className={`w-3.5 h-3.5 ${rememberToggle ? 'text-[#4A8276]' : ''}`}
                />
                <span>{rememberToggle ? '已开启：同步写入记忆' : '附带记住一件事'}</span>
              </button>
              <span className="hidden sm:inline text-[11px] text-[#9A887B]">
                支持以“记住：……”开头直接写入
              </span>
            </div>

            <AnimatePresence initial={false}>
              {rememberToggle && (
                <motion.div
                  initial={{ height: 0, opacity: 0 }}
                  animate={{ height: 'auto', opacity: 1 }}
                  exit={{ height: 0, opacity: 0 }}
                  transition={{ duration: 0.2, ease: EASE_STUDIO }}
                  className="overflow-hidden"
                >
                  <input
                    type="text"
                    value={rememberText}
                    onChange={(e) => setRememberText(e.target.value)}
                    placeholder="填写希望角色记住的事，例如：我下周五要参加路演"
                    maxLength={300}
                    className="w-full px-3.5 py-2 text-[16px] sm:text-xs bg-[#FAF7F2] border border-[#DFD5C7] rounded-xl focus:outline-none focus:ring-2 focus:ring-[#4A8276]/25 focus:border-[#4A8276]"
                  />
                </motion.div>
              )}
            </AnimatePresence>

            <div className="flex items-end gap-2">
              <textarea
                rows={1}
                value={inputText}
                onChange={(e) => setInputText(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && !e.shiftKey) {
                    e.preventDefault();
                    if (inputText.trim() && !sending) {
                      void handleSubmit(e as unknown as React.FormEvent);
                    }
                  }
                }}
                placeholder={`给 ${doll.name} 写一句话…`}
                disabled={sending}
                className="flex-1 resize-none px-4 py-2.5 text-[16px] sm:text-sm bg-[#FFFDF9]/92 border border-[#DFD5C6] rounded-[22px] shadow-[inset_0_1px_2px_rgba(56,42,34,0.04)] focus:outline-none focus:bg-white focus:ring-2 focus:ring-[#4A8276]/20 focus:border-[#4A8276] disabled:opacity-60 transition-all max-h-28"
              />
              <button
                type="submit"
                disabled={sending || !inputText.trim()}
                aria-label="发送消息"
                className="inline-flex items-center justify-center gap-1.5 w-[42px] sm:w-auto sm:px-5 h-[42px] text-sm font-medium btn-orb-primary whitespace-nowrap shrink-0"
              >
                <Send className="w-4 h-4" />
                <span className="hidden sm:inline">{sending ? '回复中' : '发送'}</span>
              </button>
            </div>
          </form>
        </section>

        {/* Desktop Right Memory Sidebar */}
        <aside className="hidden lg:block lg:col-span-4 lg:sticky lg:top-24 space-y-4">
          <div className="studio-card rounded-2xl p-5 space-y-4">
            <div className="flex items-center justify-between gap-2 border-b border-[#EAE2D6] pb-3.5">
              <div>
                <h2 className="font-editorial text-base font-semibold text-[#382A22]">角色记忆档案</h2>
                <p className="text-[11px] text-[#9A887B] mt-0.5">
                  仅记录你明确确认的信息，透明可控
                </p>
              </div>
              <span className="text-xs font-mono tabular-nums text-[#9A887B]">
                {memories.length} 项
              </span>
            </div>
            {renderMemoryPanelContent()}
          </div>
          <p className="px-1 text-[11px] text-[#9A887B] leading-relaxed">
            说明：删除记忆后，后续请求将不再注入该条目；若近期 20 条对话原文仍包含相同内容，角色仍可能从历史上下文中读取。
          </p>
        </aside>
      </div>
    </div>
  );
}
