// Tests de integración: arrancan server.js con Spotify simulado (test/mock-spotify.js).
// Ejecutar con: npm test
const { describe, it, before, after } = require("node:test");
const assert = require("node:assert/strict");
const { spawn } = require("node:child_process");
const http = require("node:http");
const net = require("node:net");
const path = require("node:path");
const WebSocket = require("ws");

const ROOT = path.join(__dirname, "..");
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));

// ---------------------------------------------------------------- servidor
function freePort() {
    return new Promise(resolve => {
        const probe = net.createServer().listen(0, () => {
            const { port } = probe.address();
            probe.close(() => resolve(port));
        });
    });
}

async function startServer(extraEnv = {}) {

    const port = await freePort();
    const env = {
        ...process.env,
        PORT: port,
        SPOTIFY_CLIENT_ID: "id",
        SPOTIFY_CLIENT_SECRET: "secret",
        SPOTIFY_REDIRECT_URI: `http://127.0.0.1:${port}/callback`,
        HIPSTER_PLAYLIST_ID: "pl-host",
        MOCK_LOG: "1",
        NODE_OPTIONS: `--require ${path.join(__dirname, "mock-spotify.js")}`,
        ...extraEnv
    };

    const child = spawn("node", ["server.js"], { cwd: ROOT, env });
    const spotifyCalls = [];
    let output = "";

    child.stderr.on("data", chunk => {
        output += chunk;
        for (const line of String(chunk).split("\n")) {
            if (line.startsWith("SPOTIFY ")) spotifyCalls.push(line.slice(8));
        }
    });
    child.stdout.on("data", chunk => { output += chunk; });

    for (let i = 0; i < 100 && !output.includes("escuchando"); i++) await sleep(50);
    assert.ok(output.includes("escuchando"), `el servidor no arrancó:\n${output}`);

    return {
        port,
        base: `http://127.0.0.1:${port}`,
        spotifyCalls,
        isAlive: () => fetch(`http://127.0.0.1:${port}/healthz`).then(res => res.ok, () => false),
        stop: () => child.kill()
    };
}

// ---------------------------------------------------------------- "navegador" con cookies
function browser(base) {

    const jar = {};

    const request = async (url, options = {}) => {

        const cookie = Object.entries(jar).map(([name, value]) => `${name}=${value}`).join("; ");
        const res = await fetch(base + url, { redirect: "manual", ...options, headers: { ...options.headers, ...(cookie && { cookie }) } });

        for (const line of res.headers.getSetCookie()) {
            const [pair, ...attributes] = line.split("; ");
            const [name, value] = pair.split("=");
            if (!value || /max-age=0|expires=Thu, 01 Jan 1970/i.test(attributes.join(";"))) delete jar[name];
            else jar[name] = value;
        }

        return res;
    };

    request.jar = jar;
    request.login = async user => {
        const res = await request("/login");
        const state = new URL(res.headers.get("location")).searchParams.get("state");
        return request(`/callback?code=code-${user}&state=${state}`);
    };

    return request;
}

// ---------------------------------------------------------------- cliente WebSocket
async function openSocket(base, token) {

    const ws = new WebSocket(base.replace("http", "ws"));
    ws.messages = [];
    ws.on("message", raw => {
        const message = JSON.parse(raw);
        ws.messages.push(message);
        ws.emit("typed", message);
    });
    await new Promise(resolve => ws.on("open", resolve));

    ws.sendJson = payload => ws.send(JSON.stringify(payload));

    // Espera el siguiente mensaje de ese tipo que nadie haya consumido todavía.
    ws.waitFor = (type, timeout = 25000) => new Promise((resolve, reject) => {

        const pending = ws.messages.find(message => message.type === type && !message.seen);

        if (pending) {
            pending.seen = true;
            return resolve(pending);
        }

        const timer = setTimeout(() => reject(new Error(`timeout esperando ${type}`)), timeout);

        const listener = message => {
            if (message.type !== type) return;
            message.seen = true;
            clearTimeout(timer);
            ws.off("typed", listener);
            resolve(message);
        };

        ws.on("typed", listener);
    });

    return ws;
}

const tracksFor = (prefix, host = "i.scdn.co") =>
    Array.from({ length: 6 }, (_, i) => ({ id: `${prefix}${i}`, name: `s${i}`, artist: "a", cover: `https://${host}/image/${prefix}${i}` }));

