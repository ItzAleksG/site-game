export class World {
    constructor(options = {}) {
        this.width = options.width ?? 700;
        this.height = options.height ?? 450;

        this.playerSpeed = options.playerSpeed ?? 10;

        this.players = new Map();

        this.tick = 0;
    }

    addPlayer({
        id,
        name,
        x = 100,
        y = 100,
        hp = 100
    }) {
        if (!id) {
            throw new Error("Player id is required.");
        }

        if (this.players.has(id)) {
            throw new Error(
                `Player "${id}" already exists.`
            );
        }

        const player = {
            id,
            name: sanitizePlayerName(name),
            x: clamp(Number(x) || 0, 0, this.width),
            y: clamp(Number(y) || 0, 0, this.height),
            hp: clamp(Number(hp) || 0, 0, 100)
        };

        this.players.set(id, player);

        return player;
    }

    removePlayer(id) {
        return this.players.delete(id);
    }

    hasPlayer(id) {
        return this.players.has(id);
    }

    getPlayer(id) {
        return this.players.get(id) ?? null;
    }

    getPlayers() {
        return [...this.players.values()];
    }

    movePlayer(id, dx, dy) {
        const player = this.players.get(id);

        if (!player) {
            return false;
        }

        const normalizedDx = clamp(
            Number(dx) || 0,
            -1,
            1
        );

        const normalizedDy = clamp(
            Number(dy) || 0,
            -1,
            1
        );

        player.x = clamp(
            player.x + normalizedDx * this.playerSpeed,
            0,
            this.width
        );

        player.y = clamp(
            player.y + normalizedDy * this.playerSpeed,
            0,
            this.height
        );

        return true;
    }

    update() {
        this.tick += 1;
    }

    snapshot() {
        return {
            tick: this.tick,

            width: this.width,

            height: this.height,

            players: this.getPlayers().map(
                player => ({
                    id: player.id,
                    name: player.name,
                    x: player.x,
                    y: player.y,
                    hp: player.hp
                })
            )
        };
    }
}

function sanitizePlayerName(name) {
    const normalized =
        String(name ?? "")
            .trim()
            .replace(/\s+/g, " ")
            .slice(0, 24);

    return normalized || "Player";
}

function clamp(value, min, max) {
    return Math.max(
        min,
        Math.min(max, value)
    );
}
