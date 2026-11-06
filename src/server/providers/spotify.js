// Adaptador de Spotify. Todo lo específico de su API vive aquí.
const crypto = require("crypto");
const { HttpError, shuffle } = require("../utils");

const ACCOUNTS = "https://accounts.spotify.com";
const API = "https://api.spotify.com/v1";

const SCOPES = [
    "user-read-private",
    "user-read-email",
    "user-read-playback-state",
    "user-modify-playback-state",
    "streaming",
    "playlist-read-private",
    "playlist-read-collaborative"
].join(" ");

const pageSize = 50;

const ITEM_FIELDS = "total,items(item(id,uri,name,type,is_local,preview_url,duration_ms,external_ids(isrc),artists(name),album(name,release_date,images)))";

const redirectUri = process.env.SPOTIFY_REDIRECT_URI;

if (!redirectUri) throw new Error("Falta SPOTIFY_REDIRECT_URI en el .env.");

// App de Spotify de BeatPlay (opcional). En Development Mode solo admite 5 cuentas autorizadas.
const sharedApp = process.env.SPOTIFY_CLIENT_ID && process.env.SPOTIFY_CLIENT_SECRET
    ? { clientId: process.env.SPOTIFY_CLIENT_ID, clientSecret: process.env.SPOTIFY_CLIENT_SECRET }
    : null;

const CLIENT_ID_FORMAT = /^[0-9a-f]{32}$/i;


// =====================================================
// AUTENTICACIÓN
// Dos formas de entrar:
//  - Con la app propia del usuario (su Client ID): PKCE, sin secreto. Cada usuario es
//    el único de su app, así que el límite de 5 cuentas no le afecta.
//  - Con la app compartida de BeatPlay (Client ID + secreto del .env), para las 5 cuentas autorizadas.
// =====================================================

const base64url = buffer => buffer.toString("base64url");

// Prepara un login. Lo que devuelve se guarda en una cookie hasta la vuelta de Spotify.
function startLogin({ clientId } = {}) {
    if (clientId) {
        if (!CLIENT_ID_FORMAT.test(clientId)) throw new HttpError("Ese Client ID no tiene el formato correcto (32 letras y números).", 400);
        return { clientId: clientId.toLowerCase(), codeVerifier: base64url(crypto.randomBytes(48)) };
    }

    if (!sharedApp) throw new HttpError("Necesitas tu propio Client ID de Spotify para entrar.", 400);
    return { clientId: sharedApp.clientId };
}

function authorizeUrl(state, login) {
    const params = new URLSearchParams({
        client_id: login.clientId,
        response_type: "code",
        redirect_uri: redirectUri,
        scope: SCOPES,
        state
    });

    if (login.codeVerifier) {
        params.set("code_challenge_method", "S256");
        params.set("code_challenge", base64url(crypto.createHash("sha256").update(login.codeVerifier).digest()));
    }

    return `${ACCOUNTS}/authorize?${params}`;
}

async function requestToken(clientId, body, previous = {}) {
    const shared = sharedApp?.clientId === clientId;
    const headers = { "Content-Type": "application/x-www-form-urlencoded" };

    // La app compartida se identifica con su secreto; la del usuario (PKCE), solo con su Client ID.
    if (shared) headers.Authorization = `Basic ${Buffer.from(`${clientId}:${sharedApp.clientSecret}`).toString("base64")}`;
    else body.client_id = clientId;

    const response = await fetch(`${ACCOUNTS}/api/token`, { method: "POST", headers, body: new URLSearchParams(body) });
    const data = await response.json().catch(() => ({}));

    if (!response.ok) {
        throw new HttpError(data.error_description || "No se pudo autenticar con Spotify.", 401);
    }

    return {
        clientId,
        ownApp: !shared, // el usuario entró con su propia app
        accessToken: data.access_token,
        // Spotify no siempre devuelve uno nuevo al renovar: se conserva el anterior.
        refreshToken: data.refresh_token || previous.refreshToken,
        expiresAt: Date.now() + (data.expires_in - 60) * 1000
    };
}

const exchangeCode = (code, login) => requestToken(login.clientId, {
    grant_type: "authorization_code",
    code,
    redirect_uri: redirectUri,
    ...(login.codeVerifier && { code_verifier: login.codeVerifier })
});

