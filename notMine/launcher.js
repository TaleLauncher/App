const fs = require('fs');
const path = require('path');
const os = require('os');
const { exec, execFile, spawn } = require('child_process');
const { promisify } = require('util');
const axios = require('axios');
const AdmZip = require('adm-zip');
const { v4: uuidv4 } = require('uuid');
const crypto = require('crypto');

const execAsync = promisify(exec);
const execFileAsync = promisify(execFile);
const JAVA_EXECUTABLE = 'java' + (process.platform === 'win32' ? '.exe' : '');

function isWaylandSession() {
  if (process.platform !== 'linux') {
    return false;
  }
  
  const sessionType = process.env.XDG_SESSION_TYPE;
  if (sessionType && sessionType.toLowerCase() === 'wayland') {
    return true;
  }
  
  if (process.env.WAYLAND_DISPLAY) {
    return true;
  }
  
  try {
    const execSync = require('child_process').execSync;
    const sessionId = process.env.XDG_SESSION_ID;
    if (sessionId) {
      const output = execSync(`loginctl show-session ${sessionId} -p Type`, { encoding: 'utf8' });
      if (output && output.toLowerCase().includes('wayland')) {
        return true;
      }
    }
  } catch (err) {
  }
  
  return false;
}

function setupWaylandEnvironment() {
  if (process.platform !== 'linux') {
    return {};
  }
  
  if (!isWaylandSession()) {
    console.log('Detected X11 session, using default environment');
    return {};
  }
  
  console.log('Detected Wayland session, configuring environment...');
  
  const envVars = {
    SDL_VIDEODRIVER: 'wayland',
  };
  
  console.log('Wayland environment variables:', envVars);
  return envVars;
}

function getAppDir() {
  const home = os.homedir();
  if (process.platform === 'win32') {
    return path.join(home, 'AppData', 'Local', 'HytaleF2P');
  } else if (process.platform === 'darwin') {
    return path.join(home, 'Library', 'Application Support', 'HytaleF2P');
  } else {
    return path.join(home, '.hytalef2p');
  }
}

const DEFAULT_APP_DIR = getAppDir();
const CONFIG_FILE = path.join(DEFAULT_APP_DIR, 'config.json');

function getResolvedAppDir(customPath) {
  if (customPath && customPath.trim()) {
    return path.join(customPath.trim(), 'HytaleF2P');
  }
  try {
    if (fs.existsSync(CONFIG_FILE)) {
      const config = JSON.parse(fs.readFileSync(CONFIG_FILE, 'utf8'));
      if (config.installPath && config.installPath.trim()) {
        return path.join(config.installPath.trim(), 'HytaleF2P');
      }
    }
  } catch (err) {
  }
  return DEFAULT_APP_DIR;
}

const APP_DIR = DEFAULT_APP_DIR;
const CACHE_DIR = path.join(APP_DIR, 'cache');
const TOOLS_DIR = path.join(APP_DIR, 'butler');
const GAME_DIR = path.join(APP_DIR, 'release', 'package', 'game', 'latest');
const JRE_DIR = path.join(APP_DIR, 'release', 'package', 'jre', 'latest');
const PLAYER_ID_FILE = path.join(APP_DIR, 'player_id.json');

function getOrCreatePlayerId() {
  try {
    if (!fs.existsSync(APP_DIR)) {
      fs.mkdirSync(APP_DIR, { recursive: true });
    }

    if (fs.existsSync(PLAYER_ID_FILE)) {
      const data = JSON.parse(fs.readFileSync(PLAYER_ID_FILE, 'utf8'));
      if (data.playerId) {
        return data.playerId;
      }
    }

    const newPlayerId = uuidv4();
    fs.writeFileSync(PLAYER_ID_FILE, JSON.stringify({
      playerId: newPlayerId,
      createdAt: new Date().toISOString()
    }, null, 2));

    return newPlayerId;
  } catch (error) {
    console.error('Error managing player ID:', error);
    return uuidv4();
  }
}

function expandHome(inputPath) {
  if (!inputPath) {
    return inputPath;
  }
  if (inputPath === '~') {
    return os.homedir();
  }
  if (inputPath.startsWith('~/') || inputPath.startsWith('~\\')) {
    return path.join(os.homedir(), inputPath.slice(2));
  }
  return inputPath;
}

function loadConfig() {
  try {
    if (fs.existsSync(CONFIG_FILE)) {
      return JSON.parse(fs.readFileSync(CONFIG_FILE, 'utf8'));
    }
  } catch (err) {
    console.log('Notice: could not load config:', err.message);
  }
  return {};
}

function saveConfig(update) {
  try {
    createFolders();
    const config = loadConfig();
    const next = { ...config, ...update };
    fs.writeFileSync(CONFIG_FILE, JSON.stringify(next, null, 2), 'utf8');
  } catch (err) {
    console.log('Notice: could not save config:', err.message);
  }
}

async function findJavaOnPath(commandName = 'java') {
  const lookupCmd = process.platform === 'win32' ? 'where' : 'which';
  try {
    const { stdout } = await execFileAsync(lookupCmd, [commandName]);
    const line = stdout.split(/\r?\n/).map(lineItem => lineItem.trim()).find(Boolean);
    return line || null;
  } catch (err) {
    return null;
  }
}

async function getMacJavaHome() {
  if (process.platform !== 'darwin') {
    return null;
  }
  try {
    const { stdout } = await execFileAsync('/usr/libexec/java_home');
    const home = stdout.trim();
    if (!home) {
      return null;
    }
    return path.join(home, 'bin', JAVA_EXECUTABLE);
  } catch (err) {
    return null;
  }
}

async function resolveJavaPath(inputPath) {
  const trimmed = (inputPath || '').trim();
  if (!trimmed) {
    return null;
  }

  const expanded = expandHome(trimmed);
  if (fs.existsSync(expanded)) {
    const stat = fs.statSync(expanded);
    if (stat.isDirectory()) {
      const candidate = path.join(expanded, 'bin', JAVA_EXECUTABLE);
      return fs.existsSync(candidate) ? candidate : null;
    }
    return expanded;
  }

  if (!path.isAbsolute(expanded)) {
    return await findJavaOnPath(trimmed);
  }

  return null;
}

async function detectSystemJava() {
  const envHome = process.env.JAVA_HOME;
  if (envHome) {
    const envJava = path.join(envHome, 'bin', JAVA_EXECUTABLE);
    if (fs.existsSync(envJava)) {
      return envJava;
    }
  }

  const macJava = await getMacJavaHome();
  if (macJava && fs.existsSync(macJava)) {
    return macJava;
  }

  const pathJava = await findJavaOnPath('java');
  if (pathJava && fs.existsSync(pathJava)) {
    return pathJava;
  }

  return null;
}

async function getJavaDetection() {
  const candidates = [];
  const bundledJava = getBundledJavaPath() || path.join(JRE_DIR, 'bin', JAVA_EXECUTABLE);

  candidates.push({
    label: 'Bundled JRE',
    path: bundledJava,
    exists: fs.existsSync(bundledJava)
  });

  const javaHomeEnv = process.env.JAVA_HOME;
  if (javaHomeEnv) {
    const envJava = path.join(javaHomeEnv, 'bin', JAVA_EXECUTABLE);
    candidates.push({
      label: 'JAVA_HOME',
      path: envJava,
      exists: fs.existsSync(envJava),
      note: fs.existsSync(envJava) ? '' : 'Not found'
    });
  } else {
    candidates.push({
      label: 'JAVA_HOME',
      path: '',
      exists: false,
      note: 'Not set'
    });
  }

  if (process.platform === 'darwin') {
    const macJava = await getMacJavaHome();
    if (macJava) {
      candidates.push({
        label: 'java_home',
        path: macJava,
        exists: fs.existsSync(macJava),
        note: fs.existsSync(macJava) ? '' : 'Not found'
      });
    } else {
      candidates.push({
        label: 'java_home',
        path: '',
        exists: false,
        note: 'Not found'
      });
    }
  }

  const pathJava = await findJavaOnPath('java');
  if (pathJava) {
    candidates.push({
      label: 'PATH',
      path: pathJava,
      exists: true
    });
  } else {
    candidates.push({
      label: 'PATH',
      path: '',
      exists: false,
      note: 'java not found'
    });
  }

  return {
    javaPath: loadJavaPath(),
    candidates
  };
}

