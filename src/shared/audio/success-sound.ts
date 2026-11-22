export type SoundResult = 'played' | 'muted' | 'unavailable';

function browserAudio(): AudioContext {
  const Constructor = globalThis.AudioContext || (globalThis as typeof globalThis & { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
  if (!Constructor) throw new Error('Audio is not supported.');
  return new Constructor({ latencyHint: 'interactive' });
}

/** Create/resume audio from a user gesture, then schedule against the running clock. */
export function createSuccessSound(isEnabled: () => boolean, createContext = browserAudio) {
  let context: AudioContext | null = null;
  let disposed = false;

  async function prepare(): Promise<boolean> {
    if (disposed) return false;
    try {
      if (!context || context.state === 'closed') context = createContext();
      if (context.state !== 'running') await context.resume();
      return !disposed && context.state === 'running';
    } catch { return false; }
  }

  return {
    prepare,
    async play(preview = false): Promise<SoundResult> {
      if (disposed || (!preview && !isEnabled())) return 'muted';
      if (!await prepare() || !context) return disposed ? 'muted' : 'unavailable';
      // The user can mute while a suspended browser context is resuming.
      if (disposed || (!preview && !isEnabled())) return 'muted';
      try {
        const start = context.currentTime + 0.01;
        // A quick C-major ascent with an octave finish: a small arcade win.
        // Soft attacks and short tails keep repeated word rewards comfortable.
        const notes = [523.25, 659.25, 783.99, 1046.5];
        for (const [index, frequency] of notes.entries()) {
          const onset = start + index * 0.055;
          const duration = index === notes.length - 1 ? 0.2 : 0.13;
          const oscillator = context.createOscillator();
          const gain = context.createGain();
          oscillator.type = 'triangle';
          oscillator.frequency.setValueAtTime(frequency, onset);
          gain.gain.setValueAtTime(0.001, onset);
          gain.gain.linearRampToValueAtTime(0.12, onset + 0.008);
          gain.gain.exponentialRampToValueAtTime(0.001, onset + duration);
          oscillator.connect(gain);
          gain.connect(context.destination);
          oscillator.onended = () => { oscillator.disconnect(); gain.disconnect(); };
          oscillator.start(onset);
          oscillator.stop(onset + duration + 0.01);
        }
        return 'played';
      } catch { return 'unavailable'; }
    },
    dispose() {
      disposed = true;
      if (context && context.state !== 'closed') void context.close().catch(() => {});
      context = null;
    },
  };
}
