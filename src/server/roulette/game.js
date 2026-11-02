// Music Roulette: salas en memoria y reglas de la partida.
// Cada jugador manda portada, título y artista de su playlist; nadie ve de quién es cada una.
const crypto = require("crypto");
const { WebSocket } = require("ws");
const { shuffle } = require("../utils");

const RULES = {
    rounds: 5,
    coversPerRound: 5,
    roundMs: 15000,
    breakMs: 5000,
    maxPlayers: 10,
    reconnectGraceMs: 30000
};

const MIN_TRACKS = RULES.coversPerRound;

// Sin 0/O/1/I: el código se dicta y se escribe desde el móvil.
const CODE_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";

function createRoulette({ coverHosts }) {

    const rooms = new Map();


    // =====================================================
    // ENVÍO
    // =====================================================

    function send(ws, type, data = {}) {
        if (ws?.readyState === WebSocket.OPEN) ws.send(JSON.stringify({ type, ...data }));
    }

    const broadcast = (room, type, data) => room.players.forEach(player => send(player.ws, type, data));
    const isReady = player => Boolean(player.playlist) && player.tracks.length >= MIN_TRACKS;

    // No se envía la playlist de cada jugador: delataría de quién es la música.
    function broadcastState(room) {
        broadcast(room, "room_state", {
            maxPlayers: RULES.maxPlayers,
            minTracks: MIN_TRACKS,
            code: room.code,
            hostId: room.hostId,
            status: room.status,
            players: room.players.map(player => ({
                id: player.id,
                name: player.name,
                connected: Boolean(player.ws),
                ready: isReady(player),
                score: player.score
            }))
        });
    }

    const scoreboard = room => room.players
        .map(({ id, name, score }) => ({ id, name, score }))
        .sort((a, b) => b.score - a.score);

    const fail = (player, message) => send(player.ws, "error_message", { message });


    // =====================================================
    // VALIDACIÓN
    // =====================================================

    const cleanName = value => String(value || "").trim().slice(0, 20) || "Jugador";

    // Las portadas se cargan en el navegador de los demás: solo se aceptan las del CDN del proveedor.
    function isAllowedCover(url) {
        try {
            const { protocol, host } = new URL(url);
            return protocol === "https:" && coverHosts.includes(host);
        } catch {
            return false;
        }
    }

    function cleanTracks(value) {
        if (!Array.isArray(value)) return [];

        return value
            .filter(track => track?.id && isAllowedCover(track.cover))
            .slice(0, 100)
            .map(track => ({
                id: String(track.id).slice(0, 60),
                name: String(track.name || "").slice(0, 120),
                artist: String(track.artist || "").slice(0, 120),
                cover: String(track.cover).slice(0, 300)
            }));
    }

    function uniqueName(room, name) {
        const taken = new Set(room.players.map(player => player.name));
        let candidate = name;
        for (let n = 2; taken.has(candidate); n++) candidate = `${name} ${n}`;
        return candidate;
    }


    // =====================================================
    // SALAS
    // =====================================================

    function createPlayer(ws) {
        return {
            ws,
            id: crypto.randomBytes(4).toString("hex"),
            token: crypto.randomBytes(12).toString("hex"), // identifica al jugador al reconectar
            name: "Jugador",
            room: null,
            playlist: null,
            tracks: [],
            score: 0,
            answer: null,
            dropTimer: null
        };
    }

    function newCode() {
        let code;
        do {
            code = Array.from({ length: 5 }, () => CODE_ALPHABET[crypto.randomInt(CODE_ALPHABET.length)]).join("");
        } while (rooms.has(code));
        return code;
    }

    function joined(player, room, extra = {}) {
        send(player.ws, "joined", { code: room.code, playerId: player.id, token: player.token, ...extra });
    }

    function createRoom(player, message) {
        if (player.room) leaveRoom(player);

        const room = {
            code: newCode(),
            hostId: player.id,
            players: [player],
            status: "lobby",
            rounds: [],
            currentRound: 0,
            roundOpen: false,
            startedAt: 0,
            answers: [],
            lastResults: null,
            timer: null
        };

        player.name = cleanName(message.name);
        player.room = room.code;
        rooms.set(room.code, room);

        joined(player, room);
        broadcastState(room);
    }

    function joinRoom(player, message) {
        const code = String(message.code || "").trim().toUpperCase();
        const room = rooms.get(code);

        if (!room) return fail(player, "No existe ninguna sala con ese código.");
        if (player.room === code) return;
        if (room.status !== "lobby") return fail(player, "Esa partida ya ha empezado.");
        if (room.players.length >= RULES.maxPlayers) return fail(player, "La sala está completa.");

        if (player.room) leaveRoom(player);

        player.name = uniqueName(room, cleanName(message.name));
        player.room = code;
        room.players.push(player);

        joined(player, room);
        broadcastState(room);
    }

    // Un móvil que bloquea la pantalla pierde el socket: al volver recupera su sitio en la sala.
    function rejoinRoom(connection, message) {
        const room = rooms.get(String(message.code || ""));
        const player = room?.players.find(other => other.token === message.token);

        if (!player) return send(connection.ws, "rejoin_failed");

        clearTimeout(player.dropTimer);
        if (player.ws && player.ws !== connection.ws) player.ws.close();

        player.ws = connection.ws;
        connection.player = player;

        joined(player, room, { resumed: true });
        broadcastState(room);

        // Se le reenvía lo que le haría falta ver según el momento de la partida.
        if (room.status === "finished") {
            send(player.ws, "game_over", { scoreboard: scoreboard(room) });
        } else if (room.roundOpen) {
            sendRoundStart(room, player, Math.max(0, RULES.roundMs - (Date.now() - room.startedAt)));
        } else if (room.status === "playing" && room.lastResults) {
            send(player.ws, "round_results", room.lastResults);
        }
    }

    function leaveRoom(player) {
        clearTimeout(player.dropTimer);

        const room = rooms.get(player.room);
        player.room = null;

        if (!room) return;

        room.players = room.players.filter(other => other.id !== player.id);

        if (!room.players.length) {
            clearTimeout(room.timer);
            rooms.delete(room.code);
            return;
        }

        if (room.hostId === player.id) room.hostId = room.players[0].id;

        if (room.status === "playing" && room.players.length < 2) {
            broadcast(room, "error_message", { message: "No quedan jugadores suficientes. Vuelta a la sala." });
            return resetRoom(room);
        }

        if (room.roundOpen) finishIfEveryoneVoted(room);

        broadcastState(room);
    }

    function setPlaylist(room, player, message) {
        if (!room || room.status !== "lobby") return;

        const tracks = cleanTracks(message.tracks);

        if (tracks.length < MIN_TRACKS) {
            return fail(player, `Esa playlist solo tiene ${tracks.length} canciones con portada. Hacen falta ${MIN_TRACKS}.`);
        }

        player.playlist = { id: String(message.playlist?.id || ""), name: String(message.playlist?.name || "").slice(0, 80) };
        player.tracks = tracks;

        broadcastState(room);
    }


    // =====================================================
    // PARTIDA
    // =====================================================

    // Reparte las rondas entre los jugadores de forma equilibrada.
    function buildRounds(room) {
        const rounds = [];
        let pool = [];

        for (let i = 0; i < RULES.rounds; i++) {
            if (!pool.length) pool = shuffle([...room.players]);
            const owner = pool.pop();
            rounds.push({ ownerId: owner.id, tracks: shuffle([...owner.tracks]).slice(0, RULES.coversPerRound) });
        }

        return rounds;
    }

    function startGame(room) {
        if (room.status !== "lobby") return;
        if (room.players.length < 2) return broadcast(room, "error_message", { message: "Hacen falta al menos dos jugadores." });
        if (!room.players.every(isReady)) {
            return broadcast(room, "error_message", { message: "Todos tienen que elegir una playlist antes de empezar." });
        }

        room.status = "playing";
        room.currentRound = 0;
        room.players.forEach(player => { player.score = 0; });
        room.rounds = buildRounds(room);

        startRound(room);
    }

    function startRound(room) {
        room.startedAt = Date.now();
        room.roundOpen = true;
        room.players.forEach(player => { player.answer = null; });
        room.answers = shuffle(room.players.map(({ id, name }) => ({ id, name })));
        room.players.forEach(player => sendRoundStart(room, player, RULES.roundMs));

        clearTimeout(room.timer);
        room.timer = setTimeout(() => finishRound(room), RULES.roundMs);
    }

    function sendRoundStart(room, player, duration) {
        const round = room.rounds[room.currentRound];

        send(player.ws, "round_start", {
            round: room.currentRound + 1,
            totalRounds: RULES.rounds,
            duration,
            tracks: round.tracks,
            answers: room.answers,
            isOwner: player.id === round.ownerId,
            answered: Boolean(player.answer)
        });
    }

    function vote(room, player, ownerId) {
        // Durante el descanso currentRound ya apunta a la siguiente ronda (o a ninguna).
        if (!room.roundOpen || player.answer) return;

        const round = room.rounds[room.currentRound];
        const elapsed = Date.now() - room.startedAt;

        if (player.id === round.ownerId || elapsed > RULES.roundMs || !room.players.some(other => other.id === ownerId)) return;

        player.answer = ownerId;

        const correct = ownerId === round.ownerId;
        // Acertar rápido puntúa más: de 1000 a 500 puntos.
        if (correct) player.score += 500 + Math.round(500 * (RULES.roundMs - elapsed) / RULES.roundMs);

        send(player.ws, "vote_registered", { correct, score: player.score });
        finishIfEveryoneVoted(room);
    }

    function finishIfEveryoneVoted(room) {
        const { ownerId } = room.rounds[room.currentRound];
        if (room.players.every(player => player.id === ownerId || player.answer)) finishRound(room);
    }

    function finishRound(room) {
        if (!room.roundOpen) return;

        room.roundOpen = false;
        clearTimeout(room.timer);

        const round = room.rounds[room.currentRound];
        const owner = room.players.find(player => player.id === round.ownerId);

        room.lastResults = {
            ownerId: round.ownerId,
            ownerName: owner?.name || "Alguien que se fue",
            round: room.currentRound + 1,
            totalRounds: RULES.rounds,
            results: room.players
                .map(player => ({
                    id: player.id,
                    name: player.name,
                    correct: player.answer === round.ownerId,
                    answered: Boolean(player.answer),
                    isOwner: player.id === round.ownerId,
                    score: player.score
                }))
                .sort((a, b) => b.score - a.score)
        };

        broadcast(room, "round_results", room.lastResults);

        room.currentRound++;
        room.timer = setTimeout(
            () => (room.currentRound >= RULES.rounds ? finishGame(room) : startRound(room)),
            RULES.breakMs
        );
    }

    function finishGame(room) {
        room.status = "finished";
        clearTimeout(room.timer);
        broadcast(room, "game_over", { scoreboard: scoreboard(room) });
    }

    function resetRoom(room) {
        clearTimeout(room.timer);

        Object.assign(room, { status: "lobby", roundOpen: false, currentRound: 0, rounds: [], lastResults: null });
        room.players.forEach(player => {
            player.score = 0;
            player.answer = null;
        });

        broadcastState(room);
    }


    // =====================================================
    // CONEXIÓN
    // =====================================================

    function handleMessage(connection, message) {
        const { player } = connection;
        const room = player.room ? rooms.get(player.room) : null;
        const isHost = room?.hostId === player.id;

        switch (message.type) {
            case "create_room": return createRoom(player, message);
            case "join_room": return joinRoom(player, message);
            case "rejoin": return rejoinRoom(connection, message);
            case "set_playlist": return setPlaylist(room, player, message);
            case "start_game": return isHost && startGame(room);
            case "vote": return room && vote(room, player, message.ownerId);
            case "play_again": return isHost && resetRoom(room);
            case "leave_room": return leaveRoom(player);
        }
    }

    // Se conserva al jugador unos segundos: un corte de red o un cambio de pestaña no lo expulsa.
    function handleDisconnect({ ws, player }) {
        if (player.ws !== ws) return; // ya lo sustituyó una reconexión

        player.ws = null;

        const room = player.room && rooms.get(player.room);
        if (!room) return;

        broadcastState(room);
        player.dropTimer = setTimeout(() => leaveRoom(player), RULES.reconnectGraceMs);
    }

    return { createPlayer, handleMessage, handleDisconnect };
}

module.exports = { createRoulette, RULES };
