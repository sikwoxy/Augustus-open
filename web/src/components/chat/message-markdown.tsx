"use client";

import { useMemo } from "react";
import ReactMarkdown, { type Components } from "react-markdown";
import remarkGfm from "remark-gfm";

const components: Components = {
  h1: ({ children }) => (
    <h3 className="text-augustus-accent font-semibold mt-4 mb-2 text-base">{children}</h3>
  ),
  h2: ({ children }) => (
    <h3 className="text-augustus-accent font-semibold mt-4 mb-2 text-base">{children}</h3>
  ),
  h3: ({ children }) => (
    <h4 className="text-augustus-accent font-semibold mt-4 mb-1.5 text-sm">{children}</h4>
  ),
  h4: ({ children }) => (
    <h4 className="text-augustus-accent font-semibold mt-4 mb-1.5 text-sm">{children}</h4>
  ),
  strong: ({ children }) => (
    <strong className="text-augustus-text font-semibold">{children}</strong>
  ),
  code: ({ className, children, ...props }) => {
    // 代码块（有 language class）vs 行内代码
    const isBlock = className?.startsWith("language-");
    if (isBlock) {
      return (
        <pre className="bg-augustus-input rounded-md p-4 overflow-x-auto my-3 border border-augustus-border">
          <code className={`text-sm text-augustus-text/80 font-mono ${className ?? ""}`} {...props}>
            {children}
          </code>
        </pre>
      );
    }
    return (
      <code className="bg-augustus-accent-muted text-augustus-accent px-1 py-0.5 rounded text-sm font-mono">
        {children}
      </code>
    );
  },
  hr: () => <hr className="border-augustus-border my-4" />,
  ul: ({ children }) => (
    <ul className="list-disc ml-4 space-y-0.5 my-2">{children}</ul>
  ),
  ol: ({ children }) => (
    <ol className="list-decimal ml-4 space-y-0.5 my-2">{children}</ol>
  ),
  li: ({ children }) => (
    <li className="text-augustus-text/80">{children}</li>
  ),
  table: ({ children }) => (
    <div className="overflow-x-auto my-3">
      <table className="w-full border-collapse border border-augustus-border rounded overflow-hidden">
        {children}
      </table>
    </div>
  ),
  thead: ({ children }) => (
    <thead className="bg-augustus-accent-muted">{children}</thead>
  ),
  th: ({ children }) => (
    <th className="border border-augustus-border px-3 py-2 text-sm text-augustus-accent font-semibold text-left">
      {children}
    </th>
  ),
  td: ({ children }) => (
    <td className="border border-augustus-border px-3 py-1.5 text-sm text-augustus-text/80">
      {children}
    </td>
  ),
  p: ({ children }) => (
    <p className="text-augustus-text/80 leading-relaxed">{children}</p>
  ),
  a: ({ children, href }) => (
    <a href={href} className="text-augustus-accent underline hover:text-augustus-accent-hover" target="_blank" rel="noopener noreferrer">
      {children}
    </a>
  ),
};

export function MessageMarkdown({ text }: { text: string }) {
  const content = useMemo(() => text, [text]);

  return (
    <div className="text-sm leading-relaxed space-y-1">
      <ReactMarkdown remarkPlugins={[remarkGfm]} components={components}>
        {content}
      </ReactMarkdown>
    </div>
  );
}
