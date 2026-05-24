// ═══════════════════════════════════════════════
// TaskSession 文件系统持久化存储
//
// 数据目录结构：
//   .augustus/
//     tasks/
//       active/       ← active / paused 任务（*.json）
//       done/         ← 已完成任务（*.json）
//       archived/     ← 归档任务（*.json）
//     indexes/
//       task-index.json              ← 全量任务索引
//       current-task-pointers.json   ← 当前任务指针
//
// 第一版优先人类可读、易于备份和手动修复。
// ═══════════════════════════════════════════════

import * as fs from "node:fs";
import * as path from "node:path";
import type { TaskSession, TaskStatus, CurrentTaskPointer } from "./types";

/** 按状态映射任务文件所在目录 */
function statusDir(baseDir: string, status: TaskStatus): string {
  if (status === "done") return path.join(baseDir, "tasks", "done");
  if (status === "archived") return path.join(baseDir, "tasks", "archived");
  if (status === "paused") return path.join(baseDir, "tasks", "paused");
  return path.join(baseDir, "tasks", "active");
}

export class FileSystemTaskStore {
  private baseDir: string;

  constructor(baseDir: string) {
    this.baseDir = baseDir;
  }

  // ─── 目录初始化 ───

  /** 确保所有目录存在（幂等） */
  init(): void {
    for (const dir of [
      path.join(this.baseDir, "tasks", "active"),
      path.join(this.baseDir, "tasks", "paused"),
      path.join(this.baseDir, "tasks", "done"),
      path.join(this.baseDir, "tasks", "archived"),
      path.join(this.baseDir, "indexes"),
    ]) {
      fs.mkdirSync(dir, { recursive: true });
    }
  }

  // ─── Task CRUD ───

  private taskFilePath(taskId: string, status: TaskStatus): string {
    return path.join(statusDir(this.baseDir, status), `${taskId}.json`);
  }

  /** 查找任务文件所在路径（不确定 status 时遍历） */
  private findTaskFile(taskId: string): string | null {
    for (const status of ["active", "paused", "done", "archived"] as TaskStatus[]) {
      const p = this.taskFilePath(taskId, status);
      if (fs.existsSync(p)) return p;
    }
    return null;
  }

  async createTask(task: TaskSession): Promise<TaskSession> {
    const filePath = this.taskFilePath(task.id, task.status);
    await fs.promises.writeFile(filePath, JSON.stringify(task, null, 2), "utf-8");
    await this.updateIndex(task);
    return task;
  }

  async getTask(taskId: string): Promise<TaskSession | null> {
    const filePath = this.findTaskFile(taskId);
    if (!filePath) return null;
    const raw = await fs.promises.readFile(filePath, "utf-8");
    return JSON.parse(raw) as TaskSession;
  }

  async saveTask(task: TaskSession): Promise<void> {
    task.updatedAt = Date.now();
    const newPath = this.taskFilePath(task.id, task.status);

    // 清理其他状态目录下的残留文件（防止同一 taskId 出现在多个目录）
    for (const s of ["active", "paused", "done", "archived"] as TaskStatus[]) {
      if (s === task.status) continue;
      const oldPath = this.taskFilePath(task.id, s);
      if (oldPath !== newPath && fs.existsSync(oldPath)) {
        await fs.promises.unlink(oldPath);
      }
    }

    await fs.promises.writeFile(newPath, JSON.stringify(task, null, 2), "utf-8");
    await this.updateIndex(task);
  }

  async updateStatus(taskId: string, newStatus: TaskStatus): Promise<TaskSession | null> {
    const task = await this.getTask(taskId);
    if (!task) return null;

    const oldStatus = task.status;
    const oldPath = this.taskFilePath(taskId, oldStatus);

    task.status = newStatus;
    task.updatedAt = Date.now();
    if (newStatus === "done" || newStatus === "archived") {
      task.closedAt = Date.now();
    }

    // 跨目录移动
    const newPath = this.taskFilePath(taskId, newStatus);
    if (oldPath !== newPath && fs.existsSync(oldPath)) {
      await fs.promises.rename(oldPath, newPath);
    }

    await fs.promises.writeFile(newPath, JSON.stringify(task, null, 2), "utf-8");
    await this.updateIndex(task);
    return task;
  }

