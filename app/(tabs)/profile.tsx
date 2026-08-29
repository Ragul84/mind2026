import React, { useState, useEffect, useCallback } from 'react';
import {
  View,
  Text,
  StyleSheet,
  StatusBar,
  ScrollView,
  TouchableOpacity,
  Image,
  Alert,
  Modal,
  ActivityIndicator,
  Platform,
  Switch,
} from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { Ionicons } from '@expo/vector-icons';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useFocusEffect } from 'expo-router';
import UniversalNavigation from '@/utils/universalNavigation';
import { SupabaseService, supabase } from '@/utils/supabaseService';
import { RewardService } from '@/services/rewardService';
import HapticService from '@/utils/hapticService';
import { V2026 } from '@/theme/v2026-tokens';
import AsyncStorage from '@react-native-async-storage/async-storage';
import NotificationService from '@/utils/notificationService';
import { getUserProtocol } from '@/utils/protocolService';
import UsagePanel from '@/components/ui/UsagePanel';
import { showBrandAlert } from '@/components/ui/BrandAlert';
import { ContentPlaceholder } from '@/components/ui/SkeletonLoader';

const COLORS = {
  bg: '#F8FAFC', // Premium soft white background
  primary: '#00D4C7',
  accent: '#00D4C7',
  textSecondary: '#64748B', // Slate-500
  card: '#FFFFFF', // Clean White Cards
  border: '#EEF2F7', // Subtle card borders
};

const AVATAR_STYLES = [
  { id: 'adventurer', name: 'Adventurer', logo: 'https://api.dicebear.com/7.x/adventurer/png?seed=Felix&backgroundColor=b4f4f0' },
  { id: 'bottts', name: 'Robots', logo: 'https://api.dicebear.com/7.x/bottts/png?seed=Bleep&backgroundColor=ffd1dc' },
  { id: 'lorelei', name: 'Chibi', logo: 'https://api.dicebear.com/7.x/lorelei/png?seed=Lily&backgroundColor=dbeafe' },
  { id: 'avataaars', name: 'Persona', logo: 'https://api.dicebear.com/7.x/avataaars/png?seed=Tom&backgroundColor=ffedd5' },
  { id: 'pixel-art', name: 'Retro Pixel', logo: 'https://api.dicebear.com/7.x/pixel-art/png?seed=Mario&backgroundColor=e2e8f0' },
];

const STYLE_SEEDS: Record<string, string[]> = {
  adventurer: ['Felix', 'Jasmine', 'Leo', 'Mia', 'Oliver', 'Sophia', 'Jack', 'Aneka'],
  bottts: ['Bleep', 'Bloop', 'Robo', 'Rusty', 'Sparky', 'Gear', 'Bolt', 'Widget'],
  lorelei: ['Lily', 'Sakura', 'Chibi', 'Momo', 'Yuki', 'Koko', 'Hana', 'Rin'],
  avataaars: ['Tom', 'Jane', 'Alex', 'Sarah', 'Mike', 'Emma', 'David', 'Olivia'],
  'pixel-art': ['Mario', 'Zelda', 'Link', 'Cloud', 'Peach', 'Yoshi', 'Sonic', 'Samus'],
};

// Generate highly optimized dicebear avatar link
const getAvatarUrl = (style: string, seed: string) => {
  return `https://api.dicebear.com/7.x/${style}/png?seed=${seed}&backgroundColor=b4f4f0,dbeafe,ffedd5,ffd1dc,e2e8f0`;
};

const StatItem = ({ label, value, icon, color, loading }: any) => (
  <View style={styles.statItem}>
    <View style={[styles.statIconBox, { backgroundColor: color + '15' }]}>
      <Ionicons name={icon} size={18} color={color} />
    </View>
    <View>
      {loading ? (
        <ContentPlaceholder lines={1} width={48} height={16} style={{ marginBottom: 4 }} />
      ) : (
        <Text style={styles.statValue}>{value}</Text>
      )}
      <Text style={styles.statLabel}>{label}</Text>
    </View>
  </View>
);

const MenuItem = ({ icon, label, subtitle, onPress, gradient }: any) => (
  <TouchableOpacity 
    style={styles.menuItem} 
    onPress={onPress} 
    activeOpacity={1}
  >
    <LinearGradient colors={gradient} style={styles.menuIconGradient}>
      <Ionicons name={icon} size={20} color="#FFF" />
    </LinearGradient>
    <View style={styles.menuInfo}>
      <Text style={styles.menuLabel}>{label}</Text>
      {subtitle && <Text style={styles.menuSub}>{subtitle}</Text>}
    </View>
    <Ionicons name="chevron-forward" size={18} color="#94A3B8" />
  </TouchableOpacity>
);

