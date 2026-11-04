// DUELO DE DJS (cliente): elegir canción para la frase, escuchar las de todos y votar.
import { definePartyGame } from "../../lib/party.js";

export default definePartyGame({
    id: "djbattle",
    title: "Duelo de DJs",
    tagline: "Sale una situación y cada uno elige en secreto la canción perfecta para ella. Suenan todas sin nombre y se vota la mejor.",
    rules: [
        "Sale una frase, por ejemplo: «La canción para llorar en el coche».",
        "Cada uno busca y elige una canción de la playlist del anfitrión. Nadie ve qué eliges.",
        "Suena un trocito de cada una. Después, vota la que mejor encaja (la tuya no vale).",
        "Cada voto son puntos. Si te votan todos, premio extra. No hace falta saber de música: gana quien mejor conoce a la sala."
    ],

    keyOf: view => view.cursor ?? "",

    screens: {
        pick(view, kit) {
            const { h, send } = kit;
            const chosen = h("div", { class: "pt-picked" });
            const count = h("p", { class: "pt-help" });

            const showPicked = index => chosen.replaceChildren(index == null ? "" : kit.songCard(index, { size: "sm", label: "Tu elección (puedes cambiarla)" }));
            const search = kit.search(track => {
                send("pick", { index: track.id });
                showPicked(track.id);
                search.search.clear();
            }, "Busca tu canción");

            const node = h("div", { class: "pt-stack pt-top" },
                h("blockquote", { class: "pt-prompt" }, view.prompt),
                search,
                chosen,
                count);

            node.update = next => {
                count.textContent = `${next.ready} de ${next.total} han elegido`;
                if (next.picked != null && !chosen.firstChild) showPicked(next.picked);
            };
            node.update(view);
            return node;
        },

        listen(view, kit) {
            const { h } = kit;
            return h("div", { class: "pt-stack pt-center" },
                h("blockquote", { class: "pt-prompt small" }, view.prompt),
                h("span", { class: "eyebrow" }, `Candidata ${view.cursor} de ${view.count}`),
                kit.songCard(view.song, { size: "lg" }),
                h("p", { class: "pt-help" }, "¿Encaja? Piensa tu voto."));
        },

        vote(view, kit) {
            const { h, send } = kit;
            const items = view.entries.map(entry => ({
                value: entry.i,
                label: kit.song(entry.song).name,
                sub: entry.mine ? "La tuya" : kit.song(entry.song).artist,
                cover: kit.song(entry.song).cover,
                disabled: entry.mine
            }));
            const options = kit.choices(items, (entry, button) => {
                send("vote", { entry });
                options.lock(button);
            }, { className: "with-covers" });
            if (view.voted != null) options.lock(options.children[view.entries.findIndex(entry => entry.i === view.voted)]);

            return h("div", { class: "pt-stack" },
                h("blockquote", { class: "pt-prompt small" }, view.prompt),
                h("h2", { class: "pt-question" }, "¿Cuál encaja mejor?"),
                options);
        },

        reveal(view, kit) {
            const { h } = kit;
            if (!view.results?.length) return kit.headline("Sin duelo", "Hacen falta al menos dos canciones distintas.");
            const [top] = view.results;
            return h("div", { class: "pt-stack" },
                h("blockquote", { class: "pt-prompt small" }, view.prompt),
                h("ol", { class: "pt-rows" }, view.results.map((row, i) => h("li", { class: `pt-row ${i === 0 && top.votes ? "good" : ""}` },
                    h("strong", {}, kit.song(row.song).name),
                    h("span", { class: "pt-row-mark" }, `de ${row.pickers.join(" y ")}${row.sweep ? " · ¡unanimidad!" : ""}`),
                    h("span", { class: "pt-row-lives" }, `${row.votes} ★`)))),
                kit.scores(view.scoreboard, { limit: 5 }));
        }
    }
});
