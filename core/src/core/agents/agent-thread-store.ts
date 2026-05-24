// ═══════════════════════════════════════════════
// TaskAgentThreadStore — task-scoped subagent context
//
// AgentRun remains the audit record for each execution. TaskAgentThread is the
// compact continuity layer loaded when the same subagent is delegated again
// within a task.
// ═══════════════════════════════════════════════

import * as fs from "node:fs";
import * as path from "node:path";
import type { AgentRun, AgentThreadRunSummary, TaskAgentThread } from "./types";

const MAX_RECENT_RUNS = 8;
const MAX_COMPLETED_STEPS = 12;
const MAX_FAILED_ATTEMPTS = 8;
const MAX_VERIFICATION_NOTES = 8;

export interface AgentThreadStore {
  init(): void;
  getThread(taskId: string, agentType: string): Promise<TaskAgentThread | null>;
  getOrCreateThread(taskId: string, agentType: string): Promise<TaskAgentThread>;
  recordRun(run: AgentRun): Promise<TaskAgentThread>;
  buildContextPack(taskId: string, agentType: string): Promise<string | null>;
}

export class FileSystemAgentThreadStore implements AgentThreadStore {
  private baseDir: string;

  constructor(baseDir: string) {
    this.baseDir = baseDir;
  }

  init(): void {
    fs.mkdirSync(this.threadRoot(), { recursive: true });
  }

  private threadRoot(): string {
    return path.join(this.baseDir, "agent-threads");
  }

  private taskDir(taskId: string): string {
    return path.join(this.threadRoot(), safePathSegment(taskId));
  }

  private threadPath(taskId: string, agentType: string): string {
    return path.join(this.taskDir(taskId), `${safePathSegment(agentType)}.json`);
  }

  async getThread(taskId: string, agentType: string): Promise<TaskAgentThread | null> {
    const filePath = this.threadPath(taskId, agentType);
    if (!fs.existsSync(filePath)) return null;
    try {
      const raw = await fs.promises.readFile(filePath, "utf-8");
      return normalizeThread(JSON.parse(raw) as Partial<TaskAgentThread>, taskId, agentType);
    } catch {
      return null;
    }
  }

  async getOrCreateThread(taskId: string, agentType: string): Promise<TaskAgentThread> {
    const existing = await this.getThread(taskId, agentType);
    if (existing) return existing;

    const now = Date.now();
    const thread: TaskAgentThread = {
      taskId,
      agentType,
      createdAt: now,
      updatedAt: now,
      runCount: 0,
      recentRuns: [],
      completedSteps: [],
      failedAttempts: [],
      verificationNotes: [],
      openQuestions: [],
    };
    await this.writeThread(thread);
    return thread;
  }

  async recordRun(run: AgentRun): Promise<TaskAgentThread> {
    const thread = await this.getOrCreateThread(run.taskId, run.agentType);
    const summary = summarizeRun(run);

    thread.runCount += 1;
    thread.lastRunId = run.id;
    thread.updatedAt = Date.now();
    thread.recentRuns = [summary, ...thread.recentRuns.filter((item) => item.runId !== run.id)]
      .slice(0, MAX_RECENT_RUNS);

    if (run.status === "done" && run.result?.summary) {
      thread.completedSteps = uniquePrepend(
        thread.completedSteps,
        `${run.id}: ${preview(run.result.summary, 260)}`,
        MAX_COMPLETED_STEPS,
      );
    }

    if (run.outcome === "needs_continuation" && run.continuationPack?.completedSteps.length) {
      for (const step of [...run.continuationPack.completedSteps].reverse()) {
        thread.completedSteps = uniquePrepend(
          thread.completedSteps,
          `${run.id}: ${preview(step, 220)}`,
          MAX_COMPLETED_STEPS,
        );
      }
    }

    if (run.status === "failed") {
      thread.failedAttempts = uniquePrepend(
        thread.failedAttempts,
        `${run.id}: ${preview(run.error ?? run.result?.summary ?? run.instruction, 260)}`,
        MAX_FAILED_ATTEMPTS,
      );
    }

    const verificationNote = extractVerificationNote(run);
    if (verificationNote) {
      thread.verificationNotes = uniquePrepend(
        thread.verificationNotes,
        verificationNote,
        MAX_VERIFICATION_NOTES,
      );
    }

    await this.writeThread(thread);
    return thread;
  }

