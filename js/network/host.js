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
    LobbyUI
} from "./ui/lobby.js";

import {
    GameUI
} from "./ui/game.js";


/*
============================================================
DOM
============================================================
*/

const elements = {
    menu:
        document.getElementById(
            "lobbyMenu"
        ),

    hostLobby:
        document.getElementById(
            "hostLobby"
        ),

    clientLobby:
        document.getElementById(
            "clientLobby"
        ),

    game:
        document.getElementById(
            "gameSection"
        ),

    playerName:
        document.getElementById(
            "playerName"
        ),

    hostButton:
        document.getElementById(
            "hostButton"
        ),

    joinButton:
        document.getElementById(
            "joinButton"
        ),

    roomCode:
        document.getElementById(
            "roomCode"
        ),

    hostOffer:
        document.getElementById(
            "hostOffer"
        ),

    hostAnswer:
        document.getElementById(
            "hostAnswer"
        ),

    acceptAnswerButton:
        document.getElementById(
            "acceptAnswerButton"
        ),

    hostPlayers:
        document.getElementById(
            "hostPlayers"
        ),

    hostStatus:
        document.getElementById(
            "hostStatus"
        ),

    clientStatus:
        document.getElementById(
            "clientStatus"
        ),

    createAnswerButton:
        document.getElementById(
            "createAnswerButton"
        ),

    clientAnswer:
        document.getElementById(
            "clientAnswer"
        ),

    gameRoomCode:
        document.getElementById(
            "gameRoomCode"
        ),

    gamePlayerId:
        document.getElementById(
            "gamePlayerId"
        ),

    gameStatus:
        document.getElementById(
            "gameStatus"
        ),

    gameWorld:
        document.getElementById(
            "gameWorld"
        )
};


const lobbyUI =
    new LobbyUI({
        ...elements
    });


const gameUI =
    new GameUI({
        worldElement:
            elements.gameWorld,

        playersElement:
            elements.hostPlayers
    });


/*
============================================================
STATE
============================================================
*/

const state = {
    mode:
        "menu",

    roomCode:
        null,

    gameServer:
        null,

    hostNetwork:
        null,

    clientNetwork:
        null,

    playerId:
        null,

    playerName:
        "Player",

    currentSnapshot:
        null,

    currentInvite:
        null
};


/*
============================================================
INITIALIZATION
============================================================
*/

initialize();


function initialize() {
    elements.playerName.value =
        loadPlayerName();

    bindEvents();

    const invite =
        getInviteFromHash();

    if (invite) {
        startClientFromInvite(
            invite
        );

        return;
    }

    lobbyUI.showMenu();
}


/*
============================================================
EVENTS
============================================================
*/

function bindEvents() {
    elements.hostButton.addEventListener(
        "click",
        createRoom
    );

    elements.joinButton.addEventListener(
        "click",
        joinRoom
    );

    elements.acceptAnswerButton.addEventListener(
        "click",
        acceptPlayerAnswer
    );

    elements.createAnswerButton.addEventListener(
        "click",
        createClientAnswer
    );

    window.addEventListener(
        "hashchange",
        handleHashChange
    );

    document.addEventListener(
        "keydown",
        handleKeyboard
    );
}


/*
============================================================
HOST: CREATE ROOM
============================================================
*/

async function createRoom() {
    if (
        state.gameServer ||
        state.hostNetwork
    ) {
        return;
    }

    try {
        setPlayerName();

        state.mode =
            "host";

        state.roomCode =
            createRoomCode();

        state.gameServer =
            new GameServer({
                roomCode:
                    state.roomCode,

                maxPlayers:
                    8
            });

        state.gameServer.setHostName(
            state.playerName
        );

        setupGameServerHandlers();

        state.hostNetwork =
            new HostNetwork(
                state.gameServer
            );

        setupHostNetworkHandlers();

        state.playerId =
            "HOST";

        lobbyUI.setRoomCode(
            state.roomCode
        );

        elements.gameRoomCode.textContent =
            state.roomCode;

        elements.gamePlayerId.textContent =
            "HOST";

        gameUI.setPlayerId(
            "HOST"
        );

        showHostInterface();

        renderHostState();

        await createHostInvite();

        lobbyUI.setHostStatus(
            "Комната создана. Отправь приглашение игроку."
        );
    }
    catch (error) {
        console.error(
            "Failed to create room:",
            error
        );

        lobbyUI.setHostStatus(
            `Ошибка: ${error.message}`
        );
    }
}


/*
============================================================
HOST: CREATE INVITE
============================================================
*/

