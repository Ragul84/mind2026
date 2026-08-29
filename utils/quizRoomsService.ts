import { supabase } from './supabaseService';
import { SupabaseService } from './supabaseService';
import HapticService from './hapticService';
import RedisService from './redisService';
import { AIUsageService } from '@/services/aiUsageService';
import { QuizQuestionEnvelope, normalizeQuizQuestion } from './quizQuestionTypes';

// ─── Types ────────────────────────────────────────────────────────────────────

export interface QuizRoom {
  id: string;
  creator_id: string;
  creator_name: string;
  title: string;
  topic: string;
  exam_category: string | null;
  question_count: number;
  time_per_question: number; // seconds
  prize_pool: number;
  winner_count: number;           // Top 3 or Top 5
  prize_splits: number[];         // e.g. [50, 30, 20]
  questions_data: QuizQuestion[];
  status: 'waiting' | 'active' | 'completed';
  join_code: string;
  participant_count: number;
  created_at: string;
  ended_at: string | null;
}

export interface QuizQuestion extends QuizQuestionEnvelope {}

export interface RoomParticipant {
  id: string;
  room_id: string;
  user_id: string | null;
  display_name: string;
  score: number;
  time_taken: number; // total seconds
  rank: number | null;
  coin_reward: number;
  answers: ParticipantAnswer[];
  joined_at: string;
  completed_at: string | null;
}

export interface ParticipantAnswer {
  question_index: number;
  selected_index: number;
  is_correct: boolean;
  time_taken: number; // seconds for this question
  question_type?: string;
  response?: any;
}

export interface LeaderboardEntry {
  rank: number;
  display_name: string;
  score: number;
  time_taken: number;
  coin_reward: number;
  is_me: boolean;
}

// ─── Room CRUD ─────────────────────────────────────────────────────────────────

export class QuizRoomsService {
  // "My rooms" is read from two separate screens (arena tab + quiz-rooms hub),
  // each re-fetching on every focus. Short TTL (rooms are semi-live — status/
  // participant_count can change) so bouncing between the two screens or
  // switching tabs doesn't re-query every time, while still staying reasonably
  // fresh. Invalidated immediately after creating a room.
  private static myRoomsCache: { userId: string; rooms: QuizRoom[]; at: number } | null = null;
  private static readonly MY_ROOMS_CACHE_TTL_MS = 15_000;

  static invalidateMyRoomsCache(): void {
    this.myRoomsCache = null;
  }

  // Generate a short human-readable join code like "TIGER42"
  static generateJoinCode(): string {
    const words = ['STAR', 'BOLT', 'LION', 'NOVA', 'BLAZE', 'APEX', 'WOLF', 'SAGE', 'HAWK', 'TIDE'];
    const word = words[Math.floor(Math.random() * words.length)];
    const num = Math.floor(10 + Math.random() * 90);
    return `${word}${num}`;
  }

  // Calculate prize splits for winner_count
  static calculatePrizeSplits(prizePool: number, winnerCount: number): number[] {
    if (winnerCount === 1) return [prizePool];
    if (winnerCount === 3) return [
      Math.floor(prizePool * 0.50),
      Math.floor(prizePool * 0.30),
      Math.floor(prizePool * 0.20),
    ];
    if (winnerCount === 5) return [
      Math.floor(prizePool * 0.40),
      Math.floor(prizePool * 0.25),
      Math.floor(prizePool * 0.17),
      Math.floor(prizePool * 0.10),
      Math.floor(prizePool * 0.08),
    ];
    // Equal split fallback
    const base = Math.floor(prizePool / winnerCount);
    return Array(winnerCount).fill(base);
  }

