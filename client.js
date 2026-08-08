let peerConnection = null;
let dataChannel = null;

let playerId = null;

let players = {};


/*
============================================================
CONFIG
============================================================
*/

const ROOM_PAGE =
    window.location.origin +
    window.location.pathname;


/*
============================================================
UI
============================================================
*/

const statusElement =
    document.getElementById("status");

const connectButton =
    document.getElementById("connectButton");

const answerContainer =
    document.getElementById("answerContainer");

const answerLink =
    document.getElementById("answerLink");

const playerIdElement =
    document.getElementById("playerId");

const messagesElement =
    document.getElementById("messages");


function log(text) {

    console.log(text);

    const element =
        document.createElement("div");

    element.textContent = text;

    messagesElement.appendChild(
        element
    );
}


function setStatus(text) {

    statusElement.textContent =
        text;
}


/*
============================================================
BASE64URL
============================================================
*/

/*
 * SDP содержит Unicode/служебные символы,
 * поэтому сначала превращаем его в UTF-8,
 * потом Base64URL.
 */


function encodeData(data) {

    const bytes =
        new TextEncoder().encode(
            JSON.stringify(data)
        );


    let binary = "";

    for (
        const byte of bytes
    ) {

        binary +=
            String.fromCharCode(
                byte
            );

    }


    return btoa(binary)
        .replace(/\+/g, "-")
        .replace(/\//g, "_")
        .replace(/=+$/, "");
}


function decodeData(encoded) {

    encoded =
        encoded
            .replace(/-/g, "+")
            .replace(/_/g, "/");


    while (
        encoded.length % 4
    ) {

        encoded += "=";

    }


    const binary =
        atob(encoded);


    const bytes =
        new Uint8Array(
            binary.length
        );


    for (
        let i = 0;
        i < binary.length;
        i++
    ) {

        bytes[i] =
            binary.charCodeAt(i);

    }


    const json =
        new TextDecoder().decode(
            bytes
        );


    return JSON.parse(json);
}


/*
============================================================
READ OFFER FROM URL
============================================================
*/


function getOfferFromURL() {

    const hash =
        window.location.hash;


    if (!hash) {
        return null;
    }


    const params =
        new URLSearchParams(
            hash.substring(1)
        );


    const offer =
        params.get("offer");


    if (!offer) {
        return null;
    }


    return decodeData(
        offer
    );
}


/*
============================================================
CREATE ANSWER
============================================================
*/


async function connectToServer() {

    const offer =
        getOfferFromURL();


    if (!offer) {

        setStatus(
            "В URL нет приглашения в комнату."
        );

        return;

    }


    setStatus(
        "Создание WebRTC соединения..."
    );


    peerConnection =
        new RTCPeerConnection();


    /*
    --------------------------------------------------------
    Connection state
    --------------------------------------------------------
    */

    peerConnection
        .onconnectionstatechange =
        () => {

            const state =
                peerConnection
                    .connectionState;


            setStatus(
                "Connection: " +
                state
            );


            log(
                "Connection: " +
                state
            );

        };


    /*
    --------------------------------------------------------
    ICE
    --------------------------------------------------------
    */

    peerConnection
        .oniceconnectionstatechange =
        () => {

            log(
                "ICE: " +
                peerConnection
                    .iceConnectionState
            );

        };


    /*
    --------------------------------------------------------
    DATA CHANNEL
    --------------------------------------------------------
    */

    peerConnection
        .ondatachannel =
        event => {

            dataChannel =
                event.channel;


            log(
                "DataChannel received: " +
                dataChannel.label
            );


            dataChannel.onopen =
                () => {

                    log(
                        "DataChannel OPEN"
                    );

                    setStatus(
                        "Connected"
                    );

                };


            dataChannel.onclose =
                () => {

                    log(
                        "DataChannel CLOSED"
                    );

                    setStatus(
                        "Disconnected"
                    );

                };


            dataChannel.onmessage =
                event => {

                    handleServerMessage(
                        event.data
                    );

                };

        };


    /*
    --------------------------------------------------------
    SET OFFER
    --------------------------------------------------------
    */

    await peerConnection
        .setRemoteDescription(
            new RTCSessionDescription(
                offer
            )
        );


    /*
    --------------------------------------------------------
    CREATE ANSWER
    --------------------------------------------------------
    */

    const answer =
        await peerConnection
            .createAnswer();


    await peerConnection
        .setLocalDescription(
            answer
        );


    /*
    --------------------------------------------------------
    WAIT FOR ICE
    --------------------------------------------------------
    */

    await waitForIceGatheringComplete(
        peerConnection
    );


    /*
    --------------------------------------------------------
    CREATE ANSWER LINK
    --------------------------------------------------------
    */

    const answerData = {

        type:
            peerConnection
                .localDescription
                .type,

        sdp:
            peerConnection
                .localDescription
                .sdp

    };


    const encoded =
        encodeData(
            answerData
        );


    const link =
        ROOM_PAGE +
        "#answer=" +
        encoded;


    answerLink.value =
        link;


    answerContainer.style.display =
        "block";


    setStatus(
        "Answer готов. Отправь ссылку хосту."
    );


    log(
        "Answer link created."
    );
}


/*
============================================================
ICE WAIT
============================================================
*/


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


/*
============================================================
SERVER MESSAGES
============================================================
*/


function handleServerMessage(
    raw
) {

    let message;


    try {

        message =
            JSON.parse(
                raw
            );

    }
    catch {

        log(
            "Invalid server message"
        );

        return;

    }


    console.log(
        "SERVER:",
        message
    );


    /*
    --------------------------------------------------------
    WELCOME
    --------------------------------------------------------
    */

    if (
        message.type ===
        "welcome"
    ) {

        playerId =
            message.player_id;


        playerIdElement
            .textContent =
            playerId;


        players =
            message.players;


        renderPlayers();


        log(
            "You are " +
            playerId
        );


        return;
    }


    /*
    --------------------------------------------------------
    PLAYER JOINED
    --------------------------------------------------------
    */

    if (
        message.type ===
        "player_joined"
    ) {

        players[
            message.player.id
        ] =
            message.player;


        renderPlayers();


        log(
            message.player.name +
            " joined."
        );


        return;
    }


    /*
    --------------------------------------------------------
    PLAYER LEFT
    --------------------------------------------------------
    */

    if (
        message.type ===
        "player_left"
    ) {

        delete players[
            message.player_id
        ];


        renderPlayers();


        log(
            message.player_id +
            " left."
        );


        return;
    }


    /*
    --------------------------------------------------------
    STATE
    --------------------------------------------------------
    */

    if (
        message.type ===
        "state"
    ) {

        players =
            message.players;


        renderPlayers();


        return;
    }


    /*
    --------------------------------------------------------
    CHAT
    --------------------------------------------------------
    */

    if (
        message.type ===
        "chat"
    ) {

        log(
            "[" +
            message.player_id +
            "] " +
            message.text
        );

        return;
    }

}


/*
============================================================
SEND MESSAGE
============================================================
*/


function send(message) {

    if (
        !dataChannel ||
        dataChannel.readyState !==
        "open"
    ) {

        log(
            "DataChannel is not open."
        );

        return;

    }


    dataChannel.send(
        JSON.stringify(
            message
        )
    );
}


/*
============================================================
CHAT
============================================================
*/


function sendChat() {

    const input =
        document.getElementById(
            "chatInput"
        );


    const text =
        input.value.trim();


    if (!text) {
        return;
    }


    send({

        type: "chat",

        text: text

    });


    input.value = "";

}


/*
============================================================
RENDER
============================================================
*/


function renderPlayers() {

    const game =
        document.getElementById(
            "game"
        );


    game.innerHTML = "";


    for (
        const id in players
    ) {

        const player =
            players[id];


        const element =
            document.createElement(
                "div"
            );


        element.className =
            "player";


        element.style.left =
            player.x + "px";


        element.style.top =
            player.y + "px";


        element.title =
            player.name;


        game.appendChild(
            element
        );

    }
}


/*
============================================================
MOVE
============================================================
*/


function move(dx, dy) {

    if (!playerId) {
        return;
    }


    const player =
        players[playerId];


    if (!player) {
        return;
    }


    send({

        type: "move",

        x: player.x + dx,

        y: player.y + dy

    });

}


/*
============================================================
KEYBOARD
============================================================
*/


document.addEventListener(
    "keydown",
    event => {

        let dx = 0;
        let dy = 0;


        if (
            event.key === "ArrowUp" ||
            event.key === "w"
        ) {

            dy = -10;

        }


        if (
            event.key === "ArrowDown" ||
            event.key === "s"
        ) {

            dy = 10;

        }


        if (
            event.key === "ArrowLeft" ||
            event.key === "a"
        ) {

            dx = -10;

        }


        if (
            event.key === "ArrowRight" ||
            event.key === "d"
        ) {

            dx = 10;

        }


        if (
            dx !== 0 ||
            dy !== 0
        ) {

            event.preventDefault();

            move(
                dx,
                dy
            );

        }

    }
);


/*
============================================================
BUTTONS
============================================================
*/


connectButton.onclick =
    connectToServer;


document.getElementById(
    "chatButton"
).onclick =
    sendChat;