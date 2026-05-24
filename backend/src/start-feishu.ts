// ═══════════════════════════════════════════════
// Feishu Bot 入口
//
// 职责：
//   1. 连接飞书 WebSocket
//   2. 接收消息 → 转换为 RuntimeEnvelope
//   3. 调用 Runtime.receive() 获取回复
//   4. 将回复发回飞书
//
// 与 server.ts 共享同一个 Runtime 实例。
// ═══════════════════════════════════════════════

import type { AugustusRuntime, FileAttachment } from "@augustus/core";
import * as os from "node:os";
import * as path from "node:path";
import { createFeishuClients, parseRoute, downloadAttachment, sendReply } from "./channels/feishu";
import type { FeishuClientEnv } from "./channels/feishu";

/**
 * 启动飞书 Bot（配置了就启动，没配置就跳过）。
 * 返回 stop 函数供 cli 层统一管理优雅关闭。
 */
export async function startFeishuBot(runtime: AugustusRuntime): Promise<() => void> {
  const noop = () => {};
  const env = createFeishuClients();
  if (!env) {
    console.log("[augustus] Feishu not configured (FEISHU_APP_ID/FEISHU_APP_SECRET missing), skipping");
    return noop;
  }

  console.log("[augustus] Feishu bot starting...");

  const queue = new SimpleSerialQueue();
  let accepting = true;

  const stop = () => {
    if (!accepting) return;
    accepting = false;
    console.log("[augustus] Feishu bot stopping, draining...");
    env.ws.close({ force: true });
  };

  // Register IM message event
  env.dispatcher.register({
    "im.message.receive_v1": async (data: Record<string, unknown>) => {
      if (!accepting) return;

      // im.message.receive_v1 通过 WebSocket 长连接接收时，数据没有外层 event 包装
      // message 和 sender 直接在根节点（HTTP webhook 才有 { event: {...} } 包装）
      const msgData = data as {
        sender?: { sender_id?: { open_id?: string; user_id?: string; union_id?: string } };
        message?: {
          message_id: string;
          chat_id: string;
          message_type: string;
          content: string;
        };
      };

      const msg = msgData.message;
      if (!msg) return;

      const senderId = msgData.sender?.sender_id?.open_id
        ?? msgData.sender?.sender_id?.user_id
        ?? "unknown";

      const messageId = msg.message_id;
      const chatId = msg.chat_id;
      const msgType = msg.message_type;

      // Serial queue: same chat_id runs sequentially
      queue.enqueue(`feishu:${chatId}`, async () => {
        try {
          const result = await handleMessage(env, runtime, messageId, chatId, senderId, msgType, msg.content);
          return result;
        } catch (err) {
          console.error("[augustus] Feishu message handler error:", err);
        }
      });
    },
  });

  try {
    await env.ws.start({ eventDispatcher: env.dispatcher });
    console.log("[augustus] Feishu bot connected");
  } catch (err) {
    console.error("[augustus] Feishu bot failed to connect:", err);
  }

  return stop;
}

/** Handle a single incoming Feishu message */
async function handleMessage(
  env: FeishuClientEnv,
  runtime: AugustusRuntime,
  messageId: string,
  chatId: string,
  senderId: string,
  msgType: string,
  content: string,
): Promise<void> {
  // Resolve upload directory: workspace _uploads/ if task exists, otherwise fallback
  async function resolveUploadDir(): Promise<string> {
    const dataDir = (await runtime.getStatus()).dataDir;
    const task = await runtime.getCurrentTask({ userId: senderId, channel: "feishu", conversationId: chatId });
    if (task) {
      const ref = task.workspaceRefs?.find((r) => r.kind === "task_workspace") ?? task.workspaceRefs?.find((r) => r.label === "default");
      if (ref) return path.resolve(ref.root, "_uploads");
    }
    return path.resolve(dataDir, "workspaces", senderId.replace(/[<>:"/\\|?*\s]+/g, "_"), chatId.replace(/[<>:"/\\|?*\s]+/g, "_"), "_uploads");
  }

  // ─── Parse content ───
  let userText = "";
  let files: FileAttachment[] = [];

  if (msgType === "text") {
    const parsed = JSON.parse(content);
    userText = parsed.text ?? "";
  } else if (msgType === "image") {
    const parsed = JSON.parse(content);
    const imageKey = parsed.image_key;
    if (imageKey) {
      try {
        const saveDir = await resolveUploadDir();
        const filePath = path.resolve(saveDir, `${Date.now()}_image`);
        await env.client.im.messageResource.get({
          params: { type: "image" },
          path: { message_id: messageId, file_key: imageKey },
        }).then((r) => r.writeFile(filePath));
        files.push({
          fileName: path.basename(filePath),
          localPath: filePath,
          size: 0,
          sourceKey: imageKey,
          sourceType: "image",
        });
        userText = "[用户发送了一张图片]";
      } catch {
        userText = "[用户发送了一张图片，但下载失败]";
      }
    }
  } else if (msgType === "file" || msgType === "audio" || msgType === "video" || msgType === "media") {
    const parsed = JSON.parse(content);
    const fileKey = parsed.file_key;
    if (fileKey) {
      try {
        const saveDir = await resolveUploadDir();
        const { filePath, fileName } = await downloadAttachment(messageId, fileKey, msgType, saveDir, env.client);
        files.push({
          fileName,
          localPath: filePath,
          size: 0,
          sourceKey: fileKey,
          sourceType: msgType === "audio" ? "audio" : msgType === "video" ? "video" : "file",
        });
        userText = msgType === "audio"
          ? `[用户发送了一条语音消息，文件: ${fileName}]`
          : msgType === "video"
            ? `[用户发送了一个视频，文件: ${fileName}]`
            : `[用户发送了文件: ${fileName}]`;
      } catch {
        userText = `[用户发送了${msgType === "audio" ? "语音" : msgType === "video" ? "视频" : "文件"}，但下载失败]`;
      }
    }
  } else {
    // 其他不支持的消息类型（如 sticker, post 等）忽略
    return;
  }

  if (!userText.trim()) return;

  // ─── Parse /cmd route ───
  const { agentHint, cleanText } = parseRoute(userText);

  // ─── Build envelope & call Runtime ───
  const result = await runtime.receive({
    channel: "feishu",
    userId: senderId,
    conversationId: chatId,
    text: cleanText,
    timestamp: Date.now(),
    agentHint,
    files: files.length > 0 ? files : undefined,
  });

  // ─── Reply via Feishu ───
  const tmpDir = os.tmpdir();
  await sendReply(chatId, result.text, tmpDir, env.client, result.replyFiles);
}

// Simple serial queue implementation (same algorithm as core SerialQueue,
// keeping it inline to avoid pulling in another dependency).
class SimpleSerialQueue {
  private queues = new Map<string, Promise<unknown>>();

  async enqueue<T>(key: string, fn: () => Promise<T>): Promise<T> {
    const prev = this.queues.get(key) ?? Promise.resolve();
    const task: Promise<T> = prev.catch(() => {}).then(() => fn());
    this.queues.set(key, task);
    task.finally(() => {
      if (this.queues.get(key) === task) {
        this.queues.delete(key);
      }
    });
    return task;
  }
}