  // ── Create a new quiz room (escrows coins from creator) ──────────────────────
  static async createRoom(data: {
    title: string;
    topic: string;
    examCategory?: string;
    questionCount: number;
    timePerQuestion: number;
    prizePool: number;
    winnerCount: number;
    questions: QuizQuestion[];
  }): Promise<QuizRoom> {
    const user = await SupabaseService.getCurrentUser();
    if (!user) throw new Error('Please log in to create a room');

    // Escrow: check & deduct coins
    if (data.prizePool > 0) {
      const canAfford = await SupabaseService.checkCanAfford(data.prizePool);
      if (!canAfford) throw new Error('Insufficient coins for this prize pool');
      const deducted = await SupabaseService.deductCoins(data.prizePool);
      if (!deducted) throw new Error('Failed to escrow prize coins');
    }

    const joinCode = this.generateJoinCode();
    const prizeSplits = this.calculatePrizeSplits(data.prizePool, data.winnerCount);

    // Get creator display name
    let creatorName = 'Host';
    try {
      const { data: profile } = await supabase
        .from('user_profiles')
        .select('full_name')
        .eq('id', user.id)
        .single();
      creatorName = profile?.full_name || 'Host';
    } catch {}

    const { data: room, error } = await supabase
      .from('quiz_rooms')
      .insert({
        creator_id: user.id,
        creator_name: creatorName,
        title: data.title,
        topic: data.topic,
        exam_category: data.examCategory || null,
        question_count: data.questionCount,
        time_per_question: data.timePerQuestion,
        prize_pool: data.prizePool,
        winner_count: data.winnerCount,
        prize_splits: prizeSplits,
        questions_data: data.questions,
        status: 'waiting',
        join_code: joinCode,
        participant_count: 0,
      })
      .select()
      .single();

    if (error) throw error;
    HapticService.success();
    this.invalidateMyRoomsCache();
    return room as QuizRoom;
  }

  // ── Fetch room by ID ──────────────────────────────────────────────────────────
  static async getRoomById(roomId: string): Promise<QuizRoom | null> {
    const { data, error } = await supabase.functions.invoke('quiz-room-get', {
      body: { id: roomId },
    });
    if (error || !data?.success) return null;
    return data.room as QuizRoom;
  }

  // ── Fetch room by join code ────────────────────────────────────────────────
  static async getRoomByCode(code: string): Promise<QuizRoom | null> {
    const { data, error } = await supabase.functions.invoke('quiz-room-get', {
      body: { code },
    });
    if (error || !data?.success) return null;
    return data.room as QuizRoom;
  }

  // ── My created rooms ───────────────────────────────────────────────────────
  static async getMyRooms(opts?: { force?: boolean }): Promise<QuizRoom[]> {
    const user = await SupabaseService.getCurrentUser();
    if (!user) return [];
    if (
      !opts?.force &&
      this.myRoomsCache &&
      this.myRoomsCache.userId === user.id &&
      Date.now() - this.myRoomsCache.at < this.MY_ROOMS_CACHE_TTL_MS
    ) {
      return this.myRoomsCache.rooms;
    }
    const { data } = await supabase
      .from('quiz_rooms')
      .select('id, creator_id, creator_name, title, topic, exam_category, question_count, time_per_question, prize_pool, winner_count, prize_splits, status, join_code, participant_count, created_at, ended_at')
      .eq('creator_id', user.id)
      .order('created_at', { ascending: false })
      .limit(20);
    const rooms = (data || []).map((room: any) => ({ ...room, questions_data: [] })) as QuizRoom[];
    this.myRoomsCache = { userId: user.id, rooms, at: Date.now() };
    return rooms;
  }

  // ── Join a room (create participant record) ────────────────────────────────
  static async joinRoom(roomId: string, displayName: string): Promise<RoomParticipant> {
    const user = await SupabaseService.getCurrentUser();
    if (!user) throw new Error('Please log in to join ranked quiz rooms.');

    const { data: participant, error } = await supabase
      .from('quiz_room_participants')
      .insert({
        room_id: roomId,
        user_id: user.id,
        display_name: displayName,
        score: 0,
        time_taken: 0,
        answers: [],
        coin_reward: 0,
      })
      .select()
      .single();

    if (error) throw error;

    // Increment participant count
    await supabase.rpc('increment_room_participants', { room_id: roomId });

    HapticService.success();
    return participant as RoomParticipant;
  }

