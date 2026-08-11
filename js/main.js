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
    playerList: document.getElementById("hostPlayers"),
    playerCount: document.getElementById("playerCount"),
    hostStatus: document.getElementById("hostStatus"),
    startGameButton: document.getElementById("startGameButton"),

    clientRoomCode: document.getElementById("clientRoomCode"),
    clientStatus: document.getElementById("clientStatus"),
    clientPlayerList: document.getElementById("clientPlayers"),
    clientPlayerCount: document.getElementById("clientPlayerCount"),
    createAnswerButton: document.getElementById("createAnswerButton"),
    clientReadyButton: document.getElementById("clientReadyButton"),

    gameRoomCode: document.getElementById("gameRoomCode"),
    gamePlayerId: document.getElementById("gamePlayerId"),
    gameStatus: document.getElementById("gameStatus"),
    gameWorld: document.getElementById("gameWorld")
};


const lobbyUI = new LobbyUI(elements);
const gameUI = new GameUI({ worldElement: elements.gameWorld });


const state = {
    mode: "menu",
    roomCode: null,
    playerId: null,
    playerName: "",
    gameServer: null,
    hostNetwork: null,
    clientNetwork: null,
    clientReady: false,
    roomStatus: "waiting"
};


const automaticSignalingEnabled = Boolean(SIGNALING_URL);


initialize();


function initialize() {
    elements.playerName.value = loadPlayerName();

    elements.playerName.addEventListener("input", () => {
        state.playerName = sanitizeName(elements.playerName.value);
    });

    elements.joinRoomCode.addEventListener("input", () => {
        elements.joinRoomCode.value = sanitizeRoomCode(elements.joinRoomCode.value);
    });

    elements.hostButton?.addEventListener("click", createRoom);
    elements.joinButton?.addEventListener("click", joinRoom);
    elements.startGameButton?.addEventListener("click", startHostGame);
    elements.clientReadyButton?.addEventListener("click", toggleClientReady);

    document.addEventListener("keydown", handleKeyboard);

    const roomFromHash = getRoomCodeFromHash();
    if (roomFromHash) {
        elements.joinRoomCode.value = roomFromHash;
    }

    lobbyUI.showMenu();
}


/* ============================================================
   COMMON LOBBY
   ============================================================ */

function getPlayerName() {
    const name = sanitizeName(elements.playerName.value);

    if (!name) {
        throw new Error("Введи ник игрока.");
    }

    elements.playerName.value = name;
    state.playerName = name;
    savePlayerName(name);

    return name;
}


function validatePlayerName() {
    const value = String(elements.playerName.value ?? "").trim();

    if (!value) {
        elements.playerName.focus();
        lobbyUI.setClientStatus("Сначала введи ник на главном экране.");
        return false;
    }

    return true;
}


/* ============================================================
   HOST
   ============================================================ */

