const THINKING_TAGS = /<\s*think(?:ing)?\s*>[\s\S]*?<\s*\/\s*think(?:ing)?\s*>/gi;
const AUDIO_TAG_RE = /\[\[\s*audio_as_voice\s*\]\]/gi;
const REPLY_TAG_RE = /\[\[\s*(?:reply_to_current|reply_to\s*:\s*[^\]\n]+)\s*\]\]/gi;

// OpenClaw injects envelope metadata into user messages:
//   System: [timestamp] ...  (system events)
//   Conversation info (untrusted metadata): ```json { ... } ```
//   [Day YYYY-MM-DD HH:MM TZ] actual user text
// Strip everything up to and including the envelope, leaving only the user's real content.
const OPENCLAW_ENVELOPE_RE =
  /^[\s\S]*?Conversation info \(untrusted metadata\):\s*```json?\s*\{[\s\S]*?\}\s*```\s*/i;
const TIMESTAMP_PREFIX_RE =
  /^\[(?:Mon|Tue|Wed|Thu|Fri|Sat|Sun)\s+\d{4}-\d{2}-\d{2}\s+\d{1,2}:\d{2}(?:\s+[^\]]+)?\]\s*/i;

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

function sanitizeUserText(text: string): string {
  let cleaned = text;
  // Strip OpenClaw envelope: system events + conversation info metadata block
  cleaned = cleaned.replace(OPENCLAW_ENVELOPE_RE, "");
  // Strip timestamp prefix like [Wed 2026-02-18 19:21 GMT+1]
  cleaned = cleaned.replace(TIMESTAMP_PREFIX_RE, "");
  return cleaned.trim();
}

export function extractText(message: unknown): string | null {
  if (!message || typeof message !== "object") {
    return null;
  }
  const m = message as Record<string, unknown>;
  const role = typeof m.role === "string" ? m.role : "";
  const content = m.content;
  if (typeof content === "string") {
    const processed = role === "assistant" ? sanitizeAssistantText(content) : role === "user" ? sanitizeUserText(content) : content;
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
      return role === "assistant" ? sanitizeAssistantText(joined) : role === "user" ? sanitizeUserText(joined) : joined;
    }
  }
  if (typeof m.text === "string") {
    return role === "assistant" ? sanitizeAssistantText(m.text) : role === "user" ? sanitizeUserText(m.text) : m.text;
  }
  if (typeof m.output === "string") {
    return role === "assistant" ? sanitizeAssistantText(m.output) : role === "user" ? sanitizeUserText(m.output) : m.output;
  }
  if (typeof m.response === "string") {
    return role === "assistant" ? sanitizeAssistantText(m.response) : role === "user" ? sanitizeUserText(m.response) : m.response;
  }
  return null;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function pickString(source: Record<string, unknown>, keys: string[]): string | null {
  for (const key of keys) {
    const value = source[key];
    if (typeof value === "string" && value.trim()) {
      return value.trim();
    }
  }
  return null;
}

function normalizeImageMimeType(value: string | null | undefined): string | null {
  const normalized = value?.trim().toLowerCase() ?? "";
  if (!normalized) {
    return null;
  }
  if (normalized.startsWith("image/")) {
    return normalized;
  }
  if (normalized === "png") {
    return "image/png";
  }
  if (normalized === "jpg" || normalized === "jpeg") {
    return "image/jpeg";
  }
  if (normalized === "gif") {
    return "image/gif";
  }
  if (normalized === "webp") {
    return "image/webp";
  }
  if (normalized === "bmp") {
    return "image/bmp";
  }
  if (normalized === "svg" || normalized === "svg+xml") {
    return "image/svg+xml";
  }
  return null;
}

function inferMimeTypeFromUrl(value: string): string | null {
  const trimmed = value.trim();
  if (!trimmed) {
    return null;
  }
  const dataMatch = /^data:(image\/[^;,]+)[;,]/i.exec(trimmed);
  if (dataMatch?.[1]) {
    return normalizeImageMimeType(dataMatch[1]);
  }
  const withoutQuery = trimmed.split("?")[0]?.split("#")[0] ?? "";
  const ext = withoutQuery.split(".").pop()?.toLowerCase() ?? "";
  if (ext === "png") {
    return "image/png";
  }
  if (ext === "jpg" || ext === "jpeg") {
    return "image/jpeg";
  }
  if (ext === "gif") {
    return "image/gif";
  }
  if (ext === "webp") {
    return "image/webp";
  }
  if (ext === "bmp") {
    return "image/bmp";
  }
  if (ext === "svg") {
    return "image/svg+xml";
  }
  return null;
}

function looksLikeImageUrl(value: string): boolean {
  const trimmed = value.trim();
  if (!trimmed) {
    return false;
  }
  if (/^data:image\//i.test(trimmed)) {
    return true;
  }
  if (/^(https?:|blob:|file:)/i.test(trimmed)) {
    return true;
  }
  if (trimmed.startsWith("/")) {
    return Boolean(inferMimeTypeFromUrl(trimmed));
  }
  return Boolean(inferMimeTypeFromUrl(trimmed));
}

