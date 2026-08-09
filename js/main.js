import { MESSAGE } from "./network/protocol.js";
import { HostNetwork } from "./network/host.js";
import { ClientNetwork } from "./network/client.js";
import { GameServer } from "./game/server.js";
import { LobbyUI } from "./ui/lobby.js";
import { GameUI } from "./ui/game.js";


const elements = {
    menu: document.getElementById("lobbyMenu"),
    hostLobby: document.getElementById("hostLobby"),
    clientLobby: document.getElementById("clientLobby"),
    game: document.getElementById("gameSection"),

    playerName: document.getElementById("playerName"),
    hostButton: document.getElementById("hostButton"),
    joinButton: document.getElementById("joinButton"),

    roomCode: document.getElementById("roomCode"),
    offer: document.getElementById("hostOffer"),
    hostAnswer: document.getElementById("hostAnswer"),
    acceptAnswerButton: document.getElementById("acceptAnswerButton"),
    playerList: document.getElementById("hostPlayers"),
    playerCount: document.getElementById("playerCount"),
    hostStatus: document.getElementById("hostStatus"),

    clientPlayerName: document.getElementById("clientPlayerName"),
    clientStatus: document.getElementById("clientStatus"),
    createAnswerButton: document.getElementById("createAnswerButton"),
    clientAnswer: document.getElementById("clientAnswer"),

    gameRoomCode: document.getElementById("gameRoomCode"),
    gamePlayerId: document.getElementById("gamePlayerId"),
    gameStatus: document.getElementById("gameStatus"),
    gameWorld: document.getElementById("gameWorld")
};


const lobbyUI = new LobbyUI(elements);

const gameUI = new GameUI({
    worldElement: elements.gameWorld
});


const state = {
    mode: "menu",
    roomCode: null,
    gameServer: null,
    hostNetwork: null,
    clientNetwork: null,
    playerId: null,
    playerName: "Player",
    currentSnapshot: null,
    currentInvite: null
};


initialize();


function initialize() {
    const savedName = loadPlayerName();

    elements.playerName.value = savedName;
    elements.clientPlayerName.value = savedName;

    bindEvents();

    const invite = getInviteFromHash();

    if (invite) {
        prepareClientFromInvite(invite);
        return;
    }

    lobbyUI.showMenu();
}


function bindEvents() {
    elements.hostButton.addEventListener("click", createRoom);
    elements.joinButton.addEventListener("click", joinRoom);
    elements.acceptAnswerButton.addEventListener("click", acceptPlayerAnswer);
    elements.createAnswerButton.addEventListener("click", createClientAnswer);

    window.addEventListener("hashchange", handleHashChange);
    document.addEventListener("keydown", handleKeyboard);
}


/* ============================================================
   HOST
   ============================================================ */

async function createRoom() {
    if (state.gameServer || state.hostNetwork) {
        return;
    }

    try {
        state.mode = "host";
        state.playerName = sanitizeName(elements.playerName.value);

        savePlayerName(state.playerName);

        state.roomCode = createRoomCode();

        state.gameServer = new GameServer({
            roomCode: state.roomCode,
            maxPlayers: 8
        });

        state.gameServer.setHostName(state.playerName);
        setupGameServerHandlers();

        state.hostNetwork = new HostNetwork(state.gameServer);
        setupHostNetworkHandlers();

        state.playerId = "HOST";

        elements.gameRoomCode.textContent = state.roomCode;
        elements.gamePlayerId.textContent = "HOST";

        gameUI.setPlayerId("HOST");

        showHostInterface();
        renderHostState();

        await createHostInvite();

        lobbyUI.setHostStatus(
            "Комната создана. Ты уже первый игрок. Отправь приглашение игроку."
        );
    }
    catch (error) {
        console.error("Failed to create room:", error);

        state.hostNetwork?.close();

        state.hostNetwork = null;
        state.gameServer = null;
        state.mode = "menu";

        lobbyUI.showMenu();
        lobbyUI.setStatus(`Ошибка создания комнаты: ${error.message}`);
    }
}


