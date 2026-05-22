export interface DeepSeekRagSettings {
  apiKey: string;
  model: string;
  apiBaseUrl: string;
  chunkSize: number;
  overlapSize: number;
  topK: number;
  realtimeIndexing: boolean;
  includeContextByDefault: boolean;
}

export interface NoteChunk {
  id: string;
  filePath: string;
  content: string;
  startOffset: number;
  endOffset: number;
  headings: string[];
  tags: string[];
  modified: number;
}

export interface SearchResult {
  chunk: NoteChunk;
  score: number;
}

export interface PersistedIndex {
  version: number;
  chunks: NoteChunk[];
  updatedAt: number;
}

export const DEFAULT_SETTINGS: DeepSeekRagSettings = {
  apiKey: "",
  model: "deepseek-chat",
  apiBaseUrl: "https://api.deepseek.com",
  chunkSize: 900,
  overlapSize: 120,
  topK: 6,
  realtimeIndexing: true,
  includeContextByDefault: true,
};
