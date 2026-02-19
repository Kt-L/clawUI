const fs = require("node:fs");
const path = require("node:path");
const { app, BrowserWindow, shell, ipcMain, protocol } = require("electron");

const WINDOW_WIDTH = 1280;
const WINDOW_HEIGHT = 820;
const DESKTOP_LOCAL_IMAGE_SCHEME = "claw-local-image";
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
