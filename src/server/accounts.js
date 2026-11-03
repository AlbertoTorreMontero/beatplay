// Recuerda qué Client ID usa cada cuenta, para entrar desde otro dispositivo sin volver a configurarlo.
// Se guarda en data/accounts.json. Un Client ID no es secreto con PKCE: sin la cuenta no sirve de nada.
const fs = require("fs");
const path = require("path");

function createAccounts(dataDir) {

    const file = path.join(dataDir, "accounts.json");
    let accounts = {};

    try {
        accounts = JSON.parse(fs.readFileSync(file, "utf8"));
    } catch {
        accounts = {}; // primera vez o archivo dañado
    }

    const key = value => String(value || "").trim().toLowerCase();

    function save() {
        try {
            fs.mkdirSync(dataDir, { recursive: true });
            fs.writeFileSync(file, JSON.stringify(accounts, null, 2));
        } catch (error) {
            console.error("No se pudo guardar accounts.json:", error.message);
        }
    }

    return {
        // Se puede buscar por el usuario de Spotify o por el email.
        remember(profile, clientId) {
            for (const name of [profile.id, profile.email]) {
                if (name) accounts[key(name)] = clientId;
            }
            save();
        },

        find: name => accounts[key(name)] || null
    };
}

module.exports = { createAccounts };
