/*
 * INTRO
 * Dos modos:
 *  - Normal, "Una décima": suena una décima de segundo de un punto cualquiera de la canción.
 *    Si no, 0,5 · 1 · 2 · 4 y 8 s. Sale de la muestra de Deezer (sin llamadas a Spotify).
 *  - Fácil: el principio de la canción, 1, 2, 4, 7, 11 y 16 segundos, por Spotify.
 * Cuanto antes la aciertes, más puntos. Si fallas la última oportunidad, se acaba la racha.
 *
 * Llamadas a la API: una al empezar (la lista entera va a la cola del reproductor).
 * Repetir el fragmento, pausar y pasar a la siguiente canción lo hace el SDK.
 */
import { refs, h, toast, pulse, shuffle, store } from "../../lib/ui.js";
import { tracks as loadTracks } from "../../lib/api.js";
import { player, positionNow } from "../../lib/player/index.js";
import { songSearch } from "../../lib/song-search.js";
import { loadPreview, playClip } from "../../lib/audio.js";

const MODES = {
    normal: [100, 500, 1000, 2000, 4000, 8000],
    easy: [1000, 2000, 4000, 7000, 11000, 16000]
};
const POINTS = [6, 5, 4, 3, 2, 1];
const MIN_SONGS = 5;

let ui = {};
let root = null;
let search = null;
let deck = [];
let index = -1;
let stage = 0;
let score = 0;
let streak = 0;
let playback = null;
let unsubscribe = null;
let stopAt = null;   // ms en los que hay que cortar el fragmento que suena
let watcher = null;
let fallback = null;
let heard = false;   // ¿ha sonado ya esta canción? (si no, resume() reanudaría la anterior)
let mode = store.get("introMode", "normal");
let STAGES = MODES[mode] || MODES.normal;
let clip = null;     // muestra de Deezer de la canción actual (modo normal)
let clipOffset = 0;
let stopClip = null;
let round = 0;


// =====================================================
// CICLO DE VIDA
// =====================================================

async function mount(container, { playlist }) {
    root = container;
    ui = refs(root);

    const tracks = await loadTracks.sample(playlist.id);
    if (tracks.length < MIN_SONGS) throw new Error(`Intro necesita al menos ${MIN_SONGS} canciones. Esta playlist tiene ${tracks.length}.`);

    ui.playlist.textContent = playlist.name;
    ui.best.textContent = store.get("introBest", 0);

    deck = shuffle([...tracks]);
    player.load(deck);

    search = songSearch(ui.search, { onPick: guess });
    search.setChoices([...tracks].sort((a, b) => a.name.localeCompare(b.name)));

    setMode(mode, false);

    unsubscribe = player.onState(state => { playback = state; });
    root.addEventListener("click", onClick);

    score = 0;
    streak = 0;
    nextSong();
}

function setMode(next, restart = true) {
    mode = MODES[next] ? next : "normal";
    STAGES = MODES[mode];
    store.set("introMode", mode);
    root.querySelectorAll("[data-mode]").forEach(button => button.setAttribute("aria-pressed", String(button.dataset.mode === mode)));
    // En normal las barras crecen en escala logarítmica (si no, la décima no se vería).
    ui.stages.replaceChildren(...STAGES.map((ms, i) => h("span", {
        style: `flex-grow: ${mode === "normal" ? 1 : ms - (STAGES[i - 1] || 0)}`
    })));
    if (restart) {
        stopWatching();
        player.pause();
        index--;
        score = 0;
        streak = 0;
        ui.score.textContent = 0;
        ui.streak.textContent = 0;
        nextSong();
    }
}

const seconds = ms => `${(ms / 1000).toLocaleString("es-ES")} s`;

function unmount() {
    stopWatching();
    unsubscribe?.();
    root = null;
}


// =====================================================
// RONDA
// =====================================================

function nextSong() {
    // Al acabarse la lista se vuelve a barajar: una llamada más cada 50 canciones.
    if (++index >= deck.length) {
        deck = shuffle([...deck]);
        player.load(deck);
        index = 0;
    }

    stage = 0;
    heard = false;
    ui.attempts.replaceChildren();
    ui.reveal.classList.add("hidden");
    ui.board.classList.remove("hidden");
    search.clear();
    clip = null;
    renderStage();

    if (mode === "easy") {
        search.disable(false);
        ui.play.disabled = false;
        setStatus("Pulsa para escuchar el primer segundo.");
        ui.play.focus();
        return;
    }
    loadClip(++round);
}

// Modo normal: busca la muestra; las canciones sin muestra se saltan.
async function loadClip(id, tries = 0) {
    search.disable(true);
    ui.play.disabled = true;
    setStatus("Preparando la canción…");
    const track = deck[index];
    const buffer = await loadPreview(track);
    if (!root || id !== round) return;
    if (!buffer) {
        if (tries > 8) {
            setStatus("Estas canciones no tienen muestra. Prueba el modo fácil.");
            return;
        }
        if (++index >= deck.length) index = 0;
        return loadClip(id, tries + 1);
    }
    clip = buffer;
    clipOffset = 2 + Math.random() * Math.max(0, buffer.duration - 12);
    if (deck[index + 1]) loadPreview(deck[index + 1]);
    search.disable(false);
    ui.play.disabled = false;
    setStatus("Pulsa para escuchar una décima de segundo.");
    ui.play.focus();
}

