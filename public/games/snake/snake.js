/* =========================================================
   BEATPLAY — SNAKE
   Clásico: cada portada que comes cambia la canción.
   Synth: además el juego sigue a la canción que suena (la
   posición y duración reales del reproductor de Spotify) y
   toma su color de la portada. Spotify no da tempo ni beats
   a las apps nuevas, así que no se simula ningún ritmo.
========================================================= */

const SNAKE = { cols: 20, rows: 15, cell: 40, tick: 130 };

// En Synth el intervalo baja de slow a fast a lo largo de cada canción.
const SYNTH = { slowTick: 150, fastTick: 90 };

const SNAKE_GREEN = { h: 141, s: 70 };

const SNAKE_DIRECTIONS = {
    up: { x: 0, y: -1 },
    down: { x: 0, y: 1 },
    left: { x: -1, y: 0 },
    right: { x: 1, y: 0 }
};

const SNAKE_KEYS = {
    ArrowUp: "up", w: "up", W: "up",
    ArrowDown: "down", s: "down", S: "down",
    ArrowLeft: "left", a: "left", A: "left",
    ArrowRight: "right", d: "right", D: "right"
};

const SNAKE_HINTS = {
    classic: "Come las portadas para cambiar de canción.",
    synth: "Come las portadas. La serpiente acelera con cada canción y toma el color de su portada."
};

let snakeSource = [];
let snakeTracks = [];
let snake = [];
let previousSnake = [];
let food = null;
let currentTrack = null;
let currentTrackIndex = -1;
let direction = SNAKE_DIRECTIONS.right;
let nextDirection = SNAKE_DIRECTIONS.right;
let score = 0;
let snakeRunning = false;
let animationFrame = null;
let lastFrameTime = 0;
let accumulator = 0;
let snakeMode = readSnakeMode();
let snakePalette = SNAKE_GREEN;
let snakePlayback = null; // último estado del reproductor y cuándo llegó
let snakeUnsubscribe = null;
let snakeSwipeStart = null;
let snakeUi = {};

const imageCache = new Map();
const paletteCache = new Map();


function bindSnakeUi() {

    const $ = id => document.getElementById(id);

    snakeUi = {
        canvas: $("gameCanvas"),
        playlist: $("gamePlaylistName"),
        score: $("score"),
        album: $("gameAlbumImage"),
        track: $("gameTrackName"),
        artist: $("gameArtistName"),
        ready: $("snakeReady"),
        gameOver: $("snakeGameOver"),
        finalScore: $("snakeFinalScore"),
        hint: $("snakeModeHint"),
        footerHint: $("snakeFooterHint"),
        startButton: $("startSnakeButton"),
        restartButton: $("restartSnakeButton")
    };

    snakeUi.ctx = snakeUi.canvas.getContext("2d");
}


function readSnakeMode() {

    try {
        return localStorage.getItem("snakeMode") === "synth" ? "synth" : "classic";
    } catch {
        return "classic";
    }
}


// =====================================================
// INICIO Y FIN
// =====================================================

function startSnake(tracks, playlistName) {

    if (!tracks?.length) {
        throw new Error("Snake necesita canciones.");
    }

    haltSnakeLoop();
    bindSnakeUi();

    snakeSource = tracks;

    snakeUi.playlist.textContent = playlistName || "";
    snakeUi.canvas.width = SNAKE.cols * SNAKE.cell;
    snakeUi.canvas.height = SNAKE.rows * SNAKE.cell;

    tracks.forEach(track => preloadImage(track.cover));

    snakeUnsubscribe?.();
    snakeUnsubscribe = onPlayerState(state => {
        snakePlayback = { state, receivedAt: performance.now() };
    });

    setSnakeMode(snakeMode);
    resetSnakeState();
    updateTrackUI(null);
    showSnakeOverlay("ready");
    drawSnake(0);
}


function haltSnakeLoop() {

    snakeRunning = false;

    if (animationFrame !== null) {
        cancelAnimationFrame(animationFrame);
        animationFrame = null;
    }
}


