/**
 * ClawUI File System Plugin for Vite dev server.
 *
 * Provides REST endpoints under /__claw/fs/ for browsing, reading, uploading,
 * and managing files on the host machine. Access is restricted to directories
 * configured in ~/.openclaw/clawui-fs.json.
 */

import fsSync from "node:fs";
import fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";

/* ── Config ───────────────────────────────────────────────────────── */

const CONFIG_PATH = path.join(os.homedir(), ".openclaw", "clawui-fs.json");

type FsRoot = { label: string; path: string };
type FsConfig = { roots: FsRoot[] };

function loadConfig(): FsConfig {
  try {
    const raw = fsSync.readFileSync(CONFIG_PATH, "utf-8");
    const parsed = JSON.parse(raw);
    if (Array.isArray(parsed?.roots)) {
      return parsed as FsConfig;
    }
  } catch {
    // ignore
  }
  // Fallback: workspace only
  return {
    roots: [{ label: "Workspace", path: path.join(os.homedir(), ".openclaw", "workspace") }],
  };
}

function saveConfig(config: FsConfig): void {
  const dir = path.dirname(CONFIG_PATH);
  if (!fsSync.existsSync(dir)) {
    fsSync.mkdirSync(dir, { recursive: true });
  }
  fsSync.writeFileSync(CONFIG_PATH, JSON.stringify(config, null, 2) + "\n", "utf-8");
}

/* ── Security ─────────────────────────────────────────────────────── */

function isPathUnderRoots(candidate: string, roots: FsRoot[]): boolean {
  const resolved = path.resolve(candidate);
  for (const root of roots) {
    const rootResolved = path.resolve(root.path);
    if (resolved === rootResolved || resolved.startsWith(rootResolved + path.sep)) {
      return true;
    }
  }
  return false;
}

async function resolveAndValidate(
  rawPath: string,
  roots: FsRoot[],
): Promise<{ resolved: string } | { error: string; status: number }> {
  if (!rawPath) {
    return { error: "missing path parameter", status: 400 };
  }
  const normalized = path.resolve(rawPath);
  // First check the normalized path (before realpath, to catch non-existent targets)
  if (!isPathUnderRoots(normalized, roots)) {
    return { error: "path outside allowed roots", status: 403 };
  }
  // For existing paths, also check the realpath (resolve symlinks)
  try {
    const real = await fs.realpath(normalized);
    if (!isPathUnderRoots(real, roots)) {
      return { error: "path outside allowed roots (symlink)", status: 403 };
    }
    return { resolved: real };
  } catch {
    // File doesn't exist yet (e.g., upload target) — normalized check passed, allow it
    return { resolved: normalized };
  }
}

/* ── MIME ──────────────────────────────────────────────────────────── */

const MIME_MAP: Record<string, string> = {
  // Text
  ".txt": "text/plain; charset=utf-8",
  ".md": "text/markdown; charset=utf-8",
  ".markdown": "text/markdown; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".jsonl": "application/x-ndjson; charset=utf-8",
  ".yaml": "text/yaml; charset=utf-8",
  ".yml": "text/yaml; charset=utf-8",
  ".toml": "text/plain; charset=utf-8",
  ".xml": "application/xml; charset=utf-8",
  ".csv": "text/csv; charset=utf-8",
  ".tsv": "text/tab-separated-values; charset=utf-8",
  ".log": "text/plain; charset=utf-8",
  ".ini": "text/plain; charset=utf-8",
  ".cfg": "text/plain; charset=utf-8",
  ".conf": "text/plain; charset=utf-8",
  ".env": "text/plain; charset=utf-8",
  ".sh": "text/x-shellscript; charset=utf-8",
  ".bash": "text/x-shellscript; charset=utf-8",
  ".zsh": "text/x-shellscript; charset=utf-8",
  ".fish": "text/x-shellscript; charset=utf-8",
  // Code
  ".js": "text/javascript; charset=utf-8",
  ".mjs": "text/javascript; charset=utf-8",
  ".cjs": "text/javascript; charset=utf-8",
  ".ts": "text/typescript; charset=utf-8",
  ".tsx": "text/typescript; charset=utf-8",
  ".jsx": "text/javascript; charset=utf-8",
  ".py": "text/x-python; charset=utf-8",
  ".rs": "text/x-rust; charset=utf-8",
  ".go": "text/x-go; charset=utf-8",
  ".java": "text/x-java; charset=utf-8",
  ".c": "text/x-c; charset=utf-8",
  ".cpp": "text/x-c++; charset=utf-8",
  ".h": "text/x-c; charset=utf-8",
  ".hpp": "text/x-c++; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".html": "text/html; charset=utf-8",
  ".htm": "text/html; charset=utf-8",
  ".sql": "text/x-sql; charset=utf-8",
  ".r": "text/x-r; charset=utf-8",
  ".lua": "text/x-lua; charset=utf-8",
  ".rb": "text/x-ruby; charset=utf-8",
  ".swift": "text/x-swift; charset=utf-8",
  ".kt": "text/x-kotlin; charset=utf-8",
  ".scala": "text/x-scala; charset=utf-8",
  // Images
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".webp": "image/webp",
  ".gif": "image/gif",
  ".bmp": "image/bmp",
  ".svg": "image/svg+xml",
  ".ico": "image/x-icon",
  // Documents
  ".pdf": "application/pdf",
  // Archives
  ".zip": "application/zip",
  ".tar": "application/x-tar",
  ".gz": "application/gzip",
  ".7z": "application/x-7z-compressed",
};

