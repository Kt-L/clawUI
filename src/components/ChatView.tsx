import React, { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { createPortal, flushSync } from "react-dom";
import type { Attachment, ChatMessage, ToolItem } from "../lib/types.ts";
import { renderMarkdown } from "../lib/markdown.ts";
import { formatBytes, formatCompactTokens, truncate } from "../lib/format.ts";
import { BASE_COMMANDS, type SlashCommand } from "../lib/slash-commands.ts";
import type { UiSettings } from "../lib/ui-settings.ts";

export type SessionInfo = {
  agentId: string;
  agentLabel: string;
  modelLabel: string;
  modelId: string;
  contextLimit: number | null;
  contextTokens: number | null;
  inputTokens: number | null;
  outputTokens: number | null;
  totalTokens: number | null;
  thinkingLevel: string | null;
  responseUsage?: "on" | "off" | "tokens" | "full" | null;
};

type ChatViewProps = {
  sessionKey: string | null;
  messages: ChatMessage[];
  streamText: string | null;
  thinking: boolean;
  toolItems: ToolItem[];
  draft: string;
  onDraftChange: (value: string) => void;
  attachments: Attachment[];
  onAttachmentsChange: (next: Attachment[]) => void;
  onSend: () => void;
  onAbort: () => void;
  canAbort: boolean;
  connected: boolean;
  disabledReason?: string | null;
  sessionInfo: SessionInfo;
  models: Array<{ id: string; name: string; provider: string; contextWindow?: number }>;
  uiSettings: UiSettings;
  canLoadOlder: boolean;
  loadingOlder: boolean;
  onLoadOlder: () => void;
  onModelSelect: (model: string) => void;
  onThinkingSelect: (level: string) => void;
  onCreateSession: () => void;
  onOpenSettings: () => void;
  onResolveRemoteImage?: (filePath: string) => Promise<string | null>;
  onCompact?: () => void;
};

const MESSAGE_RENDER_STEP = 60;
const AUTO_SCROLL_BOTTOM_THRESHOLD = 10;
const DESKTOP_LOCAL_IMAGE_SCHEME = "claw-local-image";
const SESSION_SWITCH_OUT_MS = 260;
const SESSION_SWITCH_IN_MS = 800;
const STACK_LIFT_MS = 380;
const DRAWER_KICK_MS = 440;
const POP_MARK_MS = 640;
const FLY_IN_STAGGER_MS = 38;
const MAX_FLY_IN_ELEMENTS = 10;

function normalizeMessageTimestamp(timestamp: number): number {
  if (!Number.isFinite(timestamp) || timestamp <= 0) {
    return Date.now();
  }
  // Support both seconds and milliseconds precision from upstream payloads.
  return timestamp < 1_000_000_000_000 ? timestamp * 1000 : timestamp;
}

function formatLocalDateTime(timestamp: number): string {
  const date = new Date(normalizeMessageTimestamp(timestamp));
  const pad = (value: number) => String(value).padStart(2, "0");
  const year = date.getFullYear();
  const month = pad(date.getMonth() + 1);
  const day = pad(date.getDate());
  const hour = pad(date.getHours());
  const minute = pad(date.getMinutes());
  const second = pad(date.getSeconds());
  return `${year}-${month}-${day} ${hour}:${minute}:${second}`;
}

function filePathFromFileUrl(value: string): string | null {
  try {
    const parsed = new URL(value);
    if (parsed.protocol !== "file:") {
      return null;
    }
    let pathname = decodeURIComponent(parsed.pathname || "");
    if (!pathname) {
      return null;
    }
    if (/^\/[A-Za-z]:\//.test(pathname)) {
      pathname = pathname.slice(1);
    }
    return pathname;
  } catch {
    return null;
  }
}

function stripPathDecorators(value: string): string {
  let next = value.trim();
  next = next.replace(/^media\s*:\s*/i, "").trim();
  if (!next) {
    return "";
  }
  const wrappers: Array<[string, string]> = [
    ['"', '"'],
    ["'", "'"],
    ["`", "`"],
    ["<", ">"],
    ["(", ")"],
    ["[", "]"],
  ];
  for (const [left, right] of wrappers) {
    if (next.startsWith(left) && next.endsWith(right) && next.length >= 2) {
      next = next.slice(1, -1).trim();
    }
  }
  return next.trim();
}

function looksLikeImagePath(value: string): boolean {
  const noQuery = value.split("?")[0]?.split("#")[0]?.trim() ?? "";
  if (!noQuery) {
    return false;
  }
  return /\.(png|jpe?g|webp|gif|bmp|svg)$/i.test(noQuery);
}

function looksLikeAbsoluteImagePath(value: string): boolean {
  const trimmed = value.trim();
  if (!trimmed) {
    return false;
  }
  if (
    trimmed.startsWith(".openclaw/workspace/") ||
    trimmed.startsWith("openclaw/workspace/") ||
    trimmed.includes("/.openclaw/workspace/")
  ) {
    return true;
  }
  if (!looksLikeImagePath(trimmed)) {
    return false;
  }
  return /^[A-Za-z]:[\\/]/.test(trimmed) || trimmed.startsWith("/") || trimmed.startsWith("~/");
}

function resolveWorkspaceRelativeLocalPath(value: string): string | null {
  const trimmed = value.trim().replace(/^\.\/+/, "").replace(/^\/+/, "");
  if (!trimmed || !looksLikeImagePath(trimmed)) {
    return null;
  }
  const workspaceDir = window.desktopInfo?.workspaceDir?.trim();
  if (!workspaceDir) {
    return null;
  }
  return `${workspaceDir}/${trimmed}`;
}

function mapWorkspaceAliasToLocalPath(value: string): string | null {
  const trimmed = value.trim().replace(/\\/g, "/").replace(/^\/+/, "");
  const homeDir = window.desktopInfo?.homeDir?.trim();
  if (!trimmed || !homeDir) {
    return null;
  }
  if (trimmed.startsWith(".openclaw/workspace/")) {
    return `${homeDir}/${trimmed}`;
  }
  if (trimmed.startsWith("openclaw/workspace/")) {
    return `${homeDir}/.${trimmed}`;
  }
  return null;
}

function isLikelyPathOrUrl(value: string): boolean {
  const trimmed = stripPathDecorators(value);
  if (!trimmed) {
    return false;
  }
  if (/^https?:\/\//i.test(trimmed) || trimmed.startsWith("//")) {
    return true;
  }
  if (trimmed.toLowerCase().includes("__claw/local-image")) {
    return true;
  }
  if (
    /^[A-Za-z]:[\\/]/.test(trimmed) ||
    trimmed.startsWith("/") ||
    trimmed.startsWith("~/") ||
    trimmed.startsWith(".openclaw/workspace/") ||
    trimmed.startsWith("openclaw/workspace/")
  ) {
    return true;
  }
  return looksLikeImagePath(trimmed);
}

function decodeCompactBase64AsUtf8(value: string): string | null {
  const compact = value.replace(/\s+/g, "").trim();
  if (!compact || compact.length > 32768) {
    return null;
  }
  const normalized = compact.replace(/-/g, "+").replace(/_/g, "/");
  if (!/^[A-Za-z0-9+/]+=*$/.test(normalized)) {
    return null;
  }
  const remainder = normalized.length % 4;
  if (remainder === 1) {
    return null;
  }
  const padded = remainder === 0 ? normalized : `${normalized}${"=".repeat(4 - remainder)}`;
  try {
    const binary = atob(padded);
    if (!binary) {
      return null;
    }
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i += 1) {
      bytes[i] = binary.charCodeAt(i);
    }
    const decodedRaw = new TextDecoder("utf-8", { fatal: false }).decode(bytes);
    const printableCount = decodedRaw.split("").filter((ch) => {
      const code = ch.charCodeAt(0);
      return code === 9 || code === 10 || code === 13 || (code >= 32 && code <= 126);
    }).length;
    if (decodedRaw.length === 0 || printableCount / decodedRaw.length < 0.75) {
      return null;
    }
    const decoded = decodedRaw.trim();
    if (!decoded || decoded.length > 2048) {
      return null;
    }
    return decoded;
  } catch {
    return null;
  }
}

function normalizeDataImageUrl(value: string): string | null {
  const trimmed = value.trim();
  const match = /^data:(image\/[a-z0-9.+-]+)(?:;[a-z0-9.+-]+=[^;,]+)*;base64,([\s\S]+)$/i.exec(trimmed);
  if (!match) {
    return null;
  }
  const mimeType = match[1].toLowerCase();
  const payloadRaw = match[2] ?? "";
  const payloadVariants = [payloadRaw];
  if (payloadRaw.includes("%")) {
    try {
      const decoded = decodeURIComponent(payloadRaw);
      if (decoded && decoded !== payloadRaw) {
        payloadVariants.push(decoded);
      }
    } catch {
      // keep raw payload only
    }
  }
  for (const payloadVariant of payloadVariants) {
    const payloadCompact = payloadVariant.replace(/\s+/g, "");
    if (!payloadCompact) {
      continue;
    }
    const payloadNormalized = payloadCompact.replace(/-/g, "+").replace(/_/g, "/");
    if (!/^[A-Za-z0-9+/]+=*$/.test(payloadNormalized)) {
      continue;
    }
    const remainder = payloadNormalized.length % 4;
    if (remainder === 1) {
      continue;
    }
    const padded =
      remainder === 0 ? payloadNormalized : `${payloadNormalized}${"=".repeat(4 - remainder)}`;
    return `data:${mimeType};base64,${padded}`;
  }
  return null;
}

function summarizeSourceForError(value: string): string {
  const trimmed = stripPathDecorators(value).replace(/\s+/g, " ").trim();
  if (!trimmed) {
    return "empty";
  }
  if (trimmed.toLowerCase().startsWith("data:image/")) {
    const payload = /^data:image\/[^;]+;base64,([\s\S]+)$/i.exec(trimmed)?.[1] ?? "";
    const compact = payload.replace(/\s+/g, "");
    return `data-len-${compact.length}`;
  }
  if (trimmed.length <= 64) {
    return trimmed;
  }
  return `${trimmed.slice(0, 64)}...`;
}