function getOS() {
  if (process.platform === 'win32') return 'windows';
  if (process.platform === 'darwin') return 'darwin';
  if (process.platform === 'linux') return 'linux';
  return 'unknown';
}

function getArch() {
  return process.arch === 'x64' ? 'amd64' : process.arch;
}

function createFolders() {
  const configDir = path.dirname(CONFIG_FILE);
  if (!fs.existsSync(configDir)) {
    fs.mkdirSync(configDir, { recursive: true });
  }
}

async function downloadFile(url, dest, progressCallback) {
  const response = await axios({
    method: 'GET',
    url: url,
    responseType: 'stream',
    headers: {
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
      'Accept': '*/*',
      'Accept-Language': 'en-US,en;q=0.9',
      'Referer': 'https://launcher.hytale.com/'
    }
  });

  const totalSize = parseInt(response.headers['content-length'], 10);
  let downloaded = 0;
  const startTime = Date.now();

  const writer = fs.createWriteStream(dest);

  response.data.on('data', (chunk) => {
    downloaded += chunk.length;
    if (progressCallback && totalSize > 0) {
      const percent = Math.min(100, Math.max(0, (downloaded / totalSize) * 100));
      const elapsed = (Date.now() - startTime) / 1000;
      const speed = elapsed > 0 ? downloaded / elapsed : 0;
      progressCallback(null, percent, speed, downloaded, totalSize);
    }
  });

  response.data.pipe(writer);

  return new Promise((resolve, reject) => {
    writer.on('finish', resolve);
    writer.on('error', reject);
    response.data.on('error', reject);
  });
}

async function getLatestClientVersion() {
  try {
    console.log('Fetching latest client version from API...');
    const response = await axios.get('http://3.10.208.30:3002/api/version_client', {
      timeout: 5000,
      headers: {
        'User-Agent': 'Hytale-F2P-Launcher'
      }
    });

    if (response.data && response.data.client_version) {
      const version = response.data.client_version;
      console.log(`Latest client version: ${version}`);
      return version;
    } else {
      console.log('Warning: Invalid API response, falling back to default version');
      return '4.pwr';
    }
  } catch (error) {
    console.error('Error fetching client version:', error.message);
    console.log('Warning: API unavailable, falling back to default version');
    return '4.pwr';
  }
}

async function downloadAndReplaceHomePageUI(gameDir, progressCallback) {
  try {
    console.log('Downloading HomePage.ui from server...');
    
    if (progressCallback) {
      progressCallback('Downloading HomePage.ui...', null, null, null, null);
    }

    const homeUIUrl = 'http://3.10.208.30:3002/api/HomeUI';
    const tempHomePath = path.join(path.dirname(gameDir), 'HomePage_temp.ui');

    await downloadFile(homeUIUrl, tempHomePath);

    const existingHomePath = findHomePageUIPath(gameDir);
    
    if (existingHomePath && fs.existsSync(existingHomePath)) {
      console.log('Found existing HomePage.ui at:', existingHomePath);
      
      const backupPath = existingHomePath + '.backup';
      if (!fs.existsSync(backupPath)) {
        fs.copyFileSync(existingHomePath, backupPath);
        console.log('Original HomePage.ui backed up');
      }
      
      fs.copyFileSync(tempHomePath, existingHomePath);
      console.log('HomePage.ui replaced successfully');
    } else {
      console.log('No existing HomePage.ui found, skipping replacement');
    }
    
    if (fs.existsSync(tempHomePath)) {
      fs.unlinkSync(tempHomePath);
    }
    
    if (progressCallback) {
      progressCallback('HomePage.ui updated', null, null, null, null);
    }
    
    return { success: true, updated: true };

  } catch (error) {
    console.error('Error downloading/replacing HomePage.ui:', error);
    
    const tempHomePath = path.join(path.dirname(gameDir), 'HomePage_temp.ui');
    if (fs.existsSync(tempHomePath)) {
      fs.unlinkSync(tempHomePath);
    }
    
    console.log('HomePage.ui update failed, continuing...');
    return { success: false, error: error.message };
  }
}

function findHomePageUIPath(gameLatest) {
  function searchDirectory(dir) {
    try {
      const items = fs.readdirSync(dir, { withFileTypes: true });
      
      for (const item of items) {
        if (item.isFile() && item.name === 'HomePage.ui') {
          return path.join(dir, item.name);
        } else if (item.isDirectory()) {
          const found = searchDirectory(path.join(dir, item.name));
          if (found) {
            return found;
          }
        }
      }
    } catch (error) {
    }
    
    return null;
  }
  
  if (!fs.existsSync(gameLatest)) {
    return null;
  }
  
  return searchDirectory(gameLatest);
}

async function downloadAndReplaceLogo(gameDir, progressCallback) {
  try {
    console.log('Downloading Logo@2x.png from server...');
    
    if (progressCallback) {
      progressCallback('Downloading Logo@2x.png...', null, null, null, null);
    }

    const logoUrl = 'http://3.10.208.30:3002/api/Logo';
    const tempLogoPath = path.join(path.dirname(gameDir), 'Logo@2x_temp.png');

    await downloadFile(logoUrl, tempLogoPath);

    const existingLogoPath = findLogoPath(gameDir);
    
    if (existingLogoPath && fs.existsSync(existingLogoPath)) {
      console.log('Found existing Logo@2x.png at:', existingLogoPath);
      
      const backupPath = existingLogoPath + '.backup';
      if (!fs.existsSync(backupPath)) {
        fs.copyFileSync(existingLogoPath, backupPath);
        console.log('Original Logo@2x.png backed up');
      }
      
      fs.copyFileSync(tempLogoPath, existingLogoPath);
      console.log('Logo@2x.png replaced successfully');
    } else {
      console.log('No existing Logo@2x.png found, skipping replacement');
    }
    
    if (fs.existsSync(tempLogoPath)) {
      fs.unlinkSync(tempLogoPath);
    }
    
    if (progressCallback) {
      progressCallback('Logo@2x.png updated', null, null, null, null);
    }
    
    return { success: true, updated: true };

  } catch (error) {
    console.error('Error downloading/replacing Logo@2x.png:', error);
    
    const tempLogoPath = path.join(path.dirname(gameDir), 'Logo@2x_temp.png');
    if (fs.existsSync(tempLogoPath)) {
      fs.unlinkSync(tempLogoPath);
    }
    
    console.log('Logo@2x.png update failed, continuing...');
    return { success: false, error: error.message };
  }
}

function findLogoPath(gameLatest) {
  function searchDirectory(dir) {
    try {
      const items = fs.readdirSync(dir, { withFileTypes: true });
      
      for (const item of items) {
        if (item.isFile() && item.name === 'Logo@2x.png') {
          return path.join(dir, item.name);
        } else if (item.isDirectory()) {
          const found = searchDirectory(path.join(dir, item.name));
          if (found) {
            return found;
          }
        }
      }
    } catch (error) {
    }
    
    return null;
  }
  
  if (!fs.existsSync(gameLatest)) {
    return null;
  }
  
  return searchDirectory(gameLatest);
}

async function getMultiClientVersion() {
  try {
    console.log('Fetching Multiplayer version from API...');
    const response = await axios.get('http://3.10.208.30:3002/api/multi', {
      timeout: 5000,
      headers: {
        'User-Agent': 'Hytale-F2P-Launcher'
      }
    });

    if (response.data && response.data.multi_version) {
      const version = response.data.multi_version;
      console.log(`Multiplayer version: ${version}`);
      return version;
    } else {
      console.log('Warning: Invalid multi API response');
      return null;
    }
  } catch (error) {
    console.error('Error fetching Multiplayer version:', error.message);
    console.log('Multiplayer not available');
    return null;
  }
}

async function getInstalledClientVersion() {
  try {
    console.log('Fetching installed client version from API...');
    const response = await axios.get('http://3.10.208.30:3002/api/clientCheck', {
      timeout: 5000,
      headers: {
        'User-Agent': 'Hytale-F2P-Launcher'
      }
    });

    if (response.data && response.data.client_version) {
      const version = response.data.client_version;
      console.log(`Installed client version: ${version}`);
      return version;
    } else {
      console.log('Warning: Invalid clientCheck API response');
      return null;
    }
  } catch (error) {
    console.error('Error fetching installed client version:', error.message);
    console.log('Warning: clientCheck API unavailable');
    return null;
  }
}

