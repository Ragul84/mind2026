import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  Animated,
  Easing,
  Image,
  Pressable,
  SafeAreaView,
  StatusBar,
  StyleSheet,
  Text,
  TouchableOpacity,
  useWindowDimensions,
  View,
} from 'react-native';
import { Ionicons, MaterialCommunityIcons } from '@expo/vector-icons';
import { LinearGradient } from 'expo-linear-gradient';
import { useRouter } from 'expo-router';
import { Audio } from 'expo-av';
import { useAuthContext } from '@/components/AuthProvider';
import { useFightingGame, FloatingHit, MatchEvent } from './useFightingGame';
import { SubjectFilter } from './types';
import GyanClashSound from '@/utils/gyanClashSound';

// ─── Sprite config ────────────────────────────────────────────────────────────
type FighterId = 'soldier' | 'slime';

const FIGHTERS = {
  soldier: {
    name: 'Guardian',
    accent: '#60A5FA',
    glow: 'rgba(96,165,250,0.35)',
    sheets: {
      idle:    { src: require('@/assets/FreeCharactersAnimationsAssetPack/SpriteSheets(96x96)/Human_Soldier_Sword_Shield/With_Shadows/Human_Soldier_Sword_Shield_Idle-Sheet.png'),    frames: 6,  ms: 130 },
      attack:  { src: require('@/assets/FreeCharactersAnimationsAssetPack/SpriteSheets(96x96)/Human_Soldier_Sword_Shield/With_Shadows/Human_Soldier_Sword_Shield_Attack1-Sheet.png'), frames: 8,  ms: 68  },
      special: { src: require('@/assets/FreeCharactersAnimationsAssetPack/SpriteSheets(96x96)/Human_Soldier_Sword_Shield/With_Shadows/Human_Soldier_Sword_Shield_Attack2-Sheet.png'), frames: 8,  ms: 62  },
      block:   { src: require('@/assets/FreeCharactersAnimationsAssetPack/SpriteSheets(96x96)/Human_Soldier_Sword_Shield/With_Shadows/Human_Soldier_Sword_Shield_Block-Sheet.png'),   frames: 6,  ms: 82  },
      hurt:    { src: require('@/assets/FreeCharactersAnimationsAssetPack/SpriteSheets(96x96)/Human_Soldier_Sword_Shield/With_Shadows/Human_Soldier_Sword_Shield_Hurt-Sheet.png'),    frames: 4,  ms: 68  },
      walk:    { src: require('@/assets/FreeCharactersAnimationsAssetPack/SpriteSheets(96x96)/Human_Soldier_Sword_Shield/With_Shadows/Human_Soldier_Sword_Shield_Walk-Sheet.png'),    frames: 8,  ms: 58  },
      jump:    { src: require('@/assets/FreeCharactersAnimationsAssetPack/SpriteSheets(96x96)/Human_Soldier_Sword_Shield/With_Shadows/Human_Soldier_Sword_Shield_Jump_Fall-Sheet.png'), frames: 6,  ms: 76  },
      death:   { src: require('@/assets/FreeCharactersAnimationsAssetPack/SpriteSheets(96x96)/Human_Soldier_Sword_Shield/With_Shadows/Human_Soldier_Sword_Shield_Death-Sheet.png'),   frames: 10, ms: 90  },
    },
  },
  slime: {
    name: 'Verdant',
    accent: '#4ADE80',
    glow: 'rgba(74,222,128,0.35)',
    sheets: {
      idle:    { src: require('@/assets/FreeCharactersAnimationsAssetPack/SpriteSheets(96x96)/Monster_Slime/With_Shadows/Monster_Slime_Idle-Sheet.png'),    frames: 6,  ms: 130 },
      attack:  { src: require('@/assets/FreeCharactersAnimationsAssetPack/SpriteSheets(96x96)/Monster_Slime/With_Shadows/Monster_Slime_Attack1-Sheet.png'), frames: 8,  ms: 68  },
      special: { src: require('@/assets/FreeCharactersAnimationsAssetPack/SpriteSheets(96x96)/Monster_Slime/With_Shadows/Monster_Slime_Attack2-Sheet.png'), frames: 8,  ms: 62  },
      block:   { src: require('@/assets/FreeCharactersAnimationsAssetPack/SpriteSheets(96x96)/Monster_Slime/With_Shadows/Monster_Slime_Block-Sheet.png'),   frames: 6,  ms: 82  },
      hurt:    { src: require('@/assets/FreeCharactersAnimationsAssetPack/SpriteSheets(96x96)/Monster_Slime/With_Shadows/Monster_Slime_Hurt-Sheet.png'),    frames: 4,  ms: 68  },
      walk:    { src: require('@/assets/FreeCharactersAnimationsAssetPack/SpriteSheets(96x96)/Monster_Slime/With_Shadows/Monster_Slime_Walk-Sheet.png'),    frames: 8,  ms: 58  },
      jump:    { src: require('@/assets/FreeCharactersAnimationsAssetPack/SpriteSheets(96x96)/Monster_Slime/With_Shadows/Monster_Slime_Jump_Fall-Sheet.png'), frames: 6,  ms: 76  },
      death:   { src: require('@/assets/FreeCharactersAnimationsAssetPack/SpriteSheets(96x96)/Monster_Slime/With_Shadows/Monster_Slime_Death-Sheet.png'),   frames: 10, ms: 90  },
    },
  },
} as const;

type SpriteState = keyof typeof FIGHTERS['soldier']['sheets'];

const VFX = {
  arrow:     require('@/assets/gyan-clash/vfx-frames/arrow_right.png'),
  firebolt:  require('@/assets/gyan-clash/vfx-frames/firebolt_left.png'),
  impact:    require('@/assets/gyan-clash/vfx-frames/impact_large.png'),
  gold:      require('@/assets/gyan-clash/vfx-frames/gold_explosion.png'),
};

const ARENA_BG = require('@/assets/gyan-clash/arena-background.png');

const SFX_FILES = {
  attack:  require('@/assets/gyan-clash/sfx/arrow_release.wav'),
  hit:     require('@/assets/gyan-clash/sfx/impact_hit.wav'),
  clash:   require('@/assets/gyan-clash/sfx/clash.wav'),
  wrong:   require('@/assets/gyan-clash/sfx/wrong_hit.wav'),
};

const SUBJECTS: { id: SubjectFilter; label: string; color: string }[] = [
  { id: 'mix',       label: 'Full Mix',   color: '#A78BFA' },
  { id: 'history',   label: 'History',    color: '#F472B6' },
  { id: 'geography', label: 'Geography',  color: '#34D399' },
  { id: 'polity',    label: 'Polity',     color: '#60A5FA' },
  { id: 'science',   label: 'Science',    color: '#FBBF24' },
  { id: 'economy',   label: 'Economy',    color: '#FB923C' },
];

