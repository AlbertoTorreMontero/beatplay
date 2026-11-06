// Recuerda qué Client ID usa cada cuenta (por correo y por usuario de Spotify), para que
// "Ya estoy registrado" solo pida el correo. Un Client ID no es secreto con PKCE: sin la
// contraseña de la cuenta no sirve de nada.
//
// Dónde se guarda:
//  - Con UPSTASH_REDIS_REST_URL y UPSTASH_REDIS_REST_TOKEN: en Upstash Redis (gratis). Aguanta
//    reinicios y despliegues de Render.
//  - Si no: en data/accounts.json (vale en local; en Render se borra al reiniciar).
const fs = require("fs");
const path = require("path");

const PREFIX = "beatplay:account:";
const key = value => String(value || "").trim().toLowerCase();

function redisStore(url, token) {
    async function command(...args) {
        const res = await fetch(url, {
            method: "POST",
            headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
            body: JSON.stringify(args)
        });
        if (!res.ok) throw new Error(`Upstash respondió ${res.status}`);
        return (await res.json()).result;
    }
    return {
        get: name => command("GET", PREFIX + name),
        set: (name, value) => command("SET", PREFIX + name, value)
    };
}

function fileStore(dataDir) {
    const file = path.join(dataDir, "accounts.json");
    let accounts = {};
    try {
        accounts = JSON.parse(fs.readFileSync(file, "utf8"));
    } catch {
        accounts = {};
    }
    return {
        get: async name => accounts[name] || null,
        async set(name, value) {
            accounts[name] = value;
            fs.mkdirSync(dataDir, { recursive: true });
            fs.writeFileSync(file, JSON.stringify(accounts, null, 2));
        }
    };
}

function createAccounts(dataDir) {
    const { UPSTASH_REDIS_REST_URL: url, UPSTASH_REDIS_REST_TOKEN: token } = process.env;
    const store = url && token ? redisStore(url, token) : fileStore(dataDir);
    if (!(url && token) && process.env.NODE_ENV === "production") {
        console.warn("Sin UPSTASH_REDIS_REST_URL/TOKEN: 'Ya estoy registrado' olvidará las cuentas al reiniciar.");
    }

    return {
        persistent: Boolean(url && token),

        async remember(profile, clientId) {
            try {
                for (const name of [profile.id, profile.email]) {
                    if (name) await store.set(key(name), clientId);
                }
            } catch (error) {
                console.error("No se pudo guardar la cuenta:", error.message);
            }
        },

        async find(name) {
            try {
                return name ? await store.get(key(name)) : null;
            } catch (error) {
                console.error("No se pudo leer la cuenta:", error.message);
                return null;
            }
        }
    };
}

module.exports = { createAccounts };
