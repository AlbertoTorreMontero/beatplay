// Pulsador: suena una canción en el móvil del anfitrión y todos intentan adivinarla.
// Hasta 60 s por canción. Quien acierta antes se lleva más puntos. Fallar no resta: se puede
// volver a intentar o pasar.
const RULES = { rounds: 10, roundMs: 60000, breakMs: 6000, maxChoices: 200 };

function createBuzzer({ coverHosts }) {

    const isAllowedCover = url => {
        try {
            const { protocol, host } = new URL(url);
            return protocol === "https:" && coverHosts.some(allowed => host === allowed || host.endsWith(`.${allowed}`));
        } catch {
            return false;
        }
    };

    const clean = track => ({
        id: String(track.id).slice(0, 60),
        name: String(track.name || "").slice(0, 120),
        artist: String(track.artist || "").slice(0, 120),
        cover: isAllowedCover(track.cover) ? String(track.cover).slice(0, 300) : null
    });

    const scoreboard = room => room.players
        .map(({ id, name, score }) => ({ id, name, score }))
        .sort((a, b) => b.score - a.score);

    const current = room => room.choices.find(track => track.id === room.order[room.round]);


    // ---- Preparación (anfitrión)

    // El anfitrión manda las opciones (las canciones de su playlist) y el orden en que sonarán.
    function setSongs(ctx, room, message) {
        if (room.status !== "lobby") return;

        const choices = (Array.isArray(message.choices) ? message.choices : []).filter(track => track?.id).slice(0, RULES.maxChoices).map(clean);
        const ids = new Set(choices.map(track => track.id));
        const order = (Array.isArray(message.order) ? message.order : []).map(String).filter(id => ids.has(id)).slice(0, RULES.rounds);

        if (order.length < 3) return ctx.fail(room.players.find(player => player.id === room.hostId), "Esa playlist es demasiado corta: hacen falta al menos 3 canciones.");

        Object.assign(room, { choices, order, playlistName: String(message.playlistName || "").slice(0, 80) });
        ctx.broadcastState(room);
    }

    function startGame(ctx, room) {
        if (room.status !== "lobby" || !room.order.length) return;
        room.status = "playing";
        room.round = 0;
        room.players.forEach(player => { player.score = 0; });
        startRound(ctx, room);
    }


    // ---- Rondas

    function startRound(ctx, room) {
        clearTimeout(room.timer);
        room.startedAt = Date.now();
        room.roundOpen = true;
        room.players.forEach(player => Object.assign(player, { solved: false, passed: false, points: 0, timeMs: null }));

        room.players.forEach(player => sendRoundStart(ctx, room, player, RULES.roundMs));
        ctx.broadcastState(room);
        room.timer = setTimeout(() => finishRound(ctx, room), RULES.roundMs);
    }

    function sendRoundStart(ctx, room, player, duration) {
        ctx.send(player.ws, "round_start", {
            round: room.round + 1,
            totalRounds: room.order.length,
            index: room.round, // posición en la lista del anfitrión: su móvil reproduce esa canción
            duration,
            choices: room.choices.map(({ id, name, artist }) => ({ id, name, artist })),
            solved: Boolean(player.solved),
            passed: Boolean(player.passed)
        });
    }

    function guess(ctx, room, player, trackId) {
        if (!room.roundOpen || player.solved || player.passed) return;

        const elapsed = Date.now() - room.startedAt;
        if (elapsed > RULES.roundMs) return;

        if (String(trackId) !== room.order[room.round]) {
            return ctx.send(player.ws, "guess_result", { correct: false });
        }

        // Más rápido, más puntos: de 1000 al instante a 100 al final del minuto.
        player.points = Math.max(100, Math.round(1000 * (1 - elapsed / RULES.roundMs)));
        player.score += player.points;
        player.solved = true;
        player.timeMs = elapsed;

        ctx.send(player.ws, "guess_result", { correct: true, points: player.points, score: player.score });
        ctx.broadcastState(room);
        finishIfDone(ctx, room);
    }

    function pass(ctx, room, player) {
        if (!room.roundOpen || player.solved || player.passed) return;
        player.passed = true;
        ctx.broadcastState(room);
        finishIfDone(ctx, room);
    }

    // Termina en cuanto todos los conectados han acertado o pasado.
    function finishIfDone(ctx, room) {
        const active = room.players.filter(player => player.ws);
        if (active.length && active.every(player => player.solved || player.passed)) finishRound(ctx, room);
    }

    function finishRound(ctx, room) {
        if (!room.roundOpen) return;
        room.roundOpen = false;
        clearTimeout(room.timer);

        const { name, artist, cover } = current(room);

        room.lastResults = {
            round: room.round + 1,
            totalRounds: room.order.length,
            track: { name, artist, cover },
            results: room.players
                .map(({ id, name: playerName, solved, points, timeMs, score }) => ({ id, name: playerName, solved, points, timeMs, score }))
                .sort((a, b) => b.score - a.score)
        };

        ctx.broadcast(room, "round_results", room.lastResults);
        ctx.broadcastState(room);

        room.round++;
        room.timer = setTimeout(() => nextRound(ctx, room), RULES.breakMs);
    }

    function nextRound(ctx, room) {
        if (room.status !== "playing" || room.roundOpen) return;
        if (room.round >= room.order.length) return finishGame(ctx, room);
        startRound(ctx, room);
    }

    function finishGame(ctx, room) {
        room.status = "finished";
        clearTimeout(room.timer);
        ctx.broadcast(room, "game_over", { scoreboard: scoreboard(room) });
        ctx.broadcastState(room);
    }


    // ---- Interfaz para el hub

    return {
        maxPlayers: 20,

        // Se puede entrar a mitad de partida: empieza con 0 puntos.
        canJoin: () => null,

        setup(room) {
            Object.assign(room, { choices: [], order: [], playlistName: "", round: 0, roundOpen: false, startedAt: 0, lastResults: null });
        },

        roomState: room => ({ songs: room.order.length, playlistName: room.playlistName }),
        playerState: (room, player) => ({ solved: Boolean(player.solved), passed: Boolean(player.passed) }),

        onMessage(ctx, room, player, message, isHost) {
            switch (message.type) {
                case "set_songs": return isHost && setSongs(ctx, room, message);
                case "start_game": return isHost && startGame(ctx, room);
                case "next": return isHost && nextRound(ctx, room); // saltar la pausa entre canciones
                case "guess": return guess(ctx, room, player, message.trackId);
                case "pass": return pass(ctx, room, player);
            }
        },

        // Sin anfitrión no hay música: la partida vuelve a la sala.
        onLeave(ctx, room, player, wasHost) {
            if (wasHost && room.status === "playing") {
                ctx.broadcast(room, "error_message", { message: "Se ha ido quien ponía la música. Vuelta a la sala." });
                room.order = [];
                return ctx.resetRoom(room);
            }
            if (room.roundOpen) finishIfDone(ctx, room);
        },

        resume(ctx, room, player) {
            if (room.status === "finished") ctx.send(player.ws, "game_over", { scoreboard: scoreboard(room) });
            else if (room.roundOpen) sendRoundStart(ctx, room, player, Math.max(0, RULES.roundMs - (Date.now() - room.startedAt)));
            else if (room.status === "playing" && room.lastResults) ctx.send(player.ws, "round_results", room.lastResults);
        },

        reset(room) {
            Object.assign(room, { round: 0, roundOpen: false, lastResults: null });
            room.players.forEach(player => Object.assign(player, { solved: false, passed: false }));
        }
    };
}

module.exports = { createBuzzer, BUZZER_RULES: RULES };
