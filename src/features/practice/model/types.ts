import type { Word } from '@/features/vocabulary/model/types';

export interface Settings { duration: number; sound: boolean; keyboard: boolean }
export interface KeyTargets { wpm: number; accuracy: number; dailyGoal: number }
export interface Result { date: string; wpm: number; accuracy: number; correct: number; skipped: number; key?: string }
export interface KeyProgress { targets: KeyTargets; mastered: boolean; bestWpm: number; daily: Record<string, number>; history: Result[] }
export interface Profile {
  version: 2; selectedKey: string | null; keys: Record<string, KeyProgress>; bestWpm: number; score: number;
  daily: Record<string, number>; history: Result[]; settings: Settings;
}

export interface Session {
  words: Word[]; index: number; typed: string; status: 'idle' | 'running' | 'paused' | 'finished';
  elapsed: number; duration: number; attempts: number; hits: number; correctChars: number;
  focus: string; targets: KeyTargets; lastWord: Word | null;
  completed: { word: Word; typed: string; correct: boolean }[]; feedback: 'ready' | 'correct' | 'skipped';
  masteredKey: string | null; qualified: boolean;
}
export interface State { profile: Profile; session: Session }

export type Action =
  | { type: 'TYPE'; key: string; day: string }
  | { type: 'TICK'; delta: number; day: string }
  | { type: 'PAUSE' }
  | { type: 'RESUME' }
  | { type: 'RESTART'; words: Word[] }
  | { type: 'SETTINGS'; settings: Settings }
  | { type: 'KEY_SETTINGS'; key: string; targets: KeyTargets }
  | { type: 'SELECT_KEY'; key: string };
