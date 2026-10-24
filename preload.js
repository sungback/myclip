const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("myclip", {
  started: () => ipcRenderer.send("selection-started"),
  finish: (rect) => ipcRenderer.send("selection-finished", rect),
  cancel: () => ipcRenderer.send("selection-cancelled"),
});
