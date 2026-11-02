// Adaptador del Web Playback SDK de Spotify (requiere Premium).
import { api } from "../api.js";

const SDK_URL = "https://sdk.scdn.co/spotify-player.js";
const READY_TIMEOUT = 15000;

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

export function createPlayer({ emit }) {

    let sdk = null;
    let deviceId = null;

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

        const deviceReady = new Promise((resolve, reject) => {
            const timeout = setTimeout(() => reject(new Error("El reproductor de Spotify tardó demasiado en responder.")), READY_TIMEOUT);

            // Sin Premium nunca llega "ready": mejor avisar que esperar al timeout.
            sdk.addListener("account_error", () => {
                clearTimeout(timeout);
                reject(new Error("Para reproducir música hace falta Spotify Premium."));
            });

            sdk.addListener("ready", async ({ device_id }) => {
                deviceId = device_id;
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
            emit({
                ref: state.track_window?.current_track?.uri || null,
                position: state.position,
                duration: state.duration,
                paused: state.paused
            });
        });

        for (const type of ["initialization_error", "authentication_error", "playback_error"]) {
            sdk.addListener(type, ({ message }) => console.error(`Spotify ${type}:`, message));
        }

        if (!(await sdk.connect())) throw new Error("No se pudo conectar con Spotify.");

        await deviceReady;
    }

    return {
        init,

        async play(track, positionMs = 0) {
            if (!track?.ref) throw new Error("Esta canción no se puede reproducir.");
            if (!deviceId) throw new Error("El reproductor de Spotify no está listo.");
            await api("/api/player/play", { method: "PUT", body: { deviceId, ref: track.ref, positionMs } });
        },

        async pause() {
            if (deviceId) await api("/api/player/pause", { method: "PUT" });
        },

        toggle: () => sdk.togglePlay(),
        seek: ms => sdk.seek(Math.round(ms))
    };
}
