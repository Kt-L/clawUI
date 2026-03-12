const fs = require("node:fs");
const path = require("node:path");
const { app, BrowserWindow, shell, ipcMain, protocol } = require("electron");

const WINDOW_WIDTH = 1280;
const WINDOW_HEIGHT = 820;
const DESKTOP_LOCAL_IMAGE_SCHEME = "claw-local-image";
const CLAW_FS_SCHEME = "claw-fs";
const IMAGE_CACHE_LIMIT = 5;
const BLANK_CHECK_DELAY_MS = 1400;
const MAX_BLANK_RECOVERY_ATTEMPTS = 2;
const LOCAL_GATEWAY_HOSTS = new Set([
  "localhost",
  "127.0.0.1",
  "::1",
  "[::1]",
  "0.0.0.0",
  "::",
]);
const IMAGE_MIME_BY_EXT = {
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".webp": "image/webp",
  ".gif": "image/gif",
  ".bmp": "image/bmp",
  ".svg": "image/svg+xml",
};
const imageDataCache = new Map();
let gatewayHttpBaseCandidates = [];
let gatewayUsesRemoteHost = false;
let clawFsServerUrl = "";
let mainWindow = null;
let isQuitting = false;

function imageMimeTypeFromPath(filePath) {
  const ext = path.extname(filePath).toLowerCase();
  return IMAGE_MIME_BY_EXT[ext] ?? null;
}

function isLikelyImageFileName(value) {
  return /\.(png|jpe?g|webp|gif|bmp|svg)$/i.test(value || "");
}

function normalizePathSeparators(value) {
  return String(value || "").replace(/\\/g, "/");
}

