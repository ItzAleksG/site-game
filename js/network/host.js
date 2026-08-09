import {
    MESSAGE,
    makeMessage,
    parseMessage
} from "./protocol.js";


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
         */
        this.connections =
            new Map();


        /*
         * Каждое соединение получает
         * уникальный внутренний ID.
         */
        this.nextConnectionId =
            1;


        /*
         * Callbacks.
         */
        this.handlers =
            new Map();
    }


    /*
    ============================================================
    EVENT SYSTEM
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
                    `Error in "${event}" handler:`,
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
        /*
         * Для каждого нового игрока
         * создаём отдельный RTCPeerConnection.
         */
        const connection =
            this.createConnection();


        const channel =
            connection.pc.createDataChannel(
                "game"
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


        await this.waitForIceGathering(
            connection.pc
        );


        connection.state =
            "waiting-answer";


        this.emit(
            "inviteCreated",
            {
                connectionId:
                    connection.id,

                offer:
                    connection.pc
                        .localDescription
            }
        );


        return {
            connectionId:
                connection.id,

            offer: {
                type:
                    connection.pc
                        .localDescription
                        .type,

                sdp:
                    connection.pc
                        .localDescription
                        .sdp
            }
        };
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

            channel: null,

            playerId: null,

            state: "creating"
        };


        this.connections.set(
            id,
            connection
        );


        pc.onicecandidate =
            event => {

                if (
                    event.candidate
                ) {
                    this.emit(
                        "iceCandidate",
                        {
                            connectionId:
                                id,

                            candidate:
                                event.candidate
                        }
                    );
                }
            };


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
                            id,

                        state:
                            pc.iceConnectionState
                    }
                );
            };


        pc.ondatachannel =
            event => {

                /*
                 * Для HOST мы сами создаём
                 * DataChannel, поэтому обычно
                 * этот callback не используется.
                 */
                if (
                    !connection.channel
                ) {
                    connection.channel =
                        event.channel;

                    this.setupDataChannel(
                        connection
                    );
                }
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
            };


        channel.onmessage =
            event => {

                this.gameServer.receive(
                    connection,
                    event.data
                );
            };


        channel.onclose =
            () => {

                this.removeConnection(
                    connection
                );
            };


        channel.onerror =
            error => {

                console.error(
                    "Host data channel error:",
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
        const connection =
            connectionId
                ? this.connections.get(
                    connectionId
                )
                : this.findWaitingConnection();


        if (!connection) {
            throw new Error(
                "No waiting WebRTC connection found."
            );
        }


        if (
            connection.state !==
                "waiting-answer" &&
            connection.state !==
                "connecting"
        ) {
            throw new Error(
                "This connection is not waiting for an answer."
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
            connection
        );


        return connection;
    }


    /*
    ============================================================
    FIND WAITING CONNECTION
    ============================================================
    */

    findWaitingConnection() {
        /*
         * Ищем самое новое соединение,
         * которое ждёт Answer.
         */
        const connections =
            [...this.connections.values()]
                .reverse();


        return (
            connections.find(
                connection =>
                    connection.state ===
                    "waiting-answer"
            ) || null
        );
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


        await connection.pc
            .addIceCandidate(
                candidate
            );
    }


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


                const finish = () => {

                    if (finished) {
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


                const check = () => {

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
         * Если игрок уже успел
         * присоединиться, сообщаем
         * GameServer о disconnect.
         */
        if (connection.playerId) {

            this.gameServer.disconnect(
                connection
            );

        }


        try {
            connection.channel?.close();
        }
        catch {
            // Already closed.
        }


        try {
            connection.pc?.close();
        }
        catch {
            // Already closed.
        }


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


    /*
    ============================================================
    CLOSE
    ============================================================
    */

    close() {
        for (
            const connection
            of this.connections.values()
        ) {
            try {
                connection.channel?.close();
            }
            catch {
                // Already closed.
            }


            try {
                connection.pc?.close();
            }
            catch {
                // Already closed.
            }
        }


        this.connections.clear();
    }
}