async function createRoom() {
    if (state.gameServer || state.hostNetwork) return;

    let name;

    try {
        name = getPlayerName();
    }
    catch (error) {
        alert(error.message);
        elements.playerName.focus();
        return;
    }

    try {
        state.mode = "host";
        state.playerName = name;
        state.roomCode = createRoomCode();
        state.playerId = "HOST";
        state.roomStatus = "waiting";

        state.gameServer = new GameServer({
            roomCode: state.roomCode,
            maxPlayers: 8
        });

        state.gameServer.setHostName(name);
        setupGameServerHandlers();

        state.hostNetwork = new HostNetwork(state.gameServer);
        setupHostNetworkHandlers();

        elements.roomCode.textContent = state.roomCode;
        elements.gameRoomCode.textContent = state.roomCode;
        elements.gamePlayerId.textContent = "HOST";
        elements.gameStatus.textContent = "Ожидание игроков";

        gameUI.setPlayerId("HOST");
        lobbyUI.showHost();
        renderHostState();

        if (!automaticSignalingEnabled) {
            throw new Error("Сигнализация не настроена.");
        }

        lobbyUI.setHostStatus("Подключаю комнату к сигнализации...");

        await state.hostNetwork.connectSignaling(
            SIGNALING_URL,
            state.roomCode
        );

        lobbyUI.setHostStatus(
            `Комната ${state.roomCode} создана. Ожидаю игроков.`
        );
    }
    catch (error) {
        console.error("Failed to create room:", error);

        state.hostNetwork?.close();
        state.hostNetwork = null;
        state.gameServer?.close();
        state.gameServer = null;
        state.mode = "menu";
        state.roomCode = null;

        lobbyUI.showMenu();
        alert(`Ошибка создания комнаты: ${error.message}`);
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
        lobbyUI.setHostStatus(
            `Подключаю игрока ${data.peerId} через WebRTC...`
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

    network.on("error", error => {
        console.error("Host network error:", error);
    });
}


function setupGameServerHandlers() {
    const server = state.gameServer;
    if (!server) return;

    server.onPlayerJoined = player => {
        renderHostState();
        lobbyUI.setHostStatus(
            `${player.name} подключился. Ожидаем готовность.`
        );
    };

    server.onPlayerLeft = player => {
        renderHostState();

        if (player) {
            lobbyUI.setHostStatus(`${player.name} отключился.`);
        }
    };

    server.onPlayerListChanged = players => {
        lobbyUI.setPlayers(players, "host");
        lobbyUI.setPlayers(players, "client");
        lobbyUI.setPlayerCount(players.length, server.maxPlayers, "host");
        lobbyUI.setPlayerCount(players.length, server.maxPlayers, "client");
    };

    server.onSnapshot = snapshot => {
        gameUI.render(snapshot);
    };

    server.onRoomStateChanged = roomState => {
        state.roomStatus = roomState.status;

        renderRoomStateForHost(roomState);
    };
}


function renderRoomStateForHost(roomState) {
    if (!roomState) return;

    lobbyUI.setPlayers(roomState.players, "host");
    lobbyUI.setPlayerCount(
        roomState.playerCount,
        roomState.maxPlayers,
        "host"
    );

    if (elements.startGameButton) {
        elements.startGameButton.disabled =
            roomState.status !== "waiting" || !roomState.canStart;
    }

    if (roomState.status !== "waiting") return;

    const readyCount = roomState.players
        .filter(player => player.ready)
        .length;

    lobbyUI.setHostStatus(
        roomState.canStart
            ? "Все игроки готовы. Можно запускать игру."
            : `Ожидание игроков: готово ${readyCount}/${roomState.playerCount}.`
    );
}


function renderHostState() {
    if (!state.gameServer) return;

    const players = state.gameServer.getPlayers();
    const snapshot = state.gameServer.getSnapshot();

    lobbyUI.setPlayers(players, "host");
    lobbyUI.setPlayerCount(players.length, state.gameServer.maxPlayers, "host");

    gameUI.setPlayerId("HOST");
    gameUI.render(snapshot);
}


function startHostGame() {
    if (!state.gameServer) return;

    const started = state.gameServer.startGame();

    if (!started) {
        const roomState = state.gameServer.getRoomState();

        lobbyUI.setHostStatus(
            roomState.playerCount < 2
                ? "Для запуска нужен хотя бы один подключённый игрок."
                : "Не все подключённые игроки готовы."
        );

        return;
    }

    state.roomStatus = "playing";
    elements.startGameButton.disabled = true;
    elements.startGameButton.textContent = "Игра запущена";
    elements.gameStatus.textContent = "Игра идёт";
    lobbyUI.setHostStatus("Игра запущена. HOST управляет миром.");
}


/* ============================================================
   CLIENT
   ============================================================ */

function joinRoom() {
    if (!validatePlayerName()) return;

    const roomCode = sanitizeRoomCode(elements.joinRoomCode.value);

    if (!roomCode) {
        alert("Введи код комнаты.");
        elements.joinRoomCode.focus();
        return;
    }

    prepareClientForRoom(roomCode);
}


function prepareClientForRoom(roomCode) {
    state.mode = "client";
    state.roomCode = roomCode;
    state.playerId = null;
    state.clientReady = false;
    state.roomStatus = "waiting";
    state.playerName = sanitizeName(elements.playerName.value);

    elements.clientRoomCode.textContent = roomCode;
    elements.createAnswerButton.disabled = false;
    updateClientReadyButton();

    lobbyUI.showClient();
    lobbyUI.setPlayers([], "client");
    lobbyUI.setPlayerCount(0, 8, "client");

    if (!automaticSignalingEnabled) {
        lobbyUI.setClientStatus("Сигнализация не настроена.");
        return;
    }

    lobbyUI.setClientStatus(
        `Комната ${roomCode}. Нажми «Подключиться к комнате».`
    );
}


async function createClientConnection() {
    if (!validatePlayerName()) return;

    const name = getPlayerName();
    state.playerName = name;
    elements.createAnswerButton.disabled = true;

    try {
        state.clientNetwork?.close();
        state.clientNetwork = new ClientNetwork();
        setupClientNetworkHandlers();

        lobbyUI.setClientStatus(
            `Проверяю комнату ${state.roomCode}...`
        );

        await state.clientNetwork.connectSignaling(
            SIGNALING_URL,
            state.roomCode
        );

        lobbyUI.setClientStatus(
            "Комната найдена. Ожидаю WebRTC offer от HOST..."
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
            `Проверяю доступность комнаты ${state.roomCode}...`
        );
    });

    client.on("roomReady", () => {
        lobbyUI.setClientStatus(
            "Комната найдена. Ожидаю WebRTC offer от HOST..."
        );
    });

    client.on("roomNotFound", error => {
        lobbyUI.setClientStatus(`Комната недоступна: ${error.message}`);
        elements.createAnswerButton.disabled = false;
    });

    client.on("offerTimeout", error => {
        lobbyUI.setClientStatus(
            `HOST не прислал WebRTC offer: ${error.message}`
        );
        elements.createAnswerButton.disabled = false;
    });

    client.on("connected", () => {
        lobbyUI.setClientStatus("WebRTC подключён. Регистрирую игрока...");
        client.join(state.playerName);
    });

    client.on(MESSAGE.WELCOME, message => {
        state.playerId = message.playerId;
        state.roomCode = message.roomCode;
        state.clientReady = false;
        state.roomStatus = message.roomState?.status ?? "waiting";

        elements.gameRoomCode.textContent = state.roomCode;
        elements.gamePlayerId.textContent = state.playerId;

        gameUI.setPlayerId(state.playerId);
        gameUI.render(message.snapshot);

        applyClientRoomState(message.roomState);
        elements.createAnswerButton.disabled = true;
    });

    client.on(MESSAGE.ROOM_STATE, message => {
        applyClientRoomState(message.roomState);
    });

    client.on(MESSAGE.SNAPSHOT, message => {
        gameUI.render(message.snapshot);
    });

    client.on(MESSAGE.PLAYER_JOINED, message => {
        if (message.player) {
            lobbyUI.setClientStatus(
                `${message.player.name} присоединился к комнате.`
            );
        }
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
        state.roomStatus = "waiting";
        lobbyUI.setClientStatus("Соединение с HOST потеряно.");
        elements.createAnswerButton.disabled = false;
        updateClientReadyButton();
    });

    client.on("signalingDisconnected", () => {
        if (state.mode === "client") {
            lobbyUI.setClientStatus("Сигнализация отключена.");
        }
    });

    client.on("error", error => {
        console.error("Client network error:", error);
        elements.createAnswerButton.disabled = false;
    });
}


function applyClientRoomState(roomState) {
    if (!roomState) return;

    state.roomStatus = roomState.status ?? "waiting";

    lobbyUI.setPlayers(roomState.players, "client");
    lobbyUI.setPlayerCount(
        roomState.playerCount,
        roomState.maxPlayers,
        "client"
    );

    const myPlayer = Array.isArray(roomState.players)
        ? roomState.players.find(player => player.id === state.playerId)
        : null;

    if (myPlayer) {
        state.clientReady = myPlayer.ready === true;
    }

    updateClientReadyButton();

    if (state.roomStatus === "playing") {
        elements.gameStatus.textContent = "Игра идёт";
        lobbyUI.showGame();
        return;
    }

    elements.gameStatus.textContent = "Ожидание запуска игры";
}


function toggleClientReady() {
    if (!state.clientNetwork || state.roomStatus !== "waiting") return;

    const nextReady = !state.clientReady;

    if (state.clientNetwork.setReady(nextReady)) {
        state.clientReady = nextReady;
        updateClientReadyButton();
    }
}


function updateClientReadyButton() {
    if (!elements.clientReadyButton) return;

    elements.clientReadyButton.disabled =
        !state.clientNetwork ||
        !state.playerId ||
        state.roomStatus !== "waiting";

    elements.clientReadyButton.textContent =
        state.clientReady ? "Снять готовность" : "Готов";
}


/* ============================================================
   INPUT
   ============================================================ */

function handleKeyboard(event) {
    if (state.mode !== "host" && state.mode !== "client") return;
    if (state.roomStatus !== "playing") return;

    const key = event.key.toLowerCase();
    let dx = 0;
    let dy = 0;

    if (key === "w" || key === "arrowup") dy = -1;
    if (key === "s" || key === "arrowdown") dy = 1;
    if (key === "a" || key === "arrowleft") dx = -1;
    if (key === "d" || key === "arrowright") dx = 1;

    if (dx === 0 && dy === 0) return;

    event.preventDefault();

    if (state.mode === "host") {
        state.gameServer?.input(
            { playerId: "HOST" },
            {
                action: "move",
                dx,
                dy
            }
        );
        return;
    }

    state.clientNetwork?.move(dx, dy);
}


/* ============================================================
   HELPERS
   ============================================================

function getRoomCodeFromHash() {
    const hash = location.hash;

    if (!hash.startsWith("#room=")) return null;

    try {
        return sanitizeRoomCode(
            decodeURIComponent(hash.slice("#room=".length))
        );
    }
    catch {
        return null;
    }
}


function createRoomCode() {
    const chars = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
    let code = "";

    for (let i = 0; i < 6; i++) {
        code += chars[Math.floor(Math.random() * chars.length)];
    }

    return code;
}


function sanitizeRoomCode(value) {
    return String(value ?? "")
        .toUpperCase()
        .replace(/[^A-Z0-9]/g, "")
        .slice(0, 12);
}


function sanitizeName(value) {
    return String(value ?? "")
        .trim()
        .replace(/\s+/g, " ")
        .slice(0, 24);
}


function savePlayerName(name) {
    try {
        localStorage.setItem("site-game-player-name", name);
    }
    catch {
        // Ignore storage errors.
    }
}


function loadPlayerName() {
    try {
        return localStorage.getItem("site-game-player-name") || "";
    }
    catch {
        return "";
    }
}
