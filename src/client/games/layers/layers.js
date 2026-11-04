/*
 * CAPAS
 * La canción se va montando por capas: graves, platillos, instrumentos sin voz... La letra
 * no aparece hasta la capa 5 (y lejana). Cada fallo (o "Otra capa") añade una capa. Cuanto antes la
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

// ---- Piezas del grafo de audio ----
// Filtros en cascada: cortes muy secos para que no se cuele la voz (la voz vive en 150-5000 Hz).
function steep(ctx, input, type, frequency, stages = 4) {
    let node = input;
    for (let i = 0; i < stages; i++) {
        const biquad = ctx.createBiquadFilter();
        biquad.type = type;
        biquad.frequency.value = frequency;
        biquad.Q.value = 0.71;
        node.connect(biquad);
        node = biquad;
    }
    return node;
}

function mix(ctx, parts) {
    const out = ctx.createGain();
    for (const [node, gain = 1] of parts) {
        const g = ctx.createGain();
        g.gain.value = gain;
        node.connect(g).connect(out);
    }
    return out;
}

// Truco del karaoke: izquierda menos derecha. La voz principal va en el centro (igual en los
// dos canales) y se anula; quedan guitarras, teclados, coros abiertos y reverb.
function noVoice(ctx, source) {
    const split = ctx.createChannelSplitter(2);
    const invert = ctx.createGain();
    const side = ctx.createGain();
    invert.gain.value = -1;
    source.connect(split);
    split.connect(side, 0);
    split.connect(invert, 1).connect(side);
    return side;
}

const bass = (ctx, source, hz = 140) => steep(ctx, source, "lowpass", hz);
const cymbals = (ctx, source) => steep(ctx, source, "highpass", 8000);

// De la habitación de al lado a la canción entera. Las tres primeras capas no llevan voz.
// "stereo": la capa usa el truco del karaoke (si la muestra es mono se usa "mono" en su lugar).
const LAYERS = [
    { name: "Solo graves", build: (ctx, s) => mix(ctx, [[bass(ctx, s), 1.4]]) },
    { name: "Graves y platillos", build: (ctx, s) => mix(ctx, [[bass(ctx, s), 1.3], [cymbals(ctx, s), 2.2]]) },
    {
        name: "Sin voz",
        stereo: (ctx, s) => mix(ctx, [[noVoice(ctx, s), 1.6], [bass(ctx, s), 1]]),
        mono: (ctx, s) => mix(ctx, [[bass(ctx, s, 220), 1.2], [steep(ctx, s, "highpass", 5500), 2]])
    },
    {
        name: "Sin voz, más cuerpo",
        stereo: (ctx, s) => mix(ctx, [[noVoice(ctx, s), 1.5], [bass(ctx, s, 300), 1], [cymbals(ctx, s), 1.2]]),
        mono: (ctx, s) => mix(ctx, [[bass(ctx, s, 400), 1.1], [steep(ctx, s, "highpass", 4000), 1.6]])
    },
    { name: "Voz de lejos", build: (ctx, s) => steep(ctx, s, "lowpass", 1100, 2) },
    { name: "Entera", build: null }
];

// ¿Sirve el truco del karaoke? Solo si la muestra es estéreo de verdad.
function isStereo(buffer) {
    if (buffer.numberOfChannels < 2) return false;
    const l = buffer.getChannelData(0);
    const r = buffer.getChannelData(1);
    let side = 0;
    let mid = 0;
    for (let i = 0; i < l.length; i += 64) {
        side += (l[i] - r[i]) ** 2;
        mid += (l[i] + r[i]) ** 2;
    }
    return side > mid * 0.02;
}

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
let stereo = true;

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
    stereo = isStereo(buffer);
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
        build: builder(LAYERS[layer]),
        volume: 0.9,
        onEnd: () => ui.wave?.classList.remove("playing")
    });
}

const builder = item => item.build || (stereo ? item.stereo : item.mono) || null;

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
