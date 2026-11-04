/*
 * Adaptador Spotify Connect: la música suena en la app de Spotify (del móvil o del ordenador)
 * y BeatPlay la controla por la API.
 *
 * Se usa cuando el reproductor del navegador no puede sonar: navegadores sin su DRM, o
 * móviles (sobre todo iPhone) donde el navegador no deja reproducir sin tocar la pantalla.
 *
 * Llamadas: una por canción, pausa, reanudar o buscar. No se pregunta a Spotify qué suena
 * (serían llamadas constantes): la posición se calcula aquí desde que se pidió la canción.
 */
import { api } from "../api.js";
import { PLAYER_NAME } from "./spotify-sdk.js";

const MIN_GAP_MS = 1000;
// La app de Spotify tarda un poco en empezar a sonar desde que se lo pedimos.
const START_DELAY_MS = 700;

const wait = ms => new Promise(resolve => setTimeout(resolve, ms));

export function createPlayer({ emit, warn }) {

    let deviceId = null;
    let list = [];
    let current = -1;
    let wanted = null;
    let sending = null;
    let lastSend = 0;
    let state = { ref: null, position: 0, duration: 0, paused: true, at: 0 }; // lo que creemos que suena

    // Posición estimada ahora mismo.
    const positionNow = () => (state.paused ? state.position : state.position + (performance.now() - state.at));

    function report(changes) {
        state = { ...state, ...changes, at: performance.now() };
        emit({ ref: state.ref, position: state.position, duration: state.duration, paused: state.paused });
    }

    // La app del móvil si la hay; si no, la que esté sonando; si no, cualquiera.
    async function findDevice() {
        // Nunca el reproductor del navegador de BeatPlay: si estamos aquí es porque no suena.
        const devices = (await api("/api/player/devices")).filter(device => device.name !== PLAYER_NAME);
        const pick =
            devices.find(device => device.type === "Smartphone" && device.active) ||
            devices.find(device => device.active) ||
            devices.find(device => device.type === "Smartphone") ||
            devices[0];

        if (!pick) {
            throw new Error("Abre la app de Spotify en este dispositivo, pon cualquier canción un segundo y vuelve a intentarlo.");
        }

        deviceId = pick.id;
        return pick;
    }

    // Llamada de control con el dispositivo; si se ha perdido (app cerrada), se busca otra vez una vez.
    async function control(action, body = {}) {
        if (!deviceId) await findDevice();
        try {
            await api(`/api/player/${action}`, { method: "PUT", body: { deviceId, ...body } });
        } catch (error) {
            if (error.status !== 404) throw error;
            await findDevice();
            await api(`/api/player/${action}`, { method: "PUT", body: { deviceId, ...body } });
        }
    }

    async function flush() {
        while (wanted != null) {
            const gap = MIN_GAP_MS - (Date.now() - lastSend);
            if (gap > 0) await wait(gap);

            const index = wanted;
            wanted = null;
            if (index !== current) continue;
            lastSend = Date.now();

            const track = list[index];
            await control("play", { refs: [track.ref], index: 0 });
            report({ ref: track.ref, position: -START_DELAY_MS, duration: track.duration || 0, paused: false });
        }
    }

    return {
        // Busca el dispositivo al empezar, sin fallar: si no hay, se avisa al pedir la primera canción.
        async init() {
            await findDevice().catch(() => {});
        },

        load(tracks) {
            list = tracks;
            current = -1;
            wanted = null;
        },

        // Siempre la canción exacta (también para repetirla desde el principio): una llamada.
        playAt(index) {
            if (!list[index]?.ref) return Promise.reject(new Error("Esta canción no se puede reproducir."));
            current = index;
            wanted = index;
            if (!sending) sending = flush().finally(() => { sending = null; });
            return sending;
        },

        async pause() {
            wanted = null;
            if (state.paused || !deviceId) return;
            const position = Math.max(0, positionNow());
            report({ position, paused: true });
            await control("pause").catch(error => warn(error.message));
        },

        async resume() {
            if (current >= 0 && state.ref !== list[current]?.ref) return this.playAt(current);
            if (!state.paused) return;
            await control("resume");
            report({ paused: false });
        },

        async toggle() {
            return state.paused ? this.resume() : this.pause();
        },

        async seek(ms) {
            await control("seek", { positionMs: ms });
            report({ position: ms });
        }
    };
}
