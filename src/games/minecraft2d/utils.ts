import { MC2D_CHUNK_SIZE } from "./constants";
import { TilePos } from "./types";

const CHUNK_MASK  = MC2D_CHUNK_SIZE - 1; // 0b00001111
const CHUNK_SHIFT = 4;                   // log2(16)

export const clamp  = (v: number, min: number, max: number): number => Math.max(min, Math.min(max, v));
export const lerp   = (from: number, to: number, t: number): number => from + (to - from) * t;
export const sameTile = (a: TilePos, b: TilePos): boolean => a.x === b.x && a.y === b.y;
export const toTilePos = (x: number, y: number): TilePos => ({ x: Math.floor(x), y: Math.floor(y) });
export const chunkKey = (cx: number, cy: number): string => `${cx}:${cy}`;
export const floorDiv = (v: number, d: number): number => Math.floor(v / d);

export const distSq = (a: TilePos, b: TilePos): number => {
	const dx = a.x - b.x, dy = a.y - b.y;
	return dx * dx + dy * dy;
};

export const chunkCoordFromTile = (tileX: number, tileY: number) => ({
	chunkX: Math.floor(tileX / MC2D_CHUNK_SIZE),
	chunkY: Math.floor(tileY / MC2D_CHUNK_SIZE)
});

export const localTileIndex = (tileX: number, tileY: number): number =>
	((tileY & CHUNK_MASK) << CHUNK_SHIFT) | (tileX & CHUNK_MASK);

export const seededNoise = (seed: number, x: number, y: number): number => {
	let h = seed ^ (x * 374761393) ^ (y * 668265263);
	h = (h ^ (h >> 13)) * 1274126177;
	h ^= h >> 16;
	return (h >>> 0) / 0xffffffff;
};
