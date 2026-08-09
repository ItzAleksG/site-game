import {
    MESSAGE,
    makeMessage
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

    constructor() {

        this.pc =
            null;


        this.channel =
            null;


        this.playerId =
            null;


        this.handlers = {};

    }


    on(
        type,
        callback
    ) {

        this.handlers[
            type
        ] = callback;

    }


    emit(
        type,
        data
    ) {

        const handler =
            this.handlers[
                type
            ];


        if (handler) {

            handler(data);

        }

    }


    async connect(
        offer
    ) {

        this.pc =
            new RTCPeerConnection(
                RTC_CONFIG
            );


        this.pc.ondatachannel =
            event => {

                this.channel =
                    event.channel;


                this.setupChannel();

            };


        await this.pc
            .setRemoteDescription(

                new RTCSessionDescription(
                    offer
                )

            );


        const answer =
            await this.pc.createAnswer();


        await this.pc
            .setLocalDescription(
                answer
            );


        await waitForIceGatheringComplete(
            this.pc
        );


        return {

            type:
                this.pc.localDescription.type,

            sdp:
                this.pc.localDescription.sdp

        };

    }


    setupChannel() {

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

    }


    handleMessage(raw) {

    let message;


    try {

        message =
            JSON.parse(raw);

    }
    catch {

        return;

    }


    this.emit(
        message.type,
        message
    );

}


    send(
        message
    ) {

        if (
            !this.channel ||
            this.channel.readyState !==
            "open"
        ) {

            return false;

        }


        this.channel.send(
            makeMessage(
                message.type,
                message.data || {}
            )
        );


        return true;

    }


    join(
        name
    ) {

        this.send({

            type:
                MESSAGE.JOIN,

            data: {

                name

            }

        });

    }


    move(
        dx,
        dy
    ) {

        this.send({

            type:
                MESSAGE.INPUT,

            data: {

                action:
                    "move",

                dx,

                dy

            }

        });

    }


    chat(
        text
    ) {

        this.send({

            type:
                MESSAGE.CHAT,

            data: {

                text

            }

        });

    }

}


function waitForIceGatheringComplete(
    pc
) {

    if (
        pc.iceGatheringState ===
        "complete"
    ) {

        return Promise.resolve();

    }


    return new Promise(
        resolve => {

            function check() {

                if (
                    pc.iceGatheringState ===
                    "complete"
                ) {

                    pc.removeEventListener(
                        "icegatheringstatechange",
                        check
                    );


                    resolve();

                }

            }


            pc.addEventListener(
                "icegatheringstatechange",
                check
            );

        }
    );

}