async function downloadMultiClient(gameDir, progressCallback) {
  try {
    if (process.platform !== 'win32') {
      console.log('Multiplayer-client is only available for Windows');
      return { success: false, reason: 'Platform not supported' };
    }

    const clientPath = findClientPath(gameDir);
    if (!clientPath) {
      throw new Error('Game client not found. Install game first.');
    }

    console.log('Downloading Multiplayer from server...');
    if (progressCallback) {
      progressCallback('Downloading Multiplayer...', null, null, null, null);
    }

    const clientUrl = 'http://3.10.208.30:3002/client';
    const tempClientPath = path.join(path.dirname(clientPath), 'HytaleClient_temp.exe');

    await downloadFile(clientUrl, tempClientPath, progressCallback);

    const backupPath = path.join(path.dirname(clientPath), 'HytaleClient_original.exe');
    if (!fs.existsSync(backupPath)) {
      fs.copyFileSync(clientPath, backupPath);
      console.log('Original client backed up');
    }

    fs.renameSync(tempClientPath, clientPath);
    
    if (progressCallback) {
      progressCallback('Multiplayer installed', 100, null, null, null);
    }
    console.log('Multiplayer installed successfully');

    return { success: true, installed: true };

  } catch (error) {
    console.error('Error installing Multiplayer:', error);
    throw new Error(`Failed to install Multiplayer: ${error.message}`);
  }
}

async function checkAndInstallMultiClient(gameDir, progressCallback) {
  try {
    if (process.platform !== 'win32') {
      console.log('Multiplayer check skipped (Windows only)');
      return { success: true, skipped: true, reason: 'Windows only' };
    }

    console.log('Checking for Multiplayer availability...');
    
    const [clientVersion, multiVersion] = await Promise.all([
      getLatestClientVersion(),
      getMultiClientVersion()
    ]);

    if (!multiVersion) {
      console.log('Multiplayer not available');
      return { success: true, skipped: true, reason: 'Multiplayer not available' };
    }

    if (clientVersion === multiVersion) {
      console.log(`Versions match (${clientVersion}), installing Multiplayer...`);
      return await downloadMultiClient(gameDir, progressCallback);
    } else {
      console.log(`Version mismatch: client=${clientVersion}, multi=${multiVersion}`);
      return { success: true, skipped: true, reason: 'Version mismatch' };
    }

  } catch (error) {
    console.error('Error checking Multiplayer:', error);
    return { success: false, error: error.message };
  }
}

async function installButler(toolsDir = TOOLS_DIR) {
  if (!fs.existsSync(toolsDir)) {
    fs.mkdirSync(toolsDir, { recursive: true });
  }
  
  const butlerName = process.platform === 'win32' ? 'butler.exe' : 'butler';
  const butlerPath = path.join(toolsDir, butlerName);
  const zipPath = path.join(toolsDir, 'butler.zip');

  if (fs.existsSync(butlerPath)) {
    return butlerPath;
  }

  let urls = [];
  const osName = getOS();
  const arch = getArch();
  if (osName === 'windows') {
    urls = ['https://broth.itch.zone/butler/windows-amd64/LATEST/archive/default'];
  } else if (osName === 'darwin') {
    if (arch === 'arm64') {
      urls = [
        'https://broth.itch.zone/butler/darwin-arm64/LATEST/archive/default',
        'https://broth.itch.zone/butler/darwin-amd64/LATEST/archive/default'
      ];
    } else {
      urls = ['https://broth.itch.zone/butler/darwin-amd64/LATEST/archive/default'];
    }
  } else if (osName === 'linux') {
    urls = ['https://broth.itch.zone/butler/linux-amd64/LATEST/archive/default'];
  } else {
    throw new Error('Operating system not supported');
  }

  console.log('Fetching Butler tool...');
  let lastError = null;
  for (const url of urls) {
    try {
      await downloadFile(url, zipPath);
      lastError = null;
      break;
    } catch (error) {
      lastError = error;
    }
  }
  if (lastError) {
    throw lastError;
  }

  console.log('Unpacking Butler...');
  const zip = new AdmZip(zipPath);
  zip.extractAllTo(toolsDir, true);

  if (process.platform !== 'win32') {
    fs.chmodSync(butlerPath, 0o755);
  }

  try {
    fs.unlinkSync(zipPath);
  } catch (err) {
    console.log('Notice: could not delete butler.zip');
  }

  return butlerPath;
}

async function updateGameFiles(newVersion, progressCallback, gameDir = GAME_DIR, toolsDir = TOOLS_DIR, cacheDir = CACHE_DIR) {
  let tempUpdateDir;
  try {
    if (progressCallback) {
      progressCallback('Updating game files...', 0, null, null, null);
    }
    console.log(`Updating game files to version: ${newVersion}`);

    tempUpdateDir = path.join(gameDir, '..', 'temp_update');
    
    if (fs.existsSync(tempUpdateDir)) {
      fs.rmSync(tempUpdateDir, { recursive: true, force: true });
    }
    fs.mkdirSync(tempUpdateDir, { recursive: true });

    if (progressCallback) {
      progressCallback('Downloading new game version...', 10, null, null, null);
    }
    
    const pwrFile = await downloadPWR('release', newVersion, progressCallback, cacheDir);
    
    if (progressCallback) {
      progressCallback('Extracting new files...', 50, null, null, null);
    }
    
    await applyPWR(pwrFile, progressCallback, tempUpdateDir, toolsDir);
    
    if (progressCallback) {
      progressCallback('Replacing game files...', 80, null, null, null);
    }
    
    let userDataBackup = null;
    const userDataPath = findUserDataRecursive(gameDir);
    
    if (userDataPath && fs.existsSync(userDataPath)) {
      userDataBackup = path.join(gameDir, '..', 'UserData_backup_' + Date.now());
      console.log(`Backing up UserData from ${userDataPath} to: ${userDataBackup}`);
      
      function copyRecursive(src, dest) {
        const stat = fs.statSync(src);
        if (stat.isDirectory()) {
          if (!fs.existsSync(dest)) {
            fs.mkdirSync(dest, { recursive: true });
          }
          const files = fs.readdirSync(src);
          for (const file of files) {
            copyRecursive(path.join(src, file), path.join(dest, file));
          }
        } else {
          fs.copyFileSync(src, dest);
        }
      }
      
      copyRecursive(userDataPath, userDataBackup);
    } else {
      console.log('No UserData folder found in game directory');
    }
    
    if (fs.existsSync(gameDir)) {
      console.log('Removing old game files...');
      fs.rmSync(gameDir, { recursive: true, force: true });
    }
    
    fs.renameSync(tempUpdateDir, gameDir);
    
    const multiResult = await checkAndInstallMultiClient(gameDir, progressCallback);
    console.log('Multiplayer-client check result after update:', multiResult);
    
    const homeUIResult = await downloadAndReplaceHomePageUI(gameDir, progressCallback);
    console.log('HomePage.ui update result after update:', homeUIResult);
    
    const logoResult = await downloadAndReplaceLogo(gameDir, progressCallback);
    console.log('Logo@2x.png update result after update:', logoResult);
    
    if (userDataBackup && fs.existsSync(userDataBackup)) {
      const newUserDataPath = findUserDataPath(gameDir);
      const userDataParent = path.dirname(newUserDataPath);
      
      if (!fs.existsSync(userDataParent)) {
        fs.mkdirSync(userDataParent, { recursive: true });
      }
      
      console.log(`Restoring UserData to: ${newUserDataPath}`);
      
      function copyRecursive(src, dest) {
        const stat = fs.statSync(src);
        if (stat.isDirectory()) {
          if (!fs.existsSync(dest)) {
            fs.mkdirSync(dest, { recursive: true });
          }
          const files = fs.readdirSync(src);
          for (const file of files) {
            copyRecursive(path.join(src, file), path.join(dest, file));
          }
        } else {
          fs.copyFileSync(src, dest);
        }
      }
      
      copyRecursive(userDataBackup, newUserDataPath);
    }
    
    console.log(`Game files updated successfully to version: ${newVersion}`);
    
    if (userDataBackup && fs.existsSync(userDataBackup)) {
      try {
        fs.rmSync(userDataBackup, { recursive: true, force: true });
        console.log('UserData backup cleaned up');
      } catch (cleanupError) {
        console.warn('Could not clean up UserData backup:', cleanupError.message);
      }
    }
    
    console.log('Waiting for file system sync...');
    await new Promise(resolve => setTimeout(resolve, 2000)); 
    
    if (progressCallback) {
      progressCallback('Game update completed', 100, null, null, null);
    }
    
    return { success: true, updated: true, version: newVersion };
  } catch (error) {
    console.error('Error updating game files:', error);
    
    if (userDataBackup && fs.existsSync(userDataBackup)) {
      try {
        fs.rmSync(userDataBackup, { recursive: true, force: true });
        console.log('UserData backup cleaned up after error');
      } catch (cleanupError) {
        console.warn('Could not clean up UserData backup:', cleanupError.message);
      }
    }
    
    if (tempUpdateDir && fs.existsSync(tempUpdateDir)) {
      fs.rmSync(tempUpdateDir, { recursive: true, force: true });
    }
    
    throw new Error(`Failed to update game files: ${error.message}`);
  }
}

