// Utilidades compartidas por el servidor.

class HttpError extends Error {
    constructor(message, status = 500) {
        super(message);
        this.status = status;
    }
}

// Fisher-Yates. Mezcla el array original y lo devuelve.
function shuffle(array) {
    for (let i = array.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [array[i], array[j]] = [array[j], array[i]];
    }
    return array;
}

function uniqueById(items) {
    const seen = new Set();
    return items.filter(item => !seen.has(item.id) && seen.add(item.id));
}

// Envuelve un handler async: cualquier error acaba en una respuesta JSON con su estado.
const route = handler => async (req, res, next) => {
    try {
        await handler(req, res, next);
    } catch (error) {
        const status = error.status || 500;
        if (status >= 500) console.error(error);
        res.status(status).json({ error: error.message || "Error inesperado." });
    }
};

module.exports = { HttpError, shuffle, uniqueById, route };
