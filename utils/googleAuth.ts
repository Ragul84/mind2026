// Google OAuth for MindGains — Supabase, native-safe.
//
// Why this exists: on a real device `supabase.auth.signInWithOAuth({provider})`
// alone does NOT open a browser, so nothing happens. We ask Supabase for the
// auth URL (skipBrowserRedirect), open it with expo-web-browser, then parse the
// redirect back into a Supabase session (implicit tokens OR PKCE code).
//
// The Google client secret lives ONLY in the Supabase dashboard, never here.

import * as WebBrowser from 'expo-web-browser';
import * as Linking from 'expo-linking';
import { supabase } from '@/utils/supabaseService';

// Lets the auth session close cleanly if the app was backgrounded mid-flow.
WebBrowser.maybeCompleteAuthSession();

export type GoogleSignInResult = { ok: boolean; cancelled?: boolean; error?: string };

function parseParams(url: string): URLSearchParams {
  // Tokens can arrive in the fragment (#access_token=...) or the query (?code=...).
  const hash = url.includes('#') ? url.split('#')[1] : '';
  const query = url.includes('?') ? url.split('?')[1].split('#')[0] : '';
  return new URLSearchParams(hash || query);
}

export async function signInWithGoogle(): Promise<GoogleSignInResult> {
  try {
    // exp://…/--/auth-callback in Expo Go, mindgains://auth-callback in a build.
    const redirectTo = Linking.createURL('auth-callback');

    const { data, error } = await supabase.auth.signInWithOAuth({
      provider: 'google',
      options: { redirectTo, skipBrowserRedirect: true },
    });
    if (error) return { ok: false, error: error.message };
    if (!data?.url) return { ok: false, error: 'Could not start Google sign-in.' };

    const result = await WebBrowser.openAuthSessionAsync(data.url, redirectTo);
    if (result.type === 'cancel' || result.type === 'dismiss') return { ok: false, cancelled: true };
    if (result.type !== 'success' || !result.url) return { ok: false, error: 'Sign-in was not completed.' };

    const params = parseParams(result.url);
    const access_token = params.get('access_token');
    const refresh_token = params.get('refresh_token');
    const code = params.get('code');
    const oauthError = params.get('error_description') || params.get('error');
    if (oauthError) return { ok: false, error: oauthError };

    if (access_token && refresh_token) {
      const { error: sErr } = await supabase.auth.setSession({ access_token, refresh_token });
      if (sErr) return { ok: false, error: sErr.message };
      return { ok: true };
    }
    if (code) {
      const { error: cErr } = await supabase.auth.exchangeCodeForSession(code);
      if (cErr) return { ok: false, error: cErr.message };
      return { ok: true };
    }
    return { ok: false, error: 'No session was returned from Google.' };
  } catch (e: any) {
    return { ok: false, error: e?.message || 'Google sign-in failed.' };
  }
}
