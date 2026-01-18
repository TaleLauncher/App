const api = window.electronAPI;

// Elements
const nicknameField = document.getElementById('nickname-field');
const versionDropdown = document.getElementById('version-dropdown');
const launchBtn = document.getElementById('launch-btn');
const progressContainer = document.querySelector('.progress-bar');
const progressFill = document.getElementById('progress-fill');
const statusText = document.getElementById('status-text');
const langSwitcher = document.getElementById('lang-switcher');
const closeBtn = document.getElementById('close-btn');

// Managers
const modsBtn = document.getElementById('mods-btn');
const worldsBtn = document.getElementById('worlds-btn');
const modsModal = document.getElementById('mods-modal');
const worldsModal = document.getElementById('worlds-modal');
const renameModal = document.getElementById('rename-modal');
const welcomeModal = document.getElementById('welcome-modal');
const overlay = document.getElementById('overlay');
const renameInput = document.getElementById('rename-input');

// Localization keys
const localeKeys = [
    'launcher.nickname', 'launcher.enter_nickname', 'launcher.version',
    'launcher.loading', 'launcher.launch_game', 'launcher.mods',
    'launcher.worlds', 'launcher.website', 'launcher.youtube',
    'mods.title', 'mods.upload', 'mods.close',
    'worlds.title', 'worlds.import', 'worlds.close',
    'launcher.welcome_title', 'launcher.welcome_text', 'launcher.agree_button'
];

let versions = [];
let selectedVersion = null;

// Initialization
async function init() {
    // Load settings
    const lang = await api.getSetting('language', 'EN');
    langSwitcher.value = lang;

    const nick = await api.getSetting('nickname', '');
    nicknameField.value = nick;

    const agreed = await api.getSetting('agreed_to_buy', false);
    if (!agreed) {
        showWelcome();
    }

    updateLocales();
    loadVersions();
    checkLaunchReady();
}

async function loadVersions() {
    statusText.innerText = await api.translate('launcher.loading_versions');
    versions = await api.getVersions();

    versionDropdown.innerHTML = '';
    if (versions.length > 0) {
        versions.forEach((v, i) => {
            const opt = document.createElement('option');
            opt.value = i;
            opt.innerText = v.name;
            versionDropdown.appendChild(opt);
        });
        versionDropdown.value = "0";
        selectedVersion = versions[0];
        statusText.innerText = await api.translate('launcher.ready');
    } else {
        statusText.innerText = await api.translate('launcher.no_versions');
    }
    checkLaunchReady();
}

// Serialization helper
async function updateLocales() {
    for (const [id, key] of Object.entries(labels)) {
        const el = document.getElementById(id);
        if (el) {
            const translation = await api.translate(key);
            if (el.tagName === 'INPUT') {
                el.placeholder = translation;
            } else {
                el.innerText = translation;
            }
        }
    }
}

// Re-using the same keys as Flet for simplicity in this demo
const labels = {
    'label-nickname': 'launcher.nickname',
    'nickname-field': 'launcher.enter_nickname', // as placeholder
    'label-version': 'launcher.version',
    'label-launch': 'launcher.launch_game',
    'label-mods': 'launcher.mods',
    'label-worlds': 'launcher.worlds',
    'label-website': 'launcher.website',
    'label-youtube': 'launcher.youtube',
    'modal-mods-title': 'mods.title',
    'label-upload-mod': 'mods.upload',
    'close-mods-btn': 'mods.close',
    'modal-worlds-title': 'worlds.title',
    'label-import-world': 'worlds.import',
    'close-worlds-btn': 'worlds.close',
    'welcome-title': 'launcher.welcome_title',
    'welcome-text': 'launcher.welcome_text',
    'label-agree': 'launcher.agree_button'
};

// Events
nicknameField.addEventListener('input', () => {
    checkLaunchReady();
    api.setSetting('nickname', nicknameField.value);
});

