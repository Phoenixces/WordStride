import type { Word } from '@/features/vocabulary/model/types';
import type { Action, KeyTargets, Profile, Result, Session, State } from './types';

export const KEYS = 'abcdefghijklmnopqrstuvwxyz';
export const defaultTargets = (): KeyTargets => ({ wpm: 45, accuracy: 97, dailyGoal: 20 });
export function validTargets(targets: KeyTargets): boolean {
  return Boolean(targets) && [[targets.wpm, 1, 300], [targets.accuracy, 1, 100], [targets.dailyGoal, 1, 240]]
    .every(([value, min, max]) => Number.isInteger(value) && value >= min && value <= max);
}
export const defaultProfile = (): Profile => ({
  version: 2, selectedKey: null, keys: Object.fromEntries([...KEYS].map(key => [key, {
    targets: defaultTargets(), mastered: false, bestWpm: 0, daily: {}, history: [],
  }])), bestWpm: 0, score: 0, daily: {}, history: [],
  settings: { duration: 120, sound: true, keyboard: true },
});
export function localDay(date = new Date()) {
  return [date.getFullYear(), String(date.getMonth() + 1).padStart(2, '0'), String(date.getDate()).padStart(2, '0')].join('-');
}
export function newSession(profile: Profile, words: Word[] = []): Session {
  const focus = profile.selectedKey || '';
  return { words, index: 0, typed: '', status: 'idle', elapsed: 0, duration: profile.settings.duration * 1000,
    attempts: 0, hits: 0, correctChars: 0, focus,
    targets: { ...(focus ? profile.keys[focus].targets : defaultTargets()) },
    lastWord: null, completed: [], feedback: 'ready', masteredKey: null, qualified: false };
}
export function accuracy(hits: number, attempts: number) { return attempts ? hits / attempts * 100 : 100; }
export function speed(session: Session) {
  return session.elapsed >= 1000 ? session.correctChars / 5 / (session.elapsed / 60000) : 0;
}
function finish(state: State, day: string): State {
  const { session: s, profile: p } = state;
  if (s.status === 'finished') return state;
  const wpm = speed(s);
  const correct = s.completed.filter(item => item.correct).length;
  const sessionAccuracy = accuracy(s.hits, s.attempts);
  const qualified = Boolean(s.focus && correct > 0 && s.elapsed >= 1000 && wpm >= s.targets.wpm && sessionAccuracy >= s.targets.accuracy);
  const key = p.keys[s.focus];
  const result: Result = { date: day, wpm, accuracy: sessionAccuracy, correct, skipped: s.completed.length - correct, ...(s.focus ? { key: s.focus } : {}) };
  return {
    profile: { ...p, bestWpm: Math.max(p.bestWpm, wpm), history: [result, ...p.history].slice(0, 20),
      keys: key ? { ...p.keys, [s.focus]: { ...key, mastered: key.mastered || qualified, bestWpm: Math.max(key.bestWpm, wpm), history: [result, ...key.history].slice(0, 20) } } : p.keys },
    session: { ...s, status: 'finished', qualified, masteredKey: qualified && !key?.mastered ? s.focus : null },
  };
}
export function reducer(state: State, action: Action): State {
  if (action.type === 'RESTORE_PROFILE') return { profile: action.profile, session: newSession(action.profile) };
  const { session: s, profile: p } = state;
  if (action.type === 'KEY_SETTINGS') {
    if (!/^[a-z]$/.test(action.key) || !validTargets(action.targets)) return state;
    return { ...state, profile: { ...p, keys: { ...p.keys, [action.key]: { ...p.keys[action.key], targets: { ...action.targets } } } } };
  }
  if (action.type === 'SELECT_KEY') return /^[a-z]$/.test(action.key) ? { ...state, profile: { ...p, selectedKey: action.key } } : state;
  if (action.type === 'SETTINGS') return { ...state, profile: { ...p, settings: action.settings } };
  if (action.type === 'RESTART') return { ...state, session: newSession(p, action.words) };
  if (action.type === 'PAUSE') return s.status === 'running' ? { ...state, session: { ...s, status: 'paused' } } : state;
  if (action.type === 'RESUME') return s.status === 'paused' ? { ...state, session: { ...s, status: 'running' } } : state;
  if (action.type === 'TICK') {
    if (s.status !== 'running' || action.delta <= 0 || !Number.isFinite(action.delta)) return state;
    const delta = Math.min(action.delta, s.duration - s.elapsed);
    const key = p.keys[s.focus];
    const next = { ...state, profile: { ...p, daily: { ...p.daily, [action.day]: (p.daily[action.day] || 0) + delta },
      keys: key ? { ...p.keys, [s.focus]: { ...key, daily: { ...key.daily, [action.day]: (key.daily[action.day] || 0) + delta } } } : p.keys },
      session: { ...s, elapsed: s.elapsed + delta } };
    return next.session.elapsed >= s.duration ? finish(next, action.day) : next;
  }
  if (!s.focus || s.status === 'paused' || s.status === 'finished') return state;
  const { key } = action;
  if (key === 'Backspace') return { ...state, session: { ...s, typed: s.typed.slice(0, -1) } };
  const target = s.words[s.index];
  if (!target) return state;
  if (key === ' ') {
    const correct = s.typed === target.word;
    const missing = target.word.slice(s.typed.length);
    const next: State = {
      profile: { ...p, score: p.score + (correct ? target.word.length * 10 : 0) },
      session: { ...s, status: 'running', typed: '', index: s.index + 1,
        attempts: s.attempts + missing.length,
        correctChars: s.correctChars + (correct ? target.word.length + 1 : 0),
        completed: [...s.completed, { word: target, typed: s.typed, correct }],
        lastWord: correct ? target : s.lastWord, feedback: correct ? 'correct' : 'skipped' },
    };
    return next.session.index >= s.words.length ? finish(next, action.day) : next;
  }
  if (!/^[a-zA-Z]$/.test(key) || s.typed.length >= target.word.length + 8) return state;
  const hit = key === target.word[s.typed.length];
  return { ...state, session: { ...s, status: 'running', typed: s.typed + key,
    attempts: s.attempts + 1, hits: s.hits + Number(hit) } };
}
