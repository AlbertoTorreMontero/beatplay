/* =========================================================
   BEATPLAY — REPRODUCTOR (Web Playback SDK)
   Requiere Spotify Premium. Los juegos se suscriben al
   estado del reproductor con onPlayerState().
========================================================= */

let player = null;
let deviceId = null;
let playerReady = null;

const stateListeners = new Set();

// Devuelve una función para darse de baja.
function onPlayerState(listener) {

    stateListeners.add(listener);

    return () => stateListeners.delete(listener);
}


// El SDK avisa cuando termina de cargar (o ya lo hizo antes de llegar aquí).
const sdkLoaded = new Promise(resolve => {

    if (window.Spotify?.Player) {
        resolve();
        return;
    }

    window.onSpotifyWebPlaybackSDKReady = resolve;
});


// =====================================================
// INICIALIZAR
// =====================================================

function initSpotify() {

    if (!playerReady) {

        playerReady = createPlayer();

        // Si falla, se podrá reintentar más tarde.
        playerReady.catch(() => { playerReady = null; });
    }

    return playerReady;
}


async function createPlayer() {

    await getSpotifyToken();
    await sdkLoaded;

    if (typeof window.Spotify?.Player !== "function") {
        throw new Error("Spotify Web Playback SDK no está disponible.");
    }

    player = new window.Spotify.Player({
        name: "BeatPlay",
        volume: 0.5,

        // El SDK pide el token cuando lo necesita: una sesión larga no se queda sin autorización.
        getOAuthToken: callback => {
            getSpotifyToken({ force: true })
                .then(callback)
                .catch(error => console.error("Spotify token:", error));
        }
    });

    const deviceReady = new Promise((resolve, reject) => {

        const timeout = setTimeout(
            () => reject(new Error("El reproductor de Spotify tardó demasiado.")),
            15000
        );

        // Sin Premium el SDK no llega a dar "ready": mejor avisar que esperar al timeout.
        player.addListener("account_error", () => {
            clearTimeout(timeout);
            reject(new Error("El reproductor necesita Spotify Premium."));
        });

        player.addListener("ready", async ({ device_id }) => {

            deviceId = device_id;

            try {
                await playbackRequest("/api/transfer", { deviceId });
            } catch (error) {
                console.error("Transferencia:", error.message);
            }

            clearTimeout(timeout);
            resolve();
        });
    });

    player.addListener("not_ready", ({ device_id }) => {
        if (deviceId === device_id) deviceId = null;
    });

    player.addListener("player_state_changed", state => {
        if (state) stateListeners.forEach(listener => listener(state));
    });

    player.addListener("initialization_error", ({ message }) => console.error("Spotify initialization:", message));
    player.addListener("authentication_error", ({ message }) => console.error("Spotify authentication:", message));
    player.addListener("playback_error", ({ message }) => console.error("Spotify playback:", message));

    if (!(await player.connect())) {
        throw new Error("No se pudo conectar con Spotify.");
    }

    await deviceReady;

    return { ready: true, label: "REPRODUCTOR LISTO" };
}


// =====================================================
// LLAMADAS AL SERVIDOR
// =====================================================

async function playbackRequest(url, body) {

    const response = await apiFetch(url, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body || {})
    });

    if (response.ok) return;

    let message = "Error de reproducción.";

    try {
        message = (await response.json()).error || message;
    } catch {
        /* respuesta sin cuerpo */
    }

    throw new Error(message);
}


// =====================================================
// REPRODUCCIÓN
// =====================================================

async function playSpotifyTrack(trackUri, positionMs = 0) {

    if (!trackUri) {
        throw new Error("Falta la URI de la canción.");
    }

    await initSpotify();

    if (!deviceId) {
        throw new Error("El reproductor de Spotify no está listo.");
    }

    await playbackRequest("/api/play", { deviceId, trackUri, positionMs });
}


async function pauseSpotify() {

    if (!deviceId) return;

    try {
        await playbackRequest("/api/pause");
    } catch (error) {
        console.warn("Pausa:", error.message);
    }
}


async function spotifyTogglePlay() {
    await initSpotify();
    return player.togglePlay();
}


async function spotifySeek(positionMs) {
    await initSpotify();
    return player.seek(Math.round(positionMs));
}
