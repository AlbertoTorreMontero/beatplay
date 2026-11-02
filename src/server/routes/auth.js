// Login con el proveedor de música (OAuth) y cierre de sesión.
const express = require("express");

function authRoutes({ provider, sessions }) {

    const router = express.Router();
    const callbackPath = new URL(provider.redirectUri).pathname;

    router.get("/login", (req, res) => {
        res.redirect(provider.authorizeUrl(sessions.issueState(res)));
    });

    router.get(callbackPath, async (req, res) => {
        const { code, error, state } = req.query;
        const validState = sessions.checkState(req, res, state);

        if (error) return res.redirect("/?auth=denied");
        if (!code || !validState) return res.redirect("/?auth=error");

        try {
            sessions.start(req, res, await provider.exchangeCode(code));
            res.redirect("/app");
        } catch (loginError) {
            console.error("No se pudo completar el login:", loginError.message);
            res.redirect("/?auth=error");
        }
    });

    // Público: la portada y la pantalla de login muestran el nombre del servicio.
    router.get("/auth/provider", (req, res) => res.json({ id: provider.id, name: provider.name }));

    router.post("/auth/logout", (req, res) => {
        sessions.destroy(req, res);
        res.sendStatus(204);
    });

    return router;
}

module.exports = { authRoutes };
