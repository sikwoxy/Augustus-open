"use client";

import { useState, useRef, useEffect, useCallback } from "react";
import { Bot, X } from "lucide-react";
import { api } from "@/lib/api";
import { MessageBubble, type BubbleMessage } from "@/components/chat/message-bubble";
import { ChatInput } from "@/components/chat/chat-input";
import { ContextBar } from "@/components/chat/context-bar";
import { RecentActivitySidebar } from "@/components/chat/recent-activity-sidebar";
import { TaskBoundary } from "@/components/chat/task-boundary";
import { NavigationBar } from "@/components/navigation-bar";
import type { UploadedFile } from "@/components/file-upload";
import type { ReplyFile } from "@/components/file-card";
import type {
  ContextHealth,
  TaskSummary,
  WorkingContextSummary,
} from "@/lib/api-types";

function generateId(): string {
  return `conv_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
}

const WELCOME_MESSAGE: BubbleMessage = {
  role: "assistant",
  content: "欢迎来到 Augustus 执政官大厅。有什么我可以协助您的？",
};

const CURRENT_CONTEXT_KEY = "augustus_current_context_id";
const LEGACY_CONV_KEY = "augustus_conv_id";

function readContextIdFromUrl(): string | null {
  if (typeof window === "undefined") return null;
  return new URLSearchParams(window.location.search).get("contextId");
}

function replaceChatUrl(contextId?: string | null): void {
  if (typeof window === "undefined") return;
  const url = contextId ? `/chat?contextId=${encodeURIComponent(contextId)}` : "/chat";
  window.history.replaceState(null, "", url);
}

export default function ChatPage() {
  const [messages, setMessages] = useState<BubbleMessage[]>([WELCOME_MESSAGE]);
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);
  const [taskId, setTaskId] = useState<string | null>(null);
  const [currentTask, setCurrentTask] = useState<TaskSummary | null>(null);
  const [contexts, setContexts] = useState<WorkingContextSummary[]>([]);
  const [currentContext, setCurrentContext] = useState<WorkingContextSummary | null>(null);
  const [contextHealth, setContextHealth] = useState<ContextHealth | undefined>();
  const [loadingContexts, setLoadingContexts] = useState(false);
  const [files, setFiles] = useState<UploadedFile[]>([]);
  const [uploading, setUploading] = useState(false);
  const [previewFile, setPreviewFile] = useState<ReplyFile | null>(null);
  const bottomRef = useRef<HTMLDivElement>(null);
  const conversationIdRef = useRef<string>("");

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, loading]);

  const refreshContexts = useCallback(async () => {
    const res = await api.getContexts({
      channel: "web",
      userId: "local-user",
      kind: "all",
      limit: 50,
    });
    if (!res.ok) return [];
    setContexts(res.data.contexts);
    return res.data.contexts;
  }, []);

  const loadCurrentTask = useCallback(async (conversationId: string) => {
    const res = await api.getCurrentTask("web", conversationId);
    if (res.ok && res.data) {
      setCurrentTask(res.data);
      setTaskId(res.data.id);
    } else {
      setCurrentTask(null);
      setTaskId(null);
    }
  }, []);

  const loadContext = useCallback(async (contextId: string, options?: { updateUrl?: boolean }) => {
    const res = await api.getContext(contextId);
    if (!res.ok) return false;

    const detail = res.data.context;
    conversationIdRef.current = detail.summary.conversationId;
    localStorage.setItem(CURRENT_CONTEXT_KEY, detail.summary.contextId);
    if (options?.updateUrl !== false) replaceChatUrl(detail.summary.contextId);
    setCurrentContext(detail.summary);
    setContextHealth(detail.health);
    setMessages(
      detail.messages.length > 0
        ? detail.messages.map((message) => ({
            role: message.role,
            content: message.content,
            taskId: message.taskId,
          }))
        : [WELCOME_MESSAGE],
    );
    await loadCurrentTask(detail.summary.conversationId);
    return true;
  }, [loadCurrentTask]);

  const startNewContext = useCallback(() => {
    const conversationId = generateId();
    conversationIdRef.current = conversationId;
    localStorage.setItem(CURRENT_CONTEXT_KEY, `web:${conversationId}`);
    setCurrentContext(null);
    setContextHealth(undefined);
    setCurrentTask(null);
    setTaskId(null);
    setMessages([WELCOME_MESSAGE]);
    replaceChatUrl(null);
  }, []);

  useEffect(() => {
    let cancelled = false;

    async function init() {
      setLoadingContexts(true);
      const list = await refreshContexts();
      if (cancelled) return;

      const storedContextId = localStorage.getItem(CURRENT_CONTEXT_KEY);
      const urlContextId = readContextIdFromUrl();
      const legacyConversationId = sessionStorage.getItem(LEGACY_CONV_KEY);
      const legacyContextId = legacyConversationId ? `web:${legacyConversationId}` : null;

      if (urlContextId && await loadContext(urlContextId, { updateUrl: false })) {
        if (!cancelled) setLoadingContexts(false);
        return;
      }

      const selected =
        (storedContextId && list.find((context) => context.contextId === storedContextId)?.contextId) ||
        (legacyContextId && list.find((context) => context.contextId === legacyContextId)?.contextId) ||
        list[0]?.contextId;

      if (selected) {
        await loadContext(selected, { updateUrl: false });
      } else {
        startNewContext();
      }

      if (!cancelled) setLoadingContexts(false);
    }

    init().catch(() => {
      if (!cancelled) {
        startNewContext();
        setLoadingContexts(false);
      }
    });

    return () => {
      cancelled = true;
    };
  }, [loadContext, refreshContexts, startNewContext]);

  const handleSend = useCallback(async () => {
    if ((!input.trim() && files.length === 0) || loading) return;
    if (!conversationIdRef.current) {
      conversationIdRef.current = generateId();
    }

    const text = input.trim() || "(发送了文件)";
    const activeMessageTaskId = currentTask?.id ?? taskId ?? null;
    const userMsg: BubbleMessage = { role: "user", content: text, taskId: activeMessageTaskId };
    setMessages((prev) => [...prev, userMsg]);
    setInput("");
    setLoading(true);

    // Upload files
    const fileRefs: Array<{ fileName: string; localPath: string; size: number }> = [];
    if (files.length > 0) {
      setUploading(true);
      for (const f of files) {
        const res = await api.uploadFile(f.file, conversationIdRef.current);
        if (res.ok && res.data) {
          fileRefs.push(res.data);
        }
      }
      setFiles([]);
      setUploading(false);
    }

    try {
      const response = await api.chat({
        text: userMsg.content,
        conversationId: conversationIdRef.current,
        channel: "web",
        userId: "local-user",
        files: fileRefs.length > 0
          ? fileRefs.map((f) => ({ fileName: f.fileName, localPath: f.localPath, size: f.size }))
          : undefined,
      });

      if (response.ok) {
        const replyMsg: BubbleMessage = {
          role: "assistant",
          content: response.data.text,
          replyFiles: response.data.replyFiles,
          taskId: response.data.taskId ?? activeMessageTaskId,
        };
        setMessages((prev) => [...prev, replyMsg]);
        if (response.data.taskId) setTaskId(response.data.taskId);
        const contextId = `web:${conversationIdRef.current}`;
        localStorage.setItem(CURRENT_CONTEXT_KEY, contextId);
        const list = await refreshContexts();
        const latest = list.find((context) => context.contextId === contextId);
        if (latest) setCurrentContext(latest);
        replaceChatUrl(contextId);
        await loadCurrentTask(conversationIdRef.current);
      } else {
        setMessages((prev) => [
          ...prev,
          { role: "assistant", content: `API 错误: ${response.error.message}` },
        ]);
      }
    } catch (err) {
      setMessages((prev) => [
        ...prev,
        { role: "assistant", content: `网络错误: ${String(err)}` },
      ]);
    } finally {
      setLoading(false);
    }
  }, [input, loading, files, currentTask, taskId, refreshContexts, loadCurrentTask]);

  const taskRefById = new Map((currentContext?.taskRefs ?? []).map((task) => [task.id, task]));
  if (currentTask && !taskRefById.has(currentTask.id)) {
    taskRefById.set(currentTask.id, currentTask);
  }
  let previousBoundaryKey: string | null | undefined;
  const renderedMessages = messages.flatMap((msg, i) => {
    const boundaryKey = msg.taskId ?? null;
    const showBoundary = currentContext
      ? i === 0 || boundaryKey !== previousBoundaryKey
      : i > 0 && boundaryKey !== previousBoundaryKey;
    previousBoundaryKey = boundaryKey;

    const nodes = [];
    if (showBoundary) {
      const taskRef = boundaryKey ? taskRefById.get(boundaryKey) : undefined;
      nodes.push(
        <TaskBoundary
          key={`boundary-${i}-${boundaryKey ?? "temporary"}`}
          taskId={boundaryKey}
          title={taskRef?.title}
          status={taskRef?.status}
        />,
      );
    }
    nodes.push(
      <MessageBubble
        key={`message-${i}`}
        message={msg}
        getFileUrl={(name) => api.getFileUrl(name, conversationIdRef.current)}
        onPreviewFile={(file) => setPreviewFile(file)}
      />,
    );
    return nodes;
  });

  return (
    <div className="relative flex h-screen flex-col overflow-hidden bg-augustus-bg">
      <NavigationBar />

      {/* Background gradient */}
      <div className="fixed inset-0 bg-gradient-to-b from-augustus-bg via-augustus-bg-card to-augustus-bg pointer-events-none" />

      {/* Preview overlay */}
      {previewFile && (
        <div
          className="fixed inset-0 z-50 bg-black/70 flex items-center justify-center p-8"
          onClick={() => setPreviewFile(null)}
        >
          <div
            className="bg-augustus-bg-card border border-augustus-border rounded-md overflow-hidden max-w-4xl w-full max-h-[80vh]"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between px-4 py-2 border-b border-augustus-border">
              <span className="text-sm text-augustus-text-muted">{previewFile.fileName}</span>
              <button onClick={() => setPreviewFile(null)} className="text-augustus-text-dim hover:text-augustus-text-muted">
                <X className="w-4 h-4" />
              </button>
            </div>
            <iframe
              src={api.getFileUrl(previewFile.fileName, conversationIdRef.current)}
              className="w-full bg-white"
              style={{ height: "70vh", border: "none" }}
              title={previewFile.fileName}
            />
          </div>
        </div>
      )}

      <div className="relative z-10 flex min-h-0 flex-1 pt-16">
        <div className="sticky top-20 hidden h-[calc(100vh-5rem)] lg:block">
          <RecentActivitySidebar
            contexts={contexts}
            currentContextId={currentContext?.contextId ?? null}
            loading={loadingContexts}
            onSelect={(context) => void loadContext(context.contextId)}
            onNewContext={startNewContext}
          />
        </div>

        <div className="flex min-h-0 min-w-0 flex-1 flex-col">
          {/* Header */}
          <header className="px-4 pb-3 pt-2 text-center">
            <div className="flex items-center justify-center gap-3">
              <h1 className="text-sm tracking-[0.12em] text-augustus-text/50 font-light">
                执政官大厅
              </h1>
              {taskId && (
                <span className="text-[10px] text-augustus-accent/25 font-mono">
                  {taskId.slice(-8)}
                </span>
              )}
            </div>
          </header>

          <div className="px-4">
            <ContextBar
              context={currentContext}
              currentTask={currentTask}
              health={contextHealth}
            />
          </div>

          {/* Messages */}
          <div className="min-h-0 flex-1 overflow-y-auto px-4 pb-48">
            <div className="max-w-4xl mx-auto space-y-6">
              {renderedMessages}

              {/* Loading skeleton */}
              {loading && (
                <div className="flex gap-3">
                  <div className="flex-shrink-0 w-8 h-8 rounded-full bg-augustus-accent/10 border border-augustus-accent-ring flex items-center justify-center">
                    <Bot className="w-4 h-4 text-augustus-accent" />
                  </div>
                  <div className="px-4 py-3 rounded-md bg-augustus-bg-card border border-augustus-border max-w-[82%]">
                    <div className="flex items-center gap-3">
                      <div className="w-20 h-3 bg-augustus-border rounded animate-pulse" />
                      <div className="w-32 h-3 bg-augustus-border rounded animate-pulse" />
                      <div className="w-16 h-3 bg-augustus-border rounded animate-pulse" />
                    </div>
                  </div>
                </div>
              )}

              <div ref={bottomRef} />
            </div>
          </div>
        </div>
      </div>

      {/* Input area */}
      <div className="relative z-10 fixed bottom-0 left-0 right-0">
        <ChatInput
          input={input}
          onInputChange={setInput}
          onSend={handleSend}
          disabled={loading}
          uploading={uploading}
          files={files}
          onFilesChange={setFiles}
        />
      </div>
    </div>
  );
}
