import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
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
import { formatBytes, formatCompactTokens, slugify } from "./lib/format.ts";
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
  modelShortcutSchemes: "clawui.model.shortcuts",
  agentSessionShortcutSchemes: "clawui.agent.session.shortcuts",
  appActionShortcuts: "clawui.app.action.shortcuts",
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
const MODEL_SHORTCUT_SLOT_MIN = 1;
const MODEL_SHORTCUT_SLOT_MAX = 5;
const MODEL_SHORTCUT_KEY_OPTIONS = [
  "1",
  "2",
  "3",
  "4",
  "5",
  "6",
  "7",
  "8",
  "9",
  "0",
  "a",
  "b",
  "c",
  "d",
  "e",
  "f",
  "g",
  "h",
  "i",
  "j",
  "k",
  "l",
  "m",
  "n",
  "o",
  "p",
  "q",
  "r",
  "s",
  "t",
  "u",
  "v",
  "w",
  "x",
  "y",
  "z",
] as const;
const MAX_REPLY_DONE_CUSTOM_AUDIO_DATA_URL_CHARS = 900_000;
const MEDIA_PREFIX_RE = /\bmedia\s*:/i;
const ATTACHMENT_FINGERPRINT_HEAD = 96;
const ATTACHMENT_FINGERPRINT_TAIL = 64;
const WORKSPACE_MARKER = "/.openclaw/workspace";
const DESKTOP_LOCAL_IMAGE_SCHEME = "claw-local-image";
const REMOTE_IMAGE_CACHE_LIMIT = 5;
const DEFAULT_REMOTE_IMAGE_READ_METHODS = [
  "workspace.read",
  "workspace.file.read",
  "files.read",
  "file.read",
  "fs.read",
  "image.read",
  "images.read",
  "media.read",
];
const runtimePathHints: { homeDir: string; workspaceDir: string } = {
  homeDir: "",
  workspaceDir: "",
};

type UiSettingsScheme = {
  id: string;
  name: string;
  settings: UiSettings;
  updatedAt: number;
};

type AgentChoice = {
  id: string;
  label: string;
};

type ShortcutCombo = {
  meta: boolean;
  ctrl: boolean;
  alt: boolean;
  shift: boolean;
  key: string;
};

type AppActionShortcutId = "toggleSidebar" | "newSession";

type AppActionShortcut = {
  enabled: boolean;
  combo: ShortcutCombo;
};

type AppActionShortcutMap = Record<AppActionShortcutId, AppActionShortcut>;

type ModelShortcutScheme = {
  slot: number;
  combo: ShortcutCombo;
  model: string;
  thinkingLevel: string;
  updatedAt: number;
};

type ModelShortcutSchemeMap = Partial<Record<string, ModelShortcutScheme>>;

type AgentSessionShortcutScheme = {
  slot: number;
  combo: ShortcutCombo;
  agentId: string;
  agentLabel: string;
  updatedAt: number;
};

type AgentSessionShortcutSchemeMap = Partial<Record<string, AgentSessionShortcutScheme>>;

const AGENT_SESSION_SHORTCUT_SLOT_MIN = 1;
const AGENT_SESSION_SHORTCUT_SLOT_MAX = 5;
const APP_ACTION_SHORTCUT_IDS: AppActionShortcutId[] = ["toggleSidebar", "newSession"];

function getDefaultAgentSessionShortcutCombo(slot: number): ShortcutCombo {
  const normalizedSlot = Math.max(
    AGENT_SESSION_SHORTCUT_SLOT_MIN,
    Math.min(AGENT_SESSION_SHORTCUT_SLOT_MAX, slot),
  );
  return {
    meta: true,
    ctrl: false,
    alt: false,
    shift: true,
    key: String(normalizedSlot),
  };
}

function getDefaultAgentSessionShortcutKey(slot: number): string {
  const keys = ["q", "w", "e", "r", "t"];
  const normalizedSlot = Math.max(
    AGENT_SESSION_SHORTCUT_SLOT_MIN,
    Math.min(AGENT_SESSION_SHORTCUT_SLOT_MAX, slot),
  );
  return keys[normalizedSlot - 1] ?? "q";
}

function normalizeAgentSessionShortcutSlot(value: unknown): number | null {
  if (typeof value !== "number" || !Number.isInteger(value)) {
    return null;
  }
  if (value < AGENT_SESSION_SHORTCUT_SLOT_MIN || value > AGENT_SESSION_SHORTCUT_SLOT_MAX) {
    return null;
  }
  return value;
}

function parseAgentSessionShortcutScheme(value: unknown): AgentSessionShortcutScheme | null {
  if (!value || typeof value !== "object") {
    return null;
  }
  const row = value as Record<string, unknown>;
  const slot = normalizeAgentSessionShortcutSlot(row.slot);
  if (slot === null) {
    return null;
  }
  const agentId = typeof row.agentId === "string" ? row.agentId.trim() : "";
  if (!agentId) {
    return null;
  }
  const combo =
    normalizeShortcutCombo(row.combo) ??
    getDefaultAgentSessionShortcutCombo(slot);
  const agentLabel = typeof row.agentLabel === "string" ? row.agentLabel.trim() : agentId;
  const updatedAt =
    typeof row.updatedAt === "number" && Number.isFinite(row.updatedAt) ? row.updatedAt : Date.now();
  return {
    slot,
    combo,
    agentId,
    agentLabel,
    updatedAt,
  };
}

function normalizeAgentSessionShortcutSchemes(
  map: AgentSessionShortcutSchemeMap,
): AgentSessionShortcutSchemeMap {
  const sorted = Object.values(map)
    .filter((item): item is AgentSessionShortcutScheme => Boolean(item))
    .sort((a, b) => a.slot - b.slot);
  const usedSignatures = new Set<string>();
  const next: AgentSessionShortcutSchemeMap = {};
  for (const item of sorted) {
    const normalizedCombo =
      normalizeShortcutCombo(item.combo) ?? getDefaultAgentSessionShortcutCombo(item.slot);
    const signature = shortcutComboSignature(normalizedCombo);
    const combo = usedSignatures.has(signature)
      ? {
        ...getDefaultAgentSessionShortcutCombo(item.slot),
        key: getDefaultAgentSessionShortcutKey(item.slot),
      }
      : normalizedCombo;
    usedSignatures.add(shortcutComboSignature(combo));
    next[String(item.slot)] = {
      ...item,
      combo,
    };
  }
  return next;
}

function loadAgentSessionShortcutSchemes(): AgentSessionShortcutSchemeMap {
  try {
    const raw = localStorage.getItem(STORAGE_KEYS.agentSessionShortcutSchemes);
    if (!raw) {
      return {};
    }
    const parsed = JSON.parse(raw);
    const next: AgentSessionShortcutSchemeMap = {};
    if (Array.isArray(parsed)) {
      for (const item of parsed) {
        const normalized = parseAgentSessionShortcutScheme(item);
        if (!normalized) {
          continue;
        }
        next[String(normalized.slot)] = normalized;
      }
      return normalizeAgentSessionShortcutSchemes(next);
    }
    if (!parsed || typeof parsed !== "object") {
      return {};
    }
    for (const value of Object.values(parsed as Record<string, unknown>)) {
      const normalized = parseAgentSessionShortcutScheme(value);
      if (!normalized) {
        continue;
      }
      next[String(normalized.slot)] = normalized;
    }
    return normalizeAgentSessionShortcutSchemes(next);
  } catch {
    return {};
  }
}

function saveAgentSessionShortcutSchemes(schemes: AgentSessionShortcutSchemeMap) {
  try {
    localStorage.setItem(STORAGE_KEYS.agentSessionShortcutSchemes, JSON.stringify(schemes));
  } catch {
    // ignore
  }
}

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
  return label.trim();
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

function normalizeShortcutSlot(value: unknown): number | null {
  if (typeof value !== "number" || !Number.isInteger(value)) {
    return null;
  }
  if (value < MODEL_SHORTCUT_SLOT_MIN || value > MODEL_SHORTCUT_SLOT_MAX) {
    return null;
  }
  return value;
}

function normalizeShortcutKey(value: unknown): string | null {
  if (typeof value !== "string") {
    return null;
  }
  const normalized = value.trim().toLowerCase();
  if (!/^[a-z0-9]$/.test(normalized)) {
    return null;
  }
  return normalized;
}

function getDefaultShortcutCombo(slot: number): ShortcutCombo {
  const normalizedSlot = Math.max(MODEL_SHORTCUT_SLOT_MIN, Math.min(MODEL_SHORTCUT_SLOT_MAX, slot));
  return {
    meta: true,
    ctrl: false,
    alt: false,
    shift: false,
    key: String(normalizedSlot),
  };
}

function normalizeShortcutCombo(value: unknown): ShortcutCombo | null {
  if (!value || typeof value !== "object") {
    return null;
  }
  const row = value as Record<string, unknown>;
  const key = normalizeShortcutKey(row.key);
  if (!key) {
    return null;
  }
  return {
    meta: row.meta === true,
    ctrl: row.ctrl === true,
    alt: row.alt === true,
    shift: row.shift === true,
    key,
  };
}

function getDefaultAppActionShortcutCombo(id: AppActionShortcutId): ShortcutCombo {
  if (id === "toggleSidebar") {
    return {
      meta: true,
      ctrl: false,
      alt: false,
      shift: false,
      key: "d",
    };
  }
  return {
    meta: true,
    ctrl: false,
    alt: false,
    shift: false,
    key: "e",
  };
}

function getDefaultAppActionShortcut(id: AppActionShortcutId): AppActionShortcut {
  return {
    enabled: true,
    combo: getDefaultAppActionShortcutCombo(id),
  };
}

function parseAppActionShortcut(id: AppActionShortcutId, value: unknown): AppActionShortcut {
  const fallback = getDefaultAppActionShortcut(id);
  if (!value || typeof value !== "object") {
    return fallback;
  }
  const row = value as Record<string, unknown>;
  const combo =
    normalizeShortcutCombo(row.combo) ??
    normalizeShortcutCombo(row) ??
    fallback.combo;
  const enabled = typeof row.enabled === "boolean" ? row.enabled : fallback.enabled;
  return {
    enabled,
    combo,
  };
}

function loadAppActionShortcuts(): AppActionShortcutMap {
  const defaults: AppActionShortcutMap = {
    toggleSidebar: getDefaultAppActionShortcut("toggleSidebar"),
    newSession: getDefaultAppActionShortcut("newSession"),
  };
  try {
    const raw = localStorage.getItem(STORAGE_KEYS.appActionShortcuts);
    if (!raw) {
      return defaults;
    }
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object") {
      return defaults;
    }
    const row = parsed as Record<string, unknown>;
    const next: AppActionShortcutMap = { ...defaults };
    for (const id of APP_ACTION_SHORTCUT_IDS) {
      next[id] = parseAppActionShortcut(id, row[id]);
    }
    return next;
  } catch {
    return defaults;
  }
}

function saveAppActionShortcuts(shortcuts: AppActionShortcutMap) {
  try {
    localStorage.setItem(STORAGE_KEYS.appActionShortcuts, JSON.stringify(shortcuts));
  } catch {
    // ignore
  }
}

function shortcutComboSignature(combo: ShortcutCombo): string {
  return [
    combo.meta ? "1" : "0",
    combo.ctrl ? "1" : "0",
    combo.alt ? "1" : "0",
    combo.shift ? "1" : "0",
    combo.key,
  ].join(":");
}

function findUnusedShortcutCombo(usedSignatures: Set<string>, preferredSlot: number): ShortcutCombo {
  const preferred = getDefaultShortcutCombo(preferredSlot);
  if (!usedSignatures.has(shortcutComboSignature(preferred))) {
    return preferred;
  }
  for (const key of MODEL_SHORTCUT_KEY_OPTIONS) {
    const candidate: ShortcutCombo = {
      meta: true,
      ctrl: false,
      alt: false,
      shift: false,
      key,
    };
    if (!usedSignatures.has(shortcutComboSignature(candidate))) {
      return candidate;
    }
  }
  return preferred;
}