// ================================================================= tests
describe("sesiones y OAuth", () => {

    let server;

    before(async () => { server = await startServer(); });
    after(() => server.stop());

    it("un visitante sin cookie no recibe ningún token", async () => {
        const stranger = browser(server.base);
        assert.equal((await stranger("/auth/token")).status, 401);
        assert.equal((await stranger("/api/playlists")).status, 401);
    });

    it("cada navegador usa su propia cuenta de Spotify", async () => {

        const alice = browser(server.base);
        const bob = browser(server.base);
        const stranger = browser(server.base);

        assert.equal((await alice.login("alice")).headers.get("location"), "/app");
        await bob.login("bob");

        const aliceToken = (await (await alice("/auth/token")).json()).access_token;
        const bobToken = (await (await bob("/auth/token")).json()).access_token;
        assert.match(aliceToken, /alice/);
        assert.match(bobToken, /bob/);

        assert.equal((await (await alice("/api/playlists")).json())[0].name, "alice playlist");
        assert.equal((await (await bob("/api/playlists")).json())[0].name, "bob playlist");
        assert.equal((await stranger("/auth/token")).status, 401);

        await alice("/auth/logout", { method: "POST" });
        assert.equal((await alice("/auth/token")).status, 401);
        assert.equal((await bob("/auth/token")).status, 200, "el logout de uno no afecta al otro");
    });

    it("la cookie de sesión es HttpOnly y SameSite=Lax", async () => {
        const res = await fetch(`${server.base}/login`, { redirect: "manual" });
        const cookie = res.headers.getSetCookie().join(" ");
        assert.match(cookie, /HttpOnly/i);
        assert.match(cookie, /SameSite=Lax/i);
    });

    it("rechaza un callback con state falso o ausente", async () => {
        const attacker = browser(server.base);
        const forged = await attacker("/callback?code=code-mallory&state=falso");
        assert.equal(forged.headers.get("location"), "/?auth=error");
        assert.equal(attacker.jar.beatplay_sid, undefined);
        assert.equal((await browser(server.base)("/callback?code=x&state=y")).headers.get("location"), "/?auth=error");
    });

    it("si el usuario cancela en Spotify vuelve a la portada con aviso", async () => {
        const res = await browser(server.base)("/callback?error=access_denied");
        assert.equal(res.headers.get("location"), "/?auth=denied");
    });

    it("redirige al host canónico (localhost → 127.0.0.1) y deja /healthz accesible", async () => {

        const get = (urlPath, host) => new Promise((resolve, reject) => {
            http.get({ host: "127.0.0.1", port: server.port, path: urlPath, headers: { host } }, res => {
                res.resume();
                resolve(res);
            }).on("error", reject);
        });

        const redirected = await get("/app", `localhost:${server.port}`);
        assert.equal(redirected.statusCode, 302);
        assert.equal(redirected.headers.location, `${server.base}/app`);
        assert.equal((await get("/healthz", "otro-host")).statusCode, 200);
    });

    it("sirve la landing y la app", async () => {
        assert.equal((await fetch(`${server.base}/`)).status, 200);
        const app = await fetch(`${server.base}/app`);
        assert.equal(app.status, 200);
        assert.match(await app.text(), /BeatPlay/);
    });
});

describe("renovación de token", () => {

    it("renueva el token caducado sin que el usuario lo note", async () => {

        const server = await startServer({ MOCK_EXPIRES: "61" }); // caduca a 1 s (margen de 60 s)

        try {
            const carol = browser(server.base);
            await carol.login("carol");
            const first = (await (await carol("/auth/token")).json()).access_token;
            await sleep(1300);
            const second = (await (await carol("/auth/token")).json()).access_token;
            assert.notEqual(first, second);
            assert.equal((await carol("/api/me")).status, 200);
        } finally {
            server.stop();
        }
    });
});

