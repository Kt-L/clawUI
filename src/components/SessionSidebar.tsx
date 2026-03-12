import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { GatewaySessionRow, SessionPreviewItem } from "../lib/types.ts";
import { formatTime } from "../lib/format.ts";
import { sanitizeUserText } from "../lib/message-extract.ts";
import { useCardTilt } from "../hooks/useCardTilt.ts";

const CONTENT_SNIPPET_LEAD = 20;
const CONTENT_SNIPPET_TAIL = 30;

type SessionSidebarResult = {
  session: GatewaySessionRow;
  contentSnippet: string | null;
};

export type SessionSidebarProps = {
  sessions: GatewaySessionRow[];
  selectedKey: string | null;
  sessionActivity: Record<string, { working: boolean; unread: boolean }>;
  collapsed: boolean;
  sidebarWidth: number;
  deletingKeys: Set<string>;
  enableAnimations: boolean;
  autoHover: boolean;
  hasMore?: boolean;
  sessionPreviews: Record<string, SessionPreviewItem[]>;
  allSessionRows: Record<string, GatewaySessionRow>;
  onToggleCollapse: () => void;
  onSetCollapsed: (collapsed: boolean) => void;
  onSelect: (key: string) => void;
  onCreate: () => void;
  onDelete: (key: string, opts?: { skipConfirm?: boolean }) => void;
  onReachEnd?: () => void;
  onSearchGateway: (query: string) => Promise<GatewaySessionRow[]>;
  onOpenFiles: () => void;
};

/** Split query into lowercase needles (space = AND). */
function parseNeedles(query: string): string[] {
  return query.toLowerCase().split(/\s+/).filter((s) => s.length > 0);
}

function isPreviewMatch(session: GatewaySessionRow, needles: string[]): boolean {
  const haystack = [
    session.label ?? "",
    sanitizeUserText(session.derivedTitle ?? ""),
    sanitizeUserText(session.lastMessagePreview ?? ""),
  ].join(" ").toLowerCase();
  return needles.every((n) => haystack.includes(n));
}

function buildContentSnippet(text: string, needles: string[]): string {
  const compact = text.replace(/\s+/g, " ").trim();
  if (!compact) {
    return "";
  }
  const compactLower = compact.toLowerCase();
  // Find the first needle that appears, build snippet around it
  let bestIndex = -1;
  let bestNeedle = needles[0] ?? "";
  for (const n of needles) {
    const idx = compactLower.indexOf(n);
    if (idx >= 0 && (bestIndex < 0 || idx < bestIndex)) {
      bestIndex = idx;
      bestNeedle = n;
    }
  }
  if (bestIndex < 0) {
    const end = Math.min(compact.length, CONTENT_SNIPPET_LEAD + CONTENT_SNIPPET_TAIL);
    return `${compact.slice(0, end).trim()}${end < compact.length ? "..." : ""}`;
  }
  const start = Math.max(0, bestIndex - CONTENT_SNIPPET_LEAD);
  const end = Math.min(compact.length, bestIndex + bestNeedle.length + CONTENT_SNIPPET_TAIL);
  const body = compact.slice(start, end).trim();
  return `${start > 0 ? "..." : ""}${body}${end < compact.length ? "..." : ""}`;
}

function findContentSnippet(items: SessionPreviewItem[] | undefined, needles: string[]): string | null {
  if (!Array.isArray(items) || items.length === 0 || needles.length === 0) {
    return null;
  }
  // Concatenate all preview text for AND matching
  const allText = items
    .map((item) => (typeof item?.text === "string" ? item.text : ""))
    .join(" ");
  const allLower = allText.toLowerCase();
  if (!needles.every((n) => allLower.includes(n))) {
    return null;
  }
  // Find the first item containing any needle for the snippet
  for (const item of items) {
    const text = typeof item?.text === "string" ? item.text : "";
    if (!text.trim()) continue;
    const lower = text.toLowerCase();
    if (needles.some((n) => lower.includes(n))) {
      return buildContentSnippet(text, needles);
    }
  }
  return buildContentSnippet(allText, needles);
}

function findContentMatches(
  previews: Record<string, SessionPreviewItem[]>,
  needles: string[],
): Record<string, string> {
  if (needles.length === 0) {
    return {};
  }
  const matches: Record<string, string> = {};
  for (const [key, items] of Object.entries(previews)) {
    const snippet = findContentSnippet(items, needles);
    if (snippet) {
      matches[key] = snippet;
    }
  }
  return matches;
}