function getMimeType(filePath: string): string {
  const ext = path.extname(filePath).toLowerCase();
  return MIME_MAP[ext] ?? "application/octet-stream";
}

function isTextMime(mime: string): boolean {
  return (
    mime.startsWith("text/") ||
    mime.startsWith("application/json") ||
    mime.startsWith("application/x-ndjson") ||
    mime.startsWith("application/xml")
  );
}

/* ── Helpers ──────────────────────────────────────────────────────── */

function sendJson(res: any, status: number, data: unknown): void {
  res.statusCode = status;
  res.setHeader("Content-Type", "application/json; charset=utf-8");
  res.end(JSON.stringify(data));
}

function sendError(res: any, status: number, message: string): void {
  sendJson(res, status, { error: message });
}

function getQueryParam(url: string, key: string): string {
  try {
    const u = new URL(url, "http://localhost");
    return u.searchParams.get(key) ?? "";
  } catch {
    return "";
  }
}

async function readBody(req: any): Promise<Buffer> {
  const chunks: Buffer[] = [];
  for await (const chunk of req) {
    chunks.push(typeof chunk === "string" ? Buffer.from(chunk) : chunk);
  }
  return Buffer.concat(chunks);
}

/* ── Multipart parser (minimal, no deps) ──────────────────────────── */

type MultipartFile = {
  filename: string;
  contentType: string;
  data: Buffer;
};

function parseMultipart(body: Buffer, contentType: string): MultipartFile[] {
  const boundaryMatch = contentType.match(/boundary=(?:"([^"]+)"|([^\s;]+))/);
  if (!boundaryMatch) return [];
  const boundary = boundaryMatch[1] ?? boundaryMatch[2] ?? "";
  const boundaryBuf = Buffer.from(`--${boundary}`);
  const files: MultipartFile[] = [];

  let pos = 0;
  // skip preamble
  const firstBoundary = body.indexOf(boundaryBuf, pos);
  if (firstBoundary < 0) return [];
  pos = firstBoundary + boundaryBuf.length;

  while (pos < body.length) {
    // Check for closing boundary
    if (body[pos] === 0x2d && body[pos + 1] === 0x2d) break; // --
    // Skip CRLF after boundary
    if (body[pos] === 0x0d && body[pos + 1] === 0x0a) pos += 2;
    else if (body[pos] === 0x0a) pos += 1;

    // Read headers
    const headerEnd = body.indexOf("\r\n\r\n", pos);
    if (headerEnd < 0) break;
    const headerBlock = body.slice(pos, headerEnd).toString("utf-8");
    pos = headerEnd + 4;

    // Find next boundary
    const nextBoundary = body.indexOf(boundaryBuf, pos);
    if (nextBoundary < 0) break;

    // Data is between pos and nextBoundary minus trailing CRLF
    let dataEnd = nextBoundary;
    if (dataEnd >= 2 && body[dataEnd - 2] === 0x0d && body[dataEnd - 1] === 0x0a) {
      dataEnd -= 2;
    } else if (dataEnd >= 1 && body[dataEnd - 1] === 0x0a) {
      dataEnd -= 1;
    }
    const data = body.slice(pos, dataEnd);
    pos = nextBoundary + boundaryBuf.length;

    // Parse headers
    const filenameMatch = headerBlock.match(/filename="([^"]+)"/);
    const ctMatch = headerBlock.match(/Content-Type:\s*(.+)/i);
    if (filenameMatch) {
      files.push({
        filename: filenameMatch[1],
        contentType: ctMatch?.[1]?.trim() ?? "application/octet-stream",
        data,
      });
    }
  }
  return files;
}

