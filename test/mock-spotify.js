// Precarga para tests: sustituye fetch para los hosts de Spotify y deja el servidor funcionar sin red.
// Uso: node -r ./test/mock-spotify.js src/server/index.js
const realFetch = globalThis.fetch;
const TRACKS_PER_PLAYLIST = 120;

const json = (body, status = 200) =>
    new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });

// Token de acceso: AT-<usuario>-<n>-<own|shared> (app propia del usuario o app compartida).
const userOf = auth => (auth || "").replace("Bearer ", "").split("-")[1];
const appOf = auth => (auth || "").replace("Bearer ", "").split("-")[3];

// Página pública del reproductor incrustado, como la que lee spotify-url-info.
const embedPage = entity =>
    new Response(`<html><body><script id="__NEXT_DATA__">${JSON.stringify({ props: { pageProps: { state: { data: { entity } } } } })}</script></body></html>`);

function publicEmbed(uri) {
    const [, type, id] = uri.split(":");
    if (id === "privada") return new Response("<html><body>Not found</body></html>", { status: 404 });

    if (type === "playlist") {
        return embedPage({
            type, uri, name: `Pública ${id}`,
            coverArt: { sources: [{ url: `https://image-cdn-ak.spotifycdn.com/image/${id}`, width: 300 }] },
            trackList: Array.from({ length: 30 }, (_, n) => ({ uri: `spotify:track:${id}${n}`, title: `${id} canción ${n}`, subtitle: `${id} artista`, duration: 1000 }))
        });
    }

    return embedPage({
        type, uri, name: `canción ${id}`, artists: [{ name: "artista" }],
        coverArt: { sources: [{ url: `https://image-cdn-ak.spotifycdn.com/image/${id}`, width: 300 }] }
    });
}

const track = (user, n) => ({
    id: `${user}-t${n}`,
    uri: `spotify:track:${user}${n}`,
    name: `${user} song ${n}`,
    type: "track",
    is_local: false,
    duration_ms: 150000 + (n * 7919) % 150000,
    external_ids: { isrc: `ES${user.slice(0, 3).toUpperCase().padEnd(3, "X")}26${String(n).padStart(5, "0")}` },
    artists: [{ name: `${user} artist ${n % 7}` }],
    album: {
        name: `Album ${n % 9}`,
        release_date: `${1960 + (n * 7) % 65}-01-01`,
        images: [{ url: `https://i.scdn.co/image/${user}${n}` }]
    }
});

let tokenCounter = 0;

const tempoOf = n => 70 + (n * 37) % 110;

// WAV mono de 12 s con un golpe grave (bombo) en cada pulso y otro agudo a contratiempo.
function clickTrack(bpm, seconds = 12, rate = 22050) {
    const samples = seconds * rate;
    const data = new Int16Array(samples);
    const beat = 60 / bpm;
    for (let i = 0; i < samples; i++) {
        const t = i / rate;
        const sinceBeat = t % beat;
        const sinceOff = (t + beat / 2) % beat;
        let v = sinceBeat < 0.08 ? Math.sin(2 * Math.PI * 60 * sinceBeat) * Math.exp(-sinceBeat * 40) : 0;
        if (sinceOff < 0.03) v += 0.25 * Math.sin(2 * Math.PI * 3000 * sinceOff) * Math.exp(-sinceOff * 120);
        data[i] = Math.max(-1, Math.min(1, v * 0.9)) * 32767;
    }
    const header = Buffer.alloc(44);
    header.write("RIFF", 0); header.writeUInt32LE(36 + samples * 2, 4); header.write("WAVE", 8);
    header.write("fmt ", 12); header.writeUInt32LE(16, 16); header.writeUInt16LE(1, 20); header.writeUInt16LE(1, 22);
    header.writeUInt32LE(rate, 24); header.writeUInt32LE(rate * 2, 28); header.writeUInt16LE(2, 32); header.writeUInt16LE(16, 34);
    header.write("data", 36); header.writeUInt32LE(samples * 2, 40);
    return Buffer.concat([header, Buffer.from(data.buffer)]);
}

