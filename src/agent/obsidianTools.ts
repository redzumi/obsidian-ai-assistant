import { App, TFile, TFolder } from "obsidian";
import { AgentToolExecution } from "../core/types";
import { IndexStore } from "../core/indexStore";
import { HybridSearchEngine } from "../search/hybridSearch";

const READABLE_EXTENSIONS = new Set(["md", "txt", "csv", "json", "canvas"]);

export class ObsidianAgentTools {
  constructor(
    private readonly app: App,
    private readonly indexStore: IndexStore,
    private readonly searchEngine: HybridSearchEngine,
    private readonly getTopK: () => number,
  ) {}

  async execute(toolName: string, args: Record<string, unknown>): Promise<AgentToolExecution> {
    switch (toolName) {
      case "searchNotes":
        return this.searchNotes(args);
      case "openNote":
        return this.openNote(args);
      case "listFolder":
        return this.listFolder(args);
      case "getLinks":
        return this.getLinks(args);
      case "getVaultOverview":
        return { content: this.indexStore.getVaultOverview(40) };
      default:
        return {
          content: `Unknown tool: ${toolName}. Available tools: searchNotes, openNote, listFolder, getLinks, getVaultOverview.`,
        };
    }
  }

  private searchNotes(args: Record<string, unknown>): AgentToolExecution {
    const query = getStringArg(args, "query");
    const topK = getNumberArg(args, "topK") ?? this.getTopK();
    if (!query) {
      return { content: "Missing required argument: query." };
    }

    const sources = this.searchEngine.search(query, Math.max(1, Math.min(20, topK)));
    if (sources.length === 0) {
      return { content: `No indexed chunks matched query: ${query}` };
    }

    return {
      sources,
      content: sources
        .map((result, index) => {
          const chunk = result.chunk;
          const heading = chunk.headings.length ? `\nSection: ${chunk.headings.join(" > ")}` : "";
          return `[${index + 1}] ${chunk.filePath}${heading}\nScore: ${result.score.toFixed(3)}\n${clip(chunk.content, 1200)}`;
        })
        .join("\n\n---\n\n"),
    };
  }

  private async openNote(args: Record<string, unknown>): Promise<AgentToolExecution> {
    const path = getStringArg(args, "path");
    const maxChars = getNumberArg(args, "maxChars") ?? 6000;
    if (!path) {
      return { content: "Missing required argument: path." };
    }

    const file = this.app.vault.getAbstractFileByPath(path);
    if (!(file instanceof TFile)) {
      return { content: `File not found: ${path}` };
    }

    const document = this.indexStore.getAllDocuments().find((item) => item.path === file.path);
    const metadata = document
      ? [
          `Path: ${document.path}`,
          `Extension: .${document.extension}`,
          `Status: ${document.status}`,
          document.tags.length ? `Tags: ${document.tags.join(", ")}` : "",
          document.aliases.length ? `Aliases: ${document.aliases.join(", ")}` : "",
          document.links.length ? `Links: ${document.links.join(", ")}` : "",
          document.headings.length ? `Headings: ${document.headings.join(" > ")}` : "",
        ]
          .filter(Boolean)
          .join("\n")
      : `Path: ${file.path}\nExtension: .${file.extension}`;

    if (!READABLE_EXTENSIONS.has(file.extension)) {
      return { content: `${metadata}\n\nThis file is tracked as metadata-only and is not readable as text.` };
    }

    const content = await this.app.vault.cachedRead(file);
    return { content: `${metadata}\n\nCONTENT:\n${clip(content, Math.max(1000, Math.min(20000, maxChars)))}` };
  }

  private listFolder(args: Record<string, unknown>): AgentToolExecution {
    const path = getStringArg(args, "path") ?? "";
    const folder = path ? this.app.vault.getAbstractFileByPath(path) : this.app.vault.getRoot();
    if (!(folder instanceof TFolder)) {
      return { content: `Folder not found: ${path}` };
    }

    const children = folder.children
      .slice()
      .sort((a, b) => a.path.localeCompare(b.path))
      .slice(0, 120)
      .map((child) => {
        if (child instanceof TFolder) {
          return `- [folder] ${child.path}`;
        }
        if (child instanceof TFile) {
          return `- [file] ${child.path} (${child.stat.size} bytes)`;
        }
        return `- ${child.path}`;
      });

    return { content: children.length ? children.join("\n") : `Folder is empty: ${folder.path || "/"}` };
  }

  private getLinks(args: Record<string, unknown>): AgentToolExecution {
    const path = getStringArg(args, "path");
    if (!path) {
      return { content: "Missing required argument: path." };
    }

    const file = this.app.vault.getAbstractFileByPath(path);
    if (!(file instanceof TFile)) {
      return { content: `File not found: ${path}` };
    }

    const cache = this.app.metadataCache.getFileCache(file);
    const outgoing = [
      ...(cache?.links ?? []).map((link) => link.link),
      ...(cache?.embeds ?? []).map((embed) => embed.link),
    ];
    const resolvedLinks = this.app.metadataCache.resolvedLinks;
    const backlinks = Object.entries(resolvedLinks)
      .filter(([, targets]) => Object.prototype.hasOwnProperty.call(targets, file.path))
      .map(([sourcePath]) => sourcePath);

    return {
      content: [
        `Links for ${file.path}`,
        "",
        "Outgoing:",
        unique(outgoing).map((link) => `- ${link}`).join("\n") || "None",
        "",
        "Backlinks:",
        unique(backlinks).map((link) => `- ${link}`).join("\n") || "None",
      ].join("\n"),
    };
  }
}

function getStringArg(args: Record<string, unknown>, name: string): string | undefined {
  const value = args[name];
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function getNumberArg(args: Record<string, unknown>, name: string): number | undefined {
  const value = args[name];
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

function clip(content: string, maxChars: number): string {
  return content.length <= maxChars ? content : `${content.slice(0, maxChars)}\n\n[truncated]`;
}

function unique(values: string[]): string[] {
  return Array.from(new Set(values.map((value) => value.trim()).filter(Boolean)));
}
