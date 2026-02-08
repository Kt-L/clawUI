const THINKING_TAGS = /<\s*think(?:ing)?\s*>[\s\S]*?<\s*\/\s*think(?:ing)?\s*>/gi;
const AUDIO_TAG_RE = /\[\[\s*audio_as_voice\s*\]\]/gi;
const REPLY_TAG_RE = /\[\[\s*(?:reply_to_current|reply_to\s*:\s*[^\]\n]+)\s*\]\]/gi;

function stripInlineDirectives(text: string): string {
  return text
    .replace(AUDIO_TAG_RE, " ")
    .replace(REPLY_TAG_RE, " ")
    .replace(/[ \t]+/g, " ")
    .replace(/[ \t]*\n[ \t]*/g, "\n")
    .trim();
}

export function stripThinkingTags(text: string): string {
  return text.replace(THINKING_TAGS, "").trim();
}

function sanitizeAssistantText(text: string): string {
  return stripInlineDirectives(stripThinkingTags(text));
}

export function extractText(message: unknown): string | null {
  const m = message as Record<string, unknown>;
  const role = typeof m.role === "string" ? m.role : "";
  const content = m.content;
  if (typeof content === "string") {
    const processed = role === "assistant" ? sanitizeAssistantText(content) : content;
    return processed;
  }
  if (Array.isArray(content)) {
    const parts = content
      .map((p) => {
        const item = p as Record<string, unknown>;
        const type = typeof item.type === "string" ? item.type.toLowerCase() : "";
        if (
          (type === "text" || type === "output_text" || type === "input_text") &&
          typeof item.text === "string"
        ) {
          return item.text;
        }
        if (typeof item.content === "string") {
          return item.content;
        }
        return null;
      })
      .filter((v): v is string => typeof v === "string");
    if (parts.length > 0) {
      const joined = parts.join("\n");
      return role === "assistant" ? sanitizeAssistantText(joined) : joined;
    }
  }
  if (typeof m.text === "string") {
    return role === "assistant" ? sanitizeAssistantText(m.text) : m.text;
  }
  if (typeof m.output === "string") {
    return role === "assistant" ? sanitizeAssistantText(m.output) : m.output;
  }
  if (typeof m.response === "string") {
    return role === "assistant" ? sanitizeAssistantText(m.response) : m.response;
  }
  return null;
}

export function extractImages(message: unknown): Array<{ data: string; mimeType: string }> {
  const m = message as Record<string, unknown>;
  const content = m.content;
  if (!Array.isArray(content)) {
    return [];
  }
  const images: Array<{ data: string; mimeType: string }> = [];
  for (const part of content) {
    const item = part as Record<string, unknown>;
    if (item.type !== "image") {
      continue;
    }
    const source = item.source as Record<string, unknown> | undefined;
    if (!source) {
      continue;
    }
    const data = typeof source.data === "string" ? source.data : null;
    const mimeType = typeof source.media_type === "string" ? source.media_type : null;
    if (data && mimeType) {
      images.push({ data, mimeType });
    }
  }
  return images;
}

export function isToolMessage(message: unknown): boolean {
  const m = message as Record<string, unknown>;
  const role = typeof m.role === "string" ? m.role.toLowerCase() : "";
  if (role === "tool" || role === "toolresult" || role === "tool_result" || role === "function") {
    return true;
  }
  if (Array.isArray(m.tool_calls) && m.tool_calls.length > 0) {
    return true;
  }
  if (typeof m.toolCallId === "string" || typeof m.tool_call_id === "string") {
    return true;
  }
  const content = m.content;
  if (Array.isArray(content)) {
    return content.some((item) => {
      const entry = item as Record<string, unknown>;
      const type = typeof entry.type === "string" ? entry.type.toLowerCase() : "";
      return (
        type === "tool_use" ||
        type === "tooluse" ||
        type === "tool_call" ||
        type === "toolcall" ||
        type === "tool_result" ||
        type === "toolresult" ||
        type === "tool_response" ||
        type === "function_call" ||
        type === "function_result"
      );
    });
  }
  return false;
}
