/*
 * SIGUE CANTANDO — el karaoke sin red.
 * Cada ronda le toca a alguien estar en el foco. Suena una canción y, de repente, se corta:
 * quien está en el foco tiene que seguir cantándola (letra o tarareo) donde se quedó.
 * Luego la música vuelve justo donde se cortó y los demás votan si lo clavó o no.
 * El cantante gana según los votos; quien vota lo mismo que la mayoría también suma.
 *
 * Audio: una canción por ronda, una pausa y una reanudación (vuelve al mismo punto).
 */
const { createPartyGame } = require("./kit");

const RULES = { minRounds: 4, maxRounds: 10, listenMinMs: 15000, listenMaxMs: 35000, singMs: 12000, voteMs: 14000, revealMs: 6000, singerPoints: 400, majorityPoints: 50 };

const spec = {
    id: "karaoke",
    rules: RULES,
    minPlayers: 2,
    minSongs: 5,

    player: () => ({ vote: null, sung: 0 }),

    start(api) {
        const count = api.players().length;
        // Al menos una vez cada uno; con pocos jugadores, dos vueltas.
        api.g.rounds = Math.min(RULES.maxRounds, count < RULES.minRounds ? count * 2 : count);
        nextRound(api);
    },

    act(api, player, action, message) {
        const g = api.g;
        if (action !== "vote" || api.room.phase !== "vote" || player.id === g.singer) return;
        api.me(player).vote = Boolean(message.ok);
        api.sync();
        const voters = api.active().filter(other => other.id !== g.singer);
        if (api.everyone(state => state.vote != null, voters)) api.after(800, next => next.advance());
    },

    view(api, player) {
        const g = api.g;
        const base = { singerId: g.singer, singer: api.nameOf(g.singer), you: player.id === g.singer };
        const phase = api.room.phase;

        if (phase === "vote") {
            const voters = api.players().filter(other => other.id !== g.singer);
            return { ...base, vote: api.me(player).vote, votes: voters.filter(other => api.me(other).vote != null).length, voters: voters.length };
        }
        if (phase === "reveal") return { ...base, ...g.result, scoreboard: api.scoreboard() };
        return base;
    },

    // Si se va quien canta, la ronda se acaba sin puntos.
    leave(api, player) {
        if (player.id === api.g.singer && ["listen", "sing", "vote"].includes(api.room.phase)) nextRound(api);
    }
};

function nextRound(api) {
    const g = api.g;
    if (g.round >= g.rounds) return api.finish();

    api.newRound();
    api.players().forEach(player => { api.me(player).vote = null; });

    // Canta quien menos lo ha hecho.
    const players = api.active().length ? api.active() : api.players();
    const fewest = Math.min(...players.map(player => api.me(player).sung));
    const singer = api.shuffle(players.filter(player => api.me(player).sung === fewest))[0];
    api.me(singer).sung++;
    g.singer = singer.id;
    g.song = api.pick(1)[0];
    g.result = null;

    api.music("play", { index: g.song });
    api.phase("listen");
    api.after(api.randomInt(RULES.listenMinMs, RULES.listenMaxMs), cut);
}

function cut(api) {
    api.music("pause");
    api.phase("sing", RULES.singMs, check);
}

// La música vuelve donde se cortó: así se oye si lo que cantó era lo que venía.
function check(api) {
    api.music("resume");
    api.phase("vote", RULES.voteMs, reveal);
}

function reveal(api) {
    const g = api.g;
    const voters = api.players().filter(player => player.id !== g.singer && api.me(player).vote != null);
    const ups = voters.filter(player => api.me(player).vote).length;
    const share = voters.length ? ups / voters.length : 0;
    const majority = ups * 2 >= voters.length; // empate: a favor del cantante

    const singer = api.byId(g.singer);
    const points = singer ? api.award(singer, RULES.singerPoints * share) : 0;
    voters.filter(player => api.me(player).vote === majority).forEach(player => api.award(player, RULES.majorityPoints));

    g.result = { song: g.song, ups, downs: voters.length - ups, points, nailed: voters.length > 0 && majority };

    api.music("pause");
    api.phase("reveal", RULES.revealMs, nextRound);
}

module.exports = { createKaraoke: options => createPartyGame(spec, options), KARAOKE_RULES: RULES };
