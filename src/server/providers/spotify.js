// Adaptador de Spotify. Todo lo específico de su API vive aquí.
const { HttpError } = require("../utils");

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

const ITEM_FIELDS = "items(item(id,uri,name,type,is_local,preview_url,artists(name),album(name,release_date,images)))";

const clientId = process.env.SPOTIFY_CLIENT_ID;
const clientSecret = process.env.SPOTIFY_CLIENT_SECRET;
const redirectUri = process.env.SPOTIFY_REDIRECT_URI;

if (!clientId || !clientSecret || !redirectUri) {
    throw new Error("Faltan SPOTIFY_CLIENT_ID, SPOTIFY_CLIENT_SECRET o SPOTIFY_REDIRECT_URI en el .env.");
}


// =====================================================
// AUTENTICACIÓN
// =====================================================

function authorizeUrl(state) {
    const params = new URLSearchParams({
        client_id: clientId,
        response_type: "code",
        redirect_uri: redirectUri,
        scope: SCOPES,
        state
    });
    return `${ACCOUNTS}/authorize?${params}`;
}

async function requestToken(body, previous = {}) {
    const response = await fetch(`${ACCOUNTS}/api/token`, {
        method: "POST",
        headers: {
            "Content-Type": "application/x-www-form-urlencoded",
            Authorization: `Basic ${Buffer.from(`${clientId}:${clientSecret}`).toString("base64")}`
        },
        body: new URLSearchParams(body)
    });

    const data = await response.json().catch(() => ({}));

    if (!response.ok) {
        throw new HttpError(data.error_description || "No se pudo autenticar con Spotify.", 401);
    }

    return {
        accessToken: data.access_token,
        // Spotify no siempre devuelve uno nuevo al renovar: se conserva el anterior.
        refreshToken: data.refresh_token || previous.refreshToken,
        expiresAt: Date.now() + (data.expires_in - 60) * 1000
    };
}

const exchangeCode = code => requestToken({ grant_type: "authorization_code", code, redirect_uri: redirectUri });

const refresh = tokens => requestToken({ grant_type: "refresh_token", refresh_token: tokens.refreshToken }, tokens);


// =====================================================
// API
// =====================================================

async function api(token, endpoint, options = {}) {
    const response = await fetch(`${API}${endpoint}`, {
        ...options,
        headers: { Authorization: `Bearer ${token}`, ...options.headers }
    });

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
        throw new HttpError(
            "Spotify ha denegado la petición. En Development Mode solo funcionan las cuentas " +
            "añadidas en el Dashboard y las playlists tuyas o colaborativas.",
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
        preview: item.preview_url || null
    };
}

const isPlayable = item => item?.type === "track" && item.id && item.uri && !item.is_local;

async function getProfile(token) {
    const me = await api(token, "/me");
    return { id: me.id, name: me.display_name || me.id };
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

async function getPlaylistInfo(token, playlistId) {
    const fields = encodeURIComponent("name,items(total),tracks(total)");
    const data = await api(token, `/playlists/${encodeURIComponent(playlistId)}?fields=${fields}`);
    const total = data?.items?.total ?? data?.tracks?.total;

    // Spotify oculta el contenido de las playlists ajenas a las apps nuevas.
    if (total == null) {
        throw new HttpError(
            "Spotify solo deja leer playlists tuyas o colaborativas. Guarda una copia en tu cuenta y vuelve a probar.",
            403
        );
    }

    return { name: data.name || "", total };
}

async function getTrackPage(token, playlistId, offset) {
    const query = `limit=${pageSize}&offset=${offset}&fields=${encodeURIComponent(ITEM_FIELDS)}`;
    const data = await api(token, `/playlists/${encodeURIComponent(playlistId)}/items?${query}`);

    return (data?.items || [])
        .map(entry => entry.item ?? entry.track)
        .filter(isPlayable)
        .map(toTrack);
}


// =====================================================
// REPRODUCCIÓN (Web Playback SDK en el navegador)
// =====================================================

const json = body => ({
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body)
});

const playback = {
    transfer: (token, { deviceId }) => api(token, "/me/player", json({ device_ids: [deviceId], play: false })),

    play: (token, { deviceId, ref, positionMs = 0 }) =>
        api(token, `/me/player/play?device_id=${encodeURIComponent(deviceId)}`, json({ uris: [ref], position_ms: positionMs })),

    pause: token => api(token, "/me/player/pause", { method: "PUT" })
};

module.exports = {
    id: "spotify",
    name: "Spotify",
    redirectUri,
    pageSize,
    coverHosts: ["i.scdn.co"],
    playback: "spotify-sdk",
    authorizeUrl,
    exchangeCode,
    refresh,
    getProfile,
    listPlaylists,
    getPlaylistInfo,
    getTrackPage,
    controls: playback
};
