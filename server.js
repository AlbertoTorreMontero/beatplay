require("dotenv").config();

const path = require("path");
const crypto = require("crypto");
const http = require("http");
const express = require("express");
const { WebSocketServer, WebSocket } = require("ws");

const app = express();

app.disable("x-powered-by");
app.set("trust proxy", 1); // detrás del proxy de Render
const server = http.createServer(app);
// 256 KB sobra para una playlist de 100 canciones y evita mensajes gigantes.
const wss = new WebSocketServer({
    server,
    maxPayload: 256 * 1024,
    // Solo aceptamos conexiones desde nuestra propia web.
    verifyClient: ({ origin, req }) => !origin || new URL(origin).host === req.headers.host
});

// =====================================================
// CONFIGURACIÓN
// =====================================================

const PORT = process.env.PORT || 3000;

const CLIENT_ID = process.env.SPOTIFY_CLIENT_ID;
const CLIENT_SECRET = process.env.SPOTIFY_CLIENT_SECRET;

const REDIRECT_URI = process.env.SPOTIFY_REDIRECT_URI;

if (!CLIENT_ID || !CLIENT_SECRET || !REDIRECT_URI) {
    throw new Error(
        "Faltan SPOTIFY_CLIENT_ID, SPOTIFY_CLIENT_SECRET o SPOTIFY_REDIRECT_URI en las variables de entorno."
    );
}

// =====================================================
// CONFIGURACIÓN SPOTIFY
// =====================================================

const PUBLIC_DIR = path.join(__dirname, "public");

const SPOTIFY_ACCOUNTS = "https://accounts.spotify.com";

const SPOTIFY_API = "https://api.spotify.com/v1";

const SCOPES = [
    "user-read-private",
    "user-read-email",
    "user-read-playback-state",
    "user-modify-playback-state",
    "streaming",
    "playlist-read-private",
    "playlist-read-collaborative"
].join(" ");

const PAGE_SIZE = 50;

const PARALLEL_PAGES = 5;

const HIPSTER_TRACKS = 60;

const GAME_TRACKS = 20;

const HIPSTER_PLAYLIST_ID =
    process.env.HIPSTER_PLAYLIST_ID;

const { origin: CANONICAL_ORIGIN, host: CANONICAL_HOST } = new URL(REDIRECT_URI);

// =====================================================
// SESIÓN
// =====================================================

// Una sesión por navegador (cookie), para que cada jugador use su propia cuenta de Spotify.
const sessions = new Map();

const SESSION_COOKIE = "beatplay_sid";
const STATE_COOKIE = "beatplay_oauth_state";
const SESSION_MAX_AGE = 30 * 24 * 60 * 60 * 1000;
const STATE_MAX_AGE = 10 * 60 * 1000;

const COOKIE_OPTIONS = {
    httpOnly: true,
    sameSite: "lax", // con "strict" la cookie no viajaría en la vuelta desde Spotify
    secure: REDIRECT_URI.startsWith("https://")
};

class SpotifyError extends Error {
    constructor(message, status = 500) {
        super(message);
        this.status = status;
    }
}

function getCookie(req, name) {
    const cookie = req.headers.cookie?.split("; ").find(part => part.startsWith(`${name}=`));
    return cookie ? decodeURIComponent(cookie.slice(name.length + 1)) : null;
}

function saveTokens(session, data) {
    session.accessToken = data.access_token;
    session.expiresAt = Date.now() + (data.expires_in - 60) * 1000;

    if (data.refresh_token) {
        session.refreshToken = data.refresh_token;
    }
}

function createSession(req, res, tokenData) {
    sessions.delete(getCookie(req, SESSION_COOKIE));

    const session = { id: crypto.randomUUID() };

    saveTokens(session, tokenData);
    sessions.set(session.id, session);
    res.cookie(SESSION_COOKIE, session.id, { ...COOKIE_OPTIONS, maxAge: SESSION_MAX_AGE });
}

function destroySession(req, res) {
    sessions.delete(getCookie(req, SESSION_COOKIE));
    res.clearCookie(SESSION_COOKIE, COOKIE_OPTIONS);
}

