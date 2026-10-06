/* =========================================================
   BEATPLAY — CONTROLADOR DE LA APP
   Menú, selección de juego y arranque de partidas.
========================================================= */

const $ = id => document.getElementById(id);

const state = {
    game: "snake",
    busy: false,
    invite: null // código de sala de un enlace de invitación
};

const htmlCache = new Map();


// =====================================================
// UTILIDADES DE INTERFAZ
// =====================================================

function showScreen(id) {

    document
        .querySelectorAll(".screen")
        .forEach(screen => screen.classList.toggle("hidden", screen.id !== id));

    window.scrollTo({ top: 0 });

    // Sin mover el foco, teclado y lectores de pantalla se quedan en un botón que ya no se ve.
    const screen = $(id);

    screen.tabIndex = -1;
    screen.focus({ preventScroll: true });
}


function toast(message) {

    let element = document.querySelector(".toast");

    if (!element) {
        element = document.createElement("div");
        element.className = "toast";
        element.setAttribute("role", "status");
        document.body.appendChild(element);
    }

    element.textContent = message;
    element.classList.add("show");

    clearTimeout(toast.timer);
    toast.timer = setTimeout(() => element.classList.remove("show"), 4500);
}


function setStatus(text, online = false) {

    const status = $("appStatus");

    status.textContent = text;
    status.classList.toggle("online", online);
}


async function loadGameHTML(url, containerId) {

    if (!htmlCache.has(url)) {

        const response = await fetch(url);

        if (!response.ok) {
            throw new Error(`No se pudo cargar ${url}.`);
        }

        htmlCache.set(url, await response.text());
    }

    $(containerId).innerHTML = htmlCache.get(url);
}


async function fetchTracks(loadTracks, playlistId, minimum, label) {

    const tracks = await loadTracks(playlistId);

    if (tracks.length < minimum) {
        throw new Error(
            `${label} necesita al menos ${minimum} canciones reproducibles. ` +
            `Esta playlist tiene ${tracks.length}.`
        );
    }

    return tracks;
}


// =====================================================
// JUEGOS DISPONIBLES
// =====================================================

const GAMES = {

    snake: {
        label: "EMPEZAR SNAKE",
        loading: "CARGANDO SNAKE…",
        screen: "gameScreen",
        container: "snakeContainer",
        html: "/games/snake/snake.html",
        needsPlaylist: true,
        prepare: playlist => fetchTracks(getPlaylistTracks, playlist.id, 1, "Snake"),
        run: (playlist, tracks) => startSnake(tracks, playlist.name)
    },

    // El bingo necesita la playlist entera: con una muestra todos los cartones saldrían casi iguales.
    bingo: {
        label: "CREAR BINGO",
        loading: "CARGANDO BINGO…",
        screen: "bingoScreen",
        container: "bingoContainer",
        html: "/games/bingo/bingo.html",
        needsPlaylist: true,
        prepare: playlist => fetchTracks(getPlaylistCatalog, playlist.id, 15, "El bingo"),
        run: (playlist, tracks) => startBingo(tracks, playlist.name)
    },

    "hipster-user": {
        label: "EMPEZAR HIPSTER",
        loading: "CARGANDO HIPSTER…",
        screen: "hipsterScreen",
        container: "hipsterContainer",
        html: "/games/hipster/hipster.html",
        needsPlaylist: true,
        run: playlist => startHipster({ mode: "user", playlist })
    },

    "hipster-global": {
        label: "EMPEZAR HIPSTER GLOBAL",
        loading: "CARGANDO HIPSTER GLOBAL…",
        screen: "hipsterScreen",
        container: "hipsterContainer",
        html: "/games/hipster/hipster.html",
        needsPlaylist: false,
        run: () => startHipster({ mode: "global", playlist: null })
    },

    // Multijugador: cada jugador elige su playlist dentro de la sala.
    roulette: {
        label: "ENTRAR EN MUSIC ROULETTE",
        loading: "CONECTANDO…",
        screen: "rouletteScreen",
        container: "rouletteContainer",
        html: "/games/roulette/roulette.html",
        needsPlaylist: false,
        selectedText: "Sala privada con tus amigos",
        run: () => startRoulette({ code: state.invite || "" })
    }
};

// Cada juego que tiene algo que parar al salir.
const STOP_GAME = {
    snake: stopSnake,
    hipster: stopHipster,
    roulette: stopRoulette
};


// =====================================================
// BOTÓN PRINCIPAL
// =====================================================

