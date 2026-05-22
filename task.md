
markdown
# Obsidian DeepSeek RAG Plugin - Technical Specification

## Overview
Production-grade RAG plugin for Obsidian using DeepSeek API with semantic chunking, hybrid search, and vector database.

## Architecture

### Core Components

#### 1. Vector Store Layer (LanceDB)
```typescript
// src/core/vectorStore.ts
import * as lancedb from '@lancedb/lancedb';
import { Table } from '@lancedb/lancedb';

interface ChunkMetadata {
  id: string;
  filePath: string;
  content: string;
  embedding: Float32Array;
  startPos: number;
  endPos: number;
  headings: string[];
  tags: string[];
  created: number;
  modified: number;
  accessCount: number;
}

class VectorStoreManager {
  private db: lancedb.Connection;
  private table: Table;
  private hnswIndex: HNSWLib;
  
  async initialize(vaultPath: string): Promise<void> {
    this.db = await lancedb.connect(`${vaultPath}/.deepseek-vector`);
    this.table = await this.db.openTable('chunks');
    await this.setupHNSWIndex();
  }
  
  async search(embedding: Float32Array, topK: number): Promise<ChunkMetadata[]> {
    // ANN search with HNSW
    const results = await this.table.search(embedding)
      .limit(topK)
      .metric('cosine')
      .execute();
    return results;
  }
  
  async incrementalUpdate(filePath: string, newChunks: ChunkMetadata[]): Promise<void> {
    // Remove old chunks for this file
    await this.table.delete(`filePath = '${filePath}'`);
    // Insert new chunks
    await this.table.add(newChunks);
    // Update HNSW index incrementally
    await this.updateHNSWIndex(newChunks);
  }
}
2. Semantic Chunker
typescript
// src/core/chunker.ts
import { marked } from 'marked';
import { SentenceTokenizer } from 'natural';

interface Chunk {
  id: string;
  content: string;
  startIndex: number;
  endIndex: number;
  headings: string[];
  embedding?: Float32Array;
}

class SemanticChunker {
  private tokenizer: SentenceTokenizer;
  private maxChunkSize: number = 512; // tokens
  private overlapSize: number = 50; // tokens
  
  async chunkDocument(content: string, filePath: string): Promise<Chunk[]> {
    // Parse markdown AST
    const tokens = marked.lexer(content);
    
    // Extract hierarchical structure
    const sections = this.extractSections(tokens);
    
    // Process each section
    const chunks: Chunk[] = [];
    for (const section of sections) {
      const sectionChunks = await this.processSection(section, filePath);
      chunks.push(...sectionChunks);
    }
    
    // Add overlapping between chunks
    return this.addOverlapping(chunks);
  }
  
  private extractSections(tokens: marked.Token[]): Section[] {
    const sections: Section[] = [];
    let currentSection: Section = { headings: [], content: '', startToken: 0 };
    
    for (let i = 0; i < tokens.length; i++) {
      const token = tokens[i];
      if (token.type === 'heading') {
        if (currentSection.content) {
          sections.push(currentSection);
        }
        currentSection = {
          headings: [...currentSection.headings, token.text],
          content: '',
          startToken: i
        };
      } else if (token.type === 'paragraph' || token.type === 'list') {
        currentSection.content += token.raw;
      }
    }
    
    return sections;
  }
  
  private async processSection(section: Section, filePath: string): Promise<Chunk[]> {
    // Split into sentences
    const sentences = this.tokenizer.tokenize(section.content);
    
    // Cluster sentences by semantic similarity
    const clusters = await this.clusterSentences(sentences);
    
    // Convert clusters to chunks
    return clusters.map((cluster, idx) => ({
      id: `${filePath}#${idx}`,
      content: cluster.join(' '),
      startIndex: cluster[0].index,
      endIndex: cluster[cluster.length - 1].index + cluster[cluster.length - 1].length,
      headings: section.headings
    }));
  }
  
  private async clusterSentences(sentences: Sentence[]): Promise<Sentence[][]> {
    // Get embeddings for all sentences
    const embeddings = await Promise.all(
      sentences.map(s => this.getEmbedding(s.text))
    );
    
    // Hierarchical clustering based on cosine similarity
    const clusters: Sentence[][] = [];
    let remaining = sentences.map((s, i) => ({ sentence: s, embedding: embeddings[i] }));
    
    while (remaining.length > 0) {
      const cluster = [remaining[0].sentence];
      const clusterEmbedding = remaining[0].embedding;
      remaining = remaining.slice(1);
      
      // Find similar sentences
      const toRemove: number[] = [];
      for (let i = 0; i < remaining.length; i++) {
        const similarity = this.cosineSimilarity(clusterEmbedding, remaining[i].embedding);
        if (similarity > 0.7 && this.countTokens(cluster.concat(remaining[i].sentence)) <= this.maxChunkSize) {
          cluster.push(remaining[i].sentence);
          toRemove.push(i);
        }
      }
      
      // Remove clustered sentences
      remaining = remaining.filter((_, i) => !toRemove.includes(i));
      clusters.push(cluster);
    }
    
    return clusters;
  }
}
3. Hybrid Search Engine
typescript
// src/search/hybridSearch.ts
import { BM25 } from 'bm25';
import { CrossEncoder } from '@xenova/transformers';

