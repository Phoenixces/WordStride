import { describe, expect, it } from 'vitest';
import type { Word } from '@/features/vocabulary/model/types';
import { accuracy, defaultProfile, localDay, newSession, reducer, speed } from './engine';
import type { Profile, State } from './types';

const DAY = '2026-11-22';
const word = (name: string): Word => ({ word: name, part: 'noun', meaning: 'A test definition.', example: 'Practise ' + name + '.' });
function start(names = ['train', 'retain', 'alert'], profile: Profile = { ...defaultProfile(), selectedKey: 't' }): State {
  return { profile, session: newSession(profile, names.map(word)) };
}
function type(state: State, text: string): State {
  return [...text].reduce((current, key) => reducer(current, { type: 'TYPE', key, day: DAY }), state);
}
function tick(state: State, delta: number, day = DAY): State {
  return reducer(state, { type: 'TICK', delta, day });
}
describe('typing and vocabulary feedback', () => {
  it('reveals a correct word only after Space and moves to the next word', () => {
    const typed = type(start(), 'train');
    expect(typed.session.lastWord).toBeNull();
    expect(typed.session.index).toBe(0);
    const submitted = type(typed, ' ');
    expect(submitted.session).toMatchObject({ index: 1, typed: '', lastWord: word('train'), feedback: 'correct', correctChars: 6 });
    expect(submitted.session.completed).toEqual([{ word: word('train'), typed: 'train', correct: true }]);
    expect(submitted.profile.score).toBe(50);
  });

  it.each(['retxin', 'ret', 'retainx', ''])('advances for an incorrect or incomplete word (%j), retaining the last meaning', input => {
    const state = type(start(), 'train ' + input + ' ');
    expect(state.session.index).toBe(2);
    expect(state.session.lastWord).toEqual(word('train'));
    expect(state.session.feedback).toBe('skipped');
    expect(state.session.completed[1]).toEqual({ word: word('retain'), typed: input, correct: false });
    expect(state.profile.score).toBe(50);
    expect(state.session.correctChars).toBe(6);
  });

  it('does not reveal any meaning when the first word is skipped', () => {
    const state = type(start(), ' ');
    expect(state.session.lastWord).toBeNull();
    expect(state.session.index).toBe(1);
    expect(state.session.attempts).toBe(5);
    expect(accuracy(state.session.hits, state.session.attempts)).toBe(0);
  });

  it('allows corrections while keeping their original accuracy penalty', () => {
    let state = type(start(), 'x');
    state = reducer(state, { type: 'TYPE', key: 'Backspace', day: DAY });
    state = type(state, 'train ');
    expect(state.session.lastWord).toEqual(word('train'));
    expect(state.session).toMatchObject({ attempts: 6, hits: 5 });
    expect(accuracy(state.session.hits, state.session.attempts)).toBeCloseTo(83.333);
  });

  it('counts omitted letters as misses when an incomplete word is submitted', () => {
    const state = type(start(['talent', 'train']), 'ta ');
    expect(state.session).toMatchObject({ attempts: 6, hits: 2 });
  });

  it('cannot backspace into an already submitted word', () => {
    const submitted = type(start(), 'train ');
    const state = reducer(submitted, { type: 'TYPE', key: 'Backspace', day: DAY });
    expect(state.session.index).toBe(1);
    expect(state.session.completed).toEqual(submitted.session.completed);
    expect(state.session.typed).toBe('');
  });

  it('ignores unsupported input without starting the timer or affecting accuracy', () => {
    const initial = start();
    expect(reducer(initial, { type: 'TYPE', key: 'ArrowLeft', day: DAY })).toBe(initial);
    expect(reducer(initial, { type: 'TYPE', key: '1', day: DAY })).toBe(initial);
  });

  it('measures WPM from correct submitted characters, including a word separator', () => {
    let state = type(start(), 'train ');
    state = tick(state, 60000);
    state = type(state, 'ret');
    expect(speed(state.session)).toBeCloseTo(1.2);
    expect(speed(newSession(defaultProfile()))).toBe(0);
  });
});

