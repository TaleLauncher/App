const fs = require('fs-extra');
const path = require('path');
const config = require('./config');
const utils = require('./utils');

class ModsManager {
    static getMods() {
        if (!fs.existsSync(config.MODS_DIR)) {
            fs.ensureDirSync(config.MODS_DIR);
        }
        return fs.readdirSync(config.MODS_DIR).map(name => ({
            name,
            path: path.join(config.MODS_DIR, name)
        }));
    }

    static deleteMod(modName) {
        const modPath = path.join(config.MODS_DIR, modName);
        if (fs.existsSync(modPath)) {
            fs.removeSync(modPath);
        }
    }

    static async uploadMod(filePath) {
        const dest = path.join(config.MODS_DIR, path.basename(filePath));
        await fs.copy(filePath, dest);
    }
}

class WorldsManager {
    static getWorlds() {
        if (!fs.existsSync(config.SAVES_DIR)) {
            fs.ensureDirSync(config.SAVES_DIR);
        }
        const worlds = fs.readdirSync(config.SAVES_DIR)
            .filter(name => fs.statSync(path.join(config.SAVES_DIR, name)).isDirectory())
            .map(name => {
                const worldPath = path.join(config.SAVES_DIR, name);
                const previewPath = path.join(worldPath, 'preview.png');
                let previewBase64 = null;
                if (fs.existsSync(previewPath)) {
                    previewBase64 = fs.readFileSync(previewPath, { encoding: 'base64' });
                }
                return {
                    name,
                    path: worldPath,
                    preview: previewBase64
                };
            });
        return worlds;
    }

    static deleteWorld(worldName) {
        const worldPath = path.join(config.SAVES_DIR, worldName);
        if (fs.existsSync(worldPath)) {
            fs.removeSync(worldPath);
        }
    }

    static async importWorld(zipPath) {
        const worldName = path.parse(zipPath).name;
        let destDir = path.join(config.SAVES_DIR, worldName);

        let counter = 1;
        while (fs.existsSync(destDir)) {
            destDir = path.join(config.SAVES_DIR, `${worldName}_${counter}`);
            counter++;
        }

        utils.extractZip(zipPath, destDir);
        utils.flattenDirectory(destDir);
    }

    static renameWorld(oldName, newName) {
        const oldPath = path.join(config.SAVES_DIR, oldName);
        const newPath = path.join(config.SAVES_DIR, newName);

        console.log(`[DEBUG] Renaming world from "${oldName}" to "${newName}"`);
        console.log(`[DEBUG] Old path: ${oldPath}`);
        console.log(`[DEBUG] New path: ${newPath}`);

        if (fs.existsSync(newPath)) {
            console.error(`[DEBUG] New path already exists: ${newPath}`);
            throw new Error('Name already exists');
        }

        if (!fs.existsSync(oldPath)) {
            console.error(`[DEBUG] Old path does not exist: ${oldPath}`);
            throw new Error('Original world not found');
        }

        // Update world config if exists
        const configPath = path.join(oldPath, 'universe', 'worlds', 'default', 'config.json');
        if (fs.existsSync(configPath)) {
            try {
                console.log(`[DEBUG] Updating world config at: ${configPath}`);
                const data = fs.readJsonSync(configPath);
                data.DisplayName = newName;
                fs.writeJsonSync(configPath, data, { spaces: 2 });
            } catch (e) {
                console.error(`[DEBUG] Error updating world config: ${e}`);
            }
        }

        try {
            fs.moveSync(oldPath, newPath);
            console.log(`[DEBUG] Rename successful`);
        } catch (e) {
            console.error(`[DEBUG] fs.moveSync failed: ${e}`);
            throw e;
        }
    }
}

module.exports = {
    ModsManager,
    WorldsManager
};
