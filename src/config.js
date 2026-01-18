const os = require('os');
const path = require('path');

const IS_WINDOWS = os.platform() === 'win32';
const IS_LINUX = os.platform() === 'linux';
const IS_MAC = os.platform() === 'darwin';

const ARCH = os.arch() === 'x64' ? 'amd64' : (os.arch() === 'arm64' ? 'arm64' : 'amd64');
const PLATFORM_STR = IS_WINDOWS ? 'windows' : (IS_LINUX ? 'linux' : 'darwin');

const JAVA_EXE = IS_WINDOWS ? 'java.exe' : 'java';
const GAME_EXE = IS_WINDOWS ? 'HytaleClient.exe' : 'HytaleClient';
const BUTLER_EXE = IS_WINDOWS ? 'butler.exe' : 'butler';

const APPDATA = IS_WINDOWS ? process.env.APPDATA : path.join(os.homedir(), '.local/share');

const LAUNCHER_DIR = path.join(APPDATA, 'TaleLauncher');
const GAME_BASE_DIR = path.join(APPDATA, 'Hytale');
const GAME_INSTALL_DIR = path.join(GAME_BASE_DIR, 'install');
const CACHE_DIR = path.join(LAUNCHER_DIR, 'cache');
const BUTLER_DIR = path.join(LAUNCHER_DIR, 'butler');

const DEFAULT_BRANCH = 'release';

const PATCH_BASE_URL = `https://game-patches.hytale.com/patches/${PLATFORM_STR}/${ARCH}`;
const JRE_INFO_URL = 'https://launcher.hytale.com/version/{branch}/jre.json';
const BUTLER_URL = `https://broth.itch.zone/butler/${PLATFORM_STR}-${ARCH}/LATEST/archive/default`;

const CONSECUTIVE_MISSES_TO_STOP = 5;
const DOWNLOAD_CHUNK_SIZE = 81920;
const HTTP_TIMEOUT = 30000; // ms

function getGameDir(branch = DEFAULT_BRANCH) {
    return path.join(GAME_INSTALL_DIR, branch, 'package', 'game', 'latest');
}

function getJreDir(branch = DEFAULT_BRANCH) {
    return path.join(GAME_INSTALL_DIR, branch, 'package', 'jre', 'latest');
}

function getUserDataDir() {
    return path.join(GAME_BASE_DIR, 'UserData');
}

const MODS_DIR = path.join(getUserDataDir(), 'Mods');
const SAVES_DIR = path.join(getUserDataDir(), 'Saves');
const SETTINGS_FILE = path.join(LAUNCHER_DIR, 'settings.json');
const GAME_LOG_FILE = path.join(LAUNCHER_DIR, 'game.log');

module.exports = {
    IS_WINDOWS,
    IS_LINUX,
    IS_MAC,
    ARCH,
    PLATFORM_STR,
    JAVA_EXE,
    GAME_EXE,
    BUTLER_EXE,
    LAUNCHER_DIR,
    GAME_BASE_DIR,
    GAME_INSTALL_DIR,
    CACHE_DIR,
    BUTLER_DIR,
    DEFAULT_BRANCH,
    PATCH_BASE_URL,
    JRE_INFO_URL,
    BUTLER_URL,
    CONSECUTIVE_MISSES_TO_STOP,
    DOWNLOAD_CHUNK_SIZE,
    HTTP_TIMEOUT,
    getGameDir,
    getJreDir,
    getUserDataDir,
    MODS_DIR,
    SAVES_DIR,
    SETTINGS_FILE,
    GAME_LOG_FILE
};
