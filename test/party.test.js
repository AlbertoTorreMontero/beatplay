/*
 * Partidas simuladas de los 10 juegos de fiesta: varios jugadores "bot" juegan de principio a fin
 * contra el hub real (sin red). Los tiempos se acortan para que cada partida dure poco.
 * Ejecutar: node --test test/party.test.js
 */
const test = require("node:test");
const assert = require("node:assert/strict");
const { createHub } = require("../src/server/rooms/hub");
const { createPartyGames } = require("../src/server/rooms/party");

const RULE_MODULES = ["chairs", "impostor", "djbattle", "bluff", "bid", "auction", "karaoke", "draw"]
    .map(name => require(`../src/server/rooms/party/${name}`));

// Todos los tiempos a unos pocos milisegundos.
for (const module of RULE_MODULES) {
    const rules = Object.entries(module).find(([key]) => key.endsWith("_RULES"))[1];
    for (const key of Object.keys(rules)) if (key.endsWith("Ms")) rules[key] = 60;
    if ("minStopMs" in rules) Object.assign(rules, { minStopMs: 40, maxStopMs: 70, tapWindowMs: 150 });
    if ("listenMinMs" in rules) Object.assign(rules, { listenMinMs: 30, listenMaxMs: 50 });
    if ("clipMs" in rules) rules.clipMs = 40;
    if ("maxDuration" in rules) Object.assign(rules, { minDuration: 30, maxDuration: 600 }); // no son tiempos
}

const ARTISTS = ["Queen", "Rosalía", "Bad Bunny", "ABBA", "Estopa", "Daft Punk", "Shakira", "Oasis", "Adele", "Muse"];
const pool = Array.from({ length: 40 }, (_, i) => ({
    id: `t${i}`,
    name: `Canción ${i}`,
    artist: ARTISTS[i % ARTISTS.length],
    album: `Disco ${i}`,
    year: 1970 + i,
    duration: 120000 + i * 3000,
    cover: `https://i.scdn.co/image/${i}`
}));

function bot(hub, name) {
    const self = { name, views: [], music: [], errors: [], catalog: null, joined: null, state: null };
    const ws = {
        readyState: 1,
        send(raw) {
            const message = JSON.parse(raw);
            if (message.type === "view") self.views.push(message);
            if (message.type === "music") self.music.push(message);
            if (message.type === "catalog") self.catalog = message.songs;
            if (message.type === "joined") self.joined = message;
            if (message.type === "room_state") self.state = message;
            if (message.type === "error_message") self.errors.push(message.message);
            if (message.type === "drawings") self.drawings = message;
        },
        close() {}
    };
    self.connection = { ws, player: hub.createPlayer(ws) };
    self.send = (type, data = {}) => hub.handleMessage(self.connection, { type, ...data });
    self.act = (action, data = {}) => self.send("act", { action, ...data });
    self.view = () => self.views[self.views.length - 1];
    self.id = () => self.joined?.playerId;
    return self;
}

// Un JPEG mínimo válido en base64 (lo que manda el lienzo del cliente).
const DRAWING = "data:image/jpeg;base64," + Buffer.from("dibujo").toString("base64");

const wait = ms => new Promise(resolve => setTimeout(resolve, ms));
const pickOne = list => list[Math.floor(Math.random() * list.length)];

// Lo que suena ahora (según lo último que el servidor mandó al anfitrión).
const playing = host => [...host.music].reverse().find(message => message.action === "play" || message.action === "clip")?.index;

// Cómo juega cada bot en cada juego. Devuelve una acción o nada.
const BRAINS = {
    chairs(me, view, host) {
        if (view.phase === "dancing" && view.alive && !view.tapped && host.music[host.music.length - 1]?.action === "pause" && Math.random() < 0.5) me.act("tap");
    },
    impostor(me, view) {
        if (view.phase === "vote" && view.canVote && !view.voted) me.act("vote", { target: pickOne(view.candidates).id });
    },
    djbattle(me, view) {
        if (view.phase === "pick" && view.picked == null) me.act("pick", { index: Math.floor(Math.random() * pool.length) });
        if (view.phase === "vote" && view.voted == null) {
            const options = view.entries.filter(entry => !entry.mine);
            if (options.length) me.act("vote", { entry: pickOne(options).i });
        }
    },
    bluff(me, view) {
        if (view.phase === "write" && !view.lie) me.act("lie", { text: `Farol de ${me.name}` });
        if (view.phase === "vote" && view.choice == null) me.act("choose", { option: pickOne(view.options.filter(option => !option.mine)).i });
    },
    bid(me, view) {
        if (view.phase === "guess" && view.bid == null) me.act("bid", { value: view.range[0] + Math.floor(Math.random() * (view.range[1] - view.range[0])) });
    },
    auction(me, view, host) {
        if (view.phase === "bid" && view.bid == null) me.act("bid", { seconds: 1 + Math.floor(Math.random() * 10) });
        if (view.phase === "answer" && view.options) {
            const truth = host.catalog[playing(host)];
            me.act("answer", { option: view.options.find(i => host.catalog[i].name === truth.name) });
        }
    },
    karaoke(me, view) {
        if (view.phase === "vote" && !view.you && view.vote == null) me.act("vote", { ok: Math.random() < 0.6 });
    },
    draw(me, view) {
        if (view.phase === "draw" && !view.sent) me.act("drawing", { image: DRAWING });
        if (view.phase === "vote" && view.voted == null) {
            const options = Array.from({ length: view.count }, (_, i) => i).filter(i => i !== view.mine);
            if (options.length) me.act("vote", { entry: pickOne(options) });
        }
    }
};

