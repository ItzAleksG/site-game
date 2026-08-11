const RTC_CONFIG = {
    iceServers: [
        {
            urls: "stun:stun.l.google.com:19302"
        }
    ]
};

const JOIN_TIMEOUT_MS = 20000;
const HEARTBEAT_INTERVAL_MS = 5000;
const HEARTBEAT_TIMEOUT_MS = 15000;


export class HostNetwork {
    constructor(gameServer, { iceServers = RTC_CONFIG.iceServers } = {}) {
        if (!gameServer) {
            throw new Error("HostNetwork requires a GameServer.");
        }

        this.gameServer = gameServer;
        this.iceServers = iceServers;
        this.connections = new Map();
        this.peerConnections = new Map();
        this.handlers = new Map();
        this.signalingSocket = null;
        this.signalingRoom = null;
        this.heartbeatTimer = setInterval(
            () => this.checkHeartbeats(),
            HEARTBEAT_INTERVAL_MS
        );
    }

    on(event, handler) {
        if (typeof handler !== "function") {
            throw new TypeError("Event handler must be a function.");
        }

        if (!this.handlers.has(event)) {
            this.handlers.set(event, new Set());
        }

        this.handlers.get(event).add(handler);
        return () => this.off(event, handler);
    }

    off(event, handler) {
        const handlers = this.handlers.get(event);
        if (!handlers) return;

        handlers.delete(handler);
        if (handlers.size === 0) {
            this.handlers.delete(event);
        }
    }

    emit(event, data) {
        const handlers = this.handlers.get(event);
        if (!handlers) return;

        for (const handler of handlers) {
            try {
                handler(data);
            }
            catch (error) {
                console.error(`HostNetwork "${event}" handler failed:`, error);
            }
        }
    }

    async connectSignaling(url, roomCode) {
        if (!url) {
            throw new Error("Signaling URL is not configured.");
        }

        this.closeSignaling();
        this.signalingRoom = String(roomCode ?? "").trim().toUpperCase();

        if (!this.signalingRoom) {
            throw new Error("Room code is required for signaling.");
        }

        const endpoint = buildSignalingUrl(url, this.signalingRoom, "host");
        const socket = new WebSocket(endpoint);
        this.signalingSocket = socket;

        socket.addEventListener("message", event => {
            this.handleSignalingMessage(event.data);
        });

        socket.addEventListener("close", event => {
            if (this.signalingSocket === socket) {
                this.signalingSocket = null;
            }

            this.emit("signalingDisconnected", {
                code: event.code,
                reason: event.reason
            });
        });

        socket.addEventListener("error", error => {
            this.emit("signalingError", error);
        });

        await new Promise((resolve, reject) => {
            let settled = false;

            const finish = (callback, value) => {
                if (settled) return;
                settled = true;
                callback(value);
            };

            socket.addEventListener("open", () => {
                this.emit("signalingConnected", {
                    roomCode: this.signalingRoom,
                    endpoint
                });
                finish(resolve);
            }, { once: true });

            socket.addEventListener("error", () => {
                finish(
                    reject,
                    new Error(`Signaling server connection failed: ${endpoint}`)
                );
            }, { once: true });
        });

        return true;
    }

    handleSignalingMessage(raw) {
        let message;

        try {
            message = JSON.parse(raw);
        }
        catch {
            return;
        }

        if (!message || typeof message !== "object") return;

        if (message.type === "peer_joined") {
            this.createInviteForPeer(message.peerId).catch(error => {
                console.error("Failed to create peer offer:", error);
                this.emit("error", { error, peerId: message.peerId });
            });
            return;
        }

        if (message.type === "peer_left") {
            const connectionId = this.peerConnections.get(message.peerId);

            if (connectionId) {
                this.removeConnection(connectionId, true);
            }

            return;
        }

        if (message.type === "signal" && message.data?.type === "answer") {
            this.acceptAnswer(
                message.data.answer,
                message.data.connectionId
            ).catch(error => {
                console.error("Failed to accept automatic answer:", error);
                this.emit("error", { error, peerId: message.from });
            });
        }
    }

