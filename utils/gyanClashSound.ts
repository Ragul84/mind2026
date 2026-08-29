// Gyan Clash sound layer
// A tiny pooled wrapper over expo-av that maps battle events to the shared
// assets/sounds library. Lazy-loads on first play, caches Audio.Sound objects,
// is mute-aware and never throws into the game loop.

import { Audio } from 'expo-av';

export type GyanClashSoundName =
  | 'countdown'   // tick on 3 / 2 / 1
  | 'fight'       // "FIGHT!" go
  | 'correct'     // right answer chime
  | 'wrong'       // wrong answer buzz
  | 'combo'       // streak milestone
  | 'special'     // special move charged / fired
  | 'swoosh'      // generic whoosh / transition
  | 'matchFound'  // online opponent joined
  | 'victory'     // match won
  | 'defeat'      // match lost
  | 'tap'         // UI button press
  | 'points';     // score / reward reveal

// require() must be static so the Metro bundler can resolve assets.
const SOUND_SOURCES: Record<GyanClashSoundName, number> = {
  countdown:  require('@/assets/sounds/select.mp3'),
  fight:      require('@/assets/sounds/game-start.mp3'),
  correct:    require('@/assets/sounds/quizcorrect.mp3'),
  wrong:      require('@/assets/sounds/quizwrong.mp3'),
  combo:      require('@/assets/sounds/tada.mp3'),
  special:    require('@/assets/sounds/powerup.mp3'),
  swoosh:     require('@/assets/sounds/swoosh.mp3'),
  matchFound: require('@/assets/sounds/match-found.mp3'),
  victory:    require('@/assets/sounds/victory.mp3'),
  defeat:     require('@/assets/sounds/lose.mp3'),
  tap:        require('@/assets/sounds/tap.wav'),
  points:     require('@/assets/sounds/pointsreveal.mp3'),
};

// Per-sound volume trim so nothing overpowers the punchy combat SFX.
const SOUND_VOLUME: Partial<Record<GyanClashSoundName, number>> = {
  countdown: 0.5,
  tap: 0.4,
  swoosh: 0.6,
  correct: 0.85,
  wrong: 0.8,
  combo: 0.9,
  victory: 1.0,
  defeat: 0.9,
};

class GyanClashSoundService {
  private cache: Partial<Record<GyanClashSoundName, Audio.Sound>> = {};
  private loading: Partial<Record<GyanClashSoundName, Promise<Audio.Sound | null>>> = {};
  private muted = false;
  private audioModeSet = false;

  setMuted(muted: boolean) {
    this.muted = muted;
  }

  isMuted() {
    return this.muted;
  }

  private async ensureAudioMode() {
    if (this.audioModeSet) return;
    this.audioModeSet = true;
    try {
      await Audio.setAudioModeAsync({
        playsInSilentModeIOS: true,
        shouldDuckAndroid: true,
        staysActiveInBackground: false,
      });
    } catch {
      // non-fatal
    }
  }

  private async load(name: GyanClashSoundName): Promise<Audio.Sound | null> {
    if (this.cache[name]) return this.cache[name]!;
    if (this.loading[name]) return this.loading[name]!;

    const p = (async () => {
      try {
        await this.ensureAudioMode();
        const { sound } = await Audio.Sound.createAsync(SOUND_SOURCES[name], {
          shouldPlay: false,
          volume: SOUND_VOLUME[name] ?? 0.8,
        });
        this.cache[name] = sound;
        return sound;
      } catch {
        return null;
      } finally {
        delete this.loading[name];
      }
    })();

    this.loading[name] = p;
    return p;
  }

  /** Preload a set of sounds (e.g. on lobby mount) so the first play is instant. */
  async preload(names: GyanClashSoundName[]) {
    await Promise.all(names.map(n => this.load(n).catch(() => null)));
  }

  /** Fire-and-forget play. Restarts from 0 so rapid repeats still trigger. */
  async play(name: GyanClashSoundName) {
    if (this.muted) return;
    try {
      const sound = await this.load(name);
      if (!sound || this.muted) return;
      await sound.setPositionAsync(0);
      await sound.setVolumeAsync(SOUND_VOLUME[name] ?? 0.8);
      await sound.playAsync();
    } catch {
      // swallow — audio must never break the game loop
    }
  }

  async unloadAll() {
    const sounds = Object.values(this.cache);
    this.cache = {};
    this.loading = {};
    await Promise.all(sounds.map(s => s?.unloadAsync().catch(() => {})));
  }
}

export const GyanClashSound = new GyanClashSoundService();
export default GyanClashSound;
