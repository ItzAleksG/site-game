import {
    MESSAGE,
    makeMessage,
    parseMessage
} from "../network/protocol.js";

import {
    World
} from "./world.js";


export class GameServer {
    constructor(options = {}) {
        if (typeof options === "string") {
            options = {
                roomCode: options
            };
        }

        this.roomCode =
            String(options.roomCode || "");

        if (!this.roomCode) {
            throw new Error(
                "GameServer requires roomCode."
            );
        }

        this.maxPlayers = Math.max(
            1,
            Number(options.maxPlayers) || 8
        );

        this.world = new World(
            options.world || {}
        );

        /*
         * playerId -> WebRTC connection
         *
         * HOST сюда не попадает:
         * HOST находится непосредственно
         * внутри браузера и управляется
         * через hostInput().
         */
        this.connections = new Map();

        this.nextPlayerNumber = 1;

        /*
         * Application/UI callbacks.
         */
        this.onPlayerJoined = null;
        this.onPlayerLeft = null;
        this.onPlayerListChanged = null;
        this.onSnapshot = null;
        this.onRoomStateChanged = null;

        /*
         * HOST — первый игрок комнаты.
         */
        this.world.addPlayer({
            id: "HOST",
            name: "Host"
        });
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
        this.notifySnapshot();
        this.notifyRoomState();

        return true;
    }


    hostInput(message) {
        if (!message) {
            return false;
        }

        return this.input(
            {
                playerId: "HOST"
            },
            message
        );
    }


    /*
    ============================================================
    ROOM
    ============================================================
    */

    getPlayerCount() {
        return this.world.players.size;
    }


    getPlayers() {
        return this.world.getPlayers();
    }


    getSnapshot() {
        return this.world.snapshot();
    }


    isFull() {
        return (
            this.getPlayerCount() >=
            this.maxPlayers
        );
    }


    getRoomState() {
        return {
            roomCode:
                this.roomCode,

            playerCount:
                this.getPlayerCount(),

            maxPlayers:
                this.maxPlayers,

            players:
                this.getPlayers()
        };
    }


    /*
    ============================================================
    NETWORK INPUT
    ============================================================
    */

    receive(connection, raw) {
        if (!connection) {
            return;
        }

        const message =
            parseMessage(raw);

        if (!message) {
            this.sendError(
                connection,
                "Invalid message."
            );

            return;
        }

        switch (message.type) {
            case MESSAGE.JOIN:
                this.join(
                    connection,
                    message
                );
                break;

            case MESSAGE.INPUT:
                this.input(
                    connection,
                    message
                );
                break;

            case MESSAGE.PING:
                this.send(
                    connection,
                    makeMessage(
                        MESSAGE.PONG,
                        {
                            time:
                                Date.now()
                        }
                    )
                );
                break;

            default:
                this.sendError(
                    connection,
                    `Unknown message type: ${message.type}`
                );
                break;
        }
    }


    /*
    ============================================================
    JOIN
    ============================================================
    */

    join(connection, message) {
        if (!connection) {
            return;
        }

        /*
         * Защита от повторного JOIN.
         */
        if (connection.playerId) {
            this.sendError(
                connection,
                "Player is already registered."
            );

            return;
        }

        /*
         * HOST уже занимает один слот.
         */
        if (this.isFull()) {
            this.sendError(
                connection,
                "Room is full."
            );

            return;
        }

        const playerId =
            `P-${this.nextPlayerNumber++}`;

        const name =
            sanitizeName(message.name);

        /*
         * Сначала создаём игрока в World.
         */
        const player =
            this.world.addPlayer({
                id: playerId,
                name
            });

        /*
         * Только после успешного создания
         * регистрируем connection.
         */
        connection.playerId =
            playerId;

        this.connections.set(
            playerId,
            connection
        );

        /*
        --------------------------------------------------------
        WELCOME
        --------------------------------------------------------
        */

        this.send(
            connection,
            makeMessage(
                MESSAGE.WELCOME,
                {
                    roomCode:
                        this.roomCode,

                    playerId,

                    snapshot:
                        this.world.snapshot()
                }
            )
        );

        /*
        --------------------------------------------------------
        PLAYER_JOINED
        --------------------------------------------------------
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

        /*
        --------------------------------------------------------
        CALLBACKS
        --------------------------------------------------------
        */

        if (
            typeof this.onPlayerJoined ===
            "function"
        ) {
            this.onPlayerJoined(
                player
            );
        }

        this.notifyPlayerListChanged();
        this.notifySnapshot();
        this.notifyRoomState();
    }


