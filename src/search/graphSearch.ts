import { MetadataCache, TFile, Vault } from "obsidian";
import { IndexedChunk, SearchResult } from "../core/types";
import { HybridSearchEngine } from "./hybridSearch";

export class GraphSearchEngine {
  constructor(
    private readonly vault: Vault,
    private readonly metadataCache: MetadataCache,
    private readonly baseSearch: HybridSearchEngine,
  ) {}

  search(query: string, topK: number): SearchResult[] {
    const baseResults = this.baseSearch.search(query, Math.max(topK, Math.ceil(topK * 1.5)));
    return this.expandResults(baseResults, topK);
  }

  private expandResults(baseResults: SearchResult[], topK: number): SearchResult[] {
    const allChunks = this.baseSearch.getChunks();
    const chunksByPath = groupChunksByPath(allChunks);
    const results = new Map<string, SearchResult>();

    const addResult = (chunk: IndexedChunk, score: number) => {
      const existing = results.get(chunk.id);
      if (!existing || score > existing.score) {
        results.set(chunk.id, { chunk, score });
      }
    };

    for (const result of baseResults) {
      addResult(result.chunk, result.score);

      for (const neighbor of getNeighborChunks(chunksByPath.get(result.chunk.filePath) ?? [], result.chunk)) {
        addResult(neighbor, result.score * 0.72);
      }

      const linkedPaths = this.getLinkedPaths(result.chunk.filePath);
      for (const linkedPath of linkedPaths.slice(0, 8)) {
        const linkedChunks = chunksByPath.get(linkedPath) ?? [];
        for (const linkedChunk of linkedChunks.slice(0, 2)) {
          addResult(linkedChunk, result.score * 0.48);
        }
      }
    }

    return Array.from(results.values())
      .sort((a, b) => b.score - a.score)
      .slice(0, Math.max(topK, baseResults.length));
  }

  private getLinkedPaths(filePath: string): string[] {
    const file = this.vault.getAbstractFileByPath(filePath);
    if (!(file instanceof TFile)) {
      return [];
    }

    const outgoing = Object.keys(this.metadataCache.resolvedLinks[file.path] ?? {});
    const backlinks = Object.entries(this.metadataCache.resolvedLinks)
      .filter(([, targets]) => Object.prototype.hasOwnProperty.call(targets, file.path))
      .map(([sourcePath]) => sourcePath);

    return unique([...outgoing, ...backlinks]);
  }
}

function groupChunksByPath(chunks: IndexedChunk[]): Map<string, IndexedChunk[]> {
  const grouped = new Map<string, IndexedChunk[]>();
  for (const chunk of chunks) {
    const fileChunks = grouped.get(chunk.filePath) ?? [];
    fileChunks.push(chunk);
    grouped.set(chunk.filePath, fileChunks);
  }

  for (const fileChunks of grouped.values()) {
    fileChunks.sort((a, b) => a.startOffset - b.startOffset);
  }

  return grouped;
}

function getNeighborChunks(fileChunks: IndexedChunk[], chunk: IndexedChunk): IndexedChunk[] {
  const index = fileChunks.findIndex((candidate) => candidate.id === chunk.id);
  if (index === -1) {
    return [];
  }

  return [fileChunks[index - 1], fileChunks[index + 1]].filter((candidate): candidate is IndexedChunk => Boolean(candidate));
}

function unique(values: string[]): string[] {
  return Array.from(new Set(values.map((value) => value.trim()).filter(Boolean)));
}
