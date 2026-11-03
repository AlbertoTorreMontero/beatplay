// Sesiones en memoria: una por navegador (cookie), cada jugador con su propia cuenta.
const crypto = require("crypto");
const { HttpError } = require("./utils");

const SESSION_COOKIE = "beatplay_sid";
const STATE_COOKIE = "beatplay_oauth_state";
const SESSION_MAX_AGE = 30 * 24 * 60 * 60 * 1000;
const STATE_MAX_AGE = 10 * 60 * 1000;

function createSessions(provider) {

    const sessions = new Map();

    const cookieOptions = {
        httpOnly: true,
        sameSite: "lax", // con "strict" la cookie no viajaría en la vuelta desde el login del proveedor
        secure: provider.redirectUri.startsWith("https://")
    };

    function getCookie(req, name) {
        const cookie = req.headers.cookie?.split("; ").find(part => part.startsWith(`${name}=`));
        return cookie ? decodeURIComponent(cookie.slice(name.length + 1)) : null;
    }

    // El perfil se guarda al entrar: /api/me no vuelve a preguntar al servicio.
    function start(req, res, tokens, profile) {
        sessions.delete(getCookie(req, SESSION_COOKIE));
        const session = { id: crypto.randomUUID(), tokens, profile };
        sessions.set(session.id, session);
        res.cookie(SESSION_COOKIE, session.id, { ...cookieOptions, maxAge: SESSION_MAX_AGE });
    }

    function destroy(req, res) {
        sessions.delete(getCookie(req, SESSION_COOKIE));
        res.clearCookie(SESSION_COOKIE, cookieOptions);
    }

    // Token de acceso vigente; lo renueva si ha caducado. Si no se puede, la sesión muere.
    async function accessToken(session) {
        if (Date.now() < session.tokens.expiresAt) return session.tokens.accessToken;

        try {
            session.tokens = await provider.refresh(session.tokens);
            return session.tokens.accessToken;
        } catch (error) {
            console.error("No se pudo renovar el token:", error.message);
            sessions.delete(session.id);
            throw new HttpError("Tu sesión ha caducado. Inicia sesión de nuevo.", 401);
        }
    }

    // Middleware: exige sesión y deja el token en req.token.
    async function requireSession(req, res, next) {
        const session = sessions.get(getCookie(req, SESSION_COOKIE));

        if (!session) {
            return res.status(401).json({ error: "No has iniciado sesión." });
        }

        try {
            req.session = session;
            req.token = await accessToken(session);
            next();
        } catch (error) {
            res.status(error.status || 500).json({ error: error.message });
        }
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
