import { GameServer } from "../game";
import { Player } from "../../common";
import {
    MC2D_ATTACK_COOLDOWN_MS,
    MC2D_ATTACK_DAMAGE,
    MC2D_ATTACK_REACH,
    MC2D_KNOCKBACK_X,
    MC2D_KNOCKBACK_Y,
    MC2D_MATCH_DURATION_SECONDS,
    MC2D_MINING_HARDNESS,
    MC2D_MINING_REACH,
    MC2D_PLAYER_HALF_HEIGHT,
    MC2D_PLAYER_HALF_WIDTH,
    MC2D_PLAYER_MAX_HP,
    MC2D_RESPAWN_DELAY_MS,
    MC2D_SEED_DEFAULT,
    MC2D_SNAPSHOT_INTERVAL_TICKS,
    MC2D_TOOL_SPEED
} from "./constants";
import { MC2D_RECIPE_BY_ID } from "./recipes";
import { distSq, sameTile } from "./utils";
import { stepPlayerPhysics } from "./physics";
import { resolveBestToolTier, resolveBestWeaponTier, toPrivatePlayerState, toPublicPlayerState } from "./sync";
import {
    BlockType,
    GameDelta,
    GameSnapshot,
    Inventory,
    MatchSummary,
    PlaceableBlock,
    PublicPlayerState,
    ServerPlayerState,
    TilePos,
    WorldBlockUpdate
} from "./types";
import { MinecraftWorld } from "./world";

const attackReachSqByWeapon = (weaponTier: string): number => {
    const reach = weaponTier === "iron"
        ? MC2D_ATTACK_REACH + 0.4
        : weaponTier === "stone"
            ? MC2D_ATTACK_REACH + 0.2
            : MC2D_ATTACK_REACH;
    return reach * reach;
};

const attackDamageByWeapon = (weaponTier: string): number => {
    if (weaponTier === "iron") return MC2D_ATTACK_DAMAGE + 8;
    if (weaponTier === "stone") return MC2D_ATTACK_DAMAGE + 4;
    return MC2D_ATTACK_DAMAGE;
};

const miningReachSq = MC2D_MINING_REACH * MC2D_MINING_REACH;

const SKIN_PALETTE = [
    "#f97316",
    "#0ea5e9",
    "#22c55e",
    "#ef4444",
    "#a855f7",
    "#eab308",
    "#f43f5e",
    "#14b8a6"
];

export class MinecraftDiamondRushServer extends GameServer {
    players: Record<string, ServerPlayerState>;
    world: MinecraftWorld;
    matchEndsAtMs: number;
    summary: MatchSummary | null;
    tickCounter: number;
    forceSnapshot: boolean;
    pendingBlockUpdates: WorldBlockUpdate[];

    constructor() {
        super();
        this.players = {};
        this.world = new MinecraftWorld(MC2D_SEED_DEFAULT);
        this.matchEndsAtMs = Date.now();
        this.summary = null;
        this.tickCounter = 0;
        this.forceSnapshot = true;
        this.pendingBlockUpdates = [];
    }

    init(players: Record<string, Player>): void {
        const seed = MC2D_SEED_DEFAULT + Math.floor(Math.random() * 50000);
        this.world = new MinecraftWorld(seed);
        this.matchEndsAtMs = Date.now() + MC2D_MATCH_DURATION_SECONDS * 1000;
        this.summary = null;
        this.tickCounter = 0;
        this.forceSnapshot = true;
        this.pendingBlockUpdates = [];

        const entries = Object.entries(players);
        this.players = {};
        entries.forEach(([id, player], index) => {
            const spawnX = -6 + index * 3;
            const spawnY = 6;
            this.players[id] = {
                id,
                name: player.name,
                character: player.character,
                skin: randomSkin(),
                x: spawnX,
                y: spawnY,
                vx: 0,
                vy: 0,
                facing: 1,
                hp: MC2D_PLAYER_MAX_HP,
                maxHp: MC2D_PLAYER_MAX_HP,
                dead: false,
                onGround: false,
                input: { left: false, right: false, jump: false },
                mining: null,
                attackReadyAtMs: 0,
                respawnAtMs: 0,
                spawn: { x: spawnX, y: spawnY },
                selectedPlaceable: "dirt",
                inventory: createEmptyInventory()
            };
        });
    }