async function playGame(game, players = 4) {
    const hub = createHub(createPartyGames({ coverHosts: ["scdn.co"] }));
    const bots = Array.from({ length: players }, (_, i) => bot(hub, `Bot${i}`));
    const [host] = bots;

    host.send("create_room", { game, name: host.name });
    const code = host.joined.code;
    bots.slice(1).forEach(other => other.send("join_room", { code, name: other.name }));
    host.send("set_pool", { playlistName: "Test", tracks: pool });
    host.send("start_game");

    const phases = new Set();
    const deadline = Date.now() + 20000;
    while (host.view()?.phase !== "final") {
        if (Date.now() > deadline) throw new Error(`${game}: no terminó (última fase ${host.view()?.phase})`);
        for (const me of bots) {
            const view = me.view();
            if (view) {
                phases.add(view.phase);
                BRAINS[game](me, view, host);
            }
        }
        await wait(10);
    }

    return { host, bots, phases, hub, code };
}

for (const game of Object.keys(BRAINS)) {
    test(`${game}: una partida completa termina con clasificación`, async () => {
        const { host, bots, phases } = await playGame(game);

        const final = host.view();
        assert.equal(final.scoreboard.length, bots.length);
        assert.ok(final.scoreboard.every(row => Number.isFinite(row.score)));
        assert.ok(phases.size >= 2, `fases vistas: ${[...phases]}`);

        // Solo el anfitrión recibe órdenes de audio y siempre sobre canciones de su lista.
        assert.ok(host.music.length > 0);
        bots.slice(1).forEach(other => assert.equal(other.music.length, 0));
        host.music.filter(message => message.index != null).forEach(message => assert.ok(pool[message.index]));

        // Todos recibieron el catálogo, sin años ni discos (son respuestas de algunos juegos).
        bots.forEach(other => {
            assert.equal(other.catalog.length, pool.length);
            assert.equal(other.catalog[0].year, undefined);
            assert.equal(other.catalog[0].album, undefined);
        });

        assert.deepEqual(bots.flatMap(other => other.errors), []);
    });
}

test("la partida vuelve a la sala si se va el anfitrión", async () => {
    const hub = createHub(createPartyGames({ coverHosts: ["scdn.co"] }));
    const [host, guest, third] = ["A", "B", "C"].map(name => bot(hub, name));
    host.send("create_room", { game: "bid", name: "A" });
    guest.send("join_room", { code: host.joined.code, name: "B" });
    third.send("join_room", { code: host.joined.code, name: "C" });
    host.send("set_pool", { tracks: pool });
    host.send("start_game");
    assert.equal(guest.state.status, "playing");

    host.send("leave_room");
    assert.equal(guest.state.status, "lobby");
    assert.ok(guest.errors.some(text => text.includes("música")));
});

test("no se puede empezar sin canciones suficientes ni con pocos jugadores", () => {
    const hub = createHub(createPartyGames({ coverHosts: ["scdn.co"] }));
    const host = bot(hub, "A");
    host.send("create_room", { game: "impostor", name: "A" });
    host.send("set_pool", { tracks: pool.slice(0, 2) });
    assert.ok(host.errors.at(-1).includes("Hacen falta"));
    host.send("set_pool", { tracks: pool });
    host.send("start_game");
    assert.ok(host.errors.at(-1).includes("jugadores"));
    assert.equal(host.state.status, "lobby");
});