function highlightMatch(text: string, rawQuery: string): React.ReactNode {
  if (!text) {
    return text;
  }
  const needles = parseNeedles(rawQuery);
  if (needles.length === 0) {
    return text;
  }
  // Build a regex that matches any of the needles (case-insensitive)
  const escaped = needles.map((n) => n.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"));
  const regex = new RegExp(`(${escaped.join("|")})`, "gi");
  const parts = text.split(regex);
  if (parts.length <= 1) {
    return text;
  }
  const needleSet = new Set(needles);
  return (
    <>
      {parts.map((part, i) =>
        needleSet.has(part.toLowerCase()) ? (
          <span key={i} className="session-search-highlight">{part}</span>
        ) : (
          <React.Fragment key={i}>{part}</React.Fragment>
        ),
      )}
    </>
  );
}

export default function SessionSidebar(props: SessionSidebarProps) {
  const [query, setQuery] = useState("");
  const [committedQuery, setCommittedQuery] = useState("");
  const [gatewayMatches, setGatewayMatches] = useState<GatewaySessionRow[]>([]);
  const [contentMatchesByKey, setContentMatchesByKey] = useState<Record<string, string>>({});
  const [searchingGateway, setSearchingGateway] = useState(false);
  const requestingMoreRef = useRef(false);
  const searchRequestIdRef = useRef(0);
  const { onMouseMove: tiltMove, onMouseLeave: tiltLeave } = useCardTilt();
  const hoverCollapseTimerRef = useRef<number | null>(null);

  const committedNeedles = useMemo(() => parseNeedles(committedQuery), [committedQuery]);
  const hasCommittedSearch = committedNeedles.length > 0;

  const clearHoverTimer = useCallback(() => {
    if (hoverCollapseTimerRef.current !== null) {
      window.clearTimeout(hoverCollapseTimerRef.current);
      hoverCollapseTimerRef.current = null;
    }
  }, []);

  const handleSidebarMouseEnter = useCallback(() => {
    if (!props.autoHover) return;
    clearHoverTimer();
    props.onSetCollapsed(false);
  }, [props.autoHover, props.onSetCollapsed, clearHoverTimer]);

  const handleSidebarMouseLeave = useCallback(() => {
    if (!props.autoHover) return;
    clearHoverTimer();
    hoverCollapseTimerRef.current = window.setTimeout(() => {
      hoverCollapseTimerRef.current = null;
      props.onSetCollapsed(true);
    }, 100);
  }, [props.autoHover, props.onSetCollapsed, clearHoverTimer]);

  useEffect(() => {
    return () => {
      clearHoverTimer();
    };
  }, [clearHoverTimer]);

  const executeSearch = useCallback((searchQuery: string) => {
    const trimmed = searchQuery.trim();
    setCommittedQuery(trimmed);
    const needles = parseNeedles(trimmed);

    if (needles.length === 0) {
      setGatewayMatches([]);
      setContentMatchesByKey({});
      setSearchingGateway(false);
      return;
    }

    // L3: content search (instant, from cached previews)
    setContentMatchesByKey(findContentMatches(props.sessionPreviews, needles));

    // L2: gateway search (async) — send first needle to gateway, AND filter client-side
    searchRequestIdRef.current += 1;
    const requestId = searchRequestIdRef.current;
    setSearchingGateway(true);
    void props.onSearchGateway(needles[0])
      .then((results) => {
        if (searchRequestIdRef.current !== requestId) return;
        // Client-side AND filter for multi-keyword
        const filtered = needles.length > 1
          ? (Array.isArray(results) ? results : []).filter((s) => isPreviewMatch(s, needles))
          : (Array.isArray(results) ? results : []);
        setGatewayMatches(filtered);
      })
      .catch(() => {
        if (searchRequestIdRef.current !== requestId) return;
        setGatewayMatches([]);
      })
      .finally(() => {
        if (searchRequestIdRef.current !== requestId) return;
        setSearchingGateway(false);
      });
  }, [props.onSearchGateway, props.sessionPreviews]);

  const handleSearchKeyDown = useCallback((e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Enter") {
      e.preventDefault();
      executeSearch(query);
    }
  }, [query, executeSearch]);

  const handleClearSearch = useCallback(() => {
    setQuery("");
    setCommittedQuery("");
    setGatewayMatches([]);
    setContentMatchesByKey({});
    setSearchingGateway(false);
    searchRequestIdRef.current += 1;
  }, []);

  /** Trigger side-based flip from the clicked half (left/right). */
  const flipCard = useCallback((el: HTMLElement, clientX: number) => {
    const rect = el.getBoundingClientRect();
    const normX = (clientX - rect.left) / rect.width; // 0..1
    const fromRight = normX > 0.5;

    // Reset tilt so flip starts from a physically stable baseline.
    el.style.setProperty("--tilt-x", "0deg");
    el.style.setProperty("--tilt-y", "0deg");
    el.style.setProperty("--lift", "0px");

    el.classList.remove("is-flipping", "flip-from-left", "flip-from-right");
    void el.offsetWidth; // force reflow
    el.classList.add("is-flipping", fromRight ? "flip-from-right" : "flip-from-left");

    el.addEventListener("animationend", () => {
      el.classList.remove("is-flipping", "flip-from-left", "flip-from-right");
    }, { once: true });
  }, []);

  const localMatches = useMemo(() => {
    if (!hasCommittedSearch) {
      return props.sessions;
    }
    return props.sessions.filter((session) => isPreviewMatch(session, committedNeedles));
  }, [props.sessions, committedNeedles, hasCommittedSearch]);

  const mergedResults = useMemo(() => {
    if (!hasCommittedSearch) {
      return props.sessions.map((session) => ({ session, contentSnippet: null }));
    }

    // Build a lookup that includes ALL sessions (not just the loaded 80)
    const sessionsByKey = new Map<string, GatewaySessionRow>();
    for (const [key, row] of Object.entries(props.allSessionRows)) {
      sessionsByKey.set(key, row);
    }
    for (const session of props.sessions) {
      sessionsByKey.set(session.key, session);
    }
    for (const session of gatewayMatches) {
      sessionsByKey.set(session.key, session);
    }

    const byKey = new Map<string, SessionSidebarResult>();
    const upsert = (session: GatewaySessionRow, snippet?: string | null) => {
      const existing = byKey.get(session.key);
      if (!existing) {
        byKey.set(session.key, {
          session,
          contentSnippet: snippet ?? null,
        });
        return;
      }
      if ((session.updatedAt ?? 0) > (existing.session.updatedAt ?? 0)) {
        existing.session = session;
      }
      if (!existing.contentSnippet && snippet) {
        existing.contentSnippet = snippet;
      }
    };

    for (const session of localMatches) {
      upsert(session);
    }
    for (const session of gatewayMatches) {
      upsert(session);
    }
    for (const [key, snippet] of Object.entries(contentMatchesByKey)) {
      const session = sessionsByKey.get(key);
      if (session) {
        upsert(session, snippet);
      }
    }

    return Array.from(byKey.values()).sort((a, b) => {
      return (b.session.updatedAt ?? 0) - (a.session.updatedAt ?? 0);
    });
  }, [contentMatchesByKey, gatewayMatches, localMatches, props.allSessionRows, props.sessions, hasCommittedSearch]);

  useEffect(() => {
    requestingMoreRef.current = false;
  }, [props.sessions.length, committedQuery]);

  const onScroll: React.UIEventHandler<HTMLDivElement> = (event) => {
    if (hasCommittedSearch) {
      return;
    }
    if (!props.hasMore || !props.onReachEnd) {
      return;
    }
    const target = event.currentTarget;
    const nearBottom = target.scrollTop + target.clientHeight >= target.scrollHeight - 120;
    if (!nearBottom || requestingMoreRef.current) {
      return;
    }
    requestingMoreRef.current = true;
    props.onReachEnd();
  };

  return (
    <aside
      className={`sidebar-shell ${props.collapsed ? "is-collapsed" : ""}${props.autoHover ? " auto-hover" : ""}`}
      style={{
        width: props.collapsed ? "84px" : `${props.sidebarWidth}px`,
      }}
      onMouseEnter={handleSidebarMouseEnter}
      onMouseLeave={handleSidebarMouseLeave}
    >
      <div className="sidebar-top">
        {!props.collapsed && (
          <div className="sidebar-title-wrap">
            <div className="sidebar-title">Sessions</div>
            <div className="sidebar-subtitle">{props.sessions.length} total</div>
          </div>
        )}
        <div className="sidebar-actions">
          <button
            type="button"
            onClick={props.onCreate}
            className="ui-btn ui-btn-light"
            title="New session"
          >
            <span aria-hidden="true" style={{ fontSize: "14px", lineHeight: 1 }}>+</span>
            {!props.collapsed && " New"}
          </button>
          <button
            type="button"
            onClick={props.onOpenFiles}
            className="ui-btn ui-btn-light"
            title="File manager"
          >
            {props.collapsed ? "📁" : "📁 Files"}
          </button>
          {!props.autoHover && (
            <button
              type="button"
              onClick={props.onToggleCollapse}
              className="ui-btn ui-btn-light"
              title="Toggle sidebar"
            >
              {props.collapsed ? "\u203A" : "\u2039"}
            </button>
          )}
        </div>
      </div>

      {!props.collapsed && (
        <div className="sidebar-search-wrap">
          <div className="sidebar-search-input-row">
            <input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              onKeyDown={handleSearchKeyDown}
              placeholder="Search sessions..."
              className="ui-input sidebar-search-input"
              aria-label="Search sessions"
            />
            {query.length > 0 && (
              <button
                type="button"
                onClick={handleClearSearch}
                className="sidebar-search-clear"
                aria-label="Clear search"
                title="Clear search"
              >
                &times;
              </button>
            )}
          </div>
          {hasCommittedSearch && searchingGateway && (
            <div className="sidebar-search-loading" role="status" aria-live="polite">
              <span className="sidebar-search-spinner" aria-hidden="true" />
              Searching...
            </div>
          )}
        </div>
      )}

      <div className="sidebar-list" onScroll={onScroll}>
        {mergedResults.length === 0 && !props.collapsed && (
          <div className="sidebar-empty">{hasCommittedSearch ? "No matching sessions" : "No sessions yet"}</div>
        )}
        {mergedResults.map((result) => {
          const session = result.session;
          const isActive = props.selectedKey === session.key;
          const isDeleting = props.deletingKeys.has(session.key);
          const activity = props.sessionActivity[session.key];
          const rawTitle = session.label || session.derivedTitle || session.key;
          const title = rawTitle ? sanitizeUserText(rawTitle) || rawTitle : session.key;
          const preview = session.lastMessagePreview ? sanitizeUserText(session.lastMessagePreview) : "";
          const contentSnippet = result.contentSnippet;
          return (
            <article
              key={session.key}
              className={`session-card${isActive ? " is-active" : activity?.unread ? " is-unread" : activity?.working ? " is-working" : ""}`}
              onMouseMove={props.enableAnimations ? (e) => tiltMove(session.key, e) : undefined}
              onMouseLeave={props.enableAnimations ? (e) => tiltLeave(session.key, e) : undefined}
              onClick={(e) => {
                // Don't trigger if clicking the delete button
                if ((e.target as HTMLElement).closest(".session-delete")) return;
                const cardEl = e.currentTarget;
                const clickX = e.clientX;
                props.onSelect(session.key);
                if (props.enableAnimations) {
                  requestAnimationFrame(() => {
                    flipCard(cardEl, clickX);
                  });
                }
              }}
              style={{ cursor: "pointer" }}
            >
              <div className="session-main-row">
                <div className="session-main">
                  <span className={`session-dot${isActive ? " is-active" : activity?.unread ? " is-unread" : activity?.working ? " is-working" : ""}`} />
                  {!props.collapsed && (
                    <span className="session-copy">
                      <span className="session-title" style={{ fontSize: "calc(var(--claw-sidebar-font-size) + 1px)" }}>
                        {highlightMatch(title, committedQuery)}
                      </span>
                      {contentSnippet ? (
                        <span
                          className="session-content-snippet"
                          style={{ fontSize: "calc(var(--claw-sidebar-font-size) - 2px)" }}
                        >
                          {highlightMatch(contentSnippet, committedQuery)}
                        </span>
                      ) : preview ? (
                        <span
                          className="session-preview"
                          style={{ fontSize: "calc(var(--claw-sidebar-font-size) - 2px)" }}
                        >
                          {highlightMatch(preview, committedQuery)}
                        </span>
                      ) : null}
                      <span
                        className="session-time"
                        style={{ fontSize: "calc(var(--claw-sidebar-font-size) - 3px)" }}
                      >
                        {formatTime(session.updatedAt)}
                      </span>
                    </span>
                  )}
                </div>

                {!props.collapsed && (
                  <button
                    type="button"
                    onClick={(event) => props.onDelete(session.key, { skipConfirm: event.metaKey })}
                    className={`session-delete${isDeleting ? " is-deleting-spin" : ""}`}
                    disabled={isDeleting}
                    title={isDeleting ? "Deleting session..." : "Delete session"}
                    aria-label={`Delete session ${title}`}
                  >
                    {isDeleting ? "" : "\u00D7"}
                  </button>
                )}
              </div>
            </article>
          );
        })}

        {!props.collapsed && !hasCommittedSearch && props.hasMore && (
          <div className="sidebar-more">Scroll for more sessions...</div>
        )}
      </div>
    </aside>
  );
}
