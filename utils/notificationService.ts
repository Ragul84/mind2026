import * as Notifications from 'expo-notifications';
import * as Device from 'expo-device';
import { Platform } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { SupabaseService, supabase } from './supabaseService';
import UniversalNavigation from './universalNavigation';

// Notification handler configuration
Notifications.setNotificationHandler({
  handleNotification: async () => ({
    shouldShowAlert: true,
    shouldPlaySound: true,
    shouldSetBadge: true,
    shouldShowBanner: true,
    shouldShowList: true,
  } as any),
});

export interface NotificationTemplate {
  id: string;
  title: string;
  body: string;
  data?: any;
  trigger?: Notifications.NotificationTriggerInput;
}

type ScheduledTemplate = {
  title: string;
  body?: string;
};

const TOOL_DISCOVERY_MESSAGES = [
  {
    id: 'blueprint',
    route: '/learn/blueprint',
    messages: [
      { title: 'What’s the hardest topic on your list?', body: 'Turn it into a clear lesson blueprint and start reading.' },
      { title: 'Time to build a lesson.', body: 'Pick the topic you keep avoiding. We’ll break it down for you.' },
      { title: 'One difficult topic. One clear path.', body: 'Generate a lesson blueprint and understand it step by step.' },
    ],
  },
  {
    id: 'miga',
    route: '/(tabs)/mascot',
    messages: [
      { title: 'Ask MIGA the question you didn’t ask in class.', body: 'Learn it privately, step by step, in your language.' },
      { title: 'Stuck on something?', body: 'Talk to MIGA and learn it like you have a personal tutor.' },
      { title: 'MIGA is ready when your teacher isn’t.', body: 'Ask a doubt, solve a problem, or start learning a new topic.' },
    ],
  },
  {
    id: 'quiz-room',
    route: '/quiz-rooms/create',
    messages: [
      { title: 'Create a Quiz Room.', body: 'Invite your friends and find out who actually studied.' },
      { title: 'Your next group challenge starts here.', body: 'Create a room, share the code, and compete live.' },
      { title: 'Turn revision into a match.', body: 'Create a Quiz Room and challenge your study group.' },
    ],
  },
  {
    id: 'quiz-hub',
    route: '/quiz-hub',
    messages: [
      { title: '100,000+ questions are waiting.', body: 'Choose your exam, subject, and topic in Quiz Hub.' },
      { title: 'Practice exactly what your exam asks.', body: 'Open Quiz Hub and choose a topic from 100,000+ questions.' },
      { title: 'Don’t revise blindly.', body: 'Pick your exam topic and practise it inside Quiz Hub.' },
    ],
  },
] as const;

const NOTIFICATION_TEMPLATES = {
  dailyDose: [
    { title: 'Your Daily Dose just arrived.', body: 'Today\'s topic: {{lesson_name}}. {{current_affairs_count}} current affairs questions are ready inside.' },
    { title: 'Good morning.', body: 'Daily Dose is ready with today\'s topic: {{lesson_name}} and {{current_affairs_count}} current affairs questions.' },
    { title: 'New updates are in.', body: 'Catch today\'s topic: {{lesson_name}} with {{current_affairs_count}} current affairs questions inside Daily Dose.' },
    { title: 'While most people are still asleep...', body: 'Daily Dose is already ready for you. Topic: {{lesson_name}}. Current affairs: {{current_affairs_count}}.' },
    { title: 'Fresh Daily Dose.', body: 'Today\'s topic: {{lesson_name}}. {{current_affairs_count}} current affairs questions are waiting inside.' },
  ],
  afternoon: [
    { title: 'That topic from this morning still remembers you.', body: '{{lesson_name}}' },
    { title: 'Quick question.', body: 'Do you still remember today’s Daily Dose?' },
    { title: 'Miga checking in.', body: 'One minute revision?' },
    { title: 'Today’s lesson is getting lonely.', body: '{{lesson_name}}' },
    { title: '⚡ A quick review now makes tonight easier.', body: '{{lesson_name}}' },
    {
      title: 'Remember this morning’s topic?',
      body: '{{lesson_name}}\nLet’s see how much you still remember.',
    },
  ],
  evening: [
    { title: 'Think you’re smarter than this morning?', body: 'Quick Sprint is ready.' },
    { title: 'Time for a rematch against today’s topic.', body: '{{lesson_name}}' },
    { title: '⚡ Evening Challenge is ready.', body: 'Open Quick Sprint when you’re ready.' },
    { title: 'Let’s see what survived after a full day.', body: '{{lesson_name}}' },
    { title: 'Quick Sprint is live.', body: 'Can today’s lesson beat you twice?' },
  ],
  night: [
    { title: 'Miga is still waiting.', body: 'Your streak needs one quick session.' },
    { title: 'Your streak isn’t finished yet.', body: 'Finish today with one quick session.' },
    { title: 'Today’s chapter is complete.', body: 'Your streak isn’t.' },
    { title: '⏰ Last call.', body: 'Future you will thank you.' },
    { title: 'Don’t let today’s progress disappear.', body: 'Keep the streak alive.' },
    { title: 'Just one quick session.', body: 'Keep the streak alive.' },
  ],
  
  // Streak notifications
  streak: [
    {
      title: "🔥 Your streak is on fire!",
      body: "{{days}} days of consistent prep! Keep going, success is built daily 💪"
    },
    {
      title: "⚡ {{days}}-Day Consistency Power!",
      body: "You're building an unbeatable daily learning routine. Keep it up!"
    },
  ],
  
  // Missed quiz / Inactivity
  missed: [
    {
      title: "🤔 Thiru the Mascot misses you...",
      body: "Your daily study guide is looking lonely. Let's do a quick 2-minute review!"
    },
    {
      title: "📈 Don't let your consistency slip!",
      body: "Even a small 2-minute study session keeps your exam prep active. Come back now!"
    },
  ],
  
  // Achievement unlocked
  achievement: [
    {
      title: "🏆 New Achievement Unlocked!",
      body: "You earned the '{{achievement}}' badge. Outstanding progress! 🌟"
    },
    {
      title: "🎉 Consistency Milestone Reached!",
      body: "You unlocked '{{achievement}}'. Your daily effort is paying off!"
    },
  ],
  
  // Battle invites (Knowledge Heist or similar)
  battle: [
    {
      title: "⚔️ Peer Revision Challenge!",
      body: "{{opponent}} challenged you to a quick revision battle. Show your speed!"
    },
    {
      title: "🥊 Revision Battle Alert!",
      body: "Test your skills against {{opponent}} in a quick 10-question sprint!"
    },
  ],
};

