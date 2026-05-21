import { GameClient, GameServer } from "./game";
import { Player } from "../common";
import { Button } from "../client/ui-elements";
import { UserInput } from "../client/user-input";

export const MC2D_CHUNK_SIZE = 16;
export const MC2D_TILE_SIZE_PX = 32;
export const MC2D_WORLD_MIN_X = -96;
export const MC2D_WORLD_MAX_X = 95;
export const MC2D_WORLD_MIN_Y = -84;
export const MC2D_WORLD_MAX_Y = 26;
export const MC2D_SURFACE_BASE_Y = 0;
export const MC2D_DIAMOND_MIN_Y = -72;
export const MC2D_DIAMOND_MAX_Y = -30;
export const MC2D_DIAMOND_COUNT = 4;
export const MC2D_ORE_IRON_CHANCE = 0.04;
export const MC2D_TREE_CHANCE = 0.09;
export const MC2D_MATCH_DURATION_SECONDS = 60 * 60;
export const MC2D_SNAPSHOT_INTERVAL_TICKS = 20;
export const MC2D_PLAYER_HALF_WIDTH = 0.34;
export const MC2D_PLAYER_HALF_HEIGHT = 0.9;
export const MC2D_PLAYER_MOVE_SPEED = 5.4;
export const MC2D_PLAYER_JUMP_SPEED = 9.8;
export const MC2D_PLAYER_GRAVITY = -26;
export const MC2D_PLAYER_MAX_HP = 100;
export const MC2D_MINING_REACH = 3.15;
export const MC2D_ATTACK_REACH = 1.45;
export const MC2D_ATTACK_DAMAGE = 18;
export const MC2D_ATTACK_COOLDOWN_MS = 550;
export const MC2D_KNOCKBACK_X = 3.6;
export const MC2D_KNOCKBACK_Y = 2.2;
export const MC2D_RESPAWN_DELAY_MS = 2000;
export const MC2D_REGEN_PER_SECOND = 3.5;
export const MC2D_SEED_DEFAULT = 872341;

export const MC2D_MINING_HARDNESS = {
	grass: 0.55,
	dirt: 0.5,
	trunk: 0.7,
	stone: 1.8,
	iron_ore: 2.55,
	diamond: 3.2
} as const;

export const MC2D_TOOL_SPEED = {
	hand: 0.75,
	wood: 1.1,
	stone: 1.7,
	iron: 2.35
} as const;

export type TilePos = { x: number; y: number };
type VisibleTileBounds = { left: number; right: number; top: number; bottom: number };

export type BlockType = "air" | "grass" | "dirt" | "stone" | "trunk" | "iron_ore" | "diamond";
export type PlaceableBlock = "dirt" | "stone" | "trunk";
export type ToolTier = "hand" | "wood" | "stone" | "iron";

export type Inventory = {
	wood: number;
	dirt: number;
	stone: number;
	trunk: number;
	iron: number;
	pickaxe_wood: number;
	pickaxe_stone: number;
	pickaxe_iron: number;
	sword_stone: number;
	sword_iron: number;
};

export type PlayerInput = { left: boolean; right: boolean; jump: boolean };

export type MiningState = { target: TilePos; elapsedSeconds: number } | null;

export type ServerPlayerState = {
	id: string;
	name: string;
	character: string;
	skin: string;
	x: number;
	y: number;
	vx: number;
	vy: number;
	facing: 1 | -1;
	hp: number;
	maxHp: number;
	dead: boolean;
	onGround: boolean;
	input: PlayerInput;
	mining: MiningState;
	attackReadyAtMs: number;
	respawnAtMs: number;
	spawn: TilePos;
	selectedPlaceable: PlaceableBlock;
	inventory: Inventory;
};

export type PublicPlayerState = {
	id: string;
	name: string;
	skin: string;
	x: number;
	y: number;
	vx: number;
	vy: number;
	facing: 1 | -1;
	hp: number;
	maxHp: number;
	dead: boolean;
	mining: MiningState;
};

export type PrivatePlayerState = {
	id: string;
	inventory: Inventory;
	pickaxeTier: ToolTier;
	weaponTier: ToolTier;
	selectedPlaceable: PlaceableBlock;
};

export type MatchSummary = {
	winnerId: string | null;
	reason: "diamond_found" | "time_up";
	winnerDistance?: number;
};

export type Chunk = { chunkX: number; chunkY: number; tiles: BlockType[] };

export type WorldBlockUpdate = { pos: TilePos; block: BlockType };

export type GameSnapshot = {
	kind: "snapshot";
	seed: number;
	serverNowMs: number;
	matchEndsAtMs: number;
	diamondRevealed: boolean;
	summary: MatchSummary | null;
	players: Record<string, PublicPlayerState>;
	self: PrivatePlayerState;
	chunks: Chunk[];
	diamondPos?: TilePos;
};

export type GameDelta = {
	kind: "delta";
	serverNowMs: number;
	matchEndsAtMs: number;
	diamondRevealed: boolean;
	summary: MatchSummary | null;
	players: Record<string, PublicPlayerState>;
	self: PrivatePlayerState;
	blockUpdates: WorldBlockUpdate[];
	diamondPos?: TilePos;
};

export type GameMessage = GameSnapshot | GameDelta;

export type ClientPlayerState = PublicPlayerState & { targetX: number; targetY: number };

export type LobbyPlayer = Player;

export type Recipe = {
	id: string;
	key: string;
	label: string;
	requires: Record<string, number>;
	gives?: Record<string, number>;
};

export const MC2D_RECIPES: Recipe[] = [
	{ id: "craft_pickaxe_wood", key: "1", label: "Wooden Pickaxe", requires: { wood: 3 }, gives: { pickaxe_wood: 1 } },
	{ id: "upgrade_pickaxe_stone", key: "2", label: "Stone Pick", requires: { wood: 2, stone: 4 }, gives: { pickaxe_stone: 1 } },
	{ id: "upgrade_pickaxe_iron", key: "3", label: "Iron Pick", requires: { wood: 2, iron: 4 }, gives: { pickaxe_iron: 1 } },
	{ id: "craft_sword_stone", key: "4", label: "Stone Sword", requires: { wood: 1, stone: 3 }, gives: { sword_stone: 1 } },
	{ id: "craft_sword_iron", key: "5", label: "Iron Sword", requires: { wood: 1, iron: 3 }, gives: { sword_iron: 1 } }
];

export const MC2D_RECIPE_BY_ID = Object.fromEntries(MC2D_RECIPES.map(r => [r.id, r])) as Record<string, Recipe>;
export const MC2D_RECIPE_BY_KEY = Object.fromEntries(MC2D_RECIPES.map(r => [r.key, r])) as Record<string, Recipe>;

const CHUNK_MASK = MC2D_CHUNK_SIZE - 1;
const CHUNK_SHIFT = 4;
const PLAYER_INTERPOLATION_RESPONSE_SECONDS = 0.08;
const CAMERA_FOLLOW_RESPONSE_SECONDS = 0.12;
const MAX_PHYSICS_STEP_SECONDS = 1 / 24;
const MAX_PHYSICS_SUBSTEPS = 8;

export const clamp = (value: number, min: number, max: number): number => Math.max(min, Math.min(max, value));
export const lerp = (from: number, to: number, t: number): number => from + (to - from) * t;
export const smoothFactor = (dt: number, responseSeconds: number): number => {
	if (!Number.isFinite(dt) || dt <= 0) return 0;
	if (!Number.isFinite(responseSeconds) || responseSeconds <= 0) return 1;
	return 1 - Math.exp(-dt / responseSeconds);
};

export const smoothLerp = (from: number, to: number, dt: number, responseSeconds: number): number =>
	lerp(from, to, smoothFactor(dt, responseSeconds));

export const sameTile = (a: TilePos, b: TilePos): boolean => a.x === b.x && a.y === b.y;
export const toTilePos = (x: number, y: number): TilePos => ({ x: Math.floor(x), y: Math.floor(y) });
export const chunkKey = (cx: number, cy: number): string => `${cx}:${cy}`;
export const floorDiv = (v: number, d: number): number => Math.floor(v / d);
const safeZoom = (zoom: number): number => (Number.isFinite(zoom) && zoom > 0 ? zoom : 1);

export const distSq = (a: TilePos, b: TilePos): number => {
	const dx = a.x - b.x;
	const dy = a.y - b.y;
	return dx * dx + dy * dy;
};

export const chunkCoordFromTile = (tileX: number, tileY: number) => ({
	chunkX: Math.floor(tileX / MC2D_CHUNK_SIZE),
	chunkY: Math.floor(tileY / MC2D_CHUNK_SIZE)
});

export const localTileIndex = (tileX: number, tileY: number): number => ((tileY & CHUNK_MASK) << CHUNK_SHIFT) | (tileX & CHUNK_MASK);

export const seededNoise = (seed: number, x: number, y: number): number => {
	let h = seed ^ (x * 374761393) ^ (y * 668265263);
	h = (h ^ (h >> 13)) * 1274126177;
	h ^= h >> 16;
	return (h >>> 0) / 0xffffffff;
};

type World = { isSolidAt(tileX: number, tileY: number): boolean };

