import type { LLMAdapter } from "../../llm/adapter";
import type { ChatMessage, ToolDefinition, ToolCall } from "../../llm/types";
import type {
  Tool,
  ToolHandler,
  LoopConfig,
  TurnResult,
  TurnOptions,
  ToolRound,
  FinishReason,
  MaxToolRoundsDiagnostic,
  MaxToolCallsDiagnostic,
} from "./types";
import { errorMessage, serializeError } from "../../utils/diagnostics";

export class Loop {
  private adapter: LLMAdapter;
  private tools: Map<string, Tool> = new Map();
  private messages: ChatMessage[] = [];
  private config: Required<LoopConfig>;

  constructor(adapter: LLMAdapter, config: LoopConfig = {}) {
    this.adapter = adapter;
    this.config = {
      systemPrompt: config.systemPrompt ?? "你是一个智能助手，可以使用工具来帮助用户解决问题。",
      maxTokens: config.maxTokens ?? 4096,
      maxToolRounds: config.maxToolRounds ?? 30,
      maxToolCalls: config.maxToolCalls ?? 50,
      maxContextMessages: config.maxContextMessages ?? resolveMaxContextMessages(),
    };

    if (this.config.systemPrompt) {
      this.messages.push({ role: "system", content: this.config.systemPrompt });
    }
  }

  registerTool(name: string, description: string, parameters: Record<string, unknown>, handler: ToolHandler): this {
    this.tools.set(name, {
      definition: {
        type: "function",
        function: { name, description, parameters },
      },
      handler,
    });
    return this;
  }

  private getAllToolDefinitions(): ToolDefinition[] {
    return Array.from(this.tools.values(), (t) => t.definition);
  }

  private resolveToolDefinitions(allowedTools?: string[]): ToolDefinition[] {
    const all = this.getAllToolDefinitions();
    if (!allowedTools) return all;
    const set = new Set(allowedTools);
    return all.filter((t) => set.has(t.function.name));
  }

  private async executeToolCalls(toolCalls: ToolCall[]): Promise<{ messages: ChatMessage[]; round: ToolRound }> {
    const round: ToolRound = { toolCalls: [], results: [] };
    const resultMessages: ChatMessage[] = [];

    for (const tc of toolCalls) {
      let args: Record<string, unknown>;
      let argumentError: string | null = null;

      try {
        const parsed = JSON.parse(tc.function.arguments);
        if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
          argumentError = "tool arguments must be a JSON object";
          args = {};
        } else {
          args = parsed as Record<string, unknown>;
        }
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        argumentError = `invalid JSON tool arguments: ${message}`;
        args = {};
      }

      round.toolCalls.push({ name: tc.function.name, args });

      let result: string;
      try {
        if (argumentError) {
          result = JSON.stringify({
            error: true,
            success: false,
            message: argumentError,
            toolName: tc.function.name,
            argumentsPreview: tc.function.arguments.slice(0, 500),
          });
        } else {
          const tool = this.tools.get(tc.function.name);
          if (tool) {
            result = await tool.handler(tc.function.name, args);
          } else {
            result = JSON.stringify({ error: true, message: `未知工具: ${tc.function.name}` });
          }
        }
      } catch (err) {
        result = JSON.stringify({ error: true, exception: serializeError(err) });
      }

      round.results.push(result);
      resultMessages.push({
        role: "tool",
        tool_call_id: tc.id,
        content: result,
      });
    }

