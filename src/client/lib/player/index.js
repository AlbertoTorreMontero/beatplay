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
 * Spotify: siempre se intenta que suene en el propio navegador (Web Playback SDK), también en
 * el móvil: así no hace falta la app y pausar o reanudar no gasta llamadas a la API.
 * Si el navegador no puede (sin DRM, o un iPhone que no deja sonar), se pasa solo a la app de
 * Spotify del dispositivo (Spotify Connect). En el móvil se comprueba con la primera canción:
 * si no empieza a sonar en unos segundos, se cambia a la app y se vuelve a pedir.
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

const MOBILE_READY_MS = 9000;   // en el móvil no se espera tanto al reproductor del navegador
const MOBILE_CHECK_MS = 8000;   // tiempo para que la primera canción empiece a sonar
export const PLAYER_MODE_EVENT = "beatplay:player-mode";

export const isMobile = () => Boolean(navigator.userAgentData?.mobile) || /Android|iPhone|iPad|iPod|Mobile/i.test(navigator.userAgent);
const listeners = new Set();

const emit = state => {
    const stamped = { ...state, at: performance.now() };
    listeners.forEach(listener => listener(stamped));
};

async function start(name, options = {}) {
    const module = await ADAPTERS[name]();
    const candidate = module.createPlayer({ emit, warn: message => toast(message, { error: true }), ...options });
    await candidate.init();
    candidate.load(queue);
    adapter?.disconnect?.();
    adapter = candidate;
    mode = name;
    window.dispatchEvent(new CustomEvent(PLAYER_MODE_EVENT, { detail: name }));
    return name;
}

// ---- Comprobación en el móvil: ¿suena de verdad en el navegador?

let verified = false;
let switching = null;

function verify(index) {
    if (verified || mode !== "spotify-sdk" || !isMobile()) return;
    const ref = queue[index]?.ref;

    const stop = () => {
        clearTimeout(timer);
        listeners.delete(check);
    };
    const check = state => {
        if (state.ref === ref && !state.paused && state.position > 0) {
            verified = true;
            stop();
        }
    };
    const timer = setTimeout(() => {
        stop();
        if (!verified && mode === "spotify-sdk") switchToApp(index);
    }, MOBILE_CHECK_MS);
    listeners.add(check);
}

// Pasa a la app de Spotify y vuelve a pedir la canción que no sonó.
function switchToApp(index) {
    if (switching) return switching;
    toast("Tu navegador no deja sonar la música aquí: pasamos a la app de Spotify. Ábrela si no lo está.");
    switching = start("spotify-connect")
        .then(() => adapter.playAt(index))
        .catch(error => toast(error.message, { error: true }))
        .finally(() => { switching = null; });
    return switching;
}

// Lo llama la app al arrancar con el tipo de reproductor del proveedor. Devuelve el que se usa.
export function setupPlayer(kind) {
    ready = (async () => {
        if (!ADAPTERS[kind]) throw new Error("Este servicio de música no permite reproducir desde la web.");
        if (kind !== "spotify-sdk") return start(kind);

        try {
            return await start("spotify-sdk", isMobile() ? { readyTimeout: MOBILE_READY_MS } : {});
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
    playAt: async index => {
        await withPlayer();
        if (switching) await switching;
        const playing = adapter.playAt(index);
        verify(index);
        return playing;
    },
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