function updateStartButton() {

    const button = $("startButton");
    const game = GAMES[state.game];
    const playlist = getSelectedPlaylist();

    $("playlistSection").classList.toggle("hidden", !game.needsPlaylist);
    $("startLabel").textContent = state.busy ? game.loading : game.label;

    button.disabled = state.busy || (game.needsPlaylist && !playlist);
    button.setAttribute("aria-busy", String(state.busy));

    if (!game.needsPlaylist) {
        $("selectedText").textContent = game.selectedText || "Playlist oficial de Hipster";
    } else if (playlist) {
        $("selectedText").textContent = `${playlist.name} — ${playlist.tracks} canciones`;
    } else {
        $("selectedText").textContent = "Elige una playlist";
    }
}


// =====================================================
// SELECTOR DE JUEGO
// =====================================================

function selectGame(name) {

    state.game = name;

    document.querySelectorAll(".game-card[data-game]").forEach(card => {
        const selected = card.dataset.game === name;
        card.classList.toggle("selected", selected);
        card.setAttribute("aria-pressed", String(selected));
    });

    updateStartButton();
}


function initGameSelector() {

    document.querySelectorAll(".game-card[data-game]").forEach(card => {
        card.addEventListener("click", () => {
            if (!state.busy) selectGame(card.dataset.game);
        });
    });

    selectGame(state.game);
}


// =====================================================
// INVITACIONES
// /app#sala=ABC12 lleva a la sala. El código se guarda
// porque el login con Spotify recarga la página.
// =====================================================

function storeInvite() {

    const code = location.hash.match(/^#sala=([A-Za-z0-9]{5})$/)?.[1];

    if (!code) return;

    try {
        sessionStorage.setItem("beatplayInvite", code.toUpperCase());
    } catch {
        state.invite = code.toUpperCase();
    }

    history.replaceState(null, "", location.pathname);
}


// Quien llega por un enlace de invitación entra directo a la sala.
async function openInvite() {

    state.invite = takeInvite();

    if (!state.invite) return;

    selectGame("roulette");
    await startGame();

    state.invite = null;
}


function takeInvite() {

    try {
        const code = sessionStorage.getItem("beatplayInvite");
        sessionStorage.removeItem("beatplayInvite");
        return code || state.invite;
    } catch {
        return state.invite;
    }
}


// =====================================================
// ARRANQUE DE PARTIDA
// =====================================================

async function startGame() {

    if (state.busy) return;

    const game = GAMES[state.game];
    const playlist = getSelectedPlaylist();

    if (game.needsPlaylist && !playlist) {
        toast("Elige una playlist antes de empezar.");
        return;
    }

    state.busy = true;
    updateStartButton();

    try {
        const data = game.prepare ? await game.prepare(playlist) : null;

        await loadGameHTML(game.html, game.container);

        showScreen(game.screen);

        await game.run(playlist, data);

    } catch (error) {
        console.error(`[${state.game}]`, error);
        toast(error.message || "No se pudo iniciar el juego.");
        showScreen("menuScreen");

    } finally {
        state.busy = false;
        updateStartButton();
    }
}


// =====================================================
// SALIR DE UN JUEGO
// =====================================================

document.addEventListener("click", async event => {

    const button = event.target.closest("[data-exit]");

    if (!button) return;

    STOP_GAME[button.dataset.exit]?.();

    await pauseSpotify();

    showScreen("menuScreen");
    updateStartButton();
});


// =====================================================
// SESIÓN
// =====================================================

async function enterBeatplay() {

    storeInvite();
    initGameSelector();
    updateStartButton();

    if (!(await checkSpotifyLogin())) {
        showScreen("loginScreen");
        return;
    }

    showScreen("menuScreen");

    try {
        await loadPlaylists();
    } catch (error) {
        console.error("Playlists:", error);
        toast(error.message || "No se pudieron cargar tus playlists.");
        setStatus("SPOTIFY RECHAZÓ LA PETICIÓN");
    }

    updateStartButton();

    initSpotify()
        .then(info => setStatus(info.label, info.ready))
        .catch(error => {
            console.error("Spotify:", error);
            setStatus("REPRODUCTOR NO DISPONIBLE");
            toast(error.message);
        });

    await openInvite();
}

$("startButton").addEventListener("click", startGame);

// Pegar el enlace en una pestaña que ya tiene BeatPlay abierto solo cambia el #: no recarga la página.
window.addEventListener("hashchange", () => {

    storeInvite();

    if (!$("menuScreen").classList.contains("hidden")) openInvite();
});

enterBeatplay();
