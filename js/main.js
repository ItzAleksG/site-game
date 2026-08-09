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
    renderWorld
} from "./ui/game.js";


/*
============================================================
STATE
============================================================
*/

const roomCode =
    createRoomCode();


let gameServer = null;

let hostNetwork = null;

let clientNetwork = null;

let clientPlayerId = null;

let currentSnapshot = null;


/*
============================================================
INITIAL UI
============================================================
*/

document
    .getElementById("roomCode")
    .textContent =
    roomCode;


/*
============================================================
HOST
============================================================
*/

document
    .getElementById("hostButton")
    .onclick =
    async () => {

        gameServer =
            new GameServer(
                roomCode
            );


        gameServer.setHostName(
            getPlayerName()
        );


        gameServer.onPlayerListChanged =
            players => {

                renderPlayers(
                    players
                );

            };


        gameServer.onSnapshot =
            snapshot => {

                currentSnapshot =
                    snapshot;


                renderWorld(
                    snapshot,
                    "HOST"
                );

            };


        hostNetwork =
            new HostNetwork(
                gameServer
            );


        showHostLobby(
            roomCode
        );


        showGame(
            roomCode,
            "HOST"
        );


        renderWorld(
            gameServer.world.snapshot(),
            "HOST"
        );


        renderPlayers(
            Object.values(
                gameServer.world.players
            )
        );


        await createHostInvite();


        setHostStatus(
            "Комната создана. Ты играешь как HOST."
        );

    };


/*
============================================================
CREATE HOST INVITE
============================================================
*/

async function createHostInvite() {

    const offer =
        await hostNetwork
            .createInvite();


    const link =
        createLink(
            "offer",
            {

                roomCode,

                offer

            }
        );


    setHostOffer(
        link
    );


    setHostStatus(
        "Отправь эту ссылку игроку. После его ответа вставь Answer."
    );

}


/*
============================================================
ACCEPT PLAYER ANSWER
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


            const data =
                decodeLink(
                    link
                );


            if (
                data.type !==
                "answer"
            ) {

                throw new Error(
                    "Это не Answer"
                );

            }


            await hostNetwork
                .acceptAnswer(
                    data.data
                );


            setHostStatus(
                "Игрок подключён. Создаю приглашение для следующего игрока..."
            );


            /*
             * Для следующего игрока
             * создаётся отдельное WebRTC-соединение.
             */

            await createHostInvite();

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

        const encoded =
            getHash(
                "offer"
            );


        if (!encoded) {

            alert(
                "Открой ссылку приглашения хоста."
            );

            return;

        }


        showClientLobby();


        clientNetwork =
            new ClientNetwork();


        setupClientHandlers();


        try {

            const invite =
                decodeData(
                    encoded
                );


            if (
                !invite.roomCode ||
                !invite.offer
            ) {

                throw new Error(
                    "Некорректное приглашение"
                );

            }


            setClientStatus(
                `Комната ${invite.roomCode} найдена.`
            );


            const answer =
                await clientNetwork
                    .connect(
                        invite.offer
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
                "Answer создан. Отправь его хосту."
            );

        }
        catch (error) {

            console.error(
                error
            );


            setClientStatus(
                "Ошибка: " +
                error.message
            );

        }

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
                "WebRTC подключён. Регистрируем игрока..."
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


            currentSnapshot =
                message.snapshot;


            showGame(
                message.roomCode,
                clientPlayerId
            );


            renderWorld(
                currentSnapshot,
                clientPlayerId
            );


            setClientStatus(
                `Подключено к комнате ${message.roomCode}`
            );

        }
    );


    clientNetwork.on(
        MESSAGE.SNAPSHOT,
        message => {

            currentSnapshot =
                message.snapshot;


            renderWorld(
                currentSnapshot,
                clientPlayerId
            );

        }
    );


    clientNetwork.on(
        MESSAGE.PLAYER_JOINED,
        message => {

            console.log(
                "Player joined:",
                message.player
            );

        }
    );


    clientNetwork.on(
        MESSAGE.PLAYER_LEFT,
        message => {

            console.log(
                "Player left:",
                message.playerId
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


        /*
         * HOST управляет своим игроком
         * непосредственно через GameServer.
         */

        if (gameServer) {

            gameServer.hostInput({

                type:
                    MESSAGE.INPUT,

                action:
                    "move",

                dx,

                dy

            });

            return;

        }


        /*
         * Обычный игрок отправляет
         * input через WebRTC.
         */

        if (clientNetwork) {

            clientNetwork.move(
                dx,
                dy
            );

        }

    }
);


/*
============================================================
INVITE / LINK
============================================================
*/

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


function decodeLink(link) {

    const hash =
        link.split("#")[1];


    if (!hash) {

        throw new Error(
            "Ссылка не содержит данных"
        );

    }


    const params =
        new URLSearchParams(
            hash
        );


    const type =
        [...params.keys()][0];


    const encoded =
        params.get(type);


    return {

        type,

        data:
            decodeData(
                encoded
            )

    };

}


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
            String.fromCharCode(
                byte
            );

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


function getHash(name) {

    const hash =
        location.hash;


    if (!hash) {
        return null;
    }


    return new URLSearchParams(
        hash.substring(1)
    ).get(name);

}


/*
============================================================
ROOM CODE
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
