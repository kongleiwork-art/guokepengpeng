import { useState } from 'react';
import { motion } from 'motion/react';
import { haptic } from '../lib/haptics';

const BRAND_CHARS = ['果', '壳', '碰', '碰'] as const;

export function HomeBrandLetterHero() {
  const [bumpCount, setBumpCount] = useState(0);

  const triggerBump = () => {
    haptic('light');
    setBumpCount((c) => c + 1);
  };

  return (
    <button
      type="button"
      onClick={triggerBump}
      aria-label="果壳碰碰"
      className="group relative inline-flex items-center gap-1.5 sm:gap-2 py-1 pr-1.5 text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#4A8276]/40 rounded-lg select-none whitespace-nowrap shrink-0"
    >
      {/* Subtle compact drifting Sage Green & Warm Ochre watercolor mist tucked beneath the strokes */}
      <span
        aria-hidden="true"
        className="pointer-events-none absolute -bottom-0.5 left-4 right-0 h-[13px] overflow-visible"
      >
        <span className="absolute left-0 top-0 w-[62%] h-[11px] brand-under-wash-sage opacity-75" />
        <span className="absolute right-0 top-[1px] w-[58%] h-[10px] brand-under-wash-ochre opacity-75" />
        <span className="absolute inset-x-[6%] top-[3px] h-[7px] brand-under-wash-veil opacity-70" />
      </span>

      {/* Miniature lively acorn mark with gentle spring tilt */}
      <motion.svg
        key={`acorn-${bumpCount}`}
        width="19"
        height="19"
        viewBox="0 0 24 24"
        fill="none"
        aria-hidden="true"
        initial={bumpCount > 0 ? { rotate: -14, scale: 0.9 } : false}
        animate={{ rotate: 0, scale: 1 }}
        transition={{ type: 'spring', stiffness: 420, damping: 16 }}
        className="relative z-10 text-[#4A8276] shrink-0 transition-transform duration-300 group-hover:rotate-[-10deg] group-hover:scale-105"
      >
        <path d="M12 3.2V5.4" stroke="#C9963B" strokeWidth="1.8" strokeLinecap="round" />
        <path
          d="M6.5 9.2C6.5 7.0 8.9 5.4 12 5.4C15.1 5.4 17.5 7.0 17.5 9.2H6.5Z"
          fill="currentColor"
          fillOpacity="0.18"
          stroke="currentColor"
          strokeWidth="1.6"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
        <path
          d="M7.7 9.5C7.7 14.1 9.5 18.1 12 19.7C14.5 18.1 16.3 14.1 16.3 9.5"
          stroke="#382A22"
          strokeWidth="1.6"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      </motion.svg>

      {/* Compact ultra-fine serif characters with playful staggered spring bump */}
      <span className="relative z-10 inline-flex items-baseline font-serif-hairline text-[19px] sm:text-[21px] leading-none tracking-[0.12em] text-[#35261D]">
        {BRAND_CHARS.map((char, idx) => (
          <motion.span
            key={`${idx}-${bumpCount}`}
            initial={bumpCount > 0 ? { y: 0, rotate: 0 } : { opacity: 0, y: 5 }}
            animate={
              bumpCount > 0
                ? {
                    y: [0, -4, 0.5, 0],
                    rotate: [0, idx % 2 === 0 ? -4 : 4, 0],
                  }
                : { opacity: 1, y: 0 }
            }
            whileHover={{ y: -2, transition: { type: 'spring', stiffness: 500, damping: 18 } }}
            transition={
              bumpCount > 0
                ? {
                    duration: 0.46,
                    delay: idx * 0.05,
                    ease: [0.22, 1, 0.36, 1],
                  }
                : {
                    duration: 0.34,
                    delay: idx * 0.04,
                    ease: [0.22, 1, 0.36, 1],
                  }
            }
            className="inline-block"
          >
            {char}
          </motion.span>
        ))}
      </span>

      {/* Tiny delicate vermilion seal dot accent */}
      <motion.span
        key={`seal-${bumpCount}`}
        aria-hidden="true"
        initial={bumpCount > 0 ? { scale: 0.8, rotate: 10 } : false}
        animate={{ scale: 1, rotate: 0 }}
        transition={{ type: 'spring', stiffness: 420, damping: 18, delay: 0.14 }}
        className="relative z-10 -ml-1 -mt-2 inline-flex items-center justify-center w-[14px] h-[14px] rounded-[3px] letter-seal-stamp text-[7px] leading-none font-editorial tracking-normal shrink-0"
      >
        壳
      </motion.span>
    </button>
  );
}
