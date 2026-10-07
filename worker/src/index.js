import { DurableObject } from "cloudflare:workers";

const MAX_PEERS = 8;
const ROOM_CODE_PATTERN = /^[A-Z0-9]{6,12}$/;
const HOST_STATE_KEY = "hostOnline";


export default {
    async fetch(request, env) {
        const url = new URL(request.url);

        if (url.pathname === "/health") {
            return new Response("ok", {
                headers: {
                    "content-type": "text/plain; charset=utf-8"
                }
            });
        }

        if (url.pathname !== "/ws") {
            return new Response("Not found", {
                status: 404
            });
        }

        if (request.headers.get("Upgrade")?.toLowerCase() !== "websocket") {
            return new Response("WebSocket required", {
                status: 426
            });
        }

        const room = normalizeRoomCode(
            url.searchParams.get("room")
        );
        const role = url.searchParams.get("role");

        if (!room || !ROOM_CODE_PATTERN.test(room)) {
            return json({
                error: "Invalid room code."
            }, 400);
        }

        if (role !== "host" && role !== "client") {
            return json({
                error: "Invalid role."
            }, 400);
        }

        const id = env.ROOMS.idFromName(room);
        const stub = env.ROOMS.get(id);

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

        this.restoreSockets();
    }


    restoreSockets() {
        this.sockets.clear();
        this.hostSocket = null;
        this.nextPeerNumber = 1;

        for (const socket of this.ctx.getWebSockets()) {
            const info = socket.deserializeAttachment();

            if (!info?.peerId || !info?.role) {
                continue;
            }

            const socketInfo = {
                socket,
                role: info.role,
                peerId: info.peerId,
                room: info.room,
                connectedAt: info.connectedAt ?? Date.now()
            };

            this.sockets.set(
                socketInfo.peerId,
                socketInfo
            );

            if (socketInfo.role === "host") {
                this.hostSocket = socket;
            }
            else if (socketInfo.peerId.startsWith("P-")) {
                const number = Number(
                    socketInfo.peerId.slice(2)
                );

                if (
                    Number.isInteger(number) &&
                    number >= this.nextPeerNumber
                ) {
                    this.nextPeerNumber = number + 1;
                }
            }
        }
    }


    async fetch(request) {
        if (request.headers.get("Upgrade")?.toLowerCase() !== "websocket") {
            return new Response("WebSocket required", {
                status: 426
            });
        }

        const url = new URL(request.url);
        const room = normalizeRoomCode(
            url.searchParams.get("room")
        );
        const role = url.searchParams.get("role");

        if (!room || !ROOM_CODE_PATTERN.test(room)) {
            return new Response("Invalid room code.", {
                status: 400
            });
        }

        if (role !== "host" && role !== "client") {
            return new Response("Invalid role.", {
                status: 400
            });
        }

        /*
         * Rebuild the in-memory view in case this Durable Object
         * was recreated after WebSocket hibernation.
         */
        this.restoreSockets();

        const hostOnline =
            await this.ctx.storage.get(HOST_STATE_KEY);

        if (role === "client" && !hostOnline) {
            return new Response(
                "Room not found or HOST is offline.",
                {
                    status: 404,
                    headers: {
                        "content-type":
                            "text/plain; charset=utf-8"
                    }
                }
            );
        }

        if (role === "host" && hostOnline) {
            return new Response(
                "Room already has a host.",
                {
                    status: 409
                }
            );
        }

        if (
            role === "client" &&
            this.sockets.size >= MAX_PEERS + 1
        ) {
            return new Response(
                "Room is full.",
                {
                    status: 409
                }
            );
        }

        const pair = new WebSocketPair();
        const [client, server] =
            Object.values(pair);

        /*
         * Use Durable Object WebSocket Hibernation.
         * Unlike server.accept(), this keeps the WebSocket alive
         * while allowing the Durable Object instance to hibernate.
         */
        this.ctx.acceptWebSocket(server);

        const peerId =
            role === "host"
                ? "host"
                : `P-${this.nextPeerNumber++}`;

        const socketInfo = {
            socket: server,
            role,
            peerId,
            room,
            connectedAt: Date.now()
        };

        server.serializeAttachment({
            role,
            peerId,
            room,
            connectedAt: socketInfo.connectedAt
        });

        this.sockets.set(
            peerId,
            socketInfo
        );

        if (role === "host") {
            this.hostSocket = server;

            await this.ctx.storage.put(
                HOST_STATE_KEY,
                true
            );
        }

        this.send(server, {
            type: "connected",
            room,
            peerId,
            role
        });

        if (role === "host") {
            this.send(server, {
                type: "room_ready",
                room,
                role: "host"
            });
        }
        else {
            this.send(server, {
                type: "room_ready",
                room,
                role: "client"
            });

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


    async webSocketMessage(socket, raw) {
        const sender =
            this.getSocketInfo(socket);

        if (!sender) {
            return;
        }

        this.handleMessage(
            sender,
            raw
        );
    }


    async webSocketClose(
        socket,
        code,
        reason
    ) {
        const sender =
            this.getSocketInfo(socket);

        if (sender) {
            this.removeSocket(
                sender.peerId
            );
        }

        /*
         * With compatibility_date >= 2026-04-07,
         * Cloudflare completes the close handshake automatically.
         */
        void code;
        void reason;
    }


    async webSocketError(socket) {
        const sender =
            this.getSocketInfo(socket);

        if (sender) {
            this.removeSocket(
                sender.peerId
            );
        }
    }


    getSocketInfo(socket) {
        for (const info of this.sockets.values()) {
            if (info.socket === socket) {
                return info;
            }
        }

        const attachment =
            socket.deserializeAttachment();

        if (!attachment?.peerId) {
            return null;
        }

        return {
            socket,
            role: attachment.role,
            peerId: attachment.peerId,
            room: attachment.room,
            connectedAt:
                attachment.connectedAt ??
                Date.now()
        };
    }


    handleMessage(sender, raw) {
        let message;

        try {
            message = JSON.parse(raw);
        }
        catch {
            return;
        }

        if (
            !message ||
            typeof message !== "object"
        ) {
            return;
        }

        if (message.type === "signal") {
            this.forwardSignal(
                sender,
                message
            );
            return;
        }

        if (message.type === "ping") {
            this.send(
                sender.socket,
                {
                    type: "pong",
                    time: Date.now()
                }
            );
        }
    }


    forwardSignal(sender, message) {
        const targetId =
            String(message.to ?? "");

        const target =
            this.sockets.get(targetId);

        if (!target) {
            this.send(
                sender.socket,
                {
                    type: "signal_error",
                    message:
                        `Target peer is not connected: ${targetId}`,
                    target: targetId
                }
            );
            return;
        }

        this.send(
            target.socket,
            {
                type: "signal",
                from: sender.peerId,
                data: message.data ?? null
            }
        );
    }


    sendToHost(message) {
        this.restoreSockets();

        if (!this.hostSocket) {
            return false;
        }

        return this.send(
            this.hostSocket,
            message
        );
    }


    send(socket, message) {
        try {
            if (
                socket.readyState ===
                WebSocket.OPEN
            ) {
                socket.send(
                    JSON.stringify(message)
                );

                return true;
            }
        }
        catch {
            // Socket may have closed between the state check and send.
        }

        return false;
    }


    removeSocket(peerId) {
        const info =
            this.sockets.get(peerId);

        if (!info) {
            return;
        }

        this.sockets.delete(peerId);

        if (
            info.socket ===
            this.hostSocket
        ) {
            this.hostSocket = null;

            this.ctx.storage
                .delete(HOST_STATE_KEY)
                .catch(() => {});

            for (
                const peer of
                this.sockets.values()
            ) {
                this.send(
                    peer.socket,
                    {
                        type: "host_left"
                    }
                );

                try {
                    peer.socket.close(
                        1000,
                        "Host left the room."
                    );
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
    return new Response(
        JSON.stringify(data),
        {
            status,
            headers: {
                "content-type":
                    "application/json; charset=utf-8",
                "access-control-allow-origin":
                    "*"
            }
        }
    );
}
