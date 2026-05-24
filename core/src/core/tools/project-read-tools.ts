import * as fs from "node:fs";
import * as path from "node:path";
import type { RegisteredTool } from "./registry";
import type { ToolRuntimeContext } from "./tool-context";
import type { WorkspacePermission } from "../task/types";
import {
  isInside,
  normalizeProjectRoot,
  resolveWorkspaceRootForPermission,
} from "./workspace-policy";

const DEFAULT_MAX_FILES = 100;
const MAX_FILES = 200;
const DEFAULT_MAX_RESULTS = 20;
const MAX_RESULTS = 50;
const MAX_READ_BYTES = 200 * 1024;
const MAX_CONTENT_CHARS = 12_000;
const MAX_SEARCH_FILE_BYTES = 200 * 1024;
const MAX_WRITE_BYTES = 500 * 1024;

const SKIP_DIR_NAMES = new Set(["node_modules", ".git", "dist", "temp", "_uploads", "_output"]);
const SENSITIVE_FILE_NAMES = new Set([
  ".env",
  ".env.local",
  ".env.production",
  ".env.development",
  ".npmrc",
  ".pypirc",
]);
const BINARY_EXTENSIONS = new Set([
  ".png", ".jpg", ".jpeg", ".gif", ".webp", ".ico", ".bmp", ".tiff",
  ".pdf", ".doc", ".docx", ".xls", ".xlsx", ".ppt", ".pptx",
  ".zip", ".tar", ".gz", ".7z", ".rar",
  ".exe", ".dll", ".so", ".dylib",
  ".mp3", ".mp4", ".mov", ".avi", ".mkv", ".webm", ".wav", ".ogg",
  ".ttf", ".otf", ".woff", ".woff2",
]);

function clampNumber(value: unknown, fallback: number, min: number, max: number): number {
  const n = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(n)) return fallback;
  return Math.max(min, Math.min(max, Math.floor(n)));
}

async function resolveProjectRootForPermission(
  context: ToolRuntimeContext,
  permission: WorkspacePermission,
): Promise<string> {
  return resolveWorkspaceRootForPermission(context, permission);
}

function resolveInsideProject(projectRoot: string, inputPath?: string): string {
  const base = normalizeProjectRoot(projectRoot);
  const resolved = inputPath
    ? path.resolve(base, inputPath)
    : base;

  if (!isInside(base, resolved)) {
    throw new Error("Path escapes project root");
  }
  return resolved;
}

function toRelative(projectRoot: string, filePath: string): string {
  return path.relative(projectRoot, filePath).split(path.sep).join("/");
}

function shouldSkipDirectory(projectRoot: string, dirPath: string): boolean {
  const name = path.basename(dirPath);
  if (SKIP_DIR_NAMES.has(name)) return true;

  const relative = toRelative(projectRoot, dirPath);
  return relative === ".augustus/files" || relative.startsWith(".augustus/files/");
}

function isProbablyBinaryByExtension(filePath: string): boolean {
  return BINARY_EXTENSIONS.has(path.extname(filePath).toLowerCase());
}

function isSensitiveFileName(filePath: string): boolean {
  const name = path.basename(filePath).toLowerCase();
  return SENSITIVE_FILE_NAMES.has(name) || /\.(pem|key|p12|pfx)$/i.test(name);
}

function bufferLooksBinary(buffer: Buffer): boolean {
  const len = Math.min(buffer.length, 512);
  for (let i = 0; i < len; i++) {
    if (buffer[i] === 0) return true;
  }
  return false;
}

function wildcardToRegExp(pattern: string): RegExp {
  const escaped = pattern.replace(/[.+^${}()|[\]\\]/g, "\\$&");
  const wildcarded = escaped.replace(/\*/g, ".*").replace(/\?/g, ".");
  return new RegExp(wildcarded, "i");
}

