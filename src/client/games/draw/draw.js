// DIBUJA LA PORTADA (cliente): lienzo táctil, galería con la portada de verdad arriba y votación.
import { definePartyGame } from "../../lib/party.js";

const SIZE = 320; // píxeles del dibujo: pesa poco y se ve bien en cualquier pantalla
// Paleta amplia (claros, vivos y oscuros) y además un selector libre.
const COLORS = [
    "#111111", "#5c5c5c", "#a8a8a8", "#ffffff", "#e63946", "#ff7b54", "#f4a261", "#ffd60a", "#f6e7c1",
    "#8ac926", "#2a9d8f", "#0b6e4f", "#8ecae6", "#3a86ff", "#1d3557", "#8338ec", "#ff70a6", "#8d5524"
];
const FILL_TOLERANCE = 60; // cuánto puede variar un píxel para que el cubo lo pinte (bordes suavizados)
const HOLD_MS = 180;       // mantener pulsado para ver en grande
const WIDTHS = [3, 8, 18];

let gallery = { id: null, images: [] }; // dibujos de la ronda, llegan una vez por ronda
let saved = { key: null, strokes: [] };  // lo dibujado, por si la pantalla se repinta o el móvil se reconecta

// ---- Lienzo

function createCanvas(h, strokes) {
    const canvas = h("canvas", { class: "dr-canvas", width: SIZE, height: SIZE, "aria-label": "Lienzo de dibujo" });
    const ctx = canvas.getContext("2d");
    const pen = { color: COLORS[0], width: WIDTHS[1], tool: "brush" };
    let current = null;
    let locked = false;

    const point = event => {
        const rect = canvas.getBoundingClientRect();
        return [(event.clientX - rect.left) * SIZE / rect.width, (event.clientY - rect.top) * SIZE / rect.height];
    };

    // Cubo de pintura: rellena la zona del color tocado (relleno por líneas, rápido en 320×320).
    function fill({ x, y, color }) {
        const image = ctx.getImageData(0, 0, SIZE, SIZE);
        const data = image.data;
        const start = (Math.floor(y) * SIZE + Math.floor(x)) * 4;
        const target = [data[start], data[start + 1], data[start + 2]];
        const paint = [parseInt(color.slice(1, 3), 16), parseInt(color.slice(3, 5), 16), parseInt(color.slice(5, 7), 16)];
        if (Math.abs(target[0] - paint[0]) + Math.abs(target[1] - paint[1]) + Math.abs(target[2] - paint[2]) < 6) return;

        const matches = i => Math.abs(data[i] - target[0]) + Math.abs(data[i + 1] - target[1]) + Math.abs(data[i + 2] - target[2]) <= FILL_TOLERANCE;
        const done = new Uint8Array(SIZE * SIZE);
        const stack = [[Math.floor(x), Math.floor(y)]];

        while (stack.length) {
            const [px, py] = stack.pop();
            let left = px;
            while (left >= 0 && !done[py * SIZE + left] && matches((py * SIZE + left) * 4)) left--;
            let spanUp = false;
            let spanDown = false;
            for (let cx = left + 1; cx < SIZE && !done[py * SIZE + cx] && matches((py * SIZE + cx) * 4); cx++) {
                const i = (py * SIZE + cx) * 4;
                done[py * SIZE + cx] = 1;
                data[i] = paint[0]; data[i + 1] = paint[1]; data[i + 2] = paint[2]; data[i + 3] = 255;
                if (py > 0) {
                    const up = matches(((py - 1) * SIZE + cx) * 4) && !done[(py - 1) * SIZE + cx];
                    if (up && !spanUp) stack.push([cx, py - 1]);
                    spanUp = up;
                }
                if (py < SIZE - 1) {
                    const down = matches(((py + 1) * SIZE + cx) * 4) && !done[(py + 1) * SIZE + cx];
                    if (down && !spanDown) stack.push([cx, py + 1]);
                    spanDown = down;
                }
            }
        }
        ctx.putImageData(image, 0, 0);
    }

    function stroke(item) {
        if (item.fill) return fill(item);
        const { color, width, points } = item;
        ctx.strokeStyle = ctx.fillStyle = color;
        ctx.lineWidth = width;
        ctx.lineCap = ctx.lineJoin = "round";
        if (points.length === 1) {
            ctx.beginPath();
            ctx.arc(points[0][0], points[0][1], width / 2, 0, Math.PI * 2);
            ctx.fill();
            return;
        }
        ctx.beginPath();
        ctx.moveTo(...points[0]);
        points.slice(1).forEach(p => ctx.lineTo(...p));
        ctx.stroke();
    }

    function redraw() {
        ctx.fillStyle = "#ffffff";
        ctx.fillRect(0, 0, SIZE, SIZE);
        strokes.forEach(stroke);
    }

    canvas.addEventListener("pointerdown", event => {
        if (locked) return;
        event.preventDefault();
        const [x, y] = point(event);
        if (pen.tool === "fill") {
            const item = { fill: true, x, y, color: pen.color };
            strokes.push(item);
            fill(item);
            return;
        }
        canvas.setPointerCapture(event.pointerId);
        current = { color: pen.color, width: pen.width, points: [[x, y]] };
        strokes.push(current);
        stroke(current);
    });

    canvas.addEventListener("pointermove", event => {
        if (!current) return;
        const events = event.getCoalescedEvents?.() || [event];
        const last = current.points[current.points.length - 1];
        events.forEach(e => current.points.push(point(e)));
        stroke({ ...current, points: [last, ...current.points.slice(-events.length)] });
    });

    const end = () => { current = null; };
    canvas.addEventListener("pointerup", end);
    canvas.addEventListener("pointercancel", end);

    redraw();

    return {
        canvas,
        pen,
        undo() { strokes.pop(); redraw(); },
        clear() { strokes.length = 0; redraw(); },
        lock() { locked = true; canvas.classList.add("locked"); },
        empty: () => strokes.length === 0,
        image: () => canvas.toDataURL("image/jpeg", 0.8)
    };
}

