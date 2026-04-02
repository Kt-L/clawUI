import DOMPurify from "dompurify";
import katex from "katex";
import { Marked, Renderer } from "marked";
import markedKatex from "marked-katex-extension";
import mermaid from "mermaid";

function escapeHtml(input: string): string {
  return input
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

type MathToken = {
  text: string;
  displayMode?: boolean;
};

const SUPPORTED_MATH_ENVIRONMENTS = new Set<string>([
  "array",
  "aligned",
  "align",
  "align*",
  "bmatrix",
  "Bmatrix",
  "cases",
  "eqnarray",
  "eqnarray*",
  "equation",
  "equation*",
  "flalign",
  "flalign*",
  "gather",
  "gather*",
  "matrix",
  "multline",
  "multline*",
  "pmatrix",
  "smallmatrix",
  "split",
  "vmatrix",
  "Vmatrix",
]);

const MATH_ALLOWED_TAGS = [
  "math",
  "annotation",
  "annotation-xml",
  "menclose",
  "merror",
  "mfenced",
  "mfrac",
  "mglyph",
  "mi",
  "mlabeledtr",
  "mmultiscripts",
  "mn",
  "mo",
  "mover",
  "mpadded",
  "mphantom",
  "mprescripts",
  "mroot",
  "mrow",
  "ms",
  "msqrt",
  "mspace",
  "mstyle",
  "msub",
  "msubsup",
  "msup",
  "mtable",
  "mtd",
  "mtext",
  "mtr",
  "munder",
  "munderover",
  "none",
  "semantics",
];

const MATH_ALLOWED_ATTRS = [
  "aria-hidden",
  "columnspan",
  "display",
  "encoding",
  "mathcolor",
  "mathsize",
  "mathvariant",
  "rowspan",
  "scriptlevel",
  "style",
  "xmlns",
];

const SVG_ALLOWED_TAGS = ["svg", "path", "line", "rect", "circle", "g", "use", "defs", "clipPath"];

const SVG_ALLOWED_ATTRS = [
  "viewBox",
  "preserveAspectRatio",
  "d",
  "fill",
  "stroke",
  "stroke-width",
  "fill-rule",
  "clip-path",
  "clip-rule",
  "transform",
  "width",
  "height",
  "x",
  "y",
  "x1",
  "y1",
  "x2",
  "y2",
];

function renderMath(text: string, displayMode: boolean): string {
  try {
    return katex.renderToString(text.trim(), {
      displayMode,
      output: "htmlAndMathml",
      strict: "warn",
      throwOnError: false,
      trust: false,
    });
  } catch {
    return `<code class="md-math-fallback">${escapeHtml(text)}</code>`;
  }
}

const renderer = new Renderer();
renderer.link = (href, title, text) => {
  const safeHref = href ? escapeHtml(href) : "#";
  const safeTitle = title ? ` title="${escapeHtml(title)}"` : "";
  return `<a href="${safeHref}" target="_blank" rel="noopener noreferrer"${safeTitle}>${text}</a>`;
};
renderer.code = (code: string, infostring: string, escaped: boolean) => {
  const lang = (infostring || "").trim().split(/\\s+/)[0] ?? "";
  // Handle mermaid blocks specially
  if (lang.toLowerCase() === "mermaid") {
    // ⚡ STOP AT FIRST closing fence, don't be greedy
    let trimmedCode = code.trim();
    const closeFenceIdx = trimmedCode.indexOf('```');
    if (closeFenceIdx === -1) {
      const tildeIdx = trimmedCode.indexOf('~~~');
      if (tildeIdx >= 0) {
        trimmedCode = trimmedCode.substring(0, tildeIdx).trim();
      }
    } else {
      trimmedCode = trimmedCode.substring(0, closeFenceIdx).trim();
    }
    
    if (!trimmedCode) {
      return `<pre><code class="language-mermaid">${escapeHtml(code)}</code></pre>\n`;
    }
    const id = `mermaid-${Math.random().toString(36).substring(7)}`;
    // Store mermaid code in data attribute to preserve newlines
    const escapedCode = escapeHtml(trimmedCode).replace(/\n/g, '&#10;').replace(/\r/g, '').replace(/\u2028/g, '&#8232;');
    return `<div class="mermaid" data-mermaid-id="${id}" data-mermaid-code="${escapedCode}">${trimmedCode}</div>\n`;
  }
  const language = lang ? escapeHtml(lang) : "text";
  const body = escaped ? code : escapeHtml(code);
  return `<div class="md-code"><div class="md-code-head"><span>${language}</span><button type="button" class="md-code-copy" title="Copy code">Copy</button></div><pre><code class="language-${language}">${body}</code></pre></div>`;
};

const markdownParser = new Marked({
  breaks: true,
  gfm: true,
  renderer,
});

markdownParser.use(
  markedKatex({
    nonStandard: true,
    output: "htmlAndMathml",
    strict: "warn",
    throwOnError: false,
    trust: false,
  }),
);

const MARKDOWN_CACHE_LIMIT = 240;
const markdownHtmlCache = new Map<string, string>();

function cacheMarkdownHtml(source: string, html: string): string {
  if (markdownHtmlCache.has(source)) {
    markdownHtmlCache.delete(source);
  }
  markdownHtmlCache.set(source, html);
  if (markdownHtmlCache.size > MARKDOWN_CACHE_LIMIT) {
    const oldestKey = markdownHtmlCache.keys().next().value;
    if (typeof oldestKey === "string") {
      markdownHtmlCache.delete(oldestKey);
    }
  }
  return html;
}

export function renderMarkdown(text: unknown): string {
  const source = typeof text === "string" ? text : "";
  if (!source) {
    return "";
  }
  
  // ⚡ Normalize all line separators BEFORE markdown parsing
  const normalizedSource = source
    .replace(/\r\n/g, '\n')
    .replace(/\r/g, '\n')
    .replace(/[\u2028\u2029\u0085]/g, '\n');
  
  const cached = markdownHtmlCache.get(normalizedSource);
  if (typeof cached === "string") {
    return cacheMarkdownHtml(normalizedSource, cached);
  }
  
  const html = markdownParser.parse(normalizedSource) as string;
  
  const sanitized = DOMPurify.sanitize(html, {
    ALLOWED_ATTR: [
      "href",
      "target",
      "rel",
      "class",
      "src",
      "alt",
      "title",
      "type",
      "checked",
      "disabled",
      "data-mermaid-id",
      "data-mermaid-code",
      "style", // Allow inline styles for error messages
      ...MATH_ALLOWED_ATTRS,
      ...SVG_ALLOWED_ATTRS,
    ],
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
      "input",
      "button",
      "details", // For collapsible error messages
      "summary", // For collapsible error messages
      ...MATH_ALLOWED_TAGS,
      ...SVG_ALLOWED_TAGS,
    ],
  });
  return cacheMarkdownHtml(normalizedSource, sanitized);
}