describe('session time and persistence accounting', () => {
  it('does not count idle or paused time, and resumes from the same position', () => {
    const initial = start();
    expect(tick(initial, 60000)).toBe(initial);
    let state = tick(type(initial, 'tr'), 1000);
    state = reducer(state, { type: 'PAUSE' });
    expect(tick(state, 60000)).toBe(state);
    expect(type(state, 'a')).toBe(state);
    state = reducer(state, { type: 'RESUME' });
    state = tick(type(state, 'ain '), 1000);
    expect(state.session.elapsed).toBe(2000);
    expect(state.profile.daily[DAY]).toBe(2000);
    expect(state.session.lastWord).toEqual(word('train'));
  });

  it('caps an overlong tick at the session deadline and finalizes exactly once', () => {
    const finished = tick(type(start(), 'train '), 180000);
    expect(finished.session.status).toBe('finished');
    expect(finished.session.elapsed).toBe(120000);
    expect(finished.profile.daily[DAY]).toBe(120000);
    expect(finished.profile.history).toHaveLength(1);
    expect(finished.profile.history[0]).toMatchObject({ correct: 1, skipped: 0, wpm: 0.6 });
    expect(tick(finished, 1000)).toBe(finished);
    expect(type(finished, 'retain ')).toBe(finished);
    expect(reducer(finished, { type: 'RESUME' })).toBe(finished);
  });

  it('finalizes exactly once if the generated word list is exhausted first', () => {
    const finished = type(tick(type(start(['train']), 'train'), 10000), ' ');
    expect(finished.session.status).toBe('finished');
    expect(finished.profile.history).toHaveLength(1);
    expect(tick(finished, 1000)).toBe(finished);
  });

  it.each([-1, 0, Number.NaN, Number.POSITIVE_INFINITY])('ignores an invalid timer delta: %s', delta => {
    const running = type(start(), 't');
    expect(tick(running, delta)).toBe(running);
  });

  it('records active practice against the supplied local day across midnight', () => {
    const state = tick(tick(type(start(), 't'), 1000), 1500, '2026-11-23');
    expect(state.profile.daily).toEqual({ '2026-11-22': 1000, '2026-11-23': 1500 });
  });

  it('restarts with clean session counters while retaining earned score and active practice time', () => {
    const state = tick(type(start(), 'train '), 2000);
    const restarted = reducer(state, { type: 'RESTART', words: [word('alert'), word('retain')] });
    expect(restarted.profile).toEqual(state.profile);
    expect(restarted.profile.history).toHaveLength(0);
    expect(restarted.session).toMatchObject({ status: 'idle', index: 0, typed: '', elapsed: 0, attempts: 0, lastWord: null });
  });

  it('applies duration changes to the next session, not the session underway', () => {
    let state = type(start(), 't');
    state = reducer(state, { type: 'SETTINGS', settings: { ...state.profile.settings, duration: 30 } });
    expect(state.session.duration).toBe(120000);
    const restarted = reducer(state, { type: 'RESTART', words: [word('train')] });
    expect(restarted.session.duration).toBe(30000);
  });
});

describe('local practice date', () => {
  it('uses the local calendar date with zero padding', () => {
    expect(localDay(new Date(2026, 0, 2, 0, 15))).toBe('2026-01-02');
    expect(localDay(new Date(2026, 10, 22, 23, 59))).toBe('2026-11-22');
  });
});


