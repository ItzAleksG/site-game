import { MESSAGE } from "./network/protocol.js";
import { HostNetwork } from "./network/host.js";
import { ClientNetwork } from "./network/client.js";
import { GameServer } from "./game/server.js";
import { LobbyUI } from "./ui/lobby.js";
import { GameUI } from "./ui/game.js";
import { SIGNALING_URL } from "./config.js";


const elements = {
    menu: document.getElementById("lobbyMenu"),
    hostLobby: document.getElementById("hostLobby"),
    clientLobby: document.getElementById("clientLobby"),
    game: document.getElementById("gameSection"),

    playerName: document.getElementById("playerName"),
    hostButton: document.getElementById("hostButton"),
    joinButton: document.getElementById("joinButton"),
    joinRoomCode: document.getElementById("joinRoomCode"),

    roomCode: document.getElementById("roomCode"),
    offer: document.getElementById("hostOffer"),
    hostAnswer: document.getElementById("hostAnswer"),
    acceptAnswerButton: document.getElementById("acceptAnswerButton"),
    playerList: document.getElementById("hostPlayers"),
    playerCount: document.getElementById("playerCount"),
    hostStatus: document.getElementById("hostStatus"),

    clientRoomCode: document.getElementById("clientRoomCode"),
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
    currentInvite: null
};


const automaticSignalingEnabled = Boolean(SIGNALING_URL);


initialize();


function initialize() {
    elements.playerName.value = loadPlayerName();
    elements.clientPlayerName.value = "";

    bindEvents();

    const roomFromHash = getRoomCodeFromHash();
    const invite = getInviteFromHash();

    if (invite) {
        prepareClientFromInvite(invite);
        return;
    }

    if (roomFromHash) {
        elements.joinRoomCode.value = roomFromHash;
    }

    lobbyUI.showMenu();
}


function bindEvents() {
    elements.hostButton.addEventListener("click", createRoom);
    elements.joinButton.addEventListener("click", joinRoom);
    elements.acceptAnswerButton.addEventListener("click", acceptPlayerAnswer);
    elements.createAnswerButton.addEventListener("click", createClientConnection);

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
        state.roomCode = createRoomCode();

        savePlayerName(state.playerName);

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
        elements.roomCode.textContent = state.roomCode;

        gameUI.setPlayerId("HOST");
        showHostInterface();
        renderHostState();

        if (automaticSignalingEnabled) {
            lobbyUI.setHostStatus("Подключаю комнату к сигнализации...");

            await state.hostNetwork.connectSignaling(
                SIGNALING_URL,
                state.roomCode
            );

            lobbyUI.setHostStatus(
                `Комната ${state.roomCode} создана. Ожидаю игроков.`
            );
        }
        else {
            await createHostInvite();

            lobbyUI.setHostStatus(
                `Комната ${state.roomCode} создана. Автоматическая сигнализация не настроена, используется ручное подключение.`
            );
        }
    }
    catch (error) {
        console.error("Failed to create room:", error);

        state.hostNetwork?.close();
        state.hostNetwork = null;
        state.gameServer = null;
        state.mode = "menu";

        lobbyUI.showMenu();
        alert(`Ошибка создания комнаты: ${error.message}`);
    }
}