    return { messages: resultMessages, round };
  }

  async turn(userInput: string, options?: TurnOptions): Promise<TurnResult> {
    const startedAt = Date.now();
    const messageSnapshot = [...this.messages];
    const turnMessages: ChatMessage[] = [];
    const toolRounds: ToolRound[] = [];
    let usage = { inputTokens: 0, outputTokens: 0, totalTokens: 0 };
    let finishReason: FinishReason = "final";
    let executedToolCallCount = 0;

    const userMsg: ChatMessage = { role: "user", content: userInput };
    this.messages.push(userMsg);
    turnMessages.push(userMsg);

    const tools = this.resolveToolDefinitions(options?.allowedTools);

    try {
      for (let round = 0; round < this.config.maxToolRounds; round++) {
        const response = await this.adapter.chat({
          messages: this.buildModelMessages(),
          tools: tools.length > 0 ? tools : undefined,
          maxTokens: this.config.maxTokens,
        });

        if (response.usage) {
          usage.inputTokens += response.usage.promptTokens;
          usage.outputTokens += response.usage.completionTokens;
          usage.totalTokens += response.usage.totalTokens;
        }

        const msg = response.message;
        this.messages.push(msg);
        turnMessages.push(msg);

        if (msg.tool_calls && msg.tool_calls.length > 0) {
          const remainingToolCalls = this.config.maxToolCalls - executedToolCallCount;
          if (remainingToolCalls <= 0) {
            finishReason = "max_tool_calls";
            const maxToolCallsDiagnostic = buildMaxToolCallsDiagnostic({
              maxToolCalls: this.config.maxToolCalls,
              attemptedToolCalls: executedToolCallCount + msg.tool_calls.length,
              executedToolCalls: executedToolCallCount,
              skippedToolCalls: msg.tool_calls.length,
              toolCalls: msg.tool_calls,
            });
            return {
              text: "(已达到最大工具调用次数)",
              messages: turnMessages,
              toolRounds,
              finishReason,
              latencyMs: Date.now() - startedAt,
              usage,
              diagnostics: {
                maxToolCalls: maxToolCallsDiagnostic,
              },
            };
          }

          const executableToolCalls = msg.tool_calls.slice(0, remainingToolCalls);
          const skippedToolCalls = msg.tool_calls.length - executableToolCalls.length;
          const { messages: toolMsgs, round: toolRound } = await this.executeToolCalls(executableToolCalls);
          executedToolCallCount += executableToolCalls.length;
          this.messages.push(...toolMsgs);
          turnMessages.push(...toolMsgs);
          toolRounds.push(toolRound);
          if (skippedToolCalls > 0) {
            finishReason = "max_tool_calls";
            const maxToolCallsDiagnostic = buildMaxToolCallsDiagnostic({
              maxToolCalls: this.config.maxToolCalls,
              attemptedToolCalls: executedToolCallCount + skippedToolCalls,
              executedToolCalls: executedToolCallCount,
              skippedToolCalls,
              toolCalls: msg.tool_calls,
            });
            return {
              text: "(已达到最大工具调用次数)",
              messages: turnMessages,
              toolRounds,
              finishReason,
              latencyMs: Date.now() - startedAt,
              usage,
              diagnostics: {
                maxToolCalls: maxToolCallsDiagnostic,
              },
            };
          }
          continue;
        }

        if (!msg.content) {
          finishReason = "empty_response";
        }
        return {
          text: msg.content ?? "",
          messages: turnMessages,
          toolRounds,
          finishReason,
          latencyMs: Date.now() - startedAt,
          usage,
        };
      }

      finishReason = "max_tool_rounds";
      const maxToolRoundsDiagnostic = buildMaxToolRoundsDiagnostic(toolRounds, this.config.maxToolRounds);
      return {
        text: "(已达到最大工具调用轮次)",
        messages: turnMessages,
        toolRounds,
        finishReason,
        latencyMs: Date.now() - startedAt,
        usage,
        diagnostics: {
          maxToolRounds: maxToolRoundsDiagnostic,
        },
      };
    } catch (err) {
      this.messages = messageSnapshot;
      finishReason = "tool_error";
      const serialized = serializeError(err);
      const errMsg = errorMessage(err);
      return {
        text: `执行出错: ${errMsg}`,
        messages: turnMessages,
        toolRounds,
        finishReason,
        latencyMs: Date.now() - startedAt,
        usage,
        error: serialized,
      };
    }
  }

  getMessages(): ChatMessage[] {
    return [...this.messages];
  }

  private buildModelMessages(): ChatMessage[] {
    const systemMsg = this.messages.find((m) => m.role === "system");
    const nonSystem = this.messages.filter((m) => m.role !== "system");
    const max = this.config.maxContextMessages;

    if (max <= 0 || nonSystem.length <= max) {
      return systemMsg ? [systemMsg, ...nonSystem] : [...nonSystem];
    }

    const tail = nonSystem.slice(-max);
    while (tail.length > 0 && tail[0].role === "tool") {
      tail.shift();
    }

    return systemMsg ? [systemMsg, ...tail] : tail;
  }

  restoreMessages(saved: ChatMessage[]): void {
    const systemMsg = this.messages[0]?.role === "system" ? this.messages[0] : null;
    const nonSystem = saved.filter((m) => m.role !== "system");
    this.messages = systemMsg ? [systemMsg, ...nonSystem] : [...nonSystem];
  }

  reset(): void {
    const systemMsg = this.messages[0]?.role === "system" ? this.messages[0] : null;
    this.messages = systemMsg ? [systemMsg] : [];
  }

  setSystemPrompt(prompt: string): void {
    const systemMsg = { role: "system" as const, content: prompt };
    if (this.messages[0]?.role === "system") {
      this.messages[0] = systemMsg;
    } else {
      this.messages.unshift(systemMsg);
    }
    this.config.systemPrompt = prompt;
  }
}