test("Puja justa cuenta las canciones válidas según el modo, y Farol las que tienen disco distinto", () => {
    const hub = createHub(createPartyGames({ coverHosts: ["scdn.co"] }));
    const host = bot(hub, "A");
    host.send("create_room", { game: "bid", name: "A" });
    host.send("set_pool", { tracks: pool.map((song, i) => ({ ...song, year: i < 5 ? song.year : null, duration: i < 9 ? song.duration : null })) });
    assert.equal(host.state.mode, "year");
    assert.equal(host.state.songs, 5);
    host.act("mode", { mode: "duration" });
    assert.equal(host.state.mode, "duration");
    assert.equal(host.state.songs, 9);

    const other = bot(hub, "B");
    other.send("create_room", { game: "bluff", name: "B" });
    other.send("set_pool", { tracks: pool.map((song, i) => ({ ...song, album: i < 3 ? song.name : song.album })) });
    assert.equal(other.state.songs, pool.length - 3);
});

test("Puja justa: gana el más cercano sin pasarse", async () => {
    const hub = createHub(createPartyGames({ coverHosts: ["scdn.co"] }));
    const [host, b, c] = ["A", "B", "C"].map(name => bot(hub, name));
    host.send("create_room", { game: "bid", name: "A" });
    b.send("join_room", { code: host.joined.code, name: "B" });
    c.send("join_room", { code: host.joined.code, name: "C" });
    host.send("set_pool", { tracks: pool });
    host.send("start_game");

    const year = pool[host.music.at(-1).index].year;
    host.act("bid", { value: year - 3 }); // por debajo
    b.act("bid", { value: year - 1 });    // más cerca, sin pasarse: gana
    c.act("bid", { value: year + 1 });    // se pasa
    while (host.view().phase !== "reveal") await wait(5);

    const rows = host.view().bids;
    assert.equal(rows.find(row => row.winner).name, "B");
    assert.equal(rows.find(row => row.name === "C").over, true);
    assert.equal(host.view().scoreboard.find(row => row.name === "B").score, 300);
    host.send("leave_room");
});

test("Dibuja la portada: rechaza lo que no es una imagen y reparte la galería sin nombres", async () => {
    const hub = createHub(createPartyGames({ coverHosts: ["scdn.co"] }));
    const [host, b] = ["A", "B"].map(name => bot(hub, name));
    host.send("create_room", { game: "draw", name: "A" });
    b.send("join_room", { code: host.joined.code, name: "B" });
    host.send("set_pool", { tracks: pool });
    host.send("start_game");

    b.act("drawing", { image: "https://malicioso.example/x.png" });
    assert.ok(b.errors.at(-1).includes("dibujo"));
    b.act("drawing", { image: DRAWING });
    host.act("drawing", { image: DRAWING });
    while (host.view().phase !== "vote") await wait(5);

    assert.equal(b.drawings.images.length, 2);
    assert.equal(JSON.stringify(b.drawings).includes(b.id()), false);
    assert.equal(host.view().gallery, b.drawings.gallery);
    host.send("leave_room");
});

test("sillas: pulsar antes del corte cuesta una vida", async () => {
    const hub = createHub(createPartyGames({ coverHosts: ["scdn.co"] }));
    const [host, guest] = ["A", "B"].map(name => bot(hub, name));
    host.send("create_room", { game: "chairs", name: "A" });
    guest.send("join_room", { code: host.joined.code, name: "B" });
    host.send("set_pool", { tracks: pool });
    host.send("start_game");

    guest.act("tap"); // la música aún suena
    assert.equal(guest.view().tapped, true);
    assert.equal(host.view().tapped, false); // el otro no se entera

    while (guest.view().phase !== "reveal") {
        if (host.music.at(-1).action === "pause" && !host.view().tapped) host.act("tap");
        await wait(5);
    }
    const mine = guest.view().results.find(row => row.name === "B");
    assert.equal(mine.early, true);
    assert.equal(guest.view().lives, 1);
});

test("un invitado que se reconecta recupera su pantalla", async () => {
    const hub = createHub(createPartyGames({ coverHosts: ["scdn.co"] }));
    const [host, guest] = ["A", "B"].map(name => bot(hub, name));
    host.send("create_room", { game: "chairs", name: "A" });
    guest.send("join_room", { code: host.joined.code, name: "B" });
    host.send("set_pool", { tracks: pool });
    host.send("start_game");

    const again = bot(hub, "B-again");
    again.send("rejoin", { code: host.joined.code, token: guest.joined.token });
    assert.equal(again.joined.resumed, true);
    assert.ok(again.catalog);
    assert.equal(again.view().phase, host.view().phase);
    host.send("leave_room");
});
