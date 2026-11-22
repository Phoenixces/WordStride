import { useCallback, useEffect, useReducer, useRef, useState } from 'react';
import { accuracy, KEYS, defaultTargets, validTargets, localDay, newSession, reducer, speed } from '@/features/practice/model/engine';
import type { Action, Settings } from '@/features/practice/model/types';
import { loadProfile, STORAGE_KEY } from '@/features/practice/model/profile-storage';
import { Dialog } from '@/shared/ui/Dialog';
import { Metric } from '@/shared/ui/Metric';
import { ReviewWord } from '@/features/vocabulary/components/ReviewWord';
import { VocabularyCard } from '@/features/vocabulary/components/VocabularyCard';
import { Statistics } from '@/features/statistics/components/Statistics';
import { createSuccessSound } from '@/shared/audio/success-sound';
import { Keyboard, Keycap } from '@/features/practice/components/Keyboard';
import { loadWordBatch } from '@/features/practice/services/word-source';
import type { DictionaryResult } from '@/features/vocabulary/model/types';
import { createDictionaryQueue, type DictionaryQueue } from '@/features/vocabulary/services/dictionary-queue';
import { wordByName } from '@/features/vocabulary/data/fallback-vocabulary';

const clock = (ms: number) => `${Math.floor(ms / 60000).toString().padStart(2, '0')}:${Math.floor(ms / 1000 % 60).toString().padStart(2, '0')}`;
const IDLE_PAUSE_MS = 5000;
export default function App() {
  const [state, reactDispatch] = useReducer(reducer, undefined, () => { const profile = loadProfile(); return { profile, session: newSession(profile) }; });
  const liveState = useRef(state);
  const lastTick = useRef<number | null>(null);
  const { profile, session } = state;
  const { settings } = profile;
  const [dialog, setDialog] = useState<'settings' | 'progress' | 'key' | null>(null);
  const [draft, setDraft] = useState<Settings>(settings);
  const [editingKey, setEditingKey] = useState('a');
  const [targetDraft, setTargetDraft] = useState(defaultTargets);
  const [targetError, setTargetError] = useState('');
  const [focused, setFocused] = useState(false);
  const [pressed, setPressed] = useState('');
  const [notice, setNotice] = useState('');
  const [fullscreen, setFullscreen] = useState(false);
  const [storageError, setStorageError] = useState(false);
  const [soundError, setSoundError] = useState(false);
  const [batchRequest, setBatchRequest] = useState(0);
  const [batchStatus, setBatchStatus] = useState<'idle' | 'loading' | 'ready' | 'error'>('idle');
  const [definitions, setDefinitions] = useState<Record<string, DictionaryResult>>({});
  const input = useRef<HTMLTextAreaElement>(null);
  const currentWord = useRef<HTMLSpanElement>(null);
  const wordViewport = useRef<HTMLDivElement>(null);
  const lastInput = useRef(performance.now());
  const latestProfile = useRef(profile);
  const audio = useRef<ReturnType<typeof createSuccessSound> | null>(null);
  const dictionaryQueue = useRef<DictionaryQueue | null>(null);
  const profileMenu = useRef<HTMLDetailsElement>(null);
  latestProfile.current = profile;
  liveState.current = state;
  // Flush active time before each input and pause, including the final Space.
  // Mirroring the pure reducer also handles several mobile input characters in
  // one event without checking sound against an outdated typed word.
  const dispatch = useCallback((action: Action) => {
    const now = performance.now();
    let current = liveState.current;
    const inactive = current.session.status === 'running' && now - lastInput.current >= IDLE_PAUSE_MS;
    if (current.session.status === 'running' && lastTick.current !== null) {
      const until = Math.min(now, lastInput.current + IDLE_PAUSE_MS);
      const tick: Action = { type: 'TICK', delta: Math.max(0, until - lastTick.current), day: localDay() };
      current = reducer(current, tick);
      reactDispatch(tick);
    }
    lastTick.current = now;
    if (inactive && current.session.status === 'running') {
      current = reducer(current, { type: 'PAUSE' });
      reactDispatch({ type: 'PAUSE' });
    }
    if (action.type !== 'TICK') { current = reducer(current, action); reactDispatch(action); }
    if (action.type === 'TYPE' || action.type === 'RESUME') lastInput.current = now;
    liveState.current = current;
    latestProfile.current = current.profile;
  }, []);
  const day = localDay();
  const selected = profile.selectedKey ? profile.keys[profile.selectedKey] : null;
  const selectedTargets = selected?.targets || defaultTargets();
  const mastered = [...KEYS].filter(key => profile.keys[key].mastered);
  const dailyMs = selected?.daily[day] || 0;
  const dailyMinutes = Math.floor(dailyMs / 60000);
  const focusKey = profile.selectedKey?.toUpperCase() || '';
  const target = session.words[session.index];
  const wordComplete = Boolean(target && session.typed === target.word);
  const progressBucket = Math.floor(dailyMs / 5000);
  const best = selected?.bestWpm || 0;
  const correctWords = session.completed.filter(item => item.correct);
  const skippedWords = session.completed.filter(item => !item.correct);
  const definition = session.lastWord ? definitions[session.lastWord.word] : undefined;

  const save = useCallback(() => {
    try { localStorage.setItem(STORAGE_KEY, JSON.stringify(latestProfile.current)); setStorageError(false); }
    catch { setStorageError(true); }
  }, []);
  useEffect(save, [save, progressBucket, session.status, profile.score, settings, profile.selectedKey, selected?.targets, selected?.mastered, selected?.history]);
  useEffect(() => {
    const controller = new AbortController();
    const current = latestProfile.current;
    const letter = current.selectedKey;
    if (!letter) { setBatchStatus('idle'); return; }
    setBatchStatus('loading');
    dispatch({ type: 'RESTART', words: [] });
    void loadWordBatch(letter, {}, controller.signal).then(words => {
      if (controller.signal.aborted) return;
      dispatch({ type: 'RESTART', words: words.map(word => wordByName.get(word) || { word, part: '', meaning: '', example: '' }) });
      setBatchStatus(words.length ? 'ready' : 'error');
      if (wordViewport.current) wordViewport.current.scrollTop = 0;
    }).catch(() => { if (!controller.signal.aborted) setBatchStatus('error'); });
    return () => controller.abort();
  }, [batchRequest, profile.selectedKey]);
  useEffect(() => {
    if (batchStatus === 'ready' && window.matchMedia('(pointer: fine)').matches) input.current?.focus({ preventScroll: true });
  }, [batchStatus]);
  useEffect(() => {
    const queue = createDictionaryQueue((word, result) => {
      setDefinitions(previous => ({ ...previous, [word]: result }));
    });
    dictionaryQueue.current = queue;
    return () => {
      queue.dispose();
      if (dictionaryQueue.current === queue) dictionaryQueue.current = null;
    };
  }, []);
  useEffect(() => {
    // Advancing words adds work to the mount-owned queue; it does not cancel
    // existing requests. Results stay keyed to their word, never to the cursor.
    const candidates = new Set([session.lastWord?.word, ...session.words.slice(session.index, session.index + 2).map(word => word.word)]);
    for (const word of candidates) {
      if (!word || definitions[word]?.status === 'found' || definitions[word]?.status === 'missing') continue;
      dictionaryQueue.current?.enqueue(word);
    }
  }, [session.words, session.index, session.lastWord?.word]);
  useEffect(() => {
    const pause = () => { dispatch({ type: 'PAUSE' }); save(); };
    const visibility = () => { if (document.hidden) pause(); };
    const fs = () => setFullscreen(Boolean(document.fullscreenElement));
    window.addEventListener('blur', pause);
    window.addEventListener('pagehide', pause);
    document.addEventListener('visibilitychange', visibility);
    document.addEventListener('fullscreenchange', fs);
    return () => { window.removeEventListener('blur', pause); window.removeEventListener('pagehide', pause); document.removeEventListener('visibilitychange', visibility); document.removeEventListener('fullscreenchange', fs); };
  }, [save, dispatch]);
  useEffect(() => {
    if (session.status !== 'running') return;
    const interval = window.setInterval(() => {
      const now = performance.now();
      if (now - lastInput.current >= IDLE_PAUSE_MS) { dispatch({ type: 'PAUSE' }); return; }
      dispatch({ type: 'TICK', delta: 0, day: localDay() });
    }, 250);
    return () => window.clearInterval(interval);
  }, [session.status, dispatch]);
  useEffect(() => {
    if (window.matchMedia('(pointer: fine)').matches) input.current?.focus({ preventScroll: true });
    return () => { audio.current?.dispose(); audio.current = null; };
  }, []);
  useEffect(() => {
    const word = currentWord.current; const viewport = wordViewport.current;
    if (word && viewport) viewport.scrollTop = Math.max(0, word.offsetTop - viewport.offsetTop - 6);
  }, [session.index]);
  useEffect(() => { if (!pressed) return; const id = window.setTimeout(() => setPressed(''), 110); return () => window.clearTimeout(id); }, [pressed]);

  const refocus = () => window.requestAnimationFrame(() => input.current?.focus({ preventScroll: true }));
  function soundPlayer() {
    return audio.current ??= createSuccessSound(() => latestProfile.current.settings.sound);
  }
  function playSound(preview = false) {
    const player = soundPlayer();
    void player.play(preview).then(result => {
      if (audio.current === player) setSoundError(result === 'unavailable');
    });
  }
  function toggleSound() {
    const enabled = !settings.sound;
    dispatch({ type: 'SETTINGS', settings: { ...settings, sound: enabled } });
    if (enabled) playSound();
    else setSoundError(false);
  }
  function restart() {
    if (!profile.selectedKey) return;
    setBatchStatus('loading');
    setBatchRequest(request => request + 1);
  }
  function type(key: string) {
    const before = liveState.current.session;
    if (dialog || batchStatus !== 'ready' || before.status === 'finished' || before.status === 'paused') return;
    if (settings.sound) void soundPlayer().prepare();
    setPressed(key);
    dispatch({ type: 'TYPE', key, day: localDay() });
    const after = liveState.current.session;
    if (settings.sound && key === ' ' && after.index > before.index && after.completed.at(-1)?.correct) {
      playSound();
    }
  }
  function openDialog(which: 'settings' | 'progress') {
    if (profileMenu.current?.contains(document.activeElement)) profileMenu.current.querySelector('summary')?.focus();
    profileMenu.current?.removeAttribute('open');
    dispatch({ type: 'PAUSE' }); setDraft(settings); setDialog(which);
  }
  function openKey(key: string) {
    dispatch({ type: 'PAUSE' });
    setEditingKey(key);
    setTargetDraft({ ...profile.keys[key].targets });
    setTargetError('');
    setDialog('key');
  }
  function startKey() {
    if (!validTargets(targetDraft)) { setTargetError('Enter valid targets for speed, accuracy and daily minutes.'); return; }
    if (settings.sound) void soundPlayer().prepare();
    dispatch({ type: 'KEY_SETTINGS', key: editingKey, targets: targetDraft });
    dispatch({ type: 'SELECT_KEY', key: editingKey });
    setBatchStatus('loading');
    setBatchRequest(request => request + 1);
    setDialog(null);
  }
  async function toggleFullscreen() {
    try { if (document.fullscreenElement) await document.exitFullscreen(); else await document.documentElement.requestFullscreen(); }
    catch { setNotice('Full screen is not available in this browser.'); }
  }
  const hint = session.status === 'paused' ? 'Take your time. Your session is paused.'
    : session.status === 'idle' ? 'Start typing. Press Space after each word to keep going.'
    : wordComplete ? 'Word complete. Press Space to reveal its meaning and keep going.'
    : session.feedback === 'skipped' ? 'Word skipped. Keep going — your last meaning stays here.'
    : session.feedback === 'correct' ? 'Correct word. Meaning revealed below.' : 'Find your rhythm. Accuracy comes before speed.';

  return <main className="app-shell">
    <header className="header">
      <a className="brand" href="./" aria-label="WordStride home"><span className="brand-mark">W_</span><h1>WORDSTRIDE</h1></a>
      <nav className="controls" aria-label="Practice controls">
        <button type="button" aria-pressed={settings.sound} onClick={toggleSound}>Sound {settings.sound ? 'on' : 'off'}</button>
        <button type="button" onClick={toggleFullscreen}>{fullscreen ? 'Exit full screen' : 'Full screen'}</button>
        <details className="profile-menu" ref={profileMenu} onBlur={event => { if (!event.currentTarget.contains(event.relatedTarget as Node | null)) event.currentTarget.open = false; }}>
          <summary aria-label="Open account menu" title="Settings and statistics">
            <svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="8" r="3.4" /><path d="M5.4 20c.5-3.3 3.1-5.1 6.6-5.1s6.1 1.8 6.6 5.1" /></svg>
          </summary>
          <div className="profile-menu-panel">
            <button type="button" onClick={() => openDialog('settings')}>Settings</button>
            <button type="button" onClick={() => openDialog('progress')}>Statistics</button>
          </div>
        </details>
      </nav>
    </header>
    {(notice || storageError) && <p className="notice" role="status">{notice || 'Progress could not be saved in this browser. You can still practise.'}</p>}
    {soundError && <p className="notice" role="status">Sound could not start in this browser. <button type="button" className="text-button" onClick={() => playSound(true)}>Retry sound</button></p>}
    <section className="metrics-section" aria-label="Practice metrics and key progression">
      <div className="metrics-top"><div className="metrics">
        <Metric label="SPEED" value={`${speed(session).toFixed(1)} WPM`} secondary={selected ? `Best ${best.toFixed(1)} WPM` : 'Best —'} />
        <Metric label="ACCURACY" value={session.attempts ? `${accuracy(session.hits, session.attempts).toFixed(1)}%` : '—'} />
        <Metric label="SCORE" value={profile.score.toLocaleString()} />
      </div><div className="daily-goal">
        <div className="goal-label"><span className="eyebrow">DAILY GOAL{focusKey && ` · ${focusKey}`}</span><span>{selected ? `${dailyMinutes} / ${selectedTargets.dailyGoal} min` : '—'}</span></div>
        <progress value={Math.min(dailyMs / 60000, selectedTargets.dailyGoal)} max={selectedTargets.dailyGoal} aria-label="Daily practice goal" />
        <p>{!selected ? 'Choose a key to set your daily goal.' : dailyMinutes >= selectedTargets.dailyGoal ? 'Daily goal reached. Nicely done.' : `${selectedTargets.dailyGoal - dailyMinutes} more minutes on ${focusKey}. Keep your rhythm.`}</p>
      </div></div>
      <div className="all-keys"><span className="eyebrow row-label">ALL KEYS</span><div className="key-sequence">{[...KEYS].map(key => <Keycap key={key} label={key.toUpperCase()} small mastered={profile.keys[key].mastered} active={key === profile.selectedKey} onClick={() => openKey(key)} />)}</div><span className="key-count eyebrow">{mastered.length} / 26 <span className="sr-only">keys achieved</span></span></div>
      {selected && <p className="practice-targets"><span>Target for <strong>{focusKey}</strong></span><span>{selectedTargets.wpm} WPM / {selectedTargets.accuracy}% accuracy</span></p>}
    </section>
    {session.status === 'finished' ? <section className="results" aria-labelledby="result-title">
      <div className="result-heading"><div><p className="eyebrow cyan">SESSION COMPLETE</p><h2 id="result-title">One word closer.</h2><p>{correctWords.length} correct words · {skippedWords.length} skipped · {clock(session.elapsed)} of practice</p></div><button className="primary" onClick={restart}>Next batch <span aria-hidden="true">→</span></button></div>
      <p className="result-feedback">{session.masteredKey ? `Key ${session.masteredKey.toUpperCase()} achieved! Your speed and accuracy targets are met.` : session.qualified ? 'Targets met. Keep building your rhythm.' : `Aim for at least ${session.targets.wpm} WPM and ${session.targets.accuracy}% accuracy in a completed session to check off ${focusKey}.`}</p>
      <div className="review-list"><h3>Words you discovered</h3>{correctWords.length ? [...new Map(correctWords.map(item => [item.word.word, item.word])).values()].map(word => <ReviewWord key={word.word} word={word} result={definitions[word.word]} />) : <p className="muted">Complete a word correctly and press Space to discover its meaning in your next session.</p>}</div>
      {skippedWords.length > 0 && <p className="missed-words">Skipped words: {[...new Set(skippedWords.map(item => item.word.word))].join(' · ')}</p>}
    </section> : <>
      <section className="typing-section" aria-label="Typing practice">
        {batchStatus !== 'ready' ? <div className="batch-message" role="status">
          <h2>{batchStatus === 'loading' ? 'Finding your next words…' : batchStatus === 'error' ? 'Your word list could not load.' : 'Choose your key. Find your rhythm.'}</h2>
          <p>{batchStatus === 'idle' ? 'Click any key above to set your targets and start practising.' : batchStatus === 'error' ? 'Check your connection and try again. Your progress is saved.' : 'Picking 25 random words for your key.'}</p>
          {batchStatus === 'error' && <button onClick={restart}>Try again</button>}
        </div> : <div className={`typing-pad ${session.status === 'paused' || !focused ? 'unfocused' : ''}`}>
          <div ref={wordViewport} className="word-viewport" aria-hidden="true"><div className="word-stream">{session.words.map((word, i) => {
            const completed = session.completed[i]; const active = i === session.index;
            const typed = active ? session.typed : completed?.typed || '';
            return <span className={`word ${active ? 'current-word' : ''} ${i > session.index ? 'upcoming' : ''}`} key={`${word.word}-${i}`} ref={active ? currentWord : undefined} data-word={word.word}>
              {[...word.word].map((letter, index) => <span key={index} className={`letter ${index < typed.length ? typed[index] === letter ? 'correct' : 'incorrect' : completed ? 'missed' : ''} ${active && index === typed.length ? 'caret' : ''}`}>{index < typed.length && typed[index] !== letter ? typed[index] : letter}</span>)}
              {typed.length > word.word.length && <span className="incorrect">{typed.slice(word.word.length)}</span>}
              <span className={`word-space ${completed?.correct ? 'correct' : ''} ${active && typed.length >= word.word.length ? 'caret' : ''}`}>·</span>
            </span>;
          })}</div></div>
          <textarea ref={input} className="typing-input" aria-label="Typing input" aria-describedby="typing-instructions current-word-description" value={session.typed} spellCheck={false} autoComplete="off" autoCorrect="off" autoCapitalize="off"
            onFocus={() => { setFocused(true); }} onBlur={() => { setFocused(false); dispatch({ type: 'PAUSE' }); }}
            onPaste={event => event.preventDefault()}
            onKeyDown={event => {
              if (event.nativeEvent.isComposing || event.ctrlKey || event.metaKey || event.altKey) return;
              if (event.key === 'Escape') { event.preventDefault(); dispatch({ type: 'PAUSE' }); return; }
              if (event.key === 'Tab' && !event.shiftKey) { event.preventDefault(); restart(); return; }
              if (event.key === 'Enter') { event.preventDefault(); if (session.status === 'paused') dispatch({ type: 'RESUME' }); return; }
              if (/^[a-zA-Z]$/.test(event.key) || event.key === ' ' || event.key === 'Backspace') { event.preventDefault(); if (!event.repeat || event.key === 'Backspace') type(event.key); }
            }}
            onChange={event => {
              const value = event.target.value;
              let prefix = 0; while (prefix < Math.min(value.length, session.typed.length) && value[prefix] === session.typed[prefix]) prefix++;
              for (let i = prefix; i < session.typed.length; i++) type('Backspace');
              for (const letter of value.slice(prefix)) type(letter);
            }} />
          {(session.status === 'paused' || !focused) && <button className="focus-overlay" onClick={() => { dispatch({ type: 'RESUME' }); refocus(); }}>{session.status === 'paused' ? 'Session paused · click or press Enter to resume' : 'Click here to start typing'} <span aria-hidden="true">↵</span></button>}
        </div>}
        <p id="typing-instructions" className={`typing-hint ${session.feedback === 'skipped' && !wordComplete ? 'red' : ''}`}>{batchStatus === 'ready' ? hint : 'Every batch brings a fresh mix. Your practice stats are saved automatically.'}</p>
        <span className="sr-only" id="current-word-description">Current word: {target?.word}. Space advances. Backspace corrects. Escape pauses. Tab loads the next batch; Shift Tab leaves the typing area.</span>
      </section>
      <VocabularyCard word={session.lastWord} result={definition} correct={session.feedback === 'correct'} />
      {settings.keyboard && <Keyboard selectedKey={profile.selectedKey} mastered={mastered} pressed={pressed} complete={wordComplete} />}
    </>}
    <footer className="footer"><div className="shortcuts"><span><kbd>ESC</kbd> pause</span><span><kbd>TAB</kbd> next batch</span><span><kbd>BACKSPACE</kbd> correct</span></div><span className="footer-motto">Made with <span className="pink" role="img" aria-label="love">♥</span> by Phoenixces</span></footer>
    {dialog === 'settings' && <Dialog title="Make it your rhythm." onClose={() => setDialog(null)}><form onSubmit={event => { event.preventDefault(); dispatch({ type: 'SETTINGS', settings: draft }); setDialog(null); }}>
      <p className="dialog-intro">A little practice, every day. Your preferences stay in this browser.</p>
      <label className="setting-row"><span>Session length<small>Applies to your next session.</small></span><select value={draft.duration} onChange={event => setDraft({ ...draft, duration: Number(event.target.value) })}><option value={30}>30 seconds</option><option value={60}>1 minute</option><option value={120}>2 minutes</option></select></label>
      <label className="setting-row"><span>Keyboard guide<small>Show finger placement and key achievements.</small></span><input type="checkbox" checked={draft.keyboard} onChange={event => setDraft({ ...draft, keyboard: event.target.checked })} /></label>
      <label className="setting-row"><span>Success sound<small>A short tone after a correctly submitted word.</small></span><input type="checkbox" checked={draft.sound} onChange={event => setDraft({ ...draft, sound: event.target.checked })} /></label>
      <div className="sound-preview"><button type="button" onClick={() => playSound(true)}>Preview sound</button><span className="muted">Preview plays once, even while muted.</span></div>
      {soundError && <p className="notice" role="status">Your browser could not start audio. Check its sound permissions and try the preview again.</p>}
      <p className="settings-note">Click a key to set its speed, accuracy and daily practice targets. Your timer pauses after 5 seconds without typing.</p>
      <div className="dialog-actions"><button type="button" onClick={() => setDialog(null)}>Cancel</button><button type="submit" className="primary">Save preferences</button></div>
    </form></Dialog>}
    {dialog === 'key' && <Dialog title={`Practise ${editingKey.toUpperCase()}`} onClose={() => setDialog(null)}><form onSubmit={event => { event.preventDefault(); startKey(); }}>
      <p className="dialog-intro">Set your targets for words starting with {editingKey.toUpperCase()}. Meet both speed and accuracy in a completed session to check off this key.</p>
      <label className="setting-row"><span>Speed target<small>Words per minute · 1–300</small></span><input aria-label="Speed target" type="number" required min={1} max={300} step={1} value={targetDraft.wpm || ''} onChange={event => setTargetDraft({ ...targetDraft, wpm: Number(event.target.value) })} /></label>
      <label className="setting-row"><span>Accuracy target<small>Percent correct · 1–100</small></span><input aria-label="Accuracy target" type="number" required min={1} max={100} step={1} value={targetDraft.accuracy || ''} onChange={event => setTargetDraft({ ...targetDraft, accuracy: Number(event.target.value) })} /></label>
      <label className="setting-row"><span>Daily goal<small>Minutes on this key · 1–240</small></span><input aria-label="Daily goal" type="number" required min={1} max={240} step={1} value={targetDraft.dailyGoal || ''} onChange={event => setTargetDraft({ ...targetDraft, dailyGoal: Number(event.target.value) })} /></label>
      <p className="settings-note">Daily practice is tracked separately from your checkmark. Your targets stay saved for this key. Starting practice loads a fresh batch.</p>
      {profile.keys[editingKey].mastered && <p className="settings-note cyan">✓ Previously achieved. Changing your targets keeps your earned checkmark.</p>}
      {targetError && <p className="notice" role="alert">{targetError}</p>}
      <div className="dialog-actions"><button type="button" onClick={() => setDialog(null)}>Cancel</button><button type="submit" className="primary">Start practice</button></div>
    </form></Dialog>}
    {dialog === 'progress' && <Dialog title="Your statistics." className="statistics-dialog" onClose={() => setDialog(null)}><div className="progress-stats"><Metric label="BEST SPEED" value={profile.bestWpm.toFixed(1) + ' WPM'} /><Metric label="KEYS ACHIEVED" value={mastered.length + ' / 26'} /></div>
      <Statistics profile={profile} day={day} onConfigure={openKey} />
    </Dialog>}
  </main>;
}
