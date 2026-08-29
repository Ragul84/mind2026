import { useState, useEffect, useCallback } from 'react';
import { useFocusEffect } from 'expo-router';
import { RewardService, UserStats } from '@/services/rewardService';

/**
 * Custom hook to manage user statistics and MG tokens
 * Provides real-time updates from the database
 * 
 * 🚨 CRITICAL: THIS IS WORKING CODE - DO NOT CHANGE!
 * ✅ Correctly fetches from user_profiles via RewardService.getUserStats()
 * ✅ Returns real data: totalMGTokens (4490), currentStreak (2), etc.
 */
export const useUserStats = () => {
  const [userStats, setUserStats] = useState<UserStats | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Load initial user stats
  useEffect(() => {
    loadUserStats();
  }, []);

  useFocusEffect(
    useCallback(() => {
      void loadUserStats();
    }, [])
  );

  const loadUserStats = async () => {
    try {
      setLoading(true);
      setError(null);
      // Cached (60s TTL) so switching tabs doesn't refetch/recompute XP,
      // streak, and coins on every focus — matches how AIUsageService's
      // cache already works. Every write path that changes these values
      // calls RewardService.invalidateStatsCache() to bust it immediately.
      const stats = await RewardService.getUserStatsCached();

      // Set the stats directly from database
      setUserStats(stats);
    } catch (err) {
      console.error('Error loading user stats:', err);
      setError('Failed to load user stats');
      // Don't set fake values - let it be null
    } finally {
      setLoading(false);
    }
  };

  // Refresh stats after reward claims — force-bypasses the cache since the
  // whole point of calling this is "I just changed something, get it fresh".
  const refreshStats = async () => {
    try {
      const stats = await RewardService.getUserStatsCached({ force: true });
      setUserStats(stats);
      return stats;
    } catch (err) {
      console.error('Error refreshing user stats:', err);
      return null;
    }
  };

  // 🎯 WORKING: Extract values from userStats
  // Get total MG tokens (using existing 'coins' column)
  const totalMGTokens = userStats?.coins || 0;

  // Get current streak (using existing 'streak_days' column)
  const currentStreak = userStats?.streak_days || 0;

  // Get total XP (using existing 'total_xp' column)
  const totalXP = userStats?.total_xp || 0;
  
  return {
    userStats,
    totalMGTokens,
    currentStreak,
    totalXP,
    loading,
    error,
    refreshStats,
    reload: loadUserStats
  };
};
