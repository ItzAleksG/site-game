export class HostNetwork {
    constructor(
        gameServer,
        {
            iceServers = []
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
         * Все WebRTC-соединения HOST.
         *
         * connectionId -> connection
         */
        this.connections =
            new Map();

        this.nextConnectionId =
            1;

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
            throw new Error(
                "Handler must be a function."
            );
        }

        if (
            !this.handlers.has(event)
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
            this.handlers.get(event);

        if (!handlers) {
            return;
        }

        handlers.delete(
            handler
        );

        if (
            handlers.size === 0
        ) {
            this.handlers.delete(
                event
            );
        }
    }


    emit(event, data) {
        const handlers =
            this.handlers.get(event);

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


        /*
         * HOST создаёт DataChannel.
         *
         * Именно этот канал будет использоваться
         * для всех игровых сообщений.
         */
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
            await connection.pc.createOffer();


        await connection.pc.setLocalDescription(
            offer
        );


        /*
         * Дожидаемся ICE candidates,
         * чтобы можно было передать
         * полностью готовый SDP.
         */
        await this.waitForIceGathering(
            connection.pc
        );


        connection.state =
            "waiting-answer";


        const localDescription =
            connection.pc
                .localDescription;


        const invite = {
            connectionId:
                connection.id,

            offer: {
                type:
                    localDescription.type,

                sdp:
                    localDescription.sdp
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


        /*
        --------------------------------------------------------
        ICE
        --------------------------------------------------------
        */

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
        --------------------------------------------------------
        CONNECTION STATE
        --------------------------------------------------------
        */

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


        /*
         * Мы сами создаём DataChannel,
         * поэтому ondatachannel здесь
         * является защитным механизмом.
         */
        pc.ondatachannel =
            event => {
                if (
                    connection.channel
                ) {
                    /*
                     * Если второй канал каким-то образом
                     * появился, закрываем его.
                     */
                    try {
                        event.channel.close();
                    }
                    catch {
                        // Already closed.
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


        /*
         * Не устанавливаем никаких
         * GameServer-обработчиков напрямую
         * поверх канала кроме этого одного.
         */
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
                 * ЕДИНСТВЕННАЯ точка входа
                 * сообщений игрока.
                 *
                 * HostNetwork передаёт
                 * сообщение авторитетному
                 * GameServer.
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
    GAME SERVER -> PLAYER
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
            channel.send(
                message
            );

            return true;
        }
        catch (error) {
            console.error(
                "Failed to send WebRTC message:",
                error
            );

            return false;
        }
    }


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


    broadcast(
        message,
        exceptConnectionId = null
    ) {
        let sent =
            0;


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
    ACCEPT ANSWER
    ============================================================
    */

    async acceptAnswer(
        answer,
        connectionId = null
    ) {
        const connection =
            connectionId
                ? this.connections.get(
                    connectionId
                )
                : this.findWaitingConnection();


        if (!connection) {
            throw new Error(
                "No WebRTC connection found."
            );
        }


        if (
            connection.state !==
                "waiting-answer" &&
            connection.state !==
                "connecting"
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


        await connection.pc.setRemoteDescription(
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
            ]
                .reverse();


        return (
            connections.find(
                connection =>
                    connection.state ===
                    "waiting-answer"
            ) ||
            null
        );
    }


    /*
    ============================================================
    FIND CONNECTION
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
            this.connections.get(
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


        try {
            await connection.pc.addIceCandidate(
                candidate
            );
        }
        catch (error) {
            console.error(
                "Failed to add ICE candidate:",
                error
            );


            this.emit(
                "error",
                {
                    connection,
                    error
                }
            );
        }
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
                let finished =
                    false;


                const finish =
                    () => {
                        if (
                            finished
                        ) {
                            return;
                        }


                        finished =
                            true;


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
        if (
            !connection ||
            !connection.pc
        ) {
            return;
        }


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


    /*
    ============================================================
    CHANNEL CLOSE
    ============================================================
    */

    handleChannelClose(
        connection
    ) {
        if (!connection) {
            return;
        }


        /*
         * Если канал закрылся, игрок больше
         * не может отправлять INPUT.
         *
         * Удаляем connection.
         */
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
         * Если GameServer уже знает
         * playerId, сообщаем ему
         * о выходе игрока.
         */
        if (
            connection.playerId
        ) {
            try {
                this.gameServer.disconnect(
                    connection
                );
            }
            catch (error) {
                console.error(
                    "GameServer disconnect failed:",
                    error
                );
            }
        }


        /*
         * Закрываем канал.
         */
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
            // Already closed.
        }


        /*
         * Закрываем PeerConnection.
         */
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
            // Already closed.
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
    CONNECTION LIST
    ============================================================
    */

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
    CLOSE EVERYTHING
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