function stopSnake() {

    haltSnakeLoop();

    snakeUnsubscribe?.();
    snakeUnsubscribe = null;
    snakePlayback = null;

    pauseSpotify();
}


function resetSnakeState() {

    snakeTracks = shuffle(snakeSource.map(track => ({ ...track })));
    snake = [{ x: 10, y: 7, cover: null }];
    previousSnake = cloneSnake(snake);
    food = null;
    currentTrack = null;
    currentTrackIndex = -1;
    score = 0;
    direction = SNAKE_DIRECTIONS.right;
    nextDirection = SNAKE_DIRECTIONS.right;
    accumulator = 0;
    lastFrameTime = 0;
    snakePlayback = null;
    snakePalette = SNAKE_GREEN;

    updateScore();
}


async function beginSnake() {

    if (snakeRunning || !snakeSource.length) return;

    showSnakeOverlay(null);
    resetSnakeState();

    lastFrameTime = performance.now();

    await nextSnakeTrack();

    if (!currentTrack) {
        gameOver();
        return;
    }

    createFood();

    snakeRunning = true;
    animationFrame = requestAnimationFrame(snakeFrame);
}


function gameOver() {

    haltSnakeLoop();
    pauseSpotify();

    snakeUi.finalScore.textContent = `Puntuación: ${score}`;
    showSnakeOverlay("gameOver");
}


// =====================================================
// MODO
// =====================================================

function setSnakeMode(mode) {

    snakeMode = mode;

    try {
        localStorage.setItem("snakeMode", mode);
    } catch {
        /* almacenamiento bloqueado: el modo solo dura esta sesión */
    }

    document.querySelectorAll("[data-snake-mode]").forEach(button => {
        button.setAttribute("aria-pressed", String(button.dataset.snakeMode === mode));
    });

    snakeUi.hint.textContent = SNAKE_HINTS[mode];
    snakeUi.footerHint.textContent = mode === "synth" ? "LA VELOCIDAD SIGUE A LA CANCIÓN" : "COME PARA CAMBIAR DE CANCIÓN";

    if (!snakeRunning) drawSnake(0);
}


// Avance (0-1) de la canción actual según el reproductor. Solo cuenta si el estado es de esta canción.
function songProgress() {

    if (!snakePlayback || !currentTrack) return 0;

    const { state, receivedAt } = snakePlayback;

    if (!state.duration || state.track_window?.current_track?.uri !== currentTrack.uri) return 0;

    const position = state.position + (state.paused ? 0 : performance.now() - receivedAt);

    return Math.min(1, Math.max(0, position / state.duration));
}


function currentTick() {

    if (snakeMode !== "synth") return SNAKE.tick;

    return SYNTH.slowTick - (SYNTH.slowTick - SYNTH.fastTick) * songProgress();
}


// =====================================================
// BUCLE
// =====================================================

function snakeFrame(now) {

    if (!snakeRunning) return;

    if (!lastFrameTime) lastFrameTime = now;

    accumulator += Math.min(now - lastFrameTime, 250);
    lastFrameTime = now;

    const tick = currentTick();

    while (accumulator >= tick) {

        accumulator -= tick;
        updateSnake();

        if (!snakeRunning) return;
    }

    drawSnake(accumulator / tick);
    animationFrame = requestAnimationFrame(snakeFrame);
}


// =====================================================
// CONTROLES
// =====================================================

// Se compara con la dirección ya aplicada, así dos pulsaciones rápidas no permiten dar la vuelta sobre uno mismo.
function steer(name) {

    const next = SNAKE_DIRECTIONS[name];

    if (!snakeRunning || (next.x === -direction.x && next.y === -direction.y)) return;

    nextDirection = next;
}


function handleSnakeKeyboard(event) {

    const name = SNAKE_KEYS[event.key];

    if (!snakeRunning || !name) return;

    event.preventDefault();
    steer(name);
}


