export interface LLMConfig {
  baseURL: string;
  apiKey: string;
  model: string;
  maxTokens?: number;
  temperature?: number;
}

export interface ChatMessage {
  role: "system" | "user" | "assistant" | "tool";
  content: string | null;
  name?: string;
  tool_calls?: ToolCall[];
  tool_call_id?: string;
  /** 服务端工具调用事件，仅用于持久化和调试，不会回传给普通 client tool */
  server_tool_events?: ServerToolEvent[];
  /** DeepSeek thinking mode 的推理内容，必须原样传回 */
  reasoning_content?: string;
  /** Anthropic thinking block 的签名，与 reasoning_content 配套传回 */
  thinking_signature?: string;
}

export interface ToolCall {
  id: string;
  type: "function";
  function: {
    name: string;
    arguments: string;
  };
}

export interface ServerToolEvent {
  type: "server_tool_use" | "web_search_tool_result" | "web_search_tool_result_error";
  id?: string;
  name?: string;
  input?: Record<string, unknown>;
  tool_use_id?: string;
  contentPreview?: string;
  error_code?: string;
}

export interface ToolDefinition {
  type: "function";
  function: {
    name: string;
    description: string;
    parameters: Record<string, unknown>;
  };
}

export interface ChatOptions {
  messages: ChatMessage[];
  tools?: ToolDefinition[];
  temperature?: number;
  maxTokens?: number;
  /** 覆盖默认模型名，用于元数据生成等非主对话场景 */
  model?: string;
  responseFormat?: { type: "json_object" | "json_schema"; json_schema?: Record<string, unknown> };
}

export interface ChatResponse {
  message: ChatMessage;
  usage?: {
    promptTokens: number;
    completionTokens: number;
    totalTokens: number;
  };
  finishReason: string;
}
