import { useEffect, useRef, useState } from 'react';
import { ArrowUp, X } from 'lucide-react';
import { streamDraftChat } from '../lib/api';
import type { DraftChatTurn, PersonaPublic } from '../lib/types';

interface Props {
  open: boolean;
  persona: PersonaPublic;
  materialIds: string[];
  onClose: () => void;
  onRequestScenario: () => void;
}

export function DraftCompanionChat({ open, persona, materialIds, onClose, onRequestScenario }: Props) {
  const dialog = useRef<HTMLDialogElement>(null);
  const heading = useRef<HTMLHeadingElement>(null);
  const transcript = useRef<HTMLDivElement>(null);
  const request = useRef<AbortController | null>(null);
  const [turns, setTurns] = useState<DraftChatTurn[]>([]);
  const [attempt, setAttempt] = useState<DraftChatTurn | null>(null);
  const [input, setInput] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    const element = dialog.current;
    if (!element) return;
    if (open && !element.open) {
      element.showModal();
      heading.current?.focus({ preventScroll: true });
    } else if (!open && element.open) {
      element.close();
    }
  }, [open]);

  useEffect(() => () => {
    request.current?.abort();
    request.current = null;
  }, []);

  useEffect(() => {
    if (open && transcript.current) transcript.current.scrollTop = transcript.current.scrollHeight;
  }, [open, turns, attempt, error]);

  async function send(value: string) {
    const text = value.trim();
    if (!text || request.current) return;
    const controller = new AbortController();
    request.current = controller;
    setInput(draft => draft.trim() === text ? '' : draft);
    setBusy(true);
    setError('');
    setAttempt({ user: text, reply: '' });
    let reply = '';
    try {
      await streamDraftChat({
        personaId: persona.id, materialIds, text,
        history: turns.slice(-6).map(turn => ({ user: turn.user, reply: turn.reply.slice(0, 4000) })),
      }, {
        onDelta(chunk) {
          if (controller.signal.aborted) return;
          reply += chunk;
          setAttempt({ user: text, reply });
        },
        onDone() {
          if (controller.signal.aborted) return;
          setTurns(previous => [...previous, { user: text, reply }]);
          setAttempt(null);
        },
        onError() {
          if (!controller.signal.aborted) setError('刚才的回复中断了。你的话还在，可以再发一次。');
        },
      }, controller.signal);
    } catch {
      if (!controller.signal.aborted) setError('连接中断了。联网后可以再发一次。');
    } finally {
      if (request.current === controller) {
        request.current = null;
        setBusy(false);
      }
    }
  }

  const replyStyle = 'w-fit max-w-[90%] whitespace-pre-wrap break-words rounded-2xl rounded-tl-sm bg-[#F2EEE7] px-3.5 py-2.5 text-[#382A22]';
  return (
    <dialog ref={dialog} aria-labelledby="draft-chat-heading"
      onCancel={event => { event.preventDefault(); onClose(); }}
      className="m-auto w-[92vw] max-w-md overflow-hidden rounded-[22px] border border-[#E6DDD0] bg-[#FFFDF9] p-0 text-[#382A22] shadow-xl backdrop:bg-black/35">
      <div className="flex max-h-[85dvh] flex-col">
        <header className="flex shrink-0 items-center justify-between gap-3 border-b border-[#EFE7DC] px-4 py-3">
          <h2 ref={heading} id="draft-chat-heading" tabIndex={-1}
            className="font-editorial text-lg font-semibold outline-none">和{persona.name}聊聊</h2>
          <button type="button" onClick={onClose} aria-label="回到娃娃方案"
            className="btn-paper-soft grid h-10 w-10 place-items-center">
            <X className="h-4 w-4" aria-hidden="true" />
          </button>
        </header>
        <div ref={transcript} role="log" aria-label="聊天记录"
          className="min-h-0 flex-1 space-y-3 overflow-y-auto overscroll-contain px-4 py-4 text-sm leading-relaxed">
          <p className={replyStyle}>我还想多认识你一点。你希望我哪一点更像你？也可以跟我聊聊今天的小事。</p>
          {(attempt ? [...turns, attempt] : turns).map((turn, index) => (
            <div key={index} className="space-y-3">
              <p className="ml-auto w-fit max-w-[90%] whitespace-pre-wrap break-words rounded-2xl rounded-tr-sm bg-[#DDEEE7] px-3.5 py-2.5 text-[#264C42]">
                <span className="sr-only">你说：</span>{turn.user}
              </p>
              {turn.reply
                ? <p className={replyStyle}><span className="sr-only">{persona.name}说：</span>{turn.reply}</p>
                : busy && <p className="text-xs text-[#6E5C50]">{persona.name}正在回复…</p>}
            </div>
          ))}
          {error && attempt && (
            <div className="space-y-1 text-xs text-[#6E5C50]">
              <p role="status">{error}</p>
              <button type="button" onClick={() => void send(attempt.user)}
                className="min-h-9 font-medium text-[#3D7267] underline underline-offset-4">重试这条消息</button>
            </div>
          )}
        </div>
        <footer className="shrink-0 border-t border-[#EFE7DC] px-4 py-3">
          <form className="flex items-center gap-2" onSubmit={event => { event.preventDefault(); void send(input); }}>
            <label htmlFor="draft-chat-input" className="sr-only">你想说的话</label>
            <input id="draft-chat-input" value={input} onChange={event => setInput(event.target.value)}
              autoComplete="off" enterKeyHint="send" maxLength={2000} placeholder="跟我说说吧…"
              className="min-h-11 min-w-0 flex-1 rounded-xl border border-[#DAD0C4] bg-white px-3 text-base" />
            <button type="submit" disabled={busy || !input.trim()} aria-label="发送消息"
              className="btn-capsule-primary grid h-11 w-11 shrink-0 place-items-center disabled:opacity-45">
              <ArrowUp className="h-5 w-5" aria-hidden="true" />
            </button>
          </form>
          {(turns.length > 0 || error) && (
            <button type="button" onClick={onRequestScenario}
              className="mt-1 min-h-9 text-xs font-medium text-[#3D7267] underline underline-offset-4">试试情景测验</button>
          )}
        </footer>
      </div>
    </dialog>
  );
}
