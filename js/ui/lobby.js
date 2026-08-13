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

        if (this.elements.game) {
            this.elements.game.classList.remove("hidden");
        }
    }


    showClient() {
        this.showView(this.elements.clientLobby);
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


    setPlayerCount(count, maxPlayers = null, target = "host") {
        const element = target === "client"
            ? this.elements.clientPlayerCount
            : this.elements.playerCount;

        if (!element) return;

        if (maxPlayers === null || maxPlayers === undefined) {
            this.setText(element, String(count));
            return;
        }

        this.setText(element, `${count}/${maxPlayers}`);
    }


    setPlayers(players = [], target = "host") {
        const list = target === "client"
            ? this.elements.clientPlayerList
            : this.elements.playerList;

        if (!list) return;

        list.innerHTML = "";

        for (const player of players) {
            const item = document.createElement("div");
            item.className = "lobby-player";
            item.dataset.playerId = player.id ?? "";

            const name = document.createElement("span");
            name.className = "lobby-player-name";
            name.textContent = player.name ?? "Player";

            const state = document.createElement("span");
            state.className = "lobby-player-state";
            state.textContent = getPlayerStateLabel(player);

            const id = document.createElement("span");
            id.className = "lobby-player-id";
            id.textContent = player.id ?? "-";

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


function getPlayerStateLabel(player) {
    if (player.id === "HOST") {
        return "HOST";
    }

    if (player.connected === false) {
        return "Отключён";
    }

    return player.ready === true
        ? "Готов"
        : "Не готов";
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
