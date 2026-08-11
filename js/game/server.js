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
        this.connections = new Map();
        this.nextPlayerNumber = 1;
        this.status = ROOM_STATUS.WAITING;

        this.onPlayerJoined = null;
        this.onPlayerLeft = null;
        this.onPlayerListChanged = null;
        this.onSnapshot = null;
        this.onRoomStateChanged = null;

        this.world.addPlayer({
            id: "HOST",
            name: "Host"
        });
    }


    /* ========================================================
       HOST
       ======================================================== */

    setHostName(name) {
        const host = this.world.getPlayer("HOST");
        if (!host) return false;

        host.name = sanitizeName(name);
        host.ready = true;

        this.notifyPlayerListChanged();
        this.notifySnapshot();
        this.notifyRoomState();
        return true;
    }


    hostInput(message) {
        if (!message) return false;

        return this.input(
            { playerId: "HOST" },
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
        if (this.status !== ROOM_STATUS.WAITING) return false;
        if (this.getPlayerCount() < 2) return false;

        return this.getPlayers()
            .filter(player => player.id !== "HOST")
            .every(player => player.ready === true);
    }


    getRoomState() {
        return {
            roomCode: this.roomCode,
            status: this.status,
            playerCount: this.getPlayerCount(),
            maxPlayers: this.maxPlayers,
            canStart: this.canStart(),
            players: this.getPlayers().map(player => ({
                id: player.id,
                name: player.name,
                ready: player.ready === true
            }))
        };
    }


    /* ========================================================
       ROOM LIFECYCLE
       ======================================================== */

    setPlayerReady(connection, ready = true) {
        if (!connection?.playerId) return false;
        if (this.status !== ROOM_STATUS.WAITING) return false;

        const player = this.world.getPlayer(connection.playerId);
        if (!player) return false;

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
       NETWORK INPUT
       ======================================================== */

    receive(connection, raw) {
        if (!connection) return;

        connection.lastSeenAt = Date.now();

        const message = parseMessage(raw);

        if (!message) {
            this.sendError(connection, "Invalid message.");
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
                this.setPlayerReady(connection, message.ready);
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
       JOIN
       ======================================================== */

    join(connection, message) {
        if (!connection) return;

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

        if (this.isFull()) {
            this.sendError(connection, "Room is full.");
            return;
        }

        const playerId = `P-${this.nextPlayerNumber++}`;
        const player = this.world.addPlayer({
            id: playerId,
            name: sanitizeName(message.name)
        });

        player.ready = false;
        connection.playerId = playerId;
        connection.lastSeenAt = Date.now();
        this.connections.set(playerId, connection);

        this.send(
            connection,
            makeMessage(MESSAGE.WELCOME, {
                roomCode: this.roomCode,
                playerId,
                snapshot: this.world.snapshot(),
                roomState: this.getRoomState()
            })
        );

        this.broadcast(
            makeMessage(MESSAGE.PLAYER_JOINED, { player }),
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

        if (message.action !== "move") return false;

        const moved = this.world.movePlayer(
            connection.playerId,
            message.dx,
            message.dy
        );

        if (!moved) return false;

        this.world.update();
        this.broadcastSnapshot();
        return true;
    }


    /* ========================================================
       DISCONNECT
       ======================================================== */

    disconnect(connection) {
        if (!connection?.playerId) return false;

        const playerId = connection.playerId;
        connection.playerId = null;
        this.connections.delete(playerId);

        const player = this.world.getPlayer(playerId);
        this.world.removePlayer(playerId);

        this.broadcast(
            makeMessage(MESSAGE.PLAYER_LEFT, { playerId })
        );

        if (typeof this.onPlayerLeft === "function") {
            this.onPlayerLeft(player);
        }

        this.notifyPlayerListChanged();
        this.notifySnapshot();
        this.notifyRoomState();
        this.broadcastRoomState();

        return true;
    }


    /* ========================================================
       SNAPSHOT
       ======================================================== */

    broadcastSnapshot() {
        const snapshot = this.world.snapshot();
        const message = makeMessage(MESSAGE.SNAPSHOT, {
            roomCode: this.roomCode,
            snapshot
        });

        this.broadcast(message);

        if (typeof this.onSnapshot === "function") {
            this.onSnapshot(snapshot);
        }
    }


    notifySnapshot() {
        if (typeof this.onSnapshot === "function") {
            this.onSnapshot(this.world.snapshot());
        }
    }


    /* ========================================================
       ROOM STATE
       ======================================================== */

    broadcastRoomState() {
        const roomState = this.getRoomState();

        this.broadcast(
            makeMessage(MESSAGE.ROOM_STATE, { roomState })
        );

        this.notifyRoomState();
    }


    notifyPlayerListChanged() {
        if (typeof this.onPlayerListChanged === "function") {
            this.onPlayerListChanged(this.getPlayers());
        }
    }


    notifyRoomState() {
        if (typeof this.onRoomStateChanged === "function") {
            this.onRoomStateChanged(this.getRoomState());
        }
    }


    /* ========================================================
       SEND / BROADCAST
       ======================================================== */

    send(connection, message) {
        if (!connection) return false;

        const channel = connection.channel;

        if (!channel || channel.readyState !== "open") {
            return false;
        }

        try {
            channel.send(message);
            return true;
        }
        catch (error) {
            console.error("GameServer.send failed:", error);
            return false;
        }
    }


    broadcast(message, exceptPlayerId = null) {
        let sent = 0;

        for (const [playerId, connection] of this.connections) {
            if (playerId === exceptPlayerId) continue;

            if (this.send(connection, message)) {
                sent++;
            }
        }

        return sent;
    }


    sendError(connection, message) {
        this.send(
            connection,
            makeMessage(MESSAGE.ERROR, { message })
        );
    }


    close() {
        const connections = [...this.connections.values()];

        for (const connection of connections) {
            this.disconnect(connection);
        }

        this.connections.clear();
    }
}


function sanitizeName(name) {
    const value = String(name ?? "")
        .trim()
        .replace(/\s+/g, " ")
        .slice(0, 24);

    return value || "Player";
}