function requireSession(req, res, next) {
    const session = sessions.get(getCookie(req, SESSION_COOKIE));

    if (!session) {
        return res.status(401).json({ error: "No hay ninguna sesión de Spotify activa." });
    }

    req.session = session;
    next();
}

async function requestToken(body) {

    const credentials = Buffer.from(
        `${CLIENT_ID}:${CLIENT_SECRET}`
    ).toString("base64");

    const response = await fetch(
        `${SPOTIFY_ACCOUNTS}/api/token`,
        {
            method: "POST",
            headers: {
                "Content-Type": "application/x-www-form-urlencoded",
                Authorization: `Basic ${credentials}`
            },
            body: new URLSearchParams(body)
        }
    );

    const data = await response.json();

    if (!response.ok) {
        throw new SpotifyError(
            data.error_description ||
            "No se pudo autenticar con Spotify.",
            response.status
        );
    }

    return data;
}

async function getAccessToken(session) {

    if (Date.now() < session.expiresAt) {
        return session.accessToken;
    }

    try {

        saveTokens(
            session,
            await requestToken({
                grant_type: "refresh_token",
                refresh_token: session.refreshToken
            })
        );

        return session.accessToken;

    } catch (error) {

        console.error(
            "No se pudo renovar el token:",
            error.message
        );

        sessions.delete(session.id);

        return null;
    }
}


// =====================================================
// CLIENTE DE LA API
// =====================================================

async function spotifyFetch(session, endpoint, options = {}) {

    const token = await getAccessToken(session);

    if (!token) {
        throw new SpotifyError(
            "No hay ninguna sesión de Spotify activa.",
            401
        );
    }

    const response = await fetch(
        `${SPOTIFY_API}${endpoint}`,
        {
            ...options,
            headers: {
                Authorization: `Bearer ${token}`,
                ...(options.headers || {})
            }
        }
    );

    const text = await response.text();

    let data = null;

    if (text) {
        try {
            data = JSON.parse(text);
        } catch {
            data = {
                error: {
                    message: text
                }
            };
        }
    }

    if (!response.ok) {

        if (response.status === 403) {
            throw new SpotifyError(
                "Spotify ha denegado la petición (403). " +
                "En Development Mode solo puedes usar cuentas " +
                "añadidas en el Dashboard y leer playlists tuyas " +
                "o colaborativas.",
                403
            );
        }

        throw new SpotifyError(
            data?.error?.message ||
            "Error en la API de Spotify.",
            response.status
        );
    }

    return data;
}

const route = handler => async (req, res) => {

    try {

        await handler(req, res);

    } catch (error) {

        const status = error.status || 500;

        if (status >= 500) {
            console.error(error);
        }

        res.status(status).json({
            error:
                error.message ||
                "Error inesperado."
        });
    }
};


// =====================================================
// CANCIONES
// =====================================================

const ITEM_FIELDS =
    "total,items(item(id,uri,name,type,is_local," +
    "artists(name),album(name,release_date,images)))";

function isPlayable(track) {

    return Boolean(
        track &&
        track.type === "track" &&
        track.uri &&
        track.id &&
        !track.is_local
    );
}

function getYear(track) {

    const year = parseInt(
        track.album?.release_date?.slice(0, 4),
        10
    );

    return Number.isInteger(year)
        ? year
        : null;
}

function formatTrack(track) {

    const images =
        track.album?.images || [];

    return {
        id: track.id,
        uri: track.uri,
        name: track.name,
        artist:
            (track.artists || [])
                .map(artist => artist.name)
                .join(", "),
        album:
            track.album?.name || "",
        year:
            getYear(track),
        cover:
            images[0]?.url ||
            images[1]?.url ||
            images[2]?.url ||
            null
    };
}

function uniqueTracks(tracks) {

    const seen = new Set();

    return tracks.filter(track => {

        if (seen.has(track.id)) {
            return false;
        }

        seen.add(track.id);

        return true;
    });
}

function shuffle(array) {

    for (
        let i = array.length - 1;
        i > 0;
        i--
    ) {

        const j =
            Math.floor(
                Math.random() * (i + 1)
            );

        [
            array[i],
            array[j]
        ] = [
            array[j],
            array[i]
        ];
    }

    return array;
}