class NotificationService {
  private static instance: NotificationService;
  private notificationListener: any;
  private responseListener: any;

  static getInstance(): NotificationService {
    if (!NotificationService.instance) {
      NotificationService.instance = new NotificationService();
    }
    return NotificationService.instance;
  }

  async initialize() {
    if (Platform.OS === 'android') {
      await Notifications.setNotificationChannelAsync('default', {
        name: 'MindGains',
        importance: Notifications.AndroidImportance.MAX,
        vibrationPattern: [0, 250, 250, 250],
        lightColor: '#8B5CF6',
      });
    }

    // Add notification listeners
    this.notificationListener = Notifications.addNotificationReceivedListener(notification => {
    });

    this.responseListener = Notifications.addNotificationResponseReceivedListener(response => {
      this.handleNotificationResponse(response);
    });
  }

  async requestPermissions(): Promise<boolean> {
    if (!Device.isDevice) {
      console.log('Push notifications only work on physical devices');
      return false;
    }

    const { status: existingStatus } = await Notifications.getPermissionsAsync();
    let finalStatus = existingStatus;

    if (existingStatus !== 'granted') {
      const { status } = await Notifications.requestPermissionsAsync();
      finalStatus = status;
    }

    if (finalStatus !== 'granted') {
      console.log('Failed to get push token for push notification!');
      return false;
    }

    return true;
  }

  async registerForPushNotifications(): Promise<string | null> {
    const hasPermission = await this.requestPermissions();
    if (!hasPermission) return null;

    try {
      // Only try to get push token if not in Expo Go
      if (!__DEV__ || Platform.OS === 'web') {
        const token = await Notifications.getExpoPushTokenAsync();

        // Save token to backend
        const user = await SupabaseService.getCurrentUser();
        if (user) {
          await this.savePushToken(user.id, token.data);
        }
        
        return token.data;
      } else {
        return null;
      }
    } catch (error) {
      console.error('Error getting push token:', error);
      return null;
    }
  }

  private async savePushToken(userId: string, token: string) {
    try {
      const { error } = await supabase
        .from('user_push_tokens')
        .upsert({
          user_id: userId,
          push_token: token,
          platform: Platform.OS,
          updated_at: new Date().toISOString(),
        }, { onConflict: 'push_token' });

      if (error) throw error;
    } catch (error) {
      console.error('Error saving push token:', error);
    }
  }

