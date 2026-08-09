import {
    MESSAGE,
    makeMessage,
    parseMessage
} from "../network/protocol.js";

import {
    World
} from "./world.js";


export class GameServer {
    constructor(
        options = {}
    ) {
        /*
         * Поддерживаем оба варианта:
         *
         * new GameServer("ROOM")
         *
         * new GameServer({
         *     roomCode: "ROOM",
         *     maxPlayers: 8
         * })
         */
        if (
            typeof options ===
            "string"
        ) {
            options = {
                roomCode:
                    options
            };
        }


        this.roomCode =
            String(
                options.roomCode ||
                ""
            );


        if (!this.roomCode) {
            throw new Error(
                "GameServer requires roomCode."
            );
        }


        this.maxPlayers =
            Math.max(
                1,
                Number(
                    options.maxPlayers
                ) || 8
            );


        this.world =
            new World();


        /*
         * playerId -> connection
         *
         * HOST здесь отсутствует,
         * потому что HOST находится
         * непосредственно внутри браузера.
         */
        this.connections =
            new Map();


        this.nextPlayerNumber =
            1;


        /*
         * Колбэки UI / application layer.
         */
        this.onPlayerJoined =
            null;

        this.onPlayerLeft =
            null;

        this.onPlayerListChanged =
            null;

        this.onSnapshot =
            null;

        this.onRoomStateChanged =
            null;


        /*
         * HOST — первый игрок.
         */
        this.world.addPlayer(
            "HOST",
            "Host"
        );
    }


    /*
    ============================================================
    HOST
    ============================================================
    */

    setHostName(
        name
    ) {
        const host =
            this.world.getPlayer(
                "HOST"
            );


        if (!host) {
            return;
        }


        host.name =
            sanitizeName(
                name
            );


        this.notifyPlayerListChanged();
        this.notifySnapshot();
    }


    hostInput(
        message
    ) {
        this.input(
            {
                playerId:
                    "HOST"
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
        return Object.keys(
            this.world.players
        ).length;
    }


    getPlayers() {
        return Object.values(
            this.world.players
        );
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
    CONNECTION
    ============================================================
    */

    receive(
        connection,
        raw
    ) {
        if (!connection) {
            return;
        }


        const message =
            parseMessage(
                raw
            );


        if (!message) {
            this.sendError(
                connection,
                "Invalid message."
            );

            return;
        }


        switch (
            message.type
        ) {
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

    join(
        connection,
        message
    ) {
        /*
         * Повторный JOIN запрещён.
         */
        if (
            connection.playerId
        ) {
            this.sendError(
                connection,
                "Player is already registered."
            );

            return;
        }


        /*
         * Не разрешаем превысить
         * максимальный размер комнаты.
         */
        if (
            this.isFull()
        ) {
            this.sendError(
                connection,
                "Room is full."
            );

            return;
        }


        const playerId =
            `P-${this.nextPlayerNumber++}`;


        const name =
            sanitizeName(
                message.name
            );


        connection.playerId =
            playerId;


        this.connections.set(
            playerId,
            connection
        );


        this.world.addPlayer(
            playerId,
            name
        );


        const player =
            this.world.getPlayer(
                playerId
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
        PLAYER JOINED
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
        this.broadcastSnapshot();
        this.notifyRoomState();
    }


    /*
    ============================================================
    INPUT
    ============================================================
    */

    input(
        connection,
        message
    ) {
        const playerId =
            connection?.playerId;


        if (!playerId) {
            this.sendError(
                connection,
                "Player is not registered."
            );

            return;
        }


        /*
         * Пока у нас есть только движение.
         *
         * В дальнейшем сюда добавятся:
         *
         * attack
         * interact
         * use_item
         * etc.
         */
        if (
            message.action !==
            "move"
        ) {
            return;
        }


        this.world.movePlayer(
            playerId,
            message.dx,
            message.dy
        );


        this.world.tick++;


        this.broadcastSnapshot();
    }


    /*
    ============================================================
    DISCONNECT
    ============================================================
    */

    disconnect(
        connection
    ) {
        if (!connection) {
            return;
        }


        const playerId =
            connection.playerId;


        if (!playerId) {
            return;
        }


        /*
         * Защита от повторного disconnect.
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


        /*
        --------------------------------------------------------
        PLAYER LEFT
        --------------------------------------------------------
        */

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
        this.broadcastSnapshot();
        this.notifyRoomState();
    }


    /*
    ============================================================
    SNAPSHOT
    ============================================================
    */

    broadcastSnapshot() {
        const snapshot =
            this.world.snapshot();


        this.broadcast(
            makeMessage(
                MESSAGE.SNAPSHOT,
                {
                    roomCode:
                        this.roomCode,

                    snapshot
                }
            )
        );


        /*
         * HOST не получает snapshot
         * через WebRTC.
         *
         * Поэтому приложение HOST
         * получает его напрямую.
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
    PLAYERS
    ============================================================
    */

    notifyPlayerListChanged() {
        const players =
            this.getPlayers();


        if (
            typeof this.onPlayerListChanged ===
            "function"
        ) {
            this.onPlayerListChanged(
                players
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

    send(
        connection,
        message
    ) {
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
            channel.send(
                message
            );

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
}


/*
============================================================
NAME SANITIZATION
============================================================
*/

function sanitizeName(
    name
) {
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