async function createHostInvite() {
    if (!state.hostNetwork) {
        throw new Error("Host network is not initialized.");
    }

    if (state.gameServer.isFull()) {
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
    if (!state.hostNetwork) return;

    try {
        const raw = elements.hostAnswer.value.trim();

        if (!raw) {
            throw new Error("Вставь Answer игрока.");
        }

        const data = decodeDataFromText(raw);

        if (data.type !== "answer") {
            throw new Error("Это не Answer.");
        }

        await state.hostNetwork.acceptAnswer(
            data.answer,
            data.connectionId ?? state.currentInvite?.connectionId ?? null
        );

        elements.hostAnswer.value = "";
        lobbyUI.setHostStatus("Answer принят. Ожидаю подключения игрока...");
    }
    catch (error) {
        console.error("Failed to accept answer:", error);
        lobbyUI.setHostStatus(`Ошибка: ${error.message}`);
    }
}


function setupHostNetworkHandlers() {
    const network = state.hostNetwork;
    if (!network) return;

    network.on("signalingConnected", () => {
        lobbyUI.setHostStatus(
            `Комната ${state.roomCode} доступна по коду. Ожидаю игроков.`
        );
    });

    network.on("signalingDisconnected", () => {
        if (state.mode === "host") {
            lobbyUI.setHostStatus("Сигнализация отключена.");
        }
    });

    network.on("inviteCreated", data => {
        if (!automaticSignalingEnabled) return;

        lobbyUI.setHostStatus(
            `Подключаю игрока ${data.peerId} через WebRTC...`
        );
    });

    network.on("playerConnection", () => {
        lobbyUI.setHostStatus(
            "WebRTC подключён. Ожидаю регистрацию игрока..."
        );
    });

    network.on("connectionStateChange", data => {
        if (data.state === "connected") {
            lobbyUI.setHostStatus("WebRTC соединение установлено.");
        }
    });

    network.on("connectionRemoved", () => {
        renderHostState();
    });

    network.on("error", data => {
        console.error("Host network error:", data);
    });
}


function setupGameServerHandlers() {
    const server = state.gameServer;
    if (!server) return;

    server.onPlayerJoined = player => {
        renderHostState();

        lobbyUI.setHostStatus(
            `${player.name} подключился (${player.id}).`
        );

        if (!automaticSignalingEnabled && !server.isFull()) {
            createHostInvite().catch(error => {
                console.error("Failed to create next invite:", error);
            });
        }
    };

    server.onPlayerLeft = player => {
        renderHostState();

        if (player) {
            lobbyUI.setHostStatus(`${player.name} отключился.`);
        }
    };

    server.onPlayerListChanged = players => {
        lobbyUI.setPlayers(players);
        lobbyUI.setPlayerCount(players.length, server.maxPlayers);
    };

    server.onSnapshot = snapshot => {
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
    if (!state.gameServer) return;

    const players = state.gameServer.getPlayers();
    const snapshot = state.gameServer.getSnapshot();

    lobbyUI.setPlayers(players);
    lobbyUI.setPlayerCount(players.length, state.gameServer.maxPlayers);

    gameUI.setPlayerId("HOST");
    gameUI.render(snapshot);
}


function showHostInterface() {
    lobbyUI.showHost();

    elements.gameRoomCode.textContent = state.roomCode;
    elements.gamePlayerId.textContent = "HOST";
}


/* ============================================================
   CLIENT
   ============================================================ */

function joinRoom() {
    const roomCode = sanitizeRoomCode(elements.joinRoomCode.value);

    if (roomCode) {
        prepareClientForRoom(roomCode);
        return;
    }

    const invite = getInviteFromHash();

    if (invite) {
        prepareClientFromInvite(invite);
        return;
    }

    alert("Введи код комнаты.");
}


function prepareClientForRoom(roomCode) {
    state.mode = "client";
    state.roomCode = roomCode;
    state.currentInvite = null;

    elements.clientRoomCode.textContent = roomCode;
    elements.clientPlayerName.value = "";
    elements.clientAnswer.value = "";
    elements.createAnswerButton.disabled = false;

    lobbyUI.showClient();

    if (!automaticSignalingEnabled) {
        lobbyUI.setClientStatus(
            "Автоматическая сигнализация ещё не настроена. Укажи SIGNALING_URL в js/config.js."
        );
        return;
    }

    lobbyUI.setClientStatus(
        `Комната ${roomCode} найдена. Введи ник и подключись.`
    );
}


function prepareClientFromInvite(invite) {
    if (!invite?.offer) {
        lobbyUI.showClient();
        lobbyUI.setClientStatus("Invitation не содержит WebRTC offer.");
        return;
    }

    state.mode = "client";
    state.roomCode = invite.roomCode ?? null;
    state.currentInvite = invite;

    elements.clientRoomCode.textContent = state.roomCode ?? "-";
    elements.clientPlayerName.value = "";
    elements.clientAnswer.value = "";
    elements.createAnswerButton.disabled = false;

    lobbyUI.showClient();
    lobbyUI.setClientStatus(
        `Ручное подключение к комнате ${invite.roomCode ?? ""}. Введи ник.`
    );
}


async function createClientConnection() {
    const name = sanitizeName(elements.clientPlayerName.value);

    elements.clientPlayerName.value = name;
    savePlayerName(name);
    state.playerName = name;

    elements.createAnswerButton.disabled = true;

    try {
        if (state.clientNetwork) {
            state.clientNetwork.close();
        }

        state.clientNetwork = new ClientNetwork();
        setupClientNetworkHandlers();

        if (automaticSignalingEnabled && state.roomCode) {
            lobbyUI.setClientStatus(
                `Подключаюсь к комнате ${state.roomCode}...`
            );

            await state.clientNetwork.connectSignaling(
                SIGNALING_URL,
                state.roomCode
            );

            lobbyUI.setClientStatus(
                "Ожидаю WebRTC offer от HOST..."
            );
            return;
        }

        const invite = state.currentInvite ?? getInviteFromHash();

        if (!invite?.offer) {
            throw new Error("Не найден invitation хоста.");
        }

        lobbyUI.setClientStatus("Создаю WebRTC-соединение...");

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
        lobbyUI.setClientStatus(`Ошибка: ${error.message}`);
    }
}


function setupClientNetworkHandlers() {
    const client = state.clientNetwork;
    if (!client) return;

    client.on("signalingConnected", () => {
        lobbyUI.setClientStatus(
            `Сигнализация подключена. Ожидаю HOST комнаты ${state.roomCode}...`
        );
    });

    client.on("connected", () => {
        lobbyUI.setClientStatus(
            "WebRTC подключён. Регистрирую игрока..."
        );

        client.join(state.playerName);
    });

    client.on(MESSAGE.WELCOME, message => {
        state.playerId = message.playerId;
        state.roomCode = message.roomCode;

        elements.gameRoomCode.textContent = message.roomCode;
        elements.gamePlayerId.textContent = message.playerId;

        gameUI.setPlayerId(message.playerId);
        gameUI.render(message.snapshot);
        lobbyUI.showGame();
    });

    client.on(MESSAGE.SNAPSHOT, message => {
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
        elements.createAnswerButton.disabled = false;
    });

    client.on("disconnected", () => {
        lobbyUI.setClientStatus("Соединение с HOST потеряно.");
    });

    client.on("signalingDisconnected", () => {
        if (state.mode === "client") {
            lobbyUI.setClientStatus("Сигнализация отключена.");
        }
    });

    client.on("connectionStateChange", value => {
        console.log("Client connection state:", value);
    });

    client.on("error", error => {
        console.error("Client network error:", error);
        elements.createAnswerButton.disabled = false;
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
        state.gameServer.hostInput({ action: "move", dx, dy });
        return;
    }

    if (state.mode === "client" && state.clientNetwork) {
        state.clientNetwork.move(dx, dy);
    }
}


/* ============================================================
   DATA / ROOM HELPERS
   ============================================================ */

function createRoomCode() {
    const alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
    const bytes = new Uint8Array(6);
    crypto.getRandomValues(bytes);

    return [...bytes]
        .map(byte => alphabet[byte % alphabet.length])
        .join("");
}


function sanitizeRoomCode(value) {
    return String(value ?? "")
        .trim()
        .toUpperCase()
        .replace(/[^A-Z0-9]/g, "")
        .slice(0, 12);
}


function getRoomCodeFromHash() {
    const hash = location.hash.substring(1);
    const params = new URLSearchParams(hash);
    return sanitizeRoomCode(params.get("room"));
}


function getInviteFromHash() {
    if (!location.hash) return null;

    const hash = location.hash.substring(1);
    const params = new URLSearchParams(hash);
    const inviteData = params.get("invite");

    if (!inviteData) return null;

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
    if (!value) throw new Error("Пустые данные.");

    if (value.includes("#answer=")) {
        const url = new URL(value);
        const encoded = url.hash.substring(1);
        const params = new URLSearchParams(encoded);
        return decodeData(params.get("answer"));
    }

    return decodeData(value);
}


function encodeData(value) {
    const json = JSON.stringify(value);
    const bytes = new TextEncoder().encode(json);
    let binary = "";

    for (const byte of bytes) {
        binary += String.fromCharCode(byte);
    }

    return btoa(binary)
        .replace(/\+/g, "-")
        .replace(/\//g, "_")
        .replace(/=+$/g, "");
}


function decodeData(value) {
    if (!value) {
        throw new Error("Нет данных.");
    }

    const base64 = value
        .replace(/-/g, "+")
        .replace(/_/g, "/");

    const padded = base64 + "=".repeat((4 - base64.length % 4) % 4);
    const binary = atob(padded);
    const bytes = Uint8Array.from(binary, char => char.charCodeAt(0));

    return JSON.parse(new TextDecoder().decode(bytes));
}


function loadPlayerName() {
    try {
        return sanitizeName(localStorage.getItem("site-game-player-name"));
    }
    catch {
        return "Player";
    }
}


function savePlayerName(name) {
    try {
        localStorage.setItem("site-game-player-name", name);
    }
    catch {
        // Storage may be unavailable in private/restricted contexts.
    }
}


function sanitizeName(name) {
    return String(name ?? "")
        .trim()
        .replace(/\s+/g, " ")
        .slice(0, 24) || "Player";
}
