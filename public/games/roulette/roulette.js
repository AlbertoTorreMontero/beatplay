/* =========================================================
   BEATPLAY — MUSIC ROULETTE (cliente)

   Cada jugador lee sus propias playlists con su propia
   sesión de Spotify y manda a la sala solo portada,
   título y artista. El servidor no toca cuentas ajenas.

   No se reproduce audio aquí a propósito: las condiciones
   de Spotify no permiten sincronizar sus grabaciones con
   contenido visual.
========================================================= */

const RECONNECT_ATTEMPTS = 8;

const roulette = {
    socket: null,
    playerId: null,
    hostId: null,
    code: null,
    token: null, // identifica a este jugador al reconectar
    minTracks: 0, // lo manda el servidor en room_state
    timer: null,
    reconnecting: false
};

const rid = id => document.getElementById(id);


// =====================================================
// VISTAS
// =====================================================

function showRouletteView(id) {

    document
        .querySelectorAll(".rouletteView")
        .forEach(view => view.classList.toggle("hidden", view.id !== id));
}


// =====================================================
// SALA GUARDADA
// Un móvil puede descartar la pestaña en segundo plano:
// con el código y el token se vuelve a la misma sala.
// =====================================================

function saveRoom() {

    try {
        sessionStorage.setItem("rouletteRoom", JSON.stringify({ code: roulette.code, token: roulette.token }));
    } catch {
        /* almacenamiento bloqueado: solo funcionará la reconexión sin recargar */
    }
}


function savedRoom() {

    try {
        return JSON.parse(sessionStorage.getItem("rouletteRoom"));
    } catch {
        return null;
    }
}


function forgetRoom() {

    roulette.code = null;
    roulette.token = null;
    roulette.playerId = null;

    try {
        sessionStorage.removeItem("rouletteRoom");
    } catch {
        /* nada que borrar */
    }
}


// =====================================================
// CONEXIÓN
// =====================================================

function rouletteSend(type, data = {}) {

    if (roulette.socket?.readyState !== WebSocket.OPEN) {
        toast("Sin conexión con la sala.");
        return;
    }

    roulette.socket.send(JSON.stringify({ type, ...data }));
}


function connectRoulette() {

    return new Promise((resolve, reject) => {

        if (roulette.socket?.readyState === WebSocket.OPEN) {
            resolve();
            return;
        }

        const protocol = location.protocol === "https:" ? "wss" : "ws";
        const socket = new WebSocket(`${protocol}://${location.host}`);

        roulette.socket = socket;

        socket.addEventListener("open", () => {
            socket.opened = true;
            resolve();
        });

        socket.addEventListener("message", event => {

            try {
                handleRouletteMessage(JSON.parse(event.data));
            } catch (error) {
                console.error("MusicRoulette:", error);
            }
        });

        socket.addEventListener("close", () => {

            clearInterval(roulette.timer);

            // Si ya no es el socket activo, el cierre lo pidió stopRoulette() o lo sustituyó otro.
            if (roulette.socket !== socket || !socket.opened) return;

            roulette.socket = null;

            if (roulette.code && roulette.token) {
                reconnectRoulette();
            } else {
                showRouletteView("rouletteLobby");
                toast("Se perdió la conexión con la sala.");
            }
        });

        socket.addEventListener("error", () =>
            reject(new Error("No se pudo conectar con la sala."))
        );
    });
}


// Reintenta con espera creciente y, al conectar, recupera el sitio en la sala con el token.
async function reconnectRoulette(attempt = 1) {

    if (!roulette.code || !roulette.token) return;

    if (attempt === 1) {
        if (roulette.reconnecting) return;
        roulette.reconnecting = true;
        toast("Conexión perdida. Reconectando…");
    }

    try {
        await connectRoulette();
        roulette.reconnecting = false;
        rouletteSend("rejoin", { code: roulette.code, token: roulette.token });

    } catch {

        if (attempt >= RECONNECT_ATTEMPTS) {
            roulette.reconnecting = false;
            forgetRoom();
            showRouletteView("rouletteLobby");
            toast("No se pudo volver a la sala. Crea una nueva o únete de nuevo.");
            return;
        }

        setTimeout(() => reconnectRoulette(attempt + 1), Math.min(1000 * attempt, 5000));
    }
}


// Al volver a primer plano (móvil) el socket suele estar muerto aunque el navegador no lo haya notado.
function checkRouletteConnection() {

    if (document.hidden || !roulette.code || roulette.socket?.readyState === WebSocket.OPEN) return;

    reconnectRoulette();
}

