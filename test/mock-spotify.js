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
    artists: [{ name: `${user} artist ${n % 7}` }],
    album: {
        name: `Album ${n % 9}`,
        release_date: `${1960 + (n * 7) % 65}-01-01`,
        images: [{ url: `https://i.scdn.co/image/${user}${n}` }]
    }
});

let tokenCounter = 0;

globalThis.fetch = async (url, options = {}) => {

    url = String(url);

    if (url.startsWith("https://embed.spotify.com/")) return publicEmbed(new URL(url).searchParams.get("uri"));

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