async function createHostInvite() {
    if (!state.hostNetwork) {
        throw new Error("Host network is not initialized.");
    }

    if (state.gameServer.isFull()) {
        lobbyUI.setHostStatus("Комната заполнена.");
        return null;
    }

    const invite = await state.hostNetwork.createInvite();

    state.currentInvite = invite;

    lobbyUI.setOffer(createInviteLink({
        roomCode: state.roomCode,
        connectionId: invite.connectionId,
        offer: invite.offer
    }));

    return invite;
}


async function acceptPlayerAnswer() {
    if (!state.hostNetwork) {
        return;
    }

    try {
        const raw = elements.hostAnswer.value.trim();

        if (!raw) {
            throw new Error("Вставь Answer игрока.");
        }

        const data = decodeDataFromText(raw);

        if (data.type !== "answer") {
            throw new Error("Это не Answer.");
        }

        const connectionId =
            data.connectionId ??
            state.currentInvite?.connectionId ??
            null;

        await state.hostNetwork.acceptAnswer(
            data.answer,
            connectionId
        );

        elements.hostAnswer.value = "";

        lobbyUI.setHostStatus(
            "Answer принят. Ожидаю подключения игрока..."
        );
    }
    catch (error) {
        console.error("Failed to accept answer:", error);
        lobbyUI.setHostStatus(`Ошибка: ${error.message}`);
    }
}


function setupHostNetworkHandlers() {
    const network = state.hostNetwork;

    if (!network) {
        return;
    }

    network.on("playerConnection", () => {
        lobbyUI.setHostStatus(
            "WebRTC подключён. Ожидаю регистрацию игрока..."
        );
    });

    network.on("connectionStateChange", data => {
        if (data.state === "connected") {
            lobbyUI.setHostStatus(
                "WebRTC соединение установлено."
            );
        }
    });

    network.on("connectionRemoved", () => {
        renderHostState();
        lobbyUI.setHostStatus("Игрок отключился.");
    });

    network.on("error", data => {
        console.error("Host network error:", data);
    });
}


function setupGameServerHandlers() {
    const server = state.gameServer;

    if (!server) {
        return;
    }

    server.onPlayerJoined = player => {
        renderHostState();

        lobbyUI.setHostStatus(
            `${player.name} подключился (${player.id}).`
        );

        if (!server.isFull()) {
            createHostInvite().catch(error => {
                console.error("Failed to create next invite:", error);
            });
        }
    };

    server.onPlayerLeft = player => {
        renderHostState();

        if (player) {
            lobbyUI.setHostStatus(
                `${player.name} отключился.`
            );
        }
    };

    server.onPlayerListChanged = players => {
        lobbyUI.setPlayers(players);
        lobbyUI.setPlayerCount(players.length, server.maxPlayers);
    };

    server.onSnapshot = snapshot => {
        state.currentSnapshot = snapshot;
        gameUI.render(snapshot);
    };

    server.onRoomStateChanged = roomState => {
        lobbyUI.setPlayerCount(
            roomState.playerCount,
            roomState.maxPlayers
        );
    };
}


function renderHostState() {
    if (!state.gameServer) {
        return;
    }

    const players = state.gameServer.getPlayers();
    const snapshot = state.gameServer.getSnapshot();

    lobbyUI.setPlayers(players);
    lobbyUI.setPlayerCount(
        players.length,
        state.gameServer.maxPlayers
    );

    state.currentSnapshot = snapshot;

    gameUI.setPlayerId("HOST");
    gameUI.render(snapshot);
}


function showHostInterface() {
    /*
     * HOST должен одновременно видеть:
     * 1. панель управления комнатой;
     * 2. игровое поле.
     *
     * LobbyUI специально переключает экраны,
     * поэтому gameSection показываем здесь отдельно.
     */
    lobbyUI.showHost();

    elements.game.classList.remove("hidden");

    elements.gameRoomCode.textContent = state.roomCode;
    elements.gamePlayerId.textContent = "HOST";
}


