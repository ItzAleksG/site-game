export const MESSAGE = Object.freeze({
    JOIN: "join",
    WELCOME: "welcome",

    INPUT: "input",

    SNAPSHOT: "snapshot",

    PLAYER_JOINED: "player_joined",
    PLAYER_LEFT: "player_left",

    PING: "ping",
    PONG: "pong",

    ERROR: "error"
});


export function makeMessage(type, data = {}) {
    if (
        typeof type !== "string" ||
        type.length === 0
    ) {
        throw new Error(
            "Message type must be a non-empty string."
        );
    }

    return JSON.stringify({
        type,
        ...data
    });
}


export function parseMessage(raw) {
    if (
        typeof raw !== "string" ||
        raw.length === 0
    ) {
        return null;
    }

    try {
        const message =
            JSON.parse(raw);

        if (
            !message ||
            typeof message !== "object"
        ) {
            return null;
        }

        if (
            typeof message.type !==
            "string"
        ) {
            return null;
        }

        return message;
    }
    catch (error) {
        console.warn(
            "Failed to parse network message:",
            error
        );

        return null;
    }
}