export const stepPlayerPhysics = (
	body: ServerPlayerState,
	input: PlayerInput,
	world: World,
	dt: number,
	speedMultiplier: number
): void => {
	body.vx = ((input.right ? 1 : 0) - (input.left ? 1 : 0)) * MC2D_PLAYER_MOVE_SPEED * speedMultiplier;

	if (body.onGround && input.jump) {
		body.vy = MC2D_PLAYER_JUMP_SPEED;
		body.onGround = false;
	}

	body.vy += MC2D_PLAYER_GRAVITY * dt;

	resolveHorizontal(body, world, dt);
	resolveVertical(body, world, dt);

	if (Math.abs(body.vx) > 0.0001) body.facing = body.vx > 0 ? 1 : -1;
};

const resolveHorizontal = (body: ServerPlayerState, world: World, dt: number): void => {
	let nextX = body.x + body.vx * dt;
	const botTile = Math.floor(body.y - MC2D_PLAYER_HALF_HEIGHT + 0.0001);
	const topTile = Math.floor(body.y + MC2D_PLAYER_HALF_HEIGHT - 0.0001);

	if (body.vx > 0) {
		const tileX = Math.floor(nextX + MC2D_PLAYER_HALF_WIDTH);
		for (let ty = botTile; ty <= topTile; ty++) {
			if (world.isSolidAt(tileX, ty)) {
				nextX = tileX - MC2D_PLAYER_HALF_WIDTH - 0.0001;
				body.vx = 0;
				break;
			}
		}
	} else if (body.vx < 0) {
		const tileX = Math.floor(nextX - MC2D_PLAYER_HALF_WIDTH);
		for (let ty = botTile; ty <= topTile; ty++) {
			if (world.isSolidAt(tileX, ty)) {
				nextX = tileX + 1 + MC2D_PLAYER_HALF_WIDTH + 0.0001;
				body.vx = 0;
				break;
			}
		}
	}

	body.x = nextX;
};

const resolveVertical = (body: ServerPlayerState, world: World, dt: number): void => {
	let nextY = body.y + body.vy * dt;
	body.onGround = false;
	const leftTile = Math.floor(body.x - MC2D_PLAYER_HALF_WIDTH + 0.0001);
	const rightTile = Math.floor(body.x + MC2D_PLAYER_HALF_WIDTH - 0.0001);

	if (body.vy > 0) {
		const tileY = Math.floor(nextY + MC2D_PLAYER_HALF_HEIGHT);
		for (let tx = leftTile; tx <= rightTile; tx++) {
			if (world.isSolidAt(tx, tileY)) {
				nextY = tileY - MC2D_PLAYER_HALF_HEIGHT - 0.0001;
				body.vy = 0;
				break;
			}
		}
	} else if (body.vy < 0) {
		const tileY = Math.floor(nextY - MC2D_PLAYER_HALF_HEIGHT);
		for (let tx = leftTile; tx <= rightTile; tx++) {
			if (world.isSolidAt(tx, tileY)) {
				nextY = tileY + 1 + MC2D_PLAYER_HALF_HEIGHT + 0.0001;
				body.vy = 0;
				body.onGround = true;
				break;
			}
		}
	}

	body.y = nextY;
};

const copyMiningState = (mining: MiningState): MiningState => {
	if (!mining) return null;
	return {
		target: { ...mining.target },
		elapsedSeconds: mining.elapsedSeconds
	};
};

export const toPublicPlayerState = (p: ServerPlayerState): PublicPlayerState => ({
	id: p.id,
	name: p.name,
	skin: p.skin,
	x: p.x,
	y: p.y,
	vx: p.vx,
	vy: p.vy,
	facing: p.facing,
	hp: p.hp,
	maxHp: p.maxHp,
	dead: p.dead,
	mining: copyMiningState(p.mining)
});

export const resolveBestToolTier = (inv: ServerPlayerState["inventory"]): ToolTier => {
	if (inv.pickaxe_iron > 0) return "iron";
	if (inv.pickaxe_stone > 0) return "stone";
	if (inv.pickaxe_wood > 0) return "wood";
	return "hand";
};

export const resolveBestWeaponTier = (inv: ServerPlayerState["inventory"]): ToolTier => {
	if (inv.sword_iron > 0) return "iron";
	if (inv.sword_stone > 0) return "stone";
	return "hand";
};

export const toPrivatePlayerState = (p: ServerPlayerState): PrivatePlayerState => ({
	id: p.id,
	inventory: { ...p.inventory },
	pickaxeTier: resolveBestToolTier(p.inventory),
	weaponTier: resolveBestWeaponTier(p.inventory),
	selectedPlaceable: p.selectedPlaceable
});

export class MinecraftWorld {
	seed: number;
	diamondPos: TilePos;
	diamondRevealed: boolean;
	overrides: Map<number, BlockType>;

	constructor(seed: number) {
		this.seed = seed;
		this.diamondRevealed = false;
		this.overrides = new Map();
		this.diamondPos = this.pickDiamondPos();
	}

	getBlock(tileX: number, tileY: number): BlockType {
		if (tileX < MC2D_WORLD_MIN_X || tileX > MC2D_WORLD_MAX_X) return "stone";
		if (tileY < MC2D_WORLD_MIN_Y) return "stone";
		if (tileY > MC2D_WORLD_MAX_Y) return "air";

		const override = this.overrides.get(this.tileKey(tileX, tileY));
		if (override !== undefined) return override;

		if (tileX === this.diamondPos.x && tileY === this.diamondPos.y) return "diamond";

		return this.baseBlockAt(tileX, tileY);
	}

	mineBlock(tileX: number, tileY: number): { block: BlockType; wasDiamond: boolean } | null {
		if (!this.inBounds(tileX, tileY)) return null;
		const block = this.getBlock(tileX, tileY);
		if (block === "air") return null;

		const wasDiamond = tileX === this.diamondPos.x && tileY === this.diamondPos.y;
		this.overrides.set(this.tileKey(tileX, tileY), "air");
		if (wasDiamond) this.diamondRevealed = true;

		return { block, wasDiamond };
	}

	placeBlock(tileX: number, tileY: number, block: BlockType): boolean {
		if (!this.inBounds(tileX, tileY)) return false;
		if (block === "air" || this.getBlock(tileX, tileY) !== "air") return false;
		this.overrides.set(this.tileKey(tileX, tileY), block);
		return true;
	}

	isSolidAt(tileX: number, tileY: number): boolean {
		return this.getBlock(tileX, tileY) !== "air";
	}

	getChunksAround(tileX: number, tileY: number): Chunk[] {
		const cx = Math.floor(tileX / MC2D_CHUNK_SIZE);
		const cy = Math.floor(tileY / MC2D_CHUNK_SIZE);
		const DIAM_X = 2 * 4 + 1;
		const DIAM_Y = 2 * 3 + 1;
		const chunks = new Array<Chunk>(DIAM_X * DIAM_Y);
		let i = 0;

		for (let dy = -3; dy <= 3; dy++) {
			for (let dx = -4; dx <= 4; dx++) {
				chunks[i++] = this.buildChunk(cx + dx, cy + dy);
			}
		}

		return chunks;
	}

	buildChunk(chunkX: number, chunkY: number): Chunk {
		const tiles = new Array<BlockType>(MC2D_CHUNK_SIZE * MC2D_CHUNK_SIZE);

		for (let lx = 0; lx < MC2D_CHUNK_SIZE; lx++) {
			const tx = chunkX * MC2D_CHUNK_SIZE + lx;
			const surf = this.surfaceAt(tx);
			const trunk = this.trunkTopAt(tx, surf);

			for (let ly = 0; ly < MC2D_CHUNK_SIZE; ly++) {
				const ty = chunkY * MC2D_CHUNK_SIZE + ly;
				tiles[ly * MC2D_CHUNK_SIZE + lx] = this.blockAtCached(tx, ty, surf, trunk);
			}
		}

		return { chunkX, chunkY, tiles };
	}

	private blockAtCached(tileX: number, tileY: number, surf: number, trunk: number): BlockType {
		if (tileX < MC2D_WORLD_MIN_X || tileX > MC2D_WORLD_MAX_X) return "stone";
		if (tileY < MC2D_WORLD_MIN_Y) return "stone";
		if (tileY > MC2D_WORLD_MAX_Y) return "air";

		const override = this.overrides.get(this.tileKey(tileX, tileY));
		if (override !== undefined) return override;

		if (tileX === this.diamondPos.x && tileY === this.diamondPos.y) return "diamond";

		return this.baseBlockAtCached(tileX, tileY, surf, trunk);
	}

	baseBlockAt(tileX: number, tileY: number): BlockType {
		const surf = this.surfaceAt(tileX);
		const trunk = this.trunkTopAt(tileX, surf);
		return this.baseBlockAtCached(tileX, tileY, surf, trunk);
	}

	private baseBlockAtCached(tileX: number, tileY: number, surf: number, trunk: number): BlockType {
		if (tileY > surf) return tileY >= surf + 1 && tileY <= trunk ? "trunk" : "air";
		if (tileY === surf) return "grass";
		if (tileY >= surf - 3) return "dirt";

		const depth = surf - tileY;
		if (depth > 16 && seededNoise(this.seed + 9013, tileX, tileY) < MC2D_ORE_IRON_CHANCE) return "iron_ore";
		return "stone";
	}

	surfaceAt(tileX: number): number {
		const lo = seededNoise(this.seed + 17, tileX, 0);
		const hi = seededNoise(this.seed + 53, tileX * 3, 0);
		return MC2D_SURFACE_BASE_Y + Math.floor((lo - 0.5) * 6 + (hi - 0.5) * 2);
	}

