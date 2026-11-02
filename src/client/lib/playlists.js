// Selector de playlists: lo usan el menú y Music Roulette.
import { h } from "./ui.js";
import { getPlaylists } from "./api.js";

/**
 * Pinta las playlists del usuario en `container` con estados de carga, vacío y error.
 * Devuelve { select(id) } para marcar una desde fuera.
 */
export function playlistPicker(container, { selectedId = null, onSelect }) {

    let current = selectedId;

    const mark = () => {
        for (const card of container.querySelectorAll(".playlist")) {
            card.setAttribute("aria-pressed", String(card.dataset.id === current));
        }
    };

    const card = playlist => h("button", {
        type: "button",
        class: "playlist",
        "data-id": playlist.id,
        "aria-pressed": String(playlist.id === current),
        onclick: () => {
            current = playlist.id;
            mark();
            onSelect(playlist);
        }
    },
        h("span", { class: "playlist-cover" },
            playlist.image ? h("img", { src: playlist.image, alt: "", loading: "lazy" }) : h("span", { class: "playlist-initial" }, (playlist.name || "?")[0])
        ),
        h("span", { class: "playlist-name" }, playlist.name || "Sin nombre"),
        h("span", { class: "playlist-meta" }, `${playlist.tracks} canciones`)
    );

    async function load({ refresh = false } = {}) {
        container.setAttribute("aria-busy", "true");
        container.replaceChildren(...Array.from({ length: 6 }, () => h("div", { class: "playlist playlist-skeleton skeleton", "aria-hidden": "true" })));

        try {
            const playlists = await getPlaylists({ refresh });

            container.replaceChildren(
                ...(playlists.length
                    ? playlists.map(card)
                    : [h("div", { class: "state" },
                        h("strong", {}, "No tienes playlists con canciones."),
                        h("span", {}, "Crea una o guarda alguna en tu cuenta y vuelve a cargar."),
                        h("button", { type: "button", class: "btn btn-outline", onclick: () => load({ refresh: true }) }, "Volver a cargar"))])
            );
        } catch (error) {
            container.replaceChildren(h("div", { class: "state", role: "alert" },
                h("strong", {}, "No se pudieron cargar tus playlists."),
                h("span", {}, error.message),
                h("button", { type: "button", class: "btn btn-outline", onclick: () => load({ refresh: true }) }, "Reintentar")));
        } finally {
            container.removeAttribute("aria-busy");
        }
    }

    load();

    return {
        select(id) {
            current = id;
            mark();
        }
    };
}
