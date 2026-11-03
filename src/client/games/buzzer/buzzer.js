/*
 * PULSADOR (cliente)
 * El anfitrión (con sesión) elige playlist y la música suena en su dispositivo.
 * Todos, también invitados sin cuenta, adivinan desde su móvil. Hasta 60 s por canción.
 *
 * Llamadas a la API: el anfitrión carga la playlist (una página) y manda las 10 canciones
 * de la partida a la cola del reproductor en una sola llamada. Cada canción nueva la pasa el SDK.
 */
import { refs, h, toast, pulse, shuffle, $$ } from "../../lib/ui.js";
import { getMe, tracks as loadTracks } from "../../lib/api.js";
import { playlistPicker } from "../../lib/playlists.js";
import { createRoomClient } from "../../lib/room.js";
import { songSearch } from "../../lib/song-search.js";
import { player } from "../../lib/player/index.js";

const ROUNDS = 10;
const ROUND_MS = 60000;

let ui = {};
let root = null;
let client = null;
let search = null;
let guest = false;
let state = null;      // último room_state
let timer = null;
let pool = [];         // canciones de la playlist del anfitrión, barajadas
let cursor = 0;        // por dónde va en pool (otra partida usa canciones nuevas)
let picker = null;

const isHost = () => state?.hostId === client?.room.playerId;
const show = view => $$("[data-view]", root).forEach(section => section.classList.toggle("hidden", section.dataset.view !== view));


// =====================================================
// CICLO DE VIDA
// =====================================================

async function mount(container, { code = "", guest: isGuest = false } = {}) {
    root = container;
    ui = refs(root);
    guest = isGuest;

    client = createRoomClient({
        onMessage,
        onLost: () => {
            clearInterval(timer);
            show("lobby");
            toast("Se perdió la conexión con la sala.", { error: true });
        }
    });

    search = songSearch(ui.search, { onPick: track => client.send("guess", { trackId: track.id }) });

    root.addEventListener("click", onClick);
    ui.joinForm.addEventListener("submit", event => {
        event.preventDefault();
        if (!client.join(ui.code.value, playerName())) ui.code.focus();
    });
    ui.code.addEventListener("input", () => { ui.code.value = ui.code.value.toUpperCase(); });

    // Sin cuenta no hay música: los invitados solo pueden unirse.
    ui.createOption.hidden = guest;

    ui.code.value = code;
    const named = guest ? Promise.resolve() : getMe().then(me => { if (!ui.name.value) ui.name.value = me.name.slice(0, 20); }).catch(() => {});

    await client.connect();
    show("lobby");

    if (client.resumeSaved("buzzer")) return;

    if (code) {
        await named;
        if (!ui.name.value) return ui.name.focus();
        client.join(code, playerName());
    }
}

function unmount() {
    clearInterval(timer);
    client?.close();
    client = null;
    root = null;
    state = null;
    pool = [];
    picker = null;
}

const playerName = () => ui.name.value.trim() || "Jugador";


// =====================================================
// MENSAJES DEL SERVIDOR
// =====================================================

function onMessage(message) {
    switch (message.type) {
        case "joined":
            ui.roomCode.textContent = message.code;
            if (!message.resumed) show("room");
            break;
        case "rejoin_failed":
            show("lobby");
            toast("Esa sala ya no existe.");
            break;
        case "room_state": return renderRoom(message);
        case "round_start": return renderRound(message);
        case "guess_result": return renderGuess(message);
        case "round_results": return renderResults(message);
        case "game_over": return renderFinal(message.scoreboard);
        case "error_message": return toast(message.message, { error: true });
    }
}


// =====================================================
// SALA
// =====================================================

