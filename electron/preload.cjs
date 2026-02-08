const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("desktopInfo", {
  isDesktop: true,
  platform: process.platform,
  versions: process.versions,
  beep: () => ipcRenderer.invoke("desktop:beep"),
});