/* ============================================================
   CLIENT
   ============================================================ */

function joinRoom() {
    const invite = getInviteFromHash();

    if (!invite) {
        alert("Открой invitation-ссылку хоста.");
        return;
    }

    prepareClientFromInvite(invite);
}


function prepareClientFromInvite(invite) {
    if (!invite?.offer) {
        lobbyUI.showClient();
        lobbyUI.setClientStatus(
            "Invitation не содержит WebRTC offer."
        );
        return;
    }

    state.mode = "client";
    state.roomCode = invite.roomCode ?? null;
    state.currentInvite = invite;

    const savedName = loadPlayerName();

    elements.clientPlayerName.value = savedName;
    elements.clientAnswer.value = "";
    elements.createAnswerButton.disabled = false;

    lobbyUI.showClient();

    lobbyUI.setClientStatus(
        `Комната ${invite.roomCode ?? ""} найдена. Введи свой ник и создай Answer.`
    );
}


async function createClientAnswer() {
    const invite = state.currentInvite ?? getInviteFromHash();

    if (!invite?.offer) {
        lobbyUI.setClientStatus(
            "Invitation-ссылка не найдена или повреждена."
        );
        return;
    }

    const name = sanitizeName(elements.clientPlayerName.value);

    elements.clientPlayerName.value = name;
    savePlayerName(name);

    elements.createAnswerButton.disabled = true;

    try {
        if (state.clientNetwork) {
            state.clientNetwork.close();
        }

        state.playerName = name;
        state.clientNetwork = new ClientNetwork();

        setupClientNetworkHandlers();

        lobbyUI.setClientStatus(
            "Создаю WebRTC-соединение..."
        );

        const answer = await state.clientNetwork.connect(invite.offer);

        const answerLink = createAnswerLink({
            roomCode: invite.roomCode,
            connectionId: invite.connectionId,
            answer
        });

        lobbyUI.setClientAnswer(answerLink);

        lobbyUI.setClientStatus(
            `Answer создан для игрока «${name}». Отправь его HOST.`
        );
    }
    catch (error) {
        console.error("Failed to connect to room:", error);

        elements.createAnswerButton.disabled = false;

        lobbyUI.setClientStatus(
            `Ошибка: ${error.message}`
        );
    }
}


function setupClientNetworkHandlers() {
    const client = state.clientNetwork;

    if (!client) {
        return;
    }

    client.on("connected", () => {
        lobbyUI.setClientStatus(
            "WebRTC подключён. Регистрирую игрока..."
        );

        client.join(state.playerName);
    });

    client.on(MESSAGE.WELCOME, message => {
        state.playerId = message.playerId;
        state.roomCode = message.roomCode;
        state.currentSnapshot = message.snapshot;

        elements.gameRoomCode.textContent = message.roomCode;
        elements.gamePlayerId.textContent = message.playerId;

        gameUI.setPlayerId(message.playerId);
        gameUI.render(message.snapshot);

        lobbyUI.showGame();
    });

    client.on(MESSAGE.SNAPSHOT, message => {
        state.currentSnapshot = message.snapshot;
        gameUI.render(message.snapshot);
    });

    client.on(MESSAGE.PLAYER_JOINED, message => {
        console.log("Player joined:", message.player);
    });

    client.on(MESSAGE.PLAYER_LEFT, message => {
        console.log("Player left:", message.playerId);
    });

    client.on(MESSAGE.ERROR, message => {
        lobbyUI.setClientStatus(
            `Ошибка сервера: ${message.message ?? "unknown"}`
        );
    });

    client.on("disconnected", () => {
        lobbyUI.setClientStatus(
            "Соединение с HOST потеряно."
        );
    });

    client.on("connectionStateChange", value => {
        console.log("Client connection state:", value);
    });

    client.on("error", error => {
        console.error("Client network error:", error);
    });
}


/* ============================================================
   INPUT
   ============================================================ */

