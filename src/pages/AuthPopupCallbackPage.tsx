import { useEffect } from 'react';
import { supabase } from '@/integrations/supabase/client';

const AuthPopupCallbackPage = () => {
  useEffect(() => {
    let closed = false;

    const closeWindow = () => {
      if (closed) return;
      closed = true;
      window.close();
    };

    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((event, session) => {
      if (event === 'SIGNED_IN' && session) {
        closeWindow();
      }
    });

    void supabase.auth.getSession().then(({ data }) => {
      if (data.session) {
        closeWindow();
      }
    });

    return () => {
      subscription.unsubscribe();
    };
  }, []);

  return (
    <div className="flex min-h-screen items-center justify-center bg-background p-4">
      <p className="text-sm text-muted-foreground">Concluindo login...</p>
    </div>
  );
};

export default AuthPopupCallbackPage;
