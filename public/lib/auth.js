/* =========================================================
   BEATPLAY — SESIÓN DE SPOTIFY
   El servidor guarda la sesión; aquí solo se pide el token
   (con caché) y se detecta cuándo ha caducado.
========================================================= */

let cachedToken = null;
let cachedExpiry = 0;


function clearCachedToken() {
    cachedToken = null;
    cachedExpiry = 0;
}


// Si el servidor perdió la sesión (p. ej. se reinició), hay que volver a entrar.
function sessionExpired() {

    clearCachedToken();

    toast("Tu sesión de Spotify ha caducado. Inicia sesión de nuevo.");
    showScreen("loginScreen");
}


// fetch para las rutas protegidas del servidor.
async function apiFetch(url, options) {

    const response = await fetch(url, options);

    if (response.status === 401) sessionExpired();

    return response;
}


async function getSpotifyToken({ force = false } = {}) {

    if (!force && cachedToken && Date.now() < cachedExpiry) {
        return cachedToken;
    }

    const response = await fetch("/auth/token");

    if (response.status === 401) {
        clearCachedToken();
        throw new Error("No estás autenticado en Spotify.");
    }

    if (!response.ok) {
        throw new Error("No se pudo comprobar la sesión de Spotify.");
    }

    const data = await response.json();

    if (!data.access_token) {
        throw new Error("Spotify no devolvió un Access Token.");
    }

    cachedToken = data.access_token;

    // Un minuto de margen antes de que caduque.
    cachedExpiry = Date.now() + Math.max(0, (data.expires_in || 3600) - 60) * 1000;

    return cachedToken;
}


async function checkSpotifyLogin() {

    try {
        await getSpotifyToken();
        return true;
    } catch {
        return false;
    }
}


async function logoutSpotify() {

    await fetch("/auth/logout", { method: "POST" });

    clearCachedToken();

    window.location.href = "/";
}