  async buildContextPack(taskId: string, agentType: string): Promise<string | null> {
    const thread = await this.getThread(taskId, agentType);
    if (!thread || thread.runCount === 0) return null;

    const lines: string[] = [
      "### Task-scoped Agent Thread",
      `Agent: ${agentType}`,
      `Previous runs in this task: ${thread.runCount}`,
    ];

    if (thread.completedSteps.length > 0) {
      lines.push("", "Completed steps:");
      for (const step of thread.completedSteps.slice(0, 6)) {
        lines.push(`- ${sanitizeText(step)}`);
      }
    }

    if (thread.failedAttempts.length > 0) {
      lines.push("", "Failed attempts to avoid repeating:");
      for (const attempt of thread.failedAttempts.slice(0, 4)) {
        lines.push(`- ${sanitizeText(attempt)}`);
      }
    }

    if (thread.verificationNotes.length > 0) {
      lines.push("", "Verification notes:");
      for (const note of thread.verificationNotes.slice(0, 4)) {
        lines.push(`- ${sanitizeText(note)}`);
      }
    }

    if (thread.recentRuns.length > 0) {
      lines.push("", "Recent run summaries:");
      for (const run of thread.recentRuns.slice(0, 5)) {
        const status = run.outcome ?? (run.status === "done" ? "done" : "failed");
        lines.push(`- ${run.runId} (${status}${run.mode ? `, ${run.mode}` : ""}): ${preview(run.summary ?? run.error ?? run.instruction, 220)}`);
      }
    }

    return lines.join("\n");
  }

  private async writeThread(thread: TaskAgentThread): Promise<void> {
    fs.mkdirSync(this.taskDir(thread.taskId), { recursive: true });
    await fs.promises.writeFile(
      this.threadPath(thread.taskId, thread.agentType),
      JSON.stringify(thread, null, 2),
      "utf-8",
    );
  }
}

function summarizeRun(run: AgentRun): AgentThreadRunSummary {
  return {
    runId: run.id,
    status: run.status,
    outcome: run.outcome,
    mode: run.mode,
    instruction: preview(run.instruction, 300),
    summary: run.result?.summary ? preview(run.result.summary, 500) : undefined,
    error: run.error ? preview(run.error, 500) : undefined,
    usedTools: run.usedTools,
    toolEventCount: run.toolEvents.length,
    startedAt: run.startedAt,
    endedAt: run.endedAt,
  };
}

function normalizeThread(
  input: Partial<TaskAgentThread>,
  taskId: string,
  agentType: string,
): TaskAgentThread {
  const now = Date.now();
  return {
    taskId,
    agentType,
    createdAt: typeof input.createdAt === "number" ? input.createdAt : now,
    updatedAt: typeof input.updatedAt === "number" ? input.updatedAt : now,
    runCount: typeof input.runCount === "number" ? input.runCount : 0,
    lastRunId: input.lastRunId,
    recentRuns: Array.isArray(input.recentRuns) ? input.recentRuns : [],
    completedSteps: Array.isArray(input.completedSteps) ? input.completedSteps : [],
    failedAttempts: Array.isArray(input.failedAttempts) ? input.failedAttempts : [],
    verificationNotes: Array.isArray(input.verificationNotes) ? input.verificationNotes : [],
    openQuestions: Array.isArray(input.openQuestions) ? input.openQuestions : [],
  };
}

function extractVerificationNote(run: AgentRun): string | null {
  const tools = new Set(run.usedTools);
  const verificationTools = ["run_typecheck", "run_tests", "run_lint", "git_diff", "git_status"];
  const usedVerification = verificationTools.filter((tool) => tools.has(tool));
  if (usedVerification.length === 0) return null;

  const status = run.status === "done" ? "completed" : "failed";
  return `${run.id}: ${status}; tools=${usedVerification.join(", ")}`;
}

function uniquePrepend(items: string[], value: string, limit: number): string[] {
  return [value, ...items.filter((item) => item !== value)].slice(0, limit);
}

function safePathSegment(value: string): string {
  return value.replace(/[<>:"/\\|?*]/g, "_");
}

function preview(text: string, maxChars: number): string {
  const compact = sanitizeText(text).replace(/\s+/g, " ").trim();
  const chars = Array.from(compact);
  return chars.length > maxChars ? `${chars.slice(0, maxChars).join("")}...` : compact;
}

function sanitizeText(text: string): string {
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
