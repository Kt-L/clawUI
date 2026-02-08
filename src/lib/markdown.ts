import DOMPurify from "dompurify";
import { marked } from "marked";

function escapeHtml(input: string): string {
  return input
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

const renderer = new marked.Renderer();
renderer.link = (href, title, text) => {
  const safeHref = href ? escapeHtml(href) : "#";
  const safeTitle = title ? ` title="${escapeHtml(title)}"` : "";
  return `<a href="${safeHref}" target="_blank" rel="noopener noreferrer"${safeTitle}>${text}</a>`;
};
renderer.code = (code, infostring, escaped) => {
  const lang = (infostring || "").trim().split(/\s+/)[0] ?? "";
  const language = lang ? escapeHtml(lang) : "text";
  const body = escaped ? code : escapeHtml(code);
  return `<div class="md-code"><div class="md-code-head">${language}</div><pre><code class="language-${language}">${body}</code></pre></div>`;
};

marked.setOptions({
  breaks: true,
  gfm: true,
  renderer,
});

export function renderMarkdown(text: string): string {
  const html = marked.parse(text ?? "") as string;
  return DOMPurify.sanitize(html, {
    ALLOWED_ATTR: ["href", "target", "rel", "class", "src", "alt", "title", "type", "checked", "disabled"],
    ALLOWED_TAGS: [
      "p",
      "br",
      "em",
      "strong",
      "code",
      "pre",
      "a",
      "ul",
      "ol",
      "li",
      "blockquote",
      "h1",
      "h2",
      "h3",
      "h4",
      "h5",
      "h6",
      "hr",
      "img",
      "table",
      "thead",
      "tbody",
      "tr",
      "th",
      "td",
      "div",
      "span",
      "input"
    ],
  });
}
