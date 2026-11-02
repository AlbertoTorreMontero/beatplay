/*
 * MUSIC ROULETTE (cliente)
 * Cada jugador lee sus playlists con su propia sesión y solo manda a la sala
 * portada, título y artista. Aquí no suena audio a propósito: las condiciones de
 * Spotify no permiten sincronizar sus grabaciones con contenido visual.
 */
import { refs, h, toast, $$ } from "../../lib/ui.js";
import { getMe, tracks as loadTracks } from "../../lib/api.js";
import { playlistPicker } from "../../lib/playlists.js";

const RECONNECT_ATTEMPTS = 8;
const STORAGE_KEY = "rouletteRoom";

let ui = {};
let root = null;
const room = { socket: null, code: null, token: null, playerId: null, hostId: null, minTracks: 5, reconnecting: false };
let timer = null;


// =====================================================
// CICLO DE VIDA
// =====================================================

async function mount(container, { code = "" } = {}) {
    root = container;
    ui = refs(root);

    root.addEventListener("click", onClick);
    ui.joinForm.addEventListener("submit", event => {
        event.preventDefault();
        join();
    });
    ui.code.addEventListener("input", () => { ui.code.value = ui.code.value.toUpperCase(); });

    document.addEventListener("visibilitychange", checkConnection);
    window.addEventListener("online", checkConnection);

    ui.code.value = code;
    const named = getMe().then(me => { if (!ui.name.value) ui.name.value = me.name.slice(0, 20); }).catch(() => {});

    await connect();
    show("lobby");

    // Si la pestaña se recargó en mitad de una sala, se vuelve a ella.
    const saved = savedRoom();
    if (saved?.code && saved?.token) {
        Object.assign(room, saved);
        send("rejoin", saved);
    } else if (code) {
        // Quien llega con un enlace de invitación entra directo, con su nombre de la cuenta.
        await named;
        join();
    }
}

function unmount() {
    clearInterval(timer);
    document.removeEventListener("visibilitychange", checkConnection);
    window.removeEventListener("online", checkConnection);

    const socket = room.socket;
    room.socket = null; // así el cierre no intenta reconectar
    if (socket?.readyState === WebSocket.OPEN) {
        socket.send(JSON.stringify({ type: "leave_room" }));
        socket.close();
    }

    forgetRoom();
    root = null;
}

const show = view => $$("[data-view]", root).forEach(section => section.classList.toggle("hidden", section.dataset.view !== view));


// =====================================================
// SALA GUARDADA: un móvil puede descartar la pestaña en
// segundo plano; con código y token se vuelve al mismo sitio.
// =====================================================

function saveRoom() {
    try {
        sessionStorage.setItem(STORAGE_KEY, JSON.stringify({ code: room.code, token: room.token }));
    } catch { /* sin almacenamiento: solo funcionará la reconexión sin recargar */ }
}

function savedRoom() {
    try {
        return JSON.parse(sessionStorage.getItem(STORAGE_KEY));
    } catch {
        return null;
    }
}

function forgetRoom() {
    Object.assign(room, { code: null, token: null, playerId: null });
    try {
        sessionStorage.removeItem(STORAGE_KEY);
    } catch { /* nada que borrar */ }
}


// =====================================================
// CONEXIÓN
// =====================================================

function send(type, data = {}) {
    if (room.socket?.readyState !== WebSocket.OPEN) {
        toast("Sin conexión con la sala.", { error: true });
        return;
    }
    room.socket.send(JSON.stringify({ type, ...data }));
}

function connect() {
    if (room.socket?.readyState === WebSocket.OPEN) return Promise.resolve();

    return new Promise((resolve, reject) => {
        const socket = new WebSocket(`${location.protocol === "https:" ? "wss" : "ws"}://${location.host}`);
        let opened = false;
        room.socket = socket;

        socket.addEventListener("open", () => {
            opened = true;
            resolve();
        });

        socket.addEventListener("message", event => {
            try {
                onMessage(JSON.parse(event.data));
            } catch (error) {
                console.error("Roulette:", error);
            }
        });

        socket.addEventListener("close", () => {
            clearInterval(timer);
            // Si ya no es el socket activo, el cierre lo pidió unmount() o lo sustituyó otro.
            if (room.socket !== socket || !opened) return;
            room.socket = null;

            if (room.code && room.token) reconnect();
            else {
                show("lobby");
                toast("Se perdió la conexión con la sala.", { error: true });
            }
        });

        socket.addEventListener("error", () => reject(new Error("No se pudo conectar con el servidor de salas.")));
    });
}

