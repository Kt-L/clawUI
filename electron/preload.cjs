const { contextBridge, ipcRenderer } = require("electron");

function resolveHomeDir() {
  const fromEnv = process.env.HOME || process.env.USERPROFILE || process.env.HOMEPATH || "";
  if (typeof fromEnv === "string" && fromEnv.trim()) {
    return fromEnv.trim().replace(/[\\/]+$/, "");
  }
  try {
    const os = require("node:os");
    const fromOs = os.homedir();
    if (typeof fromOs === "string" && fromOs.trim()) {
      return fromOs.trim().replace(/[\\/]+$/, "");
    }
  } catch {
    // ignore
  }
  return "";
}

function resolveWorkspaceDir(homeDir) {
  const fromEnv = process.env.OPENCLAW_WORKSPACE_DIR || process.env.CLAW_WORKSPACE_DIR || "";
  if (typeof fromEnv === "string" && fromEnv.trim()) {
    return fromEnv.trim().replace(/[\\/]+$/, "");
  }
  const normalizedHome = (homeDir || "").replace(/[\\/]+$/, "");
  if (normalizedHome) {
    return `${normalizedHome}/.openclaw/workspace`;
  }
  const user = process.env.USER || process.env.LOGNAME || "";
  if (user) {
    return `/Users/${user}/.openclaw/workspace`;
  }
  return ".openclaw/workspace";
}

const homeDir = resolveHomeDir();
const workspaceDir = resolveWorkspaceDir(homeDir);

contextBridge.exposeInMainWorld("desktopInfo", {
  isDesktop: true,
  platform: process.platform,
  versions: process.versions,
  homeDir,
  workspaceDir,
  beep: () => ipcRenderer.invoke("desktop:beep"),
  readImageFile: (filePath) => ipcRenderer.invoke("desktop:read-image-file", filePath),
  fetchImageUrl: (url) => ipcRenderer.invoke("desktop:fetch-image-url", url),
  setGatewayUrl: (url) => ipcRenderer.invoke("desktop:set-gateway-url", url),
});
