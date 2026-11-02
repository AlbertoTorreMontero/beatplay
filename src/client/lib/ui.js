// Utilidades de interfaz compartidas por la app y los juegos.

export const $ = (selector, root = document) => root.querySelector(selector);
export const $$ = (selector, root = document) => [...root.querySelectorAll(selector)];

// Crea un elemento: h("button", { class: "btn", onclick }, "Texto", otroNodo)
export function h(tag, props = {}, ...children) {
    const node = document.createElement(tag);

    for (const [key, value] of Object.entries(props)) {
        if (value == null || value === false) continue;
        if (key.startsWith("on")) node.addEventListener(key.slice(2), value);
        else if (key === "class") node.className = value;
        else if (key in node && key !== "list") node[key] = value;
        else node.setAttribute(key, value === true ? "" : value);
    }

    node.append(...children.flat().filter(child => child != null && child !== false));
    return node;
}

export function toast(message, { error = false } = {}) {
    let node = $(".toast");

    if (!node) {
        node = h("div", { class: "toast", role: "status", "aria-live": "polite" });
        document.body.append(node);
    }

    node.textContent = message;
    node.classList.toggle("error", error);
    node.classList.add("show");

    clearTimeout(toast.timer);
    toast.timer = setTimeout(() => node.classList.remove("show"), 4500);
}

// Cambia de pantalla y mueve el foco: sin eso, teclado y lector se quedan en un botón que ya no se ve.
export function showScreen(id) {
    for (const screen of $$(".screen")) screen.classList.toggle("hidden", screen.id !== id);

    const screen = document.getElementById(id);
    screen.tabIndex = -1;
    screen.focus({ preventScroll: true });
    window.scrollTo({ top: 0 });
}

// Vuelve a disparar una animación CSS de un solo uso (p. ej. .bump al cambiar un número).
export function pulse(node, className = "bump") {
    node.classList.remove(className);
    void node.offsetWidth;
    node.classList.add(className);
}

export const formatTime = ms => {
    const seconds = Math.floor((ms || 0) / 1000);
    return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, "0")}`;
};

export function shuffle(array) {
    for (let i = array.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [array[i], array[j]] = [array[j], array[i]];
    }
    return array;
}

// localStorage puede estar bloqueado (modo privado): entonces el valor solo dura la sesión.
export const store = {
    get(key, fallback = null) {
        try {
            return JSON.parse(localStorage.getItem(key)) ?? fallback;
        } catch {
            return fallback;
        }
    },
    set(key, value) {
        try {
            localStorage.setItem(key, JSON.stringify(value));
        } catch {
            /* sin almacenamiento */
        }
    }
};

export const reducedMotion = () => matchMedia("(prefers-reduced-motion: reduce)").matches;

// Elementos marcados con data-ref="nombre" dentro de root: { nombre: elemento }.
export function refs(root) {
    return Object.fromEntries($$("[data-ref]", root).map(node => [node.dataset.ref, node]));
}
