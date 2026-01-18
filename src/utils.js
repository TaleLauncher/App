const fs = require('fs-extra');
const path = require('path');
const axios = require('axios');
const AdmZip = require('adm-zip');
const { v4: uuidv4 } = require('uuid');
const config = require('./config');

async function downloadFile(url, destPath, progressCallback = null) {
    await fs.ensureDir(path.dirname(destPath));
    const tempPath = destPath + '.tmp';

    let existingBytes = 0;
    if (await fs.pathExists(tempPath)) {
        const stats = await fs.stat(tempPath);
        existingBytes = stats.size;
    }

    const headers = {
        'User-Agent': 'HytaleLauncher/1.0'
    };
    if (existingBytes > 0) {
        headers['Range'] = `bytes=${existingBytes}-`;
    }

    try {
        const response = await axios({
            method: 'get',
            url: url,
            headers: headers,
            responseType: 'stream',
            timeout: 0 // No timeout for downloads
        });

        if (existingBytes > 0 && response.status !== 206) {
            existingBytes = 0;
            await fs.remove(tempPath);
        }

        let totalSize = parseInt(response.headers['content-length'] || 0);
        totalSize += existingBytes;

        const mode = existingBytes > 0 ? 'a' : 'w';
        let downloaded = existingBytes;

        const writer = fs.createWriteStream(tempPath, { flags: mode });

        response.data.on('data', (chunk) => {
            downloaded += chunk.length;
            if (progressCallback && totalSize > 0) {
                progressCallback(downloaded, totalSize);
            }
        });

        response.data.pipe(writer);

        return new Promise((resolve, reject) => {
            writer.on('finish', async () => {
                if (await fs.pathExists(destPath)) {
                    await fs.remove(destPath);
                }
                await fs.rename(tempPath, destPath);
                resolve();
            });
            writer.on('error', reject);
        });
    } catch (error) {
        if (error.response && error.response.status === 416) {
            // Range not satisfiable usually means we already have the full file
            if (await fs.pathExists(tempPath)) {
                await fs.rename(tempPath, destPath);
                return;
            }
        }
        throw error;
    }
}

function extractZip(archivePath, destDir) {
    fs.ensureDirSync(destDir);
    const zip = new AdmZip(archivePath);
    zip.extractAllTo(destDir, true);
}

function flattenDirectory(directory) {
    const items = fs.readdirSync(directory);
    const subdirs = items.map(i => path.join(directory, i)).filter(i => fs.statSync(i).isDirectory());

    if (subdirs.length === 1) {
        const subdir = subdirs[0];
        const subdirItems = fs.readdirSync(subdir);
        for (const item of subdirItems) {
            const src = path.join(subdir, item);
            const dest = path.join(directory, item);
            if (fs.existsSync(dest)) {
                if (fs.statSync(dest).isDirectory()) {
                    fs.removeSync(dest);
                } else {
                    fs.unlinkSync(dest);
                }
            }
            fs.renameSync(src, dest);
        }
        fs.rmdirSync(subdir);
    }
}

function getOrCreateUuid(playerName) {
    const uuidFile = path.join(config.LAUNCHER_DIR, 'players.json');
    let players = {};

    if (fs.existsSync(uuidFile)) {
        try {
            players = fs.readJsonSync(uuidFile);
        } catch (e) { }
    }

    const key = playerName.toLowerCase();

    if (!players[key]) {
        players[key] = uuidv4();
        try {
            fs.writeJsonSync(uuidFile, players, { spaces: 2 });
        } catch (e) { }
    } else if (players[key].includes('-')) {
        players[key] = players[key].replace(/-/g, '');
        try {
            fs.writeJsonSync(uuidFile, players, { spaces: 2 });
        } catch (e) { }
    }

    return players[key];
}

async function checkUrlExists(url) {
    try {
        const response = await axios.get(url, {
            headers: {
                'User-Agent': 'HytaleLauncher/1.0',
                'Range': 'bytes=0-0'
            },
            timeout: 10000,
            validateStatus: (status) => (status >= 200 && status < 300) || status === 206
        });
        return true;
    } catch (error) {
        console.log(`[DEBUG] Error checking URL ${url}: ${error.message}`);
        return false;
    }
}

async function toggleOnlineMode(enable, progressCallback = null) {
    const gameDir = config.getGameDir('release');
    const clientPath = path.join(gameDir, 'Client', 'HytaleClient.exe');
    const backupDir = path.join(gameDir, 'Backup');
    const backupPath = path.join(backupDir, 'HytaleClient.exe');

    if (enable) {
        // Enable Online Mode
        if (await fs.pathExists(clientPath)) {
            await fs.ensureDir(backupDir);
            await fs.copy(clientPath, backupPath, { overwrite: true });
        }

        const downloadUrl = 'https://github.com/TaleLauncher/App/releases/download/Dev/HytaleClient.exe';
        await downloadFile(downloadUrl, clientPath, progressCallback);

        SettingsManager.setSetting('online', true);
    } else {
        // Disable Online Mode
        if (await fs.pathExists(backupPath)) {
            if (await fs.pathExists(clientPath)) {
                await fs.remove(clientPath);
            }
            await fs.move(backupPath, clientPath);
        }

        SettingsManager.setSetting('online', false);
    }
}

async function changeBackground(filePath) {
    const ext = path.extname(filePath);
    const bgPath = path.join(config.LAUNCHER_DIR, `custom_bg${ext}`);
    await fs.ensureDir(config.LAUNCHER_DIR);
    await fs.copy(filePath, bgPath, { overwrite: true });
    return bgPath;
}

class SettingsManager {
    static loadSettings() {
        if (fs.existsSync(config.SETTINGS_FILE)) {
            try {
                return fs.readJsonSync(config.SETTINGS_FILE);
            } catch (e) {
                console.error(`Error loading settings: ${e}`);
            }
        }
        return {};
    }

    static saveSettings(settings) {
        try {
            fs.ensureDirSync(path.dirname(config.SETTINGS_FILE));
            fs.writeJsonSync(config.SETTINGS_FILE, settings, { spaces: 2 });
        } catch (e) {
            console.error(`Error saving settings: ${e}`);
        }
    }

    static getSetting(key, defaultValue = null) {
        const settings = this.loadSettings();
        return settings[key] !== undefined ? settings[key] : defaultValue;
    }

    static setSetting(key, value) {
        const settings = this.loadSettings();
        settings[key] = value;
        this.saveSettings(settings);
    }
}

module.exports = {
    downloadFile,
    extractZip,
    flattenDirectory,
    getOrCreateUuid,
    checkUrlExists,
    toggleOnlineMode,
    changeBackground,
    SettingsManager
};