  // ── Submit final score for a participant ──────────────────────────────────
  static async submitScore(participantId: string, data: {
    score: number;
    timeTaken: number;
    answers: ParticipantAnswer[];
  }): Promise<{ score: number; timeTaken: number; answers: ParticipantAnswer[] }> {
    const { data: result, error } = await supabase.functions.invoke('quiz-room-submit', {
      body: {
        participantId,
        answers: data.answers,
      },
    });

    if (error || !result?.success) throw new Error(error?.message || result?.error || 'Score submission failed');
    return {
      score: result.score,
      timeTaken: result.timeTaken,
      answers: result.answers,
    };
  }

  // ── Get leaderboard for a room ─────────────────────────────────────────────
  static async getLeaderboard(roomId: string, currentParticipantId?: string): Promise<LeaderboardEntry[]> {
    const { data, error } = await supabase
      .from('quiz_room_participants')
      .select('id, display_name, score, time_taken, rank, coin_reward')
      .eq('room_id', roomId)
      .not('completed_at', 'is', null)
      .order('score', { ascending: false })
      .order('time_taken', { ascending: true })
      .limit(50);

    if (error) return [];

    return (data || []).map((p: any, index: number) => ({
      rank: p.rank ?? index + 1,
      display_name: p.display_name,
      score: p.score,
      time_taken: p.time_taken,
      coin_reward: p.coin_reward,
      is_me: p.id === currentParticipantId,
    }));
  }

  // ── Live participant count (poll this) ─────────────────────────────────────
  static async getParticipantCount(roomId: string): Promise<number> {
    const { count } = await supabase
      .from('quiz_room_participants')
      .select('*', { count: 'exact', head: true })
      .eq('room_id', roomId);
    return count || 0;
  }

  // ── Close room & distribute coins to winners (creator calls this) ──────────
  static async closeAndDistribute(roomId: string): Promise<{ success: boolean; message: string }> {
    const user = await SupabaseService.getCurrentUser();
    if (!user) return { success: false, message: 'Not authenticated' };

    const { data, error } = await supabase.functions.invoke('quiz-room-close', {
      body: { roomId },
    });
    if (error || !data?.success) return { success: false, message: error?.message || data?.error || 'Failed to close room' };
    HapticService.success();
    this.invalidateMyRoomsCache();
    return { success: true, message: `Ranked ${data.ranked || 0} participants and distributed prizes.` };
  }

  // Helper to map free-text topics to existing Redis database keys
  static matchRedisKey(topic: string): string | null {
    const t = topic.toLowerCase().trim();
    if (t.includes('tamil')) return 'tamil';
    if (t.includes('history') || t.includes('ancient') || t.includes('medieval') || t.includes('modern') || t.includes('freedom') || t.includes('national movement')) return 'history';
    if (t.includes('math') || (t.includes('quant') && !t.includes('quantum')) || t.includes('aptitude') || t.includes('algebra') || t.includes('simplification') || t.includes('lcm') || t.includes('hcf') || t.includes('interest') || t.includes('work') || t.includes('ratio')) return 'maths';
    if (t.includes('polity') || t.includes('constitution') || t.includes('parliament') || t.includes('civics') || t.includes('governance') || t.includes('government')) return 'polity';
    if (t.includes('econ') || t.includes('budget') || t.includes('gdp') || t.includes('tax') || t.includes('gst')) return 'economics';
    if (t.includes('geography') || t.includes('earth') || t.includes('soil') || t.includes('river') || t.includes('climate') || t.includes('monsoon') || t.includes('ocean')) return 'geography';
    if (t.includes('science') || t.includes('physics') || t.includes('chemistry') || t.includes('biology') || t.includes('flask') || t.includes('disease') || t.includes('health') || t.includes('atom') || t.includes('cell') || t.includes('plant') || t.includes('environment') || t.includes('ecology') || t.includes('quantum')) return 'science';
    if (t.includes('english') || t.includes('comprehension') || t.includes('grammar') || t.includes('vocab')) return 'english';
    if (t.includes('current') || t.includes('affair') || t.includes('news') || t.includes('event')) return 'current_affairs';
    if (t.includes('reasoning') || t.includes('intelligence') || t.includes('puzzle') || t.includes('series') || t.includes('coding')) return 'reasoning';
    return null;
  }