/* ── Max file size for reads ──────────────────────────────────────── */

const MAX_READ_BYTES = 100 * 1024 * 1024; // 100 MB

/* ── Plugin ───────────────────────────────────────────────────────── */

export function clawFsPlugin() {
  return {
    name: "clawui-fs",
    configureServer(
      server: { middlewares: { use: (handler: (req: any, res: any, next: () => void) => void) => void } },
    ) {
      server.middlewares.use(async (req, res, next) => {
        const url = req.url ?? "";
        if (!url.startsWith("/__claw/fs/")) {
          return next();
        }

        // CORS headers for dev
        res.setHeader("Access-Control-Allow-Origin", "*");
        res.setHeader("Access-Control-Allow-Methods", "GET, POST, DELETE, OPTIONS");
        res.setHeader("Access-Control-Allow-Headers", "Content-Type");
        if (req.method === "OPTIONS") {
          res.statusCode = 204;
          res.end();
          return;
        }

        const route = url.split("?")[0]?.replace("/__claw/fs/", "") ?? "";
        const config = loadConfig();

        try {
          switch (route) {
            /* ── GET /roots ────────────────────────────────────── */
            case "roots": {
              if (req.method === "GET") {
                sendJson(res, 200, { roots: config.roots });
                return;
              }
              if (req.method === "POST") {
                const body = await readBody(req);
                const payload = JSON.parse(body.toString("utf-8"));
                if (!Array.isArray(payload?.roots)) {
                  sendError(res, 400, "expected { roots: [...] }");
                  return;
                }
                // Validate all paths exist and are directories
                const newRoots: FsRoot[] = [];
                for (const r of payload.roots) {
                  if (!r?.path || typeof r.path !== "string") continue;
                  const label = typeof r.label === "string" ? r.label : path.basename(r.path);
                  try {
                    const stat = await fs.stat(r.path);
                    if (!stat.isDirectory()) continue;
                  } catch {
                    continue; // skip non-existent
                  }
                  newRoots.push({ label, path: path.resolve(r.path) });
                }
                config.roots = newRoots;
                saveConfig(config);
                sendJson(res, 200, { roots: config.roots });
                return;
              }
              sendError(res, 405, "method not allowed");
              return;
            }

            /* ── GET /list?path=... ────────────────────────────── */
            case "list": {
              if (req.method !== "GET") {
                sendError(res, 405, "method not allowed");
                return;
              }
              const dirPath = decodeURIComponent(getQueryParam(url, "path"));
              const result = await resolveAndValidate(dirPath, config.roots);
              if ("error" in result) {
                sendError(res, result.status, result.error);
                return;
              }
              const stat = await fs.stat(result.resolved);
              if (!stat.isDirectory()) {
                sendError(res, 400, "not a directory");
                return;
              }
              const entries = await fs.readdir(result.resolved, { withFileTypes: true });
              const items = await Promise.all(
                entries
                  .filter((e) => !e.name.startsWith(".")) // hide dotfiles by default
                  .map(async (entry) => {
                    const fullPath = path.join(result.resolved, entry.name);
                    const isDir = entry.isDirectory();
                    let size = 0;
                    let mtime = 0;
                    try {
                      const s = await fs.stat(fullPath);
                      size = s.size;
                      mtime = s.mtimeMs;
                    } catch {
                      // ignore stat errors (broken symlinks, etc.)
                    }
                    return {
                      name: entry.name,
                      path: fullPath,
                      isDirectory: isDir,
                      size,
                      mtime,
                      mime: isDir ? null : getMimeType(entry.name),
                    };
                  }),
              );
              // Sort: directories first, then alphabetical
              items.sort((a, b) => {
                if (a.isDirectory !== b.isDirectory) return a.isDirectory ? -1 : 1;
                return a.name.localeCompare(b.name, undefined, { sensitivity: "base" });
              });
              sendJson(res, 200, { path: result.resolved, items });
              return;
            }

            /* ── GET /list-all?path=...&showHidden=true ────────── */
            case "list-all": {
              if (req.method !== "GET") {
                sendError(res, 405, "method not allowed");
                return;
              }
              const dirPath = decodeURIComponent(getQueryParam(url, "path"));
              const showHidden = getQueryParam(url, "showHidden") === "true";
              const result = await resolveAndValidate(dirPath, config.roots);
              if ("error" in result) {
                sendError(res, result.status, result.error);
                return;
              }
              const stat = await fs.stat(result.resolved);
              if (!stat.isDirectory()) {
                sendError(res, 400, "not a directory");
                return;
              }
              const entries = await fs.readdir(result.resolved, { withFileTypes: true });
              const items = await Promise.all(
                entries
                  .filter((e) => showHidden || !e.name.startsWith("."))
                  .map(async (entry) => {
                    const fullPath = path.join(result.resolved, entry.name);
                    const isDir = entry.isDirectory();
                    let size = 0;
                    let mtime = 0;
                    try {
                      const s = await fs.stat(fullPath);
                      size = s.size;
                      mtime = s.mtimeMs;
                    } catch {}
                    return {
                      name: entry.name,
                      path: fullPath,
                      isDirectory: isDir,
                      size,
                      mtime,
                      mime: isDir ? null : getMimeType(entry.name),
                    };
                  }),
              );
              items.sort((a, b) => {
                if (a.isDirectory !== b.isDirectory) return a.isDirectory ? -1 : 1;
                return a.name.localeCompare(b.name, undefined, { sensitivity: "base" });
              });
              sendJson(res, 200, { path: result.resolved, items });
              return;
            }

            /* ── GET /read?path=... ────────────────────────────── */
            case "read": {
              if (req.method !== "GET") {
                sendError(res, 405, "method not allowed");
                return;
              }
              const filePath = decodeURIComponent(getQueryParam(url, "path"));
              const result = await resolveAndValidate(filePath, config.roots);
              if ("error" in result) {
                sendError(res, result.status, result.error);
                return;
              }
              const stat = await fs.stat(result.resolved);
              if (stat.isDirectory()) {
                sendError(res, 400, "cannot read a directory");
                return;
              }
              if (stat.size > MAX_READ_BYTES) {
                sendError(res, 413, "file too large");
                return;
              }
              const mime = getMimeType(result.resolved);
              const binary = await fs.readFile(result.resolved);
              res.statusCode = 200;
              res.setHeader("Content-Type", mime);
              res.setHeader("Content-Disposition", "inline");
              res.setHeader("Content-Length", binary.length.toString());
              res.setHeader("Cache-Control", "private, max-age=5");
              res.end(binary);
              return;
            }

            /* ── GET /stat?path=... ────────────────────────────── */
            case "stat": {
              if (req.method !== "GET") {
                sendError(res, 405, "method not allowed");
                return;
              }
              const filePath = decodeURIComponent(getQueryParam(url, "path"));
              const result = await resolveAndValidate(filePath, config.roots);
              if ("error" in result) {
                sendError(res, result.status, result.error);
                return;
              }
              const stat = await fs.stat(result.resolved);
              sendJson(res, 200, {
                path: result.resolved,
                isDirectory: stat.isDirectory(),
                isFile: stat.isFile(),
                size: stat.size,
                mtime: stat.mtimeMs,
                mime: stat.isFile() ? getMimeType(result.resolved) : null,
              });
              return;
            }

            /* ── POST /upload?path=... ─────────────────────────── */
            case "upload": {
              if (req.method !== "POST") {
                sendError(res, 405, "method not allowed");
                return;
              }
              const targetDir = decodeURIComponent(getQueryParam(url, "path"));
              const result = await resolveAndValidate(targetDir, config.roots);
              if ("error" in result) {
                sendError(res, result.status, result.error);
                return;
              }
              // Ensure target is a directory (or create it)
              try {
                const stat = await fs.stat(result.resolved);
                if (!stat.isDirectory()) {
                  sendError(res, 400, "target is not a directory");
                  return;
                }
              } catch {
                await fs.mkdir(result.resolved, { recursive: true });
              }

              const contentType = (req.headers["content-type"] ?? "") as string;
              const saved: string[] = [];

              if (contentType.includes("multipart/form-data")) {
                const body = await readBody(req);
                const files = parseMultipart(body, contentType);
                for (const file of files) {
                  const safeName = path.basename(file.filename);
                  if (!safeName) continue;
                  const dest = path.join(result.resolved, safeName);
                  // Validate dest is under roots
                  const destResult = await resolveAndValidate(dest, config.roots);
                  if ("error" in destResult) continue;
                  await fs.writeFile(destResult.resolved, file.data);
                  saved.push(destResult.resolved);
                }
              } else {
                // Raw body upload — need filename query param
                const filename = path.basename(decodeURIComponent(getQueryParam(url, "filename")));
                if (!filename) {
                  sendError(res, 400, "missing filename parameter for raw upload");
                  return;
                }
                const dest = path.join(result.resolved, filename);
                const destResult = await resolveAndValidate(dest, config.roots);
                if ("error" in destResult) {
                  sendError(res, destResult.status, destResult.error);
                  return;
                }
                const body = await readBody(req);
                await fs.writeFile(destResult.resolved, body);
                saved.push(destResult.resolved);
              }

              sendJson(res, 200, { uploaded: saved });
              return;
            }

            /* ── POST /mkdir?path=... ──────────────────────────── */
            case "mkdir": {
              if (req.method !== "POST") {
                sendError(res, 405, "method not allowed");
                return;
              }
              const dirPath = decodeURIComponent(getQueryParam(url, "path"));
              const result = await resolveAndValidate(dirPath, config.roots);
              if ("error" in result) {
                sendError(res, result.status, result.error);
                return;
              }
              await fs.mkdir(result.resolved, { recursive: true });
              sendJson(res, 200, { created: result.resolved });
              return;
            }

            /* ── DELETE /delete?path=... ───────────────────────── */
            case "delete": {
              if (req.method !== "DELETE") {
                sendError(res, 405, "method not allowed");
                return;
              }
              const filePath = decodeURIComponent(getQueryParam(url, "path"));
              const result = await resolveAndValidate(filePath, config.roots);
              if ("error" in result) {
                sendError(res, result.status, result.error);
                return;
              }
              // Safety: prevent deleting root dirs themselves
              for (const root of config.roots) {
                if (path.resolve(root.path) === result.resolved) {
                  sendError(res, 403, "cannot delete a root directory");
                  return;
                }
              }
              const stat = await fs.stat(result.resolved);
              if (stat.isDirectory()) {
                await fs.rm(result.resolved, { recursive: true });
              } else {
                await fs.unlink(result.resolved);
              }
              sendJson(res, 200, { deleted: result.resolved });
              return;
            }

            /* ── POST /rename?from=...&to=... ──────────────────── */
            case "rename": {
              if (req.method !== "POST") {
                sendError(res, 405, "method not allowed");
                return;
              }
              const fromPath = decodeURIComponent(getQueryParam(url, "from"));
              const toPath = decodeURIComponent(getQueryParam(url, "to"));
              const fromResult = await resolveAndValidate(fromPath, config.roots);
              if ("error" in fromResult) {
                sendError(res, fromResult.status, fromResult.error);
                return;
              }
              const toResult = await resolveAndValidate(toPath, config.roots);
              if ("error" in toResult) {
                sendError(res, toResult.status, toResult.error);
                return;
              }
              await fs.rename(fromResult.resolved, toResult.resolved);
              sendJson(res, 200, { from: fromResult.resolved, to: toResult.resolved });
              return;
            }

            /* ── PUT /write?path=... ──────────────────────────── */
            case "write": {
              if (req.method !== "PUT") {
                sendError(res, 405, "method not allowed");
                return;
              }
              const writePath = decodeURIComponent(getQueryParam(url, "path"));
              const result = await resolveAndValidate(writePath, config.roots);
              if ("error" in result) {
                sendError(res, result.status, result.error);
                return;
              }
              // Read body
              const chunks: Buffer[] = [];
              req.on("data", (chunk: Buffer) => chunks.push(chunk));
              await new Promise<void>((resolve) => req.on("end", resolve));
              const body = Buffer.concat(chunks);
              await fs.writeFile(result.resolved, body);
              const stat = await fs.stat(result.resolved);
              sendJson(res, 200, { written: result.resolved, size: stat.size });
              return;
            }

            default:
              sendError(res, 404, `unknown fs route: ${route}`);
              return;
          }
        } catch (err: unknown) {
          const code = (err as NodeJS.ErrnoException)?.code;
          if (code === "ENOENT") {
            sendError(res, 404, "not found");
          } else if (code === "EACCES" || code === "EPERM") {
            sendError(res, 403, "permission denied");
          } else {
            sendError(res, 500, String(err));
          }
        }
      });
    },
  };
}