function matchesPattern(relativePath: string, pattern?: string): boolean {
  if (!pattern || !pattern.trim()) return true;
  const trimmed = pattern.trim();
  if (trimmed.includes("*") || trimmed.includes("?")) {
    return wildcardToRegExp(trimmed).test(relativePath);
  }
  return relativePath.toLowerCase().includes(trimmed.toLowerCase());
}

async function collectFiles(
  projectRoot: string,
  startDir: string,
  maxFiles: number,
  pattern?: string,
): Promise<string[]> {
  const results: string[] = [];
  const queue = [startDir];

  while (queue.length > 0 && results.length < maxFiles) {
    const current = queue.shift()!;
    let entries: fs.Dirent[];
    try {
      entries = await fs.promises.readdir(current, { withFileTypes: true });
    } catch {
      continue;
    }

    entries.sort((a, b) => a.name.localeCompare(b.name));

    for (const entry of entries) {
      const fullPath = path.join(current, entry.name);
      if (entry.isDirectory()) {
        if (!shouldSkipDirectory(projectRoot, fullPath)) {
          queue.push(fullPath);
        }
        continue;
      }

      if (!entry.isFile()) continue;
      if (isSensitiveFileName(fullPath)) continue;

      const relative = toRelative(projectRoot, fullPath);
      if (matchesPattern(relative, pattern)) {
        results.push(relative);
        if (results.length >= maxFiles) break;
      }
    }
  }

  return results;
}

async function listProjectFiles(projectRoot: string, args: Record<string, unknown>): Promise<string> {
  const maxFiles = clampNumber(args.max_files, DEFAULT_MAX_FILES, 1, MAX_FILES);
  const root = typeof args.root === "string" && args.root.trim() ? args.root.trim() : undefined;
  const pattern = typeof args.pattern === "string" ? args.pattern : undefined;
  const startDir = resolveInsideProject(projectRoot, root);

  const stat = await fs.promises.stat(startDir).catch(() => null);
  if (!stat || !stat.isDirectory()) {
    return JSON.stringify({ success: false, message: "root is not a project directory" });
  }

  const files = await collectFiles(normalizeProjectRoot(projectRoot), startDir, maxFiles, pattern);
  return JSON.stringify({
    success: true,
    root: toRelative(normalizeProjectRoot(projectRoot), startDir) || ".",
    count: files.length,
    truncated: files.length >= maxFiles,
    files,
  });
}

async function readProjectFile(projectRoot: string, args: Record<string, unknown>): Promise<string> {
  const rawPath = typeof args.file_path === "string" ? args.file_path.trim() : "";
  if (!rawPath) {
    return JSON.stringify({ success: false, message: "file_path is required" });
  }

  const base = normalizeProjectRoot(projectRoot);
  const filePath = resolveInsideProject(base, rawPath);
  const stat = await fs.promises.stat(filePath).catch(() => null);

  if (!stat || !stat.isFile()) {
    return JSON.stringify({ success: false, message: "file does not exist or is not a file" });
  }
  if (isSensitiveFileName(filePath)) {
    return JSON.stringify({ success: false, message: "sensitive file is not readable" });
  }
  if (stat.size > MAX_READ_BYTES) {
    return JSON.stringify({
      success: false,
      message: `file is too large; max ${MAX_READ_BYTES} bytes`,
      size: stat.size,
    });
  }
  if (isProbablyBinaryByExtension(filePath)) {
    return JSON.stringify({ success: false, message: "binary file is not readable" });
  }

  const buffer = await fs.promises.readFile(filePath);
  if (bufferLooksBinary(buffer)) {
    return JSON.stringify({ success: false, message: "binary file is not readable" });
  }

  const content = buffer.toString("utf-8");
  const truncated = content.length > MAX_CONTENT_CHARS;
  return JSON.stringify({
    success: true,
    file_path: toRelative(base, filePath),
    size: stat.size,
    truncated,
    content: truncated ? content.slice(0, MAX_CONTENT_CHARS) : content,
  });
}