function hasYear(track) {

    return (
        Number.isInteger(track.year) &&
        track.year > 0
    );
}

// Caché corta por usuario: reiniciar un juego no vuelve a pedir la misma playlist a Spotify.
const CACHE_TTL = 5 * 60 * 1000;
const CACHE_MAX = 300;
const cache = new Map();

function cached(session, key, load) {

    const cacheKey = `${session.id}:${key}`;
    const hit = cache.get(cacheKey);

    if (hit && hit.expires > Date.now()) return hit.promise;

    if (cache.size >= CACHE_MAX) cache.delete(cache.keys().next().value);

    const promise = load();

    cache.set(cacheKey, { promise, expires: Date.now() + CACHE_TTL });
    promise.catch(() => cache.delete(cacheKey));

    return promise;
}


function getPlaylistInfo(session, playlistId) {

    return cached(session, `info:${playlistId}`, async () => {

        const data = await spotifyFetch(
            session,
            `/playlists/${encodeURIComponent(playlistId)}?fields=${encodeURIComponent("name,items(total),tracks(total)")}`
        );

        const total = data?.items?.total ?? data?.tracks?.total ?? null;

        if (total === null) {
            throw new SpotifyError(
                "Spotify solo deja leer el contenido de playlists tuyas o colaborativas. Guarda una copia en tu cuenta y vuelve a probar.",
                403
            );
        }

        return { name: data?.name || "", total };
    });
}


function getPlaylistPage(session, playlistId, offset) {

    return cached(session, `page:${playlistId}:${offset}`, () =>
        spotifyFetch(
            session,
            `/playlists/${encodeURIComponent(playlistId)}/items?limit=${PAGE_SIZE}&offset=${offset}&fields=${encodeURIComponent(ITEM_FIELDS)}`
        )
    );
}


function extractTracks(page) {

    return (page?.items || [])
        .map(entry => entry.item ?? entry.track)
        .filter(isPlayable)
        .map(formatTrack);
}


function pageOffsets(total) {
    return Array.from({ length: Math.ceil(total / PAGE_SIZE) }, (_, i) => i * PAGE_SIZE);
}


// Playlist completa. Las páginas se piden en tandas paralelas para no tardar tanto en las grandes.
async function getAllPlaylistTracks(session, playlistId) {

    const { total } = await getPlaylistInfo(session, playlistId);
    const offsets = pageOffsets(total);
    const tracks = [];

    for (let i = 0; i < offsets.length; i += PARALLEL_PAGES) {

        const pages = await Promise.all(
            offsets.slice(i, i + PARALLEL_PAGES).map(offset => getPlaylistPage(session, playlistId, offset))
        );

        tracks.push(...pages.flatMap(extractTracks));
    }

    return uniqueTracks(tracks);
}


// Muestra aleatoria: lee páginas en orden aleatorio y para en cuanto hay suficientes canciones.
async function getRandomPlaylistTracks(session, playlistId, amount = GAME_TRACKS, accept = () => true) {

    const { name, total } = await getPlaylistInfo(session, playlistId);

    let tracks = [];

    for (const offset of shuffle(pageOffsets(total))) {

        const page = await getPlaylistPage(session, playlistId, offset);

        tracks = uniqueTracks(tracks.concat(extractTracks(page).filter(accept)));

        if (tracks.length >= amount) break;
    }

    return { name, tracks: shuffle(tracks).slice(0, amount) };
}


// =====================================================
// PÁGINAS
// =====================================================

// La cookie de sesión es de un solo host: entrar por otro (localhost en vez de 127.0.0.1) rompería el login.
app.use((req, res, next) => {

    if (req.method === "GET" && req.path !== "/healthz" && req.headers.host !== CANONICAL_HOST) {
        return res.redirect(`${CANONICAL_ORIGIN}${req.originalUrl}`);
    }

    next();
});

app.get("/healthz", (req, res) => res.send("ok"));

app.use(
    express.json({
        limit: "1mb"
    })
);

app.use(
    express.static(
        PUBLIC_DIR,
        {
            index: false,
            redirect: false
        }
    )
);

