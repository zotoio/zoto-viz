import { marked, type Tokens } from "marked";

marked.use({
  gfm: true,
  breaks: true,
  renderer: {
    html() {
      return "";
    },
    image({ text }: Tokens.Image) {
      return escapeHtml(text);
    },
    link(this: { parser: { parseInline: (t: Tokens.Generic[]) => string } }, token: Tokens.Link) {
      const body = this.parser.parseInline(token.tokens);
      const href = safeHref(token.href);
      if (!href) return body;
      const title = token.title ? ` title="${escapeAttr(token.title)}"` : "";
      return `<a href="${escapeAttr(href)}" rel="noreferrer noopener" target="_blank"${title}>${body}</a>`;
    },
  },
});

function safeHref(href: string | null | undefined): string {
  const raw = String(href || "").trim();
  if (!/^https?:\/\//i.test(raw)) return "";
  try {
    const u = new URL(raw);
    if (u.protocol !== "http:" && u.protocol !== "https:") return "";
    return u.href;
  } catch {
    return "";
  }
}

function escapeHtml(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

function escapeAttr(s: string): string {
  return escapeHtml(s).replace(/"/g, "&quot;");
}

/** Markdown → HTML for agent replies and chain-of-thought. User lines stay plain text. */
export function renderMarkdown(src: string): string {
  const text = String(src || "");
  if (!text.trim()) return "";
  return marked.parse(text, { async: false }) as string;
}

export function fillMarkdown(el: Element, src: string): void {
  el.innerHTML = renderMarkdown(src);
}
