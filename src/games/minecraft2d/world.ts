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
import { chunkCoordFromTile, seededNoise } from "./utils";

const CHUNK_RADIUS_X = 4;
const CHUNK_RADIUS_Y = 3;

export class MinecraftWorld {
    seed: number;
    diamondPos: TilePos;
    diamondRevealed: boolean;
    overrides: Map<string, BlockType>;

    constructor(seed: number) {
        this.seed = seed;
        this.diamondPos = this.pickDiamondPos();
        this.diamondRevealed = false;
        this.overrides = new Map();
    }

    getBlock(tileX: number, tileY: number): BlockType {
        if (tileX < MC2D_WORLD_MIN_X || tileX > MC2D_WORLD_MAX_X) return "stone";
        if (tileY < MC2D_WORLD_MIN_Y) return "stone";
        if (tileY > MC2D_WORLD_MAX_Y) return "air";

        const key = this.tileKey(tileX, tileY);
        const edited = this.overrides.get(key);
        if (edited) return edited;

        if (tileX === this.diamondPos.x && tileY === this.diamondPos.y) {
            return "diamond";
        }

        return this.baseBlockAt(tileX, tileY);
    }

    getBlockForClient(tileX: number, tileY: number): BlockType {
        return this.getBlock(tileX, tileY);
    }

    mineBlock(tileX: number, tileY: number): { block: BlockType; wasDiamond: boolean } | null {
        if (!this.isWithinMutableBounds(tileX, tileY)) return null;

        const block = this.getBlock(tileX, tileY);
        if (block === "air") return null;

        const wasDiamond = tileX === this.diamondPos.x && tileY === this.diamondPos.y;
        this.overrides.set(this.tileKey(tileX, tileY), "air");
        if (wasDiamond) this.diamondRevealed = true;

        return { block, wasDiamond };
    }

    placeBlock(tileX: number, tileY: number, block: BlockType): boolean {
        if (!this.isWithinMutableBounds(tileX, tileY)) return false;
        if (block === "air") return false;
        if (this.getBlock(tileX, tileY) !== "air") return false;
        this.overrides.set(this.tileKey(tileX, tileY), block);
        return true;
    }

    isSolidAt(tileX: number, tileY: number): boolean {
        return this.getBlock(tileX, tileY) !== "air";
    }

    getChunksAround(tileX: number, tileY: number): Chunk[] {
        const centerChunk = chunkCoordFromTile(tileX, tileY);
        const chunks: Chunk[] = [];
        for (let dy = -CHUNK_RADIUS_Y; dy <= CHUNK_RADIUS_Y; dy += 1) {
            for (let dx = -CHUNK_RADIUS_X; dx <= CHUNK_RADIUS_X; dx += 1) {
                const cx = centerChunk.chunkX + dx;
                const cy = centerChunk.chunkY + dy;
                chunks.push(this.buildChunkForClient(cx, cy));
            }
        }
        return chunks;
    }

    buildChunkForClient(chunkX: number, chunkY: number): Chunk {
        const tiles: BlockType[] = [];
        for (let localY = 0; localY < MC2D_CHUNK_SIZE; localY += 1) {
            for (let localX = 0; localX < MC2D_CHUNK_SIZE; localX += 1) {
                const tileX = chunkX * MC2D_CHUNK_SIZE + localX;
                const tileY = chunkY * MC2D_CHUNK_SIZE + localY;
                tiles.push(this.getBlockForClient(tileX, tileY));
            }
        }
        return {
            chunkX,
            chunkY,
            tiles
        };
    }

    pickDiamondPos(): TilePos {
        const xSpan = MC2D_WORLD_MAX_X - MC2D_WORLD_MIN_X + 1;
        const ySpan = MC2D_DIAMOND_MAX_Y - MC2D_DIAMOND_MIN_Y + 1;
        for (let attempt = 0; attempt < 512; attempt += 1) {
            const rx = seededNoise(this.seed + 991, attempt, 17);
            const ry = seededNoise(this.seed + 31337, attempt, 41);
            const x = MC2D_WORLD_MIN_X + Math.floor(rx * xSpan);
            const y = MC2D_DIAMOND_MIN_Y + Math.floor(ry * ySpan);
            if (this.baseBlockAt(x, y) !== "air") {
                return { x, y };
            }
        }

        return {
            x: Math.floor((MC2D_WORLD_MIN_X + MC2D_WORLD_MAX_X) / 2),
            y: MC2D_DIAMOND_MIN_Y
        };
    }

    baseBlockAt(tileX: number, tileY: number): BlockType {
        const surfaceY = this.surfaceAt(tileX);
        if (tileY > surfaceY) {
            const trunkTop = this.trunkTopAt(tileX, surfaceY);
            if (tileY >= surfaceY + 1 && tileY <= trunkTop) return "trunk";
            return "air";
        }

        if (tileY === surfaceY) return "grass";
        if (tileY >= surfaceY - 3) return "dirt";

        const depth = surfaceY - tileY;
        const ironChance = seededNoise(this.seed + 9013, tileX, tileY);
        if (depth > 16 && ironChance < MC2D_ORE_IRON_CHANCE) return "iron_ore";
        return "stone";
    }

    surfaceAt(tileX: number): number {
        const lowFreq = seededNoise(this.seed + 17, tileX, 0);
        const highFreq = seededNoise(this.seed + 53, tileX * 3, 0);
        const offset = Math.floor((lowFreq - 0.5) * 6 + (highFreq - 0.5) * 2);
        return MC2D_SURFACE_BASE_Y + offset;
    }

    trunkTopAt(tileX: number, surfaceY: number): number {
        const treeRoll = seededNoise(this.seed + 12007, tileX, 0);
        if (treeRoll > MC2D_TREE_CHANCE) return surfaceY;
        const heightNoise = seededNoise(this.seed + 12083, tileX, 1);
        const height = 2 + Math.floor(heightNoise * 3);
        return surfaceY + height;
    }

    isWithinMutableBounds(tileX: number, tileY: number): boolean {
        return tileX >= MC2D_WORLD_MIN_X
            && tileX <= MC2D_WORLD_MAX_X
            && tileY >= MC2D_WORLD_MIN_Y
            && tileY <= MC2D_WORLD_MAX_Y;
    }

    tileKey(tileX: number, tileY: number): string {
        return `${tileX}:${tileY}`;
    }
}
