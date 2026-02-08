const fs = require("node:fs");
const path = require("node:path");
const { app, BrowserWindow, shell, ipcMain } = require("electron");

const WINDOW_WIDTH = 1280;
const WINDOW_HEIGHT = 820;

ipcMain.handle("desktop:beep", () => {
  try {
    shell.beep();
    return true;
  } catch {
    return false;
  }
});

function createMainWindow() {
  const mainWindow = new BrowserWindow({
    width: WINDOW_WIDTH,
    height: WINDOW_HEIGHT,
    minWidth: 1000,
    minHeight: 640,
    autoHideMenuBar: true,
    webPreferences: {
      preload: path.join(__dirname, "preload.cjs"),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });

  const entryPath = path.join(__dirname, "..", "dist", "index.html");
  if (!fs.existsSync(entryPath)) {
    throw new Error(`Desktop bundle is missing: ${entryPath}`);
  }

  mainWindow.loadFile(entryPath);

  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    shell.openExternal(url);
    return { action: "deny" };
  });
}

app.whenReady().then(() => {
  createMainWindow();

  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createMainWindow();
    }
  });
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") {
    app.quit();
  }
});