	trunkTopAt(tileX: number, surfaceY: number): number {
		if (seededNoise(this.seed + 12007, tileX, 0) > MC2D_TREE_CHANCE) return surfaceY;
		return surfaceY + 2 + Math.floor(seededNoise(this.seed + 12083, tileX, 1) * 3);
	}

	pickDiamondPos(): TilePos {
		const xSpan = MC2D_WORLD_MAX_X - MC2D_WORLD_MIN_X + 1;
		const ySpan = MC2D_DIAMOND_MAX_Y - MC2D_DIAMOND_MIN_Y + 1;

		for (let attempt = 0; attempt < 512; attempt++) {
			const x = MC2D_WORLD_MIN_X + Math.floor(seededNoise(this.seed + 991, attempt, 17) * xSpan);
			const y = MC2D_DIAMOND_MIN_Y + Math.floor(seededNoise(this.seed + 31337, attempt, 41) * ySpan);
			if (this.baseBlockAt(x, y) !== "air") return { x, y };
		}

		return { x: Math.floor((MC2D_WORLD_MIN_X + MC2D_WORLD_MAX_X) / 2), y: MC2D_DIAMOND_MIN_Y };
	}

	inBounds(tileX: number, tileY: number): boolean {
		return tileX >= MC2D_WORLD_MIN_X && tileX <= MC2D_WORLD_MAX_X && tileY >= MC2D_WORLD_MIN_Y && tileY <= MC2D_WORLD_MAX_Y;
	}

	private tileKey(tileX: number, tileY: number): number {
		return (tileX + 96) * 200 + (tileY + 84);
	}
}

const SKIN_PALETTE = ["#f97316", "#0ea5e9", "#22c55e", "#ef4444", "#a855f7", "#eab308", "#f43f5e", "#14b8a6"] as const;
const MINING_REACH_SQ = MC2D_MINING_REACH * MC2D_MINING_REACH;

const attackReachSq = (tier: string): number => {
	const extra = tier === "iron" ? 0.4 : tier === "stone" ? 0.2 : 0;
	const r = MC2D_ATTACK_REACH + extra;
	return r * r;
};

const attackDamage = (tier: string): number => {
	if (tier === "iron") return MC2D_ATTACK_DAMAGE + 8;
	if (tier === "stone") return MC2D_ATTACK_DAMAGE + 4;
	return MC2D_ATTACK_DAMAGE;
};

const randomSkin = (): string => SKIN_PALETTE[Math.floor(Math.random() * SKIN_PALETTE.length)];

const sanitizeTile = (tile: TilePos): TilePos => ({ x: Math.floor(tile.x), y: Math.floor(tile.y) });

const getPlaceableKey = (block: PlaceableBlock): keyof Inventory => (block === "dirt" ? "dirt" : block === "stone" ? "stone" : "trunk");

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

const grantDrop = (inv: Inventory, block: BlockType): void => {
	if (block === "dirt" || block === "grass") inv.dirt += 1;
	else if (block === "stone") inv.stone += 1;
	else if (block === "iron_ore") inv.iron += 1;
	else if (block === "trunk") {
		inv.trunk += 1;
		inv.wood += 1;
	}
};

class ClientMessageQueue {
	private queue: any[] = [];

	enqueue(msg: any): void {
		this.queue.push(msg);
	}

	enqueueMany(msgs: any[]): void {
		for (const m of msgs) this.queue.push(m);
	}

	flush(): any[] {
		const out = this.queue;
		this.queue = [];
		return out;
	}
}

class PlayerInterpolator {
	players: Record<string, ClientPlayerState> = {};

	sync(network: Record<string, PublicPlayerState>): void {
		for (const id in network) {
			const np = network[id];
			const cur = this.players[id];

			if (!cur) {
				this.players[id] = {
					...np,
					mining: np.mining ? { target: { ...np.mining.target }, elapsedSeconds: np.mining.elapsedSeconds } : null,
					targetX: np.x,
					targetY: np.y
				};
				continue;
			}

			cur.name = np.name;
			cur.skin = np.skin;
			cur.vx = np.vx;
			cur.vy = np.vy;
			cur.facing = np.facing;
			cur.hp = np.hp;
			cur.maxHp = np.maxHp;
			cur.dead = np.dead;
			cur.mining = np.mining ? { target: { ...np.mining.target }, elapsedSeconds: np.mining.elapsedSeconds } : null;
			cur.targetX = np.x;
			cur.targetY = np.y;
		}

		for (const id in this.players) {
			if (!network[id]) delete this.players[id];
		}
	}

	step(dt: number, myId: string): void {
		for (const id in this.players) {
			const p = this.players[id];
			if (id === myId) {
				p.x = p.targetX;
				p.y = p.targetY;
			} else {
				p.x = smoothLerp(p.x, p.targetX, dt, PLAYER_INTERPOLATION_RESPONSE_SECONDS);
				p.y = smoothLerp(p.y, p.targetY, dt, PLAYER_INTERPOLATION_RESPONSE_SECONDS);
			}
		}
	}

	getPlayers(): Record<string, ClientPlayerState> {
		return this.players;
	}
}

class MinecraftInputController {
	jumpHeld = false;
	leftMouseDown = false;
	rightClickRequested = false;
	exitRequested = false;
	lastMiningTarget: TilePos | null = null;
	pointerTile: TilePos | null = null;
	oneShotMessages: any[] = [];

	private readonly onKeyDown: (e: KeyboardEvent) => void;
	private readonly onKeyUp: (e: KeyboardEvent) => void;
	private readonly onPointerDown: (e: PointerEvent) => void;
	private readonly onPointerUp: (e: PointerEvent) => void;
	private readonly onContextMenu: (e: MouseEvent) => void;

	constructor(private readonly userInput: UserInput) {
		this.onKeyDown = (e) => {
			if (e.code === "Space") this.jumpHeld = true;
			if (e.repeat) return;
			if (e.code === "KeyF") {
				this.oneShotMessages.push({ kind: "attack" });
				return;
			}

			const recipeId = CRAFT_HOTKEYS[e.code];
			if (recipeId) {
				this.oneShotMessages.push({ kind: "craft", recipeId });
				return;
			}

			const block = PLACEABLE_HOTKEYS[e.code];
			if (block) this.oneShotMessages.push({ kind: "select_placeable", block });
		};

		this.onKeyUp = (e) => {
			if (e.code === "Space") this.jumpHeld = false;
		};
		this.onPointerDown = (e) => {
			if (e.button === 0) this.leftMouseDown = true;
			if (e.button === 2) this.rightClickRequested = true;
		};
		this.onPointerUp = (e) => {
			if (e.button === 0) this.leftMouseDown = false;
		};
		this.onContextMenu = (e) => e.preventDefault();

		document.addEventListener("keydown", this.onKeyDown);
		document.addEventListener("keyup", this.onKeyUp);
		userInput.canvas.addEventListener("pointerdown", this.onPointerDown);
		userInput.canvas.addEventListener("pointerup", this.onPointerUp);
		userInput.canvas.addEventListener("contextmenu", this.onContextMenu);
	}

	screenToTile(camera: { x: number; y: number; zoom: number }): TilePos {
		const scale = MC2D_TILE_SIZE_PX * camera.zoom;
		const worldX = (this.userInput.mouseX - this.userInput.screenW / 2) / scale + camera.x;
		const worldY = -((this.userInput.mouseY - this.userInput.screenH / 2) / scale) + camera.y;
		return { x: Math.floor(worldX), y: Math.floor(worldY) };
	}

	consumeExitRequested(): boolean {
		if (!this.exitRequested) return false;
		this.exitRequested = false;
		return true;
	}

	getPointerTile(): TilePos | null {
		return this.pointerTile;
	}

	dispose(): void {
		document.removeEventListener("keydown", this.onKeyDown);
		document.removeEventListener("keyup", this.onKeyUp);
		this.userInput.canvas.removeEventListener("pointerdown", this.onPointerDown);
		this.userInput.canvas.removeEventListener("pointerup", this.onPointerUp);
		this.userInput.canvas.removeEventListener("contextmenu", this.onContextMenu);
	}
}

class PixelRenderer {
	private drawCommonShading(ctx: CanvasRenderingContext2D, x: number, y: number): void {
		ctx.fillStyle = "rgba(255, 255, 255, 0.10)";
		ctx.fillRect(x, y, 1, 0.12);
		ctx.fillStyle = "rgba(0, 0, 0, 0.09)";
		ctx.fillRect(x, y + 0.84, 1, 0.16);
		ctx.fillRect(x + 0.84, y, 0.16, 1);
	}

	private drawGrassTile(ctx: CanvasRenderingContext2D, x: number, y: number): void {
		ctx.fillStyle = "#78bf50";
		ctx.fillRect(x, y + 0.72, 1, 0.28);
		ctx.fillStyle = "#7b5535";
		ctx.fillRect(x, y, 1, 0.72);
		ctx.fillStyle = "rgba(43, 138, 67, 0.42)";
		ctx.fillRect(x + 0.08, y + 0.04, 0.08, 0.17);
		ctx.fillRect(x + 0.34, y + 0.02, 0.07, 0.14);
		ctx.fillRect(x + 0.64, y + 0.05, 0.09, 0.16);
	}

