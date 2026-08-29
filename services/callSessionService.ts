import { supabase } from '@/utils/supabase';

// MIGA call/voice sessions — cloud-synced, separate from text chat.
// A session is stored as a single snapshot row (transcript = JSONB), mirroring
// the app's local MascotSession object so the two stay in sync trivially.

export type CallLiveMessage = { id: string; role: 'user' | 'assistant'; text: string; timestamp: number };

export type CallSessionSnapshot = {
  id: string;
  mode: 'tutor' | 'story';
  title: string;
  createdAt: string;
  updatedAt: string;
  lastMessage?: string;
  languageCode: string;
  languageLabel: string;
  status: 'active' | 'paused' | 'completed';
  topic?: string;
  storyId?: string | null;
  messageCount: number;
  transcript: CallLiveMessage[];
};

const COLS =
  'id, mode, title, last_message, language_code, language_label, status, topic, story_id, message_count, transcript, created_at, updated_at, last_message_at';

async function uid(): Promise<string | null> {
  const { data } = await supabase.auth.getUser();
  return data.user?.id ?? null;
}

const fromRow = (r: any): CallSessionSnapshot => ({
  id: r.id,
  mode: (r.mode === 'story' ? 'story' : 'tutor'),
  title: r.title || '',
  createdAt: r.created_at,
  updatedAt: r.updated_at,
  lastMessage: r.last_message ?? undefined,
  languageCode: r.language_code || 'en-IN',
  languageLabel: r.language_label || 'English',
  status: (r.status as CallSessionSnapshot['status']) || 'paused',
  topic: r.topic ?? undefined,
  storyId: r.story_id ?? null,
  messageCount: typeof r.message_count === 'number' ? r.message_count : 0,
  transcript: Array.isArray(r.transcript) ? (r.transcript as CallLiveMessage[]) : [],
});

export const CallSessionService = {
  // Most-recent sessions for the signed-in user.
  async list(limit = 30): Promise<CallSessionSnapshot[]> {
    try {
      const { data, error } = await supabase
        .from('miga_call_sessions')
        .select(COLS)
        .order('last_message_at', { ascending: false })
        .limit(limit);
      if (error) return [];
      return (data || []).map(fromRow);
    } catch {
      return [];
    }
  },

  // Upsert a single session snapshot. Fire-and-forget from the UI.
  async upsert(session: CallSessionSnapshot): Promise<void> {
    try {
      const user_id = await uid();
      if (!user_id) return;
      const now = new Date().toISOString();
      await supabase.from('miga_call_sessions').upsert(
        {
          id: session.id,
          user_id,
          mode: session.mode,
          title: session.title || '',
          last_message: session.lastMessage ?? null,
          language_code: session.languageCode || null,
          language_label: session.languageLabel || null,
          status: session.status || 'paused',
          topic: session.topic ?? null,
          story_id: session.storyId ?? null,
          message_count: session.messageCount || 0,
          transcript: session.transcript || [],
          updated_at: session.updatedAt || now,
          last_message_at: session.updatedAt || now,
        },
        { onConflict: 'id' },
      );
    } catch {
      // non-critical: local AsyncStorage copy still holds the session
    }
  },

  async remove(id: string): Promise<void> {
    try {
      await supabase.from('miga_call_sessions').delete().eq('id', id);
    } catch {}
  },
};
