import type { DictionaryResult } from '../model/types';

export function DefinitionAttribution({ result }: { result: Extract<DictionaryResult, { status: 'found' }> }) {
  return result.sourceUrl ? <p className="definition-attribution">
    <a href={result.sourceUrl} target="_blank" rel="noreferrer">Dictionary source ↗</a>
  </p> : null;
}