	private drawDirtTile(ctx: CanvasRenderingContext2D, x: number, y: number): void {
		ctx.fillStyle = "#7d5a3a";
		ctx.fillRect(x, y, 1, 1);
		ctx.fillStyle = "rgba(158, 109, 72, 0.30)";
		ctx.fillRect(x + 0.08, y + 0.06, 0.20, 0.12);
		ctx.fillRect(x + 0.54, y + 0.10, 0.20, 0.10);
		ctx.fillRect(x + 0.30, y + 0.18, 0.12, 0.08);
		ctx.fillStyle = "rgba(73, 48, 29, 0.28)";
		ctx.fillRect(x + 0.16, y + 0.56, 0.10, 0.10);
		ctx.fillRect(x + 0.42, y + 0.64, 0.08, 0.08);
		ctx.fillRect(x + 0.68, y + 0.48, 0.08, 0.08);
		ctx.fillStyle = "rgba(121, 84, 52, 0.22)";
		ctx.fillRect(x + 0.22, y + 0.28, 0.10, 0.08);
		ctx.fillRect(x + 0.60, y + 0.30, 0.08, 0.08);
	}

	private drawStoneTile(ctx: CanvasRenderingContext2D, x: number, y: number): void {
		ctx.fillStyle = "#8c96a0";
		ctx.fillRect(x, y, 1, 1);
		ctx.fillStyle = "rgba(255, 255, 255, 0.12)";
		ctx.fillRect(x + 0.08, y + 0.08, 0.20, 0.10);
		ctx.fillRect(x + 0.56, y + 0.10, 0.16, 0.10);
		ctx.fillRect(x + 0.30, y + 0.24, 0.08, 0.06);
		ctx.fillStyle = "rgba(92, 103, 117, 0.34)";
		ctx.fillRect(x + 0.14, y + 0.20, 0.10, 0.08);
		ctx.fillRect(x + 0.36, y + 0.32, 0.08, 0.08);
		ctx.fillRect(x + 0.66, y + 0.22, 0.08, 0.08);
		ctx.fillRect(x + 0.22, y + 0.60, 0.10, 0.08);
		ctx.fillRect(x + 0.54, y + 0.66, 0.10, 0.08);
		ctx.fillRect(x + 0.78, y + 0.44, 0.06, 0.08);
	}

	private drawTrunkTile(ctx: CanvasRenderingContext2D, x: number, y: number): void {
		ctx.fillStyle = "#8a5b36";
		ctx.fillRect(x, y, 1, 1);
		ctx.fillStyle = "rgba(101, 62, 34, 0.78)";
		ctx.fillRect(x + 0.16, y, 0.06, 1);
		ctx.fillRect(x + 0.46, y, 0.08, 1);
		ctx.fillRect(x + 0.72, y, 0.05, 1);
		ctx.fillStyle = "rgba(171, 121, 75, 0.26)";
		ctx.fillRect(x + 0.08, y + 0.10, 0.12, 0.12);
		ctx.fillRect(x + 0.58, y + 0.58, 0.10, 0.10);
		ctx.fillRect(x + 0.26, y + 0.34, 0.08, 0.08);
	}

	private drawIronTile(ctx: CanvasRenderingContext2D, x: number, y: number): void {
		ctx.fillStyle = "#8d949d";
		ctx.fillRect(x, y, 1, 1);
		ctx.fillStyle = "rgba(255, 255, 255, 0.10)";
		ctx.fillRect(x + 0.07, y + 0.06, 0.22, 0.15);
		ctx.fillStyle = "rgba(186, 128, 82, 0.90)";
		ctx.fillRect(x + 0.12, y + 0.18, 0.10, 0.10);
		ctx.fillRect(x + 0.30, y + 0.30, 0.10, 0.10);
		ctx.fillRect(x + 0.52, y + 0.18, 0.10, 0.10);
		ctx.fillRect(x + 0.64, y + 0.42, 0.09, 0.09);
		ctx.fillRect(x + 0.34, y + 0.66, 0.10, 0.10);
		ctx.fillStyle = "rgba(120, 78, 46, 0.70)";
		ctx.fillRect(x + 0.22, y + 0.24, 0.04, 0.04);
		ctx.fillRect(x + 0.56, y + 0.24, 0.04, 0.04);
	}

	private drawDiamondTile(ctx: CanvasRenderingContext2D, x: number, y: number): void {
		ctx.fillStyle = "#2bc4d1";
		ctx.fillRect(x, y, 1, 1);
		ctx.fillStyle = "rgba(255, 255, 255, 0.18)";
		ctx.fillRect(x + 0.08, y + 0.08, 0.22, 0.20);
		ctx.fillRect(x + 0.42, y + 0.26, 0.18, 0.18);
		ctx.fillStyle = "rgba(8, 120, 132, 0.36)";
		ctx.fillRect(x + 0.54, y + 0.56, 0.26, 0.22);
		ctx.fillRect(x + 0.16, y + 0.58, 0.14, 0.14);
		ctx.fillStyle = "rgba(255, 255, 255, 0.34)";
		ctx.fillRect(x + 0.66, y + 0.14, 0.08, 0.08);
	}

	private drawTileTexture(ctx: CanvasRenderingContext2D, block: string, x: number, y: number): void {
		switch (block) {
			case "grass": this.drawGrassTile(ctx, x, y); break;
			case "dirt": this.drawDirtTile(ctx, x, y); break;
			case "stone": this.drawStoneTile(ctx, x, y); break;
			case "trunk": this.drawTrunkTile(ctx, x, y); break;
			case "iron_ore": this.drawIronTile(ctx, x, y); break;
			case "diamond": this.drawDiamondTile(ctx, x, y); break;
			default:
				ctx.fillStyle = blockColor(block);
				ctx.fillRect(x, y, 1, 1);
		}
		this.drawCommonShading(ctx, x, y);
	}

	drawWorld(
		ctx: CanvasRenderingContext2D,
		screenW: number,
		screenH: number,
		chunks: Record<string, Chunk>,
		players: Record<string, ClientPlayerState>,
		camera: { x: number; y: number; zoom: number },
		myId: string,
		miningTarget: TilePos | null,
		miningTargetReachable: boolean,
		diamondPos: TilePos | null
	): void {
		const safeScreenW = Math.max(1, screenW);
		const safeScreenH = Math.max(1, screenH);
		const zoom = safeZoom(camera.zoom);
		const scale = zoom * MC2D_TILE_SIZE_PX;
		const cameraX = Number.isFinite(camera.x) ? camera.x : (MC2D_WORLD_MIN_X + MC2D_WORLD_MAX_X + 1) / 2;
		const cameraY = Number.isFinite(camera.y) ? camera.y : (MC2D_WORLD_MIN_Y + MC2D_WORLD_MAX_Y + 1) / 2;
		const visibleHalfW = safeScreenW / (2 * scale);
		const visibleHalfH = safeScreenH / (2 * scale);
		const visibleBounds: VisibleTileBounds = {
			left: Math.floor(cameraX - visibleHalfW) - 1,
			right: Math.ceil(cameraX + visibleHalfW) + 1,
			top: Math.floor(cameraY - visibleHalfH) - 1,
			bottom: Math.ceil(cameraY + visibleHalfH) + 1
		};

		this.drawBackground(ctx, safeScreenW, safeScreenH);
		ctx.save();
		ctx.translate(safeScreenW / 2, safeScreenH / 2);
		ctx.scale(scale, -scale);
		ctx.translate(-cameraX, -cameraY);
		this.drawTiles(ctx, chunks, visibleBounds);
		this.drawPlayers(ctx, players, myId);
		this.drawMiningTarget(ctx, miningTarget, miningTargetReachable);
		this.drawDiamondPing(ctx, diamondPos);
		ctx.restore();
	}

	drawBackground(ctx: CanvasRenderingContext2D, w: number, h: number): void {
		const sky = ctx.createLinearGradient(0, 0, 0, h);
		sky.addColorStop(0, "#77bde0");
		sky.addColorStop(0.52, "#4d8db3");
		sky.addColorStop(1, "#16202b");
		ctx.fillStyle = sky;
		ctx.fillRect(0, 0, w, h);
	}

	drawTiles(ctx: CanvasRenderingContext2D, chunks: Record<string, Chunk>, visibleBounds: VisibleTileBounds): void {
		const SIZE = MC2D_CHUNK_SIZE;

		for (const key in chunks) {
			const chunk = chunks[key];
			const tiles = chunk.tiles;
			const baseX = chunk.chunkX * SIZE;
			const baseY = chunk.chunkY * SIZE;
			const chunkRight = baseX + SIZE - 1;
			const chunkBottom = baseY + SIZE - 1;

			if (chunkRight < visibleBounds.left || baseX > visibleBounds.right || chunkBottom < visibleBounds.top || baseY > visibleBounds.bottom) {
				continue;
			}

			const startX = Math.max(0, visibleBounds.left - baseX);
			const endX = Math.min(SIZE - 1, visibleBounds.right - baseX);
			const startY = Math.max(0, visibleBounds.top - baseY);
			const endY = Math.min(SIZE - 1, visibleBounds.bottom - baseY);

			for (let ly = startY; ly <= endY; ly++) {
				const rowOffset = ly * SIZE;
				const tileY = baseY + ly;

				for (let lx = startX; lx <= endX; lx++) {
					const block = tiles[rowOffset + lx];
					if (block === "air") continue;
					this.drawTileTexture(ctx, block, baseX + lx, tileY);
				}
			}
		}
	}