    tick(incomingMessages: { clientId: string; payload: any }[], dt: number): { clientId?: string; payload: any }[] {
        const nowMs = Date.now();
        if (!this.summary) {
            this.handleIncomingMessages(incomingMessages, nowMs);
            this.simulatePlayers(dt, nowMs);
            this.evaluateTimeout(nowMs);
        }

        const messages: { clientId?: string; payload: any }[] = [];
        const publicPlayers = this.getPublicPlayers();
        const shouldSendSnapshot = this.forceSnapshot
            || (this.tickCounter % MC2D_SNAPSHOT_INTERVAL_TICKS === 0)
            || this.summary !== null;

        Object.keys(this.players).forEach((playerId) => {
            const self = this.players[playerId];
            const delta: GameDelta = {
                kind: "delta",
                serverNowMs: nowMs,
                matchEndsAtMs: this.matchEndsAtMs,
                diamondRevealed: this.world.diamondRevealed,
                summary: this.summary,
                players: publicPlayers,
                self: toPrivatePlayerState(self),
                blockUpdates: [...this.pendingBlockUpdates]
            };
            if (this.world.diamondRevealed || this.summary) {
                delta.diamondPos = { ...this.world.diamondPos };
            }

            messages.push({
                clientId: playerId,
                payload: delta
            });

            if (shouldSendSnapshot) {
                const snapshot: GameSnapshot = {
                    kind: "snapshot",
                    seed: this.world.seed,
                    serverNowMs: nowMs,
                    matchEndsAtMs: this.matchEndsAtMs,
                    diamondRevealed: this.world.diamondRevealed,
                    summary: this.summary,
                    players: publicPlayers,
                    self: toPrivatePlayerState(self),
                    chunks: this.world.getChunksAround(Math.floor(self.x), Math.floor(self.y))
                };
                if (this.world.diamondRevealed || this.summary) {
                    snapshot.diamondPos = { ...this.world.diamondPos };
                }
                messages.push({
                    clientId: playerId,
                    payload: snapshot
                });
            }
        });

        this.pendingBlockUpdates = [];
        this.forceSnapshot = false;
        this.tickCounter += 1;
        return messages;
    }

    isFinished(): boolean {
        return this.summary !== null;
    }

    handleIncomingMessages(messages: { clientId: string; payload: any }[], nowMs: number): void {
        messages.forEach((message) => {
            const player = this.players[message.clientId];
            if (!player) return;

            const payload = message.payload;
            if (payload.kind === "input") {
                player.input.left = !!payload.left;
                player.input.right = !!payload.right;
                player.input.jump = !!payload.jump;
                return;
            }

            if (player.dead) return;

            if (payload.kind === "mine_start") {
                const target = sanitizeTile(payload.target);
                if (!this.canReachTile(player, target)) return;
                if (this.world.getBlock(target.x, target.y) === "air") return;
                if (player.mining && sameTile(player.mining.target, target)) return;
                player.mining = {
                    target,
                    elapsedSeconds: 0
                };
            } else if (payload.kind === "mine_stop") {
                player.mining = null;
            } else if (payload.kind === "attack") {
                this.tryAttack(player, nowMs);
            } else if (payload.kind === "craft") {
                this.tryCraft(player, payload.recipeId);
            } else if (payload.kind === "select_placeable") {
                player.selectedPlaceable = payload.block;
            } else if (payload.kind === "place_block") {
                this.tryPlaceBlock(player, sanitizeTile(payload.target), payload.block);
            }
        });
    }

    simulatePlayers(dt: number, nowMs: number): void {
        Object.values(this.players).forEach((player) => {
            if (player.dead) {
                if (nowMs >= player.respawnAtMs) {
                    this.respawnPlayer(player);
                }
                return;
            }
            stepPlayerPhysics(player, player.input, this.world, dt, 1);
            this.processMining(player, dt);
        });
    }

