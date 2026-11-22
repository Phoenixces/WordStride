import { describe, expect, it, vi } from 'vitest';
import { createDictionaryQueue } from './dictionary-queue';
import type { DictionaryResult } from '../model/types';

const found = (word: string): DictionaryResult => ({ status: 'found', entry: { word, part: 'noun', meaning: `Meaning of ${word}.`, example: '' } });
const flush = async () => { for (let i = 0; i < 8; i++) await Promise.resolve(); };
function deferredLookup() {
  const jobs = new Map<string, { resolve: (value: DictionaryResult) => void; reject: (error: Error) => void; signal?: AbortSignal }>();
  const lookup = vi.fn((word: string, signal?: AbortSignal) => new Promise<DictionaryResult>((resolve, reject) => { jobs.set(word, { resolve, reject, signal }); }));
  return { jobs, lookup };
}

describe('dictionary request queue', () => {
  it('limits concurrency to three and starts pending words in FIFO order', async () => {
    const { jobs, lookup } = deferredLookup();
    const onResult = vi.fn();
    const queue = createDictionaryQueue(onResult, lookup);
    ['abacus', 'abalone', 'abandon', 'abase', 'abate'].forEach(queue.enqueue);
    await flush();
    expect(lookup.mock.calls.map(([word]) => word)).toEqual(['abacus', 'abalone', 'abandon']);
    jobs.get('abalone')!.resolve(found('abalone'));
    await flush();
    expect(lookup.mock.calls.map(([word]) => word)).toEqual(['abacus', 'abalone', 'abandon', 'abase']);
    expect(onResult).toHaveBeenCalledWith('abalone', found('abalone'));
    jobs.get('abacus')!.resolve(found('abacus'));
    await flush();
    expect(lookup.mock.calls.map(([word]) => word)).toEqual(['abacus', 'abalone', 'abandon', 'abase', 'abate']);
    queue.dispose();
  });

  it('deduplicates normalized words while queued, in flight, and after completion', async () => {
    const { jobs, lookup } = deferredLookup();
    const onResult = vi.fn();
    const queue = createDictionaryQueue(onResult, lookup);
    [' ABACUS ', 'abacus', 'abalone', 'abandon', 'abase', 'ABASE'].forEach(queue.enqueue);
    await flush();
    expect(lookup).toHaveBeenCalledTimes(3);
    jobs.get('abacus')!.resolve(found('abacus'));
    await flush();
    queue.enqueue('abacus');
    queue.enqueue('abase');
    await flush();
    expect(lookup).toHaveBeenCalledTimes(4);
    expect(onResult).toHaveBeenCalledTimes(1);
    queue.dispose();
  });

  it('keeps existing requests alive as later practice words are enqueued', async () => {
    const { jobs, lookup } = deferredLookup();
    const onResult = vi.fn();
    const queue = createDictionaryQueue(onResult, lookup);
    queue.enqueue('abacus');
    await flush();
    const signal = jobs.get('abacus')!.signal!;
    ['abalone', 'abandon', 'abase'].forEach(queue.enqueue);
    await flush();
    expect(signal.aborted).toBe(false);
    jobs.get('abandon')!.resolve(found('abandon'));
    jobs.get('abacus')!.resolve(found('abacus'));
    await flush();
    expect(onResult.mock.calls).toEqual([['abandon', found('abandon')], ['abacus', found('abacus')]]);
    queue.dispose();
  });

  it('dispose aborts active work, discards queued work, and suppresses late callbacks', async () => {
    const { jobs, lookup } = deferredLookup();
    const onResult = vi.fn();
    const queue = createDictionaryQueue(onResult, lookup);
    ['abacus', 'abalone', 'abandon', 'abase'].forEach(queue.enqueue);
    await flush();
    queue.dispose();
    queue.dispose();
    for (const [word, job] of jobs) { expect(job.signal?.aborted).toBe(true); job.resolve(found(word)); }
    queue.enqueue('abate');
    await flush();
    expect(lookup).toHaveBeenCalledTimes(3);
    expect(onResult).not.toHaveBeenCalled();
  });

  it('dispose before deferred invocation avoids requests entirely', async () => {
    const lookup = vi.fn(async (word: string) => found(word));
    const onResult = vi.fn();
    const queue = createDictionaryQueue(onResult, lookup);
    queue.enqueue('abacus');
    queue.dispose();
    await flush();
    expect(lookup).not.toHaveBeenCalled();
    expect(onResult).not.toHaveBeenCalled();
  });

  it('a fresh queue works after effect setup-cleanup-setup replay', async () => {
    const { jobs, lookup } = deferredLookup();
    const firstCallback = vi.fn(); const secondCallback = vi.fn();
    const first = createDictionaryQueue(firstCallback, lookup);
    first.enqueue('abacus');
    await flush();
    const firstJob = jobs.get('abacus')!;
    first.dispose();
    const second = createDictionaryQueue(secondCallback, lookup);
    second.enqueue('abacus');
    await flush();
    expect(lookup).toHaveBeenCalledTimes(2);
    expect(jobs.get('abacus')!.signal?.aborted).toBe(false);
    firstJob.resolve(found('abacus'));
    jobs.get('abacus')!.resolve(found('abacus'));
    await flush();
    expect(firstCallback).not.toHaveBeenCalled();
    expect(secondCallback).toHaveBeenCalledExactlyOnceWith('abacus', found('abacus'));
    second.dispose();
  });

  it('releases rejected and synchronously throwing requests and permits later retries', async () => {
    const onResult = vi.fn();
    const lookup = vi.fn<(word: string, signal?: AbortSignal) => Promise<DictionaryResult>>()
      .mockRejectedValueOnce(new Error('offline'))
      .mockImplementationOnce(() => { throw new Error('sync failure'); })
      .mockImplementation(async word => found(word));
    const queue = createDictionaryQueue(onResult, lookup);
    ['abacus', 'abalone', 'abandon', 'abase'].forEach(queue.enqueue);
    await flush();
    expect(lookup).toHaveBeenCalledTimes(4);
    expect(onResult).toHaveBeenCalledWith('abacus', { status: 'unavailable' });
    expect(onResult).toHaveBeenCalledWith('abalone', { status: 'unavailable' });
    queue.enqueue('abacus');
    await flush();
    expect(onResult).toHaveBeenCalledWith('abacus', found('abacus'));
    expect(lookup).toHaveBeenCalledTimes(5);
    queue.dispose();
  });

  it('does not re-request known absent words and ignores invalid input', async () => {
    const lookup = vi.fn(async (): Promise<DictionaryResult> => ({ status: 'missing' }));
    const queue = createDictionaryQueue(vi.fn(), lookup);
    ['', 'two words', '../abacus'].forEach(queue.enqueue);
    queue.enqueue('abacus');
    await flush();
    queue.enqueue('abacus');
    await flush();
    expect(lookup).toHaveBeenCalledTimes(1);
    queue.dispose();
  });

  it('a throwing consumer does not block pending work or create unhandled rejections', async () => {
    const lookup = vi.fn(async (word: string) => found(word));
    const queue = createDictionaryQueue(() => { throw new Error('Consumer error'); }, lookup);
    ['abacus', 'abalone', 'abandon', 'abase'].forEach(queue.enqueue);
    await flush();
    expect(lookup).toHaveBeenCalledTimes(4);
    queue.dispose();
  });
});
