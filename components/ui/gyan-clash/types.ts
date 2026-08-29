export type GyanClashChoice = {
  id: string;
  text: string;
};

export type GyanClashQuestion = {
  id: string;
  subject: string;
  prompt: string;
  choices: GyanClashChoice[];
  correctChoiceId?: string;
  explanation: string;
  difficulty: 'easy' | 'medium' | 'hard';
};

export type PlayerSide = 'left' | 'right';

export type BattlePlayer = {
  id: string;
  name: string;
  side: PlayerSide;
  hp: number;
  maxHp: number;
  score: number;
  streak: number;
  rank: string;
};

export type BattleParticle = {
  id: string;
  x: number;
  y: number;
  vx: number;
  vy: number;
  radius: number;
  color: string;
  life: number;
};

export type BattleProjectile = {
  id: string;
  from: PlayerSide;
  progress: number;
  color: string;
  outcome: 'correct' | 'punish' | 'clash' | 'special';
  questionId?: string;
};

export type DailyMissionProgress = {
  correctAnswers: number;
  streakHits: number;
  wins: number;
};

export type AbilityId = 'dhyaan' | 'vajra' | 'brahmastra' | 'suraksha';

export type BattleAbility = {
  id: AbilityId;
  label: string;
  ready: boolean;
  cost: number;
  description: string;
};

export type MatchMode = 'local-bot' | 'realtime';

export type MatchStatus = 'idle' | 'waiting' | 'live' | 'finished';

export type GamePhase = 'lobby' | 'countdown' | 'battle' | 'results';

export type SubjectFilter = 'mix' | 'history' | 'geography' | 'polity' | 'science' | 'economy' | 'physics' | 'biology';

export type EmoteId = 'fire' | 'strong' | 'pray' | 'skull';

export type LiveEmote = {
  id: EmoteId;
  from: PlayerSide;
  key: number;
};

export type ArenaLane = 0 | 1 | 2;

export type WorldEntityKind = 'hero' | 'rival' | 'orb' | 'hazard';

export type WorldEntity = {
  id: string;
  kind: WorldEntityKind;
  x: number;
  y: number;
  lane: ArenaLane;
  radius: number;
  color: string;
};
