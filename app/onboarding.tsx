// Onboarding · MindGains · gamified "play-to-advance"
// Lucide vector icons, real in-app Lotties (lotties/confetti.json, fire-streak),
// brand slide art, Live2D Miga rig on slide 3. No em dashes in copy. Confetti
// fires on the button press, then advances. Exam selection lives in profile-setup.

import React, { useState, useCallback, useEffect, useRef } from 'react';
import { View, Text, StyleSheet, Pressable, StatusBar, Image } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { LinearGradient } from 'expo-linear-gradient';
import LottieView from 'lottie-react-native';
import { router } from 'expo-router';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { Asset } from 'expo-asset';
import * as FileSystem from 'expo-file-system/legacy';
import { Flame, Zap, Headphones, Layers, ListChecks, FileText, Brain, Wand2, BadgeCheck, Check, MessageCircle, Trophy, Phone, Sigma, Target, Languages } from 'lucide-react-native';
import MascotRig, { MascotRigRef } from '@/components/MascotRig';
import Animated, {
  useAnimatedStyle, useSharedValue, withTiming, withSpring, withDelay, withRepeat,
  withSequence, interpolate, Easing,
} from '@/utils/reanimated';

const TEAL = '#0E9488';
const TEAL_DEEP = '#0A7568';
const TEAL_TINT = '#E7F5F2';
const TEAL_TINT_BD = '#BFE6DF';
const INK = '#1E2A44';
const GRAY = '#647087';
const FAINT = '#9AA6BA';
const LINE = '#EAEEF3';
const N = 4;

function DuoButton({ label, onPress, hidden, busy }: { label: string; onPress: () => void; hidden?: boolean; busy?: boolean }) {
  const down = useSharedValue(0);
  const face = useAnimatedStyle(() => ({ transform: [{ translateY: down.value * 5 }] }));
  const wrap = useAnimatedStyle(() => ({ opacity: withTiming(hidden ? 0 : 1, { duration: 220 }), transform: [{ translateY: withTiming(hidden ? 14 : 0, { duration: 220 }) }] }));
  return (
    <Animated.View style={wrap} pointerEvents={hidden ? 'none' : 'auto'}>
      <Pressable
        onPressIn={() => { down.value = withTiming(1, { duration: 60 }); }}
        onPressOut={() => { down.value = withTiming(0, { duration: 120 }); }}
        onPress={() => { if (!busy) onPress(); }} accessibilityRole="button" accessibilityLabel={label}
      >
        <View style={styles.btnWrap}>
          <View style={styles.btnEdge} />
          <Animated.View style={[styles.btnFace, face, busy && { opacity: 0.6 }]}>
            <LinearGradient colors={[TEAL, TEAL]} style={styles.btnGrad}><Text style={styles.btnText}>{label}</Text></LinearGradient>
          </Animated.View>
        </View>
      </Pressable>
    </Animated.View>
  );
}

// Flowing gradient border (Google-style) around a rounded content box.
function GradientBorder({ children }: { children: React.ReactNode }) {
  const shift = useSharedValue(0);
  useEffect(() => { shift.value = withRepeat(withTiming(1, { duration: 2600, easing: Easing.linear }), -1, false); }, []);
  const flow = useAnimatedStyle(() => ({ transform: [{ translateX: interpolate(shift.value, [0, 1], [0, -340]) }] }));
  return (
    <View style={styles.gbWrap}>
      <Animated.View style={[styles.gbGrad, flow]}>
        <LinearGradient colors={['#0E9488', '#22B8F0', '#7C5CFC', '#0E9488', '#22B8F0', '#7C5CFC', '#0E9488']} start={{ x: 0, y: 0 }} end={{ x: 1, y: 0 }} style={{ width: 700, height: '100%' }} />
      </Animated.View>
      <View style={styles.gbInner}>{children}</View>
    </View>
  );
}

function formatIndian(n: number) {
  const s = String(n);
  if (s.length <= 3) return s;
  return `${s.slice(0, -3).replace(/\B(?=(\d{2})+(?!\d))/g, ',')},${s.slice(-3)}`;
}

