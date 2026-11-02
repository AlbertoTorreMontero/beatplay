/*
 * Reproductor de la app, independiente del servicio de música.
 *
 * Los juegos solo usan este módulo. El servidor dice qué reproductor toca
 * (provider.playback en /api/me) y aquí se carga el adaptador que corresponda.
 * Para otro servicio: crea player/<nombre>.js con la misma forma y regístralo.
 *
 * Un adaptador expone:
 *   init()                     prepara el reproductor (lanza si no puede)
 *   play(track, positionMs)    reproduce una canción del modelo neutro
 *   pause(), toggle(), seek(ms)
 *   onState(listener)          avisa con { ref, position, duration, paused }
 */

const ADAPTERS = {
    "spotify-sdk": () => import("./spotify-sdk.js"),
    preview: () => import("./preview.js")
};

let adapter = null;
let ready = null;
const listeners = new Set();

const emit = state => {
    const stamped = { ...state, at: performance.now() };
    listeners.forEach(listener => listener(stamped));
};

// Lo llama la app al arrancar con el tipo de reproductor del proveedor.
export function setupPlayer(kind) {
    const load = ADAPTERS[kind];

    ready = load
        ? load().then(async module => {
            adapter = module.createPlayer({ emit });
            await adapter.init();
        })
        : Promise.reject(new Error("Este servicio de música no permite reproducir desde la web."));

    ready.catch(() => {});
    return ready;
}

async function withPlayer() {
    if (!ready) throw new Error("El reproductor no está configurado.");
    await ready;
    return adapter;
}

export const player = {
    ready: () => withPlayer().then(() => true),
    play: async (track, positionMs = 0) => (await withPlayer()).play(track, positionMs),
    toggle: async () => (await withPlayer()).toggle(),
    seek: async ms => (await withPlayer()).seek(ms),

    // Pausar nunca debe romper una salida de juego.
    pause: async () => {
        try {
            if (adapter) await adapter.pause();
        } catch (error) {
            console.warn("Pausa:", error.message);
        }
    },

    onState(listener) {
        listeners.add(listener);
        return () => listeners.delete(listener);
    }
};

// Posición actual estimada: entre avisos del reproductor, el tiempo sigue corriendo.
export function positionNow(state) {
    if (!state?.duration) return 0;
    const elapsed = state.paused ? 0 : performance.now() - state.at;
    return Math.min(state.duration, state.position + elapsed);
}
