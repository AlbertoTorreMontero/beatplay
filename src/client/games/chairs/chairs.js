// SILLAS MUSICALES (cliente): un botón enorme y el oído. La pantalla nunca avisa del corte.
import { definePartyGame } from "../../lib/party.js";

const hearts = (lives, max) => "♥".repeat(Math.max(0, lives)) + "♡".repeat(Math.max(0, max - lives));
const seconds = ms => `${(ms / 1000).toFixed(2).replace(".", ",")} s`;

export default definePartyGame({
    id: "chairs",
    title: "Sillas musicales",
    tagline: "Suena una canción y en cualquier momento se corta. Pulsa en cuanto deje de sonar: el más lento, o quien se adelante, pierde una vida.",
    rules: [
        "Suena una canción en el móvil de quien pone la música. Bailad, cantad, lo que queráis.",
        "Cuando la música se corte, pulsa el botón lo antes posible. Tu pantalla no te avisará: solo vale el oído.",
        "Si pulsas mientras aún suena, o no pulsas, pierdes una vida. Si nadie falla, la pierde el más lento.",
        "Tienes dos vidas. Gana el último que quede en pie."
    ],

    screens: {
        dancing(view, { h, send, buzz, headline }) {
            if (!view.alive) return headline("Estás fuera", `Quedan ${view.standing} en pie. Mira cómo caen.`, "pt-out");

            const lives = h("p", { class: "pt-lives", "aria-label": `${view.lives} vidas` }, hearts(view.lives, view.maxLives));
            const button = h("button", { type: "button", class: "pt-bigbutton", "aria-label": "Ya no suena" }, h("span", {}, "¡Silencio!"));
            const help = h("p", { class: "pt-help" }, "Pulsa cuando deje de sonar. Ni antes, ni tarde.");

            const mark = () => {
                button.disabled = true;
                button.classList.add("pressed");
                button.firstChild.textContent = "¡Plantado!";
                help.textContent = "Esperando a los demás…";
            };

            const press = () => {
                if (button.disabled) return;
                send("tap");
                buzz(30);
                mark();
            };
            // pointerdown: responde al instante, sin esperar a soltar el dedo. El click queda para el teclado.
            button.addEventListener("pointerdown", event => {
                event.preventDefault();
                press();
            });
            button.addEventListener("click", event => { if (event.detail === 0) press(); });
            if (view.tapped) mark();

            const node = h("div", { class: "pt-stack pt-center" }, lives, button, help);
            node.update = next => {
                if (next.tapped) mark();
                lives.textContent = hearts(next.lives, next.maxLives);
            };
            return node;
        },

        reveal(view, { h, song, me }) {
            const rows = view.results.map((row, i) => h("li", { class: `pt-row ${row.lost ? "bad" : ""} ${row.id === me ? "is-me" : ""}`, style: `animation-delay: ${i * 60}ms` },
                h("strong", {}, row.name),
                h("span", { class: "pt-row-mark" }, row.early ? "Se adelantó" : row.ms == null ? "No pulsó" : seconds(row.ms)),
                h("span", { class: "pt-row-lives" }, row.out ? "Fuera" : hearts(row.lives, view.maxLives))));

            return h("div", { class: "pt-stack" },
                h("div", { class: "pt-reveal-head" },
                    h("span", { class: "eyebrow" }, "Ha sonado"),
                    h("strong", {}, song(view.song).name),
                    h("span", { class: "muted" }, song(view.song).artist)),
                h("ol", { class: "pt-rows" }, rows),
                h("p", { class: "muted pt-help" }, view.void ? "Habéis fallado todos a la vez: nadie cae, se repite." : `Quedan ${view.standing} en pie.`));
        }
    }
});
