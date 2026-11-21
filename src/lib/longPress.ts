import { haptic } from './haptics';

const PRESSABLE_SELECTOR =
  '[data-pressable], .studio-card-hover, .btn-capsule-primary, .btn-primary-studio, .btn-stamp-water, .btn-ink-tinted, .btn-paper-soft, .btn-secondary-studio, .btn-orb-primary, .btn-orb-glass, .btn-voice-idle, .btn-voice-playing, .btn-icon-ghost, .btn-icon-danger';

const LONG_PRESS_DELAY_MS = 140;
const MOVE_CANCEL_THRESHOLD_PX = 10;

function isMobileOrTouchContext(e: PointerEvent): boolean {
  if (e.pointerType === 'touch' || e.pointerType === 'pen') return true;
  if (typeof window === 'undefined') return false;
  try {
    if (window.matchMedia?.('(pointer: coarse)').matches) return true;
  } catch {
    // ignore
  }
  return window.innerWidth < 768;
}

/**
 * Installs a lightweight delegated pointer observer for mobile Apple-style
 * press and long-press micro-interactions:
 * - Instant subtle touch dip (`data-pressing="true"`)
 * - Sustained hold (~140ms without scrolling) transitions into slight scale-up
 *   and luminous color-shift (`data-long-pressing="true"`) with a soft haptic pulse.
 */
export function installMobileLongPressFeedback(): () => void {
  if (typeof document === 'undefined' || typeof window === 'undefined') {
    return () => {};
  }

  let activeEl: HTMLElement | null = null;
  let timerId: number | null = null;
  let startX = 0;
  let startY = 0;
  let longPressed = false;

  const clearState = () => {
    if (timerId !== null) {
      window.clearTimeout(timerId);
      timerId = null;
    }
    if (activeEl) {
      activeEl.removeAttribute('data-pressing');
      activeEl.removeAttribute('data-long-pressing');
      activeEl = null;
    }
    longPressed = false;
  };

  const onPointerDown = (e: PointerEvent) => {
    if (e.button !== 0 && e.pointerType === 'mouse') return;
    if (!isMobileOrTouchContext(e)) return;

    const rawTarget = e.target;
    if (!(rawTarget instanceof Element)) return;

    const target = rawTarget.closest(PRESSABLE_SELECTOR);
    if (!(target instanceof HTMLElement)) return;
    if (target.matches(':disabled') || target.getAttribute('aria-disabled') === 'true') {
      return;
    }

    clearState();

    activeEl = target;
    startX = e.clientX;
    startY = e.clientY;
    longPressed = false;

    target.setAttribute('data-pressing', 'true');

    timerId = window.setTimeout(() => {
      if (!activeEl) return;
      activeEl.removeAttribute('data-pressing');
      activeEl.setAttribute('data-long-pressing', 'true');
      longPressed = true;
      haptic('light');
    }, LONG_PRESS_DELAY_MS);
  };

  const onPointerMove = (e: PointerEvent) => {
    if (!activeEl) return;
    const dx = e.clientX - startX;
    const dy = e.clientY - startY;
    if (dx * dx + dy * dy > MOVE_CANCEL_THRESHOLD_PX * MOVE_CANCEL_THRESHOLD_PX) {
      clearState();
    }
  };

  const onContextMenu = (e: MouseEvent) => {
    if (activeEl && longPressed) {
      e.preventDefault();
    }
  };

  document.addEventListener('pointerdown', onPointerDown, { passive: true });
  document.addEventListener('pointermove', onPointerMove, { passive: true });
  document.addEventListener('pointerup', clearState, { passive: true });
  document.addEventListener('pointercancel', clearState, { passive: true });
  document.addEventListener('contextmenu', onContextMenu);
  window.addEventListener('scroll', clearState, { passive: true, capture: true });
  window.addEventListener('blur', clearState);

  return () => {
    clearState();
    document.removeEventListener('pointerdown', onPointerDown);
    document.removeEventListener('pointermove', onPointerMove);
    document.removeEventListener('pointerup', clearState);
    document.removeEventListener('pointercancel', clearState);
    document.removeEventListener('contextmenu', onContextMenu);
    window.removeEventListener('scroll', clearState, { capture: true });
    window.removeEventListener('blur', clearState);
  };
}