	drawPlayers(ctx: CanvasRenderingContext2D, players: Record<string, ClientPlayerState>, myId: string): void {
		const BODY_W = 0.68;
		const BODY_H = 1.8;

		for (const id in players) {
			const p = players[id];
			ctx.globalAlpha = p.dead ? 0.4 : 1;
			ctx.fillStyle = p.skin;
			ctx.fillRect(p.x - BODY_W / 2, p.y - BODY_H / 2, BODY_W, BODY_H);
			ctx.fillStyle = "rgba(18, 18, 18, 0.55)";
			ctx.fillRect(p.x - 0.5, p.y + 1.02, 1, 0.18);
			ctx.fillStyle = "#22c55e";
			ctx.fillRect(p.x - 0.5, p.y + 1.02, Math.max(0, Math.min(1, p.hp / p.maxHp)), 0.18);
		}

		ctx.globalAlpha = 1;
	}

	drawMiningTarget(ctx: CanvasRenderingContext2D, target: TilePos | null, reachable: boolean): void {
		if (!target) return;
		ctx.lineWidth = 2 / (MC2D_TILE_SIZE_PX * 0.6);
		ctx.strokeStyle = reachable ? "#f8fafc" : "#ef4444";
		ctx.strokeRect(target.x, target.y, 1, 1);
	}

	drawDiamondPing(ctx: CanvasRenderingContext2D, pos: TilePos | null): void {
		if (!pos) return;
		ctx.fillStyle = "rgba(41, 184, 197, 0.45)";
		ctx.fillRect(pos.x, pos.y, 1, 1);
	}
}

const HOTBAR_SLOTS = [
	{ key: "dirt", label: "Dirt", tint: "#9b6a3f" },
	{ key: "stone", label: "Stone", tint: "#8b96a3" },
	{ key: "trunk", label: "Trunk", tint: "#7d4e2e" },
	{ key: "wood", label: "Wood", tint: "#a4703f" },
	{ key: "iron", label: "Iron", tint: "#c07c4c" },
	{ key: "pickaxe_wood", label: "Pickaxe", tint: "#e2e8f0" }
] as const;

const BLOCK_LABELS: Record<string, string> = {
	air: "Air",
	grass: "Grass",
	dirt: "Dirt",
	trunk: "Trunk",
	stone: "Stone",
	iron_ore: "Iron Ore",
	diamond: "Diamond"
};

const BLOCK_COLORS: Record<string, string> = {
	grass: "#6cab4f",
	dirt: "#7d5a3a",
	trunk: "#8a5b36",
	stone: "#8c96a0",
	iron_ore: "#b77f50",
	diamond: "#2bc4d1"
};

const MATERIAL_NAMES: Record<string, string> = {
	wood: "Wood",
	stone: "Stone",
	trunk: "Trunk",
	iron: "Iron",
	dirt: "Dirt",
	diamond: "Diamond"
};

const CRAFT_HOTKEYS: Record<string, string> = {
	Digit1: "craft_pickaxe_wood",
	Digit2: "upgrade_pickaxe_stone",
	Digit3: "upgrade_pickaxe_iron",
	Digit4: "craft_sword_stone",
	Digit5: "craft_sword_iron"
};

const PLACEABLE_HOTKEYS: Record<string, PlaceableBlock> = {
	KeyZ: "dirt",
	KeyX: "stone",
	KeyC: "trunk"
};

const blockColor = (block: string): string => BLOCK_COLORS[block] ?? "#111827";
const formatMaterialName = (mat: string): string => MATERIAL_NAMES[mat] ?? mat;

export class MinecraftDiamondRushClient extends GameClient {
	networkQueue: ClientMessageQueue;
	controller: MinecraftInputController;
	interpolator: PlayerInterpolator;
	renderer: PixelRenderer;
	chunks: Record<string, Chunk>;
	lobbyPlayers: Record<string, LobbyPlayer>;
	privateState: PrivatePlayerState | null;
	summary: GameSnapshot["summary"] | GameDelta["summary"] | null;
	matchEndsAtMs: number;
	diamondPos: TilePos | null;
	camera: { x: number; y: number; zoom: number };
	wantsExit: boolean;
	disposed: boolean;
	exitButton: Button;

	pointerReachable = false;
	pointerBlock: string | null = null;

	constructor(userInput: UserInput, myId: string) {
		super(userInput, myId);
		this.networkQueue = new ClientMessageQueue();
		this.controller = new MinecraftInputController(userInput);
		this.interpolator = new PlayerInterpolator();
		this.renderer = new PixelRenderer();
		this.chunks = {};
		this.lobbyPlayers = {};
		this.privateState = null;
		this.summary = null;
		this.matchEndsAtMs = Date.now() + MC2D_MATCH_DURATION_SECONDS * 1000;
		this.diamondPos = null;
		this.camera = { x: 0, y: 0, zoom: 1 };
		this.wantsExit = false;
		this.disposed = false;
		this.exitButton = new Button("Torna alla lobby", this.userInput, () => {
			this.wantsExit = true;
		});
		this.exitButton.setColors({ main: "#2563eb" });
	}

	private getUiScale(): number {
		const shortestSide = Math.max(1, Math.min(this.userInput.screenW, this.userInput.screenH));
		return Math.max(0.85, Math.min(1.35, shortestSide / 900));
	}

	private clampCameraToWorld(): void {
		const screenW = Math.max(1, this.userInput.screenW);
		const screenH = Math.max(1, this.userInput.screenH);
		this.camera.zoom = safeZoom(this.camera.zoom);
		if (!Number.isFinite(this.camera.x) || !Number.isFinite(this.camera.y)) {
			this.camera.x = (MC2D_WORLD_MIN_X + MC2D_WORLD_MAX_X + 1) / 2;
			this.camera.y = (MC2D_WORLD_MIN_Y + MC2D_WORLD_MAX_Y + 1) / 2;
		}
		const scale = this.camera.zoom * MC2D_TILE_SIZE_PX;
		const halfViewW = screenW / (2 * scale);
		const halfViewH = screenH / (2 * scale);
		const worldMinX = MC2D_WORLD_MIN_X;
		const worldMaxX = MC2D_WORLD_MAX_X + 1;
		const worldMinY = MC2D_WORLD_MIN_Y;
		const worldMaxY = MC2D_WORLD_MAX_Y + 1;
		const minCameraX = worldMinX + halfViewW;
		const maxCameraX = worldMaxX - halfViewW;
		const minCameraY = worldMinY + halfViewH;
		const maxCameraY = worldMaxY - halfViewH;

		this.camera.x = minCameraX <= maxCameraX ? clamp(this.camera.x, minCameraX, maxCameraX) : (worldMinX + worldMaxX) / 2;
		this.camera.y = minCameraY <= maxCameraY ? clamp(this.camera.y, minCameraY, maxCameraY) : (worldMinY + worldMaxY) / 2;
	}

	init(players: Record<string, Player>): Promise<void> {
		Object.assign(this.lobbyPlayers, players);
		return Promise.resolve();
	}

	draw(ctx: CanvasRenderingContext2D, dt: number): void {
		if (!this.privateState) {
			this.drawWaitingScreen(ctx);
			return;
		}

		const players = this.interpolator.getPlayers();
		const me = players[this.myId];

		if (!this.summary) {
			this.networkQueue.enqueueMany(this.collectInputMessages());
			this.interpolator.step(dt, this.myId);

			if (me) {
				this.camera.x = smoothLerp(this.camera.x, me.x, dt, CAMERA_FOLLOW_RESPONSE_SECONDS);
				this.camera.y = smoothLerp(this.camera.y, me.y, dt, CAMERA_FOLLOW_RESPONSE_SECONDS);
			}

			this.clampCameraToWorld();
			this.updatePointerState(me);
			this.networkQueue.enqueueMany(this.collectPointerMessages());
		}

		this.renderer.drawWorld(
			ctx,
			this.userInput.screenW,
			this.userInput.screenH,
			this.chunks,
			players,
			this.camera,
			this.myId,
			this.controller.getPointerTile(),
			this.pointerReachable,
			this.diamondPos
		);
		this.drawPlayerLabels(ctx, players);
		this.drawTopInfo(ctx, me);
		this.drawRecipeSidebar(ctx);
		this.drawHotbar(ctx);
		this.drawPickaxeSlot(ctx);
		this.drawHoverBlockInfo(ctx, me);
		if (this.summary) this.drawSummaryOverlay(ctx);
	}

	handleMessage(message: GameMessage): void {
		if (message.kind === "snapshot") this.applySnapshot(message);
		else this.applyDelta(message);
	}

	flushMessages(): any[] {
		return this.networkQueue.flush();
	}

	isFinished(): boolean {
		return this.wantsExit;
	}

	collectInputMessages(): any[] {
		const msgs: any[] = [{
			kind: "input",
			left: this.userInput.moveDirectionX < -0.1,
			right: this.userInput.moveDirectionX > 0.1,
			jump: this.controller.jumpHeld || this.userInput.moveDirectionY < -0.1
		}];

		if (this.controller.oneShotMessages.length) {
			for (const m of this.controller.oneShotMessages) msgs.push(m);
			this.controller.oneShotMessages = [];
		}

		return msgs;
	}

	collectPointerMessages(): any[] {
		const msgs: any[] = [];
		const pointer: TilePos | null = this.controller.pointerTile;

		if (this.controller.leftMouseDown && pointer && this.pointerReachable) {
			if (!this.controller.lastMiningTarget || !sameTile(this.controller.lastMiningTarget, pointer)) {
				msgs.push({ kind: "mine_start", target: { ...pointer } });
				this.controller.lastMiningTarget = { ...pointer };
			}
		} else if (this.controller.lastMiningTarget) {
			msgs.push({ kind: "mine_stop" });
			this.controller.lastMiningTarget = null;
		}

		if (this.controller.rightClickRequested && pointer && this.privateState) {
			msgs.push({ kind: "place_block", target: { ...pointer }, block: this.privateState.selectedPlaceable });
		}

		this.controller.rightClickRequested = false;
		return msgs;
	}

