import {
    MESSAGE,
    makeMessage,
    parseMessage
} from "../network/protocol.js";

import {
    World
} from "./world.js";


export const ROOM_STATUS = Object.freeze({
    WAITING: "waiting",
    PLAYING: "playing"
});


const RECONNECT_GRACE_MS = 20000;


export class GameServer {
    constructor(options = {}) {
        if (typeof options === "string") {
            options = { roomCode: options };
        }

        this.roomCode = String(options.roomCode || "");

        if (!this.roomCode) {
            throw new Error("GameServer requires roomCode.");
        }

        this.maxPlayers = Math.max(
            1,
            Number(options.maxPlayers) || 8
        );

        this.world = new World(options.world || {});

        /*
         * playerId -> connection
         *
         * Здесь находятся только реально подключённые
         * WebRTC-соединения.
         */
        this.connections = new Map();

        /*
         * playerId -> reconnect timer
         *
         * Игрок после отключения не удаляется сразу.
         */
        this.disconnectTimers = new Map();

        this.nextPlayerNumber = 1;
        this.status = ROOM_STATUS.WAITING;

        this.onPlayerJoined = null;
        this.onPlayerLeft = null;
        this.onPlayerReconnected = null;
        this.onPlayerListChanged = null;
        this.onSnapshot = null;
        this.onRoomStateChanged = null;

        this.world.addPlayer({
            id: "HOST",
            name: "Host"
        });

        const host = this.world.getPlayer("HOST");

        if (host) {
            host.ready = true;
            host.connected = true;
            host.sessionId = "HOST";
        }
    }


    /* ========================================================
       HOST
       ======================================================== */

    setHostName(name) {
        const host = this.world.getPlayer("HOST");

        if (!host) {
            return false;
        }

        host.name = sanitizeName(name);
        host.ready = true;
        host.connected = true;

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


    /* ========================================================
       ROOM
       ======================================================== */

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
        return this.getPlayerCount() >= this.maxPlayers;
    }


    canStart() {
        if (this.status !== ROOM_STATUS.WAITING) {
            return false;
        }

        if (this.getPlayerCount() < 2) {
            return false;
        }

        return this.getPlayers()
            .filter(player => player.id !== "HOST")
            .every(player => player.ready === true);
    }


    getRoomState() {
        return {
            roomCode: this.roomCode,

            status: this.status,

            playerCount: this.getPlayers()
                .filter(player => player.connected !== false)
                .length,

            maxPlayers: this.maxPlayers,

            canStart: this.canStart(),

            players: this.getPlayers().map(player => ({
                id: player.id,
                name: player.name,
                ready: player.ready === true,
                connected: player.connected !== false
            }))
        };
    }


    /* ========================================================
       READY
       ======================================================== */

    setPlayerReady(connection, ready = true) {
        if (!connection?.playerId) {
            return false;
        }

        if (this.status !== ROOM_STATUS.WAITING) {
            return false;
        }

        const player = this.world.getPlayer(connection.playerId);

        if (!player) {
            return false;
        }

        player.ready = Boolean(ready);

        this.broadcastRoomState();
        this.notifyPlayerListChanged();

        return true;
    }


    startGame() {
        if (!this.canStart()) {
            return false;
        }

        this.status = ROOM_STATUS.PLAYING;

        this.broadcastRoomState();
        this.broadcastSnapshot();

        return true;
    }


    /* ========================================================
       RECEIVE
       ======================================================== */

