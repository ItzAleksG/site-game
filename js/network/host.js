const RTC_CONFIG = {
    iceServers: [
        {
            urls:
                "stun:stun.l.google.com:19302"
        }
    ]
};


export class HostNetwork {
    constructor(
        gameServer,
        {
            iceServers =
                RTC_CONFIG.iceServers
        } = {}
    ) {
        if (!gameServer) {
            throw new Error(
                "HostNetwork requires a GameServer."
            );
        }

        this.gameServer =
            gameServer;

        this.iceServers =
            iceServers;

        /*
         * connectionId -> connection
         */
        this.connections =
            new Map();

        this.nextConnectionId =
            1;

        /*
         * event -> Set<handler>
         */
        this.handlers =
            new Map();
    }


    /*
    ============================================================
    EVENTS
    ============================================================
    */

    on(event, handler) {
        if (
            typeof handler !==
            "function"
        ) {
            throw new TypeError(
                "Event handler must be a function."
            );
        }

        if (
            !this.handlers.has(
                event
            )
        ) {
            this.handlers.set(
                event,
                new Set()
            );
        }

        this.handlers
            .get(event)
            .add(handler);

        return () => {
            this.off(
                event,
                handler
            );
        };
    }


    off(event, handler) {
        const handlers =
            this.handlers.get(
                event
            );

        if (!handlers) {
            return;
        }

        handlers.delete(
            handler
        );

        if (
            handlers.size ===
            0
        ) {
            this.handlers.delete(
                event
            );
        }
    }


