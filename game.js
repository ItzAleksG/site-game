"use strict";


/*
============================================================
CONFIG
============================================================
*/


const RTC_CONFIG = {

    /*
     * STUN нужен, чтобы WebRTC мог попытаться
     * установить соединение через NAT.
     *
     * Это НЕ сервер игры.
     */

    iceServers: [

        {
            urls:
                "stun:stun.l.google.com:19302"
        }

    ]

};


/*
============================================================
GLOBAL STATE
============================================================
*/


let mode = null;

let myId = null;

let roomId = null;


/*
 * Только для HOST.
 *
 * playerId -> {
 *     pc,
 *     channel,
 *     player
 * }
 */

const connections = {};


/*
 * Состояние игры.
 *
 * На HOST это authoritative state.
 *
 * На CLIENT это локальная копия.
 */

let players = {};


/*
============================================================
UTILITIES
============================================================
*/


function randomId(length = 8) {

    const chars =
        "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";


    let result = "";


    for (
        let i = 0;
        i < length;
        i++
    ) {

        result +=
            chars[
                Math.floor(
                    Math.random() *
                    chars.length
                )
            ];

    }


    return result;
}


/*
============================================================
BASE64URL
============================================================
*/


function encodeData(data) {

    const json =
        JSON.stringify(data);


    const bytes =
        new TextEncoder()
            .encode(json);


    let binary = "";


    for (
        const byte of bytes
    ) {

        binary +=
            String.fromCharCode(byte);

    }


    return btoa(binary)
        .replace(/\+/g, "-")
        .replace(/\//g, "_")
        .replace(/=/g, "");
}


function decodeData(data) {

    data =
        data
            .replace(/-/g, "+")
            .replace(/_/g, "/");


    while (
        data.length % 4
    ) {

        data += "=";

    }


    const binary =
        atob(data);


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
        new TextDecoder()
            .decode(bytes);


    return JSON.parse(json);
}


/*
============================================================
URL HASH
============================================================
*/


function getHashParameter(name) {

    const hash =
        window.location.hash;


    if (!hash) {
        return null;
    }


    const params =
        new URLSearchParams(
            hash.substring(1)
        );


    return params.get(name);
}


/*
============================================================
ICE
============================================================
*/


function waitForIceGatheringComplete(pc) {

    if (
        pc.iceGatheringState ===
        "complete"
    ) {

        return Promise.resolve();

    }


    return new Promise(resolve => {

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

    });

}


/*
============================================================
UI
============================================================
*/


function show(id) {

    document
        .getElementById(id)
        .classList
        .remove("hidden");

}


function hide(id) {

    document
        .getElementById(id)
        .classList
        .add("hidden");

}


function logChat(text) {

    const element =
        document.createElement("div");


    element.textContent =
        text;


    document
        .getElementById("chat")
        .appendChild(element);

}


/*
============================================================
HOST MODE
============================================================
*/


function startHost() {

    mode = "host";


    roomId =
        randomId(8);


    myId =
        "HOST";


    /*
     * Сам хост тоже является игроком.
     */

    players = {

        [myId]: {

            id: myId,

            name: "Host",

            x: 100,

            y: 100

        }

    };


    document
        .getElementById("roomId")
        .textContent =
        roomId;


    document
        .getElementById("myId")
        .textContent =
        myId;


    hide("modeSelect");

    show("hostPanel");

    show("gamePanel");


    renderGame();

    renderPlayersList();


    logChat(
        "Комната создана: " +
        roomId
    );

}


/*
============================================================
CREATE PLAYER CONNECTION
============================================================
*/


async function createInvite() {

    if (mode !== "host") {
        return;
    }


    const pc =
        new RTCPeerConnection(
            RTC_CONFIG
        );


    /*
     * Хост создаёт DataChannel.
     *
     * Поэтому CLIENT получит его через
     * ondatachannel.
     */

    const channel =
        pc.createDataChannel(
            "game"
        );


    /*
     * Временно используем connection ID.
     *
     * Настоящий player ID будет назначен
     * после подключения.
     */

    const connectionId =
        "C-" +
        randomId(6);


    connections[
        connectionId
    ] = {

        pc,

        channel,

        playerId: null

    };


    channel.onopen =
        () => {

            console.log(
                "Channel opened:",
                connectionId
            );

        };


    channel.onmessage =
        event => {

            handleHostMessage(
                connectionId,
                event.data
            );

        };


    channel.onclose =
        () => {

            handleHostDisconnect(
                connectionId
            );

        };


    pc.onconnectionstatechange =
        () => {

            console.log(
                "Connection:",
                connectionId,
                pc.connectionState
            );


            if (
                pc.connectionState ===
                "failed"
            ) {

                handleHostDisconnect(
                    connectionId
                );

            }

        };


    /*
     * CREATE OFFER
     */

    const offer =
        await pc.createOffer();


    await pc.setLocalDescription(
        offer
    );


    /*
     * Ждём ICE.
     */

    await waitForIceGatheringComplete(
        pc
    );


    const offerData = {

        type:
            pc.localDescription.type,

        sdp:
            pc.localDescription.sdp

    };


    const encoded =
        encodeData(
            offerData
        );


    /*
     * Ссылка содержит Offer.
     *
     * Это наш signaling без сервера.
     */

    const link =
        window.location.origin +
        window.location.pathname +
        "#offer=" +
        encoded;


    document
        .getElementById("inviteLink")
        .value =
        link;


    logChat(
        "Новое приглашение создано."
    );

}


/*
============================================================
HOST ACCEPTS ANSWER
============================================================
*/


async function acceptAnswer() {

    const text =
        document
            .getElementById("answerInput")
            .value
            .trim();


    if (!text) {

        alert(
            "Вставь ссылку ответа."
        );

        return;

    }


    const encoded =
        extractHashParameter(
            text,
            "answer"
        );


    if (!encoded) {

        alert(
            "Это не ссылка с answer."
        );

        return;

    }


    let answer;


    try {

        answer =
            decodeData(encoded);

    }
    catch (error) {

        alert(
            "Не удалось прочитать answer."
        );

        console.error(error);

        return;

    }


    /*
     * Найдём последнее соединение,
     * ожидающее answer.
     */

    const waiting =
        Object.entries(
            connections
        ).reverse()
        .find(
            ([id, connection]) =>
                connection.playerId === null
        );


    if (!waiting) {

        alert(
            "Нет соединения, ожидающего answer. " +
            "Сначала создай приглашение."
        );

        return;

    }


    const [
        connectionId,
        connection
    ] = waiting;


    await connection.pc
        .setRemoteDescription(

            new RTCSessionDescription(
                answer
            )

        );


    logChat(
        "Answer принят. Ожидаем игрока..."
    );


    document
        .getElementById("answerInput")
        .value = "";

}


/*
============================================================
EXTRACT PARAMETER
============================================================
*/


function extractHashParameter(
    url,
    name
) {

    try {

        const hash =
            url.split("#")[1];


        if (!hash) {
            return null;
        }


        const params =
            new URLSearchParams(
                hash
            );


        return params.get(name);

    }
    catch {

        return null;

    }

}


/*
============================================================
HOST MESSAGE
============================================================
*/


function handleHostMessage(
    connectionId,
    raw
) {

    let message;


    try {

        message =
            JSON.parse(raw);

    }
    catch {

        console.error(
            "Invalid client message:",
            raw
        );

        return;

    }


    const connection =
        connections[
            connectionId
        ];


    if (!connection) {
        return;
    }


    /*
     * --------------------------------------------------------
     * JOIN
     * --------------------------------------------------------
     *
     * Первый пакет клиента:
     *
     * {
     *     type: "join",
     *     name: "Player"
     * }
     *
     */

    if (
        message.type ===
        "join"
    ) {

        const playerId =
            "P-" +
            randomId(6);


        connection.playerId =
            playerId;


        players[playerId] = {

            id:
                playerId,

            name:
                sanitizeName(
                    message.name
                ),

            x:
                250,

            y:
                100

        };


        /*
         * Отправляем новому игроку
         * полное состояние мира.
         */

        sendToConnection(

            connection,

            {

                type:
                    "welcome",

                playerId:

                    playerId,

                roomId:

                    roomId,

                players:

                    players

            }

        );


        /*
         * Всем игрокам сообщаем,
         * что новый игрок вошёл.
         */

        broadcast(

            {

                type:
                    "state",

                players:
                    players

            }

        );


        renderGame();

        renderPlayersList();


        logChat(
            message.name +
            " joined the game."
        );


        updatePlayerCount();


        return;

    }


    /*
     * --------------------------------------------------------
     * MOVE
     * --------------------------------------------------------
     */

    if (
        message.type ===
        "move"
    ) {

        const playerId =
            connection.playerId;


        if (!playerId) {
            return;
        }


        const player =
            players[playerId];


        if (!player) {
            return;
        }


        let x =
            Number(message.x);


        let y =
            Number(message.y);


        if (
            !Number.isFinite(x) ||
            !Number.isFinite(y)
        ) {

            return;

        }


        /*
         * SERVER AUTHORITATIVE VALIDATION
         *
         * Пока просто ограничиваем мир.
         */

        x =
            Math.max(
                0,
                Math.min(
                    700,
                    x
                )
            );


        y =
            Math.max(
                0,
                Math.min(
                    450,
                    y
                )
            );


        player.x = x;

        player.y = y;


        /*
         * Отправляем authoritative state
         * всем клиентам.
         */

        broadcast({

            type:
                "state",

            players:
                players

        });


        renderGame();


        return;

    }


    /*
     * --------------------------------------------------------
     * CHAT
     * --------------------------------------------------------
     */

    if (
        message.type ===
        "chat"
    ) {

        const playerId =
            connection.playerId;


        const player =
            players[playerId];


        if (!player) {
            return;
        }


        const text =
            String(
                message.text || ""
            )
            .slice(
                0,
                500
            );


        if (!text) {
            return;
        }


        broadcast({

            type:
                "chat",

            playerId:
                playerId,

            name:
                player.name,

            text:
                text

        });


        logChat(
            player.name +
            ": " +
            text
        );


        return;

    }


}


/*
============================================================
HOST DISCONNECT
============================================================
*/


function handleHostDisconnect(
    connectionId
) {

    const connection =
        connections[
            connectionId
        ];


    if (!connection) {
        return;
    }


    const playerId =
        connection.playerId;


    if (playerId) {

        delete players[
            playerId
        ];


        broadcast({

            type:
                "state",

            players:
                players

        });


        logChat(
            "Игрок отключился: " +
            playerId
        );

    }


    delete connections[
        connectionId
    ];


    renderGame();

    renderPlayersList();

    updatePlayerCount();

}


/*
============================================================
SEND TO ONE CONNECTION
============================================================
*/


function sendToConnection(
    connection,
    data
) {

    if (
        !connection.channel ||
        connection.channel.readyState !==
        "open"
    ) {

        return;

    }


    connection.channel.send(
        JSON.stringify(data)
    );

}


/*
============================================================
BROADCAST
============================================================
*/


function broadcast(data) {

    for (
        const connectionId
        in connections
    ) {

        sendToConnection(

            connections[
                connectionId
            ],

            data

        );

    }

}


/*
============================================================
CLIENT MODE
============================================================
*/


function startClient() {

    mode = "client";


    const offerEncoded =
        getHashParameter(
            "offer"
        );


    if (!offerEncoded) {

        alert(
            "В ссылке нет приглашения."
        );

        return;

    }


    hide("modeSelect");

    show("clientPanel");


    document
        .getElementById("clientStatus")
        .textContent =
        "Приглашение найдено. " +
        "Нажми «Создать ответ».";

}


/*
============================================================
CLIENT CREATE ANSWER
============================================================
*/


async function createAnswer() {

    const offerEncoded =
        getHashParameter(
            "offer"
        );


    if (!offerEncoded) {

        alert(
            "Offer не найден."
        );

        return;

    }


    const offer =
        decodeData(
            offerEncoded
        );


    const pc =
        new RTCPeerConnection(
            RTC_CONFIG
        );


    peerConnection =
        pc;


    /*
     * Хост создаёт DataChannel.
     */

    pc.ondatachannel =
        event => {

            dataChannel =
                event.channel;


            dataChannel.onopen =
                () => {

                    document
                        .getElementById(
                            "clientStatus"
                        )
                        .textContent =
                        "Соединение установлено.";

                    show("gamePanel");


                    /*
                     * Представляемся серверу.
                     */

                    send({

                        type:
                            "join",

                        name:
                            "Player"

                    });

                };


            dataChannel.onmessage =
                event => {

                    handleClientMessage(
                        event.data
                    );

                };


            dataChannel.onclose =
                () => {

                    document
                        .getElementById(
                            "clientStatus"
                        )
                        .textContent =
                        "Соединение закрыто.";

                };

        };


    pc.onconnectionstatechange =
        () => {

            console.log(
                "Client connection:",
                pc.connectionState
            );

        };


    /*
     * SET OFFER
     */

    await pc.setRemoteDescription(

        new RTCSessionDescription(
            offer
        )

    );


    /*
     * CREATE ANSWER
     */

    const answer =
        await pc.createAnswer();


    await pc.setLocalDescription(
        answer
    );


    /*
     * WAIT ICE
     */

    await waitForIceGatheringComplete(
        pc
    );


    const answerData = {

        type:
            pc.localDescription.type,

        sdp:
            pc.localDescription.sdp

    };


    const encoded =
        encodeData(
            answerData
        );


    const link =
        window.location.origin +
        window.location.pathname +
        "#answer=" +
        encoded;


    document
        .getElementById("answerLink")
        .value =
        link;


    document
        .getElementById("clientStatus")
        .textContent =
        "Ответ создан. " +
        "Отправь ссылку хосту.";

}


/*
============================================================
CLIENT MESSAGE
============================================================
*/


function handleClientMessage(raw) {

    let message;


    try {

        message =
            JSON.parse(raw);

    }
    catch {

        console.error(
            "Invalid server message",
            raw
        );

        return;

    }


    /*
     * WELCOME
     */

    if (
        message.type ===
        "welcome"
    ) {

        myId =
            message.playerId;


        roomId =
            message.roomId;


        players =
            message.players;


        document
            .getElementById("myId")
            .textContent =
            myId;


        renderGame();


        logChat(
            "Ты подключён как " +
            myId
        );


        return;

    }


    /*
     * STATE
     */

    if (
        message.type ===
        "state"
    ) {

        players =
            message.players;


        renderGame();


        return;

    }


    /*
     * CHAT
     */

    if (
        message.type ===
        "chat"
    ) {

        logChat(

            message.name +
            ": " +
            message.text

        );


        return;

    }

}


/*
============================================================
CLIENT SEND
============================================================
*/


function send(data) {

    if (
        !dataChannel ||
        dataChannel.readyState !==
        "open"
    ) {

        return;

    }


    dataChannel.send(
        JSON.stringify(data)
    );

}


/*
============================================================
CLIENT MOVEMENT
============================================================
*/


function move(dx, dy) {

    if (!myId) {
        return;
    }


    const player =
        players[myId];


    if (!player) {
        return;
    }


    /*
     * ВАЖНО:
     *
     * Клиент НЕ меняет своё состояние.
     *
     * Он только отправляет запрос серверу.
     */

    send({

        type:
            "move",

        x:
            player.x + dx,

        y:
            player.y + dy

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
            event.key === "w" ||
            event.key === "ArrowUp"
        ) {

            dy = -10;

        }


        if (
            event.key === "s" ||
            event.key === "ArrowDown"
        ) {

            dy = 10;

        }


        if (
            event.key === "a" ||
            event.key === "ArrowLeft"
        ) {

            dx = -10;

        }


        if (
            event.key === "d" ||
            event.key === "ArrowRight"
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

        type:
            "chat",

        text:
            text

    });


    input.value = "";

}


/*
============================================================
RENDER GAME
============================================================
*/


function renderGame() {

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
            player.name +
            " (" +
            id +
            ")";


        game.appendChild(
            element
        );

    }

}


