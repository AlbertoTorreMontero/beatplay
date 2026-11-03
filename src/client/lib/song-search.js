// Buscador de canciones para responder: escribes y eliges de la lista (Intro y Pulsador).
import { h } from "./ui.js";

const MAX_RESULTS = 6;

// Sin tildes ni mayúsculas: "cancion" encuentra "Canción".
const normalize = text => String(text || "").normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();

/**
 * Monta el buscador en `container`. onPick(track) se llama al elegir una canción.
 * Devuelve { setChoices, clear, focus, disable }.
 */
export function songSearch(container, { onPick, placeholder = "Escribe el título o el artista" }) {

    let choices = [];
    let results = [];
    let active = 0;

    const input = h("input", {
        class: "input song-search-input",
        type: "search",
        placeholder,
        autocomplete: "off",
        spellcheck: false,
        "aria-label": "Buscar canción",
        "aria-autocomplete": "list",
        role: "combobox",
        "aria-expanded": "false"
    });
    const list = h("ul", { class: "song-search-results", role: "listbox" });

    container.replaceChildren(input, list);

    function render() {
        list.replaceChildren(...results.map((track, i) =>
            h("li", { role: "option", "aria-selected": String(i === active) },
                h("button", { type: "button", tabIndex: -1, onclick: () => pick(track) },
                    h("strong", {}, track.name),
                    h("span", {}, track.artist)))));
        input.setAttribute("aria-expanded", String(results.length > 0));
    }

    function search() {
        const words = normalize(input.value).split(/\s+/).filter(Boolean);
        active = 0;
        results = words.length
            ? choices.filter(track => {
                const text = normalize(`${track.name} ${track.artist}`);
                return words.every(word => text.includes(word));
            }).slice(0, MAX_RESULTS)
            : [];
        render();
    }

    function pick(track) {
        input.value = "";
        results = [];
        render();
        onPick(track);
    }

    input.addEventListener("input", search);
    input.addEventListener("keydown", event => {
        if (!results.length) return;
        if (event.key === "ArrowDown" || event.key === "ArrowUp") {
            event.preventDefault();
            active = (active + (event.key === "ArrowDown" ? 1 : -1) + results.length) % results.length;
            render();
        } else if (event.key === "Enter") {
            event.preventDefault();
            pick(results[active]);
        }
    });

    return {
        setChoices(tracks) {
            choices = tracks;
            search();
        },
        clear() {
            input.value = "";
            search();
        },
        focus: () => input.focus({ preventScroll: true }),
        disable(disabled) {
            input.disabled = disabled;
            if (disabled) {
                results = [];
                render();
            }
        }
    };
}
