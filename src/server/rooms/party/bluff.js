/*
 * FAROL — mentiras creíbles.
 * Suena una canción y se ve su título y artista. Pregunta: ¿cómo se llama el disco?
 * Cada uno se inventa un nombre de disco falso pero creíble. Luego salen todos mezclados con el
 * de verdad y hay que encontrar el auténtico. Puntos por acertar y por cada uno que caiga en tu farol.
 *
 * Audio: una canción por ronda.
 */
const { createPartyGame } = require("./kit");

const RULES = { rounds: 5, writeMs: 40000, voteMs: 25000, revealMs: 10000, truthPoints: 200, foolPoints: 100, maxLength: 50 };

const spec = {
    id: "bluff",
    rules: RULES,
    minPlayers: 3,
    minSongs: 5,

    // Solo canciones cuyo disco no se llame igual que la canción (los singles lo regalan).
    accept: song => {
        const album = song.album.toLowerCase();
        const name = song.name.toLowerCase();
        return Boolean(album) && !album.includes(name) && !name.includes(album);
    },

    player: () => ({ lie: null, choice: null }),

    start(api) {
        api.g.rounds = RULES.rounds;
        nextRound(api);
    },

    act(api, player, action, message) {
        const g = api.g;
        const me = api.me(player);

        if (action === "lie" && api.room.phase === "write") {
            const text = String(message.text || "").replace(/\s+/g, " ").trim().slice(0, RULES.maxLength);
            if (!text) return;
            if (api.normalize(text) === api.normalize(api.song(g.song).album)) {
                return api.fail(player, "¡Ese es el de verdad! Invéntate otro para engañar a los demás.");
            }
            me.lie = text;
            api.sync();
            if (api.everyone(state => state.lie)) api.advance();
        }

        if (action === "choose" && api.room.phase === "vote") {
            const option = g.options[Number(message.option)];
            if (!option || option.authors.includes(player.id)) return;
            me.choice = Number(message.option);
            api.sync();
            if (api.everyone(state => state.choice != null)) api.advance();
        }
    },

    view(api, player) {
        const g = api.g;
        const me = api.me(player);
        const phase = api.room.phase;
        const song = { song: g.song, year: api.song(g.song)?.year };

        if (phase === "write") return { ...song, lie: me.lie, ready: api.players().filter(other => api.me(other).lie).length, total: api.players().length };
        if (phase === "vote") {
            return {
                ...song,
                choice: me.choice,
                options: g.options.map((option, i) => ({ i, text: option.text, mine: option.authors.includes(player.id) }))
            };
        }
        if (phase === "reveal") return { ...song, album: api.song(g.song).album, cover: api.song(g.song).cover, results: g.results, scoreboard: api.scoreboard() };
        return song;
    }
};

function nextRound(api) {
    const g = api.g;
    if (g.round >= g.rounds) return api.finish();

    api.newRound();
    api.players().forEach(player => Object.assign(api.me(player), { lie: null, choice: null }));
    g.song = api.pick(1)[0];
    g.options = [];
    g.results = null;

    api.music("play", { index: g.song });
    api.phase("write", RULES.writeMs, vote);
}

// Mentiras iguales se juntan (y comparten autores). La verdad, en un sitio al azar.
function vote(api) {
    const g = api.g;
    const byText = new Map();
    api.players().forEach(player => {
        const lie = api.me(player).lie;
        if (!lie) return;
        const key = api.normalize(lie);
        if (!byText.has(key)) byText.set(key, { text: lie, authors: [], truth: false });
        byText.get(key).authors.push(player.id);
    });

    g.options = api.shuffle([...byText.values(), { text: api.song(g.song).album, authors: [], truth: true }]);
    api.phase("vote", RULES.voteMs, reveal);
}

function reveal(api) {
    const g = api.g;
    const chosenBy = g.options.map(() => []);
    api.players().forEach(player => {
        const choice = api.me(player).choice;
        if (choice != null && chosenBy[choice]) chosenBy[choice].push(player.id);
    });

    g.options.forEach((option, i) => {
        if (option.truth) {
            chosenBy[i].forEach(id => api.award(api.byId(id), RULES.truthPoints)); // chosenBy solo tiene jugadores presentes
        } else {
            option.authors.forEach(id => {
                const author = api.byId(id);
                if (author) api.award(author, chosenBy[i].length * RULES.foolPoints);
            });
        }
    });

    g.results = g.options
        .map((option, i) => ({ text: option.text, truth: option.truth, authors: option.authors.map(api.nameOf), chosenBy: chosenBy[i].map(api.nameOf) }))
        .sort((a, b) => Number(b.truth) - Number(a.truth) || b.chosenBy.length - a.chosenBy.length);

    api.phase("reveal", RULES.revealMs, nextRound);
}

module.exports = { createBluff: options => createPartyGame(spec, options), BLUFF_RULES: RULES };
