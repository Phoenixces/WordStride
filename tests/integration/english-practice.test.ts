import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { defaultProfile, KEYS, newSession, reducer } from '@/features/practice/model/engine';
import type { State } from '@/features/practice/model/types';
import { parseProfile } from '@/features/practice/model/profile-storage';
import { selectWordBatch } from '@/features/practice/services/word-source';

const words: string[] = JSON.parse(readFileSync(new URL('../../public/words/en/a.json', import.meta.url), 'utf8'));
describe('real English dataset with repeatable per-key practice', () => {
  it('every letter supplies 25 distinct words repeatedly without exhaustion', () => {
    for (const letter of KEYS) {
      const source: string[] = JSON.parse(readFileSync(new URL('../../public/words/en/' + letter + '.json', import.meta.url), 'utf8'));
      const original = [...source];
      expect(source.length).toBeGreaterThanOrEqual(25);
      for (const value of [0, 0.2, 0.7, 0.999999]) {
        const batch = selectWordBatch(source, { random: () => value });
        expect(batch).toHaveLength(25);
        expect(new Set(batch).size).toBe(25);
        expect(batch.every(word => word.startsWith(letter) && source.includes(word))).toBe(true);
      }
      expect(source).toEqual(original);
    }
  });

  it('can use a full letter list again after a finished session and profile reload', () => {
    const first = selectWordBatch(words);
    const profile = { ...defaultProfile(), selectedKey: 'a' };
    let state: State = { profile, session: newSession(profile, first.map(word => ({ word, part: '', meaning: '', example: '' }))) };
    for (const word of first) for (const key of word + ' ') state = reducer(state, { type: 'TYPE', key, day: '2026-11-22' });
    const reloaded = parseProfile(JSON.stringify(state.profile));
    expect(reloaded.selectedKey).toBe('a');
    expect(reloaded.keys.a.history[0].correct).toBe(25);
    expect(state.session.status).toBe('finished');
    const next = selectWordBatch(words);
    expect(next).toHaveLength(25);
    expect(new Set(next).size).toBe(25);
    expect(next.every(word => words.includes(word))).toBe(true);
    expect(reloaded).not.toHaveProperty('english');
  });

  it('never filters words based on unchecked keys', () => {
    const profile = defaultProfile();
    const source = words.filter(word => word.includes('z'));
    const batch = selectWordBatch(source);
    expect(batch.length).toBeGreaterThan(0);
    expect(batch.every(word => word.includes('z'))).toBe(true);
    expect(profile.keys.z.mastered).toBe(false);
  });
});