globalThis.fetch = async (url, options = {}) => {

    url = String(url);

    if (url.startsWith("https://embed.spotify.com/")) return publicEmbed(new URL(url).searchParams.get("uri"));

    // Deezer: BPM según el número de la canción (algunas sin dato: 0) y una muestra de audio
    // con golpes a ese tempo (también para las que Deezer no sabe: así se prueba el detector).
    if (url.startsWith("https://api.deezer.com/track/isrc:")) {
        const n = Number(url.slice(-5));
        return json({ id: n, bpm: n % 5 === 4 ? 0 : tempoOf(n), preview: `https://cdnt-preview.dzcdn.net/stream/${n}.wav` });
    }
    if (url.startsWith("https://cdnt-preview.dzcdn.net/stream/")) {
        const n = Number(url.match(/(\d+)\.wav/)[1]);
        return new Response(clickTrack(tempoOf(n)), { headers: { "Content-Type": "audio/wav" } });
    }

    if (url.startsWith("https://accounts.spotify.com/api/token")) {
        const body = new URLSearchParams(options.body);
        const isRefresh = body.get("grant_type") === "refresh_token";
        const user = isRefresh ? body.get("refresh_token").replace("RT-", "") : body.get("code").replace("code-", "");

        // App propia (PKCE): exige client_id y, al canjear el código, code_verifier. La compartida, su secreto.
        const own = !options.headers?.Authorization;
        if (own && (!body.get("client_id") || (!isRefresh && !body.get("code_verifier")))) {
            return json({ error: "invalid_request", error_description: "falta PKCE" }, 400);
        }

        return json({
            access_token: `AT-${user}-${++tokenCounter}-${own ? "own" : "shared"}`,
            refresh_token: `RT-${user}`,
            expires_in: Number(process.env.MOCK_EXPIRES || 3600)
        });
    }

    if (!url.startsWith("https://api.spotify.com/v1")) return realFetch(url, options);

    const { pathname, searchParams } = new URL(url);
    const path = pathname.replace("/v1", "");
    const user = userOf(options.headers?.Authorization);

    if (process.env.MOCK_LOG) console.error(`SPOTIFY ${options.method || "GET"} ${path}`);

    // En la app compartida solo están autorizadas algunas cuentas (como el allowlist de 5).
    if (appOf(options.headers?.Authorization) === "shared" && user.startsWith("fuera")) {
        return new Response("User not registered in the Developer Dashboard", { status: 403 });
    }

    if (path === "/me") return json({ id: user, display_name: user, email: `${user}@mail.com` });

    if (path === "/me/playlists") {
        return json({
            items: [{ id: `pl-${user}`, name: `${user} playlist`, owner: { display_name: user }, images: [], items: { total: TRACKS_PER_PLAYLIST }, uri: "x" }],
            next: null
        });
    }

    if (path === "/me/player/devices") {
        return json({ devices: [{ id: "phone-1", name: `${user} iPhone`, type: "Smartphone", is_active: false, is_restricted: false }] });
    }

    if (path.startsWith("/me/player")) {
        if (process.env.MOCK_LOG && options.body) console.error(`SPOTIFY_BODY ${options.body}`);
        return new Response(null, { status: 204 });
    }

    if (/^\/playlists\/[^/]+$/.test(path)) return json({ name: "playlist", items: { total: TRACKS_PER_PLAYLIST } });

    if (/^\/playlists\/[^/]+\/items$/.test(path)) {
        const offset = Number(searchParams.get("offset") || 0);
        const limit = Number(searchParams.get("limit") || 50);
        const items = [];
        for (let n = offset; n < Math.min(offset + limit, TRACKS_PER_PLAYLIST); n++) items.push({ item: track(user, n) });
        return json({ total: TRACKS_PER_PLAYLIST, items });
    }

    return json({ error: { message: `mock: ruta sin implementar ${path}` } }, 404);
};
