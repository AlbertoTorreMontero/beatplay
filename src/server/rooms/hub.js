/*
 * Salas multijugador en memoria, comunes a todos los juegos online.
 * Aquí vive lo que comparten: códigos, entrar, salir, reconexión y anfitrión.
 * Cada juego (roulette.js, buzzer.js) solo aporta sus reglas.
 *
 * Un juego expone:
 *   maxPlayers
 *   canJoin(room)                    -> texto de error o null
 *   setup(room)                      prepara sus campos al crear la sala
 *   roomState(room)                  campos extra para room_state
 *   playerState(room, player)        campos extra por jugador en room_state
 *   onMessage(ctx, room, player, message, isHost)
 *   onLeave(ctx, room, player)       tras sacar a un jugador
 *   resume(ctx, room, player)        reenvía a quien vuelve lo que le toca ver
 *   reset(room)                      vuelve a la sala de espera
 */
const crypto = require("crypto");
const { WebSocket } = require("ws");

const RECONNECT_GRACE_MS = 30000;

// Sin 0/O/1/I: el código se dicta y se escribe desde el móvil.
const CODE_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";

function createHub(games) {

    const rooms = new Map();


    // ---- Envío

    function send(ws, type, data = {}) {
        if (ws?.readyState === WebSocket.OPEN) ws.send(JSON.stringify({ type, ...data }));
    }

    const broadcast = (room, type, data) => room.players.forEach(player => send(player.ws, type, data));
    const fail = (player, message) => send(player.ws, "error_message", { message });

    function broadcastState(room) {
        const game = games[room.game];
        broadcast(room, "room_state", {
            game: room.game,
            code: room.code,
            hostId: room.hostId,
            status: room.status,
            maxPlayers: game.maxPlayers,
            ...game.roomState(room),
            players: room.players.map(player => ({
                id: player.id,
                name: player.name,
                connected: Boolean(player.ws),
                score: player.score,
                ...game.playerState(room, player)
            }))
        });
    }

    const ctx = { send, broadcast, broadcastState, fail };


    // ---- Jugadores y salas

    function createPlayer(ws) {
        return {
            ws,
            id: crypto.randomBytes(4).toString("hex"),
            token: crypto.randomBytes(12).toString("hex"), // identifica al jugador al reconectar
            name: "Jugador",
            room: null,
            score: 0,
            dropTimer: null
        };
    }

    const cleanName = value => String(value || "").trim().slice(0, 20) || "Jugador";

    function uniqueName(room, name) {
        const taken = new Set(room.players.map(player => player.name));
        let candidate = name;
        for (let n = 2; taken.has(candidate); n++) candidate = `${name} ${n}`;
        return candidate;
    }

    function newCode() {
        let code;
        do {
            code = Array.from({ length: 5 }, () => CODE_ALPHABET[crypto.randomInt(CODE_ALPHABET.length)]).join("");
        } while (rooms.has(code));
        return code;
    }

    const joined = (player, room, extra = {}) =>
        send(player.ws, "joined", { code: room.code, game: room.game, playerId: player.id, token: player.token, ...extra });

    function createRoom(player, message) {
        if (!games[message.game]) return fail(player, "Ese juego no existe.");
        if (player.room) leaveRoom(player);

        const room = { code: newCode(), game: message.game, hostId: player.id, players: [player], status: "lobby", timer: null };
        games[room.game].setup(room);

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

        const game = games[room.game];
        const problem = room.players.length >= game.maxPlayers ? "La sala está completa." : game.canJoin(room);
        if (problem) return fail(player, problem);

        if (player.room) leaveRoom(player);

        player.name = uniqueName(room, cleanName(message.name));
        player.room = code;
        room.players.push(player);

        joined(player, room);
        broadcastState(room);
        if (room.status !== "lobby") games[room.game].resume(ctx, room, player);
    }

    // Un móvil que bloquea la pantalla pierde el socket: al volver recupera su sitio.
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
        games[room.game].resume(ctx, room, player);
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

        const wasHost = room.hostId === player.id;
        if (wasHost) room.hostId = room.players[0].id;

        games[room.game].onLeave(ctx, room, player, wasHost);
        broadcastState(room);
    }

    function resetRoom(room) {
        clearTimeout(room.timer);
        room.status = "lobby";
        room.players.forEach(player => { player.score = 0; });
        games[room.game].reset(room);
        broadcastState(room);
    }

    ctx.resetRoom = resetRoom;


    // ---- Conexión

    function handleMessage(connection, message) {
        const { player } = connection;
        const room = player.room ? rooms.get(player.room) : null;
        const isHost = room?.hostId === player.id;

        switch (message.type) {
            case "create_room": return createRoom(player, message);
            case "join_room": return joinRoom(player, message);
            case "rejoin": return rejoinRoom(connection, message);
            case "leave_room": return leaveRoom(player);
            case "play_again": return isHost && resetRoom(room);
            default: return room && games[room.game].onMessage(ctx, room, player, message, isHost);
        }
    }

    // Se conserva al jugador unos segundos: un corte de red o un cambio de pestaña no lo expulsa.
    function handleDisconnect({ ws, player }) {
        if (player.ws !== ws) return; // ya lo sustituyó una reconexión

        player.ws = null;

        const room = player.room && rooms.get(player.room);
        if (!room) return;

        broadcastState(room);
        player.dropTimer = setTimeout(() => leaveRoom(player), RECONNECT_GRACE_MS);
    }

    // Para el enlace de invitación: a qué juego pertenece una sala.
    const gameOf = code => rooms.get(String(code || "").toUpperCase())?.game || null;

    return { createPlayer, handleMessage, handleDisconnect, gameOf };
}

module.exports = { createHub };