function renderStage() {
    ui.playLabel.textContent = `Escuchar ${seconds(STAGES[stage])}`;
    ui.skip.textContent = stage < STAGES.length - 1 ? `Saltar (${seconds(STAGES[stage + 1])})` : "Rendirse";
    [...ui.stages.children].forEach((bar, i) => bar.classList.toggle("open", i <= stage));
}

// Suena desde el principio hasta el límite de la fase actual y se corta solo.
async function playFragment() {
    stopWatching();
    stopAt = STAGES[stage];
    ui.play.classList.add("playing");
    setStatus("Escuchando…");

    if (mode === "normal") {
        if (!clip) return stopWatching();
        stopClip = playClip(clip, {
            offset: clipOffset,
            duration: stopAt / 1000,
            onEnd: () => {
                ui.play?.classList.remove("playing");
                setStatus("¿La tienes? Escríbela abajo, vuelve a escucharla o salta.");
            }
        });
        return;
    }

    try {
        await player.playAt(index);
    } catch (error) {
        ui.play.classList.remove("playing");
        setStatus("No se pudo reproducir. Vuelve a intentarlo.");
        toast(error.message, { error: true });
        return;
    }

    heard = true;
    const track = deck[index];
    const started = performance.now();

    watcher = setInterval(() => {
        const sameSong = playback?.ref === track.ref && !playback.paused;
        // Se corta por la posición real de la canción; si el reproductor no informa, por reloj.
        if ((sameSong && positionNow(playback) >= stopAt) || performance.now() - started > stopAt + 2500) {
            stopWatching();
            player.pause();
            setStatus("¿La tienes? Escríbela abajo, vuelve a escucharla o salta.");
        }
    }, 40);
}

function stopWatching() {
    stopClip?.();
    stopClip = null;
    clearInterval(watcher);
    clearTimeout(fallback);
    watcher = null;
    ui.play?.classList.remove("playing");
}

function guess(track) {
    const answer = deck[index];

    if (track.id === answer.id) return finishSong(true);

    ui.attempts.append(h("li", { class: "wrong" }, `✕ ${track.name} — ${track.artist}`));
    advance();
}

function skip() {
    ui.attempts.append(h("li", { class: "skipped" }, stage < STAGES.length - 1 ? "Saltada" : "Rendida"));
    advance();
}

// Un fallo o un salto desbloquea más canción; tras la última fase, se pierde.
function advance() {
    if (stage >= STAGES.length - 1) return finishSong(false);
    stage++;
    renderStage();
    pulse(ui.play, "nudge");
    setStatus(`Ahora puedes escuchar ${seconds(STAGES[stage])}.`);
}

function finishSong(correct) {
    stopWatching();
    search.disable(true);

    const answer = deck[index];
    const points = correct ? POINTS[stage] : 0;

    if (correct) {
        score += points;
        streak++;
        ui.score.textContent = score;
        ui.streak.textContent = streak;
        pulse(ui.score);
    }

    const best = store.get("introBest", 0);
    if (score > best) {
        store.set("introBest", score);
        ui.best.textContent = score;
    }

    ui.cover.src = answer.cover || "";
    ui.cover.hidden = !answer.cover;
    ui.verdict.textContent = correct
        ? `¡Acertada con ${seconds(STAGES[stage])}! +${points}`
        : `Se acabó la racha: ${score} puntos`;
    ui.title.textContent = answer.name;
    ui.artist.textContent = answer.artist;
    ui.next.textContent = correct ? "Siguiente canción" : "Empezar otra racha";

    ui.board.classList.add("hidden");
    ui.reveal.classList.remove("hidden");
    ui.reveal.classList.toggle("lost", !correct);
    ui.next.focus();

    // Ya resuelta, suena tranquila desde donde iba (sin llamadas a la API).
    (heard ? player.resume() : player.playAt(index)).catch(() => {});

    if (!correct) {
        score = 0;
        streak = 0;
    }
}

const setStatus = text => { ui.status.textContent = text; };

function onClick(event) {
    const modeButton = event.target.closest("[data-mode]");
    if (modeButton) {
        if (modeButton.dataset.mode !== mode) setMode(modeButton.dataset.mode);
    }
    else if (event.target.closest("[data-ref=play]")) playFragment();
    else if (event.target.closest("[data-ref=skip]")) skip();
    else if (event.target.closest("[data-ref=next]")) {
        ui.score.textContent = score;
        ui.streak.textContent = streak;
        player.pause();
        nextSong();
    }
}


export default {
    template: "/games/intro/intro.html",
    cta: "Jugar a Intro",
    needsPlaylist: true,
    mount,
    unmount
};
