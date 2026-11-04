/*
 * DESAFINADO — el impostor musical.
 * Todos reciben en secreto la misma canción… menos uno, que recibe otra y NO sabe que es el impostor.
 * Por turnos, cada uno tararea su canción unos segundos (sin letra). Luego se vota al que desafina.
 * Al final suena la canción buena por el altavoz y se descubre todo.
 *
 * Audio: una canción por ronda, solo en la revelación.
 */
const { createPartyGame } = require("./kit");

const RULES = { rounds: 5, peekMs: 7000, humMs: 9000, voteMs: 25000, revealMs: 10000, catchPoints: 150, escapePoints: 300 };

const spec = {
    id: "impostor",
    rules: RULES,
    minPlayers: 3,
    minSongs: 6,
    lateJoin: false,

    player: () => ({ vote: null, wasImpostor: 0 }),

    start(api) {
        api.g.rounds = RULES.rounds;
        nextRound(api);
    },

    act(api, player, action, message) {
        if (action !== "vote" || api.room.phase !== "vote") return;
        const target = api.byId(String(message.target));
        if (!target || target.id === player.id || !api.g.order.includes(player.id)) return;

        api.me(player).vote = target.id;
        api.sync();

        const voters = api.active().filter(other => api.g.order.includes(other.id));
        if (api.everyone(state => state.vote, voters)) api.advance();
    },

    view(api, player) {
        const g = api.g;
        const inRound = g.order.includes(player.id);
        const mySong = player.id === g.impostor ? g.fake : g.real;
        const phase = api.room.phase;

        if (phase === "peek") return { song: inRound ? mySong : null };
        if (phase === "hum") return { song: inRound ? mySong : null, turnId: g.order[g.turn], turn: g.turn + 1, turns: g.order.length, order: g.order.map(id => ({ id, name: api.nameOf(id) })) };
        if (phase === "vote") {
            return {
                voted: api.me(player).vote,
                canVote: inRound,
                candidates: g.order.filter(id => id !== player.id).map(id => ({ id, name: api.nameOf(id) })),
                votes: g.order.filter(id => api.me({ id }).vote).length,
                voters: g.order.length
            };
        }
        if (phase === "reveal") return { ...g.result, scoreboard: api.scoreboard() };
        return {};
    }
};

function nextRound(api) {
    const g = api.g;
    if (g.round >= g.rounds) return api.finish();

    // Que no siga sonando la canción de la ronda anterior mientras se tararea.
    if (g.round > 0) api.music("pause");
    api.newRound();
    const players = api.active();
    players.forEach(player => { api.me(player).vote = null; });

    // Dos canciones de artistas distintos: si no, el impostor lo tendría demasiado fácil.
    g.real = api.pick(1)[0];
    g.fake = api.pick(1, song => api.normalize(song.artist) !== api.normalize(api.song(g.real).artist))[0] ?? api.pick(1)[0];

    // Impostor: alguien que lo haya sido menos veces.
    const fewest = Math.min(...players.map(player => api.me(player).wasImpostor));
    const impostor = api.shuffle(players.filter(player => api.me(player).wasImpostor === fewest))[0];
    api.me(impostor).wasImpostor++;
    g.impostor = impostor.id;

    g.order = api.shuffle(players.map(player => player.id));
    g.turn = 0;
    g.result = null;

    api.phase("peek", RULES.peekMs, nextTurn);
}

function nextTurn(api) {
    const g = api.g;
    if (api.room.phase === "hum") g.turn++;
    // Quien se ha desconectado pierde su turno.
    while (g.turn < g.order.length && !api.byId(g.order[g.turn])?.ws) g.turn++;

    if (g.turn >= g.order.length) return api.phase("vote", RULES.voteMs, reveal);
    api.phase("hum", RULES.humMs, nextTurn);
}

function reveal(api) {
    const g = api.g;
    const tally = {};
    g.order.forEach(id => {
        const vote = api.me({ id }).vote;
        if (vote) tally[vote] = (tally[vote] || 0) + 1;
    });

    const top = Math.max(0, ...Object.values(tally));
    const leaders = Object.keys(tally).filter(id => tally[id] === top);
    const caught = top > 0 && leaders.length === 1 && leaders[0] === g.impostor;

    g.order.forEach(id => {
        const player = api.byId(id);
        if (!player) return;
        if (id !== g.impostor && api.me(player).vote === g.impostor) api.award(player, RULES.catchPoints);
        if (id === g.impostor && !caught) api.award(player, RULES.escapePoints);
    });

    g.result = {
        impostorId: g.impostor,
        impostor: api.nameOf(g.impostor),
        caught,
        real: g.real,
        fake: g.fake,
        votes: g.order.map(id => ({ id, name: api.nameOf(id), votes: tally[id] || 0, votedFor: api.me({ id }).vote ? api.nameOf(api.me({ id }).vote) : null })).sort((a, b) => b.votes - a.votes)
    };

    api.music("play", { index: g.real });
    api.phase("reveal", RULES.revealMs, nextRound);
}

module.exports = { createImpostor: options => createPartyGame(spec, options), IMPOSTOR_RULES: RULES };
