import {
    MESSAGE
} from "./network/protocol.js";

import {
    HostNetwork
} from "./network/host.js";

import {
    ClientNetwork
} from "./network/client.js";

import {
    GameServer
} from "./game/server.js";

import {
    showHostLobby,
    showClientLobby,
    showGame,
    setHostOffer,
    getHostAnswer,
    setClientAnswer,
    setHostStatus,
    setClientStatus,
    renderPlayers,
    getPlayerName
} from "./ui/lobby.js";

import {
    renderWorld,
    addChatMessage,
    getChatText,
    clearChatText
} from "./ui/game.js";


/*
============================================================
ROOM
============================================================
*/


const roomCode =
    createRoomCode();


let hostNetwork =
    null;


let gameServer =
    null;


let clientNetwork =
    null;


let clientSnapshot =
    null;


let clientPlayerId =
    null;


/*
============================================================
HASH / INVITE
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


    return JSON.parse(

        new TextDecoder()
            .decode(bytes)

    );

}


function getHash(
    name
) {

    const hash =
        location.hash;


    if (!hash) {
        return null;
    }


    return new URLSearchParams(
        hash.substring(1)
    ).get(name);

}


function createLink(
    type,
    data
) {

    return (
        location.origin +
        location.pathname +
        "#" +
        type +
        "=" +
        encodeData(data)
    );

}


/*
============================================================
HOST
============================================================
*/


document
    .getElementById(
        "hostButton"
    )
    .onclick =
    async () => {

        gameServer =
            new GameServer();


        gameServer
            .onPlayerListChanged =
            players => {

                renderPlayers(
                    players
                );

            };


        hostNetwork =
            new HostNetwork(
                gameServer
            );


        showHostLobby(
            roomCode
        );


        setHostStatus(
            "Комната создана."
        );


        const offer =
            await hostNetwork
                .createInvite();


        const link =
            createLink(
                "offer",
                offer
            );


        setHostOffer(
            link
        );


        /*
         * Хост сам является первым игроком.
         */

        gameServer.world
            .addPlayer(
                "HOST",
                getPlayerName()
            );


        renderPlayers(
            Object.values(
                gameServer.world.players
            )
        );


        showGame(
            roomCode,
            "HOST"
        );


        renderWorld(
            gameServer.world.snapshot(),
            "HOST"
        );

    };


/*
============================================================
HOST ACCEPT ANSWER
============================================================
*/


document
    .getElementById(
        "acceptAnswerButton"
    )
    .onclick =
    async () => {

        try {

            const link =
                getHostAnswer();


            const encoded =
                extractParameter(
                    link,
                    "answer"
                );


            if (!encoded) {

                throw new Error(
                    "Не найден answer"
                );

            }


            const answer =
                decodeData(
                    encoded
                );


            await hostNetwork
                .acceptAnswer(
                    answer
                );


            setHostStatus(
                "Answer принят. Ожидаем подключение."
            );

        }
        catch (error) {

            console.error(
                error
            );


            setHostStatus(
                "Ошибка: " +
                error.message
            );

        }

    };


/*
============================================================
CLIENT
============================================================
*/


document
    .getElementById(
        "joinButton"
    )
    .onclick =
    async () => {

        const offerEncoded =
            getHash(
                "offer"
            );


        if (!offerEncoded) {

            alert(
                "Сначала открой ссылку приглашения хоста."
            );

            return;

        }


        showClientLobby();


        setClientStatus(
            "Приглашение найдено."
        );


        clientNetwork =
            new ClientNetwork();


        setupClientHandlers();


        const offer =
            decodeData(
                offerEncoded
            );


        const answer =
            await clientNetwork
                .connect(
                    offer
                );


        const link =
            createLink(
                "answer",
                answer
            );


        setClientAnswer(
            link
        );


        setClientStatus(
            "Ответ создан. Отправь его хосту."
        );

    };


/*
============================================================
CLIENT HANDLERS
============================================================
*/


function setupClientHandlers() {

    clientNetwork.on(
        "connected",
        () => {

            setClientStatus(
                "WebRTC подключён."
            );


            clientNetwork.join(
                getPlayerName()
            );

        }
    );


    clientNetwork.on(
        MESSAGE.WELCOME,
        message => {

            clientPlayerId =
                message.playerId;


            clientSnapshot =
                message.snapshot;


            showGame(
                "UNKNOWN",
                clientPlayerId
            );


            renderWorld(
                clientSnapshot,
                clientPlayerId
            );

        }
    );


    clientNetwork.on(
        MESSAGE.SNAPSHOT,
        message => {

            clientSnapshot =
                message.snapshot;


            renderWorld(
                clientSnapshot,
                clientPlayerId
            );

        }
    );


    clientNetwork.on(
        MESSAGE.PLAYER_JOINED,
        message => {

            const player =
                message.player;


            addChatMessage(
                "SYSTEM",
                `${player.name} вошёл в игру`
            );

        }
    );


    clientNetwork.on(
        MESSAGE.PLAYER_LEFT,
        message => {

            addChatMessage(
                "SYSTEM",
                `${message.playerId} вышел`
            );

        }
    );


    clientNetwork.on(
        MESSAGE.CHAT,
        message => {

            addChatMessage(
                message.name,
                message.text
            );

        }
    );


    clientNetwork.on(
        "disconnected",
        () => {

            setClientStatus(
                "Соединение с хостом потеряно."
            );

        }
    );

}


/*
============================================================
MOVEMENT
============================================================
*/


document.addEventListener(
    "keydown",
    event => {

        if (!clientNetwork) {
            return;
        }


        let dx = 0;

        let dy = 0;


        switch (
            event.key.toLowerCase()
        ) {

            case "w":

            case "arrowup":

                dy = -1;

                break;


            case "s":

            case "arrowdown":

                dy = 1;

                break;


            case "a":

            case "arrowleft":

                dx = -1;

                break;


            case "d":

            case "arrowright":

                dx = 1;

                break;


            default:

                return;

        }


        event.preventDefault();


        clientNetwork.move(
            dx,
            dy
        );

    }
);


/*
============================================================
CHAT
============================================================
*/


document
    .getElementById(
        "sendChatButton"
    )
    .onclick =
    () => {

        if (!clientNetwork) {
            return;
        }


        const text =
            getChatText();


        if (!text) {
            return;
        }


        clientNetwork.chat(
            text
        );


        clearChatText();

    };


document
    .getElementById(
        "chatMessage"
    )
    .addEventListener(
        "keydown",
        event => {

            if (
                event.key ===
                "Enter"
            ) {

                document
                    .getElementById(
                        "sendChatButton"
                    )
                    .click();

            }

        }
    );


/*
============================================================
UTILITIES
============================================================
*/


function createRoomCode() {

    const chars =
        "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";


    let result = "";


    for (
        let i = 0;
        i < 8;
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


    return (
        result.substring(0, 4) +
        "-" +
        result.substring(4)
    );

}


function extractParameter(
    url,
    parameter
) {

    try {

        const hash =
            url.split("#")[1];


        if (!hash) {
            return null;
        }


        return new URLSearchParams(
            hash
        ).get(parameter);

    }
    catch {

        return null;

    }

}