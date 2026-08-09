export class GameUI {
    constructor({
        worldElement,
        playersElement = null
    }) {
        this.worldElement =
            worldElement;

        this.playersElement =
            playersElement;

        this.playerElements =
            new Map();

        this.myPlayerId =
            null;
    }

    setPlayerId(playerId) {
        this.myPlayerId =
            playerId;
    }

    render(snapshot) {
        if (
            !snapshot ||
            !Array.isArray(snapshot.players)
        ) {
            return;
        }

        this.renderPlayers(
            snapshot.players
        );
    }

    renderPlayers(players) {
        const visiblePlayerIds =
            new Set();

        for (
            const player
            of players
        ) {
            visiblePlayerIds.add(
                player.id
            );

            this.renderPlayer(
                player
            );
        }

        /*
         * Удаляем DOM-элементы игроков,
         * которых больше нет в snapshot.
         */
        for (
            const [
                playerId,
                element
            ]
            of this.playerElements
        ) {
            if (
                visiblePlayerIds.has(
                    playerId
                )
            ) {
                continue;
            }

            element.remove();

            this.playerElements.delete(
                playerId
            );
        }

        this.renderPlayerList(
            players
        );
    }

    renderPlayer(player) {
        let element =
            this.playerElements.get(
                player.id
            );

        if (!element) {
            element =
                document.createElement(
                    "div"
                );

            element.className =
                "game-player";

            element.dataset.playerId =
                player.id;

            this.playerElements.set(
                player.id,
                element
            );

            if (this.worldElement) {
                this.worldElement.appendChild(
                    element
                );
            }
        }

        const isLocalPlayer =
            player.id ===
            this.myPlayerId;

        element.classList.toggle(
            "local-player",
            isLocalPlayer
        );

        element.style.left =
            `${player.x}px`;

        element.style.top =
            `${player.y}px`;

        element.textContent =
            player.name;
    }

    renderPlayerList(players) {
        if (!this.playersElement) {
            return;
        }

        this.playersElement.innerHTML =
            "";

        for (
            const player
            of players
        ) {
            const element =
                document.createElement(
                    "div"
                );

            element.className =
                "player-list-item";

            if (
                player.id ===
                this.myPlayerId
            ) {
                element.classList.add(
                    "local-player"
                );
            }

            const name =
                document.createElement(
                    "span"
                );

            name.className =
                "player-list-name";

            name.textContent =
                player.name;

            const id =
                document.createElement(
                    "span"
                );

            id.className =
                "player-list-id";

            id.textContent =
                player.id;

            element.append(
                name,
                id
            );

            this.playersElement.appendChild(
                element
            );
        }
    }

    clear() {
        for (
            const element
            of this.playerElements.values()
        ) {
            element.remove();
        }

        this.playerElements.clear();

        if (this.playersElement) {
            this.playersElement.innerHTML =
                "";
        }
    }
}
