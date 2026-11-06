// Login con el proveedor de música (OAuth) y cierre de sesión.
const express = require("express");
const { route, rateLimit } = require("../utils");

function authRoutes({ provider, sessions, accounts }) {

    const router = express.Router();
    const callbackPath = new URL(provider.redirectUri).pathname;

    // Público: la portada y la pantalla de login lo necesitan para la guía de configuración.
    router.get("/auth/config", (req, res) => {
        res.json({ id: provider.id, name: provider.name, redirectUri: provider.redirectUri, ...provider.setup });
    });

    // "Ya estoy registrado": con el correo (o usuario) de Spotify se sabe qué app usa.
    router.get("/auth/client-id", rateLimit({ max: 20, windowMs: 60000 }), route(async (req, res) => {
        const clientId = await accounts.find(req.query.account);
        if (!clientId) return res.status(404).json({ error: "No encontramos ese correo." });
        res.json({ clientId });
    }));

    // /login?clientId=… entra con la app propia del usuario; sin él, con la compartida (si existe).
    router.get("/login", (req, res) => {
        let login;
        try {
            login = provider.startLogin({ clientId: req.query.clientId });
        } catch {
            return res.redirect("/app?auth=setup");
        }
        res.redirect(provider.authorizeUrl(sessions.issueState(res, login), login));
    });

    router.get(callbackPath, route(async (req, res) => {
        const { code, error, state } = req.query;
        const login = sessions.checkState(req, res, state);

        if (error) return res.redirect("/app?auth=denied");
        if (!code || !login) return res.redirect("/app?auth=error");

        let tokens, profile;
        try {
            tokens = await provider.exchangeCode(code, login);
            profile = await provider.getProfile(tokens.accessToken);
        } catch (loginError) {
            console.error("No se pudo completar el login:", loginError.message);
            // 403: la cuenta no está autorizada en la app compartida.
            return res.redirect(loginError.status === 403 ? "/app?auth=notallowed" : "/app?auth=error");
        }

        if (tokens.ownApp) await accounts.remember(profile, tokens.clientId);
        sessions.start(req, res, tokens, profile);
        res.redirect("/app");
    }));

    router.post("/auth/logout", (req, res) => {
        sessions.destroy(req, res);
        res.sendStatus(204);
    });

    return router;
}

module.exports = { authRoutes };