/*
============================================================
PLAYER LIST
============================================================
*/


function renderPlayersList() {

    const element =
        document.getElementById(
            "playersList"
        );


    element.innerHTML = "";


    for (
        const id in players
    ) {

        const player =
            players[id];


        const entry =
            document.createElement(
                "div"
            );


        entry.className =
            "playerEntry";


        entry.textContent =
            player.name +
            " — " +
            id;


        element.appendChild(
            entry
        );

    }

}


/*
============================================================
COUNT
============================================================
*/


function updatePlayerCount() {

    document
        .getElementById(
            "playerCount"
        )
        .textContent =
        Object.keys(players).length;

}


/*
============================================================
NAME
============================================================
*/


function sanitizeName(name) {

    name =
        String(name || "")
            .trim()
            .slice(0, 24);


    if (!name) {

        name =
            "Player";

    }


    return name;

}


/*
============================================================
GLOBAL VARIABLES FOR CLIENT
============================================================
*/


let peerConnection = null;

let dataChannel = null;


/*
============================================================
BUTTONS
============================================================
*/


document
    .getElementById("hostButton")
    .onclick =
    startHost;


document
    .getElementById("joinButton")
    .onclick =
    startClient;


document
    .getElementById(
        "createInviteButton"
    )
    .onclick =
    createInvite;


document
    .getElementById(
        "acceptAnswerButton"
    )
    .onclick =
    acceptAnswer;


document
    .getElementById(
        "createAnswerButton"
    )
    .onclick =
    createAnswer;


document
    .getElementById(
        "chatButton"
    )
    .onclick =
    sendChat;