// ─── Sprite component ─────────────────────────────────────────────────────────
function Sprite({
  id, side, anim, scale = 1,
}: { id: FighterId; side: 'left' | 'right'; anim: SpriteState; scale?: number }) {
  const sheet = FIGHTERS[id].sheets[anim];
  const [frame, setFrame] = useState(0);

  useEffect(() => {
    setFrame(0);
    const t = setInterval(() => {
      setFrame(v => {
        const loop = anim === 'idle' || anim === 'walk' || anim === 'block';
        return loop ? (v + 1) % sheet.frames : Math.min(v + 1, sheet.frames - 1);
      });
    }, sheet.ms);
    return () => clearInterval(t);
  }, [anim, sheet.frames, sheet.ms]);

  const px = 96 * scale;
  return (
    <View style={{ width: px * 1.45, height: px * 1.45, overflow: 'hidden', transform: [{ scaleX: side === 'right' ? -1 : 1 }] }}>
      <Image
        source={sheet.src}
        resizeMode="stretch"
        style={{ position: 'absolute', left: 0, top: 0, height: px * 1.45, width: px * sheet.frames * 1.45, transform: [{ translateX: -frame * px * 1.45 }] }}
      />
    </View>
  );
}

// ─── Floating hit text ────────────────────────────────────────────────────────
function FloatText({ hit, arenaWidth }: { hit: FloatingHit; arenaWidth: number }) {
  const anim = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    Animated.timing(anim, { toValue: 1, duration: 820, easing: Easing.out(Easing.quad), useNativeDriver: true }).start();
  }, [anim]);
  const translateY = anim.interpolate({ inputRange: [0, 1], outputRange: [0, -56] });
  const opacity    = anim.interpolate({ inputRange: [0, 0.5, 1], outputRange: [1, 1, 0] });
  const left = hit.side === 'hero' ? arenaWidth * 0.18 : arenaWidth * 0.58;
  return (
    <Animated.Text style={[g.floatText, { left, color: hit.color, opacity, transform: [{ translateY }] }]}>
      {hit.text}
    </Animated.Text>
  );
}

// ─── Spark burst (flat particles, no glow) ─────────────────────────────────────
type Burst = { id: string; side: 'hero' | 'rival'; color: string; big: boolean };

function SparkBurst({ burst, arenaWidth }: { burst: Burst; arenaWidth: number }) {
  const count = burst.big ? 12 : 8;
  const particles = useRef(
    Array.from({ length: count }, (_, i) => {
      const angle = (Math.PI * 2 * i) / count + Math.random() * 0.5;
      const dist = (burst.big ? 46 : 30) + Math.random() * 22;
      return {
        anim: new Animated.Value(0),
        dx: Math.cos(angle) * dist,
        dy: Math.sin(angle) * dist - 10,
        size: (burst.big ? 7 : 5) + Math.random() * 4,
      };
    }),
  ).current;

  useEffect(() => {
    Animated.stagger(
      10,
      particles.map(p =>
        Animated.timing(p.anim, {
          toValue: 1,
          duration: burst.big ? 560 : 420,
          easing: Easing.out(Easing.quad),
          useNativeDriver: true,
        }),
      ),
    ).start();
  }, [burst.big, particles]);

  const left = burst.side === 'hero' ? arenaWidth * 0.2 : arenaWidth * 0.78;
  return (
    <View style={{ position: 'absolute', left, bottom: '34%' }} pointerEvents="none">
      {particles.map((p, i) => (
        <Animated.View
          key={i}
          style={{
            position: 'absolute',
            width: p.size,
            height: p.size,
            borderRadius: 2,
            backgroundColor: burst.color,
            opacity: p.anim.interpolate({ inputRange: [0, 0.7, 1], outputRange: [1, 0.9, 0] }),
            transform: [
              { translateX: p.anim.interpolate({ inputRange: [0, 1], outputRange: [0, p.dx] }) },
              { translateY: p.anim.interpolate({ inputRange: [0, 1], outputRange: [0, p.dy] }) },
              { scale: p.anim.interpolate({ inputRange: [0, 1], outputRange: [1.2, 0.4] }) },
            ],
          }}
        />
      ))}
    </View>
  );
}

// ─── SFX hook ────────────────────────────────────────────────────────────────
function useSfx() {
  const ref = useRef<Partial<Record<keyof typeof SFX_FILES, Audio.Sound>>>({});
  useEffect(() => {
    let alive = true;
    Audio.setAudioModeAsync({ playsInSilentModeIOS: true }).catch(() => {});
    Promise.all(
      (Object.keys(SFX_FILES) as (keyof typeof SFX_FILES)[]).map(async k => {
        const { sound } = await Audio.Sound.createAsync(SFX_FILES[k], { shouldPlay: false, volume: 0.8 });
        if (alive) ref.current[k] = sound;
        else sound.unloadAsync().catch(() => {});
      }),
    ).catch(() => {});
    return () => {
      alive = false;
      Object.values(ref.current).forEach(s => s?.unloadAsync().catch(() => {}));
      ref.current = {};
    };
  }, []);
  return useCallback(async (k: keyof typeof SFX_FILES) => {
    try { await ref.current[k]?.setPositionAsync(0); await ref.current[k]?.playAsync(); } catch {}
  }, []);
}