    processMining(player: ServerPlayerState, dt: number): void {
        if (!player.mining) return;
        const target = player.mining.target;
        if (!this.canReachTile(player, target)) {
            player.mining = null;
            return;
        }

        const block = this.world.getBlock(target.x, target.y);
        if (block === "air") {
            player.mining = null;
            return;
        }

        const requiredSeconds = this.getRequiredMiningSeconds(player, block);
        player.mining.elapsedSeconds += dt;
        if (player.mining.elapsedSeconds < requiredSeconds) return;

        const result = this.world.mineBlock(target.x, target.y);
        player.mining = null;
        if (!result) return;

        this.pendingBlockUpdates.push({
            pos: { ...target },
            block: "air"
        });

        grantDrop(player.inventory, result.block);
        if (result.wasDiamond && !this.summary) {
            this.summary = {
                winnerId: player.id,
                reason: "diamond_found",
                winnerDistance: 0
            };
            this.world.diamondRevealed = true;
            this.forceSnapshot = true;
        }
    }

    tryAttack(attacker: ServerPlayerState, nowMs: number): void {
        if (nowMs < attacker.attackReadyAtMs) return;
        attacker.attackReadyAtMs = nowMs + MC2D_ATTACK_COOLDOWN_MS;
        const weaponTier = resolveBestWeaponTier(attacker.inventory);
        const reachSq = attackReachSqByWeapon(weaponTier);
        const damage = attackDamageByWeapon(weaponTier);

        let nearest: ServerPlayerState | null = null;
        let nearestDist = Number.POSITIVE_INFINITY;
        Object.values(this.players).forEach((candidate) => {
            if (candidate.id === attacker.id || candidate.dead) return;
            const dx = candidate.x - attacker.x;
            const dy = candidate.y - attacker.y;
            const distanceSq = dx * dx + dy * dy;
            if (distanceSq > reachSq) return;
            if (distanceSq < nearestDist) {
                nearestDist = distanceSq;
                nearest = candidate;
            }
        });

        if (!nearest) return;

        nearest.hp -= damage;
        const direction = nearest.x >= attacker.x ? 1 : -1;
        nearest.vx = direction * MC2D_KNOCKBACK_X;
        nearest.vy = Math.max(nearest.vy, MC2D_KNOCKBACK_Y);
        if (nearest.hp <= 0) {
            nearest.hp = 0;
            nearest.dead = true;
            nearest.respawnAtMs = nowMs + MC2D_RESPAWN_DELAY_MS;
            nearest.mining = null;
        }
    }

    tryCraft(player: ServerPlayerState, recipeId: string): void {
        const recipe = MC2D_RECIPE_BY_ID[recipeId];
        if (!recipe) return;

        for (const [item, amount] of Object.entries(recipe.requires)) {
            const key = item as keyof Inventory;
            if (player.inventory[key] < (amount ?? 0)) return;
        }

        for (const [item, amount] of Object.entries(recipe.requires)) {
            const key = item as keyof Inventory;
            player.inventory[key] -= amount ?? 0;
        }

        if (recipe.gives) {
            Object.entries(recipe.gives).forEach(([item, amount]) => {
                const key = item as keyof Inventory;
                player.inventory[key] += amount ?? 0;
            });
        }
    }

    tryPlaceBlock(player: ServerPlayerState, target: TilePos, block: PlaceableBlock): void {
        if (!this.canReachTile(player, target)) return;
        if (this.world.getBlock(target.x, target.y) !== "air") return;
        if (this.targetCollidesWithAnyPlayer(target)) return;

        const inventoryKey = getPlaceableKey(block);
        if (player.inventory[inventoryKey] <= 0) return;

        const placed = this.world.placeBlock(target.x, target.y, block);
        if (!placed) return;

        player.inventory[inventoryKey] -= 1;
        this.pendingBlockUpdates.push({
            pos: { ...target },
            block
        });
    }