    receive(connection, raw) {
        if (!connection) {
            return;
        }

        connection.lastSeenAt = Date.now();

        const message = parseMessage(raw);

        if (!message) {
            this.sendError(
                connection,
                "Invalid message."
            );

            return;
        }

        switch (message.type) {
            case MESSAGE.JOIN:
                this.join(connection, message);
                break;

            case MESSAGE.INPUT:
                this.input(connection, message);
                break;

            case MESSAGE.PLAYER_READY:
                this.setPlayerReady(
                    connection,
                    message.ready
                );
                break;

            case MESSAGE.PING:
                this.send(
                    connection,
                    makeMessage(MESSAGE.PONG, {
                        time: Date.now()
                    })
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


    /* ========================================================
       JOIN / RECONNECT
       ======================================================== */

    join(connection, message) {
        if (!connection) {
            return;
        }

        if (connection.playerId) {
            this.sendError(
                connection,
                "Player is already registered."
            );

            return;
        }

        if (this.status !== ROOM_STATUS.WAITING) {
            this.sendError(
                connection,
                "Game has already started."
            );

            return;
        }

        const sessionId = sanitizeSessionId(
            message.sessionId
        );

        if (!sessionId) {
            this.sendError(
                connection,
                "Player session is missing."
            );

            return;
        }

        /*
         * Ищем уже существующего игрока
         * по постоянному sessionId.
         */
        const existingPlayer = this.findPlayerBySessionId(
            sessionId
        );

        if (existingPlayer) {
            this.reconnectPlayer(
                connection,
                existingPlayer,
                message
            );

            return;
        }

        /*
         * Это действительно новый игрок.
         */
        if (this.isFull()) {
            this.sendError(
                connection,
                "Room is full."
            );

            return;
        }

        const playerId = `P-${this.nextPlayerNumber++}`;

        const player = this.world.addPlayer({
            id: playerId,
            name: sanitizeName(message.name)
        });

        player.ready = false;
        player.connected = true;
        player.sessionId = sessionId;

        connection.playerId = playerId;
        connection.sessionId = sessionId;
        connection.lastSeenAt = Date.now();

        this.connections.set(
            playerId,
            connection
        );

        this.send(
            connection,
            makeMessage(MESSAGE.WELCOME, {
                roomCode: this.roomCode,
                playerId,
                sessionId,
                resumed: false,
                snapshot: this.world.snapshot(),
                roomState: this.getRoomState()
            })
        );

        this.broadcast(
            makeMessage(MESSAGE.PLAYER_JOINED, {
                player: serializePlayer(player)
            }),
            playerId
        );

        this.broadcastRoomState();

        this.notifyPlayerListChanged();
        this.notifySnapshot();
        this.notifyRoomState();

        if (typeof this.onPlayerJoined === "function") {
            this.onPlayerJoined(player);
        }
    }


    reconnectPlayer(connection, player, message) {
        const playerId = player.id;

        /*
         * Если этот игрок ещё подключён,
         * не разрешаем второе соединение
         * с той же sessionId.
         */
        const currentConnection =
            this.connections.get(playerId);

        if (
            currentConnection &&
            currentConnection !== connection
        ) {
            this.sendError(
                connection,
                "Player session is already connected."
            );

            return;
        }

        this.clearDisconnectTimer(playerId);

        player.connected = true;

        /*
         * Ник можно обновить при reconnect.
         */
        if (message.name) {
            player.name = sanitizeName(message.name);
        }

        connection.playerId = playerId;
        connection.sessionId = player.sessionId;
        connection.lastSeenAt = Date.now();

        this.connections.set(
            playerId,
            connection
        );

        this.send(
            connection,
            makeMessage(MESSAGE.WELCOME, {
                roomCode: this.roomCode,
                playerId,
                sessionId: player.sessionId,
                resumed: true,
                snapshot: this.world.snapshot(),
                roomState: this.getRoomState()
            })
        );

        this.broadcastRoomState();

        this.notifyPlayerListChanged();
        this.notifySnapshot();
        this.notifyRoomState();

        if (typeof this.onPlayerReconnected === "function") {
            this.onPlayerReconnected(player);
        }
    }


    findPlayerBySessionId(sessionId) {
        if (!sessionId) {
            return null;
        }

        for (const player of this.world.getPlayers()) {
            if (
                player.id !== "HOST" &&
                player.sessionId === sessionId
            ) {
                return player;
            }
        }

        return null;
    }


    /* ========================================================
       INPUT
       ======================================================== */

    input(connection, message) {
        if (!connection?.playerId) {
            if (connection) {
                this.sendError(
                    connection,
                    "Player is not registered."
                );
            }

            return false;
        }

        if (this.status !== ROOM_STATUS.PLAYING) {
            return false;
        }

        if (message.action !== "move") {
            return false;
        }

        const moved = this.world.movePlayer(
            connection.playerId,
            message.dx,
            message.dy
        );

        if (!moved) {
            return false;
        }

        this.world.update();

        this.broadcastSnapshot();

        return true;
    }


    /* ========================================================
       DISCONNECT
       ======================================================== */

    disconnect(connection) {
        if (!connection?.playerId) {
            return false;
        }

        const playerId = connection.playerId;

        /*
         * Если это не тот connection, который сейчас
         * считается активным — ничего не делаем.
         */
        if (
            this.connections.get(playerId) !== connection
        ) {
            return false;
        }

        this.connections.delete(playerId);

        connection.playerId = null;

        const player = this.world.getPlayer(playerId);

        if (!player) {
            return false;
        }

        /*
         * Игрок остаётся в World на время grace period.
         */
        player.connected = false;

        this.scheduleDisconnectRemoval(
            playerId
        );

        this.broadcastRoomState();

        this.notifyPlayerListChanged();
        this.notifySnapshot();
        this.notifyRoomState();

        return true;
    }


    scheduleDisconnectRemoval(playerId) {
        this.clearDisconnectTimer(playerId);

        const timer = setTimeout(() => {
            this.disconnectTimers.delete(playerId);

            const player = this.world.getPlayer(playerId);

            /*
             * Если игрок успел вернуться,
             * удалять его нельзя.
             */
            if (!player || player.connected !== false) {
                return;
            }

            this.world.removePlayer(playerId);

            this.broadcast(
                makeMessage(
                    MESSAGE.PLAYER_LEFT,
                    {
                        playerId
                    }
                )
            );

            if (typeof this.onPlayerLeft === "function") {
                this.onPlayerLeft(player);
            }

            this.notifyPlayerListChanged();
            this.notifySnapshot();
            this.notifyRoomState();
            this.broadcastRoomState();
        }, RECONNECT_GRACE_MS);

        this.disconnectTimers.set(
            playerId,
            timer
        );
    }


    clearDisconnectTimer(playerId) {
        const timer =
            this.disconnectTimers.get(playerId);

        if (!timer) {
            return;
        }

        clearTimeout(timer);

        this.disconnectTimers.delete(
            playerId
        );
    }


    /* ========================================================
       SNAPSHOT
       ======================================================== */

    broadcastSnapshot() {
        const snapshot =
            this.world.snapshot();

        const message = makeMessage(
            MESSAGE.SNAPSHOT,
            {
                roomCode: this.roomCode,
                snapshot
            }
        );

        this.broadcast(message);

        if (typeof this.onSnapshot === "function") {
            this.onSnapshot(snapshot);
        }
    }


    notifySnapshot() {
        if (typeof this.onSnapshot === "function") {
            this.onSnapshot(
                this.world.snapshot()
            );
        }
    }


    /* ========================================================
       ROOM STATE
       ======================================================== */

    broadcastRoomState() {
        const roomState =
            this.getRoomState();

        this.broadcast(
            makeMessage(
                MESSAGE.ROOM_STATE,
                {
                    roomState
                }
            )
        );

        this.notifyRoomState();
    }


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


    /* ========================================================
       SEND
       ======================================================== */

    send(connection, message) {
        if (!connection) {
            return false;
        }

        const channel =
            connection.channel;

        if (
            !channel ||
            channel.readyState !== "open"
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


    broadcast(
        message,
        exceptPlayerId = null
    ) {
        let sent = 0;

        for (
            const [
                playerId,
                connection
            ] of this.connections
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


    sendError(connection, message) {
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


    close() {
        const connections =
            [...this.connections.values()];

        for (const connection of connections) {
            this.disconnect(connection);
        }

        for (
            const timer
            of this.disconnectTimers.values()
        ) {
            clearTimeout(timer);
        }

        this.disconnectTimers.clear();
        this.connections.clear();
    }
}


/* ============================================================
   SERIALIZATION
   ============================================================ */

function serializePlayer(player) {
    return {
        id: player.id,
        name: player.name,
        ready: player.ready === true,
        connected: player.connected !== false
    };
}


function sanitizeName(name) {
    const value = String(name ?? "")
        .trim()
        .replace(/\s+/g, " ")
        .slice(0, 24);

    return value || "Player";
}


function sanitizeSessionId(value) {
    const sessionId = String(value ?? "")
        .trim();

    if (!sessionId) {
        return null;
    }

    /*
     * Ограничиваем размер и допустимые символы.
     */
    if (
        sessionId.length > 128 ||
        !/^[a-zA-Z0-9_-]+$/.test(sessionId)
    ) {
        return null;
    }

    return sessionId;
}