  private async getScheduleContext() {
    const fallback = { lessonName: 'Today’s lesson', currentAffairsCount: 0, streakCount: 0 };
    try {
      const user = await SupabaseService.getCurrentUser();
      if (!user) return fallback;

      const todayKey = new Intl.DateTimeFormat('en-CA', {
        timeZone: 'Asia/Kolkata',
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
      }).format(new Date());

      const [{ data: protocol }, { data: stats }, { data: currentAffairs }] = await Promise.all([
        supabase
          .from('user_protocols')
          .select('track_id, current_day_number')
          .eq('user_id', user.id)
          .maybeSingle(),
        supabase
          .from('user_stats')
          .select('streak_days')
          .eq('user_id', user.id)
          .maybeSingle(),
        supabase
          .from('current_affairs_daily_sets')
          .select('question_count')
          .eq('date_key', todayKey)
          .maybeSingle(),
      ]);

      let lessonName = fallback.lessonName;
      if (protocol?.track_id && protocol?.current_day_number) {
        const { data: mission } = await supabase
          .from('master_content_vault')
          .select('topic_title')
          .eq('track_id', protocol.track_id)
          .eq('day_number', protocol.current_day_number)
          .maybeSingle();
        lessonName = String(mission?.topic_title || fallback.lessonName)
          .replace(/\s*\((?:Days?|Day)\s+\d+\s*(?:[-–]\s*\d+)?\)\s*$/i, '')
          .trim();
      }

      return {
        lessonName,
        currentAffairsCount: Number(currentAffairs?.question_count || 0),
        streakCount: Number(stats?.streak_days || 0),
      };
    } catch (error) {
      console.warn('Failed to load notification context:', error);
      return fallback;
    }
  }

  private fillTemplate(template: ScheduledTemplate, context: { lessonName: string; currentAffairsCount: number; streakCount: number }) {
    return {
      title: template.title
        .replaceAll('{{lesson_name}}', context.lessonName)
        .replaceAll('{{current_affairs_count}}', String(context.currentAffairsCount))
        .replaceAll('{{streak_count}}', String(context.streakCount)),
      body: String(template.body || '')
        .replaceAll('{{lesson_name}}', context.lessonName)
        .replaceAll('{{current_affairs_count}}', String(context.currentAffairsCount))
        .replaceAll('{{streak_count}}', String(context.streakCount)),
    };
  }

  // Schedule daily notifications
  async scheduleDailyNotifications(isTodayComplete: boolean = false) {
    try {
      // Cancel existing scheduled notifications
      await Notifications.cancelAllScheduledNotificationsAsync();

      // Read settings from AsyncStorage
      const savedStreak = await AsyncStorage.getItem('settings_streak_protector');
      const streakActive = savedStreak !== null ? savedStreak === 'true' : true;
      const { lessonName, currentAffairsCount, streakCount } = await this.getScheduleContext();

      const hours = [
        // Single morning reminder: Daily Dose now carries the current-affairs content too.
        { key: 'dailyDose' as const, h: 9, m: 0 },
        { key: 'afternoon' as const, h: 13, m: 30 },
        { key: 'toolDiscovery' as const, h: 16, m: 30 },
        { key: 'evening' as const, h: 18, m: 30 },
        { key: 'night' as const, h: 20, m: 30 },
      ];

      const now = new Date();

      // Schedule for the next 5 days
      for (let dayOffset = 0; dayOffset < 5; dayOffset++) {
        const targetDate = new Date();
        targetDate.setDate(now.getDate() + dayOffset);

        for (const slot of hours) {
          if (dayOffset === 0 && isTodayComplete && slot.key !== 'toolDiscovery') {
            continue;
          }

          // Skip if user deactivated this notification channel
          if (slot.key === 'night' && !streakActive) continue;

          const slotTime = new Date(targetDate);
          slotTime.setHours(slot.h, slot.m, 0, 0);

          // If it's today, only schedule if the slot time is in the future
          if (dayOffset === 0 && slotTime <= now) {
            continue;
          }

          let message: ScheduledTemplate;
          let notificationData: Record<string, any> = { type: slot.key };

          if (slot.key === 'toolDiscovery') {
            const dayNumber = Math.floor(slotTime.getTime() / 86400000);
            const tool = TOOL_DISCOVERY_MESSAGES[dayNumber % TOOL_DISCOVERY_MESSAGES.length];
            message = tool.messages[dayNumber % tool.messages.length];
            notificationData = {
              type: 'tool_discovery',
              tool: tool.id,
              route: tool.route,
            };
          } else {
            const template: ScheduledTemplate = (
              slot.key === 'night' && streakCount > 0 && Math.random() < 0.35
            )
              ? {
                  title: `🔥 ${streakCount}-day streak.`,
                  body: 'Let’s not make tomorrow awkward.',
                }
              : this.getRandomTemplate(slot.key);
            message = this.fillTemplate(template, { lessonName, currentAffairsCount, streakCount });
          }
          await Notifications.scheduleNotificationAsync({
            content: {
              title: message.title,
              body: message.body,
              sound: 'default',
              badge: 1,
              data: notificationData,
            },
            trigger: {
              type: Notifications.SchedulableTriggerInputTypes.DATE,
              date: slotTime,
            },
          });
        }
      }
      console.log(`Daily notifications scheduled (Today Complete: ${isTodayComplete}, Streak Protection: ${streakActive}, Current Affairs: ${currentAffairsCount})`);
    } catch (err) {
      console.error('Failed to schedule daily notifications:', err);
    }
  }

