// Controlador de la app: sesión, menú y ciclo de vida de los juegos.
import { $, $$, toast, showScreen } from "../lib/ui.js";
import { getMe, logout, SESSION_EXPIRED } from "../lib/api.js";
import { setupPlayer, player } from "../lib/player/index.js";
import { playlistPicker } from "../lib/playlists.js";
import { initLogin } from "./login.js";

import snake from "../games/snake/snake.js";
import bingo from "../games/bingo/bingo.js";
import hipster from "../games/hipster/hipster.js";
import roulette from "../games/roulette/roulette.js";
import intro from "../games/intro/intro.js";
import buzzer from "../games/buzzer/buzzer.js";

const GAMES = { snake, intro, hipster, bingo, buzzer, roulette };

const state = {
    game: "snake",
    playlist: null,
    hipsterSource: "user",
    busy: false,
    loggedIn: false,
    guest: false, // invitado sin cuenta: solo Music Roulette
    active: null, // juego montado ahora mismo
    invite: null  // código de sala de un enlace de invitación
};

const templates = new Map();


// =====================================================
// MENÚ
// =====================================================

// ¿Hace falta playlist para empezar con la configuración actual?
const needsPlaylist = () => GAMES[state.game].needsPlaylist && !(state.game === "hipster" && state.hipsterSource === "official");

function renderMenu() {
    const game = GAMES[state.game];
    const playlistVisible = needsPlaylist();

    for (const card of $$(".game-card")) {
        card.setAttribute("aria-checked", String(card.dataset.game === state.game));
    }

    $("#hipsterSource").classList.toggle("hidden", state.game !== "hipster");
    for (const button of $$("#hipsterSource button")) {
        button.setAttribute("aria-pressed", String(button.dataset.source === state.hipsterSource));
    }

    $("#playlistList").classList.toggle("hidden", !playlistVisible);
    $("#setupNote").classList.toggle("hidden", playlistVisible);
    $("#setupNote").textContent = game.note?.(state) || "";
    $("#setupTitle").textContent = playlistVisible ? "Elige una playlist" : game.setupTitle?.(state) || "Todo listo";

    $("#selectionText").textContent = playlistVisible
        ? (state.playlist ? `${state.playlist.name} · ${state.playlist.tracks} canciones` : "Elige una playlist")
        : game.setupTitle?.(state) || "";

    const start = $("#startButton");
    start.textContent = state.busy ? "Cargando…" : game.cta;
    start.disabled = state.busy || (playlistVisible && !state.playlist);
    start.setAttribute("aria-busy", String(state.busy));
}

function initMenu() {
    for (const card of $$(".game-card")) {
        card.addEventListener("click", () => {
            if (state.busy) return;
            state.game = card.dataset.game;
            renderMenu();
        });
    }

    for (const button of $$("#hipsterSource button")) {
        button.addEventListener("click", () => {
            state.hipsterSource = button.dataset.source;
            renderMenu();
        });
    }

    playlistPicker($("#playlistList"), {
        onSelect: playlist => {
            state.playlist = playlist;
            renderMenu();
        }
    });

    $("#startButton").addEventListener("click", () => startGame());
    $("#logoutButton").addEventListener("click", logout);

    renderMenu();
}


// =====================================================
// JUEGOS
// =====================================================

async function template(url) {
    if (!templates.has(url)) {
        const response = await fetch(url);
        if (!response.ok) throw new Error("No se pudo cargar el juego.");
        templates.set(url, await response.text());
    }
    return templates.get(url);
}

async function startGame(options = {}) {
    if (state.busy) return;

    const game = GAMES[state.game];
    const screen = $("#gameScreen");

    state.busy = true;
    renderMenu();

    try {
        const root = document.createElement("div");
        root.innerHTML = await template(game.template);
        screen.replaceChildren(root);

        state.active = game;
        await game.mount(root, {
            playlist: needsPlaylist() ? state.playlist : null,
            source: state.hipsterSource,
            ...options
        });

        showScreen("gameScreen");
    } catch (error) {
        console.error(`[${state.game}]`, error);
        stopGame();
        toast(error.message || "No se pudo iniciar el juego.", { error: true });
    } finally {
        state.busy = false;
        renderMenu();
    }
}

function stopGame() {
    state.active?.unmount();
    state.active = null;
    player.pause();
    $("#gameScreen").replaceChildren();
}

// Cualquier botón con data-exit dentro de un juego vuelve al menú.
$("#gameScreen").addEventListener("click", event => {
    if (!event.target.closest("[data-exit]")) return;
    stopGame();

    if (state.guest) {
        state.guest = false;
        showScreen("loginScreen");
        return;
    }

    showScreen("menuScreen");
    $(`.game-card[data-game="${state.game}"]`)?.focus();
});


