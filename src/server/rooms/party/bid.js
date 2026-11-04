/*
 * PUJA JUSTA — como en El precio justo, pero con canciones.
 * Suena una canción y todos pujan en secreto. Gana quien más se acerca SIN PASARSE.
 * Antes de empezar, el anfitrión elige a qué se puja:
 *   año       ¿en qué año salió?
 *   duración  ¿cuánto dura? (minutos y segundos)
 * Clavarlo da premio extra. Si todos se pasan, gana quien menos se pasó, pero solo la mitad.
 *
 * Audio: una canción por ronda. Las canciones vienen con año y duración (una sola lectura de la playlist).
 */
const { createPartyGame } = require("./kit");

const RULES = { rounds: 8, guessMs: 25000, revealMs: 7000, winPoints: 300, exactBonus: 200, minDuration: 30, maxDuration: 600 };

const MODES = ["year", "duration"];
const modeOf = room => (MODES.includes(room.mode) ? room.mode : "year");

// Lo que hay que adivinar de una canción: el año, o la duración en segundos.
const target = (song, mode) => (mode === "year" ? song.year : song.duration ? Math.round(song.duration / 1000) : null);

const spec = {
    id: "bid",
    rules: RULES,
    minPlayers: 2,
    minSongs: 8,

    accept: (song, room) => target(song, modeOf(room)) != null,

    player: () => ({ bid: null }),

    roomState: room => ({ mode: modeOf(room) }),

    // El anfitrión elige el modo en la sala de espera.
    lobbyAct(api, player, action, message) {
        if (action !== "mode" || player.id !== api.room.hostId || !MODES.includes(message.mode)) return;
        api.room.mode = message.mode;
        api.ctx.broadcastState(api.room);
    },

    start(api) {
        const g = api.g;
        g.rounds = RULES.rounds;
        g.mode = modeOf(api.room);

        if (g.mode === "year") {
            const years = api.room.pool.filter(song => song?.year).map(song => song.year);
            g.range = [Math.min(1950, Math.floor(Math.min(...years) / 10) * 10), new Date().getFullYear()];
        } else {
            g.range = [RULES.minDuration, RULES.maxDuration];
        }
        nextRound(api);
    },

    act(api, player, action, message) {
        if (action !== "bid" || api.room.phase !== "guess") return;
        const value = Number(message.value);
        const [min, max] = api.g.range;
        if (!Number.isInteger(value) || value < min || value > max) return;

        api.me(player).bid = value;
        api.sync();
        if (api.everyone(state => state.bid != null)) api.after(600, next => next.advance());
    },

    view(api, player) {
        const g = api.g;
        const base = { mode: g.mode, range: g.range };
        if (api.room.phase === "guess") {
            return {
                ...base,
                bid: api.me(player).bid,
                ready: api.players().filter(other => api.me(other).bid != null).length,
                total: api.players().length
            };
        }
        if (api.room.phase === "reveal") return { ...base, ...g.result, scoreboard: api.scoreboard() };
        return base;
    }
};

function nextRound(api) {
    const g = api.g;
    if (g.round >= g.rounds) return api.finish();

    api.newRound();
    api.players().forEach(player => { api.me(player).bid = null; });
    g.song = api.pick(1)[0];
    g.result = null;

    api.music("play", { index: g.song });
    api.phase("guess", RULES.guessMs, reveal);
}

function reveal(api) {
    const g = api.g;
    const answer = target(api.song(g.song), g.mode);

    const bids = api.players()
        .map(player => ({ player, bid: api.me(player).bid }))
        .filter(entry => entry.bid != null)
        .map(entry => ({ ...entry, diff: answer - entry.bid, over: entry.bid > answer }));

    // El más cercano sin pasarse. Si todos se pasan, el que menos (a mitad de premio).
    const under = bids.filter(entry => !entry.over);
    const pool = under.length ? under : bids;
    const best = pool.length ? Math.min(...pool.map(entry => Math.abs(entry.diff))) : null;
    const winners = pool.filter(entry => Math.abs(entry.diff) === best);

    winners.forEach(entry => {
        let points = under.length ? RULES.winPoints : RULES.winPoints / 2;
        if (entry.diff === 0) points += RULES.exactBonus;
        entry.points = api.award(entry.player, points);
    });

    g.result = {
        song: g.song,
        answer,
        allOver: bids.length > 0 && !under.length,
        bids: bids
            .map(entry => ({ id: entry.player.id, name: entry.player.name, bid: entry.bid, diff: entry.diff, over: entry.over, points: entry.points || 0, winner: winners.includes(entry) }))
            .sort((a, b) => Number(b.winner) - Number(a.winner) || Number(a.over) - Number(b.over) || Math.abs(a.diff) - Math.abs(b.diff))
    };

    api.phase("reveal", RULES.revealMs, nextRound);
}

module.exports = { createBid: options => createPartyGame(spec, options), BID_RULES: RULES };