app.get("/", (req, res) => {

    res.sendFile(
        path.join(
            PUBLIC_DIR,
            "landing",
            "landing.html"
        )
    );
});

app.get("/app", (req, res) => {

    res.sendFile(
        path.join(
            PUBLIC_DIR,
            "app",
            "index.html"
        )
    );
});


// =====================================================
// AUTENTICACIÓN
// =====================================================

app.get("/login", (req, res) => {

    const state = crypto.randomBytes(16).toString("hex");

    res.cookie(STATE_COOKIE, state, { ...COOKIE_OPTIONS, maxAge: STATE_MAX_AGE });

    const params = new URLSearchParams({
        client_id: CLIENT_ID,
        response_type: "code",
        redirect_uri: REDIRECT_URI,
        scope: SCOPES,
        state
    });

    res.redirect(`${SPOTIFY_ACCOUNTS}/authorize?${params}`);
});

app.get("/callback", async (req, res) => {

    const { code, error, state } = req.query;
    const expectedState = getCookie(req, STATE_COOKIE);

    res.clearCookie(STATE_COOKIE, COOKIE_OPTIONS);

    if (error) {
        console.error("Spotify rechazó la autorización:", error);
        return res.redirect("/?auth=denied");
    }

    // El state evita que alguien nos haga iniciar sesión con su cuenta sin querer.
    if (!code || !state || state !== expectedState) {
        return res.redirect("/?auth=error");
    }

    try {

        createSession(
            req,
            res,
            await requestToken({
                grant_type: "authorization_code",
                code,
                redirect_uri: REDIRECT_URI
            })
        );

    } catch (tokenError) {

        console.error("No se pudo completar el login:", tokenError.message);
        return res.redirect("/?auth=error");
    }

    res.redirect("/app");
});

app.get(
    "/auth/token",
    requireSession,
    route(async (req, res) => {

        const token = await getAccessToken(req.session);

        if (!token) {
            throw new SpotifyError("La sesión de Spotify ha caducado.", 401);
        }

        res.json({
            access_token: token,
            expires_in: Math.max(0, Math.floor((req.session.expiresAt - Date.now()) / 1000))
        });
    })
);

app.post("/auth/logout", (req, res) => {

    destroySession(req, res);

    res.sendStatus(204);
});

// Todo lo que cuelga de /api necesita que el navegador tenga su propia sesión.
app.use("/api", requireSession);

app.get(
    "/api/me",
    route(async (req, res) => {

        const me = await spotifyFetch(req.session, "/me");

        res.json({
            id: me.id,
            name: me.display_name || me.id
        });
    })
);


// =====================================================
// PLAYLISTS
// =====================================================

app.get(
    "/api/playlists",
    route(async (req, res) => {

        const playlists = [];

        let url =
            "/me/playlists?limit=50";

        while (url) {

            const data =
                await spotifyFetch(req.session, url);

            for (
                const playlist of
                data.items || []
            ) {

                if (!playlist) {
                    continue;
                }

                playlists.push({
                    id:
                        playlist.id,

                    name:
                        playlist.name,

                    owner:
                        playlist.owner
                            ?.display_name || "",

                    image:
                        playlist.images
                            ?.[0]?.url || null,

                    tracks:
                        playlist.items?.total ??
                        playlist.tracks?.total ??
                        0,

                    uri:
                        playlist.uri
                });
            }

            url =
                data.next
                    ? data.next.replace(
                        SPOTIFY_API,
                        ""
                    )
                    : null;
        }

        res.json(
            playlists.filter(
                playlist =>
                    playlist.tracks > 0
            )
        );
    })
);

app.get(
    "/api/playlists/:playlistId/tracks",
    route(async (req, res) => {

        const {
            tracks
        } =
            await getRandomPlaylistTracks(
                req.session,
                req.params.playlistId
            );

        res.json(tracks);
    })
);

app.get(
    "/api/playlists/:playlistId/catalog",
    route(async (req, res) => {

        res.json(
            shuffle(
                await getAllPlaylistTracks(
                    req.session,
                    req.params.playlistId
                )
            )
        );
    })
);