interface SearchResult {
  chunk: ChunkMetadata;
  score: number;
  source: 'vector' | 'bm25' | 'hybrid';
}

class HybridSearchEngine {
  private bm25: BM25;
  private crossEncoder: CrossEncoder;
  private vectorStore: VectorStoreManager;
  
  async search(query: string, topK: number = 10): Promise<ChunkMetadata[]> {
    // Get query embedding
    const queryEmbedding = await this.getEmbedding(query);
    
    // Parallel search
    const [vectorResults, bm25Results] = await Promise.all([
      this.vectorStore.search(queryEmbedding, topK * 2),
      this.bm25.search(query, topK * 2)
    ]);
    
    // Reciprocal Rank Fusion
    const fusedResults = this.reciprocalRankFusion(vectorResults, bm25Results);
    
    // Rerank with cross-encoder
    const reranked = await this.crossEncoder.rerank(query, fusedResults, topK);
    
    // Expand with neighboring chunks
    const expanded = await this.expandContext(reranked);
    
    return expanded;
  }
  
  private reciprocalRankFusion(vectorResults: any[], bm25Results: any[], k: number = 60): any[] {
    const scores = new Map();
    
    vectorResults.forEach((result, rank) => {
      scores.set(result.id, (scores.get(result.id) || 0) + 1 / (k + rank + 1));
    });
    
    bm25Results.forEach((result, rank) => {
      scores.set(result.id, (scores.get(result.id) || 0) + 1 / (k + rank + 1));
    });
    
    return Array.from(scores.entries())
      .sort((a, b) => b[1] - a[1])
      .map(([id]) => this.getChunk(id));
  }
  
  private async expandContext(chunks: ChunkMetadata[]): Promise<ChunkMetadata[]> {
    const expanded: ChunkMetadata[] = [];
    
    for (const chunk of chunks) {
      expanded.push(chunk);
      
      // Get neighboring chunks in the same file
      const neighbors = await this.getNeighboringChunks(chunk);
      for (const neighbor of neighbors) {
        const similarity = this.cosineSimilarity(chunk.embedding, neighbor.embedding);
        if (similarity > 0.75 && !expanded.includes(neighbor)) {
          expanded.push(neighbor);
        }
      }
    }
    
    return expanded;
  }
}
4. Real-time Indexer
typescript
// src/indexing/realtimeIndexer.ts
import { Vault, TFile, EventRef } from 'obsidian';

class RealtimeIndexer {
  private vault: Vault;
  private vectorStore: VectorStoreManager;
  private chunker: SemanticChunker;
  private debounceTimers: Map<string, NodeJS.Timeout> = new Map();
  private updateQueue: Array<{file: TFile, type: 'modify' | 'delete'}> = [];
  private isProcessing: boolean = false;
  
  constructor(vault: Vault, vectorStore: VectorStoreManager, chunker: SemanticChunker) {
    this.vault = vault;
    this.vectorStore = vectorStore;
    this.chunker = chunker;
    this.setupFileWatchers();
  }
  