async function downloadPWR(version = 'release', fileName = '4.pwr', progressCallback, cacheDir = CACHE_DIR) {
  const osName = getOS();
  const arch = getArch();
  const url = `https://game-patches.hytale.com/patches/${osName}/${arch}/${version}/0/${fileName}`;
  
  const dest = path.join(cacheDir, fileName);

  if (fs.existsSync(dest)) {
    console.log('PWR file found in cache:', dest);
    return dest;
  }

  console.log('Fetching PWR patch file:', url);
  await downloadFile(url, dest, progressCallback);
  console.log('PWR saved to:', dest);
  
  return dest;
}

async function applyPWR(pwrFile, progressCallback, gameDir = GAME_DIR, toolsDir = TOOLS_DIR) {
  const butlerPath = await installButler(toolsDir);
  const gameLatest = gameDir;
  const stagingDir = path.join(gameLatest, 'staging-temp');
  
  const clientPath = findClientPath(gameLatest);
  
  if (clientPath) {
    console.log('Game files detected, skipping patch installation.');
    return;
  }

  if (!fs.existsSync(gameLatest)) {
    fs.mkdirSync(gameLatest, { recursive: true });
  }
  if (!fs.existsSync(stagingDir)) {
    fs.mkdirSync(stagingDir, { recursive: true });
  }

  if (progressCallback) {
    progressCallback('Installing game patch...', null, null, null, null);
  }

  console.log('Installing game patch...');
  
  if (!fs.existsSync(butlerPath)) {
    throw new Error(`Butler tool not found at: ${butlerPath}`);
  }
  
  if (!fs.existsSync(pwrFile)) {
    throw new Error(`PWR file not found at: ${pwrFile}`);
  }

  const args = [
    'apply',
    '--staging-dir',
    stagingDir,
    pwrFile,
    gameLatest
  ];
  
  try {
    await new Promise((resolve, reject) => {
      const child = execFile(butlerPath, args, {
        maxBuffer: 1024 * 1024 * 10,
        timeout: 600000
      }, (error, stdout, stderr) => {
        if (error) {
          console.error('Butler stderr:', stderr);
          console.error('Butler stdout:', stdout);
          reject(new Error(`Patch installation failed: ${error.message}${stderr ? '\n' + stderr : ''}`));
        } else {
          resolve();
        }
      });
    });
  } catch (error) {
    throw error;
  }

  if (fs.existsSync(stagingDir)) {
    fs.rmSync(stagingDir, { recursive: true, force: true });
  }

  if (progressCallback) {
    progressCallback('Installation complete', null, null, null, null);
  }
  console.log('Installation complete');
}

async function downloadJRE(progressCallback, cacheDir = CACHE_DIR, jreDir = JRE_DIR) {
  if (!fs.existsSync(cacheDir)) {
    fs.mkdirSync(cacheDir, { recursive: true });
  }
  
  const osName = getOS();
  const arch = getArch();

  const bundledJava = getBundledJavaPath(jreDir);
  if (bundledJava) {
    console.log('Java runtime found, skipping download');
    return;
  }

  console.log('Requesting Java runtime information...');
  const response = await axios.get('https://launcher.hytale.com/version/release/jre.json', {
    headers: {
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
      'Accept': 'application/json',
      'Accept-Language': 'en-US,en;q=0.9'
    }
  });
  const jreData = response.data;

  const osData = jreData.download_url[osName];
  if (!osData) {
    throw new Error(`Java runtime unavailable for platform: ${osName}`);
  }

  const platform = osData[arch];
  if (!platform) {
    throw new Error(`Java runtime unavailable for architecture ${arch} on ${osName}`);
  }

  const fileName = path.basename(platform.url);
  const cacheFile = path.join(cacheDir, fileName);

  if (!fs.existsSync(cacheFile)) {
    if (progressCallback) {
      progressCallback('Fetching Java runtime...', null, null, null, null);
    }
    console.log('Fetching Java runtime...');
    await downloadFile(platform.url, cacheFile, progressCallback);
    console.log('Download finished');
  }

  if (progressCallback) {
    progressCallback('Validating files...', null, null, null, null);
  }
  console.log('Validating files...');
  const fileBuffer = fs.readFileSync(cacheFile);
  const hashSum = crypto.createHash('sha256');
  hashSum.update(fileBuffer);
  const hex = hashSum.digest('hex');
  
  if (hex !== platform.sha256) {
    fs.unlinkSync(cacheFile);
    throw new Error(`File validation failed: expected ${platform.sha256} but got ${hex}`);
  }

  if (progressCallback) {
    progressCallback('Unpacking Java runtime...', null, null, null, null);
  }
  console.log('Unpacking Java runtime...');
  await extractJRE(cacheFile, jreDir);

  if (process.platform !== 'win32') {
    const javaCandidates = [
      path.join(jreDir, 'bin', JAVA_EXECUTABLE),
      path.join(jreDir, 'Contents', 'Home', 'bin', JAVA_EXECUTABLE)
    ];
    for (const javaPath of javaCandidates) {
      if (fs.existsSync(javaPath)) {
        fs.chmodSync(javaPath, 0o755);
      }
    }
  }

  flattenJREDir(jreDir);

  try {
    fs.unlinkSync(cacheFile);
  } catch (err) {
    console.log('Notice: could not delete cached Java files:', err.message);
  }

  console.log('Java runtime ready');
}

async function extractJRE(archivePath, destDir) {
  if (fs.existsSync(destDir)) {
    fs.rmSync(destDir, { recursive: true, force: true });
  }
  fs.mkdirSync(destDir, { recursive: true });

  if (archivePath.endsWith('.zip')) {
    return extractZip(archivePath, destDir);
  } else if (archivePath.endsWith('.tar.gz')) {
    return extractTarGz(archivePath, destDir);
  } else {
    throw new Error(`Archive type not supported: ${archivePath}`);
  }
}

function extractZip(zipPath, dest) {
  const zip = new AdmZip(zipPath);
  const entries = zip.getEntries();

  for (const entry of entries) {
    const entryPath = path.join(dest, entry.entryName);
    
    const resolvedPath = path.resolve(entryPath);
    const resolvedDest = path.resolve(dest);
    if (!resolvedPath.startsWith(resolvedDest)) {
      throw new Error(`Invalid file path detected: ${entryPath}`);
    }

    if (entry.isDirectory) {
      fs.mkdirSync(entryPath, { recursive: true });
    } else {
      fs.mkdirSync(path.dirname(entryPath), { recursive: true });
      fs.writeFileSync(entryPath, entry.getData());
      if (process.platform !== 'win32') {
        fs.chmodSync(entryPath, entry.header.attr >>> 16);
      }
    }
  }
}

function extractTarGz(tarGzPath, dest) {
  const tar = require('tar');
  return tar.extract({
    file: tarGzPath,
    cwd: dest,
    strip: 0
  });
}

