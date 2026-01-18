const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('electronAPI', {
    windowControl: (action) => ipcRenderer.send('window-control', action),
    getVersions: () => ipcRenderer.invoke('get-versions'),
    launchGame: (data) => ipcRenderer.invoke('launch-game', data),
    getSetting: (key, defaultValue) => ipcRenderer.invoke('get-settings', key, defaultValue),
    setSetting: (key, value) => ipcRenderer.send('set-setting', { key, value }),
    translate: (key, ...args) => ipcRenderer.invoke('translate', { key, args }),
    getMods: () => ipcRenderer.invoke('get-mods'),
    deleteMod: (name) => ipcRenderer.invoke('delete-mod', name),
    uploadMod: (path) => ipcRenderer.invoke('upload-mod', path),
    getWorlds: () => ipcRenderer.invoke('get-worlds'),
    deleteWorld: (name) => ipcRenderer.invoke('delete-world', name),
    importWorld: (path) => ipcRenderer.invoke('import-world', path),
    renameWorld: (data) => ipcRenderer.invoke('rename-world', data),
    toggleOnlineMode: (enable) => ipcRenderer.invoke('toggle-online-mode', enable),
    changeBackground: (filePath) => ipcRenderer.invoke('change-background', filePath),
    getLauncherDir: () => ipcRenderer.invoke('get-launcher-dir'),
    openUrl: (url) => ipcRenderer.send('open-url', url),

    // Listeners
    onProgress: (callback) => ipcRenderer.on('launcher-progress', (event, value) => callback(value)),
    onStatus: (callback) => ipcRenderer.on('launcher-status', (event, message) => callback(message))
});