document.addEventListener("visibilitychange", checkRouletteConnection);
window.addEventListener("online", checkRouletteConnection);


// Crear y unirse pueden ocurrir tras perder la conexión, así que reconectan si hace falta.
async function rouletteConnectAndSend(type, data) {

    try {
        await connectRoulette();
    } catch (error) {
        toast(error.message);
        return;
    }

    rouletteSend(type, data);
}


// =====================================================
// ARRANQUE
// =====================================================

async function startRoulette({ code = "" } = {}) {

    bindRouletteControls();
    prefillRouletteName();

    if (code) rid("rouletteCode").value = code;

    await connectRoulette();

    showRouletteView("rouletteLobby");

    // Si la pestaña se recargó en mitad de una sala, se vuelve a ella.
    const saved = savedRoom();

    if (saved?.code && saved?.token) {
        roulette.code = saved.code;
        roulette.token = saved.token;
        rouletteSend("rejoin", saved);
    }
}


function stopRoulette() {

    clearInterval(roulette.timer);

    if (roulette.socket?.readyState === WebSocket.OPEN) {
        rouletteSend("leave_room");
        roulette.socket.close();
    }

    roulette.socket = null;
    roulette.reconnecting = false;
    forgetRoom();
}


function bindRouletteControls() {

    rid("rouletteCreate").addEventListener("click", () => {
        rouletteConnectAndSend("create_room", { name: rouletteName() });
    });

    rid("rouletteJoin").addEventListener("click", joinRouletteRoom);

    rid("rouletteCode").addEventListener("keydown", event => {
        if (event.key === "Enter") joinRouletteRoom();
    });

    rid("rouletteStart").addEventListener("click", () => rouletteSend("start_game"));
    rid("rouletteAgain").addEventListener("click", () => rouletteSend("play_again"));

    rid("rouletteCopy").addEventListener("click", () => copyText(roulette.code, "Código copiado."));

    // El enlace lleva el código: quien lo abre en otro dispositivo entra directo a la sala.
    rid("rouletteCopyLink").addEventListener("click", () =>
        copyText(`${location.origin}/app#sala=${roulette.code}`, "Enlace copiado.")
    );
}


async function copyText(text, message) {

    try {
        await navigator.clipboard.writeText(text || "");
        toast(message);
    } catch {
        toast(text); // sin permiso de portapapeles: al menos se ve
    }
}


// El nombre de Spotify suele ser único entre amigos; el servidor evita duplicados si no.
async function prefillRouletteName() {

    const input = rid("rouletteName");

    if (!input || input.value) return;

    try {
        const response = await apiFetch("/api/me");

        if (response.ok && !input.value) input.value = (await response.json()).name.slice(0, 20);
    } catch {
        /* sin nombre precargado: se escribe a mano */
    }
}


function rouletteName() {
    return rid("rouletteName")?.value.trim() || "Jugador";
}


function joinRouletteRoom() {

    const code = rid("rouletteCode")?.value.trim().toUpperCase();

    if (!code) {
        toast("Escribe el código de la sala.");
        return;
    }

    rouletteConnectAndSend("join_room", { code, name: rouletteName() });
}


// =====================================================
// MENSAJES DEL SERVIDOR
// =====================================================

function handleRouletteMessage(message) {

    switch (message.type) {

        case "joined":
            roulette.code = message.code;
            roulette.playerId = message.playerId;
            roulette.token = message.token;
            saveRoom();
            enterRouletteRoom(message.resumed);
            break;

        case "rejoin_failed":
            forgetRoom();
            showRouletteView("rouletteLobby");
            toast("Esa sala ya no existe.");
            break;

        case "room_state":
            renderRouletteRoom(message);
            break;

        case "round_start":
            renderRouletteRound(message);
            break;

        case "vote_registered":
            lockRouletteAnswers();
            break;

        case "round_results":
            renderRouletteResults(message);
            break;

        case "game_over":
            renderRouletteFinal(message.scoreboard);
            break;

        case "error_message":
            toast(message.message);
            break;
    }
}


// =====================================================
// SALA
// =====================================================

// Al volver a una sala en curso no se cambia de vista: el servidor reenvía la ronda que toque.
function enterRouletteRoom(resumed = false) {

    if (!resumed) showRouletteView("rouletteRoom");

    rid("rouletteRoomCode").textContent = roulette.code;

    if (!rid("roulettePlaylists").children.length) loadRoulettePlaylists();
}


