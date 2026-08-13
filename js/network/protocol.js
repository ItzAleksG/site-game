/*
 * Единый протокол обмена сообщениями
 * между GameServer и подключёнными игроками.
 *
 * Все игровые сообщения передаются
 * как JSON-строки через WebRTC DataChannel.
 */

export const MESSAGE = Object.freeze({
    /* Client -> Server */
    JOIN: "join",
    INPUT: "input",
    PING: "ping",
    PLAYER_READY: "player_ready",

    /* Server -> Client */
    WELCOME: "welcome",
    SNAPSHOT: "snapshot",
    ROOM_STATE: "room_state",
    PLAYER_JOINED: "player_joined",
    PLAYER_LEFT: "player_left",
    ERROR: "error",
    PONG: "pong"
});


export function makeMessage(type, data = {}) {
    if (typeof type !== "string") {
        throw new TypeError("Message type must be a string.");
    }

    if (
        !data ||
        typeof data !== "object" ||
        Array.isArray(data)
    ) {
        throw new TypeError("Message data must be an object.");
    }

    return JSON.stringify({
        type,
        ...data
    });
}


export function parseMessage(raw) {
    if (typeof raw !== "string") {
        return null;
    }

    try {
        const message = JSON.parse(raw);

        if (
            !message ||
            typeof message !== "object" ||
            Array.isArray(message)
        ) {
            return null;
        }

        if (typeof message.type !== "string") {
            return null;
        }

        return message;
    }
    catch {
        return null;
    }
}


export function isMessageType(type) {
    return Object.values(MESSAGE).includes(type);
}
