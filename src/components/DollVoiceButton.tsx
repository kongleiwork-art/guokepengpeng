import { AnimatePresence, motion } from 'motion/react';
import { haptic } from '../lib/haptics';

const WAVE_BARS = [
  { base: 6, peak: 14, delay: 0 },
  { base: 9, peak: 18, delay: 0.12 },
  { base: 7, peak: 16, delay: 0.24 },
  { base: 10, peak: 15, delay: 0.08 },
  { base: 5, peak: 12, delay: 0.18 },
] as const;

const DRIFTING_LEAVES = [
  { id: 'leaf-1', startX: '14%', driftX: 28, duration: 3.1, delay: 0, size: 13, color: '#6AA495', rotate: 38 },
  { id: 'leaf-2', startX: '48%', driftX: -22, duration: 3.6, delay: 0.75, size: 11, color: '#D4A85C', rotate: -42 },
  { id: 'leaf-3', startX: '76%', driftX: 20, duration: 3.2, delay: 1.45, size: 12, color: '#83B8AA', rotate: 28 },
  { id: 'leaf-4', startX: '30%', driftX: 18, duration: 3.8, delay: 2.05, size: 10, color: '#CFA076', rotate: -30 },
] as const;

interface SoundwaveGlyphProps {
  playing: boolean;
  compact?: boolean;
}

export function SoundwaveGlyph({ playing, compact = false }: SoundwaveGlyphProps) {
  const bars = compact ? WAVE_BARS.slice(0, 4) : WAVE_BARS;
  return (
    <span
      className="inline-flex items-center justify-center gap-[2px] h-4"
      aria-hidden="true"
    >
      {bars.map((bar, idx) => (
        <motion.span
          key={idx}
          animate={
            playing
              ? {
                  height: [
                    `${Math.round(bar.base * (compact ? 0.75 : 0.85))}px`,
                    `${Math.round(bar.peak * (compact ? 0.8 : 1))}px`,
                    `${Math.round(bar.base * (compact ? 0.7 : 0.78))}px`,
                  ],
                  opacity: [0.65, 1, 0.7],
                }
              : {
                  height: `${Math.round(bar.base * (compact ? 0.72 : 0.82))}px`,
                  opacity: 0.85,
                }
          }
          transition={
            playing
              ? {
                  duration: 0.85 + idx * 0.08,
                  repeat: Infinity,
                  repeatType: 'mirror',
                  ease: 'easeInOut',
                  delay: bar.delay,
                }
              : { duration: 0.25 }
          }
          className={`w-[2px] rounded-full ${
            playing
              ? idx === 2
                ? 'bg-[#C9963B]'
                : 'bg-[#4A8276]'
              : 'bg-current'
          }`}
        />
      ))}
    </span>
  );
}

interface DollVoiceButtonProps {
  playing: boolean;
  disabled?: boolean;
  onToggle: () => void;
}

/**
 * Airy Japanese-stationery soundwave pill button for handcrafted doll replies.
 * Tapping speaks the doll's line softly via Web Speech API with gentle breeze visuals.
 */
export function DollVoiceButton({ playing, disabled = false, onToggle }: DollVoiceButtonProps) {
  return (
    <button
      type="button"
      disabled={disabled}
      onClick={() => {
        haptic(playing ? 'selection' : 'light');
        onToggle();
      }}
      aria-pressed={playing}
      aria-label={playing ? '停止轻柔语音' : '聆听娃娃轻柔语音'}
      className={`group relative inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-[11px] font-medium transition-all duration-200 select-none ${
        playing
          ? 'btn-voice-playing text-[#2B5C51]'
          : 'btn-voice-idle text-[#7A685B] hover:text-[#356B5F]'
      }`}
    >
      {/* Subtle breeze halo pulse while speaking */}
      <AnimatePresence>
        {playing && (
          <motion.span
            key="voice-halo"
            initial={{ opacity: 0, scale: 0.9 }}
            animate={{ opacity: [0.4, 0.85, 0.4], scale: [1, 1.04, 1] }}
            exit={{ opacity: 0 }}
            transition={{ duration: 1.9, repeat: Infinity, ease: 'easeInOut' }}
            className="absolute inset-0 rounded-full bg-[#4A8276]/10 pointer-events-none"
          />
        )}
      </AnimatePresence>

      <span className="relative z-10 inline-flex items-center gap-1.5">
        <SoundwaveGlyph playing={playing} />
        <span>{playing ? '轻语中' : '轻听'}</span>
      </span>
    </button>
  );
}

interface BreezeLeavesOverlayProps {
  active: boolean;
}

/**
 * Delicate falling watercolor leaves & whispering breeze ribbons
 * drifting softly across a speaking doll message bubble.
 */
export function BreezeLeavesOverlay({ active }: BreezeLeavesOverlayProps) {
  return (
    <AnimatePresence>
      {active && (
        <motion.div
          key="breeze-overlay"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.35 }}
          aria-hidden="true"
          className="pointer-events-none absolute inset-0 overflow-hidden rounded-[18px]"
        >
          {/* Whispering translucent breeze shimmer sweep */}
          <div className="breeze-ribbon-sweep absolute inset-0" />

          {/* Soft curving wind line SVG */}
          <motion.svg
            viewBox="0 0 180 48"
            fill="none"
            className="absolute top-1.5 left-0 w-full h-10 opacity-45"
            initial={{ x: '-20%', opacity: 0 }}
            animate={{ x: ['-15%', '12%'], opacity: [0, 0.5, 0] }}
            transition={{ duration: 3.4, repeat: Infinity, ease: 'easeInOut' }}
          >
            <path
              d="M10 26 C42 14, 72 34, 112 20 C134 12, 152 16, 170 10"
              stroke="#6AA495"
              strokeWidth="1.2"
              strokeLinecap="round"
              strokeDasharray="4 6"
            />
            <path
              d="M28 36 C64 26, 98 40, 146 28"
              stroke="#C9963B"
              strokeWidth="1"
              strokeLinecap="round"
              strokeOpacity="0.65"
            />
          </motion.svg>

          {/* Gently drifting watercolor leaves */}
          {DRIFTING_LEAVES.map((leaf) => (
            <motion.svg
              key={leaf.id}
              width={leaf.size}
              height={leaf.size}
              viewBox="0 0 20 20"
              fill="none"
              style={{ left: leaf.startX, top: -6 }}
              className="absolute"
              initial={{ opacity: 0, y: -4, x: 0, rotate: -10 }}
              animate={{
                opacity: [0, 0.78, 0.65, 0],
                y: [-4, 24, 52, 74],
                x: [0, leaf.driftX * 0.55, leaf.driftX * 0.2, leaf.driftX],
                rotate: [-10, leaf.rotate, leaf.rotate * 0.4, leaf.rotate * 1.3],
              }}
              transition={{
                duration: leaf.duration,
                delay: leaf.delay,
                repeat: Infinity,
                ease: 'easeInOut',
              }}
            >
              <path
                d="M4 16 C4.5 9.5, 9 4.5, 16.5 4 C16 11, 11.5 15.5, 4 16 Z"
                fill={leaf.color}
                fillOpacity="0.72"
              />
              <path
                d="M4.2 15.8 C8 12, 11.5 8.8, 15.2 5.4"
                stroke="#FAF7F2"
                strokeWidth="0.9"
                strokeLinecap="round"
                strokeOpacity="0.8"
              />
            </motion.svg>
          ))}
        </motion.div>
      )}
    </AnimatePresence>
  );
}
