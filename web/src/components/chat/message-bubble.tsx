"use client";

import { Bot, User } from "lucide-react";
import { MessageMarkdown } from "./message-markdown";
import { FileCard } from "@/components/file-card";

export interface BubbleMessage {
  role: "user" | "assistant";
  content: string;
  taskId?: string | null;
  timestamp?: string;
  replyFiles?: Array<{
    fileName: string;
    localPath: string;
    size: number;
    mimeType?: string;
    sourceType?: "file" | "image" | "audio" | "video";
  }>;
}

type ReplyFileItem = NonNullable<BubbleMessage["replyFiles"]>[number];

interface Props {
  message: BubbleMessage;
  getFileUrl: (fileName: string) => string;
  onPreviewFile?: (file: ReplyFileItem) => void;
}

export function MessageBubble({ message, getFileUrl, onPreviewFile }: Props) {
  const isUser = message.role === "user";

  return (
    <div className={`flex gap-3 ${isUser ? "flex-row-reverse" : ""}`}>
      {/* Avatar */}
      <div
        className={`flex-shrink-0 w-8 h-8 rounded-full flex items-center justify-center ${
          isUser
            ? "bg-augustus-accent-muted border border-augustus-accent-ring"
            : "bg-augustus-accent/10 border border-augustus-accent-ring"
        }`}
      >
        {isUser ? (
          <User className="w-4 h-4 text-augustus-accent" />
        ) : (
          <Bot className="w-4 h-4 text-augustus-accent" />
        )}
      </div>

      {/* Content */}
      <div className="max-w-[82%] min-w-0 space-y-2">
        {/* Text bubble */}
        {message.content && (
          <div
            className={`px-4 py-3 rounded-md ${
              isUser
                ? "bg-augustus-accent-muted border border-augustus-accent-ring text-augustus-text/90"
                : "bg-augustus-bg-card border border-augustus-border text-augustus-text/80"
            }`}
          >
            {isUser ? (
              <p className="text-sm whitespace-pre-wrap">{message.content}</p>
            ) : (
              <MessageMarkdown text={message.content} />
            )}
          </div>
        )}

        {/* Reply files */}
        {!isUser && message.replyFiles && message.replyFiles.length > 0 && (
          <div className="space-y-1">
            {message.replyFiles.map((f, j) => (
              <FileCard
                key={j}
                file={f}
                downloadUrl={getFileUrl(f.fileName)}
                onPreview={onPreviewFile ? (file) => onPreviewFile(file) : undefined}
              />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
