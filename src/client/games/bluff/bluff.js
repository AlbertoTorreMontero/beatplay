// FAROL (cliente): inventar un disco falso, encontrar el de verdad.
import { definePartyGame } from "../../lib/party.js";

export default definePartyGame({
    id: "bluff",
    title: "Farol",
    tagline: "Suena una canción. ¿Cómo se llama su disco? Inventa un nombre que cuele y encuentra el de verdad entre los faroles de los demás.",
    rules: [
        "Suena una canción y ves su título y artista. La pregunta: ¿cómo se llama el disco?",
        "Escribe un nombre falso pero creíble. Si te sabes el de verdad, ¡ni se te ocurra ponerlo!",
        "Salen todos mezclados con el auténtico. Elige el que creas que es el de verdad.",
        "Puntos por encontrar el auténtico y por cada jugador que caiga en tu farol. Hacen falta 3 jugadores o más."
    ],

    screens: {
        write(view, kit) {
            const { h, send } = kit;
            const song = kit.song(view.song);
            const input = h("input", { class: "input pt-input", maxlength: 50, placeholder: "Un disco que cuele", autocomplete: "off", enterkeyhint: "send" });
            const button = h("button", { class: "btn btn-lg", type: "submit" }, "Enviar farol");
            const status = h("p", { class: "pt-help" });
            const form = h("form", { class: "pt-form" }, input, button);

            form.addEventListener("submit", event => {
                event.preventDefault();
                const text = input.value.trim();
                if (!text) return input.focus();
                send("lie", { text });
                input.blur();
            });

            const node = h("div", { class: "pt-stack pt-top" },
                kit.songCard(view.song, { size: "md", label: view.year ? `Sonando · ${view.year}` : "Sonando" }),
                h("h2", { class: "pt-question" }, `¿Cómo se llama el disco de «${song.name}»?`),
                form,
                status);

            node.update = next => {
                status.textContent = next.lie ? `Tu farol: «${next.lie}». ${next.ready} de ${next.total} listos.` : `${next.ready} de ${next.total} listos.`;
                button.textContent = next.lie ? "Cambiar" : "Enviar farol";
            };
            node.update(view);
            return node;
        },

        vote(view, kit) {
            const { h, send } = kit;
            const options = kit.choices(view.options.map(option => ({ value: option.i, label: option.text, sub: option.mine ? "Tu farol" : null, disabled: option.mine })), (option, button) => {
                send("choose", { option });
                options.lock(button);
            });
            if (view.choice != null) options.lock(options.children[view.choice]);

            return h("div", { class: "pt-stack" },
                h("h2", { class: "pt-question" }, `¿Cuál es el disco de verdad de «${kit.song(view.song).name}»?`),
                options);
        },

        reveal(view, kit) {
            const { h } = kit;
            return h("div", { class: "pt-stack" },
                h("div", { class: "pt-truth" },
                    view.cover && h("img", { src: view.cover, alt: "" }),
                    h("div", {}, h("span", { class: "eyebrow" }, "El disco de verdad"), h("strong", { class: "display" }, view.album))),
                h("ol", { class: "pt-rows" }, view.results.filter(row => !row.truth).map(row => h("li", { class: "pt-row" },
                    h("strong", {}, `«${row.text}»`),
                    h("span", { class: "pt-row-mark" }, `de ${row.authors.join(" y ")}`),
                    h("span", { class: "pt-row-lives" }, row.chosenBy.length ? `engañó a ${row.chosenBy.join(", ")}` : "nadie picó")))),
                kit.scores(view.scoreboard, { limit: 5 }));
        }
    }
});
