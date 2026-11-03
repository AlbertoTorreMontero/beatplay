// Adaptador genérico: reproduce el audio corto (track.preview) con un <audio>.
// Sirve para cualquier servicio que dé URLs de preview (Deezer, iTunes…) sin SDK propio.
export function createPlayer({ emit }) {

    const audio = new Audio();
    let ref = null;
    let list = [];

    const report = () => emit({
        ref,
        position: audio.currentTime * 1000,
        duration: (audio.duration || 0) * 1000,
        paused: audio.paused
    });

    for (const type of ["play", "pause", "seeked", "loadedmetadata", "ended"]) {
        audio.addEventListener(type, report);
    }

    return {
        init: async () => {},

        load(tracks) {
            list = tracks;
        },

        async playAt(index) {
            const track = list[index];
            if (!track?.preview) throw new Error("Esta canción no tiene audio disponible.");
            ref = track.ref || track.id;
            audio.src = track.preview;
            await audio.play();
        },

        pause: async () => audio.pause(),
        resume: () => audio.play(),
        toggle: async () => (audio.paused ? audio.play() : audio.pause()),
        seek: async ms => { audio.currentTime = ms / 1000; }
    };
}
