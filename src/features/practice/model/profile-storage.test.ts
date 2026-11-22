import { afterEach, describe, expect, it, vi } from 'vitest';
import { defaultProfile } from './engine';
import { createProfileStore, loadProfile, parseProfile, STORAGE_KEY } from './profile-storage';

afterEach(() => vi.unstubAllGlobals());

function storedProgress() {
  const profile = defaultProfile();
  profile.score = 1250;
  profile.selectedKey = 'r';
  profile.keys.r.mastered = true;
  profile.keys.r.bestWpm = 70;
  const values = new Map([[STORAGE_KEY, JSON.stringify(profile)]]);
  const storage = { getItem: vi.fn((key: string) => values.get(key) ?? null),
    setItem: vi.fn((key: string, value: string) => { values.set(key, value); }) };
  return { profile, values, storage, store: createProfileStore(() => storage) };
}

describe('progress synchronization while the app is open', () => {
  it.each(['remove', 'clear'])('does not resurrect scores after external %s, even before a storage event', operation => {
    const { profile, values, storage, store } = storedProgress();
    if (operation === 'remove') values.delete(STORAGE_KEY);
    else values.clear();
    expect(store.save(profile)).toEqual({ status: 'changed', profile: defaultProfile() });
    expect(storage.setItem).not.toHaveBeenCalled();
    expect(values.has(STORAGE_KEY)).toBe(false);
    expect(store.save(defaultProfile()).status).toBe('saved');
    expect(parseProfile(values.get(STORAGE_KEY)!)).toEqual(defaultProfile());
  });

  it('adopts a newer profile instead of overwriting it from an older tab', () => {
    const { profile, values, storage, store } = storedProgress();
    const otherTab = createProfileStore(() => storage);
    const newer = { ...profile, score: 2000 };
    expect(otherTab.save(newer).status).toBe('saved');
    storage.setItem.mockClear();
    expect(store.save(profile)).toEqual({ status: 'changed', profile: newer });
    expect(storage.setItem).not.toHaveBeenCalled();
    expect(parseProfile(values.get(STORAGE_KEY)!)).toEqual(newer);
  });

  it('detects a deletion on sync while idle and does not repeatedly reset', () => {
    const { values, store } = storedProgress();
    values.delete(STORAGE_KEY);
    expect(store.sync()).toEqual({ status: 'changed', profile: defaultProfile() });
    expect(store.sync().status).toBe('unchanged');
  });

  it('ignores unrelated dictionary changes and its own saves', () => {
    const { values, storage, store } = storedProgress();
    values.set('wordstride.dictionary.v1', '[]');
    expect(store.sync().status).toBe('unchanged');
    expect(store.save(store.initialProfile).status).toBe('saved');
    expect(storage.setItem).not.toHaveBeenCalled();
    expect(store.save({ ...store.initialProfile, score: 1300 }).status).toBe('saved');
    expect(store.sync().status).toBe('unchanged');
  });

  it('refuses to write when reading storage fails and recovers when access returns', () => {
    const { profile, storage, store } = storedProgress();
    storage.getItem.mockImplementationOnce(() => { throw new Error('Storage denied'); });
    expect(store.save(profile).status).toBe('unavailable');
    expect(storage.setItem).not.toHaveBeenCalled();
    expect(store.save(profile).status).toBe('saved');
    storage.setItem.mockImplementationOnce(() => { throw new Error('Quota exceeded'); });
    expect(store.save({ ...profile, score: 1500 }).status).toBe('unavailable');
    expect(store.save({ ...profile, score: 1500 }).status).toBe('saved');
  });

  it('loads existing progress safely when initially unavailable storage returns', () => {
    const { profile, storage } = storedProgress();
    storage.getItem.mockImplementationOnce(() => { throw new Error('Storage denied'); });
    const store = createProfileStore(() => storage);
    expect(store.initialProfile).toEqual(defaultProfile());
    expect(store.save(defaultProfile())).toEqual({ status: 'changed', profile });
    expect(storage.setItem).not.toHaveBeenCalled();
  });
});
const result = { date: '2026-11-22', wpm: 45.5, accuracy: 98.2, correct: 65, skipped: 2 };
describe('saved per-key progress', () => {
  it.each([null, '', '{broken', 'null', '[]', '42', '{"version":3}'])('starts safely for missing, malformed or unsupported storage: %j', raw => {
    expect(parseProfile(raw)).toEqual(defaultProfile());
  });

  it('round-trips per-key targets, achievements, statistics and preferences', () => {
    const profile = defaultProfile();
    profile.selectedKey = 'r';
    profile.bestWpm = 45.5;
    profile.score = 1230;
    profile.daily = { '2026-11-21': 62000, '2026-11-22': 720000 };
    profile.history = [result];
    profile.settings = { duration: 30, sound: false, keyboard: false };
    profile.keys.r = { targets: { wpm: 60, accuracy: 99, dailyGoal: 10 }, mastered: true,
      bestWpm: 60, daily: { '2026-11-22': 10000 }, history: [{ ...result, key: 'r' }] };
    expect(parseProfile(JSON.stringify(profile))).toEqual(profile);
  });

  it('migrates v1 settings and history but does not transfer old unlocks into new achievements', () => {
    const legacy = { version: 1, unlocked: 26, qualifying: 2, bestWpm: 55, score: 999,
      daily: { '2026-11-22': 5000 }, history: [result], english: { letter: 'r', completed: { r: ['retain'] } },
      settings: { duration: 60, sound: false, keyboard: false, dailyGoal: 30 },
      keys: { r: { mastered: true } } };
    const profile = parseProfile(JSON.stringify(legacy));
    expect(profile).toMatchObject({ version: 2, selectedKey: null, bestWpm: 55, score: 999, daily: legacy.daily, history: [result],
      settings: { duration: 60, sound: false, keyboard: false } });
    for (const key of Object.values(profile.keys)) expect(key).toEqual({ targets: { wpm: 45, accuracy: 97, dailyGoal: 30 }, mastered: false, bestWpm: 0, daily: {}, history: [] });
    expect(profile).not.toHaveProperty('english');
    expect(profile).not.toHaveProperty('unlocked');
    expect(parseProfile(JSON.stringify(profile))).toEqual(profile);
  });

  it('rejects invalid target, selection, numeric and settings data field by field', () => {
    const profile = parseProfile(JSON.stringify({ version: 2, selectedKey: '__proto__', score: -1, bestWpm: 'fast',
      settings: { duration: 999, sound: 'yes', keyboard: 'no' }, keys: {
        r: { targets: { wpm: 301, accuracy: 97.5, dailyGoal: 0 }, mastered: 'yes', bestWpm: -2 },
        a: { targets: { wpm: 1, accuracy: 100, dailyGoal: 240 }, mastered: true },
        b: null, c: [], d: { targets: { wpm: null, accuracy: '99', dailyGoal: 10 } },
      } }));
    expect(profile).toMatchObject({ selectedKey: null, score: 0, bestWpm: 0 });
    expect(profile.settings).toEqual(defaultProfile().settings);
    expect(profile.keys.r).toEqual(defaultProfile().keys.r);
    expect(profile.keys.a.targets).toEqual({ wpm: 1, accuracy: 100, dailyGoal: 240 });
    expect(profile.keys.d.targets).toEqual({ wpm: 45, accuracy: 97, dailyGoal: 10 });
    expect(Object.keys(profile.keys)).toHaveLength(26);
  });

  it('keeps valid daily entries and removes malformed dates or values for both global and key stats', () => {
    const daily = { '2026-11-22': 1000, '2026-11-21': 0, bad: 1000, '2026-11-20': -1, '2026-11-19': '1000' };
    const profile = parseProfile(JSON.stringify({ version: 2, daily, keys: { r: { daily } } }));
    expect(profile.daily).toEqual({ '2026-11-21': 0, '2026-11-22': 1000 });
    expect(profile.keys.r.daily).toEqual(profile.daily);
  });

  it('retains only the 90 most recent daily totals globally and per key', () => {
    const daily = Object.fromEntries(Array.from({ length: 100 }, (_, i) => {
      const date = new Date(Date.UTC(2026, 0, i + 1));
      return [date.toISOString().slice(0, 10), 1000];
    }));
    const saved = parseProfile(JSON.stringify({ version: 2, daily, keys: { r: { daily } } }));
    expect(Object.keys(saved.daily)).toHaveLength(90);
    expect(saved.daily['2026-01-01']).toBeUndefined();
    expect(saved.daily['2026-04-10']).toBe(1000);
    expect(saved.keys.r.daily).toEqual(saved.daily);
  });

  it('filters malformed history and caps both recent-session lists', () => {
    const history = [null, { ...result, wpm: -2 }, { ...result, correct: '50' }, { ...result, accuracy: 101 }, ...Array(25).fill(result)];
    const profile = parseProfile(JSON.stringify({ version: 2, history, keys: { r: { history: [{ ...result, key: 'a' }, ...history.filter(Boolean).map(r => ({ ...r, key: 'r' }))] } } }));
    expect(profile.history).toHaveLength(20);
    expect(profile.keys.r.history).toHaveLength(20);
    expect(profile.keys.r.history.every(item => item.key === 'r' && item.wpm === 45.5)).toBe(true);
  });

  it('loads only the application storage key', () => {
    const profile = { ...defaultProfile(), selectedKey: 'r' };
    const getItem = vi.fn(() => JSON.stringify(profile));
    vi.stubGlobal('localStorage', { getItem });
    expect(loadProfile().selectedKey).toBe('r');
    expect(getItem).toHaveBeenCalledWith(STORAGE_KEY);
  });

  it('still starts when browser storage is unavailable', () => {
    vi.stubGlobal('localStorage', { getItem: () => { throw new Error('Storage denied'); } });
    expect(loadProfile()).toEqual(defaultProfile());
  });
});
