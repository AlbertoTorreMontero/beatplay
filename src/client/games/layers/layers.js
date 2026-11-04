/*
 * CAPAS
 * La canción suena como desde la habitación de al lado: primero solo los graves. Cada fallo
 * (o "Otra capa") abre el filtro y se oye un poco más, hasta oírla entera. Cuanto antes la
 * aciertes, más puntos; si no la aciertas, se pierde la racha. Al resolverla suena entera.
 *
 * Spotify no deja tocar su audio (viene cifrado), así que se usa la muestra de 30 s de Deezer
 * con filtros del navegador. Llamadas a Spotify: leer la playlist y una por canción resuelta.
 */
import { refs, h, pulse, shuffle, store } from "../../lib/ui.js";
import { tracks as loadTracks } from "../../lib/api.js";
import { player } from "../../lib/player/index.js";
import { songSearch } from "../../lib/song-search.js";
import { loadPreview, playClip } from "../../lib/audio.js";

// De la habitación de al lado a la canción entera.
const LAYERS = [
    { name: "Solo graves", filter: { type: "lowpass", frequency: 180, Q: 1 } },
    { name: "Graves y algo más", filter: { type: "lowpass", frequency: 420, Q: 1 } },
    { name: "Solo agudos", filter: { type: "highpass", frequency: 2500, Q: 0.7 } },
    { name: "Medios", filter: { type: "bandpass", frequency: 1000, Q: 0.6 } },
    { name: "Casi entera", filter: { type: "lowpass", frequency: 3500, Q: 0.7 } },
    { name: "Entera", filter: null }
];
const POINTS = [6, 5, 4, 3, 2, 1];
const CLIP_S = 10;
const MIN_SONGS = 5;

let ui = {};
let root = null;
let search = null;
let deck = [];
let index = -1;
let layer = 0;
let score = 0;
let streak = 0;
let buffer = null;
let offset = 0;
let stop = null;

async function mount(container, { playlist }) {
    root = container;
    ui = refs(root);
    const tracks = await loadTracks.sample(playlist.id);
    if (tracks.length < MIN_SONGS) throw new Error(`Hacen falta al menos ${MIN_SONGS} canciones.`);

    ui.playlist.textContent = playlist.name;
    ui.best.textContent = store.get("layersBest", 0);
    deck = shuffle([...tracks]);
    player.load(deck);

    search = songSearch(ui.search, { onPick: guess });
    search.setChoices([...tracks].sort((a, b) => a.name.localeCompare(b.name)));
    ui.stages.replaceChildren(...LAYERS.map(() => h("span")));
    ui.wave.replaceChildren(...Array.from({ length: 24 }, (_, i) => h("i", { style: `--h: ${30 + ((i * 37) % 70)}%` })));

    root.addEventListener("click", onClick);
    score = 0;
    streak = 0;
    index = -1;
    next();
}

function unmount() {
    stop?.();
    root = null;
}

// Busca la siguiente canción que tenga muestra en Deezer (las que no, se saltan).
async function next(tries = 0) {
    stop?.();
    if (++index >= deck.length) {
        deck = shuffle([...deck]);
        player.load(deck);
        index = 0;
    }
    layer = 0;
    buffer = null;
    ui.attempts.replaceChildren();
    ui.reveal.classList.add("hidden");
    ui.board.classList.remove("hidden");
    search.disable(true);
    search.clear();
    ui.play.disabled = true;
    render();
    setStatus("Preparando la canción…");

    const track = deck[index];
    const loaded = await loadPreview(track);
    if (!root || deck[index] !== track) return;
    if (!loaded) {
        if (tries > 8) return setStatus("No encuentro muestras de estas canciones. Prueba con otra playlist.");
        return next(tries + 1);
    }
    buffer = loaded;
    offset = Math.max(0, Math.random() * (buffer.duration - CLIP_S - 1));
    // Se precarga la siguiente para que no haya espera.
    if (deck[index + 1]) loadPreview(deck[index + 1]);

    ui.play.disabled = false;
    search.disable(false);
    setStatus("Pulsa Escuchar. Suena como desde la habitación de al lado.");
}

function render() {
    [...ui.stages.children].forEach((bar, i) => bar.classList.toggle("open", i <= layer));
    ui.step.textContent = `Capa ${layer + 1} de ${LAYERS.length} · ${LAYERS[layer].name}`;
    ui.skip.textContent = layer < LAYERS.length - 1 ? "Otra capa" : "Rendirse";
}

function listen() {
    if (!buffer) return;
    stop?.();
    ui.wave.classList.add("playing");
    stop = playClip(buffer, {
        offset,
        duration: CLIP_S,
        filter: LAYERS[layer].filter,
        volume: LAYERS[layer].filter?.type === "highpass" ? 1 : 0.9,
        onEnd: () => ui.wave?.classList.remove("playing")
    });
}

function guess(track) {
    if (track.id === deck[index].id) return finish(true);
    ui.attempts.append(h("li", { class: "wrong" }, `✕ ${track.name}`));
    advance();
}

function advance() {
    if (layer >= LAYERS.length - 1) return finish(false);
    layer++;
    render();
    pulse(ui.play, "nudge");
    setStatus(`Nueva capa: ${LAYERS[layer].name.toLowerCase()}.`);
    listen();
}

function finish(correct) {
    stop?.();
    ui.wave.classList.remove("playing");
    search.disable(true);
    const answer = deck[index];
    const points = correct ? POINTS[layer] : 0;
    if (correct) {
        score += points;
        streak++;
    }
    const best = store.get("layersBest", 0);
    if (score > best) store.set("layersBest", score);
    ui.best.textContent = Math.max(best, score);
    ui.score.textContent = score;
    ui.streak.textContent = streak;

    ui.cover.src = answer.cover || "";
    ui.cover.hidden = !answer.cover;
    ui.verdict.textContent = correct ? `¡Acertada con la capa ${layer + 1}! +${points}` : `Se acabó la racha: ${score} puntos`;
    ui.title.textContent = answer.name;
    ui.artist.textContent = answer.artist;
    ui.next.textContent = correct ? "Siguiente" : "Otra racha";
    ui.reveal.classList.toggle("lost", !correct);
    ui.board.classList.add("hidden");
    ui.reveal.classList.remove("hidden");

    // Ahora sí, entera y por Spotify.
    player.playAt(index).catch(() => {});
    if (!correct) {
        score = 0;
        streak = 0;
    }
}

const setStatus = text => { ui.status.textContent = text; };

function onClick(event) {
    if (event.target.closest("[data-ref=play]")) return listen();
    if (event.target.closest("[data-ref=skip]")) {
        ui.attempts.append(h("li", {}, layer < LAYERS.length - 1 ? "Pasada" : "Rendida"));
        return advance();
    }
    if (event.target.closest("[data-ref=next]")) {
        player.pause();
        ui.score.textContent = score;
        ui.streak.textContent = streak;
        next();
    }
}

export default {
    template: "/games/layers/layers.html",
    cta: "Jugar a Capas",
    needsPlaylist: true,
    mount,
    unmount
};
