/*
 * HIPSTER
 * Suena una canción y hay que colocarla en su año dentro de la línea temporal.
 * Un fallo termina la partida.
 */
import { refs, h, toast, pulse, shuffle, store, formatTime, reducedMotion } from "../../lib/ui.js";
import { tracks as loadTracks } from "../../lib/api.js";
import { player, positionNow } from "../../lib/player/index.js";

const NEXT_DELAY = 1100;
const FAIL_DELAY = 1400;

let ui = {};
let root = null;
let options = null;
let deck = [];
let timeline = [];
let current = null;
let score = 0;
let locked = true;
let playback = null;
let unsubscribe = null;
let ticker = null;
let timer = null;
let gameId = 0;


// =====================================================
// CICLO DE VIDA
// =====================================================

async function mount(container, opts) {
    root = container;
    options = opts;
    ui = refs(root);

    const official = opts.source === "official";
    const loaded = (await (official ? loadTracks.hipsterOfficial() : loadTracks.dated(opts.playlist.id))).filter(track => track.year > 0);

    if (loaded.length < 2) {
        throw new Error("Hipster necesita al menos 2 canciones con año. Prueba con otra playlist.");
    }

    ui.source.textContent = official ? "Selección oficial" : opts.playlist.name;

    unsubscribe = player.onState(onPlayerState);
    ticker = setInterval(renderProgress, 250);

    root.addEventListener("click", onClick);
    ui.progress.addEventListener("change", onSeek);

    start(loaded);
}

function unmount() {
    gameId++; // invalida cargas y temporizadores pendientes
    clearTimeout(timer);
    clearInterval(ticker);
    unsubscribe?.();
    root = null;
}

function start(tracks) {
    gameId++;
    clearTimeout(timer);

    deck = shuffle([...tracks]);
    timeline = [deck.pop()];
    score = 0;

    ui.score.textContent = "0";
    ui.best.textContent = store.get("hipsterBest", 0);
    ui.over.classList.add("hidden");
    ui.board.classList.remove("hidden");

    ui.timeline.replaceChildren(slot(), card(timeline[0]), slot());
    labelSlots();

    next(gameId);
}


// =====================================================
// RONDA
// =====================================================

async function next(id) {
    if (id !== gameId) return;
    if (!deck.length) return finish(true);

    current = deck.pop();
    locked = false;
    playback = null;
    renderProgress();
    setStatus("Cargando canción…");

    try {
        await player.play(current);
        if (id === gameId) setStatus("Escucha y elige un hueco");
    } catch (error) {
        console.warn("Hipster:", error);
        setStatus("No se pudo reproducir. Pulsa ▶ o elige igualmente.");
        toast(error.message, { error: true });
    }
}

function place(position) {
    if (locked || !current) return;
    locked = true;

    const before = timeline[position - 1];
    const after = timeline[position];
    const year = current.year;
    const correct = (!before || year >= before.year) && (!after || year <= after.year);

    timeline.splice(position, 0, current);

    const placed = card(current, correct ? "correct" : "wrong");
    ui.timeline.querySelectorAll(".slot")[position].after(placed, slot());
    labelSlots();
    placed.scrollIntoView({ inline: "center", block: "nearest", behavior: reducedMotion() ? "auto" : "smooth" });

    clearTimeout(timer);

    if (!correct) {
        setStatus(`No: es de ${year}.`);
        timer = setTimeout(() => finish(false), FAIL_DELAY);
        return;
    }

    score++;
    ui.score.textContent = score;
    pulse(ui.score);
    setStatus(`¡Bien! ${current.name} es de ${year}.`);

    const id = gameId;
    timer = setTimeout(() => next(id), NEXT_DELAY);
}

