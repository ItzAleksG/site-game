export class LobbyUI {
    constructor(elements = {}) {
        this.elements = elements;
    }

    showHost() {
        this.hideAll();

        this.show(
            this.elements.hostLobby
        );
    }

    showClient() {
        this.hideAll();

        this.show(
            this.elements.clientLobby
        );
    }

    showGame() {
        this.hideAll();

        this.show(
            this.elements.game
        );
    }

    showMenu() {
        this.hideAll();

        this.show(
            this.elements.menu
        );
    }

    hideAll() {
        for (
            const element
            of Object.values(
                this.elements
            )
        ) {
            if (!element) {
                continue;
            }

            element.classList.add(
                "hidden"
            );
        }
    }

    show(element) {
        if (!element) {
            return;
        }

        element.classList.remove(
            "hidden"
        );
    }

    setRoomCode(roomCode) {
        this.setText(
            this.elements.roomCode,
            roomCode
        );
    }

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
            serializeDescription(
                answer
            )
        );
    }

    getClientAnswer() {
        return parseDescription(
            this.getValue(
                this.elements.clientAnswer
            )
        );
    }

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

    setPlayers(players) {
        if (
            !this.elements.playerList
        ) {
            return;
        }

        this.elements.playerList.innerHTML =
            "";

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

            this.elements.playerList.appendChild(
                item
            );
        }
    }

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


function serializeDescription(
    description
) {
    if (!description) {
        return "";
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
        typeof value !== "string"
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
