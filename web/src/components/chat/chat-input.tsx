"use client";

import { useRef, useCallback } from "react";
import { AlertTriangle, Send, Paperclip, X } from "lucide-react";
import type { UploadedFile } from "@/components/file-upload";

interface Props {
  input: string;
  onInputChange: (value: string) => void;
  onSend: () => void;
  disabled: boolean;
  uploading: boolean;
  files: UploadedFile[];
  onFilesChange: (files: UploadedFile[]) => void;
}

const MAX_FILE_SIZE = 10 * 1024 * 1024; // 10MB

function looksLikeInstructionInjection(value: string): boolean {
  return [
    /"system"\s*:/i,
    /"role"\s*:\s*"system"/i,
    /"developer"\s*:/i,
    /<\s*system\s*>/i,
    /ignore\s+(all\s+)?previous\s+instructions/i,
    /忽略.*(之前|以上).*指令/,
    /你现在是\s*system/i,
  ].some((pattern) => pattern.test(value));
}

function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes}B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)}KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)}MB`;
}

export function ChatInput({
  input,
  onInputChange,
  onSend,
  disabled,
  uploading,
  files,
  onFilesChange,
}: Props) {
  const hasContent = input.trim().length > 0 || files.length > 0;
  const suspiciousInput = looksLikeInstructionInjection(input);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const handleFileChange = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      const newFiles = e.target.files;
      if (!newFiles || newFiles.length === 0) return;

      const existing = new Set(files.map((f) => f.file.name + f.file.size));
      const valid: UploadedFile[] = [];

      for (const f of Array.from(newFiles)) {
        if (f.size > MAX_FILE_SIZE) continue;
        if (existing.has(f.name + f.size)) continue;
        valid.push({ file: f, id: `${Date.now()}_${f.name}` });
      }

      if (valid.length > 0) {
        onFilesChange([...files, ...valid]);
      }

      // 重置 input 以允许重复选择同一文件
      e.target.value = "";
    },
    [files, onFilesChange],
  );

  const removeFile = useCallback(
    (id: string) => onFilesChange(files.filter((f) => f.id !== id)),
    [files, onFilesChange],
  );

  const triggerFilePick = useCallback(() => {
    fileInputRef.current?.click();
  }, []);

  return (
    <div className="bg-gradient-to-t from-augustus-bg via-augustus-bg/95 to-transparent pt-8 pb-4">
      <div className="lg:ml-80">
        <div className="max-w-4xl mx-auto px-4 space-y-3">
        {/* Hidden file input — always mounted so the paperclip button can trigger it */}
        <input
          ref={fileInputRef}
          type="file"
          className="hidden"
          multiple
          disabled={disabled || uploading}
          onChange={handleFileChange}
        />

        {/* Selected files chips */}
        {files.length > 0 && (
          <div className="flex items-center gap-2 flex-wrap">
            {files.map((f) => (
              <span
                key={f.id}
                className="inline-flex items-center gap-1 px-2 py-1 bg-augustus-bg-card border border-augustus-border rounded text-xs text-augustus-text-muted"
              >
                <Paperclip className="w-3 h-3 text-augustus-accent" />
                {f.file.name}
                <span className="text-augustus-text-dim">({formatSize(f.file.size)})</span>
                <button
                  onClick={() => removeFile(f.id)}
                  className="text-augustus-text-dim hover:text-red-400"
                  disabled={disabled || uploading}
                >
                  <X className="w-3 h-3" />
                </button>
              </span>
            ))}
            <button
              onClick={triggerFilePick}
              disabled={disabled || uploading}
              className="text-xs text-augustus-accent hover:text-augustus-accent-hover disabled:opacity-50"
            >
              + 添加文件
            </button>
          </div>
        )}

        {suspiciousInput && (
          <div className="flex items-center gap-2 rounded-md border border-augustus-accent-ring bg-augustus-accent-muted px-3 py-2 text-xs text-augustus-text-muted">
            <AlertTriangle className="h-3.5 w-3.5 flex-shrink-0 text-augustus-accent" />
            <span>检测到类似系统指令的内容；发送后只会作为普通用户消息处理。</span>
          </div>
        )}

        {/* Input row */}
        <div className="flex gap-2">
          <button
            onClick={triggerFilePick}
            disabled={disabled || uploading}
            className={`px-3 py-3 rounded-md transition-colors ${
              files.length > 0 || uploading
                ? "bg-augustus-accent-muted text-augustus-accent border border-augustus-accent-ring"
                : "text-augustus-text-dim hover:text-augustus-text-muted border border-transparent hover:border-augustus-border"
            }`}
            title="上传文件"
          >
            <Paperclip className="w-4 h-4" />
          </button>
          <input
            value={input}
            onChange={(e) => onInputChange(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey && !disabled && hasContent) {
                e.preventDefault();
                onSend();
              }
            }}
            placeholder="向 Augustus 下达指令..."
            disabled={disabled}
            className="flex-1 px-4 py-3 bg-augustus-input border border-augustus-border rounded-md text-sm text-augustus-text placeholder-augustus-text-dim focus:outline-none focus:border-augustus-accent-ring focus:ring-1 focus:ring-augustus-accent-ring transition-colors disabled:opacity-50"
          />
          <button
            onClick={onSend}
            disabled={!hasContent || disabled}
            className="px-5 py-3 bg-augustus-accent hover:bg-augustus-accent-hover disabled:bg-augustus-accent/20 text-black rounded-md transition-colors disabled:cursor-not-allowed"
          >
            <Send className="w-4 h-4" />
          </button>
        </div>
        </div>
      </div>
    </div>
  );
}
