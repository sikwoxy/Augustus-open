import type { LLMConfig, ChatOptions, ChatResponse, ChatMessage, ToolCall } from "../types";
import type { LLMAdapter } from "../adapter";

export class OpenAIAdapter implements LLMAdapter {
  private config: LLMConfig;

  constructor(config: LLMConfig) {
    this.config = config;
  }

  supportsServerTool(_name: string): boolean {
    return false;
  }

  async chat(options: ChatOptions): Promise<ChatResponse> {
    const body: Record<string, unknown> = {
      model: options.model ?? this.config.model,
      messages: options.messages.map((m) => {
        const msg: Record<string, unknown> = { role: m.role, content: m.content };
        if (m.name) msg.name = m.name;
        if (m.tool_calls) msg.tool_calls = m.tool_calls;
        if (m.tool_call_id) msg.tool_call_id = m.tool_call_id;
        if (m.reasoning_content) msg.reasoning_content = m.reasoning_content;
        if (m.thinking_signature) msg.thinking_signature = m.thinking_signature;
        return msg;
      }),
      max_tokens: options.maxTokens ?? this.config.maxTokens ?? 4096,
    };

    if (options.temperature !== undefined) body.temperature = options.temperature;
    if (options.tools) {
      body.tools = options.tools.map((t) => ({ type: "function", function: t.function }));
    }
    if (options.responseFormat) {
      body.response_format = options.responseFormat;
    }

    const response = await fetch(`${this.config.baseURL}/chat/completions`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${this.config.apiKey}`,
      },
      body: JSON.stringify(body),
    });

    if (!response.ok) {
      const errText = await response.text().catch(() => "");
      throw new Error(`LLM API error ${response.status}: ${errText.slice(0, 300)}`);
    }

    const data = (await response.json()) as Record<string, unknown>;
    const choice = (data.choices as Array<Record<string, unknown>>)?.[0];
    if (!choice) throw new Error("LLM response missing choices");

    const msg = choice.message as Record<string, unknown>;
    return {
      message: {
        role: (msg.role as ChatMessage["role"]) ?? "assistant",
        content: (msg.content as string) ?? null,
        tool_calls: msg.tool_calls as ToolCall[] | undefined,
        reasoning_content: (msg as Record<string, unknown>).reasoning_content as string | undefined,
      },
      usage: data.usage
        ? {
            promptTokens: (data.usage as Record<string, number>).prompt_tokens,
            completionTokens: (data.usage as Record<string, number>).completion_tokens,
            totalTokens: (data.usage as Record<string, number>).total_tokens,
          }
        : undefined,
      finishReason: (choice.finish_reason as string) ?? "stop",
    };
  }

  // ─── Streaming ───

  async *streamChat(options: ChatOptions): AsyncGenerator<string> {
    const body: Record<string, unknown> = {
      model: options.model ?? this.config.model,
      messages: options.messages.map((m) => ({
        role: m.role,
        content: m.content,
        ...(m.name ? { name: m.name } : {}),
        ...(m.reasoning_content ? { reasoning_content: m.reasoning_content } : {}),
        ...(m.thinking_signature ? { thinking_signature: m.thinking_signature } : {}),
      })),
      max_tokens: options.maxTokens ?? this.config.maxTokens ?? 4096,
      stream: true,
    };

    if (options.temperature !== undefined) body.temperature = options.temperature;

    const response = await fetch(`${this.config.baseURL}/chat/completions`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${this.config.apiKey}`,
      },
      body: JSON.stringify(body),
    });

    if (!response.ok || !response.body) return;

    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = "";

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split("\n");
      buffer = lines.pop() ?? "";
      for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed.startsWith("data: ")) continue;
        const jsonStr = trimmed.slice(6);
        if (jsonStr === "[DONE]") return;
        try {
          const chunk = JSON.parse(jsonStr);
          const delta = chunk.choices?.[0]?.delta?.content;
          if (delta) yield delta;
        } catch {
          /* skip malformed chunks */
        }
      }
    }
  }
}
