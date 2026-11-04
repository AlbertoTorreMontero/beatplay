/*
 * Base común de los juegos de fiesta (sala con un anfitrión que pone la música).
 *
 * Idea: solo el anfitrión tiene cuenta y Spotify. Elige una playlist UNA vez, su navegador la
 * carga en el reproductor (sin llamadas) y manda al servidor los datos de las canciones.
 * A partir de ahí el servidor manda: decide qué suena (por posición en esa lista) y qué ve cada
 * jugador. Los invitados solo escriben el código de la sala.
 *
 * Cada juego aporta un "spec":
 *   id, rules, minPlayers, minSongs, lateJoin (false = no se entra a mitad de partida)
 *   accept(song, room)            canciones válidas para el juego (p. ej. con año)
 *   player()                      estado inicial de cada jugador en la partida
 *   start(api)                    empieza la partida
 *   act(api, player, action, msg) acciones de los jugadores durante la partida
 *   view(api, player)             lo que ve ese jugador ahora (datos simples, sin el pool entero)
 *   leave(api, player)            opcional: un jugador se ha ido a mitad de partida
 *   lobbyAct(api, player, action, msg)  opcional: acciones en la sala de espera
 *   resume(api, player)           opcional: reenviar a quien vuelve lo que no va en la vista (p. ej. dibujos)
 *   finalView(api, player)        opcional: datos extra en la pantalla final
 *   roomState(room)               opcional: campos extra para room_state
 *
 * Mensajes al cliente (además de los propios de cada juego):
 *   view     { phase, round, rounds, remaining, total, ...spec.view }   pantalla de cada jugador
 *   catalog  { songs: [{ name, artist, cover }] }   títulos para buscadores y opciones (por posición)
 *   music    { action: play|clip|pause|resume, index, ms }   solo al anfitrión: qué hacer con el audio
 */
const { shuffle } = require("../../utils");

const MAX_POOL = 200;

const normalize = text => String(text || "").normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase()
    .replace(/\s*[([].*?[)\]]\s*/g, " ") // "(Remastered 2011)", "[Live]"
    .replace(/\s+-\s+.*$/, "")            // "Song - Radio Edit"
    .replace(/[^a-z0-9ñ ]/g, "")
    .replace(/\s+/g, " ")
    .trim();

const randomInt = (min, max) => min + Math.floor(Math.random() * (max - min + 1));