async function searchProject(projectRoot: string, args: Record<string, unknown>): Promise<string> {
  const query = typeof args.query === "string" ? args.query : "";
  if (!query.trim()) {
    return JSON.stringify({ success: false, message: "query is required" });
  }

  const maxResults = clampNumber(args.max_results, DEFAULT_MAX_RESULTS, 1, MAX_RESULTS);
  const base = normalizeProjectRoot(projectRoot);
  const files = await collectFiles(base, base, Number.MAX_SAFE_INTEGER);
  const needle = query.toLowerCase();
  const results: Array<{ file_path: string; line: number; preview: string }> = [];

  for (const relative of files) {
    if (results.length >= maxResults) break;

    const filePath = path.join(base, relative);
    if (isProbablyBinaryByExtension(filePath)) continue;

    const stat = await fs.promises.stat(filePath).catch(() => null);
    if (!stat || !stat.isFile() || stat.size > MAX_SEARCH_FILE_BYTES) continue;

    const buffer = await fs.promises.readFile(filePath).catch(() => null);
    if (!buffer || bufferLooksBinary(buffer)) continue;

    const lines = buffer.toString("utf-8").split(/\r?\n/);
    for (let i = 0; i < lines.length; i++) {
      if (lines[i].toLowerCase().includes(needle)) {
        results.push({
          file_path: relative,
          line: i + 1,
          preview: lines[i].trim().slice(0, 240),
        });
        if (results.length >= maxResults) break;
      }
    }
  }

  return JSON.stringify({
    success: true,
    query,
    count: results.length,
    truncated: results.length >= maxResults,
    results,
  });
}

async function statProjectFile(projectRoot: string, args: Record<string, unknown>): Promise<string> {
  const rawPath = typeof args.file_path === "string" ? args.file_path.trim() : "";
  if (!rawPath) {
    return JSON.stringify({ success: false, message: "file_path is required" });
  }

  const base = normalizeProjectRoot(projectRoot);
  const filePath = resolveInsideProject(base, rawPath);
  const stat = await fs.promises.stat(filePath).catch(() => null);
  if (!stat) {
    return JSON.stringify({ success: false, message: "path does not exist" });
  }
  if (stat.isFile() && isSensitiveFileName(filePath)) {
    return JSON.stringify({ success: false, message: "sensitive file is not inspectable" });
  }

  return JSON.stringify({
    success: true,
    file_path: toRelative(base, filePath) || ".",
    type: stat.isDirectory() ? "directory" : stat.isFile() ? "file" : "other",
    size: stat.size,
    modified_at: stat.mtimeMs,
    created_at: stat.birthtimeMs,
    binary: stat.isFile() ? isProbablyBinaryByExtension(filePath) : false,
  });
}

async function writeProjectFile(projectRoot: string, args: Record<string, unknown>): Promise<string> {
  const rawPath = typeof args.file_path === "string" ? args.file_path.trim() : "";
  const content = typeof args.content === "string" ? args.content : undefined;
  const overwrite = args.overwrite === true;
  const createDirs = args.create_dirs !== false;

  if (!rawPath) {
    return JSON.stringify({ success: false, message: "file_path is required" });
  }
  if (content === undefined) {
    return JSON.stringify({ success: false, message: "content is required" });
  }
  if (Buffer.byteLength(content, "utf-8") > MAX_WRITE_BYTES) {
    return JSON.stringify({ success: false, message: `content is too large; max ${MAX_WRITE_BYTES} bytes` });
  }

  const base = normalizeProjectRoot(projectRoot);
  const filePath = resolveInsideProject(base, rawPath);
  if (isSensitiveFileName(filePath)) {
    return JSON.stringify({ success: false, message: "sensitive file paths are not writable through this tool" });
  }
  if (isProbablyBinaryByExtension(filePath)) {
    return JSON.stringify({ success: false, message: "binary file paths are not writable through this tool" });
  }

  const existing = await fs.promises.stat(filePath).catch(() => null);
  if (existing?.isDirectory()) {
    return JSON.stringify({ success: false, message: "target is a directory" });
  }
  if (existing && !overwrite) {
    return JSON.stringify({ success: false, message: "file exists; set overwrite=true to replace it" });
  }

  if (createDirs) {
    await fs.promises.mkdir(path.dirname(filePath), { recursive: true });
  }
  await fs.promises.writeFile(filePath, content, "utf-8");
  const stat = await fs.promises.stat(filePath);
  return JSON.stringify({
    success: true,
    file_path: toRelative(base, filePath),
    size: stat.size,
    overwritten: Boolean(existing),
  });
}