function handleSwipe(event) {

    if (event.pointerType !== "touch") return;

    if (event.type === "pointerdown") {
        snakeSwipeStart = { x: event.clientX, y: event.clientY };
        return;
    }

    if (!snakeSwipeStart) return;

    const dx = event.clientX - snakeSwipeStart.x;
    const dy = event.clientY - snakeSwipeStart.y;

    snakeSwipeStart = null;

    if (Math.max(Math.abs(dx), Math.abs(dy)) < 24) return;

    steer(Math.abs(dx) > Math.abs(dy) ? (dx > 0 ? "right" : "left") : (dy > 0 ? "down" : "up"));
}


// =====================================================
// MOVIMIENTO
// =====================================================

function updateSnake() {

    direction = nextDirection;

    const oldSnake = cloneSnake(snake);
    const head = oldSnake[0];
    const newHead = { x: head.x + direction.x, y: head.y + direction.y, cover: null };

    if (newHead.x < 0 || newHead.x >= SNAKE.cols || newHead.y < 0 || newHead.y >= SNAKE.rows) {
        gameOver();
        return;
    }

    const ateFood = food && newHead.x === food.x && newHead.y === food.y;

    // Si come, la cola no se mueve este turno y por tanto también cuenta como obstáculo.
    const limit = ateFood ? oldSnake.length : oldSnake.length - 1;

    for (let i = 1; i < limit; i++) {
        if (oldSnake[i].x === newHead.x && oldSnake[i].y === newHead.y) {
            gameOver();
            return;
        }
    }

    const newSnake = [newHead];

    for (let i = 0; i < oldSnake.length - 1; i++) {
        newSnake.push({ x: oldSnake[i].x, y: oldSnake[i].y, cover: oldSnake[i + 1].cover || null });
    }

    if (ateFood) {

        const tail = oldSnake[oldSnake.length - 1];

        score++;
        updateScore();

        newSnake.push({ x: tail.x, y: tail.y, cover: food.track?.cover || null });
        preloadImage(food.track?.cover);
    }

    previousSnake = oldSnake;
    snake = newSnake;

    // La comida nueva se coloca con la serpiente ya actualizada: antes podía aparecer sobre la cabeza o la cola.
    if (ateFood) {

        nextSnakeTrack();
        createFood();

        // Sin ningún hueco libre la serpiente ha llenado el tablero.
        if (!food) gameOver();
    }
}


async function nextSnakeTrack() {

    if (!snakeTracks.length) return;

    if (++currentTrackIndex >= snakeTracks.length) {
        currentTrackIndex = 0;
        snakeTracks = shuffle(snakeTracks.map(track => ({ ...track })));
    }

    currentTrack = snakeTracks[currentTrackIndex];
    snakePlayback = null; // hasta que llegue el estado de la canción nueva, el avance es 0

    updateTrackUI(currentTrack);
    preloadImage(currentTrack.cover);

    const track = currentTrack;

    coverPalette(track.cover).then(palette => {
        if (currentTrack === track) snakePalette = palette;
    });

    try {
        await playSpotifyTrack(track.uri);
    } catch (error) {
        console.error("Error reproduciendo Snake:", error);
        toast(error.message);
    }
}


function createFood() {

    const free = [];

    for (let x = 0; x < SNAKE.cols; x++) {
        for (let y = 0; y < SNAKE.rows; y++) {
            if (!snake.some(segment => segment.x === x && segment.y === y)) free.push({ x, y });
        }
    }

    if (!free.length || !currentTrack) {
        food = null;
        return;
    }

    food = { ...free[Math.floor(Math.random() * free.length)], track: currentTrack };
}


function cloneSnake(segments) {
    return segments.map(segment => ({ ...segment }));
}


// =====================================================
// COLOR DE LA PORTADA (modo Synth)
// =====================================================

function rgbToHsl(r, g, b) {

    r /= 255; g /= 255; b /= 255;

    const max = Math.max(r, g, b);
    const min = Math.min(r, g, b);
    const l = (max + min) / 2;
    const d = max - min;

    if (!d) return [0, 0, l];

    const s = d / (1 - Math.abs(2 * l - 1));
    const h = max === r ? ((g - b) / d) % 6 : max === g ? (b - r) / d + 2 : (r - g) / d + 4;

    return [(h * 60 + 360) % 360, s, l];
}