function flattenJREDir(jreLatest) {
  try {
    const entries = fs.readdirSync(jreLatest, { withFileTypes: true });
    
    if (entries.length !== 1 || !entries[0].isDirectory()) {
      return;
    }

    const nested = path.join(jreLatest, entries[0].name);
    const files = fs.readdirSync(nested, { withFileTypes: true });

    for (const file of files) {
      const oldPath = path.join(nested, file.name);
      const newPath = path.join(jreLatest, file.name);
      fs.renameSync(oldPath, newPath);
    }

    fs.rmSync(nested, { recursive: true, force: true });
  } catch (err) {
    console.log('Notice: could not restructure Java directory:', err.message);
  }
}

function getBundledJavaPath(jreDir = JRE_DIR) {
  const candidates = [
    path.join(jreDir, 'bin', JAVA_EXECUTABLE)
  ];

  if (process.platform === 'darwin') {
    candidates.push(path.join(jreDir, 'Contents', 'Home', 'bin', JAVA_EXECUTABLE));
  }

  for (const candidate of candidates) {
    if (fs.existsSync(candidate)) {
      return candidate;
    }
  }

  return null;
}

function getJavaExec(jreDir = JRE_DIR) {
  const bundledJava = getBundledJavaPath(jreDir);
  if (bundledJava) {
    return bundledJava;
  }

  console.log('Notice: Java runtime not found, using system default');
  return 'java';
}

function getClientCandidates(gameLatest) {
  const candidates = [];
  if (process.platform === 'win32') {
    candidates.push(path.join(gameLatest, 'Client', 'HytaleClient.exe'));
  } else if (process.platform === 'darwin') {
    candidates.push(path.join(gameLatest, 'Client', 'Hytale.app', 'Contents', 'MacOS', 'HytaleClient'));
    candidates.push(path.join(gameLatest, 'Client', 'HytaleClient'));
  } else {
    candidates.push(path.join(gameLatest, 'Client', 'HytaleClient'));
  }
  return candidates;
}

function findClientPath(gameLatest) {
  const candidates = getClientCandidates(gameLatest);
  for (const candidate of candidates) {
    if (fs.existsSync(candidate)) {
      return candidate;
    }
  }
  return null;
}

function isGameInstalled() {
  const appDir = getResolvedAppDir();
  const gameDir = path.join(appDir, 'release', 'package', 'game', 'latest');
  const clientPath = findClientPath(gameDir);
  return clientPath !== null;
}

function isFirstLaunch() {
  const config = loadConfig();
  
  if ('hasLaunchedBefore' in config) {
    return !config.hasLaunchedBefore;
  }
  
  const hasUserData = config.installPath || config.username || config.javaPath || 
                      config.chatUsername || config.userUuids || 
                      Object.keys(config).length > 0;
  
  if (!hasUserData) {
    return true;
  }
  
  return true;
}

function markAsLaunched() {
  saveConfig({ hasLaunchedBefore: true, firstLaunchDate: new Date().toISOString() });
}

function checkExistingGameInstallation() {
  try {
    const config = loadConfig();
    
    if (!config.installPath || !config.installPath.trim()) {
      return null;
    }
    
    const installPath = config.installPath.trim();
    const gameDir = path.join(installPath, 'HytaleF2P', 'release', 'package', 'game', 'latest');
    
    if (!fs.existsSync(gameDir)) {
      return null;
    }
    
    const clientPath = findClientPath(gameDir);
    if (!clientPath) {
      return null;
    }
    
    const userDataPath = findUserDataRecursive(gameDir);
    
    return {
      gameDir: gameDir,
      clientPath: clientPath,
      userDataPath: userDataPath,
      installPath: installPath,
      hasUserData: userDataPath && fs.existsSync(userDataPath)
    };
  } catch (error) {
    console.error('Error checking existing game installation:', error);
    return null;
  }
}

async function proposeGameUpdate(existingGame, progressCallback) {
  try {
    console.log('Proposing game update for existing installation...');
    
    if (progressCallback) {
      progressCallback('Checking for game updates...', 0, null, null, null);
    }
    
    const [installedVersion, latestVersion] = await Promise.all([
      getInstalledClientVersion(),
      getLatestClientVersion()
    ]);
    
    console.log(`Existing installation - Installed: ${installedVersion}, Latest: ${latestVersion}`);
    
    const customAppDir = path.join(existingGame.installPath, 'HytaleF2P');
    const customCacheDir = path.join(customAppDir, 'cache');
    const customToolsDir = path.join(customAppDir, 'butler');
    
    [customCacheDir, customToolsDir].forEach(dir => {
      if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
      }
    });
    
    if (progressCallback) {
      progressCallback('Updating existing game installation...', 20, null, null, null);
    }
    
    await updateGameFiles(latestVersion, progressCallback, existingGame.gameDir, customToolsDir, customCacheDir);
    
    if (progressCallback) {
      progressCallback('Game update completed successfully', 100, null, null, null);
    }
    
    console.log('Existing game installation updated successfully');
    return { success: true, updated: true };
    
  } catch (error) {
    console.error('Error updating existing game:', error);
    if (progressCallback) {
      progressCallback(`Update failed: ${error.message}`, -1, null, null, null);
    }
    throw error;
  }
}

async function handleFirstLaunchCheck(progressCallback) {
  try {
    const config = loadConfig();
    
    if (config.hasLaunchedBefore === true) {
      return { isFirstLaunch: false, needsUpdate: false };
    }
    
    console.log('First launch detected, checking for existing game installation...');
    
    const existingGame = checkExistingGameInstallation();
    
    if (!existingGame) {
      console.log('No existing game installation found');
      
      const hasUserData = config.installPath || config.username || config.javaPath || 
                          config.chatUsername || config.userUuids || 
                          Object.keys(config).length > 0;
      
      if (hasUserData) {
        console.log('Detected existing user data but no game, marking as launched');
        markAsLaunched();
        return { isFirstLaunch: false, needsUpdate: false };
      } else {
        markAsLaunched();
        return { isFirstLaunch: true, needsUpdate: false, existingGame: null };
      }
    }
    
    console.log('Existing game installation found:', {
      gameDir: existingGame.gameDir,
      hasUserData: existingGame.hasUserData
    });
    
    return { 
      isFirstLaunch: true, 
      needsUpdate: true, 
      existingGame: existingGame 
    };
    
  } catch (error) {
    console.error('Error in first launch check:', error);
    markAsLaunched(); 
    return { isFirstLaunch: true, needsUpdate: false, error: error.message };
  }
}

async function uninstallGame() {
  const appDir = getResolvedAppDir();
  
  if (!fs.existsSync(appDir)) {
    throw new Error('Game is not installed');
  }

  try {
    fs.rmSync(appDir, { recursive: true, force: true });
    console.log('Game uninstalled successfully - removed entire HytaleF2P folder');
    
    if (fs.existsSync(CONFIG_FILE)) {
      const config = loadConfig();
      delete config.installPath;
      fs.writeFileSync(CONFIG_FILE, JSON.stringify(config, null, 2), 'utf8');
    }
  } catch (error) {
    throw new Error(`Failed to uninstall game: ${error.message}`);
  }
}

