export const LEGACY_SHARED_VISITOR_KEY = 'vk_ephemeral_fallback_0001';

export function isVisitorKey(value: string): boolean {
  return value !== LEGACY_SHARED_VISITOR_KEY && /^[a-zA-Z0-9_-]{12,80}$/.test(value);
}
