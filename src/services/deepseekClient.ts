import { DeepSeekRagSettings, SearchResult } from "../core/types";

interface ChatMessage {
  role: "system" | "user" | "assistant";
  content: string;
}

export class DeepSeekClient {
  constructor(private readonly getSettings: () => DeepSeekRagSettings) {}

  async complete(userMessage: string, history: ChatMessage[], context: SearchResult[]): Promise<string> {
    const settings = this.getSettings();
    if (!settings.apiKey.trim()) {
      throw new Error("DeepSeek API key is not configured.");
    }

    const response = await fetch(`${settings.apiBaseUrl.replace(/\/$/, "")}/v1/chat/completions`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${settings.apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: settings.model,
        messages: [
          { role: "system", content: this.buildSystemPrompt(context) },
          ...history.slice(-12),
          { role: "user", content: userMessage },
        ],
        temperature: 0.2,
        max_tokens: 1800,
        stream: false,
      }),
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`DeepSeek request failed (${response.status}): ${errorText}`);
    }

    const data = await response.json();
    const content = data?.choices?.[0]?.message?.content;
    if (typeof content !== "string") {
      throw new Error("DeepSeek returned an unexpected response.");
    }

    return content.trim();
  }

  private buildSystemPrompt(context: SearchResult[]): string {
    if (context.length === 0) {
      return "You are a helpful assistant inside Obsidian. Answer plainly and say when the notes do not provide enough context.";
    }

    const sources = context
      .map((result, index) => {
        const chunk = result.chunk;
        const heading = chunk.headings.length ? `\nSection: ${chunk.headings.join(" > ")}` : "";
        return `[${index + 1}] ${chunk.filePath}${heading}\n${chunk.content}`;
      })
      .join("\n\n---\n\n");

    return [
      "You are a helpful assistant inside Obsidian.",
      "Use the note context below when it is relevant.",
      "Cite file paths when using note content.",
      "If the answer is not supported by the notes, say so clearly.",
      "",
      "NOTE CONTEXT:",
      sources,
    ].join("\n");
  }
}
