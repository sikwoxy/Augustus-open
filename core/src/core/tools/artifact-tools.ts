import * as fs from "node:fs";
import * as path from "node:path";
import type { RegisteredTool } from "./registry";
import type { ToolRuntimeContext } from "./tool-context";
import { getCurrentTaskWorkspaceRoot, isInside } from "./workspace-policy";

const MAX_READ_CHARS = 8000;
const MAX_READ_BYTES = 2 * 1024 * 1024;
const BINARY_EXTS = new Set([
  ".pdf", ".docx", ".doc", ".xlsx", ".xls", ".pptx", ".ppt",
  ".png", ".jpg", ".jpeg", ".gif", ".webp", ".svg",
  ".mp3", ".mp4", ".ogg", ".opus", ".wav", ".avi",
  ".zip", ".tar", ".gz", ".7z", ".rar",
  ".exe", ".dll", ".so", ".dylib",
]);

// ─── 路径解析 ───

function outputDir(workspaceRoot: string): string {
  return path.join(workspaceRoot, "_output");
}

function uploadsDir(workspaceRoot: string): string {
  return path.join(workspaceRoot, "_uploads");
}

/** 在 workspace 内搜索文件（_output → _uploads → workspace root） */
function findInWorkspace(workspaceRoot: string, fileName: string): string | null {
  const searchDirs = [outputDir(workspaceRoot), uploadsDir(workspaceRoot), workspaceRoot];
  for (const dir of searchDirs) {
    if (!fs.existsSync(dir)) continue;
    const entries = fs.readdirSync(dir);
    const match = entries.find((e) => e.endsWith(fileName));
    if (match) return path.join(dir, match);
  }
  return null;
}

function resolveReadableFile(input: string): string {
  const raw = input.trim();
  return path.isAbsolute(raw) ? path.resolve(raw) : path.resolve(raw);
}

