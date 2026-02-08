import React, { useEffect, useMemo, useRef, useState } from "react";
import ChatView from "./components/ChatView.tsx";
import SessionSidebar from "./components/SessionSidebar.tsx";
import SettingsModal from "./components/SettingsModal.tsx";
import NewSessionModal from "./components/NewSessionModal.tsx";
import { GatewayClient } from "./lib/gateway.ts";
import { extractImages, extractText, isToolMessage } from "./lib/message-extract.ts";
import {
  type AgentsListResult,
  type ChatMessage,
  type ChatHistoryResult,
  type GatewaySessionRow,
  type ModelsListResult,
  type SessionsListResult,
  type ToolItem,
  type Attachment,
} from "./lib/types.ts";
import { generateUUID } from "./lib/uuid.ts";
import { formatCompactTokens, slugify } from "./lib/format.ts";
import {
  DEFAULT_UI_SETTINGS,
  type ReplyDoneSoundSource,
  type ReplyDoneSoundTone,
  type UiSettings,
} from "./lib/ui-settings.ts";
import { createReplyDoneSoundPlayer } from "./lib/reply-done-sound.ts";

const STORAGE_KEYS = {
  gatewayUrl: "clawui.gateway.url",
  token: "clawui.gateway.token",
  uiSettings: "clawui.ui.settings",
  uiSettingsSchemes: "clawui.ui.settings.schemes",
  activeUiSettingsScheme: "clawui.ui.settings.activeScheme",
  lastSession: "clawui.session.last",
};

const SESSION_LIST_INITIAL_LIMIT = 80;
const SESSION_LIST_STEP = 80;
const SESSION_LIST_MAX_LIMIT = 1000;
const CHAT_HISTORY_INITIAL_LIMIT = 120;
const CHAT_HISTORY_STEP = 120;
const CHAT_HISTORY_MAX_LIMIT = 1000;
const DEFAULT_MAX_WS_PAYLOAD_BYTES = 512 * 1024;
const WS_PAYLOAD_SAFETY_BYTES = 8 * 1024;
const MIN_IMAGE_ATTACHMENT_BYTES = 48 * 1024;
const BUILTIN_UI_SETTINGS_SCHEME_ID = "default";
const MAX_REPLY_DONE_CUSTOM_AUDIO_DATA_URL_CHARS = 900_000;

type UiSettingsScheme = {
  id: string;
  name: string;
  settings: UiSettings;
  updatedAt: number;
};

function getDefaultGatewayUrl(): string {
  if (typeof window === "undefined") {
    return "ws://127.0.0.1:18789";
  }
  const protocol = window.location.protocol === "https:" ? "wss" : "ws";
  const host = window.location.hostname || "127.0.0.1";
  return `${protocol}://${host}:18789`;
}

function normalizeGatewayUrl(value: string): string {
  const trimmed = value.trim();
  if (trimmed.startsWith("http://")) {
    return `ws://${trimmed.slice("http://".length)}`;
  }
  if (trimmed.startsWith("https://")) {
    return `wss://${trimmed.slice("https://".length)}`;
  }
  return trimmed;
}

const DEFAULT_GATEWAY_URL = getDefaultGatewayUrl();

function loadStored(key: string, fallback = ""): string {
  try {
    const value = localStorage.getItem(key);
    return value ?? fallback;
  } catch {
    return fallback;
  }
}

function parseNumberSetting(
  value: unknown,
  fallback: number,
  min: number,
  max: number,
): number {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    return fallback;
  }
  return Math.max(min, Math.min(max, value));
}

function parseColorSetting(value: unknown, fallback: string): string {
  if (typeof value !== "string") {
    return fallback;
  }
  const trimmed = value.trim();
  if (!trimmed) {
    return fallback;
  }
  const isHex = /^#([0-9a-f]{3}|[0-9a-f]{6}|[0-9a-f]{8})$/i.test(trimmed);
  const isRgb = /^rgba?\(\s*[-\d.%\s,]+\)$/i.test(trimmed);
  const isHsl = /^hsla?\(\s*[-\d.%\s,]+\)$/i.test(trimmed);
  return isHex || isRgb || isHsl ? trimmed : fallback;
}

function parseReplyDoneSoundTone(
  value: unknown,
  fallback: ReplyDoneSoundTone,
): ReplyDoneSoundTone {
  if (value === "soft") {
    return "marimba";
  }
  if (value === "balanced") {
    return "glass";
  }
  if (value === "bright") {
    return "crystal";
  }
  return value === "glass" ||
      value === "marimba" ||
      value === "bell" ||
      value === "crystal" ||
      value === "harp" ||
      value === "wood" ||
      value === "synth" ||
      value === "orb"
    ? value
    : fallback;
}

function parseReplyDoneSoundSource(
  value: unknown,
  fallback: ReplyDoneSoundSource,
): ReplyDoneSoundSource {
  return value === "custom" || value === "tone" ? value : fallback;
}

function parseReplyDoneSoundCustomAudioDataUrl(value: unknown): string {
  if (typeof value !== "string") {
    return "";
  }
  const trimmed = value.trim();
  if (!trimmed || trimmed.length > MAX_REPLY_DONE_CUSTOM_AUDIO_DATA_URL_CHARS) {
    return "";
  }
  if (!trimmed.startsWith("data:audio/")) {
    return "";
  }
  if (!trimmed.includes(";base64,")) {
    return "";
  }
  return trimmed;
}

function parseReplyDoneSoundCustomAudioName(value: unknown): string {
  if (typeof value !== "string") {
    return "";
  }
  return value.trim().slice(0, 120);
}

function formatSessionTimeLabel(date: Date): string {
  const pad = (value: number) => String(value).padStart(2, "0");
  const year = date.getFullYear();
  const month = pad(date.getMonth() + 1);
  const day = pad(date.getDate());
  const hours = pad(date.getHours());
  const minutes = pad(date.getMinutes());
  const seconds = pad(date.getSeconds());
  return `${year}${month}${day}-${hours}${minutes}${seconds}`;
}

function resolveSessionLabel(label: string): string {
  const trimmed = label.trim();
  if (trimmed) {
    return trimmed;
  }
  return `session-${formatSessionTimeLabel(new Date())}`;
}

function parseUiSettings(value: unknown): UiSettings {
  const parsed = value && typeof value === "object" ? (value as Partial<UiSettings>) : {};
  return {
    fontFamily: typeof parsed.fontFamily === "string" && parsed.fontFamily.trim()
      ? parsed.fontFamily.trim()
      : DEFAULT_UI_SETTINGS.fontFamily,
    fontSize: parseNumberSetting(parsed.fontSize, DEFAULT_UI_SETTINGS.fontSize, 10, 32),
    lineHeight: parseNumberSetting(parsed.lineHeight, DEFAULT_UI_SETTINGS.lineHeight, 1.1, 2.8),
    contentWidth: parseNumberSetting(
      parsed.contentWidth,
      DEFAULT_UI_SETTINGS.contentWidth,
      420,
      1400,
    ),
    sidebarFontSize: parseNumberSetting(
      parsed.sidebarFontSize,
      DEFAULT_UI_SETTINGS.sidebarFontSize,
      10,
      18,
    ),
    sidebarWidth: parseNumberSetting(
      parsed.sidebarWidth,
      DEFAULT_UI_SETTINGS.sidebarWidth,
      220,
      420,
    ),
    modelBadgeScale: parseNumberSetting(
      parsed.modelBadgeScale,
      DEFAULT_UI_SETTINGS.modelBadgeScale,
      0.8,
      1.8,
    ),
    composerActionScale: parseNumberSetting(
      parsed.composerActionScale,
      DEFAULT_UI_SETTINGS.composerActionScale,
      0.8,
      1.8,
    ),
    footerStatsFontSize: parseNumberSetting(
      parsed.footerStatsFontSize,
      DEFAULT_UI_SETTINGS.footerStatsFontSize,
      10,
      18,
    ),
    autoScrollAssistantResponses:
      typeof parsed.autoScrollAssistantResponses === "boolean"
        ? parsed.autoScrollAssistantResponses
        : DEFAULT_UI_SETTINGS.autoScrollAssistantResponses,
    showMessageTimestamp:
      typeof parsed.showMessageTimestamp === "boolean"
        ? parsed.showMessageTimestamp
        : DEFAULT_UI_SETTINGS.showMessageTimestamp,
    messageTimestampFontSize: parseNumberSetting(
      parsed.messageTimestampFontSize,
      DEFAULT_UI_SETTINGS.messageTimestampFontSize,
      9,
      18,
    ),
    playReplyDoneSound:
      typeof parsed.playReplyDoneSound === "boolean"
        ? parsed.playReplyDoneSound
        : DEFAULT_UI_SETTINGS.playReplyDoneSound,
    playReplyDoneSoundVolume: parseNumberSetting(
      parsed.playReplyDoneSoundVolume,
      DEFAULT_UI_SETTINGS.playReplyDoneSoundVolume,
      0,
      100,
    ),
    playReplyDoneSoundTone: parseReplyDoneSoundTone(
      parsed.playReplyDoneSoundTone,
      DEFAULT_UI_SETTINGS.playReplyDoneSoundTone,
    ),
    playReplyDoneSoundSource: parseReplyDoneSoundSource(
      parsed.playReplyDoneSoundSource,
      DEFAULT_UI_SETTINGS.playReplyDoneSoundSource,
    ),
    playReplyDoneSoundCustomAudioDataUrl: parseReplyDoneSoundCustomAudioDataUrl(
      parsed.playReplyDoneSoundCustomAudioDataUrl,
    ),
    playReplyDoneSoundCustomAudioName: parseReplyDoneSoundCustomAudioName(
      parsed.playReplyDoneSoundCustomAudioName,
    ),
    showToolActivity:
      typeof parsed.showToolActivity === "boolean"
        ? parsed.showToolActivity
        : DEFAULT_UI_SETTINGS.showToolActivity,
    toolCallFontSize: parseNumberSetting(
      parsed.toolCallFontSize,
      DEFAULT_UI_SETTINGS.toolCallFontSize,
      10,
      18,
    ),
    chatBubbleRadius: parseNumberSetting(
      parsed.chatBubbleRadius,
      DEFAULT_UI_SETTINGS.chatBubbleRadius,
      10,
      28,
    ),
    messageGap: parseNumberSetting(
      parsed.messageGap,
      DEFAULT_UI_SETTINGS.messageGap,
      8,
      30,
    ),
    panelOpacity: parseNumberSetting(
      parsed.panelOpacity,
      DEFAULT_UI_SETTINGS.panelOpacity,
      75,
      100,
    ),
    backgroundPatternStrength: parseNumberSetting(
      parsed.backgroundPatternStrength,
      DEFAULT_UI_SETTINGS.backgroundPatternStrength,
      0,
      100,
    ),
    accentColor: parseColorSetting(parsed.accentColor, DEFAULT_UI_SETTINGS.accentColor),
    accentSoftColor: parseColorSetting(parsed.accentSoftColor, DEFAULT_UI_SETTINGS.accentSoftColor),
    userBubbleColor: parseColorSetting(parsed.userBubbleColor, DEFAULT_UI_SETTINGS.userBubbleColor),
    assistantBubbleColor: parseColorSetting(
      parsed.assistantBubbleColor,
      DEFAULT_UI_SETTINGS.assistantBubbleColor,
    ),
    markdownHeadingColor: parseColorSetting(
      parsed.markdownHeadingColor,
      DEFAULT_UI_SETTINGS.markdownHeadingColor,
    ),
    markdownLinkColor: parseColorSetting(
      parsed.markdownLinkColor,
      DEFAULT_UI_SETTINGS.markdownLinkColor,
    ),
    markdownBoldColor: parseColorSetting(
      parsed.markdownBoldColor,
      DEFAULT_UI_SETTINGS.markdownBoldColor,
    ),
    markdownItalicColor: parseColorSetting(
      parsed.markdownItalicColor,
      DEFAULT_UI_SETTINGS.markdownItalicColor,
    ),
    markdownCodeBg: parseColorSetting(parsed.markdownCodeBg, DEFAULT_UI_SETTINGS.markdownCodeBg),
    markdownCodeText: parseColorSetting(parsed.markdownCodeText, DEFAULT_UI_SETTINGS.markdownCodeText),
    markdownQuoteBg: parseColorSetting(parsed.markdownQuoteBg, DEFAULT_UI_SETTINGS.markdownQuoteBg),
    markdownQuoteBorderColor: parseColorSetting(
      parsed.markdownQuoteBorderColor,
      DEFAULT_UI_SETTINGS.markdownQuoteBorderColor,
    ),
    enableAnimations:
      typeof parsed.enableAnimations === "boolean"
        ? parsed.enableAnimations
        : DEFAULT_UI_SETTINGS.enableAnimations,
  };
}

function loadUiSettings(): UiSettings {
  try {
    const raw = localStorage.getItem(STORAGE_KEYS.uiSettings);
    if (!raw) {
      return { ...DEFAULT_UI_SETTINGS };
    }
    return parseUiSettings(JSON.parse(raw));
  } catch {
    return { ...DEFAULT_UI_SETTINGS };
  }
}

function saveUiSettings(settings: UiSettings) {
  try {
    localStorage.setItem(STORAGE_KEYS.uiSettings, JSON.stringify(settings));
  } catch {
    // ignore
  }
}

