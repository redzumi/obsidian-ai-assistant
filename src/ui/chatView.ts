import { ItemView, MarkdownRenderer, Notice, setIcon, WorkspaceLeaf } from "obsidian";
import { AgentToolExecutor, SearchResult } from "../core/types";
import { DeepSeekClient } from "../services/deepseekClient";
import { HybridSearchEngine } from "../search/hybridSearch";

export const CHAT_VIEW_TYPE = "deepseek-rag-chat-view";

interface ChatMessage {
  role: "user" | "assistant";
  content: string;
  error?: boolean;
}

export class ChatView extends ItemView {
  private messages: ChatMessage[] = [];
  private includeContext: boolean;
  private agentMode: boolean;
  private lastSources: SearchResult[] = [];
  private isSending = false;

  constructor(
    leaf: WorkspaceLeaf,
    private readonly searchEngine: HybridSearchEngine,
    private readonly deepSeekClient: DeepSeekClient,
    private readonly agentTools: AgentToolExecutor,
    private readonly getTopK: () => number,
    includeContextByDefault: boolean,
    agentModeByDefault: boolean,
  ) {
    super(leaf);
    this.includeContext = includeContextByDefault;
    this.agentMode = agentModeByDefault;
  }

  getViewType(): string {
    return CHAT_VIEW_TYPE;
  }

  getDisplayText(): string {
    return "DeepSeek RAG";
  }

  getIcon(): string {
    return "message-square";
  }

  async onOpen(): Promise<void> {
    this.containerEl.addClass("deepseek-rag-view");
    this.render();
  }

  private render(): void {
    this.containerEl.empty();

    const toolbar = this.containerEl.createDiv({ cls: "deepseek-rag-toolbar" });
    const contextLabel = toolbar.createEl("label");
    const contextToggle = contextLabel.createEl("input", { type: "checkbox" });
    contextToggle.checked = this.includeContext;
    contextLabel.appendText(" Use note context");
    this.registerDomEvent(contextToggle, "change", () => {
      this.includeContext = contextToggle.checked;
    });

    const agentLabel = toolbar.createEl("label");
    const agentToggle = agentLabel.createEl("input", { type: "checkbox" });
    agentToggle.checked = this.agentMode;
    agentLabel.appendText(" Agent");
    this.registerDomEvent(agentToggle, "change", () => {
      this.agentMode = agentToggle.checked;
    });

    const clearButton = toolbar.createEl("button", { attr: { "aria-label": "Clear chat" } });
    setIcon(clearButton, "trash-2");
    this.registerDomEvent(clearButton, "click", () => {
      this.messages = [];
      this.lastSources = [];
      this.render();
    });

    const messagesEl = this.containerEl.createDiv({ cls: "deepseek-rag-messages" });
    if (this.messages.length === 0) {
      messagesEl.createEl("div", {
        cls: "setting-item-description",
        text: "Ask a question about your notes.",
      });
    }

    for (const message of this.messages) {
      void this.renderMessage(messagesEl, message);
    }

    if (this.lastSources.length > 0) {
      this.renderSources();
    }

    this.renderInput();
    messagesEl.scrollTop = messagesEl.scrollHeight;
  }

  private async renderMessage(parent: HTMLElement, message: ChatMessage): Promise<void> {
    const cls = [
      "deepseek-rag-message",
      message.role === "user" ? "deepseek-rag-message-user" : "deepseek-rag-message-assistant",
      message.error ? "deepseek-rag-message-error" : "",
    ]
      .filter(Boolean)
      .join(" ");
    const messageEl = parent.createDiv({ cls });

    if (message.role === "assistant" && !message.error) {
      await MarkdownRenderer.render(this.app, message.content, messageEl, "", this);
    } else {
      messageEl.setText(message.content);
    }
  }

  private renderSources(): void {
    const sourcesEl = this.containerEl.createDiv({ cls: "deepseek-rag-sources" });
    sourcesEl.createEl("div", { cls: "setting-item-name", text: "Sources" });

    for (const result of this.lastSources) {
      const sourceEl = sourcesEl.createDiv({ cls: "deepseek-rag-source" });
      const title = sourceEl.createDiv({ cls: "deepseek-rag-source-title" });
      title.setText(result.chunk.filePath);
      sourceEl.createDiv({
        cls: "deepseek-rag-source-snippet",
        text: result.chunk.content.slice(0, 280),
      });
    }
  }

  private renderInput(): void {
    const inputRow = this.containerEl.createDiv({ cls: "deepseek-rag-input-row" });
    const textarea = inputRow.createEl("textarea", {
      cls: "deepseek-rag-input",
      attr: {
        placeholder: "Message DeepSeek...",
      },
    });
    const sendButton = inputRow.createEl("button", { cls: "mod-cta", attr: { "aria-label": "Send" } });
    setIcon(sendButton, "send");
    sendButton.disabled = this.isSending;

    const send = () => {
      const value = textarea.value.trim();
      if (!value || this.isSending) {
        return;
      }
      void this.sendMessage(value);
    };

    this.registerDomEvent(sendButton, "click", send);
    this.registerDomEvent(textarea, "keydown", (event) => {
      if (event.key === "Enter" && !event.shiftKey) {
        event.preventDefault();
        send();
      }
    });
  }

  private async sendMessage(content: string): Promise<void> {
    const history = this.messages.map((message) => ({
      role: message.role,
      content: message.content,
    }));

    this.messages.push({ role: "user", content });
    this.isSending = true;
    this.render();

    try {
      let answer: string;
      if (this.agentMode) {
        const result = await this.deepSeekClient.completeWithAgent(content, history, this.agentTools);
        this.lastSources = result.sources;
        answer = result.answer;
      } else {
        this.lastSources = this.includeContext ? this.searchEngine.search(content, this.getTopK()) : [];
        answer = await this.deepSeekClient.complete(content, history, this.lastSources);
      }
      this.messages.push({ role: "assistant", content: answer });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      new Notice(message, 6000);
      this.messages.push({ role: "assistant", content: message, error: true });
    } finally {
      this.isSending = false;
      this.render();
    }
  }
}
