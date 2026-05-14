import {
	MC2D_CHUNK_SIZE,
	MC2D_DIAMOND_MAX_Y,
	MC2D_DIAMOND_MIN_Y,
	MC2D_ORE_IRON_CHANCE,
	MC2D_SURFACE_BASE_Y,
	MC2D_TREE_CHANCE,
	MC2D_WORLD_MAX_X,
	MC2D_WORLD_MAX_Y,
	MC2D_WORLD_MIN_X,
	MC2D_WORLD_MIN_Y
} from "./constants";
import { BlockType, Chunk, TilePos } from "./types";
import { seededNoise } from "./utils";

const CHUNK_RADIUS_X = 4;
const CHUNK_RADIUS_Y = 3;
const CHUNK_AREA     = MC2D_CHUNK_SIZE * MC2D_CHUNK_SIZE;

const KEY_X_OFF = 96;
const KEY_Y_OFF = 84;
const KEY_MUL   = 200;

export class MinecraftWorld {
	seed:            number;
	diamondPos:      TilePos;
	diamondRevealed: boolean;
	overrides:       Map<number, BlockType>;

	constructor(seed: number) {
		this.seed            = seed;
		this.diamondRevealed = false;
		this.overrides       = new Map();
		this.diamondPos      = this.pickDiamondPos();
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

		const DIAM_X = 2 * CHUNK_RADIUS_X + 1;
		const DIAM_Y = 2 * CHUNK_RADIUS_Y + 1;
		const chunks = new Array<Chunk>(DIAM_X * DIAM_Y);
		let  i = 0;

		for (let dy = -CHUNK_RADIUS_Y; dy <= CHUNK_RADIUS_Y; dy++) {
			for (let dx = -CHUNK_RADIUS_X; dx <= CHUNK_RADIUS_X; dx++) {
				chunks[i++] = this.buildChunk(cx + dx, cy + dy);
			}
		}

		return chunks;
	}

	buildChunk(chunkX: number, chunkY: number): Chunk {
		const tiles = new Array<BlockType>(CHUNK_AREA);

		for (let lx = 0; lx < MC2D_CHUNK_SIZE; lx++) {
			const tx   = chunkX * MC2D_CHUNK_SIZE + lx;
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
		const surf  = this.surfaceAt(tileX);
		const trunk = this.trunkTopAt(tileX, surf);
		return this.baseBlockAtCached(tileX, tileY, surf, trunk);
	}

	private baseBlockAtCached(tileX: number, tileY: number, surf: number, trunk: number): BlockType {
		if (tileY > surf) {
			return (tileY >= surf + 1 && tileY <= trunk) ? "trunk" : "air";
		}
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
			const x = MC2D_WORLD_MIN_X + Math.floor(seededNoise(this.seed + 991,   attempt, 17) * xSpan);
			const y = MC2D_DIAMOND_MIN_Y + Math.floor(seededNoise(this.seed + 31337, attempt, 41) * ySpan);
			if (this.baseBlockAt(x, y) !== "air") return { x, y };
		}

		return { x: Math.floor((MC2D_WORLD_MIN_X + MC2D_WORLD_MAX_X) / 2), y: MC2D_DIAMOND_MIN_Y };
	}

	inBounds(tileX: number, tileY: number): boolean {
		return tileX >= MC2D_WORLD_MIN_X && tileX <= MC2D_WORLD_MAX_X
			&& tileY >= MC2D_WORLD_MIN_Y && tileY <= MC2D_WORLD_MAX_Y;
	}

	private tileKey(tileX: number, tileY: number): number {
		return (tileX + KEY_X_OFF) * KEY_MUL + (tileY + KEY_Y_OFF);
	}
}