function parseLegacyShortcutCombo(row: Record<string, unknown>, slot: number): ShortcutCombo | null {
  const shortcutKeyString = normalizeShortcutKey(
    typeof row.shortcutKey === "string" ? row.shortcutKey : "",
  );
  if (shortcutKeyString) {
    return {
      ...getDefaultShortcutCombo(slot),
      key: shortcutKeyString,
    };
  }
  const shortcutKeyNumber =
    typeof row.shortcutKey === "number" && Number.isInteger(row.shortcutKey) ? row.shortcutKey : null;
  if (shortcutKeyNumber !== null && shortcutKeyNumber >= 0 && shortcutKeyNumber <= 9) {
    return {
      ...getDefaultShortcutCombo(slot),
      key: String(shortcutKeyNumber),
    };
  }
  const functionKeyRaw = typeof row.functionKey === "string" ? row.functionKey.trim().toUpperCase() : "";
  const functionKeyMatch = /^F(\d{1,2})$/.exec(functionKeyRaw);
  if (functionKeyMatch) {
    const functionIndex = Number(functionKeyMatch[1]);
    const mappedDigit = functionIndex === 10 ? "0" : functionIndex >= 1 && functionIndex <= 9 ? String(functionIndex) : null;
    if (mappedDigit) {
      return {
        ...getDefaultShortcutCombo(slot),
        key: mappedDigit,
      };
    }
  }
  return null;
}

function parseModelShortcutScheme(value: unknown): ModelShortcutScheme | null {
  if (!value || typeof value !== "object") {
    return null;
  }
  const row = value as Record<string, unknown>;
  const slot = normalizeShortcutSlot(row.slot);
  if (slot === null) {
    return null;
  }
  const model = typeof row.model === "string" ? row.model.trim() : "";
  if (!model) {
    return null;
  }
  const combo =
    normalizeShortcutCombo(row.combo) ??
    normalizeShortcutCombo(row) ??
    parseLegacyShortcutCombo(row, slot) ??
    getDefaultShortcutCombo(slot);
  const thinkingLevel = normalizeThinkingValue(
    typeof row.thinkingLevel === "string" ? row.thinkingLevel : null,
  );
  const updatedAt =
    typeof row.updatedAt === "number" && Number.isFinite(row.updatedAt) ? row.updatedAt : Date.now();
  return {
    slot,
    combo,
    model,
    thinkingLevel,
    updatedAt,
  };
}

function normalizeModelShortcutSchemes(map: ModelShortcutSchemeMap): ModelShortcutSchemeMap {
  const sorted = Object.values(map)
    .filter((item): item is ModelShortcutScheme => Boolean(item))
    .sort((a, b) => a.slot - b.slot);
  const usedSignatures = new Set<string>();
  const next: ModelShortcutSchemeMap = {};
  for (const item of sorted) {
    const normalizedCombo = normalizeShortcutCombo(item.combo) ?? getDefaultShortcutCombo(item.slot);
    const signature = shortcutComboSignature(normalizedCombo);
    const combo = usedSignatures.has(signature)
      ? findUnusedShortcutCombo(usedSignatures, item.slot)
      : normalizedCombo;
    usedSignatures.add(shortcutComboSignature(combo));
    next[String(item.slot)] = {
      ...item,
      combo,
    };
  }
  return next;
}

function loadModelShortcutSchemes(): ModelShortcutSchemeMap {
  try {
    const raw = localStorage.getItem(STORAGE_KEYS.modelShortcutSchemes);
    if (!raw) {
      return {};
    }
    const parsed = JSON.parse(raw);
    const next: ModelShortcutSchemeMap = {};
    if (Array.isArray(parsed)) {
      for (const item of parsed) {
        const normalized = parseModelShortcutScheme(item);
        if (!normalized) {
          continue;
        }
        next[String(normalized.slot)] = normalized;
      }
      return normalizeModelShortcutSchemes(next);
    }
    if (!parsed || typeof parsed !== "object") {
      return {};
    }
    for (const value of Object.values(parsed as Record<string, unknown>)) {
      const normalized = parseModelShortcutScheme(value);
      if (!normalized) {
        continue;
      }
      next[String(normalized.slot)] = normalized;
    }
    return normalizeModelShortcutSchemes(next);
  } catch {
    return {};
  }
}

function saveModelShortcutSchemes(schemes: ModelShortcutSchemeMap) {
  try {
    localStorage.setItem(STORAGE_KEYS.modelShortcutSchemes, JSON.stringify(schemes));
  } catch {
    // ignore
  }
}

function shortcutKeyFromKeyboardEvent(event: KeyboardEvent): string | null {
  const code = event.code.trim();
  if (/^Key[A-Z]$/.test(code)) {
    return code.slice(3).toLowerCase();
  }
  if (/^Digit[0-9]$/.test(code)) {
    return code.slice(5);
  }
  if (/^Numpad[0-9]$/.test(code)) {
    return code.slice(6);
  }
  return normalizeShortcutKey(event.key);
}

function isShortcutComboEventMatch(combo: ShortcutCombo, event: KeyboardEvent): boolean {
  const key = shortcutKeyFromKeyboardEvent(event);
  if (!key || key !== combo.key) {
    return false;
  }
  return (
    event.metaKey === combo.meta &&
    event.ctrlKey === combo.ctrl &&
    event.altKey === combo.alt &&
    event.shiftKey === combo.shift
  );
}

