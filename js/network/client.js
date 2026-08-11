import {
    MESSAGE,
    makeMessage,
    parseMessage
} from "./protocol.js";


const RTC_CONFIG = {
    iceServers: [
        {
            urls: "stun:stun.l.google.com:19302"
        }
    ]
};

const PING_INTERVAL_MS = 5000;
const RECONNECT_BASE_MS = 1000;
const RECONNECT_MAX_MS = 10000;
const MAX_RECONNECT_ATTEMPTS = 5;


export class ClientNetwork {
    constructor({ iceServers = RTC_CONFIG.iceServers } = {}) {
        this.iceServers = iceServers;
        this.pc = null;
        this.channel = null;
        this.playerId = null;
        this.playerName = "Player";
        this.handlers = new Map();
        this.signalingSocket = null;
        this.signalingUrl = null;
        this.signalingRoom = null;
        this.offerTimeoutTimer = null;
        this.pingTimer = null;
        this.reconnectTimer = null;
        this.reconnectAttempts = 0;
        this.shouldReconnect = false;
        this.roomReady = false;
        this.activeConnectionId = null;
        this.joinSent = false;
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
                console.error(`ClientNetwork "${event}" handler failed:`, error);
            }
        }
    }

    async connectSignaling(url, roomCode) {
        if (!url) {
            throw new Error("Signaling URL is not configured.");
        }

        this.clearReconnectTimer();
        this.closeSignaling();
        this.roomReady = false;
        this.activeConnectionId = null;
        this.joinSent = false;
        this.signalingUrl = String(url).trim();
        this.signalingRoom = String(roomCode ?? "").trim().toUpperCase();
        this.shouldReconnect = true;

        if (!this.signalingRoom) {
            throw new Error("Room code is required for signaling.");
        }

        return this.openSignalingSocket();
    }

    async openSignalingSocket() {
        const endpoint = buildSignalingUrl(
            this.signalingUrl,
            this.signalingRoom,
            "client"
        );
        const socket = new WebSocket(endpoint);
        this.signalingSocket = socket;

        socket.addEventListener("message", event => {
            this.handleSignalingMessage(event.data);
        });

        socket.addEventListener("close", event => {
            this.clearOfferTimeout();

            if (this.signalingSocket === socket) {
                this.signalingSocket = null;
            }

            this.emit("signalingDisconnected", {
                code: event.code,
                reason: event.reason
            });

            if (this.shouldReconnect && !this.roomReady) {
                this.scheduleReconnect();
            }
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
                this.reconnectAttempts = 0;
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

        if (message.type === "connected") {
            if (message.peerId) {
                this.playerId = message.peerId;
            }
            return;
        }

        if (message.type === "room_ready") {
            this.roomReady = true;
            this.scheduleOfferTimeout();
            this.emit("roomReady", message);
            return;
        }

        if (message.type === "signal" && message.data?.type === "offer") {
            const connectionId = String(message.data.connectionId ?? "");

            if (!connectionId) {
                this.emit("error", new Error("HOST sent an offer without a connection ID."));
                return;
            }

            if (this.activeConnectionId === connectionId && this.pc) {
                return;
            }

            this.clearOfferTimeout();
            this.activeConnectionId = connectionId;

            this.connect(message.data.offer)
                .then(answer => {
                    const sent = this.sendSignal("host", {
                        type: "answer",
                        connectionId,
                        answer
                    });

                    if (!sent) {
                        throw new Error("Signaling connection closed before the WebRTC answer was sent.");
                    }
                })
                .catch(error => {
                    console.error("Failed to create automatic WebRTC answer:", error);
                    this.emit("error", error);
                    this.closeSignaling();
                    this.scheduleReconnect();
                });
            return;
        }

        if (message.type === "room_error") {
            this.clearOfferTimeout();
            this.roomReady = false;
            this.shouldReconnect = false;
            this.emit("roomNotFound", new Error(
                message.message || "Комната недоступна."
            ));
            return;
        }

        if (message.type === "signal_error") {
            this.emit("error", new Error(
                message.message || "Signaling server could not deliver the message."
            ));
            return;
        }

        if (message.type === "host_left") {
            this.clearOfferTimeout();
            this.roomReady = false;
            this.closePeerConnection();
            this.shouldReconnect = false;
            this.emit("disconnected");
        }
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

    async connect(offer) {
        if (this.pc) {
            this.closePeerConnection();
        }

        if (!offer || typeof offer !== "object") {
            throw new Error("Invalid WebRTC offer.");
        }

        this.joinSent = false;
        this.pc = new RTCPeerConnection({
            iceServers: this.iceServers
        });

        const connection = this.pc;

        connection.onconnectionstatechange = () => {
            const state = connection.connectionState;
            this.emit("connectionStateChange", state);

            if (state === "connected") {
                this.reconnectAttempts = 0;
            }

            if (state === "failed" || state === "closed") {
                if (this.pc === connection) {
                    this.pc = null;
                }

                this.emit("disconnected");
                this.closeSignaling();
                this.scheduleReconnect();
            }
        };

        connection.oniceconnectionstatechange = () => {
            const state = connection.iceConnectionState;
            this.emit("iceConnectionStateChange", state);

            if (state === "failed" || state === "closed") {
                this.emit("disconnected");
                this.closeSignaling();
                this.scheduleReconnect();
            }
        };

        connection.onicecandidate = event => {
            if (event.candidate) {
                this.emit("iceCandidate", event.candidate);
            }
        };

        connection.ondatachannel = event => {
            if (this.channel) {
                try { event.channel.close(); } catch {}
                return;
            }

            this.channel = event.channel;
            this.setupChannel();
        };

        await connection.setRemoteDescription(
            new RTCSessionDescription(offer)
        );

        const answer = await connection.createAnswer();
        await connection.setLocalDescription(answer);
        await waitForIceGatheringComplete(connection);

        const description = connection.localDescription;

        if (!description) {
            throw new Error("Failed to create WebRTC answer.");
        }

        return {
            type: description.type,
            sdp: description.sdp
        };
    }

    setupChannel() {
        if (!this.channel) return;

        this.channel.binaryType = "arraybuffer";

        this.channel.onopen = () => {
            this.startPingLoop();
            this.emit("connected");
        };

        this.channel.onmessage = event => {
            this.handleMessage(event.data);
        };

        this.channel.onclose = () => {
            this.stopPingLoop();
            this.emit("disconnected");
            this.closeSignaling();
            this.scheduleReconnect();
        };

        this.channel.onerror = error => {
            console.error("Client DataChannel error:", error);
            this.emit("error", error);
        };
    }

    handleMessage(raw) {
        const message = parseMessage(raw);

        if (!message) {
            this.emit("error", new Error("Received invalid server message."));
            return;
        }

        if (message.type === MESSAGE.WELCOME) {
            this.playerId = message.playerId;
        }

        this.emit(message.type, message);
        this.emit("message", message);
    }

    sendMessage(type, data = {}) {
        if (!this.channel || this.channel.readyState !== "open") {
            return false;
        }

        try {
            this.channel.send(makeMessage(type, data));
            return true;
        }
        catch (error) {
            console.error("ClientNetwork.sendMessage failed:", error);
            this.emit("error", error);
            return false;
        }
    }

    join(name = this.playerName) {
        this.playerName = sanitizeName(name);

        if (this.joinSent) return true;

        const sent = this.sendMessage(MESSAGE.JOIN, {
            name: this.playerName
        });

        if (sent) {
            this.joinSent = true;
        }

        return sent;
    }

    setReady(ready = true) {
        return this.sendMessage(MESSAGE.PLAYER_READY, {
            ready: Boolean(ready)
        });
    }

    move(dx, dy) {
        return this.sendMessage(MESSAGE.INPUT, {
            action: "move",
            dx: normalizeDirection(dx),
            dy: normalizeDirection(dy)
        });
    }

    ping() {
        return this.sendMessage(MESSAGE.PING, {
            time: Date.now()
        });
    }

    startPingLoop() {
        this.stopPingLoop();
        this.ping();

        this.pingTimer = setInterval(() => {
            if (!this.ping()) {
                this.stopPingLoop();
            }
        }, PING_INTERVAL_MS);
    }

    stopPingLoop() {
        if (!this.pingTimer) return;

        clearInterval(this.pingTimer);
        this.pingTimer = null;
    }

    scheduleOfferTimeout(timeout = 15000) {
        this.clearOfferTimeout();

        this.offerTimeoutTimer = setTimeout(() => {
            this.offerTimeoutTimer = null;
            this.emit(
                "offerTimeout",
                new Error("HOST did not send a WebRTC offer within 15 seconds.")
            );
        }, timeout);
    }

    clearOfferTimeout() {
        if (!this.offerTimeoutTimer) return;

        clearTimeout(this.offerTimeoutTimer);
        this.offerTimeoutTimer = null;
    }

    scheduleReconnect() {
        if (!this.shouldReconnect) return;
        if (!this.signalingRoom || !this.signalingUrl) return;
        if (this.reconnectTimer) return;

        if (this.signalingSocket) {
            this.closeSignaling();
        }

        if (this.reconnectAttempts >= MAX_RECONNECT_ATTEMPTS) {
            this.emit(
                "reconnectFailed",
                new Error("Не удалось восстановить подключение к комнате.")
            );
            return;
        }

        this.reconnectAttempts++;
        const delay = Math.min(
            RECONNECT_BASE_MS * 2 ** (this.reconnectAttempts - 1),
            RECONNECT_MAX_MS
        );

        this.emit("reconnecting", {
            attempt: this.reconnectAttempts,
            delay
        });

        this.reconnectTimer = setTimeout(async () => {
            this.reconnectTimer = null;

            if (!this.shouldReconnect) return;

            try {
                await this.openSignalingSocket();
            }
            catch (error) {
                this.emit("reconnectError", error);
                this.scheduleReconnect();
            }
        }, delay);
    }

    clearReconnectTimer() {
        if (!this.reconnectTimer) return;

        clearTimeout(this.reconnectTimer);
        this.reconnectTimer = null;
    }

    closePeerConnection() {
        this.stopPingLoop();

        const channel = this.channel;
        const pc = this.pc;

        this.channel = null;
        this.pc = null;
        this.activeConnectionId = null;
        this.joinSent = false;

        try { channel?.close(); } catch {}
        try { pc?.close(); } catch {}
    }

    closeSignaling() {
        this.clearOfferTimeout();
        this.roomReady = false;

        const socket = this.signalingSocket;
        this.signalingSocket = null;

        try { socket?.close(); } catch {}
    }

    close() {
        this.shouldReconnect = false;
        this.clearReconnectTimer();
        this.clearOfferTimeout();
        this.closeSignaling();
        this.closePeerConnection();
        this.playerId = null;
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


function sanitizeName(name) {
    const value = String(name ?? "")
        .trim()
        .replace(/\s+/g, " ")
        .slice(0, 24);

    return value || "Player";
}


function normalizeDirection(value) {
    const number = Number(value);

    if (!Number.isFinite(number)) return 0;
    if (number > 0) return 1;
    if (number < 0) return -1;
    return 0;
}


function waitForIceGatheringComplete(pc, timeout = 5000) {
    if (pc.iceGatheringState === "complete") {
        return Promise.resolve();
    }

    return new Promise(resolve => {
        let finished = false;

        const finish = () => {
            if (finished) return;
            finished = true;
            clearTimeout(timer);
            pc.removeEventListener("icegatheringstatechange", check);
            resolve();
        };

        const check = () => {
            if (pc.iceGatheringState === "complete") {
                finish();
            }
        };

        const timer = setTimeout(finish, timeout);

        pc.addEventListener("icegatheringstatechange", check);
        check();
    });
}