// Reintenta con espera creciente y recupera el sitio en la sala con el token.
async function reconnect(attempt = 1) {
    if (!root || !room.code || !room.token) return;

    if (attempt === 1) {
        if (room.reconnecting) return;
        room.reconnecting = true;
        toast("Conexión perdida. Reconectando…");
    }

    try {
        await connect();
        room.reconnecting = false;
        send("rejoin", { code: room.code, token: room.token });
    } catch {
        if (attempt >= RECONNECT_ATTEMPTS) {
            room.reconnecting = false;
            forgetRoom();
            show("lobby");
            toast("No se pudo volver a la sala. Crea una nueva o únete otra vez.", { error: true });
            return;
        }
        setTimeout(() => reconnect(attempt + 1), Math.min(1000 * attempt, 5000));
    }
}

// Al volver a primer plano (móvil) el socket suele estar muerto aunque el navegador no lo sepa.
function checkConnection() {
    if (!document.hidden && room.code && room.socket?.readyState !== WebSocket.OPEN) reconnect();
}

async function connectAndSend(type, data) {
    try {
        await connect();
        send(type, data);
    } catch (error) {
        toast(error.message, { error: true });
    }
}

const playerName = () => ui.name.value.trim() || "Jugador";

function join() {
    const code = ui.code.value.trim().toUpperCase();
    if (code.length !== 5) {
        toast("El código tiene 5 letras o números.");
        ui.code.focus();
        return;
    }
    connectAndSend("join_room", { code, name: playerName() });
}


// =====================================================
// MENSAJES DEL SERVIDOR
// =====================================================

function onMessage(message) {
    switch (message.type) {
        case "joined":
            Object.assign(room, { code: message.code, playerId: message.playerId, token: message.token });
            saveRoom();
            ui.roomCode.textContent = room.code;
            if (!message.resumed) show("room");
            if (!ui.playlists.children.length) playlistPicker(ui.playlists, { onSelect: choosePlaylist });
            break;

        case "rejoin_failed":
            forgetRoom();
            show("lobby");
            toast("Esa sala ya no existe.");
            break;

        case "room_state": return renderRoom(message);
        case "round_start": return renderRound(message);
        case "vote_registered": return lockAnswers();
        case "round_results": return renderResults(message);
        case "game_over": return renderFinal(message.scoreboard);
        case "error_message": return toast(message.message, { error: true });
    }
}


// =====================================================
// SALA
// =====================================================

function renderRoom(state) {
    room.hostId = state.hostId;
    room.minTracks = state.minTracks;

    if (state.status === "lobby") show("room");

    ui.count.textContent = `${state.players.length}/${state.maxPlayers}`;

    ui.players.replaceChildren(...state.players.map(player => {
        const status = !player.connected ? "Sin conexión" : player.ready ? "Listo" : "Eligiendo";
        return h("li", { class: `rl-player ${player.ready && player.connected ? "ready" : ""} ${player.connected ? "" : "offline"}` },
            h("span", { class: "rl-player-name" },
                player.name,
                player.id === room.playerId && h("small", {}, " (tú)"),
                player.id === state.hostId && h("small", {}, " · anfitrión")),
            h("span", { class: "rl-player-state" }, status));
    }));

    const isHost = state.hostId === room.playerId;
    const enough = state.players.length >= 2;
    const allReady = state.players.every(player => player.ready);

    ui.start.disabled = !isHost || !enough || !allReady;
    ui.hint.textContent =
        !enough ? "Comparte el enlace: hacen falta al menos dos jugadores." :
        !allReady ? "Faltan jugadores por elegir playlist." :
        isHost ? "Todo listo. ¡Empieza cuando quieras!" :
        "Todo listo. Empieza quien creó la sala.";
}

async function choosePlaylist(playlist) {
    ui.playlistStatus.textContent = "Leyendo canciones…";

    try {
        const tracks = (await loadTracks.sample(playlist.id))
            .filter(track => track.cover)
            .map(({ id, name, artist, cover }) => ({ id, name, artist, cover }));

        if (tracks.length < room.minTracks) {
            ui.playlistStatus.textContent = `Esa playlist tiene menos de ${room.minTracks} canciones con portada. Elige otra.`;
            return;
        }

        send("set_playlist", { playlist: { id: playlist.id, name: playlist.name }, tracks });
        ui.playlistStatus.textContent = `Lista: ${playlist.name}. Nadie más la ve.`;
    } catch (error) {
        ui.playlistStatus.textContent = error.message;
    }
}

