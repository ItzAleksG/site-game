/*
 * Все сообщения между клиентом и
 * browser-server проходят через этот протокол.
 */


export const MESSAGE = Object.freeze({

    JOIN: "join",
@@ -14,8 +8,6 @@ export const MESSAGE = Object.freeze({

    SNAPSHOT: "snapshot",

    CHAT: "chat",

    PLAYER_JOINED: "player_joined",

    PLAYER_LEFT: "player_left",
@@ -25,50 +17,3 @@ export const MESSAGE = Object.freeze({
    PONG: "pong"

});


export function makeMessage(
    type,
    data = {}
) {

    return JSON.stringify({

        type,

        ...data

    });

}


export function parseMessage(raw) {

    try {

        const message =
            JSON.parse(raw);


        if (
            !message ||
            typeof message.type !==
            "string"
        ) {

            return null;

        }


        return message;

    }
    catch {

        return null;

    }

}
