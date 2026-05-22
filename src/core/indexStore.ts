import { PersistedIndex, NoteChunk } from "./types";

const INDEX_VERSION = 1;

export class IndexStore {
  private chunks: NoteChunk[] = [];

  load(index: PersistedIndex | undefined): NoteChunk[] {
    this.chunks = index?.version === INDEX_VERSION ? index.chunks : [];
    return this.getAllChunks();
  }

  getAllChunks(): NoteChunk[] {
    return [...this.chunks];
  }

  replaceFile(filePath: string, chunks: NoteChunk[]): void {
    this.chunks = this.chunks.filter((chunk) => chunk.filePath !== filePath).concat(chunks);
  }

  deleteFile(filePath: string): void {
    this.chunks = this.chunks.filter((chunk) => chunk.filePath !== filePath);
  }

  clear(): void {
    this.chunks = [];
  }

  toPersistedIndex(): PersistedIndex {
    return {
      version: INDEX_VERSION,
      chunks: this.getAllChunks(),
      updatedAt: Date.now(),
    };
  }
}