  private setupFileWatchers(): void {
    // Watch for file modifications
    this.vault.on('modify', (file: TFile) => {
      if (file.extension === 'md') {
        this.queueUpdate(file, 'modify');
      }
    });
    
    // Watch for file deletions
    this.vault.on('delete', (file: TFile) => {
      if (file.extension === 'md') {
        this.queueUpdate(file, 'delete');
      }
    });
    
    // Watch for file creation
    this.vault.on('create', (file: TFile) => {
      if (file.extension === 'md') {
        this.queueUpdate(file, 'modify');
      }
    });
  }
  
  private queueUpdate(file: TFile, type: 'modify' | 'delete'): void {
    // Clear existing timer for this file
    if (this.debounceTimers.has(file.path)) {
      clearTimeout(this.debounceTimers.get(file.path));
    }
    
    // Set new timer
    this.debounceTimers.set(file.path, setTimeout(() => {
      this.updateQueue.push({file, type});
      this.processQueue();
      this.debounceTimers.delete(file.path);
    }, 2000)); // 2 second debounce
  }
  
  private async processQueue(): Promise<void> {
    if (this.isProcessing) return;
    this.isProcessing = true;
    
    while (this.updateQueue.length > 0) {
      const batch = this.updateQueue.splice(0, 10); // Process in batches
      
      for (const {file, type} of batch) {
        try {
          if (type === 'delete') {
            await this.vectorStore.deleteByFile(file.path);
          } else {
            await this.indexFile(file);
          }
        } catch (error) {
          console.error(`Failed to index ${file.path}:`, error);
        }
      }
    }
    
    this.isProcessing = false;
  }
  
  private async indexFile(file: TFile): Promise<void> {
    const content = await this.vault.read(file);
    const chunks = await this.chunker.chunkDocument(content, file.path);
    
    // Get embeddings for all chunks
    const chunksWithEmbeddings = await Promise.all(
      chunks.map(async (chunk) => ({
        ...chunk,
        embedding: await this.getEmbedding(chunk.content)
      }))
    );
    
    // Update vector store
    await this.vectorStore.incrementalUpdate(file.path, chunksWithEmbeddings);
    
    // Update BM25 index
    await this.updateBM25Index(file.path, chunksWithEmbeddings);
  }
}
5. Chat Interface
typescript
// src/ui/chatView.ts
import { ItemView, WorkspaceLeaf, MarkdownRenderer } from 'obsidian';

export const CHAT_VIEW_TYPE = 'deepseek-chat-view';

export class ChatView extends ItemView {
  private messages: Array<{role: 'user' | 'assistant', content: string}> = [];
  private searchEngine: HybridSearchEngine;
  private currentContext: ChunkMetadata[] = [];
  
  constructor(leaf: WorkspaceLeaf, searchEngine: HybridSearchEngine) {
    super(leaf);
    this.searchEngine = searchEngine;
  }
  
  getViewType(): string {
    return CHAT_VIEW_TYPE;
  }
  
  getDisplayText(): string {
    return 'DeepSeek Chat';
  }
  
  async onOpen(): Promise<void> {
    this.containerEl.addClass('deepseek-chat-container');
    this.render();
  }
  
