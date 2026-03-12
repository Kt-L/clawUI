import React, { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";
import { renderMarkdown } from "../lib/markdown.ts";
import { useCardTilt } from "../hooks/useCardTilt.ts";

/* ── Types ────────────────────────────────────────────────────────── */

type FsRoot = { label: string; path: string };

type FsEntry = {
  name: string;
  path: string;
  isDirectory: boolean;
  size: number;
  mtime: number;
  mime: string | null;
};

type SortKey = "name" | "size" | "mtime";
type SortDir = "asc" | "desc";

/* ── Helpers ──────────────────────────────────────────────────────── */

function getFsApiBase(): string {
  if (window.desktopInfo?.isDesktop) {
    try {
      const serverUrl = localStorage.getItem("clawui.fs.serverUrl")?.trim();
      if (serverUrl) return `${serverUrl.replace(/\/+$/, "")}/__claw/fs`;
    } catch {}
    return "claw-fs://fs";
  }
  return "/__claw/fs";
}

async function fetchJson<T>(url: string, init?: RequestInit): Promise<T> {
  const res = await fetch(url, init);
  if (!res.ok) {
    const body = await res.text();
    throw new Error(`${res.status}: ${body}`);
  }
  return res.json();
}

function formatSize(bytes: number): string {
  if (bytes === 0) return "—";
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
  return `${(bytes / 1024 / 1024 / 1024).toFixed(2)} GB`;
}

function formatDate(ms: number): string {
  if (!ms) return "—";
  const d = new Date(ms);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

function formatRelativeDate(ms: number): string {
  if (!ms) return "";
  const diff = Date.now() - ms;
  if (diff < 60_000) return "just now";
  if (diff < 3_600_000) return `${Math.floor(diff / 60_000)}m ago`;
  if (diff < 86_400_000) return `${Math.floor(diff / 3_600_000)}h ago`;
  if (diff < 604_800_000) return `${Math.floor(diff / 86_400_000)}d ago`;
  return formatDate(ms);
}

function getFileIcon(entry: FsEntry): string {
  if (entry.isDirectory) return "📁";
  const ext = entry.name.split(".").pop()?.toLowerCase() ?? "";
  const iconMap: Record<string, string> = {
    md: "📝", markdown: "📝", txt: "📄", log: "📄",
    json: "📋", jsonl: "📋", yaml: "📋", yml: "📋", toml: "📋",
    xml: "📋", csv: "📊", tsv: "📊",
    js: "🟨", mjs: "🟨", cjs: "🟨", ts: "🔷", tsx: "🔷", jsx: "🟨",
    py: "🐍", rs: "🦀", go: "🔵", java: "☕", c: "⚙️", cpp: "⚙️",
    h: "⚙️", hpp: "⚙️", css: "🎨", html: "🌐", htm: "🌐",
    sh: "⬛", bash: "⬛", zsh: "⬛",
    png: "🖼️", jpg: "🖼️", jpeg: "🖼️", webp: "🖼️", gif: "🖼️",
    bmp: "🖼️", svg: "🖼️", ico: "🖼️",
    pdf: "📕",
    zip: "📦", tar: "📦", gz: "📦", "7z": "📦",
    sql: "🗃️", r: "📐",
  };
  return iconMap[ext] ?? "📄";
}

function isPreviewableText(mime: string | null): boolean {
  if (!mime) return false;
  return (
    mime.startsWith("text/") ||
    mime.startsWith("application/json") ||
    mime.startsWith("application/x-ndjson") ||
    mime.startsWith("application/xml")
  );
}

function isPreviewableImage(mime: string | null): boolean {
  if (!mime) return false;
  return mime.startsWith("image/");
}

function isPreviewablePdf(mime: string | null): boolean {
  return mime === "application/pdf";
}

function isPreviewable(mime: string | null): boolean {
  return isPreviewableText(mime) || isPreviewableImage(mime) || isPreviewablePdf(mime);
}

function isEditableText(mime: string | null): boolean {
  return isPreviewableText(mime);
}

function isMarkdown(name: string): boolean {
  const ext = name.split(".").pop()?.toLowerCase() ?? "";
  return ext === "md" || ext === "markdown";
}

function parentPath(p: string): string | null {
  const parent = p.replace(/\/[^/]+\/?$/, "");
  return parent && parent !== p ? parent : null;
}

function getFileDescription(entry: FsEntry): string {
  if (entry.isDirectory) return "Folder";
  const ext = entry.name.split(".").pop()?.toLowerCase() ?? "";
  const descMap: Record<string, string> = {
    md: "Markdown", txt: "Text", json: "JSON", yaml: "YAML", yml: "YAML",
    ts: "TypeScript", tsx: "TypeScript React", js: "JavaScript", jsx: "JavaScript React",
    py: "Python", rs: "Rust", go: "Go", css: "Stylesheet", html: "HTML",
    sh: "Shell Script", pdf: "PDF Document", png: "Image", jpg: "Image", jpeg: "Image",
    webp: "Image", gif: "Image", svg: "SVG", zip: "Archive", csv: "Spreadsheet",
  };
  return descMap[ext] ?? ext.toUpperCase();
}

/* ── Shared state context ─────────────────────────────────────────── */

type FmState = {
  roots: FsRoot[];
  activeRoot: FsRoot | null;
  currentPath: string;
  entries: FsEntry[];
  sortedEntries: FsEntry[];
  loading: boolean;
  error: string | null;
  showHidden: boolean;
  sortKey: SortKey;
  sortDir: SortDir;
  previewEntry: FsEntry | null;
  previewContent: string | null;
  previewLoading: boolean;
  editing: boolean;
  editContent: string;
  editDirty: boolean;
  saving: boolean;
  uploading: boolean;
  breadcrumbs: { label: string; path: string }[];

  selectRoot: (root: FsRoot) => void;
  navigateTo: (entry: FsEntry) => void;
  navigateUp: () => void;
  openPreview: (entry: FsEntry) => void;
  closePreview: () => void;
  handleSort: (key: SortKey) => void;
  toggleHidden: () => void;
  loadDir: (path: string) => Promise<void>;
  handleNewFolder: () => void;
  uploadFiles: (files: FileList | File[]) => void;
  handleDownload: (entry: FsEntry) => void;
  setError: (err: string | null) => void;
  startEditing: () => void;
  cancelEditing: () => void;
  setEditContent: (text: string) => void;
  saveFile: () => Promise<void>;
};

const FmContext = createContext<FmState | null>(null);

function useFmState(): FmState {
  const ctx = useContext(FmContext);
  if (!ctx) throw new Error("useFmState must be inside FmProvider");
  return ctx;
}

/* ── Provider ─────────────────────────────────────────────────────── */

function FmProvider(props: { children: React.ReactNode }) {
  const [roots, setRoots] = useState<FsRoot[]>([]);
  const [activeRoot, setActiveRoot] = useState<FsRoot | null>(null);
  const [currentPath, setCurrentPath] = useState<string>("");
  const [entries, setEntries] = useState<FsEntry[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [showHidden, setShowHidden] = useState(false);
  const [sortKey, setSortKey] = useState<SortKey>("name");
  const [sortDir, setSortDir] = useState<SortDir>("asc");
  const [previewEntry, setPreviewEntry] = useState<FsEntry | null>(null);
  const [previewContent, setPreviewContent] = useState<string | null>(null);
  const [previewLoading, setPreviewLoading] = useState(false);
  const [editing, setEditing] = useState(false);
  const [editContent, setEditContent] = useState("");
  const [editDirty, setEditDirty] = useState(false);
  const [saving, setSaving] = useState(false);
  const [uploading, setUploading] = useState(false);

  // Load roots
  useEffect(() => {
    fetchJson<{ roots: FsRoot[] }>(`${getFsApiBase()}/roots`)
      .then(({ roots: r }) => {
        setRoots(r);
        if (r.length > 0) {
          setActiveRoot(r[0]);
          setCurrentPath(r[0].path);
        }
      })
      .catch((e) => setError(String(e)));
  }, []);

  // Load directory
  const loadDir = useCallback(async (dirPath: string) => {
    setLoading(true);
    setError(null);
    try {
      const endpoint = showHidden ? "list-all" : "list";
      const params = new URLSearchParams({ path: dirPath });
      if (showHidden) params.set("showHidden", "true");
      const data = await fetchJson<{ path: string; items: FsEntry[] }>(
        `${getFsApiBase()}/${endpoint}?${params}`,
      );
      setEntries(data.items);
      setCurrentPath(data.path);
    } catch (e) {
      setError(String(e));
    } finally {
      setLoading(false);
    }
  }, [showHidden]);

  useEffect(() => {
    if (currentPath) void loadDir(currentPath);
  }, [currentPath, loadDir]);

  // Sort
  const sortedEntries = useMemo(() => {
    const sorted = [...entries].sort((a, b) => {
      if (a.isDirectory !== b.isDirectory) return a.isDirectory ? -1 : 1;
      let cmp = 0;
      switch (sortKey) {
        case "name": cmp = a.name.localeCompare(b.name, undefined, { sensitivity: "base" }); break;
        case "size": cmp = a.size - b.size; break;
        case "mtime": cmp = a.mtime - b.mtime; break;
      }
      return sortDir === "asc" ? cmp : -cmp;
    });
    return sorted;
  }, [entries, sortKey, sortDir]);

  function handleSort(key: SortKey) {
    if (sortKey === key) setSortDir((d) => (d === "asc" ? "desc" : "asc"));
    else { setSortKey(key); setSortDir("asc"); }
  }

  function navigateTo(entry: FsEntry) {
    if (entry.isDirectory) {
      setCurrentPath(entry.path);
      setPreviewEntry(null); setPreviewContent(null); setEditing(false);
    }
  }

  function navigateUp() {
    const parent = parentPath(currentPath);
    if (parent && roots.some(r => parent === r.path || parent.startsWith(r.path + "/"))) {
      setCurrentPath(parent);
      setPreviewEntry(null); setPreviewContent(null); setEditing(false);
    }
  }

  function selectRoot(root: FsRoot) {
    setActiveRoot(root);
    setCurrentPath(root.path);
    setPreviewEntry(null); setPreviewContent(null); setEditing(false);
  }

  async function openPreview(entry: FsEntry) {
    setPreviewEntry(entry);
    setPreviewContent(null);
    setEditing(false);
    setEditDirty(false);
    if (isPreviewableText(entry.mime)) {
      setPreviewLoading(true);
      try {
        const res = await fetch(`${getFsApiBase()}/read?path=${encodeURIComponent(entry.path)}`);
        const text = await res.text();
        setPreviewContent(text);
      } catch (e) {
        setPreviewContent(`Error loading file: ${e}`);
      } finally {
        setPreviewLoading(false);
      }
    }
  }

  function closePreview() {
    setPreviewEntry(null); setPreviewContent(null); setEditing(false); setEditDirty(false);
  }

  function startEditing() {
    if (previewContent !== null) {
      setEditContent(previewContent);
      setEditing(true);
      setEditDirty(false);
    }
  }

  function cancelEditing() {
    setEditing(false);
    setEditDirty(false);
  }

  function handleSetEditContent(text: string) {
    setEditContent(text);
    setEditDirty(true);
  }

  async function saveFile() {
    if (!previewEntry) return;
    setSaving(true);
    try {
      const res = await fetch(`${getFsApiBase()}/write?path=${encodeURIComponent(previewEntry.path)}`, {
        method: "PUT",
        headers: { "Content-Type": "text/plain; charset=utf-8" },
        body: editContent,
      });
      if (!res.ok) {
        const body = await res.text();
        throw new Error(`${res.status}: ${body}`);
      }
      setPreviewContent(editContent);
      setEditing(false);
      setEditDirty(false);
      // Refresh directory to update size/mtime
      void loadDir(currentPath);
    } catch (e) {
      setError(`Save failed: ${e}`);
    } finally {
      setSaving(false);
    }
  }

  async function handleNewFolder() {
    const name = prompt("New folder name:");
    if (!name?.trim()) return;
    try {
      await fetch(`${getFsApiBase()}/mkdir?path=${encodeURIComponent(currentPath + "/" + name.trim())}`, { method: "POST" });
      void loadDir(currentPath);
    } catch (e) { setError(String(e)); }
  }

  function handleDownload(entry: FsEntry) {
    const url = `${getFsApiBase()}/read?path=${encodeURIComponent(entry.path)}`;
    const a = document.createElement("a");
    a.href = url; a.download = entry.name; a.click();
  }

  async function uploadFilesAsync(files: FileList | File[]) {
    if (!currentPath || files.length === 0) return;
    setUploading(true);
    try {
      const formData = new FormData();
      for (const file of Array.from(files)) formData.append("files", file, file.name);
      await fetch(`${getFsApiBase()}/upload?path=${encodeURIComponent(currentPath)}`, { method: "POST", body: formData });
      void loadDir(currentPath);
    } catch (e) { setError(`Upload failed: ${e}`); }
    finally { setUploading(false); }
  }

  // Breadcrumbs
  const breadcrumbs = useMemo(() => {
    if (!currentPath || !activeRoot) return [];
    const rootPath = activeRoot.path;
    const relative = currentPath.startsWith(rootPath) ? currentPath.slice(rootPath.length) : "";
    const parts = relative.split("/").filter(Boolean);
    const crumbs: { label: string; path: string }[] = [{ label: activeRoot.label, path: rootPath }];
    let acc = rootPath;
    for (const part of parts) { acc = acc + "/" + part; crumbs.push({ label: part, path: acc }); }
    return crumbs;
  }, [currentPath, activeRoot]);

  const value: FmState = {
    roots, activeRoot, currentPath, entries, sortedEntries, loading, error,
    showHidden, sortKey, sortDir, previewEntry, previewContent, previewLoading,
    editing, editContent, editDirty, saving, uploading, breadcrumbs,
    selectRoot, navigateTo, navigateUp, openPreview, closePreview,
    handleSort, toggleHidden: () => setShowHidden(h => !h),
    loadDir, handleNewFolder,
    uploadFiles: (files) => void uploadFilesAsync(files),
    handleDownload, setError,
    startEditing, cancelEditing, setEditContent: handleSetEditContent, saveFile,
  };

  return <FmContext.Provider value={value}>{props.children}</FmContext.Provider>;
}

/* ── File Sidebar ─────────────────────────────────────────────────── */

function FileSidebar(props: {
  collapsed: boolean;
  sidebarWidth: number;
  enableAnimations: boolean;
  autoHover: boolean;
  onToggleCollapse: () => void;
  onSetCollapsed: (v: boolean) => void;
  onSwitchToChat: () => void;
  onOpenSettings: () => void;
}) {
  const fm = useFmState();
  const { onMouseMove, onMouseLeave } = useCardTilt();
  const hoverTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const handleSidebarMouseEnter = useCallback(() => {
    if (!props.autoHover || !props.collapsed) return;
    hoverTimerRef.current = setTimeout(() => props.onSetCollapsed(false), 260);
  }, [props.autoHover, props.collapsed, props.onSetCollapsed]);

  const handleSidebarMouseLeave = useCallback(() => {
    if (!props.autoHover) return;
    if (hoverTimerRef.current) { clearTimeout(hoverTimerRef.current); hoverTimerRef.current = null; }
    if (!props.collapsed) props.onSetCollapsed(true);
  }, [props.autoHover, props.collapsed, props.onSetCollapsed]);

  const canGoUp = (() => {
    const parent = parentPath(fm.currentPath);
    if (!parent) return false;
    return fm.roots.some(r => parent === r.path || parent.startsWith(r.path + "/"));
  })();

  function sortIndicator(key: SortKey): string {
    if (fm.sortKey !== key) return "";
    return fm.sortDir === "asc" ? " ↑" : " ↓";
  }

  return (
    <aside
      className={`sidebar-shell fm-sidebar${props.collapsed ? " is-collapsed" : ""}${props.autoHover ? " auto-hover" : ""}`}
      style={{ width: props.collapsed ? "84px" : `${props.sidebarWidth}px` }}
      onMouseEnter={handleSidebarMouseEnter}
      onMouseLeave={handleSidebarMouseLeave}
    >
      <input
        ref={fileInputRef}
        type="file"
        multiple
        style={{ display: "none" }}
        onChange={(e) => { if (e.target.files) fm.uploadFiles(e.target.files); e.target.value = ""; }}
      />

      {/* Top bar */}
      <div className="sidebar-top">
        {!props.collapsed && (
          <div className="sidebar-title-wrap">
            <div className="sidebar-title">Files</div>
            <div className="sidebar-subtitle">{fm.sortedEntries.length} items</div>
          </div>
        )}
        <div className="sidebar-actions">
          <button type="button" onClick={props.onSwitchToChat} className="ui-btn ui-btn-light" title="Back to chat">
            {props.collapsed ? "💬" : "💬 Chat"}
          </button>
          {!props.autoHover && (
            <button type="button" onClick={props.onToggleCollapse} className="ui-btn ui-btn-light" title="Toggle sidebar">
              {props.collapsed ? "\u203A" : "\u2039"}
            </button>
          )}
        </div>
      </div>

      {/* Root tabs */}
      {!props.collapsed && (
        <div className="fm-sidebar-roots">
          {fm.roots.map((root, i) => (
            <button
              key={i}
              type="button"
              className={`fm-root-pill${fm.activeRoot?.path === root.path ? " active" : ""}`}
              onClick={() => fm.selectRoot(root)}
            >
              {root.label}
            </button>
          ))}
        </div>
      )}

      {/* Breadcrumb + actions */}
      {!props.collapsed && (
        <div className="fm-sidebar-nav">
          <div className="fm-sidebar-breadcrumb">
            {fm.breadcrumbs.map((crumb, i) => (
              <React.Fragment key={i}>
                {i > 0 && <span className="fm-bc-sep">/</span>}
                <button
                  type="button"
                  className={`fm-bc-item${i === fm.breadcrumbs.length - 1 ? " active" : ""}`}
                  onClick={() => { if (crumb.path !== fm.currentPath) { fm.closePreview(); void fm.loadDir(crumb.path); } }}
                >
                  {crumb.label}
                </button>
              </React.Fragment>
            ))}
          </div>
          <div className="fm-sidebar-toolbar">
            <button type="button" className="fm-sidebar-tool" onClick={fm.navigateUp} disabled={!canGoUp} title="Go up">↑</button>
            <button type="button" className="fm-sidebar-tool" onClick={() => void fm.loadDir(fm.currentPath)} title="Refresh">↻</button>
            <button type="button" className="fm-sidebar-tool" onClick={fm.handleNewFolder} title="New folder">+📁</button>
            <button type="button" className="fm-sidebar-tool" onClick={() => fileInputRef.current?.click()} disabled={fm.uploading} title="Upload">↑📄</button>
            <label className="fm-sidebar-tool fm-hidden-toggle" title="Show hidden">
              <input type="checkbox" checked={fm.showHidden} onChange={fm.toggleHidden} />
              <span>·</span>
            </label>
          </div>
        </div>
      )}

      {/* Sort header */}
      {!props.collapsed && (
        <div className="fm-sort-bar">
          <button type="button" className="fm-sort-btn fm-sort-name" onClick={() => fm.handleSort("name")}>
            Name{sortIndicator("name")}
          </button>
          <button type="button" className="fm-sort-btn fm-sort-size" onClick={() => fm.handleSort("size")}>
            Size{sortIndicator("size")}
          </button>
          <button type="button" className="fm-sort-btn fm-sort-date" onClick={() => fm.handleSort("mtime")}>
            Date{sortIndicator("mtime")}
          </button>
        </div>
      )}

      {/* File list */}
      <div className="sidebar-list">
        {fm.loading && fm.sortedEntries.length === 0 && <div className="sidebar-empty">Loading...</div>}
        {!fm.loading && fm.sortedEntries.length === 0 && <div className="sidebar-empty">Empty directory</div>}
        {fm.sortedEntries.map((entry) => {
          const isActive = fm.previewEntry?.path === entry.path;
          return (
            <article
              key={entry.path}
              className={`session-card fm-file-card${isActive ? " is-active" : ""}`}
              onClick={() => entry.isDirectory ? fm.navigateTo(entry) : void fm.openPreview(entry)}
              onDoubleClick={() => fm.navigateTo(entry)}
              onMouseMove={(e) => props.enableAnimations && onMouseMove(entry.path, e)}
              onMouseLeave={(e) => props.enableAnimations && onMouseLeave(entry.path, e)}
              style={{
                transform: "perspective(700px) rotateX(var(--tilt-x, 0deg)) rotateY(var(--tilt-y, 0deg)) translateZ(var(--lift, 0px))",
                transformStyle: "preserve-3d",
              }}
            >
              <div className="fm-card-row">
                <span className="fm-card-icon">{getFileIcon(entry)}</span>
                <div className="fm-card-info">
                  <div className="fm-card-name">{entry.name}</div>
                  {!props.collapsed && (
                    <div className="fm-card-meta">
                      <span>{getFileDescription(entry)}</span>
                      {!entry.isDirectory && <><span>·</span><span>{formatSize(entry.size)}</span></>}
                      <span>·</span>
                      <span>{formatRelativeDate(entry.mtime)}</span>
                    </div>
                  )}
                </div>
              </div>
              <div
                className="fm-card-glow"
                style={{
                  background: `radial-gradient(circle at var(--glow-x, 50%) var(--glow-y, 50%), rgba(255,255,255,0.22) 0%, transparent 60%)`,
                }}
              />
            </article>
          );
        })}
      </div>
    </aside>
  );
}

/* ── Preview Area ─────────────────────────────────────────────────── */

function PreviewArea(props: {
  enableAnimations: boolean;
  onOpenSettings: () => void;
}) {
  const fm = useFmState();
  const { previewEntry: entry, previewContent: content, previewLoading: loading } = fm;
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  // Focus textarea on edit start
  useEffect(() => {
    if (fm.editing && textareaRef.current) {
      textareaRef.current.focus();
    }
  }, [fm.editing]);

  // Ctrl+S / Cmd+S to save
  useEffect(() => {
    if (!fm.editing) return;
    const handler = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === "s") {
        e.preventDefault();
        void fm.saveFile();
      }
      if (e.key === "Escape") {
        fm.cancelEditing();
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [fm.editing]);

  if (!entry) {
    return (
      <section className="claw-chat-area fm-preview-area">
        <header className="chat-header">
          <div className="chat-header-main">
            <div className="chat-brand-title">Files</div>
          </div>
          <div className="chat-header-actions">
            <button type="button" onClick={props.onOpenSettings} className="ui-btn ui-btn-primary">
              Settings
            </button>
          </div>
        </header>
        <div className="chat-scroll">
          <div className="empty-state" style={{ animation: props.enableAnimations ? undefined : "none" }}>
            <div className="empty-state-icon" style={{ fontSize: "36px" }}>📂</div>
            <div className="empty-state-title">Select a file to preview</div>
            <div className="empty-state-copy">
              Choose a file from the sidebar to view its contents here.
              <br />Supports Markdown, text, images, and PDFs.
            </div>
          </div>
        </div>
      </section>
    );
  }

  const url = `${getFsApiBase()}/read?path=${encodeURIComponent(entry.path)}`;
  const canEdit = isEditableText(entry.mime);

  return (
    <section className="claw-chat-area fm-preview-area">
      <header className="chat-header">
        <div className="chat-header-main">
          <div className="chat-brand-title">
            <span style={{ marginRight: "8px" }}>{getFileIcon(entry)}</span>
            {entry.name}
            {fm.editing && fm.editDirty && <span className="fm-unsaved-dot" title="Unsaved changes">●</span>}
          </div>
          <div className="topbar-status">
            <span>{getFileDescription(entry)}</span>
            <span style={{ margin: "0 4px" }}>·</span>
            <span>{formatSize(entry.size)}</span>
            <span style={{ margin: "0 4px" }}>·</span>
            <span>{formatDate(entry.mtime)}</span>
          </div>
        </div>
        <div className="chat-header-actions">
          {canEdit && !fm.editing && (
            <button type="button" className="ui-btn ui-btn-light" onClick={fm.startEditing}>
              ✏️ Edit
            </button>
          )}
          {fm.editing && (
            <>
              <button
                type="button"
                className="ui-btn ui-btn-primary"
                onClick={() => void fm.saveFile()}
                disabled={fm.saving || !fm.editDirty}
              >
                {fm.saving ? "Saving..." : "💾 Save"}
              </button>
              <button type="button" className="ui-btn ui-btn-light" onClick={fm.cancelEditing}>
                Cancel
              </button>
            </>
          )}
          <button type="button" className="ui-btn ui-btn-light" onClick={() => fm.handleDownload(entry)}>
            ↓ Download
          </button>
          <button type="button" className="ui-btn ui-btn-light" onClick={fm.closePreview}>
            × Close
          </button>
          <button type="button" onClick={props.onOpenSettings} className="ui-btn ui-btn-primary">
            Settings
          </button>
        </div>
      </header>

      <div className="chat-scroll fm-preview-scroll">
        <div className="chat-thread" style={{ maxWidth: "980px" }}>
          {loading && (
            <div className="message-row assistant" style={{ animation: "fade-up 260ms ease" }}>
              <div className="message-bubble assistant">
                <div className="message-role">Loading</div>
                <div className="markdown"><p style={{ color: "var(--claw-text-muted)" }}>Loading preview...</p></div>
              </div>
            </div>
          )}

          {/* Editing mode */}
          {fm.editing && !loading && (
            <div className="message-row assistant" style={{ animation: props.enableAnimations ? "fade-up 360ms ease" : "none", width: "100%" }}>
              <div className="message-bubble assistant fm-preview-bubble">
                <textarea
                  ref={textareaRef}
                  className="fm-edit-textarea"
                  value={fm.editContent}
                  onChange={(e) => fm.setEditContent(e.target.value)}
                  spellCheck={false}
                />
              </div>
            </div>
          )}

          {/* Markdown preview */}
          {!fm.editing && isPreviewableText(entry.mime) && content !== null && !loading && (
            <div className="message-row assistant" style={{ animation: props.enableAnimations ? "fade-up 360ms ease" : "none" }}>
              <div className="message-bubble assistant fm-preview-bubble">
                {isMarkdown(entry.name) ? (
                  <div className="markdown" dangerouslySetInnerHTML={{ __html: renderMarkdown(content) }} />
                ) : (
                  <pre className="fm-code-preview">{content}</pre>
                )}
              </div>
            </div>
          )}

          {/* Image preview */}
          {isPreviewableImage(entry.mime) && !loading && (
            <div className="message-row assistant" style={{ animation: props.enableAnimations ? "fade-up 360ms ease" : "none" }}>
              <div className="message-bubble assistant fm-preview-bubble">
                <img src={url} alt={entry.name} className="fm-preview-img" />
              </div>
            </div>
          )}

          {/* PDF preview */}
          {isPreviewablePdf(entry.mime) && !loading && (
            <div className="message-row assistant" style={{ animation: props.enableAnimations ? "fade-up 360ms ease" : "none", width: "100%" }}>
              <div className="message-bubble assistant fm-preview-bubble" style={{ width: "100%", padding: 0, overflow: "hidden" }}>
                <iframe src={url} title={entry.name} className="fm-pdf-frame" />
              </div>
            </div>
          )}

          {/* Unsupported */}
          {!isPreviewable(entry.mime) && !loading && (
            <div className="message-row assistant" style={{ animation: props.enableAnimations ? "fade-up 360ms ease" : "none" }}>
              <div className="message-bubble assistant">
                <div className="message-role">Preview</div>
                <div className="markdown">
                  <p>Preview is not available for <strong>{entry.mime?.split(";")[0] ?? "this file type"}</strong>.</p>
                  <p><button type="button" className="ui-btn ui-btn-primary" style={{ marginTop: "8px" }} onClick={() => fm.handleDownload(entry)}>↓ Download File</button></p>
                </div>
              </div>
            </div>
          )}
        </div>
      </div>
    </section>
  );
}

/* ── Main FileManager ─────────────────────────────────────────────── */

export type FileManagerProps = {
  mode: "sidebar" | "main";
  sidebarCollapsed: boolean;
  sidebarWidth: number;
  enableAnimations: boolean;
  autoHoverSidebar: boolean;
  onToggleSidebarCollapse: () => void;
  onSetSidebarCollapsed: (v: boolean) => void;
  onSwitchToChat: () => void;
  onOpenSettings: () => void;
};

// Shared provider instance — rendered once around both sidebar+main
let _providerMounted = false;
const _providerListeners = new Set<() => void>();

export function FileManagerProvider(props: { children: React.ReactNode }) {
  return <FmProvider>{props.children}</FmProvider>;
}

export default function FileManager(props: FileManagerProps) {
  const [dragOver, setDragOver] = useState(false);

  if (props.mode === "sidebar") {
    return (
      <FileSidebar
        collapsed={props.sidebarCollapsed}
        sidebarWidth={props.sidebarWidth}
        enableAnimations={props.enableAnimations}
        autoHover={props.autoHoverSidebar}
        onToggleCollapse={props.onToggleSidebarCollapse}
        onSetCollapsed={props.onSetSidebarCollapsed}
        onSwitchToChat={props.onSwitchToChat}
        onOpenSettings={props.onOpenSettings}
      />
    );
  }

  // mode === "main"
  return (
    <MainContent
      enableAnimations={props.enableAnimations}
      onOpenSettings={props.onOpenSettings}
    />
  );
}

function MainContent(props: { enableAnimations: boolean; onOpenSettings: () => void }) {
  const fm = useFmState();
  const [dragOver, setDragOver] = useState(false);

  function handleDragOver(e: React.DragEvent) { e.preventDefault(); setDragOver(true); }
  function handleDragLeave(e: React.DragEvent) { e.preventDefault(); setDragOver(false); }
  function handleDrop(e: React.DragEvent) {
    e.preventDefault(); setDragOver(false);
    if (e.dataTransfer.files.length > 0) fm.uploadFiles(e.dataTransfer.files);
  }

  return (
    <div
      className={dragOver ? "fm-drag-active" : ""}
      style={{ display: "contents" }}
      onDragOver={handleDragOver}
      onDragLeave={handleDragLeave}
      onDrop={handleDrop}
    >
      {fm.uploading && <div className="fm-upload-toast">Uploading...</div>}
      {fm.error && (
        <div className="fm-error-toast">
          <span>{fm.error}</span>
          <button type="button" onClick={() => fm.setError(null)}>×</button>
        </div>
      )}
      {dragOver && (
        <div className="fm-drop-overlay"><div className="fm-drop-label">Drop files to upload</div></div>
      )}
      <PreviewArea enableAnimations={props.enableAnimations} onOpenSettings={props.onOpenSettings} />
    </div>
  );
}