export default function Onboarding() {
  const [index, setIndex] = useState(0);
  const [busy, setBusy] = useState(false);
  const [streakClaimed, setStreakClaimed] = useState(false);
  const [transformed, setTransformed] = useState(false);
  const [migaCount, setMigaCount] = useState(0);
  const [showConfetti, setShowConfetti] = useState(false);

  const enter = useSharedValue(0);
  useEffect(() => { enter.value = 0; enter.value = withDelay(40, withSpring(1, { damping: 15, stiffness: 130 })); }, [index]);
  const enterStyle = useAnimatedStyle(() => ({ opacity: enter.value, transform: [{ translateX: interpolate(enter.value, [0, 1], [40, 0]) }] }));

  const fireConfettiThen = useCallback((after: () => void) => {
    setShowConfetti(true); setBusy(true);
    setTimeout(() => { after(); setBusy(false); }, 850);
    setTimeout(() => setShowConfetti(false), 2200);
  }, []);
  const finish = useCallback(async () => {
    try { await AsyncStorage.setItem('hasSeenOnboarding', 'true'); } catch {}
    router.replace('/auth');
  }, []);
  const gotoNext = useCallback(() => { setIndex((v) => (v < N - 1 ? v + 1 : v)); }, []);
  const skip = () => router.replace('/auth');

  const onPrimary = () => {
    if (index === 0 && !streakClaimed) { setStreakClaimed(true); fireConfettiThen(gotoNext); return; }
    if (index === 3) fireConfettiThen(finish); else fireConfettiThen(gotoNext);
  };

  const label = ['Claim Today’s Streak', 'Continue', 'Continue', 'Get Started'][index];
  const hidden = (index === 1 && !transformed) || (index === 2 && migaCount < 3);

  return (
    <View style={styles.root}>
      <StatusBar barStyle="dark-content" backgroundColor="transparent" translucent />
      <LinearGradient colors={['#FFFFFF', '#F1FBFA', '#F5F9FF']} style={StyleSheet.absoluteFill} />
      <SafeAreaView style={styles.safe} edges={['top', 'bottom']}>
        <View style={styles.header}>
          <View style={styles.ofPill}><Text style={styles.ofText}>{index + 1} of {N}</Text></View>
          <Pressable onPress={skip} hitSlop={12}><Text style={styles.skip}>Skip</Text></Pressable>
        </View>

        <Animated.View style={[styles.slide, enterStyle]} key={index}>
          {index === 0 && <DailyDose claimed={streakClaimed} />}
          {index === 1 && <StudyLab transformed={transformed} onTransform={() => setTransformed(true)} />}
          {index === 2 && <Miga onProgress={setMigaCount} />}
          {index === 3 && <QuizHub />}
        </Animated.View>

        <View style={styles.footer}>
          <View style={styles.dots}>{[0, 1, 2, 3].map((d) => <View key={d} style={[styles.dot, d === index && styles.dotOn]} />)}</View>
          <DuoButton label={label} onPress={onPrimary} hidden={hidden} busy={busy} />
        </View>
      </SafeAreaView>

      {showConfetti && (
        <View pointerEvents="none" style={StyleSheet.absoluteFill}>
          <LottieView source={require('@/assets/lotties/confetti.json')} autoPlay loop={false} style={StyleSheet.absoluteFill} resizeMode="cover" />
        </View>
      )}
    </View>
  );
}

// ---------- Slide 1: Daily Dose ----------
function DailyDose({ claimed }: { claimed: boolean }) {
  return (
    <View style={styles.body}>
      <Text style={styles.h}>One lesson a day.{'\n'}<Text style={styles.hT}>Built for what you study.</Text></Text>
      <Text style={styles.s}>From UPSC to TNPSC to school exams, Daily Dose gives you a focused lesson with revision and practice every day.</Text>
      <View style={styles.stage}>
        <View style={styles.heroPanel}>
          <Image source={require('@/assets/onboard/slide1.png')} style={styles.heroImg} resizeMode="cover" />
        </View>
        <View style={styles.ddStrip}>
          <View style={[styles.ddRail, { backgroundColor: TEAL }]} />
          <View style={styles.ddStripBody}>
            <View style={styles.ddKickerRow}><Zap size={12} color={TEAL} fill={TEAL} /><Text style={styles.ddKicker}>DAILY DOSE · DAY 9</Text></View>
            <Text style={styles.ddTitle} numberOfLines={1}>Fundamental Duties and The Amendment Map</Text>
          </View>
          <View style={styles.ddStreakChip}><Flame size={13} color="#F97316" fill="#F97316" /><Text style={styles.ddStreak}>{claimed ? 7 : 6}</Text></View>
        </View>
        {claimed && (
          <View pointerEvents="none" style={styles.fireOverlay}>
            <LottieView source={require('@/assets/animations/fire-streak.json')} autoPlay loop={false} style={{ width: 200, height: 200 }} />
          </View>
        )}
      </View>
    </View>
  );
}

