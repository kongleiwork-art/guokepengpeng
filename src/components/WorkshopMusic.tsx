import { useCallback, useEffect, useRef, useState } from 'react';
import { Music2, Pause } from 'lucide-react';
import { watchDollVoice } from '../lib/dollVoice';

const track = '/audio/guoke-window.mp3';
const voiceLevel = 0.24;

export function WorkshopMusic() {
  const player = useRef<HTMLAudioElement>(null);
  const button = useRef<HTMLButtonElement>(null);
  const mixer = useRef<{ context: AudioContext; volume?: AudioParam } | null>(null);
  const speaking = useRef(false);
  const enabled = useRef(true);
  const waitingForGesture = useRef(false);
  const request = useRef(0);
  const [status, setStatus] = useState<'paused' | 'playing' | 'failed'>('paused');

  // Keep native playback audible until the browser has unlocked the Web Audio mixer.
  const unlockMixer = useCallback(async (audio: HTMLAudioElement) => {
    const Context = window.AudioContext ||
      (window as Window & { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!Context) return;
    try {
      const output = mixer.current ??= { context: new Context() };
      const { context } = output;
      if (context.state !== 'running') await context.resume();
      if (mixer.current !== output || output.volume) return;
      const node = context.createGain();
      node.gain.value = speaking.current ? voiceLevel : 1;
      node.connect(context.destination);
      context.createMediaElementSource(audio).connect(node);
      output.volume = node.gain;
      audio.volume = 1;
    } catch {
      // The media element can play directly when the browser disallows Web Audio.
    }
  }, []);

  const start = useCallback((audio: HTMLAudioElement) => {
    if (!enabled.current || document.hidden) return;
    const id = ++request.current;
    waitingForGesture.current = true;
    if (!audio.hasAttribute('src')) audio.src = track;
    void audio.play().then(() => {
      if (request.current === id) waitingForGesture.current = false;
    }).catch((error: Error) => {
      if (request.current !== id || error.name === 'AbortError') return;
      const blocked = error.name === 'NotAllowedError';
      waitingForGesture.current = blocked;
      setStatus(blocked ? 'paused' : 'failed');
    });
  }, []);

  useEffect(() => {
    const audio = player.current!;
    const unwatch = watchDollVoice(active => {
      speaking.current = active;
      const level = active ? voiceLevel : 1;
      const output = mixer.current;
      if (output?.volume) {
        output.volume.setTargetAtTime(level, output.context.currentTime, active ? 0.04 : 0.16);
      } else {
        audio.volume = level;
      }
    });

    const onGesture = (event: Event) => {
      if (!event.isTrusted || !enabled.current || document.hidden || audio.error) return;
      if (event.target instanceof Node && button.current?.contains(event.target)) return;
      if (event instanceof KeyboardEvent && (event.repeat || !['Enter', ' '].includes(event.key))) return;
      void unlockMixer(audio);
      if (waitingForGesture.current && audio.paused) start(audio);
    };
    const onVisibility = () => {
      if (document.hidden) {
        ++request.current;
        waitingForGesture.current = false;
        audio.pause();
      } else if (enabled.current && !audio.error) {
        if (mixer.current) void unlockMixer(audio);
        start(audio);
      }
    };
    document.addEventListener('click', onGesture, true);
    document.addEventListener('touchend', onGesture, { capture: true, passive: true });
    document.addEventListener('keydown', onGesture, true);
    document.addEventListener('visibilitychange', onVisibility);
    start(audio);
    return () => {
      ++request.current;
      unwatch();
      document.removeEventListener('click', onGesture, true);
      document.removeEventListener('touchend', onGesture, true);
      document.removeEventListener('keydown', onGesture, true);
      document.removeEventListener('visibilitychange', onVisibility);
      audio.pause();
      if (mixer.current) {
        void mixer.current.context.close().catch(() => {});
        mixer.current = null;
      }
    };
  }, [start, unlockMixer]);

  function toggle() {
    const audio = player.current;
    if (!audio) return;
    if (status === 'playing') {
      enabled.current = false;
      waitingForGesture.current = false;
      ++request.current;
      audio.pause();
    } else {
      enabled.current = true;
      setStatus('paused');
      if (audio.error) audio.load();
      void unlockMixer(audio);
      start(audio);
    }
  }

  const playing = status === 'playing';
  const failed = status === 'failed';
  const label = (failed ? '重试播放' : playing ? '暂停' : '播放') + '背景音乐《果壳窗边》';
  return (
    <>
      <audio ref={player} loop preload="none"
        onPlaying={event => { if (enabled.current && !event.currentTarget.paused) setStatus('playing'); }}
        onPause={event => { if (event.currentTarget.paused) setStatus(previous => previous === 'failed' ? previous : 'paused'); }}
        onError={() => { waitingForGesture.current = false; setStatus('failed'); }} />
      <button ref={button} type="button" onClick={toggle} aria-label={label} aria-pressed={playing} title={label}
        className="inline-flex h-11 shrink-0 items-center justify-center gap-1 rounded-full px-2 text-xs font-medium text-[#356B5F] hover:bg-[#EAF2EC] focus-visible:outline-2 focus-visible:outline-[#4A8276]">
        {playing ? <Pause aria-hidden="true" size={15} /> : <Music2 aria-hidden="true" size={15} />}
        <span>{failed ? '重试' : '音乐'}</span>
      </button>
    </>
  );
}