function createPartyGame(spec, { coverHosts = [] } = {}) {

    const minPlayers = spec.minPlayers || 2;
    const minSongs = spec.minSongs || 5;
    const accept = spec.accept || (() => true);

    const isAllowedCover = url => {
        try {
            const { protocol, host } = new URL(url);
            return protocol === "https:" && coverHosts.some(allowed => host === allowed || host.endsWith(`.${allowed}`));
        } catch {
            return false;
        }
    };

    // Se conserva la posición de cada canción: el anfitrión reproduce por posición en su lista.
    const cleanSong = track => {
        if (!track || typeof track !== "object" || !track.id) return null;
        const year = parseInt(track.year, 10);
        const duration = parseInt(track.duration, 10);
        return {
            id: String(track.id).slice(0, 60),
            name: String(track.name || "").slice(0, 120),
            artist: String(track.artist || "").slice(0, 120),
            album: String(track.album || "").slice(0, 120),
            year: year > 1800 && year < 2200 ? year : null,
            duration: duration > 0 && duration < 3600000 ? duration : null,
            cover: isAllowedCover(track.cover) ? String(track.cover).slice(0, 300) : null
        };
    };

    const validSongs = room => room.pool.filter(song => song && accept(song, room)).length;


    // =====================================================
    // API QUE RECIBEN LOS JUEGOS
    // =====================================================

    function makeApi(ctx, room) {

        const api = {
            room,
            ctx,
            rules: spec.rules || {},
            get g() { return room.g; },

            players: () => room.players,
            active: () => room.players.filter(player => player.ws),
            byId: id => room.players.find(player => player.id === id),
            host: () => room.players.find(player => player.id === room.hostId),
            song: index => room.pool[index],
            nameOf: id => room.players.find(player => player.id === id)?.name || "Alguien",

            // Estado de la partida de un jugador (se crea al vuelo para quien entra tarde).
            me(player) {
                if (!room.g.p[player.id]) room.g.p[player.id] = { gained: 0, ...(spec.player?.(api, player) || {}) };
                return room.g.p[player.id];
            },

            send: (player, type, data) => ctx.send(player.ws, type, data),
            fail: (player, message) => ctx.fail(player, message),

            // ---- Pantallas

            view(player) {
                return {
                    phase: room.phase,
                    round: room.g.round,
                    rounds: room.g.rounds,
                    remaining: room.phaseEnds ? Math.max(0, room.phaseEnds - Date.now()) : 0,
                    total: room.phaseMs,
                    ...(room.phase === "final"
                        ? { scoreboard: api.scoreboard(), winners: room.g.winners || null, ...(spec.finalView?.(api, player) || {}) }
                        : spec.view(api, player))
                };
            },

            sync() {
                room.players.forEach(player => ctx.send(player.ws, "view", api.view(player)));
                ctx.broadcastState(room);
            },

            // Solo a un jugador: para respuestas privadas que no deben dar pistas al resto.
            syncPlayer: player => ctx.send(player.ws, "view", api.view(player)),

            // Cambia de fase. Con ms y next, pasa sola a la siguiente al acabar el tiempo.
            phase(name, ms = 0, next = null) {
                clearTimers(room);
                room.phase = name;
                room.phaseMs = ms;
                room.phaseEnds = ms ? Date.now() + ms : 0;
                room.next = next;
                if (ms && next) room.timer = setTimeout(() => api.advance(), ms);
                api.sync();
            },

            // Ejecuta ya lo que tocaba al acabar la fase (todos han respondido, o el anfitrión salta).
            advance() {
                const next = room.next;
                if (room.status !== "playing" || !next) return;
                room.next = null;
                clearTimers(room);
                next(makeApi(ctx, room));
            },

            // Temporizador extra dentro de la fase (se cancela al cambiar de fase).
            after(ms, fn) {
                const id = setTimeout(() => {
                    if (room.status === "playing") fn(makeApi(ctx, room));
                }, ms);
                room.timers.push(id);
                return id;
            },

            // ---- Audio (solo lo ejecuta el navegador del anfitrión)

            music(action, data = {}) {
                // Pausar lo ya pausado no hace nada… salvo gastar una llamada a la API en Spotify Connect.
                if (action === "pause" && (!room.music || room.music.action === "pause")) return;
                room.music = { action, ...data };
                ctx.send(api.host()?.ws, "music", room.music);
            },

            // ---- Canciones

            // n canciones al azar que aún no hayan salido (si se acaban, se vuelven a usar).
            pick(n = 1, filter = () => true) {
                const fits = index => room.pool[index] && accept(room.pool[index], room) && filter(room.pool[index], index);
                let candidates = room.pool.map((_, index) => index).filter(index => fits(index) && !room.used.has(index));
                if (candidates.length < n) {
                    room.used.clear();
                    candidates = room.pool.map((_, index) => index).filter(fits);
                }
                const chosen = shuffle(candidates).slice(0, n);
                chosen.forEach(index => room.used.add(index));
                return chosen;
            },

            // Opciones para una pregunta: la correcta y n-1 distintas según `key` ("name" o "artist").
            options(correct, n = 4, key = "name") {
                const truth = room.pool[correct];
                const seen = new Set([normalize(truth[key])]);
                const others = [];
                for (const index of shuffle(room.pool.map((_, i) => i))) {
                    const song = room.pool[index];
                    if (!song || index === correct) continue;
                    const value = normalize(song[key]);
                    if (!value || seen.has(value)) continue;
                    seen.add(value);
                    others.push(index);
                    if (others.length === n - 1) break;
                }
                return shuffle([correct, ...others]);
            },

            same: (a, b, key = "name") => normalize(room.pool[a]?.[key]) === normalize(room.pool[b]?.[key]),

            // ---- Puntos

            award(player, points) {
                points = Math.round(points);
                player.score += points;
                api.me(player).gained += points;
                return points;
            },

            newRound() {
                room.g.round++;
                Object.values(room.g.p).forEach(state => { state.gained = 0; });
            },

            scoreboard: () => room.players
                .map(player => ({ id: player.id, name: player.name, score: player.score, gained: room.g.p[player.id]?.gained || 0 }))
                .sort((a, b) => b.score - a.score),

            // ¿Todos los conectados cumplen la condición? (para cerrar una fase antes de tiempo)
            everyone(test, among = api.active()) {
                return among.length > 0 && among.every(player => test(api.me(player), player));
            },

            finish(winners = null) {
                room.g.winners = winners;
                room.status = "finished";
                api.music("pause");
                api.phase("final");
            },

            normalize,
            randomInt,
            shuffle
        };

        return api;
    }

    function clearTimers(room) {
        clearTimeout(room.timer);
        room.timers.forEach(clearTimeout);
        room.timers = [];
    }

    const freshGame = () => ({ round: 0, rounds: 0, p: {}, winners: null });


    // =====================================================
    // MENSAJES COMUNES
    // =====================================================

    function setPool(ctx, room, player, message) {
        if (room.status !== "lobby") return;

        const tracks = Array.isArray(message.tracks) ? message.tracks.slice(0, MAX_POOL) : [];
        room.pool = tracks.map(cleanSong);
        room.playlistName = String(message.playlistName || "").slice(0, 80);

        const valid = validSongs(room);
        if (valid < minSongs) {
            ctx.fail(player, `Esa playlist solo tiene ${valid} canciones válidas para este juego. Hacen falta ${minSongs}.`);
        }
        ctx.broadcastState(room);
    }

    function startGame(ctx, room, player) {
        if (room.status !== "lobby") return;
        if (validSongs(room) < minSongs) return ctx.fail(player, "Elige antes una playlist con suficientes canciones.");
        if (room.players.length < minPlayers) return ctx.fail(player, `Hacen falta al menos ${minPlayers} jugadores.`);

        clearTimers(room);
        room.status = "playing";
        room.g = freshGame();
        room.used = new Set();
        room.players.forEach(other => { other.score = 0; });

        sendCatalog(ctx, room);
        spec.start(makeApi(ctx, room));
    }

    // Títulos, artistas y portadas, por posición. Nunca año ni disco: son respuestas de algunos juegos.
    function sendCatalog(ctx, room, only = null) {
        const songs = room.pool.map(song => song ? { name: song.name, artist: song.artist, cover: song.cover } : null);
        (only ? [only] : room.players).forEach(player => ctx.send(player.ws, "catalog", { songs }));
    }


    // =====================================================
    // INTERFAZ PARA EL HUB
    // =====================================================

    return {
        maxPlayers: spec.maxPlayers || 16,

        canJoin: room => room.status !== "lobby" && spec.lateJoin === false
            ? "La partida ya ha empezado. Espera a que acabe y vuelve a entrar."
            : null,

        setup(room) {
            Object.assign(room, { pool: [], playlistName: "", g: freshGame(), used: new Set(), phase: "lobby", phaseEnds: 0, phaseMs: 0, next: null, timers: [], music: null });
        },

        roomState: room => ({
            songs: validSongs(room),
            playlistName: room.playlistName,
            minPlayers,
            minSongs,
            ...(spec.roomState?.(room) || {})
        }),

        playerState: (room, player) => spec.playerState?.(room, player) || {},

        onMessage(ctx, room, player, message, isHost) {
            const api = makeApi(ctx, room);
            switch (message.type) {
                case "set_pool": return isHost && setPool(ctx, room, player, message);
                case "start_game": return isHost && startGame(ctx, room, player);
                case "skip": return isHost && room.status === "playing" && api.advance();
                case "act":
                    if (room.status === "playing") return spec.act(api, player, String(message.action || ""), message);
                    if (room.status === "lobby") return spec.lobbyAct?.(api, player, String(message.action || ""), message);
            }
        },

        onLeave(ctx, room, player, wasHost) {
            if (room.status !== "playing") return;

            // Sin anfitrión no hay música: vuelta a la sala.
            if (wasHost) {
                ctx.broadcast(room, "error_message", { message: "Se ha ido quien ponía la música. Vuelta a la sala." });
                room.pool = [];
                return ctx.resetRoom(room);
            }

            spec.leave?.(makeApi(ctx, room), player);
        },

        resume(ctx, room, player) {
            if (room.status === "lobby") return;
            const api = makeApi(ctx, room);
            sendCatalog(ctx, room, player);
            spec.resume?.(api, player); // antes que la vista: la pantalla puede necesitarlo
            api.syncPlayer(player);
            // El anfitrión que vuelve recupera la canción que tocaba.
            if (player.id === room.hostId && room.music?.action === "play") ctx.send(player.ws, "music", room.music);
        },

        reset(room) {
            clearTimers(room);
            Object.assign(room, { g: freshGame(), phase: "lobby", phaseEnds: 0, phaseMs: 0, next: null, music: null });
        }
    };
}

module.exports = { createPartyGame, normalize, randomInt };
