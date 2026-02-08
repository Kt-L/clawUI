import React, { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import type { Attachment, ChatMessage, ToolItem } from "../lib/types.ts";
import { renderMarkdown } from "../lib/markdown.ts";
import { formatBytes, formatCompactTokens, truncate } from "../lib/format.ts";
import { BASE_COMMANDS, type SlashCommand } from "../lib/slash-commands.ts";
import type { UiSettings } from "../lib/ui-settings.ts";

export type SessionInfo = {
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
};

const MESSAGE_RENDER_STEP = 60;
const AUTO_SCROLL_BOTTOM_THRESHOLD = 10;

function attachmentLabel(att: Attachment): string {
  return `${att.name} (${formatBytes(att.size)})`;
}

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

export default function ChatView(props: ChatViewProps) {
  const [activeCommand, setActiveCommand] = useState(0);
  const [toolExpanded, setToolExpanded] = useState<Record<string, boolean>>({});
  const [modelMenuOpen, setModelMenuOpen] = useState(false);
  const [thinkingMenuOpen, setThinkingMenuOpen] = useState(false);
  const [visibleMessageCount, setVisibleMessageCount] = useState(MESSAGE_RENDER_STEP);
  const [autoScrollEnabled, setAutoScrollEnabled] = useState(true);
  const isComposingRef = useRef(false);
  const modelMenuRef = useRef<HTMLDivElement | null>(null);
  const thinkingMenuRef = useRef<HTMLDivElement | null>(null);
  const scrollRef = useRef<HTMLDivElement | null>(null);
  const composerTextareaRef = useRef<HTMLTextAreaElement | null>(null);
  const restoreScrollRef = useRef<{ height: number; top: number } | null>(null);
  const olderLoadRequestedRef = useRef(false);
  const prevSessionKeyRef = useRef<string | null>(props.sessionKey);

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

  useEffect(() => {
    if (prevSessionKeyRef.current === props.sessionKey) {
      return;
    }
    prevSessionKeyRef.current = props.sessionKey;
    setToolExpanded({});
    setVisibleMessageCount(MESSAGE_RENDER_STEP);
    setAutoScrollEnabled(true);
    setModelMenuOpen(false);
    setThinkingMenuOpen(false);
    const container = scrollRef.current;
    if (!container) {
      return;
    }
    container.scrollTop = container.scrollHeight;
  }, [props.sessionKey]);

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

  const formatMessageTime = useCallback((timestamp: number) => formatLocalDateTime(timestamp), []);

  const formatMessageTimeTitle = useCallback((timestamp: number) => formatLocalDateTime(timestamp), []);

  const formatMessageDateTime = useCallback((timestamp: number) => {
    const normalized = normalizeMessageTimestamp(timestamp);
    return new Date(normalized).toISOString();
  }, []);

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
          props.onSend();
          return;
        }
        applySuggestion(commandSuggestions[activeCommand]!);
        return;
      }
      if (showSlashMenu && exactCommand && !requiresArgs) {
        props.onSend();
        return;
      }
      if (showSlashMenu && requiresArgs && !commandArgs) {
        return;
      }
      props.onSend();
    }
  };

  const renderMessage = (msg: ChatMessage) => {
    const isUser = msg.role === "user";
    const isSystem = msg.role === "system";
    const roleLabel = isSystem ? "System" : isUser ? "You" : "Assistant";
    if (isSystem) {
      return (
        <div key={msg.id} className="message-row system">
          <article
            className="message-bubble system"
            style={{
              fontSize: "var(--claw-font-size)",
              lineHeight: "var(--claw-line-height)",
            }}
          >
            <div className="message-role">{roleLabel}</div>
            <div className="message-body plain-text">{msg.text}</div>
            {props.uiSettings.showMessageTimestamp && (
              <div className="message-meta">
                <time
                  className="message-time"
                  dateTime={formatMessageDateTime(msg.timestamp)}
                  title={formatMessageTimeTitle(msg.timestamp)}
                  style={{ fontSize: `${props.uiSettings.messageTimestampFontSize}px` }}
                >
                  {formatMessageTime(msg.timestamp)}
                </time>
              </div>
            )}
          </article>
        </div>
      );
    }

    return (
      <div key={msg.id} className={`message-row ${isUser ? "user" : "assistant"}`}>
        <article className={`message-bubble ${isUser ? "user" : "assistant"}`}>
          <div className="message-role">{roleLabel}</div>
          {msg.text && (
            <div
              className="markdown"
              dangerouslySetInnerHTML={{ __html: renderMarkdown(msg.text) }}
            />
          )}
          {msg.attachments && msg.attachments.length > 0 && (
            <div className="attachments-wrap">{msg.attachments.map((att) => renderAttachment(att))}</div>
          )}
          {props.uiSettings.showMessageTimestamp && (
            <div className="message-meta">
              <time
                className="message-time"
                dateTime={formatMessageDateTime(msg.timestamp)}
                title={formatMessageTimeTitle(msg.timestamp)}
                style={{ fontSize: `${props.uiSettings.messageTimestampFontSize}px` }}
              >
                {formatMessageTime(msg.timestamp)}
              </time>
            </div>
          )}
        </article>
      </div>
    );
  };

  const renderToolPanel = (tools: ToolItem[], key: string) => {
    if (tools.length === 0) {
      return null;
    }
    return (
      <section key={key} className="tool-panel">
        <div className="tool-panel-header">
          <div className="tool-panel-title" style={{ fontSize: toolMinorFontSize }}>
            Tool Activity ({tools.length})
          </div>
        </div>

        <div className="tool-grid">
          {tools.map((tool) => {
            const expanded = toolExpanded[tool.id] ?? false;
            const statusLabel = tool.status === "result" ? "done" : "running";
            const outputPreview = (tool.output ?? "").replace(/\s+/g, " ").trim();
            const argsPreview = JSON.stringify(tool.args ?? {}).replace(/\s+/g, " ").trim().slice(0, 120);
            const summary = (outputPreview || argsPreview).slice(0, 120);
            return (
              <article key={tool.id} className="tool-entry" style={{ fontSize: toolFontSize }}>
                <button
                  type="button"
                  onClick={() => setToolExpanded((prev) => ({ ...prev, [tool.id]: !expanded }))}
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

  return (
    <section className="claw-chat-area chat-shell">
      <header className="chat-header">
        <div className="chat-header-main">
          <div className="chat-brand-title">ClawUI</div>
          <div className="topbar-status">
            <span className={`status-dot ${props.connected ? "connected" : "disconnected"}`} />
            <span>{props.connected ? "Gateway connected" : "Gateway disconnected"}</span>
          </div>
        </div>

        <div className="chat-header-actions">
          <div className="relative" ref={modelMenuRef}>
            <button
              type="button"
              onClick={() => setModelMenuOpen((prev) => !prev)}
              className="ui-btn ui-btn-light"
              style={{
                fontSize: modelBadgeFontSize,
                padding: `${modelBadgePaddingY} ${modelBadgePaddingX}`,
              }}
            >
              Model: {props.sessionInfo.modelLabel || "-"}
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
        <div className="chat-thread" style={{ maxWidth: "var(--claw-content-width)", gap: "var(--claw-message-gap)" }}>
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
              {renderMessage(msg)}
              {props.uiSettings.showToolActivity &&
                renderToolPanel(toolTimeline.byMessageId.get(msg.id) ?? [], `tool-after-${msg.id}`)}
            </React.Fragment>
          ))}

          {props.streamText && (
            <div className="message-row assistant">
              <article className="message-bubble assistant stream-bubble">
                <div className="message-role">Assistant</div>
                <div
                  className="markdown"
                  dangerouslySetInnerHTML={{ __html: renderMarkdown(props.streamText) }}
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
        <div className="composer-inner">
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
            <div className="attachment-chip-list">
              {props.attachments.map((att) => (
                <div key={att.id} className="attachment-chip">
                  <span>{attachmentLabel(att)}</span>
                  <button
                    type="button"
                    onClick={() =>
                      props.onAttachmentsChange(props.attachments.filter((item) => item.id !== att.id))
                    }
                    className="attachment-chip-remove"
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
                onClick={props.onSend}
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

              <div className="relative" ref={thinkingMenuRef}>
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
    </section>
  );
}