// ---------- Slide 2: Study Lab ----------
const OUTS = [
  { Icon: Headphones, label: 'Podcast', tint: '#0F766E' },
  { Icon: Layers, label: 'Flashcards', tint: '#D97706' },
  { Icon: ListChecks, label: 'Quiz', tint: '#DC2626' },
  { Icon: FileText, label: 'Smart Notes', tint: '#15803D' },
  { Icon: Brain, label: 'Mind Map', tint: '#7C3AED' },
];

function Chip({ Icon, label, tint, delay }: { Icon: any; label: string; tint: string; delay: number }) {
  const v = useSharedValue(0);
  useEffect(() => { v.value = withDelay(delay, withSpring(1, { damping: 11, stiffness: 150 })); }, []);
  const st = useAnimatedStyle(() => ({ opacity: v.value, transform: [{ scale: interpolate(v.value, [0, 1], [0.2, 1]) }, { translateY: interpolate(v.value, [0, 1], [10, 0]) }] }));
  return (
    <Animated.View style={[styles.out, st]}>
      <View style={[styles.outIcon, { backgroundColor: tint + '15' }]}><Icon size={18} color={tint} /></View>
      <Text style={styles.outT}>{label}</Text>
    </Animated.View>
  );
}

function Tick() {
  const v = useSharedValue(0);
  useEffect(() => { v.value = withSequence(withSpring(1, { damping: 10, stiffness: 160 }), withDelay(250, withTiming(0, { duration: 200 }))); }, []);
  const st = useAnimatedStyle(() => ({ opacity: v.value, transform: [{ scale: interpolate(v.value, [0, 1], [0.3, 1]) }] }));
  return (
    <Animated.View pointerEvents="none" style={[styles.tick, st]}><Check size={26} color="#fff" strokeWidth={3.5} /></Animated.View>
  );
}

function StudyLab({ transformed, onTransform }: { transformed: boolean; onTransform: () => void }) {
  const [ticking, setTicking] = useState(false);
  const trigger = () => {
    if (transformed || ticking) return;
    setTicking(true);
    setTimeout(() => onTransform(), 480);
  };
  return (
    <View style={styles.body}>
      <Text style={styles.h}>Turn anything into{'\n'}<Text style={styles.hT}>powerful lessons</Text></Text>
      <Text style={styles.s}>Feed in a video, a PDF, a link or your notes and get a full study kit in seconds.</Text>
      <View style={styles.stage}>
        <View style={styles.heroPanel}>
          <Image source={require('@/assets/onboard/slide2.png')} style={styles.heroImg} resizeMode="cover" />
        </View>
        {!transformed ? (
          <Pressable onPress={trigger} style={{ width: '100%' }}>
            <GradientBorder>
              <View style={styles.buildRow}><Wand2 size={17} color={TEAL} /><Text style={styles.buildT}>Build my lesson</Text></View>
            </GradientBorder>
            {ticking && <Tick />}
          </Pressable>
        ) : (
          <View style={styles.outs}>{OUTS.map((o, i) => <Chip key={o.label} Icon={o.Icon} label={o.label} tint={o.tint} delay={i * 55} />)}</View>
        )}
      </View>
    </View>
  );
}

// ---------- Slide 3: Miga answers a doubt (Live2D rig) ----------
type Power = { id: string; label: string; react: string; Icon: any };
const POWERS: Power[] = [
  { id: 'ask',  label: 'Ask anything',   react: 'Grounded straight from your books.', Icon: MessageCircle },
  { id: 'pyq',  label: 'Real PYQs',      react: 'Actual past-paper questions.',       Icon: Trophy },
  { id: 'call', label: 'Call Miga',      react: 'Hands-free, like a real tutor.',     Icon: Phone },
  { id: 'math', label: 'Math mode',      react: 'Every step, no skips.',              Icon: Sigma },
  { id: 'weak', label: 'Fix weak areas', react: 'I track what you keep missing.',     Icon: Target },
];

