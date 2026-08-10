export class LobbyUI {
    constructor(elements = {}) {
        this.elements = elements;

        this.views = [
            this.elements.menu,
            this.elements.hostLobby,
            this.elements.clientLobby,
            this.elements.game
        ].filter(Boolean);
    }


    showMenu() {
        this.showView(this.elements.menu);
    }


    showHost() {
        this.hideViews();

        if (this.elements.hostLobby) {
            this.elements.hostLobby.classList.remove("hidden");
        }

        /* HOST видит лобби и игровое поле одновременно. */
        if (this.elements.game) {
            this.elements.game.classList.remove("hidden");
        }
    }


    showClient() {
        this.showView(this.elements.clientLobby);

        /*
         * Ник приглашённого игрока не должен наследоваться
         * из localStorage хоста. Каждый клиент выбирает его сам.
         */
        if (this.elements.clientPlayerName && !this.elements.clientPlayerName.value) {
            this.elements.clientPlayerName.value = "";
        }
    }


    showGame() {
        this.showView(this.elements.game);
    }


    showView(view) {
        this.hideViews();

        if (!view) return;
        view.classList.remove("hidden");
    }


    hideViews() {
        for (const view of this.views) {
            view.classList.add("hidden");
        }
    }


    setRoomCode(roomCode) {
        this.setText(this.elements.roomCode, roomCode);
    }


    setStatus(status) {
        this.setText(this.elements.status, status);
    }


    setHostStatus(status) {
        this.setText(this.elements.hostStatus, status);
    }


    setClientStatus(status) {
        this.setText(this.elements.clientStatus, status);
    }


    setOffer(offer) {
        this.setValue(
            this.elements.offer,
            serializeDescription(offer)
        );
    }


    getOffer() {
        return parseDescription(
            this.getValue(this.elements.offer)
        );
    }


    setAnswer(answer) {
        this.setValue(
            this.elements.answer,
            serializeDescription(answer)
        );
    }


    getAnswer() {
        return parseDescription(
            this.getValue(this.elements.answer)
        );
    }


    setClientAnswer(answer) {
        this.setValue(
            this.elements.clientAnswer,
            typeof answer === "string"
                ? answer
                : serializeDescription(answer)
        );
    }


    getClientAnswer() {
        return this.getValue(this.elements.clientAnswer);
    }


    setPlayerCount(count, maxPlayers = null) {
        if (maxPlayers === null || maxPlayers === undefined) {
            this.setText(this.elements.playerCount, String(count));
            return;
        }

        this.setText(
            this.elements.playerCount,
            `${count}/${maxPlayers}`
        );
    }


    setPlayers(players = []) {
        const list = this.elements.playerList;
        if (!list) return;

        list.innerHTML = "";

        for (const player of players) {
            const item = document.createElement("div");
            item.className = "lobby-player";
            item.dataset.playerId = player.id;

            const name = document.createElement("span");
            name.className = "lobby-player-name";
            name.textContent = player.name;

            const state = document.createElement("span");
            state.className = "lobby-player-state";
            state.textContent = player.id === "HOST"
                ? "HOST"
                : player.ready
                    ? "Готов"
                    : "Не готов";

            const id = document.createElement("span");
            id.className = "lobby-player-id";
            id.textContent = player.id;

            item.append(name, state, id);
            list.appendChild(item);
        }
    }


    setJoinButtonEnabled(enabled) {
        if (!this.elements.joinButton) return;
        this.elements.joinButton.disabled = !enabled;
    }


    setHostButtonEnabled(enabled) {
        if (!this.elements.hostButton) return;
        this.elements.hostButton.disabled = !enabled;
    }


    setText(element, value) {
        if (!element) return;
        element.textContent = value ?? "";
    }


    setValue(element, value) {
        if (!element) return;
        element.value = value ?? "";
    }


    getValue(element) {
        if (!element) return "";
        return element.value ?? "";
    }
}


function serializeDescription(description) {
    if (!description) return "";
    if (typeof description === "string") return description;

    return JSON.stringify(
        {
            type: description.type,
            sdp: description.sdp
        },
        null,
        2
    );
}


function parseDescription(value) {
    if (!value || typeof value !== "string") return null;

    try {
        const description = JSON.parse(value);

        if (!description || typeof description !== "object") return null;
        if (typeof description.type !== "string") return null;
        if (typeof description.sdp !== "string") return null;

        return description;
    }
    catch {
        return null;
    }
}
