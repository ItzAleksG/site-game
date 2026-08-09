import {
    MESSAGE,
    makeMessage,
    parseMessage
} from "../network/protocol.js";

import {
    World
} from "./world.js";


export class GameServer {
    constructor({
        roomCode,
        maxPlayers = 8,
        worldOptions = {}
    }) {
        if (!roomCode) {
            throw new Error(
                "GameServer requires a roomCode."
            );
        }

        this.roomCode = roomCode;

        this.maxPlayers = Math.max(
            1,
            Number(maxPlayers) || 1
        );

        this.world =
            new World(worldOptions);

        /*
         * WebRTC-соединения.
         *
         * Ключом является playerId.
         *
         * HOST сюда не входит:
         * GameServer работает непосредственно
         * в браузере HOST.
         */
        this.connections = new Map();

        /*
         * Следующий ID обычного игрока.
         *
         * HOST всегда имеет ID "HOST".
         */
        this.nextPlayerNumber = 1;

        /*
         * Колбэки для браузера HOST.
         */
        this.onPlayerJoined = null;
        this.onPlayerLeft = null;
        this.onPlayerListChanged = null;
        this.onSnapshot = null;
        this.onRoomStateChanged = null;

        /*
         * HOST является первым игроком комнаты.
         */
        this.world.addPlayer({
            id: "HOST",
            name: "Host"
        });
    }


    /*
    ============================================================
    ROOM
    ============================================================
    */

    getPlayerCount() {
        return this.world.getPlayers().length;
    }

    getConnectedPlayerCount() {
        return this.connections.size + 1;
    }

    isFull() {
        return (
            this.getConnectedPlayerCount() >=
            this.maxPlayers
        );
    }

    getPlayers() {
        return this.world.getPlayers();
    }

    getSnapshot() {
        return this.world.snapshot();
    }


    /*
    ============================================================
    HOST
    ============================================================
    */

    setHostName(name) {
        const host =
            this.world.getPlayer("HOST");

        if (!host) {
            return false;
        }

        host.name =
            sanitizeName(name);

        this.notifyPlayerListChanged();
        this.broadcastSnapshot();

        return true;
    }

    hostInput(input) {
        this.processInput(
            "HOST",
            input
        );
    }


    /*
    ============================================================
    CONNECTION
    ============================================================
    */

    addConnection(connection) {
        if (!connection) {
            throw new Error(
                "Connection is required."
            );
        }

        if (!connection.channel) {
            throw new Error(
                "Connection must contain a data channel."
            );
        }

        /*
         * Connection ещё не привязано
         * к игроку.
         */
        connection.playerId = null;

        connection.channel.onmessage =
            event => {
                this.receive(
                    connection,
                    event.data
                );
            };

        connection.channel.onclose =
            () => {
                this.disconnect(
                    connection
                );
            };

        connection.channel.onerror =
            error => {
                console.error(
                    "Game connection error:",
                    error
                );
            };

        /*
         * Если канал уже открыт в момент
         * добавления соединения, ничего
         * дополнительно делать не нужно:
         * игрок сам отправит JOIN.
         */
    }


    /*
    ============================================================
    RECEIVE
    ============================================================
    */

    receive(connection, rawMessage) {
        const message =
            parseMessage(rawMessage);

        if (!message) {
            return;
        }

        switch (message.type) {
            case MESSAGE.JOIN:
                this.handleJoin(
                    connection,
                    message
                );
                break;

            case MESSAGE.INPUT:
                this.handleInput(
                    connection,
                    message
                );
                break;

            case MESSAGE.PING:
                this.handlePing(
                    connection
                );
                break;

            default:
                /*
                 * Неизвестные сообщения
                 * просто игнорируем.
                 */
                break;
        }
    }


    /*
    ============================================================
    JOIN
    ============================================================
    */

    handleJoin(connection, message) {
        /*
         * Повторный JOIN от одного
         * соединения запрещён.
         */
        if (connection.playerId) {
            return;
        }

        /*
         * Проверяем вместимость комнаты.
         */
        if (this.isFull()) {
            this.send(
                connection,
                makeMessage(
                    MESSAGE.ERROR,
                    {
                        code: "ROOM_FULL",
                        message:
                            "Room is full."
                    }
                )
            );

            this.closeConnection(
                connection
            );

            return;
        }

        const playerId =
            this.generatePlayerId();

        const playerName =
            sanitizeName(
                message.name
            );

        /*
         * Привязываем WebRTC connection
         * к игроку.
         */
        connection.playerId =
            playerId;

        this.connections.set(
            playerId,
            connection
        );

        /*
         * Создаём игрока в authoritative World.
         */
        const player =
            this.world.addPlayer({
                id: playerId,
                name: playerName
            });

        /*
         * Сначала отправляем новому игроку
         * его идентификатор и полный snapshot.
         */
        this.send(
            connection,
            makeMessage(
                MESSAGE.WELCOME,
                {
                    roomCode:
                        this.roomCode,

                    playerId,

                    player,

                    snapshot:
                        this.world.snapshot()
                }
            )
        );

        /*
         * Затем сообщаем уже подключённым
         * игрокам о новом игроке.
         */
        this.broadcast(
            makeMessage(
                MESSAGE.PLAYER_JOINED,
                {
                    player
                }
            ),
            playerId
        );

        this.notifyPlayerJoined(
            player
        );

        this.notifyPlayerListChanged();
        this.notifyRoomStateChanged();
        this.broadcastSnapshot();
    }


