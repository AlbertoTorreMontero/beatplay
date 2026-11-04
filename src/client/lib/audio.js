/*
 * Audio que sí se puede tocar y analizar en el navegador: la muestra de 30 s de Deezer.
 *
 * El audio de Spotify viene cifrado (DRM): se oye, pero no se puede medir ni filtrar.
 * Para eso usamos la muestra de Deezer que sirve nuestro servidor (/api/preview):
 *   - detectBpm(buffer)  calcula el tempo (para Snake Synth cuando Deezer no lo sabe)
 *   - playClip(...)      toca un trozo exacto (0,1 s en Intro) con o sin filtro (Capas)
 * Nada de esto gasta llamadas a Spotify.
 */
import { api } from "./api.js";
import { store } from "./ui.js";

const BPM_KEY = "beatplayBpm";
const MAX_BUFFERS = 24;

let context = null;
const buffers = new Map(); // id de canción → promesa de AudioBuffer | null

export function audioContext() {
    if (!context) context = new (window.AudioContext || window.webkitAudioContext)();
    // En el móvil el audio empieza "suspendido" hasta que el usuario toca algo.
    if (context.state === "suspended") context.resume().catch(() => {});
    return context;
}

const previewUrl = track => `/api/preview?${new URLSearchParams({ isrc: track.isrc || "", title: track.name || "", artist: (track.artist || "").split(",")[0] })}`;

// Muestra decodificada de una canción, o null si Deezer no la tiene. Se guarda en memoria.
export function loadPreview(track) {
    if (!buffers.has(track.id)) {
        if (buffers.size >= MAX_BUFFERS) buffers.delete(buffers.keys().next().value);
        buffers.set(track.id, (async () => {
            try {
                const response = await fetch(previewUrl(track));
                if (!response.ok) return null;
                return await audioContext().decodeAudioData(await response.arrayBuffer());
            } catch {
                return null;
            }
        })());
    }
    return buffers.get(track.id);
}

/**
 * Toca un trozo de la muestra. Devuelve una función para pararlo.
 * filter: { type: "lowpass" | "highpass" | "bandpass", frequency, Q } opcional.
 */
export function playClip(buffer, { offset = 0, duration = buffer.duration, filter = null, volume = 0.9, onEnd } = {}) {
    const ctx = audioContext();
    const source = ctx.createBufferSource();
    const gain = ctx.createGain();
    source.buffer = buffer;

    let node = source;
    if (filter) {
        const biquad = ctx.createBiquadFilter();
        Object.assign(biquad, { type: filter.type });
        biquad.frequency.value = filter.frequency;
        if (filter.Q) biquad.Q.value = filter.Q;
        node.connect(biquad);
        node = biquad;
    }
    node.connect(gain).connect(ctx.destination);

    // Entrada y salida muy cortas: sin chasquidos, también en clips de 0,1 s.
    const now = ctx.currentTime;
    const fade = Math.min(0.01, duration / 4);
    gain.gain.setValueAtTime(0, now);
    gain.gain.linearRampToValueAtTime(volume, now + fade);
    gain.gain.setValueAtTime(volume, now + duration - fade);
    gain.gain.linearRampToValueAtTime(0, now + duration);

    source.start(now, Math.max(0, Math.min(offset, buffer.duration - 0.05)), duration);
    source.onended = () => onEnd?.();
    return () => {
        try {
            source.stop();
        } catch { /* ya había terminado */ }
    };
}


// =====================================================
// DETECTOR DE BPM
// =====================================================

/*
 * 1. Se filtra la muestra para quedarse con los golpes (graves y medios) y se mide la energía
 *    en ventanas de 10 ms.
 * 2. "Onsets": cuánto sube la energía de una ventana a la siguiente (los golpes).
 * 3. Autocorrelación: qué separación entre golpes se repite más. Esa separación es el pulso.
 * Se busca entre 60 y 200 BPM y se prefieren los tempos habituales (90-150) para no
 * confundir el doble o la mitad.
 */