async function createHostInvite() {
    if (
        !state.hostNetwork
    ) {
        throw new Error(
            "Host network is not initialized."
        );
    }

    if (
        state.gameServer.isFull()
    ) {
        lobbyUI.setHostStatus(
            "Комната заполнена."
        );

        return null;
    }

    const invite =
        await state.hostNetwork
            .createInvite();

    state.currentInvite =
        invite;

    const link =
        createInviteLink({
            roomCode:
                state.roomCode,

            connectionId:
                invite.connectionId,

            offer:
                invite.offer
        });

    lobbyUI.setOffer(
        link
    );

    return invite;
}


/*
============================================================
HOST: ACCEPT ANSWER
============================================================
*/

async function acceptPlayerAnswer() {
    if (
        !state.hostNetwork
    ) {
        return;
    }

    try {
        const raw =
            elements.hostAnswer.value
                .trim();

        if (!raw) {
            throw new Error(
                "Вставь Answer игрока."
            );
        }

        const data =
            decodeDataFromText(
                raw
            );

        if (
            data.type !==
            "answer"
        ) {
            throw new Error(
                "Это не Answer."
            );
        }

        const connectionId =
            data.connectionId ??
            state.currentInvite
                ?.connectionId ??
            null;

        await state.hostNetwork
            .acceptAnswer(
                data.answer,
                connectionId
            );

        elements.hostAnswer.value =
            "";

        lobbyUI.setHostStatus(
            "Answer принят. Ожидаю подключения игрока..."
        );
    }
    catch (error) {
        console.error(
            "Failed to accept answer:",
            error
        );

        lobbyUI.setHostStatus(
            `Ошибка: ${error.message}`
        );
    }
}


/*
============================================================
HOST NETWORK EVENTS
============================================================
*/

function setupHostNetworkHandlers() {
    const network =
        state.hostNetwork;

    if (!network) {
        return;
    }

    network.on(
        "playerConnection",
        connection => {
            lobbyUI.setHostStatus(
                "WebRTC подключён. Регистрирую игрока..."
            );
        }
    );

    network.on(
        "connectionStateChange",
        data => {
            if (
                data.state ===
                "connected"
            ) {
                lobbyUI.setHostStatus(
                    "WebRTC соединение установлено."
                );
            }
        }
    );

    network.on(
        "connectionRemoved",
        connection => {
            renderHostState();

            if (
                state.mode ===
                "host"
            ) {
                lobbyUI.setHostStatus(
                    "Игрок отключился."
                );
            }
        }
    );

    network.on(
        "error",
        data => {
            console.error(
                "Host network error:",
                data
            );
        }
    );
}


/*
============================================================
GAME SERVER EVENTS
============================================================
*/

function setupGameServerHandlers() {
    const server =
        state.gameServer;

    if (!server) {
        return;
    }

    server.onPlayerJoined =
        async player => {
            renderHostState();

            lobbyUI.setHostStatus(
                `${player.name} подключился.`
            );

            /*
             * После успешной регистрации игрока
             * создаём следующее приглашение.
             *
             * Это позволяет подключать P-1,
             * затем P-2, P-3 и т.д.
             */
            if (
                state.mode ===
                "host" &&
                !server.isFull()
            ) {
                try {
                    await createHostInvite();

                    lobbyUI.setHostStatus(
                        `${player.name} подключился. Новое приглашение готово.`
                    );
                }
                catch (error) {
                    console.error(
                        "Failed to create next invite:",
                        error
                    );
                }
            }
        };

    server.onPlayerLeft =
        player => {
            renderHostState();

            if (player) {
                lobbyUI.setHostStatus(
                    `${player.name} отключился.`
                );
            }

            /*
             * Если место освободилось,
             * поддерживаем актуальное приглашение.
             */
            if (
                state.mode ===
                    "host" &&
                !server.isFull()
            ) {
                createHostInvite()
                    .catch(
                        error => {
                            console.error(
                                "Failed to recreate invite:",
                                error
                            );
                        }
                    );
            }
        };

    server.onPlayerListChanged =
        players => {
            lobbyUI.setPlayers(
                players
            );

            lobbyUI.setPlayerCount(
                players.length,
                server.maxPlayers
            );

            renderHostState();
        };

    server.onSnapshot =
        snapshot => {
            state.currentSnapshot =
                snapshot;

            gameUI.render(
                snapshot
            );
        };

    server.onRoomStateChanged =
        roomState => {
            lobbyUI.setPlayerCount(
                roomState.playerCount,
                roomState.maxPlayers
            );
        };
}


/*
============================================================
HOST STATE
============================================================
*/

function renderHostState() {
    if (
        !state.gameServer
    ) {
        return;
    }

    const players =
        state.gameServer.getPlayers();

    lobbyUI.setPlayers(
        players
    );

    lobbyUI.setPlayerCount(
        players.length,
        state.gameServer.maxPlayers
    );

    const snapshot =
        state.gameServer.getSnapshot();

    state.currentSnapshot =
        snapshot;

    gameUI.setPlayerId(
        "HOST"
    );

    gameUI.render(
        snapshot
    );
}