	updatePointerState(me: ClientPlayerState | undefined): void {
		const pt = this.controller.screenToTile(this.camera);
		this.controller.pointerTile = pt;
		this.pointerBlock = pt ? this.getBlockAt(pt) : null;

		if (me && pt) {
			this.pointerReachable = distSq(me, { x: pt.x + 0.5, y: pt.y + 0.5 }) <= MC2D_MINING_REACH * MC2D_MINING_REACH;
		} else {
			this.pointerReachable = false;
		}
	}

	canCraftRecipe(recipeId: string): boolean {
		if (!this.privateState) return false;
		const recipe = MC2D_RECIPE_BY_ID[recipeId];
		if (!recipe) return false;
		const inv = this.privateState.inventory;
		for (const mat in recipe.requires) {
			if ((inv[mat as keyof typeof inv] as number) < recipe.requires[mat]) return false;
		}
		return true;
	}

	applySnapshot(snapshot: GameSnapshot): void {
		this.matchEndsAtMs = snapshot.matchEndsAtMs;
		this.summary = snapshot.summary;
		this.privateState = snapshot.self;
		if (snapshot.diamondPos) this.diamondPos = { ...snapshot.diamondPos };

		this.interpolator.sync(snapshot.players);

		for (const key in this.chunks) delete this.chunks[key];
		for (const chunk of snapshot.chunks) {
			this.chunks[chunkKey(chunk.chunkX, chunk.chunkY)] = {
				chunkX: chunk.chunkX,
				chunkY: chunk.chunkY,
				tiles: [...chunk.tiles]
			};
		}
	}

	applyDelta(delta: GameDelta): void {
		this.matchEndsAtMs = delta.matchEndsAtMs;
		this.summary = delta.summary;
		if (delta.diamondPos) this.diamondPos = { ...delta.diamondPos };
		if (delta.self) this.privateState = delta.self;

		this.interpolator.sync(delta.players);
		for (const update of delta.blockUpdates) this.applyBlockUpdate(update);
	}

	applyBlockUpdate(update: { pos: TilePos; block: BlockType }): void {
		const coords = chunkCoordFromTile(update.pos.x, update.pos.y);
		const key = chunkKey(coords.chunkX, coords.chunkY);

		if (!this.chunks[key]) {
			this.chunks[key] = {
				chunkX: coords.chunkX,
				chunkY: coords.chunkY,
				tiles: new Array(MC2D_CHUNK_SIZE * MC2D_CHUNK_SIZE).fill("air")
			};
		}

		this.chunks[key].tiles[localTileIndex(update.pos.x, update.pos.y)] = update.block;
	}

	getBlockAt(tile: TilePos): string | null {
		const coords = chunkCoordFromTile(tile.x, tile.y);
		const chunk = this.chunks[chunkKey(coords.chunkX, coords.chunkY)];
		return chunk ? chunk.tiles[localTileIndex(tile.x, tile.y)] ?? null : null;
	}

	screenToTile(screenX: number, screenY: number): TilePos {
		const screenW = Math.max(1, this.userInput.screenW);
		const screenH = Math.max(1, this.userInput.screenH);
		const scale = MC2D_TILE_SIZE_PX * safeZoom(this.camera.zoom);
		const cameraX = Number.isFinite(this.camera.x) ? this.camera.x : 0;
		const cameraY = Number.isFinite(this.camera.y) ? this.camera.y : 0;
		const worldX = (screenX - screenW / 2) / scale + cameraX;
		const worldY = -((screenY - screenH / 2) / scale) + cameraY;
		return { x: Math.floor(worldX), y: Math.floor(worldY) };
	}

	worldToScreen(worldX: number, worldY: number): { x: number; y: number } {
		const scale = safeZoom(this.camera.zoom) * MC2D_TILE_SIZE_PX;
		const cameraX = Number.isFinite(this.camera.x) ? this.camera.x : 0;
		const cameraY = Number.isFinite(this.camera.y) ? this.camera.y : 0;
		return {
			x: Math.max(0, this.userInput.screenW) / 2 + (worldX - cameraX) * scale,
			y: Math.max(0, this.userInput.screenH) / 2 - (worldY - cameraY) * scale
		};
	}

	drawPlayerLabels(ctx: CanvasRenderingContext2D, players: Record<string, ClientPlayerState>): void {
		const uiScale = this.getUiScale();
		ctx.font = `${Math.round(14 * uiScale)}px monospace`;
		ctx.textAlign = "center";
		ctx.textBaseline = "middle";

		for (const id in players) {
			const p = players[id];
			const screen = this.worldToScreen(p.x, p.y + 1.45);
			ctx.fillStyle = "rgba(0, 0, 0, 0.68)";
			ctx.fillRect(screen.x - 54 * uiScale, screen.y - 16 * uiScale, 108 * uiScale, 16 * uiScale);
			ctx.fillStyle = "#f8fafc";
			ctx.fillText(p.name, screen.x, screen.y - 8 * uiScale);
			ctx.fillStyle = "#ffffff";
			ctx.fillText(`${Math.ceil(p.hp)} HP`, screen.x, screen.y - 24 * uiScale);
		}
	}

	drawTopInfo(ctx: CanvasRenderingContext2D, me: ClientPlayerState | undefined): void {
		const uiScale = this.getUiScale();
		const secondsLeft = Math.max(0, (this.matchEndsAtMs - Date.now()) / 1000);
		const W = this.userInput.screenW;
		const pad = 12 * uiScale;
		const topY = 10 * uiScale;
		const topH = 52 * uiScale;
		const topW = Math.max(0, W - pad * 2);

		ctx.fillStyle = "rgba(0, 0, 0, 0.62)";
		ctx.fillRect(pad, topY, topW, topH);

		ctx.fillStyle = "#f8fafc";
		ctx.font = `${Math.round(16 * uiScale)}px monospace`;
		ctx.textAlign = "left";
		ctx.textBaseline = "middle";

		const name = me?.name ?? this.lobbyPlayers[this.myId]?.name ?? "Player";
		const hp = me ? Math.ceil(me.hp) : 0;
		const depth = me ? Math.max(0, Math.floor(-me.y)) : 0;
		const tool = this.privateState?.pickaxeTier ?? "hand";
		const weapon = this.privateState?.weaponTier ?? "hand";

		ctx.fillText(`${name} | Time ${Math.ceil(secondsLeft)}s | HP ${hp} | Depth ${depth} | Tool ${tool} | Weapon ${weapon}`, 24 * uiScale, topY + topH / 2);
	}

	drawRecipeSidebar(ctx: CanvasRenderingContext2D): void {
		const uiScale = this.getUiScale();
		const margin = Math.round(12 * uiScale);
		const basePanelW = 280;
		const basePanelH = 250 + MC2D_RECIPES.length * 50;
		const maxPanelW = Math.max(0, this.userInput.screenW - margin * 2);
		const maxPanelH = Math.max(0, this.userInput.screenH - Math.round(72 * uiScale) - margin);
		const panelScale = Math.min(uiScale, maxPanelW / basePanelW, maxPanelH / basePanelH);
		if (panelScale <= 0) return;

		const panelW = Math.round(basePanelW * panelScale);
		const panelH = Math.round(basePanelH * panelScale);
		const panelX = Math.max(margin, this.userInput.screenW - panelW - margin);
		const panelY = Math.round(72 * panelScale);

		ctx.fillStyle = "rgba(3, 7, 18, 0.72)";
		ctx.fillRect(panelX, panelY, panelW, panelH);
		ctx.strokeStyle = "rgba(248, 250, 252, 0.18)";
		ctx.lineWidth = Math.max(1, Math.round(2 * panelScale));
		ctx.strokeRect(panelX, panelY, panelW, panelH);

		ctx.fillStyle = "#f8fafc";
		ctx.font = `bold ${Math.round(15 * panelScale)}px monospace`;
		ctx.textAlign = "left";
		ctx.textBaseline = "top";
		ctx.fillText("Objective: mine diamond", panelX + 12 * panelScale, panelY + 10 * panelScale);
		ctx.font = `bold ${Math.round(16 * panelScale)}px monospace`;
		ctx.fillText("Recipes", panelX + 12 * panelScale, panelY + 38 * panelScale);

		let cursorY = panelY + 64 * panelScale;
		for (const recipe of MC2D_RECIPES) {
			const craftable = this.canCraftRecipe(recipe.id);
			const materials = Object.entries(recipe.requires).map(([mat, amt]) => `${formatMaterialName(mat)} x${amt}`).join("  ");
			ctx.fillStyle = craftable ? "rgba(34, 197, 94, 0.14)" : "rgba(255, 255, 255, 0.06)";
			ctx.fillRect(panelX + 8 * panelScale, cursorY - 2 * panelScale, panelW - 16 * panelScale, 44 * panelScale);
			ctx.fillStyle = craftable ? "#86efac" : "#f8fafc";
			ctx.font = `bold ${Math.round(13 * panelScale)}px monospace`;
			ctx.fillText(`${recipe.key}. ${recipe.label}`, panelX + 12 * panelScale, cursorY);
			ctx.font = `${Math.round(12 * panelScale)}px monospace`;
			ctx.fillStyle = "#cbd5e1";
			ctx.fillText(materials, panelX + 12 * panelScale, cursorY + 16 * panelScale);
			cursorY += 50 * panelScale;
		}

		cursorY += 8 * panelScale;
		ctx.fillStyle = "#f8fafc";
		ctx.font = `bold ${Math.round(15 * panelScale)}px monospace`;
		ctx.fillText("Base controls", panelX + 12 * panelScale, cursorY);
		ctx.font = `${Math.round(12 * panelScale)}px monospace`;
		ctx.fillStyle = "#cbd5e1";
		const controls = ["A/D move", "W or Space jump", "Mouse aim", "left click mine", "right click place", "F attack", "Z/X/C select block", "1-5 craft"];
		for (let i = 0; i < controls.length; i++) {
			ctx.fillText(controls[i], panelX + 12 * panelScale, cursorY + 20 * panelScale + i * 16 * panelScale);
		}
	}

