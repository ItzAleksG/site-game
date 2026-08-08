export function renderWorld(
    snapshot,
    myPlayerId
) {

    const world =
        document.getElementById(
            "gameWorld"
        );


    world.innerHTML = "";


    for (
        const player
        of Object.values(
            snapshot.players
        )
    ) {

        const element =
            document.createElement(
                "div"
            );


        element.className =
            "player";


        if (
            player.id ===
            myPlayerId
        ) {

            element.classList.add(
                "me"
            );

        }


        element.style.left =
            player.x + "px";


        element.style.top =
            player.y + "px";


        element.title =
            player.name;


        world.appendChild(
            element
        );

    }

}


export function addChatMessage(
    name,
    text
) {

    const chat =
        document.getElementById(
            "chat"
        );


    const element =
        document.createElement(
            "div"
        );


    element.className =
        "chatMessage";


    element.textContent =
        `${name}: ${text}`;


    chat.appendChild(
        element
    );


    chat.scrollTop =
        chat.scrollHeight;

}


export function getChatText() {

    const input =
        document.getElementById(
            "chatMessage"
        );


    return input.value.trim();

}


export function clearChatText() {

    document
        .getElementById(
            "chatMessage"
        )
        .value = "";

}