function buildMaxToolRoundsDiagnostic(
  toolRounds: ToolRound[],
  maxToolRounds: number,
): MaxToolRoundsDiagnostic {
  const toolNames = toolRounds.flatMap((round) => round.toolCalls.map((call) => call.name));
  const counts = new Map<string, number>();
  for (const name of toolNames) {
    counts.set(name, (counts.get(name) ?? 0) + 1);
  }

  const repeatedTools = Array.from(counts.entries())
    .filter(([, count]) => count > 1)
    .sort((a, b) => b[1] - a[1])
    .map(([toolName, count]) => ({ toolName, count }));
  const lastRound = toolRounds[toolRounds.length - 1];
  const lastToolCalls = lastRound?.toolCalls.map((call) => call.name) ?? [];
  const hasShell = toolNames.some((name) => name === "run_shell_command");
  const hasVerification = toolNames.some((name) => name === "run_typecheck" || name === "run_tests" || name === "run_lint");
  const hasWrite = toolNames.some((name) => name === "write_project_file" || name === "apply_project_patch");
  const hasRead = toolNames.some((name) => name === "list_project_files" || name === "read_project_file" || name === "search_project" || name === "stat_project_file");

  let recommendedMode: MaxToolRoundsDiagnostic["recommendedMode"] = "implement_feature";
  if (hasShell && toolNames.length <= maxToolRounds + 1 && !hasRead && !hasWrite) {
    recommendedMode = "command_only";
  } else if (hasVerification && !hasWrite) {
    recommendedMode = "verify";
  } else if (hasWrite) {
    recommendedMode = "edit_files";
  } else if (hasRead) {
    recommendedMode = "inspect_only";
  }

  const likelyCause = inferLikelyCause({ repeatedTools, hasShell, hasVerification, hasWrite, hasRead });
  const needsCheckpoint = hasWrite || hasShell || hasVerification;

  return {
    maxToolRounds,
    completedRounds: toolRounds.length,
    totalToolCalls: toolNames.length,
    lastToolCalls,
    repeatedTools,
    likelyCause,
    recommendedMode,
    needsCheckpoint,
    suggestedAction: needsCheckpoint
      ? `确认 Workspace Grant 和任务边界后，用 ${recommendedMode} mode 重新委托。`
      : `用 ${recommendedMode} mode 重新委托，并传入已有探查摘要，避免重复读取。`,
  };
}

function buildMaxToolCallsDiagnostic(input: {
  maxToolCalls: number;
  attemptedToolCalls: number;
  executedToolCalls: number;
  skippedToolCalls: number;
  toolCalls: ToolCall[];
}): MaxToolCallsDiagnostic {
  const lastToolCalls = input.toolCalls.slice(-8).map((call) => call.function.name);
  return {
    maxToolCalls: input.maxToolCalls,
    attemptedToolCalls: input.attemptedToolCalls,
    executedToolCalls: input.executedToolCalls,
    skippedToolCalls: input.skippedToolCalls,
    lastToolCalls,
    suggestedAction: "本阶段工具调用次数过多。请基于已获得结果总结进展，缩小下一阶段目标，避免一次性批量读取过多文件。",
  };
}

function inferLikelyCause(input: {
  repeatedTools: Array<{ toolName: string; count: number }>;
  hasShell: boolean;
  hasVerification: boolean;
  hasWrite: boolean;
  hasRead: boolean;
}): string {
  if (input.repeatedTools.length > 0) {
    return `repeated_tool_calls: ${input.repeatedTools.slice(0, 3).map((item) => `${item.toolName}x${item.count}`).join(", ")}`;
  }
  if (input.hasWrite) return "implementation_loop_without_clear_completion";
  if (input.hasVerification) return "verification_loop_without_clear_exit";
  if (input.hasShell) return "command_execution_loop";
  if (input.hasRead) return "inspection_loop_without_context_pack";
  return "tool_loop_without_final_answer";
}

function resolveMaxContextMessages(): number {
  const raw = process.env.AUGUSTUS_SESSION_CONTEXT_MESSAGES?.trim();
  if (!raw) return 60;

  const parsed = Number.parseInt(raw, 10);
  if (!Number.isFinite(parsed)) return 60;
  if (parsed <= 0) return 0;
  return Math.max(20, parsed);
}