  static async generateQuestions(topic: string, count: number): Promise<QuizQuestion[]> {
    const cleanTopic = topic.trim();
    if (!cleanTopic) return [];

    try {
      // 1. Try to search in the Redis database from Quiz Hub first (High-yield free source!)
      const matchedKey = this.matchRedisKey(cleanTopic);
      if (matchedKey) {
        try {
          const redisQuestions = await RedisService.getQuestions(matchedKey, count);
          if (redisQuestions && redisQuestions.length > 0) {
            return redisQuestions
              .map((q: any) => normalizeQuizQuestion(q))
              .filter(Boolean) as QuizQuestion[];
          }
        } catch (redisErr) {
          console.warn('⚠️ Redis fetch failed, proceeding to next fallbacks. Error:', redisErr);
        }
      }

      // 2. Try to find a past quiz room matching the topic in Postgres database
      const { data: existingRooms, error: dbError } = await supabase
        .from('quiz_rooms')
        .select('id')
        .ilike('topic', `%${cleanTopic}%`)
        .order('created_at', { ascending: false })
        .limit(10); // Check the 10 most recent rooms

      const rooms = (existingRooms || []) as Array<{ questions_data?: QuizQuestion[] }>;
      if (false && !dbError && rooms.length > 0) {
        // Iterate through rooms to find one with enough questions
        for (const room of rooms) {
          const qList = (room.questions_data || []) as QuizQuestion[];
          if (qList.length >= count) {
            return qList
              .slice(0, count)
              .map((q: any) => normalizeQuizQuestion(q))
              .filter(Boolean) as QuizQuestion[];
          }
        }
      }

      // 3. Fallback to live AI Edge Function generation
      const usage = await AIUsageService.check('quiz_room_generate');
      if (!usage.allowed) {
        throw new Error(`LIMIT_REACHED:${AIUsageService.limitMessage(usage)}`);
      }

      const { data, error } = await supabase.functions.invoke('miga_quiz_burst_generate', {
        body: { topic: cleanTopic, count },
      });
      if (error) throw new Error(`GENERATION_FAILED:${error.message || 'AI generation failed'}`);
      await AIUsageService.consume('quiz_room_generate');

      const rawQuestions = data?.questions || [];
      const normalized = rawQuestions
        .map((q: any) => normalizeQuizQuestion(q))
        .filter(Boolean) as QuizQuestion[];

      // A "successful" call with zero usable questions is still a failure the
      // user needs to know about — surfacing it here instead of returning []
      // stops the caller from silently substituting fake placeholder questions.
      if (normalized.length === 0) {
        throw new Error('GENERATION_FAILED:AI returned no usable questions');
      }

      return normalized;
    } catch (err) {
      const message = String((err as any)?.message || '');
      if (message.startsWith('LIMIT_REACHED:') || message.startsWith('GENERATION_FAILED:')) throw err;
      console.warn('🤖 generateQuestions failed completely. Error:', err);
      throw new Error(`GENERATION_FAILED:${message || 'Could not generate questions'}`);
    }
  }

  // ── Format seconds as mm:ss ────────────────────────────────────────────────
  static formatTime(seconds: number): string {
    const m = Math.floor(seconds / 60);
    const s = seconds % 60;
    return m > 0 ? `${m}m ${s}s` : `${s}s`;
  }

  // ── Get share URL for a room ────────────────────────────────────────────────
  static getRoomShareUrl(roomId: string, joinCode: string): string {
    return `https://mindgains.app/room/${joinCode}`;
  }

  // ── Get share message ──────────────────────────────────────────────────────
  static getShareMessage(room: QuizRoom): string {
    const url = this.getRoomShareUrl(room.id, room.join_code);
    const prize = room.prize_pool > 0 ? ` Win ${room.prize_pool} coins!` : '';
    return `🎯 ${room.creator_name} challenged you to "${room.title}"!${prize}\n\n` +
      `${room.question_count} questions • ${room.time_per_question}s each\n\n` +
      `Join code: ${room.join_code}\n${url}`;
  }
}
