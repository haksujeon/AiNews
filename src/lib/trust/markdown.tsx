/**
 * 아주 작은 마크다운 렌더러 (서버 컴포넌트용, P0-6 법무·소개 본문).
 *
 * HTML 문자열을 만들지 않고 React 요소를 돌려준다 — dangerouslySetInnerHTML 없음, 원문 HTML 은 글자로 나온다.
 * 지원: ## / ### 제목(# 은 ## 로 낮춘다 — 페이지의 h1 은 하나), 문단, - 목록, 1. 목록, ---, **굵게**, `코드`, [글](주소).
 * 링크는 https:, mailto:, 사이트 안 경로(/...)만 살린다. <!-- 주석 --> 은 지운다. {{이름}} 은 vars 로 바꾼다.
 */
import type { ReactNode } from "react";
import { Link } from "@/i18n/navigation";

export type MdBlock =
  | { type: "h2" | "h3" | "p"; text: string }
  | { type: "ul" | "ol"; items: string[] }
  | { type: "hr" };

/** {{name}} 치환. 없는 이름은 그대로 둔다 */
export function fillVars(src: string, vars: Record<string, string> = {}): string {
  return src.replace(/\{\{\s*([A-Za-z0-9_]+)\s*\}\}/g, (m, k: string) => (k in vars ? vars[k] : m));
}

export function parseMarkdown(src: string): MdBlock[] {
  const text = src.replace(/\r\n?/g, "\n").replace(/<!--[\s\S]*?-->/g, "");
  const blocks: MdBlock[] = [];
  let para: string[] = [];
  let list: { type: "ul" | "ol"; items: string[] } | null = null;

  const flush = () => {
    if (para.length) blocks.push({ type: "p", text: para.join(" ") });
    para = [];
    if (list) blocks.push(list);
    list = null;
  };

  for (const raw of text.split("\n")) {
    const line = raw.trim();
    if (!line) {
      flush();
      continue;
    }
    let m: RegExpMatchArray | null;
    if ((m = line.match(/^(#{1,6})\s+(.*)$/))) {
      flush();
      blocks.push({ type: m[1].length <= 2 ? "h2" : "h3", text: m[2].trim() });
    } else if (/^(-{3,}|\*{3,})$/.test(line)) {
      flush();
      blocks.push({ type: "hr" });
    } else if ((m = line.match(/^[-*]\s+(.*)$/)) || (m = line.match(/^\d+[.)]\s+(.*)$/))) {
      const type = /^\d/.test(line) ? "ol" : "ul";
      if (para.length) {
        blocks.push({ type: "p", text: para.join(" ") });
        para = [];
      }
      if (!list || list.type !== type) {
        if (list) blocks.push(list);
        list = { type, items: [] };
      }
      list.items.push(m[1]);
    } else if (list && /^\s{2,}/.test(raw)) {
      // 목록 항목의 이어지는 줄
      list.items[list.items.length - 1] += ` ${line}`;
    } else {
      if (list) {
        blocks.push(list);
        list = null;
      }
      para.push(line);
    }
  }
  flush();
  return blocks;
}

/** 허용하는 링크 주소인가 */
export function safeHref(href: string): string | null {
  const h = href.trim();
  if (/^https:\/\/[^\s]+$/i.test(h) || /^mailto:[^\s@]+@[^\s@]+$/i.test(h)) return h;
  if (/^\/(?!\/)[^\s]*$/.test(h)) return h;
  return null;
}

const INLINE_RE = /\*\*([^*]+)\*\*|`([^`]+)`|\[([^\]]+)\]\(([^)\s]+)\)/g;

const LINK_CLASS =
  "text-jade underline decoration-1 underline-offset-4 hover:decoration-2 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring rounded-sm";

export function renderInline(text: string, keyPrefix = "i"): ReactNode[] {
  const out: ReactNode[] = [];
  let last = 0;
  let n = 0;
  for (const m of text.matchAll(INLINE_RE)) {
    const i = m.index ?? 0;
    if (i > last) out.push(text.slice(last, i));
    const key = `${keyPrefix}-${n++}`;
    if (m[1] !== undefined) {
      out.push(
        <strong key={key} className="font-semibold text-ink">
          {m[1]}
        </strong>
      );
    } else if (m[2] !== undefined) {
      out.push(
        <code key={key} className="rounded-sm bg-surface px-1 py-0.5 text-[0.92em]">
          {m[2]}
        </code>
      );
    } else {
      const href = safeHref(m[4]);
      if (!href) out.push(m[3]);
      else if (href.startsWith("/"))
        out.push(
          <Link key={key} href={href} className={LINK_CLASS}>
            {m[3]}
          </Link>
        );
      else
        out.push(
          <a key={key} href={href} className={LINK_CLASS} {...(href.startsWith("https:") ? { rel: "noopener noreferrer", target: "_blank" } : {})}>
            {m[3]}
          </a>
        );
    }
    last = i + m[0].length;
  }
  if (last < text.length) out.push(text.slice(last));
  return out;
}

/** 본문 블록 → React (Briefing Desk 본문 활자) */
export function Markdown({ source, vars }: { source: string; vars?: Record<string, string> }) {
  const blocks = parseMarkdown(fillVars(source, vars));
  return (
    <div className="max-w-3xl text-[15.5px] leading-[1.8] text-ink-2">
      {blocks.map((b, i) => {
        const k = `b${i}`;
        switch (b.type) {
          case "h2":
            return (
              <h2 key={k} className="mt-10 border-b border-rule pb-2 text-[19px] font-bold leading-snug tracking-[-0.015em] text-ink first:mt-0 sm:text-[21px]">
                {renderInline(b.text, k)}
              </h2>
            );
          case "h3":
            return (
              <h3 key={k} className="mt-6 text-[16px] font-semibold leading-snug text-ink">
                {renderInline(b.text, k)}
              </h3>
            );
          case "p":
            return (
              <p key={k} className="mt-3">
                {renderInline(b.text, k)}
              </p>
            );
          case "ul":
          case "ol": {
            const List = b.type;
            return (
              <List key={k} className={`mt-3 space-y-1.5 pl-5 ${b.type === "ul" ? "list-disc" : "list-decimal"} marker:text-ink-3`}>
                {b.items.map((it, j) => (
                  <li key={j}>{renderInline(it, `${k}-${j}`)}</li>
                ))}
              </List>
            );
          }
          case "hr":
            return <hr key={k} className="my-8 border-rule" />;
        }
      })}
    </div>
  );
}
