// ═══════════════════════════════════════════════
// AgentRunStore — Agent 执行记录持久化
//
// 数据目录结构：
//   .augustus/
//     agent-runs/
//       {taskId}/
//         run_{timestamp}_{agentType}.json
//
// AgentRun 不属于主 session，单独落盘以便观测和调试。
// ═══════════════════════════════════════════════

import * as fs from "node:fs";
import * as path from "node:path";
import type { AgentRun } from "./types";

// ─── 接口 ───

export interface AgentRunStore {
  init(): void;
  createRun(run: AgentRun): Promise<AgentRun>;
  updateRun(run: AgentRun): Promise<void>;
  getRun(taskId: string, runId: string): Promise<AgentRun | null>;
  listRunsByTask(taskId: string): Promise<AgentRun[]>;
  generateRunId(agentType: string): string;
}

// ─── 文件系统实现 ───

export class FileSystemAgentRunStore implements AgentRunStore {
  private baseDir: string;

  constructor(baseDir: string) {
    this.baseDir = baseDir;
  }

  init(): void {
    fs.mkdirSync(this.runsRoot(), { recursive: true });
  }

  // ─── 路径工具 ───

  private runsRoot(): string {
    return path.join(this.baseDir, "agent-runs");
  }

  private taskDir(taskId: string): string {
    return path.join(this.runsRoot(), taskId);
  }

  private runPath(taskId: string, runId: string): string {
    return path.join(this.taskDir(taskId), `${runId}.json`);
  }

  // ─── CRUD ───

  async createRun(run: AgentRun): Promise<AgentRun> {
    const dir = this.taskDir(run.taskId);
    fs.mkdirSync(dir, { recursive: true });
    const filePath = this.runPath(run.taskId, run.id);
    await fs.promises.writeFile(filePath, JSON.stringify(run, null, 2), "utf-8");
    return run;
  }

  async updateRun(run: AgentRun): Promise<void> {
    const filePath = this.runPath(run.taskId, run.id);
    await fs.promises.writeFile(filePath, JSON.stringify(run, null, 2), "utf-8");
  }

  async getRun(taskId: string, runId: string): Promise<AgentRun | null> {
    const filePath = this.runPath(taskId, runId);
    if (!fs.existsSync(filePath)) return null;
    try {
      const raw = await fs.promises.readFile(filePath, "utf-8");
      return JSON.parse(raw) as AgentRun;
    } catch {
      return null;
    }
  }

  async listRunsByTask(taskId: string): Promise<AgentRun[]> {
    const dir = this.taskDir(taskId);
    if (!fs.existsSync(dir)) return [];

    const files = await fs.promises.readdir(dir);
    const runs: AgentRun[] = [];

    for (const file of files) {
      if (!file.endsWith(".json")) continue;
      try {
        const raw = await fs.promises.readFile(path.join(dir, file), "utf-8");
        runs.push(JSON.parse(raw) as AgentRun);
      } catch {
        // 跳过损坏文件
      }
    }

    return runs.sort((a, b) => a.startedAt - b.startedAt);
  }

  // ─── ID 生成 ───

  generateRunId(agentType: string): string {
    const safe = agentType.replace(/[<>:"/\\|?*]/g, "_");
    return `run_${Date.now()}_${safe}`;
  }
}
