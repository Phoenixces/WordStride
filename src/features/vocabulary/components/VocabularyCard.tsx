import type { DictionaryResult, Word } from '../model/types';
import { DefinitionAttribution } from './DefinitionAttribution';

interface VocabularyCardProps {
  word: Word | null;
  result?: DictionaryResult;
  correct: boolean;
}

export function VocabularyCard({ word, result, correct }: VocabularyCardProps) {
  const entry = result?.status === 'found' ? result.entry : word;

  return <section className={`vocabulary-card ${correct ? 'discovered' : ''}`} aria-label="Vocabulary" aria-live="polite" aria-atomic="true">
    <div className="vocabulary-word">
      <p className={`eyebrow ${correct ? 'cyan' : ''}`}>{word ? correct ? 'JUST DISCOVERED' : 'LAST CORRECT WORD' : 'YOUR NEXT DISCOVERY'}</p>
      <h2>{word?.word || 'Your next word'}</h2>
      <span className="word-part pink">{entry?.part || (word ? 'word' : 'type · learn · repeat')}</span>
    </div>
    <div className="vocabulary-meaning">
      <p className="definition">{word ? entry?.meaning || (result?.status === 'missing' ? 'This dictionary has no definition for this word.' : result?.status === 'unavailable' ? 'The dictionary is unavailable. You can keep typing.' : 'Looking up the meaning…') : 'Every correct word opens a little more of the world.'}</p>
      <p className="example">{word ? entry?.example ? `“${entry.example}”` : result?.status === 'found' ? 'No example sentence provided for this meaning.' : 'Examples appear when available from the dictionary.' : 'Finish a word and press Space to see its meaning and a sentence.'}</p>
      <p className="vocabulary-tip eyebrow">Correct word + Space reveals meaning and usage.</p>
      {result?.status === 'found' && <DefinitionAttribution result={result} />}
    </div>
  </section>;
}