function renderRoom(next) {
    state = next;
    if (state.status === "lobby") show("room");

    ui.count.textContent = state.players.length;
    ui.players.replaceChildren(...state.players.map(player =>
        h("li", { class: `rl-player ${player.connected ? "" : "offline"}` },
            h("span", { class: "rl-player-name" },
                player.name,
                player.id === client.room.playerId && h("small", {}, " (tú)"),
                player.id === state.hostId && h("small", {}, " · pone la música")),
            h("span", { class: "rl-player-state" }, player.connected ? `${player.score} pts` : "Sin conexión"))));

    renderProgress();

    const host = isHost();
    ui.hostPanel.classList.toggle("hidden", !host || guest);
    ui.guestPanel.classList.toggle("hidden", host && !guest);

    if (host && guest) {
        ui.guestStatus.textContent = "Ahora te toca poner la música, pero hace falta una cuenta de Spotify. Que cree la sala alguien con cuenta.";
    } else if (!host) {
        ui.guestStatus.textContent = state.songs ? `Playlist elegida: ${state.playlistName}. Esperando a que empiece.` : "El anfitrión está eligiendo la playlist.";
    }

    if (host && !guest && !picker) picker = playlistPicker(ui.playlists, { onSelect: choosePlaylist });

    ui.start.disabled = !host || guest || !state.songs;
    ui.start.hidden = !host;
    ui.hint.textContent = !host
        ? "Empieza quien pone la música."
        : !state.songs ? "Elige una playlist para empezar." : `${state.players.length} jugando · ${state.songs} canciones`;
}

// El anfitrión lee su playlist (una llamada), elige 10 al azar y las carga en su reproductor.
async function choosePlaylist(playlist) {
    ui.playlistStatus.textContent = "Leyendo canciones…";
    try {
        const tracks = await loadTracks.sample(playlist.id);
        if (tracks.length < 3) {
            ui.playlistStatus.textContent = "Esa playlist es demasiado corta. Elige otra.";
            return;
        }
        pool = shuffle([...tracks]);
        cursor = 0;
        sendSongs(playlist.name);
        ui.playlistStatus.textContent = `${playlist.name}: ${Math.min(ROUNDS, pool.length)} canciones listas.`;
    } catch (error) {
        ui.playlistStatus.textContent = error.message;
    }
}

function sendSongs(playlistName = state?.playlistName) {
    const order = Array.from({ length: Math.min(ROUNDS, pool.length) }, (_, i) => pool[(cursor + i) % pool.length]);
    cursor = (cursor + order.length) % pool.length;

    player.load(order);
    client.send("set_songs", {
        playlistName,
        choices: pool.map(({ id, name, artist, cover }) => ({ id, name, artist, cover })),
        order: order.map(track => track.id)
    });
}


// =====================================================
// RONDA
// =====================================================

function renderRound(data) {
    show("round");

    ui.round.textContent = `Canción ${data.round} de ${data.totalRounds}`;
    ui.source.textContent = isHost() ? "🔊 Suena en este dispositivo: sube el volumen" : "🔊 Suena en el móvil de quien pone la música";

    search.setChoices([...data.choices].sort((a, b) => a.name.localeCompare(b.name)));
    search.clear();
    ui.feedback.textContent = "";

    const finished = data.solved || data.passed;
    ui.answer.classList.toggle("hidden", finished);
    ui.done.classList.toggle("hidden", !finished);
    ui.done.textContent = data.solved ? "¡La tienes! Espera a los demás." : data.passed ? "Has pasado. Espera a los demás." : "";
    if (!finished) {
        search.disable(false);
        search.focus();
    }

    if (isHost()) player.playAt(data.index).catch(error => toast(error.message, { error: true }));

    startTimer(data.duration);
}

function renderGuess(result) {
    if (!result.correct) {
        ui.feedback.textContent = "No es esa. Prueba otra.";
        pulse(ui.feedback, "shake");
        search.focus();
        return;
    }

    search.disable(true);
    ui.answer.classList.add("hidden");
    ui.done.classList.remove("hidden");
    ui.done.textContent = `¡Acertada! +${result.points} puntos`;
    pulse(ui.done);
}

