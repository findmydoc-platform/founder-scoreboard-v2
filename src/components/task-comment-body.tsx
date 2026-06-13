"use client";

import Markdown, { type Components } from "react-markdown";
import remarkBreaks from "remark-breaks";
import remarkGfm from "remark-gfm";
import { GitHubCommentImage } from "@/components/github-comment-image";

function safeHref(value: unknown) {
  const href = String(value || "").trim();
  if (!href) return "";
  if (href.startsWith("#")) return href;
  try {
    const url = new URL(href);
    if (["http:", "https:", "mailto:"].includes(url.protocol)) return href;
  } catch {
    return "";
  }
  return "";
}

const markdownComponents: Components = {
  a({ href, children }) {
    const safe = safeHref(href);
    if (!safe) return <span>{children}</span>;
    const external = safe.startsWith("http://") || safe.startsWith("https://");
    return (
      <a
        href={safe}
        target={external ? "_blank" : undefined}
        rel={external ? "noreferrer" : undefined}
        className="font-semibold text-blue-600 underline-offset-2 [overflow-wrap:anywhere] hover:text-blue-700 hover:underline"
      >
        {children}
      </a>
    );
  },
  blockquote({ children }) {
    return (
      <blockquote className="my-3 border-l-4 border-slate-300 bg-slate-50 py-2 pl-3 pr-3 text-slate-700">
        {children}
      </blockquote>
    );
  },
  br() {
    return <br />;
  },
  code({ className, children }) {
    const value = String(children || "");
    const isBlock = value.includes("\n");
    return (
      <code
        className={isBlock
          ? `${className || ""} whitespace-pre font-mono text-xs`
          : `${className || ""} rounded bg-slate-100 px-1.5 py-0.5 font-mono text-[0.92em] text-slate-800`}
      >
        {children}
      </code>
    );
  },
  del({ children }) {
    return <del className="text-slate-500">{children}</del>;
  },
  h1({ children }) {
    return <h4 className="mb-2 mt-4 text-base font-semibold leading-6 text-slate-950 first:mt-0">{children}</h4>;
  },
  h2({ children }) {
    return <h4 className="mb-2 mt-4 text-base font-semibold leading-6 text-slate-950 first:mt-0">{children}</h4>;
  },
  h3({ children }) {
    return <h5 className="mb-2 mt-3 text-sm font-semibold leading-6 text-slate-950 first:mt-0">{children}</h5>;
  },
  h4({ children }) {
    return <h5 className="mb-2 mt-3 text-sm font-semibold leading-6 text-slate-900 first:mt-0">{children}</h5>;
  },
  h5({ children }) {
    return <h6 className="mb-2 mt-3 text-xs font-semibold uppercase text-slate-700 first:mt-0">{children}</h6>;
  },
  h6({ children }) {
    return <h6 className="mb-2 mt-3 text-xs font-semibold uppercase text-slate-600 first:mt-0">{children}</h6>;
  },
  hr() {
    return <hr className="my-4 border-slate-200" />;
  },
  img({ alt, src }) {
    const safe = safeHref(src);
    if (!safe || !safe.startsWith("http")) return null;
    return <GitHubCommentImage href={safe} alt={String(alt || "Anhang")} />;
  },
  input(props) {
    if (props.type !== "checkbox") return <input {...props} />;
    return (
      <input
        {...props}
        type="checkbox"
        disabled
        readOnly
        className="mr-2 h-3.5 w-3.5 rounded border-slate-300 align-[-2px]"
      />
    );
  },
  li({ children, className }) {
    return <li className={`${className || ""} my-1 min-w-0 pl-1 [overflow-wrap:anywhere]`}>{children}</li>;
  },
  ol({ children }) {
    return <ol className="my-2 min-w-0 list-decimal space-y-1 pl-5">{children}</ol>;
  },
  p({ children }) {
    return <p className="my-2 min-w-0 [overflow-wrap:anywhere] first:mt-0 last:mb-0">{children}</p>;
  },
  pre({ children }) {
    return (
      <div className="my-3 max-w-full overflow-x-auto rounded-md border border-slate-800 bg-slate-950">
        <pre className="min-w-max p-3 text-xs leading-5 text-slate-100">{children}</pre>
      </div>
    );
  },
  table({ children }) {
    return (
      <div className="my-3 max-w-full overflow-x-auto rounded-md border border-slate-200">
        <table className="min-w-full border-collapse text-left text-sm">{children}</table>
      </div>
    );
  },
  tbody({ children }) {
    return <tbody className="divide-y divide-slate-100">{children}</tbody>;
  },
  td({ children }) {
    return <td className="border-r border-slate-100 px-3 py-2 align-top last:border-r-0">{children}</td>;
  },
  th({ children }) {
    return <th className="border-r border-slate-200 bg-slate-50 px-3 py-2 font-semibold text-slate-800 last:border-r-0">{children}</th>;
  },
  thead({ children }) {
    return <thead className="border-b border-slate-200">{children}</thead>;
  },
  ul({ children, className }) {
    return <ul className={`${className || ""} my-2 min-w-0 list-disc space-y-1 pl-5`}>{children}</ul>;
  },
};

export function CommentBody({ value }: { value: string }) {
  return (
    <div className="mt-2 min-w-0 max-w-full overflow-hidden text-sm leading-6 text-slate-700 [overflow-wrap:anywhere]">
      <Markdown
        remarkPlugins={[remarkGfm, remarkBreaks]}
        skipHtml
        components={markdownComponents}
      >
        {value}
      </Markdown>
    </div>
  );
}
