export type HapticStyle = 'selection' | 'light' | 'medium' | 'success' | 'warning';

const VIBRATE_PATTERNS: Record<HapticStyle, number | number[]> = {
  selection: 8,
  light: 12,
  medium: 18,
  success: [10, 36, 16],
  warning: [14, 30, 12],
};

let iosSwitchLabel: HTMLLabelElement | null = null;

function isTouchCapableDevice(): boolean {
  if (typeof window === 'undefined') return false;
  try {
    if (window.matchMedia?.('(pointer: coarse)').matches) return true;
  } catch {
    // ignore matchMedia failures
  }
  return (navigator.maxTouchPoints ?? 0) > 0;
}

function triggerIosTapticSwitch(): void {
  if (typeof document === 'undefined' || !document.body) return;

  if (!iosSwitchLabel || !document.body.contains(iosSwitchLabel)) {
    const wrapper = document.createElement('div');
    wrapper.setAttribute('aria-hidden', 'true');
    wrapper.style.cssText =
      'position:fixed;top:0;left:0;width:1px;height:1px;opacity:0;pointer-events:none;overflow:hidden;z-index:-1;';

    const input = document.createElement('input');
    input.type = 'checkbox';
    input.id = '__nutshell_ios_haptic_switch__';
    input.tabIndex = -1;
    input.setAttribute('switch', '');
    input.setAttribute('aria-hidden', 'true');

    const label = document.createElement('label');
    label.htmlFor = input.id;
    label.setAttribute('aria-hidden', 'true');

    wrapper.appendChild(input);
    wrapper.appendChild(label);
    document.body.appendChild(wrapper);
    iosSwitchLabel = label;
  }

  iosSwitchLabel.click();
}

/**
 * Triggers a subtle, Apple-style tactile haptic pulse on mobile devices.
 * - Uses navigator.vibrate() on Android/supported browsers.
 * - Falls back to iOS Safari 17.4+ native `<input type="checkbox" switch>` Taptic Engine pulse.
 * - Silent no-op on desktop or unsupported environments.
 */
export function haptic(style: HapticStyle = 'light'): void {
  if (typeof window === 'undefined' || !isTouchCapableDevice()) return;

  try {
    if (typeof navigator !== 'undefined' && typeof navigator.vibrate === 'function') {
      const ok = navigator.vibrate(VIBRATE_PATTERNS[style]);
      if (ok) return;
    }
  } catch {
    // Fallback below if vibrate is blocked
  }

  try {
    // iOS Safari 17.4+ Taptic Engine trigger (synchronous within user gesture)
    triggerIosTapticSwitch();
  } catch {
    // Silently ignore in restricted environments
  }
}