    /*
    ============================================================
    INPUT
    ============================================================
    */

    input(connection, message) {
        if (!connection) {
            return false;
        }

        const playerId =
            connection.playerId;

        if (!playerId) {
            this.sendError(
                connection,
                "Player is not registered."
            );

            return false;
        }

        if (
            message.action !==
            "move"
        ) {
            return false;
        }

        const moved =
            this.world.movePlayer(
                playerId,
                message.dx,
                message.dy
            );

        if (!moved) {
            return false;
        }

        /*
         * World уже имеет собственный tick.
         */
        this.world.update();

        this.broadcastSnapshot();

        return true;
    }


    /*
    ============================================================
    DISCONNECT
    ============================================================
    */

    disconnect(connection) {
        if (!connection) {
            return false;
        }

        const playerId =
            connection.playerId;

        if (!playerId) {
            return false;
        }

        /*
         * Не позволяем повторно удалить
         * одного и того же игрока.
         */
        connection.playerId =
            null;

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

        if (
            typeof this.onPlayerLeft ===
            "function"
        ) {
            this.onPlayerLeft(
                player
            );
        }

        this.notifyPlayerListChanged();
        this.notifySnapshot();
        this.notifyRoomState();

        return true;
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

        /*
         * Отправляем всем WebRTC-клиентам.
         */
        this.broadcast(message);

        /*
         * HOST получает snapshot
         * напрямую, без WebRTC.
         */
        if (
            typeof this.onSnapshot ===
            "function"
        ) {
            this.onSnapshot(
                snapshot
            );
        }
    }


    notifySnapshot() {
        if (
            typeof this.onSnapshot ===
            "function"
        ) {
            this.onSnapshot(
                this.world.snapshot()
            );
        }
    }


    /*
    ============================================================
    PLAYER LIST
    ============================================================
    */

    notifyPlayerListChanged() {
        if (
            typeof this.onPlayerListChanged ===
            "function"
        ) {
            this.onPlayerListChanged(
                this.getPlayers()
            );
        }
    }


    notifyRoomState() {
        if (
            typeof this.onRoomStateChanged ===
            "function"
        ) {
            this.onRoomStateChanged(
                this.getRoomState()
            );
        }
    }


    /*
    ============================================================
    SEND
    ============================================================
    */

    send(connection, message) {
        if (!connection) {
            return false;
        }

        const channel =
            connection.channel;

        if (
            !channel ||
            channel.readyState !==
            "open"
        ) {
            return false;
        }

        try {
            channel.send(message);
            return true;
        }
        catch (error) {
            console.error(
                "GameServer.send failed:",
                error
            );

            return false;
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
        let sent = 0;

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

            if (
                this.send(
                    connection,
                    message
                )
            ) {
                sent++;
            }
        }

        return sent;
    }


    /*
    ============================================================
    ERROR
    ============================================================
    */

    sendError(
        connection,
        message
    ) {
        this.send(
            connection,
            makeMessage(
                MESSAGE.ERROR,
                {
                    message
                }
            )
        );
    }


    /*
    ============================================================
    CLOSE
    ============================================================
    */

    close() {
        const connections =
            [
                ...this.connections.values()
            ];

        for (
            const connection
            of connections
        ) {
            this.disconnect(
                connection
            );
        }

        this.connections.clear();
    }
}


/*
============================================================
HELPERS
============================================================
*/

function sanitizeName(name) {
    const value =
        String(
            name ?? ""
        )
        .trim()
        .replace(
            /\s+/g,
            " "
        )
        .slice(
            0,
            24
        );

    return (
        value ||
        "Player"
    );
}
