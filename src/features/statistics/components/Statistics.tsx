import { useState } from 'react';
import { KEYS } from '@/features/practice/model/engine';
import type { Profile } from '@/features/practice/model/types';

export function Statistics({ profile, day, onConfigure }: { profile: Profile; day: string; onConfigure: (key: string) => void }) {
  const [selectedKey, setSelectedKey] = useState(profile.selectedKey || 'all');
  const selected = selectedKey === 'all' ? null : profile.keys[selectedKey];
  const values = [...KEYS].map(key => ({ key, ...profile.keys[key] }));
  const maxWpm = Math.max(60, Math.ceil(Math.max(...values.map(item => item.bestWpm)) / 20) * 20);
  const left = 48, top = 26, bottom = 246, width = 820, height = 292;
  const plotWidth = width - left - 12, plotHeight = bottom - top, slot = plotWidth / values.length;
  const history = selected?.history || profile.history;
  const latest = selected?.history[0];
  const dailyMs = (selected?.daily || profile.daily)[day] || 0;

  return <>
    <section className="speed-chart" aria-label="WPM comparison">
      <h3>Best WPM by key</h3>
      <p className="speed-chart-note muted">Your fastest completed session for each key. Select a key to see its statistics.</p>
      <div className="chart-scroll">
        <svg viewBox={`0 0 ${width} ${height}`} role="group" aria-label="Best words per minute for each key">
          <title>Best completed-session WPM by key</title>
          {[0, 1, 2, 3, 4].map(index => {
            const value = maxWpm * index / 4; const y = bottom - plotHeight * index / 4;
            return <g key={index} aria-hidden="true"><line x1={left} x2={width - 12} y1={y} y2={y} className="chart-grid" />
              <text x={left - 8} y={y + 4} textAnchor="end" className="chart-label">{Math.round(value)}</text></g>;
          })}
          <text x={8} y={14} className="chart-axis-title" aria-hidden="true">WPM</text>
          {values.map((item, index) => {
            const x = left + index * slot; const barHeight = plotHeight * item.bestWpm / maxWpm;
            const hasResult = item.history.length > 0 || item.bestWpm > 0;
            const description = `${item.key.toUpperCase()}: ${hasResult ? `${item.bestWpm.toFixed(1)} WPM` : 'no completed sessions'}${item.mastered ? ', achieved' : ''}`;
            return <g key={item.key} className="chart-column" role="button" tabIndex={0} aria-label={description} aria-pressed={selectedKey === item.key}
              onClick={() => setSelectedKey(item.key)} onKeyDown={event => { if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); setSelectedKey(item.key); } }}>
              <title>{description}</title>
              <rect x={x + 1} y={top - 5} width={slot - 2} height={plotHeight + 34} rx={4} className="chart-hit-area" />
              <rect x={x + slot * 0.24} y={bottom - barHeight} width={slot * 0.52} height={barHeight} rx={2} className={`chart-bar ${item.mastered ? 'achieved' : ''}`} />
              {!hasResult && <circle cx={x + slot / 2} cy={bottom} r={2} className="chart-no-result" />}
              <text x={x + slot / 2} y={bottom + 19} textAnchor="middle" className="chart-key">{item.key.toUpperCase()}</text>
            </g>;
          })}
          <text x={left + plotWidth / 2} y={height - 5} textAnchor="middle" className="chart-axis-title" aria-hidden="true">KEY</text>
        </svg>
      </div>
      <div className="chart-legend eyebrow"><span><i className="legend-swatch" />Best WPM</span><span><i className="legend-swatch achieved" />Target achieved</span><span>○ No completed session</span></div>
    </section>
    <div className="statistics-toolbar">
      <label>Statistics for <select aria-label="Statistics for key" value={selectedKey} onChange={event => setSelectedKey(event.target.value)}>
        <option value="all">All keys</option>{[...KEYS].map(key => <option key={key} value={key}>{key.toUpperCase()}</option>)}
      </select></label>
      {selected && <button className="text-button" onClick={() => onConfigure(selectedKey)}>Configure {selectedKey.toUpperCase()} ↗</button>}
    </div>
    <div className="key-statistics">
      <div><span>Best speed</span><strong>{(selected?.bestWpm ?? profile.bestWpm).toFixed(1)} WPM</strong></div>
      <div><span>{selected ? 'Latest accuracy' : 'Latest session accuracy'}</span><strong>{(latest || history[0]) ? `${(latest || history[0]).accuracy.toFixed(1)}%` : '—'}</strong></div>
      <div><span>Practice today</span><strong>{(dailyMs / 60000).toFixed(1)} min{selected && <small> / {selected.targets.dailyGoal}</small>}</strong></div>
    </div>
    {selected && <p className="statistics-targets">{selected.mastered ? '✓ Key achieved' : 'Key in progress'} · Target {selected.targets.wpm} WPM / {selected.targets.accuracy}% accuracy</p>}
    <h3>{selected ? `${selectedKey.toUpperCase()} · Recent sessions` : 'Recent sessions across all keys'}</h3>
    {history.length ? <div className="history-list">{history.map((result, index) => <div key={`${result.date}-${index}`}>
      <span>{result.date}{result.key && ` · ${result.key.toUpperCase()}`}</span><strong>{result.wpm.toFixed(1)} WPM</strong><span>{result.accuracy.toFixed(1)}%</span><span>{result.correct} words</span>
    </div>)}</div> : <p className="dialog-intro">Complete a session to record speed and accuracy here. Daily practice time is saved as you type.</p>}
  </>;
}
