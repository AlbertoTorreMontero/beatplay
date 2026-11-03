/*
 * MUSIC ROULETTE (cliente)
 * Cada jugador lee sus playlists con su propia sesión y solo manda a la sala
 * portada, título y artista. Aquí no suena audio a propósito: las condiciones de
 * Spotify no permiten sincronizar sus grabaciones con contenido visual.
 */
import { refs, h, toast, $$ } from "../../lib/ui.js";
import { api, getMe, tracks as loadTracks } from "../../lib/api.js";
import { playlistPicker } from "../../lib/playlists.js";
import { createRoomClient } from "../../lib/room.js";

let ui = {};
let root = null;
let client = null;
const room = { hostId: null, minTracks: 5 }; // lo que cuenta el servidor en room_state
let timer = null;
let guest = false;


// =====================================================
// CICLO DE VIDA
// =====================================================

async function mount(container, { code = "", guest: isGuest = false } = {}) {
    root = container;
    ui = refs(root);
    guest = isGuest;

    root.addEventListener("click", onClick);
    ui.joinForm.addEventListener("submit", event => {
        event.preventDefault();
        join();
    });
    ui.code.addEventListener("input", () => { ui.code.value = ui.code.value.toUpperCase(); });
    ui.linkForm.addEventListener("submit", event => {
        event.preventDefault();
        choosePublicPlaylist(ui.link.value.trim());
    });

    // Los invitados no tienen playlists cargadas: eligen la suya pegando el enlace.
    if (guest) {
        ui.playlists.hidden = true;
        ui.linkLabel.textContent = "Pega el enlace de tu playlist de Spotify (tiene que ser pública)";
        ui.playlistStatus.textContent = "Nadie verá cuál es.";
    }

    client = createRoomClient({
        onMessage,
        onLost: () => {
            clearInterval(timer);
            show("lobby");
            toast("Se perdió la conexión con la sala.", { error: true });
        }
    });

    ui.code.value = code;
    const named = guest
        ? Promise.resolve()
        : getMe().then(me => { if (!ui.name.value) ui.name.value = me.name.slice(0, 20); }).catch(() => {});

    await client.connect();
    show("lobby");

    if (client.resumeSaved("roulette")) return;

    if (code) {
        // Quien llega con un enlace de invitación entra directo, con su nombre de la cuenta.
        await named;
        if (guest && !ui.name.value) return ui.name.focus(); // el invitado escribe su nombre y pulsa Entrar
        join();
    }
}

function unmount() {
    clearInterval(timer);
    client?.close();
    client = null;
    root = null;
}

const show = view => $$("[data-view]", root).forEach(section => section.classList.toggle("hidden", section.dataset.view !== view));


const playerName = () => ui.name.value.trim() || "Jugador";

function join() {
    if (!client.join(ui.code.value, playerName())) ui.code.focus();
}


// =====================================================
// MENSAJES DEL SERVIDOR
// =====================================================

function onMessage(message) {
    switch (message.type) {
        case "joined":
            ui.roomCode.textContent = message.code;
            if (!message.resumed) show("room");
            if (!guest && !ui.playlists.children.length) playlistPicker(ui.playlists, { onSelect: choosePlaylist });
            break;

        case "rejoin_failed":
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
                player.id === client.room.playerId && h("small", {}, " (tú)"),
                player.id === state.hostId && h("small", {}, " · anfitrión")),
            h("span", { class: "rl-player-state" }, status));
    }));

    const isHost = state.hostId === client.room.playerId;
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

        client.send("set_playlist", { playlist: { id: playlist.id, name: playlist.name }, tracks });
        ui.playlistStatus.textContent = `Lista: ${playlist.name}. Nadie más la ve.`;
    } catch (error) {
        ui.playlistStatus.textContent = error.message;
    }
}

// Playlist pública por enlace: la lee el servidor sin iniciar sesión.
async function choosePublicPlaylist(url) {
    if (!url) return ui.link.focus();

    ui.playlistStatus.textContent = "Leyendo la playlist…";
    ui.linkForm.querySelector("button").setAttribute("aria-busy", "true");

    try {
        const { name, tracks } = await api("/api/public/playlist", { method: "POST", body: { url } });

        if (tracks.length < room.minTracks) {
            ui.playlistStatus.textContent = `Esa playlist tiene menos de ${room.minTracks} canciones con portada. Prueba con otra.`;
            return;
        }

        client.send("set_playlist", { playlist: { id: url, name }, tracks });
        ui.playlistStatus.textContent = `Lista: ${name}. Nadie más la ve.`;
        ui.playlists.querySelectorAll(".playlist").forEach(card => card.setAttribute("aria-pressed", "false"));
    } catch (error) {
        ui.playlistStatus.textContent = error.message;
    } finally {
        ui.linkForm.querySelector("button").removeAttribute("aria-busy");
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
                client.send("vote", { ownerId: answer.id });
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

    const isHost = room.hostId === client.room.playerId;
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
        case "create": return client.create("roulette", playerName());
        case "start": return client.send("start_game");
        case "again": return client.send("play_again");
        case "copy-code": return copy(client.room.code, "Código copiado.");
        // El enlace lleva el código: quien lo abre en otro dispositivo entra directo a la sala.
        case "copy-link": return copy(client.inviteLink(), "Enlace copiado. Mándaselo a tus amigos.");
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
