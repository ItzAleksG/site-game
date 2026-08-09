const RTC_CONFIG = {

    iceServers: [

        {
            urls:
                "stun:stun.l.google.com:19302"
        }

    ]

};


export class HostNetwork {

    constructor(gameServer) {

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

            playerId: null,

            state: "waiting"

        };


        this.connections.add(
            connection
        );


        /*
         * Передаём connection
         * игровому серверу.
         */

        this.gameServer
            .addConnection(
                connection
            );


        channel.onopen =
            () => {

                connection.state =
                    "connected";


                console.log(
                    "Player connected"
                );

            };


        channel.onclose =
            () => {

                connection.state =
                    "closed";

            };


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


    async acceptAnswer(answer) {

        /*
         * Ищем последнее соединение,
         * которому ещё не дали answer.
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
                "Нет ожидающего подключения. Создай новое приглашение."
            );

        }


        await pending.pc
            .setRemoteDescription(

                new RTCSessionDescription(
                    answer
                )

            );


        pending.state =
            "answer-received";

    }

}


function waitForIceGatheringComplete(pc) {

    if (
        pc.iceGatheringState ===
        "complete"
    ) {

        return Promise.resolve();

    }


    return new Promise(
        resolve => {

            const check = () => {

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

            };


            pc.addEventListener(
                "icegatheringstatechange",
                check
            );

        }
    );

}
