// PUJA JUSTA (cliente): pujar por el año o por la duración, sin pasarse.
import { definePartyGame } from "../../lib/party.js";

const MODES = {
    year: { label: "Año", question: "¿De qué año es?", steps: [-10, -1, 1, 10] },
    duration: { label: "Duración", question: "¿Cuánto dura?", steps: [-60, -10, -1, 1, 10, 60] }
};

const clock = seconds => `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, "0")}`;
const show = (value, mode) => (mode === "duration" ? clock(value) : String(value));
const stepLabel = (delta, mode) => {
    const sign = delta > 0 ? "+" : "−";
    const size = Math.abs(delta);
    return mode === "duration" ? `${sign}${size >= 60 ? `${size / 60} min` : `${size} s`}` : `${sign}${size}`;
};
const gap = (diff, mode) => (mode === "duration" ? `${Math.abs(diff)} s` : `${Math.abs(diff)} año${Math.abs(diff) === 1 ? "" : "s"}`);

export default definePartyGame({
    id: "bid",
    title: "Puja justa",
    tagline: "Como en El precio justo: suena una canción y todos pujáis por su año o por cuánto dura. Gana quien más se acerca sin pasarse.",
    dated: true, // las canciones llegan con año y duración
    rules: [
        "Antes de empezar, el anfitrión elige a qué se puja: el año de la canción o su duración.",
        "Suena una canción y cada uno puja en secreto.",
        "Gana la ronda quien más se acerca SIN PASARSE: 300 puntos. Clavarlo: 200 más.",
        "Si todos os pasáis, gana quien menos se pasó, pero solo la mitad."
    ],

    // Selector de modo en la sala: lo cambia el anfitrión, el resto lo ve.
    options(state, { h, isHost, send }) {
        const mode = state.mode || "year";
        if (!isHost()) return h("p", { class: "rl-status" }, `Se puja por: ${MODES[mode].label.toLowerCase()}.`);
        return h("div", { class: "pt-mode" },
            h("span", { class: "eyebrow" }, "¿A qué se puja?"),
            h("div", { class: "segmented", role: "group", "aria-label": "Modo" }, Object.entries(MODES).map(([key, info]) =>
                h("button", { type: "button", "aria-pressed": String(key === mode), onclick: () => send("mode", { mode: key }) }, info.label))));
    },

    screens: {
        guess(view, kit) {
            const { h, send } = kit;
            const { mode, range: [min, max] } = view;
            const middle = mode === "duration" ? 210 : Math.round((min + max) / 2 / 5) * 5;
            let value = view.bid ?? middle;

            const display = h("output", { class: "pt-year display" }, show(value, mode));
            const slider = h("input", { type: "range", min, max, value, class: "pt-slider", "aria-label": MODES[mode].label });
            const set = next => {
                value = Math.max(min, Math.min(max, next));
                display.textContent = show(value, mode);
                slider.value = value;
            };
            slider.addEventListener("input", () => set(Number(slider.value)));

            const confirm = h("button", { type: "button", class: "btn btn-lg", onclick: () => send("bid", { value }) }, "Pujar");
            const status = h("p", { class: "pt-help" });

            const node = h("div", { class: "pt-stack pt-center" },
                h("h2", { class: "pt-question" }, MODES[mode].question),
                display,
                slider,
                h("div", { class: `pt-steps steps-${MODES[mode].steps.length}` }, MODES[mode].steps.map(delta =>
                    h("button", { type: "button", class: "btn btn-outline pt-step", onclick: () => set(value + delta) }, stepLabel(delta, mode)))),
                confirm,
                h("p", { class: "pt-help muted" }, "Sin pasarte."),
                status);

            node.update = next => {
                status.textContent = next.bid != null ? `Tu puja: ${show(next.bid, mode)}. ${next.ready} de ${next.total} listos.` : `${next.ready} de ${next.total} listos.`;
                confirm.textContent = next.bid != null ? "Cambiar puja" : "Pujar";
            };
            node.update(view);
            return node;
        },

        reveal(view, kit) {
            const { h, me } = kit;
            const song = kit.song(view.song);
            return h("div", { class: "pt-stack" },
                h("div", { class: "pt-truth" },
                    song.cover && h("img", { src: song.cover, alt: "" }),
                    h("div", {},
                        h("span", { class: "eyebrow" }, `${song.name} · ${song.artist}`),
                        h("strong", { class: "display pt-year" }, show(view.answer, view.mode)))),
                view.allOver && h("p", { class: "pt-help bad" }, "Os habéis pasado todos: gana quien menos, a mitad de premio."),
                h("ol", { class: "pt-rows" }, view.bids.map(row => h("li", { class: `pt-row ${row.winner ? "good" : row.over ? "bad" : ""} ${row.id === me ? "is-me" : ""}` },
                    h("strong", {}, row.name),
                    h("span", { class: "pt-row-mark" }, `${show(row.bid, view.mode)} · ${row.diff === 0 ? "¡clavado!" : row.over ? `se pasó ${gap(row.diff, view.mode)}` : `a ${gap(row.diff, view.mode)}`}`),
                    h("span", { class: "pt-row-lives" }, row.points ? `+${row.points}` : "")))),
                !view.bids.length && kit.wait("Nadie ha pujado."));
        }
    }
});
