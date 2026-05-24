import type { ChatOptions, ChatResponse } from "./types";

export interface LLMAdapter {
  chat(options: ChatOptions): Promise<ChatResponse>;
  /** 是否支持将某个 tool 转为服务端工具（如 web_search → Anthropic server tool） */
  supportsServerTool(name: string): boolean;
}