app.get(
    "/api/playlists/:playlistId/hipster",
    route(async (req, res) => {

        const { tracks } = await getRandomPlaylistTracks(req.session, req.params.playlistId, HIPSTER_TRACKS, hasYear);

        res.json(tracks);
    })
);

app.get(
    "/api/hipster/tracks",
    route(async (req, res) => {

        if (!HIPSTER_PLAYLIST_ID) {
            throw new SpotifyError("Hipster Global no está configurado en el servidor (falta HIPSTER_PLAYLIST_ID).", 503);
        }

        const { tracks } = await getRandomPlaylistTracks(req.session, HIPSTER_PLAYLIST_ID, HIPSTER_TRACKS, hasYear);

        res.json(tracks);
    })
);


// =====================================================
// REPRODUCCIÓN
// =====================================================

app.put(
    "/api/transfer",
    route(async (req, res) => {

        const {
            deviceId
        } = req.body;

        if (!deviceId) {

            throw new SpotifyError(
                "Falta el identificador del dispositivo.",
                400
            );
        }

        await spotifyFetch(
            req.session,
            "/me/player",
            {
                method: "PUT",

                headers: {
                    "Content-Type":
                        "application/json"
                },

                body:
                    JSON.stringify({
                        device_ids:
                            [deviceId],
                        play: false
                    })
            }
        );

        res.sendStatus(204);
    })
);

app.put(
    "/api/play",
    route(async (req, res) => {

        const {
            deviceId,
            trackUri,
            positionMs
        } = req.body;

        if (!deviceId) {

            throw new SpotifyError(
                "Falta el identificador del dispositivo.",
                400
            );
        }

        await spotifyFetch(
            req.session,
            `/me/player/play?device_id=${encodeURIComponent(deviceId)}`,
            {
                method: "PUT",

                headers: {
                    "Content-Type":
                        "application/json"
                },

                body:
                    JSON.stringify(
                        trackUri
                            ? {
                                uris:
                                    [trackUri],
                                position_ms:
                                    positionMs || 0
                            }
                            : {}
                    )
            }
        );

        res.sendStatus(204);
    })
);

app.put(
    "/api/pause",
    route(async (req, res) => {

        await spotifyFetch(
            req.session,
            "/me/player/pause",
            {
                method: "PUT"
            }
        );

        res.sendStatus(204);
    })
);


// =====================================================
// MUSICROULETTE — SALAS EN MEMORIA
// =====================================================

const ROUNDS = 5;
const COVERS_PER_ROUND = 5;
const ROUND_MS = 15000;
const BREAK_MS = 5000;
const MAX_PLAYERS = 10;
const RECONNECT_GRACE_MS = 30000;
const HEARTBEAT_MS = 25000;
const MIN_TRACKS = COVERS_PER_ROUND;

const rooms = new Map();

function send(
    ws,
    type,
    data = {}
) {

    if (
        ws?.readyState ===
        WebSocket.OPEN
    ) {

        ws.send(
            JSON.stringify({
                type,
                ...data
            })
        );
    }
}

function broadcast(
    room,
    type,
    data = {}
) {

    room.players.forEach(
        player =>
            send(
                player.ws,
                type,
                data
            )
    );
}

// Sin 0/O/1/I: el código se dicta y se escribe desde el móvil.
const CODE_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";

function createCode() {

    let code;

    do {
        code = Array.from({ length: 5 }, () => CODE_ALPHABET[crypto.randomInt(CODE_ALPHABET.length)]).join("");
    } while (rooms.has(code));

    return code;
}

// No se envía la playlist de cada jugador: delataría de quién es la música.
function roomState(room) {

    return {
        maxPlayers: MAX_PLAYERS,
        minTracks: MIN_TRACKS,
        code: room.code,
        hostId: room.hostId,
        status: room.status,
        players: room.players.map(player => ({
            id: player.id,
            name: player.name,
            connected: Boolean(player.ws),
            ready: Boolean(player.playlist && player.tracks.length >= MIN_TRACKS),
            score: player.score
        }))
    };
}

function broadcastState(room) {

    broadcast(
        room,
        "room_state",
        roomState(room)
    );
}

