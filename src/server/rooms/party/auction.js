/*
 * SUBASTA — "yo la adivino en 3 segundos".
 * La pista: el artista y el año. Cada uno puja en secreto cuántos segundos necesita para adivinar
 * la canción (de 1 a 10). La puja más baja se lleva el reto: suenan SOLO esos segundos y tiene que
 * elegir el título. Si acierta, se lleva un botín mayor cuanto menos pujó; si falla, el resto se reparte.
 * (Inspirado en "Bid-a-Note" del concurso Name That Tune.)
 *
 * Audio: un fragmento (play + pausa programada) y, al final de la ronda, la canción entera.
 */
const { createPartyGame } = require("./kit");

const RULES = { rounds: 6, bidMs: 12000, answerMs: 15000, revealMs: 7000, secondMs: 1000, maxSeconds: 10, options: 4, pointsPerSecond: 50, potPoints: 100, bufferMs: 1500 };

const spec = {
    id: "auction",
    rules: RULES,
    minPlayers: 2,
    minSongs: 8,

    player: () => ({ bid: null, bidAt: 0 }),

    start(api) {
        api.g.rounds = RULES.rounds;
        nextRound(api);
    },

    act(api, player, action, message) {
        const g = api.g;
        const me = api.me(player);

        if (action === "bid" && api.room.phase === "bid") {
            const seconds = Number(message.seconds);
            if (!Number.isInteger(seconds) || seconds < 1 || seconds > RULES.maxSeconds) return;
            Object.assign(me, { bid: seconds, bidAt: Date.now() });
            api.sync();
            if (api.everyone(state => state.bid != null)) api.advance();
        }

        if (action === "answer" && api.room.phase === "answer" && player.id === g.winner) {
            const option = Number(message.option);
            if (!g.options.includes(option)) return;
            g.answer = option;
            api.advance();
        }
    },

    view(api, player) {
        const g = api.g;
        const me = api.me(player);
        const phase = api.room.phase;
        const clue = { artist: api.song(g.song)?.artist, year: api.song(g.song)?.year };

        if (phase === "bid") return { clue, bid: me.bid, ready: api.players().filter(other => api.me(other).bid != null).length, total: api.players().length };
        if (phase === "listen" || phase === "answer") {
            return {
                clue,
                winnerId: g.winner,
                winner: api.nameOf(g.winner),
                seconds: g.seconds,
                options: phase === "answer" && player.id === g.winner ? g.options : null
            };
        }
        if (phase === "reveal") return { clue, ...g.result, scoreboard: api.scoreboard() };
        return { clue };
    }
};

function nextRound(api) {
    const g = api.g;
    if (g.round >= g.rounds) return api.finish();

    if (g.round > 0) api.music("pause");
    api.newRound();
    api.players().forEach(player => Object.assign(api.me(player), { bid: null, bidAt: 0 }));
    Object.assign(g, { song: api.pick(1)[0], winner: null, seconds: 0, answer: null, result: null });

    api.phase("bid", RULES.bidMs, settle);
}

// Gana la puja más baja; si empatan, quien pujó antes.
function settle(api) {
    const g = api.g;
    const bids = api.players()
        .map(player => ({ player, me: api.me(player) }))
        .filter(({ me }) => me.bid != null)
        .sort((a, b) => a.me.bid - b.me.bid || a.me.bidAt - b.me.bidAt);

    if (!bids.length) return finishRound(api, null);

    g.winner = bids[0].player.id;
    g.seconds = bids[0].me.bid;
    g.options = api.options(g.song, RULES.options, "name");

    api.music("clip", { index: g.song, ms: g.seconds * RULES.secondMs });
    api.phase("listen", g.seconds * RULES.secondMs + RULES.bufferMs, next => next.phase("answer", RULES.answerMs, finishRound));
}

function finishRound(api) {
    const g = api.g;
    const winner = api.byId(g.winner);
    const correct = g.answer != null && api.same(g.answer, g.song);

    let points = 0;
    if (winner && correct) {
        points = api.award(winner, (RULES.maxSeconds + 1 - g.seconds) * RULES.pointsPerSecond);
    } else if (g.winner) {
        api.players().filter(player => player.id !== g.winner).forEach(player => api.award(player, RULES.potPoints));
    }

    g.result = { song: g.song, winnerId: g.winner, winner: g.winner ? api.nameOf(g.winner) : null, seconds: g.seconds, correct, points, answered: g.answer };

    // De premio, la canción entera.
    api.music("play", { index: g.song });
    api.phase("reveal", RULES.revealMs, nextRound);
}

module.exports = { createAuction: options => createPartyGame(spec, options), AUCTION_RULES: RULES };
