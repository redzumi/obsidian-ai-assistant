import { EventRef, MetadataCache, TAbstractFile, TFile, Vault } from "obsidian";
import { SemanticChunker } from "../core/chunker";
import { IndexStore } from "../core/indexStore";
import { indexVaultFile } from "./indexAll";

type PersistCallback = () => Promise<void>;
type UpdateCallback = () => void;
type EventRegistrar = (eventRef: EventRef) => void;

export class RealtimeIndexer {
  private timers = new Map<string, number>();

  constructor(
    private readonly vault: Vault,
    private readonly metadataCache: MetadataCache,
    private readonly chunker: SemanticChunker,
    private readonly indexStore: IndexStore,
    private readonly persist: PersistCallback,
    private readonly onUpdate: UpdateCallback,
    private readonly registerEvent: EventRegistrar,
  ) {}

  start(): void {
    this.registerEvent(
      this.vault.on("create", (file) => {
        if (file instanceof TFile) {
          this.scheduleIndex(file);
        }
      }),
    );

    this.registerEvent(
      this.vault.on("modify", (file) => {
        if (file instanceof TFile) {
          this.scheduleIndex(file);
        }
      }),
    );

    this.registerEvent(
      this.vault.on("delete", (file) => {
        this.handleDelete(file);
      }),
    );

    this.registerEvent(
      this.vault.on("rename", (file, oldPath) => {
        this.indexStore.deleteFile(oldPath);
        if (file instanceof TFile) {
          this.scheduleIndex(file);
        }
        void this.persistAndNotify();
      }),
    );
  }

  stop(): void {
    for (const timerId of this.timers.values()) {
      window.clearTimeout(timerId);
    }
    this.timers.clear();
  }

  private scheduleIndex(file: TFile): void {
    const existing = this.timers.get(file.path);
    if (existing) {
      window.clearTimeout(existing);
    }

    const timerId = window.setTimeout(() => {
      this.timers.delete(file.path);
      void this.indexFile(file);
    }, 1200);
    this.timers.set(file.path, timerId);
  }

  private async indexFile(file: TFile): Promise<void> {
    await indexVaultFile(this.vault, this.metadataCache, this.chunker, this.indexStore, file);
    await this.persistAndNotify();
  }

  private handleDelete(file: TAbstractFile): void {
    if (!(file instanceof TFile)) {
      return;
    }

    this.indexStore.deleteFile(file.path);
    void this.persistAndNotify();
  }

  private async persistAndNotify(): Promise<void> {
    await this.persist();
    this.onUpdate();
  }
}
