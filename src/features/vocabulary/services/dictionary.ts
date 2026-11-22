import { wordByName } from '../data/fallback-vocabulary';
import type { DictionaryResult } from '../model/types';

const CACHE_KEY = 'wordstride.dictionary.v1';
const MAX_ENTRIES = 200;
const FOUND_TTL = 30 * 24 * 60 * 60 * 1000;
const MISSING_TTL = 24 * 60 * 60 * 1000;
const TIMEOUT = 5000;
interface Cached { expires: number; result: DictionaryResult }
const cache = new Map<string, Cached>();
let hydrated = false;

const record = (value: unknown): value is Record<string, unknown> => Boolean(value) && typeof value === 'object' && !Array.isArray(value);
const text = (value: unknown, max = 2000) => typeof value === 'string' ? value.trim().slice(0, max) : '';
function httpsUrl(value: unknown): string | undefined {
  if (typeof value !== 'string' || value.length > 2048) return;
  try {
    const url = new URL(value);
    return url.protocol === 'https:' && !url.username && !url.password ? url.href : undefined;
  } catch { return; }
}
function attribution(value: Record<string, unknown>) {
  const sources = Array.isArray(value.sourceUrls) ? value.sourceUrls : [value.sourceUrl];
  const sourceUrl = sources.map(httpsUrl).find(Boolean);
  const licenseUrl = record(value.license) ? httpsUrl(value.license.url) : undefined;
  const licenseName = record(value.license) ? text(value.license.name, 100) : '';
  return { ...(sourceUrl ? { sourceUrl } : {}), ...(licenseUrl && licenseName ? { license: { name: licenseName, url: licenseUrl } } : {}) };
}
function validCachedResult(value: unknown, word: string): DictionaryResult | undefined {
  if (!record(value)) return;
  if (value.status === 'missing') return { status: 'missing' };
  if (value.status !== 'found' || !record(value.entry) || value.entry.word !== word) return;
  const meaning = text(value.entry.meaning);
  if (!meaning) return;
  return { status: 'found', entry: { word, part: text(value.entry.part, 100), meaning, example: text(value.entry.example, 1500) }, ...attribution(value) };
}
function prune() {
  const now = Date.now();
  for (const [word, item] of cache) if (item.expires <= now) cache.delete(word);
  while (cache.size > MAX_ENTRIES) cache.delete(cache.keys().next().value!);
}
function hydrate() {
  if (hydrated) return;
  hydrated = true;
  try {
    const raw = localStorage.getItem(CACHE_KEY);
    if (!raw || raw.length > 1_000_000) return;
    const data: unknown = JSON.parse(raw);
    if (!Array.isArray(data)) return;
    for (const item of data.slice(-MAX_ENTRIES)) {
      if (!record(item) || typeof item.word !== 'string' || !/^[a-z]{1,60}$/.test(item.word)) continue;
      if (typeof item.expires !== 'number' || !Number.isFinite(item.expires) || item.expires <= Date.now()) continue;
      const result = validCachedResult(item.result, item.word);
      if (result) cache.set(item.word, { result, expires: Math.min(item.expires, Date.now() + (result.status === 'missing' ? MISSING_TTL : FOUND_TTL)) });
    }
    prune();
  } catch { /* Private browsing and damaged storage must not block practice. */ }
}
function remember(word: string, result: DictionaryResult) {
  if (result.status === 'unavailable') return;
  cache.delete(word);
  cache.set(word, { result, expires: Date.now() + (result.status === 'missing' ? MISSING_TTL : FOUND_TTL) });
  prune();
  try { localStorage.setItem(CACHE_KEY, JSON.stringify([...cache].map(([word, value]) => ({ word, ...value })))); }
  catch { /* The bounded in-memory cache remains available. */ }
}

function parseEntries(data: unknown, word: string): DictionaryResult {
  if (!Array.isArray(data)) return { status: 'unavailable' };
  let fallback: Extract<DictionaryResult, { status: 'found' }> | undefined;
  // Bound traversal even if a server returns an unexpectedly large payload.
  for (const item of data.slice(0, 30)) {
    if (!record(item) || text(item.word, 60).toLowerCase() !== word || !Array.isArray(item.meanings)) continue;
    for (const meaning of item.meanings.slice(0, 30)) {
      if (!record(meaning) || !Array.isArray(meaning.definitions)) continue;
      for (const definition of meaning.definitions.slice(0, 50)) {
        if (!record(definition) || !text(definition.definition)) continue;
        const candidate: Extract<DictionaryResult, { status: 'found' }> = {
          status: 'found', entry: { word, part: text(meaning.partOfSpeech, 100), meaning: text(definition.definition), example: text(definition.example, 1500) },
          ...attribution(item),
        };
        if (candidate.entry.example) return candidate;
        fallback ??= candidate;
      }
    }
  }
  return fallback || { status: 'unavailable' };
}

/** Curated entries work offline; remote lookups resolve unavailable on timeout/abort.
 * Callers should still ignore stale results when the selected word changes.
 * Missing examples remain an empty string for the UI to handle explicitly. */
export async function lookupDefinition(rawWord: string, signal?: AbortSignal): Promise<DictionaryResult> {
  if (signal?.aborted) return { status: 'unavailable' };
  const word = rawWord.trim().toLowerCase();
  if (!/^[a-z]{1,60}$/.test(word)) return { status: 'missing' };
  const curated = wordByName.get(word);
  if (curated) return { status: 'found', entry: { ...curated } };
  hydrate();
  const saved = cache.get(word);
  if (saved && saved.expires > Date.now()) return saved.result;
  if (saved) cache.delete(word);

  const controller = new AbortController();
  const abort = () => controller.abort();
  signal?.addEventListener('abort', abort, { once: true });
  const timer = setTimeout(abort, TIMEOUT);
  let rejectAbort: (() => void) | undefined;
  const aborted = new Promise<never>((_, reject) => {
    rejectAbort = () => reject(new DOMException('Dictionary lookup cancelled', 'AbortError'));
    controller.signal.addEventListener('abort', rejectAbort, { once: true });
  });
  try {
    const request = async (): Promise<DictionaryResult> => {
      const response = await fetch(`https://api.dictionaryapi.dev/api/v2/entries/en/${encodeURIComponent(word)}`, { signal: controller.signal, headers: { Accept: 'application/json' } });
      if (response.status === 404) return { status: 'missing' };
      if (!response.ok) return { status: 'unavailable' };
      return parseEntries(await response.json(), word);
    };
    const result = await Promise.race([request(), aborted]);
    if (controller.signal.aborted || signal?.aborted) return { status: 'unavailable' };
    remember(word, result);
    return result;
  } catch { return { status: 'unavailable' }; }
  finally {
    clearTimeout(timer);
    signal?.removeEventListener('abort', abort);
    if (rejectAbort) controller.signal.removeEventListener('abort', rejectAbort);
  }
}
