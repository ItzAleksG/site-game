import { MESSAGE } from "./protocol.js";
import { ClientNetwork } from "./client.js";
import { GameServer } from "../game/server.js";

const GRACE_MS = 20000;

const clientConnectSignaling = ClientNetwork.prototype.connectSignaling;
const clientSendMessage = ClientNetwork.prototype.sendMessage;
const clientHandleMessage = ClientNetwork.prototype.handleMessage;

ClientNetwork.prototype.connectSignaling = function(url, roomCode) {
    this.sessionId = loadSessionId(roomCode);
    return clientConnectSignaling.call(this, url, roomCode);
};

ClientNetwork.prototype.sendMessage = function(type, data = {}) {
    if (type === MESSAGE.JOIN) {
        data = { ...data, sessionId: this.sessionId || loadSessionId(this.signalingRoom) };
        this.sessionId = data.sessionId;
    }
    return clientSendMessage.call(this, type, data);
};

ClientNetwork.prototype.handleMessage = function(raw) {
    let message = null;
    try { message = typeof raw === "string" ? JSON.parse(raw) : null; } catch {}
    if (message?.type === MESSAGE.WELCOME && message.sessionId) {
        this.sessionId = message.sessionId;
        saveSessionId(this.signalingRoom, this.sessionId);
    }
    return clientHandleMessage.call(this, raw);
};

const serverJoin = GameServer.prototype.join;
const serverDisconnect = GameServer.prototype.disconnect;

GameServer.prototype.join = function(connection, message) {
    if (!this._reconnectSessions) this._reconnectSessions = new Map();

    const sessionId = normalizeSession(message?.sessionId);
    const saved = sessionId ? this._reconnectSessions.get(sessionId) : null;
    const player = saved ? this.world.getPlayer(saved.playerId) : null;

    if (saved && player) {
        if (saved.timer) clearTimeout(saved.timer);
        saved.timer = null;
        if (saved.connection && saved.connection !== connection) saved.connection.playerId = null;

        connection.playerId = player.id;
        connection.sessionId = sessionId;
        connection.preserveOnDisconnect = true;
        connection.lastSeenAt = Date.now();
        saved.connection = connection;
        this.connections.set(player.id, connection);
        player.connected = true;
        player.ready = false;
        if (message?.name) player.name = sanitizeName(message.name);

        this.send(connection, JSON.stringify({
            type: MESSAGE.WELCOME,
            roomCode: this.roomCode,
            playerId: player.id,
            sessionId,
            reconnect: true,
            snapshot: this.world.snapshot(),
            roomState: this.getRoomState()
        }));
        this.broadcastRoomState();
        this.notifyPlayerListChanged();
        this.notifySnapshot();
        return;
    }

    serverJoin.call(this, connection, message);

    if (!connection.playerId) return;

    const id = sessionId || createSessionId();
    const createdPlayer = this.world.getPlayer(connection.playerId);
    if (createdPlayer) {
        createdPlayer.sessionId = id;
        createdPlayer.connected = true;
    }
    connection.sessionId = id;
    connection.preserveOnDisconnect = true;
    this._reconnectSessions.set(id, {
        playerId: connection.playerId,
        connection,
        timer: null
    });
};

GameServer.prototype.disconnect = function(connection) {
    const sessionId = connection?.sessionId;
    const playerId = connection?.playerId;
    const record = sessionId && this._reconnectSessions?.get(sessionId);
    const player = playerId && this.world.getPlayer(playerId);

    if (!record || !player || !connection?.preserveOnDisconnect) {
        return serverDisconnect.call(this, connection);
    }

    connection.playerId = null;
    this.connections.delete(playerId);
    record.connection = null;
    player.connected = false;
    player.ready = false;

    if (record.timer) clearTimeout(record.timer);
    record.timer = setTimeout(() => {
        record.timer = null;
        if (record.connection) return;
        this._reconnectSessions.delete(sessionId);
        serverDisconnect.call(this, { playerId, sessionId, preserveOnDisconnect: false });
    }, GRACE_MS);

    this.broadcastRoomState();
    this.notifyPlayerListChanged();
    this.notifySnapshot();
    this.notifyRoomState();
    return true;
};

function loadSessionId(roomCode) {
    const key = `site-game:session:${String(roomCode ?? "").trim().toUpperCase()}`;
    try {
        const existing = sessionStorage.getItem(key);
        if (existing && /^[A-Za-z0-9_-]{16,128}$/.test(existing)) return existing;
        const id = createSessionId();
        sessionStorage.setItem(key, id);
        return id;
    } catch {
        return createSessionId();
    }
}

function saveSessionId(roomCode, id) {
    try { sessionStorage.setItem(`site-game:session:${String(roomCode ?? "").trim().toUpperCase()}`, id); } catch {}
}

function normalizeSession(value) {
    const id = String(value ?? "").trim();
    return /^[A-Za-z0-9_-]{16,128}$/.test(id) ? id : null;
}

function createSessionId() {
    if (globalThis.crypto?.randomUUID) return crypto.randomUUID().replace(/-/g, "");
    const bytes = new Uint8Array(16);
    crypto.getRandomValues(bytes);
    return [...bytes].map(value => value.toString(16).padStart(2, "0")).join("");
}

function sanitizeName(name) {
    const value = String(name ?? "").trim().replace(/\s+/g, " ").slice(0, 24);
    return value || "Player";
}
