import React, { createContext, useContext, useEffect, useState } from 'react';
import { AuthChangeEvent, Session, User } from '@supabase/supabase-js';
import { supabase } from '@/integrations/supabase/client';
import { SESSION_EXPIRED_REASON_KEY, SESSION_LAST_ACTIVITY_AT_KEY } from '@/lib/session-state';

type UserRole = 'student' | 'admin';
const PASSWORD_RECOVERY_FLAG = 'auth:password-recovery';
const DEFAULT_IDLE_TIMEOUT_MINUTES = 30;
const MIN_IDLE_TIMEOUT_MINUTES = 15;
const ACTIVITY_WRITE_THROTTLE_MS = 15000;
const IDLE_CHECK_INTERVAL_MS = 30000;

const resolveIdleTimeoutMs = () => {
  const raw = Number(import.meta.env.VITE_SESSION_IDLE_TIMEOUT_MINUTES ?? DEFAULT_IDLE_TIMEOUT_MINUTES);
  if (!Number.isFinite(raw)) return DEFAULT_IDLE_TIMEOUT_MINUTES * 60 * 1000;
  const minutes = Math.max(Math.trunc(raw), MIN_IDLE_TIMEOUT_MINUTES);
  return minutes * 60 * 1000;
};

interface Profile {
  id: string;
  full_name: string | null;
  first_name: string | null;
  last_name: string | null;
  phone: string | null;
  avatar_url: string | null;
  role: UserRole;
}

interface AuthContextType {
  session: Session | null;
  user: User | null;
  profile: Profile | null;
  loading: boolean;
  signUp: (email: string, password: string, firstName: string, lastName: string) => Promise<void>;
  signIn: (email: string, password: string) => Promise<void>;
  signInWithGoogle: () => Promise<void>;
  signOut: () => Promise<void>;
  resetPassword: (email: string) => Promise<void>;
  updatePassword: (password: string) => Promise<void>;
  refreshProfile: () => Promise<void>;
  isAdmin: boolean;
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);

export const useAuth = () => {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used within AuthProvider');
  return ctx;
};

