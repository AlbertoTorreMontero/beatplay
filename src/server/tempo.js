/*
 * Datos de Deezer para los juegos: tempo (BPM) y muestra de audio de 30 s.
 *
 * Spotify ya no da el tempo a las apps nuevas (audio-features responde 403 desde 2024) y su
 * audio viene cifrado, así que no se puede analizar. Deezer tiene una API pública, gratis y sin
 * clave: buscamos cada canción por su ISRC (código universal que Spotify sí da) o, si no, por
 * título y artista. De ahí sale:
 *   - el BPM, cuando Deezer lo sabe (muchas veces da 0: entonces lo calcula el navegador);
 *   - la muestra de 30 s, que el navegador sí puede analizar y filtrar (BPM, Capas, Intro).
 * Nada de esto gasta llamadas a Spotify.
 */
const API = "https://api.deezer.com";
const TIMEOUT_MS = 4000;
const CONCURRENCY = 4;       // Deezer permite unas 50 peticiones cada 5 s: vamos muy por debajo
const MAX_CACHE = 20000;
const PREVIEW_TTL = 10 * 60 * 1000; // las URL de las muestras caducan: se piden de nuevo a los 10 min
const ISRC = /^[A-Z]{2}[A-Z0-9]{3}\d{7}$/;
const PREVIEW_HOST = /(^|\.)dzcdn\.net$/; // solo se descarga audio del CDN de Deezer

const credible = bpm => (bpm >= 40 && bpm <= 250 ? Math.round(bpm) : null);

function createTempo() {

    const cache = new Map();   // clave → { bpm, preview, at }
    const pending = new Map(); // clave → promesa (dos peticiones a la vez no duplican)

    async function get(path) {
        const response = await fetch(API + path, { signal: AbortSignal.timeout(TIMEOUT_MS) });
        const data = await response.json();
        if (data?.error) return null;
        return data;
    }

    // Busca la canción en Deezer: por ISRC; si no está, por título y artista.
    async function lookup({ isrc, title, artist }) {
        try {
            let track = isrc ? await get(`/track/isrc:${isrc}`) : null;
            if (!track?.id && title) {
                const query = artist ? `artist:"${artist}" track:"${title}"` : title;
                const found = await get(`/search?limit=1&q=${encodeURIComponent(query)}`);
                track = found?.data?.[0] ? await get(`/track/${found.data[0].id}`) : null;
            }
            return { bpm: credible(Number(track?.bpm)), preview: track?.preview || null, at: Date.now() };
        } catch {
            return undefined; // fallo de red: no se guarda, se reintentará
        }
    }

    function info(song) {
        const key = song.isrc || `${song.artist}|${song.title}`.toLowerCase();
        const known = cache.get(key);
        if (known && (!song.needPreview || Date.now() - known.at < PREVIEW_TTL)) return Promise.resolve(known);

        if (!pending.has(key)) {
            pending.set(key, lookup(song).then(result => {
                pending.delete(key);
                if (result !== undefined) {
                    if (cache.size >= MAX_CACHE) cache.clear();
                    cache.set(key, result);
                }
                return result || { bpm: null, preview: null };
            }));
        }
        return pending.get(key);
    }

    // BPM de varios ISRC a la vez, de pocos en pocos. Devuelve { isrc: bpm | null }.
    async function many(list) {
        const codes = [...new Set(list.map(code => String(code || "").toUpperCase()).filter(code => ISRC.test(code)))];
        const result = {};
        let next = 0;

        async function worker() {
            while (next < codes.length) {
                const code = codes[next++];
                result[code] = (await info({ isrc: code })).bpm;
            }
        }

        await Promise.all(Array.from({ length: Math.min(CONCURRENCY, codes.length) }, worker));
        return result;
    }

    // Muestra de audio de una canción: la respuesta de Deezer tal cual (mp3), o null si no hay.
    async function preview({ isrc, title, artist }) {
        const code = String(isrc || "").toUpperCase();
        const song = { isrc: ISRC.test(code) ? code : null, title: String(title || "").slice(0, 120), artist: String(artist || "").slice(0, 120), needPreview: true };
        if (!song.isrc && !song.title) return null;

        const { preview: url } = await info(song);
        if (!url) return null;
        try {
            if (!PREVIEW_HOST.test(new URL(url).hostname)) return null;
            const response = await fetch(url, { signal: AbortSignal.timeout(8000) });
            return response.ok ? response : null;
        } catch {
            return null;
        }
    }

    return { many, preview };
}

module.exports = { createTempo };