    respawnPlayer(player: ServerPlayerState): void {
        player.dead = false;
        player.hp = player.maxHp;
        player.x = player.spawn.x;
        player.y = player.spawn.y;
        player.vx = 0;
        player.vy = 0;
        player.onGround = false;
        player.mining = null;
    }

    evaluateTimeout(nowMs: number): void {
        if (this.summary) return;
        if (nowMs < this.matchEndsAtMs) return;

        const diamondCenter = {
            x: this.world.diamondPos.x + 0.5,
            y: this.world.diamondPos.y + 0.5
        };

        const contenders = Object.values(this.players).map((player) => ({
            player,
            distance: Math.sqrt(distSq(player, diamondCenter))
        }));
        contenders.sort((a, b) => a.distance - b.distance);

        if (!contenders.length) {
            this.summary = {
                winnerId: null,
                reason: "time_up"
            };
        } else {
            const winner = contenders[0];
            const second = contenders[1];
            if (second && Math.abs(second.distance - winner.distance) < 0.18) {
                this.summary = {
                    winnerId: null,
                    reason: "time_up",
                    winnerDistance: winner.distance
                };
            } else {
                this.summary = {
                    winnerId: winner.player.id,
                    reason: "time_up",
                    winnerDistance: winner.distance
                };
            }
        }

        this.world.diamondRevealed = true;
        this.forceSnapshot = true;
    }

    getRequiredMiningSeconds(player: ServerPlayerState, block: BlockType): number {
        const hardness = MC2D_MINING_HARDNESS[block as keyof typeof MC2D_MINING_HARDNESS] ?? 1;
        const toolTier = resolveBestToolTier(player.inventory);
        const speed = MC2D_TOOL_SPEED[toolTier] ?? 1;
        return Math.max(0.15, hardness / speed);
    }

    canReachTile(player: ServerPlayerState, tile: TilePos): boolean {
        const center = { x: tile.x + 0.5, y: tile.y + 0.5 };
        return distSq(player, center) <= miningReachSq;
    }

    targetCollidesWithAnyPlayer(tile: TilePos): boolean {
        const tileLeft = tile.x;
        const tileRight = tile.x + 1;
        const tileBottom = tile.y;
        const tileTop = tile.y + 1;
        return Object.values(this.players).some((player) => {
            const left = player.x - MC2D_PLAYER_HALF_WIDTH;
            const right = player.x + MC2D_PLAYER_HALF_WIDTH;
            const bottom = player.y - MC2D_PLAYER_HALF_HEIGHT;
            const top = player.y + MC2D_PLAYER_HALF_HEIGHT;
            return left < tileRight
                && right > tileLeft
                && bottom < tileTop
                && top > tileBottom;
        });
    }

    getPublicPlayers(): Record<string, PublicPlayerState> {
        const output: Record<string, PublicPlayerState> = {};
        Object.values(this.players).forEach((player) => {
            output[player.id] = toPublicPlayerState(player);
        });
        return output;
    }
}

const createEmptyInventory = (): Inventory => ({
    wood: 0,
    dirt: 0,
    stone: 0,
    trunk: 0,
    iron: 0,
    pickaxe_wood: 0,
    pickaxe_stone: 0,
    pickaxe_iron: 0,
    sword_stone: 0,
    sword_iron: 0
});

const sanitizeTile = (tile: TilePos): TilePos => ({
    x: Math.floor(tile.x),
    y: Math.floor(tile.y)
});

const getPlaceableKey = (block: PlaceableBlock): keyof Inventory => {
    if (block === "dirt") return "dirt";
    if (block === "stone") return "stone";
    return "trunk";
};

const randomSkin = (): string => {
    return SKIN_PALETTE[Math.floor(Math.random() * SKIN_PALETTE.length)];
};

const grantDrop = (inventory: Inventory, block: BlockType): void => {
    if (block === "dirt" || block === "grass") {
        inventory.dirt += 1;
    } else if (block === "stone") {
        inventory.stone += 1;
    } else if (block === "iron_ore") {
        inventory.iron += 1;
    } else if (block === "trunk") {
        inventory.wood += 1;
        inventory.trunk += 1;
    }
};