// =====================================================
// INVITACIONES: /app#sala=ABC12 lleva directo a la sala.
// El código se guarda porque el login recarga la página.
// =====================================================

function storeInvite() {
    const code = location.hash.match(/^#sala=([A-Za-z0-9]{5})$/)?.[1];
    if (!code) return;

    state.invite = code.toUpperCase();
    try {
        sessionStorage.setItem("beatplayInvite", state.invite);
    } catch { /* sin almacenamiento: vale con el estado en memoria */ }

    history.replaceState(null, "", location.pathname);
}

function peekInvite() {
    try {
        return sessionStorage.getItem("beatplayInvite") || state.invite;
    } catch {
        return state.invite;
    }
}

function takeInvite() {
    let code = state.invite;
    try {
        code = sessionStorage.getItem("beatplayInvite") || code;
        sessionStorage.removeItem("beatplayInvite");
    } catch { /* idem */ }
    state.invite = null;
    return code;
}

// Las salas son de Music Roulette o de Pulsador: se pregunta al servidor de cuál es.
async function gameOfRoom(code) {
    const response = await fetch(`/api/public/room/${encodeURIComponent(code)}`).catch(() => null);
    const data = await response?.json().catch(() => null);
    if (!response?.ok) throw new Error(data?.error || "No se encontró esa sala.");
    return data.game;
}

async function openInvite() {
    const code = takeInvite();
    if (!code) return;

    try {
        const game = await gameOfRoom(code);
        if (state.active) stopGame();
        state.game = game;
        renderMenu();
        await startGame({ code });
    } catch (error) {
        toast(error.message, { error: true });
    }
}

window.addEventListener("hashchange", () => {
    storeInvite();
    if (state.loggedIn) openInvite();
    else if (!$("#loginScreen").classList.contains("hidden")) startGuest(takeInvite());
});

// Invitado sin cuenta: entra a la sala del código (Music Roulette o Pulsador).
async function startGuest(code) {
    code = String(code || "").trim().toUpperCase();
    if (!code) return;

    try {
        const game = await gameOfRoom(code);
        if (state.active) stopGame();
        state.guest = true;
        state.game = game;
        await startGame({ guest: true, code });
        if (!state.active) state.guest = false; // no se pudo abrir: sigue en el login
    } catch (error) {
        toast(error.message, { error: true });
    }
}


// =====================================================
// SESIÓN Y ARRANQUE
// =====================================================

function setPlayerStatus(text, ok) {
    const status = $("#playerStatus");
    status.textContent = text;
    status.dataset.state = ok ? "ok" : "off";
}

function showProviderName(name) {
    for (const node of $$("[data-provider-name]")) node.textContent = name;
}

window.addEventListener(SESSION_EXPIRED, () => {
    if (state.loggedIn && !state.guest && $("#loginScreen").classList.contains("hidden")) {
        stopGame();
        showScreen("loginScreen");
        toast("Tu sesión ha caducado. Vuelve a entrar.");
    }
});

async function boot() {
    storeInvite();

    const config = await fetch("/auth/config").then(response => response.json()).catch(() => ({ name: "Spotify", redirectUri: "" }));
    showProviderName(config.name);

    let me;
    try {
        me = await getMe();
    } catch {
        initLogin({ config, invite: peekInvite(), onGuest: code => startGuest(code || takeInvite()) });
        showScreen("loginScreen");
        return;
    }

    state.loggedIn = true;
    $("#userName").textContent = me.name;
    initMenu();
    showScreen("menuScreen");

    setupPlayer(me.provider.playback)
        .then(mode => {
            if (mode === "spotify-connect") {
                setPlayerStatus("Suena en tu app de Spotify", true);
                $("#playerStatus").title = "La música sonará en la app de Spotify de este dispositivo. Ábrela antes de jugar.";
                // En el móvil se avisa una vez: sin la app de Spotify abierta no sonará nada.
                try {
                    if (!sessionStorage.getItem("beatplayConnectHint")) {
                        sessionStorage.setItem("beatplayConnectHint", "1");
                        toast("En el móvil la música suena en la app de Spotify: ábrela un momento antes de jugar.");
                    }
                } catch { /* sin almacenamiento: no pasa nada */ }
            } else {
                setPlayerStatus("Reproductor listo", true);
            }
        })
        .catch(error => {
            console.error("Reproductor:", error);
            setPlayerStatus("Sin reproductor", false);
            $("#playerStatus").title = error.message;
            toast(error.message, { error: true });
        });

    await openInvite();
}

// Se arranca con la página ya cargada (estilos incluidos): evita medir el diseño antes de tiempo.
if (document.readyState === "complete") boot();
else window.addEventListener("load", boot, { once: true });
