/**
 * Gentle handcrafted-doll voice engine built on Web Speech API
 * with persona-aware soft tuning, delicate wooden windchime cue,
 * and resilient fallback timer when OS voices are unavailable.
 */

export interface SpeakCallbacks {
  onStart?: () => void;
  onEnd?: () => void;
  onError?: () => void;
}

interface ActivePlayback {
  id: string;
  cancel: () => void;
}

let activePlayback: ActivePlayback | null = null;

function getVoiceTuning(mbti?: string): { pitch: number; rate: number } {
  const code = (mbti || '').toUpperCase();
  if (code.startsWith('ENF') || code.startsWith('ESF')) {
    return { pitch: 1.18, rate: 0.98 };
  }
  if (code.startsWith('INF') || code.startsWith('ISF')) {
    return { pitch: 1.12, rate: 0.92 };
  }
  if (code.startsWith('INT') || code.startsWith('IST')) {
    return { pitch: 1.03, rate: 0.93 };
  }
  return { pitch: 1.1, rate: 0.95 };
}

function sanitizeForSpeech(raw: string): string {
  return raw
    .replace(/[*_`~#>\[\]]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

function pickGentleChineseVoice(voices: SpeechSynthesisVoice[]): SpeechSynthesisVoice | null {
  if (!voices.length) return null;
  const zhVoices = voices.filter((v) => v.lang.toLowerCase().startsWith('zh'));
  const pool = zhVoices.length > 0 ? zhVoices : voices;

  const preferredKeywords = [
    'tingting',
    'ting-ting',
    'meijia',
    'mei-jia',
    'sinji',
    'xiaoxiao',
    'xiaoyi',
    'yaoyao',
    'huihui',
    'google 普通话',
    'mandarin',
    'female',
    'natural',
  ];

  for (const kw of preferredKeywords) {
    const match = pool.find((v) => v.name.toLowerCase().includes(kw));
    if (match) return match;
  }

  return (
    pool.find((v) => v.lang.toLowerCase() === 'zh-cn') ||
    pool.find((v) => v.lang.toLowerCase().startsWith('zh')) ||
    null
  );
}

/**
 * Whisper-soft wooden windchime note pair using Web Audio API.
 * Adds subtle tactile handmade-doll charm when starting voice playback.
 */
function playSoftWindchimeCue(): void {
  if (typeof window === 'undefined') return;
  try {
    const AudioCtx =
      window.AudioContext ||
      (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!AudioCtx) return;

    const ctx = new AudioCtx();
    const now = ctx.currentTime;

    const notes = [659.25, 880.0]; // Soft E5 -> A5 bamboo chime interval
    notes.forEach((freq, idx) => {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = 'sine';
      osc.frequency.setValueAtTime(freq, now + idx * 0.085);

      gain.gain.setValueAtTime(0.0001, now + idx * 0.085);
      gain.gain.exponentialRampToValueAtTime(0.032, now + idx * 0.085 + 0.025);
      gain.gain.exponentialRampToValueAtTime(0.0001, now + idx * 0.085 + 0.36);

      osc.connect(gain);
      gain.connect(ctx.destination);
      osc.start(now + idx * 0.085);
      osc.stop(now + idx * 0.085 + 0.38);
    });

    window.setTimeout(() => {
      void ctx.close().catch(() => {});
    }, 650);
  } catch {
    // Ignore autoplay or Web Audio restrictions gracefully
  }
}

export function isSpeechSupported(): boolean {
  return typeof window !== 'undefined' && 'speechSynthesis' in window && 'SpeechSynthesisUtterance' in window;
}

export function stopDollVoice(): void {
  if (activePlayback) {
    const prev = activePlayback;
    activePlayback = null;
    prev.cancel();
  }
  if (isSpeechSupported()) {
    try {
      window.speechSynthesis.cancel();
    } catch {
      // ignore
    }
  }
}

export function speakDollLine(
  id: string,
  text: string,
  mbti: string | undefined,
  callbacks: SpeakCallbacks = {}
): void {
  stopDollVoice();

  const clean = sanitizeForSpeech(text);
  if (!clean) {
    callbacks.onEnd?.();
    return;
  }

  playSoftWindchimeCue();

  // Graceful fallback cadence if browser lacks Web Speech API
  if (!isSpeechSupported()) {
    const durationMs = Math.min(Math.max(clean.length * 145, 2200), 9000);
    let cancelled = false;
    const timer = window.setTimeout(() => {
      if (cancelled) return;
      if (activePlayback?.id === id) activePlayback = null;
      callbacks.onEnd?.();
    }, durationMs);

    activePlayback = {
      id,
      cancel: () => {
        cancelled = true;
        window.clearTimeout(timer);
      },
    };
    callbacks.onStart?.();
    return;
  }

  try {
    const synth = window.speechSynthesis;
    const utterance = new SpeechSynthesisUtterance(clean);
    const tuning = getVoiceTuning(mbti);
    utterance.lang = 'zh-CN';
    utterance.pitch = tuning.pitch;
    utterance.rate = tuning.rate;
    utterance.volume = 0.92;

    const voices = synth.getVoices();
    const chosen = pickGentleChineseVoice(voices);
    if (chosen) {
      utterance.voice = chosen;
    }

    let settled = false;
    let fallbackTimer: number | null = null;
    let started = false;

    const finish = (errored = false) => {
      if (settled) return;
      settled = true;
      if (fallbackTimer !== null) {
        window.clearTimeout(fallbackTimer);
        fallbackTimer = null;
      }
      if (activePlayback?.id === id) {
        activePlayback = null;
      }
      if (errored) {
        callbacks.onError?.();
      } else {
        callbacks.onEnd?.();
      }
    };

    utterance.onstart = () => {
      started = true;
    };

    utterance.onend = () => {
      finish(false);
    };

    utterance.onerror = (ev) => {
      // "interrupted" or "canceled" happen during normal stop/switch
      if (ev.error === 'interrupted' || ev.error === 'canceled') {
        finish(false);
        return;
      }
      // If TTS engine had no audio voice in sandbox, still let breeze play gently for a moment
      if (!started) {
        const gentleMs = Math.min(Math.max(clean.length * 120, 2000), 6500);
        fallbackTimer = window.setTimeout(() => finish(false), gentleMs);
        return;
      }
      finish(true);
    };

    // Safety guard for browsers (e.g. Chrome/Safari edge cases) where onend sometimes stalls
    const maxWaitMs = Math.min(Math.max(clean.length * 260, 4500), 28000);
    fallbackTimer = window.setTimeout(() => {
      if (!settled) {
        try {
          synth.cancel();
        } catch {
          // ignore
        }
        finish(false);
      }
    }, maxWaitMs);

    activePlayback = {
      id,
      cancel: () => {
        if (settled) return;
        settled = true;
        if (fallbackTimer !== null) {
          window.clearTimeout(fallbackTimer);
          fallbackTimer = null;
        }
        try {
          synth.cancel();
        } catch {
          // ignore
        }
      },
    };

    callbacks.onStart?.();
    synth.speak(utterance);
  } catch {
    callbacks.onError?.();
  }
}
