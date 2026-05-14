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
	BlockType, GameDelta, GameSnapshot, Inventory,
	MatchSummary, PlaceableBlock, PublicPlayerState,
	ServerPlayerState, TilePos, WorldBlockUpdate
} from "./types";
import { MinecraftWorld } from "./world";

const SKIN_PALETTE = [
	"#f97316", "#0ea5e9", "#22c55e", "#ef4444",
	"#a855f7", "#eab308", "#f43f5e", "#14b8a6"
] as const;

const MINING_REACH_SQ  = MC2D_MINING_REACH * MC2D_MINING_REACH;

const attackReachSq = (tier: string): number => {
	const extra = tier === "iron" ? 0.4 : tier === "stone" ? 0.2 : 0;
	const r     = MC2D_ATTACK_REACH + extra;
	return r * r;
};

const attackDamage = (tier: string): number => {
	if (tier === "iron")  return MC2D_ATTACK_DAMAGE + 8;
	if (tier === "stone") return MC2D_ATTACK_DAMAGE + 4;
	return MC2D_ATTACK_DAMAGE;
};

const randomSkin = (): string =>
	SKIN_PALETTE[Math.floor(Math.random() * SKIN_PALETTE.length)];

const sanitizeTile = (tile: TilePos): TilePos =>
	({ x: Math.floor(tile.x), y: Math.floor(tile.y) });

const getPlaceableKey = (block: PlaceableBlock): keyof Inventory =>
	block === "dirt" ? "dirt" : block === "stone" ? "stone" : "trunk";

const createEmptyInventory = (): Inventory => ({
	wood: 0, dirt: 0, stone: 0, trunk: 0, iron: 0,
	pickaxe_wood: 0, pickaxe_stone: 0, pickaxe_iron: 0,
	sword_stone: 0, sword_iron: 0
});

const grantDrop = (inv: Inventory, block: BlockType): void => {
	if      (block === "dirt" || block === "grass") inv.dirt  += 1;
	else if (block === "stone")                     inv.stone += 1;
	else if (block === "iron_ore")                  inv.iron  += 1;
	else if (block === "trunk")                     { inv.trunk += 1 ; inv.wood += 1; };
};

export class MinecraftDiamondRushServer extends GameServer {
	players:             Record<string, ServerPlayerState>;
	world:               MinecraftWorld;
	matchEndsAtMs:       number;
	summary:             MatchSummary | null;
	tickCounter:         number;
	forceSnapshot:       boolean;
	pendingBlockUpdates: WorldBlockUpdate[];

	constructor() {
		super();
		this.players             = {};
		this.world               = new MinecraftWorld(MC2D_SEED_DEFAULT);
		this.matchEndsAtMs       = Date.now();
		this.summary             = null;
		this.tickCounter         = 0;
		this.forceSnapshot       = true;
		this.pendingBlockUpdates = [];
	}

	init(players: Record<string, Player>): void {
		const seed         = MC2D_SEED_DEFAULT + Math.floor(Math.random() * 50000);
		this.world         = new MinecraftWorld(seed);
		this.matchEndsAtMs = Date.now() + MC2D_MATCH_DURATION_SECONDS * 1000;
		this.summary       = null;
		this.tickCounter   = 0;
		this.forceSnapshot = true;
		this.pendingBlockUpdates = [];
		this.players = {};

		let index = 0;
		for (const id in players) {
			const spawnX = -6 + index * 3;
			const spawnY = 6;
			this.players[id] = {
				id,
				name:              players[id].name,
				character:         players[id].character,
				skin:              randomSkin(),
				x: spawnX, y: spawnY, vx: 0, vy: 0,
				facing:            1,
				hp:                MC2D_PLAYER_MAX_HP,
				maxHp:             MC2D_PLAYER_MAX_HP,
				dead:              false,
				onGround:          false,
				input:             { left: false, right: false, jump: false },
				mining:            null,
				attackReadyAtMs:   0,
				respawnAtMs:       0,
				spawn:             { x: spawnX, y: spawnY },
				selectedPlaceable: "dirt",
				inventory:         createEmptyInventory()
			};
			index++;
		}
	}

