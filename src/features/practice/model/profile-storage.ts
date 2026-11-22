import { defaultProfile, KEYS } from './engine';
import type { KeyTargets, Profile, Result } from './types';

// Keep the original storage key so existing installations migrate automatically.
export const STORAGE_KEY = 'wordstride.profile.v1';
const finite = (x: unknown): x is number => typeof x === 'number' && Number.isFinite(x) && x >= 0;
const record = (x: unknown): x is Record<string, unknown> => Boolean(x) && typeof x === 'object' && !Array.isArray(x);
const choice = (x: unknown, options: number[], fallback: number) => typeof x === 'number' && options.includes(x) ? x : fallback;
const bounded = (x: unknown, min: number, max: number, fallback: number) => finite(x) && Number.isInteger(x) && x >= min && x <= max ? x : fallback;
const letter = (x: unknown): x is string => typeof x === 'string' && /^[a-z]$/.test(x);
function dailyTotals(value: unknown): Record<string, number> {
  return Object.fromEntries(Object.entries(record(value) ? value : {}).filter(([date, ms]) => /^[0-9]{4}-[0-9]{2}-[0-9]{2}$/.test(date) && finite(ms))
    .sort(([a], [b]) => a.localeCompare(b)).slice(-90)) as Record<string, number>;
}
function results(value: unknown, key?: string): Result[] {
  if (!Array.isArray(value)) return [];
  return value.filter(record).filter(r => typeof r.date === 'string' && /^[0-9]{4}-[0-9]{2}-[0-9]{2}$/.test(r.date)
    && [r.wpm, r.accuracy, r.correct, r.skipped].every(finite) && (r.accuracy as number) <= 100
    && Number.isInteger(r.correct) && Number.isInteger(r.skipped) && (!key || r.key === key))
    .slice(0, 20).map(r => ({ date: r.date as string, wpm: r.wpm as number, accuracy: r.accuracy as number, correct: r.correct as number, skipped: r.skipped as number, ...(letter(r.key) ? { key: r.key } : {}) }));
}
function targets(value: unknown, fallback: KeyTargets): KeyTargets {
  const t = record(value) ? value : {};
  return { wpm: bounded(t.wpm, 1, 300, fallback.wpm), accuracy: bounded(t.accuracy, 1, 100, fallback.accuracy), dailyGoal: bounded(t.dailyGoal, 1, 240, fallback.dailyGoal) };
}
export function parseProfile(raw: string | null): Profile {
  const base = defaultProfile();
  try {
    const p: unknown = JSON.parse(raw || 'null');
    if (!record(p) || (p.version !== 1 && p.version !== 2)) return base;
    const settings = record(p.settings) ? p.settings : {};
    const keys = p.version === 2 && record(p.keys) ? p.keys : {};
    for (const key of KEYS) {
      const entry = record(keys[key]) ? keys[key] : {};
      const fallback = { ...base.keys[key].targets, dailyGoal: p.version === 1 ? bounded(settings.dailyGoal, 1, 240, 20) : 20 };
      base.keys[key] = { targets: targets(entry.targets, fallback), mastered: entry.mastered === true,
        bestWpm: finite(entry.bestWpm) ? entry.bestWpm : 0, daily: dailyTotals(entry.daily), history: results(entry.history, key) };
    }
    return { ...base,
      selectedKey: p.version === 2 && letter(p.selectedKey) ? p.selectedKey : null,
      bestWpm: finite(p.bestWpm) ? p.bestWpm : 0, score: finite(p.score) ? p.score : 0,
      daily: dailyTotals(p.daily), history: results(p.history),
      settings: { duration: choice(settings.duration, [30, 60, 120], 120),
        sound: typeof settings.sound === 'boolean' ? settings.sound : base.settings.sound,
        keyboard: typeof settings.keyboard === 'boolean' ? settings.keyboard : base.settings.keyboard },
    };
  } catch { return defaultProfile(); }
}
export function loadProfile(): Profile {
  try { return parseProfile(localStorage.getItem(STORAGE_KEY)); } catch { return defaultProfile(); }
}

type StorageResult = { status: 'changed'; profile: Profile } | { status: 'unchanged' | 'saved' | 'unavailable' };

/** Check the last observed value before saving so an open tab cannot restore
 * deleted progress or silently overwrite a newer profile from another tab. */
export function createProfileStore(getStorage: () => Pick<Storage, 'getItem' | 'setItem'> = () => localStorage) {
  let snapshot: string | null | undefined;
  try { snapshot = getStorage().getItem(STORAGE_KEY); } catch { /* Storage may become available later. */ }
  const initialProfile = parseProfile(snapshot ?? null);

  function sync(): StorageResult {
    try {
      const raw = getStorage().getItem(STORAGE_KEY);
      if (raw === snapshot) return { status: 'unchanged' };
      snapshot = raw;
      return { status: 'changed', profile: parseProfile(raw) };
    } catch { return { status: 'unavailable' }; }
  }

  function save(profile: Profile): StorageResult {
    const result = sync();
    if (result.status !== 'unchanged') return result;
    try {
      const raw = JSON.stringify(profile);
      if (raw !== snapshot) getStorage().setItem(STORAGE_KEY, raw);
      snapshot = raw;
      return { status: 'saved' };
    } catch { return { status: 'unavailable' }; }
  }

  return { initialProfile, sync, save };
}