// ─── Main BattleScreen ────────────────────────────────────────────────────────
export default function BattleScreen() {
  const router = useRouter();
  const { user } = useAuthContext();
  const heroName = user?.user_metadata?.full_name?.split(' ')[0]
    ?? user?.user_metadata?.name?.split(' ')[0]
    ?? user?.email?.split('@')[0]
    ?? 'You';

  const { width, height } = useWindowDimensions();
  const playSfx = useSfx();

  const [heroFighter, setHeroFighter]   = useState<FighterId>('soldier');
  const [rivalFighter, setRivalFighter] = useState<FighterId>('slime');
  const [subject, setSubject]           = useState<SubjectFilter>('mix');
  const [heroAnim, setHeroAnim]         = useState<SpriteState>('idle');
  const [rivalAnim, setRivalAnim]       = useState<SpriteState>('idle');
  const [showLobby, setShowLobby]       = useState(true);
  const [bursts, setBursts]             = useState<Burst[]>([]);

  const game = useFightingGame(heroName, subject);
  const { state } = game;

  const spawnBurst = useCallback((side: 'hero' | 'rival', color: string, big = false) => {
    const id = `burst-${Date.now()}-${Math.random()}`;
    setBursts(b => [...b.slice(-4), { id, side, color, big }]);
    setTimeout(() => setBursts(b => b.filter(x => x.id !== id)), 640);
  }, []);

  // ── Shake & flash anims ───────────────────────────────────────────────────
  const shakeAnim  = useRef(new Animated.Value(0)).current;
  const flashAnim  = useRef(new Animated.Value(0)).current;
  const warnAnim   = useRef(new Animated.Value(0)).current;
  const qSlideAnim = useRef(new Animated.Value(300)).current;
  const cdAnim     = useRef(new Animated.Value(0)).current;
  const comboPop   = useRef(new Animated.Value(0)).current;
  const vignette   = useRef(new Animated.Value(0)).current;

  const heroMoveX  = useRef(new Animated.Value(0)).current;
  const rivalMoveX = useRef(new Animated.Value(0)).current;
  const heroIdleY  = useRef(new Animated.Value(0)).current;
  const rivalIdleY = useRef(new Animated.Value(0)).current;

  const heroResetRef  = useRef<ReturnType<typeof setTimeout> | null>(null);
  const rivalResetRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const prevEventRef  = useRef<MatchEvent | null>(null);

  // Idle float
  useEffect(() => {
    const loop = (anim: Animated.Value) => Animated.loop(Animated.sequence([
      Animated.timing(anim, { toValue: -5, duration: 900, easing: Easing.inOut(Easing.sin), useNativeDriver: true }),
      Animated.timing(anim, { toValue: 0,  duration: 900, easing: Easing.inOut(Easing.sin), useNativeDriver: true }),
    ]));
    const a = loop(heroIdleY);
    const b = loop(rivalIdleY);
    a.start(); b.start();
    return () => { a.stop(); b.stop(); };
  }, [heroIdleY, rivalIdleY]);

  const shake = useCallback((large = false) => {
    shakeAnim.setValue(0);
    const s = large ? 10 : 5;
    Animated.sequence([
      Animated.timing(shakeAnim, { toValue: s,    duration: 30, useNativeDriver: true }),
      Animated.timing(shakeAnim, { toValue: -s,   duration: 36, useNativeDriver: true }),
      Animated.timing(shakeAnim, { toValue: s*0.5,duration: 36, useNativeDriver: true }),
      Animated.timing(shakeAnim, { toValue: 0,    duration: 44, useNativeDriver: true }),
    ]).start();
  }, [shakeAnim]);

  const flash = useCallback((large = false) => {
    Animated.sequence([
      Animated.timing(flashAnim, { toValue: large ? 0.55 : 0.28, duration: 60, useNativeDriver: true }),
      Animated.timing(flashAnim, { toValue: 0, duration: 200, useNativeDriver: true }),
    ]).start();
  }, [flashAnim]);

  const triggerHero = useCallback((anim: SpriteState, ms = 500) => {
    setHeroAnim(anim);
    if (heroResetRef.current) clearTimeout(heroResetRef.current);
    if (anim !== 'idle' && anim !== 'death') heroResetRef.current = setTimeout(() => setHeroAnim('idle'), ms);
    if (anim === 'attack' || anim === 'special') {
      Animated.sequence([
        Animated.timing(heroMoveX, { toValue: 28, duration: 120, easing: Easing.out(Easing.quad), useNativeDriver: true }),
        Animated.timing(heroMoveX, { toValue: 0,  duration: 280, easing: Easing.out(Easing.back(1.6)), useNativeDriver: true }),
      ]).start();
    }
    if (anim === 'hurt') {
      Animated.sequence([
        Animated.timing(heroMoveX, { toValue: -20, duration: 80,  useNativeDriver: true }),
        Animated.timing(heroMoveX, { toValue: 0,   duration: 220, easing: Easing.out(Easing.back(1.2)), useNativeDriver: true }),
      ]).start();
    }
  }, [heroMoveX]);

  const triggerRival = useCallback((anim: SpriteState, ms = 500) => {
    setRivalAnim(anim);
    if (rivalResetRef.current) clearTimeout(rivalResetRef.current);
    if (anim !== 'idle' && anim !== 'death') rivalResetRef.current = setTimeout(() => setRivalAnim('idle'), ms);
    if (anim === 'attack' || anim === 'special') {
      Animated.sequence([
        Animated.timing(rivalMoveX, { toValue: -28, duration: 120, easing: Easing.out(Easing.quad), useNativeDriver: true }),
        Animated.timing(rivalMoveX, { toValue: 0,   duration: 280, easing: Easing.out(Easing.back(1.6)), useNativeDriver: true }),
      ]).start();
    }
    if (anim === 'hurt') {
      Animated.sequence([
        Animated.timing(rivalMoveX, { toValue: 20, duration: 80,  useNativeDriver: true }),
        Animated.timing(rivalMoveX, { toValue: 0,  duration: 220, easing: Easing.out(Easing.back(1.2)), useNativeDriver: true }),
      ]).start();
    }
  }, [rivalMoveX]);

  // React to game events
  useEffect(() => {
    const ev = state.lastEvent;
    if (!ev || ev === prevEventRef.current) return;
    prevEventRef.current = ev;

    switch (ev) {
      case 'rival_hit':
        triggerHero('attack', 480);
        triggerRival('hurt', 320);
        playSfx('hit');
        flash();
        spawnBurst('rival', '#4ADE80');
        break;
      case 'rival_special':
        triggerHero('special', 560);
        triggerRival('hurt', 420);
        playSfx('clash');
        shake(true);
        flash(true);
        spawnBurst('rival', '#FACC15', true);
        break;
      case 'hero_hit':
        triggerRival('attack', 480);
        triggerHero('hurt', 320);
        playSfx('hit');
        shake();
        spawnBurst('hero', '#EF4444');
        break;
      case 'rival_blocked':
        triggerRival('attack', 480);
        triggerHero('block', 480);
        playSfx('wrong');
        break;
      case 'hero_blocked':
        triggerRival('attack', 480);
        triggerHero('block', 480);
        playSfx('wrong');
        break;
      case 'hero_miss':
        triggerHero('attack', 480);
        playSfx('wrong');
        break;
      case 'ko':
        playSfx('clash');
        shake(true);
        flash(true);
        spawnBurst('hero', '#FACC15', true);
        spawnBurst('rival', '#EF4444', true);
        break;
    }
  }, [state.lastEvent, flash, playSfx, shake, spawnBurst, triggerHero, triggerRival]);

  // Combo text pop
  useEffect(() => {
    if (state.comboText) {
      comboPop.setValue(0);
      Animated.spring(comboPop, { toValue: 1, tension: 120, friction: 7, useNativeDriver: true }).start();
    }
  }, [state.comboText, comboPop]);

  // Low-HP danger vignette (flat red edge pulse — no glow disc)
  useEffect(() => {
    const danger = state.heroHp > 0 && state.heroHp / game.MAX_HP <= 0.3 && state.phase === 'fight';
    if (danger) {
      const loop = Animated.loop(Animated.sequence([
        Animated.timing(vignette, { toValue: 0.5, duration: 620, useNativeDriver: true }),
        Animated.timing(vignette, { toValue: 0.12, duration: 620, useNativeDriver: true }),
      ]));
      loop.start();
      return () => { loop.stop(); vignette.setValue(0); };
    }
    vignette.setValue(0);
  }, [state.heroHp, state.phase, game.MAX_HP, vignette]);

  // Hero blocking → block sprite
  useEffect(() => {
    if (state.heroBlocking) triggerHero('block', 2000);
  }, [state.heroBlocking, triggerHero]);

  // KO animations
  useEffect(() => {
    if (state.heroHp <= 0) { setHeroAnim('death'); if (heroResetRef.current) clearTimeout(heroResetRef.current); }
    if (state.rivalHp <= 0) { setRivalAnim('death'); if (rivalResetRef.current) clearTimeout(rivalResetRef.current); }
  }, [state.heroHp, state.rivalHp]);

  // Question slide
  useEffect(() => {
    if (state.questionPhase === 'active') {
      Animated.spring(qSlideAnim, { toValue: 0, tension: 68, friction: 9, useNativeDriver: true }).start();
    } else {
      Animated.timing(qSlideAnim, { toValue: 320, duration: 220, easing: Easing.in(Easing.quad), useNativeDriver: true }).start();
    }
  }, [state.questionPhase, qSlideAnim]);

  // Incoming warning pulse
  useEffect(() => {
    if (state.incomingWarn.active) {
      Animated.loop(Animated.sequence([
        Animated.timing(warnAnim, { toValue: 1, duration: 180, useNativeDriver: true }),
        Animated.timing(warnAnim, { toValue: 0, duration: 180, useNativeDriver: true }),
      ])).start();
    } else {
      warnAnim.stopAnimation();
      warnAnim.setValue(0);
    }
  }, [state.incomingWarn.active, warnAnim]);

  // Countdown anim
  useEffect(() => {
    if (state.phase === 'countdown') {
      cdAnim.setValue(0);
      Animated.spring(cdAnim, { toValue: 1, tension: 80, friction: 6, useNativeDriver: true }).start();
    }
  }, [state.countdownNum, state.phase, cdAnim]);

  useEffect(() => () => {
    if (heroResetRef.current) clearTimeout(heroResetRef.current);
    if (rivalResetRef.current) clearTimeout(rivalResetRef.current);
  }, []);

  const arenaH = Math.round(height * 0.52);
  const spriteScale = width < 380 ? 1.1 : 1.4;

  // ── HP bar color ──────────────────────────────────────────────────────────
  function hpColor(pct: number) {
    if (pct > 0.5) return '#22C55E';
    if (pct > 0.25) return '#FBBF24';
    return '#EF4444';
  }

  // ─────────────────────────────────────────────────────────────────────────────
  // LOBBY
  // ─────────────────────────────────────────────────────────────────────────────
  if (showLobby) {
    return (
      <View style={g.root}>
        <StatusBar barStyle="light-content" />
        <Image source={ARENA_BG} style={g.arenaBgFixed} resizeMode="cover" />
        <LinearGradient colors={['rgba(5,8,20,0.6)', 'rgba(5,8,20,0.96)']} style={StyleSheet.absoluteFill} />

        <SafeAreaView style={g.safe}>
          <View style={g.lobbyTopBar}>
            <TouchableOpacity style={g.iconBtn} onPress={() => router.back()}>
              <Ionicons name="chevron-back" size={20} color="#FFF7ED" />
            </TouchableOpacity>
          </View>

          <View style={g.lobbyHero}>
            <LinearGradient colors={['#FACC15', '#F97316']} style={g.logoGrad} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }}>
              <Text style={g.logoText}>GYAN{'\n'}CLASH</Text>
            </LinearGradient>
            <Text style={g.lobbyTagline}>KNOWLEDGE  •  POWER  •  GLORY</Text>
          </View>

          <View style={g.lobbyFighterRow}>
            {(['soldier', 'slime'] as FighterId[]).map((fid, i) => (
              <TouchableOpacity key={fid}
                style={[g.lobbyFighterCard, heroFighter === fid && { borderColor: FIGHTERS[fid].accent, borderWidth: 2.5 }]}
                onPress={() => { setHeroFighter(fid); setRivalFighter(fid === 'soldier' ? 'slime' : 'soldier'); }}>
                <Sprite id={fid} side="left" anim="idle" scale={spriteScale * 0.85} />
                <Text style={[g.lobbyFighterName, { color: FIGHTERS[fid].accent }]}>{FIGHTERS[fid].name}</Text>
                {heroFighter === fid && <View style={[g.selBadge, { backgroundColor: FIGHTERS[fid].accent }]}><Text style={g.selBadgeText}>YOU</Text></View>}
              </TouchableOpacity>
            ))}
          </View>

          <View style={g.lobbySubjectWrap}>
            <Text style={g.sectionLabel}>CHOOSE SUBJECT</Text>
            <View style={g.subjectGrid}>
              {SUBJECTS.map(sub => (
                <TouchableOpacity key={sub.id}
                  style={[g.subjectChip, subject === sub.id && { backgroundColor: sub.color }]}
                  onPress={() => setSubject(sub.id)}>
                  <Text style={[g.subjectChipText, subject === sub.id && { color: '#111827' }]}>{sub.label}</Text>
                </TouchableOpacity>
              ))}
            </View>
          </View>

          <View style={g.lobbyBtns}>
            <TouchableOpacity style={g.fightBtn} onPress={() => { GyanClashSound.play('swoosh'); setShowLobby(false); game.startFight(subject); }}>
              <LinearGradient colors={['#FACC15', '#F97316']} start={{ x: 0, y: 0 }} end={{ x: 1, y: 0 }} style={g.fightBtnGrad}>
                <Ionicons name="flash" size={22} color="#111827" />
                <Text style={g.fightBtnText}>FIGHT!</Text>
              </LinearGradient>
            </TouchableOpacity>
          </View>
        </SafeAreaView>
      </View>
    );
  }

  // ─────────────────────────────────────────────────────────────────────────────
  // COUNTDOWN
  // ─────────────────────────────────────────────────────────────────────────────
  if (state.phase === 'countdown' || state.phase === 'intro') {
    const cdScale = cdAnim.interpolate({ inputRange: [0, 1], outputRange: [0.3, 1] });
    return (
      <View style={g.root}>
        <StatusBar barStyle="light-content" />
        <Image source={ARENA_BG} style={g.arenaBgFixed} resizeMode="cover" />
        <LinearGradient colors={['rgba(5,8,20,0.45)', 'rgba(5,8,20,0.82)']} style={StyleSheet.absoluteFill} />

        <SafeAreaView style={[g.safe, { alignItems: 'center', justifyContent: 'center' }]}>
          <Text style={g.cdMatchup}>{state.heroName}  VS  {state.rivalName}</Text>

          <View style={g.cdFightersRow}>
            <View style={g.cdFighterWrap}>
              <View style={[g.cdGlow, { shadowColor: FIGHTERS[heroFighter].accent }]}>
                <Sprite id={heroFighter} side="left" anim="idle" scale={spriteScale * 1.1} />
              </View>
              <Text style={[g.cdFighterLabel, { color: FIGHTERS[heroFighter].accent }]}>{FIGHTERS[heroFighter].name}</Text>
            </View>

            <View style={g.cdCenter}>
              {state.countdownNum > 0 ? (
                <Animated.Text style={[g.cdNum, { transform: [{ scale: cdScale }] }]}>
                  {state.countdownNum}
                </Animated.Text>
              ) : (
                <Animated.Text style={[g.cdFight, { transform: [{ scale: cdScale }] }]}>
                  FIGHT!
                </Animated.Text>
              )}
            </View>

            <View style={g.cdFighterWrap}>
              <View style={[g.cdGlow, { shadowColor: FIGHTERS[rivalFighter].accent }]}>
                <Sprite id={rivalFighter} side="right" anim="idle" scale={spriteScale * 1.1} />
              </View>
              <Text style={[g.cdFighterLabel, { color: FIGHTERS[rivalFighter].accent }]}>{state.rivalName}</Text>
            </View>
          </View>

          <Text style={g.cdSubject}>{SUBJECTS.find(s => s.id === state.subject)?.label ?? 'Full Mix'}</Text>
          <Text style={g.cdRound}>ROUND {state.round}</Text>
        </SafeAreaView>
      </View>
    );
  }

  // ─────────────────────────────────────────────────────────────────────────────
  // RESULT
  // ─────────────────────────────────────────────────────────────────────────────
  if (state.phase === 'result') {
    const won = state.heroWins >= 2;
    const accuracy = state.totalAnswered > 0
      ? Math.round((state.totalCorrect / state.totalAnswered) * 100)
      : 0;
    return (
      <View style={g.root}>
        <StatusBar barStyle="light-content" />
        <Image source={ARENA_BG} style={g.arenaBgFixed} resizeMode="cover" />
        <LinearGradient colors={['rgba(5,8,20,0.6)', 'rgba(5,8,20,0.97)']} style={StyleSheet.absoluteFill} />

        <SafeAreaView style={[g.safe, { alignItems: 'center', justifyContent: 'center', paddingHorizontal: 20 }]}>
          <LinearGradient
            colors={won ? ['rgba(34,197,94,0.3)', 'transparent'] : ['rgba(239,68,68,0.3)', 'transparent']}
            style={g.resultGlow}
          />

          <Text style={[g.resultVerdict, { color: won ? '#22C55E' : '#EF4444' }]}>
            {won ? 'VIJAY!' : 'HAAAR!'}
          </Text>
          <Text style={g.resultSubVerdict}>{won ? 'You conquered the arena!' : 'Train harder, warrior.'}</Text>

          <View style={g.resultFighters}>
            <View style={g.resultFighterCol}>
              <Sprite id={heroFighter} side="left" anim={won ? 'idle' : 'death'} scale={spriteScale} />
              <Text style={[g.resultFighterName, { color: FIGHTERS[heroFighter].accent }]}>{state.heroName}</Text>
              <Text style={g.resultScore}>{state.heroScore} pts</Text>
            </View>
            <View style={g.resultMidCol}>
              <Text style={g.resultVs}>{state.heroWins}-{state.rivalWins}</Text>
              <Text style={g.resultRoundsLabel}>ROUNDS</Text>
            </View>
            <View style={g.resultFighterCol}>
              <Sprite id={rivalFighter} side="right" anim={won ? 'death' : 'idle'} scale={spriteScale} />
              <Text style={[g.resultFighterName, { color: FIGHTERS[rivalFighter].accent }]}>{state.rivalName}</Text>
              <Text style={g.resultScore}>Bot</Text>
            </View>
          </View>

          <View style={g.statsRow}>
            {[
              { label: 'Accuracy', value: `${accuracy}%` },
              { label: 'Correct',  value: `${state.totalCorrect}/${state.totalAnswered}` },
              { label: 'Max Combo',value: `${state.heroStreak}x` },
              { label: 'Subject',  value: SUBJECTS.find(s => s.id === state.subject)?.label ?? 'Mix' },
            ].map(st => (
              <View key={st.label} style={g.statBox}>
                <Text style={g.statVal}>{st.value}</Text>
                <Text style={g.statLbl}>{st.label}</Text>
              </View>
            ))}
          </View>

          <TouchableOpacity style={g.rematchBtn} onPress={() => { game.startFight(state.subject); }}>
            <LinearGradient colors={['#FACC15', '#F97316']} start={{ x: 0, y: 0 }} end={{ x: 1, y: 0 }} style={g.rematchGrad}>
              <Ionicons name="refresh" size={18} color="#111827" />
              <Text style={g.rematchText}>REMATCH</Text>
            </LinearGradient>
          </TouchableOpacity>

          <View style={g.resultSecondary}>
            <TouchableOpacity style={g.secondaryBtn} onPress={game.shareResult}>
              <Ionicons name="share-social" size={16} color="#94A3B8" />
              <Text style={g.secondaryBtnText}>Share</Text>
            </TouchableOpacity>
            <TouchableOpacity style={g.secondaryBtn} onPress={() => { setShowLobby(true); }}>
              <Ionicons name="home" size={16} color="#94A3B8" />
              <Text style={g.secondaryBtnText}>Lobby</Text>
            </TouchableOpacity>
          </View>
        </SafeAreaView>
      </View>
    );
  }

  // ─────────────────────────────────────────────────────────────────────────────
  // BATTLE  (fight | ko phases)
  // ─────────────────────────────────────────────────────────────────────────────
  const heroPct  = state.heroHp  / game.MAX_HP;
  const rivalPct = state.rivalHp / game.MAX_HP;
  const timerPct = state.questionTimerMs / game.Q_TIMER_MS;
  const warnBorder = warnAnim.interpolate({ inputRange: [0, 1], outputRange: [1, 3] });
  const warnColor  = state.incomingWarn.moveType === 'special' ? '#FACC15' : '#EF4444';

  return (
    <View style={g.root}>
      <StatusBar barStyle="light-content" />

      {/* Arena background with parallax drift */}
      <Image source={ARENA_BG} style={g.arenaBgFixed} resizeMode="cover" />
      <LinearGradient colors={['rgba(5,8,20,0.18)', 'rgba(5,8,20,0.72)']} style={StyleSheet.absoluteFill} />

      {/* White flash on big hit */}
      <Animated.View style={[StyleSheet.absoluteFill, { backgroundColor: '#FFF', opacity: flashAnim, pointerEvents: 'none' }]} />

      {/* Low-HP danger frame (flat red edge, pulses) */}
      <Animated.View
        pointerEvents="none"
        style={[StyleSheet.absoluteFill, { borderWidth: 9, borderColor: '#EF4444', opacity: vignette }]}
      />

      {/* ── Top HUD ─────────────────────────────────────────────────────────── */}
      <SafeAreaView style={g.safe} pointerEvents="box-none">
        <Animated.View style={[g.hudWrap, { transform: [{ translateX: shakeAnim }] }]}>
          {/* Round badge */}
          <View style={g.roundBadge}>
            <Text style={g.roundText}>RND {state.round}</Text>
          </View>

          {/* Hero HP */}
          <View style={g.hudPlayerLeft}>
            <Text style={g.hudName} numberOfLines={1}>{state.heroName}</Text>
            <View style={g.hpTrack}>
              <View style={[g.hpFill, { width: `${heroPct * 100}%`, backgroundColor: hpColor(heroPct) }]} />
            </View>
            <Text style={g.hudHpNum}>{state.heroHp} HP</Text>
          </View>

          {/* Rival HP */}
          <View style={g.hudPlayerRight}>
            <Text style={[g.hudName, { textAlign: 'right' }]} numberOfLines={1}>{state.rivalName}</Text>
            <View style={g.hpTrack}>
              <View style={[g.hpFill, { width: `${rivalPct * 100}%`, backgroundColor: hpColor(rivalPct), alignSelf: 'flex-end' }]} />
            </View>
            <Text style={[g.hudHpNum, { textAlign: 'right' }]}>{state.rivalHp} HP</Text>
          </View>

          {/* Win dots */}
          <View style={g.winsRow}>
            {[0, 1].map(i => (
              <View key={i} style={[g.winDot, i < state.heroWins && g.winDotFilled]} />
            ))}
            <View style={g.winDotSpacer} />
            {[0, 1].map(i => (
              <View key={i} style={[g.winDot, i < state.rivalWins && { backgroundColor: '#EF4444' }]} />
            ))}
          </View>
        </Animated.View>

        {/* ── Arena fighters ───────────────────────────────────────────────── */}
        <View style={[g.arenaStage, { height: arenaH }]} pointerEvents="none">
          {/* Hero */}
          <Animated.View style={[g.heroPos, { transform: [{ translateX: heroMoveX }, { translateY: heroIdleY }] }]}>
            {state.heroCharged && (
              <View style={[g.chargeAura, { shadowColor: FIGHTERS[heroFighter].accent, borderColor: FIGHTERS[heroFighter].accent }]} />
            )}
            <Sprite id={heroFighter} side="left" anim={heroAnim} scale={spriteScale} />
          </Animated.View>

          {/* Rival */}
          <Animated.View style={[g.rivalPos, { transform: [{ translateX: rivalMoveX }, { translateY: rivalIdleY }] }]}>
            {state.rivalHp < 60 && state.rivalHp > 0 && (
              <View style={[g.chargeAura, { shadowColor: '#EF4444', borderColor: '#EF4444' }]} />
            )}
            <Sprite id={rivalFighter} side="right" anim={rivalAnim} scale={spriteScale} />
          </Animated.View>

          {/* Floating hit texts */}
          {state.floatingHits.map(hit => (
            <FloatText key={hit.id} hit={hit} arenaWidth={width} />
          ))}

          {/* Spark bursts on impact */}
          {bursts.map(b => (
            <SparkBurst key={b.id} burst={b} arenaWidth={width} />
          ))}

          {/* Combo text */}
          {state.comboText && (
            <Animated.Text
              style={[g.comboText, {
                transform: [
                  { scale: comboPop.interpolate({ inputRange: [0, 1], outputRange: [0.4, 1] }) },
                  { translateY: comboPop.interpolate({ inputRange: [0, 1], outputRange: [10, 0] }) },
                ],
              }]}
            >
              {state.comboText}
            </Animated.Text>
          )}

          {/* Incoming warning */}
          {state.incomingWarn.active && (
            <Animated.View style={[g.incomingWarn, { borderColor: warnColor, borderWidth: warnBorder }]}>
              <Ionicons name="warning" size={14} color={warnColor} />
              <Text style={[g.incomingText, { color: warnColor }]}>
                {state.incomingWarn.moveType === 'special' ? 'SPECIAL INCOMING!' : 'INCOMING ATTACK!'}
              </Text>
            </Animated.View>
          )}

          {/* KO banner */}
          {state.phase === 'ko' && (
            <View style={g.koBanner}>
              <Text style={g.koText}>K . O .</Text>
            </View>
          )}
        </View>

        {/* ── Question panel (slides up) ────────────────────────────────────── */}
        <Animated.View style={[g.questionPanel, { transform: [{ translateY: qSlideAnim }] }]}>
          {state.currentQuestion && (
            <>
              {/* Timer bar */}
              <View style={g.timerTrack}>
                <View style={[g.timerFill, { width: `${timerPct * 100}%`, backgroundColor: timerPct > 0.4 ? '#22C55E' : '#EF4444' }]} />
              </View>
              <View style={g.qTopRow}>
                <View style={g.subjectPill}>
                  <Text style={g.subjectPillText}>{state.currentQuestion.subject}</Text>
                </View>
                <Text style={g.diffText}>{state.currentQuestion.difficulty.toUpperCase()}</Text>
                <Text style={[g.qMoveTag, { color: state.pendingMoveType === 'special' ? '#FACC15' : '#4ADE80' }]}>
                  {state.pendingMoveType === 'special' ? 'SPECIAL MOVE' : 'ATTACK'}
                </Text>
              </View>
              <Text style={g.qText}>{state.currentQuestion.prompt}</Text>
              <View style={g.choicesGrid}>
                {state.currentQuestion.choices.map(ch => (
                  <TouchableOpacity key={ch.id} style={g.choice}
                    onPress={() => game.answerQuestion(ch.id)}
                    disabled={state.questionPhase === 'resolving'}>
                    <Text style={g.choiceKey}>{ch.id.toUpperCase()}</Text>
                    <Text style={g.choiceText}>{ch.text}</Text>
                  </TouchableOpacity>
                ))}
              </View>
            </>
          )}
        </Animated.View>

        {/* ── Combat controls ───────────────────────────────────────────────── */}
        {state.questionPhase === 'idle' && state.phase === 'fight' && (
          <View style={g.controlRow}>
            <TouchableOpacity
              style={[g.blockBtn, state.heroBlocking && g.blockBtnActive]}
              onPress={game.playerBlock}
              activeOpacity={0.78}>
              <Ionicons name="shield" size={22} color={state.heroBlocking ? '#60A5FA' : '#94A3B8'} />
              <Text style={[g.blockBtnText, state.heroBlocking && { color: '#60A5FA' }]}>BLOCK</Text>
            </TouchableOpacity>

            <TouchableOpacity
              style={[g.attackBtn, state.attackOnCooldown && g.attackBtnCooldown]}
              onPress={() => game.playerAttack('attack')}
              disabled={state.attackOnCooldown}
              activeOpacity={0.82}>
              <LinearGradient
                colors={state.attackOnCooldown ? ['#334155', '#1E293B'] : ['#22C55E', '#16A34A']}
                start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }}
                style={g.attackBtnGrad}>
                <MaterialCommunityIcons name="sword" size={26} color="#FFF7ED" />
                <Text style={g.attackBtnText}>ATTACK</Text>
              </LinearGradient>
            </TouchableOpacity>

            <TouchableOpacity
              style={[g.specialBtn, !state.heroCharged && g.specialBtnOff]}
              onPress={() => game.playerAttack('special')}
              disabled={!state.heroCharged}
              activeOpacity={0.78}>
              {state.heroCharged ? (
                <LinearGradient colors={['#FACC15', '#F97316']} style={g.specialBtnGrad}>
                  <MaterialCommunityIcons name="lightning-bolt" size={20} color="#111827" />
                  <Text style={g.specialBtnText}>SPECIAL</Text>
                </LinearGradient>
              ) : (
                <>
                  <MaterialCommunityIcons name="lightning-bolt" size={20} color="#334155" />
                  <Text style={[g.specialBtnText, { color: '#334155' }]}>
                    {state.heroStreak}/3
                  </Text>
                </>
              )}
            </TouchableOpacity>
          </View>
        )}

        {/* Streak indicator under controls */}
        {state.heroStreak > 0 && state.phase === 'fight' && (
          <View style={g.streakBar}>
            {[1, 2, 3, 4, 5].map(i => (
              <View key={i} style={[g.streakDot, i <= state.heroStreak && g.streakDotFilled]} />
            ))}
            <Text style={g.streakLabel}>{state.heroStreak >= 5 ? 'MAX COMBO' : `${state.heroStreak} HIT STREAK`}</Text>
          </View>
        )}
      </SafeAreaView>
    </View>
  );
}

