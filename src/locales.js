const { SettingsManager } = require('./utils');

const TRANS_EN = {
    "launcher.title": "TaleLauncher",
    "launcher.nickname": "NICKNAME",
    "launcher.enter_nickname": "Enter nickname",
    "launcher.version": "VERSION",
    "launcher.loading": "Loading...",
    "launcher.loading_versions": "Loading version list...",
    "launcher.versions_found": "Versions found: {0}",
    "launcher.no_versions": "No versions found. Check your internet connection.",
    "launcher.launch_game": "LAUNCH GAME",
    "launcher.ready": "Ready",
    "launcher.website": "WEBSITE",
    "launcher.youtube": "YOUTUBE",
    "launcher.mods": "MODS",
    "launcher.worlds": "WORLDS",
    "launcher.welcome_title": "Welcome to TaleLauncher",
    "launcher.welcome_text": "This is a fan-made launcher. If you enjoy the game, please agree that simplify you will support the developers and buy the official game when it releases.",
    "launcher.agree_button": "I Agree to buy the game later",
    "launcher.error": "Error: {0}",
    "launcher.failed_versions": "Failed to load versions: {0}",

    "mods.title": "Mods Manager",
    "mods.upload": "Upload Mod",
    "mods.close": "Close",
    "mods.no_mods": "No mods installed",
    "mods.delete_tooltip": "Delete Mod",

    "worlds.title": "Worlds Manager",
    "worlds.import": "Import World (.zip)",
    "worlds.close": "Close",
    "worlds.no_worlds": "No worlds found",
    "worlds.rename_tooltip": "Rename",
    "worlds.delete_tooltip": "Delete",
    "worlds.rename_title": "Rename World",
    "worlds.new_name": "New Name",
    "worlds.cancel": "Cancel",
    "worlds.rename": "Rename",
    "worlds.name_exists": "Name already exists",

    "status.checking_versions": "Checking available versions...",
    "status.java_installed": "Java is already installed",
    "status.downloading_java": "Downloading Java Runtime...",
    "status.extracting_java": "Extracting Java...",
    "status.java_install_error": "Java installation error (system Java will be used): {0}",
    "status.game_installed": "Game is already installed",
    "status.downloading_version": "Downloading version {0}...",
    "status.applying_patch": "Applying patch...",
    "status.game_installed_success": "Game installed!",
    "status.downloading_butler": "Downloading Butler...",
    "status.extracting_butler": "Extracting Butler...",
    "status.game_not_installed": "Game not installed",
    "status.game_launched": "Game launched!",

    "versions.latest": "Latest Version",
    "versions.version_fmt": "Version {0}"
};

const TRANS_RU = {
    "launcher.title": "TaleLauncher",
    "launcher.nickname": "НИКНЕЙМ",
    "launcher.enter_nickname": "Введите никнейм",
    "launcher.version": "ВЕРСИЯ",
    "launcher.loading": "Загрузка...",
    "launcher.loading_versions": "Загрузка списка версий...",
    "launcher.versions_found": "Найдено версий: {0}",
    "launcher.no_versions": "Версии не найдены. Проверьте интернет.",
    "launcher.launch_game": "ИГРАТЬ",
    "launcher.ready": "Готов к запуску",
    "launcher.website": "САЙТ",
    "launcher.youtube": "YOUTUBE",
    "launcher.mods": "МОДЫ",
    "launcher.worlds": "МИРЫ",
    "launcher.welcome_title": "Добро пожаловать в TaleLauncher",
    "launcher.welcome_text": "Это фанатский лаунчер. Если вам нравится игра, пожалуйста, согласитесь поддержать разработчиков и купить официальную игру после её выхода.",
    "launcher.agree_button": "Я куплю игру позже",
    "launcher.error": "Ошибка: {0}",
    "launcher.failed_versions": "Ошибка загрузки версий: {0}",

    "mods.title": "Менеджер Модов",
    "mods.upload": "Загрузить мод",
    "mods.close": "Закрыть",
    "mods.no_mods": "Моды не установлены",
    "mods.delete_tooltip": "Удалить мод",

    "worlds.title": "Менеджер Миров",
    "worlds.import": "Импорт Мира (.zip)",
    "worlds.close": "Закрыть",
    "worlds.no_worlds": "Миры не найдены",
    "worlds.rename_tooltip": "Переименовать",
    "worlds.delete_tooltip": "Удалить",
    "worlds.rename_title": "Переименование мира",
    "worlds.new_name": "Новое имя",
    "worlds.cancel": "Отмена",
    "worlds.rename": "Переименовать",
    "worlds.name_exists": "Имя уже занято",

    "status.checking_versions": "Проверка версии...",
    "status.java_installed": "Java уже установлена",
    "status.downloading_java": "Загрузка Java Runtime...",
    "status.extracting_java": "Распаковка Java...",
    "status.java_install_error": "Ошибка установки Java (используется системная): {0}",
    "status.game_installed": "Игра уже установлена",
    "status.downloading_version": "Загрузка версии {0}...",
    "status.applying_patch": "Установка патча...",
    "status.game_installed_success": "Игра установлена!",
    "status.downloading_butler": "Загрузка Butler...",
    "status.extracting_butler": "Распаковка Butler...",
    "status.game_not_installed": "Игра не установлена",
    "status.game_launched": "Игра запущена!",

    "versions.latest": "Последняя версия",
    "versions.version_fmt": "Версия {0}"
};

const TRANSLATIONS = {
    "EN": TRANS_EN,
    "RU": TRANS_RU
};

function tr(key, ...args) {
    const lang = SettingsManager.getSetting("language", "EN");
    let transMap = TRANSLATIONS[lang] || TRANSLATIONS["EN"];

    let val = transMap[key] || TRANSLATIONS["EN"][key] || key;

    if (args.length > 0) {
        args.forEach((arg, i) => {
            val = val.replace(`{${i}}`, arg);
        });
    }
    return val;
}

function getCurrentLang() {
    return SettingsManager.getSetting("language", "EN");
}

module.exports = {
    tr,
    getCurrentLang
};
