/*
 * SNAKE
 * Clásico: cada portada que comes cambia la canción.
 * Synth: además la serpiente acelera a lo largo de cada canción (posición real
 * del reproductor) y el tablero toma el color de la portada.
 */
import { refs, toast, pulse, shuffle, store } from "../../lib/ui.js";
import { tracks as loadTracks } from "../../lib/api.js";
import { player, positionNow } from "../../lib/player/index.js";

// La rejilla se adapta a la pantalla al entrar: apaisada en el ordenador, vertical en el móvil.
// Las casillas siempre son cuadradas; CELL es su tamaño interno de dibujo.
let COLS = 20;
let ROWS = 15;
const CELL = 40;
const TICK = { classic: 130, synthSlow: 150, synthFast: 90 };
const TOUCH_SLOWER = 15; // con el dedo se reacciona algo más lento que con el teclado
const SWIPE_PX = 22;
const BASE_COLOR = { h: 262, s: 22 }; // lila de la marca

const DIRECTIONS = { up: [0, -1], down: [0, 1], left: [-1, 0], right: [1, 0] };
const KEYS = {
    ArrowUp: "up", w: "up", W: "up",
    ArrowDown: "down", s: "down", S: "down",
    ArrowLeft: "left", a: "left", A: "left",
    ArrowRight: "right", d: "right", D: "right"
};
const HINTS = {
    classic: "Come portadas para cambiar de canción. No choques con las paredes ni contigo.",
    synth: "La serpiente acelera mientras avanza la canción y el tablero toma el color de su portada."
};

let ui = {};
let ctx = null;
let root = null;
let source = [];
let queue = [];
let queueIndex = -1;
let game = null;
let mode = store.get("snakeMode", "classic");
let frame = null;
let playback = null;
let unsubscribe = null;
let swipe = null;
let resizer = null;
let wakeLock = null;
let coarse = false;
let gridReady = false;

const images = new Map();
const palettes = new Map();


// =====================================================
// CICLO DE VIDA
// =====================================================

async function mount(container, { playlist }) {
    root = container;
    ui = refs(root);
    source = await loadTracks.sample(playlist.id);

    if (!source.length) throw new Error("Esta playlist no tiene canciones que se puedan reproducir.");

    ui.playlist.textContent = playlist.name;
    ui.best.textContent = store.get("snakeBest", 0);

    coarse = matchMedia("(pointer: coarse)").matches;
    gridReady = false;
    // La rejilla se elige cuando el tablero ya se ve y se puede medir (ver fitBoard).
    resizer = new ResizeObserver(fitBoard);
    resizer.observe(ui.board);
    source.forEach(track => preload(track.cover));

    unsubscribe = player.onState(state => { playback = state; });

    root.addEventListener("click", onClick);
    ui.board.addEventListener("pointerdown", onSwipe);
    ui.board.addEventListener("pointermove", onSwipe);
    ui.board.addEventListener("pointerup", onSwipe);
    ui.board.addEventListener("pointercancel", onSwipe);
    document.addEventListener("keydown", onKey);
    document.addEventListener("visibilitychange", onHidden);

    // Botones de dirección: giran al tocar, sin esperar al "click" (que en el móvil llega tarde).
    root.querySelector(".snake-pad").addEventListener("pointerdown", event => {
        const button = event.target.closest("[data-steer]");
        if (!button) return;
        event.preventDefault();
        steer(button.dataset.steer);
        navigator.vibrate?.(5);
    });

    setMode(mode);
    loadQueue();
    reset();
    draw(0);
    overlay("ready");
}

function unmount() {
    stopLoop();
    unsubscribe?.();
    resizer?.disconnect();
    releaseWakeLock();
    document.removeEventListener("keydown", onKey);
    document.removeEventListener("visibilitychange", onHidden);
    root = null;
    game = null;
    playback = null;
}

// Casillas cuadradas que llenan el hueco disponible, con un mínimo de 14 por lado.
function chooseGrid() {
    const { width, height } = ui.board.getBoundingClientRect();
    const aspect = width && height ? width / height : 4 / 3;
    const clamp = (value, min, max) => Math.min(max, Math.max(min, Math.round(value)));

    if (aspect < 1) {
        COLS = 14;
        ROWS = clamp(14 / aspect, 14, 26);
    } else {
        ROWS = 15;
        COLS = clamp(15 * aspect, 15, 26);
    }
}