    async createInviteForPeer(peerId) {
        const normalizedPeerId = String(peerId ?? "").trim();
        if (!normalizedPeerId) {
            throw new Error("Signaling peer ID is missing.");
        }

        if (this.peerConnections.has(normalizedPeerId)) {
            return null;
        }

        if (this.gameServer.status !== "waiting") {
            this.sendSignal(normalizedPeerId, {
                type: "room_error",
                message: "Game has already started."
            });
            return null;
        }

        if (this.gameServer.isFull()) {
            this.sendSignal(normalizedPeerId, {
                type: "room_error",
                message: "Room is full."
            });
            return null;
        }

        const invite = await this.createInvite();
        const connection = this.connections.get(invite.connectionId);

        if (!connection) {
            throw new Error("WebRTC connection disappeared while creating offer.");
        }

        connection.peerId = normalizedPeerId;
        this.peerConnections.set(normalizedPeerId, invite.connectionId);

        this.sendSignal(normalizedPeerId, {
            type: "offer",
            connectionId: invite.connectionId,
            offer: invite.offer
        });

        this.emit("inviteCreated", {
            peerId: normalizedPeerId,
            ...invite
        });

        return invite;
    }

    sendSignal(to, data) {
        if (!this.signalingSocket || this.signalingSocket.readyState !== WebSocket.OPEN) {
            return false;
        }

        this.signalingSocket.send(JSON.stringify({
            type: "signal",
            to,
            data
        }));

        return true;
    }

    async createInvite() {
        if (this.gameServer.isFull()) {
            throw new Error("Room is full.");
        }

        const connectionId = createConnectionId();
        const pc = new RTCPeerConnection({
            iceServers: this.iceServers
        });
        const channel = pc.createDataChannel("game");

        const connection = {
            id: connectionId,
            pc,
            channel,
            playerId: null,
            peerId: null,
            closed: false,
            joinTimer: null,
            lastState: "connecting",
            lastSeenAt: Date.now()
        };

        this.connections.set(connectionId, connection);
        this.setupConnection(connection);
        connection.joinTimer = setTimeout(() => {
            if (!connection.closed && !connection.playerId) {
                this.emit("connectionTimeout", {
                    connectionId,
                    peerId: connection.peerId
                });
                this.removeConnection(connectionId, false);
            }
        }, JOIN_TIMEOUT_MS);

        const offer = await pc.createOffer();
        await pc.setLocalDescription(offer);
        await waitForIceGatheringComplete(pc);

        const description = pc.localDescription;

        if (!description) {
            this.removeConnection(connectionId, false);
            throw new Error("Failed to create WebRTC offer.");
        }

        return {
            connectionId,
            offer: {
                type: description.type,
                sdp: description.sdp
            }
        };
    }

    async acceptAnswer(answer, connectionId = null) {
        if (!answer || typeof answer !== "object") {
            throw new Error("Invalid WebRTC answer.");
        }

        const connection = this.findConnection(connectionId);

        if (!connection) {
            throw new Error("WebRTC connection for this Answer was not found.");
        }

        await connection.pc.setRemoteDescription(
            new RTCSessionDescription(answer)
        );

        this.emit("answerAccepted", {
            connectionId: connection.id,
            peerId: connection.peerId
        });

        return true;
    }

    setupConnection(connection) {
        const { pc, channel } = connection;

        pc.onconnectionstatechange = () => {
            const state = pc.connectionState;
            connection.lastState = state;

            this.emit("connectionStateChange", {
                connectionId: connection.id,
                peerId: connection.peerId,
                playerId: connection.playerId,
                state
            });

            if (state === "failed" || state === "closed") {
                this.removeConnection(connection.id, true);
            }
        };

        pc.oniceconnectionstatechange = () => {
            const state = pc.iceConnectionState;

            this.emit("iceConnectionStateChange", {
                connectionId: connection.id,
                peerId: connection.peerId,
                playerId: connection.playerId,
                state
            });

            if (state === "failed" || state === "closed") {
                this.removeConnection(connection.id, true);
            }
        };

        channel.binaryType = "arraybuffer";

        channel.onopen = () => {
            connection.lastSeenAt = Date.now();
            connection.lastState = "connected";

            this.emit("playerConnection", {
                connectionId: connection.id,
                peerId: connection.peerId,
                playerId: connection.playerId
            });
        };

        channel.onmessage = event => {
            connection.lastSeenAt = Date.now();
            this.gameServer.receive(connection, event.data);
        };

        channel.onclose = () => {
            this.removeConnection(connection.id, true);
        };

        channel.onerror = error => {
            console.error("Host DataChannel error:", error);
            this.emit("error", {
                connectionId: connection.id,
                peerId: connection.peerId,
                error
            });
        };
    }

