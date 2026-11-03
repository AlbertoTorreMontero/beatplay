/*
 * Adaptador del Web Playback SDK de Spotify (requiere Premium).
 *
 * Funciona como la versión original, que iba bien:
 *  - Al estar listo, el reproductor se activa como dispositivo (una llamada): así la primera
 *    canción arranca rápido.
 *  - Cada canción se pide por la API, una a una y exacta. Sin colas ni saltos con el SDK: es
 *    lo único que garantiza que suena la canción que el juego dice.
 *  - Pausar, reanudar, buscar y repetir la misma canción lo hace el SDK, sin API.
 * Para no rozar el límite de Spotify: si llegan varias canciones seguidas (Snake comiendo
 * rápido) solo se pide la última, con al menos 1 s entre llamadas, y nada se reintenta en bucle.
 */
import { api } from "../api.js";

const SDK_URL = "https://sdk.scdn.co/spotify-player.js";
const READY_TIMEOUT = 15000;
const MIN_GAP_MS = 1000;

function loadSdk() {
    if (window.Spotify?.Player) return Promise.resolve();

    return new Promise((resolve, reject) => {
        window.onSpotifyWebPlaybackSDKReady = resolve;
        const script = document.createElement("script");
        script.src = SDK_URL;
        script.onerror = () => reject(new Error("No se pudo cargar el reproductor de Spotify."));
        document.head.append(script);
    });
}

const wait = ms => new Promise(resolve => setTimeout(resolve, ms));

export function createPlayer({ emit, warn }) {

    let sdk = null;
    let deviceId = null;

    let list = [];        // canciones del juego, en orden
    let current = -1;     // índice que el juego quiere oír
    let loaded = null;    // URI que tiene cargada el reproductor
    let wanted = null;    // índice pendiente de pedir (el último pedido gana)
    let sending = null;   // petición en curso
    let lastSend = 0;

    // Spotify puede devolver otra URI para la misma canción (versión de otro mercado).
    const sameSong = (item, ref) => Boolean(item && ref && (item.uri === ref || item.linked_from?.uri === ref));


    // ---- Pedir la canción exacta por la API

    async function flush() {
        while (wanted != null) {
            const gap = MIN_GAP_MS - (Date.now() - lastSend);
            if (gap > 0) await wait(gap);

            const index = wanted;
            wanted = null;
            if (index !== current) continue; // el juego ya pidió otra
            lastSend = Date.now();

            try {
                await api("/api/player/play", { method: "PUT", body: { deviceId, refs: [list[index].ref], index: 0 } });
            } catch (error) {
                // Si Spotify pide esperar poco, se espera y se intenta UNA vez más.
                if (error.status === 429 && error.retryAfter <= 30 && wanted == null && current === index) {
                    warn(`Spotify pide esperar ${error.retryAfter} s.`);
                    await wait(error.retryAfter * 1000);
                    if (wanted == null && current === index) {
                        lastSend = Date.now();
                        await api("/api/player/play", { method: "PUT", body: { deviceId, refs: [list[index].ref], index: 0 } });
                    }
                    continue;
                }
                throw error;
            }
        }
    }

    function playAt(index) {
        if (!deviceId) return Promise.reject(new Error("El reproductor de Spotify no está listo."));
        if (!list[index]?.ref) return Promise.reject(new Error("Esta canción no se puede reproducir."));

        current = index;

        // Ya cargada: desde el principio, sin API.
        if (!sending && loaded === list[index].ref) return sdk.seek(0).then(() => sdk.resume());

        wanted = index;
        if (!sending) sending = flush().finally(() => { sending = null; });
        return sending;
    }

    async function token() {
        return (await api("/api/player/token")).accessToken;
    }

    async function init() {
        await token(); // comprueba la sesión antes de cargar nada
        await loadSdk();

        sdk = new window.Spotify.Player({
            name: "BeatPlay",
            volume: 0.6,
            // El SDK pide el token cuando lo necesita: una sesión larga no se queda sin permiso.
            getOAuthToken: callback => token().then(callback).catch(error => console.error("Token:", error))
        });

        // Firefox, Safari y los móviles solo dejan sonar audio que empieza con un toque del usuario.
        const activate = () => sdk.activateElement?.();
        document.addEventListener("pointerdown", activate, { once: true, capture: true });
        document.addEventListener("keydown", activate, { once: true, capture: true });

        const deviceReady = new Promise((resolve, reject) => {
            const timeout = setTimeout(() => reject(new Error("El reproductor de Spotify tardó demasiado en responder.")), READY_TIMEOUT);

            // Sin Premium nunca llega "ready": mejor avisar que esperar al timeout.
            sdk.addListener("account_error", () => {
                clearTimeout(timeout);
                reject(new Error("Para reproducir música hace falta Spotify Premium."));
            });

            sdk.addListener("ready", async ({ device_id }) => {
                deviceId = device_id;
                // Activar este navegador como dispositivo de Spotify: la primera canción arranca antes.
                await api("/api/player/transfer", { method: "PUT", body: { deviceId } }).catch(error => console.warn("Transferencia:", error.message));
                clearTimeout(timeout);
                resolve();
            });
        });

        sdk.addListener("not_ready", ({ device_id }) => {
            if (deviceId === device_id) deviceId = null;
        });

        sdk.addListener("player_state_changed", state => {
            if (!state) return;

            const item = state.track_window?.current_track;
            const expected = list[current]?.ref;
            loaded = sameSong(item, expected) ? expected : item?.uri || null;

            emit({
                // Se avisa con la URI que pidió el juego, aunque Spotify use otra equivalente.
                ref: loaded,
                position: state.position,
                duration: state.duration,
                paused: state.paused
            });
        });

        // Un error al sonar se avisa (una vez cada poco) y no se reintenta.
        let lastWarn = 0;
        sdk.addListener("playback_error", ({ message }) => {
            console.warn("Spotify playback_error:", message);
            if (Date.now() - lastWarn > 10000) {
                lastWarn = Date.now();
                warn("Spotify no ha podido reproducir esa canción. Espera unos segundos y vuelve a intentarlo.");
            }
        });

        sdk.addListener("authentication_error", ({ message }) => console.warn("Spotify authentication_error:", message));
        sdk.addListener("initialization_error", ({ message }) => console.warn("Spotify initialization_error:", message));

        deviceReady.catch(() => {}); // si connect() falla antes, que este aviso no quede sin capturar

        if (!(await sdk.connect())) {
            throw new Error("No se pudo conectar con Spotify. Activa el contenido DRM del navegador y desactiva los bloqueadores para este sitio.");
        }

        await deviceReady;
    }

    return {
        init,

        load(tracks) {
            list = tracks;
            current = -1;
            wanted = null;
        },

        playAt,

        pause: async () => {
            wanted = null;
            await sdk?.pause().catch(() => {});
        },

        // Si lo cargado no es la canción del juego, se pide la buena.
        resume: () => (current >= 0 && loaded !== list[current]?.ref ? playAt(current) : sdk.resume()),
        toggle: () => (current >= 0 && loaded !== list[current]?.ref ? playAt(current) : sdk.togglePlay()),
        seek: ms => sdk.seek(Math.round(ms))
    };
}
