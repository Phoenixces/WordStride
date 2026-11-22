import { lookupDefinition } from './dictionary';
import type { DictionaryResult } from '../model/types';

export interface DictionaryQueue {
  enqueue(word: string): void;
  dispose(): void;
}

/** Own one queue for a mounted screen, not one per current word. Results are keyed
 * so finishing an older request never selects that older word in the UI. Create a
 * fresh queue during each effect setup (including React StrictMode's replay). */
export function createDictionaryQueue(
  onResult: (word: string, result: DictionaryResult) => void,
  lookup: typeof lookupDefinition = lookupDefinition,
): DictionaryQueue {
  const pending: string[] = [];
  const queued = new Set<string>();
  const active = new Map<string, AbortController>();
  const completed = new Set<string>();
  let disposed = false;

  function finish(word: string, result: DictionaryResult) {
    active.delete(word);
    if (disposed) return;
    // Temporary failures may be retried by a later explicit enqueue. Successful
    // and absent entries are remembered here as well as by the lookup cache.
    if (result.status !== 'unavailable') {
      completed.add(word);
      if (completed.size > 200) completed.delete(completed.values().next().value!);
    }
    try { onResult(word, result); }
    finally { drain(); }
  }

  function drain() {
    while (!disposed && active.size < 3 && pending.length) {
      const word = pending.shift()!;
      queued.delete(word);
      const controller = new AbortController();
      active.set(word, controller);
      // Defer invocation so a synchronous lookup failure also takes the normal
      // completion path, releasing its slot and allowing later work to proceed.
      void Promise.resolve().then(() => {
        if (disposed) return { status: 'unavailable' } as const;
        return lookup(word, controller.signal);
      }).then(
        result => finish(word, result),
        () => finish(word, { status: 'unavailable' }),
      ).catch(() => { /* A throwing consumer cannot stop or reject the queue. */ });
    }
  }

  return {
    enqueue(rawWord) {
      if (disposed) return;
      const word = rawWord.trim().toLowerCase();
      if (!/^[a-z]{1,60}$/.test(word) || queued.has(word) || active.has(word) || completed.has(word)) return;
      queued.add(word);
      pending.push(word);
      drain();
    },
    dispose() {
      if (disposed) return;
      disposed = true;
      for (const controller of active.values()) controller.abort();
      pending.length = 0;
      queued.clear();
      active.clear();
      completed.clear();
    },
  };
}
