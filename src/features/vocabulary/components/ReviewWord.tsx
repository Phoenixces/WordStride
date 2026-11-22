import type { DictionaryResult, Word } from '../model/types';
import { DefinitionAttribution } from './DefinitionAttribution';

export function ReviewWord({ word, result }: { word: Word; result?: DictionaryResult }) {
  const entry = result?.status === 'found' ? result.entry : word;
  return <article><strong>{word.word}</strong><span className="pink">{entry.part}</span>
    <p>{entry.meaning || (!result ? 'Looking up the meaning…' : result.status === 'missing' ? 'This dictionary has no definition for this word.' : 'The dictionary is unavailable. You can keep typing.')}</p>
    <p className="muted">{entry.example ? `“${entry.example}”` : !result && !entry.meaning ? 'Example lookup in progress…' : 'No example sentence available.'}</p>
    {result?.status === 'found' && <DefinitionAttribution result={result} />}
  </article>;
}