function renderRouletteRoom(state) {

    roulette.hostId = state.hostId;
    roulette.minTracks = state.minTracks;

    if (state.status === "lobby") showRouletteView("rouletteRoom");

    const count = rid("rouletteCount");
    if (count) count.textContent = `${state.players.length}/${state.maxPlayers}`;

    const list = rid("roulettePlayers");

    if (list) {

        list.textContent = "";

        state.players.forEach((player, index) => {

            const row = document.createElement("div");
            row.className = "roulettePlayer";

            const position = document.createElement("span");
            position.className = "roulettePlayerIndex";
            position.textContent = String(index + 1).padStart(2, "0");

            const name = document.createElement("span");
            name.className = "roulettePlayerName";
            name.textContent = player.name;
            name.classList.toggle("you", player.id === roulette.playerId);
            name.classList.toggle("host", player.id === state.hostId);

            const status = document.createElement("span");
            status.className = "roulettePlayerState";
            status.textContent = !player.connected ? "SIN CONEXIÓN" : player.ready ? "LISTO" : "ELIGIENDO";
            status.classList.toggle("ready", player.ready && player.connected);
            status.classList.toggle("offline", !player.connected);

            row.append(position, name, status);
            list.appendChild(row);
        });
    }

    const isHost = state.hostId === roulette.playerId;
    const everyoneReady = state.players.every(player => player.ready);
    const enough = state.players.length >= 2;

    const start = rid("rouletteStart");
    if (start) start.disabled = !isHost || !enough || !everyoneReady;

    const hint = rid("rouletteHint");

    if (hint) {
        if (!enough) {
            hint.textContent = "Comparte el código: hacen falta dos jugadores.";
        } else if (!everyoneReady) {
            hint.textContent = "Faltan jugadores por elegir playlist.";
        } else if (!isHost) {
            hint.textContent = "Todo listo. Que empiece quien creó la sala.";
        } else {
            hint.textContent = "Todo listo.";
        }
    }
}


// =====================================================
// PLAYLISTS
// =====================================================

async function loadRoulettePlaylists() {

    const grid = rid("roulettePlaylists");
    const status = rid("roulettePlaylistStatus");

    if (!grid) return;

    grid.textContent = "";

    if (status) status.textContent = "Cargando tus playlists…";

    try {
        const response = await apiFetch("/api/playlists");
        const data = await response.json();

        if (!response.ok) {
            throw new Error(data?.error || "No se pudieron cargar.");
        }

        if (!data.length) {
            if (status) status.textContent = "No tienes playlists con canciones.";
            return;
        }

        if (status) {
            status.textContent = "Elige una playlist. Nadie verá cuál es.";
        }

        data.forEach(playlist => {

            const card = document.createElement("button");
            card.type = "button";
            card.className = "roulettePlaylistCard";
            card.dataset.id = playlist.id;

            if (playlist.image) {
                const image = document.createElement("img");
                image.src = playlist.image;
                image.alt = "";
                image.loading = "lazy";
                card.appendChild(image);
            }

            const name = document.createElement("strong");
            name.textContent = playlist.name;

            const count = document.createElement("small");
            count.textContent = `${playlist.tracks} canciones`;

            card.append(name, count);

            card.addEventListener("click", () => chooseRoulettePlaylist(playlist));

            grid.appendChild(card);
        });

    } catch (error) {
        console.error("MusicRoulette:", error);
        if (status) status.textContent = error.message;
    }
}


async function chooseRoulettePlaylist(playlist) {

    const status = rid("roulettePlaylistStatus");

    document
        .querySelectorAll(".roulettePlaylistCard")
        .forEach(card => {
            card.classList.toggle("selected", card.dataset.id === playlist.id);
            card.setAttribute("aria-pressed", String(card.dataset.id === playlist.id));
        });

    if (status) status.textContent = "Leyendo canciones…";

    try {
        const tracks = (await getPlaylistTracks(playlist.id))
            .filter(track => track.cover)
            .map(track => ({
                id: track.id,
                name: track.name,
                artist: track.artist,
                cover: track.cover
            }));

        if (tracks.length < roulette.minTracks) {
            if (status) {
                status.textContent =
                    `Esa playlist tiene menos de ${roulette.minTracks} canciones con portada.`;
            }
            return;
        }

        rouletteSend("set_playlist", {
            playlist: { id: playlist.id, name: playlist.name },
            tracks
        });

        if (status) {
            status.textContent = `Listo: ${tracks.length} canciones cargadas.`;
        }

    } catch (error) {
        console.error("MusicRoulette:", error);
        if (status) status.textContent = error.message;
    }
}


// =====================================================
// RONDA
// =====================================================