	drawHotbar(ctx: CanvasRenderingContext2D): void {
		if (!this.privateState) return;
		const uiScale = this.getUiScale();
		const margin = Math.round(12 * uiScale);
		let slotSize = Math.max(18, Math.round(58 * uiScale));
		let spacing = Math.max(2, Math.round(8 * uiScale));
		const availableW = Math.max(0, this.userInput.screenW - margin * 2);
		let totalW = HOTBAR_SLOTS.length * slotSize + (HOTBAR_SLOTS.length - 1) * spacing;
		if (availableW > 0 && totalW > availableW) {
			const fit = availableW / totalW;
			slotSize = Math.max(18, Math.floor(slotSize * fit));
			spacing = Math.max(2, Math.floor(spacing * fit));
			totalW = HOTBAR_SLOTS.length * slotSize + (HOTBAR_SLOTS.length - 1) * spacing;
		}
		const startX = Math.max(margin, (this.userInput.screenW - totalW) / 2);
		const y = Math.max(margin, this.userInput.screenH - slotSize - margin);
		const hotbarScale = slotSize / 58;

		for (let idx = 0; idx < HOTBAR_SLOTS.length; idx++) {
			const slot = HOTBAR_SLOTS[idx];
			const x = startX + idx * (slotSize + spacing);
			const quantity = this.privateState.inventory[slot.key as keyof typeof this.privateState.inventory] as number;
			const selected = slot.key === this.privateState.selectedPlaceable;

			ctx.fillStyle = "rgba(15, 23, 42, 0.84)";
			ctx.fillRect(x, y, slotSize, slotSize);
			ctx.strokeStyle = selected ? "#facc15" : "rgba(248, 250, 252, 0.35)";
			ctx.lineWidth = selected ? Math.max(2, Math.round(3 * hotbarScale)) : Math.max(1, Math.round(2 * hotbarScale));
			ctx.strokeRect(x, y, slotSize, slotSize);
			ctx.fillStyle = slot.tint;
			ctx.fillRect(x + 8 * hotbarScale, y + 8 * hotbarScale, Math.max(0, slotSize - 16 * hotbarScale), 20 * hotbarScale);
			ctx.fillStyle = "#f8fafc";
			ctx.font = `bold ${Math.max(8, Math.round(10 * hotbarScale))}px monospace`;
			ctx.textAlign = "center";
			ctx.textBaseline = "middle";
			ctx.fillText(slot.label, x + slotSize / 2, y + 20 * hotbarScale);
			ctx.textAlign = "right";
			ctx.textBaseline = "bottom";
			ctx.font = `${Math.max(9, Math.round(15 * hotbarScale))}px monospace`;
			ctx.fillText(`${quantity}`, x + slotSize - 7 * hotbarScale, y + slotSize - 7 * hotbarScale);
		}
	}

	drawPickaxeSlot(ctx: CanvasRenderingContext2D): void {
		if (!this.privateState) return;
		const uiScale = this.getUiScale();
		const margin = Math.round(12 * uiScale);
		let slotSize = Math.max(18, Math.round(64 * uiScale));
		let gap = Math.max(2, Math.round(10 * uiScale));
		const availableW = Math.max(0, this.userInput.screenW - margin * 2);
		let totalW = slotSize * 2 + gap;
		if (availableW > 0 && totalW > availableW) {
			const fit = availableW / totalW;
			slotSize = Math.max(18, Math.floor(slotSize * fit));
			gap = Math.max(2, Math.floor(gap * fit));
			totalW = slotSize * 2 + gap;
		}
		const x = Math.max(margin, this.userInput.screenW - margin - totalW);
		const y = Math.max(margin, this.userInput.screenH - slotSize - margin);
		this.drawGearSlot(ctx, x, y, slotSize, "Pickaxe", this.privateState.pickaxeTier, "#e2e8f0");
		this.drawGearSlot(ctx, x + slotSize + gap, y, slotSize, "Sword", this.privateState.weaponTier, "#fcd34d");
	}

	drawHoverBlockInfo(ctx: CanvasRenderingContext2D, me: ClientPlayerState | undefined): void {
		if (!this.controller.pointerTile) return;
		const uiScale = this.getUiScale();
		const label = this.pointerBlock ? BLOCK_LABELS[this.pointerBlock] ?? this.pointerBlock : "Unknown";
		const reachText = this.pointerReachable ? "in reach" : "out of reach";
		const margin = Math.round(12 * uiScale);
		const basePanelH = this.getMiningProgress(me) !== null ? 60 : 44;
		const maxPanelW = Math.max(0, this.userInput.screenW - margin * 2);
		const maxPanelH = Math.max(0, this.userInput.screenH - margin * 2);
		const panelScale = Math.min(uiScale, maxPanelW / 210, maxPanelH / basePanelH);
		if (panelScale <= 0) return;
		const panelW = Math.round(210 * panelScale);
		const panelH = Math.round(basePanelH * panelScale);
		const panelX = clamp(this.userInput.mouseX + 14 * panelScale, margin, Math.max(margin, this.userInput.screenW - panelW - margin));
		const panelY = clamp(this.userInput.mouseY - 32 * panelScale, margin, Math.max(margin, this.userInput.screenH - panelH - margin));

		ctx.fillStyle = this.pointerReachable ? "rgba(15, 23, 42, 0.88)" : "rgba(127, 29, 29, 0.86)";
		const miningProgress = this.getMiningProgress(me);
		ctx.fillRect(panelX, panelY, panelW, panelH);

		ctx.fillStyle = "#f8fafc";
		ctx.font = `${Math.round(14 * panelScale)}px monospace`;
		ctx.textAlign = "left";
		ctx.textBaseline = "top";
		ctx.fillText(label, panelX + 8 * panelScale, panelY + 4 * panelScale);
		ctx.fillText(reachText, panelX + 8 * panelScale, panelY + 20 * panelScale);

		if (!this.pointerReachable && me) {
			const dist = Math.sqrt(distSq(me, { x: this.controller.pointerTile.x + 0.5, y: this.controller.pointerTile.y + 0.5 }));
			ctx.fillText(`dist ${dist.toFixed(2)}`, panelX + 118 * panelScale, panelY + 20 * panelScale);
		}

		if (miningProgress !== null) {
			const barX = panelX + 8 * panelScale;
			const barY = panelY + 40 * panelScale;
			const barW = panelW - 16 * panelScale;
			ctx.fillStyle = "rgba(255, 255, 255, 0.12)";
			ctx.fillRect(barX, barY, barW, 6 * panelScale);
			ctx.fillStyle = "#22c55e";
			ctx.fillRect(barX, barY, barW * miningProgress, 6 * panelScale);
			ctx.strokeStyle = "rgba(255, 255, 255, 0.22)";
			ctx.lineWidth = Math.max(1, Math.round(panelScale));
			ctx.strokeRect(barX + 0.5, barY + 0.5, barW - 1, 5 * panelScale);
		}
	}

	getMiningProgress(me: ClientPlayerState | undefined): number | null {
		if (!me || !me.mining || !this.controller.pointerTile || !sameTile(me.mining.target, this.controller.pointerTile) || !this.privateState) return null;
		if (!this.pointerBlock || this.pointerBlock === "air") return null;

		const hardness = MC2D_MINING_HARDNESS[this.pointerBlock as keyof typeof MC2D_MINING_HARDNESS] ?? 1;
		const speed = MC2D_TOOL_SPEED[this.privateState.pickaxeTier] ?? 1;
		const required = Math.max(0.15, hardness / speed);
		return Math.max(0, Math.min(1, me.mining.elapsedSeconds / required));
	}