// Matiz medio de la portada, dando más peso a los píxeles vivos que a los grises, blancos o negros.
function dominantPalette(image) {

    const size = 16;
    const canvas = document.createElement("canvas");

    canvas.width = canvas.height = size;

    const ctx = canvas.getContext("2d", { willReadFrequently: true });

    ctx.drawImage(image, 0, 0, size, size);

    let pixels;

    try {
        pixels = ctx.getImageData(0, 0, size, size).data;
    } catch {
        return SNAKE_GREEN; // el CDN no permite leer los píxeles
    }

    let x = 0, y = 0, weight = 0, saturation = 0;

    for (let i = 0; i < pixels.length; i += 4) {

        const [h, s, l] = rgbToHsl(pixels[i], pixels[i + 1], pixels[i + 2]);
        const w = s * (1 - Math.abs(2 * l - 1));

        x += Math.cos(h * Math.PI / 180) * w;
        y += Math.sin(h * Math.PI / 180) * w;
        saturation += s * w;
        weight += w;
    }

    if (weight < 0.5) return { h: 0, s: 0 }; // portada casi en blanco y negro

    return {
        h: Math.round((Math.atan2(y, x) * 180 / Math.PI + 360) % 360),
        s: Math.round(Math.max(65, saturation / weight * 100))
    };
}


function coverPalette(src) {

    if (!src) return Promise.resolve(SNAKE_GREEN);

    if (!paletteCache.has(src)) {

        paletteCache.set(src, new Promise(resolve => {

            const image = new Image();

            // Sin crossOrigin el canvas quedaría "contaminado" y no podríamos leer los píxeles.
            image.crossOrigin = "anonymous";
            image.onload = () => resolve(dominantPalette(image));
            image.onerror = () => resolve(SNAKE_GREEN);
            image.src = src;
        }));
    }

    return paletteCache.get(src);
}


// =====================================================
// DIBUJO
// =====================================================

function tint(lightness, alpha = 1) {
    return `hsl(${snakePalette.h} ${snakePalette.s}% ${lightness}% / ${alpha})`;
}


function drawSnake(alpha = 0) {

    const { ctx, canvas } = snakeUi;

    if (!ctx) return;

    const synth = snakeMode === "synth";

    ctx.fillStyle = synth ? "#06060a" : "#080808";
    ctx.fillRect(0, 0, canvas.width, canvas.height);

    drawGrid(ctx, synth ? tint(50, 0.16) : "#111");
    drawFood(ctx, synth);
    drawBody(ctx, alpha, synth);
    drawHead(ctx, alpha, synth ? tint(62) : "#1ed760");

    if (synth) {
        ctx.fillStyle = tint(60);
        ctx.fillRect(0, 0, canvas.width * songProgress(), 4);
    }
}


function drawGrid(ctx, color) {

    const width = SNAKE.cols * SNAKE.cell;
    const height = SNAKE.rows * SNAKE.cell;

    ctx.strokeStyle = color;
    ctx.lineWidth = 1;
    ctx.beginPath();

    for (let x = 0; x <= SNAKE.cols; x++) {
        ctx.moveTo(x * SNAKE.cell, 0);
        ctx.lineTo(x * SNAKE.cell, height);
    }

    for (let y = 0; y <= SNAKE.rows; y++) {
        ctx.moveTo(0, y * SNAKE.cell);
        ctx.lineTo(width, y * SNAKE.cell);
    }

    ctx.stroke();
}


// Portada si ya cargó; si no, un cuadrado de color.
function drawCell(ctx, cover, px, py, fallback) {

    const image = cover ? imageCache.get(cover) : null;

    if (image?.complete && image.naturalWidth) {
        ctx.drawImage(image, px + 2, py + 2, SNAKE.cell - 4, SNAKE.cell - 4);
        return;
    }

    ctx.fillStyle = fallback;
    ctx.fillRect(px + 3, py + 3, SNAKE.cell - 6, SNAKE.cell - 6);
}


