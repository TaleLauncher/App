const fs = require('fs-extra');
const path = require('path');
const axios = require('axios');
const { spawn } = require('child_process');
const config = require('./config');
const utils = require('./utils');
const { tr } = require('./locales');

class GameVersion {
    constructor(name, version, branch = config.DEFAULT_BRANCH) {
        this.name = name;
        this.version = version;
        this.branch = branch;
        this.isLatest = false;
    }

    toString() {
        return this.name;
    }
}

class GameLauncher {
    constructor() {
        this.onProgress = null;
        this.onStatus = null;
        this.branch = config.DEFAULT_BRANCH;
    }

    _setStatus(message) {
        if (this.onStatus) {
            this.onStatus(message);
        }
    }

    _setProgress(value) {
        if (this.onProgress) {
            this.onProgress(value);
        }
    }

    async getAvailableVersions() {
        console.log(`[DEBUG] Checking versions from: ${config.PATCH_BASE_URL}/${this.branch}/0/X.pwr`);
        this._setStatus(tr("status.checking_versions"));
        const versions = [];

        let consecutiveMisses = 0;
        let ver = 1;
        let maxVersion = 0;

        while (consecutiveMisses < config.CONSECUTIVE_MISSES_TO_STOP) {
            const url = `${config.PATCH_BASE_URL}/${this.branch}/0/${ver}.pwr`;
            console.log(`[DEBUG] Checking version ${ver}: ${url}`);

            const exists = await utils.checkUrlExists(url);
            console.log(`[DEBUG] Version ${ver} exists: ${exists}`);

            if (exists) {
                maxVersion = ver;
                consecutiveMisses = 0;
            } else {
                consecutiveMisses += 1;
            }

            this._setProgress(Math.min(ver * 5, 100));
            ver += 1;
        }

        console.log(`[DEBUG] Max version found: ${maxVersion}`);

        for (let v = 1; v <= maxVersion; v++) {
            versions.push(new GameVersion(
                tr("versions.version_fmt", v),
                v,
                this.branch
            ));
        }

        if (versions.length > 0) {
            const latest = new GameVersion(
                tr("versions.latest"),
                maxVersion,
                this.branch
            );
            latest.isLatest = true;
            versions.unshift(latest);
        } else {
            console.log("[DEBUG] No versions found, using fallback");
            const latest = new GameVersion(
                tr("versions.latest"),
                1,
                this.branch
            );
            latest.isLatest = true;
            versions.push(latest);
        }

        this._setProgress(100);
        return versions;
    }

    async downloadJre() {
        const jreDir = config.getJreDir(this.branch);
        const javaPath = path.join(jreDir, 'bin', config.JAVA_EXE);

        if (fs.existsSync(javaPath)) {
            console.log(`[Launcher] JRE already installed at ${javaPath}`);
            this._setStatus(tr("status.java_installed"));
            this._setProgress(100);
            return;
        }

        console.log(`[Launcher] JRE not found at ${javaPath}, starting download...`);
        this._setStatus(tr("status.downloading_java"));

        try {
            const jreUrl = config.JRE_INFO_URL.replace('{branch}', this.branch);
            console.log(`[Launcher] Fetching JRE info from ${jreUrl}`);
            const response = await axios.get(jreUrl, {
                headers: { 'User-Agent': 'HytaleLauncher/1.0' }
            });
            const jreData = response.data;

            const downloadInfo = jreData.download_url[config.PLATFORM_STR][config.ARCH];
            if (!downloadInfo) {
                throw new Error(`No JRE download info found for ${config.PLATFORM_STR} ${config.ARCH}`);
            }

            const jreDownloadUrl = downloadInfo.url;
            console.log(`[Launcher] Downloading JRE from ${jreDownloadUrl}`);
            const cachePath = path.join(config.CACHE_DIR, path.basename(jreDownloadUrl));

            await utils.downloadFile(jreDownloadUrl, cachePath, (downloaded, total) => {
                this._setProgress((downloaded / total) * 100);
            });

            this._setStatus(tr("status.extracting_java"));
            console.log(`[Launcher] Extracting JRE to ${jreDir}`);
            fs.ensureDirSync(jreDir);
            utils.extractZip(cachePath, jreDir);
            utils.flattenDirectory(jreDir);

            fs.removeSync(cachePath);

            if (fs.existsSync(javaPath)) {
                this._setStatus("Java installed");
                console.log(`[Launcher] JRE installed successfully at ${javaPath}`);
            } else {
                throw new Error(`JRE extraction failed: ${javaPath} still not found`);
            }

        } catch (e) {
            console.error(`[Launcher] JRE download/install error: ${e.stack}`);
            this._setStatus(tr("status.java_install_error", e.message));
            throw e; // Rethrow so launchGameAsync knows it failed
        }
    }

