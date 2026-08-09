import {
    MESSAGE,
    makeMessage,
    parseMessage
} from "./protocol.js";


export class ClientNetwork {
    constructor({
        iceServers = []
    } = {}) {
        this.iceServers =
            iceServers;

        this.pc = null;

        this.channel = null;

        this.playerId = null;

        this.roomCode = null;

        this.handlers = new Map();

        this.connected = false;

        this.remoteDescriptionSet =
            false;

        this.pendingCandidates = [];

        this.disconnectNotified =
            false;
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

        handlers.delete(handler);

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
    CONNECT
    ============================================================
    */

    async connect(offer) {
        this.close();

        this.disconnectNotified =
            false;

        this.remoteDescriptionSet =
            false;

        this.pendingCandidates = [];

        this.pc =
            new RTCPeerConnection({
                iceServers:
                    this.iceServers
            });


        this.setupPeerConnection();


        await this.pc.setRemoteDescription(
            new RTCSessionDescription(
                offer
            )
        );


        this.remoteDescriptionSet =
            true;


        await this.flushPendingCandidates();


        const answer =
            await this.pc.createAnswer();


        await this.pc.setLocalDescription(
            answer
        );


        await this.waitForIceGathering();


        return {
            type:
                this.pc.localDescription.type,

            sdp:
                this.pc.localDescription.sdp
        };
    }


    /*
    ============================================================
    PEER CONNECTION
    ============================================================
    */

    setupPeerConnection() {
        this.pc.ondatachannel =
            event => {

                const channel =
                    event.channel;

                this.setupDataChannel(
                    channel
                );
            };


        this.pc.onicecandidate =
            event => {

                if (
                    event.candidate
                ) {
                    this.emit(
                        "iceCandidate",
                        event.candidate
                    );
                }
            };


        this.pc.onconnectionstatechange =
            () => {

                this.handleConnectionState();
            };


        this.pc.oniceconnectionstatechange =
            () => {

                this.emit(
                    "iceConnectionStateChange",
                    this.pc.iceConnectionState
                );
            };
    }


    /*
    ============================================================
    DATA CHANNEL
    ============================================================
    */

    setupDataChannel(channel) {
        this.channel =
            channel;


        channel.binaryType =
            "arraybuffer";


        channel.onopen =
            () => {

                this.connected =
                    true;

                this.disconnectNotified =
                    false;

                this.emit(
                    "connected"
                );
            };


        channel.onmessage =
            event => {

                this.handleMessage(
                    event.data
                );
            };


        channel.onclose =
            () => {

                this.handleDisconnect();
            };


        channel.onerror =
            error => {

                console.error(
                    "Data channel error:",
                    error
                );

                this.emit(
                    "error",
                    error
                );
            };
    }


    /*
    ============================================================
    MESSAGES
    ============================================================
    */

    handleMessage(raw) {
        const message =
            parseMessage(raw);

        if (!message) {
            return;
        }


        if (
            message.type ===
            MESSAGE.WELCOME
        ) {
            this.playerId =
                message.playerId;

            this.roomCode =
                message.roomCode;
        }


        this.emit(
            message.type,
            message
        );


        this.emit(
            "message",
            message
        );
    }


    /*
    ============================================================
    JOIN
    ============================================================
    */

    join(name) {
        this.send(
            makeMessage(
                MESSAGE.JOIN,
                {
                    name
                }
            )
        );
    }


    /*
    ============================================================
    INPUT
    ============================================================
    */

    move(dx, dy) {
        this.send(
            makeMessage(
                MESSAGE.INPUT,
                {
                    action:
                        "move",

                    dx,

                    dy
                }
            )
        );
    }


    sendInput(input) {
        this.send(
            makeMessage(
                MESSAGE.INPUT,
                input
            )
        );
    }


    /*
    ============================================================
    SEND
    ============================================================
    */

    send(message) {
        if (
            !this.channel ||
            this.channel.readyState !==
                "open"
        ) {
            return false;
        }


        try {
            this.channel.send(
                message
            );

            return true;
        }
        catch (error) {
            console.error(
                "Failed to send message:",
                error
            );

            return false;
        }
    }


    /*
    ============================================================
    CONNECTION STATE
    ============================================================
    */

    handleConnectionState() {
        if (!this.pc) {
            return;
        }


        const state =
            this.pc.connectionState;


        this.emit(
            "connectionStateChange",
            state
        );


        if (
            state === "connected"
        ) {
            return;
        }


        if (
            state === "failed" ||
            state === "disconnected" ||
            state === "closed"
        ) {
            this.handleDisconnect();
        }
    }


    handleDisconnect() {
        if (
            this.disconnectNotified
        ) {
            return;
        }


        this.disconnectNotified =
            true;

        this.connected =
            false;


        this.emit(
            "disconnected"
        );
    }


    /*
    ============================================================
    ICE
    ============================================================
    */

    async waitForIceGathering(
        timeout = 5000
    ) {
        if (!this.pc) {
            return;
        }


        if (
            this.pc.iceGatheringState ===
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

                    this.pc.removeEventListener(
                        "icegatheringstatechange",
                        check
                    );

                    resolve();
                };


                const check = () => {

                    if (
                        this.pc
                            .iceGatheringState ===
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


                this.pc.addEventListener(
                    "icegatheringstatechange",
                    check
                );


                check();
            }
        );
    }


    async addIceCandidate(
        candidate
    ) {
        if (!this.pc) {
            return;
        }


        if (
            !this.remoteDescriptionSet
        ) {
            this.pendingCandidates.push(
                candidate
            );

            return;
        }


        try {
            await this.pc.addIceCandidate(
                candidate
            );
        }
        catch (error) {
            console.error(
                "Failed to add ICE candidate:",
                error
            );
        }
    }


    async flushPendingCandidates() {
        if (
            !this.pc ||
            !this.remoteDescriptionSet
        ) {
            return;
        }


        const candidates =
            this.pendingCandidates;


        this.pendingCandidates =
            [];


        for (
            const candidate
            of candidates
        ) {
            await this.addIceCandidate(
                candidate
            );
        }
    }


    /*
    ============================================================
    CLOSE
    ============================================================
    */

    close() {
        this.connected =
            false;

        this.playerId =
            null;

        this.roomCode =
            null;

        this.remoteDescriptionSet =
            false;

        this.pendingCandidates =
            [];


        if (this.channel) {
            try {
                this.channel.close();
            }
            catch {
                // Already closed.
            }
        }


        if (this.pc) {
            try {
                this.pc.close();
            }
            catch {
                // Already closed.
            }
        }


        this.channel =
            null;

        this.pc =
            null;
    }
}