function drawFood(ctx, synth) {

    if (!food) return;

    if (synth) {
        ctx.shadowColor = tint(60);
        ctx.shadowBlur = 14;
    }

    drawCell(ctx, food.track?.cover, food.x * SNAKE.cell, food.y * SNAKE.cell, synth ? tint(60) : "#1db954");

    ctx.shadowBlur = 0;
}


function drawBody(ctx, alpha, synth) {

    for (let i = 1; i < snake.length; i++) {

        const current = snake[i];
        const previous = previousSnake[i] || current;
        const x = previous.x + (current.x - previous.x) * alpha;
        const y = previous.y + (current.y - previous.y) * alpha;

        drawCell(ctx, current.cover, x * SNAKE.cell, y * SNAKE.cell, synth ? tint(50) : "#1db954");
    }
}


function drawHead(ctx, alpha, color) {

    if (!snake.length) return;

    const current = snake[0];
    const previous = previousSnake[0] || current;
    const centerX = (previous.x + (current.x - previous.x) * alpha) * SNAKE.cell + SNAKE.cell / 2;
    const centerY = (previous.y + (current.y - previous.y) * alpha) * SNAKE.cell + SNAKE.cell / 2;
    const half = SNAKE.cell * 0.4;
    const { x: dx, y: dy } = direction;

    // Triángulo apuntando en la dirección de avance: la punta y los dos extremos de la base.
    const tip = [centerX + dx * half, centerY + dy * half];
    const baseA = [centerX - dx * half + dy * half, centerY - dy * half + dx * half];
    const baseB = [centerX - dx * half - dy * half, centerY - dy * half - dx * half];

    ctx.fillStyle = color;
    ctx.beginPath();
    ctx.moveTo(...tip);
    ctx.lineTo(...baseA);
    ctx.lineTo(...baseB);
    ctx.closePath();
    ctx.fill();

    // Ojos: a los lados de la dirección de avance.
    ctx.fillStyle = "#080808";

    for (const side of [-1, 1]) {
        ctx.beginPath();
        ctx.arc(centerX + dx * 8 + -dy * 6 * side, centerY + dy * 8 + dx * 6 * side, 2, 0, Math.PI * 2);
        ctx.fill();
    }
}


function preloadImage(src) {

    if (!src || imageCache.has(src)) return;

    const image = new Image();

    image.decoding = "async";
    image.src = src;
    imageCache.set(src, image);
}


// =====================================================
// INTERFAZ
// =====================================================

function updateTrackUI(track) {

    snakeUi.album.hidden = !track?.cover;

    if (track?.cover) snakeUi.album.src = track.cover;

    snakeUi.track.textContent = track?.name || "—";
    snakeUi.artist.textContent = track?.artist || "—";
}


function updateScore() {
    if (snakeUi.score) snakeUi.score.textContent = score;
}


function showSnakeOverlay(which) {

    snakeUi.ready.classList.toggle("hidden", which !== "ready");
    snakeUi.gameOver.classList.toggle("hidden", which !== "gameOver");

    // El botón del overlay recibe el foco para poder empezar con teclado.
    if (which === "ready") snakeUi.startButton.focus({ preventScroll: true });
    if (which === "gameOver") snakeUi.restartButton.focus({ preventScroll: true });
}


// =====================================================
// EVENTOS
// =====================================================

document.addEventListener("keydown", handleSnakeKeyboard);

document.addEventListener("pointerdown", event => {
    if (event.target.closest("#gameCanvas")) handleSwipe(event);
});

document.addEventListener("pointerup", event => {
    if (event.target.closest("#gameCanvas")) handleSwipe(event);
});

document.addEventListener("click", event => {

    const mode = event.target.closest("[data-snake-mode]");
    const steerButton = event.target.closest("[data-steer]");

    if (mode) {
        setSnakeMode(mode.dataset.snakeMode);
    } else if (steerButton) {
        steer(steerButton.dataset.steer);
    } else if (event.target.closest("#startSnakeButton, #restartSnakeButton")) {
        beginSnake();
    }
});
