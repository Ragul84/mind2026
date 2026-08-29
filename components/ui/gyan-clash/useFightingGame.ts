import { useCallback, useEffect, useRef, useState } from 'react';
import { Share } from 'react-native';
import HapticService from '@/utils/hapticService';
import { supabase } from '@/utils/supabaseService';
import { GyanClashQuestion, SubjectFilter } from './types';
import { getDailyQuestionSet, loadGyanClashQuestions } from './questionBank';
import GyanClashSound from '@/utils/gyanClashSound';

// ─── Constants ───────────────────────────────────────────────────────────────
const MAX_HP        = 100;
const ROUND_COUNT   = 3;
const Q_TIMER_MS    = 5000;
const BLOCK_MS      = 1600;
const ATTACK_CD_MS  = 1000;
const BOT_MIN_MS    = 2600;
const BOT_MAX_MS    = 4400;
const BOT_WARN_MS   = 700;

const DAMAGE = {
  normalCorrect:  { min: 12, max: 18 },
  specialCorrect: { min: 28, max: 38 },
  botNormal:      { min: 10, max: 16 },
  botSpecial:     { min: 22, max: 30 },
  selfPunish:     4,
  blockReduction: 0.65,
};

export type FightPhase = 'intro' | 'countdown' | 'fight' | 'ko' | 'result';
export type MoveType   = 'attack' | 'special';
export type PlayerSide = 'hero' | 'rival';

export type FloatingHit = {
  id: string;
  text: string;
  color: string;
  side: PlayerSide;
};

export type IncomingWarning = {
  active: boolean;
  moveType: MoveType;
};

export type MatchEvent =
  | 'hero_hit'
  | 'hero_blocked'
  | 'hero_miss'
  | 'rival_hit'
  | 'rival_special'
  | 'rival_blocked'
  | 'clash'
  | 'ko';

export type FightState = {
  phase: FightPhase;
  round: number;
  heroHp: number;
  rivalHp: number;
  heroWins: number;
  rivalWins: number;
  heroStreak: number;
  heroCharged: boolean;
  heroScore: number;
  heroBlocking: boolean;
  attackOnCooldown: boolean;
  incomingWarn: IncomingWarning;
  currentQuestion: GyanClashQuestion | null;
  questionPhase: 'idle' | 'active' | 'resolving';
  pendingMoveType: MoveType | null;
  questionTimerMs: number;
  floatingHits: FloatingHit[];
  lastEvent: MatchEvent | null;
  comboText: string | null;
  countdownNum: number;
  heroName: string;
  rivalName: string;
  totalCorrect: number;
  totalAnswered: number;
  subject: SubjectFilter;
};

function rand(min: number, max: number) {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}

function pickQuestion(pool: GyanClashQuestion[], moveType: MoveType): GyanClashQuestion {
  if (moveType === 'special') {
    const hard = pool.filter(q => q.difficulty === 'hard' || q.difficulty === 'medium');
    if (hard.length > 0) return hard[Math.floor(Math.random() * hard.length)];
  }
  return pool[Math.floor(Math.random() * pool.length)];
}

const BOT_NAMES = ['Arjun', 'Riya', 'Karan', 'Priya', 'Vikram', 'Sneha', 'Rohan', 'Ananya'];

