export const BATCH_SIZE = 25;

export interface WordBatchOptions {
  limit?: number;
  random?: () => number;
}

// Store only validated, successful responses. An unavailable file never poisons a retry.
const letterCache = new Map<string, readonly string[]>();

function throwIfAborted(signal?: AbortSignal): void {
  if (signal?.aborted) throw signal.reason ?? new DOMException('The request was aborted.', 'AbortError');
}

function validateLetter(letter: string): void {
  if (!/^[a-z]$/.test(letter)) throw new Error('Choose one lowercase English letter from a to z.');
}

function validateWords(value: unknown, letter: string): string[] {
  if (!Array.isArray(value)) throw new Error(`The ${letter.toUpperCase()} word list is not an array.`);
  for (let i = 0; i < value.length; i++) {
    const word: unknown = value[i];
    if (typeof word !== 'string' || !/^[a-z]+$/.test(word) || !word.startsWith(letter)) {
      throw new Error(`The ${letter.toUpperCase()} word list contains an invalid word.`);
    }
    if (i > 0 && value[i - 1] >= word) {
      throw new Error(`The ${letter.toUpperCase()} word list must be sorted and contain no duplicates.`);
    }
  }
  return value as string[];
}

/** Load one version-controlled alphabet file; callers receive their own array copy. */
export async function fetchLetterWords(letter: string, signal?: AbortSignal): Promise<string[]> {
  validateLetter(letter);
  throwIfAborted(signal);
  const cached = letterCache.get(letter);
  if (cached) return [...cached];

  const response = await fetch(`${import.meta.env.BASE_URL}words/en/${letter}.json`, { signal });
  if (!response.ok) throw new Error(`Unable to load ${letter.toUpperCase()} words (HTTP ${response.status}).`);
  const words = validateWords(await response.json(), letter);
  // Some fetch implementations can finish parsing after cancellation. Do not cache that result.
  throwIfAborted(signal);
  letterCache.set(letter, [...words]);
  return words;
}

/** Sample without replacement inside a batch; later batches may repeat words.
 * Partial Fisher–Yates gives every source word an equal chance without changing
 * the cached alphabetical source. Inject randomness for deterministic checks. */
export function selectWordBatch(words: readonly string[], options: WordBatchOptions = {}): string[] {
  const limit = options.limit ?? BATCH_SIZE;
  if (!Number.isInteger(limit) || limit < 0) throw new Error('The batch limit must be a non-negative integer.');
  if (limit === 0) return [];
  const pool = [...new Set(words)];
  const count = Math.min(limit, pool.length);
  const random = options.random ?? Math.random;
  for (let index = 0; index < count; index++) {
    const value = random();
    if (!Number.isFinite(value) || value < 0 || value >= 1) throw new Error('Random values must be between zero (inclusive) and one (exclusive).');
    const picked = index + Math.floor(value * (pool.length - index));
    [pool[index], pool[picked]] = [pool[picked], pool[index]];
  }
  return pool.slice(0, count);
}

export async function loadWordBatch(letter: string, options: WordBatchOptions = {}, signal?: AbortSignal): Promise<string[]> {
  return selectWordBatch(await fetchLetterWords(letter, signal), options);
}