async function installGame(playerName = 'Player', progressCallback, javaPathOverride, installPathOverride) {
  const customAppDir = getResolvedAppDir(installPathOverride);
  const customCacheDir = path.join(customAppDir, 'cache');
  const customToolsDir = path.join(customAppDir, 'butler');
  const customGameDir = path.join(customAppDir, 'release', 'package', 'game', 'latest');
  const customJreDir = path.join(customAppDir, 'release', 'package', 'jre', 'latest');
  const userDataDir = path.join(customGameDir, 'Client', 'UserData');

  [customAppDir, customCacheDir, customToolsDir].forEach(dir => {
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
  });

  if (!fs.existsSync(userDataDir)) {
    fs.mkdirSync(userDataDir, { recursive: true });
  }

  saveUsername(playerName);
  if (installPathOverride) {
    saveInstallPath(installPathOverride);
  }

  const gameLatest = customGameDir;
  let clientPath = findClientPath(gameLatest);

  if (clientPath) {
    if (progressCallback) {
      progressCallback('Game already installed', 100, null, null, null);
    }
    console.log('Game is already installed');
    return { success: true, alreadyInstalled: true };
  }

  const configuredJava = (javaPathOverride !== undefined && javaPathOverride !== null
    ? javaPathOverride
    : loadJavaPath() || '').trim();
  let javaBin = null;

  if (configuredJava) {
    javaBin = await resolveJavaPath(configuredJava);
    if (!javaBin) {
      throw new Error(`Configured Java path not found: ${configuredJava}`);
    }
  } else {
    try {
      await downloadJRE(progressCallback, customCacheDir, customJreDir);
    } catch (error) {
      const fallback = await detectSystemJava();
      if (fallback) {
        javaBin = fallback;
      } else {
        throw error;
      }
    }

    if (!javaBin) {
      javaBin = getJavaExec(customJreDir);
    }
  }

  if (progressCallback) {
    progressCallback('Fetching game files...', null, null, null, null);
  }
  console.log('Installing game files...');
  
  const latestVersion = await getLatestClientVersion();
  const pwrFile = await downloadPWR('release', latestVersion, progressCallback, customCacheDir);
  await applyPWR(pwrFile, progressCallback, customGameDir, customToolsDir);
  
  const multiResult = await checkAndInstallMultiClient(customGameDir, progressCallback);
  console.log('Multiplayer check result:', multiResult);
  
  const homeUIResult = await downloadAndReplaceHomePageUI(customGameDir, progressCallback);
  console.log('HomePage.ui update result after installation:', homeUIResult);
  
  const logoResult = await downloadAndReplaceLogo(customGameDir, progressCallback);
  console.log('Logo@2x.png update result after installation:', logoResult);
  
  if (progressCallback) {
    progressCallback('Installation complete', 100, null, null, null);
  }
  console.log('Game installation completed successfully');
  
  return { 
    success: true, 
    installed: true, 
    multiClient: multiResult 
  };
}

async function launchGameWithVersionCheck(playerName = 'Player', progressCallback, javaPathOverride, installPathOverride) {
  try {
    if (progressCallback) {
      progressCallback('Checking for updates...', 0, null, null, null);
    }

    const [installedVersion, latestVersion] = await Promise.all([
      getInstalledClientVersion(),
      getLatestClientVersion()
    ]);

    console.log(`Installed version: ${installedVersion}, Latest version: ${latestVersion}`);

    let needsUpdate = false;
    if (installedVersion && latestVersion && installedVersion !== latestVersion) {
      needsUpdate = true;
      console.log('Version mismatch detected, update required');
    }

    if (needsUpdate) {
      if (progressCallback) {
        progressCallback('Game update required, starting update process...', 10, null, null, null);
      }

      const customAppDir = getResolvedAppDir(installPathOverride);
      const customGameDir = path.join(customAppDir, 'release', 'package', 'game', 'latest');
      const customToolsDir = path.join(customAppDir, 'tools');
      const customCacheDir = path.join(customAppDir, 'cache');

      try {
        await updateGameFiles(latestVersion, progressCallback, customGameDir, customToolsDir, customCacheDir);
        console.log('Game updated successfully, waiting before launch...');
        
        if (progressCallback) {
          progressCallback('Preparing game launch...', 90, null, null, null);
        }
        await new Promise(resolve => setTimeout(resolve, 3000)); 
        
      } catch (updateError) {
        console.error('Update failed:', updateError);
        if (progressCallback) {
          progressCallback(`Update failed: ${updateError.message}`, -1, null, null, null);
        }
        throw updateError;
      }
    }

    if (progressCallback) {
      progressCallback('Launching game...', 80, null, null, null);
    }

    return await launchGame(playerName, progressCallback, javaPathOverride, installPathOverride);
  } catch (error) {
    console.error('Error in version check and launch:', error);
    if (progressCallback) {
      progressCallback(`Error: ${error.message}`, -1, null, null, null);
    }
    throw error;
  }
}

async function launchGame(playerName = 'Player', progressCallback, javaPathOverride, installPathOverride) {
  const customAppDir = getResolvedAppDir(installPathOverride);
  const customGameDir = path.join(customAppDir, 'release', 'package', 'game', 'latest');
  const customJreDir = path.join(customAppDir, 'release', 'package', 'jre', 'latest');
  const userDataDir = path.join(customGameDir, 'Client', 'UserData');

  const gameLatest = customGameDir;
  let clientPath = findClientPath(gameLatest);

  if (!clientPath) {
    throw new Error('Game is not installed. Please install the game first.');
  }

  saveUsername(playerName);
  if (installPathOverride) {
    saveInstallPath(installPathOverride);
  }

  const configuredJava = (javaPathOverride !== undefined && javaPathOverride !== null
    ? javaPathOverride
    : loadJavaPath() || '').trim();
  let javaBin = null;

  if (configuredJava) {
    javaBin = await resolveJavaPath(configuredJava);
    if (!javaBin) {
      throw new Error(`Configured Java path not found: ${configuredJava}`);
    }
  } else {
    javaBin = getJavaExec(customJreDir);
    
    if (!getBundledJavaPath(customJreDir)) {
      const fallback = await detectSystemJava();
      if (fallback) {
        javaBin = fallback;
      } else {
        throw new Error('Java runtime not found. Please install the game first or configure Java path.');
      }
    }
  }

  if (process.platform === 'darwin') {
    try {
      const appBundle = path.join(gameLatest, 'Client', 'Hytale.app');
      const serverDir = path.join(gameLatest, 'Server');

      const signPath = async (targetPath, deep = false) => {
        await execAsync(`xattr -cr "${targetPath}"`).catch(() => {});
        const deepFlag = deep ? '--deep ' : '';
        await execAsync(`codesign --force ${deepFlag}--sign - "${targetPath}"`).catch(() => {});
      };

      if (fs.existsSync(appBundle)) {
        await signPath(appBundle, true);
        console.log('Signed macOS app bundle');
      } else {
        await signPath(path.dirname(clientPath), true);
        console.log('Signed macOS client binary');
      }

      if (javaBin && fs.existsSync(javaBin)) {
        let jreRoot = path.dirname(path.dirname(javaBin));
        if (jreRoot.endsWith('Home')) {
          jreRoot = path.dirname(path.dirname(jreRoot));
        }
        await signPath(jreRoot, true);
        await signPath(javaBin, false);
        console.log('Signed Java runtime');
      }

      if (fs.existsSync(serverDir)) {
        await execAsync(`xattr -cr "${serverDir}"`).catch(() => {});
        await execAsync(`find "${serverDir}" -type f -perm +111 -exec codesign --force --sign - {} \\;`).catch(() => {});
        console.log('Signed server binaries');
      }

      if (javaBin && fs.existsSync(javaBin)) {
        const javaWrapperPath = path.join(path.dirname(javaBin), 'java-wrapper');
        const wrapperScript = `#!/bin/bash
# Java wrapper for macOS - adds --disable-sentry to fix Sentry hang issue
REAL_JAVA="${javaBin}"
ARGS=("$@")
for i in "\${!ARGS[@]}"; do
  if [[ "\${ARGS[$i]}" == *"HytaleServer.jar"* ]]; then
    ARGS=("\${ARGS[@]:0:$((i+1))}" "--disable-sentry" "\${ARGS[@]:$((i+1))}")
    break
  fi
done
exec "$REAL_JAVA" "\${ARGS[@]}"
`;
        fs.writeFileSync(javaWrapperPath, wrapperScript, { mode: 0o755 });
        await signPath(javaWrapperPath, false);
        console.log('Created java wrapper with --disable-sentry fix');
        javaBin = javaWrapperPath;
      }
    } catch (signError) {
      console.log('Notice: macOS signing step failed:', signError.message);
      console.log('The game may still launch if Gatekeeper allows it');
    }
  }

  const uuid = getUuidForUser(playerName);
  const args = [
    '--app-dir', gameLatest,
    '--java-exec', javaBin,
    '--auth-mode', 'offline',
    '--uuid', uuid,
    '--name', playerName,
    '--user-dir', userDataDir
  ];

  if (progressCallback) {
    progressCallback('Starting game...', null, null, null, null);
  }
  console.log('Starting game...');
  console.log(`Command: "${clientPath}" ${args.join(' ')}`);

  const env = { ...process.env };
  
  const waylandEnv = setupWaylandEnvironment();
  Object.assign(env, waylandEnv);

  try {
    let spawnOptions = {
      stdio: ['ignore', 'pipe', 'pipe'],
      detached: true,
      env: env
    };

    if (process.platform === 'win32') {
      spawnOptions.shell = false; 
      spawnOptions.windowsHide = true; 
    }

    const child = spawn(clientPath, args, spawnOptions);

    console.log(`Game process started with PID: ${child.pid}`);

    let hasExited = false;
    let outputReceived = false;

    child.stdout.on('data', (data) => {
      outputReceived = true;
      console.log(`Game output: ${data.toString().trim()}`);
    });

    child.stderr.on('data', (data) => {
      outputReceived = true;
      console.error(`Game error: ${data.toString().trim()}`);
    });

    child.on('error', (error) => {
      hasExited = true;
      console.error(`Failed to start game process: ${error.message}`);
      if (progressCallback) {
        progressCallback(`Failed to start game: ${error.message}`, -1, null, null, null);
      }
    });

    child.on('exit', (code, signal) => {
      hasExited = true;
      if (code !== null) {
        console.log(`Game process exited with code ${code}`);
        if (code !== 0 && progressCallback) {
          progressCallback(`Game exited with error code ${code}`, -1, null, null, null);
        }
      } else if (signal) {
        console.log(`Game process terminated by signal ${signal}`);
      }
    });

    setTimeout(() => {
      if (!hasExited) {
        console.log('Game appears to be running successfully');
        child.unref();
        if (progressCallback) {
          progressCallback('Game launched successfully', 100, null, null, null);
        }
      } else if (!outputReceived) {
        console.warn('Game process exited immediately with no output - possible issue with game files or dependencies');
      }
    }, 3000);

    return { success: true, installed: true, launched: true, pid: child.pid };
  } catch (spawnError) {
    console.error(`Error spawning game process: ${spawnError.message}`);
    if (progressCallback) {
      progressCallback(`Error launching game: ${spawnError.message}`, -1, null, null, null);
    }
    throw spawnError;
  }
}

