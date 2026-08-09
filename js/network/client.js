import {
    MESSAGE,
    makeMessage,
    parseMessage
} from "./protocol.js";


const RTC_CONFIG = {
    iceServers: [
        {
            urls:
                "stun:stun.l.google.com:19302"
        }
    ]
};


export class ClientNetwork {
    constructor(
        {
            iceServers =
                RTC_CONFIG.iceServers
        } = {}
    ) {
        this.iceServers =
            iceServers;


        this.pc =
            null;


        this.channel =
            null;


        this.playerId =
            null;


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

    on(
        event,
        handler
    ) {
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


    off(
        event,
        handler
    ) {
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


    emit(
        event,
        data
    ) {
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
                    `ClientNetwork "${event}" handler failed:`,
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

    async connect(
        offer
    ) {
        if (
            this.pc
        ) {
            this.close();
        }


        if (
            !offer ||
            typeof offer !==
                "object"
        ) {
            throw new Error(
                "Invalid WebRTC offer."
            );
        }


        this.pc =
            new RTCPeerConnection({
                iceServers:
                    this.iceServers
            });


        /*
        --------------------------------------------------------
        CONNECTION STATE
        --------------------------------------------------------
        */

        this.pc.onconnectionstatechange =
            () => {
                const state =
                    this.pc
                        .connectionState;


                this.emit(
                    "connectionStateChange",
                    state
                );


                if (
                    state ===
                        "failed" ||
                    state ===
                        "closed"
                ) {
                    this.emit(
                        "disconnected"
                    );
                }
            };


        /*
        --------------------------------------------------------
        ICE
        --------------------------------------------------------
        */

        this.pc.onicecandidate =
            event => {
                if (
                    !event.candidate
                ) {
                    return;
                }


                this.emit(
                    "iceCandidate",
                    event.candidate
                );
            };


        /*
        --------------------------------------------------------
        DATA CHANNEL
        --------------------------------------------------------
        */

        this.pc.ondatachannel =
            event => {
                /*
                 * У нас должен быть
                 * только один игровой канал.
                 */
                if (
                    this.channel
                ) {
                    try {
                        event.channel.close();
                    }
                    catch {
                        // Ignore.
                    }

                    return;
                }


                this.channel =
                    event.channel;


                this.setupChannel();
            };


        /*
        --------------------------------------------------------
        REMOTE OFFER
        --------------------------------------------------------
        */

        await this.pc
            .setRemoteDescription(
                new RTCSessionDescription(
                    offer
                )
            );


        /*
        --------------------------------------------------------
        ANSWER
        --------------------------------------------------------
        */

        const answer =
            await this.pc
                .createAnswer();


        await this.pc
            .setLocalDescription(
                answer
            );


        /*
        --------------------------------------------------------
        ICE GATHERING
        --------------------------------------------------------
        */

        await waitForIceGatheringComplete(
            this.pc
        );


        const description =
            this.pc.localDescription;


        return {
            type:
                description.type,

            sdp:
                description.sdp
        };
    }


    /*
    ============================================================
    DATA CHANNEL
    ============================================================
    */

    setupChannel() {
        if (!this.channel) {
            return;
        }


        this.channel.binaryType =
            "arraybuffer";


        this.channel.onopen =
            () => {
                this.emit(
                    "connected"
                );
            };


        this.channel.onmessage =
            event => {
                this.handleMessage(
                    event.data
                );
            };


        this.channel.onclose =
            () => {
                this.emit(
                    "disconnected"
                );
            };


        this.channel.onerror =
            error => {
                console.error(
                    "Client DataChannel error:",
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
    MESSAGE
    ============================================================
    */

    handleMessage(
        raw
    ) {
        const message =
            parseMessage(
                raw
            );


        if (!message) {
            this.emit(
                "error",
                new Error(
                    "Received invalid server message."
                )
            );

            return;
        }


        /*
         * Сохраняем playerId,
         * когда сервер присылает WELCOME.
         */
        if (
            message.type ===
            MESSAGE.WELCOME
        ) {
            this.playerId =
                message.playerId;
        }


        /*
         * Событие по конкретному
         * типу сообщения.
         */
        this.emit(
            message.type,
            message
        );


        /*
         * Универсальное событие.
         */
        this.emit(
            "message",
            message
        );
    }


    /*
    ============================================================
    SEND
    ============================================================
    */

    sendMessage(
        type,
        data = {}
    ) {
        if (
            !this.channel ||
            this.channel.readyState !==
                "open"
        ) {
            return false;
        }


        try {
            this.channel.send(
                makeMessage(
                    type,
                    data
                )
            );


            return true;
        }
        catch (error) {
            console.error(
                "ClientNetwork.sendMessage failed:",
                error
            );


            this.emit(
                "error",
                error
            );


            return false;
        }
    }


    /*
    ============================================================
    JOIN
    ============================================================
    */

    join(
        name
    ) {
        return this.sendMessage(
            MESSAGE.JOIN,
            {
                name:
                    sanitizeName(
                        name
                    )
            }
        );
    }


    /*
    ============================================================
    MOVEMENT
    ============================================================
    */

    move(
        dx,
        dy
    ) {
        return this.sendMessage(
            MESSAGE.INPUT,
            {
                action:
                    "move",

                dx:
                    normalizeDirection(
                        dx
                    ),

                dy:
                    normalizeDirection(
                        dy
                    )
            }
        );
    }


    /*
    ============================================================
    PING
    ============================================================
    */

    ping() {
        return this.sendMessage(
            MESSAGE.PING,
            {
                time:
                    Date.now()
            }
        );
    }


    /*
    ============================================================
    CLOSE
    ============================================================
    */

    close() {
        if (
            this.channel
        ) {
            try {
                this.channel.close();
            }
            catch {
                // Ignore.
            }
        }


        if (
            this.pc
        ) {
            try {
                this.pc.close();
            }
            catch {
                // Ignore.
            }
        }


        this.channel =
            null;


        this.pc =
            null;


        this.playerId =
            null;
    }
}


/*
============================================================
HELPERS
============================================================
*/

function sanitizeName(
    name
) {
    const value =
        String(
            name ?? ""
        )
        .trim()
        .replace(
            /\s+/g,
            " "
        )
        .slice(
            0,
            24
        );


    return (
        value ||
        "Player"
    );
}


function normalizeDirection(
    value
) {
    const number =
        Number(value);


    if (
        !Number.isFinite(
            number
        )
    ) {
        return 0;
    }


    if (
        number > 0
    ) {
        return 1;
    }


    if (
        number < 0
    ) {
        return -1;
    }


    return 0;
}


function waitForIceGatheringComplete(
    pc,
    timeout = 5000
) {
    if (
        pc.iceGatheringState ===
        "complete"
    ) {
        return Promise.resolve();
    }


    return new Promise(
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