// El tablero ocupa todo el hueco libre sin deformarse ni provocar scroll.
function fitBoard() {
    if (!root) return;
    const { width, height } = ui.board.getBoundingClientRect();
    if (!width || !height) return;

    if (!gridReady) {
        gridReady = true;
        chooseGrid();
        setupCanvas();
        if (!game?.running) {
            reset();
            draw(0);
        }
    }

    const scale = Math.min(width / (COLS * CELL), height / (ROWS * CELL));
    if (!scale) return;
    ui.stage.style.width = `${Math.floor(COLS * CELL * scale)}px`;
    ui.stage.style.height = `${Math.floor(ROWS * CELL * scale)}px`;
}

// Canvas nítido en pantallas de alta densidad.
function setupCanvas() {
    const ratio = Math.min(window.devicePixelRatio || 1, 2);
    ui.canvas.width = COLS * CELL * ratio;
    ui.canvas.height = ROWS * CELL * ratio;
    ctx = ui.canvas.getContext("2d");
    ctx.scale(ratio, ratio);
}


// =====================================================
// PARTIDA
// =====================================================

// La lista de canciones se carga una vez al entrar: otra partida sigue por donde iba, sin llamadas.
function loadQueue() {
    queue = shuffle([...source]);
    queueIndex = -1;
    player.load(queue);
}

function reset() {
    game = {
        snake: [{ x: Math.floor(COLS / 2) - 2, y: Math.floor(ROWS / 2), cover: null }],
        previous: [{ x: Math.floor(COLS / 2) - 2, y: Math.floor(ROWS / 2) }],
        food: null,
        track: null,
        direction: DIRECTIONS.right,
        next: DIRECTIONS.right,
        score: 0,
        running: false,
        accumulator: 0,
        last: 0,
        color: BASE_COLOR,
        flash: null // destello al comer
    };
    ui.score.textContent = "0";
}

function begin() {
    if (game?.running) return;

    reset();
    overlay(null);
    nextTrack();
    placeFood();

    game.running = true;
    game.last = performance.now();
    frame = requestAnimationFrame(loop);
    keepAwake();
}

// Pausa (cambio de pestaña, ir a la app de Spotify, tecla P o Espacio) y vuelta.
function pauseGame() {
    if (!game?.running) return;
    stopLoop();
    releaseWakeLock();
    player.pause();
    overlay("paused");
}

function resumeGame() {
    if (!game || game.running || !game.snake.length || ui.paused.classList.contains("hidden")) return;
    overlay(null);
    game.running = true;
    game.last = performance.now();
    game.accumulator = 0;
    frame = requestAnimationFrame(loop);
    keepAwake();
    player.resume().catch(() => {});
}

function onHidden() {
    if (document.hidden) pauseGame();
}

// En el móvil, que la pantalla no se apague a mitad de partida.
async function keepAwake() {
    try {
        wakeLock = await navigator.wakeLock?.request("screen");
    } catch {
        wakeLock = null;
    }
}

function releaseWakeLock() {
    wakeLock?.release().catch(() => {});
    wakeLock = null;
}

function end() {
    stopLoop();
    releaseWakeLock();
    player.pause();
    navigator.vibrate?.([30, 40, 60]);

    const best = store.get("snakeBest", 0);
    const record = game.score > best;

    if (record) {
        store.set("snakeBest", game.score);
        ui.best.textContent = game.score;
    }

    ui.final.textContent = game.score;
    ui.record.textContent = record ? "Nuevo récord" : `Récord: ${Math.max(best, game.score)}`;
    overlay("over");
}

function stopLoop() {
    if (game) game.running = false;
    cancelAnimationFrame(frame);
    frame = null;
}

function loop(now) {
    if (!game?.running) return;

    game.accumulator += Math.min(now - game.last, 250);
    game.last = now;

    const tick = currentTick();

    while (game.accumulator >= tick) {
        game.accumulator -= tick;
        step();
        if (!game.running) return;
    }

    draw(game.accumulator / tick);
    frame = requestAnimationFrame(loop);
}