export function useFightingGame(heroDisplayName = 'You', defaultSubject: SubjectFilter = 'mix') {
  const [state, setState] = useState<FightState>(() => ({
    phase: 'intro',
    round: 1,
    heroHp: MAX_HP,
    rivalHp: MAX_HP,
    heroWins: 0,
    rivalWins: 0,
    heroStreak: 0,
    heroCharged: false,
    heroScore: 0,
    heroBlocking: false,
    attackOnCooldown: false,
    incomingWarn: { active: false, moveType: 'attack' },
    currentQuestion: null,
    questionPhase: 'idle',
    pendingMoveType: null,
    questionTimerMs: Q_TIMER_MS,
    floatingHits: [],
    lastEvent: null,
    comboText: null,
    countdownNum: 3,
    heroName: heroDisplayName,
    rivalName: BOT_NAMES[Math.floor(Math.random() * BOT_NAMES.length)],
    totalCorrect: 0,
    totalAnswered: 0,
    subject: defaultSubject,
  }));

  const questionPoolRef  = useRef<GyanClashQuestion[]>(getDailyQuestionSet(undefined, defaultSubject));
  const stateRef         = useRef(state);
  const botTimerRef      = useRef<ReturnType<typeof setTimeout> | null>(null);
  const qTimerRef        = useRef<ReturnType<typeof setInterval> | null>(null);
  const cooldownRef      = useRef<ReturnType<typeof setTimeout> | null>(null);
  const blockTimerRef    = useRef<ReturnType<typeof setTimeout> | null>(null);
  const comboTimerRef    = useRef<ReturnType<typeof setTimeout> | null>(null);
  const floatTimerRef    = useRef<ReturnType<typeof setTimeout> | null>(null);
  const roundCountRef    = useRef({ heroWins: 0, rivalWins: 0 });

  stateRef.current = state;

  // Tracks the subject the live question pool belongs to, so async Redis loads
  // never overwrite the pool of a match that has since changed subject.
  const poolSubjectRef = useRef<SubjectFilter>(defaultSubject);

  // Load real quiz-hub questions from Redis for the default subject.
  useEffect(() => {
    let alive = true;
    poolSubjectRef.current = defaultSubject;
    loadGyanClashQuestions(defaultSubject, 30)
      .then(qs => {
        if (alive && qs.length > 0 && poolSubjectRef.current === defaultSubject) {
          questionPoolRef.current = qs;
        }
      })
      .catch(() => {});
    return () => { alive = false; };
  }, [defaultSubject]);

  // Warm up the battle sound bank.
  useEffect(() => {
    GyanClashSound.preload(['countdown', 'fight', 'correct', 'combo', 'victory', 'defeat']);
  }, []);

  // ── helpers ─────────────────────────────────────────────────────────────────

  const addFloatHit = useCallback((text: string, color: string, side: PlayerSide) => {
    const id = `fh-${Date.now()}-${Math.random()}`;
    setState(s => ({ ...s, floatingHits: [...s.floatingHits.slice(-3), { id, text, color, side }] }));
    if (floatTimerRef.current) clearTimeout(floatTimerRef.current);
    floatTimerRef.current = setTimeout(() => {
      setState(s => ({ ...s, floatingHits: s.floatingHits.filter(f => f.id !== id) }));
    }, 900);
  }, []);

  const setCombo = useCallback((text: string) => {
    setState(s => ({ ...s, comboText: text }));
    if (comboTimerRef.current) clearTimeout(comboTimerRef.current);
    comboTimerRef.current = setTimeout(() => setState(s => ({ ...s, comboText: null })), 1400);
  }, []);

  const clearQuestion = useCallback(() => {
    if (qTimerRef.current) { clearInterval(qTimerRef.current); qTimerRef.current = null; }
    setState(s => ({
      ...s,
      questionPhase: 'idle',
      currentQuestion: null,
      pendingMoveType: null,
      questionTimerMs: Q_TIMER_MS,
    }));
  }, []);

  const startAttackCooldown = useCallback(() => {
    setState(s => ({ ...s, attackOnCooldown: true }));
    if (cooldownRef.current) clearTimeout(cooldownRef.current);
    cooldownRef.current = setTimeout(() => {
      setState(s => ({ ...s, attackOnCooldown: false }));
    }, ATTACK_CD_MS);
  }, []);

  // ── round management ─────────────────────────────────────────────────────────

  const endRound = useCallback((heroLost: boolean) => {
    if (botTimerRef.current) { clearTimeout(botTimerRef.current); botTimerRef.current = null; }
    clearQuestion();
    setState(s => ({ ...s, phase: 'ko', lastEvent: 'ko' }));
    HapticService.heavy();

    const nextHeroWins  = heroLost ? roundCountRef.current.heroWins  : roundCountRef.current.heroWins + 1;
    const nextRivalWins = heroLost ? roundCountRef.current.rivalWins + 1 : roundCountRef.current.rivalWins;
    roundCountRef.current = { heroWins: nextHeroWins, rivalWins: nextRivalWins };

    setTimeout(() => {
      if (nextHeroWins >= 2 || nextRivalWins >= 2) {
        GyanClashSound.play(nextHeroWins >= 2 ? 'victory' : 'defeat');
        setState(s => ({
          ...s,
          heroWins: nextHeroWins,
          rivalWins: nextRivalWins,
          phase: 'result',
        }));
      } else {
        setState(s => ({
          ...s,
          heroWins: nextHeroWins,
          rivalWins: nextRivalWins,
          heroHp: MAX_HP,
          rivalHp: MAX_HP,
          heroStreak: 0,
          heroCharged: false,
          round: s.round + 1,
          phase: 'countdown',
          countdownNum: 3,
        }));
        scheduleNextCountdownTick(3);
      }
    }, 2200);
  }, [clearQuestion]);

  // ── countdown ────────────────────────────────────────────────────────────────

  const scheduleNextCountdownTick = useCallback((num: number) => {
    if (num <= 0) {
      GyanClashSound.play('fight');
      setState(s => ({ ...s, phase: 'fight' }));
      return;
    }
    GyanClashSound.play('countdown');
    setTimeout(() => {
      setState(s => ({ ...s, countdownNum: num - 1 }));
      scheduleNextCountdownTick(num - 1);
    }, num === 3 ? 900 : 800);
  }, []);

  // ── bot AI ───────────────────────────────────────────────────────────────────

  const scheduleBot = useCallback(() => {
    if (botTimerRef.current) clearTimeout(botTimerRef.current);
    const delay = rand(BOT_MIN_MS, BOT_MAX_MS);
    botTimerRef.current = setTimeout(() => {
      const cur = stateRef.current;
      if (cur.phase !== 'fight') return;

      const st = cur.round;
      const botCorrectRate = Math.min(0.62 + st * 0.06, 0.82);
      const useSpecial = cur.rivalHp > 60 && Math.random() < 0.22;
      const moveType: MoveType = useSpecial ? 'special' : 'attack';
      const botCorrect = Math.random() < botCorrectRate;

      setState(s => ({ ...s, incomingWarn: { active: true, moveType } }));
      HapticService.light();

      const warnTimer = setTimeout(() => {
        setState(s => {
          if (s.phase !== 'fight') return s;
          const isBlocking = s.heroBlocking;
          let damage = moveType === 'special'
            ? rand(DAMAGE.botSpecial.min, DAMAGE.botSpecial.max)
            : rand(DAMAGE.botNormal.min, DAMAGE.botNormal.max);

          if (!botCorrect) {
            addFloatHit('MISS!', '#64748B', 'hero');
            return { ...s, incomingWarn: { active: false, moveType: 'attack' }, lastEvent: 'rival_blocked' };
          }

          if (isBlocking) {
            damage = Math.floor(damage * (1 - DAMAGE.blockReduction));
            addFloatHit(`BLOCKED! -${damage}`, '#60A5FA', 'hero');
            HapticService.light();
            const nextHp = Math.max(0, s.heroHp - damage);
            if (nextHp <= 0) { setTimeout(() => endRound(true), 200); }
            return { ...s, heroHp: nextHp, incomingWarn: { active: false, moveType: 'attack' }, lastEvent: 'hero_blocked' };
          }

          addFloatHit(`-${damage}`, '#EF4444', 'hero');
          HapticService.medium();
          const nextHp = Math.max(0, s.heroHp - damage);
          if (nextHp <= 0) { setTimeout(() => endRound(true), 400); }
          return {
            ...s,
            heroHp: nextHp,
            incomingWarn: { active: false, moveType: 'attack' },
            lastEvent: moveType === 'special' ? 'rival_special' : 'rival_hit',
          };
        });
        scheduleBot();
      }, BOT_WARN_MS);

      botTimerRef.current = warnTimer;
    }, delay);
  }, [addFloatHit, endRound]);

  // ── question timer ────────────────────────────────────────────────────────────

  const startQuestionTimer = useCallback(() => {
    if (qTimerRef.current) clearInterval(qTimerRef.current);
    setState(s => ({ ...s, questionTimerMs: Q_TIMER_MS }));
    qTimerRef.current = setInterval(() => {
      setState(s => {
        if (s.questionPhase !== 'active') return s;
        const next = s.questionTimerMs - 80;
        if (next <= 0) {
          clearInterval(qTimerRef.current!);
          qTimerRef.current = null;
          addFloatHit('MISS!', '#64748B', 'rival');
          HapticService.light();
          startAttackCooldown();
          scheduleBot();
          return {
            ...s,
            questionPhase: 'idle',
            currentQuestion: null,
            pendingMoveType: null,
            questionTimerMs: Q_TIMER_MS,
            lastEvent: 'hero_miss',
            heroStreak: 0,
            heroCharged: false,
          };
        }
        return { ...s, questionTimerMs: next };
      });
    }, 80);
  }, [addFloatHit, scheduleBot, startAttackCooldown]);

  // ── player moves ─────────────────────────────────────────────────────────────

  const playerAttack = useCallback((moveType: MoveType = 'attack') => {
    const cur = stateRef.current;
    if (cur.phase !== 'fight') return;
    if (cur.questionPhase !== 'idle') return;
    if (cur.attackOnCooldown) return;
    if (moveType === 'special' && !cur.heroCharged) return;

    const q = pickQuestion(questionPoolRef.current, moveType);
    setState(s => ({
      ...s,
      currentQuestion: q,
      questionPhase: 'active',
      pendingMoveType: moveType,
      questionTimerMs: Q_TIMER_MS,
    }));
    startQuestionTimer();
    HapticService.light();
  }, [startQuestionTimer]);

  const playerBlock = useCallback(() => {
    const cur = stateRef.current;
    if (cur.phase !== 'fight') return;
    if (cur.heroBlocking) return;

    setState(s => ({ ...s, heroBlocking: true }));
    HapticService.medium();
    if (blockTimerRef.current) clearTimeout(blockTimerRef.current);
    blockTimerRef.current = setTimeout(() => {
      setState(s => ({ ...s, heroBlocking: false }));
    }, BLOCK_MS);
  }, []);

  const answerQuestion = useCallback((choiceId: string) => {
    const cur = stateRef.current;
    if (cur.questionPhase !== 'active' || !cur.currentQuestion || !cur.pendingMoveType) return;

    if (qTimerRef.current) { clearInterval(qTimerRef.current); qTimerRef.current = null; }

    const correct = choiceId === cur.currentQuestion.correctChoiceId;
    const moveType = cur.pendingMoveType;
    const isMedHard = cur.currentQuestion.difficulty !== 'easy';

    setState(s => ({ ...s, questionPhase: 'resolving', totalAnswered: s.totalAnswered + 1 }));

    setTimeout(() => {
      setState(s => {
        if (correct) {
          const raw = moveType === 'special'
            ? rand(DAMAGE.specialCorrect.min, DAMAGE.specialCorrect.max)
            : rand(DAMAGE.normalCorrect.min, DAMAGE.normalCorrect.max);
          const streakBonus = Math.min(s.heroStreak, 4) * 3;
          const damage = raw + streakBonus;
          const nextRivalHp = Math.max(0, s.rivalHp - damage);
          const nextStreak  = s.heroStreak + 1;
          const nextCharged = nextStreak >= 3;
          const nextScore   = s.heroScore + (moveType === 'special' ? 150 : 80) + streakBonus * 5;

          if (nextStreak >= 3)  setCombo(`${nextStreak}x COMBO!`);
          if (nextStreak === 5) setCombo('UNSTOPPABLE!');
          if (nextStreak === 7) setCombo('BRAHMASTRA!');

          GyanClashSound.play(moveType === 'special' ? 'special' : 'correct');
          if (nextStreak === 3 || nextStreak === 5 || nextStreak === 7) GyanClashSound.play('combo');

          addFloatHit(moveType === 'special' ? `SPECIAL -${damage}!` : `-${damage}`, '#22C55E', 'rival');
          HapticService.medium();

          if (nextRivalHp <= 0) setTimeout(() => endRound(false), 500);

          return {
            ...s,
            rivalHp: nextRivalHp,
            heroStreak: nextStreak,
            heroCharged: nextCharged,
            heroScore: nextScore,
            totalCorrect: s.totalCorrect + 1,
            questionPhase: 'idle',
            currentQuestion: null,
            pendingMoveType: null,
            questionTimerMs: Q_TIMER_MS,
            lastEvent: moveType === 'special' ? 'rival_special' : 'rival_hit',
          };
        } else {
          const punish = DAMAGE.selfPunish + (isMedHard ? 4 : 0);
          addFloatHit('WRONG! -' + punish, '#F97316', 'hero');
          HapticService.light();
          const nextHp = Math.max(0, s.heroHp - punish);
          if (nextHp <= 0) setTimeout(() => endRound(true), 400);
          return {
            ...s,
            heroHp: nextHp,
            heroStreak: 0,
            heroCharged: false,
            questionPhase: 'idle',
            currentQuestion: null,
            pendingMoveType: null,
            questionTimerMs: Q_TIMER_MS,
            lastEvent: 'hero_miss',
          };
        }
      });
      startAttackCooldown();
      scheduleBot();
    }, 380);
  }, [addFloatHit, endRound, scheduleBot, setCombo, startAttackCooldown]);

  // ── game start / restart ──────────────────────────────────────────────────────

  const startFight = useCallback((subject: SubjectFilter = 'mix') => {
    // Seed instantly with the static set so the countdown can begin with no
    // network wait, then swap in the real Redis quiz-hub questions when ready.
    questionPoolRef.current = getDailyQuestionSet(undefined, subject);
    poolSubjectRef.current = subject;
    loadGyanClashQuestions(subject, 30)
      .then(qs => {
        if (qs.length > 0 && poolSubjectRef.current === subject) {
          questionPoolRef.current = qs;
        }
      })
      .catch(() => {});
    roundCountRef.current = { heroWins: 0, rivalWins: 0 };
    if (botTimerRef.current)   clearTimeout(botTimerRef.current);
    if (qTimerRef.current)     clearInterval(qTimerRef.current);
    if (cooldownRef.current)   clearTimeout(cooldownRef.current);
    if (blockTimerRef.current) clearTimeout(blockTimerRef.current);
    if (comboTimerRef.current) clearTimeout(comboTimerRef.current);

    setState(s => ({
      ...s,
      phase: 'countdown',
      round: 1,
      heroHp: MAX_HP,
      rivalHp: MAX_HP,
      heroWins: 0,
      rivalWins: 0,
      heroStreak: 0,
      heroCharged: false,
      heroScore: 0,
      heroBlocking: false,
      attackOnCooldown: false,
      incomingWarn: { active: false, moveType: 'attack' },
      currentQuestion: null,
      questionPhase: 'idle',
      pendingMoveType: null,
      questionTimerMs: Q_TIMER_MS,
      floatingHits: [],
      lastEvent: null,
      comboText: null,
      countdownNum: 3,
      rivalName: BOT_NAMES[Math.floor(Math.random() * BOT_NAMES.length)],
      totalCorrect: 0,
      totalAnswered: 0,
      subject,
    }));

    scheduleNextCountdownTick(3);
  }, [scheduleNextCountdownTick]);

  // Start bot after countdown ends
  useEffect(() => {
    if (state.phase === 'fight') {
      scheduleBot();
    }
    if (state.phase !== 'fight' && botTimerRef.current) {
      clearTimeout(botTimerRef.current);
      botTimerRef.current = null;
    }
  }, [state.phase, scheduleBot]);

  useEffect(() => () => {
    if (botTimerRef.current)   clearTimeout(botTimerRef.current);
    if (qTimerRef.current)     clearInterval(qTimerRef.current);
    if (cooldownRef.current)   clearTimeout(cooldownRef.current);
    if (blockTimerRef.current) clearTimeout(blockTimerRef.current);
    if (comboTimerRef.current) clearTimeout(comboTimerRef.current);
    if (floatTimerRef.current) clearTimeout(floatTimerRef.current);
  }, []);

  const shareResult = useCallback(async () => {
    const won = state.heroWins >= 2;
    const accuracy = state.totalAnswered > 0 ? Math.round((state.totalCorrect / state.totalAnswered) * 100) : 0;
    await Share.share({
      message: `I ${won ? 'won' : 'fought'} a Gyan Clash battle! Score: ${state.heroScore} | Accuracy: ${accuracy}% | Beat me on MindGains!`,
    });
  }, [state.heroScore, state.heroWins, state.totalAnswered, state.totalCorrect]);

  return {
    state,
    playerAttack,
    playerBlock,
    answerQuestion,
    startFight,
    shareResult,
    MAX_HP,
    Q_TIMER_MS,
  };
}