function extractImageSourceCandidates(value: string): string[] {
  const initial = stripPathDecorators(value);
  if (!initial) {
    return [];
  }
  const seen = new Set<string>();
  const candidates: string[] = [];
  const push = (raw: string) => {
    const next = stripPathDecorators(raw);
    if (!next || seen.has(next)) {
      return;
    }
    seen.add(next);
    candidates.push(next);
  };
  const tryExtractFromText = (text: string) => {
    const candidate = stripPathDecorators(text);
    if (!candidate) {
      return;
    }
    if (isLikelyPathOrUrl(candidate)) {
      push(candidate);
    }
    try {
      const decoded = decodeURIComponent(candidate);
      if (decoded && decoded !== candidate && isLikelyPathOrUrl(decoded)) {
        push(decoded);
      }
    } catch {
      // ignore
    }
    const maybeJson = candidate.trim();
    if (!maybeJson.startsWith("{") && !maybeJson.startsWith("[")) {
      return;
    }
    try {
      const parsed = JSON.parse(maybeJson) as unknown;
      const queue: Array<{ value: unknown; depth: number }> = [{ value: parsed, depth: 0 }];
      let traversed = 0;
      while (queue.length > 0 && traversed < 220) {
        const current = queue.shift();
        if (!current) {
          continue;
        }
        traversed += 1;
        if (typeof current.value === "string") {
          const textValue = stripPathDecorators(current.value);
          if (textValue && isLikelyPathOrUrl(textValue)) {
            push(textValue);
          }
          continue;
        }
        if (!current.value || current.depth >= 6) {
          continue;
        }
        if (Array.isArray(current.value)) {
          for (const nested of current.value) {
            queue.push({ value: nested, depth: current.depth + 1 });
          }
          continue;
        }
        if (typeof current.value === "object") {
          for (const nested of Object.values(current.value as Record<string, unknown>)) {
            if (typeof nested === "string" || Array.isArray(nested) || (nested && typeof nested === "object")) {
              queue.push({ value: nested, depth: current.depth + 1 });
            }
          }
        }
      }
    } catch {
      // ignore
    }
  };

  push(initial);
  tryExtractFromText(initial);
  try {
    const decoded = decodeURIComponent(initial);
    if (decoded && decoded !== initial) {
      push(decoded);
      tryExtractFromText(decoded);
    }
  } catch {
    // ignore
  }

  const dataUrlPayload = /^data:image\/[^;]+;base64,([^,\s]+)$/i.exec(initial)?.[1]?.trim() ?? "";
  if (dataUrlPayload) {
    push(dataUrlPayload);
    try {
      const decodedPayload = decodeURIComponent(dataUrlPayload);
      if (decodedPayload && decodedPayload !== dataUrlPayload) {
        push(decodedPayload);
      }
      const decodedPayloadText = decodeCompactBase64AsUtf8(decodedPayload);
      if (decodedPayloadText && isLikelyPathOrUrl(decodedPayloadText)) {
        push(decodedPayloadText);
        tryExtractFromText(decodedPayloadText);
      }
    } catch {
      // ignore
    }
    const decodedPayloadText = decodeCompactBase64AsUtf8(dataUrlPayload);
    if (decodedPayloadText && isLikelyPathOrUrl(decodedPayloadText)) {
      push(decodedPayloadText);
      tryExtractFromText(decodedPayloadText);
    }
  }

  const initialDecodedText = decodeCompactBase64AsUtf8(initial);
  if (initialDecodedText && isLikelyPathOrUrl(initialDecodedText)) {
    push(initialDecodedText);
    tryExtractFromText(initialDecodedText);
  }

  return candidates;
}

function buildDesktopLocalImageUrl(filePath: string): string {
  return `${DESKTOP_LOCAL_IMAGE_SCHEME}://open?path=${encodeURIComponent(filePath)}`;
}

function localPathFromDesktopLocalImageUrl(value: string): string | null {
  const trimmed = value.trim();
  if (!trimmed) {
    return null;
  }
  try {
    const parsed = new URL(trimmed);
    if (parsed.protocol !== `${DESKTOP_LOCAL_IMAGE_SCHEME}:`) {
      return null;
    }
    const rawPath = parsed.searchParams.get("path");
    if (rawPath) {
      return decodeURIComponent(rawPath);
    }
    let pathname = decodeURIComponent(parsed.pathname || "");
    if (/^\/[A-Za-z]:\//.test(pathname)) {
      pathname = pathname.slice(1);
    }
    return pathname || null;
  } catch {
    return null;
  }
}

function filePathFromImageSource(value: string): string | null {
  const trimmed = stripPathDecorators(value);
  if (!trimmed) {
    return null;
  }
  const fromDesktopLocalImage = localPathFromDesktopLocalImageUrl(trimmed);
  if (fromDesktopLocalImage) {
    return fromDesktopLocalImage;
  }
  const dataUrlPayload = /^data:image\/[^;]+;base64,([^,\s]+)$/i.exec(trimmed)?.[1]?.trim() ?? "";
  if (dataUrlPayload) {
    let decodedPayload = dataUrlPayload;
    try {
      decodedPayload = decodeURIComponent(dataUrlPayload);
    } catch {
      // keep raw payload
    }
    const cleanedPayload = stripPathDecorators(decodedPayload);
    const mappedFromAlias = mapWorkspaceAliasToLocalPath(cleanedPayload);
    if (mappedFromAlias) {
      return mappedFromAlias;
    }
    if (looksLikeAbsoluteImagePath(cleanedPayload)) {
      return cleanedPayload;
    }
    const workspaceRelativePayload = resolveWorkspaceRelativeLocalPath(cleanedPayload);
    if (workspaceRelativePayload) {
      return workspaceRelativePayload;
    }
  }
  if (/^file:\/\/\/__claw\/local-image\?/i.test(trimmed)) {
    try {
      const parsed = new URL(trimmed);
      const rawPath = parsed.searchParams.get("path");
      if (!rawPath) {
        return null;
      }
      return decodeURIComponent(rawPath);
    } catch {
      return null;
    }
  }
  if (trimmed.toLowerCase().includes("__claw/local-image")) {
    const marker = "__claw/local-image?";
    const parsePath = (raw: string | null): string | null => {
      if (!raw) {
        return null;
      }
      try {
        return decodeURIComponent(raw);
      } catch {
        return raw;
      }
    };
    const normalized = trimmed.toLowerCase();
    if (normalized.startsWith(marker)) {
      return parsePath(new URLSearchParams(trimmed.slice(marker.length)).get("path"));
    }
    const markerIndex = normalized.indexOf(marker);
    if (markerIndex >= 0) {
      return parsePath(new URLSearchParams(trimmed.slice(markerIndex + marker.length)).get("path"));
    }
    try {
      const parsed = new URL(trimmed, "http://127.0.0.1");
      return parsePath(parsed.searchParams.get("path"));
    } catch {
      return null;
    }
  }
  const fromFileUrl = filePathFromFileUrl(trimmed);
  if (fromFileUrl) {
    return fromFileUrl;
  }
  const mappedFromAlias = mapWorkspaceAliasToLocalPath(trimmed);
  if (mappedFromAlias) {
    return mappedFromAlias;
  }
  if (trimmed.startsWith("~/")) {
    const homeDir = window.desktopInfo?.homeDir?.trim();
    if (homeDir) {
      return `${homeDir}/${trimmed.slice(2)}`;
    }
    return trimmed;
  }
  const workspaceRelativePath = resolveWorkspaceRelativeLocalPath(trimmed);
  if (workspaceRelativePath) {
    return workspaceRelativePath;
  }
  if (/^[A-Za-z]:[\\/]/.test(trimmed) || trimmed.startsWith("/")) {
    try {
      const strippedQuery = trimmed.split("?")[0]?.split("#")[0] ?? trimmed;
      return decodeURIComponent(strippedQuery);
    } catch {
      return trimmed;
    }
  }
  return null;
}

function normalizeHttpImageUrl(value: string): string | null {
  const trimmed = value.trim();
  if (!trimmed) {
    return null;
  }
  if (/^https?:\/\//i.test(trimmed)) {
    return trimmed;
  }
  if (trimmed.startsWith("//")) {
    const protocol = window.location.protocol === "https:" ? "https:" : "http:";
    return `${protocol}${trimmed}`;
  }
  return null;
}

function toDesktopRenderableSrc(value: string): string {
  if (!isDesktopRuntime()) {
    return value;
  }
  const path = filePathFromImageSource(value);
  if (!path) {
    return value;
  }
  return buildDesktopLocalImageUrl(path);
}

function isDesktopRuntime(): boolean {
  if (window.desktopInfo?.isDesktop) {
    return true;
  }
  return window.location.protocol === "file:";
}

function isLikelyLocalFileSource(value: string): boolean {
  const trimmed = value.trim();
  if (!trimmed) {
    return false;
  }
  if (trimmed.toLowerCase().startsWith(`${DESKTOP_LOCAL_IMAGE_SCHEME}:`)) {
    return true;
  }
  if (/^file:/i.test(trimmed)) {
    return true;
  }
  if (/^[A-Za-z]:[\\/]/.test(trimmed)) {
    return true;
  }
  if (
    /^\/(?:home|users|tmp|var|private|mnt|volumes)\//i.test(trimmed) ||
    trimmed.startsWith("~/") ||
    trimmed.startsWith("\\\\")
  ) {
    return true;
  }
  return false;
}

