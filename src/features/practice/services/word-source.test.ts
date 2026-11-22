import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { BATCH_SIZE, selectWordBatch } from './word-source';

beforeEach(() => vi.resetModules());
afterEach(() => { vi.unstubAllGlobals(); vi.unstubAllEnvs(); });

describe('random batch selection', () => {
  const words = ['ace', 'act', 'add', 'age', 'aid', 'air', 'art', 'ate'];

  it('samples 25 distinct words from the full source by default', () => {
    const source = Array.from({ length: 40 }, (_, index) => `a${String.fromCharCode(97 + Math.floor(index / 26))}${String.fromCharCode(97 + index % 26)}`);
    expect(BATCH_SIZE).toBe(25);
    const batch = selectWordBatch(source, { random: () => 0.999 });
    expect(batch).toHaveLength(25);
    expect(new Set(batch).size).toBe(25);
    expect(batch.every(word => source.includes(word))).toBe(true);
    expect(batch[0]).toBe(source.at(-1));
    expect(batch).not.toEqual(source.slice(0, 25));
  });

  it('can repeat words across batches without retaining a consumed-word cursor', () => {
    const first = selectWordBatch(words, { limit: 3, random: () => 0 });
    const next = selectWordBatch(words, { limit: 3, random: () => 0 });
    expect(first).toEqual(['ace', 'act', 'add']);
    expect(next).toEqual(first);
  });

  it('produces different selections from different random draws', () => {
    const first = selectWordBatch(words, { limit: 3, random: () => 0 });
    const next = selectWordBatch(words, { limit: 3, random: () => 0.999 });
    expect(next).toEqual(['ate', 'ace', 'act']);
    expect(next).not.toEqual(first);
  });

  it('keeps each word eligible irrespective of the letters it contains', () => {
    expect(selectWordBatch(['abacus', 'azure'], { limit: 1, random: () => 0.999 })).toEqual(['azure']);
  });

  it('deduplicates a source array before sampling', () => {
    expect(selectWordBatch(['ace', 'ace', 'act'], { random: () => 0 })).toEqual(['ace', 'act']);
  });

  it('returns empty and short batches without padding or mutating inputs', () => {
    const source = [...words];
    const random = vi.fn(() => 0.5);
    expect(selectWordBatch([], { random })).toEqual([]);
    expect(selectWordBatch(source, { limit: 0, random })).toEqual([]);
    expect(random).not.toHaveBeenCalled();
    const result = selectWordBatch(source, { random });
    expect(result).toHaveLength(words.length);
    expect(new Set(result)).toEqual(new Set(words));
    expect(source).toEqual(words);
    expect(result).not.toBe(source);
  });

  it.each([-1, 1.5, Number.NaN, Number.POSITIVE_INFINITY])('rejects invalid batch limits: %s', limit => {
    expect(() => selectWordBatch(words, { limit })).toThrow('non-negative integer');
  });

  it.each([-0.1, 1, Number.NaN, Number.POSITIVE_INFINITY])('rejects invalid random values: %s', value => {
    expect(() => selectWordBatch(words, { random: () => value })).toThrow('Random values');
  });
});