// Each tapped power springs its mini-demo into the stage.
function DemoShell({ children }: { children: React.ReactNode }) {
  const p = useSharedValue(0);
  useEffect(() => { p.value = withSpring(1, { damping: 15, stiffness: 150 }); }, []);
  const st = useAnimatedStyle(() => ({ opacity: p.value, transform: [{ translateY: (1 - p.value) * 12 }, { scale: 0.97 + p.value * 0.03 }] }));
  return <Animated.View style={[styles.demoCard, st]}>{children}</Animated.View>;
}

function AskDemo() {
  const [ta, setTa] = useState(false);
  return (
    <View style={{ gap: 8 }}>
      <View style={styles.chatUser}><Text style={styles.chatUserT}>What is Article 44?</Text></View>
      <View style={styles.chatMiga}>
        {ta ? (
          <Text style={styles.chatMigaT}>சட்டப்பிரிவு 44, அனைவருக்கும் <Text style={styles.hlTeal}>ஒரே சீரான குடிமையியல் சட்டத்தை</Text> உறுதி செய்ய அரசை வழிநடத்துகிறது.</Text>
        ) : (
          <Text style={styles.chatMigaT}>Article 44 directs the State to secure a <Text style={styles.hlTeal}>Uniform Civil Code</Text>. A Directive Principle, so it guides policy but is not enforceable in court.</Text>
        )}
        <View style={styles.demoFootRow}>
          <View style={styles.srcChip}><BadgeCheck size={11} color={TEAL} /><Text style={styles.srcChipT}>Samacheer Class 10</Text></View>
          <Pressable onPress={() => setTa((v) => !v)} style={styles.langToggle}><Languages size={11} color={TEAL} /><Text style={styles.langToggleT}>{ta ? 'EN' : 'தமிழ்'}</Text></Pressable>
        </View>
      </View>
    </View>
  );
}

const PYQ_OPTS = ['Chenab', 'Jhelum', 'Ravi', 'Sutlej'];
function PyqDemo() {
  return (
    <View style={{ gap: 9 }}>
      <Text style={styles.pyqQ}>UPSC 2021 · Which of these rivers joins the Indus direct?</Text>
      <View style={styles.pyqOpts}>
        {PYQ_OPTS.map((o) => {
          const right = o === 'Sutlej';
          return (
            <View key={o} style={[styles.pyqOpt, right && styles.pyqOptRight]}>
              <Text style={[styles.pyqOptT, right && { color: TEAL }]}>{o}</Text>
              {right && <Check size={13} color={TEAL} />}
            </View>
          );
        })}
      </View>
      <View style={styles.demoBadge}><Trophy size={12} color={TEAL} /><Text style={styles.demoBadgeT}>Verified previous-year question</Text></View>
    </View>
  );
}

function WaveBar({ i }: { i: number }) {
  const h = useSharedValue(0.3);
  useEffect(() => { h.value = withRepeat(withSequence(withTiming(1, { duration: 320 + i * 45 }), withTiming(0.3, { duration: 320 + i * 45 })), -1, true); }, []);
  const st = useAnimatedStyle(() => ({ height: 10 + h.value * 28 }));
  return <Animated.View style={[styles.waveBar, st]} />;
}
function CallDemo() {
  return (
    <View style={{ alignItems: 'center', gap: 12, paddingVertical: 4 }}>
      <View style={styles.waveRow}>{[0, 1, 2, 3, 4, 5, 6, 7].map((i) => <WaveBar key={i} i={i} />)}</View>
      <Text style={styles.callT}>Talk to Miga hands-free, like a real tutor.</Text>
      <View style={styles.demoBadge}><Phone size={12} color={TEAL} /><Text style={styles.demoBadgeT}>Live voice with lip-sync</Text></View>
    </View>
  );
}

function MathDemo() {
  return (
    <View style={{ gap: 7 }}>
      <Text style={styles.mathEq}>Solve   2x + 6 = 14</Text>
      <Text style={styles.mathStep}>2x = 14 − 6 = 8</Text>
      <Text style={styles.mathStep}>x = 8 ÷ 2</Text>
      <View style={styles.mathAnsRow}><Text style={styles.mathAns}>x = 4</Text><Check size={15} color={TEAL} /></View>
      <View style={styles.demoBadge}><Sigma size={12} color={TEAL} /><Text style={styles.demoBadgeT}>Every step shown</Text></View>
    </View>
  );
}

