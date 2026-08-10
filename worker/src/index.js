import { DurableObject } from "cloudflare:workers";

const MAX_PEERS = 8;
const ROOM_CODE_PATTERN = /^[A-Z0-9]{6,12}$/;

export default {
    async fetch(request, env) {
        const url = new URL(request.url);

        if (url.pathname === "/health") {
            return new Response("ok", {
                headers: { "content-type": "text/plain; charset=utf-8" }
            });
        }

        if (url.pathname !== "/ws") {
            return new Response("Not found", { status: 404 });
        }

        if (request.headers.get("Upgrade")?.toLowerCase() !== "websocket") {
            return new Response("WebSocket required", { status: 426 });
        }

        const room = normalizeRoomCode(url.searchParams.get("room"));
        const role = url.searchParams.get("role");

        if (!room || !ROOM_CODE_PATTERN.test(room)) {
            return json({ error: "Invalid room code." }, 400);
        }

        if (role !== "host" && role !== "client") {
            return json({ error: "Invalid role." }, 400);
        }

        const id = env.ROOMS.idFromName(room);
        const stub = env.ROOMS.get(id);

        // Forward the original WebSocket request unchanged so the
        // Durable Object receives the WebSocket upgrade correctly.
        return stub.fetch(request);
    }
};


export class RoomSignaling extends DurableObject {
    constructor(ctx, env) {
        super(ctx, env);
        this.env = env;
        this.sockets = new Map();
        this.hostSocket = null;
        this.nextPeerNumber = 1;
    }

    async fetch(request) {
        if (request.headers.get("Upgrade")?.toLowerCase() !== "websocket") {
            return new Response("WebSocket required", { status: 426 });
        }

        const url = new URL(request.url);
        const room = normalizeRoomCode(url.searchParams.get("room"));
        const role = url.searchParams.get("role");

        if (!room || !ROOM_CODE_PATTERN.test(room)) {
            return new Response("Invalid room code.", { status: 400 });
        }

        if (role !== "host" && role !== "client") {
            return new Response("Invalid role.", { status: 400 });
        }

        // A room only exists while its HOST is connected. idFromName(room)
        // creates a Durable Object for any arbitrary name, so existence must
        // be checked here instead of treating every syntactically valid code
        // as an existing room.
        if (role === "client" && !this.hostSocket) {
            return new Response("Room not found or HOST is offline.", {
                status: 404,
                headers: {
                    "content-type": "text/plain; charset=utf-8"
                }
            });
        }

        if (role === "host" && this.hostSocket) {
            return new Response("Room already has a host.", { status: 409 });
        }

        if (role === "client" && this.sockets.size >= MAX_PEERS + 1) {
            return new Response("Room is full.", { status: 409 });
        }

        const pair = new WebSocketPair();
        const [client, server] = Object.values(pair);

        server.accept();

        const peerId = role === "host"
            ? "host"
            : `P-${this.nextPeerNumber++}`;

        const socketInfo = {
            socket: server,
            role,
            peerId,
            room,
            connectedAt: Date.now()
        };

        this.sockets.set(peerId, socketInfo);

        if (role === "host") {
            this.hostSocket = server;
        }

        server.addEventListener("message", event => {
            this.handleMessage(socketInfo, event.data);
        });

        server.addEventListener("close", () => {
            this.removeSocket(peerId);
        });

        server.addEventListener("error", () => {
            this.removeSocket(peerId);
        });

        server.send(JSON.stringify({
            type: "connected",
            room,
            peerId,
            role
        }));

        if (role === "client") {
            this.sendToHost({
                type: "peer_joined",
                peerId
            });
        }

        return new Response(null, {
            status: 101,
            webSocket: client
        });
    }

    handleMessage(sender, raw) {
        let message;

        try {
            message = JSON.parse(raw);
        }
        catch {
            return;
        }

        if (!message || typeof message !== "object") {
            return;
        }

        if (message.type === "signal") {
            this.forwardSignal(sender, message);
            return;
        }

        if (message.type === "ping") {
            this.send(sender.socket, {
                type: "pong",
                time: Date.now()
            });
        }
    }

    forwardSignal(sender, message) {
        const targetId = String(message.to ?? "");
        const target = this.sockets.get(targetId);

        if (!target) {
            this.send(sender.socket, {
                type: "signal_error",
                message: "Target peer is not connected.",
                target: targetId
            });
            return;
        }

        this.send(target.socket, {
            type: "signal",
            from: sender.peerId,
            data: message.data ?? null
        });
    }

    sendToHost(message) {
        if (!this.hostSocket) {
            return;
        }

        this.send(this.hostSocket, message);
    }

    send(socket, message) {
        try {
            if (socket.readyState === WebSocket.OPEN) {
                socket.send(JSON.stringify(message));
            }
        }
        catch {
            // Socket may have closed between the state check and send.
        }
    }

    removeSocket(peerId) {
        const info = this.sockets.get(peerId);

        if (!info) {
            return;
        }

        this.sockets.delete(peerId);

        if (info.socket === this.hostSocket) {
            this.hostSocket = null;

            for (const peer of this.sockets.values()) {
                this.send(peer.socket, {
                    type: "host_left"
                });

                try {
                    peer.socket.close(1000, "Host left the room.");
                }
                catch {
                    // Ignore.
                }
            }

            this.sockets.clear();
            return;
        }

        if (this.hostSocket) {
            this.sendToHost({
                type: "peer_left",
                peerId
            });
        }
    }
}


function normalizeRoomCode(value) {
    return String(value ?? "")
        .trim()
        .toUpperCase();
}


function json(data, status = 200) {
    return new Response(JSON.stringify(data), {
        status,
        headers: {
            "content-type": "application/json; charset=utf-8",
            "access-control-allow-origin": "*"
        }
    });
}
