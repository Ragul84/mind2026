import { supabase } from '@/utils/supabaseService';
import type { SubscriptionTier } from './rewardService';

export type AIFeature =
  | 'miga_message'
  | 'miga_call'
  | 'study_lab_generation'
  | 'study_lab_podcast'
  | 'blueprint_generate'
  | 'quiz_room_generate'
  | 'quiz_sprint_generate';

export type AIFeatureUsage = {
  feature: AIFeature;
  label: string;
  used: number;
  limit: number;
  remaining: number;
  tier: SubscriptionTier;
  allowed: boolean;
  /** Absolute instant the daily count resets (server-authoritative). */
  resetAt: string | null;
};

const FEATURE_LABELS: Record<AIFeature, string> = {
  miga_message: 'MIGA messages',
  miga_call: 'MIGA voice replies',
  study_lab_generation: 'Study Lab generations',
  study_lab_podcast: 'Podcast generations',
  blueprint_generate: 'Lesson blueprints',
  quiz_room_generate: 'AI quiz rooms',
  quiz_sprint_generate: 'Weak-area sprints',
};

// miga_call is counted per spoken reply. Voice is the app's only unbounded cost
// (TTS on every turn), so a daily cap keeps it in line with the plan price while
// still giving free users a real taste of the call experience.
const FEATURE_LIMITS: Record<SubscriptionTier, Record<AIFeature, number>> = {
  free: {
    miga_message: 20,
    miga_call: 10,
    study_lab_generation: 2,
    study_lab_podcast: 0,
    blueprint_generate: 2,
    quiz_room_generate: 1,
    quiz_sprint_generate: 3,
  },
  plus: {
    miga_message: 60,
    miga_call: 30,
    study_lab_generation: 20,
    study_lab_podcast: 1,
    blueprint_generate: 6,
    quiz_room_generate: 4,
    quiz_sprint_generate: 12,
  },
  pro: {
    miga_message: 150,
    miga_call: 200,
    study_lab_generation: 50,
    study_lab_podcast: 5,
    blueprint_generate: 15,
    quiz_room_generate: 10,
    quiz_sprint_generate: 25,
  },
};

function normalizeUsage(feature: AIFeature, data: any): AIFeatureUsage {
  const tier: SubscriptionTier = data?.tier === 'pro' ? 'pro' : data?.tier === 'plus' ? 'plus' : 'free';
  const fallbackLimit = FEATURE_LIMITS[tier][feature];
  const used = Math.max(0, Number(data?.used ?? 0) || 0);
  const limit = Math.max(0, Number(data?.limit ?? fallbackLimit) || 0);
  const remaining = Math.max(0, Number(data?.remaining ?? limit - used) || 0);
  return {
    feature,
    label: FEATURE_LABELS[feature],
    used,
    limit,
    remaining,
    tier,
    allowed: Boolean(data?.allowed ?? remaining > 0),
    resetAt: typeof data?.reset_at === 'string' ? data.reset_at : null,
  };
}

function blockedUsage(feature: AIFeature): AIFeatureUsage {
  return {
    feature,
    label: FEATURE_LABELS[feature],
    used: 0,
    limit: 0,
    remaining: 0,
    tier: 'free',
    allowed: false,
    resetAt: null,
  };
}

/**
 * Reads are cached so that re-entering a screen (tab switches, back navigation)
 * paints from memory instead of firing one edge-function call per feature every
 * time. Only a `consume` — or an explicit refresh — goes back to the server.
 */
const READ_TTL_MS = 60_000;

type CacheEntry = { usage: AIFeatureUsage; at: number };

export class AIUsageService {
  static limits = FEATURE_LIMITS;
  static labels = FEATURE_LABELS;

  private static cache = new Map<AIFeature, CacheEntry>();
  /** Concurrent reads of the same feature share one request instead of racing. */
  private static inflight = new Map<AIFeature, Promise<AIFeatureUsage>>();

  private static fresh(feature: AIFeature): AIFeatureUsage | null {
    const hit = this.cache.get(feature);
    if (!hit) return null;
    if (Date.now() - hit.at > READ_TTL_MS) return null;
    // A cached count is meaningless once the daily window has rolled over.
    if (hit.usage.resetAt && Date.parse(hit.usage.resetAt) <= Date.now()) return null;
    return hit.usage;
  }

