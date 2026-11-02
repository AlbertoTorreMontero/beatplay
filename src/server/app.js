// Aplicación Express: páginas, login y API.
const path = require("path");
const express = require("express");
const { createSessions } = require("./session");
const { createLibrary } = require("./library");
const { authRoutes } = require("./routes/auth");
const { apiRoutes } = require("./routes/api");

function createApp({ provider, clientDir, hipsterPlaylistId }) {

    const app = express();
    const sessions = createSessions(provider);
    const library = createLibrary(provider);
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
    app.use(express.static(clientDir, { index: false, redirect: false }));

    app.get("/", (req, res) => res.sendFile(path.join(clientDir, "landing", "index.html")));
    app.get("/app", (req, res) => res.sendFile(path.join(clientDir, "app", "index.html")));

    app.use(authRoutes({ provider, sessions }));
    app.use("/api", apiRoutes({ provider, sessions, library, hipsterPlaylistId }));

    app.use((req, res) => res.redirect("/"));

    return app;
}

module.exports = { createApp };
