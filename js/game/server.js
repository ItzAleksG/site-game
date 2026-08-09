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

        this.connections = {};

        this.nextPlayerNumber = 1;

        this.onPlayerListChanged = null;

        this.onSnapshot = null;

        this.onChat = null;

        /*
         * Хост — полноценный игрок.
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
            host.name = sanitizeName(name);
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


    hostChat(text) {

    const player =
        this.world.getPlayer("HOST");

    if (!player) {
        return;
    }

    text =
        String(text || "")
            .trim()
            .slice(0, 500);

    if (!text) {
        return;
    }


    const chatMessage =
        makeMessage(
            MESSAGE.CHAT,
            {
                playerId: "HOST",
                name: player.name,
                text
            }
        );


    /*
     * Отправляем сообщение P1, P2, P3...
     */

    this.broadcast(chatMessage);


    /*
     * И показываем его самому HOST.
     */

    if (this.onChat) {

        this.onChat({
            playerId: "HOST",
            name: player.name,
            text
        });

    }

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


            case MESSAGE.CHAT:

                this.chat(
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
                typeof message.type !== "string"
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
         * Сначала отправляем новому игроку
         * полное состояние комнаты.
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
         * Затем сообщаем остальным.
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
    CHAT
    ========================================================
    */

    chat(connection, message) {

    const playerId = connection.playerId;

    if (!playerId) {
        return;
    }

    const player =
        this.world.getPlayer(playerId);

    if (!player) {
        return;
    }

    const text =
        String(message.text || "")
            .trim()
            .slice(0, 500);

    if (!text) {
        return;
    }

    const chatMessage =
        makeMessage(
            MESSAGE.CHAT,
            {
                playerId,
                name: player.name,
                text
            }
        );


    /*
     * Отправляем всем подключённым игрокам.
     */

    this.broadcast(chatMessage);


    /*
     * И отдельно уведомляем браузер хоста.
     *
     * HOST не находится в this.connections,
     * поэтому broadcast() до него не доберётся.
     */

    if (this.onChat) {

        this.onChat({
            playerId,
            name: player.name,
            text
        });

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


        if (this.onSnapshot) {

            this.onSnapshot(
                snapshot
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