    /*
    ============================================================
    INPUT
    ============================================================
    */

    handleInput(connection, message) {
        const playerId =
            connection.playerId;

        /*
         * Игрок должен сначала
         * пройти JOIN.
         */
        if (!playerId) {
            return;
        }

        this.processInput(
            playerId,
            message
        );
    }

    processInput(playerId, message) {
        if (
            !message ||
            typeof message.action !==
                "string"
        ) {
            return;
        }

        switch (message.action) {
            case "move":
                this.handleMoveInput(
                    playerId,
                    message
                );
                break;

            default:
                break;
        }
    }

    handleMoveInput(playerId, message) {
        const moved =
            this.world.movePlayer(
                playerId,
                message.dx,
                message.dy
            );

        if (!moved) {
            return;
        }

        this.broadcastSnapshot();
    }


    /*
    ============================================================
    DISCONNECT
    ============================================================
    */

    disconnect(connection) {
        const playerId =
            connection?.playerId;

        /*
         * Соединение могло закрыться
         * ещё до JOIN.
         */
        if (!playerId) {
            return;
        }

        /*
         * Не обрабатываем disconnect
         * дважды.
         */
        connection.playerId = null;

        this.connections.delete(
            playerId
        );

        const player =
            this.world.getPlayer(
                playerId
            );

        this.world.removePlayer(
            playerId
        );

        this.broadcast(
            makeMessage(
                MESSAGE.PLAYER_LEFT,
                {
                    playerId
                }
            )
        );

        this.notifyPlayerLeft(
            player
        );

        this.notifyPlayerListChanged();
        this.notifyRoomStateChanged();
        this.broadcastSnapshot();
    }


    /*
    ============================================================
    PING
    ============================================================
    */

    handlePing(connection) {
        this.send(
            connection,
            makeMessage(
                MESSAGE.PONG,
                {
                    time: Date.now()
                }
            )
        );
    }


    /*
    ============================================================
    SNAPSHOT
    ============================================================
    */

    broadcastSnapshot() {
        const snapshot =
            this.world.snapshot();

        const message =
            makeMessage(
                MESSAGE.SNAPSHOT,
                {
                    roomCode:
                        this.roomCode,

                    snapshot
                }
            );

        this.broadcast(message);

        /*
         * HOST получает snapshot напрямую,
         * поскольку HOST не имеет WebRTC
         * connection к самому себе.
         */
        if (typeof this.onSnapshot === "function") {
            this.onSnapshot(
                snapshot
            );
        }
    }


    /*
    ============================================================
    BROADCAST
    ============================================================
    */

    broadcast(
        message,
        exceptPlayerId = null
    ) {
        for (
            const [
                playerId,
                connection
            ]
            of this.connections
        ) {
            if (
                playerId ===
                exceptPlayerId
            ) {
                continue;
            }

            this.send(
                connection,
                message
            );
        }
    }


    /*
    ============================================================
    SEND
    ============================================================
    */

    send(connection, message) {
        if (!connection?.channel) {
            return false;
        }

        if (
            connection.channel.readyState !==
            "open"
        ) {
            return false;
        }

        try {
            connection.channel.send(
                message
            );

            return true;
        }
        catch (error) {
            console.error(
                "Failed to send message:",
                error
            );

            return false;
        }
    }


    /*
    ============================================================
    PLAYER IDs
    ============================================================
    */

    generatePlayerId() {
        let playerId;

        do {
            playerId =
                `P-${this.nextPlayerNumber++}`;
        }
        while (
            this.world.hasPlayer(
                playerId
            )
        );

        return playerId;
    }


    /*
    ============================================================
    CALLBACKS
    ============================================================
    */

    notifyPlayerJoined(player) {
        if (
            typeof this.onPlayerJoined ===
            "function"
        ) {
            this.onPlayerJoined(
                player
            );
        }
    }

    notifyPlayerLeft(player) {
        if (
            typeof this.onPlayerLeft ===
            "function"
        ) {
            this.onPlayerLeft(
                player
            );
        }
    }

    notifyPlayerListChanged() {
        if (
            typeof this.onPlayerListChanged !==
            "function"
        ) {
            return;
        }

        this.onPlayerListChanged(
            this.world.getPlayers()
        );
    }

    notifyRoomStateChanged() {
        if (
            typeof this.onRoomStateChanged !==
            "function"
        ) {
            return;
        }

        this.onRoomStateChanged({
            roomCode:
                this.roomCode,

            playerCount:
                this.getPlayerCount(),

            maxPlayers:
                this.maxPlayers,

            isFull:
                this.isFull(),

            players:
                this.world.getPlayers()
        });
    }


    /*
    ============================================================
    CONNECTION CLEANUP
    ============================================================
    */

    closeConnection(connection) {
        if (!connection) {
            return;
        }

        try {
            connection.channel?.close();
        }
        catch {
            // Connection already closed.
        }

        try {
            connection.pc?.close();
        }
        catch {
            // Peer connection already closed.
        }
    }


    /*
    ============================================================
    STOP
    ============================================================
    */

    stop() {
        for (
            const connection
            of this.connections.values()
        ) {
            this.closeConnection(
                connection
            );
        }

        this.connections.clear();

        /*
         * HOST остаётся в World,
         * пока GameServer существует.
         */
    }
}


function sanitizeName(name) {
    const normalized =
        String(name ?? "")
            .trim()
            .replace(/\s+/g, " ")
            .slice(0, 24);

    return normalized || "Player";
}
