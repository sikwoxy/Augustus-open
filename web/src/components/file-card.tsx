"use client";

import { Download, Eye, FileCode, FileText, FileImage } from "lucide-react";

export interface ReplyFile {
  fileName: string;
  localPath: string;
  size: number;
  mimeType?: string;
  sourceKey?: string;
  sourceType?: "file" | "image" | "audio" | "video";
}

export interface FileCardProps {
  file: ReplyFile;
  downloadUrl?: string;
  onPreview?: (file: ReplyFile) => void;
  description?: string;
  actionsAlwaysVisible?: boolean;
  className?: string;
}

function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes}B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)}KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)}MB`;
}

function getFileIcon(fileName: string) {
  const ext = fileName.split(".").pop()?.toLowerCase();
  switch (ext) {
    case "html":
    case "htm":
      return <FileCode className="w-4 h-4 text-augustus-accent" />;
    case "png":
    case "jpg":
    case "jpeg":
    case "gif":
    case "svg":
      return <FileImage className="w-4 h-4 text-augustus-accent" />;
    case "md":
    case "txt":
    case "json":
    case "csv":
      return <FileText className="w-4 h-4 text-augustus-accent" />;
    default:
      return <FileCode className="w-4 h-4 text-augustus-text-muted" />;
  }
}

function isPreviewable(fileName: string): boolean {
  const ext = fileName.split(".").pop()?.toLowerCase();
  return ["html", "htm", "svg", "png", "jpg", "jpeg", "gif", "txt", "md", "json"].includes(ext ?? "");
}

function displayName(fileName: string): string {
  return fileName.replace(/^\d{10,13}_/, "");
}

export function FileCard({
  file,
  downloadUrl,
  onPreview,
  description,
  actionsAlwaysVisible = false,
  className = "",
}: FileCardProps) {
  const name = displayName(file.fileName);
  const handleDownload = () => {
    if (downloadUrl) {
      window.open(downloadUrl, "_blank");
    }
  };

  return (
    <div
      className={`group flex items-center gap-2 rounded-md border border-augustus-border bg-augustus-bg-card px-3 py-2 transition-colors hover:border-augustus-border-hover sm:gap-3 ${className}`}
    >
      {getFileIcon(file.fileName)}
      <div className="flex-1 min-w-0">
        <p className="text-sm text-augustus-text/85 truncate">{name}</p>
        {description ? (
          <p className="text-[11px] text-augustus-text-muted line-clamp-2">{description}</p>
        ) : file.size > 0 ? (
          <p className="text-[10px] text-augustus-text-dim">{formatSize(file.size)}</p>
        ) : null}
      </div>
      <div
        className={`flex items-center gap-1 transition-opacity ${
          actionsAlwaysVisible ? "opacity-100" : "opacity-100 sm:opacity-0 sm:group-hover:opacity-100"
        }`}
      >
        {isPreviewable(file.fileName) && onPreview && (
          <button
            onClick={() => onPreview(file)}
            className="p-1.5 rounded text-augustus-accent transition-colors hover:bg-augustus-accent-muted hover:text-augustus-accent-hover"
            title="预览"
          >
            <Eye className="w-3.5 h-3.5" />
          </button>
        )}
        {downloadUrl && (
          <button
            onClick={handleDownload}
            className="p-1.5 rounded text-augustus-text-muted transition-colors hover:bg-augustus-accent-muted hover:text-augustus-accent"
            title="下载"
          >
            <Download className="w-3.5 h-3.5" />
          </button>
        )}
      </div>
    </div>
  );
}
