"use client";

import Markdown, { type Components } from "react-markdown";
import remarkGfm from "remark-gfm";

// Raw HTML in the text is not rendered (react-markdown's default), so AI output cannot
// inject markup into the page.
const components: Components = {
  p: ({ children }) => <p className="my-1 break-words text-sm leading-6">{children}</p>,
  strong: ({ children }) => <strong className="font-semibold text-[#2f2a21]">{children}</strong>,
  em: ({ children }) => <em className="italic">{children}</em>,
  ul: ({ children }) => <ul className="my-1 list-disc space-y-0.5 pl-5 text-sm leading-6">{children}</ul>,
  ol: ({ children }) => <ol className="my-1 list-decimal space-y-0.5 pl-5 text-sm leading-6">{children}</ol>,
  li: ({ children }) => <li className="break-words">{children}</li>,
  h1: ({ children }) => <h3 className="mb-1 mt-2 text-base font-semibold">{children}</h3>,
  h2: ({ children }) => <h3 className="mb-1 mt-2 text-base font-semibold">{children}</h3>,
  h3: ({ children }) => <h4 className="mb-1 mt-2 text-sm font-semibold">{children}</h4>,
  a: ({ href, children }) => (
    <a href={href} target="_blank" rel="noopener noreferrer" className="text-[#1c4e98] underline">
      {children}
    </a>
  ),
  // Inline code is how record IDs are shown: small and muted so they don't dominate.
  code: ({ children, className }) =>
    className ? (
      <code className={`${className} font-mono text-xs`}>{children}</code>
    ) : (
      <code className="rounded bg-[#f3eee4] px-1 font-mono text-[11px] text-[#7d6f57]">{children}</code>
    ),
  pre: ({ children }) => (
    <pre className="my-2 overflow-x-auto rounded-lg bg-[#f6f1e7] p-2 text-xs leading-5">{children}</pre>
  ),
  table: ({ children }) => (
    <div className="my-2 overflow-x-auto rounded-lg border border-[#e3dbcf]">
      <table className="w-full border-collapse text-left text-xs">{children}</table>
    </div>
  ),
  thead: ({ children }) => <thead className="bg-[#f6f1e7] text-[#5f523d]">{children}</thead>,
  th: ({ children }) => <th className="whitespace-nowrap border-b border-[#e3dbcf] px-2 py-1.5 font-semibold">{children}</th>,
  td: ({ children }) => <td className="border-b border-[#eee7da] px-2 py-1.5 align-top">{children}</td>,
  hr: () => <hr className="my-2 border-[#e3dbcf]" />,
};

/** Renders an assistant/system chat message written in Markdown (lists, bold, tables). */
export default function MarkdownMessage({ text }: { text: string }) {
  return (
    <div className="min-w-0">
      <Markdown remarkPlugins={[remarkGfm]} components={components}>
        {text}
      </Markdown>
    </div>
  );
}