describe('alphabet files', () => {
  it('loads from the deployment base, caches valid words, and protects the cached array', async () => {
    vi.stubEnv('BASE_URL', '/wordstride/');
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify(['ace', 'act', 'add'])));
    vi.stubGlobal('fetch', fetchMock);
    const { fetchLetterWords } = await import('./word-source');
    const first = await fetchLetterWords('a');
    expect(fetchMock).toHaveBeenCalledWith('/wordstride/words/en/a.json', { signal: undefined });
    first.push('another');
    expect(await fetchLetterWords('a')).toEqual(['ace', 'act', 'add']);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it.each(['A', '', 'ab', '../a', '1'])('rejects invalid prefixes before fetching: %j', async letter => {
    const fetchMock = vi.fn(); vi.stubGlobal('fetch', fetchMock);
    const { fetchLetterWords } = await import('./word-source');
    await expect(fetchLetterWords(letter)).rejects.toThrow('one lowercase English letter');
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('allows retry after HTTP and network failures', async () => {
    const fetchMock = vi.fn().mockResolvedValueOnce(new Response('', { status: 503 }))
      .mockRejectedValueOnce(new TypeError('Offline'))
      .mockResolvedValueOnce(new Response('["ace","act"]'));
    vi.stubGlobal('fetch', fetchMock);
    const { fetchLetterWords } = await import('./word-source');
    await expect(fetchLetterWords('a')).rejects.toThrow('503');
    await expect(fetchLetterWords('a')).rejects.toThrow('Offline');
    await expect(fetchLetterWords('a')).resolves.toEqual(['ace', 'act']);
    expect(fetchMock).toHaveBeenCalledTimes(3);
  });

  it.each([{}, ['ace', 2], ['Ace'], ['a-b'], ['ace', 'bee'], ['act', 'ace'], ['ace', 'ace']])('rejects malformed or unsorted data without caching it: %j', async payload => {
    const fetchMock = vi.fn().mockResolvedValueOnce(new Response(JSON.stringify(payload)))
      .mockResolvedValueOnce(new Response('["ace"]'));
    vi.stubGlobal('fetch', fetchMock);
    const { fetchLetterWords } = await import('./word-source');
    await expect(fetchLetterWords('a')).rejects.toThrow();
    await expect(fetchLetterWords('a')).resolves.toEqual(['ace']);
  });

  it('rejects invalid JSON without caching it', async () => {
    const fetchMock = vi.fn().mockResolvedValueOnce(new Response('{broken')).mockResolvedValueOnce(new Response('[]'));
    vi.stubGlobal('fetch', fetchMock);
    const { fetchLetterWords } = await import('./word-source');
    await expect(fetchLetterWords('a')).rejects.toThrow();
    await expect(fetchLetterWords('a')).resolves.toEqual([]);
  });

  it('does not fetch for an already aborted caller, even if a cached file exists', async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response('["ace"]'));
    vi.stubGlobal('fetch', fetchMock);
    const { fetchLetterWords } = await import('./word-source');
    await fetchLetterWords('a');
    const controller = new AbortController(); controller.abort();
    await expect(fetchLetterWords('a', controller.signal)).rejects.toMatchObject({ name: 'AbortError' });
    await expect(fetchLetterWords('b', controller.signal)).rejects.toMatchObject({ name: 'AbortError' });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('propagates in-flight cancellation and permits a subsequent fresh request', async () => {
    const controller = new AbortController();
    const fetchMock = vi.fn().mockImplementationOnce((_url, options) => new Promise((_resolve, reject) => {
      options.signal.addEventListener('abort', () => reject(options.signal.reason));
    })).mockResolvedValueOnce(new Response('["ace"]'));
    vi.stubGlobal('fetch', fetchMock);
    const { fetchLetterWords } = await import('./word-source');
    const pending = fetchLetterWords('a', controller.signal);
    controller.abort();
    await expect(pending).rejects.toMatchObject({ name: 'AbortError' });
    await expect(fetchLetterWords('a')).resolves.toEqual(['ace']);
  });

  it('does not cache a response when cancellation occurs while parsing', async () => {
    const controller = new AbortController();
    const fetchMock = vi.fn().mockResolvedValueOnce({ ok: true, json: async () => { controller.abort(); return ['ace']; } })
      .mockResolvedValueOnce(new Response('["act"]'));
    vi.stubGlobal('fetch', fetchMock);
    const { fetchLetterWords } = await import('./word-source');
    await expect(fetchLetterWords('a', controller.signal)).rejects.toMatchObject({ name: 'AbortError' });
    await expect(fetchLetterWords('a')).resolves.toEqual(['act']);
  });

  it('resamples the cached full source for every batch', async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response('["ace","act","add","age"]'));
    vi.stubGlobal('fetch', fetchMock);
    const { loadWordBatch } = await import('./word-source');
    await expect(loadWordBatch('a', { limit: 2, random: () => 0 })).resolves.toEqual(['ace', 'act']);
    await expect(loadWordBatch('a', { limit: 2, random: () => 0.999 })).resolves.toEqual(['age', 'ace']);
    await expect(loadWordBatch('a', { limit: 2, random: () => 0 })).resolves.toEqual(['ace', 'act']);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});
