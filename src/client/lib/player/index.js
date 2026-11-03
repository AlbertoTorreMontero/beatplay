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
 *   playAt(index)              reproduce la canción n de esa lista (la exacta)
 *   pause(), resume(), toggle(), seek(ms)
 * y avisa de lo que suena con emit({ ref, position, duration, paused }).
 *
 * Spotify: en el ordenador suena en el propio navegador (Web Playback SDK). En el móvil, Spotify
 * no permite ese reproductor, así que suena en la app de Spotify del móvil (Spotify Connect).
 * Si el navegador de escritorio no puede (sin DRM), también se usa Spotify Connect.
 */

import { toast } from "../ui.js";

const ADAPTERS = {
    "spotify-sdk": () => import("./spotify-sdk.js"),
    "spotify-connect": () => import("./spotify-connect.js"),
    preview: () => import("./preview.js")
};

let adapter = null;
let queue = []; // lista cargada por el juego, aunque el reproductor aún no esté listo
let ready = null;
let mode = null; // adaptador en uso

// Spotify no deja usar su reproductor web en navegadores de móvil.
export const isMobile = () => Boolean(navigator.userAgentData?.mobile) || /Android|iPhone|iPad|iPod|Mobile/i.test(navigator.userAgent);
const listeners = new Set();

const emit = state => {
    const stamped = { ...state, at: performance.now() };
    listeners.forEach(listener => listener(stamped));
};

async function start(name) {
    const module = await ADAPTERS[name]();
    const candidate = module.createPlayer({ emit, warn: message => toast(message, { error: true }) });
    await candidate.init();
    candidate.load(queue);
    adapter = candidate;
    mode = name;
    return name;
}

// Lo llama la app al arrancar con el tipo de reproductor del proveedor. Devuelve el que se usa.
export function setupPlayer(kind) {
    ready = (async () => {
        if (!ADAPTERS[kind]) throw new Error("Este servicio de música no permite reproducir desde la web.");
        if (kind !== "spotify-sdk") return start(kind);
        if (isMobile()) return start("spotify-connect");

        try {
            return await start("spotify-sdk");
        } catch (error) {
            console.warn("Reproductor del navegador no disponible, se usa la app de Spotify:", error.message);
            return start("spotify-connect");
        }
    })();

    ready.catch(() => {});
    return ready;
}

export const playerMode = () => mode;

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
    return Math.max(0, Math.min(state.duration, state.position + elapsed));
}