versionDropdown.addEventListener('change', () => {
    selectedVersion = versions[versionDropdown.value];
    checkLaunchReady();
});

langSwitcher.addEventListener('change', async () => {
    const lang = langSwitcher.value;
    api.setSetting('language', lang);
    location.reload(); // Refresh to apply locales
});

closeBtn.addEventListener('click', () => api.windowControl('close'));

launchBtn.addEventListener('click', async () => {
    if (launchBtn.disabled) return;

    const nickname = nicknameField.value.trim();
    if (!nickname || !selectedVersion) return;

    setControlsEnabled(false);
    progressContainer.style.display = 'block';

    const result = await api.launchGame({ nickname, version: selectedVersion });

    if (!result.success) {
        statusText.innerText = result.error;
        setControlsEnabled(true);
    }
});

// Managers
modsBtn.addEventListener('click', async () => {
    const mods = await api.getMods();
    renderMods(mods);
    showModal(modsModal);
});

worldsBtn.addEventListener('click', async () => {
    const worlds = await api.getWorlds();
    renderWorlds(worlds);
    showModal(worldsModal);
});

document.getElementById('close-mods-btn').addEventListener('click', hideModals);
document.getElementById('close-worlds-btn').addEventListener('click', hideModals);
overlay.addEventListener('click', hideModals);

// Modals logic
function showModal(modal) {
    overlay.classList.remove('hidden');
    modal.classList.remove('hidden');
}

function hideModals() {
    overlay.classList.add('hidden');
    modsModal.classList.add('hidden');
    worldsModal.classList.add('hidden');
    renameModal.classList.add('hidden');
    welcomeModal.classList.add('hidden');
}

function showWelcome() {
    overlay.classList.remove('hidden');
    welcomeModal.classList.remove('hidden');
}

document.getElementById('agree-btn').addEventListener('click', () => {
    api.setSetting('agreed_to_buy', true);
    hideModals();
});

// Renderers
function renderMods(mods) {
    const list = document.getElementById('mods-list');
    list.innerHTML = '';
    if (mods.length === 0) {
        list.innerHTML = '<div style="color: #aaaaaa; font-style: italic; text-align: center; padding: 40px;">No mods installed</div>';
        return;
    }
    mods.forEach(mod => {
        const div = document.createElement('div');
        div.className = 'item-row';

        const icon = document.createElement('span');
        icon.className = 'icon-svg';
        icon.style.webkitMaskImage = "url('art/icons/puzzle-piece-solid.svg')";
        icon.style.maskImage = "url('art/icons/puzzle-piece-solid.svg')";

        const name = document.createElement('span');
        name.className = 'name';
        name.innerText = mod.name;

        const delBtn = document.createElement('button');
        delBtn.className = 'icon-btn delete-btn';
        delBtn.innerHTML = '<span class="icon-svg" style="-webkit-mask-image: url(\'art/icons/trash-solid.svg\'); mask-image: url(\'art/icons/trash-solid.svg\');"></span>';
        delBtn.onclick = () => deleteMod(mod.name);

        div.appendChild(icon);
        div.appendChild(name);
        div.appendChild(delBtn);
        list.appendChild(div);
    });
}

async function deleteMod(name) {
    if (confirm(`Delete mod "${name}"?`)) {
        const mods = await api.deleteMod(name);
        renderMods(mods);
    }
}

document.getElementById('upload-mod-btn').addEventListener('click', async () => {
    // In a real app, I'd use a file picker. 
    // Since I can't trigger a native picker easily without more setup, 
    // I'll use a hidden input or assume the user knows.
    // For this rewrite, I'll just show the logic.
    const input = document.createElement('input');
    input.type = 'file';
    input.onchange = async (e) => {
        if (e.target.files.length > 0) {
            const mods = await api.uploadMod(e.target.files[0].path);
            renderMods(mods);
        }
    };
    input.click();
});

