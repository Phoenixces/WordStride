export interface Word {
  word: string;
  part: string;
  meaning: string;
  example: string;
}

export type DictionaryResult =
  | { status: 'found'; entry: Word; sourceUrl?: string; license?: { name: string; url: string } }
  | { status: 'missing' | 'unavailable' };

