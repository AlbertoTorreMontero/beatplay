/*
 * PUZZLE DE PORTADA
 * Puzzle deslizante con la portada de la canción que suena. Tienes hasta que acabe la canción
 * (máximo 3 minutos). Cuanto más tiempo te sobre, más puntos.
 *
 * Llamadas a la API: una para leer la playlist y una por puzzle (la canción).
 */
import { refs, pulse, shuffle, store, formatTime } from "../../lib/ui.js";
import { tracks as loadTracks } from "../../lib/api.js";
import { player } from "../../lib/player/index.js";

const MAX_MS = 180000;

let ui = {};
let root = null;
let deck = [];
let index = -1;
let size = store.get("puzzleSize", 3);
let tiles = [];       // tiles[posición] = número de pieza (size*size - 1 = hueco)
let moves = 0;
let score = 0;
let deadline = 0;
let timer = null;
let playing = false;

async function mount(container, { playlist }) {
    root = container;
    ui = refs(root);
    const tracks = (await loadTracks.sample(playlist.id)).filter(track => track.cover);
    if (tracks.length < 3) throw new Error("Hacen falta canciones con portada.");

    ui.playlist.textContent = playlist.name;
    deck = shuffle([...tracks]);
    player.load(deck);
    root.addEventListener("click", onClick);
    setSize(size, false);
    score = 0;
    index = -1;
    next();
}

function unmount() {
    clearInterval(timer);
    root = null;
}

function setSize(next, restart = true) {
    size = next;
    store.set("puzzleSize", size);
    root.querySelectorAll("[data-size]").forEach(button => button.setAttribute("aria-pressed", String(Number(button.dataset.size) === size)));
    if (restart) build();
}

function next() {
    if (++index >= deck.length) {
        deck = shuffle([...deck]);
        player.load(deck);
        index = 0;
    }
    const track = deck[index];
    ui.ref.src = track.cover;
    ui.track.textContent = `${track.name} — ${track.artist}`;
    ui.reveal.classList.add("hidden");
    ui.board.classList.remove("hidden");
    player.playAt(index).catch(() => {});
    playing = true;
    deadline = Date.now() + Math.min(track.duration || MAX_MS, MAX_MS);
    build();
    clearInterval(timer);
    timer = setInterval(tick, 250);
    tick();
}

// Se mezcla haciendo movimientos válidos desde la solución: siempre tiene arreglo.
function build() {
    const count = size * size;
    tiles = Array.from({ length: count }, (_, i) => i);
    let hole = count - 1;
    let previous = -1;
    for (let i = 0; i < size * size * 25; i++) {
        const options = neighbours(hole).filter(position => position !== previous);
        const target = options[Math.floor(Math.random() * options.length)];
        [tiles[hole], tiles[target]] = [tiles[target], tiles[hole]];
        previous = hole;
        hole = target;
    }
    moves = 0;
    ui.moves.textContent = 0;
    ui.grid.classList.remove("solved");
    ui.grid.style.setProperty("--n", size);
    render();
}

function neighbours(position) {
    const row = Math.floor(position / size);
    const col = position % size;
    return [
        row > 0 && position - size,
        row < size - 1 && position + size,
        col > 0 && position - 1,
        col < size - 1 && position + 1
    ].filter(value => value !== false);
}

function render() {
    const cover = deck[index]?.cover;
    const hole = tiles.indexOf(size * size - 1);
    const movable = new Set(neighbours(hole));
    ui.grid.replaceChildren(...tiles.map((piece, position) => {
        const tile = document.createElement("button");
        tile.type = "button";
        tile.className = "puzzle-tile";
        tile.dataset.position = position;
        if (piece === size * size - 1 && !ui.grid.classList.contains("solved")) {
            tile.classList.add("empty");
            tile.disabled = true;
            tile.setAttribute("aria-label", "Hueco");
            return tile;
        }
        const row = Math.floor(piece / size);
        const col = piece % size;
        tile.style.backgroundImage = `url("${cover}")`;
        tile.style.backgroundSize = `${size * 100}% ${size * 100}%`;
        tile.style.backgroundPosition = `${(col / (size - 1)) * 100}% ${(row / (size - 1)) * 100}%`;
        tile.setAttribute("aria-label", `Pieza ${piece + 1}`);
        if (movable.has(position)) tile.classList.add("movable");
        return tile;
    }));
}

function move(position) {
    if (!playing) return;
    const hole = tiles.indexOf(size * size - 1);
    if (!neighbours(hole).includes(position)) return;
    [tiles[hole], tiles[position]] = [tiles[position], tiles[hole]];
    moves++;
    ui.moves.textContent = moves;
    navigator.vibrate?.(5);
    if (tiles.every((piece, i) => piece === i)) return finish(true);
    render();
}

function tick() {
    const left = Math.max(0, deadline - Date.now());
    ui.time.textContent = formatTime(left);
    ui.time.classList.toggle("urgent", left < 15000);
    if (!left && playing) finish(false);
}

function finish(solved) {
    playing = false;
    clearInterval(timer);
    const left = Math.max(0, deadline - Date.now());
    const points = solved ? Math.round(left / 1000) * (size === 4 ? 2 : 1) : 0;
    score += points;
    ui.score.textContent = score;
    pulse(ui.score);

    ui.grid.classList.add("solved");
    render();

    const track = deck[index];
    setTimeout(() => {
        if (!root) return;
        ui.cover.src = track.cover;
        ui.verdict.textContent = solved ? `¡Resuelto en ${moves} movimientos! +${points}` : "Se acabó la canción";
        ui.title.textContent = track.name;
        ui.artist.textContent = track.artist;
        ui.reveal.classList.toggle("lost", !solved);
        ui.board.classList.add("hidden");
        ui.reveal.classList.remove("hidden");
    }, solved ? 900 : 300);
}

function onClick(event) {
    const tile = event.target.closest(".puzzle-tile");
    if (tile && !tile.disabled) return move(Number(tile.dataset.position));
    const sizeButton = event.target.closest("[data-size]");
    if (sizeButton && Number(sizeButton.dataset.size) !== size) return setSize(Number(sizeButton.dataset.size));
    if (event.target.closest("[data-ref=next]")) next();
}

export default {
    template: "/games/puzzle/puzzle.html",
    cta: "Jugar al Puzzle",
    needsPlaylist: true,
    mount,
    unmount
};
