"use client";

import { useState, useRef, useCallback } from "react";
import { Upload, X, File as FileIcon } from "lucide-react";

export interface UploadedFile {
  file: File;
  id: string;
}

export interface FileUploadProps {
  files: UploadedFile[];
  onFilesChange: (files: UploadedFile[]) => void;
  maxSize?: number; // bytes, default 10MB
  accept?: string; // e.g. ".pdf,.txt,.html"
  disabled?: boolean;
  className?: string;
}

function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes}B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)}KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)}MB`;
}

export function FileUpload({
  files,
  onFilesChange,
  maxSize = 10 * 1024 * 1024,
  accept,
  disabled,
  className = "",
}: FileUploadProps) {
  const [isDragging, setIsDragging] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const addFiles = useCallback(
    (newFiles: FileList | File[]) => {
      setError(null);
      const existing = new Set(files.map((f) => f.file.name + f.file.size));
      const valid: UploadedFile[] = [];

      for (const f of Array.from(newFiles)) {
        if (f.size > maxSize) {
          setError(`"${f.name}" 超过 ${formatSize(maxSize)} 限制`);
          continue;
        }
        if (existing.has(f.name + f.size)) continue;
        valid.push({ file: f, id: `${Date.now()}_${f.name}` });
      }
      if (valid.length > 0) {
        onFilesChange([...files, ...valid]);
      }
    },
    [files, maxSize, onFilesChange],
  );

  const removeFile = useCallback(
    (id: string) => {
      onFilesChange(files.filter((f) => f.id !== id));
      setError(null);
    },
    [files, onFilesChange],
  );

  return (
    <div className={`space-y-2 ${className}`}>
      {/* Drop zone */}
      <div
        onDragOver={(e) => { e.preventDefault(); setIsDragging(true); }}
        onDragLeave={() => setIsDragging(false)}
        onDrop={(e) => {
          e.preventDefault();
          setIsDragging(false);
          if (!disabled) addFiles(e.dataTransfer.files);
        }}
        onClick={() => !disabled && inputRef.current?.click()}
        className={`
          border-2 border-dashed rounded-lg p-4 text-center cursor-pointer transition-colors
          ${isDragging ? "border-[#E8C96A] bg-[#E8C96A]/5" : "border-[#2A2A4A] hover:border-[#3A3A5A]"}
          ${disabled ? "opacity-50 cursor-not-allowed" : ""}
        `}
      >
        <Upload className="w-5 h-5 text-[#707090] mx-auto mb-1" />
        <p className="text-xs text-[#707090]">
          拖拽文件到此处，或点击选择
        </p>
        <p className="text-[10px] text-[#505070] mt-0.5">
          单个文件最大 {formatSize(maxSize)}
        </p>
        <input
          ref={inputRef}
          type="file"
          className="hidden"
          accept={accept}
          multiple
          disabled={disabled}
          onChange={(e) => e.target.files && addFiles(e.target.files)}
        />
      </div>

      {/* Error */}
      {error && (
        <p className="text-xs text-red-400">{error}</p>
      )}

      {/* File list */}
      {files.length > 0 && (
        <div className="space-y-1">
          {files.map((f) => (
            <div
              key={f.id}
              className="flex items-center gap-2 bg-[#0A0A1A] border border-[#1A1A2E] rounded px-3 py-1.5 text-xs"
            >
              <FileIcon className="w-3 h-3 text-[#C9A84C] shrink-0" />
              <span className="text-[#C0C0D0] truncate flex-1">{f.file.name}</span>
              <span className="text-[#505070] shrink-0">{formatSize(f.file.size)}</span>
              <button
                onClick={(e) => { e.stopPropagation(); removeFile(f.id); }}
                className="text-[#707090] hover:text-red-400 transition-colors shrink-0"
                disabled={disabled}
              >
                <X className="w-3 h-3" />
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
