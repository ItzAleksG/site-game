export class World {

    constructor() {

        this.width = 700;

        this.height = 450;


        this.players = {};

        this.tick = 0;

    }


    addPlayer(
        id,
        name
    ) {

        this.players[id] = {

            id,

            name,

            x: 100,

            y: 100,

            hp: 100

        };

    }


    removePlayer(id) {

        delete this.players[id];

    }


    getPlayer(id) {

        return this.players[id];

    }


    movePlayer(
        id,
        dx,
        dy
    ) {

        const player =
            this.players[id];


        if (!player) {
            return;
        }


        /*
         * SERVER-SIDE VALIDATION
         */

        const speed = 10;


        dx =
            Math.max(
                -1,
                Math.min(
                    1,
                    Number(dx) || 0
                )
            );


        dy =
            Math.max(
                -1,
                Math.min(
                    1,
                    Number(dy) || 0
                )
            );


        player.x +=
            dx * speed;


        player.y +=
            dy * speed;


        /*
         * Границы мира.
         */

        player.x =
            Math.max(
                0,
                Math.min(
                    this.width,
                    player.x
                )
            );


        player.y =
            Math.max(
                0,
                Math.min(
                    this.height,
                    player.y
                )
            );

    }


    snapshot() {

        return {

            tick:
                this.tick,

            players:
                structuredClone(
                    this.players
                )

        };

    }


    update() {

        this.tick++;

    }

}