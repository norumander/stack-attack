/**
 * Tiny markdown renderer — just enough for tutor replies.
 *
 * Supported:
 *   **bold**, *italic*, `inline code`
 *   bullet lists (lines starting with "- " or "* ")
 *   paragraphs (blank-line separated)
 *
 * Not supported: headings, links, images, block code, tables, HTML.
 * We intentionally escape all HTML before applying transformations to
 * prevent injection from the LLM.
 */

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function renderInline(s: string): string {
  let out = escapeHtml(s);
  // inline code first — content inside must not be re-processed, but since we
  // already escaped HTML and use placeholder-free regex, consecutive passes
  // are safe enough for our closed inline grammar.
  out = out.replace(/`([^`]+)`/g, "<code>$1</code>");
  out = out.replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>");
  out = out.replace(/(^|[^*])\*([^*\n]+)\*/g, "$1<em>$2</em>");
  return out;
}

export function renderMarkdown(markdown: string): string {
  const lines = markdown.replace(/\r\n/g, "\n").split("\n");
  const blocks: string[] = [];
  let paragraph: string[] = [];
  let list: string[] = [];

  function flushParagraph(): void {
    if (paragraph.length === 0) return;
    blocks.push(`<p>${paragraph.map(renderInline).join(" ")}</p>`);
    paragraph = [];
  }
  function flushList(): void {
    if (list.length === 0) return;
    const items = list.map((l) => `<li>${renderInline(l)}</li>`).join("");
    blocks.push(`<ul>${items}</ul>`);
    list = [];
  }

  for (const rawLine of lines) {
    const line = rawLine.replace(/\s+$/, "");
    if (line === "") {
      flushParagraph();
      flushList();
      continue;
    }
    const bulletMatch = /^[-*]\s+(.*)$/.exec(line);
    if (bulletMatch) {
      flushParagraph();
      list.push(bulletMatch[1] ?? "");
    } else {
      flushList();
      paragraph.push(line.trim());
    }
  }
  flushParagraph();
  flushList();

  return blocks.join("");
}
