const { app, BrowserWindow, ipcMain, shell } = require('electron');
const { autoUpdater } = require('electron-updater');
const path = require('path');
const config = require('./src/config');
const { GameLauncher } = require('./src/launcher');
const { ModsManager, WorldsManager } = require('./src/managers');
const { SettingsManager, toggleOnlineMode } = require('./src/utils');

let mainWindow;
const launcher = new GameLauncher();

function createWindow() {
    mainWindow = new BrowserWindow({
        width: 1200,
        height: 700,
        resizable: false,
        frame: false,
        transparent: true,
        icon: path.join(__dirname, 'art/icon.png'),
        webPreferences: {
            preload: path.join(__dirname, 'preload.js'),
            nodeIntegration: false,
            contextIsolation: true
        }
    });

    mainWindow.loadFile('index.html');
    mainWindow.center();

    // IPC Handlers
    launcher.onProgress = (value) => {
        mainWindow.webContents.send('launcher-progress', value);
    };

    launcher.onStatus = (message) => {
        mainWindow.webContents.send('launcher-status', message);
    };
}

app.whenReady().then(() => {
    createWindow();
    autoUpdater.checkForUpdatesAndNotify();

    app.on('activate', () => {
        if (BrowserWindow.getAllWindows().length === 0) createWindow();
    });
});

app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') app.quit();
});

// IPC Handlers
ipcMain.on('window-control', (event, action) => {
    if (!mainWindow) return;
    switch (action) {
        case 'minimize': mainWindow.minimize(); break;
        case 'close': mainWindow.close(); break;
    }
});

ipcMain.handle('get-versions', async () => {
    return await launcher.getAvailableVersions();
});

ipcMain.handle('launch-game', async (event, { nickname, version }) => {
    try {
        await launcher.launchGameAsync(nickname, version);
        return { success: true };
    } catch (error) {
        return { success: false, error: error.message };
    }
});

ipcMain.handle('get-settings', (event, key, defaultValue) => {
    return SettingsManager.getSetting(key, defaultValue);
});

ipcMain.handle('translate', (event, { key, args }) => {
    const { tr } = require('./src/locales');
    return tr(key, ...args);
});

ipcMain.on('set-setting', (event, { key, value }) => {
    SettingsManager.setSetting(key, value);
});

ipcMain.handle('get-mods', () => {
    return ModsManager.getMods();
});

ipcMain.handle('delete-mod', (event, modName) => {
    ModsManager.deleteMod(modName);
    return ModsManager.getMods();
});

ipcMain.handle('upload-mod', async (event, filePath) => {
    await ModsManager.uploadMod(filePath);
    return ModsManager.getMods();
});

ipcMain.handle('get-worlds', () => {
    return WorldsManager.getWorlds();
});

ipcMain.handle('delete-world', (event, worldName) => {
    WorldsManager.deleteWorld(worldName);
    return WorldsManager.getWorlds();
});

ipcMain.handle('import-world', async (event, zipPath) => {
    await WorldsManager.importWorld(zipPath);
    return WorldsManager.getWorlds();
});

ipcMain.handle('rename-world', (event, { oldName, newName }) => {
    try {
        WorldsManager.renameWorld(oldName, newName);
        return { success: true, worlds: WorldsManager.getWorlds() };
    } catch (error) {
        return { success: false, error: error.message };
    }
});

ipcMain.handle('toggle-online-mode', async (event, enable) => {
    try {
        await toggleOnlineMode(enable, (downloaded, total) => {
            const percent = Math.round((downloaded / total) * 100);
            mainWindow.webContents.send('launcher-progress', percent);
            mainWindow.webContents.send('launcher-status', `Downloading Online Client: ${percent}%`);
        });
        return { success: true };
    } catch (error) {
        return { success: false, error: error.message };
    }
});

ipcMain.on('open-url', (event, url) => {
    shell.openExternal(url);
});