/*
============================================================
CLIENT: JOIN
============================================================
*/

function joinRoom() {
    const invite =
        getInviteFromHash();

    if (!invite) {
        alert(
            "Открой invitation-ссылку хоста."
        );

        return;
    }

    startClientFromInvite(
        invite
    );
}


async function startClientFromInvite(
    invite
) {
    if (!invite) {
        return;
    }

    if (
        !invite.offer
    ) {
        lobbyUI.showClient();

        lobbyUI.setClientStatus(
            "Invitation не содержит WebRTC offer."
        );

        return;
    }

    if (
        state.clientNetwork
    ) {
        state.clientNetwork.close();
    }

    try {
        setPlayerName();

        state.mode =
            "client";

        state.roomCode =
            invite.roomCode;

        state.playerId =
            null;

        lobbyUI.showClient();

        lobbyUI.setClientStatus(
            `Комната ${invite.roomCode} найдена.`
        );

        elements.gameRoomCode.textContent =
            invite.roomCode;

        state.clientNetwork =
            new ClientNetwork();

        setupClientNetworkHandlers();

        lobbyUI.setClientStatus(
            "Создаю WebRTC-соединение..."
        );

        const answer =
            await state.clientNetwork
                .connect(
                    invite.offer
                );

        const answerLink =
            createAnswerLink({
                roomCode:
                    invite.roomCode,

                connectionId:
                    invite.connectionId,

                answer
            });

        lobbyUI.setClientAnswer(
            answerLink
        );

        lobbyUI.setClientStatus(
            "Answer создан. Отправь его HOST."
        );

        elements.createAnswerButton.disabled =
            true;
    }
    catch (error) {
        console.error(
            "Failed to connect to room:",
            error
        );

        lobbyUI.setClientStatus(
            `Ошибка: ${error.message}`
        );
    }
}


/*
============================================================
CLIENT: ANSWER BUTTON
============================================================
*/

async function createClientAnswer() {
    const invite =
        getInviteFromHash();

    if (!invite) {
        lobbyUI.setClientStatus(
            "Invitation-ссылка не найдена."
        );

        return;
    }

    await startClientFromInvite(
        invite
    );
}


/*
============================================================
CLIENT NETWORK EVENTS
============================================================
*/

function setupClientNetworkHandlers() {
    const client =
        state.clientNetwork;

    if (!client) {
        return;
    }

    client.on(
        "connected",
        () => {
            lobbyUI.setClientStatus(
                "WebRTC подключён. Регистрирую игрока..."
            );

            client.join(
                state.playerName
            );
        }
    );

    client.on(
        MESSAGE.WELCOME,
        message => {
            state.playerId =
                message.playerId;

            state.roomCode =
                message.roomCode;

            state.currentSnapshot =
                message.snapshot;

            elements.gameRoomCode.textContent =
                message.roomCode;

            elements.gamePlayerId.textContent =
                message.playerId;

            gameUI.setPlayerId(
                message.playerId
            );

            gameUI.render(
                message.snapshot
            );

            lobbyUI.showGame();

            lobbyUI.setClientStatus(
                `Подключено к комнате ${message.roomCode}.`
            );
        }
    );

    client.on(
        MESSAGE.SNAPSHOT,
        message => {
            state.currentSnapshot =
                message.snapshot;

            gameUI.render(
                message.snapshot
            );
        }
    );

    client.on(
        MESSAGE.PLAYER_JOINED,
        message => {
            console.log(
                "Player joined:",
                message.player
            );
        }
    );

    client.on(
        MESSAGE.PLAYER_LEFT,
        message => {
            console.log(
                "Player left:",
                message.playerId
            );
        }
    );

    client.on(
        MESSAGE.ERROR,
        message => {
            lobbyUI.setClientStatus(
                `Ошибка сервера: ${
                    message.message ??
                    "unknown error"
                }`
            );
        }
    );

    client.on(
        "disconnected",
        () => {
            lobbyUI.setClientStatus(
                "Соединение с HOST потеряно."
            );
        }
    );

    client.on(
        "connectionStateChange",
        stateValue => {
            console.log(
                "Client connection state:",
                stateValue
            );
        }
    );

    client.on(
        "error",
        error => {
            console.error(
                "Client network error:",
                error
            );
        }
    );
}


/*
============================================================
KEYBOARD / MOVEMENT
============================================================
*/

