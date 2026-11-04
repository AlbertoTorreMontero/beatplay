// DIBUJA LA PORTADA (cliente): lienzo táctil, galería con la portada de verdad arriba y votación.
import { definePartyGame } from "../../lib/party.js";

const SIZE = 320; // píxeles del dibujo: pesa poco y se ve bien en cualquier pantalla
const COLORS = ["#111111", "#ffffff", "#e63946", "#f4a261", "#ffd60a", "#2a9d8f", "#3a86ff", "#8338ec", "#ff70a6", "#8d5524"];
const WIDTHS = [3, 8, 18];

let gallery = { id: null, images: [] }; // dibujos de la ronda, llegan una vez por ronda
let saved = { key: null, strokes: [] };  // lo dibujado, por si la pantalla se repinta o el móvil se reconecta

// ---- Lienzo

function createCanvas(h, strokes) {
    const canvas = h("canvas", { class: "dr-canvas", width: SIZE, height: SIZE, "aria-label": "Lienzo de dibujo" });
    const ctx = canvas.getContext("2d");
    const pen = { color: COLORS[0], width: WIDTHS[1] };
    let current = null;
    let locked = false;

    const point = event => {
        const rect = canvas.getBoundingClientRect();
        return [(event.clientX - rect.left) * SIZE / rect.width, (event.clientY - rect.top) * SIZE / rect.height];
    };

    function stroke({ color, width, points }) {
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
        canvas.setPointerCapture(event.pointerId);
        current = { color: pen.color, width: pen.width, points: [point(event)] };
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
        "Aparece la portada de una canción (y suena). Todos dibujáis la misma, con el dedo, en vuestro móvil.",
        "Tienes 80 segundos. Si se acaba el tiempo, tu dibujo se envía tal cual.",
        "Se expone la galería: la portada de verdad arriba y todos los dibujos debajo, sin nombre.",
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

            const swatches = h("div", { class: "dr-colors", role: "group", "aria-label": "Color" }, COLORS.map((color, i) =>
                h("button", {
                    type: "button",
                    class: `dr-swatch ${i === 0 ? "active" : ""}`,
                    style: `--swatch: ${color}`,
                    "aria-label": `Color ${i + 1}`,
                    onclick: event => {
                        pad.pen.color = color;
                        [...swatches.children].forEach(button => button.classList.toggle("active", button === event.currentTarget));
                    }
                })));

            const widths = WIDTHS.map((width, i) => h("button", {
                type: "button",
                class: `dr-width ${i === 1 ? "active" : ""}`,
                "aria-label": `Grosor ${i + 1}`,
                onclick: event => {
                    pad.pen.width = width;
                    widths.forEach(button => button.classList.toggle("active", button === event.currentTarget));
                }
            }, h("i", { style: `width:${4 + i * 5}px;height:${4 + i * 5}px` })));

            const done = h("button", { type: "button", class: "btn dr-send", onclick: submit }, "Enviar");

            const node = h("div", { class: "pt-stack pt-top dr-board" },
                h("div", { class: "dr-ref" },
                    song.cover && h("img", { src: song.cover, alt: "Portada que hay que dibujar" }),
                    h("div", {}, h("span", { class: "eyebrow" }, "Dibuja esta portada"), h("strong", {}, song.name), h("span", { class: "muted" }, song.artist))),
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

            const grid = h("div", { class: "dr-gallery" }, gallery.images.map((image, i) => h("button", {
                type: "button",
                class: `dr-piece ${i === view.voted ? "chosen" : ""}`,
                disabled: i === view.mine || view.voted != null,
                onclick: () => {
                    send("vote", { entry: i });
                    [...grid.children].forEach((button, j) => {
                        button.disabled = true;
                        button.classList.toggle("chosen", j === i);
                    });
                }
            }, h("img", { src: image, alt: `Dibujo ${i + 1}` }), i === view.mine && h("small", {}, "El tuyo"))));

            const count = h("p", { class: "pt-help" });
            const node = h("div", { class: "pt-stack pt-top" },
                reference(h, kit.song(view.song)),
                h("h2", { class: "pt-question" }, "¿Cuál te gusta más?"),
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
                    gallery.images[row.entry] && h("img", { src: gallery.images[row.entry], alt: `Dibujo de ${row.name}` }),
                    h("figcaption", {}, h("strong", {}, row.name), h("span", {}, `${row.votes} ★${row.sweep ? " · ¡todos!" : ""}`))))));
        }
    }
});

// La portada de verdad, arriba de la galería.
function reference(h, song) {
    return h("div", { class: "dr-ref dr-ref-real" },
        song.cover && h("img", { src: song.cover, alt: "Portada original" }),
        h("div", {}, h("span", { class: "eyebrow" }, "La de verdad"), h("strong", {}, song.name), h("span", { class: "muted" }, song.artist)));
}