	drawSummaryOverlay(ctx: CanvasRenderingContext2D): void {
		if (!this.summary) return;
		const { screenW: W, screenH: H } = this.userInput;
		const uiScale = this.getUiScale();
		const me = this.interpolator.getPlayers()[this.myId];
		const winnerName = this.summary.winnerId ? this.interpolator.getPlayers()[this.summary.winnerId]?.name || this.lobbyPlayers[this.summary.winnerId]?.name || "Unknown" : null;
		const won = this.summary.winnerId === this.myId;
		const title = this.summary.winnerId === null ? "Pareggio" : won ? "Hai vinto" : "Hai perso";
		const reasonText = this.summary.reason === "diamond_found"
			? (won ? "Hai trovato il diamante" : winnerName ? `${winnerName} ha trovato il diamante` : "Il diamante e stato trovato")
			: (this.summary.winnerId === null
				? "Tempo scaduto, pareggio"
				: won
					? "Sei rimasto il piu vicino al diamante"
					: winnerName
						? `${winnerName} era piu vicino al diamante`
						: "Un altro giocatore era piu vicino al diamante");

		ctx.fillStyle = "rgba(0, 0, 0, 0.75)";
		ctx.fillRect(0, 0, W, H);
		ctx.fillStyle = "#ffffff";
		ctx.font = `bold ${Math.round(42 * uiScale)}px monospace`;
		ctx.textAlign = "center";
		ctx.textBaseline = "middle";
		ctx.fillText(title, W / 2, H / 2 - 24 * uiScale);
		ctx.font = `${Math.round(20 * uiScale)}px monospace`;
		ctx.fillText(reasonText, W / 2, H / 2 + 20 * uiScale);
		ctx.fillText(me ? `Giocatore: ${me.name}` : "Match concluso", W / 2, H / 2 + 56 * uiScale);

		const btnW = Math.max(0, Math.min(300 * uiScale, W - 48 * uiScale));
		const btnH = Math.max(0, 52 * uiScale);
		const btnX = clamp(W / 2 - btnW / 2, 24 * uiScale, Math.max(24 * uiScale, W - btnW - 24 * uiScale));
		const btnY = clamp(H / 2 + 92 * uiScale, 24 * uiScale, Math.max(24 * uiScale, H - btnH - 24 * uiScale));
		if (btnW > 0 && btnH > 0) this.exitButton.draw(ctx, btnX, btnY, btnW, btnH);
	}

	drawWaitingScreen(ctx: CanvasRenderingContext2D): void {
		const uiScale = this.getUiScale();
		ctx.fillStyle = "#0f172a";
		ctx.fillRect(0, 0, this.userInput.screenW, this.userInput.screenH);
		ctx.fillStyle = "#e2e8f0";
		ctx.font = `${Math.round(28 * uiScale)}px monospace`;
		ctx.textAlign = "center";
		ctx.textBaseline = "middle";
		ctx.fillText("Preparing Minecraft Diamond Rush", this.userInput.screenW / 2, this.userInput.screenH / 2);
	}

	drawGearSlot(ctx: CanvasRenderingContext2D, x: number, y: number, slotSize: number, title: string, tier: string, tint: string): void {
		ctx.fillStyle = "rgba(10, 14, 24, 0.88)";
		ctx.fillRect(x, y, slotSize, slotSize);
		ctx.strokeStyle = tint;
		ctx.lineWidth = 2;
		ctx.strokeRect(x, y, slotSize, slotSize);
		ctx.fillStyle = tint;
		ctx.fillRect(x + 8, y + 8, slotSize - 16, 18);
		ctx.fillStyle = "#f8fafc";
		ctx.font = `bold ${Math.max(9, Math.round(slotSize * 0.19))}px monospace`;
		ctx.textAlign = "center";
		ctx.textBaseline = "top";
		ctx.fillText(title, x + slotSize / 2, y + 8);
		ctx.font = `bold ${Math.max(10, Math.round(slotSize * 0.2))}px monospace`;
		ctx.fillText(tier === "hand" ? "HAND" : tier.toUpperCase(), x + slotSize / 2, y + 30);
	}

	dispose(): void {
		if (this.disposed) return;
		this.disposed = true;
		this.controller.dispose();
	}
}

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
		this.players = {};

		let index = 0;
		for (const id in players) {
			const spawnX = -6 + index * 3;
			const spawnY = 6;
			this.players[id] = {
				id,
				name: players[id].name,
				character: players[id].character,
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
			index++;
		}
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
		const shouldSnapshot = this.forceSnapshot || this.tickCounter % MC2D_SNAPSHOT_INTERVAL_TICKS === 0 || this.summary !== null;
		const revealDiamond = this.world.diamondRevealed || this.summary !== null;
		const diamondPosCopy = revealDiamond ? { ...this.world.diamondPos } : undefined;

		for (const playerId in this.players) {
			const self = this.players[playerId];
			const delta: GameDelta = {
				kind: "delta",
				serverNowMs: nowMs,
				matchEndsAtMs: this.matchEndsAtMs,
				diamondRevealed: this.world.diamondRevealed,
				summary: this.summary,
				players: publicPlayers,
				self: toPrivatePlayerState(self),
				blockUpdates: this.pendingBlockUpdates,
				diamondPos: diamondPosCopy
			};
			messages.push({ clientId: playerId, payload: delta });

			if (shouldSnapshot) {
				const snapshot: GameSnapshot = {
					kind: "snapshot",
					seed: this.world.seed,
					serverNowMs: nowMs,
					matchEndsAtMs: this.matchEndsAtMs,
					diamondRevealed: this.world.diamondRevealed,
					summary: this.summary,
					players: publicPlayers,
					self: toPrivatePlayerState(self),
					chunks: this.world.getChunksAround(Math.floor(self.x), Math.floor(self.y)),
					diamondPos: diamondPosCopy
				};
				messages.push({ clientId: playerId, payload: snapshot });
			}
		}

		this.pendingBlockUpdates = [];
		this.forceSnapshot = false;
		this.tickCounter += 1;
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
				player.input.left = !!payload.left;
				player.input.right = !!payload.right;
				player.input.jump = !!payload.jump;
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
				case "mine_stop": player.mining = null; break;
				case "attack": this.tryAttack(player, nowMs); break;
				case "craft": this.tryCraft(player, payload.recipeId); break;
				case "select_placeable": player.selectedPlaceable = payload.block; break;
				case "place_block": this.tryPlaceBlock(player, sanitizeTile(payload.target), payload.block); break;
			}
		}
	}

	simulatePlayers(dt: number, nowMs: number): void {
		const safeDt = Number.isFinite(dt) && dt > 0 ? dt : 0;
		for (const id in this.players) {
			const player = this.players[id];

			if (player.dead) {
				if (nowMs >= player.respawnAtMs) this.respawnPlayer(player);
				continue;
			}

			const subSteps = Math.max(1, Math.min(MAX_PHYSICS_SUBSTEPS, Math.ceil(safeDt / MAX_PHYSICS_STEP_SECONDS)));
			const stepDt = safeDt / subSteps;
			for (let i = 0; i < subSteps; i++) {
				stepPlayerPhysics(player, player.input, this.world, stepDt, 1);
				this.processMining(player, stepDt);
			}
		}
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

		player.mining.elapsedSeconds += dt;
		if (player.mining.elapsedSeconds < this.requiredMiningSeconds(player, block)) return;

		const result = this.world.mineBlock(target.x, target.y);
		player.mining = null;
		if (!result) return;

		this.pendingBlockUpdates.push({ pos: { ...target }, block: "air" });
		grantDrop(player.inventory, result.block);
		if (result.wasDiamond && !this.summary) {
			this.summary = { winnerId: player.id, reason: "diamond_found", winnerDistance: 0 };
			this.world.diamondRevealed = true;
			this.forceSnapshot = true;
		}
	}

	tryAttack(attacker: ServerPlayerState, nowMs: number): void {
		if (nowMs < attacker.attackReadyAtMs) return;
		attacker.attackReadyAtMs = nowMs + MC2D_ATTACK_COOLDOWN_MS;

		const weaponTier = resolveBestWeaponTier(attacker.inventory);
		const reachSq = attackReachSq(weaponTier);
		const damage = attackDamage(weaponTier);

		let nearest: ServerPlayerState | null = null;
		let nearestDist = Number.POSITIVE_INFINITY;

		for (const id in this.players) {
			const c = this.players[id];
			if (c.id === attacker.id || c.dead) continue;
			const dx = c.x - attacker.x;
			const dy = c.y - attacker.y;
			const dSq = dx * dx + dy * dy;
			if (dSq > reachSq || dSq >= nearestDist) continue;
			nearestDist = dSq;
			nearest = c;
		}

		if (!nearest) return;

		nearest.hp -= damage;
		const dir = nearest.x >= attacker.x ? 1 : -1;
		nearest.vx = dir * MC2D_KNOCKBACK_X;
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
				winnerId: isTie ? null : best.player.id,
				reason: "time_up",
				winnerDistance: best.distance
			};
		}

		this.world.diamondRevealed = true;
		this.forceSnapshot = true;
	}

	requiredMiningSeconds(player: ServerPlayerState, block: BlockType): number {
		const hardness = MC2D_MINING_HARDNESS[block as keyof typeof MC2D_MINING_HARDNESS] ?? 1;
		const speed = MC2D_TOOL_SPEED[resolveBestToolTier(player.inventory)] ?? 1;
		return Math.max(0.15, hardness / speed);
	}

	canReachTile(player: ServerPlayerState, tile: TilePos): boolean {
		const cx = tile.x + 0.5;
		const cy = tile.y + 0.5;
		return (player.x - cx) * (player.x - cx) + (player.y - cy) * (player.y - cy) <= MINING_REACH_SQ;
	}

	targetCollidesWithAnyPlayer(tile: TilePos): boolean {
		const tileRight = tile.x + 1;
		const tileTop = tile.y + 1;
		for (const id in this.players) {
			const p = this.players[id];
			if (
				p.x - MC2D_PLAYER_HALF_WIDTH < tileRight &&
				p.x + MC2D_PLAYER_HALF_WIDTH > tile.x &&
				p.y - MC2D_PLAYER_HALF_HEIGHT < tileTop &&
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