function MessageImageAttachment(props: {
  attachment: Attachment;
  onOpen: (attachment: Attachment) => void;
  resolveRemoteImage?: (filePath: string) => Promise<string | null>;
}) {
  const [resolvedSrc, setResolvedSrc] = useState(toDesktopRenderableSrc(props.attachment.dataUrl));
  const [failedToLoad, setFailedToLoad] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const desktopReadImageFile = window.desktopInfo?.readImageFile;
  const desktopFetchImageUrl = window.desktopInfo?.fetchImageUrl;
  const localPathCandidate = filePathFromImageSource(resolvedSrc || props.attachment.dataUrl);
  const usesDesktopLocalScheme = resolvedSrc.trim().toLowerCase().startsWith(`${DESKTOP_LOCAL_IMAGE_SCHEME}:`);
  const requiresDesktopDecode =
    isDesktopRuntime() &&
    typeof desktopReadImageFile === "function" &&
    Boolean(localPathCandidate) &&
    !usesDesktopLocalScheme;
  const desktopBridgeMissing =
    isDesktopRuntime() && typeof desktopReadImageFile !== "function";
  const webLocalFileBlocked = !isDesktopRuntime() && isLikelyLocalFileSource(resolvedSrc);
  const desktopResolveTriedRef = useRef<Set<string>>(new Set());

  useEffect(() => {
    setResolvedSrc(toDesktopRenderableSrc(props.attachment.dataUrl));
    setFailedToLoad(false);
    setLoadError(null);
  }, [props.attachment.dataUrl]);

  const tryResolveLocalImage = useCallback(async (): Promise<Attachment | null> => {
    const sourceValue = (resolvedSrc || props.attachment.dataUrl).trim();
    const sourceCandidates = extractImageSourceCandidates(sourceValue);
    const sourceKind = sourceValue.toLowerCase().startsWith("data:image/")
      ? "data-url"
      : sourceValue.toLowerCase().startsWith("http:")
      ? "http-url"
      : sourceValue.toLowerCase().startsWith("https:")
      ? "https-url"
      : sourceValue.toLowerCase().startsWith("file:")
      ? "file-url"
      : sourceValue.toLowerCase().includes("__claw/local-image")
      ? "proxy-url"
      : "raw";
    let filePath: string | null = null;
    for (const candidate of sourceCandidates) {
      filePath = filePathFromImageSource(candidate);
      if (filePath) {
        break;
      }
    }
    if (!filePath) {
      if (sourceKind === "data-url") {
        for (const candidate of sourceCandidates) {
          const normalizedDataUrl = normalizeDataImageUrl(candidate);
          if (normalizedDataUrl && normalizedDataUrl !== sourceValue) {
            setResolvedSrc(normalizedDataUrl);
            setFailedToLoad(false);
            setLoadError(null);
            return {
              ...props.attachment,
              dataUrl: normalizedDataUrl,
            };
          }
        }
        setFailedToLoad(true);
        setLoadError(`img-decode-failed:${sourceKind}:${summarizeSourceForError(sourceValue)}`);
        return null;
      }
      let remoteUrl: string | null = null;
      for (const candidate of sourceCandidates) {
        remoteUrl = normalizeHttpImageUrl(candidate);
        if (remoteUrl) {
          break;
        }
      }
      if (remoteUrl && typeof desktopFetchImageUrl === "function") {
        try {
          const fetched = await desktopFetchImageUrl(remoteUrl);
          const nextDataUrl =
            fetched?.ok && typeof fetched.dataUrl === "string" ? fetched.dataUrl.trim() : "";
          if (nextDataUrl) {
            setResolvedSrc(nextDataUrl);
            setFailedToLoad(false);
            setLoadError(null);
            return {
              ...props.attachment,
              dataUrl: nextDataUrl,
            };
          }
          setFailedToLoad(true);
          setLoadError(fetched?.error ?? "remote-fetch-failed");
          return null;
        } catch {
          setFailedToLoad(true);
          setLoadError("remote-fetch-failed");
          return null;
        }
      }
      setFailedToLoad(true);
      setLoadError(`path-parse-failed:${sourceKind}:${summarizeSourceForError(sourceValue)}`);
      return null;
    }
    const tryResolveRemote = async (): Promise<Attachment | null> => {
      if (!props.resolveRemoteImage) {
        return null;
      }
      const remoteDataUrl = await props.resolveRemoteImage(filePath);
      const nextDataUrl = typeof remoteDataUrl === "string" ? remoteDataUrl.trim() : "";
      if (!nextDataUrl) {
        return null;
      }
      setResolvedSrc(nextDataUrl);
      setFailedToLoad(false);
      setLoadError(null);
      return {
        ...props.attachment,
        dataUrl: nextDataUrl,
      };
    };

    let localError: string | null = null;
    const readImageFile = desktopReadImageFile;
    if (readImageFile) {
      try {
        const result = await readImageFile(filePath);
        if (result.ok && typeof result.dataUrl === "string" && result.dataUrl.trim()) {
          const nextDataUrl = result.dataUrl.trim();
          setResolvedSrc(nextDataUrl);
          setFailedToLoad(false);
          setLoadError(null);
          return {
            ...props.attachment,
            dataUrl: nextDataUrl,
          };
        }
        localError = result.error ?? "read-failed";
      } catch {
        localError = "read-failed";
      }
    } else {
      localError = "desktop-api-unavailable";
    }

    const remoteResolved = await tryResolveRemote();
    if (remoteResolved) {
      return remoteResolved;
    }

    if (localError) {
      setFailedToLoad(true);
      setLoadError(localError);
      return null;
    }
    setFailedToLoad(true);
    setLoadError("read-failed");
    return null;
  }, [desktopFetchImageUrl, desktopReadImageFile, props.attachment, props.resolveRemoteImage, resolvedSrc]);

  useEffect(() => {
    if (!requiresDesktopDecode || !localPathCandidate) {
      return;
    }
    if (desktopResolveTriedRef.current.has(localPathCandidate)) {
      return;
    }
    desktopResolveTriedRef.current.add(localPathCandidate);
    void tryResolveLocalImage();
  }, [localPathCandidate, props.attachment.dataUrl, requiresDesktopDecode, resolvedSrc, tryResolveLocalImage]);

  const openAttachment = useCallback(async () => {
    if (requiresDesktopDecode || failedToLoad) {
      const recovered = await tryResolveLocalImage();
      if (recovered) {
        props.onOpen(recovered);
        return;
      }
    }
    if (!failedToLoad) {
      const next =
        resolvedSrc === props.attachment.dataUrl
          ? props.attachment
          : {
              ...props.attachment,
              dataUrl: resolvedSrc,
            };
      props.onOpen(next);
      return;
    }
    props.onOpen(props.attachment);
  }, [failedToLoad, props, requiresDesktopDecode, resolvedSrc, tryResolveLocalImage]);

  const onPreviewImageError = useCallback(() => {
    const pathCandidate = filePathFromImageSource(resolvedSrc || props.attachment.dataUrl);
    if (isDesktopRuntime() && pathCandidate && !usesDesktopLocalScheme) {
      const desktopSrc = buildDesktopLocalImageUrl(pathCandidate);
      if (desktopSrc !== resolvedSrc) {
        setResolvedSrc(desktopSrc);
        setFailedToLoad(false);
        setLoadError(null);
        return;
      }
    }
    if (
      isDesktopRuntime() &&
      (typeof desktopReadImageFile === "function" || typeof desktopFetchImageUrl === "function")
    ) {
      void tryResolveLocalImage();
      return;
    }
    setFailedToLoad(true);
    if (!loadError) {
      setLoadError("img-decode-failed");
    }
  }, [
    desktopReadImageFile,
    desktopFetchImageUrl,
    loadError,
    props.attachment.dataUrl,
    resolvedSrc,
    tryResolveLocalImage,
    usesDesktopLocalScheme,
  ]);

  return (
    <button
      type="button"
      className="attachment-image-button"
      onClick={() => {
        void openAttachment();
      }}
      aria-label={`Open image ${props.attachment.name}`}
      title="Click to view larger"
    >
      <div className="attachment-image">
        {webLocalFileBlocked ? (
          <div className="attachment-image-fallback">
            Web cannot read local file paths. Open this session in desktop app.
          </div>
        ) : requiresDesktopDecode && !failedToLoad ? (
          <div className="attachment-image-fallback">Loading local image...</div>
        ) : failedToLoad ? (
          <div className="attachment-image-fallback">
            {loadError
              ? `Image load failed: ${loadError}`
              : desktopBridgeMissing
              ? "Image load failed: desktop-api-unavailable"
              : "Click to load local image"}
          </div>
        ) : (
          <img
            src={resolvedSrc}
            alt={props.attachment.name}
            className="attachment-image-preview"
            onError={onPreviewImageError}
          />
        )}
      </div>
    </button>
  );
}

function renderAttachment(att: Attachment) {
  if (att.isImage) {
    return (
      <div key={att.id} className="attachment-image">
        <img src={att.dataUrl} alt={att.name} className="attachment-image-preview" />
      </div>
    );
  }
  return (
    <div key={att.id} className="attachment-file">
      <div>
        <div className="attachment-file-name">{truncate(att.name, 32)}</div>
        <div className="attachment-file-size">{formatBytes(att.size)}</div>
      </div>
      <div className="attachment-file-kind">FILE</div>
    </div>
  );
}

function formatMessageDateTime(timestamp: number): string {
  const normalized = normalizeMessageTimestamp(timestamp);
  return new Date(normalized).toISOString();
}

type MessageRowProps = {
  message: ChatMessage;
  showTimestamp: boolean;
  timestampFontSize: number;
  drawerPop?: boolean;
  sessionFlyIn?: boolean;
  onOpenImage: (attachment: Attachment) => void;
  onResolveRemoteImage?: (filePath: string) => Promise<string | null>;
};

type ThreadSnapshot = {
  sessionKey: string | null;
  hiddenMessageCount: number;
  loadingOlder: boolean;
  displayedMessages: ChatMessage[];
  toolBeforeFirst: ToolItem[];
  toolByMessageEntries: Array<[string, ToolItem[]]>;
  streamText: string | null;
  thinking: boolean;
};

type MotionVarsStyle = React.CSSProperties & Record<`--${string}`, string>;

