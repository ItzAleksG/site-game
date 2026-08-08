export function getPlayerName() {

    const input =
        document.getElementById(
            "playerName"
        );


    const name =
        input.value.trim();


    return name || "Player";

}


export function showHostLobby(
    roomCode
) {

    hide("lobbyMenu");

    show("hostLobby");


    document
        .getElementById(
            "roomCode"
        )
        .textContent =
        roomCode;

}


export function showClientLobby() {

    hide("lobbyMenu");

    show("clientLobby");

}


export function showGame(
    roomCode,
    playerId
) {

    show("gameSection");


    document
        .getElementById(
            "gameRoomCode"
        )
        .textContent =
        roomCode;


    document
        .getElementById(
            "gamePlayerId"
        )
        .textContent =
        playerId;

}


export function setHostOffer(
    link
) {

    document
        .getElementById(
            "hostOffer"
        )
        .value =
        link;

}


export function getHostAnswer() {

    return document
        .getElementById(
            "hostAnswer"
        )
        .value
        .trim();

}


export function setClientAnswer(
    link
) {

    document
        .getElementById(
            "clientAnswer"
        )
        .value =
        link;

}


export function setHostStatus(
    text
) {

    document
        .getElementById(
            "hostStatus"
        )
        .textContent =
        text;

}


export function setClientStatus(
    text
) {

    document
        .getElementById(
            "clientStatus"
        )
        .textContent =
        text;

}


export function renderPlayers(
    players
) {

    const container =
        document.getElementById(
            "hostPlayers"
        );


    container.innerHTML = "";


    for (
        const player
        of players
    ) {

        const element =
            document.createElement(
                "div"
            );


        element.className =
            "playerRow";


        element.textContent =
            player.name +
            " — " +
            player.id;


        container.appendChild(
            element
        );

    }

}


function show(id) {

    document
        .getElementById(id)
        .classList
        .remove("hidden");

}


function hide(id) {

    document
        .getElementById(id)
        .classList
        .add("hidden");

}