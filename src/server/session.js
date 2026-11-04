// Sesiones sin memoria en el servidor: la sesión entera (tokens y perfil) viaja cifrada en la
// cookie. Así un reinicio o un despliegue en Render no echa a nadie.
const crypto = require("crypto");
const fs = require("fs");
const path = require("path");
const { HttpError } = require("./utils");

const SESSION_COOKIE = "beatplay_session";
const STATE_COOKIE = "beatplay_oauth_state";
const SESSION_MAX_AGE = 60 * 24 * 60 * 60 * 1000; // 60 días; se alarga con el uso
const STATE_MAX_AGE = 10 * 60 * 1000;
const REFRESH_REUSE_MS = 10 * 60 * 1000;

// Clave de cifrado: SESSION_SECRET; si no, se deriva del secreto de la app de Spotify (ya está en
// Render); si tampoco, una aleatoria guardada en data/ (en local).
function loadKey(dataDir) {
    const secret = process.env.SESSION_SECRET || process.env.SPOTIFY_CLIENT_SECRET;
    if (secret) return crypto.createHash("sha256").update(`beatplay-session:${secret}`).digest();

    const file = path.join(dataDir, "session.key");
    try {
        return Buffer.from(fs.readFileSync(file, "utf8").trim(), "hex");
    } catch {
        const key = crypto.randomBytes(32);
        try {
            fs.mkdirSync(dataDir, { recursive: true });
            fs.writeFileSync(file, key.toString("hex"));
        } catch {
            console.warn("Sin SESSION_SECRET: las sesiones se perderán al reiniciar.");
        }
        return key;
    }
}

function createSessions(provider, { dataDir }) {

    const key = loadKey(dataDir);
    // Varias peticiones a la vez pueden traer el mismo token caducado: se renueva una sola vez.
    const refreshing = new Map();

    const cookieOptions = {
        httpOnly: true,
        sameSite: "lax", // con "strict" la cookie no viajaría en la vuelta desde el login del proveedor
        secure: provider.redirectUri.startsWith("https://"),
        path: "/"
    };

    function seal(data) {
        const iv = crypto.randomBytes(12);
        const cipher = crypto.createCipheriv("aes-256-gcm", key, iv);
        const body = Buffer.concat([cipher.update(JSON.stringify(data), "utf8"), cipher.final()]);
        return Buffer.concat([iv, cipher.getAuthTag(), body]).toString("base64url");
    }

    function open(value) {
        try {
            const raw = Buffer.from(value, "base64url");
            const decipher = crypto.createDecipheriv("aes-256-gcm", key, raw.subarray(0, 12));
            decipher.setAuthTag(raw.subarray(12, 28));
            return JSON.parse(Buffer.concat([decipher.update(raw.subarray(28)), decipher.final()]).toString("utf8"));
        } catch {
            return null; // cookie de otra clave, manipulada o antigua
        }
    }

    function getCookie(req, name) {
        const cookie = req.headers.cookie?.split("; ").find(part => part.startsWith(`${name}=`));
        return cookie ? decodeURIComponent(cookie.slice(name.length + 1)) : null;
    }

    const save = (res, session) => res.cookie(SESSION_COOKIE, seal(session), { ...cookieOptions, maxAge: SESSION_MAX_AGE });

    // Solo lo necesario: la cookie tiene que caber en 4 KB.
    function start(req, res, tokens, profile) {
        save(res, {
            tokens: { accessToken: tokens.accessToken, refreshToken: tokens.refreshToken, expiresAt: tokens.expiresAt, clientId: tokens.clientId, ownApp: tokens.ownApp },
            profile: { id: profile.id, name: profile.name }
        });
    }

    function destroy(req, res) {
        res.clearCookie(SESSION_COOKIE, cookieOptions);
    }

    async function renew(tokens) {
        const known = refreshing.get(tokens.refreshToken);
        if (known && Date.now() - known.at < REFRESH_REUSE_MS) return known.promise;

        const promise = provider.refresh(tokens);
        refreshing.set(tokens.refreshToken, { promise, at: Date.now() });
        promise.catch(() => refreshing.delete(tokens.refreshToken));
        for (const [token, entry] of refreshing) {
            if (Date.now() - entry.at > REFRESH_REUSE_MS) refreshing.delete(token);
        }
        return promise;
    }

    // Middleware: exige sesión y deja el token vigente en req.token (lo renueva si ha caducado).
    async function requireSession(req, res, next) {
        const session = open(getCookie(req, SESSION_COOKIE));
        if (!session?.tokens) return res.status(401).json({ error: "No has iniciado sesión." });

        if (Date.now() >= session.tokens.expiresAt) {
            try {
                const fresh = await renew(session.tokens);
                session.tokens = { ...session.tokens, accessToken: fresh.accessToken, refreshToken: fresh.refreshToken, expiresAt: fresh.expiresAt };
                save(res, session);
            } catch (error) {
                console.error("No se pudo renovar el token:", error.message);
                destroy(req, res);
                const expired = new HttpError("Tu sesión ha caducado. Vuelve a entrar.", 401);
                return res.status(expired.status).json({ error: expired.message });
            }
        }

        req.session = session;
        req.token = session.tokens.accessToken;
        next();
    }

    // State de OAuth: evita que alguien nos haga iniciar sesión con su cuenta sin querer.
    // Viaja junto a los datos del login (Client ID y verificador PKCE) hasta la vuelta del proveedor.
    function issueState(res, login) {
        const state = crypto.randomBytes(16).toString("hex");
        res.cookie(STATE_COOKIE, JSON.stringify({ state, login }), { ...cookieOptions, maxAge: STATE_MAX_AGE });
        return state;
    }

    // Devuelve los datos del login si el state coincide; si no, null.
    function checkState(req, res, state) {
        res.clearCookie(STATE_COOKIE, cookieOptions);
        try {
            const saved = JSON.parse(getCookie(req, STATE_COOKIE));
            return state && saved?.state === state ? saved.login : null;
        } catch {
            return null;
        }
    }

    return { start, destroy, requireSession, issueState, checkState };
}

module.exports = { createSessions };
