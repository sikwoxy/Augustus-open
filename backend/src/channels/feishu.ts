import { Client, WSClient, EventDispatcher, Domain, LoggerLevel } from "@larksuiteoapi/node-sdk";
import * as fs from "node:fs";
import * as path from "node:path";
import type { AugustusRuntime, FileAttachment } from "@augustus/core";

export interface FeishuClientEnv {
  client: Client;
  ws: WSClient;
  dispatcher: EventDispatcher;
}

const FEISHU_TEXT_LIMIT = 3500;

function env(
  name: string,
  fallback?: string,
): string | undefined {
  return process.env[name] || fallback;
}

/** 初始化飞书 Client + WSClient + EventDispatcher。未配置凭据时返回 null。 */
export function createFeishuClients(): FeishuClientEnv | null {
  const appId = env("FEISHU_APP_ID");
  const appSecret = env("FEISHU_APP_SECRET");
  if (!appId || !appSecret) return null;

  const loggerLevel = LoggerLevel.info;
  const client = new Client({ appId, appSecret, domain: Domain.Feishu, loggerLevel });
  const ws = new WSClient({ appId, appSecret, domain: Domain.Feishu, loggerLevel });
  const dispatcher = new EventDispatcher({});
  return { client, ws, dispatcher };
}

/** 发送文本消息到会话（使用 create API，比 reply 更可靠） */
export async function sendText(chatId: string, text: string, client: Client): Promise<void> {
  const content = JSON.stringify({ text });
  await client.im.message.create({
    params: { receive_id_type: "chat_id" },
    data: { receive_id: chatId, content, msg_type: "text" },
  });
}

/** 上传图片到飞书，返回 image_key */
export async function uploadImage(filePath: string, client: Client): Promise<string> {
  const image = fs.createReadStream(filePath);
  const res = await client.im.image.create({
    data: { image_type: "message", image },
  });
  if (!res?.image_key) throw new Error("图片上传失败：未返回 image_key");
  return res.image_key;
}

/** 发送图片消息 */
export async function sendImage(chatId: string, imageKey: string, client: Client): Promise<void> {
  const content = JSON.stringify({ image_key: imageKey });
  await client.im.message.create({
    params: { receive_id_type: "chat_id" },
    data: { receive_id: chatId, content, msg_type: "image" },
  });
}

/** 扩展名 → 飞书 file_type。19 种常见类型。 */
export function getFileType(ext: string): string {
  const map: Record<string, string> = {
    opus: "opus", mp4: "mp4", pdf: "pdf", doc: "doc", docx: "doc",
    xls: "xls", xlsx: "xls", ppt: "ppt", pptx: "ppt", stream: "stream",
    csv: "stream", log: "stream", txt: "stream", json: "stream",
    md: "stream", yml: "stream", yaml: "stream", xml: "stream",
    html: "stream", htm: "stream",
  };
  return map[ext.toLowerCase()] ?? "stream";
}

/** 上传文件到飞书，返回 file_key */
export async function uploadFile(filePath: string, fileName: string, client: Client): Promise<string> {
  const ext = path.extname(fileName).replace(".", "").toLowerCase();
  const fileType = getFileType(ext);
  const file = fs.createReadStream(filePath);
  const res = await client.im.file.create({
    data: { file_type: fileType as "opus" | "mp4" | "pdf" | "doc" | "xls" | "ppt" | "stream", file_name: fileName, file },
  });
  if (!res?.file_key) throw new Error("文件上传失败：未返回 file_key");
  return res.file_key;
}

/** 发送文件消息 */
export async function sendFileMsg(chatId: string, fileKey: string, client: Client): Promise<void> {
  const content = JSON.stringify({ file_key: fileKey });
  await client.im.message.create({
    params: { receive_id_type: "chat_id" },
    data: { receive_id: chatId, content, msg_type: "file" },
  });
}