describe("canciones y Hipster", () => {

    let server, user;

    before(async () => {
        server = await startServer();
        user = browser(server.base);
        await user.login("dana");
    });
    after(() => server.stop());

    it("Bingo recibe la playlist completa sin duplicados", async () => {
        const tracks = await (await user("/api/playlists/pl-dana/catalog")).json();
        assert.equal(tracks.length, 120);
        assert.equal(new Set(tracks.map(track => track.id)).size, 120);
    });

    it("Hipster devuelve una muestra acotada, con año, sin bajar la playlist entera", async () => {

        const before = server.spotifyCalls.length;
        const tracks = await (await user("/api/playlists/pl-dana/hipster")).json();
        const calls = server.spotifyCalls.slice(before).filter(call => call.includes("/playlists/"));

        assert.equal(tracks.length, 60);
        assert.ok(tracks.every(track => Number.isInteger(track.year)));
        assert.ok(calls.length <= 3, `demasiadas peticiones a Spotify: ${calls.join(", ")}`);
    });

    it("reiniciar Hipster no vuelve a pedir nada a Spotify (caché)", async () => {

        await user("/api/playlists/pl-dana/hipster");
        const before = server.spotifyCalls.length;

        // Dos muestras más: las páginas posibles ya están en caché.
        await user("/api/playlists/pl-dana/hipster");
        await user("/api/playlists/pl-dana/hipster");

        assert.ok(server.spotifyCalls.length - before <= 1, "se esperaba servir casi todo desde caché");
    });

    it("la caché no se comparte entre usuarios", async () => {
        const erin = browser(server.base);
        await erin.login("erin");
        const before = server.spotifyCalls.length;
        const tracks = await (await erin("/api/playlists/pl-dana/hipster")).json();
        assert.ok(server.spotifyCalls.length > before, "erin debe pedir a Spotify con su propio token");
        assert.ok(tracks.every(track => track.id.startsWith("erin")));
    });

    it("Hipster Global usa la playlist configurada", async () => {
        assert.equal((await user("/api/hipster/tracks")).status, 200);
    });

    it("Hipster Global avisa si el servidor no lo tiene configurado", async () => {

        const bare = await startServer({ HIPSTER_PLAYLIST_ID: "" });

        try {
            const frank = browser(bare.base);
            await frank.login("frank");
            const res = await frank("/api/hipster/tracks");
            assert.equal(res.status, 503);
            assert.match((await res.json()).error, /HIPSTER_PLAYLIST_ID/);
        } finally {
            bare.stop();
        }
    });
});

