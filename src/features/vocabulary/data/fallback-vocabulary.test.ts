import { describe, expect, it } from 'vitest';
import { vocabulary } from './fallback-vocabulary';

describe('offline fallback definitions', () => {
  it('has unique lowercase words with a definition, part of speech and example', () => {
    expect(new Set(vocabulary.map(item => item.word)).size).toBe(vocabulary.length);
    for (const item of vocabulary) {
      expect(item.word).toMatch(/^[a-z]+$/);
      expect(item.part.length).toBeGreaterThan(0);
      expect(item.meaning.length).toBeGreaterThan(10);
      expect(item.example.toLowerCase()).toContain(item.word);
    }
  });

});