    async downloadGame(version) {
        const gameDir = config.getGameDir(this.branch);
        const clientPath = path.join(gameDir, 'Client', config.GAME_EXE);
        const versionFile = path.join(gameDir, '.version');

        if (fs.existsSync(versionFile) && fs.existsSync(clientPath)) {
            try {
                const installedVer = parseInt(fs.readFileSync(versionFile, 'utf8').trim());
                if (installedVer === version.version) {
                    this._setStatus(tr("status.game_installed"));
                    this._setProgress(100);
                    return;
                }
            } catch (e) { }
        }

        fs.ensureDirSync(gameDir);

        const pwrFile = `${version.version}.pwr`;
        const pwrUrl = `${config.PATCH_BASE_URL}/${this.branch}/0/${pwrFile}`;
        const cachePath = path.join(config.CACHE_DIR, `${this.branch}_0_${pwrFile}`);

        this._setStatus(tr("status.downloading_version", version.version));

        await utils.downloadFile(pwrUrl, cachePath, (downloaded, total) => {
            this._setProgress((downloaded / total) * 100);
        });

        this._setStatus(tr("status.applying_patch"));
        await this._applyPatch(cachePath, gameDir);

        fs.writeFileSync(versionFile, version.version.toString());
        this._setStatus(tr("status.game_installed_success"));
    }

    async _ensureButler() {
        const butlerPath = path.join(config.BUTLER_DIR, config.BUTLER_EXE);

        if (fs.existsSync(butlerPath)) {
            return butlerPath;
        }

        this._setStatus(tr("status.downloading_butler"));

        const cachePath = path.join(config.CACHE_DIR, 'butler.zip');
        await utils.downloadFile(config.BUTLER_URL, cachePath);

        this._setStatus(tr("status.extracting_butler"));
        fs.ensureDirSync(config.BUTLER_DIR);
        utils.extractZip(cachePath, config.BUTLER_DIR);
        utils.flattenDirectory(config.BUTLER_DIR);
        fs.removeSync(cachePath);

        if (!config.IS_WINDOWS) {
            if (fs.existsSync(butlerPath)) {
                fs.chmodSync(butlerPath, 0o755);
            }
        }

        if (!fs.existsSync(butlerPath)) {
            throw new Error(`Butler executable not found at ${butlerPath} after extraction.`);
        }

        return butlerPath;
    }

    async _applyPatch(pwrPath, gameDir) {
        const butlerPath = await this._ensureButler();
        const stagingDir = path.join(gameDir, 'staging-temp');

        if (fs.existsSync(stagingDir)) {
            fs.removeSync(stagingDir);
        }

        fs.ensureDirSync(stagingDir);
        fs.ensureDirSync(gameDir);

        return new Promise((resolve, reject) => {
            console.log(`[DEBUG] Spawning: ${butlerPath} apply --verbose --staging-dir ${stagingDir} ${pwrPath} ${gameDir}`);
            const child = spawn(butlerPath, [
                'apply',
                '--verbose',
                '--staging-dir', stagingDir,
                pwrPath,
                gameDir
            ]);

            let stdout = '';
            let stderr = '';

            child.stdout.on('data', (data) => {
                stdout += data.toString();
            });

            child.stderr.on('data', (data) => {
                const msg = data.toString();
                stderr += msg;
                console.error(`[Butler Error] ${msg}`);
            });

            child.on('error', (err) => {
                console.error(`[Butler Spawn Error] ${err.message}`);
                reject(new Error(`Failed to start Butler: ${err.message}`));
            });

            child.on('close', (code) => {
                if (fs.existsSync(stagingDir)) {
                    fs.removeSync(stagingDir);
                }

                if (code !== 0) {
                    const errorDetails = stderr || stdout || 'Unknown error';
                    console.error(`[Butler Failure] Code ${code}. Details: ${errorDetails}`);
                    reject(new Error(`Butler error (code ${code}): ${errorDetails}`));
                } else {
                    resolve();
                }
            });
        });
    }