// ---- Juego

export default definePartyGame({
    id: "draw",
    title: "Dibuja la portada",
    tagline: "Aparece la portada de una canción y todos la dibujáis a la vez. Luego se expone la galería con la de verdad arriba y se vota el mejor dibujo.",
    rules: [
        "Aparece la portada de una canción (y suena). Todos dibujáis la misma, con el dedo, en vuestro móvil: pincel, cubo de pintura y muchos colores.",
        "Tienes 80 segundos. Si se acaba el tiempo, tu dibujo se envía tal cual.",
        "Se expone la galería: la portada de verdad arriba y todos los dibujos debajo, sin nombre. Mantén pulsado cualquiera para verlo en grande.",
        "Vota el que más te guste (el tuyo no vale). Cada voto son 100 puntos, y si te votan todos, premio extra."
    ],

    // Los dibujos llegan aparte, una vez por ronda.
    onMessage(message) {
        if (message.type === "drawings") gallery = { id: message.gallery, images: message.images || [] };
    },

    screens: {
        draw(view, kit) {
            const { h, send } = kit;
            const song = kit.song(view.song);
            const key = `${view.round}:${view.song}`;
            if (saved.key !== key) saved = { key, strokes: [] };

            const pad = createCanvas(h, saved.strokes);
            const status = h("p", { class: "pt-help" });
            let sent = false;

            const submit = () => {
                if (sent || !pad.canvas.isConnected) return;
                sent = true;
                pad.lock();
                send("drawing", { image: pad.image() });
                done.disabled = true;
                done.textContent = "Enviado";
            };

            const pickColor = (color, button) => {
                pad.pen.color = color;
                [...swatches.children].forEach(other => other.classList.toggle("active", other === button));
            };
            const custom = h("input", { type: "color", value: "#ff5e8a", class: "dr-custom", "aria-label": "Otro color", oninput: event => pickColor(event.target.value, customLabel) });
            const customLabel = h("label", { class: "dr-swatch dr-swatch-custom", title: "Otro color" }, custom);
            const swatches = h("div", { class: "dr-colors", role: "group", "aria-label": "Color" },
                COLORS.map((color, i) => h("button", {
                    type: "button",
                    class: `dr-swatch ${i === 0 ? "active" : ""}`,
                    style: `--swatch: ${color}`,
                    "aria-label": `Color ${i + 1}`,
                    onclick: event => pickColor(color, event.currentTarget)
                })),
                customLabel);

            // Pincel (con tres grosores) o cubo de pintura.
            const tools = [];
            const setTool = (tool, width, button) => {
                pad.pen.tool = tool;
                if (width) pad.pen.width = width;
                tools.forEach(other => other.classList.toggle("active", other === button));
                pad.canvas.classList.toggle("filling", tool === "fill");
            };
            WIDTHS.forEach((width, i) => tools.push(h("button", {
                type: "button",
                class: `dr-width ${i === 1 ? "active" : ""}`,
                "aria-label": `Pincel ${["fino", "medio", "gordo"][i]}`,
                onclick: event => setTool("brush", width, event.currentTarget)
            }, h("i", { style: `width:${4 + i * 5}px;height:${4 + i * 5}px` }))));
            tools.push(h("button", {
                type: "button",
                class: "dr-width dr-bucket",
                "aria-label": "Cubo de pintura",
                title: "Cubo: rellena una zona",
                onclick: event => setTool("fill", null, event.currentTarget)
            }, bucketIcon(h)));
            const widths = tools;

            const done = h("button", { type: "button", class: "btn dr-send", onclick: submit }, "Enviar");

            const node = h("div", { class: "pt-stack pt-top dr-board" },
                h("div", { class: "dr-ref" },
                    song.cover && zoomable(h("img", { src: song.cover, alt: "Portada que hay que dibujar" })),
                    h("div", {}, h("span", { class: "eyebrow" }, "Dibuja esta portada"), h("strong", {}, song.name), h("span", { class: "muted" }, "Mantén pulsada la portada para ampliarla"))),
                pad.canvas,
                swatches,
                h("div", { class: "dr-tools" },
                    ...widths,
                    h("button", { type: "button", class: "btn btn-ghost dr-tool", "aria-label": "Deshacer", onclick: () => pad.undo() }, "↶"),
                    h("button", { type: "button", class: "btn btn-ghost dr-tool", "aria-label": "Borrar todo", onclick: () => pad.clear() }, "✕"),
                    done),
                status);

            // Al acabar el tiempo, se envía lo que haya (si has dibujado algo).
            setTimeout(() => { if (!pad.empty()) submit(); }, Math.max(0, view.remaining - 1500));

            node.update = next => {
                status.textContent = `${next.ready} de ${next.total} han terminado`;
                if (next.sent && !sent) {
                    sent = true;
                    pad.lock();
                    done.disabled = true;
                    done.textContent = "Enviado";
                }
            };
            node.update(view);
            return node;
        },

        vote(view, kit) {
            const { h, send } = kit;
            if (gallery.id !== view.gallery) return kit.wait("Colgando los dibujos…");

            // Tocar vota; mantener pulsado amplía el dibujo (y no vota).
            const grid = h("div", { class: "dr-gallery" }, gallery.images.map((image, i) => {
                const picture = h("img", { src: image, alt: `Dibujo ${i + 1}` });
                const button = h("button", {
                    type: "button",
                    class: `dr-piece ${i === view.voted ? "chosen" : ""}`,
                    disabled: i === view.mine || view.voted != null,
                    onclick: () => {
                        if (button.dataset.zoomed) return delete button.dataset.zoomed;
                        send("vote", { entry: i });
                        [...grid.children].forEach((other, j) => {
                            other.disabled = true;
                            other.classList.toggle("chosen", j === i);
                        });
                    }
                }, picture, i === view.mine && h("small", {}, "El tuyo"));
                zoomable(picture, button);
                return button;
            }));

            const count = h("p", { class: "pt-help" });
            const node = h("div", { class: "pt-stack pt-top" },
                reference(h, kit.song(view.song)),
                h("h2", { class: "pt-question" }, "¿Cuál te gusta más?"),
                h("p", { class: "pt-help muted" }, "Toca para votar · mantén pulsado para verlo en grande"),
                grid,
                count);
            node.update = next => { count.textContent = `${next.votes} de ${next.total} han votado`; };
            node.update(view);
            return node;
        },

        reveal(view, kit) {
            const { h, me } = kit;
            if (!view.results?.length) return kit.headline("Sin dibujos", "Esta ronda nadie ha dibujado.");
            const top = view.results[0].votes;
            return h("div", { class: "pt-stack pt-top" },
                reference(h, kit.song(view.song)),
                h("div", { class: "dr-gallery" }, view.results.map(row => h("figure", { class: `dr-piece ${row.votes && row.votes === top ? "winner" : ""} ${row.id === me ? "is-me" : ""}` },
                    gallery.images[row.entry] && zoomable(h("img", { src: gallery.images[row.entry], alt: `Dibujo de ${row.name}` })),
                    h("figcaption", {}, h("strong", {}, row.name), h("span", {}, `${row.votes} ★${row.sweep ? " ¡todos!" : ""}`))))));
        }
    }
});