  private getRandomTemplate(category: keyof typeof NOTIFICATION_TEMPLATES) {
    const templates = NOTIFICATION_TEMPLATES[category];
    return templates[Math.floor(Math.random() * templates.length)];
  }

  async scheduleNotification(
    template: { title: string; body: string },
    trigger: { hour: number; minute: number; repeats: boolean }
  ) {
    await Notifications.scheduleNotificationAsync({
      content: {
        title: template.title,
        body: template.body,
        sound: 'default',
        badge: 1,
      },
      trigger: {
        type: Notifications.SchedulableTriggerInputTypes.DAILY,
        hour: trigger.hour,
        minute: trigger.minute,
      },
    });
  }

  async cancelRemainingStudyRemindersForToday() {
    try {
      const now = new Date();
      const scheduled = await Notifications.getAllScheduledNotificationsAsync();
      await Promise.all(scheduled.map(async (request) => {
        const type = request.content.data?.type;
        const triggerDate = (request.trigger as any)?.date;
        if (!['dailyDose', 'afternoon', 'evening', 'night'].includes(String(type)) || !triggerDate) return;
        const date = new Date(triggerDate);
        const isToday = (
          date.getFullYear() === now.getFullYear() &&
          date.getMonth() === now.getMonth() &&
          date.getDate() === now.getDate()
        );
        if (isToday && date > now) {
          await Notifications.cancelScheduledNotificationAsync(request.identifier);
        }
      }));
    } catch (error) {
      console.error('Failed to cancel today’s study reminders:', error);
    }
  }

  // Send immediate notifications
  async sendStreakNotification(days: number) {
    const template = this.getRandomTemplate('streak');
    await Notifications.scheduleNotificationAsync({
      content: {
        title: template.title.replace('{{days}}', days.toString()),
        body: template.body.replace('{{days}}', days.toString()),
        sound: 'default',
      },
      trigger: null,
    });
  }

  async sendMissedQuizNotification() {
    const template = this.getRandomTemplate('missed');
    await Notifications.scheduleNotificationAsync({
      content: {
        title: template.title,
        body: template.body,
        sound: 'default',
      },
      trigger: null,
    });
  }

  async sendAchievementNotification(achievementName: string) {
    const template = this.getRandomTemplate('achievement');
    await Notifications.scheduleNotificationAsync({
      content: {
        title: template.title.replace('{{achievement}}', achievementName),
        body: template.body.replace('{{achievement}}', achievementName),
        sound: 'default',
      },
      trigger: null,
    });
  }

  async sendBattleInviteNotification(opponentName: string) {
    const template = this.getRandomTemplate('battle');
    await Notifications.scheduleNotificationAsync({
      content: {
        title: template.title.replace('{{opponent}}', opponentName),
        body: template.body.replace('{{opponent}}', opponentName),
        sound: 'default',
        data: { type: 'battle_invite', opponent: opponentName },
      },
      trigger: null,
    });
  }

  private handleNotificationResponse(response: Notifications.NotificationResponse) {
    const { notification } = response;
    const data = notification.request.content.data;

    if (data?.type === 'battle_invite') {
      UniversalNavigation.navigateTo('/(tabs)/arena');
    } else if (data?.type === 'current_affairs') {
      UniversalNavigation.navigateTo('/daily-mission');
    } else if (data?.type === 'dailyDose') {
      UniversalNavigation.navigateTo('/daily-mission');
    } else if (data?.type === 'tool_discovery' && typeof data?.route === 'string') {
      UniversalNavigation.navigateTo(data.route);
    } else if (data?.type === 'evening') {
      // Launch Quick Sprint directly with 20 questions
      UniversalNavigation.navigateTo('/quiz/reader?mode=quick-sprint&questionCount=20');
    } else if (data?.type === 'night') {
      UniversalNavigation.navigateTo('/(tabs)/streak');
    } else if (data?.type === 'afternoon') {
      UniversalNavigation.navigateTo('/daily-mission');
    } else if (data?.type === 'daily_quiz') {
      UniversalNavigation.navigateTo('/daily-mission');
    }
  }

  cleanup() {
    if (this.notificationListener) {
      this.notificationListener.remove();
    }
    if (this.responseListener) {
      this.responseListener.remove();
    }
  }
}

export default NotificationService.getInstance();
