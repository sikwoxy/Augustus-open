// ═══════════════════════════════════════════════
// Typed API Client
//
// 所有 HTTP 调用集中在这里。直连后端，无 mock。
// 导出 api（正式）和 testApi（测试隔离空间）。
// ═══════════════════════════════════════════════

import type {
  ApiResponse,
  ChatRequest,
  ChatResponse,
  TaskSummary,
  TaskDetailResponse,
  WorkingContextSummary,
  WorkingContextDetail,
  StatusResponse,
  HealthResponse,
  ReadyResponse,
  SleepResponse,
} from "./api-types";

// ─── 配置 ───

const BASE_URL = (process.env.NEXT_PUBLIC_API_URL || "http://localhost:3001").replace(/\/$/, "");

// ─── 底层请求工厂 ───

function makeGet(extraHeaders: Record<string, string> = {}) {
  return async <T>(path: string): Promise<ApiResponse<T>> => {
    const res = await fetch(`${BASE_URL}${path}`, { headers: extraHeaders });
    return res.json();
  };
}

function makePost(extraHeaders: Record<string, string> = {}) {
  return async <T>(path: string, body: unknown): Promise<ApiResponse<T>> => {
    const res = await fetch(`${BASE_URL}${path}`, {
      method: "POST",
      headers: { "Content-Type": "application/json", ...extraHeaders },
      body: JSON.stringify(body),
    });
    return res.json();
  };
}

// ─── API Client 工厂 ───

export interface ApiClient {
  chat(req: ChatRequest): Promise<ApiResponse<ChatResponse>>;
  getTasks(): Promise<ApiResponse<{ tasks: TaskSummary[] }>>;
  getCurrentTask(channel?: string, conversationId?: string): Promise<ApiResponse<TaskSummary | null>>;
  getTask(taskId: string): Promise<ApiResponse<TaskDetailResponse>>;
  getContexts(query?: { channel?: string; userId?: string; taskId?: string; kind?: "task_related" | "temporary" | "all"; limit?: number }): Promise<ApiResponse<{ contexts: WorkingContextSummary[] }>>;
  getContext(contextId: string): Promise<ApiResponse<{ context: WorkingContextDetail }>>;
  getStatus(): Promise<ApiResponse<StatusResponse>>;
  health(): Promise<ApiResponse<HealthResponse>>;
  ready(): Promise<ApiResponse<ReadyResponse>>;
  sleep(): Promise<ApiResponse<SleepResponse>>;
  getFileUrl(fileName: string, conversationId: string, channel?: string, taskId?: string): string;
  uploadFile(file: File, conversationId: string, channel?: string): Promise<ApiResponse<{ fileName: string; localPath: string; size: number }>>;
  listFiles(conversationId: string, channel?: string): Promise<ApiResponse<{ files: Array<{ fileName: string; size: number; createdAt: number; modifiedAt: number }> }>>;
  getConfig(): Promise<ApiResponse<{
    provider: string; model: string; baseUrl: string; webSearchSupported: boolean;
    agentConfigs: Record<string, { provider: string; model: string }>; envFile: string;
  }>>;
  reset(keep?: string[]): Promise<ApiResponse<{ deleted: string[]; kept: string[] }>>;
}

export function createApiClient(options?: { testMode?: boolean }): ApiClient {
  const testMode = options?.testMode ?? false;
  const headers: Record<string, string> = {};
  if (testMode) headers["x-augustus-test-mode"] = "true";
  const get = makeGet(headers);
  const post = makePost(headers);

  return {
    async chat(req) {
      return post<ChatResponse>("/v1/chat", req);
    },

    async getTasks() {
      return get<{ tasks: TaskSummary[] }>("/v1/tasks");
    },

    async getCurrentTask(channel = "web", conversationId: string) {
      return get<TaskSummary | null>(
        `/v1/tasks/current?userId=local-user&channel=${channel}&conversationId=${conversationId}`,
      );
    },

    async getTask(taskId: string) {
      return get<TaskDetailResponse>(`/v1/tasks/${encodeURIComponent(taskId)}`);
    },

    async getContexts(query) {
      const params = new URLSearchParams();
      if (query?.channel) params.set("channel", query.channel);
      if (query?.userId) params.set("userId", query.userId);
      if (query?.taskId) params.set("taskId", query.taskId);
      if (query?.kind) params.set("kind", query.kind);
      if (query?.limit) params.set("limit", String(query.limit));
      const suffix = params.toString() ? `?${params.toString()}` : "";
      return get<{ contexts: WorkingContextSummary[] }>(`/v1/contexts${suffix}`);
    },

    async getContext(contextId: string) {
      return get<{ context: WorkingContextDetail }>(`/v1/contexts/${encodeURIComponent(contextId)}`);
    },

    async getStatus() {
      return get<StatusResponse>("/v1/status");
    },

    async health() {
      return get<HealthResponse>("/healthz");
    },

    async ready() {
      return get<ReadyResponse>("/readyz");
    },

    async sleep() {
      return post<SleepResponse>("/v1/sleep", {});
    },

    getFileUrl(fileName: string, conversationId: string, channel = "web", taskId?: string) {
      const params = new URLSearchParams({ conversationId, channel, userId: "local-user" });
      if (taskId) params.set("taskId", taskId);
      const url = `${BASE_URL}/v1/files/${encodeURIComponent(fileName)}?${params.toString()}`;
      return testMode ? `${url}&test=true` : url;
    },

    async uploadFile(file: File, conversationId: string, channel = "web") {
      const form = new FormData();
      form.append("file", file);
      const params = new URLSearchParams({ conversationId, channel, userId: "local-user" });
      const fetchHeaders: Record<string, string> = {};
      if (testMode) fetchHeaders["x-augustus-test-mode"] = "true";
      const res = await fetch(`${BASE_URL}/v1/files/upload?${params.toString()}`, {
        method: "POST",
        headers: fetchHeaders,
        body: form,
      });
      return res.json();
    },

    async getConfig() {
      return get<{
        provider: string; model: string; baseUrl: string; webSearchSupported: boolean;
        agentConfigs: Record<string, { provider: string; model: string }>; envFile: string;
      }>("/v1/config");
    },

    async listFiles(conversationId: string, channel = "web") {
      const params = new URLSearchParams({ conversationId, channel, userId: "local-user" });
      return get<{ files: Array<{ fileName: string; size: number; createdAt: number; modifiedAt: number }> }>(`/v1/files?${params.toString()}`);
    },

    async reset(keep?: string[]) {
      return post<{ deleted: string[]; kept: string[] }>("/v1/admin/reset", { keep });
    },
  };
}

/** 正式环境 API client — 数据目录 .augustus/ */
export const api = createApiClient();

/** 测试环境 API client — 数据目录 .augustus-test/，请求自动带 x-augustus-test-mode header */
export const testApi = createApiClient({ testMode: true });