	tick(
		incomingMessages: { clientId: string; payload: any }[],
		dt: number
	): { clientId?: string; payload: any }[] {
		const nowMs = Date.now();

		if (!this.summary) {
			this.handleIncomingMessages(incomingMessages, nowMs);
			this.simulatePlayers(dt, nowMs);
			this.evaluateTimeout(nowMs);
		}

		const messages: { clientId?: string; payload: any }[] = [];
		const publicPlayers   = this.getPublicPlayers();
		const shouldSnapshot  = this.forceSnapshot
			|| (this.tickCounter % MC2D_SNAPSHOT_INTERVAL_TICKS === 0)
			|| this.summary !== null;
		const revealDiamond   = this.world.diamondRevealed || this.summary !== null;
		const diamondPosCopy  = revealDiamond ? { ...this.world.diamondPos } : undefined;

		for (const playerId in this.players) {
			const self = this.players[playerId];

			const delta: GameDelta = {
				kind:            "delta",
				serverNowMs:     nowMs,
				matchEndsAtMs:   this.matchEndsAtMs,
				diamondRevealed: this.world.diamondRevealed,
				summary:         this.summary,
				players:         publicPlayers,
				self:            toPrivatePlayerState(self),
				blockUpdates:    this.pendingBlockUpdates,
				diamondPos:      diamondPosCopy
			};
			messages.push({ clientId: playerId, payload: delta });

			if (shouldSnapshot) {
				const snapshot: GameSnapshot = {
					kind:            "snapshot",
					seed:            this.world.seed,
					serverNowMs:     nowMs,
					matchEndsAtMs:   this.matchEndsAtMs,
					diamondRevealed: this.world.diamondRevealed,
					summary:         this.summary,
					players:         publicPlayers,
					self:            toPrivatePlayerState(self),
					chunks:          this.world.getChunksAround(Math.floor(self.x), Math.floor(self.y)),
					diamondPos:      diamondPosCopy
				};
				messages.push({ clientId: playerId, payload: snapshot });
			}
		}

		this.pendingBlockUpdates = [];
		this.forceSnapshot       = false;
		this.tickCounter        += 1;
		return messages;
	}

	clientClosed(clientId: string): void {
		delete this.players[clientId];
	}

	isFinished(): boolean {
		return this.summary !== null || Object.keys(this.players).length === 0;
	}

	handleIncomingMessages(messages: { clientId: string; payload: any }[], nowMs: number): void {
		for (const { clientId, payload } of messages) {
			const player = this.players[clientId];
			if (!player) continue;

			if (payload.kind === "input") {
				player.input.left  = !!payload.left;
				player.input.right = !!payload.right;
				player.input.jump  = !!payload.jump;
				continue;
			}

			if (player.dead) continue;

			switch (payload.kind) {
				case "mine_start": {
					const target = sanitizeTile(payload.target);
					if (!this.canReachTile(player, target)) break;
					if (this.world.getBlock(target.x, target.y) === "air") break;
					if (player.mining && sameTile(player.mining.target, target)) break;
					player.mining = { target, elapsedSeconds: 0 };
					break;
				}
				case "mine_stop":       player.mining = null; break;
				case "attack":          this.tryAttack(player, nowMs); break;
				case "craft":           this.tryCraft(player, payload.recipeId); break;
				case "select_placeable":player.selectedPlaceable = payload.block; break;
				case "place_block":     this.tryPlaceBlock(player, sanitizeTile(payload.target), payload.block); break;
			}
		}
	}

	simulatePlayers(dt: number, nowMs: number): void {
		for (const id in this.players) {
			const player = this.players[id];

			if (player.dead) {
				if (nowMs >= player.respawnAtMs) this.respawnPlayer(player);
				continue;
			}

			stepPlayerPhysics(player, player.input, this.world, dt, 1);
			this.processMining(player, dt);
		}
	}

	processMining(player: ServerPlayerState, dt: number): void {
		if (!player.mining) return;

		const target = player.mining.target;
		if (!this.canReachTile(player, target)) { player.mining = null; return; }

		const block = this.world.getBlock(target.x, target.y);
		if (block === "air") { player.mining = null; return; }

		player.mining.elapsedSeconds += dt;
		if (player.mining.elapsedSeconds < this.requiredMiningSeconds(player, block)) return;

		const result = this.world.mineBlock(target.x, target.y);
		player.mining = null;
		if (!result) return;

		this.pendingBlockUpdates.push({ pos: { ...target }, block: "air" });
		grantDrop(player.inventory, result.block);

		if (result.wasDiamond && !this.summary) {
			this.summary                 = { winnerId: player.id, reason: "diamond_found", winnerDistance: 0 };
			this.world.diamondRevealed   = true;
			this.forceSnapshot           = true;
		}
	}

	tryAttack(attacker: ServerPlayerState, nowMs: number): void {
		if (nowMs < attacker.attackReadyAtMs) return;
		attacker.attackReadyAtMs = nowMs + MC2D_ATTACK_COOLDOWN_MS;

		const weaponTier = resolveBestWeaponTier(attacker.inventory);
		const reachSq    = attackReachSq(weaponTier);
		const damage     = attackDamage(weaponTier);

		// for...in avoids Object.values() temporary array allocation on this hot path.
		let nearest:     ServerPlayerState | null = null;
		let nearestDist: number                   = Number.POSITIVE_INFINITY;

		for (const id in this.players) {
			const c = this.players[id];
			if (c.id === attacker.id || c.dead) continue;
			const dx = c.x - attacker.x, dy = c.y - attacker.y;
			const dSq = dx * dx + dy * dy;
			if (dSq > reachSq || dSq >= nearestDist) continue;
			nearestDist = dSq;
			nearest     = c;
		}

		if (!nearest) return;

		nearest.hp  -= damage;
		const dir    = nearest.x >= attacker.x ? 1 : -1;
		nearest.vx   = dir * MC2D_KNOCKBACK_X;
		nearest.vy   = Math.max(nearest.vy, MC2D_KNOCKBACK_Y);

		if (nearest.hp <= 0) {
			nearest.hp          = 0;
			nearest.dead        = true;
			nearest.respawnAtMs = nowMs + MC2D_RESPAWN_DELAY_MS;
			nearest.mining      = null;
		}
	}

