import { Notice, TFile, Vault } from "obsidian";
import { SemanticChunker } from "../core/chunker";
import { IndexStore } from "../core/indexStore";

export async function indexAllMarkdownFiles(vault: Vault, chunker: SemanticChunker, indexStore: IndexStore): Promise<number> {
  const files = vault.getMarkdownFiles();
  const notice = new Notice(`DeepSeek RAG: indexing 0/${files.length} notes...`, 0);
  indexStore.clear();

  try {
    for (let index = 0; index < files.length; index += 1) {
      await indexFile(vault, chunker, indexStore, files[index]);

      const done = index + 1;
      if (done === files.length || done % 10 === 0) {
        notice.setMessage(`DeepSeek RAG: indexing ${done}/${files.length} notes...`);
      }
    }

    notice.setMessage(`DeepSeek RAG: indexed ${files.length} notes.`);
    window.setTimeout(() => notice.hide(), 3000);
    return files.length;
  } catch (error) {
    notice.hide();
    throw error;
  }
}

async function indexFile(vault: Vault, chunker: SemanticChunker, indexStore: IndexStore, file: TFile): Promise<void> {
  const content = await vault.read(file);
  const chunks = chunker.chunkDocument(content, file.path, file.stat.mtime);
  indexStore.replaceFile(file.path, chunks);
}