function saveUsername(username) {
  saveConfig({ username: username || 'Player' });
}

function loadUsername() {
  const config = loadConfig();
  return config.username || 'Player';
}

function saveChatUsername(chatUsername) {
  saveConfig({ chatUsername: chatUsername || '' });
}

function loadChatUsername() {
  const config = loadConfig();
  return config.chatUsername || '';
}

function getUuidForUser(username) {
  const config = loadConfig();
  const userUuids = config.userUuids || {};

  if (userUuids[username]) {
    return userUuids[username];
  }

  const newUuid = uuidv4();
  userUuids[username] = newUuid;
  saveConfig({ userUuids });

  return newUuid;
}

function saveJavaPath(javaPath) {
  const trimmed = (javaPath || '').trim();
  saveConfig({ javaPath: trimmed });
}

function loadJavaPath() {
  const config = loadConfig();
  return config.javaPath || '';
}

function saveInstallPath(installPath) {
  const trimmed = (installPath || '').trim();
  saveConfig({ installPath: trimmed });
}

function loadInstallPath() {
  const config = loadConfig();
  return config.installPath || '';
}

async function getHytaleNews() {
  try {
    const response = await axios.get('https://launcher.hytale.com/launcher-feed/release/feed.json', {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
      },
      timeout: 10000
    });
    
    const articles = response.data.articles || [];
    return articles.map(article => ({
      title: article.title || '',
      description: article.description || '',
      destUrl: article.dest_url || '',
      imageUrl: article.image_url ? 
        (article.image_url.startsWith('http') ? 
          article.image_url : 
          `https://launcher.hytale.com/launcher-feed/release/${article.image_url}`
        ) : ''
    }));
  } catch (error) {
    console.error('Failed to fetch news:', error.message);
    return [];
  }
}

function findUserDataPath(gameLatest) {
  const candidates = [];
  
  candidates.push(path.join(gameLatest, 'Client', 'UserData'));
  
  candidates.push(path.join(gameLatest, 'Client', 'Hytale.app', 'Contents', 'UserData'));
  candidates.push(path.join(gameLatest, 'Hytale.app', 'Contents', 'UserData'));
  candidates.push(path.join(gameLatest, 'UserData'));
  
  candidates.push(path.join(gameLatest, 'Client', 'UserData'));
  
  for (const candidate of candidates) {
    if (fs.existsSync(candidate)) {
      return candidate;
    }
  }
  
  let defaultPath;
  if (process.platform === 'darwin') {
    defaultPath = path.join(gameLatest, 'Client', 'UserData');
  } else {
    defaultPath = path.join(gameLatest, 'Client', 'UserData');
  }
  
  if (!fs.existsSync(defaultPath)) {
    fs.mkdirSync(defaultPath, { recursive: true });
  }
  
  return defaultPath;
}

function findUserDataRecursive(gameLatest) {
  function searchDirectory(dir) {
    try {
      const items = fs.readdirSync(dir, { withFileTypes: true });
      
      for (const item of items) {
        if (item.isDirectory()) {
          const fullPath = path.join(dir, item.name);
          
          if (item.name === 'UserData') {
            return fullPath;
          }
          
          const found = searchDirectory(fullPath);
          if (found) {
            return found;
          }
        }
      }
    } catch (error) {
    }
    
    return null;
  }
  
  if (!fs.existsSync(gameLatest)) {
    return null;
  }
  
  const found = searchDirectory(gameLatest);
  return found;
}

async function getModsPath(customInstallPath = null) {
  try {
    let installPath = customInstallPath;

    if (!installPath) {
      if (fs.existsSync(CONFIG_FILE)) {
        const config = JSON.parse(fs.readFileSync(CONFIG_FILE, 'utf8'));
        installPath = config.installPath || '';
      }
    }

    if (!installPath) {
      const localAppData = process.env.LOCALAPPDATA || path.join(os.homedir(), 'AppData', 'Local');
      installPath = path.join(localAppData, 'HytaleF2P');
    } else {
      installPath = path.join(installPath, 'HytaleF2P');
    }

    const gameLatest = path.join(installPath, 'release', 'package', 'game', 'latest');
    
    const userDataPath = findUserDataPath(gameLatest);
    
    const modsPath = path.join(userDataPath, 'Mods');
    const disabledModsPath = path.join(userDataPath, 'DisabledMods');

    if (!fs.existsSync(modsPath)) {
      fs.mkdirSync(modsPath, { recursive: true });
    }
    if (!fs.existsSync(disabledModsPath)) {
      fs.mkdirSync(disabledModsPath, { recursive: true });
    }

    return modsPath;
  } catch (error) {
    console.error('Error getting mods path:', error);
    throw error;
  }
}

function saveModsToConfig(mods) {
  try {
    let config = {};
    
    if (fs.existsSync(CONFIG_FILE)) {
      config = JSON.parse(fs.readFileSync(CONFIG_FILE, 'utf8'));
    }
    
    config.installedMods = mods;
    
    if (!fs.existsSync(path.dirname(CONFIG_FILE))) {
      fs.mkdirSync(path.dirname(CONFIG_FILE), { recursive: true });
    }
    
    fs.writeFileSync(CONFIG_FILE, JSON.stringify(config, null, 2));
    console.log('Mods saved to config.json');
  } catch (error) {
    console.error('Error saving mods to config:', error);
  }
}

function loadModsFromConfig() {
  try {
    if (fs.existsSync(CONFIG_FILE)) {
      const config = JSON.parse(fs.readFileSync(CONFIG_FILE, 'utf8'));
      return config.installedMods || [];
    }
    return [];
  } catch (error) {
    console.error('Error loading mods from config:', error);
    return [];
  }
}

