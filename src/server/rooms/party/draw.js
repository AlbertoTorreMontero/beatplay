/*
 * DIBUJA LA PORTADA — todos dibujan la misma.
 * Aparece la portada de una canción (y suena). Cada uno la dibuja en su móvil como pueda.
 * Después se expone la galería: la portada de verdad arriba y todos los dibujos debajo,
 * sin nombre. Se vota el que más te guste (el tuyo no vale) y cada voto son puntos.
 *
 * Audio: una canción por ronda (suena mientras se dibuja).
 * Los dibujos son imágenes pequeñas (JPEG de 320×320): viajan una sola vez a cada jugador,
 * en un mensaje aparte, no en cada actualización de pantalla.
 */
const { createPartyGame } = require("./kit");

const RULES = { rounds: 3, drawMs: 80000, voteMs: 30000, revealMs: 12000, votePoints: 100, sweepBonus: 100, maxBytes: 150000 };

// Solo imágenes incrustadas en base64: nada de enlaces externos.
const IMAGE = /^data:image\/(png|jpeg|webp);base64,[A-Za-z0-9+/]+=*$/;

const spec = {
    id: "draw",
    rules: RULES,
    minPlayers: 2,
    minSongs: 3,

    accept: song => Boolean(song.cover),

    player: () => ({ drawing: null, vote: null }),

    start(api) {
        api.g.rounds = RULES.rounds;
        nextRound(api);
    },

    act(api, player, action, message) {
        const g = api.g;
        const me = api.me(player);

        if (action === "drawing" && api.room.phase === "draw") {
            const image = String(message.image || "");
            if (image.length > RULES.maxBytes || !IMAGE.test(image)) return api.fail(player, "No se pudo enviar el dibujo.");
            me.drawing = image;
            api.sync();
            if (api.everyone(state => state.drawing)) api.advance();
        }

        if (action === "vote" && api.room.phase === "vote") {
            const entry = Number(message.entry);
            if (!g.entries[entry] || g.entries[entry].id === player.id) return;
            me.vote = entry;
            api.sync();
            const voters = api.active().filter(other => g.entries.some(candidate => candidate.id !== other.id));
            if (api.everyone(state => state.vote != null, voters)) api.advance();
        }
    },

    view(api, player) {
        const g = api.g;
        const me = api.me(player);
        const base = { song: g.song, gallery: g.galleryId };
        const ready = () => api.players().filter(other => api.me(other).drawing).length;

        if (api.room.phase === "draw") return { ...base, sent: Boolean(me.drawing), ready: ready(), total: api.players().length };
        if (api.room.phase === "vote") {
            return {
                ...base,
                count: g.entries.length,
                mine: g.entries.findIndex(entry => entry.id === player.id),
                voted: me.vote,
                votes: api.players().filter(other => api.me(other).vote != null).length,
                total: api.players().length
            };
        }
        if (api.room.phase === "reveal") return { ...base, results: g.results, scoreboard: api.scoreboard() };
        return base;
    },

    // Quien vuelve (o entra) a mitad de la votación necesita los dibujos.
    resume(api, player) {
        if (["vote", "reveal"].includes(api.room.phase)) sendGallery(api, [player]);
    }
};

function nextRound(api) {
    const g = api.g;
    if (g.round >= g.rounds) return api.finish();

    api.newRound();
    api.players().forEach(player => Object.assign(api.me(player), { drawing: null, vote: null }));
    g.song = api.pick(1)[0];
    g.entries = [];
    g.results = null;

    api.music("play", { index: g.song });
    api.phase("draw", RULES.drawMs, gallery);
}

// Los dibujos, mezclados y sin nombre.
function gallery(api) {
    const g = api.g;
    g.entries = api.shuffle(api.players()
        .filter(player => api.me(player).drawing)
        .map(player => ({ id: player.id, image: api.me(player).drawing })));
    g.galleryId = `${g.round}-${Date.now()}`;

    sendGallery(api, api.players());
    if (g.entries.length < 2) return reveal(api); // con un solo dibujo no hay votación
    api.phase("vote", RULES.voteMs, reveal);
}

function sendGallery(api, players) {
    const { galleryId, entries } = api.g;
    players.forEach(player => api.send(player, "drawings", { gallery: galleryId, images: entries.map(entry => entry.image) }));
}

function reveal(api) {
    const g = api.g;
    const votes = g.entries.map(() => 0);
    api.players().forEach(player => {
        const vote = api.me(player).vote;
        if (vote != null && votes[vote] != null) votes[vote]++;
    });

    g.results = g.entries.map((entry, i) => {
        const author = api.byId(entry.id);
        const possible = api.players().filter(player => player.id !== entry.id).length;
        const sweep = possible > 1 && votes[i] === possible;
        const points = author ? api.award(author, votes[i] * RULES.votePoints + (sweep ? RULES.sweepBonus : 0)) : 0;
        return { entry: i, id: entry.id, name: api.nameOf(entry.id), votes: votes[i], points, sweep };
    }).sort((a, b) => b.votes - a.votes);

    api.phase("reveal", RULES.revealMs, nextRound);
}

module.exports = { createDraw: options => createPartyGame(spec, options), DRAW_RULES: RULES };