const refresh = tokens => requestToken(tokens.clientId, { grant_type: "refresh_token", refresh_token: tokens.refreshToken }, tokens);


// =====================================================
// API
// =====================================================

// Spotify castiga con esperas largas a quien insiste tras un 429: mientras dure, no se le vuelve a llamar.
const limitedUntil = new Map();

function rateLimited(seconds) {
    const minutes = Math.ceil(seconds / 60);
    const error = new HttpError(
        `Spotify ha limitado las peticiones de tu app. Espera ${seconds < 90 ? `${seconds} s` : `${minutes} min`} y vuelve a intentarlo.`,
        429
    );
    error.retryAfter = seconds;
    return error;
}

async function api(token, endpoint, options = {}) {
    const until = limitedUntil.get(token);
    if (until > Date.now()) throw rateLimited(Math.ceil((until - Date.now()) / 1000));

    const response = await fetch(`${API}${endpoint}`, {
        ...options,
        headers: { Authorization: `Bearer ${token}`, ...options.headers }
    });

    if (response.status === 429) {
        const seconds = Number(response.headers.get("retry-after")) || 30;
        if (limitedUntil.size > 1000) limitedUntil.clear();
        limitedUntil.set(token, Date.now() + seconds * 1000);
        throw rateLimited(seconds);
    }

    const text = await response.text();
    let data = null;

    try {
        data = text ? JSON.parse(text) : null;
    } catch {
        data = { error: { message: text } };
    }

    if (response.status === 401) {
        throw new HttpError("Tu sesión de Spotify ha caducado.", 401);
    }

    if (response.status === 403) {
        const notAllowed = /not registered|not approved/i.test(text);
        throw new HttpError(
            notAllowed
                ? "Tu cuenta no está autorizada en esa app de Spotify. Entra con tu propio Client ID."
                : "Spotify ha denegado la petición. Solo se pueden leer playlists tuyas o colaborativas.",
            403
        );
    }

    if (!response.ok) {
        throw new HttpError(data?.error?.message || "Error en la API de Spotify.", response.status);
    }

    return data;
}

function toTrack(item) {
    const images = item.album?.images || [];
    const year = parseInt(item.album?.release_date, 10);

    return {
        id: item.id,
        ref: item.uri,
        name: item.name,
        artist: (item.artists || []).map(artist => artist.name).join(", "),
        album: item.album?.name || "",
        year: year > 0 ? year : null,
        cover: images[0]?.url || null,
        thumb: images[1]?.url || images[0]?.url || null, // 300 px: para cuadrículas (Bingo)
        preview: item.preview_url || null,
        duration: item.duration_ms || null,
        isrc: item.external_ids?.isrc || null // código universal de la grabación: sirve para buscar su tempo
    };
}

const isPlayable = item => item?.type === "track" && item.id && item.uri && !item.is_local;

async function getProfile(token) {
    const me = await api(token, "/me");
    return { id: me.id, name: me.display_name || me.id, email: me.email || null };
}

async function listPlaylists(token) {
    const playlists = [];
    let url = "/me/playlists?limit=50";

    while (url) {
        const data = await api(token, url);

        for (const playlist of data.items || []) {
            if (!playlist) continue;
            playlists.push({
                id: playlist.id,
                name: playlist.name,
                owner: playlist.owner?.display_name || "",
                image: playlist.images?.[0]?.url || null,
                tracks: playlist.items?.total ?? playlist.tracks?.total ?? 0
            });
        }

        url = data.next ? data.next.replace(API, "") : null;
    }

    return playlists;
}

async function getTrackPage(token, playlistId, offset) {
    const query = `limit=${pageSize}&offset=${offset}&fields=${encodeURIComponent(ITEM_FIELDS)}`;
    const data = await api(token, `/playlists/${encodeURIComponent(playlistId)}/items?${query}`);

    // Spotify oculta el contenido de las playlists ajenas a las apps nuevas.
    if (data?.total == null) {
        throw new HttpError("Spotify solo deja leer playlists tuyas o colaborativas. Guarda una copia en tu cuenta y vuelve a probar.", 403);
    }

    return {
        total: data.total,
        tracks: (data.items || []).map(entry => entry.item ?? entry.track).filter(isPlayable).map(toTrack)
    };
}


// =====================================================
// PLAYLISTS PÚBLICAS SIN INICIAR SESIÓN (invitados)
// Se leen de la página pública de reproductor incrustado de Spotify, sin API.
// No es oficial: si Spotify cambia esa página, esto deja de funcionar.
// =====================================================