    async _getSystemJavaPath() {
        return new Promise((resolve) => {
            const cmd = config.IS_WINDOWS ? 'where' : 'which';
            const child = spawn(cmd, [config.JAVA_EXE]);
            let output = '';
            child.stdout.on('data', (data) => output += data.toString());
            child.on('close', (code) => {
                if (code === 0 && output.trim()) {
                    resolve(output.split('\n')[0].trim());
                } else {
                    resolve(config.JAVA_EXE);
                }
            });
        });
    }

    async launchGame(playerName, version) {
        const gameDir = config.getGameDir(this.branch);
        const clientPath = path.join(gameDir, 'Client', config.GAME_EXE);

        if (!fs.existsSync(clientPath)) {
            throw new Error(tr("status.game_not_installed") + `: ${clientPath}`);
        }

        let javaPath = path.join(config.getJreDir(this.branch), 'bin', config.JAVA_EXE);
        if (!fs.existsSync(javaPath)) {
            console.warn(`[Launcher] Internal JRE not found at ${javaPath}, searching for system Java...`);
            javaPath = await this._getSystemJavaPath();
        }

        const playerUuid = utils.getOrCreateUuid(playerName);
        const userDataDir = config.getUserDataDir();
        fs.ensureDirSync(userDataDir);

        const args = [
            '--app-dir', gameDir,
            '--java-exec', javaPath,
            '--user-dir', userDataDir,
            '--auth-mode', 'offline',
            '--uuid', playerUuid,
            '--name', playerName
        ];

        console.log(`[Launcher] Launching game: ${clientPath} ${args.join(' ')}`);

        // Setup logging
        const logStream = fs.createWriteStream(config.GAME_LOG_FILE, { flags: 'w' });
        logStream.write(`Launching Hytale at ${new Date().toISOString()}\n`);
        logStream.write(`Command: ${clientPath} ${args.join(' ')}\n\n`);

        const gameProcess = spawn(clientPath, args, {
            cwd: path.dirname(clientPath),
            detached: true,
            stdio: ['ignore', 'pipe', 'pipe']
        });

        gameProcess.stdout.pipe(logStream);
        gameProcess.stderr.pipe(logStream);

        gameProcess.on('error', (err) => {
            const msg = `Failed to start game process: ${err.message}`;
            console.error(`[Launcher] ${msg}`);
            logStream.write(`\nERROR: ${msg}\n`);
            this._setStatus(`Error: ${msg}`);
        });

        gameProcess.unref();

        this._setStatus(tr("status.game_launched"));
        console.log(`[Launcher] Game process spawned with PID: ${gameProcess.pid}`);
    }

    async launchGameAsync(playerName, version) {
        try {
            try {
                await this.downloadJre();
            } catch (jreError) {
                console.warn(`[Launcher] Failed to download JRE, will try system Java: ${jreError.message}`);
            }
            await this.downloadGame(version);
            await this.launchGame(playerName, version);
        } catch (e) {
            console.error(`[Launcher] Launch failed: ${e.stack}`);
            this._setStatus(`Error: ${e.message}`);
            throw e;
        }
    }
}

module.exports = {
    GameLauncher,
    GameVersion
};