function normalizeUiSettingsSchemeName(value: string): string {
  return value.trim().replace(/\s+/g, " ").slice(0, 42);
}

function loadUiSettingsSchemes(): UiSettingsScheme[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEYS.uiSettingsSchemes);
    if (!raw) {
      return [];
    }
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) {
      return [];
    }
    const seenIds = new Set<string>();
    const schemes: UiSettingsScheme[] = [];
    for (const item of parsed) {
      if (!item || typeof item !== "object") {
        continue;
      }
      const row = item as Record<string, unknown>;
      const id = typeof row.id === "string" ? row.id.trim() : "";
      const name = typeof row.name === "string" ? normalizeUiSettingsSchemeName(row.name) : "";
      if (!id || !name || id === BUILTIN_UI_SETTINGS_SCHEME_ID || seenIds.has(id)) {
        continue;
      }
      const updatedAt = typeof row.updatedAt === "number" && Number.isFinite(row.updatedAt)
        ? row.updatedAt
        : Date.now();
      schemes.push({
        id,
        name,
        settings: parseUiSettings(row.settings),
        updatedAt,
      });
      seenIds.add(id);
    }
    return schemes.sort((a, b) => b.updatedAt - a.updatedAt);
  } catch {
    return [];
  }
}

function saveUiSettingsSchemes(schemes: UiSettingsScheme[]) {
  try {
    localStorage.setItem(STORAGE_KEYS.uiSettingsSchemes, JSON.stringify(schemes));
  } catch {
    // ignore
  }
}

type OutgoingGatewayAttachment = {
  type: "image" | "file";
  mimeType: string;
  fileName: string;
  content: string;
};

function extractBase64Content(dataUrl: string): string {
  const match = /^data:[^;]+;base64,(.*)$/i.exec(dataUrl.trim());
  return match?.[1]?.trim() ?? "";
}

function estimateBase64Bytes(base64: string): number {
  const trimmed = base64.trim();
  if (!trimmed) {
    return 0;
  }
  const padding = trimmed.endsWith("==") ? 2 : trimmed.endsWith("=") ? 1 : 0;
  return Math.max(0, Math.floor((trimmed.length * 3) / 4) - padding);
}

function estimateChatSendFrameBytes(params: {
  sessionKey: string;
  message: string;
  deliver: boolean;
  idempotencyKey: string;
  attachments?: OutgoingGatewayAttachment[];
}): number {
  const frame = { type: "req", id: "frame-size-estimate", method: "chat.send", params };
  return new TextEncoder().encode(JSON.stringify(frame)).length;
}

function buildFileFallbackText(attachments: Attachment[]): string | null {
  const files = attachments.filter((item) => !item.isImage);
  if (files.length === 0) {
    return null;
  }
  const list = files.slice(0, 3).map((item) => item.name).join(", ");
  const suffix = files.length > 3 ? ` (+${files.length - 3} more)` : "";
  return `[Attached file] ${list}${suffix}`;
}

function loadImageElement(dataUrl: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const image = new Image();
    image.onload = () => resolve(image);
    image.onerror = () => reject(new Error("image decode failed"));
    image.src = dataUrl;
  });
}

async function compressImageAttachment(
  attachment: Attachment,
  targetBytes: number,
): Promise<Attachment | null> {
  if (!attachment.isImage) {
    return null;
  }
  const sourceBase64 = extractBase64Content(attachment.dataUrl);
  const sourceBytes = estimateBase64Bytes(sourceBase64);
  if (sourceBytes <= 0 || sourceBytes <= targetBytes) {
    return attachment;
  }
  let image: HTMLImageElement;
  try {
    image = await loadImageElement(attachment.dataUrl);
  } catch {
    return null;
  }
  const canvas = document.createElement("canvas");
  const context = canvas.getContext("2d");
  if (!context) {
    return null;
  }

  const maxDimension = 2200;
  const initialScale = Math.min(1, maxDimension / Math.max(image.naturalWidth, image.naturalHeight));
  const attempts = [
    { scale: initialScale, quality: 0.85 },
    { scale: initialScale * 0.92, quality: 0.78 },
    { scale: initialScale * 0.82, quality: 0.7 },
    { scale: initialScale * 0.72, quality: 0.62 },
    { scale: initialScale * 0.62, quality: 0.55 },
    { scale: initialScale * 0.54, quality: 0.5 },
    { scale: initialScale * 0.46, quality: 0.45 },
  ];

  let best: Attachment | null = null;
  let bestBytes = sourceBytes;
  for (const attempt of attempts) {
    const width = Math.max(1, Math.round(image.naturalWidth * attempt.scale));
    const height = Math.max(1, Math.round(image.naturalHeight * attempt.scale));
    canvas.width = width;
    canvas.height = height;
    context.clearRect(0, 0, width, height);
    context.drawImage(image, 0, 0, width, height);
    const nextDataUrl = canvas.toDataURL("image/jpeg", attempt.quality);
    const nextBase64 = extractBase64Content(nextDataUrl);
    const nextBytes = estimateBase64Bytes(nextBase64);
    if (nextBytes <= 0) {
      continue;
    }
    if (nextBytes < bestBytes) {
      bestBytes = nextBytes;
      best = {
        ...attachment,
        type: "image/jpeg",
        dataUrl: nextDataUrl,
        size: nextBytes,
      };
    }
    if (nextBytes <= targetBytes) {
      return {
        ...attachment,
        type: "image/jpeg",
        dataUrl: nextDataUrl,
        size: nextBytes,
      };
    }
  }
  return best;
}

function formatToolOutput(value: unknown): string {
  const stripControlSequences = (input: string): string =>
    input
      .replace(/\u001B\][^\u0007]*(?:\u0007|\u001B\\)/g, "")
      .replace(/\u001B\[[0-?]*[ -/]*[@-~]/g, "")
      .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, "");

  if (value === null || value === undefined) {
    return "";
  }
  if (typeof value === "string") {
    return stripControlSequences(value);
  }
  if (typeof value === "number" || typeof value === "boolean") {
    return String(value);
  }
  try {
    return stripControlSequences(JSON.stringify(value, null, 2));
  } catch {
    return stripControlSequences(String(value));
  }
}

