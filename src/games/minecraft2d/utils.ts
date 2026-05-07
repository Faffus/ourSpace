import { MC2D_CHUNK_SIZE } from "./constants";
import { TilePos } from "./types";

export const clamp = (value: number, min: number, max: number): number => {
    return Math.max(min, Math.min(max, value));
};

export const lerp = (from: number, to: number, t: number): number => {
    return from + (to - from) * t;
};

export const distSq = (a: TilePos, b: TilePos): number => {
    const dx = a.x - b.x;
    const dy = a.y - b.y;
    return dx * dx + dy * dy;
};

export const floorDiv = (value: number, divisor: number): number => {
    return Math.floor(value / divisor);
};

export const chunkCoordFromTile = (tileX: number, tileY: number) => {
    return {
        chunkX: floorDiv(tileX, MC2D_CHUNK_SIZE),
        chunkY: floorDiv(tileY, MC2D_CHUNK_SIZE)
    };
};

export const chunkKey = (chunkX: number, chunkY: number): string => `${chunkX}:${chunkY}`;

export const localTileIndex = (tileX: number, tileY: number): number => {
    const localX = ((tileX % MC2D_CHUNK_SIZE) + MC2D_CHUNK_SIZE) % MC2D_CHUNK_SIZE;
    const localY = ((tileY % MC2D_CHUNK_SIZE) + MC2D_CHUNK_SIZE) % MC2D_CHUNK_SIZE;
    return localY * MC2D_CHUNK_SIZE + localX;
};

export const seededNoise = (seed: number, x: number, y: number): number => {
    let hash = seed ^ (x * 374761393) ^ (y * 668265263);
    hash = (hash ^ (hash >> 13)) * 1274126177;
    hash ^= hash >> 16;
    return (hash >>> 0) / 0xffffffff;
};

export const sameTile = (a: TilePos, b: TilePos): boolean => a.x === b.x && a.y === b.y;

export const toTilePos = (x: number, y: number): TilePos => ({
    x: Math.floor(x),
    y: Math.floor(y)
});
