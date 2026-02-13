import DOMPurify from "dompurify";
import katex from "katex";
import { Marked, Renderer } from "marked";
import markedKatex from "marked-katex-extension";

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
renderer.code = (code, infostring, escaped) => {
  const lang = (infostring || "").trim().split(/\s+/)[0] ?? "";
  const language = lang ? escapeHtml(lang) : "text";
  const body = escaped ? code : escapeHtml(code);
  return `<div class="md-code"><div class="md-code-head">${language}</div><pre><code class="language-${language}">${body}</code></pre></div>`;
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

markdownParser.use({
  extensions: [
    {
      level: "block",
      name: "mathFence",
      start(src: string) {
        const index = src.search(/ {0,3}(?:`{3,}|~{3,})\s*(?:katex|latex|math|tex)\b/i);
        return index >= 0 ? index : undefined;
      },
      tokenizer(src: string) {
        const match = src.match(
          /^ {0,3}(`{3,}|~{3,})\s*(?:katex|latex|math|tex)[^\n]*\n([\s\S]*?)\n {0,3}\1[ \t]*(?:\n|$)/i,
        );
        if (!match) {
          return;
        }
        return {
          displayMode: true,
          raw: match[0],
          text: match[2],
          type: "mathFence",
        };
      },
      renderer(token: MathToken) {
        return `${renderMath(token.text, true)}\n`;
      },
    },
    {
      level: "block",
      name: "mathBracketBlock",
      start(src: string) {
        const index = src.indexOf("\\[");
        return index >= 0 ? index : undefined;
      },
      tokenizer(src: string) {
        const match = src.match(/^ {0,3}\\\[\s*\n?([\s\S]+?)\n?\s*\\\](?:\n|$)/);
        if (!match) {
          return;
        }
        return {
          displayMode: true,
          raw: match[0],
          text: match[1],
          type: "mathBracketBlock",
        };
      },
      renderer(token: MathToken) {
        return `${renderMath(token.text, true)}\n`;
      },
    },
    {
      level: "block",
      name: "mathEnvironmentBlock",
      start(src: string) {
        const index = src.indexOf("\\begin{");
        return index >= 0 ? index : undefined;
      },
      tokenizer(src: string) {
        const match = src.match(/^ {0,3}(\\begin\{([A-Za-z*]+)\}[\s\S]+?\\end\{\2\})(?:\n|$)/);
        if (!match) {
          return;
        }
        if (!SUPPORTED_MATH_ENVIRONMENTS.has(match[2])) {
          return;
        }
        return {
          displayMode: true,
          raw: match[0],
          text: match[1],
          type: "mathEnvironmentBlock",
        };
      },
      renderer(token: MathToken) {
        return `${renderMath(token.text, true)}\n`;
      },
    },
    {
      level: "block",
      name: "mathTagBlock",
      start(src: string) {
        const index = src.toLowerCase().indexOf("[math]");
        return index >= 0 ? index : undefined;
      },
      tokenizer(src: string) {
        const match = src.match(/^\[math\]\s*\n?([\s\S]+?)\n?\[\/math\](?:\n|$)/i);
        if (!match) {
          return;
        }
        return {
          displayMode: true,
          raw: match[0],
          text: match[1],
          type: "mathTagBlock",
        };
      },
      renderer(token: MathToken) {
        return `${renderMath(token.text, true)}\n`;
      },
    },
    {
      level: "inline",
      name: "mathParenInline",
      start(src: string) {
        const index = src.indexOf("\\(");
        return index >= 0 ? index : undefined;
      },
      tokenizer(src: string) {
        const match = src.match(/^\\\(((?:\\.|[^\\\n])+?)\\\)/);
        if (!match) {
          return;
        }
        return {
          displayMode: false,
          raw: match[0],
          text: match[1],
          type: "mathParenInline",
        };
      },
      renderer(token: MathToken) {
        return renderMath(token.text, false);
      },
    },
    {
      level: "inline",
      name: "mathTagInline",
      start(src: string) {
        const index = src.toLowerCase().indexOf("[math]");
        return index >= 0 ? index : undefined;
      },
      tokenizer(src: string) {
        const match = src.match(/^\[math\]((?:\\.|[^\n])+?)\[\/math\]/i);
        if (!match) {
          return;
        }
        return {
          displayMode: false,
          raw: match[0],
          text: match[1],
          type: "mathTagInline",
        };
      },
      renderer(token: MathToken) {
        return renderMath(token.text, false);
      },
    },
  ],
});

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

export function renderMarkdown(text: string): string {
  const source = text ?? "";
  if (!source) {
    return "";
  }
  const cached = markdownHtmlCache.get(source);
  if (typeof cached === "string") {
    return cacheMarkdownHtml(source, cached);
  }
  const html = markdownParser.parse(source) as string;
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
      ...MATH_ALLOWED_ATTRS,
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
      ...MATH_ALLOWED_TAGS,
    ],
  });
  return cacheMarkdownHtml(source, sanitized);
}