function renderRouletteRound(data) {

    showRouletteView("rouletteGame");

    const round = rid("rouletteRound");
    if (round) round.textContent = `${data.round}/${data.totalRounds}`;

    const covers = rid("rouletteCovers");

    if (covers) {

        covers.textContent = "";

        data.tracks.forEach(track => {

            const card = document.createElement("div");
            card.className = "rouletteCover";

            const image = document.createElement("img");
            image.src = track.cover;
            image.alt = "";
            image.referrerPolicy = "no-referrer";
            card.appendChild(image);

            const info = document.createElement("div");
            info.className = "rouletteCoverInfo";

            const name = document.createElement("strong");
            name.textContent = track.name;

            const artist = document.createElement("span");
            artist.textContent = track.artist;

            info.append(name, artist);
            card.appendChild(info);

            covers.appendChild(card);
        });
    }

    const question = rid("rouletteQuestion");

    if (question) {
        question.textContent = data.isOwner
            ? "Esta ronda es tu playlist. Disimula."
            : "¿De quién es esta música?";
    }

    const answers = rid("rouletteAnswers");

    if (answers) {

        answers.textContent = "";

        data.answers.forEach(answer => {

            const button = document.createElement("button");
            button.type = "button";
            button.className = "rouletteAnswer";
            button.textContent = answer.name;
            button.disabled = data.isOwner;

            button.addEventListener("click", () => {
                button.classList.add("chosen");
                lockRouletteAnswers();
                rouletteSend("vote", { ownerId: answer.id });
            });

            answers.appendChild(button);
        });
    }

    startRouletteTimer(data.duration);

    // Si se vuelve a la sala tras votar, los botones siguen bloqueados.
    if (data.answered) lockRouletteAnswers();
}


function lockRouletteAnswers() {

    document
        .querySelectorAll(".rouletteAnswer")
        .forEach(button => {
            button.disabled = true;
        });
}


function startRouletteTimer(duration) {

    const display = rid("rouletteTimer");

    if (!display) return;

    const end = Date.now() + duration;

    clearInterval(roulette.timer);

    const tick = () => {

        const remaining = Math.max(0, end - Date.now());

        display.textContent = (remaining / 1000).toFixed(1);
        display.classList.toggle("urgent", remaining <= 5000);

        if (remaining <= 0) {
            clearInterval(roulette.timer);
            lockRouletteAnswers();
        }
    };

    tick();
    roulette.timer = setInterval(tick, 100);
}


// =====================================================
// RESULTADOS
// =====================================================

function renderRouletteResults(data) {

    clearInterval(roulette.timer);

    showRouletteView("rouletteResults");

    const owner = rid("rouletteOwner");
    if (owner) owner.textContent = `ERA DE ${data.ownerName.toUpperCase()}`;

    renderRouletteScores(rid("rouletteScores"), data.results, true);
}


function renderRouletteFinal(scoreboard) {

    clearInterval(roulette.timer);

    showRouletteView("rouletteFinal");

    const winner = rid("rouletteWinner");

    if (winner) {
        winner.textContent = scoreboard.length
            ? `GANA ${scoreboard[0].name.toUpperCase()}`
            : "SIN JUGADORES";
    }

    renderRouletteScores(rid("rouletteFinalScores"), scoreboard, false);

    const again = rid("rouletteAgain");

    if (again) {
        again.disabled = roulette.hostId !== roulette.playerId;
    }
}


function renderRouletteScores(container, rows, showMarks) {

    if (!container) return;

    container.textContent = "";

    rows.forEach((entry, index) => {

        const row = document.createElement("div");
        row.className = "rouletteScoreRow";
        row.classList.toggle("leader", index === 0);

        const position = document.createElement("span");
        position.className = "rouletteScoreIndex";
        position.textContent = String(index + 1).padStart(2, "0");

        const name = document.createElement("span");
        name.className = "rouletteScoreName";
        name.textContent = entry.name;

        const mark = document.createElement("span");
        mark.className = "rouletteScoreMark";

        if (showMarks) {
            if (entry.isOwner) {
                mark.textContent = "SU PLAYLIST";
            } else if (entry.correct) {
                mark.textContent = "ACIERTO";
                mark.classList.add("correct");
            } else if (entry.answered) {
                mark.textContent = "FALLO";
            } else {
                mark.textContent = "SIN VOTAR";
            }
        }

        const points = document.createElement("span");
        points.className = "rouletteScorePoints";
        points.textContent = entry.score;

        row.append(position, name, mark, points);
        container.appendChild(row);
    });
}
