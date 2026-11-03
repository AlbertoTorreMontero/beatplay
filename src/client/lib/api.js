// Llamadas al servidor. Ningún juego habla con el servicio de música directamente.

// Si el servidor pierde la sesión (se reinició o caducó), la app vuelve a la pantalla de login.
export const SESSION_EXPIRED = "beatplay:session-expired";

export async function api(path, { method = "GET", body } = {}) {
    let response;

    try {
        response = await fetch(path, {
            method,
            headers: body ? { "Content-Type": "application/json" } : undefined,
            body: body ? JSON.stringify(body) : undefined
        });
    } catch {
        throw new Error("Sin conexión con el servidor. Revisa tu red.");
    }

    if (response.status === 401) window.dispatchEvent(new Event(SESSION_EXPIRED));

    if (response.status === 204) return null;

    const data = await response.json().catch(() => null);

    if (!response.ok) {
        const error = new Error(data?.error || "El servidor no ha respondido bien.");
        error.status = response.status;
        error.retryAfter = data?.retryAfter || null;
        throw error;
    }

    return data;
}

export const getMe = () => api("/api/me");

let playlistsPromise = null;

// Las playlists se piden una vez por visita: el menú y Music Roulette comparten el resultado.
export function getPlaylists({ refresh = false } = {}) {
    if (refresh || !playlistsPromise) {
        playlistsPromise = api(refresh ? "/api/playlists?refresh=1" : "/api/playlists");
        playlistsPromise.catch(() => { playlistsPromise = null; });
    }
    return playlistsPromise;
}

const tracksUrl = (id, query = "") => `/api/playlists/${encodeURIComponent(id)}/tracks${query}`;

export const tracks = {
    sample: id => api(tracksUrl(id)),
    all: id => api(tracksUrl(id, "?all=1")),
    dated: id => api(tracksUrl(id, "?dated=1")),
    hipsterOfficial: () => api("/api/hipster/tracks")
};

export async function logout() {
    await fetch("/auth/logout", { method: "POST" }).catch(() => {});
    location.href = "/";
}
