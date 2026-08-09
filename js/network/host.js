import { MESSAGE } from "./protocol.js";


const RTC_CONFIG = {
    iceServers: [
        {
            urls: "stun:stun.l.google.com:19302"
        }
    ]
};


export class HostNetwork {
    constructor(
        gameServer,
        {
            iceServers = RTC_CONFIG.iceServers
        } = {}
    ) {
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

        const endpoint = new URL(url);
        endpoint.searchParams.set("room", this.signalingRoom);
        endpoint.searchParams.set("role", "host");

        const socket = new WebSocket(endpoint);
        this.signalingSocket = socket;

        await new Promise((resolve, reject) => {
            let settled = false;

            const finish = (callback, value) => {
                if (settled) return;
                settled = true;
                callback(value);
            };

            socket.addEventListener("open", () => {
                this.emit("signalingConnected", {
                    roomCode: this.signalingRoom
                });
                finish(resolve);
            }, { once: true });

            socket.addEventListener("error", error => {
                finish(reject, new Error("Signaling server connection failed."));
                this.emit("signalingError", error);
            }, { once: true });
        });

        socket.addEventListener("message", event => {
            this.handleSignalingMessage(event.data);
        });

        socket.addEventListener("close", () => {
            if (this.signalingSocket === socket) {
                this.signalingSocket = null;
            }
            this.emit("signalingDisconnected");
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
                this.peerConnections.delete(message.peerId);
            }
            return;
        }

        if (message.type === "signal") {
            if (message.data?.type !== "answer") return;

            const connectionId = message.data.connectionId;

            this.acceptAnswer(
                message.data.answer,
                connectionId
            ).catch(error => {
                console.error("Failed to accept automatic answer:", error);
                this.emit("error", {
                    error,
                    peerId: message.from
                });
            });
        }
    }

    async createInviteForPeer(peerId) {
        const invite = await this.createInvite();

        this.peerConnections.set(
            peerId,
            invite.connectionId
        );

        this.sendSignal(
            peerId,
            {
                type: "offer",
                connectionId: invite.connectionId,
                offer: invite.offer
            }
        );

        this.emit("inviteCreated", {
            peerId,
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
            closed: false
        };

        this.connections.set(connectionId, connection);
        this.setupConnection(connection);

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
            connectionId: connection.id
        });

        return true;
    }

    setupConnection(connection) {
        const { pc, channel } = connection;

        pc.onconnectionstatechange = () => {
            const state = pc.connectionState;

            this.emit("connectionStateChange", {
                connectionId: connection.id,
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
                state
            });

            if (state === "failed") {
                this.removeConnection(connection.id, true);
            }
        };

        pc.onicecandidate = event => {
            if (event.candidate) {
                this.emit("iceCandidate", {
                    connectionId: connection.id,
                    candidate: event.candidate
                });
            }
        };

        channel.binaryType = "arraybuffer";

        channel.onopen = () => {
            this.emit("playerConnection", {
                connectionId: connection.id
            });
        };

        channel.onmessage = event => {
            this.gameServer.receive(connection, event.data);
        };

        channel.onclose = () => {
            this.removeConnection(connection.id, true);
        };

        channel.onerror = error => {
            console.error("Host DataChannel error:", error);
            this.emit("error", {
                connectionId: connection.id,
                error
            });
        };
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

        for (const [peerId, id] of this.peerConnections) {
            if (id === connectionId) {
                this.peerConnections.delete(peerId);
            }
        }

        if (notifyServer && connection.playerId) {
            this.gameServer.disconnect(connection);
        }

        try { connection.channel.close(); } catch {}
        try { connection.pc.close(); } catch {}

        this.emit("connectionRemoved", {
            connectionId,
            playerId: connection.playerId
        });
    }

    closeSignaling() {
        if (!this.signalingSocket) return;

        try {
            this.signalingSocket.close();
        }
        catch {
            // Ignore.
        }

        this.signalingSocket = null;
    }

    close() {
        this.closeSignaling();

        for (const connection of [...this.connections.values()]) {
            this.removeConnection(connection.id, true);
        }

        this.connections.clear();
        this.peerConnections.clear();
    }
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