  private static store(usage: AIFeatureUsage) {
    // Never cache a blocked/failed read — that would pin a spurious "0 left"
    // on screen for a minute after a transient network blip.
    if (usage.limit <= 0 && !usage.allowed) return;
    this.cache.set(usage.feature, { usage, at: Date.now() });
  }

  /** Drop cached reads so the next call hits the server. */
  static invalidate(feature?: AIFeature) {
    if (feature) this.cache.delete(feature);
    else this.cache.clear();
  }

  // Lightweight change feed so on-screen usage pills refresh the moment a feature
  // is consumed, instead of only on screen focus. Subscribers get the feature that
  // changed (or null for "unknown/refresh all").
  private static listeners = new Set<(feature: AIFeature | null) => void>();

  static subscribe(cb: (feature: AIFeature | null) => void): () => void {
    this.listeners.add(cb);
    return () => { this.listeners.delete(cb); };
  }

  private static emitChange(feature: AIFeature | null) {
    this.listeners.forEach((cb) => { try { cb(feature); } catch { /* ignore */ } });
  }

  /**
   * Display read. Serves from cache when warm — this is what the profile panel
   * and pills call on every focus, so it must not cost a round-trip each time.
   * Pass `force` to deliberately bypass the cache (e.g. pull-to-refresh).
   */
  static async getUsage(feature: AIFeature, opts?: { force?: boolean }): Promise<AIFeatureUsage> {
    if (!opts?.force) {
      const cached = this.fresh(feature);
      if (cached) return cached;
    }

    const pending = this.inflight.get(feature);
    if (pending && !opts?.force) return pending;

    const req = this.callGate(feature, false).finally(() => {
      if (this.inflight.get(feature) === req) this.inflight.delete(feature);
    });
    this.inflight.set(feature, req);
    return req;
  }

  static async getBatchUsage(_tier: SubscriptionTier): Promise<AIFeatureUsage[]> {
    try {
      const { data: authData } = await supabase.auth.getUser();
      if (!authData.user) {
        return (Object.keys(FEATURE_LABELS) as AIFeature[]).map((f) => blockedUsage(f));
      }

      return await Promise.all(
        (Object.keys(FEATURE_LABELS) as AIFeature[]).map((feature) => this.getUsage(feature))
      );
    } catch (error) {
      console.warn('[AIUsageService] getBatchUsage exception', error);
      return (Object.keys(FEATURE_LABELS) as AIFeature[]).map((f) => blockedUsage(f));
    }
  }

  /** Gate decision before spending a credit — always server-fresh, never cached. */
  static async check(feature: AIFeature): Promise<AIFeatureUsage> {
    return this.callGate(feature, false);
  }

  static async consume(feature: AIFeature): Promise<AIFeatureUsage> {
    return this.callGate(feature, true);
  }

  static limitMessage(usage: AIFeatureUsage) {
    if (usage.limit <= 0 && !usage.allowed) {
      return `${usage.label}: daily free limit reached. Upgrade to continue.`;
    }
    return `${usage.label}: ${usage.used}/${usage.limit} used today. Resets tomorrow.`;
  }

  private static async callGate(feature: AIFeature, consume: boolean): Promise<AIFeatureUsage> {
    try {
      const { data: authData } = await supabase.auth.getUser();
      if (!authData.user) {
        return blockedUsage(feature);
      }

      const { data, error } = await supabase.functions.invoke('ai-usage-gate', {
        body: { feature, consume },
      });

      if (error || !data?.success) {
        console.warn('[AIUsageService] AI usage gate failed', error || data?.error);
        return blockedUsage(feature);
      }

      const usage = normalizeUsage(feature, data.usage);
      this.store(usage);
      // A successful consume changed the remaining count: tell the pills. They
      // now read the just-cached value rather than re-hitting the gate.
      if (consume) this.emitChange(feature);
      return usage;
    } catch (error) {
      console.warn('[AIUsageService] AI usage gate exception', error);
      return blockedUsage(feature);
    }
  }
}
