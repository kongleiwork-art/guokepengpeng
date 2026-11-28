import { useEffect, useRef, useState } from 'react';
import { Music2, Pause } from 'lucide-react';
import { watchDollVoice } from '../lib/dollVoice';

const track = '/audio/guoke-window.mp3';
const voiceLevel = 0.24;

export function WorkshopMusic() {
  const player = useRef<HTMLAudioElement>(null);
  const mixer = useRef<{ context: AudioContext; volume: AudioParam } | null>(null);
  const speaking = useRef(false);
  const [playing, setPlaying] = useState(false);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    const audio = player.current!;
    const unwatch = watchDollVoice(active => {
      speaking.current = active;
      const level = active ? voiceLevel : 1;
      if (mixer.current) {
        const { context, volume } = mixer.current;
        volume.setTargetAtTime(level, context.currentTime, active ? 0.04 : 0.16);
      } else {
        audio.volume = level;
      }
    });
    const pauseWhenHidden = () => { if (document.hidden) audio.pause(); };
    document.addEventListener('visibilitychange', pauseWhenHidden);
    return () => {
      unwatch();
      document.removeEventListener('visibilitychange', pauseWhenHidden);
      audio.pause();
      if (mixer.current) {
        void mixer.current.context.close().catch(() => {});
        mixer.current = null;
      }
    };
  }, []);

  function toggle() {
    const audio = player.current;
    if (!audio) return;
    if (!audio.paused && !audio.error) {
      audio.pause();
      return;
    }
    setFailed(false);
    if (!audio.getAttribute('src')) audio.src = track;
    else if (audio.error) audio.load();

    // A gain node also controls the music on iOS, where media volume can be hardware-only.
    const Context = window.AudioContext ||
      (window as Window & { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!mixer.current && Context) {
      let context: AudioContext | undefined;
      try {
        context = new Context();
        const node = context.createGain();
        node.gain.value = speaking.current ? voiceLevel : 1;
        node.connect(context.destination);
        context.createMediaElementSource(audio).connect(node);
        audio.volume = 1;
        mixer.current = { context, volume: node.gain };
      } catch {
        if (context) void context.close().catch(() => {});
      }
    }
    const context = mixer.current?.context;
    const resume = context && context.state !== 'running' ? context.resume() : undefined;
    void Promise.all([resume, audio.play()]).catch((error: Error) => {
      if (error.name === 'AbortError' || player.current !== audio) return;
      audio.pause();
      setFailed(true);
    });
  }

  const label = (failed ? '重试播放' : playing ? '暂停' : '播放') + '背景音乐《果壳窗边》';
  return (
    <>
      <audio ref={player} loop preload="none" onPlay={() => setPlaying(true)} onPause={() => setPlaying(false)}
        onError={() => { setFailed(true); setPlaying(false); }} />
      <button type="button" onClick={toggle} aria-label={label} aria-pressed={playing} title={label}
        className="inline-flex h-11 shrink-0 items-center justify-center gap-1 rounded-full px-2 text-xs font-medium text-[#356B5F] hover:bg-[#EAF2EC] focus-visible:outline-2 focus-visible:outline-[#4A8276]">
        {playing ? <Pause aria-hidden="true" size={15} /> : <Music2 aria-hidden="true" size={15} />}
        <span>{failed ? '重试' : '音乐'}</span>
      </button>
    </>
  );
}