async function applyProjectPatch(projectRoot: string, args: Record<string, unknown>): Promise<string> {
  const rawPath = typeof args.file_path === "string" ? args.file_path.trim() : "";
  const oldText = typeof args.old_text === "string" ? args.old_text : "";
  const newText = typeof args.new_text === "string" ? args.new_text : undefined;
  const expected = clampNumber(args.expected_replacements, 1, 1, 100);

  if (!rawPath) {
    return JSON.stringify({ success: false, message: "file_path is required" });
  }
  if (!oldText) {
    return JSON.stringify({ success: false, message: "old_text is required and cannot be empty" });
  }
  if (newText === undefined) {
    return JSON.stringify({ success: false, message: "new_text is required" });
  }

  const base = normalizeProjectRoot(projectRoot);
  const filePath = resolveInsideProject(base, rawPath);
  if (isSensitiveFileName(filePath)) {
    return JSON.stringify({ success: false, message: "sensitive file is not patchable" });
  }
  const stat = await fs.promises.stat(filePath).catch(() => null);
  if (!stat || !stat.isFile()) {
    return JSON.stringify({ success: false, message: "file does not exist or is not a file" });
  }
  if (stat.size > MAX_WRITE_BYTES) {
    return JSON.stringify({ success: false, message: `file is too large; max ${MAX_WRITE_BYTES} bytes` });
  }
  if (isProbablyBinaryByExtension(filePath)) {
    return JSON.stringify({ success: false, message: "binary file is not patchable" });
  }

  const original = await fs.promises.readFile(filePath, "utf-8");
  const occurrences = countOccurrences(original, oldText);
  if (occurrences !== expected) {
    return JSON.stringify({
      success: false,
      message: `replacement count mismatch; expected ${expected}, found ${occurrences}`,
      occurrences,
    });
  }

  const updated = original.split(oldText).join(newText);
  await fs.promises.writeFile(filePath, updated, "utf-8");
  return JSON.stringify({
    success: true,
    file_path: toRelative(base, filePath),
    replacements: occurrences,
    size_before: Buffer.byteLength(original, "utf-8"),
    size_after: Buffer.byteLength(updated, "utf-8"),
  });
}

function countOccurrences(source: string, needle: string): number {
  let count = 0;
  let index = 0;
  while (true) {
    const found = source.indexOf(needle, index);
    if (found < 0) return count;
    count++;
    index = found + needle.length;
  }
}

