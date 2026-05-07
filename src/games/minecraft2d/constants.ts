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
export const MC2D_SEED_DEFAULT = 872341;
