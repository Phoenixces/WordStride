import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const KEY = 'wordstride.dictionary.v1';
let stored: Map<string, string>;
let request: ReturnType<typeof vi.fn>;
let lookup: typeof import('./dictionary').lookupDefinition;
const entry = (word = 'abacus', example = 'She counted with an abacus.') => ({
  word, meanings: [{ partOfSpeech: 'noun', definitions: [{ definition: 'A frame used for counting.', example }] }],
  sourceUrls: [`https://en.wiktionary.org/wiki/${word}`], license: { name: 'CC BY-SA 3.0', url: 'https://creativecommons.org/licenses/by-sa/3.0/' },
});
const response = (data: unknown, status = 200) => ({ status, ok: status >= 200 && status < 300, json: async () => data });

beforeEach(async () => {
  vi.resetModules();
  stored = new Map();
  request = vi.fn();
  vi.stubGlobal('fetch', request);
  vi.stubGlobal('localStorage', { getItem: (key: string) => stored.get(key) ?? null, setItem: (key: string, value: string) => stored.set(key, value) });
  lookup = (await import('./dictionary')).lookupDefinition;
});
afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); });

const found = { status: 'found', entry: { word: 'abacus', part: 'noun', meaning: 'A frame used for counting.', example: 'She counted with an abacus.' } };

