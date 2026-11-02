// Lectura de playlists independiente del proveedor: caché por usuario y muestras aleatorias.
const { shuffle, uniqueById } = require("./utils");

const CACHE_TTL = 5 * 60 * 1000;
const CACHE_MAX = 300;
const PARALLEL_PAGES = 5;

function createLibrary(provider) {

    // Reiniciar un juego no vuelve a pedir la misma playlist al servicio.
    const cache = new Map();

    function cached(session, key, load) {
        const cacheKey = `${session.id}:${key}`;
        const hit = cache.get(cacheKey);

        if (hit && hit.expires > Date.now()) return hit.promise;
        if (cache.size >= CACHE_MAX) cache.delete(cache.keys().next().value);

        const promise = load();
        cache.set(cacheKey, { promise, expires: Date.now() + CACHE_TTL });
        promise.catch(() => cache.delete(cacheKey));

        return promise;
    }

    const info = (req, id) => cached(req.session, `info:${id}`, () => provider.getPlaylistInfo(req.token, id));
    const page = (req, id, offset) => cached(req.session, `page:${id}:${offset}`, () => provider.getTrackPage(req.token, id, offset));
    const offsets = total => Array.from({ length: Math.ceil(total / provider.pageSize) }, (_, i) => i * provider.pageSize);

    // Playlist completa, en tandas de páginas paralelas.
    async function allTracks(req, id) {
        const all = offsets((await info(req, id)).total);
        const tracks = [];

        for (let i = 0; i < all.length; i += PARALLEL_PAGES) {
            const pages = await Promise.all(all.slice(i, i + PARALLEL_PAGES).map(offset => page(req, id, offset)));
            tracks.push(...pages.flat());
        }

        return shuffle(uniqueById(tracks));
    }

    // Muestra aleatoria: lee páginas al azar y para en cuanto tiene suficientes canciones.
    async function sampleTracks(req, id, amount, accept = () => true) {
        let tracks = [];

        for (const offset of shuffle(offsets((await info(req, id)).total))) {
            tracks = uniqueById(tracks.concat((await page(req, id, offset)).filter(accept)));
            if (tracks.length >= amount) break;
        }

        return shuffle(tracks).slice(0, amount);
    }

    return { allTracks, sampleTracks };
}

module.exports = { createLibrary };