function resolveShortcutLabel(combo: ShortcutCombo): string {
  const parts: string[] = [];
  if (combo.meta) {
    parts.push("Cmd");
  }
  if (combo.ctrl) {
    parts.push("Control");
  }
  if (combo.alt) {
    parts.push("Option");
  }
  if (combo.shift) {
    parts.push("Shift");
  }
  parts.push(combo.key.toUpperCase());
  return parts.join("+");
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

const TEXT_MIME_PREFIXES = [
  "text/",
  "application/json",
  "application/xml",
  "application/javascript",
  "application/typescript",
  "application/x-yaml",
  "application/yaml",
  "application/toml",
  "application/x-sh",
  "application/x-python",
  "application/sql",
  "application/graphql",
  "application/ld+json",
];

const TEXT_FILE_EXTENSIONS = new Set([
  "txt", "md", "markdown", "json", "jsonl", "json5", "csv", "tsv",
  "xml", "html", "htm", "svg", "yaml", "yml", "toml", "ini", "cfg", "conf",
  "js", "jsx", "ts", "tsx", "mjs", "cjs",
  "py", "rb", "go", "rs", "java", "kt", "c", "h", "cpp", "hpp", "cs",
  "sh", "bash", "zsh", "fish", "bat", "ps1", "cmd",
  "sql", "graphql", "gql",
  "css", "scss", "sass", "less",
  "vue", "svelte", "astro",
  "env", "gitignore", "dockerignore", "editorconfig",
  "log", "diff", "patch",
  "tex", "bib", "rst", "adoc",
]);

function isTextMime(mime: string): boolean {
  const lower = mime.toLowerCase();
  return TEXT_MIME_PREFIXES.some((prefix) => lower.startsWith(prefix));
}

function isTextFile(attachment: Attachment): boolean {
  if (isTextMime(attachment.type)) {
    return true;
  }
  const ext = attachment.name.split(".").pop()?.toLowerCase() ?? "";
  return TEXT_FILE_EXTENSIONS.has(ext);
}

function decodeBase64Content(dataUrl: string): string {
  const b64 = extractBase64Content(dataUrl);
  if (!b64) {
    return "";
  }
  try {
    return atob(b64);
  } catch {
    return "";
  }
}

const MAX_EMBEDDED_FILE_CHARS = 100_000;

function buildFileFallbackText(attachments: Attachment[]): string | null {
  const files = attachments.filter((item) => !item.isImage);
  if (files.length === 0) {
    return null;
  }

  const parts: string[] = [];
  for (const file of files) {
    if (isTextFile(file)) {
      let text = decodeBase64Content(file.dataUrl);
      if (text.length > MAX_EMBEDDED_FILE_CHARS) {
        text = text.slice(0, MAX_EMBEDDED_FILE_CHARS) + "\n...(truncated)";
      }
      if (text) {
        parts.push(`<file name="${file.name}">\n${text}\n</file>`);
      } else {
        parts.push(`[Attached file: ${file.name} (could not decode)]`);
      }
    } else {
      parts.push(`[Attached file: ${file.name} (${formatBytes(file.size)}) — binary file, content not readable by model]`);
    }
  }

  return parts.join("\n\n");
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

function toFiniteNumber(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) {
    return value;
  }
  if (typeof value !== "string") {
    return null;
  }
  const normalized = value.trim().replace(/,/g, "");
  if (!normalized) {
    return null;
  }
  const parsed = Number(normalized);
  return Number.isFinite(parsed) ? parsed : null;
}

function getNumberLike(source: Record<string, unknown>, keys: string[]): number | null {
  for (const key of keys) {
    const parsed = toFiniteNumber(source[key]);
    if (parsed !== null) {
      return parsed;
    }
  }
  return null;
}

type SessionTokenStats = {
  contextTokens: number;
  inputTokens: number;
  outputTokens: number;
  totalTokens: number;
};

function extractSessionTokenStatsFromMessage(message: unknown): Partial<SessionTokenStats> | null {
  if (!isRecord(message)) {
    return null;
  }
  const readRecord = (path: string[]): Record<string, unknown> | null => {
    const value = getNested(message, path);
    return isRecord(value) ? value : null;
  };
  const usageRecord = isRecord(message.usage) ? message.usage : null;
  const tokenUsageRecord = isRecord(message.tokenUsage) ? message.tokenUsage : null;
  const responseUsageRecord = isRecord(message.responseUsage) ? message.responseUsage : null;
  const statsRecord = isRecord(message.stats) ? message.stats : null;
  const dataRecord = isRecord(message.data) ? message.data : null;
  const payloadRecord = isRecord(message.payload) ? message.payload : null;
  const resultRecord = isRecord(message.result) ? message.result : null;
  const dataUsageRecord = readRecord(["data", "usage"]);
  const dataTokenUsageRecord = readRecord(["data", "tokenUsage"]);
  const dataResponseUsageRecord = readRecord(["data", "responseUsage"]);
  const dataStatsRecord = readRecord(["data", "stats"]);
  const payloadUsageRecord = readRecord(["payload", "usage"]);
  const payloadTokenUsageRecord = readRecord(["payload", "tokenUsage"]);
  const payloadResponseUsageRecord = readRecord(["payload", "responseUsage"]);
  const payloadStatsRecord = readRecord(["payload", "stats"]);
  const resultUsageRecord = readRecord(["result", "usage"]);
  const resultTokenUsageRecord = readRecord(["result", "tokenUsage"]);
  const resultResponseUsageRecord = readRecord(["result", "responseUsage"]);
  const resultStatsRecord = readRecord(["result", "stats"]);
  const metadataUsage = getNested(message, ["metadata", "usage"]);
  const metadataUsageRecord = isRecord(metadataUsage) ? metadataUsage : null;
  const metaUsage = getNested(message, ["meta", "usage"]);
  const metaUsageRecord = isRecord(metaUsage) ? metaUsage : null;
  const sources = [
    message,
    dataRecord,
    payloadRecord,
    resultRecord,
    usageRecord,
    tokenUsageRecord,
    responseUsageRecord,
    statsRecord,
    dataUsageRecord,
    dataTokenUsageRecord,
    dataResponseUsageRecord,
    dataStatsRecord,
    payloadUsageRecord,
    payloadTokenUsageRecord,
    payloadResponseUsageRecord,
    payloadStatsRecord,
    resultUsageRecord,
    resultTokenUsageRecord,
    resultResponseUsageRecord,
    resultStatsRecord,
    metadataUsageRecord,
    metaUsageRecord,
  ].filter((item): item is Record<string, unknown> => Boolean(item));
  const read = (keys: string[]): number | null => {
    for (const source of sources) {
      const value = getNumberLike(source, keys);
      if (value !== null) {
        return value;
      }
    }
    return null;
  };

  const inputTokens = read([
    "inputTokens",
    "input_tokens",
    "promptTokens",
    "prompt_tokens",
    "promptTokenCount",
    "requestTokens",
    "request_tokens",
  ]);
  const outputTokens = read([
    "outputTokens",
    "output_tokens",
    "completionTokens",
    "completion_tokens",
    "completionTokenCount",
    "responseTokens",
    "response_tokens",
  ]);
  const totalTokensRaw = read([
    "totalTokens",
    "total_tokens",
    "allTokens",
    "all_tokens",
    "tokenCount",
  ]);
  const contextTokens = read([
    "contextTokens",
    "context_tokens",
    "contextWindow",
    "context_window",
    "contextLimit",
    "context_limit",
    "maxContextTokens",
    "max_context_tokens",
  ]);
  const totalTokens =
    totalTokensRaw ??
    (inputTokens !== null && outputTokens !== null ? inputTokens + outputTokens : null);

  const patch: Partial<SessionTokenStats> = {};
  if (contextTokens !== null) {
    patch.contextTokens = contextTokens;
  }
  if (inputTokens !== null) {
    patch.inputTokens = inputTokens;
  }
  if (outputTokens !== null) {
    patch.outputTokens = outputTokens;
  }
  if (totalTokens !== null) {
    patch.totalTokens = totalTokens;
  }
  return Object.keys(patch).length > 0 ? patch : null;
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

function resolveCanonicalModelFromCatalog(
  value: string | null | undefined,
  catalog: ModelsListResult["models"],
): string {
  const normalized = value?.trim() ?? "";
  if (!normalized) {
    return "";
  }
  const exact =
    catalog.find((entry) => `${entry.provider}/${entry.id}` === normalized) ??
    catalog.find((entry) => entry.id === normalized) ??
    catalog.find((entry) => `${entry.provider}/${entry.name}` === normalized) ??
    catalog.find((entry) => entry.name === normalized) ??
    null;
  if (!exact) {
    return normalized;
  }
  return `${exact.provider}/${exact.id}`;
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
  const compatibleMatch = sessions.find((session) => sessionKeysMatch(session.key, previousKey));
  if (compatibleMatch) {
    return compatibleMatch.key;
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

function normalizeAgentId(value: string | null | undefined): string {
  return value?.trim().toLowerCase() ?? "";
}

function resolveAgentIdWithFallback(value: string | null | undefined): string {
  return normalizeAgentId(value) || "main";
}

function resolveAgentChoiceLabel(entry: AgentsListResult["agents"][number]): string {
  const identityName = entry.identity?.name?.trim() ?? "";
  if (identityName) {
    return identityName;
  }
  const name = entry.name?.trim() ?? "";
  if (name) {
    return name;
  }
  return entry.id;
}

function resolveAgentForSession(
  agents: AgentsListResult | null,
  sessionKey: string | null | undefined,
): AgentChoice {
  if (agents?.scope === "global") {
    return { id: "global", label: "global" };
  }
  const preferredId = sessionKey ? splitAgentSessionKey(sessionKey)?.agentId ?? null : null;
  const selectedId = resolveAgentIdWithFallback(preferredId ?? agents?.defaultId);
  const matched = agents?.agents.find((entry) => normalizeAgentId(entry.id) === selectedId);
  return {
    id: selectedId,
    label: matched ? resolveAgentChoiceLabel(matched) : selectedId,
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

function stripWrappingQuotes(value: string): string {
  const trimmed = value.trim();
  if (
    (trimmed.startsWith('"') && trimmed.endsWith('"')) ||
    (trimmed.startsWith("'") && trimmed.endsWith("'"))
  ) {
    return trimmed.slice(1, -1).trim();
  }
  return trimmed;
}

function normalizeMediaDirectivePath(value: string): string {
  let next = value.trim();
  if (!next) {
    return "";
  }
  if (next.startsWith("`") && next.endsWith("`") && next.length > 1) {
    next = next.slice(1, -1).trim();
  }
  next = stripWrappingQuotes(next);
  // Strip common trailing punctuation generated by LLMs.
  next = next.replace(/[),.;!?]+$/g, "").trim();
  if (!next) {
    return "";
  }
  if (/\s/.test(next)) {
    const firstToken = next.split(/\s+/)[0] ?? "";
    return firstToken.trim();
  }
  return next;
}

function isAbsoluteFsPath(value: string): boolean {
  const trimmed = value.trim();
  return (
    trimmed.startsWith("/") ||
    trimmed.startsWith("\\\\") ||
    /^[A-Za-z]:[\\/]/.test(trimmed) ||
    trimmed.startsWith("~/")
  );
}

function normalizeFsPath(value: string): string {
  return value.replace(/\\/g, "/");
}

function trimTrailingSlashes(value: string): string {
  const normalized = normalizeFsPath(value).trim();
  if (!normalized) {
    return "";
  }
  return normalized.replace(/\/+$/g, "");
}

function deriveHomeFromWorkspacePath(workspacePath: string): string {
  const normalized = trimTrailingSlashes(workspacePath).toLowerCase();
  const markerIndex = normalized.indexOf(WORKSPACE_MARKER);
  if (markerIndex <= 0) {
    return "";
  }
  return trimTrailingSlashes(workspacePath).slice(0, markerIndex);
}

function setRuntimePathHints(next: { homeDir?: string | null; workspaceDir?: string | null }) {
  const homeDir = trimTrailingSlashes(next.homeDir ?? "");
  const workspaceDir = trimTrailingSlashes(next.workspaceDir ?? "");
  if (homeDir) {
    runtimePathHints.homeDir = homeDir;
  }
  if (workspaceDir) {
    runtimePathHints.workspaceDir = workspaceDir;
  }
  if (!runtimePathHints.homeDir && runtimePathHints.workspaceDir) {
    const derivedHome = deriveHomeFromWorkspacePath(runtimePathHints.workspaceDir);
    if (derivedHome) {
      runtimePathHints.homeDir = derivedHome;
    }
  }
  if (!runtimePathHints.workspaceDir && runtimePathHints.homeDir) {
    runtimePathHints.workspaceDir = `${runtimePathHints.homeDir}${WORKSPACE_MARKER}`;
  }
}

function getRuntimeHomeDir(): string {
  const desktopHomeDir = trimTrailingSlashes(window.desktopInfo?.homeDir ?? "");
  if (desktopHomeDir) {
    return desktopHomeDir;
  }
  return runtimePathHints.homeDir;
}

function getRuntimeWorkspaceDir(): string {
  const desktopWorkspaceDir = trimTrailingSlashes(window.desktopInfo?.workspaceDir ?? "");
  if (desktopWorkspaceDir) {
    return desktopWorkspaceDir;
  }
  if (runtimePathHints.workspaceDir) {
    return runtimePathHints.workspaceDir;
  }
  const homeDir = getRuntimeHomeDir();
  if (!homeDir) {
    return "";
  }
  return `${homeDir}${WORKSPACE_MARKER}`;
}

function collectRuntimePathHintsFromConfig(snapshot: unknown) {
  if (!isRecord(snapshot)) {
    return;
  }
  const queue: Array<{ value: unknown; keyPath: string; depth: number }> = [
    { value: snapshot, keyPath: "", depth: 0 },
  ];
  let nodes = 0;
  const MAX_NODES = 600;
  const MAX_DEPTH = 7;
  let workspaceCandidate = "";
  let homeCandidate = "";
  while (queue.length > 0 && nodes < MAX_NODES) {
    const current = queue.shift();
    if (!current) {
      continue;
    }
    nodes += 1;
    const { value, keyPath, depth } = current;
    if (typeof value === "string") {
      const trimmed = trimTrailingSlashes(value);
      if (!trimmed) {
        continue;
      }
      const lowerValue = trimmed.toLowerCase();
      const lowerKey = keyPath.toLowerCase();
      const isAbsoluteLike = isAbsoluteFsPath(trimmed) || trimmed.startsWith("~/");
      if (!isAbsoluteLike) {
        continue;
      }
      if (!workspaceCandidate && (lowerKey.includes("workspace") || lowerValue.includes(WORKSPACE_MARKER))) {
        workspaceCandidate = trimmed;
      }
      if (!homeCandidate && lowerKey.includes("home")) {
        homeCandidate = trimmed;
      }
      continue;
    }
    if (depth >= MAX_DEPTH) {
      continue;
    }
    if (Array.isArray(value)) {
      for (let index = 0; index < value.length; index += 1) {
        queue.push({ value: value[index], keyPath: `${keyPath}[${index}]`, depth: depth + 1 });
      }
      continue;
    }
    if (!isRecord(value)) {
      continue;
    }
    for (const [key, nested] of Object.entries(value)) {
      const nextKeyPath = keyPath ? `${keyPath}.${key}` : key;
      queue.push({ value: nested, keyPath: nextKeyPath, depth: depth + 1 });
    }
  }
  const derivedHome = workspaceCandidate ? deriveHomeFromWorkspacePath(workspaceCandidate) : "";
  setRuntimePathHints({
    homeDir: homeCandidate || derivedHome || null,
    workspaceDir: workspaceCandidate || null,
  });
}

function fileNameFromPath(value: string): string {
  const normalized = normalizeFsPath(value);
  const parts = normalized.split("/").filter(Boolean);
  return parts[parts.length - 1] ?? "image";
}

function inferImageMimeTypeFromPath(value: string): string | null {
  const normalized = normalizeFsPath(value).toLowerCase();
  const noQuery = normalized.split("?")[0]?.split("#")[0] ?? normalized;
  if (noQuery.endsWith(".png")) {
    return "image/png";
  }
  if (noQuery.endsWith(".jpg") || noQuery.endsWith(".jpeg")) {
    return "image/jpeg";
  }
  if (noQuery.endsWith(".webp")) {
    return "image/webp";
  }
  if (noQuery.endsWith(".gif")) {
    return "image/gif";
  }
  if (noQuery.endsWith(".bmp")) {
    return "image/bmp";
  }
  if (noQuery.endsWith(".svg")) {
    return "image/svg+xml";
  }
  return null;
}

function looksLikeBase64Payload(value: string): boolean {
  const compact = value.replace(/\s+/g, "");
  if (compact.length < 24 || compact.length % 4 === 1) {
    return false;
  }
  return /^[A-Za-z0-9+/]+=*$/.test(compact);
}

function toImageDataUrl(base64Payload: string, sourcePathHint: string, mimeHint?: string | null): string | null {
  const compact = base64Payload.replace(/\s+/g, "").trim();
  if (!looksLikeBase64Payload(compact)) {
    return null;
  }
  const mimeType = mimeHint ?? inferImageMimeTypeFromPath(sourcePathHint) ?? "image/png";
  return `data:${mimeType};base64,${compact}`;
}

function extractImageDataUrlFromUnknown(
  value: unknown,
  sourcePathHint: string,
  mimeHint?: string | null,
): string | null {
  const queue: Array<{ value: unknown; depth: number; mimeHint?: string | null }> = [
    { value, depth: 0, mimeHint },
  ];
  const seen = new Set<unknown>();
  let traversed = 0;
  const MAX_NODES = 220;
  const MAX_DEPTH = 6;

  while (queue.length > 0 && traversed < MAX_NODES) {
    const current = queue.shift();
    if (!current) {
      continue;
    }
    traversed += 1;
    const node = current.value;
    if (node === null || node === undefined || seen.has(node)) {
      continue;
    }
    seen.add(node);

    if (typeof node === "string") {
      const trimmed = node.trim();
      if (!trimmed) {
        continue;
      }
      if (/^data:image\//i.test(trimmed)) {
        return trimmed;
      }
      if (/^(https?:|blob:)/i.test(trimmed)) {
        return trimmed;
      }
      const dataUrl = toImageDataUrl(trimmed, sourcePathHint, current.mimeHint);
      if (dataUrl) {
        return dataUrl;
      }
      continue;
    }

    if (Array.isArray(node)) {
      if (current.depth < MAX_DEPTH) {
        for (const item of node) {
          queue.push({ value: item, depth: current.depth + 1, mimeHint: current.mimeHint });
        }
      }
      continue;
    }

    if (!isRecord(node)) {
      continue;
    }

    const inferredMime =
      getString(node, ["mimeType", "mime_type", "media_type", "contentType", "content_type"]) ??
      current.mimeHint ??
      null;
    const directUrl = getString(node, ["dataUrl", "data_url", "url", "uri", "href", "image_url", "imageUrl"]);
    if (directUrl) {
      if (/^data:image\//i.test(directUrl) || /^(https?:|blob:)/i.test(directUrl)) {
        return directUrl;
      }
      const fromRaw = toImageDataUrl(directUrl, sourcePathHint, inferredMime);
      if (fromRaw) {
        return fromRaw;
      }
    }

    const directBase64 = getString(node, [
      "base64",
      "b64",
      "b64_json",
      "data",
      "content",
      "bytes",
      "image",
      "image_base64",
    ]);
    if (directBase64) {
      const asDataUrl = toImageDataUrl(directBase64, sourcePathHint, inferredMime);
      if (asDataUrl) {
        return asDataUrl;
      }
    }

    if (current.depth >= MAX_DEPTH) {
      continue;
    }
    for (const nested of Object.values(node)) {
      if (isRecord(nested) || Array.isArray(nested) || typeof nested === "string") {
        queue.push({ value: nested, depth: current.depth + 1, mimeHint: inferredMime });
      }
    }
  }

  return null;
}

function pickRemoteImageReadMethods(methods: Set<string>): string[] {
  const values = [...methods].filter((entry) => typeof entry === "string" && entry.trim());
  if (values.length === 0) {
    return [...DEFAULT_REMOTE_IMAGE_READ_METHODS];
  }
  const scored = values
    .map((method) => {
      const lower = method.trim().toLowerCase();
      let score = 0;
      if (lower.includes("read")) {
        score += 3;
      }
      if (lower.includes("file") || lower.includes("fs")) {
        score += 3;
      }
      if (lower.includes("workspace") || lower.includes("media") || lower.includes("image")) {
        score += 2;
      }
      if (lower.includes("chat")) {
        score -= 2;
      }
      return { method, score };
    })
    .filter((item) => item.score >= 2)
    .sort((a, b) => b.score - a.score);

  const methodsByScore = scored.map((item) => item.method);
  const relatedMethods = values.filter((method) => {
    const lower = method.toLowerCase();
    return (
      lower.includes("read") ||
      lower.includes("file") ||
      lower.includes("fs") ||
      lower.includes("image") ||
      lower.includes("media") ||
      lower.includes("workspace")
    );
  });
  const merged = [...methodsByScore, ...relatedMethods, ...DEFAULT_REMOTE_IMAGE_READ_METHODS].filter(
    (method, index, arr) => arr.indexOf(method) === index,
  );
  if (merged.length === 0) {
    return [...DEFAULT_REMOTE_IMAGE_READ_METHODS];
  }
  return merged;
}

function toGatewayHttpBaseCandidates(rawGatewayUrl: string): string[] {
  const trimmed = normalizeGatewayUrl(rawGatewayUrl).trim();
  if (!trimmed) {
    return [];
  }
  const seen = new Set<string>();
  const candidates: string[] = [];
  const push = (value: string) => {
    const next = value.trim().replace(/\/+$/g, "");
    if (!next || seen.has(next)) {
      return;
    }
    seen.add(next);
    candidates.push(next);
  };
  const collectFromUrl = (value: URL) => {
    const protocol =
      value.protocol === "wss:"
        ? "https:"
        : value.protocol === "ws:"
          ? "http:"
          : value.protocol;
    if (protocol !== "http:" && protocol !== "https:") {
      return;
    }
    const originBase = `${protocol}//${value.host}`;
    push(originBase);
    const segments = value.pathname.split("/").filter(Boolean);
    if (segments.length === 0) {
      return;
    }
    for (let i = segments.length; i >= 1; i -= 1) {
      push(`${originBase}/${segments.slice(0, i).join("/")}`);
    }
  };

  try {
    collectFromUrl(new URL(trimmed));
  } catch {
    try {
      collectFromUrl(new URL(`ws://${trimmed}`));
    } catch {
      return [];
    }
  }
  return candidates;
}

function buildGatewayLocalImageProxyCandidates(rawGatewayUrl: string, filePath: string): string[] {
  const encodedPath = encodeURIComponent(filePath);
  return toGatewayHttpBaseCandidates(rawGatewayUrl)
    .map((base) => `${base}/__claw/local-image?path=${encodedPath}`)
    .filter((value, index, arr) => arr.indexOf(value) === index);
}

function blobToDataUrl(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const result = typeof reader.result === "string" ? reader.result : "";
      if (!result) {
        reject(new Error("empty-data-url"));
        return;
      }
      resolve(result);
    };
    reader.onerror = () => {
      reject(reader.error ?? new Error("file-reader-failed"));
    };
    reader.readAsDataURL(blob);
  });
}

async function extractImageDataUrlFromHttpResponse(
  response: Response,
  sourcePathHint: string,
): Promise<string | null> {
  const contentType = (response.headers.get("content-type") ?? "").toLowerCase();
  if (contentType.includes("json")) {
    try {
      const payload = await response.json();
      return extractImageDataUrlFromUnknown(payload, sourcePathHint);
    } catch {
      return null;
    }
  }
  if (contentType.startsWith("text/")) {
    const payload = await response.text();
    if (!payload.trim()) {
      return null;
    }
    try {
      const parsed = JSON.parse(payload);
      return extractImageDataUrlFromUnknown(parsed, sourcePathHint);
    } catch {
      return extractImageDataUrlFromUnknown(payload, sourcePathHint);
    }
  }
  const blob = await response.blob();
  if (!blob.size) {
    return null;
  }
  if (blob.type.toLowerCase().startsWith("image/")) {
    return blobToDataUrl(blob);
  }
  const inferredType = inferImageMimeTypeFromPath(sourcePathHint) ?? "image/png";
  return blobToDataUrl(new Blob([blob], { type: inferredType }));
}

async function resolveRemoteImageViaHttpProxy(
  gatewayUrl: string,
  filePath: string,
): Promise<string | null> {
  const candidates = buildGatewayLocalImageProxyCandidates(gatewayUrl, filePath);
  const desktopFetchImageUrl = window.desktopInfo?.fetchImageUrl;
  for (const candidate of candidates) {
    if (typeof desktopFetchImageUrl === "function") {
      try {
        const result = await desktopFetchImageUrl(candidate);
        const dataUrl = result?.ok && typeof result.dataUrl === "string" ? result.dataUrl.trim() : "";
        if (dataUrl) {
          return dataUrl;
        }
      } catch {
        // fallback to renderer-side fetch
      }
    }
    try {
      const response = await fetch(candidate, {
        method: "GET",
        cache: "no-store",
      });
      if (!response.ok) {
        continue;
      }
      const dataUrl = await extractImageDataUrlFromHttpResponse(response, filePath);
      if (dataUrl) {
        return dataUrl;
      }
    } catch {
      // try next candidate
    }
  }
  return null;
}

function toFileUrl(value: string): string | null {
  const normalized = normalizeFsPath(value).trim();
  if (!normalized) {
    return null;
  }
  if (normalized.startsWith("~/")) {
    const homeDir = getRuntimeHomeDir();
    if (!homeDir) {
      return null;
    }
    const expanded = `${homeDir}/${normalized.slice(2)}`;
    return toFileUrl(expanded);
  }
  if (/^[A-Za-z]:\//.test(normalized)) {
    return `file:///${encodeURI(normalized)}`;
  }
  if (normalized.startsWith("//")) {
    return `file:${encodeURI(normalized)}`;
  }
  if (normalized.startsWith("/")) {
    return `file://${encodeURI(normalized)}`;
  }
  return null;
}

function buildDesktopLocalImageUrl(localPath: string): string {
  return `${DESKTOP_LOCAL_IMAGE_SCHEME}://open?path=${encodeURIComponent(localPath)}`;
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

function localPathFromWebProxyUrl(value: string): string | null {
  const trimmed = value.trim();
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
  const marker = "/__claw/local-image?";
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

  if (trimmed.startsWith(marker)) {
    return parsePath(new URLSearchParams(trimmed.slice(marker.length)).get("path"));
  }

  const markerIndex = trimmed.indexOf(marker);
  if (markerIndex >= 0) {
    return parsePath(new URLSearchParams(trimmed.slice(markerIndex + marker.length)).get("path"));
  }

  if (!trimmed.includes("/__claw/local-image")) {
    return null;
  }
  try {
    const parsed = new URL(trimmed, "http://127.0.0.1");
    return parsePath(parsed.searchParams.get("path"));
  } catch {
    return null;
  }
}

function isDesktopRuntime(): boolean {
  if (window.desktopInfo?.isDesktop) {
    return true;
  }
  return window.location.protocol === "file:";
}

function canUseWebLocalImageProxy(): boolean {
  const protocol = window.location.protocol;
  return protocol === "http:" || protocol === "https:";
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

function buildWebLocalImageProxyUrl(localPath: string): string {
  if (!canUseWebLocalImageProxy()) {
    return "";
  }
  const origin = window.location.origin;
  return `${origin}/__claw/local-image?path=${encodeURIComponent(localPath)}`;
}

function resolveWorkspaceRelativeImagePath(value: string): string | null {
  const trimmed = value.trim();
  if (!trimmed) {
    return null;
  }
  if (trimmed.includes("/") || trimmed.includes("\\")) {
    return null;
  }
  if (!inferImageMimeTypeFromPath(trimmed)) {
    return null;
  }
  const workspaceDir = getRuntimeWorkspaceDir();
  if (!workspaceDir) {
    return null;
  }
  return `${workspaceDir}/${trimmed}`;
}

function resolveMediaDirectivePath(rawPath: string): string | null {
  const cleaned = normalizeMediaDirectivePath(rawPath);
  if (!cleaned) {
    return null;
  }
  const homeDir = getRuntimeHomeDir();
  const workspaceDir = getRuntimeWorkspaceDir();
  if (cleaned.startsWith("~/")) {
    if (!homeDir) {
      return null;
    }
    return `${homeDir}/${cleaned.slice(2)}`;
  }
  if (isAbsoluteFsPath(cleaned)) {
    return cleaned;
  }
  // Only filename is accepted for relative directives; it maps to ~/.openclaw/workspace.
  if (cleaned.includes("/") || cleaned.includes("\\")) {
    return null;
  }
  if (!workspaceDir) {
    if (!isDesktopRuntime()) {
      return cleaned;
    }
    return null;
  }
  return `${workspaceDir}/${cleaned}`;
}

function extractMediaAttachmentsFromText(text: string): {
  cleanedText: string;
  attachments: Attachment[];
} {
  const attachments: Attachment[] = [];
  const seen = new Set<string>();
  const retainedLines: string[] = [];
  const lines = text.split(/\r?\n/);

  for (const line of lines) {
    const match = MEDIA_PREFIX_RE.exec(line);
    if (!match || match.index < 0) {
      retainedLines.push(line);
      continue;
    }
    const prefix = line.slice(0, match.index).trimEnd();
    const rawPath = line.slice(match.index + match[0].length).trim();
    const resolved = resolveMediaDirectivePath(rawPath);
    if (!resolved) {
      retainedLines.push(line);
      continue;
    }
    const mimeType = inferImageMimeTypeFromPath(resolved);
    const dataUrl = isDesktopRuntime()
      ? buildDesktopLocalImageUrl(resolved)
      : buildWebLocalImageProxyUrl(resolved) || toFileUrl(resolved);
    if (!mimeType || !dataUrl) {
      retainedLines.push(line);
      continue;
    }
    if (seen.has(dataUrl)) {
      continue;
    }
    seen.add(dataUrl);
    attachments.push({
      id: `${generateUUID()}-media`,
      name: fileNameFromPath(resolved),
      size: 0,
      type: mimeType,
      dataUrl,
      isImage: true,
    });
    if (prefix) {
      retainedLines.push(prefix);
    }
  }

  const cleanedText = retainedLines.join("\n").replace(/\n{3,}/g, "\n\n").trim();
  return { cleanedText, attachments };
}

function buildAttachmentSignature(type: string, dataUrl: string): string {
  const normalizedType = type.trim().toLowerCase();
  const normalizedDataUrl = dataUrl.trim();
  const head = normalizedDataUrl.slice(0, ATTACHMENT_FINGERPRINT_HEAD);
  const tail =
    normalizedDataUrl.length > ATTACHMENT_FINGERPRINT_HEAD + ATTACHMENT_FINGERPRINT_TAIL
      ? normalizedDataUrl.slice(-ATTACHMENT_FINGERPRINT_TAIL)
      : "";
  return `${normalizedType}:${normalizedDataUrl.length}:${head}:${tail}`;
}

function toolMessageMayContainImage(raw: unknown): boolean {
  if (!isRecord(raw)) {
    return false;
  }
  if (Object.keys(raw).some((key) => key.toLowerCase().includes("image"))) {
    return true;
  }
  const directType = getString(raw, ["type", "event", "kind"])?.toLowerCase() ?? "";
  if (directType.includes("image")) {
    return true;
  }
  const content = raw.content;
  if (Array.isArray(content)) {
    for (const part of content) {
      if (!isRecord(part)) {
        continue;
      }
      const type = getString(part, ["type"])?.toLowerCase() ?? "";
      if (type.includes("image")) {
        return true;
      }
      if (part.image_url !== undefined || part.imageUrl !== undefined) {
        return true;
      }
      if (isRecord(part.source)) {
        const mediaType =
          getString(part.source, ["media_type", "mimeType", "mime_type", "contentType", "content_type"]) ??
          "";
        if (mediaType.toLowerCase().includes("image")) {
          return true;
        }
      }
      if (Object.keys(part).some((key) => key.toLowerCase().includes("image"))) {
        return true;
      }
    }
  }
  const candidates = [raw.content, raw.output, raw.result, raw.response, raw.text];
  for (const value of candidates) {
    if (typeof value !== "string") {
      continue;
    }
    const sample = value.slice(0, 2048).toLowerCase();
    if (
      sample.includes("data:image/") ||
      sample.includes("media:") ||
      /\.(png|jpe?g|webp|gif|bmp|svg)\b/i.test(sample)
    ) {
      return true;
    }
  }
  return false;
}

function normalizeImageSourceData(rawData: string, mimeType: string): { dataUrl: string; fromBase64: boolean } {
  const trimmed = rawData.trim();
  if (!trimmed) {
    return { dataUrl: "", fromBase64: false };
  }
  if (/^data:image\//i.test(trimmed)) {
    return { dataUrl: trimmed, fromBase64: false };
  }
  if (/^(https?:|blob:)/i.test(trimmed)) {
    return { dataUrl: trimmed, fromBase64: false };
  }
  const fromDesktopLocalPath = localPathFromDesktopLocalImageUrl(trimmed);
  if (fromDesktopLocalPath) {
    if (isDesktopRuntime()) {
      return { dataUrl: buildDesktopLocalImageUrl(fromDesktopLocalPath), fromBase64: false };
    }
    const proxied = buildWebLocalImageProxyUrl(fromDesktopLocalPath);
    return { dataUrl: proxied || trimmed, fromBase64: false };
  }
  const fromProxyPath = localPathFromWebProxyUrl(trimmed);
  if (fromProxyPath) {
    const resolvedProxyPath =
      isAbsoluteFsPath(fromProxyPath) || fromProxyPath.startsWith("~")
        ? fromProxyPath
        : getRuntimeWorkspaceDir()
          ? `${getRuntimeWorkspaceDir()}/${fromProxyPath}`
          : fromProxyPath;
    if (isDesktopRuntime()) {
      return { dataUrl: buildDesktopLocalImageUrl(resolvedProxyPath), fromBase64: false };
    }
    const proxied = buildWebLocalImageProxyUrl(resolvedProxyPath);
    return { dataUrl: proxied || trimmed, fromBase64: false };
  }
  if (/^file:/i.test(trimmed)) {
    if (isDesktopRuntime()) {
      const asLocalPath = filePathFromFileUrl(trimmed);
      if (asLocalPath) {
        return { dataUrl: buildDesktopLocalImageUrl(asLocalPath), fromBase64: false };
      }
      return { dataUrl: trimmed, fromBase64: false };
    }
    const asLocalPath = filePathFromFileUrl(trimmed);
    if (asLocalPath) {
      const proxied = buildWebLocalImageProxyUrl(asLocalPath);
      return { dataUrl: proxied || trimmed, fromBase64: false };
    }
    return { dataUrl: trimmed, fromBase64: false };
  }
  if (isAbsoluteFsPath(trimmed)) {
    if (isDesktopRuntime()) {
      return { dataUrl: buildDesktopLocalImageUrl(trimmed), fromBase64: false };
    }
    if (!isDesktopRuntime()) {
      const proxied = buildWebLocalImageProxyUrl(trimmed);
      if (proxied) {
        return { dataUrl: proxied, fromBase64: false };
      }
      const asFileUrl = toFileUrl(trimmed);
      if (asFileUrl) {
        return { dataUrl: asFileUrl, fromBase64: false };
      }
    }
    const asFileUrl = toFileUrl(trimmed);
    if (asFileUrl) {
      return { dataUrl: asFileUrl, fromBase64: false };
    }
  }
  const workspaceRelativePath = resolveWorkspaceRelativeImagePath(trimmed);
  if (workspaceRelativePath) {
    if (isDesktopRuntime()) {
      return { dataUrl: buildDesktopLocalImageUrl(workspaceRelativePath), fromBase64: false };
    }
    const proxied = buildWebLocalImageProxyUrl(workspaceRelativePath);
    return { dataUrl: proxied || workspaceRelativePath, fromBase64: false };
  }
  if (trimmed.startsWith("/") && Boolean(inferImageMimeTypeFromPath(trimmed))) {
    return { dataUrl: trimmed, fromBase64: false };
  }
  return { dataUrl: `data:${mimeType};base64,${trimmed}`, fromBase64: true };
}

function toChatMessage(raw: unknown, fallbackTimestamp?: number): ChatMessage | null {
  const toolMessage = isToolMessage(raw);
  if (toolMessage && !toolMessageMayContainImage(raw)) {
    return null;
  }
  const rawText = toolMessage ? "" : (extractText(raw) ?? "");
  let text = rawText;
  let mediaAttachments: Attachment[] = [];
  if (!toolMessage && rawText && MEDIA_PREFIX_RE.test(rawText)) {
    const mediaResult = extractMediaAttachmentsFromText(rawText);
    text = mediaResult.cleanedText;
    mediaAttachments = mediaResult.attachments;
  }
  const images = extractImages(raw);
  const imageAttachments: Attachment[] = images
    .map((img, index) => {
      const normalized = normalizeImageSourceData(img.data, img.mimeType);
      if (!normalized.dataUrl) {
        return null;
      }
      return {
        id: `${generateUUID()}-${index}`,
        name: `image-${index + 1}`,
        size: normalized.fromBase64 ? estimateBase64Bytes(img.data) : normalized.dataUrl.length,
        type: img.mimeType,
        dataUrl: normalized.dataUrl,
        isImage: true,
      } satisfies Attachment;
    })
    .filter((item): item is Attachment => Boolean(item));
  const dedupeSignatures = new Set<string>();
  const attachments = [...imageAttachments, ...mediaAttachments].filter((item) => {
    const signature = buildAttachmentSignature(item.type, item.dataUrl);
    if (dedupeSignatures.has(signature)) {
      return false;
    }
    dedupeSignatures.add(signature);
    return true;
  });
  if (toolMessage && attachments.length === 0) {
    return null;
  }
  const renderedText = toolMessage ? "" : text;
  if (!renderedText && attachments.length === 0) {
    return null;
  }
  const roleRaw = (raw as Record<string, unknown>)?.role;
  const timestampRaw = (raw as Record<string, unknown>)?.timestamp;
  const role = toolMessage
    ? "assistant"
    : roleRaw === "user"
      ? "user"
      : roleRaw === "assistant"
        ? "assistant"
        : "system";
  return {
    id: generateUUID(),
    role,
    text: renderedText,
    timestamp:
      typeof timestampRaw === "number" && Number.isFinite(timestampRaw)
        ? timestampRaw
        : fallbackTimestamp ?? Date.now(),
    attachments: attachments.length > 0 ? attachments : undefined,
    raw,
  };
}

function toChatMessageSafe(raw: unknown, fallbackTimestamp?: number): ChatMessage | null {
  try {
    return toChatMessage(raw, fallbackTimestamp);
  } catch {
    return null;
  }
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
  const [modelShortcutSchemes, setModelShortcutSchemes] = useState<ModelShortcutSchemeMap>(
    () => loadModelShortcutSchemes(),
  );
  const [agentSessionShortcutSchemes, setAgentSessionShortcutSchemes] =
    useState<AgentSessionShortcutSchemeMap>(() => loadAgentSessionShortcutSchemes());
  const [appActionShortcuts, setAppActionShortcuts] = useState<AppActionShortcutMap>(
    () => loadAppActionShortcuts(),
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
  const [deletingSessionKey, setDeletingSessionKey] = useState<string | null>(null);

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
  const gatewayMethodsRef = useRef<Set<string>>(new Set());
  const remoteImageDataCacheRef = useRef<Map<string, string>>(new Map());
  const sessionsRef = useRef<GatewaySessionRow[]>(sessions);
  const pendingStreamTextRef = useRef<string | null>(null);
  const streamFlushRafRef = useRef<number | null>(null);
  const pendingSessionCreatesRef = useRef<Set<string>>(new Set());
  const deferredSessionRefreshTimersRef = useRef<number[]>([]);
  const deletingSessionKeyRef = useRef<string | null>(null);

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

  useEffect(() => {
    sessionsRef.current = sessions;
  }, [sessions]);

  const clearDeferredSessionRefreshTimers = () => {
    for (const timer of deferredSessionRefreshTimersRef.current) {
      window.clearTimeout(timer);
    }
    deferredSessionRefreshTimersRef.current = [];
  };

  const flushPendingStreamText = useCallback(() => {
    streamFlushRafRef.current = null;
    const next = pendingStreamTextRef.current;
    pendingStreamTextRef.current = null;
    if (next === streamTextRef.current) {
      return;
    }
    streamTextRef.current = next;
    setStreamText(next);
  }, []);

  const setStreamTextSynced = useCallback((next: string | null) => {
    pendingStreamTextRef.current = null;
    if (streamFlushRafRef.current !== null) {
      window.cancelAnimationFrame(streamFlushRafRef.current);
      streamFlushRafRef.current = null;
    }
    if (next === streamTextRef.current) {
      return;
    }
    streamTextRef.current = next;
    setStreamText(next);
  }, []);

  const mergeStreamTextSynced = useCallback((incoming: string) => {
    const current = pendingStreamTextRef.current ?? streamTextRef.current;
    pendingStreamTextRef.current = mergeStreamingText(current, incoming);
    if (streamFlushRafRef.current !== null) {
      return;
    }
    streamFlushRafRef.current = window.requestAnimationFrame(() => {
      flushPendingStreamText();
    });
  }, [flushPendingStreamText]);

  const cacheRemoteImageDataUrl = (pathKey: string, dataUrl: string) => {
    const cache = remoteImageDataCacheRef.current;
    if (cache.has(pathKey)) {
      cache.delete(pathKey);
    }
    cache.set(pathKey, dataUrl);
    while (cache.size > REMOTE_IMAGE_CACHE_LIMIT) {
      const oldestKey = cache.keys().next().value;
      if (!oldestKey) {
        break;
      }
      cache.delete(oldestKey);
    }
  };

  const resolveRemoteImage = useCallback(async (filePath: string): Promise<string | null> => {
    const normalizedPath = filePath.trim();
    if (!normalizedPath) {
      return null;
    }
    const cached = remoteImageDataCacheRef.current.get(normalizedPath);
    if (cached) {
      cacheRemoteImageDataUrl(normalizedPath, cached);
      return cached;
    }
    const client = clientRef.current;
    if (!client || !connected) {
      return null;
    }
    const methods = pickRemoteImageReadMethods(gatewayMethodsRef.current);
    if (methods.length === 0) {
      return null;
    }

    const paramVariants: Record<string, unknown>[] = [
      { path: normalizedPath },
      { filePath: normalizedPath },
      { file_path: normalizedPath },
      { source: normalizedPath },
      { uri: normalizedPath },
      { path: normalizedPath, encoding: "base64" },
      { filePath: normalizedPath, encoding: "base64" },
      { path: normalizedPath, format: "base64" },
      { filePath: normalizedPath, format: "base64" },
      { path: normalizedPath, responseType: "base64" },
    ];

    const seenParamKeys = new Set<string>();
    for (const method of methods) {
      for (const params of paramVariants) {
        const dedupeKey = `${method}:${JSON.stringify(params)}`;
        if (seenParamKeys.has(dedupeKey)) {
          continue;
        }
        seenParamKeys.add(dedupeKey);
        try {
          const payload = await client.request(method, params);
          const dataUrl = extractImageDataUrlFromUnknown(payload, normalizedPath);
          if (!dataUrl) {
            continue;
          }
          cacheRemoteImageDataUrl(normalizedPath, dataUrl);
          return dataUrl;
        } catch {
          // try next method/params
        }
      }
    }
    const httpDataUrl = await resolveRemoteImageViaHttpProxy(gatewayUrl, normalizedPath);
    if (httpDataUrl) {
      cacheRemoteImageDataUrl(normalizedPath, httpDataUrl);
      return httpDataUrl;
    }
    return null;
  }, [connected, gatewayUrl]);

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

  const applySessionTokenStatsFromMessage = (
    rawMessage: unknown,
    sessionKeyHint?: string | null,
  ) => {
    const patch = extractSessionTokenStatsFromMessage(rawMessage);
    if (!patch) {
      return;
    }
    const activeSessionKey = selectedSessionRef.current;
    setSessions((prev) => {
      let didChange = false;
      const next = prev.map((session) => {
        const shouldPatch = sessionKeyHint
          ? sessionKeysMatch(session.key, sessionKeyHint)
          : activeSessionKey
            ? sessionKeysMatch(session.key, activeSessionKey)
            : false;
        if (!shouldPatch) {
          return session;
        }
        const mergedInputTokens = patch.inputTokens ?? toFiniteNumber(session.inputTokens);
        const mergedOutputTokens = patch.outputTokens ?? toFiniteNumber(session.outputTokens);
        const mergedTotalTokens =
          patch.totalTokens ??
          toFiniteNumber(session.totalTokens) ??
          (mergedInputTokens !== null && mergedOutputTokens !== null
            ? mergedInputTokens + mergedOutputTokens
            : undefined);
        const mergedContextTokens = patch.contextTokens ?? toFiniteNumber(session.contextTokens);
        const nextSession: GatewaySessionRow = {
          ...session,
          inputTokens: mergedInputTokens ?? undefined,
          outputTokens: mergedOutputTokens ?? undefined,
          totalTokens: mergedTotalTokens ?? undefined,
          contextTokens: mergedContextTokens ?? undefined,
          updatedAt: Date.now(),
        };
        if (
          nextSession.inputTokens === session.inputTokens &&
          nextSession.outputTokens === session.outputTokens &&
          nextSession.totalTokens === session.totalTokens &&
          nextSession.contextTokens === session.contextTokens
        ) {
          return session;
        }
        didChange = true;
        return nextSession;
      });
      return didChange ? next : prev;
    });
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
            refreshSessionsWithFollowUp(client);
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
          refreshSessionsWithFollowUp(client);
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
      clearDeferredSessionRefreshTimers();
      if (streamFlushRafRef.current !== null) {
        window.cancelAnimationFrame(streamFlushRafRef.current);
        streamFlushRafRef.current = null;
      }
      pendingStreamTextRef.current = null;
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

  const handleChangeAppActionShortcut = (
    id: AppActionShortcutId,
    shortcutRaw: AppActionShortcut,
  ) => {
    const combo = normalizeShortcutCombo(shortcutRaw.combo);
    if (!combo) {
      return;
    }
    const enabled = shortcutRaw.enabled === true;
    setAppActionShortcuts((prev) => {
      const current = prev[id];
      if (
        current.enabled === enabled &&
        shortcutComboSignature(current.combo) === shortcutComboSignature(combo)
      ) {
        return prev;
      }
      return {
        ...prev,
        [id]: {
          enabled,
          combo,
        },
      };
    });
  };

  const handleSaveModelShortcutScheme = (slotRaw: number) => {
    const slot = normalizeShortcutSlot(slotRaw);
    if (slot === null) {
      return;
    }
    const existing = modelShortcutSchemes[String(slot)];
    const model = currentShortcutModel.trim();
    if (!model) {
      pushSystemMessage("Cannot save model shortcut: active session has no model.");
      return;
    }
    const nextScheme: ModelShortcutScheme = {
      slot,
      combo: existing?.combo ?? getDefaultShortcutCombo(slot),
      model,
      thinkingLevel: currentShortcutThinkingLevel,
      updatedAt: Date.now(),
    };
    setModelShortcutSchemes((prev) =>
      normalizeModelShortcutSchemes({
        ...prev,
        [String(slot)]: nextScheme,
      })
    );
    pushSystemMessage(
      `saved ${resolveShortcutLabel(nextScheme.combo)} → ${model} · thinking ${nextScheme.thinkingLevel}`,
    );
  };

  const handleClearModelShortcutScheme = (slotRaw: number) => {
    const slot = normalizeShortcutSlot(slotRaw);
    if (slot === null) {
      return;
    }
    setModelShortcutSchemes((prev) => {
      if (!(String(slot) in prev)) {
        return prev;
      }
      const next = { ...prev };
      delete next[String(slot)];
      return next;
    });
  };

  const handleChangeModelShortcutSchemeCombo = (
    slotRaw: number,
    comboRaw: ShortcutCombo,
  ) => {
    const slot = normalizeShortcutSlot(slotRaw);
    const combo = normalizeShortcutCombo(comboRaw);
    if (slot === null || combo === null) {
      return;
    }
    const target = modelShortcutSchemes[String(slot)];
    if (!target || shortcutComboSignature(target.combo) === shortcutComboSignature(combo)) {
      return;
    }
    const occupiedEntry =
      Object.values(modelShortcutSchemes).find(
        (entry) =>
          entry &&
          entry.slot !== slot &&
          shortcutComboSignature(entry.combo) === shortcutComboSignature(combo),
      ) ?? null;
    setModelShortcutSchemes((prev) => {
      const target = prev[String(slot)];
      if (!target || shortcutComboSignature(target.combo) === shortcutComboSignature(combo)) {
        return prev;
      }
      const next = { ...prev };
      const occupiedEntry = Object.values(prev).find(
        (entry) =>
          entry &&
          entry.slot !== slot &&
          shortcutComboSignature(entry.combo) === shortcutComboSignature(combo),
      );
      if (occupiedEntry) {
        next[String(occupiedEntry.slot)] = {
          ...occupiedEntry,
          combo: target.combo,
          updatedAt: Date.now(),
        };
      }
      next[String(slot)] = {
        ...target,
        combo,
        updatedAt: Date.now(),
      };
      return normalizeModelShortcutSchemes(next);
    });
    if (occupiedEntry) {
      pushSystemMessage(
        `shortcut updated: slot ${slot} → ${resolveShortcutLabel(combo)} (swapped with slot ${occupiedEntry.slot})`,
      );
    } else {
      pushSystemMessage(
        `shortcut updated: slot ${slot} → ${resolveShortcutLabel(combo)}`,
      );
    }
  };

  const applyModelShortcutScheme = async (
    scheme: ModelShortcutScheme,
    source: "shortcut" | "manual",
  ) => {
    const client = clientRef.current;
    const key = selectedSessionRef.current;
    if (!client || !key) {
      return;
    }
    const thinking = normalizeThinkingValue(scheme.thinkingLevel);
    try {
      await client.request("sessions.patch", {
        key,
        model: scheme.model,
        thinkingLevel: thinking,
      });
      if (normalizeModelKey(scheme.model) === "default") {
        setSessionModelOverrides((prev) => clearOverride(prev, key));
      } else {
        setSessionModelOverrides((prev) => ({ ...prev, [key]: scheme.model }));
      }
      setSessionThinkingOverrides((prev) => ({ ...prev, [key]: thinking }));
      await refreshSessions(client);
      await loadModels(client);
      if (source === "shortcut") {
        pushSystemMessage(
          `switched by ${resolveShortcutLabel(scheme.combo)} → ${scheme.model} · thinking ${thinking}`,
        );
      }
    } catch (err) {
      pushSystemMessage(`Model shortcut failed: ${String(err)}`);
    }
  };

  const handleApplyModelShortcutScheme = async (
    slotRaw: number,
    source: "shortcut" | "manual" = "manual",
  ) => {
    const slot = normalizeShortcutSlot(slotRaw);
    if (slot === null) {
      return;
    }
    const scheme = modelShortcutSchemes[String(slot)];
    if (!scheme) {
      if (source === "manual") {
        pushSystemMessage(`No saved scheme in slot ${slot}.`);
      }
      return;
    }
    await applyModelShortcutScheme(scheme, source);
  };

  const handleSaveAgentSessionShortcutScheme = (slotRaw: number) => {
    const slot = normalizeAgentSessionShortcutSlot(slotRaw);
    if (slot === null) {
      return;
    }
    const existing = agentSessionShortcutSchemes[String(slot)];
    const agentId = currentShortcutAgentId.trim();
    if (!agentId) {
      pushSystemMessage("Cannot save agent session shortcut: no active agent.");
      return;
    }
    const nextScheme: AgentSessionShortcutScheme = {
      slot,
      combo:
        existing?.combo ?? {
          ...getDefaultAgentSessionShortcutCombo(slot),
          key: getDefaultAgentSessionShortcutKey(slot),
        },
      agentId,
      agentLabel: currentShortcutAgentLabel || agentId,
      updatedAt: Date.now(),
    };
    setAgentSessionShortcutSchemes((prev) =>
      normalizeAgentSessionShortcutSchemes({
        ...prev,
        [String(slot)]: nextScheme,
      }),
    );
    pushSystemMessage(
      `saved ${resolveShortcutLabel(nextScheme.combo)} → new session with ${nextScheme.agentLabel}`,
    );
  };

  const handleClearAgentSessionShortcutScheme = (slotRaw: number) => {
    const slot = normalizeAgentSessionShortcutSlot(slotRaw);
    if (slot === null) {
      return;
    }
    setAgentSessionShortcutSchemes((prev) => {
      if (!(String(slot) in prev)) {
        return prev;
      }
      const next = { ...prev };
      delete next[String(slot)];
      return next;
    });
  };

  const handleChangeAgentSessionShortcutSchemeCombo = (
    slotRaw: number,
    comboRaw: ShortcutCombo,
  ) => {
    const slot = normalizeAgentSessionShortcutSlot(slotRaw);
    const combo = normalizeShortcutCombo(comboRaw);
    if (slot === null || combo === null) {
      return;
    }
    const target = agentSessionShortcutSchemes[String(slot)];
    if (!target || shortcutComboSignature(target.combo) === shortcutComboSignature(combo)) {
      return;
    }
    const occupiedEntry =
      Object.values(agentSessionShortcutSchemes).find(
        (entry) =>
          entry &&
          entry.slot !== slot &&
          shortcutComboSignature(entry.combo) === shortcutComboSignature(combo),
      ) ?? null;
    setAgentSessionShortcutSchemes((prev) => {
      const target = prev[String(slot)];
      if (!target || shortcutComboSignature(target.combo) === shortcutComboSignature(combo)) {
        return prev;
      }
      const next = { ...prev };
      const occupiedEntry = Object.values(prev).find(
        (entry) =>
          entry &&
          entry.slot !== slot &&
          shortcutComboSignature(entry.combo) === shortcutComboSignature(combo),
      );
      if (occupiedEntry) {
        next[String(occupiedEntry.slot)] = {
          ...occupiedEntry,
          combo: target.combo,
          updatedAt: Date.now(),
        };
      }
      next[String(slot)] = {
        ...target,
        combo,
        updatedAt: Date.now(),
      };
      return normalizeAgentSessionShortcutSchemes(next);
    });
    if (occupiedEntry) {
      pushSystemMessage(
        `agent shortcut updated: slot ${slot} → ${resolveShortcutLabel(combo)} (swapped with slot ${occupiedEntry.slot})`,
      );
    } else {
      pushSystemMessage(`agent shortcut updated: slot ${slot} → ${resolveShortcutLabel(combo)}`);
    }
  };

  const handleApplyAgentSessionShortcutScheme = async (
    slotRaw: number,
    source: "shortcut" | "manual" = "manual",
  ) => {
    const slot = normalizeAgentSessionShortcutSlot(slotRaw);
    if (slot === null) {
      return;
    }
    const scheme = agentSessionShortcutSchemes[String(slot)];
    if (!scheme) {
      if (source === "manual") {
        pushSystemMessage(`No saved agent session shortcut in slot ${slot}.`);
      }
      return;
    }
    const key = await createSession("", true, scheme.agentId);
    if (source === "shortcut" && key) {
      pushSystemMessage(
        `created session ${key} via ${resolveShortcutLabel(scheme.combo)} (agent: ${scheme.agentLabel})`,
      );
    }
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
    if (uiSettings.enableAnimations) {
      document.documentElement.removeAttribute("data-animations-off");
    } else {
      document.documentElement.setAttribute("data-animations-off", "");
    }
    saveUiSettings(uiSettings);
  }, [uiSettings]);

  useEffect(() => {
    saveUiSettingsSchemes(uiSettingsSchemes);
  }, [uiSettingsSchemes]);

  useEffect(() => {
    saveModelShortcutSchemes(modelShortcutSchemes);
  }, [modelShortcutSchemes]);

  useEffect(() => {
    saveAgentSessionShortcutSchemes(agentSessionShortcutSchemes);
  }, [agentSessionShortcutSchemes]);

  useEffect(() => {
    saveAppActionShortcuts(appActionShortcuts);
  }, [appActionShortcuts]);

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
    const setGatewayUrl = window.desktopInfo?.setGatewayUrl;
    if (typeof setGatewayUrl !== "function") {
      return;
    }
    void setGatewayUrl(gatewayUrl).catch(() => {
      // ignore desktop bridge errors
    });
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
        gatewayMethodsRef.current = new Set(
          Array.isArray(hello.features?.methods)
            ? hello.features.methods.filter((item): item is string => typeof item === "string")
            : [],
        );
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
        gatewayMethodsRef.current.clear();
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
    if (pendingSessionCreatesRef.current.has(selectedSessionKey)) {
      return;
    }
    setCanLoadMoreHistory(historyCanLoadMoreBySessionRef.current[selectedSessionKey] ?? false);
    void loadHistory(client, selectedSessionKey, getHistoryLimit(selectedSessionKey));
  }, [connected, selectedSessionKey]);

  const currentSession = useMemo(() => {
    if (!selectedSessionKey) {
      return null;
    }
    return (
      sessions.find((session) => session.key === selectedSessionKey) ??
      sessions.find((session) => sessionKeysMatch(session.key, selectedSessionKey)) ??
      null
    );
  }, [sessions, selectedSessionKey]);

  const currentSessionAgent = useMemo(
    () => resolveAgentForSession(agents, selectedSessionKey ?? currentSession?.key),
    [agents, selectedSessionKey, currentSession?.key],
  );

  const defaultAgentChoice = useMemo(
    () => resolveAgentForSession(agents, null),
    [agents],
  );

  const newSessionAgentChoices = useMemo(() => {
    const listedAgents = agents?.agents ?? [];
    const next: AgentChoice[] = [];
    const seen = new Set<string>();
    for (const entry of listedAgents) {
      const normalizedId = normalizeAgentId(entry.id);
      if (!normalizedId) {
        continue;
      }
      if (seen.has(normalizedId)) {
        continue;
      }
      seen.add(normalizedId);
      next.push({
        id: normalizedId,
        label: resolveAgentChoiceLabel(entry),
      });
    }
    if (!seen.has(defaultAgentChoice.id)) {
      next.unshift(defaultAgentChoice);
    }
    return next;
  }, [agents, defaultAgentChoice]);

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
    const contextTokens = toFiniteNumber(currentSession?.contextTokens);
    const inputTokens = toFiniteNumber(currentSession?.inputTokens);
    const outputTokens = toFiniteNumber(currentSession?.outputTokens);
    const totalTokens =
      toFiniteNumber(currentSession?.totalTokens) ??
      (inputTokens !== null && outputTokens !== null ? inputTokens + outputTokens : null);
    const defaultContextTokens = toFiniteNumber(sessionDefaults?.contextTokens);
    return {
      agentId: currentSessionAgent.id,
      agentLabel: currentSessionAgent.label,
      modelLabel,
      modelId,
      contextLimit:
        overrideModelCatalog?.contextWindow ??
        contextTokens ??
        defaultContextTokens ??
        null,
      contextTokens,
      inputTokens,
      outputTokens,
      totalTokens,
      thinkingLevel: overrideThinking ?? currentSession?.thinkingLevel ?? thinkingLevel,
      responseUsage: currentSession?.responseUsage ?? null,
    };
  }, [
    currentSessionAgent.id,
    currentSessionAgent.label,
    currentSession,
    thinkingLevel,
    sessionDefaults,
    sessionModelOverrides,
    sessionThinkingOverrides,
    selectedSessionKey,
    models,
  ]);

  const currentShortcutModel = useMemo(
    () => resolveCanonicalModelFromCatalog(sessionInfo.modelId || sessionInfo.modelLabel || "", models),
    [sessionInfo.modelId, sessionInfo.modelLabel, models],
  );
  const currentShortcutThinkingLevel = useMemo(
    () => normalizeThinkingValue(sessionInfo.thinkingLevel),
    [sessionInfo.thinkingLevel],
  );

  const appActionShortcutEntries = useMemo(
    () => [
      {
        id: "toggleSidebar" as const,
        label: "Toggle Sidebar",
        enabled: appActionShortcuts.toggleSidebar.enabled,
        combo: appActionShortcuts.toggleSidebar.combo,
        shortcutLabel: resolveShortcutLabel(appActionShortcuts.toggleSidebar.combo),
      },
      {
        id: "newSession" as const,
        label: "New Session",
        enabled: appActionShortcuts.newSession.enabled,
        combo: appActionShortcuts.newSession.combo,
        shortcutLabel: resolveShortcutLabel(appActionShortcuts.newSession.combo),
      },
    ],
    [appActionShortcuts],
  );

  const modelShortcutSlots = useMemo(
    () =>
      Array.from({ length: MODEL_SHORTCUT_SLOT_MAX }, (_, index) => {
        const slot = index + MODEL_SHORTCUT_SLOT_MIN;
        const scheme = modelShortcutSchemes[String(slot)] ?? null;
        const combo = scheme?.combo ?? getDefaultShortcutCombo(slot);
        return {
          slot,
          combo,
          shortcutLabel: resolveShortcutLabel(combo),
          scheme,
        };
      }),
    [modelShortcutSchemes],
  );

  const currentShortcutAgentId = useMemo(
    () => currentSessionAgent.id,
    [currentSessionAgent.id],
  );
  const currentShortcutAgentLabel = useMemo(
    () => currentSessionAgent.label,
    [currentSessionAgent.label],
  );

  const agentSessionShortcutSlots = useMemo(
    () =>
      Array.from({ length: AGENT_SESSION_SHORTCUT_SLOT_MAX }, (_, index) => {
        const slot = index + AGENT_SESSION_SHORTCUT_SLOT_MIN;
        const scheme = agentSessionShortcutSchemes[String(slot)] ?? null;
        const combo = scheme?.combo ?? {
          ...getDefaultAgentSessionShortcutCombo(slot),
          key: getDefaultAgentSessionShortcutKey(slot),
        };
        return {
          slot,
          combo,
          shortcutLabel: resolveShortcutLabel(combo),
          scheme,
        };
      }),
    [agentSessionShortcutSchemes],
  );

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
        collectRuntimePathHintsFromConfig(configSnapshot);
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

  function refreshSessionsWithFollowUp(client: GatewayClient) {
    clearDeferredSessionRefreshTimers();
    const delaysMs = [260, 1100];
    deferredSessionRefreshTimersRef.current = delaysMs.map((delayMs) =>
      window.setTimeout(() => {
        if (clientRef.current !== client) {
          return;
        }
        void refreshSessions(client);
      }, delayMs)
    );
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
      const isActiveSession = selectedSessionRef.current === key;
      if (isActiveSession) {
        setCanLoadMoreHistory(canLoadMore);
      }
      if (!isActiveSession) {
        return;
      }
      setThinkingLevel(res.thinkingLevel ?? null);
      const historyMessages: ChatMessage[] = [];
      const seenContentKeys = new Set<string>();
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
          const parsed = toChatMessageSafe(raw, inferredTs);
          if (parsed) {
            // Deduplicate messages with identical role + text + similar timestamp
            const tsKey = Math.floor(parsed.timestamp / 2000); // 2s window
            const contentKey = `${parsed.role}:${tsKey}:${parsed.text.slice(0, 200)}`;
            if (!seenContentKeys.has(contentKey)) {
              seenContentKeys.add(contentKey);
              historyMessages.push(parsed);
            }
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
      if (selectedSessionRef.current !== key) {
        return;
      }
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
      applySessionTokenStatsFromMessage(parsed.message, parsed.sessionKey);
      applySessionTokenStatsFromMessage(payload, parsed.sessionKey);
      const isToolFinal = isToolMessage(parsed.message);
      const streamedText = (streamTextRef.current ?? "").trim();
      let msg = toChatMessageSafe(parsed.message);
      if (!isToolFinal && msg && msg.role !== "user" && !msg.text.trim() && streamedText) {
        msg = { ...msg, text: streamedText };
      }
      if (!isToolFinal && (!msg || !msg.text.trim()) && streamedText) {
        msg = {
          id: generateUUID(),
          role: "assistant",
          text: streamedText,
          timestamp: Date.now(),
          raw: parsed.message,
        };
      }
      const hasRenderableAttachment = Boolean(msg?.attachments && msg.attachments.length > 0);
      const hasRenderableText = Boolean(msg?.text.trim());
      if (msg && (hasRenderableText || hasRenderableAttachment)) {
        if (!hasRenderableText || !shouldSkipAssistantFinal(parsed.runId, msg.text)) {
          setMessages((prev) => [...prev, msg]);
          notifyReplyCompleted();
        }
      }
      setStreamTextSynced(null);
      setChatRunId(null);
      setThinking(false);
      const client = clientRef.current;
      if (client) {
        refreshSessionsWithFollowUp(client);
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

  function resolveTargetAgentId(preferredAgentId?: string | null): string {
    const preferred = preferredAgentId?.trim();
    if (preferred) {
      return resolveAgentIdWithFallback(preferred);
    }
    if (agents?.defaultId) {
      return resolveAgentIdWithFallback(agents.defaultId);
    }
    const current = selectedSessionRef.current;
    if (current?.startsWith("agent:")) {
      const parts = current.split(":");
      if (parts.length > 1 && parts[1]) {
        return resolveAgentIdWithFallback(parts[1]);
      }
    }
    return "main";
  }

  async function createSession(
    labelInput: string,
    closeModal: boolean,
    preferredAgentId?: string | null,
  ): Promise<string | null> {
    const client = clientRef.current;
    if (!client) {
      return null;
    }
    const label = resolveSessionLabel(labelInput);
    const slug = label ? (slugify(label) || "chat") : "chat";
    const agentId = resolveTargetAgentId(preferredAgentId);
    const key = `agent:${agentId}:ui:${slug}-${generateUUID().slice(0, 8)}`;
    const primarySessionKey = resolvePrimarySessionKey(agents, lastConfigSnapshotRef.current);
    const previousSelectedKey = selectedSessionRef.current;
    pendingSessionCreatesRef.current.add(key);
    setSessions((prev) => {
      const nextSession: GatewaySessionRow = {
        key,
        kind: "direct",
        label: label || undefined,
        derivedTitle: label || undefined,
        lastMessagePreview: "",
        updatedAt: Date.now(),
      };
      const withoutDuplicate = prev.filter((session) => session.key !== key);
      const primaryIndex = withoutDuplicate.findIndex(
        (session) => session.key.toLowerCase() === primarySessionKey,
      );
      if (primaryIndex < 0) {
        return [nextSession, ...withoutDuplicate];
      }
      const next = [...withoutDuplicate];
      next.splice(primaryIndex + 1, 0, nextSession);
      return next;
    });
    setSelectedSessionKey(key);
    setMessages([]);
    setToolItems([]);
    setStreamTextSynced(null);
    setChatRunId(null);
    setThinking(false);
    setThinkingLevel(null);
    setHistoryLimit(key, CHAT_HISTORY_INITIAL_LIMIT);
    historyCanLoadMoreBySessionRef.current = {
      ...historyCanLoadMoreBySessionRef.current,
      [key]: false,
    };
    setCanLoadMoreHistory(false);
    try {
      await client.request("sessions.patch", { key, ...(label ? { label } : {}) });
      if (closeModal) {
        setShowNewSession(false);
      }
      pendingSessionCreatesRef.current.delete(key);
      if (selectedSessionRef.current === key) {
        setCanLoadMoreHistory(historyCanLoadMoreBySessionRef.current[key] ?? false);
        void loadHistory(client, key, getHistoryLimit(key));
      }
      void refreshSessions(client);
      return key;
    } catch (err) {
      pendingSessionCreatesRef.current.delete(key);
      setSessions((prev) => prev.filter((session) => session.key !== key));
      setSelectedSessionKey((prev) => (prev === key ? previousSelectedKey : prev));
      const nextHistoryCanLoadMore = { ...historyCanLoadMoreBySessionRef.current };
      delete nextHistoryCanLoadMore[key];
      historyCanLoadMoreBySessionRef.current = nextHistoryCanLoadMore;
      const nextHistoryLimit = { ...historyLimitBySessionRef.current };
      delete nextHistoryLimit[key];
      historyLimitBySessionRef.current = nextHistoryLimit;
      if (previousSelectedKey) {
        setCanLoadMoreHistory(historyCanLoadMoreBySessionRef.current[previousSelectedKey] ?? false);
        void loadHistory(client, previousSelectedKey, getHistoryLimit(previousSelectedKey));
      }
      pushSystemMessage(`Create failed: ${String(err)}`);
      return null;
    }
  }

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.defaultPrevented) {
        return;
      }
      const matchedModelScheme = Object.values(modelShortcutSchemes).find(
        (entry) => entry && isShortcutComboEventMatch(entry.combo, event),
      );
      if (matchedModelScheme) {
        event.preventDefault();
        void applyModelShortcutScheme(matchedModelScheme, "shortcut");
        return;
      }
      const matchedAgentScheme = Object.values(agentSessionShortcutSchemes).find(
        (entry) => entry && isShortcutComboEventMatch(entry.combo, event),
      );
      if (matchedAgentScheme) {
        event.preventDefault();
        void handleApplyAgentSessionShortcutScheme(matchedAgentScheme.slot, "shortcut");
        return;
      }
      const toggleSidebarShortcut = appActionShortcuts.toggleSidebar;
      if (toggleSidebarShortcut.enabled && isShortcutComboEventMatch(toggleSidebarShortcut.combo, event)) {
        event.preventDefault();
        setSidebarCollapsed((prev) => !prev);
        return;
      }
      const newSessionShortcut = appActionShortcuts.newSession;
      if (newSessionShortcut.enabled && isShortcutComboEventMatch(newSessionShortcut.combo, event)) {
        event.preventDefault();
        void createSession("", false);
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [agents, connected, modelShortcutSchemes, agentSessionShortcutSchemes, appActionShortcuts]);

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
    const currentInputTokens = toFiniteNumber(currentSession?.inputTokens);
    const currentOutputTokens = toFiniteNumber(currentSession?.outputTokens);
    const currentTotalTokens =
      toFiniteNumber(currentSession?.totalTokens) ??
      (currentInputTokens !== null && currentOutputTokens !== null
        ? currentInputTokens + currentOutputTokens
        : null);
    const currentContextTokens = toFiniteNumber(currentSession?.contextTokens);
    const defaultContextTokens = defaults ? getNumberLike(defaults, ["contextTokens", "context_tokens"]) : null;

    const inputTokens =
      (statusSession ? getNumberLike(statusSession, ["inputTokens", "input_tokens"]) : null) ??
      currentInputTokens ??
      sessionInfo.inputTokens ??
      null;
    const outputTokens =
      (statusSession ? getNumberLike(statusSession, ["outputTokens", "output_tokens"]) : null) ??
      currentOutputTokens ??
      sessionInfo.outputTokens ??
      null;
    const contextUsed =
      (statusSession ? getNumberLike(statusSession, ["totalTokens", "total_tokens"]) : null) ??
      currentTotalTokens ??
      currentInputTokens ??
      sessionInfo.totalTokens ??
      sessionInfo.inputTokens ??
      null;
    const contextLimit =
      (statusSession ? getNumberLike(statusSession, ["contextTokens", "context_tokens"]) : null) ??
      currentContextTokens ??
      sessionInfo.contextLimit ??
      defaultContextTokens ??
      null;
    const contextPercent =
      Number.isFinite(contextUsed) && Number.isFinite(contextLimit) && (contextLimit as number) > 0
        ? Math.max(
          0,
          Math.min(999, Math.round(((contextUsed as number) / (contextLimit as number)) * 100)),
        )
        : null;
    const compactions =
      statusSession ? getNumberLike(statusSession, ["compactionCount", "compaction_count"]) ?? 0 : 0;
    const sessionKeyForLine =
      (statusSession ? getString(statusSession, ["key"]) : null) ??
      activeKey ??
      currentSession?.key ??
      "unknown";
    const updatedAt =
      (statusSession ? getNumberLike(statusSession, ["updatedAt", "updated_at"]) : null) ??
      toFiniteNumber(currentSession?.updatedAt) ??
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
      `🧮 Tokens: ${Number.isFinite(inputTokens) ? formatCompactTokens(inputTokens) : "?"
      } in / ${Number.isFinite(outputTokens) ? formatCompactTokens(outputTokens) : "?"} out`,
      `📚 Context: ${Number.isFinite(contextUsed) ? formatCompactTokens(contextUsed) : "?"
      }/${Number.isFinite(contextLimit) ? formatCompactTokens(contextLimit) : "?"}${contextPercent !== null ? ` (${contextPercent}%)` : ""
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
            type: "image" as const,
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
          collectRuntimePathHintsFromConfig(configSnapshot);
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
          const normalizedArgs = args.trim();
          const commandText = normalizedArgs ? `/compact ${normalizedArgs}` : "/compact";
          const runId = generateUUID();
          chatRunRef.current = runId;
          setChatRunId(runId);
          setThinking(true);
          setStreamTextSynced("");
          pushSystemMessage("running /compact...");
          const sendRes = (await client.request("chat.send", {
            sessionKey: selectedSessionKey,
            message: commandText,
            deliver: false,
            idempotencyKey: runId,
          })) as { runId?: unknown };
          const ackRunId =
            typeof sendRes?.runId === "string" && sendRes.runId.trim()
              ? sendRes.runId.trim()
              : null;
          if (ackRunId && ackRunId !== chatRunRef.current) {
            chatRunRef.current = ackRunId;
            setChatRunId(ackRunId);
          }
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

  async function handleCreateSession(label: string, agentId?: string | null) {
    await createSession(label, true, agentId);
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
    if (deletingSessionKeyRef.current) {
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
    deletingSessionKeyRef.current = key;
    setDeletingSessionKey(key);
    const sessionsBeforeDelete = sessionsRef.current;
    const wasSelected = selectedSessionRef.current === key;
    const nextSelectedKey = wasSelected
      ? sessionsBeforeDelete.find((session) => session.key !== key)?.key ?? null
      : selectedSessionRef.current;
    const previousHistoryCanLoadMore = { ...historyCanLoadMoreBySessionRef.current };
    const previousHistoryLimit = { ...historyLimitBySessionRef.current };
    const nextHistoryCanLoadMore = { ...historyCanLoadMoreBySessionRef.current };
    delete nextHistoryCanLoadMore[key];
    historyCanLoadMoreBySessionRef.current = nextHistoryCanLoadMore;
    const nextHistoryLimit = { ...historyLimitBySessionRef.current };
    delete nextHistoryLimit[key];
    historyLimitBySessionRef.current = nextHistoryLimit;
    setSessions((prev) => prev.filter((session) => session.key !== key));
    setSessionModelOverrides((prev) => clearOverride(prev, key));
    setSessionThinkingOverrides((prev) => clearOverride(prev, key));
    if (wasSelected) {
      setSelectedSessionKey(nextSelectedKey);
      if (!nextSelectedKey) {
        setMessages([]);
        setToolItems([]);
        setStreamTextSynced(null);
        setChatRunId(null);
        setThinking(false);
        setCanLoadMoreHistory(false);
      }
    }
    try {
      await client.request("sessions.delete", { key });
      refreshSessionsWithFollowUp(client);
    } catch (err) {
      historyCanLoadMoreBySessionRef.current = previousHistoryCanLoadMore;
      historyLimitBySessionRef.current = previousHistoryLimit;
      setSessions(sessionsBeforeDelete);
      if (wasSelected) {
        setSelectedSessionKey(key);
      }
      pushSystemMessage(`Delete failed: ${String(err)}`);
    } finally {
      deletingSessionKeyRef.current = null;
      setDeletingSessionKey((previousKey) => (previousKey === key ? null : previousKey));
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
        deletingKey={deletingSessionKey}
        enableAnimations={uiSettings.enableAnimations}
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
          onResolveRemoteImage={resolveRemoteImage}
          onCompact={() => void handleSlashCommand("/compact")}
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
        appActionShortcuts={appActionShortcutEntries}
        onChangeAppActionShortcut={handleChangeAppActionShortcut}
        modelShortcutSchemes={modelShortcutSlots}
        currentModelForShortcut={currentShortcutModel}
        currentThinkingForShortcut={currentShortcutThinkingLevel}
        onSaveModelShortcutScheme={handleSaveModelShortcutScheme}
        onApplyModelShortcutScheme={(slot) => void handleApplyModelShortcutScheme(slot, "manual")}
        onChangeModelShortcutSchemeCombo={handleChangeModelShortcutSchemeCombo}
        onDeleteModelShortcutScheme={handleClearModelShortcutScheme}
        onPreviewReplyDoneSound={previewReplyDoneSound}
        agentSessionShortcutSchemes={agentSessionShortcutSlots}
        currentAgentIdForShortcut={currentShortcutAgentId}
        currentAgentLabelForShortcut={currentShortcutAgentLabel}
        onSaveAgentSessionShortcutScheme={handleSaveAgentSessionShortcutScheme}
        onApplyAgentSessionShortcutScheme={(slot) =>
          void handleApplyAgentSessionShortcutScheme(slot, "manual")
        }
        onChangeAgentSessionShortcutSchemeCombo={handleChangeAgentSessionShortcutSchemeCombo}
        onDeleteAgentSessionShortcutScheme={handleClearAgentSessionShortcutScheme}
      />

      <NewSessionModal
        open={showNewSession}
        onClose={() => setShowNewSession(false)}
        onCreate={handleCreateSession}
        agentOptions={newSessionAgentChoices}
        defaultAgentId={defaultAgentChoice.id}
        defaultAgentLabel={defaultAgentChoice.label}
      />
    </div>
  );
}