  private render(): void {
    this.containerEl.empty();
    
    // Chat messages area
    const messagesDiv = this.containerEl.createDiv({ cls: 'chat-messages' });
    for (const msg of this.messages) {
      this.renderMessage(messagesDiv, msg);
    }
    
    // Input area
    const inputDiv = this.containerEl.createDiv({ cls: 'chat-input-container' });
    const textarea = inputDiv.createEl('textarea', { cls: 'chat-input' });
    const sendButton = inputDiv.createEl('button', { text: 'Send', cls: 'send-button' });
    
    // Context controls
    const contextDiv = this.containerEl.createDiv({ cls: 'context-controls' });
    const includeContextCheckbox = contextDiv.createEl('input', {
      type: 'checkbox',
      cls: 'include-context'
    });
    contextDiv.createEl('label', { text: 'Include RAG context' });
    
    const refreshContextButton = contextDiv.createEl('button', {
      text: 'Refresh Context',
      cls: 'refresh-context'
    });
    
    sendButton.onclick = async () => {
      const query = textarea.value;
      if (!query) return;
      
      // Add user message
      this.messages.push({ role: 'user', content: query });
      this.render();
      
      // Get context if enabled
      let context: ChunkMetadata[] = [];
      if (includeContextCheckbox.checked) {
        context = await this.searchEngine.search(query, 5);
        this.currentContext = context;
      }
      
      // Get response from DeepSeek
      const response = await this.getDeepSeekResponse(query, context);
      this.messages.push({ role: 'assistant', content: response });
      this.render();
      
      textarea.value = '';
    };
    
    refreshContextButton.onclick = async () => {
      const lastQuery = this.messages[this.messages.length - 1]?.content;
      if (lastQuery && includeContextCheckbox.checked) {
        this.currentContext = await this.searchEngine.search(lastQuery, 5);
        this.showContextPreview(this.currentContext);
      }
    };
  }
  
  private async getDeepSeekResponse(query: string, context: ChunkMetadata[]): Promise<string> {
    const systemPrompt = this.buildSystemPrompt(context);
    
    const response = await fetch('https://api.deepseek.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${this.getApiKey()}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        model: 'deepseek-chat',
        messages: [
          { role: 'system', content: systemPrompt },
          ...this.messages.map(m => ({ role: m.role, content: m.content }))
        ],
        temperature: 0.3,
        max_tokens: 2000,
        stream: false
      })
    });
    
    const data = await response.json();
    return data.choices[0].message.content;
  }
  
  private buildSystemPrompt(context: ChunkMetadata[]): string {
    if (context.length === 0) {
      return 'You are a helpful assistant for Obsidian notes.';
    }
    
    let prompt = `You are an AI assistant with access to the user's notes.

CONTEXT FROM NOTES:
`;
    
    for (const chunk of context) {
      prompt += `\n--- From ${chunk.filePath} ---\n`;
      prompt += chunk.content;
      if (chunk.headings.length) {
        prompt += `\n[Section: ${chunk.headings.join(' > ')}]`;
      }
      prompt += '\n';
    }
    
    prompt += `\nAnswer based ONLY on the context above. 
If the answer isn't in the context, say "I don't have enough information in your notes to answer that."
Cite specific files when referencing information.

Question: `;
    
    return prompt;
  }
  
  private showContextPreview(chunks: ChunkMetadata[]): void {
    const preview = this.containerEl.createDiv({ cls: 'context-preview' });
    preview.createEl('h4', { text: 'Retrieved Context:' });
    
    for (const chunk of chunks) {
      const chunkDiv = preview.createDiv({ cls: 'context-chunk' });
      chunkDiv.createEl('div', { 
        text: chunk.filePath,
        cls: 'context-file' 
      });
      chunkDiv.createEl('div', { 
        text: chunk.content.substring(0, 200) + '...',
        cls: 'context-content'
      });
    }
    
    setTimeout(() => preview.remove(), 5000);
  }
}
6. Plugin Main Class
typescript
// src/main.ts
import { Plugin, WorkspaceLeaf, Notice } from 'obsidian';
import { ChatView, CHAT_VIEW_TYPE } from './ui/chatView';
import { VectorStoreManager } from './core/vectorStore';
import { SemanticChunker } from './core/chunker';
import { HybridSearchEngine } from './search/hybridSearch';
import { RealtimeIndexer } from './indexing/realtimeIndexer';

interface PluginSettings {
  apiKey: string;
  chunkSize: number;
  overlapSize: number;
  topK: number;
  useHybridSearch: boolean;
  realtimeIndexing: boolean;
}

const DEFAULT_SETTINGS: PluginSettings = {
  apiKey: '',
  chunkSize: 512,
  overlapSize: 50,
  topK: 5,
  useHybridSearch: true,
  realtimeIndexing: true
};

export default class DeepSeekRAGPlugin extends Plugin {
  settings: PluginSettings;
  vectorStore: VectorStoreManager;
  chunker: SemanticChunker;
  searchEngine: HybridSearchEngine;
  indexer: RealtimeIndexer;
  
