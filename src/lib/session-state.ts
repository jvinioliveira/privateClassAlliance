export const SESSION_LAST_ACTIVITY_AT_KEY = 'auth:last-activity-at';
export const SESSION_EXPIRED_REASON_KEY = 'auth:expired-reason';

export const STUDENT_LAST_ROUTE_KEY = 'nav:last-route:student';
export const ADMIN_LAST_ROUTE_KEY = 'nav:last-route:admin';

type SavedRoute = {
  path: string;
  savedAt: number;
};

export const saveLastRoute = (storageKey: string, path: string) => {
  if (typeof window === 'undefined') return;
  const payload: SavedRoute = { path, savedAt: Date.now() };
  window.localStorage.setItem(storageKey, JSON.stringify(payload));
};

export const getRecentLastRoute = (storageKey: string, maxAgeMs: number): string | null => {
  if (typeof window === 'undefined') return null;

  const raw = window.localStorage.getItem(storageKey);
  if (!raw) return null;

  try {
    const parsed = JSON.parse(raw) as Partial<SavedRoute>;
    const path = typeof parsed.path === 'string' ? parsed.path.trim() : '';
    const savedAt = Number(parsed.savedAt);
    if (!path || !Number.isFinite(savedAt)) return null;
    if (Date.now() - savedAt > maxAgeMs) return null;
    if (path === '/' || path === '/login' || path.startsWith('/signup') || path.startsWith('/reset-password')) return null;
    return path;
  } catch {
    return null;
  }
};
