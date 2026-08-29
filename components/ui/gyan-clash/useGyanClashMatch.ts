import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Share } from 'react-native';
import HapticService from '@/utils/hapticService';
import { supabase } from '@/utils/supabaseService';
import {
  AbilityId,
  BattleAbility,
  BattlePlayer,
  BattleProjectile,
  DailyMissionProgress,
  EmoteId,
  GyanClashQuestion,
  LiveEmote,
  MatchMode,
  MatchStatus,
  SubjectFilter,
} from './types';
import { getDailyQuestionSet, loadGyanClashQuestions, submitGyanClashAnswer } from './questionBank';
import GyanClashSound from '@/utils/gyanClashSound';

/** Short, unambiguous room code (no easily-confused chars). */
function makeRoomCode(): string {
  const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let code = '';
  for (let i = 0; i < 4; i++) code += alphabet[Math.floor(Math.random() * alphabet.length)];
  return code;
}

const QUESTION_SECONDS = 12;
const DHYAAN_RESET_MINUTES = 35;
const ANSWER_RESOLVE_MS = 900;

type RemoteAnswerPayload = {
  playerId: string;
  correct: boolean;
  questionId: string;
  answeredAt: number;
  damage: number;
  scoreDelta: number;
};

type QuestionSetPayload = {
  playerId: string;
  matchId: string;
  questions: GyanClashQuestion[];
  subject: SubjectFilter;
};

type EmotePayload = {
  playerId: string;
  emoteId: EmoteId;
};

type PendingAnswer = {
  questionId: string;
  correct: boolean;
  answeredAt: number;
  damage: number;
  scoreDelta: number;
  streakBefore: number;
};

export const RANK_THRESHOLDS = [
  { min: 2000, label: 'Brahmarishi', color: '#F59E0B' },
  { min: 1400, label: 'Acharya',     color: '#A78BFA' },
  { min: 800,  label: 'Vidwan',      color: '#60A5FA' },
  { min: 350,  label: 'Yodha',       color: '#34D399' },
  { min: 0,    label: 'Sadhak',      color: '#CBD5E1' },
] as const;

export function rankForScore(score: number): string {
  return RANK_THRESHOLDS.find(r => score >= r.min)?.label ?? 'Sadhak';
}

export function rankColorForScore(score: number): string {
  return RANK_THRESHOLDS.find(r => score >= r.min)?.color ?? '#CBD5E1';
}

function createPlayers(heroName: string): { hero: BattlePlayer; rival: BattlePlayer } {
  return {
    hero:  { id: 'you',   name: heroName, side: 'left',  hp: 100, maxHp: 100, score: 0, streak: 0, rank: 'Sadhak' },
    rival: { id: 'rival', name: 'Prana',  side: 'right', hp: 100, maxHp: 100, score: 0, streak: 0, rank: 'Sadhak' },
  };
}

const BOT_NAMES = ['Arjun', 'Riya', 'Karan', 'Priya', 'Amit', 'Sneha', 'Vikram', 'Ananya'];

function randomBotName(): string {
  return BOT_NAMES[Math.floor(Math.random() * BOT_NAMES.length)];
}