function looksLikeBase64(value: string): boolean {
  const compact = value.replace(/\s+/g, "");
  if (compact.length < 32 || compact.length % 4 === 1) {
    return false;
  }
  return /^[A-Za-z0-9+/]+=*$/.test(compact);
}

export function extractImages(message: unknown): Array<{ data: string; mimeType: string }> {
  const images: Array<{ data: string; mimeType: string }> = [];
  const seenValues = new Set<unknown>();
  const seenImageKeys = new Set<string>();
  const MAX_TRAVERSE_DEPTH = 6;
  const MAX_TRAVERSE_NODES = 500;
  const MAX_IMAGES_PER_MESSAGE = 12;
  const MAX_IMAGE_DATA_CHARS = 8_000_000;
  const FINGERPRINT_HEAD = 96;
  const FINGERPRINT_TAIL = 64;
  const queue: Array<{ value: unknown; depth: number }> = [{ value: message, depth: 0 }];
  let traversed = 0;

  const pushImage = (rawData: string, mimeHint: string | null) => {
    if (images.length >= MAX_IMAGES_PER_MESSAGE) {
      return;
    }
    const data = rawData.trim();
    if (!data) {
      return;
    }
    if (data.length > MAX_IMAGE_DATA_CHARS) {
      return;
    }
    const inferredMime = normalizeImageMimeType(mimeHint) ?? inferMimeTypeFromUrl(data);
    if (!inferredMime) {
      return;
    }
    const head = data.slice(0, FINGERPRINT_HEAD);
    const tail = data.length > FINGERPRINT_HEAD + FINGERPRINT_TAIL ? data.slice(-FINGERPRINT_TAIL) : "";
    const imageKey = `${inferredMime}:${data.length}:${head}:${tail}`;
    if (seenImageKeys.has(imageKey)) {
      return;
    }
    seenImageKeys.add(imageKey);
    images.push({ data, mimeType: inferredMime });
  };

  while (queue.length > 0 && traversed < MAX_TRAVERSE_NODES) {
    const currentNode = queue.shift();
    if (!currentNode) {
      continue;
    }
    traversed += 1;
    const { value: current, depth } = currentNode;
    if (current === null || current === undefined || seenValues.has(current)) {
      continue;
    }
    seenValues.add(current);
    if (Array.isArray(current)) {
      if (depth < MAX_TRAVERSE_DEPTH) {
        for (const item of current) {
          queue.push({ value: item, depth: depth + 1 });
        }
      }
      continue;
    }
    if (!isRecord(current)) {
      continue;
    }

    const type = pickString(current, ["type"])?.toLowerCase() ?? "";
    const mime =
      normalizeImageMimeType(
        pickString(current, [
          "media_type",
          "mimeType",
          "mime_type",
          "contentType",
          "content_type",
          "format",
        ]),
      ) ?? (type.includes("image") ? "image/png" : null);
    const hasImageHint =
      type.includes("image") || Object.keys(current).some((key) => key.toLowerCase().includes("image"));

    const nestedSource = current.source;
    if (isRecord(nestedSource)) {
      const sourceMime =
        normalizeImageMimeType(
          pickString(nestedSource, ["media_type", "mimeType", "mime_type", "contentType", "content_type"]),
        ) ?? mime;
      const sourceData = pickString(nestedSource, ["data", "base64", "b64_json", "image_base64"]);
      if (sourceData && (looksLikeImageUrl(sourceData) || looksLikeBase64(sourceData))) {
        pushImage(sourceData, sourceMime);
      }
      const sourceUrl = pickString(nestedSource, ["url", "uri", "src", "href"]);
      if (sourceUrl && looksLikeImageUrl(sourceUrl)) {
        pushImage(sourceUrl, sourceMime);
      }
    }

    const imageUrlValue = current.image_url ?? current.imageUrl;
    if (typeof imageUrlValue === "string" && looksLikeImageUrl(imageUrlValue)) {
      pushImage(imageUrlValue, mime);
    } else if (isRecord(imageUrlValue)) {
      const imageUrl = pickString(imageUrlValue, ["url", "uri", "src", "href"]);
      if (imageUrl && looksLikeImageUrl(imageUrl)) {
        pushImage(imageUrl, mime);
      }
    }

    const url = pickString(current, ["url", "uri", "src", "href"]);
    if (url && looksLikeImageUrl(url) && (hasImageHint || Boolean(inferMimeTypeFromUrl(url)))) {
      pushImage(url, mime);
    }

    const directData = pickString(current, ["data", "base64", "b64_json", "image_base64", "imageBase64"]);
    if (directData && (looksLikeImageUrl(directData) || (hasImageHint && looksLikeBase64(directData)))) {
      pushImage(directData, mime);
    }

    if (depth >= MAX_TRAVERSE_DEPTH) {
      continue;
    }
    for (const nested of Object.values(current)) {
      if (isRecord(nested) || Array.isArray(nested)) {
        queue.push({ value: nested, depth: depth + 1 });
      }
    }
  }

  return images;
}

export function isToolMessage(message: unknown): boolean {
  if (!message || typeof message !== "object") {
    return false;
  }
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