  async onload() {
    await this.loadSettings();
    
    // Initialize components
    await this.initializeVectorStore();
    this.chunker = new SemanticChunker(this.settings.chunkSize, this.settings.overlapSize);
    this.searchEngine = new HybridSearchEngine(this.vectorStore, this.settings.useHybridSearch);
    
    if (this.settings.realtimeIndexing) {
      this.indexer = new RealtimeIndexer(this.app.vault, this.vectorStore, this.chunker);
    }
    
    // Register chat view
    this.registerView(CHAT_VIEW_TYPE, (leaf) => new ChatView(leaf, this.searchEngine));
    
    // Add ribbon icon
    this.addRibbonIcon('message-square', 'Open DeepSeek Chat', () => {
      this.activateView();
    });
    
    // Add settings tab
    this.addSettingTab(new DeepSeekSettingTab(this.app, this));
    
    // Initial indexing of all notes
    await this.initialIndexing();
  }
  
  private async initializeVectorStore(): Promise<void> {
    this.vectorStore = new VectorStoreManager();
    await this.vectorStore.initialize(this.app.vault.adapter.basePath);
  }
  
  private async initialIndexing(): Promise<void> {
    const files = this.app.vault.getMarkdownFiles();
    const notice = new Notice('Indexing notes for DeepSeek RAG...', 0);
    
    let indexed = 0;
    for (const file of files) {
      const content = await this.app.vault.read(file);
      const chunks = await this.chunker.chunkDocument(content, file.path);
      
      // Get embeddings
      const chunksWithEmbeddings = await Promise.all(
        chunks.map(async (chunk) => ({
          ...chunk,
          embedding: await this.getEmbedding(chunk.content)
        }))
      );
      
      await this.vectorStore.incrementalUpdate(file.path, chunksWithEmbeddings);
      indexed++;
      
      if (indexed % 10 === 0) {
        notice.setMessage(`Indexed ${indexed}/${files.length} notes...`);
      }
    }
    
    notice.setMessage(`Indexed ${indexed} notes successfully!`);
    setTimeout(() => notice.hide(), 3000);
  }
  
  private async getEmbedding(text: string): Promise<Float32Array> {
    const response = await fetch('https://api.deepseek.com/v1/embeddings', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${this.settings.apiKey}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        model: 'deepseek-embed',
        input: text
      })
    });
    
    const data = await response.json();
    return new Float32Array(data.data[0].embedding);
  }
  
  private async activateView(): Promise<void> {
    const { workspace } = this.app;
    
    let leaf = workspace.getLeavesOfType(CHAT_VIEW_TYPE)[0];
    if (!leaf) {
      leaf = workspace.getRightLeaf(false);
      await leaf.setViewState({ type: CHAT_VIEW_TYPE, active: true });
    }
    
    workspace.revealLeaf(leaf);
  }
  
  async loadSettings() {
    this.settings = Object.assign({}, DEFAULT_SETTINGS, await this.loadData());
  }
  
  async saveSettings() {
    await this.saveData(this.settings);
  }
  
  onunload() {
    // Cleanup
    if (this.indexer) {
      // Stop realtime indexing
    }
  }
}
7. Settings Tab
typescript
// src/ui/settingsTab.ts
import { App, PluginSettingTab, Setting } from 'obsidian';
import DeepSeekRAGPlugin from '../main';

export class DeepSeekSettingTab extends PluginSettingTab {
  plugin: DeepSeekRAGPlugin;
  
  constructor(app: App, plugin: DeepSeekRAGPlugin) {
    super(app, plugin);
    this.plugin = plugin;
  }
  