    emit(event, data) {
        const handlers =
            this.handlers.get(
                event
            );

        if (!handlers) {
            return;
        }

        for (
            const handler
            of handlers
        ) {
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


    /*
    ============================================================
    CREATE INVITE
    ============================================================
    */

    async createInvite() {
        if (
            this.gameServer.isFull()
        ) {
            throw new Error(
                "Room is full."
            );
        }

        const connection =
            this.createConnection();

        const channel =
            connection.pc.createDataChannel(
                "game",
                {
                    ordered: true
                }
            );

        connection.channel =
            channel;

        this.setupDataChannel(
            connection
        );

        const offer =
            await connection.pc
                .createOffer();

        await connection.pc
            .setLocalDescription(
                offer
            );

        await this.waitForIceGathering(
            connection.pc
        );

        connection.state =
            "waiting-answer";

        const description =
            connection.pc.localDescription;

        const invite = {
            connectionId:
                connection.id,

            offer: {
                type:
                    description.type,

                sdp:
                    description.sdp
            }
        };

        this.emit(
            "inviteCreated",
            {
                connection,
                invite
            }
        );

        return invite;
    }


    /*
    ============================================================
    CREATE CONNECTION
    ============================================================
    */

    createConnection() {
        const id =
            `connection-${this.nextConnectionId++}`;

        const pc =
            new RTCPeerConnection({
                iceServers:
                    this.iceServers
            });

        const connection = {
            id,

            pc,

            channel:
                null,

            playerId:
                null,

            state:
                "creating",

            createdAt:
                Date.now()
        };

        this.connections.set(
            id,
            connection
        );

        pc.onconnectionstatechange =
            () => {
                this.handleConnectionState(
                    connection
                );
            };

        pc.oniceconnectionstatechange =
            () => {
                this.emit(
                    "iceConnectionStateChange",
                    {
                        connectionId:
                            connection.id,

                        state:
                            pc.iceConnectionState
                    }
                );
            };

        pc.onicecandidate =
            event => {
                if (
                    !event.candidate
                ) {
                    return;
                }

                this.emit(
                    "iceCandidate",
                    {
                        connectionId:
                            connection.id,

                        candidate:
                            event.candidate
                    }
                );
            };

        /*
         * HOST сам создаёт DataChannel.
         *
         * ondatachannel оставляем как защиту,
         * если браузер сообщит о канале.
         */
        pc.ondatachannel =
            event => {
                if (
                    connection.channel
                ) {
                    try {
                        event.channel.close();
                    }
                    catch {
                        // Ignore.
                    }

                    return;
                }

                connection.channel =
                    event.channel;

                this.setupDataChannel(
                    connection
                );
            };

        return connection;
    }


    /*
    ============================================================
    DATA CHANNEL
    ============================================================
    */

    setupDataChannel(
        connection
    ) {
        const channel =
            connection.channel;

        if (!channel) {
            return;
        }

        channel.binaryType =
            "arraybuffer";

        channel.onopen =
            () => {
                connection.state =
                    "connected";

                this.emit(
                    "playerConnection",
                    connection
                );

                this.emit(
                    "connectionStateChange",
                    {
                        connection,
                        state:
                            "connected"
                    }
                );
            };

        channel.onmessage =
            event => {
                /*
                 * Только передаём сообщение
                 * авторитетному GameServer.
                 */
                this.gameServer.receive(
                    connection,
                    event.data
                );
            };

        channel.onclose =
            () => {
                this.handleChannelClose(
                    connection
                );
            };

        channel.onerror =
            error => {
                console.error(
                    "WebRTC DataChannel error:",
                    error
                );

                this.emit(
                    "error",
                    {
                        connection,
                        error
                    }
                );
            };
    }


    /*
    ============================================================
    ACCEPT ANSWER
    ============================================================
    */

    async acceptAnswer(
        answer,
        connectionId = null
    ) {
        let connection;

        if (connectionId) {
            connection =
                this.connections.get(
                    connectionId
                );
        }
        else {
            connection =
                this.findWaitingConnection();
        }

        if (!connection) {
            throw new Error(
                "No waiting WebRTC connection found."
            );
        }

        if (
            connection.state !==
            "waiting-answer"
        ) {
            throw new Error(
                "Connection is not waiting for an answer."
            );
        }

        if (
            !answer ||
            typeof answer !==
            "object"
        ) {
            throw new Error(
                "Invalid WebRTC answer."
            );
        }

        await connection.pc
            .setRemoteDescription(
                new RTCSessionDescription(
                    answer
                )
            );

        connection.state =
            "connecting";

        this.emit(
            "answerAccepted",
            {
                connection,
                answer
            }
        );

        return connection;
    }


    /*
    ============================================================
    FIND WAITING CONNECTION
    ============================================================
    */

    findWaitingConnection() {
        const connections =
            [
                ...this.connections.values()
            ];

        for (
            let i =
                connections.length - 1;
            i >= 0;
            i--
        ) {
            if (
                connections[i].state ===
                "waiting-answer"
            ) {
                return connections[i];
            }
        }

        return null;
    }


    /*
    ============================================================
    SEND
    ============================================================
    */

    send(
        connection,
        message
    ) {
        if (!connection) {
            return false;
        }

        const channel =
            connection.channel;

        if (
            !channel ||
            channel.readyState !==
            "open"
        ) {
            return false;
        }

        try {
            channel.send(message);
            return true;
        }
        catch (error) {
            console.error(
                "HostNetwork.send failed:",
                error
            );

            this.emit(
                "error",
                {
                    connection,
                    error
                }
            );

            return false;
        }
    }


    /*
    ============================================================
    SEND TO PLAYER
    ============================================================
    */

    sendToPlayer(
        playerId,
        message
    ) {
        const connection =
            this.findByPlayerId(
                playerId
            );

        if (!connection) {
            return false;
        }

        return this.send(
            connection,
            message
        );
    }


    /*
    ============================================================
    BROADCAST
    ============================================================
    */

    broadcast(
        message,
        exceptConnectionId = null
    ) {
        let sent = 0;

        for (
            const connection
            of this.connections.values()
        ) {
            if (
                connection.id ===
                exceptConnectionId
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


    /*
    ============================================================
    LOOKUP
    ============================================================
    */

    getConnection(
        connectionId
    ) {
        return (
            this.connections.get(
                connectionId
            ) ||
            null
        );
    }


    findByPlayerId(
        playerId
    ) {
        for (
            const connection
            of this.connections.values()
        ) {
            if (
                connection.playerId ===
                playerId
            ) {
                return connection;
            }
        }

        return null;
    }


    getConnections() {
        return [
            ...this.connections.values()
        ];
    }


    getConnectedConnections() {
        return this
            .getConnections()
            .filter(
                connection =>
                    connection.state ===
                    "connected"
            );
    }


    getConnectionCount() {
        return this.connections.size;
    }


    /*
    ============================================================
    ICE
    ============================================================
    */

    async addIceCandidate(
        connectionId,
        candidate
    ) {
        const connection =
            this.getConnection(
                connectionId
            );

        if (!connection) {
            throw new Error(
                "Connection not found."
            );
        }

        if (!candidate) {
            return;
        }

        await connection.pc
            .addIceCandidate(
                candidate
            );
    }


    /*
    ============================================================
    ICE GATHERING
    ============================================================
    */

    async waitForIceGathering(
        pc,
        timeout = 5000
    ) {
        if (
            pc.iceGatheringState ===
            "complete"
        ) {
            return;
        }

        await new Promise(
            resolve => {
                let finished = false;

                const finish =
                    () => {
                        if (finished) {
                            return;
                        }

                        finished = true;

                        clearTimeout(
                            timer
                        );

                        pc.removeEventListener(
                            "icegatheringstatechange",
                            check
                        );

                        resolve();
                    };

                const check =
                    () => {
                        if (
                            pc.iceGatheringState ===
                            "complete"
                        ) {
                            finish();
                        }
                    };

                const timer =
                    setTimeout(
                        finish,
                        timeout
                    );

                pc.addEventListener(
                    "icegatheringstatechange",
                    check
                );

                check();
            }
        );
    }


    /*
    ============================================================
    CONNECTION STATE
    ============================================================
    */

    handleConnectionState(
        connection
    ) {
        const state =
            connection.pc
                .connectionState;

        connection.state =
            state;

        this.emit(
            "connectionStateChange",
            {
                connection,
                state
            }
        );

        if (
            state === "failed" ||
            state === "closed"
        ) {
            this.removeConnection(
                connection
            );
        }
    }


    handleChannelClose(
        connection
    ) {
        this.removeConnection(
            connection
        );
    }


    /*
    ============================================================
    REMOVE CONNECTION
    ============================================================
    */

    removeConnection(
        connection
    ) {
        if (!connection) {
            return;
        }

        if (
            !this.connections.has(
                connection.id
            )
        ) {
            return;
        }

        this.connections.delete(
            connection.id
        );

        /*
         * Если игрок успел зарегистрироваться,
         * GameServer удалит его из мира.
         */
        if (
            connection.playerId
        ) {
            this.gameServer.disconnect(
                connection
            );
        }

        try {
            if (
                connection.channel &&
                connection.channel.readyState !==
                "closed"
            ) {
                connection.channel.close();
            }
        }
        catch {
            // Ignore.
        }

        try {
            if (
                connection.pc &&
                connection.pc.connectionState !==
                "closed"
            ) {
                connection.pc.close();
            }
        }
        catch {
            // Ignore.
        }

        connection.state =
            "closed";

        this.emit(
            "connectionRemoved",
            connection
        );
    }


    /*
    ============================================================
    CLOSE
    ============================================================
    */

    close() {
        const connections =
            this.getConnections();

        for (
            const connection
            of connections
        ) {
            this.removeConnection(
                connection
            );
        }

        this.connections.clear();
    }
}
