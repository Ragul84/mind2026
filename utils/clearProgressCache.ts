// 🧹 Clear Progress Cache - Reset AsyncStorage progress data
import AsyncStorage from '@react-native-async-storage/async-storage';

export class ClearProgressCache {
  /**
   * Clear all learning progress from AsyncStorage
   */
  static async clearAllProgress(): Promise<void> {
    try {
      // Get all keys from AsyncStorage
      const allKeys = await AsyncStorage.getAllKeys();
      
      // Find all learning progress keys
      const progressKeys = allKeys.filter(key => 
        key.startsWith('learning_progress_') || 
        key.startsWith('daily_progress_') ||
        key.includes('streak') ||
        key.includes('xp') ||
        key.includes('lesson') ||
        key.includes('progress')
      );
      
      // Remove all progress keys
      if (progressKeys.length > 0) {
        await AsyncStorage.multiRemove(progressKeys);
      }
    } catch (error) {
      console.error('❌ Error clearing progress cache:', error);
    }
  }

  /**
   * Clear progress for a specific user
   */
  static async clearUserProgress(userId: string): Promise<void> {
    try {
      const keysToRemove = [
        `learning_progress_${userId}`,
        `daily_progress_${userId}`,
        `streak_${userId}`,
        `xp_${userId}`,
      ];
      
      await AsyncStorage.multiRemove(keysToRemove);
    } catch (error) {
      console.error('❌ Error clearing user progress:', error);
    }
  }

  /**
   * Reset to lesson 1 for a specific user
   */
  static async resetToLesson1(userId: string = 'guest'): Promise<void> {
    try {
      // Clear existing progress
      await this.clearUserProgress(userId);
      
      // Set fresh progress starting from lesson 1
      const freshProgress = {
        completedLessons: [],
        currentUnit: 1,
        currentLesson: 'lesson-1', // First lesson
        totalXP: 0,
        streak: 0,
        dailyDoseCompleted: false,
        dailySnackCompleted: false,
        lastSeen: new Date().toDateString(),
        unlockedUnits: [1],
      };
      
      const progressKey = `learning_progress_${userId}`;
      await AsyncStorage.setItem(progressKey, JSON.stringify(freshProgress));
    } catch (error) {
      console.error('❌ Error resetting to lesson 1:', error);
    }
  }
}