export function useGyanClashMatch(heroName = 'You') {
  const [subject, setSubject] = useState<SubjectFilter>('mix');
  const [questions, setQuestions] = useState<GyanClashQuestion[]>(() => getDailyQuestionSet(undefined, 'mix').slice(0, 15));
  const [matchId, setMatchId] = useState<string | null>(null);
  const [questionIndex, setQuestionIndex] = useState(0);
  const [selectedChoiceId, setSelectedChoiceId] = useState<string | null>(null);
  const [{ hero, rival }, setPlayers] = useState(() => createPlayers(heroName));
  const [questionSecondsLeft, setQuestionSecondsLeft] = useState(QUESTION_SECONDS);
  const [revealedCorrectChoiceId, setRevealedCorrectChoiceId] = useState<string | null>(null);
  const [revealedExplanation, setRevealedExplanation] = useState<string | null>(null);
  const [status, setStatus] = useState<MatchStatus>('idle');
  const [mode, setMode] = useState<MatchMode>('realtime');
  const [onlineCount, setOnlineCount] = useState(0);
  const [comboFlash, setComboFlash] = useState<string | null>(null);
  const [projectiles, setProjectiles] = useState<BattleProjectile[]>([]);
  const [missions, setMissions] = useState<DailyMissionProgress>({ correctAnswers: 0, streakHits: 0, wins: 0 });
  const [needsBreak, setNeedsBreak] = useState(false);
  const [isFinished, setIsFinished] = useState(false);
  const [xpEarned, setXpEarned] = useState(0);
  const [liveEmote, setLiveEmote] = useState<LiveEmote | null>(null);
  const [totalMatches, setTotalMatches] = useState(0);
  const [roomCode, setRoomCode] = useState<string | null>(null);
  const prevOnlineRef = useRef(0);

  const startedAtRef = useRef(Date.now());
  const channelRef = useRef<ReturnType<typeof supabase.channel> | null>(null);
  const playerIdRef = useRef(`player-${Date.now()}-${Math.random().toString(16).slice(2)}`);
  const pendingLocalRef = useRef<PendingAnswer | null>(null);
  const pendingRemoteRef = useRef<PendingAnswer | null>(null);
  const resolveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const resolvedQuestionsRef = useRef<Set<string>>(new Set());
  const questionSetSentRef = useRef(false);
  const questionsRef = useRef(questions);
  const heroNameRef = useRef(heroName);

  const currentQuestion: GyanClashQuestion = questions[questionIndex % questions.length];
  const winner = hero.hp <= 0 ? rival : rival.hp <= 0 ? hero : null;

  useEffect(() => { questionsRef.current = questions; }, [questions]);
  useEffect(() => { heroNameRef.current = heroName; }, [heroName]);

  const abilities: BattleAbility[] = useMemo(() => [
    { id: 'dhyaan',     label: 'Dhyaan',     ready: hero.streak >= 3, cost: 3, description: 'Restore 18 HP' },
    { id: 'vajra',      label: 'Vajra',      ready: hero.streak >= 5, cost: 5, description: 'Deal 24 damage' },
    { id: 'suraksha',   label: 'Suraksha',   ready: hero.streak >= 4, cost: 4, description: 'Block next hit' },
    { id: 'brahmastra', label: 'Brahmastra', ready: hero.streak >= 7, cost: 7, description: 'Deal 42 damage' },
  ], [hero.streak]);

  const [surakshaActive, setSurakshaActive] = useState(false);

  useEffect(() => {
    let mounted = true;
    // Pull the real quiz-hub questions from Redis for this subject.
    loadGyanClashQuestions(subject, 15)
      .then((qs) => {
        if (mounted && qs.length > 0) {
          setQuestions(qs);
          setQuestionIndex(0);
          setQuestionSecondsLeft(QUESTION_SECONDS);
        }
      })
      .catch(() => {});
    return () => { mounted = false; };
  }, [subject]);

  const clearResolveTimer = useCallback(() => {
    if (resolveTimerRef.current) {
      clearTimeout(resolveTimerRef.current);
      resolveTimerRef.current = null;
    }
  }, []);

  const resolveQuestion = useCallback((questionId: string) => {
    const local = pendingLocalRef.current?.questionId === questionId ? pendingLocalRef.current : null;
    const remote = pendingRemoteRef.current?.questionId === questionId ? pendingRemoteRef.current : null;

    clearResolveTimer();
    resolvedQuestionsRef.current.add(questionId);
    pendingLocalRef.current = null;
    pendingRemoteRef.current = null;

    const question = questionsRef.current.find(q => q.id === questionId);
    if (question?.explanation) {
      setRevealedExplanation(question.explanation);
    }

    if (!local && !remote) {
      setTimeout(() => {
        setSelectedChoiceId(null);
        setRevealedCorrectChoiceId(null);
        setRevealedExplanation(null);
        setComboFlash(null);
        setQuestionSecondsLeft(QUESTION_SECONDS);
        setQuestionIndex(v => v + 1);
      }, 260);
      return;
    }

    const bothCorrect = !!local?.correct && !!remote?.correct;
    const localOnlyCorrect = !!local?.correct && !remote?.correct;
    const remoteOnlyCorrect = !!remote?.correct && !local?.correct;
    const blocked = surakshaActive && remoteOnlyCorrect;

    setPlayers(current => {
      const nextHeroHp = remoteOnlyCorrect && !blocked
        ? Math.max(0, current.hero.hp - (remote?.damage ?? 0))
        : current.hero.hp;
      const nextRivalHp = localOnlyCorrect
        ? Math.max(0, current.rival.hp - (local?.damage ?? 0))
        : current.rival.hp;
      const nextHeroScore = current.hero.score + (local?.correct ? (local?.scoreDelta ?? 0) : 0);
      const nextRivalScore = current.rival.score + (remote?.correct ? (remote?.scoreDelta ?? 0) : 0);
      return {
        hero: {
          ...current.hero,
          hp: nextHeroHp,
          score: nextHeroScore,
          streak: local?.correct ? current.hero.streak + 1 : 0,
          rank: rankForScore(nextHeroScore),
        },
        rival: {
          ...current.rival,
          hp: nextRivalHp,
          score: nextRivalScore,
          streak: remote?.correct ? current.rival.streak + 1 : 0,
          rank: rankForScore(nextRivalScore),
        },
      };
    });

    if (blocked) setSurakshaActive(false);

    if (local?.correct) {
      const streak = local.streakBefore + 1;
      setMissions(v => ({
        correctAnswers: v.correctAnswers + 1,
        streakHits: streak >= 3 ? v.streakHits + 1 : v.streakHits,
        wins: v.wins,
      }));
      if (streak >= 3) setComboFlash(`${streak}x Combo!`);
    }

    if (bothCorrect) {
      const id = Date.now();
      setProjectiles(items => [
        ...items.slice(-4),
        { id: `clash-hero-${id}`, from: 'left',  progress: 0, color: '#FACC15', outcome: 'clash', questionId },
        { id: `clash-rival-${id}`, from: 'right', progress: 0, color: '#FACC15', outcome: 'clash', questionId },
      ]);
    } else if (localOnlyCorrect && local) {
      setProjectiles(items => [
        ...items.slice(-5),
        { id: `hero-${Date.now()}`, from: 'left', progress: 0,
          color: local.streakBefore >= 6 ? '#EF4444' : local.streakBefore >= 4 ? '#FACC15' : '#22C55E',
          outcome: local.streakBefore >= 4 ? 'special' : 'correct', questionId },
      ]);
    } else if (remoteOnlyCorrect && remote) {
      setProjectiles(items => [
        ...items.slice(-5),
        { id: `remote-${remote.answeredAt}`, from: 'right', progress: 0, color: '#F97316', outcome: 'correct', questionId },
      ]);
    }

    const delay = bothCorrect ? 1200 : 900;
    setTimeout(() => {
      setSelectedChoiceId(null);
      setRevealedCorrectChoiceId(null);
      setRevealedExplanation(null);
      setComboFlash(null);
      setQuestionSecondsLeft(QUESTION_SECONDS);
      setQuestionIndex(v => v + 1);
    }, delay);
  }, [clearResolveTimer, surakshaActive]);

  const scheduleResolve = useCallback((questionId: string, delay = ANSWER_RESOLVE_MS) => {
    clearResolveTimer();
    resolveTimerRef.current = setTimeout(() => resolveQuestion(questionId), delay);
  }, [clearResolveTimer, resolveQuestion]);

  useEffect(() => {
    if (status !== 'live' || isFinished) return;
    const timer = setInterval(() => {
      if (Date.now() - startedAtRef.current > DHYAAN_RESET_MINUTES * 60 * 1000) {
        setNeedsBreak(true);
      }
    }, 10000);
    return () => clearInterval(timer);
  }, [isFinished, status]);

  useEffect(() => {
    if (status !== 'live' || isFinished || selectedChoiceId || resolvedQuestionsRef.current.has(currentQuestion.id)) return;
    setQuestionSecondsLeft(QUESTION_SECONDS);
    const timer = setInterval(() => {
      setQuestionSecondsLeft(v => {
        if (v <= 1) {
          clearInterval(timer);
          resolveQuestion(currentQuestion.id);
          return 0;
        }
        return v - 1;
      });
    }, 1000);
    return () => clearInterval(timer);
  }, [currentQuestion.id, isFinished, resolveQuestion, selectedChoiceId, status]);

  useEffect(() => {
    if (mode !== 'realtime' || status === 'idle' || status === 'finished' || !roomCode) return;
    const channel = supabase.channel(`gyan-clash:room:${roomCode}`, {
      config: {
        broadcast: { self: false },
        presence: { key: playerIdRef.current },
      },
    });
    channel
      .on('broadcast', { event: 'questions' }, ({ payload }: { payload: QuestionSetPayload }) => {
        if (payload.playerId === playerIdRef.current || !Array.isArray(payload.questions) || payload.questions.length === 0) return;
        setMatchId(String(payload.matchId));
        setQuestions(payload.questions.slice(0, 15));
        setQuestionIndex(0);
        setQuestionSecondsLeft(QUESTION_SECONDS);
        setStatus('live');
      })
      .on('broadcast', { event: 'answer' }, ({ payload }: { payload: RemoteAnswerPayload }) => {
        if (payload.playerId === playerIdRef.current) return;
        if (resolvedQuestionsRef.current.has(payload.questionId)) return;
        pendingRemoteRef.current = {
          questionId: payload.questionId,
          correct: payload.correct,
          answeredAt: payload.answeredAt,
          damage: payload.damage,
          scoreDelta: payload.scoreDelta,
          streakBefore: rival.streak,
        };
        if (pendingLocalRef.current?.questionId === payload.questionId) {
          resolveQuestion(payload.questionId);
        } else {
          scheduleResolve(payload.questionId);
        }
      })
      .on('broadcast', { event: 'emote' }, ({ payload }: { payload: EmotePayload }) => {
        if (payload.playerId === playerIdRef.current) return;
        setLiveEmote({ id: payload.emoteId, from: 'right', key: Date.now() });
      })
      .on('presence', { event: 'sync' }, () => {
        const state = channel.presenceState();
        const keys = Object.keys(state).sort();
        const count = keys.length;
        setOnlineCount(count);
        if (count >= 2 && prevOnlineRef.current < 2) {
          GyanClashSound.play('matchFound');
        }
        prevOnlineRef.current = count;
        if (count >= 2 && keys[0] === playerIdRef.current && !questionSetSentRef.current) {
          questionSetSentRef.current = true;
          channel.send({
            type: 'broadcast',
            event: 'questions',
            payload: {
              playerId: playerIdRef.current,
              matchId: matchId || `local-${Date.now()}`,
              questions: questionsRef.current.slice(0, 15),
              subject,
            },
          });
          setStatus('live');
        }
      })
      .subscribe(async (event) => {
        if (event !== 'SUBSCRIBED') return;
        await channel.track({ id: playerIdRef.current, name: heroNameRef.current, joinedAt: Date.now() });
      });
    channelRef.current = channel;
    return () => {
      supabase.removeChannel(channel);
      channelRef.current = null;
    };
  }, [matchId, mode, resolveQuestion, rival.streak, scheduleResolve, status, subject, roomCode]);

  useEffect(() => {
    if (!winner) return;
    setIsFinished(true);
    setStatus('finished');
    const xp = winner.id === 'you' ? 40 : 10;
    setXpEarned(xp);
    if (winner.id === 'you') {
      setMissions(v => ({ ...v, wins: v.wins + 1 }));
    }
    setTotalMatches(v => v + 1);
  }, [winner]);

  useEffect(() => {
    if (mode !== 'local-bot' || status !== 'live' || isFinished || selectedChoiceId) return;
    const difficulty = Math.min(questionIndex / 10, 1);
    const baseDelay = 3000 - difficulty * 800;
    const botDelay = baseDelay + Math.floor(Math.random() * 1600);
    const botTimer = setTimeout(() => {
      const correct = Math.random() > (0.44 - difficulty * 0.12);
      setPlayers(current => {
        const damage = correct ? 8 + Math.floor(difficulty * 4) : 0;
        return {
          hero: { ...current.hero, hp: Math.max(0, current.hero.hp - damage) },
          rival: {
            ...current.rival,
            score: current.rival.score + (correct ? 80 : 0),
            streak: correct ? current.rival.streak + 1 : 0,
            rank: rankForScore(current.rival.score + (correct ? 80 : 0)),
          },
        };
      });
      if (correct) {
        setProjectiles(items => [
          ...items.slice(-5),
          { id: `bot-${Date.now()}`, from: 'right', progress: 0, color: '#F97316', outcome: 'correct', questionId: currentQuestion.id },
        ]);
      }
    }, botDelay);
    return () => clearTimeout(botTimer);
  }, [currentQuestion.id, isFinished, mode, questionIndex, selectedChoiceId, status]);

  const answer = useCallback(async (choiceId: string) => {
    if (selectedChoiceId || isFinished) return;
    setSelectedChoiceId(choiceId);
    setQuestionSecondsLeft(0);

    let validation = {
      correct: currentQuestion.correctChoiceId ? choiceId === currentQuestion.correctChoiceId : false,
      correctChoiceId: currentQuestion.correctChoiceId || '',
      scoreDelta: currentQuestion.correctChoiceId && choiceId === currentQuestion.correctChoiceId ? 100 : 0,
      damage: currentQuestion.correctChoiceId && choiceId === currentQuestion.correctChoiceId ? 14 : 0,
    };
    try {
      if (matchId) {
        validation = await submitGyanClashAnswer({ matchId, questionId: currentQuestion.id, selectedChoiceId: choiceId });
      }
    } catch {}

    const correct = validation.correct;
    setRevealedCorrectChoiceId(validation.correctChoiceId || null);
    const streakBonus = correct ? Math.min(hero.streak, 5) * 12 : 0;
    const damage = correct ? validation.damage + Math.min(hero.streak, 4) * 3 : 0;
    HapticService[correct ? 'medium' : 'light']();

    const answeredAt = Date.now();
    const localAnswer: PendingAnswer = {
      questionId: currentQuestion.id,
      correct,
      answeredAt,
      damage,
      scoreDelta: correct ? validation.scoreDelta + streakBonus : 0,
      streakBefore: hero.streak,
    };
    pendingLocalRef.current = localAnswer;

    channelRef.current?.send({
      type: 'broadcast',
      event: 'answer',
      payload: {
        playerId: playerIdRef.current,
        correct,
        questionId: currentQuestion.id,
        answeredAt,
        damage,
        scoreDelta: correct ? validation.scoreDelta + streakBonus : 0,
      },
    });

    if (mode === 'local-bot') {
      if (!correct) {
        pendingRemoteRef.current = {
          questionId: currentQuestion.id,
          correct: true,
          answeredAt: Date.now(),
          damage: 14,
          scoreDelta: 100,
          streakBefore: rival.streak,
        };
      }
      resolveQuestion(currentQuestion.id);
    } else if (pendingRemoteRef.current?.questionId === currentQuestion.id) {
      resolveQuestion(currentQuestion.id);
    } else {
      scheduleResolve(currentQuestion.id);
    }
  }, [currentQuestion, hero.streak, rival.streak, isFinished, matchId, mode, resolveQuestion, scheduleResolve, selectedChoiceId]);

  const sendEmote = useCallback((emoteId: EmoteId) => {
    setLiveEmote({ id: emoteId, from: 'left', key: Date.now() });
    HapticService.light();
    channelRef.current?.send({
      type: 'broadcast',
      event: 'emote',
      payload: { playerId: playerIdRef.current, emoteId },
    });
    setTimeout(() => setLiveEmote(null), 1800);
  }, []);

  const useAbility = useCallback((abilityId: AbilityId) => {
    if (abilityId === 'dhyaan' && hero.streak >= 3) {
      setPlayers(current => ({
        hero: { ...current.hero, hp: Math.min(current.hero.maxHp, current.hero.hp + 18), streak: 0 },
        rival: current.rival,
      }));
      HapticService.medium();
    }
    if (abilityId === 'vajra' && hero.streak >= 5) {
      setPlayers(current => ({
        hero: { ...current.hero, streak: 0 },
        rival: { ...current.rival, hp: Math.max(0, current.rival.hp - 24) },
      }));
      setProjectiles(items => [...items.slice(-5), { id: `vajra-${Date.now()}`, from: 'left', progress: 0, color: '#FACC15', outcome: 'special' }]);
      HapticService.heavy();
    }
    if (abilityId === 'suraksha' && hero.streak >= 4) {
      setSurakshaActive(true);
      setPlayers(current => ({ hero: { ...current.hero, streak: 0 }, rival: current.rival }));
      HapticService.medium();
    }
    if (abilityId === 'brahmastra' && hero.streak >= 7) {
      setPlayers(current => ({
        hero: { ...current.hero, streak: 0 },
        rival: { ...current.rival, hp: Math.max(0, current.rival.hp - 42) },
      }));
      setProjectiles(items => [
        ...items.slice(-5),
        { id: `brahmastra-${Date.now()}`, from: 'left', progress: 0, color: '#EF4444', outcome: 'special' },
      ]);
      HapticService.heavy();
    }
  }, [hero.streak]);

  const tickProjectiles = useCallback(() => {
    setProjectiles(items =>
      items
        .map(item => ({ ...item, progress: item.progress + 0.045 }))
        .filter(item => item.progress < (item.outcome === 'clash' ? 0.58 : 1.08)),
    );
  }, []);

  const restart = useCallback(() => {
    setPlayers(createPlayers(heroName));
    setQuestionIndex(0);
    setSelectedChoiceId(null);
    setRevealedCorrectChoiceId(null);
    setRevealedExplanation(null);
    setQuestionSecondsLeft(QUESTION_SECONDS);
    setProjectiles([]);
    setComboFlash(null);
    setIsFinished(false);
    setXpEarned(0);
    setLiveEmote(null);
    setSurakshaActive(false);
    setStatus(mode === 'realtime' ? 'waiting' : 'live');
    setNeedsBreak(false);
    pendingLocalRef.current = null;
    pendingRemoteRef.current = null;
    resolvedQuestionsRef.current.clear();
    questionSetSentRef.current = false;
    clearResolveTimer();
    startedAtRef.current = Date.now();
  }, [clearResolveTimer, heroName, mode]);

  const startMatch = useCallback((nextMode: MatchMode, nextSubject: SubjectFilter = 'mix', rivalDisplayName?: string) => {
    const botName = nextMode === 'local-bot' ? randomBotName() : 'Prana';
    setSubject(nextSubject);
    setMode(nextMode);
    setPlayers({
      hero:  { id: 'you',   name: heroName, side: 'left',  hp: 100, maxHp: 100, score: 0, streak: 0, rank: 'Sadhak' },
      rival: { id: 'rival', name: rivalDisplayName ?? botName, side: 'right', hp: 100, maxHp: 100, score: 0, streak: 0, rank: 'Sadhak' },
    });
    setQuestions(getDailyQuestionSet(undefined, nextSubject).slice(0, 15));
    setQuestionIndex(0);
    setSelectedChoiceId(null);
    setRevealedCorrectChoiceId(null);
    setRevealedExplanation(null);
    setQuestionSecondsLeft(QUESTION_SECONDS);
    setProjectiles([]);
    setComboFlash(null);
    setIsFinished(false);
    setXpEarned(0);
    setLiveEmote(null);
    setSurakshaActive(false);
    setNeedsBreak(false);
    pendingLocalRef.current = null;
    pendingRemoteRef.current = null;
    resolvedQuestionsRef.current.clear();
    questionSetSentRef.current = false;
    clearResolveTimer();
    setOnlineCount(nextMode === 'local-bot' ? 1 : 0);
    setStatus(nextMode === 'local-bot' ? 'live' : 'waiting');
    startedAtRef.current = Date.now();
  }, [clearResolveTimer, heroName]);

  // ── Room matchmaking ────────────────────────────────────────────────────────
  const enterRealtimeRoom = useCallback((code: string, nextSubject: SubjectFilter = 'mix') => {
    startMatch('realtime', nextSubject);
    prevOnlineRef.current = 0;
    setRoomCode(code);
    // Make sure the host has real Redis questions ready to broadcast.
    loadGyanClashQuestions(nextSubject, 15)
      .then((qs) => {
        if (qs.length > 0) {
          questionsRef.current = qs;
          setQuestions(qs);
        }
      })
      .catch(() => {});
  }, [startMatch]);

  /** Create a private room and return its shareable code. */
  const createRoom = useCallback((nextSubject: SubjectFilter = 'mix') => {
    const code = makeRoomCode();
    enterRealtimeRoom(code, nextSubject);
    return code;
  }, [enterRealtimeRoom]);

  /** Join a friend's room by code. */
  const joinRoom = useCallback((code: string, nextSubject: SubjectFilter = 'mix') => {
    const clean = code.trim().toUpperCase();
    if (clean.length < 3) return false;
    enterRealtimeRoom(clean, nextSubject);
    return true;
  }, [enterRealtimeRoom]);

  /** Drop into a shared per-subject public bucket to face a random player. */
  const quickMatch = useCallback((nextSubject: SubjectFilter = 'mix') => {
    enterRealtimeRoom(`Q-${nextSubject.toUpperCase()}`, nextSubject);
  }, [enterRealtimeRoom]);

  const leaveRoom = useCallback(() => {
    setRoomCode(null);
    setOnlineCount(0);
    prevOnlineRef.current = 0;
    setStatus('idle');
    setMode('local-bot');
  }, []);

  const shareVictory = useCallback(async () => {
    const accuracy = missions.correctAnswers > 0
      ? Math.round((missions.correctAnswers / (questionIndex || 1)) * 100)
      : 0;
    await Share.share({
      title: 'Gyan Clash Victory',
      message: `I won a Gyan Clash battle with ${hero.score} points and ${accuracy}% accuracy! Rank: ${hero.rank}. Beat me on MindGains!`,
    });
  }, [hero.rank, hero.score, missions.correctAnswers, questionIndex]);

  return {
    hero,
    rival,
    mode,
    status,
    subject,
    onlineCount,
    questionSecondsLeft,
    currentQuestion,
    questionIndex,
    selectedChoiceId,
    revealedCorrectChoiceId,
    revealedExplanation,
    projectiles,
    missions,
    abilities,
    comboFlash,
    needsBreak,
    isFinished,
    winner,
    xpEarned,
    liveEmote,
    surakshaActive,
    totalMatches,
    roomCode,
    answer,
    startMatch,
    createRoom,
    joinRoom,
    quickMatch,
    leaveRoom,
    useAbility,
    tickProjectiles,
    restart,
    shareVictory,
    sendEmote,
    dismissBreak: () => setNeedsBreak(false),
  };
}
