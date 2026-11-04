// DESAFINADO (cliente): tu canción secreta, el turno de tararear y la votación.
import { definePartyGame } from "../../lib/party.js";

export default definePartyGame({
    id: "impostor",
    title: "Desafinado",
    tagline: "Todos tenéis la misma canción secreta… menos uno, que tiene otra y no lo sabe. Tararead por turnos y cazad al que desafina.",
    rules: [
        "Cada uno ve en su móvil una canción secreta. Todas son iguales menos una, y su dueño no sabe que es la rara.",
        "Por turnos, tararea tu canción unos segundos. Sin letra: solo la melodía.",
        "Votad quién creéis que tenía otra canción. Si le pilláis, puntos para quien acertó; si se escapa, puntos para el impostor.",
        "Al final suena la canción buena por el altavoz y se descubre todo. Hacen falta 3 jugadores o más."
    ],

    keyOf: view => view.turn ?? "",

    screens: {
        peek(view, kit) {
            const { h } = kit;
            if (view.song == null) return kit.wait("Esta ronda miras. Entras en la siguiente.");
            return h("div", { class: "pt-stack pt-center" },
                h("span", { class: "eyebrow" }, "Tu canción secreta"),
                kit.songCard(view.song, { size: "lg" }),
                h("p", { class: "pt-help" }, "Memorízala y que nadie vea tu pantalla. Uno de vosotros tiene otra… y no lo sabe."));
        },

        hum(view, kit) {
            const { h, me, name } = kit;
            const mine = view.turnId === me;
            if (mine) kit.buzz(80);

            return h("div", { class: "pt-stack pt-center" },
                mine
                    ? kit.headline("¡Te toca!", "Tararea tu canción. Sin letra.", "pt-spotlight")
                    : kit.headline(`Tararea ${name(view.turnId)}`, "¿Le pega con tu canción?"),
                h("ol", { class: "pt-turns", "aria-label": "Turnos" }, view.order.map((entry, i) =>
                    h("li", { class: i + 1 < view.turn ? "done" : i + 1 === view.turn ? "now" : "" }, entry.name))),
                view.song != null && kit.songCard(view.song, { size: "sm", label: "La tuya" }));
        },

        vote(view, kit) {
            const { h, send } = kit;
            if (!view.canVote) return kit.wait("Votan los que han tarareado.", view.votes, view.voters);

            const count = h("p", { class: "pt-help" }, `${view.votes} de ${view.voters} han votado`);
            const options = kit.choices(view.candidates.map(candidate => ({ value: candidate.id, label: candidate.name })), (target, button) => {
                send("vote", { target });
                options.lock(button);
            }, { columns: 2 });
            if (view.voted) options.lock([...options.children].find((_, i) => view.candidates[i].id === view.voted));

            const node = h("div", { class: "pt-stack" }, h("h2", { class: "pt-question" }, "¿Quién desafinaba?"), options, count);
            node.update = next => { count.textContent = `${next.votes} de ${next.voters} han votado`; };
            return node;
        },

        reveal(view, kit) {
            const { h, me } = kit;
            const wasMe = view.impostorId === me;
            return h("div", { class: "pt-stack" },
                kit.headline(view.caught ? `¡Pillado, ${view.impostor}!` : `${view.impostor} se ha escapado`, wasMe ? "Eras tú el impostor." : view.caught ? "Buen oído." : "Nadie le pilló."),
                h("div", { class: "pt-versus" },
                    kit.songCard(view.real, { size: "sm", label: "La de todos (suena)" }),
                    kit.songCard(view.fake, { size: "sm", label: "La del impostor" })),
                h("ol", { class: "pt-rows" }, view.votes.map(row => h("li", { class: `pt-row ${row.id === view.impostorId ? "good" : ""}` },
                    h("strong", {}, row.name),
                    h("span", { class: "pt-row-mark" }, row.votedFor ? `votó a ${row.votedFor}` : "no votó"),
                    h("span", { class: "pt-row-lives" }, `${row.votes} ✋`)))));
        }
    }
});
