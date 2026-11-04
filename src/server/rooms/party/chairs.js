/*
 * SILLAS MUSICALES — reflejos y oído.
 * Suena una canción y, en un momento al azar, se corta. Hay que pulsar en cuanto deja de sonar.
 * Quien pulsa antes de tiempo o no pulsa pierde una vida; si nadie falla, la pierde el más lento.
 * La pantalla no avisa del corte: solo vale el oído. Gana el último en pie.
 *
 * Audio: una canción por ronda (play) y una pausa. Nada más.
 */
const { createPartyGame } = require("./kit");

const RULES = { lives: 2, minStopMs: 7000, maxStopMs: 22000, tapWindowMs: 3500, revealMs: 5000 };

const spec = {
    id: "chairs",
    rules: RULES,
    minPlayers: 2,
    minSongs: 5,
    lateJoin: false,

    player: () => ({ lives: RULES.lives, alive: true, tapMs: null, early: false, lost: false, place: null }),

    start(api) {
        api.players().forEach(player => api.me(player));
        api.g.rounds = 0; // sin número fijo: hasta que quede uno
        api.g.out = [];   // eliminados, en orden
        nextRound(api);
    },

    act(api, player, action) {
        if (action !== "tap" || api.room.phase !== "dancing") return;
        const me = api.me(player);
        if (!me.alive || me.tapMs != null || me.early) return;

        if (!api.g.stoppedAt) me.early = true; // aún sonaba
        else me.tapMs = Date.now() - api.g.stoppedAt;

        // Solo se entera quien ha pulsado: el resto no debe saber que ya ha parado.
        api.syncPlayer(player);
        if (api.g.stoppedAt && api.everyone(state => !state.alive || state.tapMs != null || state.early)) api.after(400, resolve);
    },

    view(api, player) {
        const me = api.me(player);
        const base = { lives: me.lives, alive: me.alive, maxLives: RULES.lives, standing: alive(api).length };
        if (api.room.phase === "dancing") return { ...base, tapped: me.tapMs != null || me.early };
        if (api.room.phase === "reveal") return { ...base, results: api.g.results, song: api.g.song, void: api.g.void };
        return base;
    },

    // Si solo queda uno en pie, ha ganado.
    leave(api) {
        if (alive(api).length < 2) finish(api);
    }
};

const alive = api => api.players().filter(player => api.me(player).alive);

function nextRound(api) {
    const standing = alive(api);
    if (standing.length <= 1) return finish(api);

    api.newRound();
    standing.forEach(player => Object.assign(api.me(player), { tapMs: null, early: false, lost: false }));
    api.g.stoppedAt = 0;
    api.g.song = api.pick(1)[0];

    api.music("play", { index: api.g.song });
    api.phase("dancing");

    // El corte llega cuando quiere. Luego, unos segundos para pulsar.
    api.after(api.randomInt(RULES.minStopMs, RULES.maxStopMs), () => {
        api.g.stoppedAt = Date.now();
        api.music("pause");
        api.after(RULES.tapWindowMs, resolve);
    });
}

function resolve(api) {
    if (api.room.phase !== "dancing") return;
    const standing = alive(api);
    const states = standing.map(player => ({ player, me: api.me(player) }));

    const missed = states.filter(({ me }) => me.early || me.tapMs == null);
    const valid = states.filter(({ me }) => !me.early && me.tapMs != null).sort((a, b) => a.me.tapMs - b.me.tapMs);

    // Si nadie ha fallado, cae el más lento (si hay más de uno en pie).
    const losers = missed.length ? missed : valid.length > 1 ? [valid[valid.length - 1]] : [];
    losers.forEach(({ me }) => { me.lives--; me.lost = true; });

    valid.forEach(({ player }, i) => api.award(player, i === 0 ? 100 : 50));

    // Si caerían todos a la vez, ronda nula: nadie pierde la vida (si no, no habría ganador).
    api.g.void = losers.length === standing.length && losers.every(({ me }) => me.lives <= 0);
    if (api.g.void) losers.forEach(({ me }) => { me.lives++; });

    const fallen = losers.filter(({ me }) => me.lives <= 0);
    fallen.forEach(({ player, me }) => {
        me.alive = false;
        api.g.out.push(player.id);
        me.place = standing.length - fallen.length + 1; // empatan los que caen a la vez
    });

    api.g.results = states
        .map(({ player, me }) => ({ id: player.id, name: player.name, ms: me.tapMs, early: me.early, lost: me.lost, lives: me.lives, out: !me.alive }))
        .sort((a, b) => (a.ms ?? Infinity) - (b.ms ?? Infinity));

    api.music("pause");
    api.phase("reveal", RULES.revealMs, nextRound);
}

function finish(api) {
    const [winner] = alive(api);
    if (winner) api.award(winner, 300);
    api.finish(winner ? [winner.id] : null);
}

module.exports = { createChairs: options => createPartyGame(spec, options), CHAIRS_RULES: RULES };