async function loadInstalledMods(modsPath) {
  try {
    const configMods = loadModsFromConfig();
    const modsMap = new Map();
    
    configMods.forEach(mod => {
      modsMap.set(mod.fileName, mod);
    });
    
    if (fs.existsSync(modsPath)) {
      const files = fs.readdirSync(modsPath);
      
      for (const file of files) {
        const filePath = path.join(modsPath, file);
        const stats = fs.statSync(filePath);
        
        if (stats.isFile() && (file.endsWith('.jar') || file.endsWith('.zip'))) {
          const configMod = modsMap.get(file);
          
          const modInfo = {
            id: configMod?.id || generateModId(file),
            name: configMod?.name || extractModName(file),
            version: configMod?.version || extractVersion(file) || '1.0.0',
            description: configMod?.description || 'Installed mod',
            author: configMod?.author || 'Unknown',
            enabled: true,
            filePath: filePath,
            fileName: file,
            fileSize: configMod?.fileSize || stats.size,
            dateInstalled: configMod?.dateInstalled || stats.birthtime || stats.mtime,
            curseForgeId: configMod?.curseForgeId,
            curseForgeFileId: configMod?.curseForgeFileId
          };
          
          modsMap.set(file, modInfo);
        }
      }
    }
    
    const disabledModsPath = path.join(path.dirname(modsPath), 'DisabledMods');
    if (fs.existsSync(disabledModsPath)) {
      const files = fs.readdirSync(disabledModsPath);
      
      for (const file of files) {
        const filePath = path.join(disabledModsPath, file);
        const stats = fs.statSync(filePath);
        
        if (stats.isFile() && (file.endsWith('.jar') || file.endsWith('.zip'))) {
          const configMod = modsMap.get(file);
          
          const modInfo = {
            id: configMod?.id || generateModId(file),
            name: configMod?.name || extractModName(file),
            version: configMod?.version || extractVersion(file) || '1.0.0',
            description: configMod?.description || 'Disabled mod',
            author: configMod?.author || 'Unknown',
            enabled: false,
            filePath: filePath,
            fileName: file,
            fileSize: configMod?.fileSize || stats.size,
            dateInstalled: configMod?.dateInstalled || stats.birthtime || stats.mtime,
            curseForgeId: configMod?.curseForgeId,
            curseForgeFileId: configMod?.curseForgeFileId
          };
          
          modsMap.set(file, modInfo);
        }
      }
    }
    
    return Array.from(modsMap.values());
  } catch (error) {
    console.error('Error loading installed mods:', error);
    return [];
  }
}

function generateModId(filename) {
  return crypto.createHash('md5').update(filename).digest('hex').substring(0, 8);
}

function extractModName(filename) {
  let name = path.parse(filename).name;
  
  name = name.replace(/-v?\d+\.[\d\.]+.*$/i, '');
  name = name.replace(/-\d+\.[\d\.]+.*$/i, '');
  
  name = name.replace(/[-_]/g, ' ');
  name = name.replace(/\b\w/g, l => l.toUpperCase());
  
  return name || 'Unknown Mod';
}

function extractVersion(filename) {
  const versionMatch = filename.match(/v?(\d+\.[\d\.]+)/);
  return versionMatch ? versionMatch[1] : null;
}

async function downloadMod(modInfo) {
  try {
    const modsPath = await getModsPath();
    
    if (!modInfo.downloadUrl && !modInfo.fileId) {
      throw new Error('No download URL or file ID provided');
    }
    
    let downloadUrl = modInfo.downloadUrl;
    
    if (!downloadUrl && modInfo.fileId && modInfo.modId) {
      const response = await axios.get(`https://api.curseforge.com/v1/mods/${modInfo.modId}/files/${modInfo.fileId}`, {
        headers: {
          'x-api-key': modInfo.apiKey,
          'Accept': 'application/json'
        }
      });
      
      downloadUrl = response.data.data.downloadUrl;
    }
    
    if (!downloadUrl) {
      throw new Error('Could not determine download URL');
    }
    
    const fileName = modInfo.fileName || `mod-${modInfo.modId}.jar`;
    const filePath = path.join(modsPath, fileName);
    
    const response = await axios({
      method: 'get',
      url: downloadUrl,
      responseType: 'stream'
    });
    
    const writer = fs.createWriteStream(filePath);
    response.data.pipe(writer);
    
    return new Promise((resolve, reject) => {
      writer.on('finish', () => {
        const configMods = loadModsFromConfig();
        const newMod = {
          id: modInfo.id || generateModId(fileName),
          name: modInfo.name || extractModName(fileName),
          version: modInfo.version || '1.0.0',
          description: modInfo.summary || modInfo.description || 'Downloaded from CurseForge',
          author: modInfo.author || 'Unknown',
          enabled: true,
          fileName: fileName,
          fileSize: fs.statSync(filePath).size,
          dateInstalled: new Date().toISOString(),
          curseForgeId: modInfo.modId,
          curseForgeFileId: modInfo.fileId
        };
        
        configMods.push(newMod);
        saveModsToConfig(configMods);
        
        resolve({
          success: true,
          filePath: filePath,
          fileName: fileName,
          modInfo: newMod
        });
      });
      writer.on('error', reject);
    });
    
  } catch (error) {
    console.error('Error downloading mod:', error);
    return {
      success: false,
      error: error.message
    };
  }
}

async function uninstallMod(modId, modsPath) {
  try {
    const configMods = loadModsFromConfig();
    const mod = configMods.find(m => m.id === modId);
    
    if (!mod) {
      throw new Error('Mod not found in config');
    }
    
    const disabledModsPath = path.join(path.dirname(modsPath), 'DisabledMods');
    const enabledPath = path.join(modsPath, mod.fileName);
    const disabledPath = path.join(disabledModsPath, mod.fileName);
    
    let fileRemoved = false;
    if (fs.existsSync(enabledPath)) {
      fs.unlinkSync(enabledPath);
      fileRemoved = true;
      console.log('Removed mod from Mods folder:', enabledPath);
    } else if (fs.existsSync(disabledPath)) {
      fs.unlinkSync(disabledPath);
      fileRemoved = true;
      console.log('Removed mod from DisabledMods folder:', disabledPath);
    }
    
    if (!fileRemoved) {
      console.warn('Mod file not found on filesystem, removing from config anyway');
    }
    
    const updatedMods = configMods.filter(m => m.id !== modId);
    saveModsToConfig(updatedMods);
    console.log('Mod removed from config.json');
    
    return { success: true };
  } catch (error) {
    console.error('Error uninstalling mod:', error);
    return {
      success: false,
      error: error.message
    };
  }
}

async function toggleMod(modId, modsPath) {
  try {
    const mods = await loadInstalledMods(modsPath);
    const mod = mods.find(m => m.id === modId);
    
    if (!mod) {
      throw new Error('Mod not found');
    }

    const disabledModsPath = path.join(path.dirname(modsPath), 'DisabledMods');
    if (!fs.existsSync(disabledModsPath)) {
      fs.mkdirSync(disabledModsPath, { recursive: true });
    }

    const currentPath = mod.filePath;
    let newPath, newEnabled;

    if (mod.enabled) {
      newPath = path.join(disabledModsPath, path.basename(currentPath));
      newEnabled = false;
    } else {
      newPath = path.join(modsPath, path.basename(currentPath));
      newEnabled = true;
    }

    fs.renameSync(currentPath, newPath);
    
    const configMods = loadModsFromConfig();
    const configModIndex = configMods.findIndex(m => m.id === modId);
    if (configModIndex !== -1) {
      configMods[configModIndex].enabled = newEnabled;
      saveModsToConfig(configMods);
    }
    
    return { success: true, enabled: newEnabled };
  } catch (error) {
    console.error('Error toggling mod:', error);
    return {
      success: false,
      error: error.message
    };
  }
}

module.exports = {
  launchGame,
  launchGameWithVersionCheck,
  installGame,
  saveUsername,
  loadUsername,
  saveChatUsername,
  loadChatUsername,
  saveJavaPath,
  loadJavaPath,
  saveInstallPath,
  loadInstallPath,
  isGameInstalled,
  uninstallGame,
  getHytaleNews,
  getJavaDetection,
  getOrCreatePlayerId,
  checkAndInstallMultiClient,
  getModsPath,
  loadInstalledMods,
  downloadMod,
  uninstallMod,
  toggleMod,
  saveModsToConfig,
  loadModsFromConfig,
  getInstalledClientVersion,
  getLatestClientVersion,
  updateGameFiles,
  downloadAndReplaceHomePageUI,
  findHomePageUIPath,
  downloadAndReplaceLogo,
  findLogoPath,
  isFirstLaunch,
  markAsLaunched,
  checkExistingGameInstallation,
  proposeGameUpdate,
  handleFirstLaunchCheck
};
