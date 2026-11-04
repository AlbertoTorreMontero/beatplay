// SUBASTA (cliente): pujar segundos, escuchar el fragmento y jugarse el bote.
import { definePartyGame } from "../../lib/party.js";

const clueText = clue => `Una canción de ${clue.artist}${clue.year ? ` (${clue.year})` : ""}`;

export default definePartyGame({
    id: "auction",
    title: "Subasta",
    tagline: "«Yo la adivino en 3 segundos». Puja cuántos segundos necesitas para adivinar la canción. Quien menos puje se la juega.",
    rules: [
        "Pista: el artista y el año. Cada uno puja en secreto cuántos segundos necesita (de 1 a 10).",
        "La puja más baja gana el reto (si empatan, quien pujó antes). Suenan solo esos segundos.",
        "Si acierta el título, se lleva más puntos cuanto menos pujó. Si falla, el bote se reparte entre los demás.",
        "Después suena la canción entera, de premio."
    ],

    screens: {
        bid(view, kit) {
            const { h, send } = kit;
            const status = h("p", { class: "pt-help" });
            const grid = kit.choices(Array.from({ length: 10 }, (_, i) => ({ value: i + 1, label: `${i + 1}`, sub: "seg." })), (seconds, button) => {
                send("bid", { seconds });
                [...grid.children].forEach(other => other.classList.toggle("chosen", other === button));
            }, { columns: 5, className: "pt-bids" });
            if (view.bid) grid.children[view.bid - 1].classList.add("chosen");

            const node = h("div", { class: "pt-stack" },
                h("blockquote", { class: "pt-prompt small" }, clueText(view.clue)),
                h("h2", { class: "pt-question" }, "¿En cuántos segundos la adivinas?"),
                grid,
                status);
            node.update = next => { status.textContent = `${next.bid ? `Pujas ${next.bid} s. ` : ""}${next.ready} de ${next.total} han pujado`; };
            node.update(view);
            return node;
        },

        listen(view, kit) {
            const mine = view.winnerId === kit.me;
            if (mine) kit.buzz(80);
            return kit.stack(
                kit.h("blockquote", { class: "pt-prompt small" }, clueText(view.clue)),
                kit.headline(mine ? "¡Escucha!" : `${view.winner} dice: en ${view.seconds} s`, mine ? `Tienes ${view.seconds} segundos de canción.` : "Silencio, que escucha.", "pt-spotlight"));
        },

        answer(view, kit) {
            const { h, send } = kit;
            if (!view.options) return kit.stack(kit.headline(`${view.winner} está pensando…`, `Pujó ${view.seconds} s. Si falla, os repartís el bote.`));
            const options = kit.songChoices(view.options, "name", (option, button) => {
                send("answer", { option });
                options.lock(button);
            });
            return h("div", { class: "pt-stack" }, h("h2", { class: "pt-question" }, "¿Cuál era?"), options);
        },

        reveal(view, kit) {
            const { h } = kit;
            const title = !view.winner ? "Nadie pujó"
                : view.correct ? `¡${view.winner} la clavó en ${view.seconds} s!`
                : `${view.winner} falló`;
            const sub = view.correct ? `+${view.points} puntos` : view.winner ? "Bote para todos los demás." : "";
            return h("div", { class: "pt-stack" },
                kit.headline(title, sub, view.correct ? "good" : "bad"),
                h("div", { class: "pt-inline" }, kit.songCard(view.song, { size: "sm", label: "Era (suena entera)" })),
                kit.scores(view.scoreboard, { limit: 5 }));
        }
    }
});
