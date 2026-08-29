import { useEffect, useState } from 'react';
import { User } from '@supabase/supabase-js';
import { supabase } from '@/utils/supabaseService';
import NotificationService from '@/utils/notificationService';
import { getUserProtocol } from '@/utils/protocolService';

let notificationUserConfigured: string | null = null;

export function useAuth() {
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);
  const [initialized, setInitialized] = useState(false);

  useEffect(() => {
    const configureNotifications = async (activeUser: User) => {
      if (notificationUserConfigured === activeUser.id) return;
      notificationUserConfigured = activeUser.id;

      await NotificationService.registerForPushNotifications();
      try {
        const protocol = await getUserProtocol(activeUser.id);
        await NotificationService.scheduleDailyNotifications(
          protocol ? (protocol.progress_phase ?? 0) >= 5 : false
        );
      } catch {
        await NotificationService.scheduleDailyNotifications(false);
      }
    };

    const getInitialSession = async () => {
      try {
        const { data: { session }, error } = await supabase.auth.getSession();
        if (error) {
          console.error('Error getting session:', error);
        } else {
          setUser(session?.user ?? null);
          if (session?.user) {
            await configureNotifications(session.user);
          }
        }
      } catch (error) {
        console.error('Session error:', error);
      } finally {
        setLoading(false);
        setInitialized(true);
      }
    };

    getInitialSession();

    const { data: { subscription } } = supabase.auth.onAuthStateChange(
      async (_event, session) => {
        setUser(session?.user ?? null);
        if (session?.user) {
          await configureNotifications(session.user);
        } else {
          notificationUserConfigured = null;
        }
        setLoading(false);
        setInitialized(true);
      }
    );

    return () => subscription.unsubscribe();
  }, []);

  const signOut = async () => {
    try {
      const { error } = await supabase.auth.signOut();
      if (error) throw error;
    } catch (error) {
      console.error('Error signing out:', error);
      throw error;
    }
  };

  return {
    user,
    loading,
    initialized,
    isAuthenticated: !!user,
    signOut,
  };
}