/** 下载用户发送的附件到本地目录 */
export async function downloadAttachment(
  messageId: string,
  fileKey: string,
  fileType: string,
  saveDir: string,
  client: Client,
): Promise<{ filePath: string; fileName: string }> {
  const res = await client.im.messageResource.get({
    params: { type: fileType },
    path: { message_id: messageId, file_key: fileKey },
  });

  let fileName = `${Date.now()}_attachment`;
  const disposition = res.headers?.["content-disposition"] as string | undefined;
  if (disposition) {
    const decoded = decodeContentDisposition(disposition);
    if (decoded) fileName = decoded;
  }

  fs.mkdirSync(saveDir, { recursive: true });
  const filePath = path.resolve(saveDir, fileName);
  await res.writeFile(filePath);
  return { filePath, fileName };
}

/**
 * 核心发送入口：使用 create API 发消息到会话（不依赖 reply 端点，更稳定）。
 * - text ≤ 3500 字符：直接 sendText
 * - text > 3500 字符：截断发送 + 完整文本落盘为 .md 文件发送
 * - 附带 files 时轮询上传后逐个发送
 */
export async function sendReply(
  chatId: string,
  text: string,
  filesDir: string,
  client: Client,
  replyFiles?: FileAttachment[],
): Promise<void> {
  if (text.length <= FEISHU_TEXT_LIMIT) {
    await sendText(chatId, text, client);
  } else {
    const truncated = text.slice(0, 3000) + "\n\n…（完整内容见文件）";
    await sendText(chatId, truncated, client);

    fs.mkdirSync(filesDir, { recursive: true });
    const fileName = `${Date.now()}_response.md`;
    const filePath = path.join(filesDir, fileName);
    fs.writeFileSync(filePath, text, "utf-8");
    const fileKey = await uploadFile(filePath, fileName, client);
    await sendFileMsg(chatId, fileKey, client);
  }

  if (replyFiles && replyFiles.length > 0) {
    for (const f of replyFiles) {
      try {
        const ext = path.extname(f.fileName).toLowerCase();
        if ([".png", ".jpg", ".jpeg", ".gif", ".webp", ".svg", ".bmp", ".ico", ".tiff"].includes(ext)) {
          const imageKey = await uploadImage(f.localPath, client);
          await sendImage(chatId, imageKey, client);
        } else {
          const fileKey = await uploadFile(f.localPath, f.fileName, client);
          await sendFileMsg(chatId, fileKey, client);
        }
      } catch {
        // 单个文件发送失败不影响回复文本已送达
      }
    }
  }
}

/** RFC 5987 + Latin-1 → UTF-8 中文文件名解码 */
export function decodeContentDisposition(header: string): string | null {
  // RFC 5987: filename*=UTF-8''encoded-name
  const rfc5987 = header.match(/filename\*=UTF-8''([^;]+)/i);
  if (rfc5987) {
    try {
      return decodeURIComponent(rfc5987[1].trim());
    } catch {
      return null;
    }
  }

  // Latin-1 fallback: filename="..."
  const latin1 = header.match(/filename="?([^";\s]+)"?/i);
  if (latin1) {
    try {
      return Buffer.from(latin1[1], "latin1").toString("utf-8");
    } catch {
      return latin1[1];
    }
  }

  return null;
}

/** 解析 /cmd 和 /cmd:topic 路由 */
export function parseRoute(msgText: string): { agentHint?: string; cleanText: string } {
  const trimmed = msgText.trim();
  const cmd = trimmed.match(/^\/([a-zA-Z0-9_]+)(?::(\S+))?\s*(.*)/s);
  if (cmd) {
    const agent = cmd[1].toLowerCase();
    const topic = cmd[2];
    const rest = cmd[3] || "";
    const agentHint = topic ? `${agent}:${topic}` : agent;
    return { agentHint, cleanText: rest };
  }
  return { cleanText: trimmed };
}
