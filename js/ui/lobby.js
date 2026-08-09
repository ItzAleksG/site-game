export class LobbyUI {
    constructor(elements = {}) {
        this.elements = elements;

        /*
         * Только эти элементы являются экранами.
         *
         * ВАЖНО:
         * Нельзя скрывать все elements подряд.
         * В elements также находятся кнопки, input,
         * textarea и прочие элементы интерфейса.
         */
        this.views = [
            this.elements.menu,
            this.elements.hostLobby,
            this.elements.clientLobby,
            this.elements.game
        ].filter(Boolean);
    }


    /*
    ============================================================
    VIEWS
    ============================================================
    */

    showMenu() {
        this.showView(
            this.elements.menu
        );
    }


    showHost() {
        this.showView(
            this.elements.hostLobby
        );
    }


    showClient() {
        this.showView(
            this.elements.clientLobby
        );
    }


    showGame() {
        this.showView(
            this.elements.game
        );
    }


    showView(view) {
        this.hideViews();

        if (!view) {
            return;
        }

        view.classList.remove(
            "hidden"
        );
    }


    hideViews() {
        for (
            const view
            of this.views
        ) {
            view.classList.add(
                "hidden"
            );
        }
    }


    /*
    ============================================================
    ROOM
    ============================================================
    */

    setRoomCode(roomCode) {
        this.setText(
            this.elements.roomCode,
            roomCode
        );
    }


    /*
    ============================================================
    STATUS
    ============================================================
    */

    setStatus(status) {
        this.setText(
            this.elements.status,
            status
        );
    }


    setHostStatus(status) {
        this.setText(
            this.elements.hostStatus,
            status
        );
    }


    setClientStatus(status) {
        this.setText(
            this.elements.clientStatus,
            status
        );
    }


    /*
    ============================================================
    WEBRTC OFFER
    ============================================================
    */

    setOffer(offer) {
        this.setValue(
            this.elements.offer,
            serializeDescription(
                offer
            )
        );
    }


    getOffer() {
        return parseDescription(
            this.getValue(
                this.elements.offer
            )
        );
    }


    /*
    ============================================================
    WEBRTC ANSWER
    ============================================================
    */

    setAnswer(answer) {
        this.setValue(
            this.elements.answer,
            serializeDescription(
                answer
            )
        );
    }


    getAnswer() {
        return parseDescription(
            this.getValue(
                this.elements.answer
            )
        );
    }


    setClientAnswer(answer) {
        this.setValue(
            this.elements.clientAnswer,
            typeof answer === "string"
                ? answer
                : serializeDescription(
                    answer
                )
        );
    }


    getClientAnswer() {
        return this.getValue(
            this.elements.clientAnswer
        );
    }


    /*
    ============================================================
    PLAYERS
    ============================================================
    */

    setPlayerCount(
        count,
        maxPlayers = null
    ) {
        if (
            maxPlayers === null ||
            maxPlayers === undefined
        ) {
            this.setText(
                this.elements.playerCount,
                String(count)
            );

            return;
        }

        this.setText(
            this.elements.playerCount,
            `${count}/${maxPlayers}`
        );
    }


    setPlayers(players = []) {
        const list =
            this.elements.playerList;

        if (!list) {
            return;
        }

        list.innerHTML = "";

        for (
            const player
            of players
        ) {
            const item =
                document.createElement(
                    "div"
                );

            item.className =
                "lobby-player";

            item.dataset.playerId =
                player.id;

            const name =
                document.createElement(
                    "span"
                );

            name.className =
                "lobby-player-name";

            name.textContent =
                player.name;

            const id =
                document.createElement(
                    "span"
                );

            id.className =
                "lobby-player-id";

            id.textContent =
                player.id;

            item.append(
                name,
                id
            );

            list.appendChild(
                item
            );
        }
    }


    /*
    ============================================================
    BUTTONS
    ============================================================
    */

    setJoinButtonEnabled(
        enabled
    ) {
        if (
            !this.elements.joinButton
        ) {
            return;
        }

        this.elements.joinButton.disabled =
            !enabled;
    }


    setHostButtonEnabled(
        enabled
    ) {
        if (
            !this.elements.hostButton
        ) {
            return;
        }

        this.elements.hostButton.disabled =
            !enabled;
    }


    /*
    ============================================================
    DOM HELPERS
    ============================================================
    */

    setText(
        element,
        value
    ) {
        if (!element) {
            return;
        }

        element.textContent =
            value ?? "";
    }


    setValue(
        element,
        value
    ) {
        if (!element) {
            return;
        }

        element.value =
            value ?? "";
    }


    getValue(element) {
        if (!element) {
            return "";
        }

        return element.value ?? "";
    }
}


/*
============================================================
WEBRTC DESCRIPTION SERIALIZATION
============================================================
*/

function serializeDescription(
    description
) {
    if (!description) {
        return "";
    }

    /*
     * Если уже передана готовая строка,
     * не сериализуем её повторно.
     */
    if (
        typeof description ===
        "string"
    ) {
        return description;
    }

    return JSON.stringify(
        {
            type:
                description.type,

            sdp:
                description.sdp
        },
        null,
        2
    );
}


function parseDescription(
    value
) {
    if (
        !value ||
        typeof value !==
            "string"
    ) {
        return null;
    }

    try {
        const description =
            JSON.parse(value);

        if (
            !description ||
            typeof description !==
                "object"
        ) {
            return null;
        }

        if (
            typeof description.type !==
            "string"
        ) {
            return null;
        }

        if (
            typeof description.sdp !==
            "string"
        ) {
            return null;
        }

        return description;
    }
    catch {
        return null;
    }
}