function buildRounds(room) {

    const eligible =
        room.players.filter(
            player =>
                player.tracks.length >=
                MIN_TRACKS
        );

    const owners = [];

    let pool = [];

    for (
        let i = 0;
        i < ROUNDS;
        i++
    ) {

        if (!pool.length) {
            pool =
                shuffle([
                    ...eligible
                ]);
        }

        owners.push(
            pool.pop()
        );
    }

    return owners.map(
        owner => ({

            ownerId:
                owner.id,

            tracks:
                shuffle([
                    ...owner.tracks
                ]).slice(
                    0,
                    COVERS_PER_ROUND
                )
        })
    );
}

function startGame(room) {

    if (
        room.status !== "lobby"
    ) {
        return;
    }

    if (
        room.players.length < 2
    ) {

        return broadcast(
            room,
            "error_message",
            {
                message:
                    "Hacen falta al menos dos jugadores."
            }
        );
    }

    const notReady =
        room.players.filter(
            player =>
                !player.playlist ||
                player.tracks.length <
                MIN_TRACKS
        );

    if (notReady.length) {

        return broadcast(
            room,
            "error_message",
            {
                message:
                    "Todos tienen que elegir una playlist antes de empezar."
            }
        );
    }

    room.status =
        "playing";

    room.currentRound =
        0;

    room.players.forEach(
        player => {

            player.score = 0;
            player.answer = null;
        }
    );

    room.rounds =
        buildRounds(room);

    startRound(room);
}

function startRound(room) {

    const round = room.rounds[room.currentRound];

    if (!round) {
        return finishGame(room);
    }

    room.startedAt = Date.now();
    room.roundOpen = true;
    room.players.forEach(player => { player.answer = null; });
    room.answers = shuffle(room.players.map(({ id, name }) => ({ id, name })));
    room.players.forEach(player => sendRoundStart(room, player, ROUND_MS));

    clearTimeout(room.timer);
    room.timer = setTimeout(() => finishRound(room), ROUND_MS);
}


function sendRoundStart(room, player, duration) {

    const round = room.rounds[room.currentRound];

    send(player.ws, "round_start", {
        round: room.currentRound + 1,
        totalRounds: ROUNDS,
        duration,
        tracks: round.tracks,
        answers: room.answers,
        isOwner: player.id === round.ownerId,
        answered: Boolean(player.answer)
    });
}

function handleVote(room, player, ownerId) {

    // Durante el descanso entre rondas currentRound ya apunta a la siguiente (o a ninguna).
    if (!room.roundOpen || player.answer) return;

    const round = room.rounds[room.currentRound];
    const elapsed = Date.now() - room.startedAt;

    if (
        player.id === round.ownerId ||
        elapsed > ROUND_MS ||
        !room.players.some(other => other.id === ownerId)
    ) {
        return;
    }

    player.answer = ownerId;

    const correct = ownerId === round.ownerId;

    if (correct) {
        player.score += 500 + Math.round(500 * (ROUND_MS - elapsed) / ROUND_MS);
    }

    send(player.ws, "vote_registered", { correct, score: player.score });

    finishIfEveryoneVoted(room);
}


function finishIfEveryoneVoted(room) {

    const { ownerId } = room.rounds[room.currentRound];

    if (room.players.every(player => player.id === ownerId || player.answer)) {
        finishRound(room);
    }
}

function finishRound(room) {

    if (!room.roundOpen) return;

    room.roundOpen = false;
    clearTimeout(room.timer);

    const round = room.rounds[room.currentRound];
    const owner = room.players.find(player => player.id === round.ownerId);

    room.lastResults = {
        ownerId: round.ownerId,
        ownerName: owner?.name || "Alguien que se fue",
        results: room.players
            .map(player => ({
                id: player.id,
                name: player.name,
                correct: player.answer === round.ownerId,
                answered: Boolean(player.answer),
                isOwner: player.id === round.ownerId,
                score: player.score
            }))
            .sort((a, b) => b.score - a.score)
    };

    broadcast(room, "round_results", room.lastResults);

    room.currentRound++;

    room.timer = setTimeout(
        () => (room.currentRound >= ROUNDS ? finishGame(room) : startRound(room)),
        BREAK_MS
    );
}

