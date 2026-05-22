import { NoteChunk, SearchResult } from "../core/types";

const WORD_RE = /[\p{L}\p{N}_-]+/gu;

export class HybridSearchEngine {
  private chunks: NoteChunk[] = [];
  private documentFrequency = new Map<string, number>();

  setChunks(chunks: NoteChunk[]): void {
    this.chunks = chunks;
    this.rebuildDocumentFrequency();
  }

  search(query: string, topK: number): SearchResult[] {
    const queryTerms = tokenize(query);
    if (queryTerms.length === 0) {
      return [];
    }

    const querySet = new Set(queryTerms);
    const scored = this.chunks
      .map((chunk) => ({ chunk, score: this.scoreChunk(chunk, queryTerms, querySet) }))
      .filter((result) => result.score > 0)
      .sort((a, b) => b.score - a.score);

    return scored.slice(0, topK);
  }

  private rebuildDocumentFrequency(): void {
    this.documentFrequency.clear();

    for (const chunk of this.chunks) {
      const terms = new Set(tokenize(this.searchableText(chunk)));
      for (const term of terms) {
        this.documentFrequency.set(term, (this.documentFrequency.get(term) ?? 0) + 1);
      }
    }
  }

  private scoreChunk(chunk: NoteChunk, queryTerms: string[], querySet: Set<string>): number {
    const text = this.searchableText(chunk);
    const terms = tokenize(text);
    if (terms.length === 0) {
      return 0;
    }

    const counts = new Map<string, number>();
    for (const term of terms) {
      counts.set(term, (counts.get(term) ?? 0) + 1);
    }

    let score = 0;
    for (const term of querySet) {
      const tf = counts.get(term) ?? 0;
      if (tf === 0) {
        continue;
      }

      const df = this.documentFrequency.get(term) ?? 1;
      const idf = Math.log(1 + (this.chunks.length + 1) / df);
      score += (tf / Math.sqrt(terms.length)) * idf;
    }

    const lowerText = text.toLocaleLowerCase();
    const phrase = queryTerms.join(" ");
    if (phrase.length > 2 && lowerText.includes(phrase)) {
      score += 2;
    }

    return score;
  }

  private searchableText(chunk: NoteChunk): string {
    return `${chunk.filePath}\n${chunk.headings.join(" ")}\n${chunk.tags.join(" ")}\n${chunk.content}`;
  }
}

function tokenize(text: string): string[] {
  return Array.from(text.toLocaleLowerCase().matchAll(WORD_RE), (match) => match[0]).filter((word) => word.length > 1);
}