export async function detectBpm(buffer) {
    const rate = 11025;
    const length = Math.floor(Math.min(buffer.duration, 30) * rate);
    const offline = new OfflineAudioContext(1, length, rate);
    const source = offline.createBufferSource();
    source.buffer = buffer;
    const lowpass = offline.createBiquadFilter();
    lowpass.type = "lowpass";
    lowpass.frequency.value = 1200;
    source.connect(lowpass).connect(offline.destination);
    source.start();
    const data = (await offline.startRendering()).getChannelData(0);

    // Energía en ventanas de 10 ms.
    const hop = Math.round(rate * 0.01);
    const frames = Math.floor(data.length / hop);
    const energy = new Float32Array(frames);
    for (let f = 0; f < frames; f++) {
        let sum = 0;
        for (let i = f * hop; i < (f + 1) * hop; i++) sum += data[i] * data[i];
        energy[f] = Math.sqrt(sum / hop);
    }

    // Subidas de energía.
    const onset = new Float32Array(frames);
    for (let f = 1; f < frames; f++) onset[f] = Math.max(0, energy[f] - energy[f - 1]);
    const mean = onset.reduce((a, b) => a + b, 0) / frames;
    if (!mean) return null;
    for (let f = 0; f < frames; f++) onset[f] = Math.max(0, onset[f] - mean);

    // Autocorrelación entre 60 y 200 BPM, con preferencia suave por los tempos habituales.
    const framesPerSecond = 1 / 0.01;
    let best = null;
    let bestScore = 0;
    for (let bpm = 60; bpm <= 200; bpm += 0.5) {
        const lag = (60 / bpm) * framesPerSecond;
        const whole = Math.floor(lag);
        const part = lag - whole;
        let sum = 0;
        for (let f = 0; f + whole + 1 < frames; f++) {
            sum += onset[f] * (onset[f + whole] * (1 - part) + onset[f + whole + 1] * part);
        }
        const weight = Math.exp(-0.5 * ((Math.log2(bpm / 120)) / 0.6) ** 2);
        const score = sum * weight;
        if (score > bestScore) {
            bestScore = score;
            best = bpm;
        }
    }
    return best ? Math.round(best) : null;
}

/**
 * Tempo de varias canciones: primero lo guardado en este navegador, luego Deezer (una petición
 * para todas) y, para las que falten (hasta `analyze`), el análisis de su muestra. onUpdate(track, bpm) avisa
 * de cada una en cuanto se sabe. Devuelve un Map id → bpm.
 */
export function tempoFor(tracks, { onUpdate = () => {}, analyze = Infinity } = {}) {
    const known = store.get(BPM_KEY, {});
    const result = new Map();
    const keyOf = track => track.isrc || track.id;

    const remember = (track, bpm) => {
        if (!bpm) return;
        result.set(track.id, bpm);
        known[keyOf(track)] = bpm;
        store.set(BPM_KEY, known);
        onUpdate(track, bpm);
    };

    tracks.forEach(track => { if (known[keyOf(track)]) result.set(track.id, known[keyOf(track)]); });
    const missing = tracks.filter(track => !result.has(track.id));

    const done = (async () => {
        const codes = missing.map(track => track.isrc).filter(Boolean);
        if (codes.length) {
            const fromDeezer = await api(`/api/tempo?isrc=${codes.join(",")}`).catch(() => ({}));
            missing.forEach(track => remember(track, fromDeezer?.[track.isrc]));
        }
        if (analyze) {
            // Las que Deezer no sabe se calculan de una en una y solo las primeras `analyze`
            // (cada muestra son unos 500 KB: en el móvil no se descargan todas de golpe).
            for (const track of missing.filter(item => !result.has(item.id)).slice(0, analyze)) {
                const buffer = await loadPreview(track);
                if (buffer) remember(track, await detectBpm(buffer).catch(() => null));
            }
        }
        return result;
    })();

    result.ready = done;
    return result;
}