function scoreboard(room) {

    return room.players
        .map(({ id, name, score }) => ({ id, name, score }))
        .sort((a, b) => b.score - a.score);
}


function finishGame(room) {

    room.status = "finished";
    clearTimeout(room.timer);

    broadcast(room, "game_over", { scoreboard: scoreboard(room) });
}

function resetRoom(room) {

    clearTimeout(room.timer);

    room.status = "lobby";
    room.roundOpen = false;
    room.currentRound = 0;
    room.rounds = [];
    room.lastResults = null;
    room.players.forEach(player => {
        player.score = 0;
        player.answer = null;
    });

    broadcastState(room);
}

function leaveRoom(player) {

    clearTimeout(player.dropTimer);

    const room = rooms.get(player.room);

    player.room = null;

    if (!room) return;

    room.players = room.players.filter(other => other.id !== player.id);

    if (!room.players.length) {
        clearTimeout(room.timer);
        rooms.delete(room.code);
        return;
    }

    if (room.hostId === player.id) {
        room.hostId = room.players[0].id;
    }

    if (room.status === "playing" && room.players.length < 2) {
        broadcast(room, "error_message", { message: "No quedan jugadores suficientes. Vuelta a la sala." });
        return resetRoom(room);
    }

    if (room.roundOpen) finishIfEveryoneVoted(room);

    broadcastState(room);
}

function sanitizeName(value) {

    return (
        String(value || "")
            .trim()
            .slice(0, 20) ||
        "Jugador"
    );
}

// Las portadas se cargan en el navegador de los demás jugadores: solo se aceptan las del CDN de Spotify.
function isSpotifyCover(url) {

    return (
        typeof url === "string" &&
        url.startsWith("https://i.scdn.co/")
    );
}

function sanitizeTracks(value) {

    if (
        !Array.isArray(value)
    ) {
        return [];
    }

    return value
        .filter(
            track =>
                track?.id &&
                isSpotifyCover(track.cover)
        )
        .slice(0, 100)
        .map(
            track => ({

                id:
                    String(
                        track.id
                    ).slice(0, 40),

                name:
                    String(
                        track.name || ""
                    ).slice(0, 120),

                artist:
                    String(
                        track.artist || ""
                    ).slice(0, 120),

                cover:
                    String(
                        track.cover
                    ).slice(0, 300)
            })
        );
}

function uniqueName(room, name) {

    const taken = new Set(room.players.map(player => player.name));

    let candidate = name;

    for (let n = 2; taken.has(candidate); n++) candidate = `${name} ${n}`;

    return candidate;
}


function createPlayer(ws) {

    return {
        ws,
        id: crypto.randomBytes(4).toString("hex"),
        token: crypto.randomBytes(12).toString("hex"), // identifica al jugador al reconectar
        name: "Jugador",
        room: null,
        playlist: null,
        tracks: [],
        score: 0,
        answer: null,
        dropTimer: null
    };
}


function createRoom(player, message) {

    if (player.room) leaveRoom(player);

    player.name = sanitizeName(message.name);

    const room = {
        code: createCode(),
        hostId: player.id,
        players: [player],
        status: "lobby",
        rounds: [],
        currentRound: 0,
        timer: null,
        roundOpen: false,
        startedAt: 0,
        answers: [],
        lastResults: null
    };

    rooms.set(room.code, room);
    player.room = room.code;

    send(player.ws, "joined", { code: room.code, playerId: player.id, token: player.token });
    broadcastState(room);
}


function joinRoom(player, message) {

    const code = String(message.code || "").trim().toUpperCase();
    const room = rooms.get(code);
    const fail = text => send(player.ws, "error_message", { message: text });

    if (!room) return fail("No existe ninguna sala con ese código.");

    if (player.room === code) return;

    if (room.status !== "lobby") return fail("Esa partida ya ha empezado.");

    if (room.players.length >= MAX_PLAYERS) return fail("La sala está completa.");

    if (player.room) leaveRoom(player);

    player.name = uniqueName(room, sanitizeName(message.name));
    player.room = code;
    room.players.push(player);

    send(player.ws, "joined", { code, playerId: player.id, token: player.token });
    broadcastState(room);
}