function WeakDemo() {
  const w = useSharedValue(0.35);
  const [done, setDone] = useState(false);
  useEffect(() => {
    w.value = withDelay(250, withTiming(1, { duration: 900 }));
    const t = setTimeout(() => setDone(true), 1250);
    return () => clearTimeout(t);
  }, []);
  const st = useAnimatedStyle(() => ({ width: `${w.value * 100}%` }));
  return (
    <View style={{ gap: 11 }}>
      <View style={styles.weakRow}>
        <Text style={styles.weakTopic}>Fundamental Rights</Text>
        {done
          ? <View style={styles.weakDone}><Check size={11} color="#fff" /><Text style={styles.weakDoneT}>Mastered</Text></View>
          : <Text style={styles.weakTag}>Weak spot</Text>}
      </View>
      <View style={styles.weakTrack}><Animated.View style={[styles.weakFill, st]} /></View>
      <View style={styles.demoBadge}><Target size={12} color={TEAL} /><Text style={styles.demoBadgeT}>Spaced revision until it sticks</Text></View>
    </View>
  );
}

function Miga({ onProgress }: { onProgress: (n: number) => void }) {
  const rigRef = useRef<MascotRigRef>(null);
  const greeted = useRef(false);
  const [collected, setCollected] = useState<string[]>([]);
  const [active, setActive] = useState<string | null>(null);

  // Play the pre-recorded greeting THROUGH the rig: mp3 bytes -> base64 ->
  // decodeAudioData -> analyser-driven lipsync. Same WebAudio path the waitlist
  // page and the app's TTS use. No URL / no crossOrigin, so it works bundled.
  const speakGreeting = useCallback(async () => {
    if (greeted.current) return; greeted.current = true;
    try {
      const asset = Asset.fromModule(require('@/assets/voice/miga-en-greet.mp3'));
      await asset.downloadAsync();
      const uri = asset.localUri || asset.uri;
      const base64 = await FileSystem.readAsStringAsync(uri, { encoding: FileSystem.EncodingType.Base64 });
      rigRef.current?.setExpression('happy');
      rigRef.current?.resetAudioQueue();
      rigRef.current?.enqueueAudioChunk(base64, true);
    } catch {}
  }, []);

  const tap = (id: string) => {
    setActive(id);
    rigRef.current?.setExpression('teaching');
    setCollected((c) => {
      if (c.includes(id)) return c;
      const next = [...c, id];
      onProgress(next.length);
      return next;
    });
  };

  const activePower = POWERS.find((p) => p.id === active);
  const remaining = Math.max(0, 3 - collected.length);

  return (
    <View style={styles.body}>
      <Text style={styles.h}>Meet Miga,{'\n'}<Text style={styles.hT}>your all-in-one exam brain</Text></Text>
      <Text style={styles.s}>NCERT and Samacheer grounded. Tap a power to watch it work.</Text>
      <View style={styles.migaStage}>
        <View style={styles.rigRow}>
          <View style={styles.rigWrapSm}><MascotRig ref={rigRef} size={90} onReady={() => { rigRef.current?.setExpression('happy'); speakGreeting(); }} /></View>
          <View style={styles.bubble}>
            <Text style={styles.bubbleT}>{activePower ? activePower.react : "Hi, I'm Miga. I do a lot for you. Tap a power below."}</Text>
          </View>
        </View>

        <View style={styles.demoArea}>
          {active ? (
            <DemoShell key={active}>
              {active === 'ask' && <AskDemo />}
              {active === 'pyq' && <PyqDemo />}
              {active === 'call' && <CallDemo />}
              {active === 'math' && <MathDemo />}
              {active === 'weak' && <WeakDemo />}
            </DemoShell>
          ) : (
            <View style={styles.demoEmpty}><Text style={styles.demoEmptyT}>Pick a power to see it in action</Text></View>
          )}
        </View>

        <View style={styles.powerRow}>
          {POWERS.map((p) => {
            const on = collected.includes(p.id);
            const isActive = active === p.id;
            const Icon = p.Icon;
            return (
              <Pressable key={p.id} onPress={() => tap(p.id)} style={[styles.powerPill, isActive && styles.powerPillActive, on && !isActive && styles.powerPillDone]}>
                <View style={styles.powerIconWrap}>
                  <Icon size={15} color={on || isActive ? TEAL : FAINT} />
                  {on && <View style={styles.powerCheck}><Check size={8} color="#fff" /></View>}
                </View>
                <Text style={[styles.powerLabel, (on || isActive) && { color: INK }]}>{p.label}</Text>
              </Pressable>
            );
          })}
        </View>

        <Text style={styles.collectHint}>
          {remaining === 0 ? 'You have seen enough. Hit Continue.' : `${collected.length} of 5 explored · try ${remaining} more to continue`}
        </Text>
      </View>
    </View>
  );
}