function stripPathDecorators(value) {
  let next = String(value || "").trim();
  next = next.replace(/^media\s*:\s*/i, "").trim();
  if (!next) {
    return "";
  }
  const wrappers = [
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

function getWorkspaceRoot(homeDir) {
  return path.join(homeDir, ".openclaw", "workspace");
}

function mapWorkspacePathToLocalHome(rawPath, homeDir) {
  const normalized = normalizePathSeparators(rawPath).trim();
  const marker = "/.openclaw/workspace/";
  const markerIndex = normalized.toLowerCase().indexOf(marker);
  if (markerIndex < 0) {
    return null;
  }
  const suffix = normalized.slice(markerIndex + marker.length);
  if (!suffix) {
    return path.join(homeDir, ".openclaw", "workspace");
  }
  return path.join(homeDir, ".openclaw", "workspace", suffix);
}

function resolveWorkspaceRelativePath(rawPath, homeDir) {
  const normalized = normalizePathSeparators(rawPath)
    .trim()
    .replace(/^\.\/+/, "")
    .replace(/^\/+/, "");
  if (!normalized) {
    return null;
  }
  if (normalized.startsWith(".openclaw/workspace/")) {
    return path.join(homeDir, normalized);
  }
  if (normalized.startsWith("openclaw/workspace/")) {
    return path.join(homeDir, `.${normalized}`);
  }
  if (!normalized.includes("/") && isLikelyImageFileName(normalized)) {
    return path.join(homeDir, ".openclaw", "workspace", normalized);
  }
  return null;
}

function getCachedImage(pathKey, mimeType) {
  const entry = imageDataCache.get(pathKey);
  if (!entry) {
    return null;
  }
  if (entry.mimeType !== mimeType) {
    imageDataCache.delete(pathKey);
    return null;
  }
  // Refresh insertion order for LRU behavior.
  imageDataCache.delete(pathKey);
  imageDataCache.set(pathKey, entry);
  return entry;
}

function setCachedImage(pathKey, value) {
  if (imageDataCache.has(pathKey)) {
    imageDataCache.delete(pathKey);
  }
  imageDataCache.set(pathKey, value);
  while (imageDataCache.size > IMAGE_CACHE_LIMIT) {
    const oldestKey = imageDataCache.keys().next().value;
    if (!oldestKey) {
      break;
    }
    imageDataCache.delete(oldestKey);
  }
}

protocol.registerSchemesAsPrivileged([
  {
    scheme: DESKTOP_LOCAL_IMAGE_SCHEME,
    privileges: {
      standard: true,
      secure: true,
      supportFetchAPI: true,
      corsEnabled: true,
    },
  },
  {
    scheme: CLAW_FS_SCHEME,
    privileges: {
      standard: true,
      secure: true,
      supportFetchAPI: true,
      corsEnabled: true,
      stream: true,
    },
  },
]);

function resolveLocalImagePathCandidates(rawPath) {
  if (typeof rawPath !== "string") {
    return [];
  }
  const homeDir = app.getPath("home");
  const workspaceRoot = getWorkspaceRoot(homeDir);
  const initial = stripPathDecorators(rawPath);
  if (!initial) {
    return [];
  }

  const variants = new Set([initial]);
  try {
    const decoded = decodeURIComponent(initial);
    if (decoded && decoded !== initial) {
      variants.add(decoded);
    }
  } catch {
    // ignore decode errors
  }

  const candidates = [];
  const seen = new Set();
  const pushCandidate = (candidate) => {
    if (!candidate || typeof candidate !== "string") {
      return;
    }
    const resolved = path.resolve(candidate);
    if (seen.has(resolved)) {
      return;
    }
    seen.add(resolved);
    candidates.push(resolved);
  };

  for (const variant of variants) {
    if (variant.startsWith("file:")) {
      try {
        const parsed = new URL(variant);
        if (parsed.protocol === "file:") {
          let pathname = decodeURIComponent(parsed.pathname || "");
          if (/^\/[A-Za-z]:\//.test(pathname)) {
            pathname = pathname.slice(1);
          }
          if (pathname) {
            pushCandidate(pathname);
          }
        }
      } catch {
        // ignore malformed file URL
      }
    }

    if (variant.startsWith("~/")) {
      pushCandidate(path.join(homeDir, variant.slice(2)));
    }

    const workspaceMapped = mapWorkspacePathToLocalHome(variant, homeDir);
    if (workspaceMapped) {
      pushCandidate(workspaceMapped);
    }

    const workspaceResolved = resolveWorkspaceRelativePath(variant, homeDir);
    if (workspaceResolved) {
      pushCandidate(workspaceResolved);
    }

    if (path.isAbsolute(variant)) {
      pushCandidate(variant);
    }

    const normalized = normalizePathSeparators(variant)
      .trim()
      .replace(/^\.\/+/, "")
      .replace(/^\/+/, "");
    if (normalized) {
      if (normalized.includes("/") || isLikelyImageFileName(normalized)) {
        pushCandidate(path.join(workspaceRoot, normalized));
      }
      const baseName = path.basename(normalized);
      if (isLikelyImageFileName(baseName)) {
        pushCandidate(path.join(workspaceRoot, baseName));
      }
    }

    pushCandidate(variant);
  }

  return candidates;
}

function localImageCandidatesFromDesktopUrl(rawUrl) {
  try {
    const parsed = new URL(rawUrl);
    if (parsed.protocol !== `${DESKTOP_LOCAL_IMAGE_SCHEME}:`) {
      return [];
    }
    const queryPath = parsed.searchParams.get("path");
    if (queryPath) {
      return resolveLocalImagePathCandidates(queryPath);
    }
    let pathname = decodeURIComponent(parsed.pathname || "");
    if (/^\/[A-Za-z]:\//.test(pathname)) {
      pathname = pathname.slice(1);
    }
    return resolveLocalImagePathCandidates(pathname);
  } catch {
    return [];
  }
}

function localImagePathFromDesktopUrl(rawUrl) {
  try {
    const parsed = new URL(rawUrl);
    if (parsed.protocol !== `${DESKTOP_LOCAL_IMAGE_SCHEME}:`) {
      return "";
    }
    const queryPath = parsed.searchParams.get("path");
    if (queryPath) {
      try {
        return decodeURIComponent(queryPath);
      } catch {
        return queryPath;
      }
    }
    let pathname = decodeURIComponent(parsed.pathname || "");
    if (/^\/[A-Za-z]:\//.test(pathname)) {
      pathname = pathname.slice(1);
    }
    return pathname || "";
  } catch {
    return "";
  }
}

function toGatewayHttpBaseCandidates(rawGatewayUrl) {
  if (typeof rawGatewayUrl !== "string") {
    return [];
  }
  const trimmed = rawGatewayUrl.trim();
  if (!trimmed) {
    return [];
  }
  const seen = new Set();
  const candidates = [];
  const push = (value) => {
    const next = String(value || "").trim().replace(/\/+$/g, "");
    if (!next || seen.has(next)) {
      return;
    }
    seen.add(next);
    candidates.push(next);
  };
  const collectFromUrl = (value) => {
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

function isRemoteGatewayBaseUrl(rawBaseUrl) {
  try {
    const parsed = new URL(rawBaseUrl);
    const host = parsed.hostname.trim().toLowerCase();
    if (!host) {
      return false;
    }
    if (LOCAL_GATEWAY_HOSTS.has(host)) {
      return false;
    }
    if (host.startsWith("127.")) {
      return false;
    }
    return true;
  } catch {
    return false;
  }
}

function isRemoteGatewayCandidates(candidates) {
  return Array.isArray(candidates) && candidates.some((item) => isRemoteGatewayBaseUrl(item));
}

// Vite dev server port for local image proxy (run `npm run dev` on the Gateway machine)
const VITE_DEV_SERVER_PORT = process.env.CLAWUI_IMAGE_PROXY_PORT || "3000";

async function tryFetchImageFromUrl(targetUrl) {
  try {
    const response = await fetch(targetUrl, {
      method: "GET",
      cache: "no-store",
    });
    if (!response.ok) {
      return { ok: false, error: `http-${response.status}` };
    }
    const arrayBuffer = await response.arrayBuffer();
    const data = Buffer.from(arrayBuffer);
    if (data.length === 0) {
      return { ok: false, error: "empty-body" };
    }
    const contentType = (response.headers.get("content-type") || "")
      .split(";")[0]
      .trim()
      .toLowerCase();
    // Only accept image/* content types; skip HTML/JSON/text responses
    if (!contentType.startsWith("image/")) {
      return { ok: false, error: `wrong-content-type:${contentType || "unknown"}` };
    }
    return {
      ok: true,
      mimeType: contentType,
      size: data.length,
      data,
    };
  } catch (error) {
    const code =
      error && typeof error === "object" && "code" in error && typeof error.code === "string"
        ? error.code
        : "fetch-failed";
    return { ok: false, error: code };
  }
}

async function readImageFromRemoteGateway(rawPath) {
  const normalizedPath = stripPathDecorators(rawPath);
  if (!normalizedPath) {
    return { ok: false, error: "invalid-path" };
  }
  const encodedPath = encodeURIComponent(normalizedPath);
  let lastError = "gateway-fetch-failed";

  // Strategy 1: Try Vite dev server running on the Gateway machine (proxied via SSH tunnel or direct)
  // The Vite dev server has a local-image-proxy plugin that reads files from the Gateway's filesystem
  const viteUrls = [
    `http://localhost:${VITE_DEV_SERVER_PORT}/__claw/local-image?path=${encodedPath}`,
  ];
  for (const url of viteUrls) {
    const result = await tryFetchImageFromUrl(url);
    if (result.ok) {
      return result;
    }
    lastError = `vite-${result.error}`;
  }

  // Strategy 2: Try Gateway HTTP endpoints (in case Gateway adds support in the future)
  for (const baseUrl of gatewayHttpBaseCandidates) {
    const targetUrl = `${baseUrl}/__claw/local-image?path=${encodedPath}`;
    const result = await tryFetchImageFromUrl(targetUrl);
    if (result.ok) {
      return result;
    }
    lastError = `gateway-${result.error}`;
  }

  return { ok: false, error: lastError };
}

async function readImageFromCandidates(candidates) {
  let lastErrorCode = "ENOENT";
  let lastTriedPath = "";
  for (const candidate of candidates) {
    const mimeType = imageMimeTypeFromPath(candidate);
    if (!mimeType) {
      continue;
    }
    try {
      const cached = getCachedImage(candidate, mimeType);
      if (cached) {
        return {
          ok: true,
          path: candidate,
          mimeType: cached.mimeType,
          size: cached.size,
          data: cached.data,
        };
      }
      const stat = await fs.promises.stat(candidate);
      if (!stat.isFile()) {
        continue;
      }
      const data = await fs.promises.readFile(candidate);
      setCachedImage(candidate, {
        mimeType,
        size: stat.size,
        data,
      });
      return {
        ok: true,
        path: candidate,
        mimeType,
        size: stat.size,
        data,
      };
    } catch (error) {
      lastTriedPath = candidate;
      lastErrorCode =
        error && typeof error === "object" && "code" in error && typeof error.code === "string"
          ? error.code
          : "unknown";
    }
  }
  const suffix = lastTriedPath ? `:${lastTriedPath}` : "";
  return { ok: false, error: `read-failed:${lastErrorCode}${suffix}`, path: lastTriedPath };
}

/* ── ClawFS Protocol Handler ──────────────────────────────────────── */

const CLAWFS_CONFIG_PATH = path.join(
  app.getPath("home"),
  ".openclaw",
  "clawui-fs.json"
);
const CLAWFS_MAX_READ_BYTES = 100 * 1024 * 1024; // 100 MB

function clawFsLoadConfig() {
  try {
    const raw = fs.readFileSync(CLAWFS_CONFIG_PATH, "utf-8");
    const parsed = JSON.parse(raw);
    if (Array.isArray(parsed?.roots)) return parsed;
  } catch {
    // ignore
  }
  return {
    roots: [
      {
        label: "Workspace",
        path: path.join(app.getPath("home"), ".openclaw", "workspace"),
      },
    ],
  };
}

function clawFsSaveConfig(config) {
  const dir = path.dirname(CLAWFS_CONFIG_PATH);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(
    CLAWFS_CONFIG_PATH,
    JSON.stringify(config, null, 2) + "\n",
    "utf-8"
  );
}

function clawFsIsPathUnderRoots(candidate, roots) {
  const resolved = path.resolve(candidate);
  for (const root of roots) {
    const rootResolved = path.resolve(root.path);
    if (
      resolved === rootResolved ||
      resolved.startsWith(rootResolved + path.sep)
    )
      return true;
  }
  return false;
}

function clawFsResolveAndValidate(rawPath, roots) {
  if (!rawPath)
    return { error: "missing path parameter", status: 400 };
  const resolved = path.resolve(rawPath);
  if (!clawFsIsPathUnderRoots(resolved, roots))
    return { error: "path outside allowed roots", status: 403 };
  return { resolved };
}

function clawFsMimeFromExt(ext) {
  const map = {
    ".html": "text/html",
    ".htm": "text/html",
    ".css": "text/css",
    ".js": "application/javascript",
    ".mjs": "application/javascript",
    ".json": "application/json",
    ".jsonl": "application/x-ndjson",
    ".xml": "application/xml",
    ".svg": "image/svg+xml",
    ".png": "image/png",
    ".jpg": "image/jpeg",
    ".jpeg": "image/jpeg",
    ".gif": "image/gif",
    ".webp": "image/webp",
    ".bmp": "image/bmp",
    ".ico": "image/x-icon",
    ".pdf": "application/pdf",
    ".zip": "application/zip",
    ".gz": "application/gzip",
    ".tar": "application/x-tar",
    ".mp3": "audio/mpeg",
    ".wav": "audio/wav",
    ".mp4": "video/mp4",
    ".webm": "video/webm",
    ".woff": "font/woff",
    ".woff2": "font/woff2",
    ".ttf": "font/ttf",
    ".otf": "font/otf",
    ".md": "text/markdown",
    ".markdown": "text/markdown",
    ".txt": "text/plain",
    ".csv": "text/csv",
    ".tsv": "text/tab-separated-values",
    ".yaml": "text/yaml",
    ".yml": "text/yaml",
    ".toml": "text/plain",
    ".log": "text/plain",
    ".sh": "text/x-shellscript",
    ".bash": "text/x-shellscript",
    ".zsh": "text/x-shellscript",
    ".py": "text/x-python",
    ".rs": "text/x-rust",
    ".go": "text/x-go",
    ".java": "text/x-java",
    ".c": "text/x-c",
    ".cpp": "text/x-c++",
    ".h": "text/x-c",
    ".hpp": "text/x-c++",
    ".ts": "text/typescript",
    ".tsx": "text/typescript",
    ".jsx": "text/javascript",
    ".r": "text/x-r",
    ".sql": "text/x-sql",
  };
  return map[(ext || "").toLowerCase()] || "application/octet-stream";
}

function clawFsJsonResponse(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

function clawFsErrorResponse(status, message) {
  return new Response(JSON.stringify({ error: message }), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

function clawFsGetQueryParam(url, key) {
  try {
    const u = new URL(url);
    return u.searchParams.get(key) || "";
  } catch {
    return "";
  }
}

async function clawFsProxyToRemote(request) {
  const base = clawFsServerUrl.replace(/\/+$/, "");
  const fsUrl = new URL(request.url);
  const route = fsUrl.pathname.replace(/^\/+/, "");
  const proxyUrl = `${base}/__claw/fs/${route}${fsUrl.search}`;

  const init = { method: request.method, headers: {} };
  if (request.method === "POST" || request.method === "DELETE") {
    const ct = request.headers.get("content-type");
    if (ct) init.headers["content-type"] = ct;
    init.body = await request.arrayBuffer();
  }

  try {
    return await fetch(proxyUrl, init);
  } catch (err) {
    return clawFsErrorResponse(502, `proxy error: ${err.message || err}`);
  }
}

async function handleClawFsRequest(request) {
  // If a remote file server URL is configured, proxy FS requests there
  if (clawFsServerUrl) {
    return clawFsProxyToRemote(request);
  }

  try {
    const url = new URL(request.url);
    // URL format: claw-fs://fs/<route>?params
    const route = url.pathname.replace(/^\/+/, "");
    const config = clawFsLoadConfig();

    switch (route) {
      /* ── GET /roots ──────────────────────────────────────── */
      case "roots": {
        if (request.method === "GET") {
          return clawFsJsonResponse({ roots: config.roots });
        }
        if (request.method === "POST") {
          const payload = await request.json();
          if (!Array.isArray(payload?.roots)) {
            return clawFsErrorResponse(400, "expected { roots: [...] }");
          }
          const newRoots = [];
          for (const r of payload.roots) {
            if (!r?.path || typeof r.path !== "string") continue;
            const label =
              typeof r.label === "string" ? r.label : path.basename(r.path);
            try {
              const stat = fs.statSync(r.path);
              if (!stat.isDirectory()) continue;
            } catch {
              continue;
            }
            newRoots.push({ label, path: path.resolve(r.path) });
          }
          const newConfig = { roots: newRoots };
          clawFsSaveConfig(newConfig);
          return clawFsJsonResponse({ roots: newConfig.roots });
        }
        return clawFsErrorResponse(405, "method not allowed");
      }

      /* ── GET /list ───────────────────────────────────────── */
      case "list": {
        if (request.method !== "GET")
          return clawFsErrorResponse(405, "method not allowed");
        const dirPath = url.searchParams.get("path") || "";
        const result = clawFsResolveAndValidate(dirPath, config.roots);
        if (result.error) return clawFsErrorResponse(result.status, result.error);
        const stat = fs.statSync(result.resolved);
        if (!stat.isDirectory())
          return clawFsErrorResponse(400, "not a directory");
        const entries = fs.readdirSync(result.resolved, {
          withFileTypes: true,
        });
        const items = entries
          .filter((e) => !e.name.startsWith("."))
          .map((entry) => {
            const fullPath = path.join(result.resolved, entry.name);
            try {
              const s = fs.statSync(fullPath);
              return {
                name: entry.name,
                path: fullPath,
                isDirectory: entry.isDirectory(),
                size: s.size,
                mtime: s.mtimeMs,
                mime: entry.isDirectory()
                  ? null
                  : clawFsMimeFromExt(path.extname(entry.name)),
              };
            } catch {
              return null;
            }
          })
          .filter(Boolean);
        return clawFsJsonResponse({ path: result.resolved, items });
      }

      /* ── GET /list-all ───────────────────────────────────── */
      case "list-all": {
        if (request.method !== "GET")
          return clawFsErrorResponse(405, "method not allowed");
        const dirPathAll = url.searchParams.get("path") || "";
        const maxDepthStr = url.searchParams.get("maxDepth");
        const maxDepth =
          maxDepthStr !== null ? Math.max(1, parseInt(maxDepthStr, 10) || 10) : 10;
        const resultAll = clawFsResolveAndValidate(dirPathAll, config.roots);
        if (resultAll.error)
          return clawFsErrorResponse(resultAll.status, resultAll.error);

        const allItems = [];
        const queue = [{ dir: resultAll.resolved, depth: 0 }];
        while (queue.length > 0) {
          const { dir, depth } = queue.shift();
          if (depth > maxDepth) continue;
          let dirEntries;
          try {
            dirEntries = fs.readdirSync(dir, { withFileTypes: true });
          } catch {
            continue;
          }
          for (const e of dirEntries) {
            if (e.name.startsWith(".")) continue;
            const full = path.join(dir, e.name);
            try {
              const s = fs.statSync(full);
              allItems.push({
                name: e.name,
                path: full,
                isDirectory: e.isDirectory(),
                size: s.size,
                mtime: s.mtimeMs,
                mime: e.isDirectory()
                  ? null
                  : clawFsMimeFromExt(path.extname(e.name)),
              });
              if (e.isDirectory()) {
                queue.push({ dir: full, depth: depth + 1 });
              }
            } catch {
              // skip
            }
          }
        }
        return clawFsJsonResponse({ path: resultAll.resolved, items: allItems });
      }

      /* ── GET /read ───────────────────────────────────────── */
      case "read": {
        if (request.method !== "GET")
          return clawFsErrorResponse(405, "method not allowed");
        const readPath = url.searchParams.get("path") || "";
        const resultRead = clawFsResolveAndValidate(readPath, config.roots);
        if (resultRead.error)
          return clawFsErrorResponse(resultRead.status, resultRead.error);
        const readStat = fs.statSync(resultRead.resolved);
        if (readStat.isDirectory())
          return clawFsErrorResponse(400, "is a directory");
        if (readStat.size > CLAWFS_MAX_READ_BYTES)
          return clawFsErrorResponse(413, "file too large");
        const mime = clawFsMimeFromExt(path.extname(resultRead.resolved));
        const data = fs.readFileSync(resultRead.resolved);
        return new Response(data, {
          status: 200,
          headers: {
            "Content-Type": mime,
            "Content-Length": String(data.length),
          },
        });
      }

      /* ── GET /stat ───────────────────────────────────────── */
      case "stat": {
        if (request.method !== "GET")
          return clawFsErrorResponse(405, "method not allowed");
        const statPath = url.searchParams.get("path") || "";
        const resultStat = clawFsResolveAndValidate(statPath, config.roots);
        if (resultStat.error)
          return clawFsErrorResponse(resultStat.status, resultStat.error);
        const st = fs.statSync(resultStat.resolved);
        return clawFsJsonResponse({
          path: resultStat.resolved,
          isDirectory: st.isDirectory(),
          isFile: st.isFile(),
          size: st.size,
          mtime: st.mtimeMs,
          mime: st.isDirectory()
            ? null
            : clawFsMimeFromExt(path.extname(resultStat.resolved)),
        });
      }

      /* ── POST /upload ────────────────────────────────────── */
      case "upload": {
        if (request.method !== "POST")
          return clawFsErrorResponse(405, "method not allowed");
        const uploadDir = url.searchParams.get("path") || "";
        const resultUpload = clawFsResolveAndValidate(uploadDir, config.roots);
        if (resultUpload.error)
          return clawFsErrorResponse(resultUpload.status, resultUpload.error);

        const contentType = request.headers.get("content-type") || "";
        if (!contentType.includes("multipart/form-data")) {
          return clawFsErrorResponse(400, "expected multipart/form-data");
        }

        // Use the web FormData API available in Electron
        const formData = await request.formData();
        const uploaded = [];
        for (const [key, value] of formData.entries()) {
          if (typeof value === "object" && value.arrayBuffer) {
            // It's a File/Blob
            const filename = value.name || key;
            const safeName = path.basename(filename);
            const dest = path.join(resultUpload.resolved, safeName);
            if (!clawFsIsPathUnderRoots(dest, config.roots)) continue;
            const buffer = Buffer.from(await value.arrayBuffer());
            fs.writeFileSync(dest, buffer);
            uploaded.push({ name: safeName, path: dest, size: buffer.length });
          }
        }
        return clawFsJsonResponse({ uploaded });
      }

      /* ── POST /mkdir ─────────────────────────────────────── */
      case "mkdir": {
        if (request.method !== "POST")
          return clawFsErrorResponse(405, "method not allowed");
        const mkdirPath = url.searchParams.get("path") || "";
        const resultMkdir = clawFsResolveAndValidate(mkdirPath, config.roots);
        if (resultMkdir.error)
          return clawFsErrorResponse(resultMkdir.status, resultMkdir.error);
        fs.mkdirSync(resultMkdir.resolved, { recursive: true });
        return clawFsJsonResponse({ created: resultMkdir.resolved });
      }

      /* ── DELETE /delete ──────────────────────────────────── */
      case "delete": {
        if (request.method !== "DELETE" && request.method !== "POST")
          return clawFsErrorResponse(405, "method not allowed");
        const deletePath = url.searchParams.get("path") || "";
        const resultDelete = clawFsResolveAndValidate(deletePath, config.roots);
        if (resultDelete.error)
          return clawFsErrorResponse(resultDelete.status, resultDelete.error);
        // Don't allow deleting root directories themselves
        for (const root of config.roots) {
          if (path.resolve(root.path) === resultDelete.resolved) {
            return clawFsErrorResponse(403, "cannot delete a root directory");
          }
        }
        const delStat = fs.statSync(resultDelete.resolved);
        if (delStat.isDirectory()) {
          fs.rmSync(resultDelete.resolved, { recursive: true, force: true });
        } else {
          fs.unlinkSync(resultDelete.resolved);
        }
        return clawFsJsonResponse({ deleted: resultDelete.resolved });
      }

      /* ── POST /rename ────────────────────────────────────── */
      case "rename": {
        if (request.method !== "POST")
          return clawFsErrorResponse(405, "method not allowed");
        const fromPath = url.searchParams.get("from") || "";
        const toPath = url.searchParams.get("to") || "";
        const resultFrom = clawFsResolveAndValidate(fromPath, config.roots);
        if (resultFrom.error)
          return clawFsErrorResponse(resultFrom.status, resultFrom.error);
        const resultTo = clawFsResolveAndValidate(toPath, config.roots);
        if (resultTo.error)
          return clawFsErrorResponse(resultTo.status, resultTo.error);
        fs.renameSync(resultFrom.resolved, resultTo.resolved);
        return clawFsJsonResponse({
          from: resultFrom.resolved,
          to: resultTo.resolved,
        });
      }

      /* ── POST /write ─────────────────────────────────────── */
      case "write": {
        if (request.method !== "POST")
          return clawFsErrorResponse(405, "method not allowed");
        const writePath = url.searchParams.get("path") || "";
        const resultWrite = clawFsResolveAndValidate(writePath, config.roots);
        if (resultWrite.error)
          return clawFsErrorResponse(resultWrite.status, resultWrite.error);
        const bodyBuf = Buffer.from(await request.arrayBuffer());
        fs.writeFileSync(resultWrite.resolved, bodyBuf);
        const writeStat = fs.statSync(resultWrite.resolved);
        return clawFsJsonResponse({
          written: resultWrite.resolved,
          size: writeStat.size,
        });
      }

      default:
        return clawFsErrorResponse(404, `unknown fs route: ${route}`);
    }
  } catch (err) {
    const code = err?.code;
    if (code === "ENOENT") return clawFsErrorResponse(404, "not found");
    if (code === "EACCES" || code === "EPERM")
      return clawFsErrorResponse(403, "permission denied");
    return clawFsErrorResponse(500, String(err));
  }
}

async function handleDesktopLocalImageRequest(request) {
  const rawPath = localImagePathFromDesktopUrl(request.url);
  if (rawPath) {
    const fromRemoteGateway = await readImageFromRemoteGateway(rawPath);
    if (fromRemoteGateway.ok) {
      return new Response(fromRemoteGateway.data, {
        status: 200,
        headers: {
          "Content-Type": fromRemoteGateway.mimeType,
          "Cache-Control": "no-store",
        },
      });
    }
  }
  const candidates = localImageCandidatesFromDesktopUrl(request.url);
  if (candidates.length === 0) {
    return new Response("invalid-path", { status: 400 });
  }
  const loaded = await readImageFromCandidates(candidates);
  if (!loaded.ok) {
    return new Response(loaded.error, { status: 404 });
  }
  return new Response(loaded.data, {
    status: 200,
    headers: {
      "Content-Type": loaded.mimeType,
      "Cache-Control": "no-store",
    },
  });
}

ipcMain.handle("desktop:beep", () => {
  try {
    shell.beep();
    return true;
  } catch {
    return false;
  }
});

ipcMain.handle("desktop:read-image-file", async (_event, rawPath) => {
  const candidates = resolveLocalImagePathCandidates(rawPath);
  if (candidates.length === 0) {
    return { ok: false, error: "invalid-path" };
  }
  const loaded = await readImageFromCandidates(candidates);
  if (!loaded.ok) {
    return { ok: false, error: loaded.error };
  }
  return {
    ok: true,
    path: loaded.path,
    mimeType: loaded.mimeType,
    size: loaded.size,
    dataUrl: `data:${loaded.mimeType};base64,${loaded.data.toString("base64")}`,
  };
});

ipcMain.handle("desktop:fetch-image-url", async (_event, rawUrl) => {
  if (typeof rawUrl !== "string" || !rawUrl.trim()) {
    return { ok: false, error: "invalid-url" };
  }
  let parsed;
  try {
    parsed = new URL(rawUrl.trim());
  } catch {
    return { ok: false, error: "invalid-url" };
  }
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    return { ok: false, error: "invalid-url-protocol" };
  }
  try {
    const response = await fetch(parsed.toString(), {
      method: "GET",
      cache: "no-store",
    });
    if (!response.ok) {
      return { ok: false, error: `http-${response.status}` };
    }
    const arrayBuffer = await response.arrayBuffer();
    const data = Buffer.from(arrayBuffer);
    if (data.length === 0) {
      return { ok: false, error: "empty-body" };
    }
    const contentType = (response.headers.get("content-type") || "").split(";")[0].trim().toLowerCase();
    const mimeType = contentType.startsWith("image/")
      ? contentType
      : imageMimeTypeFromPath(parsed.pathname) || "image/png";
    return {
      ok: true,
      mimeType,
      size: data.length,
      dataUrl: `data:${mimeType};base64,${data.toString("base64")}`,
    };
  } catch (error) {
    const code =
      error && typeof error === "object" && "code" in error && typeof error.code === "string"
        ? error.code
        : "fetch-failed";
    return { ok: false, error: code };
  }
});

ipcMain.handle("desktop:set-gateway-url", (_event, rawGatewayUrl) => {
  if (typeof rawGatewayUrl !== "string") {
    gatewayHttpBaseCandidates = [];
    gatewayUsesRemoteHost = false;
    return { ok: true, remote: false, candidates: 0 };
  }
  const nextCandidates = toGatewayHttpBaseCandidates(rawGatewayUrl);
  gatewayHttpBaseCandidates = nextCandidates;
  gatewayUsesRemoteHost = isRemoteGatewayCandidates(nextCandidates);
  return {
    ok: true,
    remote: gatewayUsesRemoteHost,
    candidates: gatewayHttpBaseCandidates.length,
  };
});

ipcMain.handle("desktop:set-fs-server-url", (_event, url) => {
  clawFsServerUrl = typeof url === "string" ? url.trim() : "";
  return { ok: true, url: clawFsServerUrl };
});

function hasLiveMainWindow() {
  return Boolean(mainWindow && !mainWindow.isDestroyed());
}

function recreateMainWindow() {
  if (hasLiveMainWindow()) {
    const staleWindow = mainWindow;
    mainWindow = null;
    try {
      staleWindow.destroy();
    } catch {
      // ignore stale-window teardown errors
    }
  }
  return createMainWindow();
}

function focusMainWindow() {
  if (!hasLiveMainWindow()) {
    return false;
  }
  if (mainWindow.isMinimized()) {
    mainWindow.restore();
  }
  if (!mainWindow.isVisible()) {
    mainWindow.show();
  }
  mainWindow.focus();
  return true;
}

function createMainWindow() {
  if (focusMainWindow()) {
    return mainWindow;
  }

  const nextWindow = new BrowserWindow({
    width: WINDOW_WIDTH,
    height: WINDOW_HEIGHT,
    minWidth: 1000,
    minHeight: 640,
    autoHideMenuBar: true,
    webPreferences: {
      preload: path.join(__dirname, "preload.cjs"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
    },
  });

  const entryPath = path.join(__dirname, "..", "dist", "index.html");
  if (!fs.existsSync(entryPath)) {
    throw new Error(`Desktop bundle is missing: ${entryPath}`);
  }

  mainWindow = nextWindow;
  nextWindow.loadFile(entryPath);
  let blankRecoveryAttempts = 0;
  let blankCheckTimer = null;

  const clearBlankCheckTimer = () => {
    if (blankCheckTimer === null) {
      return;
    }
    clearTimeout(blankCheckTimer);
    blankCheckTimer = null;
  };

  const runBlankCheck = async () => {
    if (nextWindow.isDestroyed()) {
      return;
    }
    try {
      const state = await nextWindow.webContents.executeJavaScript(
        `(() => {
          const root = document.getElementById("root");
          const hasRoot = Boolean(root);
          const rootChildren = hasRoot ? root.childElementCount : 0;
          const rootText = hasRoot ? (root.textContent || "").trim().length : 0;
          return { hasRoot, rootChildren, rootText };
        })();`,
      );
      const looksBlank =
        !state ||
        typeof state !== "object" ||
        state.hasRoot !== true ||
        (((state.rootChildren ?? 0) === 0) && ((state.rootText ?? 0) === 0));
      if (!looksBlank) {
        return;
      }
    } catch {
      // If script execution fails, treat it as a blank state and recover.
    }

    if (blankRecoveryAttempts >= MAX_BLANK_RECOVERY_ATTEMPTS) {
      return;
    }
    blankRecoveryAttempts += 1;

    if (!nextWindow.isDestroyed()) {
      nextWindow.webContents.reloadIgnoringCache();
    }
  };

  const scheduleBlankCheck = () => {
    clearBlankCheckTimer();
    blankCheckTimer = setTimeout(() => {
      blankCheckTimer = null;
      void runBlankCheck();
    }, BLANK_CHECK_DELAY_MS);
  };

  nextWindow.webContents.setWindowOpenHandler(({ url }) => {
    shell.openExternal(url);
    return { action: "deny" };
  });

  nextWindow.webContents.on("did-finish-load", () => {
    scheduleBlankCheck();
  });

  nextWindow.webContents.on("did-fail-load", (_event, _errorCode, _errorDescription, _validatedURL, isMainFrame) => {
    if (!isMainFrame || isQuitting || nextWindow.isDestroyed()) {
      return;
    }
    if (blankRecoveryAttempts >= MAX_BLANK_RECOVERY_ATTEMPTS) {
      return;
    }
    blankRecoveryAttempts += 1;
    nextWindow.webContents.reloadIgnoringCache();
  });

  nextWindow.webContents.on("render-process-gone", () => {
    if (isQuitting) {
      return;
    }
    recreateMainWindow();
  });

  nextWindow.on("close", (event) => {
    if (process.platform === "darwin" && !isQuitting) {
      event.preventDefault();
      nextWindow.hide();
    }
  });

  nextWindow.on("closed", () => {
    clearBlankCheckTimer();
    if (mainWindow === nextWindow) {
      mainWindow = null;
    }
  });

  return nextWindow;
}

app.whenReady().then(() => {
  protocol.handle(DESKTOP_LOCAL_IMAGE_SCHEME, handleDesktopLocalImageRequest);
  protocol.handle(CLAW_FS_SCHEME, handleClawFsRequest);
  createMainWindow();

  app.on("activate", () => {
    if (!focusMainWindow()) {
      createMainWindow();
    }
  });
});

app.on("before-quit", () => {
  isQuitting = true;
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") {
    app.quit();
  }
});
