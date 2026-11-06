// Aplicación Express: páginas, login y API.
const path = require("path");
const express = require("express");
const { createSessions } = require("./session");
const { createAccounts } = require("./accounts");
const { createLibrary } = require("./library");
const { createTempo } = require("./tempo");
const { HttpError, route, rateLimit } = require("./utils");
const { authRoutes } = require("./routes/auth");
const { apiRoutes } = require("./routes/api");

function createApp({ provider, clientDir, dataDir, hipsterPlaylistId }) {

    const app = express();
    const sessions = createSessions(provider, { dataDir });
    const library = createLibrary(provider, { dataDir });
    const tempo = createTempo();
    const canonical = new URL(provider.redirectUri);

    app.disable("x-powered-by");
    app.set("trust proxy", 1); // detrás del proxy de Render

    app.get("/healthz", (req, res) => res.send("ok"));

    // La cookie de sesión es de un solo host: entrar por otro (localhost en vez de 127.0.0.1) rompería el login.
    app.use((req, res, next) => {
        if (req.method === "GET" && req.headers.host !== canonical.host) {
            return res.redirect(`${canonical.origin}${req.originalUrl}`);
        }
        next();
    });

    app.use(express.json({ limit: "1mb" }));
    app.use(express.static(clientDir, {
        index: false,
        redirect: false,
        // Las fuentes no cambian: el móvil no las vuelve a descargar. El resto se revalida (ETag).
        setHeaders: (res, file) => {
            if (file.includes(`${path.sep}assets${path.sep}`)) res.set("Cache-Control", "public, max-age=31536000, immutable");
        }
    }));

    app.get("/", (req, res) => res.sendFile(path.join(clientDir, "landing", "index.html")));
    app.get("/app", (req, res) => res.sendFile(path.join(clientDir, "app", "index.html")));

    app.use(authRoutes({ provider, sessions, accounts: createAccounts(dataDir) }));

    // Invitados de Music Roulette: eligen playlist pegando su enlace público, sin iniciar sesión.
    app.post("/api/public/playlist", rateLimit({ max: 10, windowMs: 60000 }), route(async (req, res) => {
        if (!provider.readPublicPlaylist) throw new HttpError("Este servicio no permite leer playlists públicas.", 404);
        res.json(await provider.readPublicPlaylist(req.body?.url));
    }));

    // Enlace de invitación: a qué juego pertenece una sala.
    app.get("/api/public/room/:code", (req, res) => {
        const game = req.app.locals.rooms?.gameOf(req.params.code);
        if (!game) return res.status(404).json({ error: "Esa sala ya no existe." });
        res.json({ game });
    });

    app.use("/api", apiRoutes({ provider, sessions, library, tempo, hipsterPlaylistId }));

    app.use((req, res) => res.redirect("/"));

    return app;
}

module.exports = { createApp };