function renderWorlds(worlds) {
    const grid = document.getElementById('worlds-grid');
    grid.innerHTML = '';
    if (worlds.length === 0) {
        grid.innerHTML = '<div style="color: #aaaaaa; font-style: italic; text-align: center; padding: 40px; grid-column: 1/-1;">No worlds found</div>';
        return;
    }
    worlds.forEach(w => {
        const card = document.createElement('div');
        card.className = 'world-card';

        const previewDiv = document.createElement('div');
        previewDiv.className = 'world-preview';
        if (w.preview) {
            previewDiv.innerHTML = `<img src="data:image/png;base64,${w.preview}">`;
        } else {
            previewDiv.innerHTML = '<span class="icon" style="font-size: 40px; color: #333">🌍</span>';
        }

        const nameDiv = document.createElement('div');
        nameDiv.className = 'world-name';
        nameDiv.innerText = w.name;
        nameDiv.title = w.name;

        const actionsDiv = document.createElement('div');
        actionsDiv.className = 'world-actions';

        const editBtn = document.createElement('button');
        editBtn.className = 'icon-btn';
        editBtn.innerHTML = '<span class="icon-svg" style="-webkit-mask-image: url(\'art/icons/pen-solid.svg\'); mask-image: url(\'art/icons/pen-solid.svg\');"></span>';
        editBtn.title = 'Rename';
        editBtn.onclick = () => renameWorld(w.name);

        const deleteBtn = document.createElement('button');
        deleteBtn.className = 'icon-btn delete-btn';
        deleteBtn.innerHTML = '<span class="icon-svg" style="-webkit-mask-image: url(\'art/icons/trash-solid.svg\'); mask-image: url(\'art/icons/trash-solid.svg\');"></span>';
        deleteBtn.title = 'Delete';
        deleteBtn.onclick = () => deleteWorld(w.name);

        actionsDiv.appendChild(editBtn);
        actionsDiv.appendChild(deleteBtn);

        card.appendChild(previewDiv);
        card.appendChild(nameDiv);
        card.appendChild(actionsDiv);

        grid.appendChild(card);
    });
}

async function deleteWorld(name) {
    if (confirm(`Delete world "${name}"?`)) {
        const worlds = await api.deleteWorld(name);
        renderWorlds(worlds);
    }
}

// Rename world logic
let renamingWorldName = null;

async function renameWorld(oldName) {
    renamingWorldName = oldName;
    renameInput.value = oldName;
    showModal(renameModal);
    renameInput.focus();
}

document.getElementById('confirm-rename-btn').addEventListener('click', async () => {
    const newName = renameInput.value.trim();
    if (newName && newName !== renamingWorldName) {
        try {
            const result = await api.renameWorld({ oldName: renamingWorldName, newName });
            if (result.success) {
                renderWorlds(result.worlds);
                hideModals();
            } else {
                alert(result.error || 'Failed to rename');
            }
        } catch (e) {
            alert(`Error: ${e.message}`);
        }
    } else if (newName === renamingWorldName) {
        hideModals();
    }
});

document.getElementById('cancel-rename-btn').addEventListener('click', hideModals);

document.getElementById('import-world-btn').addEventListener('click', async () => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = '.zip';
    input.onchange = async (e) => {
        if (e.target.files.length > 0) {
            const worlds = await api.importWorld(e.target.files[0].path);
            renderWorlds(worlds);
        }
    };
    input.click();
});

// Helpers
function checkLaunchReady() {
    const nick = nicknameField.value.trim();
    const ready = nick.length > 0 && selectedVersion !== null;
    launchBtn.disabled = !ready;
}

function setControlsEnabled(enabled) {
    launchBtn.disabled = !enabled;
    nicknameField.disabled = !enabled;
    versionDropdown.disabled = !enabled;
    launchBtn.style.opacity = enabled ? '1' : '0.5';
}

// Progress and Status bridge
api.onProgress((value) => {
    progressFill.style.width = `${value}%`;
});

api.onStatus((message) => {
    statusText.innerText = message;
});

// Start
init();
