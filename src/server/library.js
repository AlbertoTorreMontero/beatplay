/*
 * Lectura de playlists independiente del proveedor.
 * Regla del proyecto: el menor número posible de llamadas a la API del servicio.
 *  - Todo se cachea por usuario (30 min): reiniciar o cambiar de juego no vuelve a pedir nada.
 *  - El total de canciones sale de la lista de playlists ya cacheada o de la primera página:
 *    no hay llamada aparte para saber cuántas tiene.
 *  - Una muestra aleatoria lee solo las páginas que necesita.
 *  - La selección oficial de Hipster es la misma para todos: se guarda una vez en disco.
 */
const fs = require("fs");
const path = require("path");
const { shuffle, uniqueById, HttpError } = require("./utils");

const CACHE_TTL = 30 * 60 * 1000;
const CACHE_MAX = 500;
const PARALLEL_PAGES = 5;
const SHARED_TTL = 7 * 24 * 60 * 60 * 1000;

function createLibrary(provider, { dataDir }) {

    const cache = new Map();

    function cached(key, load) {
        const hit = cache.get(key);
        if (hit && hit.expires > Date.now()) return hit.promise;
        if (cache.size >= CACHE_MAX) cache.delete(cache.keys().next().value);

        const promise = load();
        cache.set(key, { promise, expires: Date.now() + CACHE_TTL });
        promise.catch(() => cache.delete(key));
        return promise;
    }

    const userKey = (req, key) => `${req.session.profile.id}:${key}`;

    // refresh: el usuario pulsó "Volver a cargar" (p. ej. acaba de crear una playlist).
    function playlists(req, { refresh = false } = {}) {
        if (refresh) cache.delete(userKey(req, "playlists"));
        return cached(userKey(req, "playlists"), () => provider.listPlaylists(req.token));
    }
    const page = (req, id, offset) => cached(userKey(req, `page:${id}:${offset}`), () => provider.getTrackPage(req.token, id, offset));
    const offsets = total => Array.from({ length: Math.ceil(total / provider.pageSize) }, (_, i) => i * provider.pageSize);

    // Total de canciones sin gastar una llamada: de la lista de playlists si ya está en caché.
    async function knownTotal(req, id) {
        const hit = cache.get(userKey(req, "playlists"));
        if (!hit || hit.expires < Date.now()) return null;
        const list = await hit.promise.catch(() => null);
        return list?.find(playlist => playlist.id === id)?.tracks ?? null;
    }

    async function allTracks(req, id) {
        const first = await page(req, id, 0);
        const rest = offsets(first.total).slice(1);
        const tracks = [...first.tracks];

        for (let i = 0; i < rest.length; i += PARALLEL_PAGES) {
            const pages = await Promise.all(rest.slice(i, i + PARALLEL_PAGES).map(offset => page(req, id, offset)));
            tracks.push(...pages.flatMap(result => result.tracks));
        }

        return shuffle(uniqueById(tracks));
    }

    // Muestra aleatoria: páginas al azar hasta tener suficientes. Una playlist corta es una sola llamada.
    async function sampleTracks(req, id, amount, accept = () => true) {
        let total = await knownTotal(req, id);
        let tracks = [];
        const read = new Set();

        if (total == null) {
            const first = await page(req, id, 0);
            total = first.total;
            tracks = first.tracks.filter(accept);
            read.add(0);
        }

        // Primero páginas completas al azar; la última (incompleta) al final: así casi siempre basta una.
        const all = offsets(total);
        const full = total % provider.pageSize ? all.slice(0, -1) : all;
        const order = [...shuffle(full), ...all.slice(full.length)];

        for (const offset of order) {
            if (tracks.length >= amount) break;
            if (read.has(offset)) continue;
            tracks = uniqueById(tracks.concat((await page(req, id, offset)).tracks.filter(accept)));
        }

        return shuffle(tracks).slice(0, amount);
    }


    // ---- Selección oficial de Hipster: compartida por todos y guardada en disco.
    // Spotify solo deja leer una playlist a su dueño, así que la carga quien pueda y la ven todos.

    const sharedFile = path.join(dataDir, "hipster-official.json");
    let shared = null;

    try {
        shared = JSON.parse(fs.readFileSync(sharedFile, "utf8"));
    } catch {
        shared = null;
    }

    async function sharedTracks(req, id, filter) {
        if (shared?.id === id && shared.savedAt + SHARED_TTL > Date.now()) return shared.tracks;

        try {
            const tracks = (await allTracks(req, id)).filter(filter);
            shared = { id, savedAt: Date.now(), tracks };
            fs.mkdirSync(dataDir, { recursive: true });
            fs.writeFile(sharedFile, JSON.stringify(shared), () => {});
            return tracks;
        } catch (error) {
            // Si no se puede leer ahora, mejor una copia antigua que nada.
            if (shared?.id === id) return shared.tracks;
            throw error.status === 403
                ? new HttpError("La selección oficial aún no está disponible. Tiene que abrirla una vez el dueño de la playlist.", 503)
                : error;
        }
    }

    return { allTracks, sampleTracks, playlists, sharedTracks };
}

module.exports = { createLibrary };