// Quién la ha adivinado ya, sin decir cuál es.
function renderProgress() {
    if (!state || state.status !== "playing") return;
    ui.progress.replaceChildren(...state.players.map(player =>
        h("li", { class: player.solved ? "solved" : player.passed ? "passed" : "" },
            player.solved ? "✓ " : player.passed ? "– " : "… ", player.name)));
}

function startTimer(duration) {
    const end = Date.now() + duration;
    clearInterval(timer);

    const tick = () => {
        const left = Math.max(0, end - Date.now());
        ui.seconds.textContent = Math.ceil(left / 1000);
        ui.seconds.classList.toggle("urgent", left <= 10000);
        ui.timerBar.style.transform = `scaleX(${left / ROUND_MS})`;
        ui.timerBar.classList.toggle("urgent", left <= 10000);
        if (!left) {
            clearInterval(timer);
            search.disable(true);
        }
    };

    tick();
    timer = setInterval(tick, 200);
}


// =====================================================
// RESULTADOS
// =====================================================

function renderResults(data) {
    clearInterval(timer);
    show("results");

    ui.resultsRound.textContent = `Canción ${data.round} de ${data.totalRounds}`;
    ui.cover.hidden = !data.track.cover;
    if (data.track.cover) ui.cover.src = data.track.cover;
    ui.track.textContent = data.track.name;
    ui.artist.textContent = data.track.artist;

    renderScores(ui.scores, data.results, true);

    const last = data.round >= data.totalRounds;
    ui.next.classList.toggle("hidden", !isHost() || last);
    ui.nextHint.textContent = last ? "Esta era la última." : "La siguiente empieza en unos segundos.";
}

function renderFinal(scoreboard) {
    clearInterval(timer);
    show("final");
    if (isHost()) player.pause();

    ui.winner.textContent = scoreboard[0]?.name || "nadie";
    renderScores(ui.finalScores, scoreboard, false);
    ui.again.disabled = !isHost();
    ui.again.textContent = isHost() ? "Otra partida" : "Esperando al anfitrión";
}

function renderScores(list, rows, showRound) {
    list.replaceChildren(...rows.map((entry, i) =>
        h("li", { class: `rl-score ${i === 0 ? "leader" : ""} ${entry.solved ? "correct" : ""}`, style: `animation-delay: ${i * 60}ms` },
            h("span", { class: "rl-score-name" }, entry.name),
            h("span", { class: "rl-score-mark" }, !showRound ? "" : entry.solved ? `+${entry.points} · ${(entry.timeMs / 1000).toFixed(1)} s` : "Sin acertar"),
            h("span", { class: "rl-score-points display" }, entry.score))));
}


async function copy(text, done) {
    try {
        await navigator.clipboard.writeText(text);
        toast(done);
    } catch {
        toast(text);
    }
}

function onClick(event) {
    switch (event.target.closest("[data-action]")?.dataset.action) {
        case "create": return client.create("buzzer", playerName());
        case "start": return client.send("start_game");
        case "pass": return client.send("pass");
        case "next": return client.send("next");
        case "again":
            client.send("play_again");
            // Otra partida con canciones nuevas de la misma playlist: sin llamadas a la API para leerla.
            if (pool.length) setTimeout(() => sendSongs(), 100);
            return;
        case "copy-code": return copy(client.room.code, "Código copiado.");
        case "copy-link": return copy(client.inviteLink(), "Enlace copiado. Mándaselo a tus amigos.");
    }
}


export default {
    template: "/games/buzzer/buzzer.html",
    cta: "Abrir Pulsador",
    needsPlaylist: false,
    setupTitle: () => "Juega con tus amigos",
    note: () => "Creas una sala, la música suena en tu dispositivo y todos adivinan desde su móvil, sin necesidad de cuenta.",
    mount,
    unmount
};