async function copy(text, done) {
    try {
        await navigator.clipboard.writeText(text);
        toast(done);
    } catch {
        toast(text); // sin permiso de portapapeles: al menos se ve
    }
}


// =====================================================
// RONDA
// =====================================================

function renderRound(data) {
    show("round");

    ui.round.textContent = `Ronda ${data.round} de ${data.totalRounds}`;

    ui.covers.replaceChildren(...data.tracks.map((track, i) =>
        h("figure", { class: "rl-cover", style: `animation-delay: ${i * 70}ms` },
            h("img", { src: track.cover, alt: "", referrerPolicy: "no-referrer" }),
            h("figcaption", {}, h("strong", {}, track.name), h("span", {}, track.artist)))
    ));

    ui.question.textContent = data.isOwner ? "Es tu playlist. Disimula." : "¿De quién es esta música?";

    ui.answers.replaceChildren(...data.answers.map(answer =>
        h("button", {
            type: "button",
            class: "rl-answer",
            disabled: data.isOwner,
            onclick: event => {
                event.currentTarget.classList.add("chosen");
                lockAnswers();
                send("vote", { ownerId: answer.id });
            }
        }, answer.name)
    ));

    startTimer(data.duration);

    // Al volver a la sala tras votar, los botones siguen bloqueados.
    if (data.answered) lockAnswers();
}

const lockAnswers = () => $$(".rl-answer", root).forEach(button => { button.disabled = true; });

function startTimer(duration) {
    const end = Date.now() + duration;
    const total = 15000;

    clearInterval(timer);

    const tick = () => {
        const left = Math.max(0, end - Date.now());
        ui.seconds.textContent = Math.ceil(left / 1000);
        ui.seconds.classList.toggle("urgent", left <= 5000);
        ui.timerBar.style.transform = `scaleX(${left / total})`;
        ui.timerBar.classList.toggle("urgent", left <= 5000);

        if (!left) {
            clearInterval(timer);
            lockAnswers();
        }
    };

    tick();
    timer = setInterval(tick, 100);
}


// =====================================================
// RESULTADOS
// =====================================================

function renderResults(data) {
    clearInterval(timer);
    show("results");

    ui.resultsRound.textContent = data.round ? `Ronda ${data.round} de ${data.totalRounds}` : "Resultado";
    ui.owner.textContent = data.ownerName;
    renderScores(ui.scores, data.results, true);
}

function renderFinal(scoreboard) {
    clearInterval(timer);
    show("final");

    ui.winner.textContent = scoreboard[0]?.name || "nadie";
    renderScores(ui.finalScores, scoreboard, false);

    const isHost = room.hostId === room.playerId;
    ui.again.disabled = !isHost;
    ui.again.textContent = isHost ? "Otra partida" : "Esperando al anfitrión";
}

function renderScores(list, rows, marks) {
    list.replaceChildren(...rows.map((entry, i) => {
        const mark = !marks ? "" : entry.isOwner ? "Su playlist" : entry.correct ? "Acierto" : entry.answered ? "Fallo" : "Sin votar";
        return h("li", { class: `rl-score ${i === 0 ? "leader" : ""} ${entry.correct ? "correct" : ""}`, style: `animation-delay: ${i * 60}ms` },
            h("span", { class: "rl-score-name" }, entry.name),
            h("span", { class: "rl-score-mark" }, mark),
            h("span", { class: "rl-score-points display" }, entry.score));
    }));
}


function onClick(event) {
    const action = event.target.closest("[data-action]")?.dataset.action;

    switch (action) {
        case "create": return connectAndSend("create_room", { name: playerName() });
        case "start": return send("start_game");
        case "again": return send("play_again");
        case "copy-code": return copy(room.code, "Código copiado.");
        // El enlace lleva el código: quien lo abre en otro dispositivo entra directo a la sala.
        case "copy-link": return copy(`${location.origin}/app#sala=${room.code}`, "Enlace copiado. Mándaselo a tus amigos.");
    }
}


export default {
    template: "/games/roulette/roulette.html",
    cta: "Abrir Music Roulette",
    needsPlaylist: false,
    setupTitle: () => "Juega con tus amigos",
    note: () => "Crea una sala o únete con un código. Cada uno elige su playlist dentro de la sala, desde su móvil.",
    mount,
    unmount
};