function handleKeyboard(event) {
    const target = event.target;

    if (
        target instanceof HTMLInputElement ||
        target instanceof HTMLTextAreaElement
    ) {
        return;
    }

    let dx = 0;
    let dy = 0;

    switch (event.key.toLowerCase()) {
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

    if (state.mode === "host" && state.gameServer) {
        state.gameServer.hostInput({
            action: "move",
            dx,
            dy
        });

        return;
    }

    if (state.mode === "client" && state.clientNetwork) {
        state.clientNetwork.move(dx, dy);
    }
}


/* ============================================================
   INVITES
   ============================================================ */

function handleHashChange() {
    const invite = getInviteFromHash();

    if (invite && state.mode === "menu") {
        prepareClientFromInvite(invite);
    }
}


function getInviteFromHash() {
    if (!location.hash) {
        return null;
    }

    const hash = location.hash.substring(1);
    const params = new URLSearchParams(hash);
    const inviteData = params.get("invite");

    if (!inviteData) {
        return null;
    }

    try {
        return decodeData(inviteData);
    }
    catch (error) {
        console.error("Invalid invitation:", error);
        return null;
    }
}


function createInviteLink(data) {
    const encoded = encodeData({
        type: "invite",
        version: 1,
        roomCode: data.roomCode,
        connectionId: data.connectionId,
        offer: data.offer
    });

    return `${location.origin}${location.pathname}#invite=${encoded}`;
}


function createAnswerLink(data) {
    const encoded = encodeData({
        type: "answer",
        version: 1,
        roomCode: data.roomCode,
        connectionId: data.connectionId,
        answer: data.answer
    });

    return `${location.origin}${location.pathname}#answer=${encoded}`;
}


function decodeDataFromText(text) {
    const value = text.trim();

    if (!value) {
        throw new Error("Пустые данные.");
    }

    if (
        value.startsWith("http://") ||
        value.startsWith("https://")
    ) {
        const url = new URL(value);
        const hash = url.hash.replace(/^#/, "");
        const params = new URLSearchParams(hash);
        const encoded = params.get("answer");

        if (!encoded) {
            throw new Error("Answer-ссылка пуста или некорректна.");
        }

        return decodeData(encoded);
    }

    return decodeData(value);
}


function encodeData(data) {
    const json = JSON.stringify(data);
    const bytes = new TextEncoder().encode(json);
    let binary = "";

    for (const byte of bytes) {
        binary += String.fromCharCode(byte);
    }

    return btoa(binary)
        .replace(/\+/g, "-")
        .replace(/\//g, "_")
        .replace(/=/g, "");
}


function decodeData(data) {
    let normalized = String(data)
        .replace(/-/g, "+")
        .replace(/_/g, "/");

    while (normalized.length % 4 !== 0) {
        normalized += "=";
    }

    const binary = atob(normalized);
    const bytes = new Uint8Array(binary.length);

    for (let i = 0; i < binary.length; i++) {
        bytes[i] = binary.charCodeAt(i);
    }

    return JSON.parse(new TextDecoder().decode(bytes));
}


/* ============================================================
   PLAYER NAME
   ============================================================ */

function sanitizeName(name) {
    const value = String(name ?? "")
        .trim()
        .replace(/\s+/g, " ")
        .slice(0, 24);

    return value || "Player";
}


function savePlayerName(name) {
    localStorage.setItem(
        "browser-game-player-name",
        sanitizeName(name)
    );
}


function loadPlayerName() {
    return sanitizeName(
        localStorage.getItem(
            "browser-game-player-name"
        ) || "Player"
    );
}


/* ============================================================
   ROOM CODE
   ============================================================ */

function createRoomCode() {
    const chars =
        "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";

    const bytes = new Uint32Array(8);
    crypto.getRandomValues(bytes);

    let value = "";

    for (const byte of bytes) {
        value += chars[byte % chars.length];
    }

    return `${value.substring(0, 4)}-${value.substring(4)}`;
}