describe('per-key targets and achievements', () => {
  it('starts with 26 unchecked keys, no selection, and independent default targets', () => {
    const profile = defaultProfile();
    expect(profile.selectedKey).toBeNull();
    expect(Object.keys(profile.keys)).toHaveLength(26);
    for (const key of Object.values(profile.keys)) expect(key).toMatchObject({ mastered: false, targets: { wpm: 45, accuracy: 97, dailyGoal: 20 } });
    expect(profile.keys.a.targets).not.toBe(profile.keys.b.targets);
    expect(type({ profile, session: newSession(profile, [word('train')]) }, 'train ')).toEqual({ profile, session: newSession(profile, [word('train')]) });
  });

  // Construct a session close to its deadline to isolate exact KPI boundaries.
  function nearFinish(wpm: number, acc: number, profile: Profile = { ...defaultProfile(), selectedKey: 't' }): State {
    const session = newSession(profile, [word('train')]);
    return { profile, session: { ...session, status: 'running', elapsed: session.duration - 1000,
      attempts: 100, hits: acc, correctChars: wpm * 10,
      completed: [{ word: word('train'), typed: 'train', correct: true }] } };
  }
  it.each([[45, 97, true], [44.99, 100, false], [60, 96.99, false], [60, 98, true]])('awards only at both full-session targets: %s WPM and %s%%', (wpm, acc, expected) => {
    const initial = nearFinish(wpm, acc);
    expect(initial.profile.keys.t.mastered).toBe(false);
    const finished = tick(initial, 1000);
    expect(finished.session.qualified).toBe(expected);
    expect(finished.profile.keys.t.mastered).toBe(expected);
    expect(finished.profile.keys.a.mastered).toBe(false);
    expect(finished.session.masteredKey).toBe(expected ? 't' : null);
    expect(finished.profile.keys.t.history[0]).toMatchObject({ key: 't', wpm, accuracy: acc });
    expect(tick(finished, 1000)).toBe(finished);
  });

  it('does not award a live peak, a restart, an instantaneous finish or a session with no correct words', () => {
    let state = type(start(['train', 'train']), 'train ');
    state = tick(state, 1000);
    expect(speed(state.session)).toBeGreaterThan(45);
    expect(state.profile.keys.t.mastered).toBe(false);
    expect(reducer(state, { type: 'RESTART', words: [word('train')] }).profile.keys.t.mastered).toBe(false);
    expect(type(start(['train']), 'train ').profile.keys.t.mastered).toBe(false);
    const empty = nearFinish(60, 100);
    empty.session.completed = [];
    expect(tick(empty, 1000).profile.keys.t.mastered).toBe(false);
  });

  it('uses targets captured at session start and applies changes on the next session', () => {
    const state = nearFinish(50, 98);
    const targets = { wpm: 80, accuracy: 99, dailyGoal: 5 };
    const changed = reducer(state, { type: 'KEY_SETTINGS', key: 't', targets });
    expect(changed.session.targets).toEqual({ wpm: 45, accuracy: 97, dailyGoal: 20 });
    expect(tick(changed, 1000).profile.keys.t.mastered).toBe(true);
    const next = reducer(changed, { type: 'RESTART', words: [word('train')] });
    expect(next.session.targets).toEqual(targets);
    expect(next.profile.keys.a.targets).toEqual({ wpm: 45, accuracy: 97, dailyGoal: 20 });
    targets.wpm = 1;
    expect(next.session.targets.wpm).toBe(80);
    expect(next.profile.keys.t.targets.wpm).toBe(80);
  });

  it('uses customized targets independently and keeps previously earned checks', () => {
    let state = nearFinish(30, 90);
    const targets = { wpm: 30, accuracy: 90, dailyGoal: 240 };
    state = reducer(state, { type: 'KEY_SETTINGS', key: 't', targets });
    state = nearFinish(30, 90, state.profile);
    const finished = tick(state, 1000);
    expect(finished.profile.keys.t.mastered).toBe(true);
    expect(finished.profile.keys.t.daily[DAY]).toBe(1000);
    const weaker = tick(nearFinish(1, 10, finished.profile), 1000);
    expect(weaker.profile.keys.t.mastered).toBe(true);
    expect(weaker.profile.keys.t.bestWpm).toBe(30);
    expect(weaker.session.masteredKey).toBeNull();
  });

  it('attributes time and results to the session key even if another key is selected', () => {
    const running = tick(type(start(), 'train '), 1000);
    const selected = reducer(running, { type: 'SELECT_KEY', key: 'r' });
    const continued = tick(selected, 1000);
    expect(continued.profile.selectedKey).toBe('r');
    expect(continued.profile.keys.t.daily[DAY]).toBe(2000);
    expect(continued.profile.keys.r.daily).toEqual({});
    const finished = tick(continued, 120000);
    expect(finished.profile.keys.t.history).toHaveLength(1);
    expect(finished.profile.keys.r.history).toHaveLength(0);
    const next = reducer(finished, { type: 'RESTART', words: [word('retain')] });
    expect(next.session.focus).toBe('r');
    const nextDay = tick(type(next, 'r'), 1000, '2026-11-23');
    expect(nextDay.profile.keys.r.daily).toEqual({ '2026-11-23': 1000 });
    expect(nextDay.profile.keys.t.daily[DAY]).toBe(120000);
  });

  it('ignores invalid selections and target values, and input before loading', () => {
    const state = start();
    expect(reducer(state, { type: 'SELECT_KEY', key: '../bad' })).toBe(state);
    for (const targets of [{ wpm: 0, accuracy: 97, dailyGoal: 20 }, { wpm: 301, accuracy: 97, dailyGoal: 20 }, { wpm: 45, accuracy: 101, dailyGoal: 20 }, { wpm: 45, accuracy: 97, dailyGoal: NaN }, { wpm: 45.5, accuracy: 97, dailyGoal: 20 }]) {
      expect(reducer(state, { type: 'KEY_SETTINGS', key: 't', targets })).toBe(state);
    }
    const empty = { profile: state.profile, session: newSession(state.profile) };
    expect(type(empty, 'train ')).toBe(empty);
  });
});