export function createProjectReadTools(context: ToolRuntimeContext): RegisteredTool[] {
  return [
    {
      name: "list_project_files",
      description:
        "List files under the project root. Supports optional root, pattern, and max_files. Read-only; skips node_modules, .git, dist, temp, _uploads, _output, and .augustus/files.",
      parameters: {
        type: "object",
        properties: {
          root: { type: "string", description: "Optional project-relative directory to list." },
          pattern: { type: "string", description: "Optional substring or wildcard pattern, such as *.ts." },
          max_files: { type: "number", description: "Maximum files to return, capped at 200." },
        },
      },
      risk: "read",
      scopes: ["project"],
      handler: async (_name, args) => {
        try {
          const projectRoot = await resolveProjectRootForPermission(context, "read");
          return await listProjectFiles(projectRoot, args);
        } catch (err) {
          const message = err instanceof Error ? err.message : String(err);
          return JSON.stringify({ success: false, message });
        }
      },
    },
    {
      name: "read_project_file",
      description:
        "Read a text file inside the project root. Rejects path escape, binary files, and files over 200KB. Returns at most 12000 characters.",
      parameters: {
        type: "object",
        properties: {
          file_path: { type: "string", description: "Project-relative file path to read." },
        },
        required: ["file_path"],
      },
      risk: "read",
      scopes: ["project"],
      handler: async (_name, args) => {
        try {
          const projectRoot = await resolveProjectRootForPermission(context, "read");
          return await readProjectFile(projectRoot, args);
        } catch (err) {
          const message = err instanceof Error ? err.message : String(err);
          return JSON.stringify({ success: false, message });
        }
      },
    },
    {
      name: "search_project",
      description:
        "Search text files inside the project root for a query. Read-only; skips binary and large files. Returns at most 50 matches.",
      parameters: {
        type: "object",
        properties: {
          query: { type: "string", description: "Text to search for." },
          max_results: { type: "number", description: "Maximum matches to return, capped at 50." },
        },
        required: ["query"],
      },
      risk: "read",
      scopes: ["project"],
      handler: async (_name, args) => {
        try {
          const projectRoot = await resolveProjectRootForPermission(context, "read");
          return await searchProject(projectRoot, args);
        } catch (err) {
          const message = err instanceof Error ? err.message : String(err);
          return JSON.stringify({ success: false, message });
        }
      },
    },
    {
      name: "stat_project_file",
      description:
        "Return metadata for a project-relative file or directory. Rejects paths outside the project root.",
      parameters: {
        type: "object",
        properties: {
          file_path: { type: "string", description: "Project-relative path to inspect." },
        },
        required: ["file_path"],
      },
      risk: "read",
      scopes: ["project"],
      handler: async (_name, args) => {
        try {
          const projectRoot = await resolveProjectRootForPermission(context, "read");
          return await statProjectFile(projectRoot, args);
        } catch (err) {
          const message = err instanceof Error ? err.message : String(err);
          return JSON.stringify({ success: false, message });
        }
      },
    },
    {
      name: "write_project_file",
      description:
        "Write a UTF-8 text file inside the project root. Refuses path escape and common binary extensions. Existing files require overwrite=true.",
      parameters: {
        type: "object",
        properties: {
          file_path: { type: "string", description: "Project-relative file path to write." },
          content: { type: "string", description: "UTF-8 text content." },
          overwrite: { type: "boolean", description: "Set true to replace an existing file." },
          create_dirs: { type: "boolean", description: "Create parent directories; defaults to true." },
        },
        required: ["file_path", "content"],
      },
      risk: "write",
      scopes: ["project"],
      handler: async (_name, args) => {
        try {
          const projectRoot = await resolveProjectRootForPermission(context, "write");
          return await writeProjectFile(projectRoot, args);
        } catch (err) {
          const message = err instanceof Error ? err.message : String(err);
          return JSON.stringify({ success: false, message });
        }
      },
    },
    {
      name: "apply_project_patch",
      description:
        "Patch a UTF-8 project file by replacing old_text with new_text. Requires an exact expected replacement count.",
      parameters: {
        type: "object",
        properties: {
          file_path: { type: "string", description: "Project-relative file path to patch." },
          old_text: { type: "string", description: "Exact text to replace." },
          new_text: { type: "string", description: "Replacement text." },
          expected_replacements: { type: "number", description: "Expected number of replacements; defaults to 1." },
        },
        required: ["file_path", "old_text", "new_text"],
      },
      risk: "write",
      scopes: ["project"],
      handler: async (_name, args) => {
        try {
          const projectRoot = await resolveProjectRootForPermission(context, "write");
          return await applyProjectPatch(projectRoot, args);
        } catch (err) {
          const message = err instanceof Error ? err.message : String(err);
          return JSON.stringify({ success: false, message });
        }
      },
    },
  ];
}