export default function ProfileScreen() {
    const [user, setUser] = useState<any>(null);
    const [stats, setStats] = useState<any>(null);
    const [statsLoading, setStatsLoading] = useState(true);

    // Avatar state
    const [avatarModalOpen, setAvatarModalOpen] = useState(false);
    const [selectedStyle, setSelectedStyle] = useState('adventurer');
    const [currentSeed, setCurrentSeed] = useState('Felix');
    const [isSavingAvatar, setIsSavingAvatar] = useState(false);
    const [successModalOpen, setSuccessModalOpen] = useState(false);

    // Notification states
    const [dailyBriefing, setDailyBriefing] = useState(true);
    const [streakProtector, setStreakProtector] = useState(true);
    const [peerInvites, setPeerInvites] = useState(true);
    const [preferredSlot, setPreferredSlot] = useState('evening');

    useEffect(() => {
        const loadSettings = async () => {
            try {
                const savedBriefing = await AsyncStorage.getItem('settings_daily_briefing');
                const savedStreak = await AsyncStorage.getItem('settings_streak_protector');
                const savedInvites = await AsyncStorage.getItem('settings_peer_invites');
                const savedSlot = await AsyncStorage.getItem('settings_preferred_slot');

                if (savedBriefing !== null) setDailyBriefing(savedBriefing === 'true');
                if (savedStreak !== null) setStreakProtector(savedStreak === 'true');
                if (savedInvites !== null) setPeerInvites(savedInvites === 'true');
                if (savedSlot !== null) setPreferredSlot(savedSlot);
            } catch (err) {
                console.error('Failed to load settings:', err);
            }
        };
        loadSettings();
    }, []);

    const toggleSetting = async (key: string, value: boolean, setter: (val: boolean) => void) => {
        HapticService.selection();
        setter(value);
        try {
            await AsyncStorage.setItem(key, value.toString());
            const currentUser = user || await SupabaseService.getCurrentUser();
            if (currentUser) {
                const protocol = await getUserProtocol(currentUser.id);
                const isTodayComplete = protocol ? (protocol.progress_phase ?? 0) >= 5 : false;
                NotificationService.scheduleDailyNotifications(isTodayComplete);
            }
        } catch (err) {
            console.error('Failed to save setting:', err);
        }
    };

    const selectPreferredSlot = async (slot: string) => {
        HapticService.selection();
        setPreferredSlot(slot);
        try {
            await AsyncStorage.setItem('settings_preferred_slot', slot);
            const currentUser = user || await SupabaseService.getCurrentUser();
            if (currentUser) {
                const protocol = await getUserProtocol(currentUser.id);
                const isTodayComplete = protocol ? (protocol.progress_phase ?? 0) >= 5 : false;
                NotificationService.scheduleDailyNotifications(isTodayComplete);
            }
        } catch (err) {
            console.error('Failed to save preferred slot:', err);
        }
    };

    const fetchUser = async (opts?: { force?: boolean }) => {
        const currentUser = await SupabaseService.getCurrentUser();
        if (currentUser) {
            setUser(currentUser);
            // Cached (60s TTL, invalidated on any XP/reward write) — re-entering
            // this tab shouldn't re-query and re-upsert on every single focus.
            const userStats = await RewardService.getUserStatsCached(opts);
            setStats(userStats);
            // Only clear the skeleton once we actually have a value — a failed/
            // not-ready-yet read keeps showing the skeleton (and retries on the
            // next focus) instead of flashing a misleading "0".
            if (userStats) setStatsLoading(false);

            // Global rank comes from a SECURITY DEFINER RPC (RLS hides other rows,
            // so it can't be counted client-side). Degrades to no rank if the RPC
            // isn't present yet. Also cached — rank changes slowly.
            const rank = await RewardService.getGlobalRankCached(currentUser.id, opts);
            if (typeof rank === 'number') setStats((prev: any) => ({ ...(prev || userStats), rank }));

            // Sync default seed to current metadata seed if present
            const currentUrl = currentUser?.user_metadata?.avatar_url;
            if (currentUrl && currentUrl.includes('api.dicebear.com')) {
              try {
                const parts = currentUrl.split('/');
                const stylePart = parts[4]; // Corrected index from 5 to 4
                const seedMatch = currentUrl.match(/seed=([^&]+)/);
                if (stylePart && STYLE_SEEDS[stylePart]) setSelectedStyle(stylePart);
                if (seedMatch) setCurrentSeed(decodeURIComponent(seedMatch[1]));
              } catch (e) {}
            }
        }
    }

    useFocusEffect(
        useCallback(() => {
            fetchUser();
        }, [fetchUser])
    );

    const handleShuffle = () => {
      HapticService.selection();
      const randomSeed = Math.random().toString(36).substring(7);
      setCurrentSeed(randomSeed);
    };

    const saveAvatar = async () => {
        setIsSavingAvatar(true);
        HapticService.heavy();
        try {
            if (!user?.id) throw new Error("User session not found.");
            const avatarUrl = getAvatarUrl(selectedStyle, currentSeed);
            
            // Save to Supabase auth user metadata
            const { data, error } = await supabase.auth.updateUser({
                data: { avatar_url: avatarUrl }
            });
            
            if (error) throw error;
            
            // Sync to user_profiles table too
            const { error: dbError } = await supabase
                .from('user_profiles')
                .update({
                    avatar_url: avatarUrl,
                    updated_at: new Date().toISOString(),
                })
                .eq('id', user.id);

            if (dbError) throw dbError;

            // Close modal immediately so the UI feels ultra responsive
            setAvatarModalOpen(false);

            // Refresh user state in the background
            fetchUser().catch(() => {});

            // Show a pleasant final confirmation success popup
            HapticService.success();
            setSuccessModalOpen(true);
        } catch (error: any) {
            console.error("Error saving avatar:", error);
            Alert.alert("Error", error.message || "Failed to update avatar.");
        } finally {
            setIsSavingAvatar(false);
        }
    };

    const handleLogout = () => {
        HapticService.heavy();
        showBrandAlert({
            title: "Log out?",
            message: "You'll need to sign in again to continue your streak and progress.",
            icon: 'log-out-outline',
            buttons: [
                { text: "Cancel", style: 'cancel' },
                { text: "Log Out", style: 'destructive', onPress: async () => {
                    await SupabaseService.signOut();
                    UniversalNavigation.replaceTo('/auth');
                }}
            ],
        });
    }

    return (
        <View style={styles.container}>
            <StatusBar barStyle='dark-content' translucent />

            <SafeAreaView style={styles.safe} edges={['top', 'left', 'right']}>
              <View style={styles.header}>
                <Text style={styles.headerTitle}>Profile</Text>
              </View>

              <ScrollView 
                  showsVerticalScrollIndicator={false}
                  contentContainerStyle={{ paddingBottom: 150 }}
              >
                {/* Profile Header */}
                <View style={styles.profileSection}>
                  <TouchableOpacity style={styles.avatarWrapper} onPress={() => setAvatarModalOpen(true)} activeOpacity={0.82}>
                    <Image 
                        source={{ uri: user?.user_metadata?.avatar_url || `https://ui-avatars.com/api/?name=${user?.user_metadata?.full_name || user?.email || 'User'}&background=1e293b&color=fff&size=200&bold=true` }}
                        style={styles.avatar}
                    />
                    <View style={styles.editBadge}>
                      <Ionicons name="camera" size={12} color="#FFF" />
                    </View>
                  </TouchableOpacity>
                  
                  <View style={styles.profileInfo}>
                    <Text style={styles.userName}>{user?.user_metadata?.full_name || user?.email?.split('@')[0] || 'Learner'}</Text>
                    <View style={styles.badgeRow}>
                      <View style={styles.statusBadge}>
                        <Text style={styles.statusText}>{(stats?.subscription_tier || 'Free').toUpperCase()} PLAN</Text>
                      </View>
                      <View style={styles.streakBadge}>
                        <Ionicons name="flame" size={12} color="#F59E0B" />
                        <Text style={styles.streakText}>{stats?.streak_days || 0}d Streak</Text>
                      </View>
                    </View>
                  </View>
                </View>

                {/* Performance Stats */}
                <View style={styles.statsContainer}>
                   <StatItem label="Total Points" value={stats?.total_xp?.toLocaleString() || '0'} icon="flash-outline" color="#3B82F6" loading={statsLoading} />
                   <View style={styles.vDivider} />
                   <StatItem label="Global Rank" value={typeof stats?.rank === 'number' ? `#${stats.rank}` : '—'} icon="trophy-outline" color="#F59E0B" loading={statsLoading} />
                </View>

                {/* Daily AI usage */}
                <View style={styles.section}>
                  <Text style={styles.sectionTitle}>DAILY USAGE</Text>
                  <UsagePanel />
                </View>

                {/* Account Settings */}
                <View style={styles.section}>
                  <Text style={styles.sectionTitle}>YOUR PROGRESS</Text>
                  <View style={styles.menuBox}>
                    <MenuItem
                      icon="sparkles"
                      label="Go Pro / Subscription"
                      subtitle="Unlock unlimited lessons & AI features"
                      gradient={['#FDE68A', '#F59E0B']}
                      onPress={() => UniversalNavigation.navigateTo('/subscription')}
                    />
                    <View style={styles.hDivider} />
                    <MenuItem
                      icon="flag"
                      label="Join MISA Movement"
                      subtitle="Test the oath and share page"
                      gradient={['#111827', '#7C3AED']}
                      onPress={() => UniversalNavigation.navigateTo('/misa')}
                    />
                    <View style={styles.hDivider} />
                    <MenuItem
                      icon="flame"
                      label="Streak Progress"
                      subtitle="Track your daily consistency"
                      gradient={['#A78BFA', '#00D4C7']}
                      onPress={() => UniversalNavigation.navigateTo('/(tabs)/streak')} 
                    />
                    <View style={styles.hDivider} />
                    <MenuItem
                      icon="book"
                      label="Mistake Notebook"
                      subtitle="Revisit wrong answers with explanations"
                      gradient={['#FB7185', '#F43F5E']}
                      onPress={() => UniversalNavigation.navigateTo('/quiz/mistakes')}
                    />
                    <View style={styles.hDivider} />
                    <MenuItem 
                      icon="flag" 
                      label="State Leaderboard" 
                      subtitle="See how your state is performing" 
                      gradient={['#FBBF24', '#F59E0B']}
                      onPress={() => UniversalNavigation.navigateTo('/(tabs)/leaderboard')} 
                    />
                    <View style={styles.hDivider} />
                    <MenuItem 
                      icon="albums" 
                      label="AI Lab History" 
                      subtitle="Open your saved study outputs" 
                      gradient={['#6366F1', '#4F46E5']}
                      onPress={() => UniversalNavigation.navigateTo('/learn/history')} 
                    />
                  </View>
                </View>

                {/* Logout */}
                <TouchableOpacity style={styles.logoutBtn} activeOpacity={1} onPress={handleLogout}>
                   <Ionicons name="log-out-outline" size={20} color="#FB7185" />
                   <Text style={styles.logoutText}>Log Out</Text>
                </TouchableOpacity>

                <View style={styles.footer}>
                    <Text style={styles.footerText}>MindGains v2.5.0</Text>
                </View>
              </ScrollView>
            </SafeAreaView>

            {/* 🔮 PREMIUM DICEBEAR AVATAR CUSTOMIZER MODAL */}
            <Modal
              visible={avatarModalOpen}
              animationType="slide"
              transparent={true}
              onRequestClose={() => setAvatarModalOpen(false)}
            >
              <View style={styles.modalOverlay}>
                <View style={styles.modalSheet}>
                  
                  {/* Sheet Handle Indicator */}
                  <View style={styles.sheetHandle} />
                  
                  {/* Header with compact Shuffle button */}
                  <View style={styles.modalHeader}>
                    <Text style={styles.modalTitle}>Customize Avatar</Text>
                    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
                      <TouchableOpacity onPress={handleShuffle} style={styles.compactShuffleBtn}>
                        <Ionicons name="shuffle" size={14} color="#0D9488" />
                        <Text style={styles.compactShuffleText}>Shuffle</Text>
                      </TouchableOpacity>
                      <TouchableOpacity onPress={() => setAvatarModalOpen(false)} style={styles.modalCloseBtn}>
                        <Ionicons name="close" size={20} color="#64748B" />
                      </TouchableOpacity>
                    </View>
                  </View>

                  {/* Docked Preview Container (Always Visible at Top!) */}
                  <View style={styles.previewContainer}>
                    <LinearGradient colors={['#EFF6FF', '#DBEAFE']} style={styles.previewGradient}>
                      <Image
                        source={{ uri: getAvatarUrl(selectedStyle, currentSeed) }}
                        style={styles.previewImage}
                      />
                    </LinearGradient>
                  </View>
                  
                  {/* Scrollable list for collections and seeds only */}
                  <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={styles.modalScrollContent}>
                    
                    {/* Avatar Categories Row */}
                    <Text style={styles.customSectionLabel}>AVATAR COLLECTION</Text>
                    <ScrollView 
                      horizontal 
                      showsHorizontalScrollIndicator={false} 
                      contentContainerStyle={styles.categoriesRow}
                    >
                      {AVATAR_STYLES.map((style) => {
                        const isSelected = selectedStyle === style.id;
                        return (
                          <TouchableOpacity
                            key={style.id}
                            activeOpacity={0.82}
                            onPress={() => {
                              HapticService.selection();
                              setSelectedStyle(style.id);
                              setCurrentSeed(STYLE_SEEDS[style.id][0]);
                            }}
                            style={[
                              styles.styleChip,
                              isSelected && styles.styleChipActive
                            ]}
                          >
                            <Image 
                              source={{ uri: style.logo }} 
                              style={{ width: 22, height: 22, borderRadius: 11, marginRight: 6 }} 
                            />
                            <Text style={[
                              styles.styleChipText,
                              isSelected && styles.styleChipTextActive
                            ]}>
                              {style.name}
                            </Text>
                          </TouchableOpacity>
                        );
                      })}
                    </ScrollView>

                    {/* Pre-defined Seeds Grid */}
                    <Text style={styles.customSectionLabel}>POPULAR PICKS</Text>
                    <View style={styles.seedsGrid}>
                      {STYLE_SEEDS[selectedStyle]?.map((seed) => {
                        const isSelected = currentSeed === seed;
                        const itemUrl = getAvatarUrl(selectedStyle, seed);
                        return (
                          <TouchableOpacity
                            key={seed}
                            activeOpacity={0.8}
                            onPress={() => {
                              HapticService.selection();
                              setCurrentSeed(seed);
                            }}
                            style={[
                              styles.seedCard,
                              isSelected && styles.seedCardActive
                            ]}
                          >
                            <Image source={{ uri: itemUrl }} style={styles.seedThumbnail} />
                            <Text style={[
                              styles.seedCardText,
                              isSelected && styles.seedCardTextActive
                            ]} numberOfLines={1}>
                              {seed}
                            </Text>
                          </TouchableOpacity>
                        );
                      })}
                    </View>

                  </ScrollView>

                  {/* Bottom Actions */}
                  <View style={styles.modalActions}>
                    <TouchableOpacity style={styles.cancelActionBtn} onPress={() => setAvatarModalOpen(false)}>
                      <Text style={styles.cancelActionText}>Cancel</Text>
                    </TouchableOpacity>
                    
                    <TouchableOpacity 
                      style={styles.saveActionBtn} 
                      onPress={saveAvatar}
                      disabled={isSavingAvatar}
                    >
                      {isSavingAvatar ? (
                        <ActivityIndicator size="small" color="#FFFFFF" />
                      ) : (
                        <Text style={styles.saveActionText}>Apply Avatar</Text>
                      )}
                    </TouchableOpacity>
                  </View>

                </View>
              </View>
            </Modal>

            {/* ✨ REDESIGNED PREMIUM AVATAR SUCCESS MODAL */}
            <Modal
              visible={successModalOpen}
              animationType="fade"
              transparent={true}
              onRequestClose={() => setSuccessModalOpen(false)}
            >
              <View style={styles.successOverlay}>
                <View style={styles.successCard}>
                  {/* Decorative Sparkles & Checkmark circle */}
                  <LinearGradient
                    colors={['#00D4C7', '#0D9488']}
                    style={styles.successIconCircle}
                  >
                    <Ionicons name="checkmark-sharp" size={34} color="#FFFFFF" />
                  </LinearGradient>

                  <View style={styles.sparkleDecorationLeft}>
                    <Ionicons name="sparkles" size={16} color="#FBBF24" />
                  </View>
                  <View style={styles.sparkleDecorationRight}>
                    <Ionicons name="sparkles" size={20} color="#FBBF24" />
                  </View>

                  <Text style={styles.successTitle}>Avatar Updated!</Text>
                  <Text style={styles.successBody}>
                    Your profile avatar has been successfully changed. Other players will see your new look on the Leaderboard and in quiz battles!
                  </Text>

                  {/* Render the current new avatar preview right in the popup! */}
                  <View style={styles.successPreviewBox}>
                    <Image
                      source={{ uri: getAvatarUrl(selectedStyle, currentSeed) }}
                      style={styles.successPreviewImage}
                    />
                  </View>

                  <TouchableOpacity
                    style={styles.successActionBtn}
                    activeOpacity={0.88}
                    onPress={() => {
                      HapticService.selection();
                      setSuccessModalOpen(false);
                    }}
                  >
                    <LinearGradient
                      colors={['#00D4C7', '#0D9488']}
                      style={styles.successActionBtnGradient}
                    >
                      <Text style={styles.successActionText}>Awesome</Text>
                    </LinearGradient>
                  </TouchableOpacity>
                </View>
              </View>
            </Modal>
        </View>
    );
}

