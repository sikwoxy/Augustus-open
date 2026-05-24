import type { LLMConfig, ChatOptions, ChatResponse, ChatMessage, ToolCall, ToolDefinition, ServerToolEvent } from "../types";
import type { LLMAdapter } from "../adapter";

// ─── Anthropic API 内部类型 ───

interface AnthropicContentBlock {
  type: "text" | "thinking" | "tool_use" | "server_tool_use" | "web_search_tool_result" | "web_search_tool_result_error";
  text?: string;
  thinking?: string;
  signature?: string;
  id?: string;
  name?: string;
  input?: Record<string, unknown>;
  tool_use_id?: string;
  content?: unknown[];
  error_code?: string;
}

interface AnthropicToolDef {
  type?: string;
  name: string;
  description?: string;
  input_schema?: Record<string, unknown>;
  max_uses?: number;
}

interface AnthropicResponse {
  id: string;
  role: string;
  content: AnthropicContentBlock[];
  stop_reason: string;
  usage?: {
    input_tokens: number;
    output_tokens: number;
  };
}

// ─── 服务端工具配置 ───

export interface AnthropicServerTools {
  /** 联网搜索最大次数，默认 3；设为 0 关闭 */
  webSearchMaxUses?: number;
}

export class AnthropicAdapter implements LLMAdapter {
  private config: LLMConfig;
  private serverTools: AnthropicServerTools;

  constructor(config: LLMConfig, serverTools: AnthropicServerTools = {}) {
    this.config = config;
    this.serverTools = serverTools;
  }

  supportsServerTool(name: string): boolean {
    if (name === "web_search") return this.serverTools.webSearchMaxUses !== 0;
    return false;
  }