// =====================================================
// MODO Y VELOCIDAD
// =====================================================

function setMode(next) {
    mode = next;
    store.set("snakeMode", mode);

    for (const button of root.querySelectorAll("[data-mode]")) {
        button.setAttribute("aria-pressed", String(button.dataset.mode === mode));
    }

    ui.hint.textContent = HINTS[mode];
    if (!game?.running) draw(0);
}

// Avance (0-1) de la canción que suena, solo si el reproductor habla de esta canción.
function songProgress() {
    if (!playback?.duration || playback.ref !== game?.track?.ref) return 0;
    return positionNow(playback) / playback.duration;
}

function currentTick() {
    const extra = coarse ? TOUCH_SLOWER : 0;
    if (mode !== "synth") return TICK.classic + extra;
    return TICK.synthSlow - (TICK.synthSlow - TICK.synthFast) * songProgress() + extra;
}


// =====================================================
// MOVIMIENTO
// =====================================================

function steer(name) {
    const [dx, dy] = DIRECTIONS[name];
    const [cx, cy] = game?.direction || [];

    // Se compara con la dirección ya aplicada: dos pulsaciones rápidas no permiten darse la vuelta.
    if (!game?.running || (dx === -cx && dy === -cy)) return;

    game.next = DIRECTIONS[name];
}

function step() {
    game.direction = game.next;

    const old = game.snake;
    const [dx, dy] = game.direction;
    const head = { x: old[0].x + dx, y: old[0].y + dy, cover: null };

    if (head.x < 0 || head.x >= COLS || head.y < 0 || head.y >= ROWS) return end();

    const ate = game.food && head.x === game.food.x && head.y === game.food.y;

    // Si come, la cola no se mueve este turno y también cuenta como obstáculo.
    const body = ate ? old : old.slice(0, -1);
    if (body.some(segment => segment.x === head.x && segment.y === head.y)) return end();

    // Cada segmento avanza a la posición del anterior y conserva su portada.
    const snake = [head, ...old.slice(0, -1).map((segment, i) => ({ x: segment.x, y: segment.y, cover: old[i + 1].cover }))];

    if (ate) {
        const tail = old[old.length - 1];
        snake.push({ x: tail.x, y: tail.y, cover: game.food.track.cover });
        game.score++;
        game.flash = { x: game.food.x, y: game.food.y, at: performance.now() };
        navigator.vibrate?.(12);
        ui.score.textContent = game.score;
        pulse(ui.score);
    }

    game.previous = old;
    game.snake = snake;

    if (ate) {
        nextTrack();
        placeFood();
        if (!game.food) end(); // tablero lleno
    }
}

// Cada portada pasa a la siguiente canción de la lista ya cargada: sin llamadas a la API.
function nextTrack() {
    if (queueIndex + 1 >= queue.length) loadQueue();
    queueIndex++;

    const track = queue[queueIndex];
    game.track = track;
    playback = null; // hasta que llegue el estado de la canción nueva, el avance es 0

    ui.cover.hidden = !track.cover;
    if (track.cover) ui.cover.src = track.cover;
    ui.track.textContent = track.name;
    ui.artist.textContent = track.artist;

    coverColor(track.cover).then(color => {
        if (game?.track === track) game.color = color;
    });

    player.playAt(queueIndex).catch(error => {
        console.error("Snake:", error);
        toast(error.message, { error: true });
    });
}

function placeFood() {
    const taken = new Set(game.snake.map(segment => `${segment.x},${segment.y}`));
    const free = [];

    for (let x = 0; x < COLS; x++) {
        for (let y = 0; y < ROWS; y++) {
            if (!taken.has(`${x},${y}`)) free.push({ x, y });
        }
    }

    game.food = free.length ? { ...free[Math.floor(Math.random() * free.length)], track: game.track } : null;
    preload(game.track?.cover);
}


// =====================================================
// COLOR DE LA PORTADA
// =====================================================

