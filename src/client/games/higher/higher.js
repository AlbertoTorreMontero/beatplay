/*
 * MÁS O MENOS
 * A la izquierda, una canción con su dato a la vista. A la derecha suena otra: ¿su dato es
 * mayor o menor? Si aciertas, la de la derecha pasa a la izquierda y llega otra. Un fallo y se
 * acaba la racha. Cada ronda se compara un dato al azar, nunca el mismo dos veces seguidas:
 * año, duración o BPM (este último
 * cuando ya se conoce el tempo de suficientes canciones).
 *
 * Llamadas a la API: una para leer la playlist (con año) y una por canción que suena.
 * El BPM sale de Deezer o del análisis de su muestra (lib/audio.js), sin llamar a Spotify.
 */
import { refs, h, pulse, shuffle, store } from "../../lib/ui.js";
import { tracks as loadTracks } from "../../lib/api.js";
import { player } from "../../lib/player/index.js";
import { tempoFor } from "../../lib/audio.js";

const MIN_BPM_SONGS = 8;

const clock = ms => `${Math.floor(ms / 60000)}:${String(Math.round(ms / 1000) % 60).padStart(2, "0")}`;

const ATTRIBUTES = {
    year: { label: "Año", question: "¿Es más nueva o más antigua?", up: "▲ Más nueva", down: "▼ Más antigua", value: track => track.year, show: v => v },
    duration: { label: "Duración", question: "¿Dura más o menos?", up: "▲ Dura más", down: "▼ Dura menos", value: track => track.duration, show: clock },
    bpm: { label: "BPM", question: "¿Es más rápida o más lenta?", up: "▲ Más rápida", down: "▼ Más lenta", value: track => bpms.get(track.id), show: v => `${v} BPM` }
};

let ui = {};
let root = null;
let tracks = [];
let bpms = new Map();
let left = null;
let right = null;
let attribute = "year";
let streak = 0;
let locked = false;

async function mount(container, { playlist }) {
    root = container;
    ui = refs(root);

    tracks = (await loadTracks.dated(playlist.id)).filter(track => track.year && track.duration);
    if (tracks.length < 6) throw new Error("Hacen falta al menos 6 canciones con año y duración.");

    ui.playlist.textContent = playlist.name;
    ui.best.textContent = store.get("higherBest", 0);
    player.load(tracks);

    // El tempo se va conociendo en segundo plano: el modo BPM entra cuando hay bastantes.
    bpms = tempoFor(shuffle([...tracks]), { analyze: 16 });

    root.addEventListener("click", onClick);
    start();
}

function unmount() {
    root = null;
}

function start() {
    streak = 0;
    attribute = "year";
    ui.streak.textContent = 0;
    ui.reveal.classList.add("hidden");
    ui.board.classList.remove("hidden");
    left = pick(null);
    newRound();
}

const valid = track => ATTRIBUTES[attribute].value(track) != null;

function pick(except) {
    const options = tracks.filter(track => track !== except && track !== left && valid(track));
    return options[Math.floor(Math.random() * options.length)];
}

// Cada ronda, un dato al azar distinto del anterior. BPM solo si ya se sabe el de bastantes canciones.
function shuffleAttribute() {
    const available = ["year", "duration", ...(bpms.size >= MIN_BPM_SONGS ? ["bpm"] : [])]
        .filter(name => name !== attribute && ATTRIBUTES[name].value(left) != null);
    if (available.length) attribute = available[Math.floor(Math.random() * available.length)];
    if (!valid(left)) left = pick(null);
}

function newRound() {
    locked = false;
    shuffleAttribute();
    right = pick(left);
    const info = ATTRIBUTES[attribute];
    ui.question.textContent = info.question;
    ui.up.textContent = info.up;
    ui.down.textContent = info.down;
    ui.up.disabled = ui.down.disabled = false;
    ui.status.textContent = "";
    ui.arena.replaceChildren(card(left, true), card(right, false));
    player.playAt(tracks.indexOf(right)).catch(() => {});
}

function card(track, visible) {
    const info = ATTRIBUTES[attribute];
    return h("article", { class: `hl-card ${visible ? "" : "playing"}` },
        h("img", { src: track.cover || "", alt: "" }),
        h("span", { class: "hl-label" }, visible ? info.label : "Suena ahora"),
        h("span", { class: `hl-value ${visible ? "" : "hidden-value"}` }, visible ? info.show(info.value(track)) : "?"),
        h("strong", {}, track.name),
        h("span", { class: "muted" }, track.artist));
}

function answer(direction) {
    if (locked) return;
    locked = true;
    ui.up.disabled = ui.down.disabled = true;

    const info = ATTRIBUTES[attribute];
    const a = info.value(left);
    const b = info.value(right);
    const correct = a === b || (direction === "up" ? b > a : b < a); // si empatan, vale cualquiera

    const rightCard = ui.arena.lastElementChild;
    const value = rightCard.querySelector(".hl-value");
    value.textContent = info.show(b);
    value.classList.remove("hidden-value");
    rightCard.classList.add(correct ? "right" : "wrong");
    pulse(value);
    navigator.vibrate?.(correct ? 15 : [60, 40, 60]);

    if (!correct) return setTimeout(lose, 1300);

    streak++;
    ui.streak.textContent = streak;
    pulse(ui.streak);
    setTimeout(() => {
        if (!root) return;
        left = right;
        newRound();
    }, 1100);
}

function lose() {
    if (!root) return;
    const best = store.get("higherBest", 0);
    if (streak > best) store.set("higherBest", streak);
    ui.best.textContent = Math.max(best, streak);
    ui.final.textContent = streak;
    ui.record.textContent = streak > best ? "¡Nuevo récord!" : `Récord: ${Math.max(best, streak)}`;
    ui.board.classList.add("hidden");
    ui.reveal.classList.remove("hidden");
}

function onClick(event) {
    const button = event.target.closest("[data-answer]");
    if (button) return answer(button.dataset.answer);
    if (event.target.closest("[data-ref=again]")) start();
}

export default {
    template: "/games/higher/higher.html",
    cta: "Jugar a Más o menos",
    needsPlaylist: true,
    mount,
    unmount
};
