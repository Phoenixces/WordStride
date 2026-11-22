const rows = [['Tab', ...'QWERTYUIOP', '⌫'], ['Caps', ...'ASDFGHJKL', 'Enter'], ['Shift', ...'ZXCVBNM', 'Shift']];
export function Keycap({ label, mastered = false, active = false, small = false, pressed = false, onClick }: {
  label: string; mastered?: boolean; active?: boolean; small?: boolean; pressed?: boolean; onClick?: () => void;
}) {
  const isLetter = /^[A-Z]$/.test(label);
  const state = active ? 'active' : isLetter ? mastered ? 'learned' : 'locked' : '';
  const className = `keycap ${state} ${small ? 'small' : ''} ${label.length > 1 ? 'wide' : ''} ${pressed ? 'pressed' : ''} ${onClick ? 'key-choice' : ''}`;
  const title = isLetter ? `${label}: ${mastered ? 'target achieved' : 'not yet achieved'}${active ? ' · current key' : ''}` : undefined;
  const contents = <><span className={label === 'F' || label === 'J' ? 'home-key' : ''}>{label}</span>{mastered && small && <span className="key-check" aria-hidden="true">✓</span>}</>;
  return onClick ? <button type="button" className={className} title={title} onClick={onClick} aria-label={`Practise ${label}${mastered ? ', target achieved' : ', not yet achieved'}`} aria-pressed={active} data-key={label.toLowerCase()} data-mastered={mastered}>{contents}</button>
    : <span className={className} title={title}>{contents}</span>;
}
function fingerFor(key: string) {
  if ('QAZ'.includes(key)) return 'LEFT LITTLE FINGER';
  if ('WSX'.includes(key)) return 'LEFT RING FINGER';
  if ('EDC'.includes(key)) return 'LEFT MIDDLE FINGER';
  if ('RFVTGB'.includes(key)) return 'LEFT INDEX FINGER';
  if ('YHNUJM'.includes(key)) return 'RIGHT INDEX FINGER';
  if ('IK'.includes(key)) return 'RIGHT MIDDLE FINGER';
  if ('OL'.includes(key)) return 'RIGHT RING FINGER';
  return 'RIGHT LITTLE FINGER';
}
export function Keyboard({ selectedKey, mastered, pressed, complete }: { selectedKey: string | null; mastered: string[]; pressed: string; complete: boolean }) {
  const focus = selectedKey?.toUpperCase() || '';
  return <section className="keyboard-guide" aria-label="Keyboard guide">
    <div className="keyboard-heading eyebrow"><span>KEYBOARD GUIDE</span><span className={focus ? 'pink' : ''}>{focus ? `${focus} · ${fingerFor(focus)}` : 'CHOOSE A KEY ABOVE'}</span></div>
    <div className="keyboard-rows" aria-hidden="true">{rows.map((row, i) => <div className="keyboard-row" key={i}>{row.map((key, j) =>
      <Keycap key={`${key}-${j}`} label={key} mastered={mastered.includes(key.toLowerCase())} active={key === focus} pressed={pressed.toUpperCase() === key || (pressed === 'Backspace' && key === '⌫')} />)}</div>)}
      <div className={`spacebar keycap ${complete ? 'active' : ''} ${pressed === ' ' ? 'pressed' : ''}`}>space <span>/</span> next word</div>
    </div>
    <div className="legend eyebrow"><span className="cyan">✓ Achieved</span><span className="pink">● Current key</span><span>○ Practise any key</span></div>
  </section>;
}