  async chat(options: ChatOptions): Promise<ChatResponse> {
    const systemMsg = options.messages.find((m) => m.role === "system");
    const requestedWebSearch = (options.tools ?? []).some((t) => t.function.name === "web_search");

    // 客户端工具：过滤掉 web_search（转为服务端工具处理）
    const clientTools = this.toAnthropicTools(options.tools ?? []);

    // 添加服务端工具
    if (requestedWebSearch && this.serverTools.webSearchMaxUses !== 0) {
      clientTools.push({
        type: "web_search_20250305",
        name: "web_search",
        max_uses: this.serverTools.webSearchMaxUses ?? 3,
      });
    }

    // 消息格式转换
    const anthropicMessages = this.toAnthropicMessages(options.messages);

    const url = this.buildMessagesUrl();

    const body: Record<string, unknown> = {
      model: options.model ?? this.config.model,
      max_tokens: options.maxTokens ?? this.config.maxTokens ?? 4096,
      tools: clientTools,
      messages: anthropicMessages,
    };

    if (systemMsg?.content) {
      body.system = typeof systemMsg.content === "string" ? this.prepareTextForAnthropicCompat(systemMsg.content) : "";
    }
    if (options.temperature !== undefined) {
      body.temperature = options.temperature;
    }
    if (options.responseFormat) {
      body.response_format = options.responseFormat;
    }

    const response = await fetch(url, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-api-key": this.config.apiKey,
      },
      body: JSON.stringify(body),
    });

    if (!response.ok) {
      const errText = await response.text().catch(() => "");
      throw new Error(`Anthropic API error ${response.status}: ${errText.slice(0, 300)}`);
    }

    const data = (await response.json()) as AnthropicResponse;
    return this.fromAnthropicResponse(data);
  }

  // ─── 工具转换 ───

  /** 转换为 Anthropic 工具格式，web_search 被过滤（转为服务端工具） */
  private toAnthropicTools(tools: ToolDefinition[]): AnthropicToolDef[] {
    return tools
      .filter((t) => t.function.name !== "web_search")
      .map((t) => ({
        name: t.function.name,
        description: t.function.description,
        input_schema: t.function.parameters,
      }));
  }

  // ─── 消息格式转换 ───

  private toAnthropicMessages(messages: ChatMessage[]): Record<string, unknown>[] {
    const result: Record<string, unknown>[] = [];

    for (let i = 0; i < messages.length; i++) {
      const message = messages[i];
      if (message.role === "system") continue;

      if (message.role === "tool") {
        const blocks: Record<string, unknown>[] = [];
        while (i < messages.length && messages[i].role === "tool") {
          const toolMessage = messages[i];
          if (toolMessage.tool_call_id) {
            blocks.push({
              type: "tool_result",
              tool_use_id: toolMessage.tool_call_id,
              content: this.toTextBlocks(toolMessage.content ?? ""),
            });
          }
          i++;
        }
        i--;
        if (blocks.length > 0) {
          result.push({ role: "user", content: blocks });
        }
        continue;
      }

      result.push(this.toAnthropicMessage(message));
    }

    return result;
  }

  private toAnthropicMessage(m: ChatMessage): Record<string, unknown> {
    // assistant 消息带有 reasoning_content 或 tool_calls → content blocks 数组
    if (m.role === "assistant" && (m.reasoning_content || (m.tool_calls && m.tool_calls.length > 0))) {
      const blocks: Record<string, unknown>[] = [];

      // thinking block 必须在 text 之前（Anthropic API 要求）
      if (m.reasoning_content) {
        const thinkingBlock: Record<string, unknown> = {
          type: "thinking",
          thinking: m.reasoning_content,
        };
        if (m.thinking_signature) thinkingBlock.signature = m.thinking_signature;
        blocks.push(thinkingBlock);
      }

      if (m.content) {
        blocks.push(...this.toTextBlocks(m.content));
      }
      for (const tc of m.tool_calls ?? []) {
        let args: Record<string, unknown> = {};
        try {
          args = JSON.parse(tc.function.arguments);
        } catch {
          /* empty */
        }
        blocks.push({ type: "tool_use", id: tc.id, name: tc.function.name, input: args });
      }
      return { role: "assistant", content: blocks };
    }

    // 普通文本消息。DeepSeek 的 Anthropic-compatible 示例使用 text block；
    // 这里统一成 block 形式，避免代理端对 content 字符串二次解析转义。
    return { role: m.role, content: this.toTextBlocks(m.content ?? "") };
  }

  private toTextBlocks(text: string | null | undefined): Array<{ type: "text"; text: string }> {
    return [{ type: "text", text: this.prepareTextForAnthropicCompat(text ?? "") }];
  }

  private prepareTextForAnthropicCompat(text: string): string {
    return this.escapeTextForAnthropicCompat(this.replaceLoneSurrogates(text));
  }

  private replaceLoneSurrogates(text: string): string {
    let result = "";
    for (let i = 0; i < text.length; i++) {
      const code = text.charCodeAt(i);
      if (code >= 0xd800 && code <= 0xdbff) {
        const next = text.charCodeAt(i + 1);
        if (next >= 0xdc00 && next <= 0xdfff) {
          result += text[i] + text[i + 1];
          i++;
        } else {
          result += "\ufffd";
        }
        continue;
      }
      if (code >= 0xdc00 && code <= 0xdfff) {
        result += "\ufffd";
        continue;
      }
      result += text[i];
    }
    return result;
  }

  private escapeTextForAnthropicCompat(text: string): string {
    // DeepSeek's Anthropic-compatible endpoint can reject Windows-style
    // backslashes in text with "unexpected end of hex escape". Doubling the
    // slash keeps the path readable for the model while avoiding that parser
    // edge case after the upstream JSON decoder normalizes escapes.
    return text.replace(/\\/g, "\\\\");
  }

  private buildMessagesUrl(): string {
    const baseURL = this.config.baseURL.replace(/\/+$/, "");
    if (/\/anthropic\/v1\/messages$/i.test(baseURL)) return baseURL;
    if (/\/anthropic\/v1$/i.test(baseURL)) return `${baseURL}/messages`;
    if (/\/anthropic$/i.test(baseURL)) return `${baseURL}/v1/messages`;

    const withoutOpenAIV1 = baseURL.replace(/\/v1$/i, "");
    return `${withoutOpenAIV1}/anthropic/v1/messages`;
  }

  private fromAnthropicResponse(data: AnthropicResponse): ChatResponse {
    const blocks = data.content;
    const textParts: string[] = [];
    const toolCalls: ToolCall[] = [];
    const serverToolEvents: ServerToolEvent[] = [];
    let reasoning = "";

    let thinkingSignature = "";

    for (const block of blocks) {
      switch (block.type) {
        case "text":
          if (block.text) textParts.push(block.text);
          break;
        case "thinking":
          if (block.thinking) reasoning += block.thinking;
          if (block.signature && !thinkingSignature) thinkingSignature = block.signature;
          break;
        case "tool_use": {
          const tc: ToolCall = {
            id: block.id ?? `tool_${toolCalls.length}`,
            type: "function",
            function: {
              name: block.name ?? "unknown",
              arguments: JSON.stringify(block.input ?? {}),
            },
          };
          toolCalls.push(tc);
          break;
        }
        case "server_tool_use":
          serverToolEvents.push({
            type: "server_tool_use",
            id: block.id,
            name: block.name,
            input: block.input,
          });
          break;
        case "web_search_tool_result":
          serverToolEvents.push({
            type: "web_search_tool_result",
            tool_use_id: block.tool_use_id,
            contentPreview: this.previewUnknown(block.content),
          });
          break;
        case "web_search_tool_result_error":
          serverToolEvents.push({
            type: "web_search_tool_result_error",
            tool_use_id: block.tool_use_id,
            error_code: block.error_code,
            contentPreview: this.previewUnknown(block.content),
          });
          break;
        default:
          break;
      }
    }

    return {
      message: {
        role: "assistant",
        content: textParts.join("") || null,
        tool_calls: toolCalls.length > 0 ? toolCalls : undefined,
        server_tool_events: serverToolEvents.length > 0 ? serverToolEvents : undefined,
        reasoning_content: reasoning || undefined,
        thinking_signature: thinkingSignature || undefined,
      },
      usage: data.usage
        ? {
            promptTokens: data.usage.input_tokens,
            completionTokens: data.usage.output_tokens,
            totalTokens: data.usage.input_tokens + data.usage.output_tokens,
          }
        : undefined,
      finishReason:
        data.stop_reason === "end_turn" ? "stop" :
        data.stop_reason === "tool_use" ? "tool_calls" :
        data.stop_reason,
    };
  }

  private previewUnknown(value: unknown): string | undefined {
    if (value === undefined || value === null) return undefined;
    try {
      return JSON.stringify(value).slice(0, 2000);
    } catch {
      return String(value).slice(0, 2000);
    }
  }
}
