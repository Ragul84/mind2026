import AsyncStorage from '@react-native-async-storage/async-storage';
import { supabase } from '@/utils/supabaseService';

/**
 * Study Lab persistence. Sessions (and their generated artifacts) live in the
 * `study_lab_sessions` Supabase table so they sync across devices and survive a
 * reinstall. A local AsyncStorage copy is kept purely as an offline/instant-paint
 * CACHE — the cloud is the source of truth. Cloud writes are debounced and only
 * send sessions that actually changed, so the frequent progress-bar updates during
 * a generation don't hammer the network.
 */

const CACHE_PREFIX = 'study_lab_sessions_v1_';
const cacheKey = (uid: string) => `${CACHE_PREFIX}${uid}`;

type AnySession = { id: string; title?: string; updatedAt?: number; [k: string]: any };

// JSON of the last version we successfully pushed per session id — lets us skip
// unchanged rows on the next save.
const lastSynced = new Map<string, string>();

let flushTimer: ReturnType<typeof setTimeout> | null = null;
let pendingQueue = new Map<string, AnySession>();
let pendingUserId = '';

async function flushNow() {
  flushTimer = null;
  const uid = pendingUserId;
  if (!uid || uid === 'guest' || pendingQueue.size === 0) return;
  const batch = Array.from(pendingQueue.values());
  pendingQueue = new Map();
  const rows = batch.map((s) => ({
    id: s.id,
    user_id: uid,
    title: (s.title && String(s.title).trim()) || 'Untitled',
    session: s,
    updated_at: new Date(s.updatedAt || Date.now()).toISOString(),
  }));
  try {
    const { error } = await supabase.from('study_lab_sessions').upsert(rows, { onConflict: 'id' });
    if (error) throw error;
    for (const r of rows) lastSynced.set(r.id, JSON.stringify(r.session));
  } catch (e) {
    // Re-queue so a later save (or the next flush) retries; never lose data.
    for (const s of batch) pendingQueue.set(s.id, s);
    if (!flushTimer) flushTimer = setTimeout(flushNow, 4000);
    console.warn('[studyLabStore] cloud upsert failed (queued for retry)', e);
  }
}

export const studyLabStore = {
  /**
   * Load a user's sessions. Cloud is authoritative; on any cloud error we fall back
   * to the local cache so the tab still works offline. Any session that exists only
   * locally (e.g. created before this migration, or made while offline) is pushed up.
   */
  async load(userId?: string | null): Promise<AnySession[]> {
    const uid = userId || 'guest';

    let local: AnySession[] = [];
    try {
      const raw = await AsyncStorage.getItem(cacheKey(uid));
      const parsed = raw ? JSON.parse(raw) : [];
      if (Array.isArray(parsed)) local = parsed;
    } catch { /* ignore bad cache */ }

    if (uid === 'guest') return local; // no auth → local only

    try {
      const { data, error } = await supabase
        .from('study_lab_sessions')
        .select('session')
        .eq('user_id', uid)
        .order('updated_at', { ascending: false });
      if (error) throw error;

      const cloud = (data || []).map((r: any) => r.session).filter(Boolean) as AnySession[];
      const cloudIds = new Set(cloud.map((s) => s.id));
      for (const s of cloud) lastSynced.set(s.id, JSON.stringify(s));

      const localOnly = local.filter((s) => s && s.id && !cloudIds.has(s.id));
      let merged = cloud;
      if (localOnly.length) {
        // One-time (or offline-recovery) migration: keep local-only sessions and
        // push them to the cloud.
        merged = [...localOnly, ...cloud].sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0));
        this.save(uid, merged);
      } else {
        AsyncStorage.setItem(cacheKey(uid), JSON.stringify(cloud)).catch(() => {});
      }
      return merged;
    } catch (e) {
      console.warn('[studyLabStore] cloud load failed; using local cache', e);
      return local;
    }
  },

  /**
   * Persist the full sessions array. The local cache is written immediately; changed
   * sessions are upserted to the cloud on a short debounce.
   */
  save(userId: string | null | undefined, sessions: AnySession[]) {
    const uid = userId || 'guest';
    AsyncStorage.setItem(cacheKey(uid), JSON.stringify(sessions)).catch(() => {});
    if (uid === 'guest') return;

    pendingUserId = uid;
    for (const s of sessions) {
      if (!s || !s.id) continue;
      const snap = JSON.stringify(s);
      if (lastSynced.get(s.id) !== snap) pendingQueue.set(s.id, s);
    }
    if (pendingQueue.size > 0 && !flushTimer) flushTimer = setTimeout(flushNow, 1200);
  },

  /** Delete one session from cloud + local cache. */
  async remove(userId: string | null | undefined, id: string, remaining: AnySession[]) {
    const uid = userId || 'guest';
    pendingQueue.delete(id);
    lastSynced.delete(id);
    AsyncStorage.setItem(cacheKey(uid), JSON.stringify(remaining)).catch(() => {});
    if (uid === 'guest') return;
    try {
      const { error } = await supabase.from('study_lab_sessions').delete().eq('user_id', uid).eq('id', id);
      if (error) throw error;
    } catch (e) {
      console.warn('[studyLabStore] cloud delete failed', e);
    }
  },
};
