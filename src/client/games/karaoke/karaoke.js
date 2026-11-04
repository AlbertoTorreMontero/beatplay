// SIGUE CANTANDO (cliente): el foco, el corte y el veredicto del público.
import { definePartyGame } from "../../lib/party.js";

export default definePartyGame({
    id: "karaoke",
    title: "Sigue cantando",
    tagline: "Suena una canción y, de repente, se corta. Quien está en el foco tiene que seguir cantándola. Los demás deciden si lo clavó.",
    rules: [
        "Cada ronda le toca a uno estar en el foco. Todos lo veréis en pantalla.",
        "Suena una canción y en algún momento se corta. Quien está en el foco sigue cantando donde se quedó (letra o tarareo).",
        "La música vuelve justo donde se cortó: así se oye si lo que cantó era lo que venía.",
        "Los demás votan: ¿lo clavó o no? Puntos para el cantante según los votos, y para quien vote como la mayoría."
    ],

    screens: {
        listen(view, kit) {
            if (view.you) {
                kit.buzz([80, 60, 80]);
                return kit.stack(kit.headline("Estás en el foco 🎤", "Escucha con atención: cuando se corte, sigues tú.", "pt-spotlight"));
            }
            return kit.stack(kit.headline(`Foco: ${view.singer}`, "Cuando se corte la música, le toca seguir cantando."));
        },

        sing(view, kit) {
            if (view.you) {
                kit.buzz(200);
                return kit.stack(kit.headline("¡CANTA!", "Sigue la canción donde se ha cortado.", "pt-sing"));
            }
            return kit.stack(kit.headline(`¡Vamos, ${view.singer}!`, "En unos segundos vuelve la música para comprobarlo."));
        },

        vote(view, kit) {
            const { h, send } = kit;
            if (view.you) return kit.stack(kit.headline("Veredicto…", "La música ha vuelto. Los demás están votando."), kit.wait("", view.votes, view.voters));

            const options = kit.choices([
                { value: true, label: "¡Lo clavó!", className: "good" },
                { value: false, label: "Ni de lejos", className: "bad" }
            ], (ok, button) => {
                send("vote", { ok });
                options.lock(button);
            }, { columns: 2, className: "pt-verdict" });
            if (view.vote != null) options.lock(options.children[view.vote ? 0 : 1]);

            const count = h("p", { class: "pt-help" });
            const node = h("div", { class: "pt-stack pt-center" },
                h("h2", { class: "pt-question" }, `¿Lo clavó ${view.singer}?`),
                h("p", { class: "pt-help" }, "Escucha cómo sigue la canción y vota."),
                options,
                count);
            node.update = next => { count.textContent = `${next.votes} de ${next.voters} han votado`; };
            node.update(view);
            return node;
        },

        reveal(view, kit) {
            const { h } = kit;
            return h("div", { class: "pt-stack" },
                kit.headline(view.nailed ? `¡${view.singer} lo clavó!` : `${view.singer}… casi`, `${view.ups} a favor · ${view.downs} en contra · +${view.points}`, view.nailed ? "good" : "bad"),
                h("div", { class: "pt-inline" }, kit.songCard(view.song, { size: "sm", label: "Era" })),
                kit.scores(view.scoreboard, { limit: 5 }));
        }
    }
});
