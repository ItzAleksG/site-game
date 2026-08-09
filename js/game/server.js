import {
    MESSAGE,
    makeMessage
} from "../network/protocol.js";

import {
    World
} from "./world.js";


export class GameServer {

    constructor(roomCode) {

        this.roomCode = roomCode;

        this.world = new World();

        /*
         * WebRTC-соединения обычных игроков.
         *
         * HOST сюда не входит, потому что
         * сам GameServer работает в браузере хоста.
         */

        this.connections = {};

        this.nextPlayerNumber = 1;

        this.onPlayerListChanged = null;

        this.onSnapshot = null;


        /*
         * HOST — полноценный игрок.
         */

        this.world.addPlayer(
            "HOST",
            "Host"
        );

    }


    /*
    ========================================================
    HOST
    ========================================================
    */

    setHostName(name) {

        const host =
            this.world.getPlayer("HOST");

        if (host) {

            host.name =
                sanitizeName(name);

        }

    }


    hostInput(message) {

        this.input(
            {
                playerId: "HOST"
            },
            message
        );

    }


    /*
    ========================================================
    CONNECTION
    ========================================================
    */

    addConnection(connection) {

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

    }


    receive(
        connection,
        raw
    ) {

        const message =
            this.parse(raw);

        if (!message) {
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
                            time: Date.now()
                        }
                    )

                );

                break;

        }

    }


    parse(raw) {

        try {

            const message =
                JSON.parse(raw);


            if (
                !message ||
                typeof message.type !==
                    "string"
            ) {

                return null;

            }


            return message;

        }
        catch {

            return null;

        }

    }


    /*
    ========================================================
    JOIN
    ========================================================
    */

    join(
        connection,
        message
    ) {

        /*
         * Уже зарегистрированный игрок
         * не должен регистрироваться повторно.
         */

        if (connection.playerId) {
            return;
        }


        const playerId =
            "P-" +
            this.nextPlayerNumber++;


        const name =
            sanitizeName(
                message.name
            );


        connection.playerId =
            playerId;


        this.connections[playerId] =
            connection;


        this.world.addPlayer(
            playerId,
            name
        );


        /*
         * Отправляем новому игроку
         * первоначальное состояние комнаты.
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
         * Сообщаем остальным игрокам
         * о подключении.
         */

        this.broadcast(

            makeMessage(
                MESSAGE.PLAYER_JOINED,
                {

                    player:
                        this.world.getPlayer(
                            playerId
                        )

                }
            ),

            playerId

        );


        this.updatePlayerList();

        this.broadcastSnapshot();

    }


    /*
    ========================================================
    INPUT
    ========================================================
    */

    input(
        connection,
        message
    ) {

        const playerId =
            connection.playerId;


        if (!playerId) {
            return;
        }


        if (
            message.action ===
            "move"
        ) {

            this.world.movePlayer(

                playerId,

                message.dx,

                message.dy

            );


            this.broadcastSnapshot();

        }

    }


    /*
    ========================================================
    DISCONNECT
    ========================================================
    */

    disconnect(connection) {

        const playerId =
            connection.playerId;


        if (!playerId) {
            return;
        }


        delete this.connections[
            playerId
        ];


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


        this.updatePlayerList();

        this.broadcastSnapshot();

    }


    /*
    ========================================================
    SNAPSHOT
    ========================================================
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
         * Хост не получает snapshot через
         * WebRTC, поэтому сообщаем ему
         * напрямую через callback.
         */

        if (this.onSnapshot) {

            this.onSnapshot(
                snapshot
            );

        }

    }


    /*
    ========================================================
    PLAYERS
    ========================================================
    */

    updatePlayerList() {

        if (
            this.onPlayerListChanged
        ) {

            this.onPlayerListChanged(

                Object.values(
                    this.world.players
                )

            );

        }

    }


    /*
    ========================================================
    BROADCAST
    ========================================================
    */

    broadcast(
        message,
        exceptPlayerId = null
    ) {

        for (
            const playerId
            in this.connections
        ) {

            if (
                playerId ===
                exceptPlayerId
            ) {

                continue;

            }


            const connection =
                this.connections[
                    playerId
                ];


            this.send(
                connection,
                message
            );

        }

    }


    send(
        connection,
        message
    ) {

        if (
            !connection.channel
        ) {

            return;

        }


        if (
            connection.channel.readyState !==
            "open"
        ) {

            return;

        }


        connection.channel.send(
            message
        );

    }

}


function sanitizeName(name) {

    name =
        String(
            name || ""
        )
        .trim()
        .slice(0, 24);


    return name || "Player";

}