function safeFileName(fileName: string): string {
  return fileName.replace(/[<>:"/\\|?*]/g, "_");
}

function isSensitiveFileName(filePath: string): boolean {
  const name = path.basename(filePath).toLowerCase();
  return name.startsWith(".env") || name.includes("_.env") || name === ".npmrc" || /\.(pem|key|p12|pfx)$/i.test(name);
}

/** 检查给定路径是否在 dataDir/files/ 的 staging 区域（无活跃任务时的降级上传位置） */
function stagingRoot(context: ToolRuntimeContext): string {
  return path.join(context.dataDir, "files");
}

function isInStaging(context: ToolRuntimeContext, filePath: string): boolean {
  return isInside(stagingRoot(context), filePath);
}

// ─── 工具实现 ───

async function readFileTool(context: ToolRuntimeContext, args: Record<string, unknown>): Promise<string> {
  const rawPath = typeof args.file_path === "string" ? args.file_path.trim() : "";
  if (!rawPath) {
    return JSON.stringify({ success: false, message: "file_path is required" });
  }

  const workspaceRoot = await getCurrentTaskWorkspaceRoot(context);
  const normalizedPath = resolveReadableFile(rawPath);
  const inStaging = isInStaging(context, normalizedPath);

  if (workspaceRoot && !isInside(workspaceRoot, normalizedPath) && !inStaging) {
    return JSON.stringify({
      success: false,
      message: `安全限制：只能读取 ${workspaceRoot}/ 目录下的文件`,
    });
  }

  if (!workspaceRoot && !inStaging) {
    return JSON.stringify({ success: false, message: "read_file 需要当前有活跃任务及其 workspace" });
  }

  if (!fs.existsSync(normalizedPath)) {
    return JSON.stringify({ success: false, message: `文件不存在: ${rawPath}` });
  }

  const stat = fs.statSync(normalizedPath);
  if (stat.isDirectory()) {
    return JSON.stringify({ success: false, message: "不支持读取目录，请指定具体文件路径" });
  }

  const ext = path.extname(normalizedPath).toLowerCase();
  if (isSensitiveFileName(normalizedPath)) {
    return JSON.stringify({ success: false, message: "sensitive file is not readable" });
  }
  if (BINARY_EXTS.has(ext)) {
    const sizeKB = (stat.size / 1024).toFixed(1);
    return JSON.stringify({
      success: false,
      message: `此文件为二进制格式 (${ext})，暂不支持直接读取。文件大小: ${sizeKB} KB`,
    });
  }

  if (stat.size > MAX_READ_BYTES) {
    return JSON.stringify({
      success: false,
      message: `文件过大 (${(stat.size / 1024 / 1024).toFixed(1)} MB)，最大支持 2 MB`,
    });
  }

  try {
    const content = fs.readFileSync(normalizedPath, "utf-8");
    const truncated = content.length > MAX_READ_CHARS
      ? content.slice(0, MAX_READ_CHARS) + `\n\n... (已截断，总长度 ${content.length} 字符)`
      : content;
    return JSON.stringify({
      success: true,
      file_path: rawPath,
      size: stat.size,
      content: truncated,
    });
  } catch {
    return JSON.stringify({ success: false, message: "文件读取失败，可能是编码不兼容" });
  }
}

async function writeFileTool(context: ToolRuntimeContext, args: Record<string, unknown>): Promise<string> {
  if (typeof args.file_name !== "string" || args.file_name.trim() === "") {
    return JSON.stringify({ success: false, message: "write_file 缺少必填参数 file_name" });
  }
  if (typeof args.content !== "string" || args.content.length === 0) {
    return JSON.stringify({ success: false, message: "write_file 缺少必填参数 content，且内容不能为空" });
  }

  const workspaceRoot = await getCurrentTaskWorkspaceRoot(context);
  if (!workspaceRoot) {
    return JSON.stringify({ success: false, message: "write_file 需要当前有活跃任务及其 workspace" });
  }

  const outDir = outputDir(workspaceRoot);
  fs.mkdirSync(outDir, { recursive: true });

  const cleanName = safeFileName(args.file_name);
  if (isSensitiveFileName(cleanName)) {
    return JSON.stringify({ success: false, message: "sensitive file names are not writable through this tool" });
  }
  const fileName = `${Date.now()}_${cleanName}`;
  const filePath = path.join(outDir, fileName);

  try {
    fs.writeFileSync(filePath, args.content, "utf-8");
    const stat = fs.statSync(filePath);
    return JSON.stringify({
      success: true,
      file_path: filePath,
      file_name: cleanName,
      size: stat.size,
      message: `文件已创建: ${cleanName} (${stat.size} 字节)，位于 workspace _output/ 目录`,
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return JSON.stringify({ success: false, message: `文件写入失败: ${msg}` });
  }
}

async function sendFileTool(context: ToolRuntimeContext, args: Record<string, unknown>): Promise<string> {
  const workspaceRoot = await getCurrentTaskWorkspaceRoot(context);
  if (!workspaceRoot) {
    return JSON.stringify({ success: false, message: "send_file 需要当前有活跃任务及其 workspace" });
  }

  let sourcePath: string | null = null;

  if (typeof args.file_path === "string" && args.file_path.trim()) {
    sourcePath = args.file_path.trim();
    if (!path.isAbsolute(sourcePath)) {
      sourcePath = path.resolve(sourcePath);
    }
    sourcePath = path.resolve(sourcePath);

    if (!isInside(workspaceRoot, sourcePath)) {
      return JSON.stringify({
        success: false,
        message: `send_file can only send files from ${workspaceRoot}`,
      });
    }
    if (!fs.existsSync(sourcePath)) {
      return JSON.stringify({ success: false, message: `文件不存在: ${args.file_path}` });
    }
  } else if (typeof args.file_name === "string" && args.file_name.trim()) {
    sourcePath = findInWorkspace(workspaceRoot, args.file_name);
    if (!sourcePath) {
      return JSON.stringify({
        success: false,
        message: `未找到文件: ${args.file_name}（在 ${workspaceRoot}/_output, ${workspaceRoot}/_uploads 中搜索）`,
      });
    }
  } else {
    return JSON.stringify({ success: false, message: "请提供 file_path 或 file_name 参数" });
  }

  const stat = fs.statSync(sourcePath);
  const fileName = path.basename(sourcePath);
  if (isSensitiveFileName(fileName)) {
    return JSON.stringify({ success: false, message: "sensitive file is not sendable" });
  }

  if (context.addReplyFile) {
    context.addReplyFile({ fileName, localPath: sourcePath, size: stat.size });
    return JSON.stringify({
      success: true,
      file_name: fileName,
      message: `文件 ${fileName} 已加入发送队列，回复用户时将一并发送`,
    });
  }

  return JSON.stringify({
    success: true,
    file_name: fileName,
    file_path: sourcePath,
    message: `文件已标记待发送: ${sourcePath}，请主 Agent 使用 send_file 发送`,
  });
}

// ─── 工具注册 ───

export function createArtifactTools(context: ToolRuntimeContext): RegisteredTool[] {
  return [
    {
      name: "read_file",
      description:
        "读取当前任务 workspace 下的文本文件。支持 _uploads/ 和 _output/ 子目录；拒绝常见二进制文件。",
      parameters: {
        type: "object",
        properties: {
          file_path: { type: "string", description: "文件在 workspace 下的路径，如 _uploads/report.pdf 或 _output/123_report.md" },
        },
        required: ["file_path"],
      },
      risk: "read",
      scopes: ["artifact"],
      handler: async (_name, args) => readFileTool(context, args),
    },
    {
      name: "write_file",
      description:
        "将内容写入当前任务 workspace 的 _output/ 目录，返回绝对路径。用于生成报告、代码或文档产物；不要用于修改项目源码。",
      parameters: {
        type: "object",
        properties: {
          content: { type: "string", description: "要写入的文件内容" },
          file_name: { type: "string", description: "文件名，如 report.md、script.py。若重名会自动添加时间戳" },
        },
        required: ["content", "file_name"],
      },
      risk: "write",
      scopes: ["artifact"],
      handler: async (_name, args) => writeFileTool(context, args),
    },
    {
      name: "send_file",
      description:
        "将文件发送给用户（通过当前渠道）。可通过 file_path 指定已存在的文件路径，或通过 file_name 在 workspace 的 _output/ 和 _uploads/ 目录中按文件名搜索已有文件。",
      parameters: {
        type: "object",
        properties: {
          file_path: { type: "string", description: "由 write_file 返回的文件路径（绝对路径）" },
          file_name: { type: "string", description: "文件名，如 report.md、script.py，在 workspace 中按后缀匹配搜索" },
        },
      },
      risk: "external_send",
      scopes: ["artifact"],
      handler: async (_name, args) => sendFileTool(context, args),
    },
  ];
}