type ToolUpdate = {
  id: string;
  name?: string;
  status?: ToolItem["status"];
  args?: unknown;
  output?: string;
  startedAt?: number;
  updatedAt?: number;
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function getString(source: Record<string, unknown>, keys: string[]): string | null {
  for (const key of keys) {
    const value = source[key];
    if (typeof value === "string" && value.trim()) {
      return value;
    }
  }
  return null;
}

function getNumber(source: Record<string, unknown>, keys: string[]): number | null {
  for (const key of keys) {
    const value = source[key];
    if (typeof value === "number" && Number.isFinite(value)) {
      return value;
    }
  }
  return null;
}

function getBoolean(source: Record<string, unknown>, keys: string[]): boolean | null {
  for (const key of keys) {
    const value = source[key];
    if (typeof value === "boolean") {
      return value;
    }
    if (typeof value === "number" && Number.isFinite(value)) {
      return value !== 0;
    }
    if (typeof value === "string") {
      const normalized = value.trim().toLowerCase();
      if (
        normalized === "true" ||
        normalized === "1" ||
        normalized === "yes" ||
        normalized === "done" ||
        normalized === "final" ||
        normalized === "complete" ||
        normalized === "completed"
      ) {
        return true;
      }
      if (normalized === "false" || normalized === "0" || normalized === "no") {
        return false;
      }
    }
  }
  return null;
}

function isEventVariant(eventName: string, root: string): boolean {
  const name = eventName.trim().toLowerCase();
  if (!name) {
    return false;
  }
  return (
    name === root ||
    name.startsWith(`${root}.`) ||
    name.startsWith(`${root}:`) ||
    name.startsWith(`${root}/`)
  );
}

function getNested(source: unknown, path: string[]): unknown {
  let cursor: unknown = source;
  for (const key of path) {
    if (!isRecord(cursor)) {
      return undefined;
    }
    cursor = cursor[key];
  }
  return cursor;
}

function getNestedString(source: unknown, path: string[]): string | null {
  const value = getNested(source, path);
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function getConfigRoot(configSnapshot: unknown): Record<string, unknown> | null {
  if (!isRecord(configSnapshot)) {
    return null;
  }
  return isRecord(configSnapshot.config) ? configSnapshot.config : configSnapshot;
}

function formatAgeFromTimestamp(updatedAt: number | null | undefined): string {
  if (!Number.isFinite(updatedAt)) {
    return "unknown";
  }
  const delta = Math.max(0, Date.now() - (updatedAt as number));
  const minutes = Math.round(delta / 60_000);
  if (minutes < 1) {
    return "just now";
  }
  if (minutes < 60) {
    return `${minutes}m ago`;
  }
  const hours = Math.round(minutes / 60);
  if (hours < 48) {
    return `${hours}h ago`;
  }
  const days = Math.round(hours / 24);
  return `${days}d ago`;
}

function formatApiKeySnippet(apiKey: string): string {
  const compact = apiKey.replace(/\s+/g, "");
  if (!compact) {
    return "unknown";
  }
  if (compact.includes("${")) {
    return "configured";
  }
  const edge = compact.length >= 12 ? 6 : 4;
  return `${compact.slice(0, edge)}…${compact.slice(-edge)}`;
}

function resolveProviderApiKeyLabel(configSnapshot: unknown, providerRaw: string | null): string | null {
  const provider = providerRaw?.trim().toLowerCase();
  if (!provider) {
    return null;
  }
  const config = getConfigRoot(configSnapshot);
  if (!config) {
    return null;
  }
  const providers = getNested(config, ["models", "providers"]);
  if (!isRecord(providers)) {
    return null;
  }
  for (const [providerId, entry] of Object.entries(providers)) {
    if (providerId.trim().toLowerCase() !== provider || !isRecord(entry)) {
      continue;
    }
    const apiKey = getString(entry, ["apiKey", "api_key"]);
    if (!apiKey) {
      return null;
    }
    const snippet = formatApiKeySnippet(apiKey);
    return `api-key ${snippet} (${providerId}:default)`;
  }
  return null;
}

function resolveQueueMode(configSnapshot: unknown): string {
  const config = getConfigRoot(configSnapshot);
  if (!config) {
    return "collect";
  }
  return (
    getNestedString(config, ["queue", "mode"]) ??
    getNestedString(config, ["session", "queue", "mode"]) ??
    getNestedString(config, ["agents", "defaults", "queue", "mode"]) ??
    "collect"
  );
}

function normalizeThinkingValue(value: string | null | undefined): string {
  const normalized = value?.trim().toLowerCase() ?? "";
  return normalized || "off";
}

function clearOverride<T extends string>(
  map: Record<string, T>,
  key: string,
): Record<string, T> {
  if (!(key in map)) {
    return map;
  }
  const next = { ...map };
  delete next[key];
  return next;
}

function normalizeModelKey(value: string): string {
  return value.trim().toLowerCase();
}

function resolveHeartbeatSessionOverride(
  configRoot: unknown,
  defaultAgentId: string,
): string | null {
  const config = getConfigRoot(configRoot);
  if (!config) {
    return null;
  }
  const agentsConfig = isRecord(config.agents) ? config.agents : null;
  const defaults = agentsConfig && isRecord(agentsConfig.defaults) ? agentsConfig.defaults : null;
  let sessionOverride = defaults ? getNestedString(defaults, ["heartbeat", "session"]) : null;

  const list = agentsConfig && Array.isArray(agentsConfig.list) ? agentsConfig.list : [];
  for (const entry of list) {
    if (!isRecord(entry)) {
      continue;
    }
    const id = getString(entry, ["id"])?.trim().toLowerCase();
    if (!id || id !== defaultAgentId) {
      continue;
    }
    const perAgent = getNestedString(entry, ["heartbeat", "session"]);
    if (perAgent?.trim()) {
      sessionOverride = perAgent;
    }
    break;
  }

  const normalized = sessionOverride?.trim().toLowerCase() ?? "";
  return normalized || null;
}

function resolvePrimarySessionKey(
  agents: AgentsListResult | null,
  configRoot?: unknown,
): string {
  if (agents?.scope === "global") {
    return "global";
  }
  const agentId = (agents?.defaultId ?? "main").trim().toLowerCase() || "main";
  const mainKey = (agents?.mainKey ?? "main").trim().toLowerCase() || "main";
  const override = resolveHeartbeatSessionOverride(configRoot, agentId);
  if (!override || override === "main" || override === "global") {
    return `agent:${agentId}:${mainKey}`;
  }
  if (override.startsWith("agent:")) {
    return override;
  }
  if (override.startsWith("global")) {
    return "global";
  }
  const overrideKey = override.replace(/^:+|:+$/g, "");
  if (!overrideKey) {
    return `agent:${agentId}:${mainKey}`;
  }
  return `agent:${agentId}:${overrideKey}`;
}

function resolveMainSessionFallback(agents: AgentsListResult | null): string {
  if (agents?.scope === "global") {
    return "global";
  }
  const agentId = (agents?.defaultId ?? "main").trim().toLowerCase() || "main";
  const mainKey = (agents?.mainKey ?? "main").trim().toLowerCase() || "main";
  return `agent:${agentId}:${mainKey}`;
}

function reconcileSelectedSessionKey(params: {
  previousKey: string | null;
  sessions: GatewaySessionRow[];
  primarySessionKey: string;
}): string | null {
  const { previousKey, sessions, primarySessionKey } = params;
  if (sessions.length === 0) {
    return previousKey;
  }
  if (!previousKey) {
    return sessions[0]!.key;
  }
  const exactMatch = sessions.find((session) => session.key === previousKey);
  if (exactMatch) {
    return exactMatch.key;
  }
  const normalizedPreviousKey = previousKey.toLowerCase();
  const normalizedMatch = sessions.find(
    (session) => session.key.toLowerCase() === normalizedPreviousKey,
  );
  if (normalizedMatch) {
    return normalizedMatch.key;
  }
  const primaryMatch = sessions.find(
    (session) => session.key.toLowerCase() === primarySessionKey,
  );
  if (primaryMatch) {
    return primaryMatch.key;
  }
  return sessions[0]!.key;
}

function collectConfiguredModelKeys(configRoot: unknown): Set<string> {
  const keys = new Set<string>();
  if (!isRecord(configRoot)) {
    return keys;
  }
  const config = isRecord(configRoot.config) ? configRoot.config : configRoot;
  const aliasToModelKey = new Map<string, string>();
  const agents = isRecord(config.agents) ? config.agents : null;
  const defaults = agents && isRecord(agents.defaults) ? agents.defaults : null;
  if (defaults && isRecord(defaults.models)) {
    for (const [key, value] of Object.entries(defaults.models)) {
      const normalizedKey = normalizeModelKey(key);
      if (normalizedKey) {
        keys.add(normalizedKey);
      }
      if (!isRecord(value)) {
        continue;
      }
      const alias = typeof value.alias === "string" ? normalizeModelKey(value.alias) : "";
      if (alias && normalizedKey) {
        aliasToModelKey.set(alias, normalizedKey);
      }
    }
  }

  const addModelValue = (value: unknown) => {
    if (typeof value !== "string") {
      return;
    }
    const trimmed = value.trim();
    if (!trimmed) {
      return;
    }
    const normalized = normalizeModelKey(trimmed);
    keys.add(normalized);
    const mapped = aliasToModelKey.get(normalized);
    if (mapped) {
      keys.add(mapped);
    }
  };

  const addModelList = (value: unknown) => {
    if (!Array.isArray(value)) {
      return;
    }
    for (const item of value) {
      addModelValue(item);
    }
  };

  const defaultModel = defaults && isRecord(defaults.model) ? defaults.model : null;
  if (defaultModel) {
    addModelValue(defaultModel.primary);
    addModelList(defaultModel.fallbacks);
  }
  const defaultImageModel = defaults && isRecord(defaults.imageModel) ? defaults.imageModel : null;
  if (defaultImageModel) {
    addModelValue(defaultImageModel.primary);
    addModelList(defaultImageModel.fallbacks);
  }

  return keys;
}

function filterConfiguredModels(
  catalog: ModelsListResult["models"],
  configuredKeys: Set<string>,
): ModelsListResult["models"] {
  if (configuredKeys.size === 0) {
    return catalog.filter((model) => model.available === true);
  }
  return catalog.filter((model) => {
    const full = normalizeModelKey(`${model.provider}/${model.id}`);
    const idOnly = normalizeModelKey(model.id);
    return configuredKeys.has(full) || configuredKeys.has(idOnly);
  });
}

function normalizeToolStatus(raw: string | null | undefined): ToolItem["status"] {
  const value = raw?.toLowerCase() ?? "";
  if (
    value.includes("result") ||
    value.includes("done") ||
    value.includes("end") ||
    value.includes("error") ||
    value.includes("fail") ||
    value.includes("ok") ||
    value.includes("success") ||
    value.includes("finish") ||
    value.includes("complete")
  ) {
    return "result";
  }
  if (
    value.includes("start") ||
    value.includes("begin") ||
    value.includes("call") ||
    value.includes("invoke")
  ) {
    return "start";
  }
  return "update";
}

function pickToolCallId(source: Record<string, unknown>): string | null {
  const explicit = getString(source, [
    "toolCallId",
    "tool_call_id",
    "toolUseId",
    "tool_use_id",
    "callId",
    "call_id",
  ]);
  if (explicit) {
    return explicit;
  }
  const genericId = getString(source, ["id"]);
  if (!genericId) {
    return null;
  }
  const hasToolName = Boolean(getString(source, ["name", "toolName", "tool_name", "tool"]));
  const hasPayload =
    source.args !== undefined ||
    source.arguments !== undefined ||
    source.input !== undefined ||
    source.result !== undefined ||
    source.output !== undefined ||
    source.partialResult !== undefined ||
    source.delta !== undefined;
  return hasToolName || hasPayload ? genericId : null;
}

function mergeToolItems(prev: ToolItem[], updates: ToolUpdate[]): ToolItem[] {
  if (updates.length === 0) {
    return prev;
  }
  const stripToolLabel = (input: string): string =>
    input
      .replace(/\u001B\][^\u0007]*(?:\u0007|\u001B\\)/g, "")
      .replace(/\u001B\[[0-?]*[ -/]*[@-~]/g, "")
      .replace(/[\u0000-\u001F\u007F]/g, "")
      .trim();
  const map = new Map(prev.map((item) => [item.id, item] as const));
  for (const update of updates) {
    const existing = map.get(update.id);
    const status = update.status ?? existing?.status ?? "update";
    const normalizedName = stripToolLabel(update.name ?? existing?.name ?? "tool") || "tool";
    const next: ToolItem = {
      id: update.id,
      name: normalizedName,
      status,
      args: update.args ?? existing?.args,
      output: update.output ?? existing?.output,
      startedAt: update.startedAt ?? existing?.startedAt ?? Date.now(),
      updatedAt: update.updatedAt ?? Date.now(),
    };
    map.set(update.id, next);
  }
  return [...map.values()].sort((a, b) => {
    if (a.startedAt !== b.startedAt) {
      return a.startedAt - b.startedAt;
    }
    if (a.updatedAt !== b.updatedAt) {
      return a.updatedAt - b.updatedAt;
    }
    return a.id.localeCompare(b.id);
  });
}

function tryParseJsonRecord(value: unknown): unknown {
  if (typeof value !== "string") {
    return value;
  }
  const trimmed = value.trim();
  if (!(trimmed.startsWith("{") || trimmed.startsWith("["))) {
    return value;
  }
  try {
    return JSON.parse(trimmed);
  } catch {
    return value;
  }
}

function collectObjectCandidates(input: unknown, maxDepth = 4): Record<string, unknown>[] {
  const out: Record<string, unknown>[] = [];
  const queue: Array<{ value: unknown; depth: number }> = [{ value: tryParseJsonRecord(input), depth: 0 }];
  const seen = new Set<unknown>();
  while (queue.length > 0) {
    const next = queue.shift();
    if (!next) {
      continue;
    }
    const { value, depth } = next;
    if (seen.has(value)) {
      continue;
    }
    seen.add(value);
    if (Array.isArray(value)) {
      if (depth >= maxDepth) {
        continue;
      }
      for (const item of value) {
        queue.push({ value: tryParseJsonRecord(item), depth: depth + 1 });
      }
      continue;
    }
    if (!isRecord(value)) {
      continue;
    }
    out.push(value);
    if (depth >= maxDepth) {
      continue;
    }
    for (const nested of Object.values(value)) {
      if (isRecord(nested) || Array.isArray(nested)) {
        queue.push({ value: tryParseJsonRecord(nested), depth: depth + 1 });
      }
    }
  }
  return out;
}

function hasToolHint(candidate: Record<string, unknown>): boolean {
  const type = getString(candidate, ["type", "event", "kind", "phase", "status", "state"])?.toLowerCase() ?? "";
  if (type.includes("tool") || type.includes("function")) {
    return true;
  }
  return (
    Object.keys(candidate).some((key) => key.toLowerCase().includes("tool")) ||
    Object.keys(candidate).some((key) => key.toLowerCase().includes("function"))
  );
}

function dedupeToolUpdates(updates: ToolUpdate[]): ToolUpdate[] {
  const map = new Map<string, ToolUpdate>();
  for (const update of updates) {
    const prev = map.get(update.id);
    map.set(update.id, {
      ...prev,
      ...update,
      args: update.args ?? prev?.args,
      output: update.output ?? prev?.output,
      status: update.status ?? prev?.status ?? "update",
    });
  }
  return [...map.values()];
}

function extractToolUpdatesFromAgent(payload: unknown): ToolUpdate[] {
  if (!isRecord(payload)) {
    return [];
  }
  const ts = typeof payload.ts === "number" ? payload.ts : Date.now();
  const root = isRecord(payload.data) ? payload.data : payload;
  const rootStream =
    getString(payload, ["stream", "channel", "topic"]) ??
    (isRecord(payload.data) ? getString(payload.data, ["stream", "channel", "topic"]) : null);
  const streamIsTool = Boolean(rootStream?.toLowerCase().includes("tool"));
  const updates: ToolUpdate[] = [];
  const candidates = collectObjectCandidates(root);
  for (let i = 0; i < candidates.length; i += 1) {
    const candidate = candidates[i]!;
    const toolId = pickToolCallId(candidate);
    const fn = isRecord(candidate.function) ? candidate.function : {};
    const name =
      getString(candidate, ["name", "toolName", "tool_name", "tool"]) ??
      getString(fn, ["name"]) ??
      null;
    const args = candidate.args ?? candidate.arguments ?? candidate.input ?? fn.arguments;
    const outputValue =
      candidate.partialResult ??
      candidate.delta ??
      candidate.result ??
      candidate.output ??
      candidate.response;
    const hinted = hasToolHint(candidate);
    const looksLikeToolByPayload =
      (args !== undefined || outputValue !== undefined) && (Boolean(name) || Boolean(toolId));
    if (!(hinted || toolId || (streamIsTool && looksLikeToolByPayload))) {
      continue;
    }
    const id = toolId ?? (name ? `tool:${name}:${ts}:${i}` : null);
    if (!id) {
      continue;
    }
    const status = normalizeToolStatus(
      getString(candidate, ["phase", "status", "state", "event", "type"]),
    );
    updates.push({
      id,
      name: name ?? "tool",
      status: outputValue !== undefined && status === "start" ? "update" : status,
      args,
      output: outputValue !== undefined ? formatToolOutput(outputValue) : undefined,
      startedAt: ts,
      updatedAt: Date.now(),
    });
  }
  return dedupeToolUpdates(updates);
}

function extractToolUpdatesFromMessage(message: unknown, fallbackTimestamp?: number): ToolUpdate[] {
  if (!isRecord(message)) {
    return [];
  }
  const ts =
    typeof message.timestamp === "number" && Number.isFinite(message.timestamp)
      ? message.timestamp
      : fallbackTimestamp ?? Date.now();
  const updates: ToolUpdate[] = [];
  const content = message.content;
  if (Array.isArray(content)) {
    for (let i = 0; i < content.length; i += 1) {
      const part = content[i];
      if (!isRecord(part)) {
        continue;
      }
      const type = getString(part, ["type"])?.toLowerCase() ?? "";
      if (type === "tool_use" || type === "tooluse" || type === "tool_call" || type === "toolcall") {
        const id = pickToolCallId(part) ?? `tool:content:${ts}:${i}`;
        updates.push({
          id,
          name: getString(part, ["name", "toolName", "tool_name", "tool"]) ?? "tool",
          status: "start",
          args: part.input ?? part.args ?? part.arguments,
          startedAt: ts,
          updatedAt: ts,
        });
      }
      if (
        type === "tool_result" ||
        type === "toolresult" ||
        type === "tool_response" ||
        type === "function_result"
      ) {
        const id = pickToolCallId(part) ?? `tool:content:${ts}:${i}`;
        updates.push({
          id,
          name: getString(part, ["name", "toolName", "tool_name", "tool"]) ?? "tool",
          status: "result",
          output: formatToolOutput(part.content ?? part.result ?? part.output),
          startedAt: ts,
          updatedAt: ts,
        });
      }
    }
  }
  const toolCalls = message.tool_calls;
  if (Array.isArray(toolCalls)) {
    for (let i = 0; i < toolCalls.length; i += 1) {
      const rawCall = toolCalls[i];
      if (!isRecord(rawCall)) {
        continue;
      }
      const fn = isRecord(rawCall.function) ? rawCall.function : {};
      const id = pickToolCallId(rawCall) ?? `tool:call:${ts}:${i}`;
      const name = getString(rawCall, ["name"]) ?? getString(fn, ["name"]) ?? "tool";
      updates.push({
        id,
        name,
        status: "start",
        args: rawCall.arguments ?? fn.arguments,
        startedAt: ts,
        updatedAt: ts,
      });
    }
  }
  const role = getString(message, ["role"])?.toLowerCase() ?? "";
  if (role === "tool" || role === "toolresult" || role === "tool_result" || role === "function") {
    const id = pickToolCallId(message) ?? `tool:role:${ts}`;
    updates.push({
      id,
      name: getString(message, ["name", "toolName", "tool_name", "tool"]) ?? "tool",
      status: "result",
      output: extractText(message) ?? formatToolOutput(message.result ?? message.output),
      startedAt: ts,
      updatedAt: ts,
    });
  }
  if (updates.length > 0) {
    return dedupeToolUpdates(updates);
  }
  if (!isToolMessage(message)) {
    return [];
  }
  const id = pickToolCallId(message) ?? `tool:message:${ts}`;
  return [
    {
      id,
      name: getString(message, ["name", "toolName", "tool_name", "tool"]) ?? "tool",
      status: "update",
      output: extractText(message) ?? undefined,
      startedAt: ts,
      updatedAt: ts,
    },
  ];
}

type NormalizedChatEvent = {
  runId?: string;
  sessionKey?: string;
  state: "delta" | "final" | "aborted" | "error";
  message?: unknown;
  errorMessage?: string;
};

function normalizeChatState(raw: string | null | undefined): NormalizedChatEvent["state"] | null {
  const value = raw?.toLowerCase() ?? "";
  if (!value) {
    return null;
  }
  if (value.includes("delta") || value.includes("stream")) {
    return "delta";
  }
  if (value.includes("final") || value.includes("done") || value.includes("complete")) {
    return "final";
  }
  if (value.includes("abort")) {
    return "aborted";
  }
  if (value.includes("error") || value.includes("fail")) {
    return "error";
  }
  return null;
}

function normalizeSessionKeyForMatch(value: string | null | undefined): string | null {
  if (typeof value !== "string") {
    return null;
  }
  const normalized = value.trim().toLowerCase();
  return normalized || null;
}

function splitAgentSessionKey(value: string): { agentId: string; rest: string } | null {
  if (!value.startsWith("agent:")) {
    return null;
  }
  const firstSep = value.indexOf(":", "agent:".length);
  if (firstSep <= "agent:".length || firstSep >= value.length - 1) {
    return null;
  }
  return {
    agentId: value.slice("agent:".length, firstSep),
    rest: value.slice(firstSep + 1),
  };
}

function sessionKeysMatch(a: string | null | undefined, b: string | null | undefined): boolean {
  const left = normalizeSessionKeyForMatch(a);
  const right = normalizeSessionKeyForMatch(b);
  if (!left || !right) {
    return false;
  }
  if (left === right) {
    return true;
  }
  const leftAgent = splitAgentSessionKey(left);
  const rightAgent = splitAgentSessionKey(right);
  if (leftAgent && !rightAgent) {
    return leftAgent.rest === right;
  }
  if (!leftAgent && rightAgent) {
    return left === rightAgent.rest;
  }
  return false;
}

function normalizeLifecyclePhase(raw: string | null | undefined): "start" | "end" | "error" | null {
  const value = raw?.trim().toLowerCase() ?? "";
  if (!value) {
    return null;
  }
  if (value.includes("error") || value.includes("fail")) {
    return "error";
  }
  if (value.includes("end") || value.includes("done") || value.includes("finish") || value.includes("complete")) {
    return "end";
  }
  if (value.includes("start") || value.includes("begin")) {
    return "start";
  }
  return null;
}

function extractAssistantTextFromAgentPayload(payload: Record<string, unknown>): string | null {
  const data = isRecord(payload.data) ? payload.data : null;
  const text =
    (data ? getString(data, ["text", "delta", "chunk", "partial"]) : null) ??
    getString(payload, ["text", "delta", "chunk", "partial"]);
  if (text && text.trim()) {
    return text;
  }
  if (data?.message !== undefined) {
    const fromMessage = extractText(data.message);
    if (fromMessage && fromMessage.trim()) {
      return fromMessage;
    }
  }
  return null;
}

function normalizeChatEventPayload(payload: unknown, eventHint?: string): NormalizedChatEvent | null {
  if (!isRecord(payload)) {
    return null;
  }
  const data = isRecord(payload.data) ? payload.data : {};
  const errorMessage =
    getString(payload, ["errorMessage"]) ??
    getString(data, ["errorMessage"]) ??
    (isRecord(payload.error)
      ? getString(payload.error, ["message", "error"])
      : getString(payload, ["error"])) ??
    undefined;
  const finalHint =
    getBoolean(payload, ["done", "isDone", "final", "isFinal", "completed", "isComplete"]) ??
    getBoolean(data, ["done", "isDone", "final", "isFinal", "completed", "isComplete"]) ??
    null;
  const abortedHint =
    getBoolean(payload, ["aborted", "isAborted", "cancelled", "canceled"]) ??
    getBoolean(data, ["aborted", "isAborted", "cancelled", "canceled"]) ??
    null;
  const hasDelta = payload.delta !== undefined || data.delta !== undefined;
  const hasMessage = payload.message !== undefined || data.message !== undefined;
  const state =
    normalizeChatState(getString(payload, ["state", "phase", "event"])) ??
    normalizeChatState(getString(data, ["state", "phase", "event"])) ??
    normalizeChatState(eventHint) ??
    (finalHint ? "final" : null) ??
    (abortedHint ? "aborted" : null) ??
    (errorMessage ? "error" : null) ??
    (hasDelta ? "delta" : null) ??
    (hasMessage ? "final" : null);
  if (!state) {
    return null;
  }
  const runId = getString(payload, ["runId", "run_id"]) ?? getString(data, ["runId", "run_id"]) ?? undefined;
  const sessionKey =
    getString(payload, ["sessionKey", "session_key"]) ??
    getString(data, ["sessionKey", "session_key"]) ??
    undefined;
  const messageRaw =
    payload.message ??
    data.message ??
    payload.delta ??
    data.delta ??
    payload.content ??
    data.content;
  const message =
    typeof messageRaw === "string" ? { role: "assistant", content: messageRaw } : messageRaw;
  return { runId, sessionKey, state, message, errorMessage };
}

function mergeStreamingText(previous: string | null, incoming: string): string {
  if (!previous) {
    return incoming;
  }
  if (!incoming || incoming === previous) {
    return previous;
  }
  if (incoming.startsWith(previous)) {
    return incoming;
  }
  if (previous.startsWith(incoming) || previous.endsWith(incoming)) {
    return previous;
  }
  const maxOverlap = Math.min(previous.length, incoming.length);
  for (let overlap = maxOverlap; overlap > 0; overlap -= 1) {
    if (previous.slice(-overlap) === incoming.slice(0, overlap)) {
      return `${previous}${incoming.slice(overlap)}`;
    }
  }
  return `${previous}${incoming}`;
}

function toChatMessage(raw: unknown, fallbackTimestamp?: number): ChatMessage | null {
  if (isToolMessage(raw)) {
    return null;
  }
  const text = extractText(raw) ?? "";
  const images = extractImages(raw);
  const attachments: Attachment[] = images.map((img, index) => ({
    id: `${generateUUID()}-${index}`,
    name: `image-${index + 1}`,
    size: img.data.length,
    type: img.mimeType,
    dataUrl: `data:${img.mimeType};base64,${img.data}`,
    isImage: true,
  }));
  if (!text && attachments.length === 0) {
    return null;
  }
  const roleRaw = (raw as Record<string, unknown>)?.role;
  const timestampRaw = (raw as Record<string, unknown>)?.timestamp;
  const role = roleRaw === "user" ? "user" : roleRaw === "assistant" ? "assistant" : "system";
  return {
    id: generateUUID(),
    role,
    text,
    timestamp:
      typeof timestampRaw === "number" && Number.isFinite(timestampRaw)
        ? timestampRaw
        : fallbackTimestamp ?? Date.now(),
    attachments: attachments.length > 0 ? attachments : undefined,
    raw,
  };
}

export default function App() {
  const [gatewayUrl, setGatewayUrl] = useState(
    loadStored(STORAGE_KEYS.gatewayUrl, DEFAULT_GATEWAY_URL),
  );
  const [token, setToken] = useState(loadStored(STORAGE_KEYS.token, ""));
  const [password, setPassword] = useState("");
  const [connected, setConnected] = useState(false);
  const [connectionNote, setConnectionNote] = useState<string | null>(null);
  const [pairingRequired, setPairingRequired] = useState(false);
  const [sessions, setSessions] = useState<GatewaySessionRow[]>([]);
  const [sessionDefaults, setSessionDefaults] = useState<SessionsListResult["defaults"] | null>(
    null,
  );
  const [selectedSessionKey, setSelectedSessionKey] = useState<string | null>(
    loadStored(STORAGE_KEYS.lastSession, ""),
  );
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [draft, setDraft] = useState("");
  const [attachments, setAttachments] = useState<Attachment[]>([]);
  const [streamText, setStreamText] = useState<string | null>(null);
  const [chatRunId, setChatRunId] = useState<string | null>(null);
  const [thinking, setThinking] = useState(false);
  const [toolItems, setToolItems] = useState<ToolItem[]>([]);
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const [showSettings, setShowSettings] = useState(false);
  const [showNewSession, setShowNewSession] = useState(false);
  const [uiSettings, setUiSettings] = useState<UiSettings>(() => loadUiSettings());
  const [uiSettingsSchemes, setUiSettingsSchemes] = useState<UiSettingsScheme[]>(
    () => loadUiSettingsSchemes(),
  );
  const [activeUiSettingsSchemeId, setActiveUiSettingsSchemeId] = useState<string>(
    () => loadStored(STORAGE_KEYS.activeUiSettingsScheme, BUILTIN_UI_SETTINGS_SCHEME_ID),
  );
  const [agents, setAgents] = useState<AgentsListResult | null>(null);
  const [models, setModels] = useState<ModelsListResult["models"]>([]);
  const [sessionModelOverrides, setSessionModelOverrides] = useState<Record<string, string>>({});
  const [sessionThinkingOverrides, setSessionThinkingOverrides] = useState<Record<string, string>>(
    {},
  );
  const [serverInfo, setServerInfo] = useState<{ version: string | null; commit: string | null }>({
    version: null,
    commit: null,
  });
  const [maxPayloadBytes, setMaxPayloadBytes] = useState(DEFAULT_MAX_WS_PAYLOAD_BYTES);
  const [thinkingLevel, setThinkingLevel] = useState<string | null>(null);
  const [sessionListLimit, setSessionListLimit] = useState(SESSION_LIST_INITIAL_LIMIT);
  const [canLoadMoreSessions, setCanLoadMoreSessions] = useState(false);
  const [canLoadMoreHistory, setCanLoadMoreHistory] = useState(false);
  const [loadingOlderHistory, setLoadingOlderHistory] = useState(false);

  const clientRef = useRef<GatewayClient | null>(null);
  const selectedSessionRef = useRef<string | null>(selectedSessionKey);
  const chatRunRef = useRef<string | null>(chatRunId);
  const thinkingRef = useRef<boolean>(thinking);
  const streamTextRef = useRef<string | null>(streamText);
  const lastConfigSnapshotRef = useRef<unknown>(null);
  const sessionListLimitRef = useRef<number>(sessionListLimit);
  const loadingMoreSessionsRef = useRef(false);
  const historyLimitBySessionRef = useRef<Record<string, number>>({});
  const historyCanLoadMoreBySessionRef = useRef<Record<string, boolean>>({});
  const historyLoadInFlightRef = useRef(new Set<string>());
  const replyDoneSoundRef = useRef<ReturnType<typeof createReplyDoneSoundPlayer> | null>(null);
  const agentFinalizeTimerByRunRef = useRef<Record<string, number>>({});
  const finalizedAssistantByRunRef = useRef<Map<string, string>>(new Map());
  const lastFinalizedAssistantRef = useRef<{ text: string; at: number } | null>(null);

  useEffect(() => {
    selectedSessionRef.current = selectedSessionKey;
  }, [selectedSessionKey]);

  useEffect(() => {
    chatRunRef.current = chatRunId;
  }, [chatRunId]);

  useEffect(() => {
    thinkingRef.current = thinking;
  }, [thinking]);

  useEffect(() => {
    streamTextRef.current = streamText;
  }, [streamText]);

  const setStreamTextSynced = (next: string | null) => {
    streamTextRef.current = next;
    setStreamText(next);
  };

  const mergeStreamTextSynced = (incoming: string) => {
    setStreamText((prev) => {
      const merged = mergeStreamingText(prev, incoming);
      streamTextRef.current = merged;
      return merged;
    });
  };

  const shouldSkipAssistantFinal = (runId: string | null | undefined, text: string): boolean => {
    const normalizedText = text.trim();
    if (!normalizedText) {
      return true;
    }
    const normalizedRunId = runId?.trim();
    if (normalizedRunId) {
      const seen = finalizedAssistantByRunRef.current.get(normalizedRunId);
      if (seen === normalizedText) {
        return true;
      }
      finalizedAssistantByRunRef.current.set(normalizedRunId, normalizedText);
      if (finalizedAssistantByRunRef.current.size > 200) {
        const oldestKey = finalizedAssistantByRunRef.current.keys().next().value;
        if (typeof oldestKey === "string") {
          finalizedAssistantByRunRef.current.delete(oldestKey);
        }
      }
      return false;
    }
    const now = Date.now();
    const last = lastFinalizedAssistantRef.current;
    if (last && last.text === normalizedText && now - last.at < 1500) {
      return true;
    }
    lastFinalizedAssistantRef.current = { text: normalizedText, at: now };
    return false;
  };

  const clearAgentFinalizeTimer = (runId: string | null | undefined) => {
    if (!runId) {
      return;
    }
    const timer = agentFinalizeTimerByRunRef.current[runId];
    if (!timer) {
      return;
    }
    window.clearTimeout(timer);
    const next = { ...agentFinalizeTimerByRunRef.current };
    delete next[runId];
    agentFinalizeTimerByRunRef.current = next;
  };

  const scheduleAgentFinalizeFallback = (params: {
    runId: string | null | undefined;
    phase: "end" | "error";
    errorMessage?: string | null;
  }) => {
    const runId = params.runId?.trim();
    if (!runId) {
      return;
    }
    clearAgentFinalizeTimer(runId);
    const timer = window.setTimeout(() => {
      const next = { ...agentFinalizeTimerByRunRef.current };
      delete next[runId];
      agentFinalizeTimerByRunRef.current = next;
      const activeRun = chatRunRef.current;
      if (activeRun && activeRun !== runId) {
        return;
      }
      const streamedText = (streamTextRef.current ?? "").trim();
      if (params.phase === "end") {
        if (!streamedText) {
          setStreamTextSynced(null);
          setChatRunId(null);
          setThinking(false);
          const client = clientRef.current;
          const activeSessionKey = selectedSessionRef.current;
          if (client && activeSessionKey) {
            void loadHistory(client, activeSessionKey, getHistoryLimit(activeSessionKey));
          }
          return;
        }
        if (!shouldSkipAssistantFinal(runId, streamedText)) {
          setMessages((prev) => [
            ...prev,
            {
              id: generateUUID(),
              role: "assistant",
              text: streamedText,
              timestamp: Date.now(),
            },
          ]);
          notifyReplyCompleted();
        }
        setStreamTextSynced(null);
        setChatRunId(null);
        setThinking(false);
        const client = clientRef.current;
        const activeSessionKey = selectedSessionRef.current;
        if (client && activeSessionKey) {
          void refreshSessions(client);
        }
        return;
      }
      setStreamTextSynced(null);
      setChatRunId(null);
      setThinking(false);
      if (params.errorMessage) {
        pushSystemMessage(`Error: ${params.errorMessage}`);
      }
    }, 220);
    agentFinalizeTimerByRunRef.current = {
      ...agentFinalizeTimerByRunRef.current,
      [runId]: timer,
    };
  };

  useEffect(() => {
    sessionListLimitRef.current = sessionListLimit;
  }, [sessionListLimit]);

  useEffect(() => {
    const player = createReplyDoneSoundPlayer();
    replyDoneSoundRef.current = player;
    const warmup = () => {
      player.warmup();
    };
    window.addEventListener("pointerdown", warmup, { passive: true });
    window.addEventListener("keydown", warmup);
    return () => {
      for (const timer of Object.values(agentFinalizeTimerByRunRef.current)) {
        window.clearTimeout(timer);
      }
      agentFinalizeTimerByRunRef.current = {};
      window.removeEventListener("pointerdown", warmup);
      window.removeEventListener("keydown", warmup);
      player.dispose();
      replyDoneSoundRef.current = null;
    };
  }, []);

  function notifyReplyCompleted() {
    if (!uiSettings.playReplyDoneSound) {
      return;
    }
    if (uiSettings.playReplyDoneSoundVolume <= 0) {
      return;
    }
    replyDoneSoundRef.current?.play({
      volume: uiSettings.playReplyDoneSoundVolume,
      tone: uiSettings.playReplyDoneSoundTone,
      source: uiSettings.playReplyDoneSoundSource,
      customAudioDataUrl: uiSettings.playReplyDoneSoundCustomAudioDataUrl,
    });
  }

  function previewReplyDoneSound(next: {
    enabled: boolean;
    volume: number;
    tone: UiSettings["playReplyDoneSoundTone"];
    source: UiSettings["playReplyDoneSoundSource"];
    customAudioDataUrl: UiSettings["playReplyDoneSoundCustomAudioDataUrl"];
  }) {
    if (!next.enabled || next.volume <= 0) {
      return;
    }
    if (next.source === "custom" && !next.customAudioDataUrl) {
      return;
    }
    replyDoneSoundRef.current?.play({
      volume: next.volume,
      tone: next.tone,
      source: next.source,
      customAudioDataUrl: next.customAudioDataUrl,
    });
  }

  const getHistoryLimit = (key: string): number => {
    return historyLimitBySessionRef.current[key] ?? CHAT_HISTORY_INITIAL_LIMIT;
  };

  const setHistoryLimit = (key: string, limit: number) => {
    historyLimitBySessionRef.current = {
      ...historyLimitBySessionRef.current,
      [key]: limit,
    };
  };

  const handleApplyUiSettingsScheme = (schemeId: string) => {
    if (schemeId === BUILTIN_UI_SETTINGS_SCHEME_ID) {
      setUiSettings({ ...DEFAULT_UI_SETTINGS });
      setActiveUiSettingsSchemeId(BUILTIN_UI_SETTINGS_SCHEME_ID);
      return;
    }
    const matched = uiSettingsSchemes.find((item) => item.id === schemeId);
    if (!matched) {
      return;
    }
    setUiSettings({ ...matched.settings });
    setActiveUiSettingsSchemeId(matched.id);
  };

  const handleSaveUiSettingsScheme = (rawName: string) => {
    const baseName = normalizeUiSettingsSchemeName(rawName);
    if (!baseName) {
      return;
    }
    const timestamp = Date.now();
    const nextId = generateUUID();
    setUiSettingsSchemes((prev) => {
      const used = new Set(prev.map((item) => item.name.toLowerCase()));
      let nextName = baseName;
      let suffix = 2;
      while (used.has(nextName.toLowerCase())) {
        nextName = `${baseName} (${suffix})`;
        suffix += 1;
      }
      return [{ id: nextId, name: nextName, settings: { ...uiSettings }, updatedAt: timestamp }, ...prev];
    });
    setActiveUiSettingsSchemeId(nextId);
  };

  const handleOverwriteUiSettingsScheme = (schemeId: string) => {
    if (schemeId === BUILTIN_UI_SETTINGS_SCHEME_ID) {
      return;
    }
    const timestamp = Date.now();
    setUiSettingsSchemes((prev) =>
      prev.map((item) =>
        item.id === schemeId ? { ...item, settings: { ...uiSettings }, updatedAt: timestamp } : item
      ).sort((a, b) => b.updatedAt - a.updatedAt)
    );
  };

  const handleDeleteUiSettingsScheme = (schemeId: string) => {
    if (schemeId === BUILTIN_UI_SETTINGS_SCHEME_ID) {
      return;
    }
    setUiSettingsSchemes((prev) => prev.filter((item) => item.id !== schemeId));
    setActiveUiSettingsSchemeId((prev) =>
      prev === schemeId ? BUILTIN_UI_SETTINGS_SCHEME_ID : prev
    );
  };

  useEffect(() => {
    if (
      activeUiSettingsSchemeId !== BUILTIN_UI_SETTINGS_SCHEME_ID &&
      !uiSettingsSchemes.some((item) => item.id === activeUiSettingsSchemeId)
    ) {
      setActiveUiSettingsSchemeId(BUILTIN_UI_SETTINGS_SCHEME_ID);
    }
  }, [activeUiSettingsSchemeId, uiSettingsSchemes]);

  useEffect(() => {
    document.documentElement.style.setProperty("--claw-font", uiSettings.fontFamily);
    document.documentElement.style.setProperty("--claw-font-size", `${uiSettings.fontSize}px`);
    document.documentElement.style.setProperty("--claw-line-height", uiSettings.lineHeight.toString());
    document.documentElement.style.setProperty(
      "--claw-content-width",
      `${uiSettings.contentWidth}px`,
    );
    document.documentElement.style.setProperty(
      "--claw-sidebar-font-size",
      `${uiSettings.sidebarFontSize}px`,
    );
    document.documentElement.style.setProperty("--claw-sidebar-width", `${uiSettings.sidebarWidth}px`);
    document.documentElement.style.setProperty(
      "--claw-chat-bubble-radius",
      `${uiSettings.chatBubbleRadius}px`,
    );
    document.documentElement.style.setProperty("--claw-message-gap", `${uiSettings.messageGap}px`);
    document.documentElement.style.setProperty("--claw-panel-opacity", `${uiSettings.panelOpacity / 100}`);
    document.documentElement.style.setProperty(
      "--claw-pattern-strength",
      `${uiSettings.backgroundPatternStrength / 100}`,
    );
    document.documentElement.style.setProperty("--claw-accent", uiSettings.accentColor);
    document.documentElement.style.setProperty("--claw-accent-soft", uiSettings.accentSoftColor);
    document.documentElement.style.setProperty("--claw-user-bubble", uiSettings.userBubbleColor);
    document.documentElement.style.setProperty(
      "--claw-assistant-bubble",
      uiSettings.assistantBubbleColor,
    );
    document.documentElement.style.setProperty(
      "--claw-md-heading",
      uiSettings.markdownHeadingColor,
    );
    document.documentElement.style.setProperty("--claw-md-link", uiSettings.markdownLinkColor);
    document.documentElement.style.setProperty("--claw-md-strong", uiSettings.markdownBoldColor);
    document.documentElement.style.setProperty("--claw-md-em", uiSettings.markdownItalicColor);
    document.documentElement.style.setProperty("--claw-md-code-bg", uiSettings.markdownCodeBg);
    document.documentElement.style.setProperty("--claw-md-code-text", uiSettings.markdownCodeText);
    document.documentElement.style.setProperty("--claw-md-quote-bg", uiSettings.markdownQuoteBg);
    document.documentElement.style.setProperty(
      "--claw-md-quote-border",
      uiSettings.markdownQuoteBorderColor,
    );
    document.documentElement.style.setProperty(
      "--claw-animation-duration-scale",
      uiSettings.enableAnimations ? "1" : "0",
    );
    saveUiSettings(uiSettings);
  }, [uiSettings]);

  useEffect(() => {
    saveUiSettingsSchemes(uiSettingsSchemes);
  }, [uiSettingsSchemes]);

  useEffect(() => {
    try {
      localStorage.setItem(STORAGE_KEYS.activeUiSettingsScheme, activeUiSettingsSchemeId);
    } catch {
      // ignore
    }
  }, [activeUiSettingsSchemeId]);

  useEffect(() => {
    const normalized = normalizeGatewayUrl(gatewayUrl);
    if (normalized !== gatewayUrl) {
      setGatewayUrl(normalized);
      return;
    }
    try {
      localStorage.setItem(STORAGE_KEYS.gatewayUrl, normalized);
    } catch {
      // ignore
    }
  }, [gatewayUrl]);

  useEffect(() => {
    try {
      localStorage.setItem(STORAGE_KEYS.token, token);
    } catch {
      // ignore
    }
  }, [token]);

  useEffect(() => {
    if (selectedSessionKey) {
      try {
        localStorage.setItem(STORAGE_KEYS.lastSession, selectedSessionKey);
      } catch {
        // ignore
      }
    }
  }, [selectedSessionKey]);

  useEffect(() => {
    const client = new GatewayClient({
      url: gatewayUrl,
      token,
      password,
      clientName: "clawui",
      mode: "webchat",
      onHello: (hello) => {
        setConnected(true);
        setConnectionNote(null);
        setPairingRequired(false);
        setServerInfo({
          version: typeof hello.server?.version === "string" ? hello.server.version : null,
          commit: typeof hello.server?.commit === "string" ? hello.server.commit : null,
        });
        setMaxPayloadBytes(
          typeof hello.policy?.maxPayload === "number" && Number.isFinite(hello.policy.maxPayload)
            ? hello.policy.maxPayload
            : DEFAULT_MAX_WS_PAYLOAD_BYTES,
        );
        void loadAgents(client);
        void loadModels(client);
        void refreshSessions(client);
      },
      onClose: (info) => {
        setConnected(false);
        const reason = info.reason?.trim() ?? "";
        if (reason.toLowerCase().includes("pairing")) {
          setPairingRequired(true);
          setConnectionNote("Pairing required. Approve this device in the gateway.");
        } else {
          const hint =
            !reason && info.code === 1006
              ? "Handshake failed. Check Gateway URL/path or Origin allowlist."
              : "";
          setConnectionNote(
            reason
              ? `Disconnected (${info.code}): ${reason}`
              : `Disconnected (${info.code}). ${hint}`.trim(),
          );
        }
      },
      onEvent: (evt) => {
        if (isEventVariant(evt.event, "chat")) {
          handleChatEvent(evt.payload, evt.event);
        }
        if (evt.event === "agent") {
          handleAgentEvent(evt.payload);
          return;
        }
        const evtName = evt.event.toLowerCase();
        const payload = isRecord(evt.payload) ? evt.payload : {};
        const payloadData = isRecord(payload.data) ? payload.data : {};
        const streamHint =
          getString(payload, ["stream", "channel", "topic"]) ??
          getString(payloadData, ["stream", "channel", "topic"]) ??
          "";
        const shouldParseTool =
          evtName.includes("agent") ||
          evtName.includes("tool") ||
          evtName.includes("function") ||
          streamHint.toLowerCase().includes("tool");
        if (shouldParseTool) {
          handleAgentEvent(evt.payload);
        }
      },
    });
    clientRef.current = client;
    client.start();
    return () => client.stop();
  }, [gatewayUrl, token, password]);

  useEffect(() => {
    if (!connected) {
      return;
    }
    const client = clientRef.current;
    if (!client || !selectedSessionKey) {
      return;
    }
    setCanLoadMoreHistory(historyCanLoadMoreBySessionRef.current[selectedSessionKey] ?? false);
    void loadHistory(client, selectedSessionKey, getHistoryLimit(selectedSessionKey));
  }, [connected, selectedSessionKey]);

  const currentSession = useMemo(() => {
    if (!selectedSessionKey) {
      return null;
    }
    return sessions.find((session) => session.key === selectedSessionKey) ?? null;
  }, [sessions, selectedSessionKey]);

  useEffect(() => {
    setSessionModelOverrides((prev) => {
      const activeKeys = new Set(sessions.map((session) => session.key));
      const nextEntries = Object.entries(prev).filter(([key]) => activeKeys.has(key));
      if (nextEntries.length === Object.keys(prev).length) {
        return prev;
      }
      return Object.fromEntries(nextEntries);
    });
    setSessionThinkingOverrides((prev) => {
      const activeKeys = new Set(sessions.map((session) => session.key));
      const nextEntries = Object.entries(prev).filter(([key]) => activeKeys.has(key));
      if (nextEntries.length === Object.keys(prev).length) {
        return prev;
      }
      return Object.fromEntries(nextEntries);
    });
  }, [sessions]);

  const usageEnabledRef = useRef(new Set<string>());
  const usageEnablePendingRef = useRef(new Set<string>());
  const verboseEnabledRef = useRef(new Set<string>());
  const verboseEnablePendingRef = useRef(new Set<string>());

  useEffect(() => {
    if (!connected) {
      return;
    }
    const client = clientRef.current;
    if (!client || !currentSession?.key) {
      return;
    }
    const usage = (currentSession.responseUsage ?? "").toLowerCase();
    if (usage === "tokens" || usage === "full") {
      usageEnabledRef.current.add(currentSession.key);
      return;
    }
    void ensureUsageTokenStats(client, currentSession.key);
  }, [connected, currentSession?.key, currentSession?.responseUsage]);

  async function ensureUsageTokenStats(client: GatewayClient, key: string) {
    if (usageEnabledRef.current.has(key) || usageEnablePendingRef.current.has(key)) {
      return;
    }
    usageEnablePendingRef.current.add(key);
    try {
      await client.request("sessions.patch", {
        key,
        responseUsage: "tokens",
      });
      usageEnabledRef.current.add(key);
      setSessions((prev) =>
        prev.map((session) =>
          session.key === key ? { ...session, responseUsage: "tokens" } : session,
        ),
      );
      await refreshSessions(client);
    } catch {
      // ignore
    } finally {
      usageEnablePendingRef.current.delete(key);
    }
  }

  useEffect(() => {
    if (!connected) {
      return;
    }
    const client = clientRef.current;
    if (!client || !currentSession?.key) {
      return;
    }
    if (verboseEnabledRef.current.has(currentSession.key)) {
      return;
    }
    if ((currentSession.verboseLevel ?? "").toLowerCase() === "on") {
      verboseEnabledRef.current.add(currentSession.key);
      return;
    }
    void ensureVerboseToolEvents(client, currentSession.key);
  }, [connected, currentSession?.key, currentSession?.verboseLevel]);

  async function ensureVerboseToolEvents(client: GatewayClient, key: string) {
    if (verboseEnabledRef.current.has(key) || verboseEnablePendingRef.current.has(key)) {
      return;
    }
    verboseEnablePendingRef.current.add(key);
    try {
      await client.request("sessions.patch", {
        key,
        verboseLevel: "on",
      });
      verboseEnabledRef.current.add(key);
      await refreshSessions(client);
    } catch {
      // ignore
    } finally {
      verboseEnablePendingRef.current.delete(key);
    }
  }

  const sessionInfo = useMemo(() => {
    const serverModel = currentSession?.model
      ? currentSession.modelProvider
        ? `${currentSession.modelProvider}/${currentSession.model}`
        : currentSession.model
      : sessionDefaults?.modelProvider && sessionDefaults?.model
        ? `${sessionDefaults.modelProvider}/${sessionDefaults.model}`
        : sessionDefaults?.model ?? "";
    const overrideModel =
      selectedSessionKey ? sessionModelOverrides[selectedSessionKey] : undefined;
    const overrideThinking =
      selectedSessionKey ? sessionThinkingOverrides[selectedSessionKey] : undefined;
    const modelLabel = overrideModel ?? serverModel;
    const modelId = overrideModel ?? serverModel;
    const overrideModelCatalog =
      models.find((entry) => `${entry.provider}/${entry.id}` === modelId) ??
      models.find((entry) => entry.id === modelId) ??
      null;
    return {
      modelLabel,
      modelId,
      contextLimit:
        overrideModelCatalog?.contextWindow ??
        currentSession?.contextTokens ??
        sessionDefaults?.contextTokens ??
        null,
      contextTokens: currentSession?.contextTokens ?? null,
      inputTokens: currentSession?.inputTokens ?? null,
      outputTokens: currentSession?.outputTokens ?? null,
      totalTokens: currentSession?.totalTokens ?? null,
      thinkingLevel: overrideThinking ?? currentSession?.thinkingLevel ?? thinkingLevel,
      responseUsage: currentSession?.responseUsage ?? null,
    };
  }, [
    currentSession,
    thinkingLevel,
    sessionDefaults,
    sessionModelOverrides,
    sessionThinkingOverrides,
    selectedSessionKey,
    models,
  ]);

  async function loadAgents(client: GatewayClient) {
    try {
      const res = (await client.request("agents.list", {})) as AgentsListResult;
      setAgents(res);
      if (!selectedSessionKey) {
        setSelectedSessionKey(resolveMainSessionFallback(res));
      }
      // Agent metadata determines the canonical "main" session key.
      // Refresh once more so the pinned-main ordering uses the resolved default agent/main key.
      void refreshSessions(client);
    } catch (err) {
      setConnectionNote(String(err));
    }
  }

  async function loadModels(client: GatewayClient): Promise<ModelsListResult["models"]> {
    try {
      const res = (await client.request("models.list", {})) as ModelsListResult;
      const catalog = res.models ?? [];
      let configuredKeys = new Set<string>();
      try {
        const configSnapshot = await client.request("config.get", {});
        lastConfigSnapshotRef.current = configSnapshot;
        configuredKeys = collectConfiguredModelKeys(configSnapshot);
      } catch {
        // ignore
      }

      const filtered = filterConfiguredModels(catalog, configuredKeys);
      setModels(filtered);
      return filtered;
    } catch {
      setModels([]);
      return [];
    }
  }

  async function refreshSessions(client: GatewayClient, requestedLimit?: number) {
    try {
      const limit = Math.min(
        SESSION_LIST_MAX_LIMIT,
        Math.max(1, requestedLimit ?? sessionListLimitRef.current),
      );
      if (limit !== sessionListLimitRef.current) {
        sessionListLimitRef.current = limit;
        setSessionListLimit(limit);
      }
      const res = (await client.request("sessions.list", {
        limit,
        includeDerivedTitles: true,
        includeLastMessage: true,
      })) as SessionsListResult;
      setSessionDefaults(res.defaults ?? null);
      const primarySessionKey = resolvePrimarySessionKey(agents, lastConfigSnapshotRef.current);
      const ordered = [...res.sessions].sort((a, b) => {
        const aIsPrimary = a.key.toLowerCase() === primarySessionKey;
        const bIsPrimary = b.key.toLowerCase() === primarySessionKey;
        if (aIsPrimary !== bIsPrimary) {
          return aIsPrimary ? -1 : 1;
        }
        return (b.updatedAt ?? 0) - (a.updatedAt ?? 0);
      });
      setSessions(ordered);
      setCanLoadMoreSessions(ordered.length >= limit && limit < SESSION_LIST_MAX_LIMIT);
      loadingMoreSessionsRef.current = false;
      setSelectedSessionKey((previousKey) =>
        reconcileSelectedSessionKey({
          previousKey,
          sessions: ordered,
          primarySessionKey,
        }),
      );
    } catch (err) {
      loadingMoreSessionsRef.current = false;
      setConnectionNote(String(err));
    }
  }

  async function loadHistory(client: GatewayClient, key: string, requestedLimit?: number) {
    try {
      const limit = Math.min(
        CHAT_HISTORY_MAX_LIMIT,
        Math.max(1, requestedLimit ?? getHistoryLimit(key)),
      );
      setHistoryLimit(key, limit);
      const res = (await client.request("chat.history", {
        sessionKey: key,
        limit,
      })) as ChatHistoryResult;
      const rawCount = Array.isArray(res.messages) ? res.messages.length : 0;
      const canLoadMore = rawCount >= limit && limit < CHAT_HISTORY_MAX_LIMIT;
      historyCanLoadMoreBySessionRef.current = {
        ...historyCanLoadMoreBySessionRef.current,
        [key]: canLoadMore,
      };
      if (selectedSessionRef.current === key) {
        setCanLoadMoreHistory(canLoadMore);
      }
      setThinkingLevel(res.thinkingLevel ?? null);
      const historyMessages: ChatMessage[] = [];
      let historyTools: ToolItem[] = [];
      if (Array.isArray(res.messages)) {
        let lastTs = Date.now() - Math.max(1, res.messages.length);
        for (const raw of res.messages) {
          const rawTs =
            isRecord(raw) && typeof raw.timestamp === "number" && Number.isFinite(raw.timestamp)
              ? raw.timestamp
              : null;
          const inferredTs = rawTs ?? (lastTs + 1);
          lastTs = inferredTs;
          const toolUpdates = extractToolUpdatesFromMessage(raw, inferredTs);
          historyTools = mergeToolItems(historyTools, toolUpdates);
          if (isToolMessage(raw)) {
            continue;
          }
          const parsed = toChatMessage(raw, inferredTs);
          if (parsed) {
            historyMessages.push(parsed);
          }
        }
      }
      setMessages(historyMessages);
      setToolItems(historyTools);
      setStreamTextSynced(null);
      setChatRunId(null);
      setThinking(false);
      finalizedAssistantByRunRef.current.clear();
      lastFinalizedAssistantRef.current = null;
    } catch (err) {
      setConnectionNote(String(err));
    } finally {
      historyLoadInFlightRef.current.delete(key);
      if (selectedSessionRef.current === key) {
        setLoadingOlderHistory(false);
      }
    }
  }

  function handleChatEvent(payload: unknown, eventHint?: string) {
    const parsed = normalizeChatEventPayload(payload, eventHint);
    if (!parsed) {
      return;
    }
    const activeSessionKey = selectedSessionRef.current;
    if (parsed.sessionKey && activeSessionKey && !sessionKeysMatch(parsed.sessionKey, activeSessionKey)) {
      const activeRun = chatRunRef.current;
      if (!activeRun || !parsed.runId || parsed.runId !== activeRun) {
        return;
      }
    }
    if (parsed.state === "delta") {
      if (chatRunRef.current && parsed.runId && parsed.runId !== chatRunRef.current) {
        if (!thinkingRef.current) {
          return;
        }
        chatRunRef.current = parsed.runId;
        setChatRunId(parsed.runId);
      }
      const deltaToolUpdates = extractToolUpdatesFromMessage(parsed.message);
      if (deltaToolUpdates.length > 0) {
        setToolItems((prev) => mergeToolItems(prev, deltaToolUpdates));
        return;
      }
      if (isToolMessage(parsed.message)) {
        return;
      }
      const next = extractText(parsed.message);
      if (typeof next === "string" && next.length > 0) {
        mergeStreamTextSynced(next);
        setThinking(false);
      }
      return;
    }

    if (parsed.state === "final") {
      clearAgentFinalizeTimer(parsed.runId);
      const activeRun = chatRunRef.current;
      if (activeRun && parsed.runId && parsed.runId !== activeRun) {
        if (thinkingRef.current) {
          chatRunRef.current = parsed.runId;
          setChatRunId(parsed.runId);
        } else {
          const client = clientRef.current;
          if (client && activeSessionKey) {
            void loadHistory(client, activeSessionKey);
          }
          return;
        }
      }
      const activeRunAfterSync = chatRunRef.current;
      if (activeRunAfterSync && parsed.runId && parsed.runId !== activeRunAfterSync) {
        const client = clientRef.current;
        if (client && activeSessionKey) {
          void loadHistory(client, activeSessionKey);
        }
        return;
      }
      const toolUpdates = extractToolUpdatesFromMessage(parsed.message);
      if (toolUpdates.length > 0) {
        setToolItems((prev) => mergeToolItems(prev, toolUpdates));
      }
      if (isToolMessage(parsed.message)) {
        setStreamTextSynced(null);
        setChatRunId(null);
        setThinking(false);
        const client = clientRef.current;
        if (client) {
          void refreshSessions(client);
        }
        return;
      }
      const streamedText = (streamTextRef.current ?? "").trim();
      let msg = toChatMessage(parsed.message);
      if (msg && msg.role !== "user" && !msg.text.trim() && streamedText) {
        msg = { ...msg, text: streamedText };
      }
      if ((!msg || !msg.text.trim()) && streamedText) {
        msg = {
          id: generateUUID(),
          role: "assistant",
          text: streamedText,
          timestamp: Date.now(),
          raw: parsed.message,
        };
      }
      if (msg && msg.text.trim() && !shouldSkipAssistantFinal(parsed.runId, msg.text)) {
        setMessages((prev) => [...prev, msg]);
        notifyReplyCompleted();
      }
      setStreamTextSynced(null);
      setChatRunId(null);
      setThinking(false);
      const client = clientRef.current;
      if (client) {
        void refreshSessions(client);
      }
      return;
    }

    if (parsed.state === "aborted") {
      clearAgentFinalizeTimer(parsed.runId);
      setStreamTextSynced(null);
      setChatRunId(null);
      setThinking(false);
      return;
    }

    if (parsed.state === "error") {
      clearAgentFinalizeTimer(parsed.runId);
      setStreamTextSynced(null);
      setChatRunId(null);
      setThinking(false);
      if (parsed.errorMessage) {
        pushSystemMessage(`Error: ${parsed.errorMessage}`);
      }
    }
  }

  function handleAgentEvent(payload: unknown) {
    if (!isRecord(payload)) {
      return;
    }
    const activeSessionKey = selectedSessionRef.current;
    const sessionKey =
      getString(payload, ["sessionKey", "session_key"]) ??
      (isRecord(payload.data) ? getString(payload.data, ["sessionKey", "session_key"]) : null);
    const runId =
      getString(payload, ["runId", "run_id"]) ??
      (isRecord(payload.data) ? getString(payload.data, ["runId", "run_id"]) : null);
    if (sessionKey && activeSessionKey && !sessionKeysMatch(sessionKey, activeSessionKey)) {
      const activeRun = chatRunRef.current;
      if (!activeRun) {
        return;
      }
      if (runId && runId !== activeRun) {
        return;
      }
    }
    const updates = extractToolUpdatesFromAgent(payload);
    if (updates.length > 0) {
      setToolItems((prev) => mergeToolItems(prev, updates));
    }
    const streamRaw =
      getString(payload, ["stream", "channel", "topic"]) ??
      (isRecord(payload.data) ? getString(payload.data, ["stream", "channel", "topic"]) : null);
    const stream = streamRaw?.toLowerCase() ?? "";
    if (stream === "assistant") {
      const activeRun = chatRunRef.current;
      if (activeRun && (!runId || runId === activeRun)) {
        return;
      }
      const next = extractAssistantTextFromAgentPayload(payload);
      if (next) {
        if (runId && chatRunRef.current && runId !== chatRunRef.current && thinkingRef.current) {
          chatRunRef.current = runId;
          setChatRunId(runId);
        }
        mergeStreamTextSynced(next);
        setThinking(false);
      }
      return;
    }
    if (stream === "lifecycle" && isRecord(payload.data)) {
      const phase = normalizeLifecyclePhase(
        getString(payload.data, ["phase", "status", "state", "event", "type"]),
      );
      if (phase === "end" || phase === "error") {
        scheduleAgentFinalizeFallback({
          runId,
          phase,
          errorMessage:
            getString(payload.data, ["errorMessage", "error", "reason"]) ??
            getString(payload, ["errorMessage", "error"]),
        });
      }
    }
  }

  function pushSystemMessage(text: string) {
    setMessages((prev) => [
      ...prev,
      { id: generateUUID(), role: "system", text, timestamp: Date.now() },
    ]);
  }

  function resolveTargetAgentId(): string {
    if (agents?.defaultId) {
      return agents.defaultId;
    }
    const current = selectedSessionRef.current;
    if (current?.startsWith("agent:")) {
      const parts = current.split(":");
      if (parts.length > 1 && parts[1]) {
        return parts[1];
      }
    }
    return "main";
  }

  async function createSession(labelInput: string, closeModal: boolean): Promise<string | null> {
    const client = clientRef.current;
    if (!client) {
      return null;
    }
    const label = resolveSessionLabel(labelInput);
    const slug = slugify(label) || "session";
    const agentId = resolveTargetAgentId();
    const key = `agent:${agentId}:ui:${slug}-${generateUUID().slice(0, 8)}`;
    try {
      await client.request("sessions.patch", { key, label });
      setSelectedSessionKey(key);
      if (closeModal) {
        setShowNewSession(false);
      }
      setHistoryLimit(key, CHAT_HISTORY_INITIAL_LIMIT);
      historyCanLoadMoreBySessionRef.current = {
        ...historyCanLoadMoreBySessionRef.current,
        [key]: false,
      };
      setCanLoadMoreHistory(false);
      await refreshSessions(client);
      await loadHistory(client, key, CHAT_HISTORY_INITIAL_LIMIT);
      return key;
    } catch (err) {
      pushSystemMessage(`Create failed: ${String(err)}`);
      return null;
    }
  }

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.defaultPrevented || !event.metaKey || event.altKey || event.ctrlKey) {
        return;
      }
      const key = event.key.toLowerCase();
      if (key === "d") {
        event.preventDefault();
        setSidebarCollapsed((prev) => !prev);
        return;
      }
      if (key === "e") {
        event.preventDefault();
        void createSession("", false);
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [agents, connected]);

  function buildStatusCard(statusPayload: unknown, configSnapshot: unknown): string {
    const statusRoot: Record<string, unknown> =
      isRecord(statusPayload) && isRecord(statusPayload.status)
        ? statusPayload.status
        : isRecord(statusPayload)
          ? statusPayload
          : {};
    const sessionsRoot = isRecord(statusRoot.sessions) ? statusRoot.sessions : null;
    const defaults = sessionsRoot && isRecord(sessionsRoot.defaults) ? sessionsRoot.defaults : null;
    const recent =
      sessionsRoot && Array.isArray(sessionsRoot.recent)
        ? sessionsRoot.recent.filter(isRecord)
        : [];
    const activeKey = selectedSessionRef.current ?? selectedSessionKey ?? currentSession?.key ?? null;
    const statusSession =
      (activeKey ? recent.find((entry) => getString(entry, ["key"]) === activeKey) : null) ??
      (currentSession?.key
        ? recent.find((entry) => getString(entry, ["key"]) === currentSession.key)
        : null) ??
      recent[0] ??
      null;

    const currentSessionModel = currentSession?.model
      ? currentSession.modelProvider
        ? `${currentSession.modelProvider}/${currentSession.model}`
        : currentSession.model
      : null;
    const statusModel = statusSession ? getString(statusSession, ["model"]) : null;
    const defaultsModel = defaults ? getString(defaults, ["model"]) : null;
    const modelLabel =
      sessionInfo.modelLabel ||
      currentSessionModel ||
      statusModel ||
      defaultsModel ||
      "unknown";
    const provider =
      modelLabel.includes("/")
        ? modelLabel.split("/")[0] ?? null
        : currentSession?.modelProvider ?? null;
    const authLabel = resolveProviderApiKeyLabel(configSnapshot, provider);

    const inputTokens =
      (statusSession ? getNumber(statusSession, ["inputTokens"]) : null) ??
      currentSession?.inputTokens ??
      sessionInfo.inputTokens ??
      null;
    const outputTokens =
      (statusSession ? getNumber(statusSession, ["outputTokens"]) : null) ??
      currentSession?.outputTokens ??
      sessionInfo.outputTokens ??
      null;
    const contextUsed =
      (statusSession ? getNumber(statusSession, ["totalTokens"]) : null) ??
      currentSession?.totalTokens ??
      currentSession?.inputTokens ??
      sessionInfo.totalTokens ??
      sessionInfo.inputTokens ??
      null;
    const contextLimit =
      (statusSession ? getNumber(statusSession, ["contextTokens"]) : null) ??
      currentSession?.contextTokens ??
      sessionInfo.contextLimit ??
      (defaults ? getNumber(defaults, ["contextTokens"]) : null) ??
      null;
    const contextPercent =
      Number.isFinite(contextUsed) && Number.isFinite(contextLimit) && (contextLimit as number) > 0
        ? Math.max(
            0,
            Math.min(999, Math.round(((contextUsed as number) / (contextLimit as number)) * 100)),
          )
        : null;
    const compactions = statusSession ? getNumber(statusSession, ["compactionCount"]) ?? 0 : 0;
    const sessionKeyForLine =
      (statusSession ? getString(statusSession, ["key"]) : null) ??
      activeKey ??
      currentSession?.key ??
      "unknown";
    const updatedAt =
      (statusSession ? getNumber(statusSession, ["updatedAt"]) : null) ??
      currentSession?.updatedAt ??
      null;
    const runtime =
      (statusSession ? getString(statusSession, ["kind"]) : null) ??
      currentSession?.kind ??
      "direct";
    const thinkLabel = normalizeThinkingValue(sessionInfo.thinkingLevel);
    const verboseLevel = normalizeModelKey(
      (statusSession ? getString(statusSession, ["verboseLevel"]) : null) ??
        currentSession?.verboseLevel ??
        "",
    );
    const verboseLabel =
      verboseLevel === "full" ? "verbose:full" : verboseLevel === "on" ? "verbose" : null;
    const queueDepth = Array.isArray(statusRoot.queuedSystemEvents)
      ? statusRoot.queuedSystemEvents.length
      : (isRecord(statusRoot.queue) ? getNumber(statusRoot.queue, ["depth"]) : null) ?? 0;
    const queueMode = resolveQueueMode(configSnapshot);
    const version = serverInfo.version?.trim() || "dev";
    const commit = serverInfo.commit?.trim() || null;

    return [
      `🦞 OpenClaw ${version}${commit ? ` (${commit})` : ""}`,
      `🧠 Model: ${modelLabel}${authLabel ? ` · 🔑 ${authLabel}` : ""}`,
      `🧮 Tokens: ${
        Number.isFinite(inputTokens) ? formatCompactTokens(inputTokens) : "?"
      } in / ${Number.isFinite(outputTokens) ? formatCompactTokens(outputTokens) : "?"} out`,
      `📚 Context: ${
        Number.isFinite(contextUsed) ? formatCompactTokens(contextUsed) : "?"
      }/${Number.isFinite(contextLimit) ? formatCompactTokens(contextLimit) : "?"}${
        contextPercent !== null ? ` (${contextPercent}%)` : ""
      } · 🧹 Compactions: ${compactions}`,
      `🧵 Session: ${sessionKeyForLine} • updated ${formatAgeFromTimestamp(updatedAt)}`,
      `⚙️ Runtime: ${runtime} · Think: ${thinkLabel}${verboseLabel ? ` · ${verboseLabel}` : ""}`,
      `🪢 Queue: ${queueMode} (depth ${queueDepth})`,
    ].join("\n");
  }

  async function handleSend() {
    if (!connected) {
      return;
    }
    const client = clientRef.current;
    if (!client || !selectedSessionKey) {
      return;
    }
    const trimmed = draft.trim();
    if (trimmed.startsWith("/")) {
      const cmd = trimmed.replace(/^\//, "").trim().split(/\s+/)[0]?.toLowerCase() ?? "";
      const gatewayCommands = new Set([
        "status",
        "models",
        "compact",
        "model",
        "think",
        "verbose",
        "reasoning",
        "usage",
        "abort",
        "new",
        "reset",
      ]);
      if (gatewayCommands.has(cmd)) {
        await handleSlashCommand(trimmed);
        return;
      }
      // unknown slash commands should go to the model
    }

    if (!trimmed && attachments.length === 0) {
      return;
    }

    const responseUsage = (currentSession?.responseUsage ?? "").toLowerCase();
    if (responseUsage !== "tokens" && responseUsage !== "full") {
      await ensureUsageTokenStats(client, selectedSessionKey);
    }

    if ((currentSession?.verboseLevel ?? "").toLowerCase() !== "on") {
      await ensureVerboseToolEvents(client, selectedSessionKey);
    }

    const runId = generateUUID();
    const maxFrameBytes = Math.max(32 * 1024, maxPayloadBytes - WS_PAYLOAD_SAFETY_BYTES);
    const draftBeforeSend = draft;
    const attachmentsBeforeSend = attachments;

    let preparedAttachments = [...attachments];
    const toApiAttachments = (source: Attachment[]): OutgoingGatewayAttachment[] =>
      source
        .map((att) => {
          if (!att.isImage) {
            return null;
          }
          const content = extractBase64Content(att.dataUrl);
          if (!content) {
            return null;
          }
          return {
            type: "image",
            mimeType: att.type,
            fileName: att.name,
            content,
          };
        })
        .filter((item): item is OutgoingGatewayAttachment => item !== null);

    let apiAttachments = toApiAttachments(preparedAttachments);
    const fallbackText = buildFileFallbackText(preparedAttachments);
    const outboundMessage = trimmed
      ? fallbackText
        ? `${trimmed}\n\n${fallbackText}`
        : trimmed
      : fallbackText || "";

    let estimate = estimateChatSendFrameBytes({
      sessionKey: selectedSessionKey,
      message: outboundMessage,
      deliver: false,
      idempotencyKey: runId,
      attachments: apiAttachments.length > 0 ? apiAttachments : undefined,
    });

    let compressionRounds = 0;
    while (apiAttachments.length > 0 && estimate > maxFrameBytes && compressionRounds < 8) {
      const imageCandidates = preparedAttachments
        .map((item, index) => ({
          item,
          index,
          bytes: estimateBase64Bytes(extractBase64Content(item.dataUrl)),
        }))
        .filter((entry) => entry.item.isImage && entry.bytes > MIN_IMAGE_ATTACHMENT_BYTES)
        .sort((a, b) => b.bytes - a.bytes);
      const largest = imageCandidates[0];
      if (!largest) {
        break;
      }
      const targetBytes = Math.max(
        MIN_IMAGE_ATTACHMENT_BYTES,
        Math.floor(largest.bytes * 0.72),
      );
      const compressed = await compressImageAttachment(largest.item, targetBytes);
      if (!compressed) {
        break;
      }
      const compressedBytes = estimateBase64Bytes(extractBase64Content(compressed.dataUrl));
      if (compressedBytes <= 0 || compressedBytes >= largest.bytes) {
        break;
      }
      preparedAttachments = preparedAttachments.map((item, index) =>
        index === largest.index ? compressed : item,
      );
      apiAttachments = toApiAttachments(preparedAttachments);
      estimate = estimateChatSendFrameBytes({
        sessionKey: selectedSessionKey,
        message: outboundMessage,
        deliver: false,
        idempotencyKey: runId,
        attachments: apiAttachments.length > 0 ? apiAttachments : undefined,
      });
      compressionRounds += 1;
    }

    if (estimate > maxFrameBytes) {
      const payloadKb = Math.round(maxFrameBytes / 1024);
      pushSystemMessage(
        `Attachment payload is too large for this gateway (${payloadKb}KB frame budget). Please send fewer/smaller files.`,
      );
      return;
    }

    const optimisticMessageId = generateUUID();
    const userMessage: ChatMessage = {
      id: optimisticMessageId,
      role: "user",
      text: outboundMessage,
      attachments: preparedAttachments,
      timestamp: Date.now(),
    };
    setMessages((prev) => [...prev, userMessage]);
    setDraft("");
    setAttachments([]);
    chatRunRef.current = runId;
    setChatRunId(runId);
    setThinking(true);
    setStreamTextSynced("");
    setToolItems([]);

    try {
      const sendRes = (await client.request("chat.send", {
        sessionKey: selectedSessionKey,
        message: outboundMessage,
        deliver: false,
        idempotencyKey: runId,
        attachments: apiAttachments.length > 0 ? apiAttachments : undefined,
      })) as { runId?: unknown };
      const ackRunId =
        typeof sendRes?.runId === "string" && sendRes.runId.trim()
          ? sendRes.runId.trim()
          : null;
      if (ackRunId && ackRunId !== chatRunRef.current) {
        chatRunRef.current = ackRunId;
        setChatRunId(ackRunId);
      }
    } catch (err) {
      setMessages((prev) => prev.filter((message) => message.id !== optimisticMessageId));
      setDraft(draftBeforeSend);
      setAttachments(attachmentsBeforeSend);
      pushSystemMessage(`Send failed: ${String(err)}`);
      setStreamTextSynced(null);
      setChatRunId(null);
      setThinking(false);
    }
  }

  async function handleSlashCommand(input: string) {
    const client = clientRef.current;
    if (!client || !selectedSessionKey) {
      return;
    }
    const parts = input.replace(/^\//, "").trim().split(/\s+/);
    const cmd = parts[0]?.toLowerCase();
    const args = parts.slice(1).join(" ");

    try {
      switch (cmd) {
        case "status": {
          const [statusRes, configSnapshot] = await Promise.all([
            client.request("status", {}),
            client.request("config.get", {}).catch(() => null),
          ]);
          pushSystemMessage(buildStatusCard(statusRes, configSnapshot));
          break;
        }
        case "models": {
          const availableModels = await loadModels(client);
          const list = availableModels
            .map((model) => `${model.provider}/${model.id}`)
            .join(", ");
          pushSystemMessage(list ? `models: ${list}` : "models: (none)");
          break;
        }
        case "compact": {
          const maxLines = Number.parseInt(args || "", 10);
          await client.request("sessions.compact", {
            key: selectedSessionKey,
            maxLines: Number.isFinite(maxLines) ? maxLines : undefined,
          });
          pushSystemMessage("session compact requested");
          break;
        }
        case "model": {
          if (!args) {
            pushSystemMessage("/model requires provider/model");
            break;
          }
          const nextModel = args.trim();
          await client.request("sessions.patch", {
            key: selectedSessionKey,
            model: nextModel,
          });
          if (normalizeModelKey(nextModel) === "default") {
            setSessionModelOverrides((prev) => clearOverride(prev, selectedSessionKey));
          } else {
            setSessionModelOverrides((prev) => ({
              ...prev,
              [selectedSessionKey]: nextModel,
            }));
          }
          pushSystemMessage(`model set to ${nextModel}`);
          await refreshSessions(client);
          await loadModels(client);
          break;
        }
        case "think": {
          const rawValue = args.trim();
          const value = normalizeThinkingValue(rawValue);
          await client.request("sessions.patch", {
            key: selectedSessionKey,
            thinkingLevel: rawValue ? value : null,
          });
          if (rawValue) {
            setSessionThinkingOverrides((prev) => ({
              ...prev,
              [selectedSessionKey]: value,
            }));
          } else {
            setSessionThinkingOverrides((prev) => clearOverride(prev, selectedSessionKey));
          }
          pushSystemMessage(`thinking set to ${rawValue ? value : "default"}`);
          await refreshSessions(client);
          break;
        }
        case "verbose": {
          const value = args.trim();
          await client.request("sessions.patch", {
            key: selectedSessionKey,
            verboseLevel: value ? value : null,
          });
          pushSystemMessage(`verbose ${value || "default"}`);
          await refreshSessions(client);
          break;
        }
        case "reasoning": {
          const value = args.trim();
          await client.request("sessions.patch", {
            key: selectedSessionKey,
            reasoningLevel: value ? value : null,
          });
          pushSystemMessage(`reasoning ${value || "default"}`);
          await refreshSessions(client);
          break;
        }
        case "usage": {
          const value = args.trim();
          await client.request("sessions.patch", {
            key: selectedSessionKey,
            responseUsage: value ? value : null,
          });
          pushSystemMessage(`usage ${value || "default"}`);
          await refreshSessions(client);
          break;
        }
        case "abort": {
          const runId = chatRunRef.current ?? undefined;
          await client.request(
            "chat.abort",
            runId ? { sessionKey: selectedSessionKey, runId } : { sessionKey: selectedSessionKey },
          );
          pushSystemMessage("abort requested");
          setStreamTextSynced(null);
          setChatRunId(null);
          setThinking(false);
          break;
        }
        case "new": {
          await createSession(args, false);
          break;
        }
        case "reset": {
          const resetRes = (await client.request("sessions.reset", {
            key: selectedSessionKey,
          })) as { key?: unknown };
          const resolvedKey =
            typeof resetRes?.key === "string" && resetRes.key.trim()
              ? resetRes.key
              : selectedSessionKey;
          if (resolvedKey !== selectedSessionKey) {
            setSelectedSessionKey(resolvedKey);
          }
          setSessionModelOverrides((prev) =>
            clearOverride(clearOverride(prev, selectedSessionKey), resolvedKey),
          );
          setSessionThinkingOverrides((prev) =>
            clearOverride(clearOverride(prev, selectedSessionKey), resolvedKey),
          );
          pushSystemMessage("session reset");
          await refreshSessions(client);
          await loadModels(client);
          await loadHistory(client, resolvedKey, getHistoryLimit(resolvedKey));
          break;
        }
        default:
          pushSystemMessage(`Unknown command: /${cmd}`);
      }
    } catch (err) {
      pushSystemMessage(`Command failed: ${String(err)}`);
    } finally {
      setDraft("");
    }
  }

  async function handleCreateSession(label: string) {
    await createSession(label, true);
  }

  async function handleLoadMoreSessions() {
    const client = clientRef.current;
    if (!client || loadingMoreSessionsRef.current || !canLoadMoreSessions) {
      return;
    }
    loadingMoreSessionsRef.current = true;
    const nextLimit = Math.min(
      SESSION_LIST_MAX_LIMIT,
      sessionListLimitRef.current + SESSION_LIST_STEP,
    );
    try {
      setSessionListLimit(nextLimit);
      sessionListLimitRef.current = nextLimit;
      await refreshSessions(client, nextLimit);
    } finally {
      loadingMoreSessionsRef.current = false;
    }
  }

  async function handleLoadOlderHistory() {
    const client = clientRef.current;
    const key = selectedSessionRef.current;
    if (!client || !key || thinkingRef.current || Boolean(chatRunRef.current)) {
      return;
    }
    const canLoad = historyCanLoadMoreBySessionRef.current[key] ?? false;
    if (!canLoad || historyLoadInFlightRef.current.has(key)) {
      return;
    }
    const currentLimit = getHistoryLimit(key);
    const nextLimit = Math.min(CHAT_HISTORY_MAX_LIMIT, currentLimit + CHAT_HISTORY_STEP);
    if (nextLimit <= currentLimit) {
      return;
    }
    historyLoadInFlightRef.current.add(key);
    setLoadingOlderHistory(true);
    await loadHistory(client, key, nextLimit);
  }

  async function handleDeleteSession(
    key: string,
    options?: { skipConfirm?: boolean },
  ) {
    const client = clientRef.current;
    if (!client) {
      return;
    }
    if (!options?.skipConfirm && typeof window !== "undefined") {
      const target = sessions.find((session) => session.key === key);
      const label = target?.label ?? target?.derivedTitle ?? key;
      const confirmed = window.confirm(`Delete session "${label}"?`);
      if (!confirmed) {
        return;
      }
    }
    try {
      await client.request("sessions.delete", { key });
      await refreshSessions(client);
      if (selectedSessionKey === key) {
        const next = sessions.find((session) => session.key !== key)?.key || null;
        setSelectedSessionKey(next);
      }
    } catch (err) {
      pushSystemMessage(`Delete failed: ${String(err)}`);
    }
  }

  async function handleSelectModel(model: string) {
    const client = clientRef.current;
    const key = selectedSessionRef.current;
    if (!client || !key) {
      return;
    }
    try {
      const nextModel = model.trim();
      await client.request("sessions.patch", {
        key,
        model: nextModel,
      });
      if (normalizeModelKey(nextModel) === "default") {
        setSessionModelOverrides((prev) => clearOverride(prev, key));
      } else {
        setSessionModelOverrides((prev) => ({ ...prev, [key]: nextModel }));
      }
      await refreshSessions(client);
      await loadModels(client);
    } catch (err) {
      pushSystemMessage(`Model switch failed: ${String(err)}`);
    }
  }

  async function handleSelectThinking(level: string) {
    const client = clientRef.current;
    const key = selectedSessionRef.current;
    if (!client || !key) {
      return;
    }
    try {
      const nextLevel = normalizeThinkingValue(level);
      await client.request("sessions.patch", {
        key,
        thinkingLevel: nextLevel,
      });
      setSessionThinkingOverrides((prev) => ({
        ...prev,
        [key]: nextLevel,
      }));
      await refreshSessions(client);
    } catch (err) {
      pushSystemMessage(`Thinking switch failed: ${String(err)}`);
    }
  }

  const protocolWarning =
    typeof window !== "undefined" &&
    window.location.protocol === "https:" &&
    gatewayUrl.startsWith("ws://")
      ? "This page is HTTPS. Use wss:// for the Gateway WebSocket."
      : null;

  const disabledReason = pairingRequired
    ? "Pairing required. Approve this device with openclaw devices approve."
    : [protocolWarning, connectionNote].filter(Boolean).join(" ");

  return (
    <div className="app-shell">
      <SessionSidebar
        sessions={sessions}
        selectedKey={selectedSessionKey}
        collapsed={sidebarCollapsed}
        sidebarWidth={uiSettings.sidebarWidth}
        onToggleCollapse={() => setSidebarCollapsed((prev) => !prev)}
        onSelect={(key) => setSelectedSessionKey(key)}
        onCreate={() => setShowNewSession(true)}
        onDelete={(key, opts) => void handleDeleteSession(key, opts)}
        hasMore={canLoadMoreSessions}
        onReachEnd={() => void handleLoadMoreSessions()}
      />

      <div className="main-shell">
        <ChatView
          sessionKey={selectedSessionKey}
          messages={messages}
          streamText={streamText}
          thinking={thinking}
          toolItems={toolItems}
          draft={draft}
          onDraftChange={setDraft}
          attachments={attachments}
          onAttachmentsChange={setAttachments}
          onSend={() => void handleSend()}
          onAbort={() => void handleSlashCommand("/abort")}
          canAbort={Boolean(chatRunId)}
          connected={connected}
          disabledReason={disabledReason}
          sessionInfo={sessionInfo}
          models={models}
          uiSettings={uiSettings}
          canLoadOlder={canLoadMoreHistory}
          loadingOlder={loadingOlderHistory}
          onLoadOlder={() => void handleLoadOlderHistory()}
          onModelSelect={(model) => void handleSelectModel(model)}
          onThinkingSelect={(level) => void handleSelectThinking(level)}
          onCreateSession={() => setShowNewSession(true)}
          onOpenSettings={() => setShowSettings(true)}
        />
      </div>

      <SettingsModal
        open={showSettings}
        onClose={() => setShowSettings(false)}
        gatewayUrl={gatewayUrl}
        token={token}
        password={password}
        onGatewayUrlChange={setGatewayUrl}
        onTokenChange={setToken}
        onPasswordChange={setPassword}
        uiSettings={uiSettings}
        onUiSettingsChange={setUiSettings}
        uiSettingsSchemes={uiSettingsSchemes.map((item) => ({
          id: item.id,
          name: item.name,
          updatedAt: item.updatedAt,
        }))}
        activeUiSettingsSchemeId={activeUiSettingsSchemeId}
        onApplyUiSettingsScheme={handleApplyUiSettingsScheme}
        onSaveUiSettingsScheme={handleSaveUiSettingsScheme}
        onOverwriteUiSettingsScheme={handleOverwriteUiSettingsScheme}
        onDeleteUiSettingsScheme={handleDeleteUiSettingsScheme}
        onPreviewReplyDoneSound={previewReplyDoneSound}
      />

      <NewSessionModal
        open={showNewSession}
        onClose={() => setShowNewSession(false)}
        onCreate={handleCreateSession}
      />
    </div>
  );
}