describe('dictionary enrichment', () => {
  it('uses a curated definition without requesting the network', async () => {
    expect(await lookup(' CURIOUS ')).toMatchObject({ status: 'found', entry: { word: 'curious', part: 'adjective', example: 'She was curious about how the machine worked.' } });
    expect(request).not.toHaveBeenCalled();
  });

  it('fetches a normalized word and retains valid source and licence attribution', async () => {
    request.mockResolvedValue(response([entry()]));
    expect(await lookup(' ABACUS ')).toEqual({ ...found, sourceUrl: 'https://en.wiktionary.org/wiki/abacus', license: { name: 'CC BY-SA 3.0', url: 'https://creativecommons.org/licenses/by-sa/3.0/' } });
    expect(request).toHaveBeenCalledWith('https://api.dictionaryapi.dev/api/v2/entries/en/abacus', expect.objectContaining({ signal: expect.any(AbortSignal) }));
  });

  it('selects an example and its own matching definition, even from a later sense', async () => {
    const data = entry();
    data.meanings[0].definitions.unshift({ definition: 'The top of a column.', example: '' });
    request.mockResolvedValue(response([data]));
    expect(await lookup('abacus')).toMatchObject(found);
  });

  it('returns a definition with an empty example when no example was supplied', async () => {
    request.mockResolvedValue(response([entry('abacus', '')]));
    expect(await lookup('abacus')).toMatchObject({ status: 'found', entry: { meaning: 'A frame used for counting.', example: '' } });
  });

  it('does not expose unsafe attribution links', async () => {
    request.mockResolvedValue(response([{ ...entry(), sourceUrls: ['javascript:alert(1)', 'http://example.com/', 'https://user:password@example.com/'], license: { name: 'Unknown', url: 'javascript:alert(1)' } }]));
    expect(await lookup('abacus')).toEqual(found);
  });

  it.each(['', '../secret', 'two words', 'résumé', 'a'.repeat(61)])('rejects invalid word inputs without a fetch: %s', async word => {
    expect(await lookup(word)).toEqual({ status: 'missing' });
    expect(request).not.toHaveBeenCalled();
  });

  it.each([null, {}, [], [{ word: 'other', meanings: entry().meanings }], [{ word: 'abacus', meanings: [{ definitions: [{ definition: {} }] }] }]])('handles malformed, empty, or mismatched entries without caching them', async data => {
    request.mockResolvedValue(response(data));
    expect(await lookup('abacus')).toEqual({ status: 'unavailable' });
    await lookup('abacus');
    expect(request).toHaveBeenCalledTimes(2);
  });

  it('handles JSON parsing failures and network errors without caching failures', async () => {
    request.mockResolvedValueOnce({ status: 200, ok: true, json: () => { throw new Error('Bad JSON'); } }).mockRejectedValueOnce(new Error('Offline'));
    expect(await lookup('abacus')).toEqual({ status: 'unavailable' });
    expect(await lookup('abacus')).toEqual({ status: 'unavailable' });
    expect(request).toHaveBeenCalledTimes(2);
  });

  it('caches 404 misses but does not cache rate-limit or server failures', async () => {
    request.mockResolvedValueOnce(response({}, 429)).mockResolvedValueOnce(response({}, 500)).mockResolvedValueOnce(response({}, 404));
    expect(await lookup('abacus')).toEqual({ status: 'unavailable' });
    expect(await lookup('abacus')).toEqual({ status: 'unavailable' });
    expect(await lookup('abacus')).toEqual({ status: 'missing' });
    expect(await lookup('abacus')).toEqual({ status: 'missing' });
    expect(request).toHaveBeenCalledTimes(3);
  });

  it('reuses successful memory and browser-storage caches across module reloads', async () => {
    request.mockResolvedValue(response([entry()]));
    const result = await lookup('abacus');
    expect(await lookup('abacus')).toEqual(result);
    vi.resetModules();
    const reloaded = (await import('./dictionary')).lookupDefinition;
    expect(await reloaded('abacus')).toEqual(result);
    expect(request).toHaveBeenCalledTimes(1);
  });

  it('expires misses after a day and successful definitions after 30 days', async () => {
    vi.useFakeTimers();
    request.mockResolvedValueOnce(response({}, 404)).mockResolvedValue(response([entry()]));
    await lookup('abacus');
    vi.setSystemTime(Date.now() + 24 * 60 * 60 * 1000 + 1);
    expect(await lookup('abacus')).toMatchObject(found);
    vi.setSystemTime(Date.now() + 29 * 24 * 60 * 60 * 1000);
    await lookup('abacus');
    expect(request).toHaveBeenCalledTimes(2);
    vi.setSystemTime(Date.now() + 2 * 24 * 60 * 60 * 1000);
    await lookup('abacus');
    expect(request).toHaveBeenCalledTimes(3);
  });

  it('keeps working when browser storage throws or is corrupt', async () => {
    vi.stubGlobal('localStorage', { getItem: () => { throw new Error('Denied'); }, setItem: () => { throw new Error('Quota'); } });
    request.mockResolvedValue(response([entry()]));
    expect(await lookup('abacus')).toMatchObject(found);
    expect(await lookup('abacus')).toMatchObject(found);
    expect(request).toHaveBeenCalledTimes(1);
    vi.resetModules();
    vi.stubGlobal('localStorage', { getItem: () => '{bad json', setItem: () => undefined });
    expect(await (await import('./dictionary')).lookupDefinition('abacus')).toMatchObject(found);
  });

  it('rejects expired or malformed stored entries and strips unsafe cached links', async () => {
    stored.set(KEY, JSON.stringify([
      { word: 'bad', expires: Date.now() + 1000, result: { status: 'found', entry: { word: 'other', meaning: 'Wrong word' } } },
      { word: 'abacus', expires: Date.now() + 10000, result: { ...found, sourceUrl: 'javascript:alert(1)' } },
    ]));
    expect(await lookup('abacus')).toEqual(found);
    expect(request).not.toHaveBeenCalled();
  });

  it('bounds persisted and in-memory caches to 200 entries', async () => {
    request.mockImplementation(async (url: string) => response([entry(url.split('/').at(-1)!)]));
    const names = Array.from({ length: 205 }, (_, i) => `zz${String.fromCharCode(97 + Math.floor(i / 26))}${String.fromCharCode(97 + i % 26)}`);
    for (const name of names) await lookup(name);
    const rows = JSON.parse(stored.get(KEY)!);
    expect(rows).toHaveLength(200);
    expect(rows[0].word).toBe(names[5]);
    await lookup(names[0]);
    expect(request).toHaveBeenCalledTimes(206);
  });

  it('returns promptly for a pre-aborted signal without a request', async () => {
    const controller = new AbortController(); controller.abort();
    expect(await lookup('abacus', controller.signal)).toEqual({ status: 'unavailable' });
    expect(request).not.toHaveBeenCalled();
  });

  it('cancels an in-progress fetch and never caches its late success', async () => {
    let resolve!: (value: unknown) => void;
    request.mockImplementationOnce(() => new Promise(done => { resolve = done; }));
    const controller = new AbortController();
    const result = lookup('abacus', controller.signal);
    controller.abort();
    expect(await result).toEqual({ status: 'unavailable' });
    expect(request.mock.calls[0][1].signal.aborted).toBe(true);
    resolve(response([entry()]));
    request.mockResolvedValue(response([entry()]));
    expect(await lookup('abacus')).toMatchObject(found);
    expect(request).toHaveBeenCalledTimes(2);
  });

  it('times out a hanging fetch or hanging JSON body after five seconds', async () => {
    vi.useFakeTimers();
    request.mockImplementationOnce(() => new Promise(() => undefined));
    const first = lookup('abacus');
    await vi.advanceTimersByTimeAsync(5000);
    expect(await first).toEqual({ status: 'unavailable' });
    request.mockResolvedValue({ status: 200, ok: true, json: () => new Promise(() => undefined) });
    const second = lookup('abacus');
    await vi.advanceTimersByTimeAsync(5000);
    expect(await second).toEqual({ status: 'unavailable' });
    expect(request).toHaveBeenCalledTimes(2);
    expect(vi.getTimerCount()).toBe(0);
  });
});