// Matiz medio de la portada, dando más peso a los píxeles vivos que a los grises.
function dominantColor(image) {
    const size = 16;
    const canvas = Object.assign(document.createElement("canvas"), { width: size, height: size });
    const context = canvas.getContext("2d", { willReadFrequently: true });

    context.drawImage(image, 0, 0, size, size);

    let pixels;
    try {
        pixels = context.getImageData(0, 0, size, size).data;
    } catch {
        return BASE_COLOR; // el CDN no deja leer los píxeles
    }

    let x = 0, y = 0, weight = 0, saturation = 0;

    for (let i = 0; i < pixels.length; i += 4) {
        const r = pixels[i] / 255, g = pixels[i + 1] / 255, b = pixels[i + 2] / 255;
        const max = Math.max(r, g, b), min = Math.min(r, g, b);
        const l = (max + min) / 2, d = max - min;
        if (!d) continue;

        const s = d / (1 - Math.abs(2 * l - 1));
        const h = (max === r ? ((g - b) / d) % 6 : max === g ? (b - r) / d + 2 : (r - g) / d + 4) * 60;
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

function coverColor(src) {
    if (!src) return Promise.resolve(BASE_COLOR);

    if (!palettes.has(src)) {
        palettes.set(src, new Promise(resolve => {
            const image = new Image();
            image.crossOrigin = "anonymous"; // sin esto el canvas no deja leer los píxeles
            image.onload = () => resolve(dominantColor(image));
            image.onerror = () => resolve(BASE_COLOR);
            image.src = src;
        }));
    }

    return palettes.get(src);
}


// =====================================================
// DIBUJO
// =====================================================

function preload(src) {
    if (!src || images.has(src)) return;
    const image = new Image();
    image.decoding = "async";
    image.src = src;
    images.set(src, image);
}

const tint = (l, a = 1) => `hsl(${game.color.h} ${game.color.s}% ${l}% / ${a})`;
const lerp = (a, b, t) => a + (b - a) * t;

function draw(alpha) {
    if (!ctx || !game) return;

    const synth = mode === "synth";
    const W = COLS * CELL, H = ROWS * CELL;

    ctx.fillStyle = synth ? tint(6) : "#0d0d0c";
    ctx.fillRect(0, 0, W, H);

    // Rejilla de puntos: marca las casillas sin cargar el tablero.
    ctx.fillStyle = synth ? tint(55, 0.22) : "#262624";
    for (let x = 1; x < COLS; x++) {
        for (let y = 1; y < ROWS; y++) ctx.fillRect(x * CELL - 1, y * CELL - 1, 2, 2);
    }

    drawFood(synth);
    drawFlash();

    // Cuerpo: interpolado entre el paso anterior y el actual para que se mueva suave.
    for (let i = game.snake.length - 1; i >= 1; i--) {
        const now = game.snake[i];
        const before = game.previous[i] || now;
        cell(now.cover, lerp(before.x, now.x, alpha) * CELL, lerp(before.y, now.y, alpha) * CELL, synth ? tint(50) : "#8b78a5");
    }

    drawHead(alpha, synth ? tint(70) : "#f1f0eb");

    if (synth) {
        ctx.fillStyle = tint(65);
        ctx.fillRect(0, 0, W * songProgress(), 4);
    }
}

function cell(cover, px, py, fallback, inset = 3) {
    const image = cover && images.get(cover);
    const size = CELL - inset * 2;

    ctx.save();
    ctx.beginPath();
    ctx.roundRect(px + inset, py + inset, size, size, 4);
    ctx.clip();

    if (image?.complete && image.naturalWidth) ctx.drawImage(image, px + inset, py + inset, size, size);
    else {
        ctx.fillStyle = fallback;
        ctx.fill();
    }

    ctx.restore();
}

function drawFood(synth) {
    if (!game.food) return;

    // La comida late suavemente para que se encuentre de un vistazo.
    const beat = (Math.sin(performance.now() / 180) + 1) / 2;
    const { x, y } = game.food;

    ctx.strokeStyle = synth ? tint(70, 0.5 + beat * 0.5) : `rgb(241 240 235 / ${0.35 + beat * 0.5})`;
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.roundRect(x * CELL + 1, y * CELL + 1, CELL - 2, CELL - 2, 6);
    ctx.stroke();

    cell(game.food.track?.cover, x * CELL, y * CELL, synth ? tint(60) : "#ab9bc6", 4);
}

function drawFlash() {
    const flash = game.flash;
    if (!flash) return;

    const t = (performance.now() - flash.at) / 360;
    if (t >= 1) {
        game.flash = null;
        return;
    }

    ctx.strokeStyle = `rgb(241 240 235 / ${1 - t})`;
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.arc(flash.x * CELL + CELL / 2, flash.y * CELL + CELL / 2, CELL * (0.5 + t * 0.9), 0, Math.PI * 2);
    ctx.stroke();
}

function drawHead(alpha, color) {
    const now = game.snake[0];
    const before = game.previous[0] || now;
    const cx = lerp(before.x, now.x, alpha) * CELL + CELL / 2;
    const cy = lerp(before.y, now.y, alpha) * CELL + CELL / 2;
    const [dx, dy] = game.direction;
    const half = CELL * 0.42;

    ctx.fillStyle = color;
    ctx.beginPath();
    ctx.roundRect(cx - half, cy - half, half * 2, half * 2, 8);
    ctx.fill();

    // Ojos hacia donde avanza.
    ctx.fillStyle = "#0a0a0a";
    for (const side of [-1, 1]) {
        ctx.beginPath();
        ctx.arc(cx + dx * 7 - dy * 7 * side, cy + dy * 7 + dx * 7 * side, 3, 0, Math.PI * 2);
        ctx.fill();
    }
}


// =====================================================
// INTERFAZ Y CONTROLES
// =====================================================

function overlay(which) {
    ui.ready.classList.toggle("hidden", which !== "ready");
    ui.over.classList.toggle("hidden", which !== "over");
    ui.paused.classList.toggle("hidden", which !== "paused");

    const panel = { ready: ui.ready, over: ui.over, paused: ui.paused }[which];
    panel?.querySelector("[data-action]")?.focus({ preventScroll: true });
}

function onClick(event) {
    const target = event.target.closest("[data-mode], [data-steer], [data-action]");
    if (!target) return;

    if (target.dataset.mode) setMode(target.dataset.mode);
    else if (target.dataset.steer) {
        if (event.detail === 0) steer(target.dataset.steer); // con teclado; con el dedo ya giró al tocar
    }
    else if (target.dataset.action === "start") begin();
    else if (target.dataset.action === "menu") overlay("ready");
    else if (target.dataset.action === "resume") resumeGame();
    else if (target.dataset.action === "pause") pauseGame();
}

function onKey(event) {
    if ((event.key === "p" || event.key === "P" || event.key === " " || event.key === "Escape") && game) {
        if (game.running) {
            event.preventDefault();
            pauseGame();
        } else if (!ui.paused.classList.contains("hidden") && event.key !== "Escape") {
            event.preventDefault();
            resumeGame();
        }
        return;
    }

    const name = KEYS[event.key];
    if (!game?.running || !name) return;
    event.preventDefault();
    steer(name);
}

// Se gira en cuanto el dedo recorre unos píxeles, sin levantarlo: se pueden encadenar giros.
function onSwipe(event) {
    if (event.pointerType === "mouse") return;
    if (event.target.closest("button")) return;

    if (event.type === "pointerdown") {
        swipe = { x: event.clientX, y: event.clientY };
        ui.board.setPointerCapture?.(event.pointerId);
        return;
    }

    if (event.type !== "pointermove") {
        swipe = null;
        return;
    }

    if (!swipe) return;

    const dx = event.clientX - swipe.x;
    const dy = event.clientY - swipe.y;
    if (Math.max(Math.abs(dx), Math.abs(dy)) < SWIPE_PX) return;

    steer(Math.abs(dx) > Math.abs(dy) ? (dx > 0 ? "right" : "left") : (dy > 0 ? "down" : "up"));
    swipe = { x: event.clientX, y: event.clientY };
}


export default {
    template: "/games/snake/snake.html",
    cta: "Jugar a Snake",
    needsPlaylist: true,
    mount,
    unmount
};