// ---------- Slide 4: Quiz Hub (image led) ----------
function QuizHub() {
  return (
    <View style={styles.body}>
      <Text style={styles.h}>Practice like the{'\n'}<Text style={styles.hT}>real exam</Text></Text>
      <Text style={styles.s}>2,00,000+ high yield questions across UPSC, TNPSC, SSC, Railway and Samacheer.</Text>
      <View style={styles.stageImg}>
        <Image source={require('@/assets/onboard/slide4.png')} style={styles.quizImg} resizeMode="contain" />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: '#fff' },
  safe: { flex: 1 },
  header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 24, height: 30, marginTop: 4 },
  ofPill: { backgroundColor: TEAL_TINT, borderColor: TEAL_TINT_BD, borderWidth: 1, borderRadius: 999, paddingHorizontal: 11, paddingVertical: 3 },
  ofText: { fontFamily: 'Poppins-Bold', fontSize: 12, color: TEAL },
  skip: { fontFamily: 'Poppins-Bold', fontSize: 13, color: FAINT },
  slide: { flex: 1 },
  body: { flex: 1, paddingHorizontal: 24, paddingTop: 12 },
  h: { fontFamily: 'Poppins-Bold', fontSize: 25, lineHeight: 31, letterSpacing: -0.4, color: INK },
  hT: { color: TEAL },
  s: { fontFamily: 'Poppins-SemiBold', fontSize: 12, lineHeight: 17, color: GRAY, marginTop: 8, maxWidth: 320 },
  stage: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 16 },
  stageImg: { flex: 1, alignItems: 'center', justifyContent: 'center' },

  // ── Slide 3: Miga's Powers ──
  migaStage: { flex: 1, gap: 12, paddingTop: 6 },
  rigWrapSm: { width: 90, height: 90 },
  demoArea: { minHeight: 150, justifyContent: 'center' },
  demoCard: { backgroundColor: '#fff', borderRadius: 18, borderWidth: 1, borderColor: LINE, padding: 14 },
  demoEmpty: { minHeight: 120, borderRadius: 18, borderWidth: 1, borderColor: LINE, borderStyle: 'dashed', alignItems: 'center', justifyContent: 'center', backgroundColor: '#FAFBFC' },
  demoEmptyT: { fontFamily: 'Poppins-SemiBold', fontSize: 12.5, color: FAINT },
  chatUser: { alignSelf: 'flex-end', backgroundColor: TEAL, borderRadius: 14, borderBottomRightRadius: 4, paddingHorizontal: 12, paddingVertical: 8, maxWidth: '80%' },
  chatUserT: { fontFamily: 'Poppins-SemiBold', fontSize: 12.5, color: '#fff' },
  chatMiga: { alignSelf: 'flex-start', backgroundColor: '#F4F7FA', borderRadius: 14, borderBottomLeftRadius: 4, padding: 11, gap: 8, maxWidth: '96%' },
  chatMigaT: { fontFamily: 'Inter-Medium', fontSize: 12.5, lineHeight: 19, color: INK },
  hlTeal: { fontFamily: 'Inter-Bold', color: TEAL },
  demoFootRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  srcChip: { flexDirection: 'row', alignItems: 'center', gap: 4, backgroundColor: TEAL_TINT, borderRadius: 999, paddingHorizontal: 8, paddingVertical: 3 },
  srcChipT: { fontFamily: 'Poppins-Bold', fontSize: 10, color: TEAL },
  langToggle: { flexDirection: 'row', alignItems: 'center', gap: 3, borderWidth: 1, borderColor: TEAL_TINT_BD, borderRadius: 999, paddingHorizontal: 8, paddingVertical: 3 },
  langToggleT: { fontFamily: 'Poppins-Bold', fontSize: 10, color: TEAL },
  pyqQ: { fontFamily: 'Poppins-SemiBold', fontSize: 12.5, lineHeight: 17, color: INK },
  pyqOpts: { flexDirection: 'row', flexWrap: 'wrap', gap: 7 },
  pyqOpt: { flexDirection: 'row', alignItems: 'center', gap: 5, borderWidth: 1, borderColor: LINE, borderRadius: 10, paddingHorizontal: 11, paddingVertical: 7 },
  pyqOptRight: { borderColor: TEAL, backgroundColor: TEAL_TINT },
  pyqOptT: { fontFamily: 'Poppins-SemiBold', fontSize: 12, color: GRAY },
  demoBadge: { flexDirection: 'row', alignItems: 'center', gap: 5, alignSelf: 'flex-start', marginTop: 2 },
  demoBadgeT: { fontFamily: 'Poppins-Bold', fontSize: 10.5, color: TEAL },
  waveRow: { flexDirection: 'row', alignItems: 'center', gap: 5, height: 40 },
  waveBar: { width: 5, borderRadius: 3, backgroundColor: TEAL },
  callT: { fontFamily: 'Poppins-SemiBold', fontSize: 12.5, color: INK, textAlign: 'center' },
  mathEq: { fontFamily: 'Poppins-Bold', fontSize: 15, color: INK },
  mathStep: { fontFamily: 'Inter-Medium', fontSize: 13, color: GRAY },
  mathAnsRow: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  mathAns: { fontFamily: 'Poppins-Bold', fontSize: 15, color: TEAL },
  weakRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  weakTopic: { fontFamily: 'Poppins-SemiBold', fontSize: 13, color: INK },
  weakTag: { fontFamily: 'Poppins-Bold', fontSize: 10, color: '#F97316', backgroundColor: '#FFF4ED', borderRadius: 999, paddingHorizontal: 8, paddingVertical: 3 },
  weakDone: { flexDirection: 'row', alignItems: 'center', gap: 4, backgroundColor: TEAL, borderRadius: 999, paddingHorizontal: 8, paddingVertical: 3 },
  weakDoneT: { fontFamily: 'Poppins-Bold', fontSize: 10, color: '#fff' },
  weakTrack: { height: 9, borderRadius: 5, backgroundColor: '#EEF2F6', overflow: 'hidden' },
  weakFill: { height: '100%', borderRadius: 5, backgroundColor: TEAL },
  powerRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, justifyContent: 'center' },
  powerPill: { flexDirection: 'row', alignItems: 'center', gap: 6, borderWidth: 1, borderColor: LINE, borderRadius: 999, paddingLeft: 8, paddingRight: 12, paddingVertical: 7, backgroundColor: '#fff' },
  powerPillActive: { borderColor: TEAL, backgroundColor: TEAL_TINT },
  powerPillDone: { borderColor: TEAL_TINT_BD, backgroundColor: '#fff' },
  powerIconWrap: { width: 18, height: 18, alignItems: 'center', justifyContent: 'center' },
  powerCheck: { position: 'absolute', right: -5, top: -5, width: 12, height: 12, borderRadius: 6, backgroundColor: TEAL, alignItems: 'center', justifyContent: 'center' },
  powerLabel: { fontFamily: 'Poppins-SemiBold', fontSize: 11.5, color: GRAY },
  collectHint: { fontFamily: 'Poppins-SemiBold', fontSize: 11, color: FAINT, textAlign: 'center' },
  footer: { paddingHorizontal: 24, paddingBottom: 20 },
  dots: { flexDirection: 'row', gap: 7, justifyContent: 'center', marginBottom: 14 },
  dot: { width: 7, height: 7, borderRadius: 4, backgroundColor: '#D8E0E8' },
  dotOn: { width: 22, backgroundColor: TEAL },
  btnWrap: { height: 55, borderRadius: 17 },
  btnEdge: { position: 'absolute', left: 0, right: 0, top: 5, bottom: 0, borderRadius: 17, backgroundColor: TEAL_DEEP },
  btnFace: { position: 'absolute', left: 0, right: 0, top: 0, height: 50, borderRadius: 17, overflow: 'hidden' },
  btnGrad: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  btnText: { fontFamily: 'Poppins-SemiBold', fontSize: 16, color: '#fff' },

  // hero image panel (dark-bg brand art)
  heroPanel: { width: '100%', height: 236, borderRadius: 22, overflow: 'hidden', backgroundColor: '#0E1230', borderWidth: 1, borderColor: 'rgba(15,23,42,0.10)' },
  heroImg: { width: '100%', height: '100%' },

  // slide 1 compact strip
  ddStrip: { width: '100%', flexDirection: 'row', alignItems: 'center', gap: 10, backgroundColor: '#fff', borderRadius: 16, borderWidth: 1, borderColor: LINE, padding: 12 },
  ddRail: { width: 4, height: 34, borderRadius: 3 },
  ddStripBody: { flex: 1, gap: 3 },
  ddKickerRow: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  ddKicker: { fontFamily: 'Poppins-Bold', fontSize: 9.5, color: '#334155', letterSpacing: 1 },
  ddTitle: { fontFamily: 'Poppins-SemiBold', fontSize: 12.5, color: '#0F172A' },
  ddStreakChip: { flexDirection: 'row', alignItems: 'center', gap: 4, backgroundColor: '#FFF4ED', borderRadius: 999, paddingHorizontal: 9, paddingVertical: 5 },
  ddStreak: { fontFamily: 'Poppins-Bold', fontSize: 13, color: '#F97316' },
  fireOverlay: { position: 'absolute', alignSelf: 'center', top: 40 },

  // study lab
  buildRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, paddingVertical: 15 },
  buildT: { fontFamily: 'Poppins-Bold', fontSize: 14, color: TEAL },
  gbWrap: { width: '100%', borderRadius: 18, overflow: 'hidden', padding: 2, backgroundColor: '#fff' },
  gbGrad: { position: 'absolute', top: 0, bottom: 0, left: 0 },
  gbInner: { backgroundColor: '#fff', borderRadius: 16, overflow: 'hidden' },
  tick: { position: 'absolute', alignSelf: 'center', top: 6, width: 46, height: 46, borderRadius: 23, backgroundColor: TEAL, alignItems: 'center', justifyContent: 'center' },
  outs: { flexDirection: 'row', flexWrap: 'wrap', gap: 9, justifyContent: 'center' },
  out: { width: 84, alignItems: 'center', gap: 7, paddingVertical: 12, borderRadius: 15, backgroundColor: '#fff', borderWidth: 1, borderColor: LINE },
  outIcon: { width: 34, height: 34, borderRadius: 10, alignItems: 'center', justifyContent: 'center' },
  outT: { fontFamily: 'Poppins-SemiBold', fontSize: 9.5, color: INK },

  // miga
  rigRow: { flexDirection: 'row', alignItems: 'center', gap: 6, width: '100%' },
  rigWrap: { width: 132, height: 132, alignItems: 'center', justifyContent: 'center' },
  bubble: { flex: 1, backgroundColor: TEAL_TINT, borderColor: TEAL_TINT_BD, borderWidth: 1, borderRadius: 16, borderBottomLeftRadius: 4, paddingHorizontal: 13, paddingVertical: 11, gap: 8 },
  bubbleT: { fontFamily: 'Inter-Medium', fontSize: 12.5, color: INK, lineHeight: 18 },
  verify: { flexDirection: 'row', alignItems: 'center', gap: 5 },
  verifyT: { fontFamily: 'Poppins-SemiBold', fontSize: 10.5, color: TEAL },
  qCards: { flexDirection: 'row', gap: 8, width: '100%' },
  qCard: { flex: 1, paddingVertical: 12, paddingHorizontal: 10, borderRadius: 14, backgroundColor: '#fff', borderWidth: 1.5, borderColor: LINE, gap: 3 },
  qCardSel: { borderColor: TEAL, backgroundColor: TEAL_TINT },
  qCardT: { fontFamily: 'Poppins-Bold', fontSize: 12, color: INK },
  qCardSrc: { fontFamily: 'Inter-Medium', fontSize: 9.5, color: FAINT },

  // quiz hub
  quizImg: { width: '100%', height: '100%' },
});
