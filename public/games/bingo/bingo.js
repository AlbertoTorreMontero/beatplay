let bingoTracks = [];
let bingoPlaylistName = "";


// =====================================================
// INICIO
// =====================================================

function startBingo(tracks, playlistName) {

    bingoTracks = Array.isArray(tracks)
        ? tracks
        : [];

    bingoPlaylistName =
        playlistName || "Bingo Musical";

    const title =
        document.getElementById(
            "bingoPlaylistName"
        );

    if (title) {
        title.textContent =
            bingoPlaylistName;
    }

    renderBingoSetup();
}


// =====================================================
// CONFIGURACIÓN
// =====================================================

function renderBingoSetup() {

    const content =
        document.getElementById(
            "bingoContent"
        );

    if (!content) {
        console.error(
            "No existe #bingoContent"
        );
        return;
    }

    content.innerHTML = `
        <section class="bingoSetup">

            <div class="bingoSetupInfo">

                <span class="eyebrow">
                    BINGO MUSICAL
                </span>

                <h2>
                    Configura tu bingo
                </h2>

                <p>
                    Genera tus cartones a partir
                    de las canciones de tu playlist.
                </p>

            </div>

            <div class="bingoControls">

                <div class="bingoControl">

                    <label for="bingoName">
                        Nombre del bingo
                    </label>

                    <input
                        id="bingoName"
                        type="text"
                        placeholder="Ej. Bingo de verano"
                        value="${escapeHtml(
                            bingoPlaylistName
                        )}"
                    >

                </div>

                <div class="bingoControl">

                    <label for="bingoCardCount">
                        Número de cartones
                    </label>

                    <select id="bingoCardCount">
                        ${Array.from(
                            { length: 20 },
                            (_, index) => {

                                const number =
                                    index + 1;

                                return `
                                    <option value="${number}">
                                        ${number}
                                        ${number === 1
                                            ? "cartón"
                                            : "cartones"}
                                    </option>
                                `;
                            }
                        ).join("")}
                    </select>

                </div>

                <button
                    id="generateBingoButton"
                    class="primaryButton"
                    type="button"
                >
                    Generar cartones
                </button>

            </div>

        </section>

        <section id="bingoCards"></section>
    `;

    document
        .getElementById(
            "generateBingoButton"
        )
        ?.addEventListener(
            "click",
            generateBingoCards
        );
}


// =====================================================
// GENERAR
// =====================================================

function generateBingoCards() {

    const count =
        parseInt(
            document.getElementById(
                "bingoCardCount"
            )?.value,
            10
        );

    const name =
        document
            .getElementById("bingoName")
            ?.value
            .trim() ||
        bingoPlaylistName ||
        "Bingo Musical";

    const container =
        document.getElementById(
            "bingoCards"
        );

    if (!container) {
        return;
    }

    if (!bingoTracks.length) {

        toast(
            "No hay canciones disponibles para crear el Bingo."
        );

        return;
    }

    bingoPlaylistName = name;
    container.innerHTML = "";

    const grid =
        document.createElement("div");

    grid.className =
        "bingoCardsGrid";

    for (
        let i = 1;
        i <= count;
        i++
    ) {

        /*
         * Cada cartón necesita 15 canciones.
         */
        const cardTracks =
            shuffle(
                [...bingoTracks]
            ).slice(0, 15);

        grid.appendChild(
            createBingoCard(
                cardTracks,
                i,
                name
            )
        );
    }

    container.appendChild(grid);


    const actions =
        document.createElement("div");

    actions.className =
        "bingoActions";

    actions.innerHTML = `
        <button
            id="regenerateBingoButton"
            class="secondaryButton"
            type="button"
        >
            Regenerar
        </button>

        <button
            id="printBingoButton"
            class="primaryButton"
            type="button"
        >
            Imprimir / Guardar PDF
        </button>
    `;

    container.appendChild(
        actions
    );


    document
        .getElementById(
            "regenerateBingoButton"
        )
        ?.addEventListener(
            "click",
            generateBingoCards
        );

    document
        .getElementById(
            "printBingoButton"
        )
        ?.addEventListener(
            "click",
            () => window.print()
        );


    container.scrollIntoView({
        behavior: "smooth",
        block: "start"
    });
}


// =====================================================
// CARTÓN
// =====================================================

function createBingoCard(
    tracks,
    number,
    bingoName
) {

    const card =
        document.createElement(
            "article"
        );

    card.className =
        "bingoCard";


    const header =
        document.createElement(
            "div"
        );

    header.className =
        "bingoCardHeader";

    header.innerHTML = `
        <div>
            <span>
                BINGO MUSICAL
            </span>

            <h3>
                ${escapeHtml(bingoName)}
            </h3>
        </div>

        <strong>
            ${String(number).padStart(2, "0")}
        </strong>
    `;


    const grid =
        document.createElement(
            "div"
        );

    grid.className =
        "bingoGrid";


    const rows =
        createBingoRows();

    let trackIndex = 0;


    for (let row = 0; row < 3; row++) {

        for (let col = 0; col < 9; col++) {

            const cell =
                document.createElement(
                    "div"
                );

            cell.className =
                "bingoCell";


            if (rows[row][col]) {

                const track =
                    tracks[trackIndex++];

                if (track) {

                    cell.classList.add(
                        "filled"
                    );

                    const image =
                        document.createElement(
                            "img"
                        );

                    image.src =
                        track.cover || "";

                    image.alt = "";


                    const name =
                        document.createElement(
                            "div"
                        );

                    name.className =
                        "bingoTrackName";

                    name.textContent =
                        track.name;


                    cell.append(
                        image,
                        name
                    );
                }

            } else {

                cell.classList.add(
                    "empty"
                );
            }


            grid.appendChild(cell);
        }
    }


    const footer =
        document.createElement(
            "footer"
        );

    footer.className =
        "bingoCardFooter";

    footer.innerHTML = `
        <span>
            ${escapeHtml(bingoName)}
        </span>

        <span>
            Cartón ${String(number).padStart(2, "0")}
        </span>
    `;


    card.append(
        header,
        grid,
        footer
    );

    return card;
}


// =====================================================
// DISTRIBUCIÓN
// =====================================================

function createBingoRows() {

    return Array.from(
        { length: 3 },
        () => {

            const filled =
                Array(9).fill(false);

            shuffle(
                [...Array(9).keys()]
            )
                .slice(0, 5)
                .forEach(
                    position => {
                        filled[position] = true;
                    }
                );

            return filled;
        }
    );
}