const styles = StyleSheet.create({
    container: { flex: 1, backgroundColor: COLORS.bg },
    safe: { flex: 1 },
    header: {
      paddingHorizontal: 24,
      paddingVertical: 16,
    },
    headerTitle: {
      color: '#0F172A',
      fontSize: 28,
      fontFamily: 'Poppins-Bold',
      letterSpacing: -0.5,
    },
    profileSection: {
      flexDirection: 'row',
      alignItems: 'center',
      paddingHorizontal: 24,
      marginTop: 8,
      marginBottom: 24,
    },
    avatarWrapper: {
      position: 'relative',
    },
    avatar: {
      width: 80,
      height: 80,
      borderRadius: 40,
      backgroundColor: '#FFFFFF',
      borderWidth: 1.5,
      borderColor: '#EEF2F7',
    },
    editBadge: {
      position: 'absolute',
      bottom: 0,
      right: 0,
      width: 26,
      height: 26,
      borderRadius: 13,
      backgroundColor: '#00D4C7',
      borderWidth: 2,
      borderColor: '#FFFFFF',
      alignItems: 'center',
      justifyContent: 'center',
      ...V2026.shadows.primary,
    },
    profileInfo: {
      marginLeft: 20,
      flex: 1,
    },
    userName: {
      color: '#0F172A',
      fontSize: 22,
      fontFamily: 'Poppins-Bold',
      letterSpacing: -0.5,
    },
    badgeRow: {
      flexDirection: 'row',
      marginTop: 8,
      gap: 10,
    },
    statusBadge: {
      backgroundColor: 'rgba(0, 212, 199, 0.15)',
      paddingHorizontal: 8,
      paddingVertical: 4,
      borderRadius: 6,
      borderWidth: 1,
      borderColor: 'rgba(0, 212, 199, 0.3)',
    },
    statusText: {
      color: COLORS.primary,
      fontSize: 10,
      fontFamily: 'Poppins-SemiBold',
    },
    streakBadge: {
      flexDirection: 'row',
      alignItems: 'center',
      backgroundColor: 'rgba(245, 158, 11, 0.1)',
      paddingHorizontal: 8,
      paddingVertical: 4,
      borderRadius: 6,
      gap: 4,
    },
    streakText: {
      color: '#F59E0B',
      fontSize: 10,
      fontFamily: 'Poppins-SemiBold',
    },
    statsContainer: {
      flexDirection: 'row',
      backgroundColor: '#FFFFFF',
      marginHorizontal: 24,
      borderRadius: 24,
      padding: 16,
      alignItems: 'center',
      borderWidth: 1,
      borderColor: COLORS.border,
      ...V2026.shadows.milky,
    },
    statItem: {
      flex: 1,
      flexDirection: 'row',
      alignItems: 'center',
      gap: 12,
      paddingHorizontal: 4,
    },
    statIconBox: {
      width: 40,
      height: 40,
      borderRadius: 12,
      alignItems: 'center',
      justifyContent: 'center',
    },
    statValue: {
      color: '#0F172A',
      fontSize: 16,
      fontFamily: 'Poppins-Bold',
    },
    statLabel: {
      color: COLORS.textSecondary,
      fontSize: 10,
      fontFamily: 'Inter-Medium',
    },
    vDivider: {
      width: 1,
      height: 30,
      backgroundColor: '#EEF2F7',
      marginHorizontal: 12,
    },
    section: {
      marginTop: 32,
      paddingHorizontal: 24,
    },
    sectionTitle: {
      color: COLORS.textSecondary,
      fontSize: 11,
      fontFamily: 'Poppins-SemiBold',
      letterSpacing: 1,
      marginBottom: 12,
      marginLeft: 4,
    },
    menuBox: {
      backgroundColor: '#FFFFFF',
      borderRadius: 24,
      overflow: 'hidden',
      borderWidth: 1,
      borderColor: COLORS.border,
      ...V2026.shadows.milky,
    },
    menuItem: {
      flexDirection: 'row',
      alignItems: 'center',
      padding: 16,
    },
    menuIconGradient: {
      width: 42,
      height: 42,
      borderRadius: 14,
      alignItems: 'center',
      justifyContent: 'center',
      marginRight: 16,
    },
    menuInfo: {
      flex: 1,
    },
    menuLabel: {
      color: '#0F172A',
      fontSize: 15,
      fontFamily: 'Inter-SemiBold',
    },
    menuSub: {
      color: 'rgba(148, 163, 184, 0.6)',
      fontSize: 11,
      marginTop: 2,
    },
    hDivider: {
      height: 1,
      backgroundColor: '#EEF2F7',
      marginHorizontal: 16,
    },
    settingItem: {
      flexDirection: 'row',
      alignItems: 'center',
      padding: 16,
      justifyContent: 'space-between',
    },
    settingIconBox: {
      width: 42,
      height: 42,
      borderRadius: 14,
      alignItems: 'center',
      justifyContent: 'center',
      marginRight: 16,
      backgroundColor: '#F8FAFC',
      borderWidth: 1,
      borderColor: '#EEF2F7',
    },
    settingInfo: {
      flex: 1,
      marginRight: 12,
    },
    settingLabel: {
      color: '#0F172A',
      fontSize: 15,
      fontFamily: 'Inter-SemiBold',
    },
    settingSub: {
      color: 'rgba(148, 163, 184, 0.9)',
      fontSize: 11,
      marginTop: 2,
    },
    slotSelectorContainer: {
      padding: 16,
      backgroundColor: '#FAFAFA',
      borderTopWidth: 1,
      borderColor: '#EEF2F7',
    },
    slotSelectorLabel: {
      color: '#64748B',
      fontSize: 10,
      fontFamily: 'Poppins-Bold',
      letterSpacing: 1,
      marginBottom: 12,
    },
    slotGrid: {
      flexDirection: 'row',
      flexWrap: 'wrap',
      gap: 10,
      justifyContent: 'space-between',
    },
    slotChip: {
      width: '48%',
      backgroundColor: '#FFFFFF',
      borderWidth: 1.5,
      borderColor: '#EEF2F7',
      borderRadius: 14,
      padding: 12,
      alignItems: 'center',
      gap: 4,
      marginVertical: 4,
    },
    slotChipActive: {
      backgroundColor: 'rgba(0, 212, 199, 0.08)',
      borderColor: '#00D4C7',
    },
    slotChipText: {
      fontSize: 12,
      fontFamily: 'Poppins-Bold',
      color: '#475569',
    },
    slotChipTextActive: {
      color: '#00D4C7',
    },
    slotChipTime: {
      fontSize: 10,
      fontFamily: 'Inter-SemiBold',
      color: '#94A3B8',
    },
    slotChipTimeActive: {
      color: '#0D9488',
    },
    logoutBtn: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'center',
      marginTop: 40,
      marginBottom: 20,
      gap: 10,
    },
    logoutText: {
      color: '#FB7185',
      fontSize: 15,
      fontFamily: 'Poppins-SemiBold',
    },
    footer: {
      alignItems: 'center',
      marginTop: 20,
    },
    footerText: {
      color: 'rgba(15, 23, 42, 0.25)',
      fontSize: 11,
      fontFamily: 'Poppins-SemiBold',
    },

    // Modal Customizer Styles
    modalOverlay: {
      flex: 1,
      backgroundColor: 'rgba(15, 23, 42, 0.45)', // Translucent slate backdrop
      justifyContent: 'flex-end',
    },
    modalSheet: {
      backgroundColor: '#FFFFFF',
      borderTopLeftRadius: 32,
      borderTopRightRadius: 32,
      paddingHorizontal: 24,
      paddingTop: 10,
      paddingBottom: Platform.OS === 'ios' ? 44 : 28,
      height: '80%',
      ...V2026.shadows.primary,
    },
    sheetHandle: {
      width: 40,
      height: 5,
      borderRadius: 3,
      backgroundColor: '#E2E8F0',
      alignSelf: 'center',
      marginBottom: 16,
    },
    modalHeader: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      marginBottom: 16,
    },
    modalTitle: {
      fontSize: 20,
      fontFamily: 'Poppins-Bold',
      color: '#0F172A',
    },
    modalCloseBtn: {
      width: 32,
      height: 32,
      borderRadius: 16,
      backgroundColor: '#F1F5F9',
      alignItems: 'center',
      justifyContent: 'center',
    },
    modalScrollContent: {
      paddingBottom: 24,
    },
    previewContainer: {
      alignItems: 'center',
      justifyContent: 'center',
      marginVertical: 4,
    },
    previewGradient: {
      width: 106,
      height: 106,
      borderRadius: 53,
      padding: 4,
      alignItems: 'center',
      justifyContent: 'center',
      borderWidth: 2,
      borderColor: '#00D4C7',
      ...V2026.shadows.milky,
    },
    previewImage: {
      width: 94,
      height: 94,
      borderRadius: 47,
    },
    compactShuffleBtn: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 4,
      backgroundColor: '#F0FDFA',
      borderWidth: 1.2,
      borderColor: '#99F6E4',
      borderRadius: 10,
      paddingHorizontal: 8,
      paddingVertical: 4.5,
    },
    compactShuffleText: {
      fontSize: 11,
      fontFamily: 'Poppins-Bold',
      color: '#0D9488',
    },
    customSectionLabel: {
      fontSize: 11,
      fontFamily: 'Poppins-Bold',
      color: '#64748B',
      letterSpacing: 0.8,
      marginTop: 16,
      marginBottom: 10,
    },
    categoriesRow: {
      gap: 8,
      paddingBottom: 4,
    },
    styleChip: {
      flexDirection: 'row',
      alignItems: 'center',
      paddingHorizontal: 14,
      paddingVertical: 8,
      borderRadius: 12,
      backgroundColor: '#F8FAFC',
      borderWidth: 1.5,
      borderColor: '#E2E8F0',
    },
    styleChipActive: {
      backgroundColor: 'rgba(0, 212, 199, 0.15)',
      borderColor: '#00D4C7',
    },
    styleChipText: {
      fontSize: 12,
      fontFamily: 'Poppins-Medium',
      color: '#475569',
    },
    styleChipTextActive: {
      fontFamily: 'Poppins-Bold',
      color: '#00D4C7',
    },
    seedsGrid: {
      flexDirection: 'row',
      flexWrap: 'wrap',
      gap: 12,
      justifyContent: 'space-between',
    },
    seedCard: {
      width: '22%',
      backgroundColor: '#F8FAFC',
      borderWidth: 1.5,
      borderColor: '#E2E8F0',
      borderRadius: 14,
      padding: 6,
      alignItems: 'center',
    },
    seedCardActive: {
      backgroundColor: 'rgba(0, 212, 199, 0.15)',
      borderColor: '#00D4C7',
    },
    seedThumbnail: {
      width: 50,
      height: 50,
      borderRadius: 25,
      marginBottom: 6,
    },
    seedCardText: {
      fontSize: 10,
      fontFamily: 'Inter-Medium',
      color: '#475569',
      textAlign: 'center',
    },
    seedCardTextActive: {
      fontFamily: 'Inter-Bold',
      color: '#00D4C7',
    },
    modalActions: {
      flexDirection: 'row',
      gap: 12,
      marginTop: 16,
    },
    cancelActionBtn: {
      flex: 1,
      height: 50,
      borderRadius: 25,
      backgroundColor: '#F1F5F9',
      alignItems: 'center',
      justifyContent: 'center',
    },
    cancelActionText: {
      fontSize: 14,
      fontFamily: 'Poppins-Bold',
      color: '#64748B',
    },
    saveActionBtn: {
      flex: 1,
      height: 50,
      borderRadius: 25,
      backgroundColor: '#00D4C7',
      alignItems: 'center',
      justifyContent: 'center',
      ...V2026.shadows.primary,
    },
    saveActionText: {
      fontSize: 14,
      fontFamily: 'Poppins-Bold',
      color: '#FFFFFF',
    },

    // Success Modal Redesign Styles
    successOverlay: {
      flex: 1,
      backgroundColor: 'rgba(15, 23, 42, 0.65)', // Elegant dark glass backdrop
      justifyContent: 'center',
      alignItems: 'center',
      paddingHorizontal: 24,
    },
    successCard: {
      width: '90%',
      backgroundColor: '#FFFFFF',
      borderRadius: 30,
      paddingVertical: 32,
      paddingHorizontal: 24,
      alignItems: 'center',
      position: 'relative',
      borderWidth: 1,
      borderColor: '#EEF2F7',
      ...V2026.shadows.primary,
    },
    successIconCircle: {
      width: 72,
      height: 72,
      borderRadius: 36,
      alignItems: 'center',
      justifyContent: 'center',
      marginBottom: 20,
      ...V2026.shadows.primary,
    },
    sparkleDecorationLeft: {
      position: 'absolute',
      top: 36,
      left: '28%',
    },
    sparkleDecorationRight: {
      position: 'absolute',
      top: 24,
      right: '24%',
    },
    successTitle: {
      fontSize: 22,
      fontFamily: 'Poppins-Bold',
      color: '#0F172A',
      textAlign: 'center',
      marginBottom: 10,
    },
    successBody: {
      fontSize: 13,
      fontFamily: 'Inter-Medium',
      color: '#64748B',
      textAlign: 'center',
      lineHeight: 20,
      paddingHorizontal: 12,
      marginBottom: 24,
    },
    successPreviewBox: {
      width: 90,
      height: 90,
      borderRadius: 45,
      backgroundColor: '#F8FAFC',
      borderWidth: 2,
      borderColor: '#EEF2F7',
      padding: 4,
      alignItems: 'center',
      justifyContent: 'center',
      marginBottom: 28,
      ...V2026.shadows.milky,
    },
    successPreviewImage: {
      width: 76,
      height: 76,
      borderRadius: 38,
    },
    successActionBtn: {
      width: '100%',
      height: 52,
      borderRadius: 26,
      overflow: 'hidden',
      ...V2026.shadows.primary,
    },
    successActionBtnGradient: {
      flex: 1,
      alignItems: 'center',
      justifyContent: 'center',
    },
    successActionText: {
      color: '#FFFFFF',
      fontSize: 15,
      fontFamily: 'Poppins-Bold',
      letterSpacing: 0.3,
    },
});