// Un móvil que bloquea la pantalla pierde el socket: al volver recupera su sitio en la sala.
function rejoinRoom(connection, message) {

    const room = rooms.get(String(message.code || ""));
    const player = room?.players.find(other => other.token === message.token);

    if (!player) return send(connection.ws, "rejoin_failed");

    clearTimeout(player.dropTimer);

    if (player.ws && player.ws !== connection.ws) player.ws.close();

    player.ws = connection.ws;
    connection.player = player;

    send(player.ws, "joined", { code: room.code, playerId: player.id, token: player.token, resumed: true });
    broadcastState(room);
    resumePlayer(room, player);
}


// Reenvía a quien vuelve lo que le haría falta ver según el momento de la partida.
function resumePlayer(room, player) {

    if (room.status === "finished") {
        send(player.ws, "game_over", { scoreboard: scoreboard(room) });
    } else if (room.roundOpen) {
        sendRoundStart(room, player, Math.max(0, ROUND_MS - (Date.now() - room.startedAt)));
    } else if (room.status === "playing" && room.lastResults) {
        send(player.ws, "round_results", room.lastResults);
    }
}


function setPlaylist(room, player, message) {

    if (!room || room.status !== "lobby") return;

    const tracks = sanitizeTracks(message.tracks);

    if (tracks.length < MIN_TRACKS) {
        return send(player.ws, "error_message", {
            message: `Esa playlist solo tiene ${tracks.length} canciones con portada. Hacen falta ${MIN_TRACKS}.`
        });
    }

    player.playlist = {
        id: String(message.playlist?.id || ""),
        name: String(message.playlist?.name || "").slice(0, 80)
    };
    player.tracks = tracks;

    broadcastState(room);
}


function handleMessage(connection, message) {

    const { player } = connection;
    const room = player.room ? rooms.get(player.room) : null;
    const isHost = room?.hostId === player.id;

    switch (message.type) {
        case "create_room": return createRoom(player, message);
        case "join_room": return joinRoom(player, message);
        case "rejoin": return rejoinRoom(connection, message);
        case "set_playlist": return setPlaylist(room, player, message);
        case "start_game": return isHost && startGame(room);
        case "vote": return room && handleVote(room, player, message.ownerId);
        case "play_again": return isHost && resetRoom(room);
        case "leave_room": return leaveRoom(player);
    }
}


// Se conserva al jugador unos segundos: así un corte de red o un cambio de pestaña no lo expulsa.
function handleDisconnect({ ws, player }) {

    if (player.ws !== ws) return; // ya lo sustituyó una reconexión

    player.ws = null;

    const room = player.room && rooms.get(player.room);

    if (!room) return;

    broadcastState(room);
    player.dropTimer = setTimeout(() => leaveRoom(player), RECONNECT_GRACE_MS);
}


wss.on("connection", ws => {

    const connection = { ws, player: createPlayer(ws) };
    const disconnect = () => handleDisconnect(connection);

    ws.isAlive = true;
    ws.on("pong", () => { ws.isAlive = true; });

    ws.on("message", raw => {

        let message;

        try {
            message = JSON.parse(raw);
        } catch {
            return;
        }

        if (message && typeof message === "object") handleMessage(connection, message);
    });

    ws.on("close", disconnect);
    ws.on("error", disconnect);
});


// Los proxies cierran las conexiones inactivas; un ping periódico las mantiene y detecta las muertas.
const heartbeat = setInterval(() => {

    wss.clients.forEach(ws => {
        if (!ws.isAlive) return ws.terminate();
        ws.isAlive = false;
        ws.ping();
    });

}, HEARTBEAT_MS);

wss.on("close", () => clearInterval(heartbeat));


// =====================================================
// 404
// =====================================================

app.use(
    (req, res) => {

        if (
            req.path.startsWith(
                "/api/"
            )
        ) {

            return res
                .status(404)
                .json({
                    error:
                        "Ruta no encontrada."
                });
        }

        res.redirect("/");
    }
);


// =====================================================
// SERVIDOR
// =====================================================

server.listen(PORT, () => {
    console.log(`BeatPlay escuchando en el puerto ${PORT} (${CANONICAL_ORIGIN})`);
});