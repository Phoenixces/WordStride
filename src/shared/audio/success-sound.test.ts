import { describe, expect, it, vi } from 'vitest';
import { createSuccessSound } from './success-sound';

function audio(state: AudioContextState = 'running') {
  const starts: number[] = [];
  const oscillator = { type: '', frequency: { setValueAtTime: vi.fn(), exponentialRampToValueAtTime: vi.fn() },
    connect: vi.fn(), disconnect: vi.fn(), start: vi.fn((time: number) => starts.push(time)), stop: vi.fn(), onended: null };
  const gain = { gain: { setValueAtTime: vi.fn(), linearRampToValueAtTime: vi.fn(), exponentialRampToValueAtTime: vi.fn() }, connect: vi.fn(), disconnect: vi.fn() };
  const context = { state, currentTime: 12, destination: {}, resume: vi.fn(async () => { context.state = 'running'; }),
    close: vi.fn(async () => { context.state = 'closed'; }), createOscillator: vi.fn(() => oscillator), createGain: vi.fn(() => gain) };
  return { context, starts, factory: vi.fn(() => context as unknown as AudioContext) };
}

describe('success sound browser lifecycle', () => {
  it('waits for suspended audio and schedules against its new running clock', async () => {
    const { context, starts, factory } = audio('suspended');
    let resume!: () => void;
    context.resume.mockImplementation(() => new Promise<void>(resolve => { resume = () => { context.state = 'running'; context.currentTime = 20; resolve(); }; }));
    const player = createSuccessSound(() => true, factory);
    const playing = player.play();
    expect(context.createOscillator).not.toHaveBeenCalled();
    resume();
    expect(await playing).toBe('played');
    expect(starts).toHaveLength(4);
    expect(starts[0]).toBe(20.01);
    expect(starts.every(time => time >= 20.01)).toBe(true);
    player.dispose();
  });

  it('reports rejected or unsupported audio instead of silently claiming playback', async () => {
    const { context, factory } = audio('suspended');
    context.resume.mockRejectedValue(new Error('Audio blocked'));
    const player = createSuccessSound(() => true, factory);
    expect(await player.play()).toBe('unavailable');
    expect(context.createOscillator).not.toHaveBeenCalled();
    const unsupported = createSuccessSound(() => true, () => { throw new Error('Unsupported browser'); });
    expect(await unsupported.play()).toBe('unavailable');
    player.dispose();
    unsupported.dispose();
  });

  it('honors mute changes while audio is resuming and allows an explicit preview', async () => {
    const { context, factory } = audio('suspended');
    let enabled = true;
    let resume!: () => void;
    context.resume.mockImplementation(() => new Promise<void>(resolve => { resume = () => { context.state = 'running'; resolve(); }; }));
    const player = createSuccessSound(() => enabled, factory);
    const playing = player.play();
    enabled = false;
    resume();
    expect(await playing).toBe('muted');
    expect(context.createOscillator).not.toHaveBeenCalled();
    expect(await player.play(true)).toBe('played');
    expect(context.createOscillator).toHaveBeenCalledTimes(4);
    player.dispose();
  });

  it('does not create audio for muted submissions; preparation is silent', async () => {
    const { context, factory } = audio();
    const player = createSuccessSound(() => false, factory);
    expect(await player.play()).toBe('muted');
    expect(factory).not.toHaveBeenCalled();
    expect(await player.prepare()).toBe(true);
    expect(context.createOscillator).not.toHaveBeenCalled();
    player.dispose();
    expect(context.close).toHaveBeenCalledOnce();
    expect(await player.play(true)).toBe('muted');
  });

  it('suppresses pending playback on unmount and recreates externally closed audio', async () => {
    const first = audio('closed');
    const next = audio('suspended');
    const factory = vi.fn().mockReturnValueOnce(first.context).mockReturnValueOnce(next.context);
    const player = createSuccessSound(() => true, factory);
    expect(await player.prepare()).toBe(true);
    first.context.state = 'closed';
    let resume!: () => void;
    next.context.resume.mockImplementation(() => new Promise<void>(resolve => { resume = resolve; }));
    const playing = player.play();
    player.dispose();
    resume();
    expect(await playing).toBe('muted');
    expect(next.context.createOscillator).not.toHaveBeenCalled();
  });
});
