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
    startGameButton: document.getElementById("startGameButton"),

    clientRoomCode: document.getElementById("clientRoomCode"),
    clientPlayerName: document.getElementById("clientPlayerName"),
    clientStatus: document.getElementById("clientStatus"),
    createAnswerButton: document.getElementById("createAnswerButton"),
    clientAnswer: document.getElementById("clientAnswer"),
    clientReadyButton: document.getElementById("clientReadyButton"),

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
    currentInvite: null,
    clientReady: false,
    roomStatus: "waiting"
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
    elements.hostButton?.addEventListener("click", createRoom);
    elements.joinButton?.addEventListener("click", joinRoom);
    elements.acceptAnswerButton?.addEventListener("click", acceptPlayerAnswer);
    elements.createAnswerButton?.addEventListener("click", createClientConnection);
    elements.startGameButton?.addEventListener("click", startHostGame);
    elements.clientReadyButton?.addEventListener("click", toggleClientReady);

    document.addEventListener("keydown", handleKeyboard);
}


/* ============================================================
   HOST
   ============================================================ */

async function createRoom() {
    if (state.gameServer || state.hostNetwork) return;

    try {
        state.mode = "host";
        state.playerName = sanitizeName(elements.playerName.value);
        state.roomCode = createRoomCode();
        state.roomStatus = "waiting";

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


async function startHostGame() {
    if (!state.gameServer) return;

    const started = state.gameServer.startGame();

    if (!started) {
        const roomState = state.gameServer.getRoomState();

        if (roomState.playerCount < 2) {
            lobbyUI.setHostStatus("Для запуска нужен хотя бы один подключённый игрок.");
        }
        else {
            lobbyUI.setHostStatus("Не все подключённые игроки готовы.");
        }

        return;
    }

    state.roomStatus = "playing";
    elements.startGameButton.disabled = true;
    elements.startGameButton.textContent = "Игра запущена";
    lobbyUI.setHostStatus("Игра запущена. HOST управляет миром.");
    elements.gameStatus.textContent = "Игра идёт";
}


async function createHostInvite() {
    if (!state.hostNetwork) {
        throw new Error("Host network is not initialized.");
    }

    if (state.gameServer.isFull()) return null;

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
            `${player.name} подключился (${player.id}). Готовность: нет.`
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
        state.roomStatus = roomState.status;

        lobbyUI.setPlayers(roomState.players);
        lobbyUI.setPlayerCount(
            roomState.playerCount,
            roomState.maxPlayers
        );

        if (elements.startGameButton) {
            elements.startGameButton.disabled =
                roomState.status !== "waiting" || !roomState.canStart;
        }

        if (roomState.status === "waiting") {
            const readyCount = roomState.players
                .filter(player => player.ready)
                .length;

            lobbyUI.setHostStatus(
                roomState.canStart
                    ? "Все игроки готовы. Можно запускать игру."
                    : `Ожидание игроков: готово ${readyCount}/${roomState.playerCount}.`
            );
        }
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
    elements.gameStatus.textContent = "Ожидание запуска игры";
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
    state.clientReady = false;
    state.roomStatus = "waiting";

    elements.clientRoomCode.textContent = roomCode;
    elements.clientPlayerName.value = "";
    elements.clientAnswer.value = "";
    elements.createAnswerButton.disabled = false;
    updateClientReadyButton();

    lobbyUI.showClient();

    if (!automaticSignalingEnabled) {
        lobbyUI.setClientStatus(
            "Автоматическая сигнализация ещё не настроена. Укажи SIGNALING_URL в js/config.js."
        );
        return;
    }

    lobbyUI.setClientStatus(
        `Комната ${roomCode}. Введи ник и подключись.`
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
    state.clientReady = false;

    elements.clientRoomCode.textContent = state.roomCode ?? "-";
    elements.clientPlayerName.value = "";
    elements.clientAnswer.value = "";
    elements.createAnswerButton.disabled = false;
    updateClientReadyButton();

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
                `Проверяю комнату ${state.roomCode}...`
            );

            await state.clientNetwork.connectSignaling(
                SIGNALING_URL,
                state.roomCode
            );

            lobbyUI.setClientStatus(
                "Комната существует. Ожидаю WebRTC offer от HOST..."
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
        lobbyUI.setClientStatus(
            "WebRTC подключён. Регистрирую игрока..."
        );

        client.join(state.playerName);
    });

    client.on(MESSAGE.WELCOME, message => {
        state.playerId = message.playerId;
        state.roomCode = message.roomCode;
        state.clientReady = false;
        state.roomStatus = message.roomState?.status ?? "waiting";

        elements.gameRoomCode.textContent = message.roomCode;
        elements.gamePlayerId.textContent = message.playerId;

        gameUI.setPlayerId(message.playerId);
        gameUI.render(message.snapshot);
        updateClientReadyButton();

        applyClientRoomState(message.roomState);
    });

    client.on(MESSAGE.ROOM_STATE, message => {
        applyClientRoomState(message.roomState);
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
        state.roomStatus = "waiting";
        lobbyUI.setClientStatus("Соединение с HOST потеряно.");
        elements.createAnswerButton.disabled = false;
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


function applyClientRoomState(roomState) {
    if (!roomState) return;

    state.roomStatus = roomState.status ?? "waiting";

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
        !state.clientNetwork || state.roomStatus !== "waiting";

    elements.clientReadyButton.textContent =
        state.clientReady ? "Снять готовность" : "Готов";
}


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
        state.gameServer?.movePlayer("HOST", dx, dy);
        return;
    }

    state.clientNetwork?.move(dx, dy);
}


/* ============================================================
   LINKS / STORAGE / HELPERS
   ============================================================ */

function createInviteLink(data) {
    const payload = encodeData(data);
    return `${location.origin}${location.pathname}#invite=${encodeURIComponent(payload)}`;
}


function createAnswerLink(data) {
    const payload = encodeData({
        type: "answer",
        ...data
    });

    return `${location.origin}${location.pathname}#answer=${encodeURIComponent(payload)}`;
}


function getInviteFromHash() {
    const hash = location.hash;

    if (!hash.startsWith("#invite=")) return null;

    try {
        const payload = decodeURIComponent(hash.slice("#invite=".length));
        const data = decodeDataFromText(payload);

        if (data.type !== "invite") {
            return null;
        }

        return data;
    }
    catch {
        return null;
    }
}


function getRoomCodeFromHash() {
    const hash = location.hash;

    if (!hash.startsWith("#room=")) return null;

    return sanitizeRoomCode(
        decodeURIComponent(hash.slice("#room=".length))
    );
}


function encodeData(data) {
    const json = JSON.stringify(data);
    return btoa(unescape(encodeURIComponent(json)));
}


function decodeDataFromText(value) {
    const json = decodeURIComponent(escape(atob(value)));
    return JSON.parse(json);
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
    const name = String(value ?? "")
        .trim()
        .replace(/\s+/g, " ")
        .slice(0, 24);

    return name || "Player";
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