// ─── Styles ───────────────────────────────────────────────────────────────────
const g = StyleSheet.create({
  root:        { flex: 1, backgroundColor: '#050814' },
  safe:        { flex: 1 },
  arenaBgFixed:{ position: 'absolute', top: 0, left: 0, right: 0, bottom: 0 },

  // ── Lobby ───────────────────────────────────────────────────────────────────
  lobbyTopBar:   { paddingHorizontal: 16, paddingTop: 8, paddingBottom: 4, flexDirection: 'row', alignItems: 'center' },
  iconBtn:       { width: 38, height: 38, borderRadius: 12, backgroundColor: 'rgba(15,23,42,0.72)', borderWidth: 1, borderColor: 'rgba(255,255,255,0.12)', alignItems: 'center', justifyContent: 'center' },
  lobbyHero:     { alignItems: 'center', paddingTop: 16, paddingBottom: 24 },
  logoGrad:      { borderRadius: 20, paddingHorizontal: 28, paddingVertical: 14, alignItems: 'center' },
  logoText:      { fontFamily: 'Poppins-Bold', fontSize: 46, color: '#111827', letterSpacing: 5, textAlign: 'center', lineHeight: 52 },
  lobbyTagline:  { marginTop: 12, fontFamily: 'Inter-SemiBold', fontSize: 11, color: '#475569', letterSpacing: 2, textTransform: 'uppercase' },
  lobbyFighterRow:{ flexDirection: 'row', paddingHorizontal: 20, gap: 12, marginBottom: 24 },
  lobbyFighterCard:{ flex: 1, borderRadius: 18, backgroundColor: 'rgba(15,23,42,0.72)', borderWidth: 1, borderColor: 'rgba(255,255,255,0.1)', alignItems: 'center', paddingVertical: 16, overflow: 'hidden' },
  lobbyFighterName:{ fontFamily: 'Poppins-Bold', fontSize: 13, marginTop: 6 },
  selBadge:      { position: 'absolute', top: 8, right: 8, borderRadius: 6, paddingHorizontal: 6, paddingVertical: 2 },
  selBadgeText:  { fontFamily: 'Poppins-Bold', fontSize: 9, color: '#111827' },
  lobbySubjectWrap:{ paddingHorizontal: 20, marginBottom: 24 },
  sectionLabel:  { fontFamily: 'Inter-SemiBold', fontSize: 10, color: '#475569', letterSpacing: 1.5, textTransform: 'uppercase', marginBottom: 10 },
  subjectGrid:   { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  subjectChip:   { paddingHorizontal: 14, paddingVertical: 8, borderRadius: 999, borderWidth: 1, borderColor: 'rgba(255,255,255,0.14)', backgroundColor: 'rgba(15,23,42,0.72)' },
  subjectChipText:{ fontFamily: 'Inter-SemiBold', fontSize: 12, color: '#94A3B8' },
  lobbyBtns:     { paddingHorizontal: 20 },
  fightBtn:      { borderRadius: 18, overflow: 'hidden' },
  fightBtnGrad:  { height: 60, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 10 },
  fightBtnText:  { fontFamily: 'Poppins-Bold', fontSize: 20, color: '#111827', letterSpacing: 2 },

  // ── Countdown ───────────────────────────────────────────────────────────────
  cdMatchup:      { fontFamily: 'Poppins-Bold', fontSize: 17, color: '#CBD5E1', letterSpacing: 1, marginBottom: 36 },
  cdFightersRow:  { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', width: '100%', paddingHorizontal: 16 },
  cdFighterWrap:  { alignItems: 'center', flex: 1 },
  cdGlow:         { shadowOffset: { width: 0, height: 0 }, shadowOpacity: 0.8, shadowRadius: 28, elevation: 14 },
  cdFighterLabel: { fontFamily: 'Poppins-Bold', fontSize: 12, marginTop: 8 },
  cdCenter:       { width: 80, alignItems: 'center' },
  cdNum:          { fontFamily: 'Poppins-Bold', fontSize: 96, color: '#FACC15', textShadowColor: 'rgba(250,204,21,0.7)', textShadowOffset: { width: 0, height: 0 }, textShadowRadius: 32 },
  cdFight:        { fontFamily: 'Poppins-Bold', fontSize: 28, color: '#22C55E', textShadowColor: 'rgba(34,197,94,0.7)', textShadowOffset: { width: 0, height: 0 }, textShadowRadius: 22 },
  cdSubject:      { marginTop: 42, fontFamily: 'Inter-SemiBold', fontSize: 13, color: '#64748B', textTransform: 'uppercase', letterSpacing: 1.8 },
  cdRound:        { marginTop: 6, fontFamily: 'Poppins-Bold', fontSize: 22, color: '#FACC15', letterSpacing: 2.5 },

  // ── Battle HUD ───────────────────────────────────────────────────────────────
  hudWrap:       { flexDirection: 'row', alignItems: 'flex-start', paddingHorizontal: 14, paddingTop: 10, gap: 8 },
  roundBadge:    { position: 'absolute', top: 10, left: '50%', transform: [{ translateX: -28 }], backgroundColor: '#FACC15', paddingHorizontal: 8, paddingVertical: 3, borderRadius: 8, zIndex: 2 },
  roundText:     { fontFamily: 'Poppins-Bold', fontSize: 11, color: '#111827', letterSpacing: 1 },
  hudPlayerLeft: { flex: 1 },
  hudPlayerRight:{ flex: 1, alignItems: 'flex-end' },
  hudName:       { fontFamily: 'Poppins-Bold', fontSize: 12, color: '#FFF7ED', marginBottom: 4 },
  hpTrack:       { height: 12, borderRadius: 7, backgroundColor: 'rgba(255,255,255,0.1)', overflow: 'hidden', width: '100%' },
  hpFill:        { height: '100%', borderRadius: 7, minWidth: 4 },
  hudHpNum:      { fontFamily: 'Inter-SemiBold', fontSize: 10, color: '#64748B', marginTop: 2 },
  winsRow:       { position: 'absolute', bottom: -16, left: 0, right: 0, flexDirection: 'row', justifyContent: 'center', alignItems: 'center', gap: 4 },
  winDot:        { width: 10, height: 10, borderRadius: 5, borderWidth: 1.5, borderColor: '#475569' },
  winDotFilled:  { backgroundColor: '#22C55E', borderColor: '#22C55E' },
  winDotSpacer:  { width: 24 },

  // ── Arena ─────────────────────────────────────────────────────────────────────
  arenaStage:    { position: 'relative', width: '100%', marginTop: 24 },
  heroPos:       { position: 'absolute', left: '8%', bottom: 0 },
  rivalPos:      { position: 'absolute', right: '8%', bottom: 0 },
  chargeAura:    { position: 'absolute', top: -8, left: -8, right: -8, bottom: -8, borderRadius: 99, borderWidth: 2, shadowOffset: { width: 0, height: 0 }, shadowOpacity: 0.9, shadowRadius: 20, elevation: 12 },
  floatText:     { position: 'absolute', bottom: '60%', fontFamily: 'Poppins-Bold', fontSize: 18, textShadowColor: 'rgba(0,0,0,0.6)', textShadowOffset: { width: 1, height: 1 }, textShadowRadius: 4 },
  comboText:     { position: 'absolute', top: '20%', alignSelf: 'center', left: '25%', fontFamily: 'Poppins-Bold', fontSize: 22, color: '#FACC15', textShadowColor: 'rgba(250,204,21,0.8)', textShadowOffset: { width: 0, height: 0 }, textShadowRadius: 18 },
  incomingWarn:  { position: 'absolute', bottom: '15%', alignSelf: 'center', left: '20%', right: '20%', flexDirection: 'row', alignItems: 'center', gap: 6, borderRadius: 10, borderWidth: 2, paddingHorizontal: 12, paddingVertical: 6, backgroundColor: 'rgba(5,8,20,0.82)' },
  incomingText:  { fontFamily: 'Poppins-Bold', fontSize: 12, letterSpacing: 0.8 },
  koBanner:      { ...StyleSheet.absoluteFillObject, alignItems: 'center', justifyContent: 'center', backgroundColor: 'rgba(5,8,20,0.55)' },
  koText:        { fontFamily: 'Poppins-Bold', fontSize: 72, color: '#EF4444', letterSpacing: 12, textShadowColor: 'rgba(239,68,68,0.8)', textShadowOffset: { width: 0, height: 0 }, textShadowRadius: 32 },

  // ── Question panel ────────────────────────────────────────────────────────────
  questionPanel: { marginHorizontal: 12, borderRadius: 20, backgroundColor: 'rgba(7,12,26,0.96)', borderWidth: 1, borderColor: 'rgba(255,255,255,0.14)', overflow: 'hidden', marginTop: 'auto' },
  timerTrack:    { height: 4, backgroundColor: 'rgba(255,255,255,0.1)', width: '100%' },
  timerFill:     { height: '100%' },
  qTopRow:       { flexDirection: 'row', alignItems: 'center', gap: 8, padding: 12, paddingBottom: 4 },
  subjectPill:   { paddingHorizontal: 8, paddingVertical: 3, borderRadius: 6, backgroundColor: 'rgba(96,165,250,0.18)', borderWidth: 1, borderColor: 'rgba(96,165,250,0.4)' },
  subjectPillText:{ fontFamily: 'Poppins-Bold', fontSize: 10, color: '#60A5FA' },
  diffText:      { fontFamily: 'Inter-SemiBold', fontSize: 9, color: '#64748B', letterSpacing: 0.8 },
  qMoveTag:      { marginLeft: 'auto', fontFamily: 'Poppins-Bold', fontSize: 10, letterSpacing: 0.5 },
  qText:         { fontFamily: 'Poppins-Bold', fontSize: 16, color: '#FFF7ED', lineHeight: 22, paddingHorizontal: 12, paddingBottom: 10 },
  choicesGrid:   { flexDirection: 'row', flexWrap: 'wrap', gap: 6, paddingHorizontal: 12, paddingBottom: 14 },
  choice:        { width: '47.5%', minHeight: 44, borderRadius: 12, flexDirection: 'row', alignItems: 'center', gap: 8, backgroundColor: 'rgba(255,255,255,0.07)', borderWidth: 1, borderColor: 'rgba(255,255,255,0.12)', paddingHorizontal: 10 },
  choiceKey:     { fontFamily: 'Poppins-Bold', fontSize: 11, color: '#FDE68A', width: 18 },
  choiceText:    { flex: 1, fontFamily: 'Inter-SemiBold', fontSize: 12, color: '#FFF7ED' },

  // ── Combat controls ────────────────────────────────────────────────────────────
  controlRow:    { flexDirection: 'row', paddingHorizontal: 14, gap: 10, paddingTop: 10, paddingBottom: 4, alignItems: 'flex-end' },
  blockBtn:      { width: 70, height: 70, borderRadius: 16, backgroundColor: 'rgba(15,23,42,0.82)', borderWidth: 1.5, borderColor: 'rgba(96,165,250,0.28)', alignItems: 'center', justifyContent: 'center', gap: 3 },
  blockBtnActive:{ borderColor: '#60A5FA', backgroundColor: 'rgba(96,165,250,0.18)' },
  blockBtnText:  { fontFamily: 'Poppins-Bold', fontSize: 9, color: '#94A3B8', letterSpacing: 0.5 },
  attackBtn:     { flex: 1, height: 78, borderRadius: 18, overflow: 'hidden' },
  attackBtnCooldown: { opacity: 0.58 },
  attackBtnGrad: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 3 },
  attackBtnText: { fontFamily: 'Poppins-Bold', fontSize: 15, color: '#FFF7ED', letterSpacing: 1.5 },
  specialBtn:    { width: 70, height: 70, borderRadius: 16, backgroundColor: 'rgba(15,23,42,0.72)', borderWidth: 1.5, borderColor: 'rgba(255,255,255,0.1)', alignItems: 'center', justifyContent: 'center', gap: 3, overflow: 'hidden' },
  specialBtnOff: { opacity: 0.55 },
  specialBtnGrad:{ ...StyleSheet.absoluteFillObject, alignItems: 'center', justifyContent: 'center', gap: 3 },
  specialBtnText:{ fontFamily: 'Poppins-Bold', fontSize: 9, color: '#111827', letterSpacing: 0.5 },

  // ── Streak bar ─────────────────────────────────────────────────────────────────
  streakBar:     { flexDirection: 'row', alignItems: 'center', gap: 4, paddingHorizontal: 20, paddingBottom: 8 },
  streakDot:     { width: 10, height: 10, borderRadius: 5, backgroundColor: 'rgba(255,255,255,0.12)', borderWidth: 1, borderColor: 'rgba(255,255,255,0.18)' },
  streakDotFilled:{ backgroundColor: '#FACC15', borderColor: '#FACC15' },
  streakLabel:   { fontFamily: 'Inter-SemiBold', fontSize: 11, color: '#64748B', marginLeft: 4, letterSpacing: 0.5 },

  // ── Result ─────────────────────────────────────────────────────────────────────
  resultGlow:    { position: 'absolute', top: 0, left: 0, right: 0, height: 300 },
  resultVerdict: { fontFamily: 'Poppins-Bold', fontSize: 64, letterSpacing: 6, textShadowOffset: { width: 0, height: 0 }, textShadowRadius: 28 },
  resultSubVerdict:{ fontFamily: 'Inter-SemiBold', fontSize: 14, color: '#64748B', marginBottom: 28 },
  resultFighters:{ flexDirection: 'row', alignItems: 'flex-end', width: '100%', marginBottom: 24 },
  resultFighterCol:{ flex: 1, alignItems: 'center', gap: 6 },
  resultFighterName:{ fontFamily: 'Poppins-Bold', fontSize: 12 },
  resultScore:   { fontFamily: 'Poppins-Bold', fontSize: 20, color: '#FFF7ED' },
  resultMidCol:  { width: 64, alignItems: 'center', gap: 4, paddingBottom: 20 },
  resultVs:      { fontFamily: 'Poppins-Bold', fontSize: 32, color: '#FFF7ED' },
  resultRoundsLabel:{ fontFamily: 'Inter-SemiBold', fontSize: 10, color: '#475569', letterSpacing: 1 },
  statsRow:      { flexDirection: 'row', flexWrap: 'wrap', gap: 8, width: '100%', marginBottom: 24 },
  statBox:       { flex: 1, minWidth: '44%', padding: 12, borderRadius: 14, backgroundColor: 'rgba(255,255,255,0.05)', borderWidth: 1, borderColor: 'rgba(255,255,255,0.08)', alignItems: 'center' },
  statVal:       { fontFamily: 'Poppins-Bold', fontSize: 22, color: '#FFF7ED' },
  statLbl:       { fontFamily: 'Inter-SemiBold', fontSize: 10, color: '#64748B', marginTop: 2 },
  rematchBtn:    { width: '100%', borderRadius: 18, overflow: 'hidden', marginBottom: 12 },
  rematchGrad:   { height: 58, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 10 },
  rematchText:   { fontFamily: 'Poppins-Bold', fontSize: 17, color: '#111827', letterSpacing: 2 },
  resultSecondary:{ flexDirection: 'row', gap: 12 },
  secondaryBtn:  { flex: 1, height: 44, borderRadius: 12, borderWidth: 1, borderColor: 'rgba(255,255,255,0.1)', alignItems: 'center', justifyContent: 'center', flexDirection: 'row', gap: 7 },
  secondaryBtnText:{ fontFamily: 'Inter-SemiBold', fontSize: 13, color: '#94A3B8' },
});
