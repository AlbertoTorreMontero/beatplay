/*
 * PORTADA PIXELADA
 * Sale la portada de una canción de tu playlist hecha cuadraditos y hay que decir de qué ARTISTA es
 * (un artista tiene muchas canciones con la misma portada: pedir el título sería injusto). Cada fallo (o "Más nítida")
 * la aclara un poco. Cuanto antes la aciertes, más puntos; si se acaba sin acertar, se pierde la racha.
 * Al resolverla suena la canción.
 *
 * Llamadas a la API: una para leer la playlist y una por canción, solo al resolverla.
 */
import { refs, h, pulse, shuffle, store } from "../../lib/ui.js";
import { tracks as loadTracks } from "../../lib/api.js";
import { player } from "../../lib/player/index.js";
import { songSearch } from "../../lib/song-search.js";

const LEVELS = [5, 8, 12, 18, 28, 48]; // cuadraditos por lado en cada intento
const POINTS = [6, 5, 4, 3, 2, 1];
const MIN_SONGS = 5;

let ui = {};
let root = null;
let search = null;
let deck = [];
let index = -1;
let level = 0;
let score = 0;
let streak = 0;
let image = null;

async function mount(container, { playlist }) {
    root = container;
    ui = refs(root);

    const tracks = (await loadTracks.sample(playlist.id)).filter(track => track.cover);
    if (tracks.length < MIN_SONGS) throw new Error(`Hacen falta al menos ${MIN_SONGS} canciones con portada.`);

    ui.playlist.textContent = playlist.name;
    ui.best.textContent = store.get("pixelBest", 0);
    deck = spread(tracks);
    if (deck.length < MIN_SONGS) throw new Error(`Hacen falta al menos ${MIN_SONGS} portadas distintas.`);
    player.load(deck);

    // Se elige artista. Cuenta cualquiera de los artistas de la canción.
    const names = new Map();
    for (const track of tracks) for (const name of artistsOf(track)) names.set(name.toLowerCase(), name);
    search = songSearch(ui.search, { onPick: guess, placeholder: "Escribe el artista" });
    search.setChoices([...names].map(([id, name]) => ({ id, name, artist: "" })).sort((a, b) => a.name.localeCompare(b.name)));
    ui.stages.replaceChildren(...LEVELS.map(() => h("span")));

    root.addEventListener("click", onClick);
    score = 0;
    streak = 0;
    index = -1;
    next();
}

function unmount() {
    root = null;
}

function next() {
    if (++index >= deck.length) {
        deck = spread(deck);
        player.load(deck);
        index = 0;
    }
    level = 0;
    ui.attempts.replaceChildren();
    ui.reveal.classList.add("hidden");
    ui.board.classList.remove("hidden");
    search.disable(false);
    search.clear();
    setStatus("¿De qué artista es esta portada?");

    image = new Image();
    image.onload = draw;
    image.src = deck[index].cover;
    draw();
}

// Se dibuja la portada en pequeño y se amplía sin suavizar: quedan los cuadraditos.
function draw() {
    const canvas = ui.canvas;
    const ctx = canvas.getContext("2d");
    ctx.fillStyle = "#131312";
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    [...ui.stages.children].forEach((bar, i) => bar.classList.toggle("open", i <= level));
    ui.skip.textContent = level < LEVELS.length - 1 ? "Más nítida" : "Rendirse";
    if (!image?.complete || !image.naturalWidth) return;

    const n = LEVELS[level];
    const small = Object.assign(document.createElement("canvas"), { width: n, height: n });
    small.getContext("2d").drawImage(image, 0, 0, n, n);
    ctx.imageSmoothingEnabled = false;
    ctx.drawImage(small, 0, 0, canvas.width, canvas.height);
}

const artistsOf = track => (track.artist || "").split(", ").map(name => name.trim()).filter(Boolean);

// Una canción por portada y sin el mismo artista dos veces seguidas.
function spread(tracks) {
    const byCover = new Map();
    for (const track of shuffle([...tracks])) if (!byCover.has(track.cover)) byCover.set(track.cover, track);
    const pool = [...byCover.values()];
    const result = [];
    while (pool.length) {
        const last = result.at(-1);
        const i = pool.findIndex(track => !last || artistsOf(track)[0] !== artistsOf(last)[0]);
        result.push(pool.splice(Math.max(0, i), 1)[0]);
    }
    return result;
}

function guess(choice) {
    if (artistsOf(deck[index]).some(name => name.toLowerCase() === choice.id)) return finish(true);
    ui.attempts.append(h("li", { class: "wrong" }, `✕ ${choice.name}`));
    advance();
}

function advance() {
    if (level >= LEVELS.length - 1) return finish(false);
    level++;
    draw();
    pulse(ui.canvas, "bump");
    setStatus("Un poco más nítida…");
}

function finish(correct) {
    search.disable(true);
    const answer = deck[index];
    const points = correct ? POINTS[level] : 0;

    if (correct) {
        score += points;
        streak++;
    }
    const best = store.get("pixelBest", 0);
    if (score > best) store.set("pixelBest", score);
    ui.best.textContent = Math.max(best, score);
    ui.score.textContent = score;
    ui.streak.textContent = streak;

    ui.cover.src = answer.cover;
    ui.verdict.textContent = correct ? `¡Acertada en el intento ${level + 1}! +${points}` : `Se acabó la racha: ${score} puntos`;
    ui.title.textContent = answer.name;
    ui.artist.textContent = answer.artist;
    ui.next.textContent = correct ? "Siguiente" : "Otra racha";
    ui.reveal.classList.toggle("lost", !correct);
    ui.board.classList.add("hidden");
    ui.reveal.classList.remove("hidden");

    // De premio, suena la canción.
    player.playAt(index).catch(() => {});

    if (!correct) {
        score = 0;
        streak = 0;
    }
}

const setStatus = text => { ui.status.textContent = text; };

function onClick(event) {
    if (event.target.closest("[data-ref=skip]")) {
        ui.attempts.append(h("li", {}, level < LEVELS.length - 1 ? "Pasada" : "Rendida"));
        advance();
    } else if (event.target.closest("[data-ref=next]")) {
        player.pause();
        ui.score.textContent = score;
        ui.streak.textContent = streak;
        next();
    }
}

export default {
    template: "/games/pixel/pixel.html",
    cta: "Jugar a Portada pixelada",
    needsPlaylist: true,
    mount,
    unmount
};
