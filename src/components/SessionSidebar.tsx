import React, { useEffect, useMemo, useRef, useState } from "react";
import type { GatewaySessionRow } from "../lib/types.ts";
import { formatTime } from "../lib/format.ts";

export type SessionSidebarProps = {
  sessions: GatewaySessionRow[];
  selectedKey: string | null;
  collapsed: boolean;
  sidebarWidth: number;
  deletingKey?: string | null;
  onToggleCollapse: () => void;
  onSelect: (key: string) => void;
  onCreate: () => void;
  onDelete: (key: string, opts?: { skipConfirm?: boolean }) => void;
  hasMore?: boolean;
  onReachEnd?: () => void;
};

export default function SessionSidebar(props: SessionSidebarProps) {
  const [query, setQuery] = useState("");
  const requestingMoreRef = useRef(false);

  const filtered = useMemo(() => {
    if (!query.trim()) {
      return props.sessions;
    }
    const needle = query.toLowerCase();
    return props.sessions.filter((session) => {
      const label = session.label ?? "";
      const title = session.derivedTitle ?? "";
      const preview = session.lastMessagePreview ?? "";
      return (
        label.toLowerCase().includes(needle) ||
        title.toLowerCase().includes(needle) ||
        preview.toLowerCase().includes(needle)
      );
    });
  }, [props.sessions, query]);

  useEffect(() => {
    requestingMoreRef.current = false;
  }, [props.sessions.length, query]);

  const onScroll: React.UIEventHandler<HTMLDivElement> = (event) => {
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
      className={`sidebar-shell ${props.collapsed ? "is-collapsed" : ""}`}
      style={{
        width: props.collapsed ? "84px" : `${props.sidebarWidth}px`,
      }}
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
            New
          </button>
          <button
            type="button"
            onClick={props.onToggleCollapse}
            className="ui-btn ui-btn-light"
            title="Toggle sidebar"
          >
            {props.collapsed ? ">" : "<"}
          </button>
        </div>
      </div>

      {!props.collapsed && (
        <div className="sidebar-search-wrap">
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search sessions"
            className="ui-input"
            aria-label="Search sessions"
          />
        </div>
      )}

      <div className="sidebar-list" onScroll={onScroll}>
        {filtered.length === 0 && !props.collapsed && (
          <div className="sidebar-empty">No sessions found.</div>
        )}
        {filtered.map((session) => {
          const isActive = props.selectedKey === session.key;
          const isDeleting = props.deletingKey === session.key;
          const hasPendingDelete = Boolean(props.deletingKey);
          const title = session.label ?? session.derivedTitle ?? session.key;
          const preview = session.lastMessagePreview ?? "";
          return (
            <article
              key={session.key}
              className={`session-card ${isActive ? "is-active" : ""}`}
            >
              <div className="session-main-row">
                <button
                  type="button"
                  onClick={() => props.onSelect(session.key)}
                  className="session-main"
                >
                  <span className={`session-dot ${isActive ? "is-active" : ""}`} />
                  {!props.collapsed && (
                    <span className="session-copy">
                      <span className="session-title" style={{ fontSize: "calc(var(--claw-sidebar-font-size) + 1px)" }}>
                        {title}
                      </span>
                      {preview && (
                        <span
                          className="session-preview"
                          style={{ fontSize: "calc(var(--claw-sidebar-font-size) - 2px)" }}
                        >
                          {preview}
                        </span>
                      )}
                      <span
                        className="session-time"
                        style={{ fontSize: "calc(var(--claw-sidebar-font-size) - 3px)" }}
                      >
                        {formatTime(session.updatedAt)}
                      </span>
                    </span>
                  )}
                </button>

                {!props.collapsed && (
                  <button
                    type="button"
                    onClick={(event) => props.onDelete(session.key, { skipConfirm: event.metaKey })}
                    className="session-delete"
                    disabled={hasPendingDelete}
                    title={isDeleting ? "Deleting session..." : "Delete session"}
                    aria-label={`Delete session ${title}`}
                  >
                    {isDeleting ? "..." : "-"}
                  </button>
                )}
              </div>
            </article>
          );
        })}

        {!props.collapsed && props.hasMore && (
          <div className="sidebar-more">Scroll for more sessions...</div>
        )}
      </div>
    </aside>
  );
}
