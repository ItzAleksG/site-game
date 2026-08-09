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
            throw new Error(
                "HostNetwork requires a GameServer."
            );
        }

        this.gameServer = gameServer;
        this.iceServers = iceServers;

        this.connections = new Map();
        this.handlers = new Map();
    }


    on(event, handler) {
        if (typeof handler !== "function") {
            throw new TypeError(
                "Event handler must be a function."
            );
        }

        if (!this.handlers.has(event)) {
            this.handlers.set(event, new Set());
        }

        this.handlers.get(event).add(handler);

        return () => this.off(event, handler);
    }


    off(event, handler) {
        const handlers = this.handlers.get(event);

        if (!handlers) {
            return;
        }

        handlers.delete(handler);

        if (handlers.size === 0) {
            this.handlers.delete(event);
        }
    }


    emit(event, data) {
        const handlers = this.handlers.get(event);

        if (!handlers) {
            return;
        }

        for (const handler of handlers) {
            try {
                handler(data);
            }
            catch (error) {
                console.error(
                    `HostNetwork "${event}" handler failed:`,
                    error
                );
            }
        }
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

        this.connections.set(
            connectionId,
            connection
        );

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
            throw new Error(
                "WebRTC connection for this Answer was not found."
            );
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

            if (
                state === "failed" ||
                state === "closed"
            ) {
                this.removeConnection(
                    connection.id,
                    true
                );
            }
        };

        pc.oniceconnectionstatechange = () => {
            const state = pc.iceConnectionState;

            this.emit("iceConnectionStateChange", {
                connectionId: connection.id,
                state
            });

            if (state === "failed") {
                this.removeConnection(
                    connection.id,
                    true
                );
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
            this.gameServer.receive(
                connection,
                event.data
            );
        };

        channel.onclose = () => {
            this.removeConnection(
                connection.id,
                true
            );
        };

        channel.onerror = error => {
            console.error(
                "Host DataChannel error:",
                error
            );

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

        const pending = [
            ...this.connections.values()
        ].filter(connection => !connection.playerId);

        if (pending.length === 1) {
            return pending[0];
        }

        return null;
    }


    removeConnection(connectionId, notifyServer) {
        const connection = this.connections.get(connectionId);

        if (!connection || connection.closed) {
            return;
        }

        connection.closed = true;
        this.connections.delete(connectionId);

        if (notifyServer && connection.playerId) {
            this.gameServer.disconnect(connection);
        }

        try {
            connection.channel.close();
        }
        catch {
            // Ignore.
        }

        try {
            connection.pc.close();
        }
        catch {
            // Ignore.
        }

        this.emit("connectionRemoved", {
            connectionId,
            playerId: connection.playerId
        });
    }


    close() {
        const connections = [
            ...this.connections.values()
        ];

        for (const connection of connections) {
            this.removeConnection(
                connection.id,
                true
            );
        }

        this.connections.clear();
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
        const timeout = setTimeout(
            resolve,
            10000
        );

        const check = () => {
            if (pc.iceGatheringState !== "complete") {
                return;
            }

            clearTimeout(timeout);
            pc.removeEventListener(
                "icegatheringstatechange",
                check
            );
            resolve();
        };

        pc.addEventListener(
            "icegatheringstatechange",
            check
        );
    });
}
