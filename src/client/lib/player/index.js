/*
 * Reproductor de la app: la música suena siempre en esta web, con el Web Playback SDK de
 * Spotify (hace falta Premium). Los juegos solo usan este módulo.
 *
 *   player.load(tracks)   lista del juego, en orden (sin llamadas)
 *   player.playAt(i)      la canción i de esa lista (una llamada a la API)
 *   pause(), resume(), toggle(), seek(ms)   las hace el SDK, sin llamadas
 *   player.onState(fn)    avisa de lo que suena: { ref, position, duration, paused, at }
 *
 * En el móvil el SDK de Spotify no está soportado: se intenta igual y, si la primera canción
 * no empieza a sonar, se avisa con PLAYER_STATUS_EVENT para que la música se ponga desde un
 * ordenador (los invitados juegan desde el móvil sin problema).
 */
import { createPlayer } from "./spotify-sdk.js";

const MOBILE_READY_MS = 9000;
const MOBILE_CHECK_MS = 8000;
export const PLAYER_STATUS_EVENT = "beatplay:player-status";
export const MOBILE_UNSUPPORTED = "En este móvil Spotify no deja sonar la música en la web. Pon la música desde un ordenador: los demás pueden jugar desde el móvil.";

export const isMobile = () => Boolean(navigator.userAgentData?.mobile) || /Android|iPhone|iPad|iPod|Mobile/i.test(navigator.userAgent);

const listeners = new Set();
let adapter = null;
let ready = null;
let queue = [];
let checked = false;

const announce = (ok, message) => window.dispatchEvent(new CustomEvent(PLAYER_STATUS_EVENT, { detail: { ok, message } }));
const emit = state => {
    const stamped = { ...state, at: performance.now() };
    listeners.forEach(listener => listener(stamped));
};

// Lo llama la app al arrancar, una vez con sesión.
export function setupPlayer({ warn }) {
    ready = (async () => {
        const candidate = createPlayer({ emit, warn, ...(isMobile() ? { readyTimeout: MOBILE_READY_MS } : {}) });
        try {
            await candidate.init();
        } catch (error) {
            throw new Error(isMobile() ? MOBILE_UNSUPPORTED : error.message);
        }
        candidate.load(queue);
        adapter = candidate;
    })();
    ready.then(() => announce(true), error => announce(false, error.message));
    return ready;
}

// En el móvil, la primera canción dice si de verdad suena.
function checkMobile(index) {
    if (checked || !isMobile()) return;
    checked = true;
    const ref = queue[index]?.ref;
    let sounded = false;
    const check = state => {
        if (state.ref === ref && !state.paused && state.position > 0) sounded = true;
    };
    listeners.add(check);
    setTimeout(() => {
        listeners.delete(check);
        if (!sounded) announce(false, MOBILE_UNSUPPORTED);
    }, MOBILE_CHECK_MS);
}

async function withPlayer() {
    if (!ready) throw new Error("El reproductor no está listo.");
    await ready;
    return adapter;
}

export const player = {
    ready: () => withPlayer().then(() => true),
    load(tracks) {
        queue = tracks;
        adapter?.load(tracks);
    },
    playAt: async index => {
        const playing = (await withPlayer()).playAt(index);
        checkMobile(index);
        return playing;
    },
    resume: async () => (await withPlayer()).resume(),
    toggle: async () => (await withPlayer()).toggle(),
    seek: async ms => (await withPlayer()).seek(ms),
    // Pausar nunca debe romper una salida de juego.
    pause: async () => {
        try {
            await adapter?.pause();
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