    checkHeartbeats() {
        const now = Date.now();

        for (const connection of [...this.connections.values()]) {
            if (connection.closed || !connection.playerId) continue;

            if (now - connection.lastSeenAt > HEARTBEAT_TIMEOUT_MS) {
                this.emit("heartbeatTimeout", {
                    connectionId: connection.id,
                    peerId: connection.peerId,
                    playerId: connection.playerId
                });
                this.removeConnection(connection.id, true);
            }
        }
    }

    findConnection(connectionId) {
        if (connectionId) {
            return this.connections.get(connectionId) || null;
        }

        const pending = [...this.connections.values()]
            .filter(connection => !connection.playerId);

        return pending.length === 1 ? pending[0] : null;
    }

    removeConnection(connectionId, notifyServer) {
        const connection = this.connections.get(connectionId);

        if (!connection || connection.closed) return;

        connection.closed = true;
        this.connections.delete(connectionId);

        if (connection.joinTimer) {
            clearTimeout(connection.joinTimer);
            connection.joinTimer = null;
        }

        if (connection.peerId) {
            const mappedId = this.peerConnections.get(connection.peerId);
            if (mappedId === connectionId) {
                this.peerConnections.delete(connection.peerId);
            }
        }

        const playerId = connection.playerId;

        if (notifyServer && playerId) {
            this.gameServer.disconnect(connection);
        }

        try { connection.channel.close(); } catch {}
        try { connection.pc.close(); } catch {}

        this.emit("connectionRemoved", {
            connectionId,
            peerId: connection.peerId,
            playerId
        });
    }

    closeSignaling() {
        if (!this.signalingSocket) return;

        try { this.signalingSocket.close(); } catch {}
        this.signalingSocket = null;
    }

    close() {
        if (this.heartbeatTimer) {
            clearInterval(this.heartbeatTimer);
            this.heartbeatTimer = null;
        }

        this.closeSignaling();

        for (const connection of [...this.connections.values()]) {
            this.removeConnection(connection.id, true);
        }

        this.connections.clear();
        this.peerConnections.clear();
    }
}


function buildSignalingUrl(value, roomCode, role) {
    let raw = String(value ?? "").trim();

    if (!raw) {
        throw new Error("Signaling URL is not configured.");
    }

    raw = raw.replace(/^wss:\/+(?=[^/])/i, "wss://");
    raw = raw.replace(/^ws:\/+(?=[^/])/i, "ws://");
    raw = raw.replace(/^https:\/+(?=[^/])/i, "https://");
    raw = raw.replace(/^http:\/+(?=[^/])/i, "http://");

    if (!/^wss?:\/\//i.test(raw)) {
        throw new Error(`Invalid signaling URL: ${raw}`);
    }

    const endpoint = new URL(raw);
    endpoint.searchParams.set("room", roomCode);
    endpoint.searchParams.set("role", role);

    return endpoint.toString();
}


function createConnectionId() {
    if (crypto.randomUUID) {
        return crypto.randomUUID();
    }

    const bytes = new Uint8Array(16);
    crypto.getRandomValues(bytes);

    return [...bytes]
        .map(value => value.toString(16).padStart(2, "0"))
        .join("");
}


function waitForIceGatheringComplete(pc) {
    if (pc.iceGatheringState === "complete") {
        return Promise.resolve();
    }

    return new Promise(resolve => {
        const timeout = setTimeout(resolve, 10000);

        const check = () => {
            if (pc.iceGatheringState !== "complete") return;

            clearTimeout(timeout);
            pc.removeEventListener("icegatheringstatechange", check);
            resolve();
        };

        pc.addEventListener("icegatheringstatechange", check);
    });
}