  async listTasks(filter?: { status?: TaskStatus }): Promise<TaskSession[]> {
    const tasks: TaskSession[] = [];
    const dirs: string[] = [];

    if (!filter?.status) {
      dirs.push(
        path.join(this.baseDir, "tasks", "active"),
        path.join(this.baseDir, "tasks", "paused"),
        path.join(this.baseDir, "tasks", "done"),
        path.join(this.baseDir, "tasks", "archived"),
      );
    } else {
      dirs.push(statusDir(this.baseDir, filter.status));
    }

    for (const dir of dirs) {
      if (!fs.existsSync(dir)) continue;
      const files = await fs.promises.readdir(dir);
      for (const file of files) {
        if (!file.endsWith(".json")) continue;
        const raw = await fs.promises.readFile(path.join(dir, file), "utf-8");
        try {
          const task = JSON.parse(raw) as TaskSession;
          if (!filter?.status || task.status === filter.status) {
            tasks.push(task);
          }
        } catch {
          // 跳过损坏的 JSON 文件
        }
      }
    }

    return tasks.sort((a, b) => b.updatedAt - a.updatedAt);
  }

  // ─── Task Index ───

  private indexPath(): string {
    return path.join(this.baseDir, "indexes", "task-index.json");
  }

  private async readIndex(): Promise<Record<string, IndexEntry>> {
    const p = this.indexPath();
    if (!fs.existsSync(p)) return {};
    try {
      const raw = await fs.promises.readFile(p, "utf-8");
      return JSON.parse(raw) as Record<string, IndexEntry>;
    } catch {
      return {};
    }
  }

  async updateIndex(task: TaskSession): Promise<void> {
    const index = await this.readIndex();
    index[task.id] = {
      id: task.id,
      title: task.title,
      status: task.status,
      createdAt: task.createdAt,
      updatedAt: task.updatedAt,
      closedAt: task.closedAt,
    };
    await fs.promises.writeFile(this.indexPath(), JSON.stringify(index, null, 2), "utf-8");
  }

  async getIndex(): Promise<IndexEntry[]> {
    const index = await this.readIndex();
    return Object.values(index).sort((a, b) => b.updatedAt - a.updatedAt);
  }

  // ─── Current Task Pointer ───

  private pointerPath(): string {
    return path.join(this.baseDir, "indexes", "current-task-pointers.json");
  }

  private async readPointers(): Promise<Record<string, CurrentTaskPointer>> {
    const p = this.pointerPath();
    if (!fs.existsSync(p)) return {};
    try {
      const raw = await fs.promises.readFile(p, "utf-8");
      const parsed = JSON.parse(raw) as { pointers?: Record<string, CurrentTaskPointer> };
      return parsed.pointers ?? {};
    } catch {
      return {};
    }
  }

  private async writePointers(pointers: Record<string, CurrentTaskPointer>): Promise<void> {
    await fs.promises.writeFile(
      this.pointerPath(),
      JSON.stringify({ pointers }, null, 2),
      "utf-8",
    );
  }

  /** (userId, channel, conversationId) → pointer key */
  private pointerKey(userId: string, channel: string, conversationId: string): string {
    return `${userId}:${channel}:${conversationId}`;
  }

  async getCurrentPointer(
    userId: string,
    channel: string,
    conversationId: string,
  ): Promise<CurrentTaskPointer | null> {
    const pointers = await this.readPointers();
    return pointers[this.pointerKey(userId, channel, conversationId)] ?? null;
  }

  async setCurrentPointer(pointer: CurrentTaskPointer): Promise<void> {
    const pointers = await this.readPointers();
    pointers[this.pointerKey(pointer.userId, pointer.channel, pointer.conversationId)] = {
      ...pointer,
      updatedAt: Date.now(),
    };
    await this.writePointers(pointers);
  }

  async clearCurrentPointer(userId: string, channel: string, conversationId: string): Promise<void> {
    const pointers = await this.readPointers();
    delete pointers[this.pointerKey(userId, channel, conversationId)];
    await this.writePointers(pointers);
  }

  // ─── ID 生成 ───

  static generateTaskId(): string {
    const hex = Array.from({ length: 12 }, () =>
      Math.floor(Math.random() * 16).toString(16),
    ).join("");
    return `tsk_${hex}`;
  }
}

// ─── Index Entry ───

interface IndexEntry {
  id: string;
  title: string;
  status: TaskStatus;
  createdAt: number;
  updatedAt: number;
  closedAt?: number;
}
