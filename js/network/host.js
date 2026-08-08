import {
    makeMessage,
    MESSAGE
} from "./protocol.js";


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
        gameServer
    ) {

        this.gameServer =
            gameServer;


        this.connections =
            new Set();

    }


    async createInvite() {

        const pc =
            new RTCPeerConnection(
                RTC_CONFIG
            );


        const channel =
            pc.createDataChannel(
                "game"
            );


        const connection = {

            pc,

            channel,

            playerId: null

        };


        this.connections.add(
            connection
        );


        channel.onopen =
            () => {

                console.log(
                    "Player connection opened"
                );

            };


        channel.onclose =
            () => {

                this.connections.delete(
                    connection
                );

            };


        this.gameServer
            .addConnection(
                connection
            );


        const offer =
            await pc.createOffer();


        await pc.setLocalDescription(
            offer
        );


        await waitForIceGatheringComplete(
            pc
        );


        return {

            type:
                pc.localDescription.type,

            sdp:
                pc.localDescription.sdp

        };

    }


    async acceptAnswer(
        answer
    ) {

        /*
         * Находим последнюю connection,
         * которая ещё не получила answer.
         */

        const pending =
            [...this.connections]
                .reverse()
                .find(
                    connection =>
                        !connection.pc
                            .remoteDescription
                );


        if (!pending) {

            throw new Error(
                "Нет ожидающего подключения"
            );

        }


        await pending.pc
            .setRemoteDescription(

                new RTCSessionDescription(
                    answer
                )

            );

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