export const AuthProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [session, setSession] = useState<Session | null>(null);
  const [user, setUser] = useState<User | null>(null);
  const [profile, setProfile] = useState<Profile | null>(null);
  const [loading, setLoading] = useState(true);
  const idleTimeoutMs = resolveIdleTimeoutMs();

  const fetchProfile = async (userId: string) => {
    const { data, error } = await supabase
      .from('profiles')
      .select('id, full_name, first_name, last_name, phone, avatar_url, role')
      .eq('id', userId)
      .maybeSingle();

    if (error) throw error;

    setProfile((data as Profile | null) ?? null);
  };

  useEffect(() => {
    let mounted = true;

    const syncAuthState = async (event: AuthChangeEvent, nextSession: Session | null) => {
      if (!mounted) return;

      if (event === 'PASSWORD_RECOVERY' && typeof window !== 'undefined') {
        sessionStorage.setItem(PASSWORD_RECOVERY_FLAG, Date.now().toString());
        if (window.location.pathname !== '/reset-password') {
          const nextUrl = `${window.location.origin}/reset-password${window.location.search}${window.location.hash}`;
          window.location.replace(nextUrl);
          return;
        }
      }

      setSession(nextSession);
      setUser(nextSession?.user ?? null);

      if (nextSession?.user && typeof window !== 'undefined') {
        window.localStorage.setItem(SESSION_LAST_ACTIVITY_AT_KEY, Date.now().toString());
        window.localStorage.removeItem(SESSION_EXPIRED_REASON_KEY);
      }

      // Token refresh keeps the same user/profile, so avoid unnecessary loading flicker.
      if (event === 'TOKEN_REFRESHED') return;

      setLoading(true);
      setProfile(null);

      try {
        if (nextSession?.user) {
          await fetchProfile(nextSession.user.id);
        }
      } catch {
        setProfile(null);
      } finally {
        if (mounted) setLoading(false);
      }
    };

    const { data: { subscription } } = supabase.auth.onAuthStateChange((event, nextSession) => {
      void syncAuthState(event, nextSession);
    });

    void supabase.auth.getSession().then(({ data: { session: currentSession } }) => {
      void syncAuthState('INITIAL_SESSION', currentSession);
    });

    return () => {
      mounted = false;
      subscription.unsubscribe();
    };
  }, []);

  useEffect(() => {
    if (!user?.id || typeof window === 'undefined') return;

    const readLastActivity = () => {
      const raw = window.localStorage.getItem(SESSION_LAST_ACTIVITY_AT_KEY);
      const parsed = Number(raw);
      if (!Number.isFinite(parsed) || parsed <= 0) return null;
      return parsed;
    };

    const isExpired = () => {
      const lastActivity = readLastActivity();
      if (!lastActivity) return false;
      return Date.now() - lastActivity > idleTimeoutMs;
    };

    const expireSession = () => {
      window.localStorage.setItem(SESSION_EXPIRED_REASON_KEY, 'inactive');
      void supabase.auth.signOut();
    };

    if (isExpired()) {
      expireSession();
      return;
    }

    let lastPersistAt = 0;
    const markActivity = () => {
      const now = Date.now();
      if (now - lastPersistAt < ACTIVITY_WRITE_THROTTLE_MS) return;
      lastPersistAt = now;
      window.localStorage.setItem(SESSION_LAST_ACTIVITY_AT_KEY, now.toString());
    };

    markActivity();

    const onUserActivity = () => markActivity();
    const onVisibilityOrFocus = () => {
      if (isExpired()) {
        expireSession();
        return;
      }
      markActivity();
    };

    const activityEvents: Array<keyof WindowEventMap> = [
      'click',
      'keydown',
      'pointerdown',
      'touchstart',
      'scroll',
      'mousemove',
    ];

    activityEvents.forEach((eventName) => {
      window.addEventListener(eventName, onUserActivity, { passive: true });
    });

    const onVisibilityChange = () => {
      if (document.visibilityState === 'visible') onVisibilityOrFocus();
    };

    document.addEventListener('visibilitychange', onVisibilityChange);
    window.addEventListener('focus', onVisibilityOrFocus);
    window.addEventListener('online', onVisibilityOrFocus);

    const checkTimer = window.setInterval(() => {
      if (isExpired()) {
        expireSession();
      }
    }, IDLE_CHECK_INTERVAL_MS);

    return () => {
      window.clearInterval(checkTimer);
      activityEvents.forEach((eventName) => {
        window.removeEventListener(eventName, onUserActivity);
      });
      document.removeEventListener('visibilitychange', onVisibilityChange);
      window.removeEventListener('focus', onVisibilityOrFocus);
      window.removeEventListener('online', onVisibilityOrFocus);
    };
  }, [user?.id, idleTimeoutMs]);

  const signUp = async (email: string, password: string, firstName: string, lastName: string) => {
    const normalizedFirstName = firstName.trim();
    const normalizedLastName = lastName.trim();
    const fullName = `${normalizedFirstName} ${normalizedLastName}`.trim();

    const { error } = await supabase.auth.signUp({
      email,
      password,
      options: {
        data: {
          full_name: fullName || null,
          first_name: normalizedFirstName || null,
          last_name: normalizedLastName || null,
        },
        emailRedirectTo: window.location.origin,
      },
    });
    if (error) throw error;
  };

  const signIn = async (email: string, password: string) => {
    const { error } = await supabase.auth.signInWithPassword({ email, password });
    if (error) throw error;
  };

  const signInWithGoogle = async () => {
    const popupRedirect = `${window.location.origin}/auth/popup-callback`;
    const { data, error } = await supabase.auth.signInWithOAuth({
      provider: 'google',
      options: {
        redirectTo: popupRedirect,
        skipBrowserRedirect: true,
      },
    });
    if (error) throw error;

    const popupUrl = data?.url;
    if (!popupUrl) {
      throw new Error('Não foi possível iniciar o login com Google.');
    }

    const width = 500;
    const height = 680;
    const left = window.screenX + (window.outerWidth - width) / 2;
    const top = window.screenY + (window.outerHeight - height) / 2;
    const popup = window.open(
      popupUrl,
      'google-oauth-popup',
      `width=${width},height=${height},left=${left},top=${top},resizable=yes,scrollbars=yes,status=no`,
    );

    if (!popup) {
      // Fallback for browsers/devices that block popup windows.
      const { error: redirectError } = await supabase.auth.signInWithOAuth({
        provider: 'google',
        options: { redirectTo: window.location.origin },
      });
      if (redirectError) throw redirectError;
      return;
    }

    await new Promise<void>((resolve, reject) => {
      const timeoutId = window.setTimeout(() => {
        window.clearInterval(checkClosedInterval);
        reject(new Error('Não foi possível concluir o login com Google. Tente novamente.'));
      }, 120000);

      const checkClosedInterval = window.setInterval(() => {
        if (!popup.closed) return;
        window.clearInterval(checkClosedInterval);
        window.clearTimeout(timeoutId);
        resolve();
      }, 500);
    });

    // Wait briefly for auth state sync after popup closes.
    let sessionData = (await supabase.auth.getSession()).data;
    if (!sessionData.session) {
      await new Promise((resolve) => window.setTimeout(resolve, 300));
      sessionData = (await supabase.auth.getSession()).data;
    }
    if (!sessionData.session) {
      throw new Error('Login com Google cancelado.');
    }
  };

  const signOut = async () => {
    const { error } = await supabase.auth.signOut();
    if (error) throw error;
    setProfile(null);
    if (typeof window !== 'undefined') {
      window.localStorage.removeItem(SESSION_LAST_ACTIVITY_AT_KEY);
    }
  };

  const resetPassword = async (email: string) => {
    const { error } = await supabase.auth.resetPasswordForEmail(email, {
      redirectTo: `${window.location.origin}/reset-password`,
    });
    if (error) throw error;
  };

  const updatePassword = async (password: string) => {
    const { error } = await supabase.auth.updateUser({ password });
    if (error) throw error;
  };

  const refreshProfile = async () => {
    if (!user?.id) {
      setProfile(null);
      return;
    }
    await fetchProfile(user.id);
  };

  return (
    <AuthContext.Provider
      value={{
        session,
        user,
        profile,
        loading,
        signUp,
        signIn,
        signInWithGoogle,
        signOut,
        resetPassword,
        updatePassword,
        refreshProfile,
        isAdmin: profile?.role === 'admin',
      }}
    >
      {children}
    </AuthContext.Provider>
  );
};