describe("Music Roulette", () => {

    let server;

    before(async () => { server = await startServer(); });
    after(() => server.stop());

    it("sobrevive a mensajes basura y a orígenes ajenos", async () => {

        const ws = await openSocket(server.base);
        for (const junk of ["null", "42", "\"texto\"", "[]", "{no es json"]) ws.send(junk);
        await sleep(200);
        assert.ok(await server.isAlive());
        ws.close();

        const foreign = new WebSocket(server.base.replace("http", "ws"), { origin: "https://evil.example" });
        const result = await new Promise(resolve => {
            foreign.on("open", () => resolve("abierto"));
            foreign.on("error", () => resolve("rechazado"));
        });
        assert.equal(result, "rechazado");
    });

    it("sala, nombres únicos, límites y portadas validadas", async () => {

        const a = await openSocket(server.base);
        const b = await openSocket(server.base);

        a.sendJson({ type: "create_room", name: "Jugador" });
        const { code } = await a.waitFor("joined");
        assert.match(code, /^[A-HJ-NP-Z2-9]{5}$/, "código sin caracteres ambiguos");

        const state = await a.waitFor("room_state");
        assert.equal(state.maxPlayers, 10);
        assert.equal(state.minTracks, 5);

        a.sendJson({ type: "join_room", code, name: "Jugador" });
        await sleep(100);
        assert.ok(await server.isAlive(), "unirse a tu propia sala no la destruye");

        b.sendJson({ type: "join_room", code: code.toLowerCase(), name: "Jugador" });
        await b.waitFor("joined");

        const names = (await a.waitFor("room_state").then(() => a.messages.filter(m => m.type === "room_state").at(-1))).players.map(p => p.name);
        assert.deepEqual(names.sort(), ["Jugador", "Jugador 2"]);

        b.sendJson({ type: "set_playlist", playlist: { id: "x", name: "Secreta" }, tracks: tracksFor("evil", "tracker.example.com") });
        assert.match((await b.waitFor("error_message")).message, /0 canciones/);

        a.sendJson({ type: "set_playlist", playlist: { id: "a", name: "Lista de A" }, tracks: tracksFor("a") });
        await sleep(150);
        const last = a.messages.filter(m => m.type === "room_state").at(-1);
        assert.ok(!JSON.stringify(last).includes("Lista de A"), "el estado de la sala no revela las playlists");

        a.close();
        b.close();
    });

    it("partida completa entre dos dispositivos, con votos fuera de plazo ignorados", async () => {

        const a = await openSocket(server.base);
        const b = await openSocket(server.base);

        a.sendJson({ type: "create_room", name: "A" });
        const { code, playerId: aId } = await a.waitFor("joined");
        b.sendJson({ type: "join_room", code, name: "B" });
        const { playerId: bId } = await b.waitFor("joined");
        a.sendJson({ type: "set_playlist", playlist: { id: "a", name: "a" }, tracks: tracksFor("a") });
        b.sendJson({ type: "set_playlist", playlist: { id: "b", name: "b" }, tracks: tracksFor("b") });
        await sleep(200);
        a.sendJson({ type: "start_game" });

        let lastOwner;

        for (let round = 1; round <= 5; round++) {

            const start = await a.waitFor("round_start");
            await b.waitFor("round_start");

            const [owner, guesser, ownerId] = start.isOwner ? [a, b, aId] : [b, a, bId];

            if (round === 1) {
                guesser.sendJson({ type: "vote", ownerId: "no-es-un-jugador" });
                await sleep(100);
            }

            guesser.sendJson({ type: "vote", ownerId });
            const results = await a.waitFor("round_results");
            await b.waitFor("round_results");

            if (round === 1) {
                assert.equal(results.results.find(r => r.id === (owner === a ? bId : aId)).correct, true);
            }

            lastOwner = owner;
        }

        // Durante el descanso final nadie puede votar (antes esto tumbaba el servidor).
        lastOwner.sendJson({ type: "vote", ownerId: "cualquiera" });
        a.sendJson({ type: "vote", ownerId: aId });
        await sleep(300);
        assert.ok(await server.isAlive());

        const over = await a.waitFor("game_over");
        assert.equal(over.scoreboard.length, 2);

        a.close();
        b.close();
    });

    it("un jugador que pierde la conexión vuelve a su sitio con su token", async () => {

        const a = await openSocket(server.base);
        let b = await openSocket(server.base);

        a.sendJson({ type: "create_room", name: "A" });
        const { code } = await a.waitFor("joined");
        b.sendJson({ type: "join_room", code, name: "B" });
        const { playerId, token } = await b.waitFor("joined");
        assert.ok(token);

        a.sendJson({ type: "set_playlist", playlist: { id: "a", name: "a" }, tracks: tracksFor("a") });
        b.sendJson({ type: "set_playlist", playlist: { id: "b", name: "b" }, tracks: tracksFor("b") });
        await sleep(200);

        // B pierde la conexión: sigue en la sala pero marcado como desconectado.
        b.close();
        await sleep(200);
        const offline = a.messages.filter(m => m.type === "room_state").at(-1);
        assert.equal(offline.players.find(p => p.id === playerId).connected, false);

        // Un token falso no sirve.
        const intruder = await openSocket(server.base);
        intruder.sendJson({ type: "rejoin", code, token: "falso" });
        await intruder.waitFor("rejoin_failed");
        intruder.close();

        // B vuelve con su token y recupera identidad y estado.
        b = await openSocket(server.base);
        b.sendJson({ type: "rejoin", code, token });
        const resumed = await b.waitFor("joined");
        assert.equal(resumed.resumed, true);
        assert.equal(resumed.playerId, playerId);

        await sleep(150);
        const online = a.messages.filter(m => m.type === "room_state").at(-1);
        assert.equal(online.players.find(p => p.id === playerId).connected, true);
        assert.equal(online.players.find(p => p.id === playerId).ready, true, "conserva su playlist");

        // A mitad de ronda también recupera la ronda en curso, con el tiempo que queda.
        a.sendJson({ type: "start_game" });
        await a.waitFor("round_start");
        await b.waitFor("round_start");

        b.close();
        await sleep(200);
        b = await openSocket(server.base);
        b.sendJson({ type: "rejoin", code, token });
        await b.waitFor("joined");
        const midRound = await b.waitFor("round_start");
        assert.ok(midRound.duration <= 15000 && midRound.duration > 0);
        assert.equal(midRound.tracks.length, 5);

        a.close();
        b.close();
    });
});
