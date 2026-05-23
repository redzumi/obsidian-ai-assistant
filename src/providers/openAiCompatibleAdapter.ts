import { McpToolDefinition, ObsidianAIAssistantSettings } from "../core/types";
import { ChatProviderAdapter, ProviderAssistantMessage, ProviderMessage, ProviderRequest } from "./types";

export class OpenAiCompatibleAdapter implements ChatProviderAdapter {
  readonly name = "openai-compatible";

  createRequest(settings: ObsidianAIAssistantSettings, messages: ProviderMessage[], tools: McpToolDefinition[], maxTokens: number): ProviderRequest {
    const url = `${settings.apiBaseUrl.replace(/\/$/, "")}/v1/chat/completions`;
    return {
      url,
      body: {
        model: settings.model,
        messages: messages.map(toOpenAiMessage),
        tools: tools.map(toOpenAiTool),
        tool_choice: "auto",
        temperature: 0.2,
        max_tokens: maxTokens,
        stream: false,
      },
    };
  }

  parseResponse(data: unknown): ProviderAssistantMessage | null {
    if (!isRecord(data)) {
      return null;
    }

    const choices = data.choices;
    if (!Array.isArray(choices) || choices.length === 0 || !isRecord(choices[0])) {
      return null;
    }

    const message = choices[0].message;
    if (!isRecord(message) || message.role !== "assistant") {
      return null;
    }

    const content = typeof message.content === "string" ? message.content : "";
    const toolCalls = Array.isArray(message.tool_calls)
      ? message.tool_calls.flatMap((toolCall) => {
          if (!isRecord(toolCall) || typeof toolCall.id !== "string" || !isRecord(toolCall.function)) {
            return [];
          }
          const name = toolCall.function.name;
          const argumentsJson = toolCall.function.arguments;
          if (typeof name !== "string" || typeof argumentsJson !== "string") {
            return [];
          }
          return [{ id: toolCall.id, name, argumentsJson }];
        })
      : [];

    return {
      content,
      toolCalls,
      raw: message,
    };
  }
}

function toOpenAiMessage(message: ProviderMessage): Record<string, unknown> {
  if (message.role === "assistant") {
    return {
      role: "assistant",
      content: message.content,
      tool_calls: message.toolCalls?.map((toolCall) => ({
        id: toolCall.id,
        type: "function",
        function: {
          name: toolCall.name,
          arguments: toolCall.argumentsJson,
        },
      })),
    };
  }

  if (message.role === "tool") {
    return {
      role: "tool",
      tool_call_id: message.toolCallId,
      content: message.content,
    };
  }

  return {
    role: message.role,
    content: message.content,
  };
}

function toOpenAiTool(tool: McpToolDefinition): Record<string, unknown> {
  return {
    type: "function",
    function: {
      name: tool.name,
      description: tool.description,
      parameters: tool.inputSchema,
    },
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
