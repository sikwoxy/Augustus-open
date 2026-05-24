// ═══════════════════════════════════════════════
// LLMClient — 兼容性包装层
//
// chat() 和 chatAnthropic() 已迁移到独立的 Adapter 类：
//   - OpenAIAdapter    →  src/llm/adapters/openai.ts
//   - AnthropicAdapter →  src/llm/adapters/anthropic.ts
//
// 新代码请直接使用 Adapter 实现 LLMAdapter 接口。
// ═══════════════════════════════════════════════

import type { LLMConfig, ChatOptions } from "./types";

export class LLMClient {
  private config: LLMConfig;

  constructor(config: LLMConfig) {
    this.config = config;
  }

  // ─── Streaming（仅 OpenAI 兼容端点） ───

  async *streamChat(options: ChatOptions): AsyncGenerator<string> {
    const body: Record<string, unknown> = {
      model: options.model ?? this.config.model,
      messages: options.messages.map((m) => ({
        role: m.role,
        content: m.content,
        ...(m.name ? { name: m.name } : {}),
        ...(m.reasoning_content ? { reasoning_content: m.reasoning_content } : {}),
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
