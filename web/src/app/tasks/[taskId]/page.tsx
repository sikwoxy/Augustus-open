"use client";

import { useEffect, useState } from "react";
import { useParams } from "next/navigation";
import { ArrowLeft, Target, CheckSquare, Layers, Wrench, MessageSquare, ExternalLink, Clock, X } from "lucide-react";
import Link from "next/link";
import { api } from "@/lib/api";
import type { TaskDetailResponse, WorkingContextSummary } from "@/lib/api-types";
import { TaskStatusBadge } from "@/components/task/task-status-badge";
import { TaskTimeline } from "@/components/task/task-timeline";
import { FileCard } from "@/components/file-card";
import { NavigationBar } from "@/components/navigation-bar";

function formatTime(ts: number): string {
  return new Date(ts).toLocaleString("zh-CN");
}

function artifactFileName(uri: string): string {
  return uri.split(/[\\/]/).pop() || uri;
}

export default function TaskDetailPage() {
  const { taskId } = useParams<{ taskId: string }>();
  const [task, setTask] = useState<TaskDetailResponse["task"] | null>(null);
  const [relatedContexts, setRelatedContexts] = useState<WorkingContextSummary[]>([]);
  const [previewFile, setPreviewFile] = useState<{ fileName: string; localPath: string; size: number } | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    async function load() {
      try {
        const [taskRes, contextsRes] = await Promise.all([
          api.getTask(taskId),
          api.getContexts({ channel: "web", taskId, kind: "all", limit: 20 }),
        ]);
        if (taskRes.ok) setTask(taskRes.data!.task);
        else setError(taskRes.error?.message ?? "加载失败");
        if (contextsRes.ok) setRelatedContexts(contextsRes.data.contexts);
      } catch {
        setError("无法连接到 Backend");
      } finally {
        setLoading(false);
      }
    }
    load();
  }, [taskId]);

  if (loading) {
    return (
      <div className="min-h-screen bg-augustus-bg flex items-center justify-center">
        <div className="w-48 h-4 bg-augustus-border rounded animate-pulse" />
      </div>
    );
  }

  if (error || !task) {
    return (
      <div className="min-h-screen bg-augustus-bg flex flex-col items-center justify-center gap-4">
        <p className="text-sm text-red-400">{error ?? "任务不存在"}</p>
        <Link href="/tasks" className="text-xs text-augustus-accent hover:text-augustus-accent-hover">
          ← 返回任务列表
        </Link>
      </div>
    );
  }

  const timeline: Array<{ label: string; value: string; time?: number }> = [
    { label: "创建", value: `任务创建`, time: task.createdAt },
  ];
  if (task.status === "done" && task.summary) {
    timeline.push({ label: "完成", value: task.summary, time: task.updatedAt });
  }
  if (task.decisions && task.decisions.length > 0) {
    for (const d of task.decisions) {
      timeline.push({ label: "决策", value: d });
    }
  }

  const artifactConversationId =
    task.channels.find((channel) => channel.channel === "web")?.conversationId ??
    task.channels[0]?.conversationId ??
    "";

  return (
    <div className="min-h-screen bg-augustus-bg">
      <NavigationBar />
      <div className="fixed inset-0 bg-gradient-to-b from-augustus-bg via-augustus-bg-card to-augustus-bg pointer-events-none" />

      {previewFile && artifactConversationId && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-3 sm:p-8"
          onClick={() => setPreviewFile(null)}
        >
          <div
            className="max-h-[86vh] w-full max-w-4xl overflow-hidden rounded-md border border-augustus-border bg-augustus-bg-card sm:max-h-[80vh]"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between border-b border-augustus-border px-4 py-2">
              <span className="truncate text-sm text-augustus-text-muted">{previewFile.fileName}</span>
              <button onClick={() => setPreviewFile(null)} className="text-augustus-text-dim hover:text-augustus-text-muted">
                <X className="h-4 w-4" />
              </button>
            </div>
            <iframe
              src={api.getFileUrl(previewFile.fileName, artifactConversationId, "web", task.id)}
              className="w-full bg-white"
              style={{ height: "72vh", border: "none" }}
              title={previewFile.fileName}
            />
          </div>
        </div>
      )}

      <div className="relative z-10 mx-auto max-w-3xl px-3 pb-12 pt-20 sm:px-4 sm:py-24">
        {/* Back link */}
        <Link
          href="/tasks"
          className="mb-5 inline-flex items-center gap-1 text-xs text-augustus-text-muted transition-colors hover:text-augustus-accent sm:mb-6"
        >
          <ArrowLeft className="w-3 h-3" /> 返回列表
        </Link>

        {/* Header */}
        <div className="mb-6 flex flex-col gap-3 sm:mb-8 sm:flex-row sm:items-start sm:justify-between">
          <div className="flex-1 min-w-0">
            <h1 className="text-lg text-augustus-text font-semibold mb-1 sm:text-xl">{task.title}</h1>
            {task.goal && <p className="text-sm text-augustus-text-muted">{task.goal}</p>}
          </div>
          <div className="self-start">
            <TaskStatusBadge status={task.status} />
          </div>
        </div>

        <div className="grid grid-cols-1 gap-4 md:grid-cols-2 md:gap-6">
          {/* Left: timeline and related activity */}
          <div className="space-y-4 md:space-y-6">
            <section className="bg-augustus-bg-card border border-augustus-border rounded-md p-3 sm:p-4">
              <h2 className="text-sm font-semibold text-augustus-text mb-4 flex items-center gap-1.5">
                <Layers className="w-4 h-4 text-augustus-accent" /> 时间线
              </h2>
              <TaskTimeline items={timeline} />
            </section>

            <section className="bg-augustus-bg-card border border-augustus-border rounded-md p-3 sm:p-4">
              <h2 className="text-sm font-semibold text-augustus-text mb-4 flex items-center gap-1.5">
                <MessageSquare className="w-4 h-4 text-augustus-accent" /> 相关活动
              </h2>
              {relatedContexts.length > 0 ? (
                <div className="space-y-2">
                  {relatedContexts.map((context) => (
                    <Link
                      key={context.contextId}
                      href={`/chat?contextId=${encodeURIComponent(context.contextId)}`}
                      className="block rounded-md border border-augustus-border/80 bg-augustus-bg/50 px-3 py-2 transition-colors hover:border-augustus-accent-ring hover:bg-augustus-accent-muted/40"
                    >
                      <div className="flex items-start justify-between gap-3">
                        <div className="min-w-0">
                          <div className="truncate text-sm text-augustus-text/85">{context.title}</div>
                          {context.lastMessagePreview && (
                            <div className="mt-1 line-clamp-2 text-xs text-augustus-text-muted">
                              {context.lastMessagePreview}
                            </div>
                          )}
                        </div>
                        <ExternalLink className="mt-0.5 h-3.5 w-3.5 shrink-0 text-augustus-text-dim" />
                      </div>
                      <div className="mt-2 flex flex-wrap items-center gap-2 text-[11px] text-augustus-text-dim">
                        <Clock className="h-3 w-3" />
                        <span>{formatTime(context.updatedAt)}</span>
                        <span>{context.userMessageCount + context.assistantMessageCount} 条消息</span>
                        {context.taskIds.length > 1 && <span>横跨 {context.taskIds.length} 个任务</span>}
                      </div>
                    </Link>
                  ))}
                </div>
              ) : (
                <p className="text-xs text-augustus-text-dim">
                  暂无可恢复的相关活动。后续在 Chat 中围绕此任务交流后会出现在这里。
                </p>
              )}
            </section>
          </div>

          {/* Right: details */}
          <div className="space-y-4 md:space-y-6">
            {/* Outcome */}
            {task.outcome && (
              <section className="bg-augustus-bg-card border border-augustus-border rounded-md p-3 sm:p-4">
                <h2 className="text-sm font-semibold text-augustus-text mb-2 flex items-center gap-1.5">
                  <Target className="w-4 h-4 text-augustus-accent" /> 产出
                </h2>
                <p className="text-sm text-augustus-text/80">{task.outcome}</p>
              </section>
            )}

            {/* Todos */}
            {task.todos && task.todos.length > 0 && (
              <section className="bg-augustus-bg-card border border-augustus-border rounded-md p-3 sm:p-4">
                <h2 className="text-sm font-semibold text-augustus-text mb-2 flex items-center gap-1.5">
                  <CheckSquare className="w-4 h-4 text-augustus-accent" /> 待办
                </h2>
                <ul className="space-y-1">
                  {task.todos.map((todo, i) => (
                    <li key={i} className="text-sm text-augustus-text/80 flex items-start gap-2">
                      <span className="text-augustus-accent mt-1.5">•</span>
                      {todo}
                    </li>
                  ))}
                </ul>
              </section>
            )}

            {/* Agents */}
            {task.usedAgents && task.usedAgents.length > 0 && (
              <section className="bg-augustus-bg-card border border-augustus-border rounded-md p-3 sm:p-4">
                <h2 className="text-sm font-semibold text-augustus-text mb-2 flex items-center gap-1.5">
                  <Wrench className="w-4 h-4 text-augustus-accent" /> 使用的 Agent
                </h2>
                <div className="flex flex-wrap gap-1.5">
                  {task.usedAgents.map((a) => (
                    <span key={a} className="text-xs px-2 py-0.5 bg-augustus-accent-muted text-augustus-accent rounded">
                      {a}
                    </span>
                  ))}
                </div>
              </section>
            )}

            {/* Artifacts */}
            {task.artifacts && task.artifacts.length > 0 && (
              <section className="bg-augustus-bg-card border border-augustus-border rounded-md p-3 sm:p-4">
                <h2 className="text-sm font-semibold text-augustus-text mb-2">产出物</h2>
                <div className="space-y-1.5">
                  {task.artifacts.map((artifact, i) => {
                    const fileName = artifactFileName(artifact.uri);
                    const file = {
                      fileName,
                      localPath: artifact.uri,
                      size: 0,
                    };
                    return (
                      <FileCard
                        key={`${artifact.uri}-${i}`}
                        file={file}
                        description={artifact.description || artifact.type}
                        downloadUrl={artifactConversationId ? api.getFileUrl(fileName, artifactConversationId, "web", task.id) : undefined}
                        onPreview={artifactConversationId ? () => setPreviewFile(file) : undefined}
                        actionsAlwaysVisible
                      />
                    );
                  })}
                </div>
                {!artifactConversationId && (
                  <p className="mt-2 text-xs text-augustus-text-dim">
                    当前任务没有可用于读取文件的会话入口。
                  </p>
                )}
              </section>
            )}

            {/* Meta */}
            <section className="text-xs text-augustus-text-dim space-y-1">
              <p>任务 ID: <code className="text-augustus-text-muted">{task.id}</code></p>
              <p>创建者: {task.ownerUserId}</p>
              <p>更新于: {formatTime(task.updatedAt)}</p>
            </section>
          </div>
        </div>
      </div>
    </div>
  );
}
