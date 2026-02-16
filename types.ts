
export enum Difficulty {
  BEGINNER = 'Beginner',
  ELEMENTARY = 'Elementary',
  INTERMEDIATE = 'Intermediate',
  ADVANCED = 'Advanced'
}

export interface VocabularyWord {
  word: string;
  meaning: string;
}

export interface MCQQuestion {
  question: string;
  options: string[];
  correctIndex: number;
}

export interface TrueFalseQuestion {
  statement: string;
  isTrue: boolean;
}

export interface PassageData {
  title: string;
  arabicContent: string;
  englishTranslation: string;
  vocabulary: VocabularyWord[];
  mcqs: MCQQuestion[];
  trueFalse: TrueFalseQuestion[];
}

export interface ProgressRecord {
  id: string;
  date: number;
  topic: string;
  difficulty: Difficulty;
  score: number;
  total: number;
  title: string;
}

export interface UserProfile {
  email: string;
  history: ProgressRecord[];
}

export interface UserAnswers {
  mcqs: number[];
  trueFalse: boolean[];
  vocabulary: string[];
}