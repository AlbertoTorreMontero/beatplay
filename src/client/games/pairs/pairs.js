/*
 * PAREJAS SONORAS
 * Memory con el oído: todas las cartas son iguales por fuera. Al tocar una suena un trozo de
 * su canción; encuentra las dos que suenan igual. En fácil, al girarla se ve la portada.
 *
 * Audio: la muestra de 30 s de Deezer, tocada en el navegador (exacta e instantánea, sin
 * llamadas a Spotify). Si alguna canción no tiene muestra se cambia por otra; si no hay
 * bastantes, suena con el reproductor de Spotify (una llamada por carta).
 */
import { refs, h, pulse, shuffle, store } from "../../lib/ui.js";
import { tracks as loadTracks } from "../../lib/api.js";
import { player } from "../../lib/player/index.js";
import { loadPreview, playClip } from "../../lib/audio.js";

const PAIRS = 6;
const CLIP_S = 2.5;

let ui = {};
let root = null;
let pool = [];
let cards = [];       // { track, sound, el, done }
let open = [];
let moves = 0;
let found = 0;
let mode = store.get("pairsMode", "normal");
let stop = null;
let busy = false;
let useSpotify = false;
let round = 0;

async function mount(container, { playlist }) {
    root = container;
    ui = refs(root);
    pool = await loadTracks.sample(playlist.id);
    if (pool.length < PAIRS) throw new Error(`Hacen falta al menos ${PAIRS} canciones.`);

    ui.playlist.textContent = playlist.name;
    root.addEventListener("click", onClick);
    setMode(mode);
    deal();
}

function unmount() {
    stop?.();
    root = null;
}

function setMode(next) {
    mode = next;
    store.set("pairsMode", mode);
    root.querySelectorAll("[data-mode]").forEach(button => button.setAttribute("aria-pressed", String(button.dataset.mode === mode)));
    ui.best.textContent = store.get(`pairsBest-${mode}`, "—");
    cards.forEach(card => card.el.classList.toggle("show", mode === "easy" && card.done));
}

// Elige 6 canciones con muestra (prueba unas cuantas más por si alguna no tiene).
async function deal() {
    const myRound = ++round;
    stop?.();
    moves = 0;
    found = 0;
    open = [];
    busy = true;
    ui.moves.textContent = 0;
    ui.found.textContent = `0/${PAIRS}`;
    ui.reveal.classList.add("hidden");
    ui.board.classList.remove("hidden");
    ui.grid.replaceChildren();
    ui.status.textContent = "Preparando las cartas…";

    const candidates = shuffle([...pool]).slice(0, PAIRS + 6);
    const loaded = await Promise.all(candidates.map(async track => ({ track, buffer: await loadPreview(track) })));
    if (myRound !== round || !root) return;

    let chosen = loaded.filter(item => item.buffer).slice(0, PAIRS);
    useSpotify = chosen.length < PAIRS;
    if (useSpotify) {
        chosen = candidates.slice(0, PAIRS).map(track => ({ track, buffer: null }));
        player.load(chosen.map(item => item.track));
    }

    // Cada pareja suena igual: el mismo trozo de la misma canción.
    const sounds = chosen.map((item, i) => ({
        ...item,
        index: i,
        offset: item.buffer ? 3 + Math.random() * Math.max(0, item.buffer.duration - CLIP_S - 6) : 30 + Math.random() * 30
    }));

    cards = shuffle([...sounds, ...sounds]).map(sound => {
        const el = h("button", { type: "button", class: "pairs-card", "aria-label": "Carta" }, sound.track.cover ? h("img", { src: sound.track.cover, alt: "" }) : null);
        return { sound, el, done: false };
    });
    cards.forEach(card => {
        card.el.addEventListener("click", () => flip(card));
        ui.grid.append(card.el);
    });
    ui.status.textContent = "Toca una carta para escucharla.";
    busy = false;
}

async function listen(sound) {
    stop?.();
    if (!useSpotify) {
        stop = playClip(sound.buffer, { offset: sound.offset, duration: CLIP_S });
        return;
    }
    try {
        await player.playAt(sound.index);
        await player.seek(sound.offset * 1000);
        const timer = setTimeout(() => player.pause(), CLIP_S * 1000);
        stop = () => { clearTimeout(timer); player.pause(); };
    } catch { /* sin sonido: se puede seguir jugando */ }
}

function flip(card) {
    if (busy || card.done || open.includes(card)) return;
    open.push(card);
    card.el.classList.add("open");
    if (mode === "easy") card.el.classList.add("show");
    listen(card.sound);
    navigator.vibrate?.(8);

    if (open.length < 2) return;

    moves++;
    ui.moves.textContent = moves;
    const [a, b] = open;

    if (a.sound === b.sound) {
        busy = true;
        setTimeout(() => {
            [a, b].forEach(item => {
                item.done = true;
                item.el.classList.remove("open");
                item.el.classList.add("done");
                item.el.disabled = true;
            });
            open = [];
            busy = false;
            found++;
            ui.found.textContent = `${found}/${PAIRS}`;
            pulse(ui.found);
            ui.status.textContent = `¡Pareja! ${a.sound.track.name} — ${a.sound.track.artist}`;
            if (found === PAIRS) setTimeout(win, 900);
        }, 600);
        return;
    }

    // No son pareja: se dejan oír y se vuelven a tapar.
    busy = true;
    setTimeout(() => {
        [a, b].forEach(item => item.el.classList.remove("open", "show"));
        open = [];
        busy = false;
    }, CLIP_S * 1000);
}

function win() {
    if (!root) return;
    stop?.();
    const key = `pairsBest-${mode}`;
    const best = store.get(key, null);
    const record = best == null || moves < best;
    if (record) store.set(key, moves);
    ui.best.textContent = record ? moves : best;
    ui.final.textContent = moves;
    ui.record.textContent = record ? "¡Nuevo récord!" : `Récord: ${best} intentos`;
    ui.board.classList.add("hidden");
    ui.reveal.classList.remove("hidden");
}

function onClick(event) {
    const modeButton = event.target.closest("[data-mode]");
    if (modeButton) {
        setMode(modeButton.dataset.mode);
        return deal();
    }
    if (event.target.closest("[data-ref=again]")) deal();
}

export default {
    template: "/games/pairs/pairs.html",
    cta: "Jugar a Parejas",
    needsPlaylist: true,
    mount,
    unmount
};
