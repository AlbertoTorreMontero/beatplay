/*
 * Tempo (BPM) de las canciones, para el modo Synth de Snake.
 *
 * Spotify ya no da el tempo a las apps nuevas (audio-features responde 403 desde 2024).
 * Lo sacamos de la API pública de Deezer, gratis y sin clave, buscando la grabación por su
 * ISRC (código universal que Spotify sí da). No gasta llamadas a Spotify.
 *
 * Cada ISRC se pregunta una sola vez: el resultado (también "no se sabe") se guarda en memoria.
 */
const DEEZER = "https://api.deezer.com/track/isrc:";
const TIMEOUT_MS = 4000;
const CONCURRENCY = 4;   // Deezer permite unas 50 peticiones cada 5 s: vamos muy por debajo
const MAX_CACHE = 20000;
const ISRC = /^[A-Z]{2}[A-Z0-9]{3}\d{7}$/;

function createTempo() {

    const cache = new Map(); // isrc → bpm | null
    const pending = new Map(); // isrc → promesa en curso (dos jugadores a la vez no duplican)

    async function lookup(isrc) {
        try {
            const response = await fetch(DEEZER + isrc, { signal: AbortSignal.timeout(TIMEOUT_MS) });
            const data = await response.json();
            const bpm = Number(data?.bpm);
            // Deezer devuelve 0 cuando no lo sabe. Fuera de 40-250 no es creíble.
            return bpm >= 40 && bpm <= 250 ? Math.round(bpm) : null;
        } catch {
            return undefined; // fallo de red: no se guarda, se podrá reintentar otro día
        }
    }

    function one(isrc) {
        if (cache.has(isrc)) return Promise.resolve(cache.get(isrc));
        if (!pending.has(isrc)) {
            pending.set(isrc, lookup(isrc).then(bpm => {
                pending.delete(isrc);
                if (bpm !== undefined) {
                    if (cache.size >= MAX_CACHE) cache.clear();
                    cache.set(isrc, bpm);
                }
                return bpm ?? null;
            }));
        }
        return pending.get(isrc);
    }

    // Varios ISRC a la vez, de pocos en pocos. Devuelve { isrc: bpm | null }.
    async function many(list) {
        const codes = [...new Set(list.map(code => String(code || "").toUpperCase()).filter(code => ISRC.test(code)))];
        const result = {};
        let next = 0;

        async function worker() {
            while (next < codes.length) {
                const code = codes[next++];
                result[code] = await one(code);
            }
        }

        await Promise.all(Array.from({ length: Math.min(CONCURRENCY, codes.length) }, worker));
        return result;
    }

    return { many };
}

module.exports = { createTempo };
