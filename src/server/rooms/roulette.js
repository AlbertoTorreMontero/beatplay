// Music Roulette: cinco portadas de la playlist de alguien; adivina de quién es.
// Cada jugador manda portada, título y artista de su playlist; nadie ve de quién es cada una.
const { shuffle } = require("../utils");

const RULES = { rounds: 5, coversPerRound: 5, roundMs: 15000, breakMs: 5000 };
const MIN_TRACKS = RULES.coversPerRound;

function createRoulette({ coverHosts }) {

    const isReady = player => Boolean(player.playlist) && player.tracks?.length >= MIN_TRACKS;

    // Las portadas se cargan en el navegador de los demás: solo se aceptan las del CDN del proveedor.
    function isAllowedCover(url) {
        try {
            const { protocol, host } = new URL(url);
            return protocol === "https:" && coverHosts.some(allowed => host === allowed || host.endsWith(`.${allowed}`));
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

    const scoreboard = room => room.players
        .map(({ id, name, score }) => ({ id, name, score }))
        .sort((a, b) => b.score - a.score);


    // ---- Partida

    function setPlaylist(ctx, room, player, message) {
        if (room.status !== "lobby") return;

        const tracks = cleanTracks(message.tracks);
        if (tracks.length < MIN_TRACKS) {
            return ctx.fail(player, `Esa playlist solo tiene ${tracks.length} canciones con portada. Hacen falta ${MIN_TRACKS}.`);
        }

        player.playlist = { id: String(message.playlist?.id || ""), name: String(message.playlist?.name || "").slice(0, 80) };
        player.tracks = tracks;
        ctx.broadcastState(room);
    }

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

    function startGame(ctx, room) {
        if (room.status !== "lobby") return;
        if (room.players.length < 2) return ctx.broadcast(room, "error_message", { message: "Hacen falta al menos dos jugadores." });
        if (!room.players.every(isReady)) {
            return ctx.broadcast(room, "error_message", { message: "Todos tienen que elegir una playlist antes de empezar." });
        }

        room.status = "playing";
        room.currentRound = 0;
        room.players.forEach(player => { player.score = 0; });
        room.rounds = buildRounds(room);

        startRound(ctx, room);
    }

    function startRound(ctx, room) {
        room.startedAt = Date.now();
        room.roundOpen = true;
        room.players.forEach(player => { player.answer = null; });
        room.answers = shuffle(room.players.map(({ id, name }) => ({ id, name })));
        room.players.forEach(player => sendRoundStart(ctx, room, player, RULES.roundMs));

        clearTimeout(room.timer);
        room.timer = setTimeout(() => finishRound(ctx, room), RULES.roundMs);
    }

    function sendRoundStart(ctx, room, player, duration) {
        const round = room.rounds[room.currentRound];
        ctx.send(player.ws, "round_start", {
            round: room.currentRound + 1,
            totalRounds: RULES.rounds,
            duration,
            tracks: round.tracks,
            answers: room.answers,
            isOwner: player.id === round.ownerId,
            answered: Boolean(player.answer)
        });
    }

    function vote(ctx, room, player, ownerId) {
        // Durante el descanso currentRound ya apunta a la siguiente ronda (o a ninguna).
        if (!room.roundOpen || player.answer) return;

        const round = room.rounds[room.currentRound];
        const elapsed = Date.now() - room.startedAt;

        if (player.id === round.ownerId || elapsed > RULES.roundMs || !room.players.some(other => other.id === ownerId)) return;

        player.answer = ownerId;

        const correct = ownerId === round.ownerId;
        // Acertar rápido puntúa más: de 1000 a 500 puntos.
        if (correct) player.score += 500 + Math.round(500 * (RULES.roundMs - elapsed) / RULES.roundMs);

        ctx.send(player.ws, "vote_registered", { correct, score: player.score });
        finishIfEveryoneVoted(ctx, room);
    }

    function finishIfEveryoneVoted(ctx, room) {
        const { ownerId } = room.rounds[room.currentRound];
        if (room.players.every(player => player.id === ownerId || player.answer)) finishRound(ctx, room);
    }

    function finishRound(ctx, room) {
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

        ctx.broadcast(room, "round_results", room.lastResults);

        room.currentRound++;
        room.timer = setTimeout(
            () => (room.currentRound >= RULES.rounds ? finishGame(ctx, room) : startRound(ctx, room)),
            RULES.breakMs
        );
    }

    function finishGame(ctx, room) {
        room.status = "finished";
        clearTimeout(room.timer);
        ctx.broadcast(room, "game_over", { scoreboard: scoreboard(room) });
    }


    // ---- Interfaz para el hub

    return {
        maxPlayers: 10,

        canJoin: room => (room.status !== "lobby" ? "Esa partida ya ha empezado." : null),

        setup(room) {
            Object.assign(room, { rounds: [], currentRound: 0, roundOpen: false, startedAt: 0, answers: [], lastResults: null });
        },

        // No se envía la playlist de cada jugador: delataría de quién es la música.
        roomState: () => ({ minTracks: MIN_TRACKS }),
        playerState: (room, player) => ({ ready: isReady(player) }),

        onMessage(ctx, room, player, message, isHost) {
            switch (message.type) {
                case "set_playlist": return setPlaylist(ctx, room, player, message);
                case "start_game": return isHost && startGame(ctx, room);
                case "vote": return vote(ctx, room, player, message.ownerId);
            }
        },

        onLeave(ctx, room) {
            if (room.status === "playing" && room.players.length < 2) {
                ctx.broadcast(room, "error_message", { message: "No quedan jugadores suficientes. Vuelta a la sala." });
                return ctx.resetRoom(room);
            }
            if (room.roundOpen) finishIfEveryoneVoted(ctx, room);
        },

        resume(ctx, room, player) {
            if (room.status === "finished") ctx.send(player.ws, "game_over", { scoreboard: scoreboard(room) });
            else if (room.roundOpen) sendRoundStart(ctx, room, player, Math.max(0, RULES.roundMs - (Date.now() - room.startedAt)));
            else if (room.status === "playing" && room.lastResults) ctx.send(player.ws, "round_results", room.lastResults);
        },

        reset(room) {
            Object.assign(room, { roundOpen: false, currentRound: 0, rounds: [], lastResults: null });
            room.players.forEach(player => { player.answer = null; });
        }
    };
}

module.exports = { createRoulette };
