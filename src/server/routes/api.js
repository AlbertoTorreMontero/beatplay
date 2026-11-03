// API JSON para el cliente. Todo cuelga de /api y exige sesión.
const express = require("express");
const { HttpError, route, shuffle } = require("../utils");

const SAMPLE_SIZE = 50; // una página entera: misma llamada, más variedad
const HIPSTER_SIZE = 60;
const hasYear = track => Number.isInteger(track.year) && track.year > 0;

function apiRoutes({ provider, sessions, library, hipsterPlaylistId }) {

    const router = express.Router();

    router.use(sessions.requireSession);

    router.get("/me", route(async (req, res) => {
        const { id, name } = req.session.profile;
        res.json({
            id,
            name,
            provider: { id: provider.id, name: provider.name, playback: provider.playback }
        });
    }));

    router.get("/playlists", route(async (req, res) => {
        res.json((await library.playlists(req, { refresh: Boolean(req.query.refresh) })).filter(playlist => playlist.tracks > 0));
    }));

    // ?all=1 → playlist entera (Bingo). ?dated=1 → solo canciones con año (Hipster). Si no, muestra corta.
    router.get("/playlists/:id/tracks", route(async (req, res) => {
        const { id } = req.params;

        if (req.query.all) return res.json(await library.allTracks(req, id));
        if (req.query.dated) return res.json(await library.sampleTracks(req, id, HIPSTER_SIZE, hasYear));

        res.json(await library.sampleTracks(req, id, SAMPLE_SIZE));
    }));

    router.get("/hipster/tracks", route(async (req, res) => {
        if (!hipsterPlaylistId) {
            throw new HttpError("La selección oficial de Hipster no está configurada (falta HIPSTER_PLAYLIST_ID).", 503);
        }
        res.json(shuffle([...await library.sharedTracks(req, hipsterPlaylistId, hasYear)]).slice(0, HIPSTER_SIZE));
    }));

    // ---- Reproductor del cliente: token y controles, si el proveedor los necesita.

    router.get("/player/token", route(async (req, res) => {
        res.json({
            accessToken: req.token,
            expiresIn: Math.max(0, Math.floor((req.session.tokens.expiresAt - Date.now()) / 1000))
        });
    }));

    router.put("/player/:action", route(async (req, res) => {
        const control = provider.controls?.[req.params.action];

        if (!control) throw new HttpError("Este servicio no admite esa acción.", 404);
        if (!req.body?.deviceId) throw new HttpError("Falta el dispositivo.", 400);

        await control(req.token, req.body || {});
        res.sendStatus(204);
    }));

    router.use((req, res) => res.status(404).json({ error: "Ruta no encontrada." }));

    return router;
}

module.exports = { apiRoutes };