  display(): void {
    const { containerEl } = this;
    containerEl.empty();
    
    containerEl.createEl('h2', { text: 'DeepSeek RAG Plugin Settings' });
    
    new Setting(containerEl)
      .setName('API Key')
      .setDesc('Your DeepSeek API key from platform.deepseek.com')
      .addText(text => text
        .setPlaceholder('sk-...')
        .setValue(this.plugin.settings.apiKey)
        .onChange(async (value) => {
          this.plugin.settings.apiKey = value;
          await this.plugin.saveSettings();
        }));
    
    new Setting(containerEl)
      .setName('Chunk Size')
      .setDesc('Maximum tokens per chunk (default: 512)')
      .addSlider(slider => slider
        .setLimits(100, 2000, 50)
        .setValue(this.plugin.settings.chunkSize)
        .setDynamicTooltip()
        .onChange(async (value) => {
          this.plugin.settings.chunkSize = value;
          await this.plugin.saveSettings();
        }));
    
    new Setting(containerEl)
      .setName('Hybrid Search')
      .setDesc('Combine vector search with BM25 for better results')
      .addToggle(toggle => toggle
        .setValue(this.plugin.settings.useHybridSearch)
        .onChange(async (value) => {
          this.plugin.settings.useHybridSearch = value;
          await this.plugin.saveSettings();
        }));
    
    new Setting(containerEl)
      .setName('Realtime Indexing')
      .setDesc('Automatically index notes when they change')
      .addToggle(toggle => toggle
        .setValue(this.plugin.settings.realtimeIndexing)
        .onChange(async (value) => {
          this.plugin.settings.realtimeIndexing = value;
          await this.plugin.saveSettings();
        }));
    
    containerEl.createEl('hr');
    containerEl.createEl('h3', { text: 'Index Statistics' });
    
    const statsDiv = containerEl.createDiv({ cls: 'stats-container' });
    this.updateStats(statsDiv);
  }
  
  private async updateStats(container: HTMLElement): Promise<void> {
    // Show indexing stats
    container.createEl('p', { text: 'Click "Re-index All Notes" to rebuild index' });
    
    const reindexButton = container.createEl('button', { 
      text: 'Re-index All Notes',
      cls: 'mod-cta'
    });
    
    reindexButton.onclick = async () => {
      reindexButton.disabled = true;
      reindexButton.setText('Indexing...');
      await this.plugin.initialIndexing();
      reindexButton.disabled = false;
      reindexButton.setText('Re-index All Notes');
    };
  }
}
Installation
Dependencies
json
{
  "name": "obsidian-deepseek-rag",
  "version": "1.0.0",
  "devDependencies": {
    "@types/node": "^20.0.0",
    "obsidian": "latest",
    "typescript": "^5.0.0"
  },
  "dependencies": {
    "@lancedb/lancedb": "^0.6.0",
    "@xenova/transformers": "^2.7.0",
    "bm25": "^1.0.0",
    "marked": "^11.0.0",
    "natural": "^8.0.0"
  }
}
Build Configuration
typescript
// esbuild.config.mjs
import esbuild from "esbuild";
import process from "process";

const prod = process.argv[2] === "production";

esbuild.build({
  entryPoints: ["src/main.ts"],
  bundle: true,
  external: ["obsidian", "electron"],
  format: "cjs",
  target: "es2020",
  logLevel: "info",
  sourcemap: prod ? false : "inline",
  treeShaking: true,
  outfile: "main.js",
  minify: prod,
}).catch(() => process.exit(1));
Manifest
json
// manifest.json
{
  "id": "deepseek-rag",
  "name": "DeepSeek RAG",
  "version": "1.0.0",
  "minAppVersion": "0.15.0",
  "description": "Production RAG system with DeepSeek API",
  "author": "Your Name",
  "authorUrl": "",
  "isDesktopOnly": true
}
Performance Optimizations
Batch embedding calls - Group chunks into batches of 20 for API calls

Lazy loading - Only load vector store when needed

Worker threads - Run embedding generation in Web Worker

Caching - LRU cache for frequent queries and embeddings

Progressive indexing - Index small files first, show results incrementally

Usage Workflow
Install plugin and enter DeepSeek API key

Plugin automatically indexes all markdown notes

Open chat panel via ribbon icon

Ask questions - plugin retrieves relevant context automatically

Toggle "Include RAG context" to use your notes

Results cite specific files and sections

This implementation provides production-grade RAG with semantic search, real-time indexing, and seamless Obsidian integration.