	tryCraft(player: ServerPlayerState, recipeId: string): void {
		const recipe = MC2D_RECIPE_BY_ID[recipeId];
		if (!recipe) return;

		// Check — fail fast before any mutation.
		for (const item in recipe.requires) {
			if (player.inventory[item as keyof Inventory] < recipe.requires[item]) return;
		}

		for (const item in recipe.requires) {
			(player.inventory[item as keyof Inventory] as number) -= recipe.requires[item];
		}

		if (recipe.gives) {
			for (const item in recipe.gives) {
				(player.inventory[item as keyof Inventory] as number) += recipe.gives[item]!;
			}
		}
	}

	tryPlaceBlock(player: ServerPlayerState, target: TilePos, block: PlaceableBlock): void {
		if (!this.canReachTile(player, target)) return;
		if (this.world.getBlock(target.x, target.y) !== "air") return;
		if (this.targetCollidesWithAnyPlayer(target)) return;

		const key = getPlaceableKey(block);
		if (player.inventory[key] <= 0) return;

		if (!this.world.placeBlock(target.x, target.y, block)) return;

		(player.inventory[key] as number) -= 1;
		this.pendingBlockUpdates.push({ pos: { ...target }, block });
	}

	respawnPlayer(player: ServerPlayerState): void {
		player.dead     = false;
		player.hp       = player.maxHp;
		player.x        = player.spawn.x;
		player.y        = player.spawn.y;
		player.vx       = 0;
		player.vy       = 0;
		player.onGround = false;
		player.mining   = null;
	}

	evaluateTimeout(nowMs: number): void {
		if (this.summary || nowMs < this.matchEndsAtMs) return;

		const dc = { x: this.world.diamondPos.x + 0.5, y: this.world.diamondPos.y + 0.5 };

		type Contender = { player: ServerPlayerState; distance: number };
		const contenders: Contender[] = [];
		for (const id in this.players) {
			contenders.push({ player: this.players[id], distance: Math.sqrt(distSq(this.players[id], dc)) });
		}
		contenders.sort((a, b) => a.distance - b.distance);

		if (!contenders.length) {
			this.summary = { winnerId: null, reason: "time_up" };
		} else {
			const [best, second] = contenders;
			const isTie = second && Math.abs(second.distance - best.distance) < 0.18;
			this.summary = {
				winnerId:      isTie ? null : best.player.id,
				reason:        "time_up",
				winnerDistance: best.distance
			};
		}

		this.world.diamondRevealed = true;
		this.forceSnapshot         = true;
	}

	requiredMiningSeconds(player: ServerPlayerState, block: BlockType): number {
		const hardness = MC2D_MINING_HARDNESS[block as keyof typeof MC2D_MINING_HARDNESS] ?? 1;
		const speed    = MC2D_TOOL_SPEED[resolveBestToolTier(player.inventory)] ?? 1;
		return Math.max(0.15, hardness / speed);
	}

	canReachTile(player: ServerPlayerState, tile: TilePos): boolean {
		const cx = tile.x + 0.5, cy = tile.y + 0.5;
		return (player.x - cx) * (player.x - cx) + (player.y - cy) * (player.y - cy) <= MINING_REACH_SQ;
	}

	// for...in avoids Object.values() array allocation — called every time a block is placed.
	targetCollidesWithAnyPlayer(tile: TilePos): boolean {
		const tileRight = tile.x + 1, tileTop = tile.y + 1;
		for (const id in this.players) {
			const p = this.players[id];
			if (
				p.x - MC2D_PLAYER_HALF_WIDTH  < tileRight  &&
				p.x + MC2D_PLAYER_HALF_WIDTH  > tile.x     &&
				p.y - MC2D_PLAYER_HALF_HEIGHT < tileTop    &&
				p.y + MC2D_PLAYER_HALF_HEIGHT > tile.y
			) return true;
		}
		return false;
	}

	getPublicPlayers(): Record<string, PublicPlayerState> {
		const out: Record<string, PublicPlayerState> = {};
		for (const id in this.players) out[id] = toPublicPlayerState(this.players[id]);
		return out;
	}
}
