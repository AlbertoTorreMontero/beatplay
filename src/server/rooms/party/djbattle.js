/*
 * DUELO DE DJS — elige la mejor canción para cada situación.
 * Sale una frase ("La canción para llorar en el coche"). Cada uno elige en secreto una canción de
 * la playlist del anfitrión. Suenan todas (un trocito cada una) sin decir de quién es, y se vota la
 * mejor. No vale votarse a uno mismo. No hace falta saber de música: gana quien mejor lee a la sala.
 *
 * Audio: un fragmento por canción elegida (una llamada por canción) y una pausa.
 */
const { createPartyGame } = require("./kit");

const RULES = { rounds: 4, pickMs: 35000, clipMs: 12000, voteMs: 20000, revealMs: 8000, votePoints: 100, sweepBonus: 150 };

const PROMPTS = [
    "La canción para llorar en el coche",
    "La que pondrías en tu boda",
    "La que suena cuando entras en una pelea a cámara lenta",
    "La canción del primer beso",
    "La que pondrías a las 6 de la mañana para acabar la fiesta",
    "La que le dedicarías a tu ex",
    "La que sonaría en el tráiler de tu vida",
    "Para limpiar la casa a tope",
    "Para un viaje en coche de 8 horas",
    "La que pondrías en tu funeral (con humor)",
    "La que suena en el gimnasio cuando levantas más de la cuenta",
    "Para conquistar a alguien en la primera cita",
    "La que pondrías si ganas la lotería",
    "La canción de los lunes por la mañana",
    "Para el último baile de la noche",
    "La que sonaría en tu entrada al ring",
    "La que no puedes no cantar a gritos",
    "La de quedarte mirando por la ventana del bus",
    "La banda sonora de un atraco perfecto",
    "La que pondrías para enfadar a tus vecinos",
    "La que suena cuando te dejan en visto",
    "Para el primer día de vacaciones",
    "La que pondrías en una cena con tus suegros",
    "La que define a la persona de tu izquierda",
    "La que sonaría si fueras el villano de una peli",
    "Para estudiar la noche antes del examen",
    "La que pones cuando nadie te ve",
    "La de reencontrarte con un amigo después de años",
    "La que pondrías en la ducha",
    "La que sonaría en tu ascensor ideal"
];

const spec = {
    id: "djbattle",
    rules: RULES,
    minPlayers: 3,
    minSongs: 10,

    player: () => ({ pick: null, vote: null }),

    start(api) {
        api.g.rounds = RULES.rounds;
        api.g.prompts = api.shuffle([...PROMPTS]);
        nextRound(api);
    },

    act(api, player, action, message) {
        const g = api.g;
        const me = api.me(player);

        if (action === "pick" && api.room.phase === "pick") {
            const index = Number(message.index);
            if (!Number.isInteger(index) || !api.song(index)) return;
            me.pick = index;
            api.sync();
            if (api.everyone(state => state.pick != null)) api.advance();
        }

        if (action === "vote" && api.room.phase === "vote") {
            const entry = g.entries[Number(message.entry)];
            if (!entry || entry.pickers.includes(player.id)) return;
            me.vote = Number(message.entry);
            api.sync();
            // Solo votan quienes tienen algo que votar (si todos eligieron la misma, nadie).
            const voters = api.active().filter(other => g.entries.some(candidate => !candidate.pickers.includes(other.id)));
            if (api.everyone(state => state.vote != null, voters)) api.advance();
        }
    },

    view(api, player) {
        const g = api.g;
        const me = api.me(player);
        const phase = api.room.phase;
        const base = { prompt: g.prompt };

        if (phase === "pick") return { ...base, picked: me.pick, ready: api.players().filter(other => api.me(other).pick != null).length, total: api.players().length };
        if (phase === "listen") return { ...base, cursor: g.cursor + 1, count: g.entries.length, song: g.entries[g.cursor].index };
        if (phase === "vote") {
            return {
                ...base,
                voted: me.vote,
                entries: g.entries.map((entry, i) => ({ i, song: entry.index, mine: entry.pickers.includes(player.id) }))
            };
        }
        if (phase === "reveal") return { ...base, results: g.results, scoreboard: api.scoreboard() };
        return base;
    }
};

function nextRound(api) {
    const g = api.g;
    if (g.round >= g.rounds) return api.finish();

    if (g.round > 0) api.music("pause");
    api.newRound();
    api.players().forEach(player => Object.assign(api.me(player), { pick: null, vote: null }));
    g.prompt = g.prompts[(g.round - 1) % g.prompts.length];
    g.entries = [];
    g.results = null;

    api.phase("pick", RULES.pickMs, listen);
}

// Junta las elecciones (si dos eligen la misma, la comparten) y las pone a sonar una a una.
function listen(api) {
    const g = api.g;
    const byIndex = new Map();
    api.players().forEach(player => {
        const pick = api.me(player).pick;
        if (pick == null) return;
        if (!byIndex.has(pick)) byIndex.set(pick, { index: pick, pickers: [] });
        byIndex.get(pick).pickers.push(player.id);
    });

    g.entries = api.shuffle([...byIndex.values()]);
    if (g.entries.length < 2) return reveal(api); // no hay duelo posible

    g.cursor = -1;
    nextClip(api);
}

function nextClip(api) {
    const g = api.g;
    g.cursor++;
    if (g.cursor >= g.entries.length) {
        api.music("pause");
        return api.phase("vote", RULES.voteMs, reveal);
    }
    api.music("play", { index: g.entries[g.cursor].index });
    api.phase("listen", RULES.clipMs, nextClip);
}

function reveal(api) {
    const g = api.g;
    const votes = g.entries.map(() => []);
    api.players().forEach(player => {
        const vote = api.me(player).vote;
        if (vote != null && votes[vote]) votes[vote].push(player.id);
    });

    g.entries.forEach((entry, i) => {
        // Barrido: todos los que podían votarla, la votaron.
        const possible = api.players().filter(player => !entry.pickers.includes(player.id)).length;
        const sweep = possible > 1 && votes[i].length === possible;
        entry.pickers.forEach(id => {
            const player = api.byId(id);
            if (player) api.award(player, votes[i].length * RULES.votePoints + (sweep ? RULES.sweepBonus : 0));
        });
        entry.votes = votes[i].length;
        entry.sweep = sweep;
    });

    g.results = g.entries
        .map(entry => ({ song: entry.index, votes: entry.votes || 0, sweep: Boolean(entry.sweep), pickers: entry.pickers.map(api.nameOf) }))
        .sort((a, b) => b.votes - a.votes);

    // La ganadora vuelve a sonar.
    if (g.results[0]?.votes) api.music("play", { index: g.results[0].song });
    api.phase("reveal", RULES.revealMs, nextRound);
}

module.exports = { createDjBattle: options => createPartyGame(spec, options), DJBATTLE_RULES: RULES, DJ_PROMPTS: PROMPTS };