function finish(completed) {
    const failed = current;

    gameId++;
    locked = true;
    clearTimeout(timer);
    player.pause();

    const best = store.get("hipsterBest", 0);
    if (score > best) store.set("hipsterBest", score);

    ui.board.classList.add("hidden");
    ui.over.classList.remove("hidden");
    ui.final.textContent = score;
    ui.title.textContent = completed ? "Has completado la línea" : "Se acabó la racha";
    ui.record.textContent = score > best ? "Nuevo récord" : `Récord: ${best}`;
    ui.answer.textContent = !completed && failed ? `${failed.name} — ${failed.artist} es de ${failed.year}.` : "";
    ui.over.querySelector("[data-action=restart]").focus();
}


// =====================================================
// LÍNEA TEMPORAL
// Hijos: hueco, carta, hueco, carta… hueco. Colocar una carta
// solo inserta dos nodos; así no se recargan las portadas.
// =====================================================

const hideBroken = event => { event.target.style.visibility = "hidden"; };

const slot = () => h("div", { class: "slot" }, h("button", { type: "button", class: "slot-button" }, "+"));

const card = (track, result) => h("article", { class: `year-card ${result || ""}` },
    h("img", { class: "year-card-cover", src: track.cover || "", alt: "", decoding: "async", onerror: hideBroken }),
    h("span", { class: "year-card-year display" }, track.year),
    h("span", { class: "year-card-name" }, track.name),
    h("span", { class: "year-card-artist" }, track.artist)
);

// Etiquetas para lector de pantalla: "Colocar entre 1990 y 2001".
function labelSlots() {
    ui.timeline.querySelectorAll(".slot-button").forEach((button, i) => {
        const before = timeline[i - 1];
        const after = timeline[i];
        const label = !before ? `Antes de ${after.year}` : !after ? `Después de ${before.year}` : `Entre ${before.year} y ${after.year}`;
        button.setAttribute("aria-label", `Colocar ${label.toLowerCase()}`);
        button.title = label;
    });
}


// =====================================================
// REPRODUCTOR
// =====================================================

function onPlayerState(state) {
    if (current && state.ref && state.ref !== current.ref) return;
    playback = state;
    ui.play.textContent = state.paused ? "▶" : "❚❚";
    ui.play.setAttribute("aria-label", state.paused ? "Reproducir" : "Pausar");
    renderProgress();
}

function renderProgress() {
    if (!ui.progress) return;

    if (!playback?.duration) {
        ui.progress.value = 0;
        ui.time.textContent = "0:00";
        ui.duration.textContent = "0:00";
        ui.play.textContent = "▶";
        return;
    }

    // Mientras se arrastra la barra no se mueve sola.
    if (document.activeElement === ui.progress) return;

    const position = positionNow(playback);
    ui.progress.value = Math.round(position / playback.duration * 1000);
    ui.progress.style.setProperty("--fill", `${position / playback.duration * 100}%`);
    ui.time.textContent = formatTime(position);
    ui.duration.textContent = formatTime(playback.duration);
}

function onSeek() {
    if (playback?.duration) player.seek(playback.duration * Number(ui.progress.value) / 1000).catch(console.error);
    ui.progress.blur();
}

const setStatus = text => { ui.status.textContent = text; };

function onClick(event) {
    const slotButton = event.target.closest(".slot-button");

    if (slotButton) {
        place([...ui.timeline.querySelectorAll(".slot-button")].indexOf(slotButton));
    } else if (event.target.closest("[data-ref=play]")) {
        player.toggle().catch(error => toast(error.message, { error: true }));
    } else if (event.target.closest("[data-action=restart]")) {
        const all = [...timeline, ...deck, current].filter(Boolean);
        start([...new Set(all)]);
    }
}


export default {
    template: "/games/hipster/hipster.html",
    cta: "Jugar a Hipster",
    needsPlaylist: true,
    setupTitle: state => (state.hipsterSource === "official" ? "Selección oficial" : null),
    note: () => "Canciones de todas las épocas elegidas para Hipster. No necesitas playlist.",
    mount,
    unmount
};