function handleKeyboard(event) {
    const target =
        event.target;

    if (
        target instanceof
            HTMLInputElement ||
        target instanceof
            HTMLTextAreaElement
    ) {
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

    /*
     * HOST управляет собой
     * непосредственно через GameServer.
     */
    if (
        state.mode ===
            "host" &&
        state.gameServer
    ) {
        state.gameServer.hostInput({
            action:
                "move",

            dx,
            dy
        });

        return;
    }

    /*
     * CLIENT отправляет INPUT
     * через WebRTC.
     */
    if (
        state.mode ===
            "client" &&
        state.clientNetwork
    ) {
        state.clientNetwork.move(
            dx,
            dy
        );
    }
}


/*
============================================================
INTERFACE
============================================================
*/

function showHostInterface() {
    lobbyUI.showHost();

    elements.gameRoomCode.textContent =
        state.roomCode;

    elements.gamePlayerId.textContent =
        "HOST";
}


function showGame() {
    lobbyUI.showGame();
}


/*
============================================================
PLAYER NAME
============================================================
*/

function setPlayerName() {
    const name =
        elements.playerName.value
            .trim();

    state.playerName =
        name ||
        "Player";

    localStorage.setItem(
        "browser-game-player-name",
        state.playerName
    );
}


function loadPlayerName() {
    return (
        localStorage.getItem(
            "browser-game-player-name"
        ) ||
        "Player"
    );
}


/*
============================================================
INVITE HASH
============================================================
*/

function handleHashChange() {
    const invite =
        getInviteFromHash();

    if (
        invite &&
        state.mode ===
            "menu"
    ) {
        startClientFromInvite(
            invite
        );
    }
}


function getInviteFromHash() {
    if (
        !location.hash
    ) {
        return null;
    }

    const hash =
        location.hash.substring(
            1
        );

    /*
     * Поддерживаем:
     *
     * #invite=...
     *
     * и:
     *
     * #answer=...
     */
    const params =
        new URLSearchParams(
            hash
        );

    const inviteData =
        params.get(
            "invite"
        );

    if (inviteData) {
        try {
            return decodeData(
                inviteData
            );
        }
        catch (error) {
            console.error(
                "Invalid invitation:",
                error
            );

            return null;
        }
    }

    return null;
}


/*
============================================================
INVITE LINKS
============================================================
*/

function createInviteLink(
    data
) {
    return createLink(
        "invite",
        {
            version:
                1,

            roomCode:
                data.roomCode,

            connectionId:
                data.connectionId,

            offer:
                data.offer
        }
    );
}


function createAnswerLink(
    data
) {
    return createLink(
        "answer",
        {
            version:
                1,

            roomCode:
                data.roomCode,

            connectionId:
                data.connectionId,

            answer:
                data.answer
        }
    );
}


function createLink(
    type,
    data
) {
    const encoded =
        encodeData({
            type,
            ...data
        });

    return (
        location.origin +
        location.pathname +
        "#" +
        type +
        "=" +
        encoded
    );
}


/*
============================================================
ANSWER DECODING
============================================================
*/

function decodeDataFromText(
    text
) {
    const value =
        text.trim();

    if (!value) {
        throw new Error(
            "Пустые данные."
        );
    }

    /*
     * HOST может вставить полную
     * Answer-ссылку.
     */
    if (
        value.startsWith(
            "http://"
        ) ||
        value.startsWith(
            "https://"
        )
    ) {
        const url =
            new URL(value);

        const hash =
            url.hash.replace(
                /^#/,
                ""
            );

        const params =
            new URLSearchParams(
                hash
            );

        const encoded =
            params.get(
                "answer"
            );

        if (!encoded) {
            throw new Error(
                "Answer-ссылка пуста или некорректна."
            );
        }

        return decodeData(
            encoded
        );
    }

    /*
     * Также принимаем напрямую
     * Base64URL-строку.
     */
    return decodeData(
        value
    );
}


/*
============================================================
BASE64URL JSON
============================================================
*/

function encodeData(
    data
) {
    const json =
        JSON.stringify(
            data
        );

    const bytes =
        new TextEncoder()
            .encode(json);

    let binary = "";

    for (
        const byte
        of bytes
    ) {
        binary +=
            String.fromCharCode(
                byte
            );
    }

    return btoa(binary)
        .replace(
            /\+/g,
            "-"
        )
        .replace(
            /\//g,
            "_"
        )
        .replace(
            /=/g,
            ""
        );
}


function decodeData(
    data
) {
    let normalized =
        String(data)
            .replace(
                /-/g,
                "+"
            )
            .replace(
                /_/g,
                "/"
            );

    while (
        normalized.length %
            4 !==
        0
    ) {
        normalized +=
            "=";
    }

    const binary =
        atob(
            normalized
        );

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


/*
============================================================
ROOM CODE
============================================================
*/

function createRoomCode() {
    const chars =
        "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";

    const bytes =
        new Uint32Array(
            8
        );

    crypto.getRandomValues(
        bytes
    );

    let value = "";

    for (
        const byte
        of bytes
    ) {
        value +=
            chars[
                byte %
                chars.length
            ];
    }

    return (
        value.substring(0, 4) +
        "-" +
        value.substring(4)
    );
}