function hashString(value: string): number {
  let hash = 0x811c9dc5;
  for (let i = 0; i < value.length; i += 1) {
    hash ^= value.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  return hash >>> 0;
}

function buildMotionVars(id: string): MotionVarsStyle {
  const hash = hashString(id);
  const byte = (shift: number) => ((hash >>> shift) & 0xff) / 255;
  // Horizontal jitter — slight random drift left/right (GPU translate, no blur)
  const dx = (byte(0) - 0.5) * 6;
  // Time scale — each card animates at a slightly different speed
  const timeScale = 0.9 + byte(24) * 0.2;
  // Emerge Y — how far below the card starts (drawer depth)
  const emergeY = 42 + byte(4) * 30;
  return {
    "--pop-dx": `${dx.toFixed(1)}px`,
    "--pop-time-scale": `${timeScale.toFixed(3)}`,
    "--pop-emerge-y": `${Math.round(emergeY)}px`,
  };
}

const MessageRow = React.memo(
  function MessageRow(props: MessageRowProps) {
    const { message } = props;
    const isUser = message.role === "user";
    const isSystem = message.role === "system";
    const roleLabel = isSystem ? "System" : isUser ? "You" : "Assistant";
    const rowMotionClass = `${props.drawerPop ? "drawer-pop" : ""} ${props.sessionFlyIn ? "session-fly-in" : ""}`.trim();
    const motionStyle = useMemo(() => buildMotionVars(message.id), [message.id]);
    const markdownHtml = useMemo(
      () => (message.text ? renderMarkdown(message.text) : ""),
      [message.text],
    );

    if (isSystem) {
      return (
        <div className={`message-row system ${rowMotionClass}`} data-message-id={message.id} style={motionStyle}>
          <article
            className="message-bubble system"
            style={{
              fontSize: "var(--claw-font-size)",
              lineHeight: "var(--claw-line-height)",
            }}
          >
            <div className="message-role">{roleLabel}</div>
            <div className="message-body plain-text">{message.text}</div>
            {props.showTimestamp && (
              <div className="message-meta">
                <time
                  className="message-time"
                  dateTime={formatMessageDateTime(message.timestamp)}
                  title={formatLocalDateTime(message.timestamp)}
                  style={{ fontSize: `${props.timestampFontSize}px` }}
                >
                  {formatLocalDateTime(message.timestamp)}
                </time>
              </div>
            )}
          </article>
        </div>
      );
    }

    return (
      <div
        className={`message-row ${isUser ? "user" : "assistant"} ${rowMotionClass}`}
        data-message-id={message.id}
        style={motionStyle}
      >
        <article className={`message-bubble ${isUser ? "user" : "assistant"}`}>
          <div className="message-role">{roleLabel}</div>
          {markdownHtml && (
            <div
              className="markdown"
              dangerouslySetInnerHTML={{ __html: markdownHtml }}
            />
          )}
          {message.attachments && message.attachments.length > 0 && (
            <div className="attachments-wrap">
              {message.attachments.map((att) => {
                if (att.isImage) {
                  return (
                    <MessageImageAttachment
                      key={att.id}
                      attachment={att}
                      onOpen={props.onOpenImage}
                      resolveRemoteImage={props.onResolveRemoteImage}
                    />
                  );
                }
                return renderAttachment(att);
              })}
            </div>
          )}
          {props.showTimestamp && (
            <div className="message-meta">
              <time
                className="message-time"
                dateTime={formatMessageDateTime(message.timestamp)}
                title={formatLocalDateTime(message.timestamp)}
                style={{ fontSize: `${props.timestampFontSize}px` }}
              >
                {formatLocalDateTime(message.timestamp)}
              </time>
            </div>
          )}
        </article>
      </div>
    );
  },
  (prev, next) =>
    prev.message === next.message &&
    prev.showTimestamp === next.showTimestamp &&
    prev.timestampFontSize === next.timestampFontSize &&
    prev.drawerPop === next.drawerPop &&
    prev.sessionFlyIn === next.sessionFlyIn &&
    prev.onOpenImage === next.onOpenImage &&
    prev.onResolveRemoteImage === next.onResolveRemoteImage,
);

export default function ChatView(props: ChatViewProps) {
  const [activeCommand, setActiveCommand] = useState(0);
  const [toolExpanded, setToolExpanded] = useState<Record<string, boolean>>({});
  const [modelMenuOpen, setModelMenuOpen] = useState(false);
  const [thinkingMenuOpen, setThinkingMenuOpen] = useState(false);
  const [visibleMessageCount, setVisibleMessageCount] = useState(MESSAGE_RENDER_STEP);
  const [autoScrollEnabled, setAutoScrollEnabled] = useState(true);
  const [imageLightbox, setImageLightbox] = useState<Attachment | null>(null);
  const [chatImpulseActive, setChatImpulseActive] = useState(false);
  const [composerLaunchActive, setComposerLaunchActive] = useState(false);
  const [sessionTransitionPhase, setSessionTransitionPhase] = useState<"idle" | "out" | "preparing" | "in">("idle");
  const [outgoingThreadSnapshot, setOutgoingThreadSnapshot] = useState<ThreadSnapshot | null>(null);
  const [poppingMessageIds, setPoppingMessageIds] = useState<string[]>([]);
  const [poppingToolIds, setPoppingToolIds] = useState<string[]>([]);
  const [sessionFlyInMessageIds, setSessionFlyInMessageIds] = useState<string[]>([]);
  const [sessionFlyInToolIds, setSessionFlyInToolIds] = useState<string[]>([]);
  const [sessionFlyInToolPanelKeys, setSessionFlyInToolPanelKeys] = useState<string[]>([]);
  const [sessionFlyInStream, setSessionFlyInStream] = useState(false);
  const [streamPopActive, setStreamPopActive] = useState(false);
  const lightboxReadTriedRef = useRef<Set<string>>(new Set());
  const isComposingRef = useRef(false);
  const modelMenuRef = useRef<HTMLDivElement | null>(null);
  const thinkingMenuRef = useRef<HTMLDivElement | null>(null);
  const scrollRef = useRef<HTMLDivElement | null>(null);
  const composerTextareaRef = useRef<HTMLTextAreaElement | null>(null);
  const restoreScrollRef = useRef<{ height: number; top: number } | null>(null);
  const olderLoadRequestedRef = useRef(false);
  const prevSessionKeyRef = useRef<string | null>(props.sessionKey);
  const prevSessionKeyForLayoutRef = useRef<string | null>(props.sessionKey);

  // Pre-paint: hide main thread AND set overlay state synchronously.
  // useLayoutEffect fires after React commits DOM but BEFORE the browser paints.
  // By setting overlay state here, React does a synchronous re-render — the overlay
  // is in the DOM before the first paint. Zero blank frames.
  useLayoutEffect(() => {
    if (prevSessionKeyForLayoutRef.current === props.sessionKey) {
      return;
    }
    prevSessionKeyForLayoutRef.current = props.sessionKey;
    if (!props.uiSettings.enableAnimations) {
      return;
    }
    const container = scrollRef.current;
    if (!container) {
      return;
    }
    const mainThread = container.querySelector<HTMLElement>(".chat-thread-main");
    if (mainThread) {
      mainThread.style.visibility = "hidden";
    }
    // Set overlay state synchronously — triggers sync re-render before paint
    const previousSnapshot = latestThreadSnapshotRef.current;
    if (previousSnapshot) {
      setOutgoingThreadSnapshot(previousSnapshot);
      setSessionTransitionPhase("out");
    } else {
      // No snapshot (first visit) — skip out phase, go straight to preparing
      setSessionTransitionPhase("preparing");
    }
  }, [props.sessionKey, props.uiSettings.enableAnimations]);
  const chatImpulseResetTimerRef = useRef<number | null>(null);
  const composerLaunchResetTimerRef = useRef<number | null>(null);
  const popMessageResetTimerRef = useRef<number | null>(null);
  const popToolResetTimerRef = useRef<number | null>(null);
  const sessionFlyInResetTimerRef = useRef<number | null>(null);
  const streamPopResetTimerRef = useRef<number | null>(null);
  const chatImpulseRafRef = useRef<number | null>(null);
  const composerLaunchRafRef = useRef<number | null>(null);
  const sessionFlyInRafRefs = useRef<number[]>([]);
  const sessionSwitchTimersRef = useRef<number[]>([]);
  const streamWasActiveRef = useRef(Boolean(props.streamText));
  const prevMessageIdsRef = useRef<Set<string>>(new Set(props.messages.map((message) => message.id)));
  const prevToolIdsRef = useRef<Set<string>>(new Set(props.toolItems.map((tool) => tool.id)));
  const latestThreadSnapshotRef = useRef<ThreadSnapshot | null>(null);
  const snapshotSessionKeyRef = useRef<string | null>(props.sessionKey);

  const displayedMessages = useMemo(() => {
    const total = props.messages.length;
    const count = Math.max(0, Math.min(total, visibleMessageCount));
    return props.messages.slice(Math.max(0, total - count));
  }, [props.messages, visibleMessageCount]);

  const hiddenMessageCount = Math.max(0, props.messages.length - displayedMessages.length);

  const orderedTools = useMemo(
    () => [...props.toolItems].sort((a, b) => a.startedAt - b.startedAt),
    [props.toolItems],
  );
  const toolTimeline = useMemo(() => {
    const beforeFirst: ToolItem[] = [];
    const byMessageId = new Map<string, ToolItem[]>();
    if (orderedTools.length === 0) {
      return { beforeFirst, byMessageId };
    }
    if (displayedMessages.length === 0) {
      return { beforeFirst: [...orderedTools], byMessageId };
    }
    let messageIndex = -1;
    for (const tool of orderedTools) {
      while (
        messageIndex + 1 < displayedMessages.length &&
        displayedMessages[messageIndex + 1]!.timestamp <= tool.startedAt
      ) {
        messageIndex += 1;
      }
      if (messageIndex < 0) {
        beforeFirst.push(tool);
        continue;
      }
      const anchor = displayedMessages[messageIndex]!;
      const bucket = byMessageId.get(anchor.id);
      if (bucket) {
        bucket.push(tool);
      } else {
        byMessageId.set(anchor.id, [tool]);
      }
    }
    return { beforeFirst, byMessageId };
  }, [orderedTools, displayedMessages]);
  const poppingMessageIdSet = useMemo(() => new Set(poppingMessageIds), [poppingMessageIds]);
  const poppingToolIdSet = useMemo(() => new Set(poppingToolIds), [poppingToolIds]);
  const sessionFlyInMessageIdSet = useMemo(() => new Set(sessionFlyInMessageIds), [sessionFlyInMessageIds]);
  const sessionFlyInToolIdSet = useMemo(() => new Set(sessionFlyInToolIds), [sessionFlyInToolIds]);
  const sessionFlyInToolPanelKeySet = useMemo(() => new Set(sessionFlyInToolPanelKeys), [sessionFlyInToolPanelKeys]);

  const modelChoices = useMemo(() => {
    const unique = new Map<string, { id: string; name: string; provider: string; contextWindow?: number }>();
    for (const model of props.models) {
      const full = `${model.provider}/${model.id}`;
      if (!unique.has(full)) {
        unique.set(full, model);
      }
    }
    return [...unique.entries()]
      .map(([full, model]) => ({ full, ...model }))
      .sort((a, b) => a.full.localeCompare(b.full));
  }, [props.models]);

  const activeModel = props.sessionInfo.modelId || props.sessionInfo.modelLabel || "";
  const thinkChoices = ["off", "minimal", "low", "medium", "high", "xhigh"];
  const activeThinking = (props.sessionInfo.thinkingLevel ?? "off").toLowerCase();

  useEffect(() => {
    if (snapshotSessionKeyRef.current !== props.sessionKey) {
      snapshotSessionKeyRef.current = props.sessionKey;
      return;
    }
    latestThreadSnapshotRef.current = {
      sessionKey: props.sessionKey,
      hiddenMessageCount,
      loadingOlder: props.loadingOlder,
      displayedMessages: [...displayedMessages],
      toolBeforeFirst: [...toolTimeline.beforeFirst],
      toolByMessageEntries: Array.from(toolTimeline.byMessageId.entries()).map(([messageId, tools]) => [
        messageId,
        [...tools],
      ]),
      streamText: props.streamText,
      thinking: props.thinking,
    };
  }, [
    hiddenMessageCount,
    props.loadingOlder,
    props.sessionKey,
    displayedMessages,
    toolTimeline.beforeFirst,
    toolTimeline.byMessageId,
    props.streamText,
    props.thinking,
  ]);

  const autoResizeComposer = useCallback(() => {
    const textarea = composerTextareaRef.current;
    if (!textarea) {
      return;
    }
    const computed = window.getComputedStyle(textarea);
    const parsedMinHeight = Number.parseFloat(computed.minHeight);
    const defaultHeight = Number.isFinite(parsedMinHeight) ? parsedMinHeight : 78;
    const maxHeight = Math.max(defaultHeight, Math.floor(window.innerHeight * 0.5));

    textarea.style.height = `${defaultHeight}px`;
    const contentHeight = textarea.scrollHeight;
    const nextHeight = Math.min(Math.max(contentHeight, defaultHeight), maxHeight);
    textarea.style.height = `${nextHeight}px`;
    textarea.style.overflowY = contentHeight > maxHeight ? "auto" : "hidden";
  }, []);

  const triggerChatImpulse = useCallback(() => {
    if (!props.uiSettings.enableAnimations) {
      return;
    }
    if (chatImpulseResetTimerRef.current !== null) {
      return;
    }
    if (chatImpulseRafRef.current !== null) {
      window.cancelAnimationFrame(chatImpulseRafRef.current);
      chatImpulseRafRef.current = null;
    }
    setChatImpulseActive(false);
    chatImpulseRafRef.current = window.requestAnimationFrame(() => {
      chatImpulseRafRef.current = null;
      setChatImpulseActive(true);
      chatImpulseResetTimerRef.current = window.setTimeout(() => {
        setChatImpulseActive(false);
        chatImpulseResetTimerRef.current = null;
      }, STACK_LIFT_MS);
    });
  }, [props.uiSettings.enableAnimations]);

  const triggerComposerLaunch = useCallback(() => {
    if (!props.uiSettings.enableAnimations) {
      return;
    }
    if (composerLaunchResetTimerRef.current !== null) {
      window.clearTimeout(composerLaunchResetTimerRef.current);
      composerLaunchResetTimerRef.current = null;
    }
    if (composerLaunchRafRef.current !== null) {
      window.cancelAnimationFrame(composerLaunchRafRef.current);
      composerLaunchRafRef.current = null;
    }
    setComposerLaunchActive(false);
    composerLaunchRafRef.current = window.requestAnimationFrame(() => {
      composerLaunchRafRef.current = null;
      setComposerLaunchActive(true);
      composerLaunchResetTimerRef.current = window.setTimeout(() => {
        setComposerLaunchActive(false);
        composerLaunchResetTimerRef.current = null;
      }, DRAWER_KICK_MS);
    });
  }, [props.uiSettings.enableAnimations]);

  const markPoppingMessages = useCallback((ids: string[]) => {
    if (!props.uiSettings.enableAnimations || ids.length === 0) {
      return;
    }
    setPoppingMessageIds((prev) => {
      const next = new Set(prev);
      for (const id of ids) {
        next.add(id);
      }
      return [...next];
    });
    if (popMessageResetTimerRef.current !== null) {
      window.clearTimeout(popMessageResetTimerRef.current);
    }
    popMessageResetTimerRef.current = window.setTimeout(() => {
      setPoppingMessageIds([]);
      popMessageResetTimerRef.current = null;
    }, POP_MARK_MS);
  }, [props.uiSettings.enableAnimations]);

  const markPoppingTools = useCallback((ids: string[]) => {
    if (!props.uiSettings.enableAnimations || ids.length === 0) {
      return;
    }
    setPoppingToolIds((prev) => {
      const next = new Set(prev);
      for (const id of ids) {
        next.add(id);
      }
      return [...next];
    });
    if (popToolResetTimerRef.current !== null) {
      window.clearTimeout(popToolResetTimerRef.current);
    }
    popToolResetTimerRef.current = window.setTimeout(() => {
      setPoppingToolIds([]);
      popToolResetTimerRef.current = null;
    }, POP_MARK_MS);
  }, [props.uiSettings.enableAnimations]);

  const clearSessionSwitchTimers = useCallback(() => {
    if (sessionSwitchTimersRef.current.length === 0) {
      return;
    }
    for (const timer of sessionSwitchTimersRef.current) {
      window.clearTimeout(timer);
    }
    sessionSwitchTimersRef.current = [];
  }, []);

  const clearSessionFlyInMarks = useCallback(() => {
    if (sessionFlyInResetTimerRef.current !== null) {
      window.clearTimeout(sessionFlyInResetTimerRef.current);
      sessionFlyInResetTimerRef.current = null;
    }
    if (sessionFlyInRafRefs.current.length > 0) {
      for (const rafId of sessionFlyInRafRefs.current) {
        window.cancelAnimationFrame(rafId);
      }
      sessionFlyInRafRefs.current = [];
    }
    setSessionFlyInMessageIds([]);
    setSessionFlyInToolIds([]);
    setSessionFlyInToolPanelKeys([]);
    setSessionFlyInStream(false);
  }, []);

  const triggerVisibleSessionFlyIn = useCallback((onReady?: () => void) => {
    if (!props.uiSettings.enableAnimations) {
      // Still need to clear visibility:hidden from useLayoutEffect
      const container = scrollRef.current;
      const mainThread = container?.querySelector<HTMLElement>(".chat-thread-main");
      if (mainThread) {
        mainThread.style.visibility = "";
      }
      onReady?.();
      return;
    }
    clearSessionFlyInMarks();
    // Single RAF — React has committed the DOM with new session content by now
    const raf = window.requestAnimationFrame(() => {
      const container = scrollRef.current;
      if (!container) {
        onReady?.();
        return;
      }
      const mainThread = container.querySelector<HTMLElement>(".chat-thread-main");
      if (!mainThread) {
        onReady?.();
        return;
      }
      // Ensure scroll is at the bottom before measuring visibility.
      // loadHistory may have replaced messages since the initial scroll,
      // changing scrollHeight while scrollTop stayed stale.
      container.scrollTop = container.scrollHeight;

      const viewport = container.getBoundingClientRect();
      const messageIds = new Set<string>();
      const toolIds = new Set<string>();
      const toolPanelKeys = new Set<string>();
      const isVisible = (el: Element) => {
        const rect = el.getBoundingClientRect();
        return rect.bottom > viewport.top + 2 && rect.top < viewport.bottom - 2;
      };

      // Collect visible elements with position for stagger
      const visibleEls: Array<{ el: HTMLElement; bottom: number }> = [];

      mainThread.querySelectorAll<HTMLElement>(".message-row[data-message-id]").forEach((el) => {
        if (!isVisible(el)) {
          return;
        }
        const id = el.dataset.messageId;
        if (id) {
          messageIds.add(id);
          visibleEls.push({ el, bottom: el.getBoundingClientRect().bottom });
        }
      });
      mainThread.querySelectorAll<HTMLElement>(".tool-panel[data-tool-panel-key]").forEach((el) => {
        if (!isVisible(el)) {
          return;
        }
        const key = el.dataset.toolPanelKey;
        if (key) {
          toolPanelKeys.add(key);
          // Tool panels fade in independently (no stagger, no translateY).
          // Don't add to visibleEls — children handle the waterfall.
        }
      });
      mainThread.querySelectorAll<HTMLElement>(".tool-entry[data-tool-id]").forEach((el) => {
        if (!isVisible(el)) {
          return;
        }
        const id = el.dataset.toolId;
        if (id) {
          toolIds.add(id);
          visibleEls.push({ el, bottom: el.getBoundingClientRect().bottom });
        }
      });
      const streamRow = mainThread.querySelector<HTMLElement>(".message-row[data-stream-row='1']");
      const streamVisible = Boolean(streamRow && isVisible(streamRow));
      if (streamRow && streamVisible) {
        visibleEls.push({ el: streamRow, bottom: streamRow.getBoundingClientRect().bottom });
      }

      // Sort bottom-first (closest to drawer animates first).
      // All visible elements get animation; stagger is capped at MAX_FLY_IN_ELEMENTS
      // so elements beyond the cap animate simultaneously at the maximum stagger delay.
      visibleEls.sort((a, b) => b.bottom - a.bottom);
      visibleEls.forEach((item, index) => {
        const stagger = Math.min(index, MAX_FLY_IN_ELEMENTS) * FLY_IN_STAGGER_MS;
        item.el.style.setProperty("--pop-stagger", `${stagger}ms`);
      });

      // flushSync forces React to commit state + re-render synchronously,
      // so animation classes are in the DOM BEFORE we reveal the thread.
      // Without this, there's a flash: visibility="" runs while React state
      // is still batched → elements appear at full opacity for one frame
      // before animation classes apply opacity:0.
      flushSync(() => {
        setSessionFlyInMessageIds([...messageIds]);
        setSessionFlyInToolIds([...toolIds]);
        setSessionFlyInToolPanelKeys([...toolPanelKeys]);
        setSessionFlyInStream(streamVisible);
      });

      // Now animation classes are committed — reveal the thread.
      // Animated elements start at opacity:0 (animation 0%), non-animated appear instantly.
      mainThread.style.visibility = "";
      onReady?.();

      // Cleanup after all animations finish
      const maxStagger = Math.min(visibleEls.length, MAX_FLY_IN_ELEMENTS + 1) * FLY_IN_STAGGER_MS;
      sessionFlyInResetTimerRef.current = window.setTimeout(() => {
        setSessionFlyInMessageIds([]);
        setSessionFlyInToolIds([]);
        setSessionFlyInToolPanelKeys([]);
        setSessionFlyInStream(false);
        visibleEls.forEach((item) => {
          item.el.style.removeProperty("--pop-stagger");
        });
        sessionFlyInResetTimerRef.current = null;
      }, SESSION_SWITCH_IN_MS + maxStagger + 100);
    });
    sessionFlyInRafRefs.current.push(raf);
  }, [clearSessionFlyInMarks, props.uiSettings.enableAnimations]);

  const sendWithPhysics = useCallback(() => {
    if (props.connected) {
      triggerChatImpulse();
      triggerComposerLaunch();
    }
    props.onSend();
  }, [props.connected, props.onSend, triggerChatImpulse, triggerComposerLaunch]);

  useEffect(() => {
    if (prevSessionKeyRef.current === props.sessionKey) {
      return;
    }
    clearSessionSwitchTimers();

    const previousSnapshot = latestThreadSnapshotRef.current;
    const hasAnimations = props.uiSettings.enableAnimations;

    if (hasAnimations) {
      // Overlay + phase already set in useLayoutEffect (before paint).
      // Here we only set up timers.
      if (previousSnapshot) {
        // OUT → PREPARING → IN
        const outTimer = window.setTimeout(() => {
          setOutgoingThreadSnapshot(null);
          setSessionTransitionPhase("preparing");
          triggerVisibleSessionFlyIn(() => {
            setSessionTransitionPhase("in");
            triggerComposerLaunch();
            const inTimer = window.setTimeout(() => {
              setSessionTransitionPhase("idle");
              const ct = scrollRef.current;
              const mt = ct?.querySelector<HTMLElement>(".chat-thread-main");
              if (mt) mt.style.visibility = "";
            }, SESSION_SWITCH_IN_MS);
            sessionSwitchTimersRef.current.push(inTimer);
          });
        }, SESSION_SWITCH_OUT_MS);
        sessionSwitchTimersRef.current.push(outTimer);
      } else {
        // No snapshot (first visit to session) — skip OUT, fly in immediately
        triggerVisibleSessionFlyIn(() => {
          setSessionTransitionPhase("in");
          triggerComposerLaunch();
          const inTimer = window.setTimeout(() => {
            setSessionTransitionPhase("idle");
            const ct = scrollRef.current;
            const mt = ct?.querySelector<HTMLElement>(".chat-thread-main");
            if (mt) mt.style.visibility = "";
          }, SESSION_SWITCH_IN_MS);
          sessionSwitchTimersRef.current.push(inTimer);
        });
      }
    } else {
      setOutgoingThreadSnapshot(null);
      setSessionTransitionPhase("idle");
      const ct = scrollRef.current;
      const mt = ct?.querySelector<HTMLElement>(".chat-thread-main");
      if (mt) mt.style.visibility = "";
    }

    prevSessionKeyRef.current = props.sessionKey;
    setToolExpanded({});
    setVisibleMessageCount(MESSAGE_RENDER_STEP);
    setAutoScrollEnabled(true);
    setImageLightbox(null);
    setModelMenuOpen(false);
    setThinkingMenuOpen(false);
    setChatImpulseActive(false);
    setComposerLaunchActive(false);
    setPoppingMessageIds([]);
    setPoppingToolIds([]);
    setStreamPopActive(false);
    clearSessionFlyInMarks();
    prevMessageIdsRef.current = new Set(props.messages.map((message) => message.id));
    prevToolIdsRef.current = new Set(props.toolItems.map((tool) => tool.id));

    const container = scrollRef.current;
    if (!container) {
      return;
    }
    container.scrollTop = container.scrollHeight;
  }, [
    props.sessionKey,
    props.uiSettings.enableAnimations,
    props.messages,
    props.toolItems,
    clearSessionSwitchTimers,
    clearSessionFlyInMarks,
    triggerComposerLaunch,
    triggerVisibleSessionFlyIn,
  ]);

  useEffect(() => {
    const pending = restoreScrollRef.current;
    const container = scrollRef.current;
    if (!pending || !container) {
      return;
    }
    const delta = container.scrollHeight - pending.height;
    container.scrollTop = pending.top + delta;
    restoreScrollRef.current = null;
  }, [displayedMessages.length]);

  useEffect(() => {
    if (props.loadingOlder) {
      return;
    }
    olderLoadRequestedRef.current = false;
  }, [props.loadingOlder]);

  useEffect(() => {
    if (sessionTransitionPhase !== "idle") {
      streamWasActiveRef.current = Boolean(props.streamText);
      return;
    }
    const isStreaming = Boolean(props.streamText);
    if (isStreaming && !streamWasActiveRef.current) {
      triggerChatImpulse();
      if (props.uiSettings.enableAnimations) {
        setStreamPopActive(true);
        if (streamPopResetTimerRef.current !== null) {
          window.clearTimeout(streamPopResetTimerRef.current);
        }
        streamPopResetTimerRef.current = window.setTimeout(() => {
          setStreamPopActive(false);
          streamPopResetTimerRef.current = null;
        }, POP_MARK_MS);
      }
    }
    if (!isStreaming) {
      setStreamPopActive(false);
    }
    streamWasActiveRef.current = isStreaming;
  }, [props.streamText, props.uiSettings.enableAnimations, triggerChatImpulse, sessionTransitionPhase]);

  useEffect(() => {
    const currentIds = props.messages.map((message) => message.id);
    if (sessionTransitionPhase !== "idle") {
      prevMessageIdsRef.current = new Set(currentIds);
      return;
    }
    const previousIds = prevMessageIdsRef.current;
    const addedIds = currentIds.filter((id) => !previousIds.has(id));
    if (addedIds.length > 0) {
      markPoppingMessages(addedIds);
      triggerChatImpulse();
    }
    prevMessageIdsRef.current = new Set(currentIds);
  }, [props.messages, sessionTransitionPhase, markPoppingMessages, triggerChatImpulse]);

  useEffect(() => {
    const currentIds = props.toolItems.map((tool) => tool.id);
    if (sessionTransitionPhase !== "idle") {
      prevToolIdsRef.current = new Set(currentIds);
      return;
    }
    const previousIds = prevToolIdsRef.current;
    const addedIds = currentIds.filter((id) => !previousIds.has(id));
    if (addedIds.length > 0) {
      markPoppingTools(addedIds);
      triggerChatImpulse();
    }
    prevToolIdsRef.current = new Set(currentIds);
  }, [props.toolItems, sessionTransitionPhase, markPoppingTools, triggerChatImpulse]);

  useEffect(() => {
    return () => {
      clearSessionSwitchTimers();
      clearSessionFlyInMarks();
      if (chatImpulseResetTimerRef.current !== null) {
        window.clearTimeout(chatImpulseResetTimerRef.current);
      }
      if (composerLaunchResetTimerRef.current !== null) {
        window.clearTimeout(composerLaunchResetTimerRef.current);
      }
      if (popMessageResetTimerRef.current !== null) {
        window.clearTimeout(popMessageResetTimerRef.current);
      }
      if (popToolResetTimerRef.current !== null) {
        window.clearTimeout(popToolResetTimerRef.current);
      }
      if (sessionFlyInResetTimerRef.current !== null) {
        window.clearTimeout(sessionFlyInResetTimerRef.current);
      }
      if (streamPopResetTimerRef.current !== null) {
        window.clearTimeout(streamPopResetTimerRef.current);
      }
      if (chatImpulseRafRef.current !== null) {
        window.cancelAnimationFrame(chatImpulseRafRef.current);
      }
      if (composerLaunchRafRef.current !== null) {
        window.cancelAnimationFrame(composerLaunchRafRef.current);
      }
    };
  }, [clearSessionFlyInMarks, clearSessionSwitchTimers]);

  useEffect(() => {
    const onClickOutside = (event: MouseEvent) => {
      if (!(event.target instanceof Node)) {
        return;
      }
      if (modelMenuRef.current && !modelMenuRef.current.contains(event.target)) {
        setModelMenuOpen(false);
      }
      if (thinkingMenuRef.current && !thinkingMenuRef.current.contains(event.target)) {
        setThinkingMenuOpen(false);
      }
    };
    window.addEventListener("mousedown", onClickOutside);
    return () => window.removeEventListener("mousedown", onClickOutside);
  }, []);

  useEffect(() => {
    if (!imageLightbox) {
      return;
    }
    const onEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setImageLightbox(null);
      }
    };
    window.addEventListener("keydown", onEscape);
    return () => window.removeEventListener("keydown", onEscape);
  }, [imageLightbox]);

  useEffect(() => {
    if (!imageLightbox) {
      return;
    }
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = prevOverflow;
    };
  }, [imageLightbox]);

  const onLightboxImageError = useCallback(() => {
    if (!imageLightbox) {
      return;
    }
    const filePath = filePathFromImageSource(imageLightbox.dataUrl);
    if (isDesktopRuntime() && filePath) {
      const nextDesktopSrc = buildDesktopLocalImageUrl(filePath);
      if (nextDesktopSrc !== imageLightbox.dataUrl) {
        setImageLightbox((previous) => {
          if (!previous || previous.id !== imageLightbox.id) {
            return previous;
          }
          return {
            ...previous,
            dataUrl: nextDesktopSrc,
          };
        });
        return;
      }
    }
    const attemptedKey = imageLightbox.dataUrl;
    if (!attemptedKey || lightboxReadTriedRef.current.has(attemptedKey)) {
      return;
    }
    lightboxReadTriedRef.current.add(attemptedKey);
    const readImageFile = window.desktopInfo?.readImageFile;
    if (!readImageFile) {
      return;
    }
    if (!filePath) {
      return;
    }
    void readImageFile(filePath)
      .then((result) => {
        const nextDataUrl =
          result.ok && typeof result.dataUrl === "string" ? result.dataUrl.trim() : "";
        if (!nextDataUrl) {
          return;
        }
        setImageLightbox((previous) => {
          if (!previous || previous.id !== imageLightbox.id) {
            return previous;
          }
          lightboxReadTriedRef.current.add(nextDataUrl);
          return {
            ...previous,
            dataUrl: nextDataUrl,
          };
        });
      })
      .catch(() => {
        // ignore
      });
  }, [imageLightbox]);

  useEffect(() => {
    if (!imageLightbox) {
      return;
    }
    if (!isDesktopRuntime()) {
      return;
    }
    const filePath = filePathFromImageSource(imageLightbox.dataUrl);
    if (filePath) {
      const nextDesktopSrc = buildDesktopLocalImageUrl(filePath);
      if (nextDesktopSrc !== imageLightbox.dataUrl) {
        setImageLightbox((previous) => {
          if (!previous || previous.id !== imageLightbox.id) {
            return previous;
          }
          return {
            ...previous,
            dataUrl: nextDesktopSrc,
          };
        });
      }
      return;
    }
  }, [imageLightbox]);
  const lightboxBlockedByWebLocalFile = useMemo(() => {
    if (!imageLightbox) {
      return false;
    }
    return !isDesktopRuntime() && isLikelyLocalFileSource(imageLightbox.dataUrl);
  }, [imageLightbox]);

  useEffect(() => {
    const container = scrollRef.current;
    if (!container || !autoScrollEnabled || !props.uiSettings.showToolActivity) {
      return;
    }
    container.scrollTop = container.scrollHeight;
  }, [orderedTools, autoScrollEnabled, props.uiSettings.showToolActivity]);

  useEffect(() => {
    const container = scrollRef.current;
    if (!container || !autoScrollEnabled) {
      return;
    }
    const lastMessage = displayedMessages[displayedMessages.length - 1];
    if (lastMessage?.role === "assistant" && !props.uiSettings.autoScrollAssistantResponses) {
      return;
    }
    if (props.streamText && !props.uiSettings.autoScrollAssistantResponses) {
      return;
    }
    container.scrollTop = container.scrollHeight;
  }, [
    displayedMessages,
    props.streamText,
    props.thinking,
    autoScrollEnabled,
    props.uiSettings.autoScrollAssistantResponses,
  ]);

  const onScroll: React.UIEventHandler<HTMLDivElement> = (event) => {
    const container = event.currentTarget;
    const distanceToBottom = container.scrollHeight - (container.scrollTop + container.clientHeight);
    const nearBottom = distanceToBottom <= AUTO_SCROLL_BOTTOM_THRESHOLD;
    if (nearBottom !== autoScrollEnabled) {
      setAutoScrollEnabled(nearBottom);
    }
    if (container.scrollTop > 80) {
      return;
    }
    if (visibleMessageCount < props.messages.length) {
      restoreScrollRef.current = {
        height: container.scrollHeight,
        top: container.scrollTop,
      };
      setVisibleMessageCount((prev) => Math.min(props.messages.length, prev + MESSAGE_RENDER_STEP));
      return;
    }
    if (props.canLoadOlder && !props.loadingOlder && !olderLoadRequestedRef.current) {
      olderLoadRequestedRef.current = true;
      props.onLoadOlder();
    }
  };

  const actionScale = props.uiSettings.composerActionScale;
  const actionFontSize = `${Math.round(12 * actionScale)}px`;
  const actionPaddingY = `${Math.round(8 * actionScale)}px`;
  const actionPaddingX = `${Math.round(12 * actionScale)}px`;
  const sendFontSize = `${Math.round(14 * actionScale)}px`;
  const sendPaddingY = `${Math.round(8 * actionScale)}px`;
  const sendPaddingX = `${Math.round(20 * actionScale)}px`;
  const modelBadgeScale = props.uiSettings.modelBadgeScale;
  const modelBadgeFontSize = `${Math.round(12 * modelBadgeScale)}px`;
  const modelBadgePaddingY = `${Math.round(4 * modelBadgeScale)}px`;
  const modelBadgePaddingX = `${Math.round(12 * modelBadgeScale)}px`;
  const toolFontSize = `${props.uiSettings.toolCallFontSize}px`;
  const toolMinorFontSize = `${Math.max(10, props.uiSettings.toolCallFontSize - 2)}px`;
  const typographyFontSize = `${props.uiSettings.fontSize}px`;

  useEffect(() => {
    if (props.messages.length < visibleMessageCount) {
      setVisibleMessageCount(Math.max(MESSAGE_RENDER_STEP, props.messages.length));
    }
  }, [props.messages.length, visibleMessageCount]);

  useLayoutEffect(() => {
    autoResizeComposer();
  }, [props.draft, autoResizeComposer]);

  useEffect(() => {
    window.addEventListener("resize", autoResizeComposer);
    return () => window.removeEventListener("resize", autoResizeComposer);
  }, [autoResizeComposer]);

  const showSlashMenu = props.draft.trim().startsWith("/");
  const commandQuery = props.draft.trim().replace(/^\//, "");
  const tokens = commandQuery.split(/\s+/).filter(Boolean);
  const commandName = tokens[0] ?? "";
  const commandArgs = tokens.slice(1).join(" ");

  const commandSuggestions = useMemo<Array<SlashCommand & { value?: string }>>(() => {
    if (!showSlashMenu) {
      return [];
    }
    const thinkCommand = commandName === "think" || commandName === "thinking" || commandName === "t";
    if (commandName && (commandName === "model" || thinkCommand)) {
      if (commandName === "model") {
        return props.models
          .filter((model) => `${model.provider}/${model.id}`.toLowerCase().includes(commandArgs.toLowerCase()))
          .slice(0, 8)
          .map((model) => ({
            name: "model",
            description: model.name,
            value: `${model.provider}/${model.id}`,
          }));
      }
      const thinkLevels = ["off", "minimal", "low", "medium", "high", "xhigh"];
      return thinkLevels
        .filter((level) => level.startsWith(commandArgs.toLowerCase()))
        .map((level) => ({ name: commandName, description: "Thinking level", value: level }));
    }
    return BASE_COMMANDS.filter((cmd) => cmd.name.toLowerCase().startsWith(commandName.toLowerCase()));
  }, [showSlashMenu, commandName, commandArgs, props.models]);

  const requiresArgs =
    commandName === "model" ||
    commandName === "think" ||
    commandName === "thinking" ||
    commandName === "t";
  const exactCommand = BASE_COMMANDS.find((cmd) => cmd.name === commandName) ?? null;

  const applySuggestion = (suggestion: SlashCommand & { value?: string }) => {
    if (suggestion.value) {
      props.onDraftChange(`/${suggestion.name} ${suggestion.value} `);
    } else {
      props.onDraftChange(`/${suggestion.name} `);
    }
    setActiveCommand(0);
  };

  const onKeyDown: React.KeyboardEventHandler<HTMLTextAreaElement> = (event) => {
    const nativeEvent = event.nativeEvent as KeyboardEvent;
    const keyCode = (nativeEvent as KeyboardEvent & { keyCode?: number }).keyCode;
    if (
      nativeEvent.isComposing ||
      isComposingRef.current ||
      event.key === "Process" ||
      keyCode === 229
    ) {
      return;
    }
    if (
      showSlashMenu &&
      commandSuggestions.length > 0 &&
      (event.key === "ArrowDown" || event.key === "ArrowUp")
    ) {
      event.preventDefault();
      const delta = event.key === "ArrowDown" ? 1 : -1;
      const next = (activeCommand + delta + commandSuggestions.length) % commandSuggestions.length;
      setActiveCommand(next);
      return;
    }
    if (showSlashMenu && event.key === "Tab" && commandSuggestions.length > 0) {
      event.preventDefault();
      applySuggestion(commandSuggestions[activeCommand]!);
      return;
    }
    if (event.key === "Enter" && !event.shiftKey) {
      event.preventDefault();
      if (showSlashMenu && commandSuggestions.length > 0 && commandName && !commandArgs) {
        if (exactCommand && !requiresArgs) {
          sendWithPhysics();
          return;
        }
        applySuggestion(commandSuggestions[activeCommand]!);
        return;
      }
      if (showSlashMenu && exactCommand && !requiresArgs) {
        sendWithPhysics();
        return;
      }
      if (showSlashMenu && requiresArgs && !commandArgs) {
        return;
      }
      sendWithPhysics();
    }
  };

  const streamMarkdownHtml = useMemo(
    () => (props.streamText ? renderMarkdown(props.streamText) : ""),
    [props.streamText],
  );
  const streamMotionStyle = useMemo(
    () => buildMotionVars(`stream-${props.sessionKey ?? "none"}`),
    [props.sessionKey],
  );

  const renderToolPanel = (tools: ToolItem[], key: string, opts?: { snapshot?: boolean }) => {
    if (tools.length === 0) {
      return null;
    }
    const snapshotMode = opts?.snapshot ?? false;
    const panelFlyIn = !snapshotMode && sessionFlyInToolPanelKeySet.has(key);
    const panelMotionStyle = buildMotionVars(key);
    return (
      <section
        key={key}
        className={`tool-panel ${panelFlyIn ? "session-fly-in" : ""}`}
        data-tool-panel-key={key}
        style={panelMotionStyle}
      >
        <div className="tool-panel-header">
          <div className="tool-panel-title" style={{ fontSize: toolMinorFontSize }}>
            Tool Activity ({tools.length})
          </div>
        </div>

        <div className="tool-grid">
          {tools.map((tool) => {
            const expanded = snapshotMode ? false : (toolExpanded[tool.id] ?? false);
            const statusLabel = tool.status === "result" ? "done" : "running";
            const outputPreview = (tool.output ?? "").replace(/\s+/g, " ").trim();
            const argsPreview = JSON.stringify(tool.args ?? {}).replace(/\s+/g, " ").trim().slice(0, 120);
            const summary = (outputPreview || argsPreview).slice(0, 120);
            const drawerPop = !snapshotMode && poppingToolIdSet.has(tool.id);
            const sessionFlyIn = !snapshotMode && sessionFlyInToolIdSet.has(tool.id);
            const motionStyle = buildMotionVars(tool.id);
            return (
              <article
                key={tool.id}
                className={`tool-entry ${expanded ? "is-expanded" : ""} ${drawerPop ? "drawer-pop" : ""} ${sessionFlyIn ? "session-fly-in" : ""}`}
                data-tool-id={tool.id}
                style={{ ...motionStyle, fontSize: toolFontSize }}
              >
                <button
                  type="button"
                  onClick={() => {
                    if (snapshotMode) {
                      return;
                    }
                    setToolExpanded((prev) => ({ ...prev, [tool.id]: !expanded }));
                  }}
                  className="tool-entry-toggle"
                  aria-expanded={expanded}
                >
                  <span className="tool-title-wrap">
                    <span className={`tool-status-dot ${statusLabel === "done" ? "done" : "running"}`} />
                    <span className="tool-title">{tool.name}</span>
                    <span className="tool-status-text" style={{ fontSize: toolMinorFontSize }}>
                      {statusLabel}
                    </span>
                  </span>
                  {!expanded && summary && (
                    <span className="tool-summary" style={{ fontSize: toolMinorFontSize }}>
                      {summary}
                    </span>
                  )}
                </button>

                {expanded && (
                  <div className="tool-expanded">
                    <div>
                      <div className="tool-expanded-title" style={{ fontSize: toolMinorFontSize }}>
                        Args
                      </div>
                      <pre className="tool-pre">{JSON.stringify(tool.args ?? {}, null, 2)}</pre>
                    </div>
                    <div>
                      <div className="tool-expanded-title" style={{ fontSize: toolMinorFontSize }}>
                        Output
                      </div>
                      <pre className="tool-pre">{tool.output ?? "(no output)"}</pre>
                    </div>
                  </div>
                )}
              </article>
            );
          })}
        </div>
      </section>
    );
  };

  const outgoingToolTimelineByMessage = useMemo(
    () => new Map(outgoingThreadSnapshot?.toolByMessageEntries ?? []),
    [outgoingThreadSnapshot],
  );

  return (
    <section className="claw-chat-area chat-shell">
      <header className={`chat-header ${modelMenuOpen || thinkingMenuOpen ? "menu-layer-active" : ""}`}>
        <div className="chat-header-main">
          <div className="chat-brand-title">ClawUI</div>
          <div className="topbar-status">
            <span className={`status-dot ${props.connected ? "connected" : "disconnected"}`} />
            <span>{props.connected ? "Gateway connected" : "Gateway disconnected"}</span>
          </div>
        </div>

        <div className="chat-header-actions">
          <div className={`relative ${modelMenuOpen ? "menu-open-ctx" : ""}`} ref={modelMenuRef}>
            <button
              type="button"
              onClick={() => setModelMenuOpen((prev) => !prev)}
              className="ui-btn ui-btn-light"
              style={{
                fontSize: modelBadgeFontSize,
                padding: `${modelBadgePaddingY} ${modelBadgePaddingX}`,
              }}
            >
              Agent: {props.sessionInfo.agentLabel || "-"} · Model:{" "}
              {props.sessionInfo.modelLabel || "-"}
            </button>

            {modelMenuOpen && (
              <div className="floating-menu" style={{ fontSize: modelBadgeFontSize }}>
                {modelChoices.length === 0 && <div className="floating-empty">No available models.</div>}
                {modelChoices.map((model) => {
                  const isActive =
                    model.full === activeModel || model.id === activeModel || model.name === activeModel;
                  return (
                    <button
                      key={model.full}
                      type="button"
                      onClick={() => {
                        setModelMenuOpen(false);
                        props.onModelSelect(model.full);
                      }}
                      className={`floating-item ${isActive ? "active" : ""}`}
                    >
                      <div className="floating-item-title">{model.full}</div>
                      <div className="floating-item-subtitle">{model.name}</div>
                    </button>
                  );
                })}
              </div>
            )}
          </div>

          {props.canAbort && (
            <button type="button" onClick={props.onAbort} className="ui-btn ui-btn-light">
              Stop
            </button>
          )}
          <button type="button" onClick={props.onCreateSession} className="ui-btn ui-btn-light">
            New Session
          </button>
          <button type="button" onClick={props.onOpenSettings} className="ui-btn ui-btn-primary">
            Settings
          </button>
        </div>
      </header>

      <div ref={scrollRef} onScroll={onScroll} className="chat-scroll">
        {outgoingThreadSnapshot && sessionTransitionPhase === "out" && (
          <div className="chat-thread-overlay" aria-hidden="true">
            <div
              key={`outgoing-${outgoingThreadSnapshot.sessionKey ?? "none"}`}
              className="chat-thread chat-thread-outgoing"
              style={{ maxWidth: "var(--claw-content-width)", gap: "var(--claw-message-gap)" }}
            >
              {(outgoingThreadSnapshot.hiddenMessageCount > 0 || outgoingThreadSnapshot.loadingOlder) && (
                <div className="history-hint">
                  {outgoingThreadSnapshot.loadingOlder
                    ? "Loading older messages..."
                    : `${outgoingThreadSnapshot.hiddenMessageCount} older messages available. Scroll up to load.`}
                </div>
              )}

              {outgoingThreadSnapshot.displayedMessages.length === 0 && (
                <article className="empty-state">
                  <div className="empty-state-title">Start a new session</div>
                  <div className="empty-state-copy">
                    Ask OpenClaw anything. Use slash commands like /model, /status, /usage.
                  </div>
                </article>
              )}

              {props.uiSettings.showToolActivity &&
                renderToolPanel(outgoingThreadSnapshot.toolBeforeFirst, "snapshot-tool-before-first", { snapshot: true })}

              {outgoingThreadSnapshot.displayedMessages.map((msg) => (
                <React.Fragment key={`snapshot-${msg.id}`}>
                  <MessageRow
                    message={msg}
                    showTimestamp={props.uiSettings.showMessageTimestamp}
                    timestampFontSize={props.uiSettings.messageTimestampFontSize}
                    drawerPop={false}
                    onOpenImage={setImageLightbox}
                    onResolveRemoteImage={props.onResolveRemoteImage}
                  />
                  {props.uiSettings.showToolActivity &&
                    renderToolPanel(outgoingToolTimelineByMessage.get(msg.id) ?? [], `snapshot-tool-after-${msg.id}`, {
                      snapshot: true,
                    })}
                </React.Fragment>
              ))}

              {outgoingThreadSnapshot.streamText && (
                <div className="message-row assistant">
                  <article className="message-bubble assistant stream-bubble">
                    <div className="message-role">Assistant</div>
                    <div
                      className="markdown"
                      dangerouslySetInnerHTML={{ __html: renderMarkdown(outgoingThreadSnapshot.streamText) }}
                    />
                  </article>
                </div>
              )}

              {!outgoingThreadSnapshot.streamText && outgoingThreadSnapshot.thinking && (
                <div className="message-row assistant">
                  <article className="message-bubble assistant thinking-indicator">
                    <span className="thinking-label">Thinking</span>
                    <span className="thinking-dots" aria-hidden="true">
                      <span className="dot" />
                      <span className="dot" />
                      <span className="dot" />
                    </span>
                  </article>
                </div>
              )}
            </div>
          </div>
        )}

        <div
          key={`main-${props.sessionKey ?? "none"}`}
          className={`chat-thread chat-thread-main ${chatImpulseActive ? "is-impulsing" : ""} ${(sessionTransitionPhase === "out" || sessionTransitionPhase === "preparing") ? "is-hidden-for-switch-out" : ""}`}
          style={{ maxWidth: "var(--claw-content-width)", gap: "var(--claw-message-gap)" }}
        >
          {(hiddenMessageCount > 0 || props.loadingOlder) && (
            <div className="history-hint">
              {props.loadingOlder
                ? "Loading older messages..."
                : `${hiddenMessageCount} older messages available. Scroll up to load.`}
            </div>
          )}

          {props.messages.length === 0 && (
            <article className="empty-state">
              <div className="empty-state-title">Start a new session</div>
              <div className="empty-state-copy">
                Ask OpenClaw anything. Use slash commands like /model, /status, /usage.
              </div>
            </article>
          )}

          {props.uiSettings.showToolActivity && renderToolPanel(toolTimeline.beforeFirst, "tool-before-first")}

          {displayedMessages.map((msg) => (
            <React.Fragment key={msg.id}>
              <MessageRow
                message={msg}
                showTimestamp={props.uiSettings.showMessageTimestamp}
                timestampFontSize={props.uiSettings.messageTimestampFontSize}
                drawerPop={poppingMessageIdSet.has(msg.id)}
                sessionFlyIn={sessionFlyInMessageIdSet.has(msg.id)}
                onOpenImage={setImageLightbox}
                onResolveRemoteImage={props.onResolveRemoteImage}
              />
              {props.uiSettings.showToolActivity &&
                renderToolPanel(toolTimeline.byMessageId.get(msg.id) ?? [], `tool-after-${msg.id}`)}
            </React.Fragment>
          ))}

          {props.streamText && (
            <div
              className={`message-row assistant ${streamPopActive ? "drawer-pop" : ""} ${sessionFlyInStream ? "session-fly-in" : ""}`}
              data-stream-row="1"
              style={streamMotionStyle}
            >
              <article className="message-bubble assistant stream-bubble">
                <div className="message-role">Assistant</div>
                <div
                  className="markdown"
                  dangerouslySetInnerHTML={{ __html: streamMarkdownHtml }}
                />
              </article>
            </div>
          )}

          {!props.streamText && props.thinking && (
            <div className="message-row assistant">
              <article className="message-bubble assistant thinking-indicator">
                <span className="thinking-label">Thinking</span>
                <span className="thinking-dots" aria-hidden="true">
                  <span className="dot" />
                  <span className="dot" />
                  <span className="dot" />
                </span>
              </article>
            </div>
          )}
        </div>
      </div>

      <footer className="composer-shell">
        <div
          className={`composer-inner ${composerLaunchActive ? "is-launching" : ""}`}
          onDragOver={(e) => {
            e.preventDefault();
            e.stopPropagation();
          }}
          onDrop={(e) => {
            e.preventDefault();
            e.stopPropagation();
            const files = Array.from(e.dataTransfer?.files ?? []);
            if (files.length === 0) {
              return;
            }
            const reads: Promise<Attachment>[] = files.map((file) => {
              return new Promise((resolve, reject) => {
                const reader = new FileReader();
                reader.onload = () => {
                  const dataUrl = typeof reader.result === "string" ? reader.result : "";
                  resolve({
                    id: `drop-${Date.now()}-${Math.random().toString(36).slice(2, 8)}-${file.name}`,
                    name: file.name,
                    size: file.size,
                    type: file.type || "application/octet-stream",
                    dataUrl,
                    isImage: file.type.startsWith("image/"),
                  });
                };
                reader.onerror = () => reject(reader.error);
                reader.readAsDataURL(file);
              });
            });
            Promise.all(reads)
              .then((next) => {
                props.onAttachmentsChange([...props.attachments, ...next]);
              })
              .catch(() => {
                // ignore
              });
          }}
        >
          {!props.connected && (
            <div className="composer-warning">
              {props.disabledReason || "Gateway disconnected. Update settings to reconnect."}
            </div>
          )}

          <div className="composer-input-wrap">
            <textarea
              ref={composerTextareaRef}
              value={props.draft}
              onChange={(e) => props.onDraftChange(e.target.value)}
              onCompositionStart={() => {
                isComposingRef.current = true;
              }}
              onCompositionEnd={() => {
                isComposingRef.current = false;
              }}
              onKeyDown={onKeyDown}
              onPaste={(e) => {
                const items = e.clipboardData?.items;
                if (!items) {
                  return;
                }
                const imageFiles: File[] = [];
                for (let i = 0; i < items.length; i += 1) {
                  const item = items[i];
                  if (item && item.kind === "file" && item.type.startsWith("image/")) {
                    const file = item.getAsFile();
                    if (file) {
                      imageFiles.push(file);
                    }
                  }
                }
                if (imageFiles.length === 0) {
                  return;
                }
                e.preventDefault();
                const reads: Promise<Attachment>[] = imageFiles.map((file) => {
                  return new Promise((resolve, reject) => {
                    const reader = new FileReader();
                    reader.onload = () => {
                      const dataUrl = typeof reader.result === "string" ? reader.result : "";
                      resolve({
                        id: `paste-${Date.now()}-${Math.random().toString(36).slice(2, 8)}-${file.name}`,
                        name: file.name || `pasted-image.${file.type.split("/")[1] || "png"}`,
                        size: file.size,
                        type: file.type || "image/png",
                        dataUrl,
                        isImage: true,
                      });
                    };
                    reader.onerror = () => reject(reader.error);
                    reader.readAsDataURL(file);
                  });
                });
                Promise.all(reads)
                  .then((next) => {
                    props.onAttachmentsChange([...props.attachments, ...next]);
                  })
                  .catch(() => {
                    // ignore
                  });
              }}
              placeholder="Type a message or /command"
              className="composer-textarea"
              style={{
                fontFamily: "var(--claw-font)",
                fontSize: "var(--claw-font-size)",
                lineHeight: "var(--claw-line-height)",
              }}
            />

            {showSlashMenu && commandSuggestions.length > 0 && (
              <div className="slash-menu" style={{ fontSize: typographyFontSize }}>
                {commandSuggestions.map((cmd, idx) => (
                  <button
                    key={`${cmd.name}-${cmd.value ?? cmd.description}`}
                    type="button"
                    onClick={() => applySuggestion(cmd)}
                    className={`slash-item ${idx === activeCommand ? "active" : ""}`}
                  >
                    <span className="slash-name">/{cmd.name}</span>
                    <span className="slash-detail">{cmd.value ?? cmd.description}</span>
                  </button>
                ))}
              </div>
            )}
          </div>

          {props.attachments.length > 0 && (
            <div className="attachment-preview-list">
              {props.attachments.map((att) => (
                <div key={att.id} className={`attachment-preview-item ${att.isImage ? "is-image" : "is-file"}`}>
                  {att.isImage ? (
                    <div className="attachment-preview-thumb">
                      <img src={att.dataUrl} alt={att.name} className="attachment-preview-img" />
                    </div>
                  ) : (
                    <div className="attachment-preview-file-icon">
                      <span className="attachment-preview-file-ext">
                        {att.name.split(".").pop()?.toUpperCase().slice(0, 4) || "FILE"}
                      </span>
                    </div>
                  )}
                  <div className="attachment-preview-info">
                    <span className="attachment-preview-name" title={att.name}>{truncate(att.name, 20)}</span>
                    <span className="attachment-preview-size">{formatBytes(att.size)}</span>
                  </div>
                  <button
                    type="button"
                    onClick={() =>
                      props.onAttachmentsChange(props.attachments.filter((item) => item.id !== att.id))
                    }
                    className="attachment-preview-remove"
                    aria-label={`Remove ${att.name}`}
                  >
                    ×
                  </button>
                </div>
              ))}
            </div>
          )}

          <div className="composer-actions-row">
            <div className="composer-actions">
              <label
                className="attachment-trigger"
                style={{
                  fontSize: actionFontSize,
                  padding: `${actionPaddingY} ${actionPaddingX}`,
                }}
              >
                + Attach
                <input
                  type="file"
                  multiple
                  className="hidden"
                  onChange={(e) => {
                    const files = Array.from(e.target.files ?? []);
                    const events: Promise<Attachment>[] = files.map((file) => {
                      return new Promise((resolve, reject) => {
                        const reader = new FileReader();
                        reader.onload = () => {
                          const dataUrl = typeof reader.result === "string" ? reader.result : "";
                          resolve({
                            id: `${file.name}-${file.size}-${file.lastModified}`,
                            name: file.name,
                            size: file.size,
                            type: file.type || "application/octet-stream",
                            dataUrl,
                            isImage: file.type.startsWith("image/"),
                          });
                        };
                        reader.onerror = () => reject(reader.error);
                        reader.readAsDataURL(file);
                      });
                    });
                    Promise.all(events)
                      .then((next) => {
                        props.onAttachmentsChange([...props.attachments, ...next]);
                      })
                      .catch(() => {
                        // ignore
                      });
                  }}
                />
              </label>

              <button
                type="button"
                onClick={sendWithPhysics}
                disabled={!props.connected}
                className="ui-btn ui-btn-primary"
                style={{
                  fontSize: sendFontSize,
                  padding: `${sendPaddingY} ${sendPaddingX}`,
                }}
              >
                Send
              </button>
            </div>

            <div className="footer-stats" style={{ fontSize: `${props.uiSettings.footerStatsFontSize}px` }}>
              {props.onCompact && (
                <button
                  type="button"
                  onClick={props.onCompact}
                  className="ui-btn ui-btn-light compact-btn"
                  title="Compact session context"
                >
                  🧹 Compact
                </button>
              )}
              <span>
                Context:{" "}
                {(() => {
                  const total =
                    props.sessionInfo.totalTokens ??
                    (Number.isFinite(props.sessionInfo.inputTokens) || Number.isFinite(props.sessionInfo.outputTokens)
                      ? (props.sessionInfo.inputTokens ?? 0) + (props.sessionInfo.outputTokens ?? 0)
                      : null);
                  const used = Number.isFinite(total) ? total : null;
                  const modelId = props.sessionInfo.modelId || props.sessionInfo.modelLabel;
                  const model =
                    props.models.find((item) => item.id === modelId) ??
                    props.models.find((item) => `${item.provider}/${item.id}` === modelId) ??
                    props.models.find((item) => `${item.provider}/${item.name}` === modelId) ??
                    null;
                  const limit = model?.contextWindow ?? props.sessionInfo.contextLimit ?? null;
                  if (!Number.isFinite(used)) {
                    return "-";
                  }
                  if (Number.isFinite(limit)) {
                    const percent = Math.max(0, Math.min(100, ((used as number) / (limit as number)) * 100));
                    return `${formatCompactTokens(used)} / ${formatCompactTokens(limit)} (${percent.toFixed(0)}%)`;
                  }
                  return formatCompactTokens(used);
                })()}
              </span>
              <span>In: {formatCompactTokens(props.sessionInfo.inputTokens)}</span>
              <span>Out: {formatCompactTokens(props.sessionInfo.outputTokens)}</span>
              <span>Total: {formatCompactTokens(props.sessionInfo.totalTokens)}</span>

              <div className={`relative ${thinkingMenuOpen ? "menu-open-ctx" : ""}`} ref={thinkingMenuRef}>
                <button
                  type="button"
                  onClick={() => setThinkingMenuOpen((prev) => !prev)}
                  className="ui-btn ui-btn-light"
                >
                  Thinking: {activeThinking}
                </button>
                {thinkingMenuOpen && (
                  <div className="thinking-menu">
                    {thinkChoices.map((level) => {
                      const isActive = level === activeThinking;
                      return (
                        <button
                          key={level}
                          type="button"
                          onClick={() => {
                            setThinkingMenuOpen(false);
                            props.onThinkingSelect(level);
                          }}
                          className={`thinking-item ${isActive ? "active" : ""}`}
                        >
                          {level}
                        </button>
                      );
                    })}
                  </div>
                )}
              </div>
            </div>
          </div>
        </div>
      </footer>

      {imageLightbox && (
        <div
          className="image-lightbox-backdrop"
          role="dialog"
          aria-modal="true"
          aria-label="Image viewer"
          onClick={() => setImageLightbox(null)}
        >
          <div className="image-lightbox" onClick={(event) => event.stopPropagation()}>
            <div className="image-lightbox-header">
              <div className="image-lightbox-name" title={imageLightbox.name}>
                {imageLightbox.name}
              </div>
              <div className="image-lightbox-actions">
                <a
                  className="ui-btn ui-btn-light"
                  href={imageLightbox.dataUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                >
                  Open
                </a>
                <button
                  type="button"
                  className="ui-btn ui-btn-primary"
                  onClick={() => setImageLightbox(null)}
                >
                  Close
                </button>
              </div>
            </div>
            <div className="image-lightbox-body">
              {lightboxBlockedByWebLocalFile ? (
                <div className="attachment-image-fallback">
                  Web cannot render local file paths. Use desktop app or provide http/data image URL.
                </div>
              ) : (
                <img
                  src={imageLightbox.dataUrl}
                  alt={imageLightbox.name}
                  className="image-lightbox-image"
                  onError={onLightboxImageError}
                />
              )}
            </div>
          </div>
        </div>
      )}

      {/* Scrim: portaled to document.body so it paints below menus.
          Dims the background when a dropdown menu is open. */}
      {(modelMenuOpen || thinkingMenuOpen || (showSlashMenu && commandSuggestions.length > 0)) && createPortal(
        <div
          className="menu-scrim"
          onClick={() => {
            setModelMenuOpen(false);
            setThinkingMenuOpen(false);
            // For slash menu: blur the textarea so the user can interact with the page
            if (showSlashMenu) {
              const ta = document.querySelector(".composer-textarea") as HTMLElement | null;
              if (ta) ta.blur();
            }
          }}
        />,
        document.body
      )}
    </section>
  );
}
