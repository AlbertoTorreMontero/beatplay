// Precarga para tests: sustituye fetch para los hosts de Spotify y deja el servidor funcionar sin red.
// Uso: node -r ./test/mock-spotify.js server.js
const realFetch = globalThis.fetch;
const TRACKS_PER_PLAYLIST = 120;

const json = (body, status = 200) =>
    new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });

const userOf = auth => (auth || "").replace("Bearer ", "").split("-")[1];

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

    if (url.startsWith("https://accounts.spotify.com/api/token")) {
        const body = new URLSearchParams(options.body);
        const isRefresh = body.get("grant_type") === "refresh_token";
        const user = isRefresh ? body.get("refresh_token").replace("RT-", "") : body.get("code").replace("code-", "");
        return json({
            access_token: `AT-${user}-${++tokenCounter}`,
            refresh_token: `RT-${user}`,
            expires_in: Number(process.env.MOCK_EXPIRES || 3600)
        });
    }

    if (!url.startsWith("https://api.spotify.com/v1")) return realFetch(url, options);

    const { pathname, searchParams } = new URL(url);
    const path = pathname.replace("/v1", "");
    const user = userOf(options.headers?.Authorization);

    if (process.env.MOCK_LOG) console.error(`SPOTIFY ${options.method || "GET"} ${path}`);

    if (path === "/me") return json({ id: user, display_name: user });

    if (path === "/me/playlists") {
        return json({
            items: [{ id: `pl-${user}`, name: `${user} playlist`, owner: { display_name: user }, images: [], items: { total: TRACKS_PER_PLAYLIST }, uri: "x" }],
            next: null
        });
    }

    if (path.startsWith("/me/player")) return new Response(null, { status: 204 });

    if (/^\/playlists\/[^/]+$/.test(path)) return json({ name: "playlist", items: { total: TRACKS_PER_PLAYLIST } });

    if (/^\/playlists\/[^/]+\/items$/.test(path)) {
        const offset = Number(searchParams.get("offset") || 0);
        const limit = Number(searchParams.get("limit") || 50);
        const items = [];
        for (let n = offset; n < Math.min(offset + limit, TRACKS_PER_PLAYLIST); n++) items.push({ item: track(user, n) });
        return json({ items });
    }

    return json({ error: { message: `mock: ruta sin implementar ${path}` } }, 404);
};