const publicSpotify = require("spotify-url-info")(fetch);

const PUBLIC_COVER_CONCURRENCY = 5;
const PUBLIC_TTL = 30 * 60 * 1000;
const publicCache = new Map(); // enlace → { expires, promise }
const coverCache = new Map();  // canción → portada (no cambia)

// La misma playlist pegada dos veces (o por dos invitados) no se vuelve a leer.
function readPublicPlaylistCached(url, options) {
    const key = String(url).split("?")[0];
    const hit = publicCache.get(key);
    if (hit && hit.expires > Date.now()) return hit.promise;
    if (publicCache.size > 500) publicCache.clear();

    const promise = readPublicPlaylist(url, options);
    publicCache.set(key, { promise, expires: Date.now() + PUBLIC_TTL });
    promise.catch(() => publicCache.delete(key));
    return promise;
}

async function coverOf(id) {
    if (coverCache.has(id)) return coverCache.get(id);
    const preview = await publicSpotify.getPreview(`https://open.spotify.com/track/${id}`).catch(() => null);
    if (coverCache.size > 20000) coverCache.clear();
    if (preview?.image) coverCache.set(id, preview.image);
    return preview?.image || null;
}

async function readPublicPlaylist(url, { limit = 20 } = {}) {
    if (!/^https:\/\/open\.spotify\.com\/(intl-[a-z-]+\/)?playlist\/[A-Za-z0-9]+/.test(String(url))) {
        throw new HttpError("Pega el enlace de una playlist de Spotify (open.spotify.com/playlist/…).", 400);
    }

    let details;
    try {
        details = await publicSpotify.getDetails(url);
    } catch {
        throw new HttpError("No se pudo leer esa playlist. Comprueba que es pública.", 404);
    }

    // La página de la playlist no trae portada por canción: se pide la de cada una de las elegidas.
    const picked = shuffle([...details.tracks.filter(track => track.uri?.startsWith("spotify:track:"))]).slice(0, limit);
    const tracks = [];

    for (let i = 0; i < picked.length; i += PUBLIC_COVER_CONCURRENCY) {
        const batch = await Promise.all(picked.slice(i, i + PUBLIC_COVER_CONCURRENCY).map(async track => {
            const id = track.uri.split(":")[2];
            return { id, name: track.name, artist: track.artist || "", cover: await coverOf(id) };
        }));
        tracks.push(...batch.filter(track => track.cover));
    }

    return { name: details.preview?.title || "Playlist", tracks };
}

// =====================================================
// REPRODUCCIÓN (Web Playback SDK en el navegador)
// =====================================================

const json = body => ({
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body)
});

// Una sola llamada para toda la cola: después, el reproductor del navegador pasa de canción sin la API.
const MAX_QUEUE = 100;

const playback = {
    play: (token, { deviceId, refs, index = 0, positionMs = 0 }) => {
        const uris = (Array.isArray(refs) ? refs : []).filter(ref => typeof ref === "string" && ref.startsWith("spotify:track:")).slice(0, MAX_QUEUE);
        if (!uris.length) throw new HttpError("No hay canciones que reproducir.", 400);

        return api(token, `/me/player/play?device_id=${encodeURIComponent(deviceId)}`, json({
            uris,
            offset: { position: Math.min(Math.max(0, index | 0), uris.length - 1) },
            position_ms: positionMs
        }));
    },

    // Activa el navegador como dispositivo de Spotify (al conectar): la primera canción arranca antes.
    transfer: (token, { deviceId }) => api(token, "/me/player", json({ device_ids: [deviceId], play: false }))

};

module.exports = {
    id: "spotify",
    name: "Spotify",
    redirectUri,
    pageSize,
    coverHosts: ["scdn.co", "spotifycdn.com"],
    playback: "spotify-sdk",
    // Para la guía de configuración: cada usuario crea su app con esta Redirect URI.
    setup: { kind: "own-client-id", sharedApp: Boolean(sharedApp), dashboardUrl: "https://developer.spotify.com/dashboard/create" },
    startLogin,
    authorizeUrl,
    exchangeCode,
    refresh,
    getProfile,
    listPlaylists,
    getTrackPage,
    readPublicPlaylist: readPublicPlaylistCached,
    controls: playback
};
