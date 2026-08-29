import { router } from 'expo-router';
import { type AIFeatureUsage } from '@/services/aiUsageService';
import { showBrandAlert } from '@/components/ui/BrandAlert';

/** "4h 20m" / "45m", or null when unknown or already past. */
export function formatResetIn(resetAt: string | null | undefined): string | null {
  if (!resetAt) return null;
  const ms = new Date(resetAt).getTime() - Date.now();
  if (!Number.isFinite(ms) || ms <= 0) return null;
  const mins = Math.ceil(ms / 60000);
  if (mins < 60) return `${mins}m`;
  const h = Math.floor(mins / 60);
  const m = mins % 60;
  return m ? `${h}h ${m}m` : `${h}h`;
}

export const showAILimitPrompt = (usageOrMessage: AIFeatureUsage | string) => {
  let message: string;

  if (typeof usageOrMessage === 'string') {
    message = usageOrMessage;
  } else {
    const usage = usageOrMessage;
    if (usage.limit <= 0) {
      // Not available on this tier at all (e.g. free podcasts).
      message = `${usage.label} isn't included on the free plan. Upgrade to unlock it.`;
    } else {
      const resetIn = formatResetIn(usage.resetAt);
      const back = resetIn ? ` Back in ${resetIn}.` : ' Resets tomorrow.';
      message = `You're out of ${usage.label.toLowerCase()} for today.${back}`;
    }
  }

  showBrandAlert({
    title: 'Daily limit reached',
    message,
    icon: 'time-outline',
    buttons: [
      { text: 'Not now', style: 'cancel' },
      { text: 'Upgrade', style: 'default', onPress: () => router.push('/subscription' as any) },
    ],
  });
};

export default formatResetIn;