// La portada de verdad, arriba de la galería.
function reference(h, song) {
    return h("div", { class: "dr-ref dr-ref-real" },
        song.cover && zoomable(h("img", { src: song.cover, alt: "Portada original" })),
        h("div", {}, h("span", { class: "eyebrow" }, "La de verdad"), h("strong", {}, song.name), h("span", { class: "muted" }, song.artist)));
}


// ---- Ver en grande mientras se mantiene pulsado

let viewer = null;

function showBig(src) {
    if (!viewer) {
        viewer = document.createElement("div");
        viewer.className = "dr-viewer";
        viewer.innerHTML = "<img alt=\"\">";
        document.body.append(viewer);
    }
    viewer.firstChild.src = src;
    viewer.classList.add("open");
}

const hideBig = () => viewer?.classList.remove("open");

// Mantener pulsado (dedo o ratón) enseña la imagen a pantalla completa hasta soltar.
// Si va dentro de un botón, ese toque largo no cuenta como clic (owner.dataset.zoomed).
function zoomable(img, owner = null) {
    let timer = null;
    img.draggable = false;
    img.classList.add("dr-zoomable");
    img.addEventListener("contextmenu", event => event.preventDefault());
    img.addEventListener("pointerdown", () => {
        timer = setTimeout(() => {
            timer = null;
            if (owner) owner.dataset.zoomed = "1";
            showBig(img.src);
            navigator.vibrate?.(10);
        }, HOLD_MS);
    });
    const release = () => {
        clearTimeout(timer);
        timer = null;
        hideBig();
    };
    ["pointerup", "pointercancel", "pointerleave"].forEach(type => img.addEventListener(type, release));
    return img;
}

function bucketIcon(h) {
    const icon = h("span", { class: "dr-bucket-icon", "aria-hidden": "true" });
    icon.innerHTML = '<svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M5 11l7-7 7 7-7 7z"/><path d="M12 4v4"/><path d="M19 13c1 1.6 2 2.8 2 4a2 2 0 0 1-4 0c0-1.2 1-2.4 2-4z"/></svg>';
    return icon;
}
