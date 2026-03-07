import React, { createContext, useContext, useEffect, useState } from 'react';
import { AuthChangeEvent, Session, User } from '@supabase/supabase-js';
import { supabase } from '@/integrations/supabase/client';

const GOOGLE_GSI_SCRIPT_URL = 'https://accounts.google.com/gsi/client';
let gsiScriptLoadingPromise: Promise<void> | null = null;

interface GoogleCredentialResponse {
  credential?: string;
}

interface GooglePromptNotification {
  isNotDisplayed?: () => boolean;
  isSkippedMoment?: () => boolean;
  isDismissedMoment?: () => boolean;
}

interface GoogleIdApi {
  initialize: (params: {
    client_id: string;
    callback: (response: GoogleCredentialResponse) => void;
    ux_mode?: 'popup' | 'redirect';
    auto_select?: boolean;
    cancel_on_tap_outside?: boolean;
  }) => void;
  prompt: (listener?: (notification: GooglePromptNotification) => void) => void;
}

interface GoogleAccountsApi {
  accounts: {
    id: GoogleIdApi;
  };
}

type GoogleSignInResult =
  | { kind: 'id_token'; token: string }
  | { kind: 'fallback_redirect' };

declare global {
  interface Window {
    google?: GoogleAccountsApi;
  }
}

const loadGoogleIdentityScript = async () => {
  if (window.google?.accounts?.id) return;
  if (gsiScriptLoadingPromise) return gsiScriptLoadingPromise;

  gsiScriptLoadingPromise = new Promise<void>((resolve, reject) => {
    const script = document.createElement('script');
    script.src = GOOGLE_GSI_SCRIPT_URL;
    script.async = true;
    script.defer = true;
    script.onload = () => resolve();
    script.onerror = () => reject(new Error('Falha ao carregar Google Identity Services.'));
    document.head.appendChild(script);
  });

  return gsiScriptLoadingPromise;
};

type UserRole = 'student' | 'admin';

interface Profile {
  id: string;
  full_name: string | null;
  phone: string | null;
  avatar_url: string | null;
  role: UserRole;
}

interface AuthContextType {
  session: Session | null;
  user: User | null;
  profile: Profile | null;
  loading: boolean;
  signUp: (email: string, password: string, fullName: string) => Promise<void>;
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

  const fetchProfile = async (userId: string) => {
    const { data, error } = await supabase
      .from('profiles')
      .select('id, full_name, phone, avatar_url, role')
      .eq('id', userId)
      .maybeSingle();

    if (error) throw error;

    setProfile((data as Profile | null) ?? null);
  };

  useEffect(() => {
    let mounted = true;

    const syncAuthState = async (event: AuthChangeEvent, nextSession: Session | null) => {
      if (!mounted) return;

      setSession(nextSession);
      setUser(nextSession?.user ?? null);

      // Token refresh keeps the same user/profile, so avoid unnecessary loading flicker.
      if (event === 'TOKEN_REFRESHED') return;

      setLoading(true);
      setProfile(null);

      try {
        if (nextSession?.user) {
          await fetchProfile(nextSession.user.id);
        }
      } catch (error) {
        console.error('Failed to load profile', error);
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
    // Preload GSI script to preserve user gesture during click on mobile browsers.
    void loadGoogleIdentityScript().catch((error) => {
      console.warn('Could not preload Google Identity Services', error);
    });
  }, []);

  const signUp = async (email: string, password: string, fullName: string) => {
    const { error } = await supabase.auth.signUp({
      email,
      password,
      options: {
        data: { full_name: fullName },
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
    const googleClientId = import.meta.env.VITE_GOOGLE_CLIENT_ID as string | undefined;
    if (!googleClientId) {
      throw new Error('Configure VITE_GOOGLE_CLIENT_ID para habilitar login com Google.');
    }

    const signInWithOAuthRedirect = async () => {
      const { error } = await supabase.auth.signInWithOAuth({
        provider: 'google',
        options: {
          redirectTo: window.location.origin,
        },
      });
      if (error) throw error;
    };

    await loadGoogleIdentityScript();
    const gsi = window.google?.accounts?.id;
    if (!gsi) {
      await signInWithOAuthRedirect();
      return;
    }

    const signInResult = await new Promise<GoogleSignInResult>((resolve, reject) => {
      let finished = false;
      const timeoutId = window.setTimeout(() => {
        if (finished) return;
        finished = true;
        reject(new Error('Nao foi possivel concluir o login com Google. Tente novamente.'));
      }, 120000);

      gsi.initialize({
        client_id: googleClientId,
        ux_mode: 'popup',
        auto_select: false,
        cancel_on_tap_outside: true,
        callback: (response) => {
          if (finished) return;
          finished = true;
          window.clearTimeout(timeoutId);
          if (!response.credential) {
            reject(new Error('Nao foi possivel obter credencial do Google.'));
            return;
          }
          resolve({ kind: 'id_token', token: response.credential });
        },
      });

      gsi.prompt((notification) => {
        if (finished) return;
        if (notification?.isNotDisplayed?.()) {
          finished = true;
          window.clearTimeout(timeoutId);
          resolve({ kind: 'fallback_redirect' });
          return;
        }
        // Do not fail on "not displayed" or "skipped" moments because these
        // can happen before a successful credential callback in some browsers.
        if (notification?.isDismissedMoment?.()) {
          finished = true;
          window.clearTimeout(timeoutId);
          reject(new Error('Login com Google cancelado.'));
        }
      });
    });

    if (signInResult.kind === 'fallback_redirect') {
      await signInWithOAuthRedirect();
      return;
    }

    const { error } = await supabase.auth.signInWithIdToken({
      provider: 'google',
      token: signInResult.token,
    });
    if (error) throw error;
  };

  const signOut = async () => {
    const { error } = await supabase.auth.signOut();
    if (error) throw error;
    setProfile(null);
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
