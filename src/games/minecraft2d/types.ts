import { Player } from "../../common";

export type TilePos = {
    x: number;
    y: number;
};

export type BlockType =
    | "air"
    | "grass"
    | "dirt"
    | "stone"
    | "trunk"
    | "iron_ore"
    | "diamond";

export type PlaceableBlock = "dirt" | "stone" | "trunk";

export type ToolTier = "hand" | "wood" | "stone" | "iron";

export type EffectName = "speed" | "haste" | "regen";

export type ActiveEffect = {
    effect: EffectName;
    expiresAtMs: number;
};

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

export type PlayerInput = {
    left: boolean;
    right: boolean;
    jump: boolean;
};

export type MiningState = {
    target: TilePos;
    elapsedSeconds: number;
} | null;

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

export type Chunk = {
    chunkX: number;
    chunkY: number;
    tiles: BlockType[];
};

export type WorldBlockUpdate = {
    pos: TilePos;
    block: BlockType;
};

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

export type ClientPlayerState = PublicPlayerState & {
    targetX: number;
    targetY: number;
};

export type LobbyPlayer = Player;
