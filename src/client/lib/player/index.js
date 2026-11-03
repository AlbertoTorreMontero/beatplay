/*
 * Reproductor de la app, independiente del servicio de música.
 *
 * Los juegos solo usan este módulo. El servidor dice qué reproductor toca
 * (provider.playback en /api/me) y aquí se carga el adaptador que corresponda.
 * Para otro servicio: crea player/<nombre>.js con la misma forma y regístralo.
 *
 * Un adaptador expone:
 *   init()                     prepara el reproductor (lanza si no puede)
 *   load(tracks)               carga la lista del juego, en orden (sin llamadas)
 *   playAt(index)              reproduce la canción n de esa lista. Avanzar de una en una
 *                              no debe gastar llamadas a la API: es la regla del proyecto
 *   pause(), resume(), toggle(), seek(ms)   todo sin llamadas a la API
 *   onState(listener)          avisa con { ref, position, duration, paused }
 */

import { toast } from "../ui.js";

const ADAPTERS = {
    "spotify-sdk": () => import("./spotify-sdk.js"),
    preview: () => import("./preview.js")
};

let adapter = null;
let queue = []; // lista cargada por el juego, aunque el reproductor aún no esté listo
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
            adapter = module.createPlayer({ emit, warn: message => toast(message, { error: true }) });
            await adapter.init();
            adapter.load(queue);
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
    // Los juegos cargan su lista una vez y piden canciones por posición.
    load(tracks) {
        queue = tracks;
        adapter?.load(tracks);
    },
    playAt: async index => (await withPlayer()).playAt(index),
    resume: async () => (await withPlayer()).resume(),
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
