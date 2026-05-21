import { Player } from '../common';
import { IncomingMsg, OutgoingMsg } from '../server';
import { GameClient, GameServer } from './game';
import { UserInput } from '../client/user-input';
import { Button } from '../client/ui-elements';

const TILE_SIZE = 64;
const PLAYER_RADIUS = 11;
const PLAYER_SPEED = 160;
const STRAFE_SPEED = 115;
const WALL_GLIDE_SPEED = 110;
const ROTATION_SPEED = 2.8;
const FOV = Math.PI / 3;
const MAX_VIEW_DISTANCE = TILE_SIZE * 14;
const DEFAULT_MOUSE_LOOK_SENSITIVITY = 0.0012;
const MIN_MOUSE_LOOK_SENSITIVITY = 0;
const MAX_MOUSE_LOOK_SENSITIVITY = DEFAULT_MOUSE_LOOK_SENSITIVITY;
const MOUSE_LOOK_SENSITIVITY_STEP = DEFAULT_MOUSE_LOOK_SENSITIVITY / 20;
const MOUSE_LOOK_ASSIST = 0.8;
const MAX_LOOK_DELTA_PER_INPUT = Math.PI / 2;
const MOUSE_SENSITIVITY_KEY = "doomMouseSensitivity";
const MAX_LIFE = 100;
const RESPAWN_TIME = 2;
const TIMED_GAME_TIME = 180;
const GAME_OVER_TIME = 6;
const WEAPON_PICKUP_RADIUS = 36;
const WEAPON_RESPAWN_TIME = 14;
const INITIAL_WEAPON_SPAWNS = 5;
const SHOOT_BUFFER_TIME = 0.18;
const ENEMY_SPRITE_SCALE = 0.76;
const PICKUP_SPRITE_SCALE = 0.36;
const MINI_MAP_MAX_W = 220;
const MINI_MAP_MAX_H = 155;

type DoomMapName = "small" | "medium" | "large";
type DoomSpawnPoint = { x: number; y: number; angle: number; };
type DoomWeaponSpawnPoint = { x: number; y: number; };
type DoomMapData = {
    name: DoomMapName;
    title: string;
    maxPlayers: number;
    tiles: string[];
    spawns: DoomSpawnPoint[];
    weaponSpawns: DoomWeaponSpawnPoint[];
}

const DOOM_MAPS: Record<DoomMapName, DoomMapData> = {
    small: {
        name: "small",
        title: "Arena",
        maxPlayers: 3,
        tiles: [
            "22222222222222222",
            "2...1.......1...2",
            "2.1.1.22222.1.1.2",
            "2.1...........1.2",
            "2...22.111.22...2",
            "222....1.1....222",
            "2...22.111.22...2",
            "2.1...........1.2",
            "2.1.1.22222.1.1.2",
            "2...1.......1...2",
            "22222222222222222",
        ],
        spawns: [
            { x: 1.5 * TILE_SIZE, y: 1.5 * TILE_SIZE, angle: 0 },
            { x: 15.5 * TILE_SIZE, y: 9.5 * TILE_SIZE, angle: Math.PI },
            { x: 15.5 * TILE_SIZE, y: 1.5 * TILE_SIZE, angle: Math.PI },
            { x: 1.5 * TILE_SIZE, y: 9.5 * TILE_SIZE, angle: 0 },
        ],
        weaponSpawns: [
            { x: 8.5 * TILE_SIZE, y: 1.5 * TILE_SIZE },
            { x: 8.5 * TILE_SIZE, y: 9.5 * TILE_SIZE },
            { x: 3.5 * TILE_SIZE, y: 5.5 * TILE_SIZE },
            { x: 13.5 * TILE_SIZE, y: 5.5 * TILE_SIZE },
            { x: 6.5 * TILE_SIZE, y: 3.5 * TILE_SIZE },
            { x: 10.5 * TILE_SIZE, y: 7.5 * TILE_SIZE },
            { x: 5.5 * TILE_SIZE, y: 5.5 * TILE_SIZE },
            { x: 11.5 * TILE_SIZE, y: 5.5 * TILE_SIZE },
            { x: 6.5 * TILE_SIZE, y: 7.5 * TILE_SIZE },
            { x: 10.5 * TILE_SIZE, y: 3.5 * TILE_SIZE },
        ]
    },
    medium: {
        name: "medium",
        title: "Depot",
        maxPlayers: 6,
        tiles: [
            "333333333333333333333",
            "3...................3",
            "3.111...22222...111.3",
            "3.1...............1.3",
            "3.1.44...333...44.1.3",
            "3...................3",
            "3.222....444....222.3",
            "3...................3",
            "3.1.44...333...44.1.3",
            "3.1...............1.3",
            "3.111...22222...111.3",
            "3...................3",
            "333333333333333333333",
        ],
        spawns: [
            { x: 1.5 * TILE_SIZE, y: 1.5 * TILE_SIZE, angle: 0 },
            { x: 19.5 * TILE_SIZE, y: 11.5 * TILE_SIZE, angle: Math.PI },
            { x: 19.5 * TILE_SIZE, y: 1.5 * TILE_SIZE, angle: Math.PI },
            { x: 1.5 * TILE_SIZE, y: 11.5 * TILE_SIZE, angle: 0 },
            { x: 10.5 * TILE_SIZE, y: 5.5 * TILE_SIZE, angle: Math.PI / 2 },
            { x: 10.5 * TILE_SIZE, y: 7.5 * TILE_SIZE, angle: -Math.PI / 2 },
            { x: 5.5 * TILE_SIZE, y: 6.5 * TILE_SIZE, angle: 0 },
            { x: 15.5 * TILE_SIZE, y: 6.5 * TILE_SIZE, angle: Math.PI },
        ],
        weaponSpawns: [
            { x: 5.5 * TILE_SIZE, y: 1.5 * TILE_SIZE },
            { x: 15.5 * TILE_SIZE, y: 1.5 * TILE_SIZE },
            { x: 10.5 * TILE_SIZE, y: 3.5 * TILE_SIZE },
            { x: 10.5 * TILE_SIZE, y: 9.5 * TILE_SIZE },
            { x: 5.5 * TILE_SIZE, y: 6.5 * TILE_SIZE },
            { x: 15.5 * TILE_SIZE, y: 6.5 * TILE_SIZE },
            { x: 5.5 * TILE_SIZE, y: 11.5 * TILE_SIZE },
            { x: 15.5 * TILE_SIZE, y: 11.5 * TILE_SIZE },
            { x: 2.5 * TILE_SIZE, y: 5.5 * TILE_SIZE },
            { x: 18.5 * TILE_SIZE, y: 7.5 * TILE_SIZE },
        ]
    },
    large: {
        name: "large",
        title: "Stronghold",
        maxPlayers: 99,
        tiles: [
            "3333333333333333333333333333",
            "3............22............3",
            "3.1111.2222..22..2222.1111.3",
            "3.1......................1.3",
            "3.1.44.222.111111.222.44.1.3",
            "3...44......1111......44...3",
            "333.2222.44......44.2222.333",
            "3........44......44........3",
            "3.222222....3333....222222.3",
            "3......1....3..3....1......3",
            "3.222222....3333....222222.3",
            "3........44......44........3",
            "333.2222.44......44.2222.333",
            "3...44......1111......44...3",
            "3.1.44.222.111111.222.44.1.3",
            "3.1......................1.3",
            "3.1111.2222..22..2222.1111.3",
            "3............22............3",
            "3333333333333333333333333333",
        ],
        spawns: [
            { x: 1.5 * TILE_SIZE, y: 1.5 * TILE_SIZE, angle: 0 },
            { x: 26.5 * TILE_SIZE, y: 17.5 * TILE_SIZE, angle: Math.PI },
            { x: 26.5 * TILE_SIZE, y: 1.5 * TILE_SIZE, angle: Math.PI },
            { x: 1.5 * TILE_SIZE, y: 17.5 * TILE_SIZE, angle: 0 },
            { x: 13.5 * TILE_SIZE, y: 3.5 * TILE_SIZE, angle: Math.PI / 2 },
            { x: 14.5 * TILE_SIZE, y: 15.5 * TILE_SIZE, angle: -Math.PI / 2 },
            { x: 7.5 * TILE_SIZE, y: 7.5 * TILE_SIZE, angle: 0 },
            { x: 20.5 * TILE_SIZE, y: 11.5 * TILE_SIZE, angle: Math.PI },
            { x: 7.5 * TILE_SIZE, y: 11.5 * TILE_SIZE, angle: 0 },
            { x: 20.5 * TILE_SIZE, y: 7.5 * TILE_SIZE, angle: Math.PI },
        ],
        weaponSpawns: [
            { x: 4.5 * TILE_SIZE, y: 1.5 * TILE_SIZE },
            { x: 23.5 * TILE_SIZE, y: 1.5 * TILE_SIZE },
            { x: 13.5 * TILE_SIZE, y: 3.5 * TILE_SIZE },
            { x: 14.5 * TILE_SIZE, y: 15.5 * TILE_SIZE },
            { x: 3.5 * TILE_SIZE, y: 7.5 * TILE_SIZE },
            { x: 24.5 * TILE_SIZE, y: 11.5 * TILE_SIZE },
            { x: 6.5 * TILE_SIZE, y: 9.5 * TILE_SIZE },
            { x: 21.5 * TILE_SIZE, y: 9.5 * TILE_SIZE },
            { x: 12.5 * TILE_SIZE, y: 6.5 * TILE_SIZE },
            { x: 15.5 * TILE_SIZE, y: 12.5 * TILE_SIZE },
            { x: 5.5 * TILE_SIZE, y: 15.5 * TILE_SIZE },
            { x: 22.5 * TILE_SIZE, y: 15.5 * TILE_SIZE },
        ]
    }
};

const DEFAULT_MAP = DOOM_MAPS.large;

type DoomMode = "battle_royale" | "timed";
type DoomPhase = "mode_select" | "playing" | "game_over";
type WeaponName = "pistol" | "shotgun" | "chaingun" | "rocket" | "plasma" | "bfg";
type ShotStyle = "single" | "spread" | "rapid" | "blast" | "beam" | "bfg";

type WallInfo = {
    r: number;
    g: number;
    b: number;
    miniMap: string;
    texture: string;
}

const WALLS: Record<string, WallInfo> = {
    "1": { r: 92, g: 86, b: 74, miniMap: "#575147", texture: "wall_1" },
    "2": { r: 92, g: 86, b: 74, miniMap: "#575147", texture: "wall_1" },
    "3": { r: 92, g: 86, b: 74, miniMap: "#575147", texture: "wall_1" },
    "4": { r: 92, g: 86, b: 74, miniMap: "#575147", texture: "wall_1" },
    "#": { r: 92, g: 86, b: 74, miniMap: "#575147", texture: "wall_1" }
};

type WeaponInfo = {
    name: string;
    damage: number;
    cooldown: number;
    range: number;
    aim: number;
    color: string;
    flashColor: string;
    traceColor: string;
    gunScale: number;
    recoil: number;
    flashSize: number;
    auto: boolean;
    shotStyle: ShotStyle;
    splashRadius: number;
    spawnDelay: number;
    spawnWeight: number;
    respawnTime: number;
    ammo: number;
    frames: string[];
    pickup: string;
}

const WEAPONS: Record<WeaponName, WeaponInfo> = {
    pistol: {
        name: "Pistol",
        damage: 30,
        cooldown: 0.45,
        range: TILE_SIZE * 7,
        aim: 0.012,
        color: "#c9c9c9",
        flashColor: "rgba(245, 198, 80, 0.7)",
        traceColor: "rgba(255, 232, 130, 0.42)",
        gunScale: 0.23,
        recoil: 10,
        flashSize: 1,
        auto: false,
        shotStyle: "single",
        splashRadius: 0,
        spawnDelay: 0,
        spawnWeight: 0,
        respawnTime: WEAPON_RESPAWN_TIME,
        ammo: 0,
        frames: ["PISGA0.png", "PISGB0.png", "PISGC0.png"],
        pickup: "CLIPA0.png"
    },
    shotgun: {
        name: "Shotgun",
        damage: 58,
        cooldown: 0.85,
        range: TILE_SIZE * 5,
        aim: 0.035,
        color: "#d8a241",
        flashColor: "rgba(255, 176, 66, 0.75)",
        traceColor: "rgba(255, 206, 122, 0.32)",
        gunScale: 0.32,
        recoil: 25,
        flashSize: 1.6,
        auto: false,
        shotStyle: "spread",
        splashRadius: 0,
        spawnDelay: 0,
        spawnWeight: 5,
        respawnTime: 13,
        ammo: 8,
        frames: ["SHTGA0.png", "SHTGB0.png", "SHTGC0.png"],
        pickup: "SHOTA0.png"
    },
    chaingun: {
        name: "Chaingun",
        damage: 22,
        cooldown: 0.18,
        range: TILE_SIZE * 8,
        aim: 0.010,
        color: "#6fb1d8",
        flashColor: "rgba(255, 219, 112, 0.68)",
        traceColor: "rgba(255, 238, 156, 0.34)",
        gunScale: 0.34,
        recoil: 8,
        flashSize: 0.82,
        auto: true,
        shotStyle: "rapid",
        splashRadius: 0,
        spawnDelay: 5,
        spawnWeight: 4,
        respawnTime: 15,
        ammo: 35,
        frames: ["CHGGA0.png", "CHGGB0.png", "CHGFA0.png"],
        pickup: "MGUNA0.png"
    },
    rocket: {
        name: "Rocket",
        damage: 115,
        cooldown: 1.15,
        range: TILE_SIZE * 9,
        aim: 0.006,
        color: "#9bc2c8",
        flashColor: "rgba(255, 104, 54, 0.72)",
        traceColor: "rgba(255, 107, 55, 0.48)",
        gunScale: 0.31,
        recoil: 28,
        flashSize: 1.45,
        auto: false,
        shotStyle: "blast",
        splashRadius: TILE_SIZE * 1.8,
        spawnDelay: 35,
        spawnWeight: 0.7,
        respawnTime: 35,
        ammo: 2,
        frames: ["MISGA0.png", "MISGB0.png", "MISFA0.png"],
        pickup: "LAUNA0.png"
    },
    plasma: {
        name: "Plasma",
        damage: 28,
        cooldown: 0.24,
        range: TILE_SIZE * 7,
        aim: 0.010,
        color: "#71c9ff",
        flashColor: "rgba(94, 203, 255, 0.72)",
        traceColor: "rgba(98, 215, 255, 0.44)",
        gunScale: 0.30,
        recoil: 9,
        flashSize: 1.05,
        auto: true,
        shotStyle: "beam",
        splashRadius: 0,
        spawnDelay: 45,
        spawnWeight: 0.8,
        respawnTime: 32,
        ammo: 18,
        frames: ["PLSGA0.png", "PLSGB0.png", "PLSFA0.png"],
        pickup: "PLASA0.png"
    },
    bfg: {
        name: "BFG",
        damage: 150,
        cooldown: 1.45,
        range: TILE_SIZE * 8,
        aim: 0.018,
        color: "#71e889",
        flashColor: "rgba(92, 255, 128, 0.66)",
        traceColor: "rgba(112, 255, 146, 0.52)",
        gunScale: 0.42,
        recoil: 38,
        flashSize: 2.1,
        auto: false,
        shotStyle: "bfg",
        splashRadius: TILE_SIZE * 2.3,
        spawnDelay: 75,
        spawnWeight: 0.22,
        respawnTime: 52,
        ammo: 1,
        frames: ["BFGGA0.png", "BFGGB0.png", "BFGFA0.png"],
        pickup: "BFUGA0.png"
    }
};

const WEAPON_ORDER: WeaponName[] = ["pistol", "shotgun", "chaingun", "rocket", "plasma", "bfg"];

function getDoomMap(name: DoomMapName | null | undefined): DoomMapData {
    if (!name) return DEFAULT_MAP;
    return DOOM_MAPS[name] || DEFAULT_MAP;
}

function pickDoomMap(playerCount: number): DoomMapData {
    const maps = [DOOM_MAPS.small, DOOM_MAPS.medium, DOOM_MAPS.large];
    return maps.find(map => playerCount <= map.maxPlayers) || DEFAULT_MAP;
}

type DoomPlayer = Player & {
    x: number;
    y: number;
    angle: number;
    life: number;
    score: number;
    reload: number;
    respawn: number;
    dead: boolean;
    moving: boolean;
    weapon: WeaponName;
    weapons: WeaponName[];
    ammo: Partial<Record<WeaponName, number>>;
}

type DoomInput = {
    forward: number;
    strafe: number;
    turn: number;
    look: number;
    shoot: boolean;
    weapon: WeaponName;
}

type DoomShot = {
    shooterId: string;
    x: number;
    y: number;
    angle: number;
    weapon: WeaponName;
    hitX: number;
    hitY: number;
    hitId?: string;
}

type DoomEvent = {
    text: string;
    time: number;
}

type WeaponPickup = {
    id: string;
    x: number;
    y: number;
    weapon: WeaponName;
    respawn: number;
}

type DoomServerMsg = {
    kind: "doom_update";
    mode: DoomMode | null;
    phase: DoomPhase;
    mapName: DoomMapName;
    players: Record<string, DoomPlayer>;
    weaponPickups: WeaponPickup[];
    timeLeft: number;
    gameOver: boolean;
    winnerId?: string;
    events: DoomEvent[];
    shot?: DoomShot;
}

type DoomInputMsg = {
    kind: "doom_input";
    input: DoomInput;
}

type DoomModeMsg = {
    kind: "doom_select_mode";
    mode: DoomMode;
}

type DoomClientMsg = DoomInputMsg | DoomModeMsg;

type RayHit = {
    x: number;
    y: number;
    distance: number;
    tile: string;
    textureX: number;
    side: "x" | "y";
}

function isWeaponName(weapon: any): weapon is WeaponName {
    return WEAPON_ORDER.indexOf(weapon) >= 0;
}

function getMapTileAt(map: DoomMapData, tileX: number, tileY: number): string {
    if (tileY < 0 || tileY >= map.tiles.length) return "#";
    if (tileX < 0 || tileX >= map.tiles[tileY].length) return "#";
    return map.tiles[tileY][tileX];
}

function getMapTile(map: DoomMapData, x: number, y: number): string {
    const tileX = Math.floor(x / TILE_SIZE);
    const tileY = Math.floor(y / TILE_SIZE);

    return getMapTileAt(map, tileX, tileY);
}

function isWall(map: DoomMapData, x: number, y: number): boolean {
    return getMapTile(map, x, y) !== ".";
}

function canMove(map: DoomMapData, x: number, y: number): boolean {
    return !isWall(map, x - PLAYER_RADIUS, y - PLAYER_RADIUS) &&
        !isWall(map, x + PLAYER_RADIUS, y - PLAYER_RADIUS) &&
        !isWall(map, x - PLAYER_RADIUS, y + PLAYER_RADIUS) &&
        !isWall(map, x + PLAYER_RADIUS, y + PLAYER_RADIUS);
}

function normalizeAngle(angle: number): number {
    while (angle > Math.PI) angle -= Math.PI * 2;
    while (angle < -Math.PI) angle += Math.PI * 2;
    return angle;
}

function clamp(n: number, min: number, max: number): number {
    return Math.max(min, Math.min(max, n));
}

function distanceBetween(a: { x: number, y: number }, b: { x: number, y: number }): number {
    const dx = a.x - b.x;
    const dy = a.y - b.y;
    return Math.sqrt(dx * dx + dy * dy);
}

function randomItem<T>(items: T[]): T {
    return items[Math.floor(Math.random() * items.length)];
}

function shuffled<T>(items: T[]): T[] {
    return [...items].sort(() => Math.random() - 0.5);
}

function randomWeapon(matchTime: number): WeaponName {
    const availableWeapons = WEAPON_ORDER.filter(weapon => {
        const info = WEAPONS[weapon];
        return info.spawnWeight > 0 && matchTime >= info.spawnDelay;
    });
    const weapons = availableWeapons.length > 0 ? availableWeapons : ["shotgun"] as WeaponName[];
    const totalWeight = weapons.reduce((total, weapon) => total + WEAPONS[weapon].spawnWeight, 0);
    let roll = Math.random() * totalWeight;

    for (const weapon of weapons) {
        roll -= WEAPONS[weapon].spawnWeight;
        if (roll <= 0) return weapon;
    }

    return weapons[0];
}

function matchWeapons(count: number): WeaponName[] {
    const guaranteed: WeaponName[] = ["shotgun", "shotgun", "chaingun", "chaingun", "rocket", "rocket", "plasma", "plasma", "bfg", "bfg"];
    const weapons: WeaponName[] = [];

    while (weapons.length < count) {
        weapons.push(guaranteed[weapons.length] || randomWeapon(999));
    }

    return shuffled(weapons);
}

function formatTime(seconds: number): string {
    const safeSeconds = Math.max(0, Math.ceil(seconds));
    const minutes = Math.floor(safeSeconds / 60);
    const remainingSeconds = safeSeconds % 60;
    return `${minutes}:${remainingSeconds.toString().padStart(2, "0")}`;
}

function modeName(mode: DoomMode): string {
    if (mode === "battle_royale") return "Battle Royale";
    return "A tempo";
}

function castRay(map: DoomMapData, x: number, y: number, angle: number, maxDistance: number): RayHit {
    const dirX = Math.cos(angle);
    const dirY = Math.sin(angle);
    let tileX = Math.floor(x / TILE_SIZE);
    let tileY = Math.floor(y / TILE_SIZE);

    const deltaX = dirX === 0 ? Infinity : Math.abs(TILE_SIZE / dirX);
    const deltaY = dirY === 0 ? Infinity : Math.abs(TILE_SIZE / dirY);
    const stepX = dirX < 0 ? -1 : 1;
    const stepY = dirY < 0 ? -1 : 1;

    let nextX = dirX === 0 ? Infinity : dirX < 0
        ? (x - tileX * TILE_SIZE) / -dirX
        : ((tileX + 1) * TILE_SIZE - x) / dirX;
    let nextY = dirY === 0 ? Infinity : dirY < 0
        ? (y - tileY * TILE_SIZE) / -dirY
        : ((tileY + 1) * TILE_SIZE - y) / dirY;

    let distance = 0;
    let side: "x" | "y" = "x";

    while (distance < maxDistance) {
        if (nextX < nextY) {
            distance = nextX;
            nextX += deltaX;
            tileX += stepX;
            side = "x";
        }
        else {
            distance = nextY;
            nextY += deltaY;
            tileY += stepY;
            side = "y";
        }

        const tile = getMapTileAt(map, tileX, tileY);
        if (tile === ".") continue;

        const hitX = x + dirX * distance;
        const hitY = y + dirY * distance;
        const textureX = side === "x"
            ? (hitY / TILE_SIZE) - Math.floor(hitY / TILE_SIZE)
            : (hitX / TILE_SIZE) - Math.floor(hitX / TILE_SIZE);

        return {
            x: hitX,
            y: hitY,
            distance,
            tile,
            textureX,
            side
        };
    }

    return {
        x: x + dirX * maxDistance,
        y: y + dirY * maxDistance,
        distance: maxDistance,
        tile: ".",
        textureX: 0,
        side
    };
}

//////////////////////
////// SERVER ////////
//////////////////////

export class DoomGameServer extends GameServer {
    private mode: DoomMode | null = null;
    private phase: DoomPhase = "mode_select";
    private players: Record<string, DoomPlayer> = {};
    private inputs: Record<string, DoomInput> = {};
    private shootBuffers: Record<string, number> = {};
    private weaponPickups: WeaponPickup[] = [];
    private events: DoomEvent[] = [];
    private lastShot: DoomShot | null = null;
    private timeLeft: number = TIMED_GAME_TIME;
    private matchTime: number = 0;
    private gameOver: boolean = false;
    private winnerId?: string;
    private gameOverTimer: number = GAME_OVER_TIME;
    private map: DoomMapData = DEFAULT_MAP;

    init(players: Record<string, Player>) {
        this.players = {};
        this.inputs = {};
        this.shootBuffers = {};
        this.weaponPickups = [];
        this.events = [];
        this.map = pickDoomMap(Object.keys(players).length);
        this.mode = null;
        this.phase = "mode_select";
        this.timeLeft = 0;
        this.matchTime = 0;
        this.gameOver = false;
        this.winnerId = undefined;
        this.gameOverTimer = GAME_OVER_TIME;

        Object.keys(players).forEach((id, index) => {
            const spawn = this.map.spawns[index % this.map.spawns.length];
            this.players[id] = {
                ...players[id],
                x: spawn.x,
                y: spawn.y,
                angle: spawn.angle,
                life: MAX_LIFE,
                score: 0,
                reload: 0,
                respawn: 0,
                dead: false,
                moving: false,
                weapon: "pistol",
                weapons: ["pistol"],
                ammo: { pistol: 0 }
            };
            this.inputs[id] = {
                forward: 0,
                strafe: 0,
                turn: 0,
                look: 0,
                shoot: false,
                weapon: "pistol"
            };
            this.shootBuffers[id] = 0;
        });

        this.addEvent("Scegliete una modalita per iniziare");
    }

    tick(incomingMessages: IncomingMsg[], dt: number): OutgoingMsg[] {
        this.lastShot = null;

        incomingMessages.forEach(message => {
            const payload = message.payload as DoomClientMsg;

            if (payload.kind === "doom_select_mode" && this.phase === "mode_select") {
                this.startMatch(payload.mode, message.clientId);
            }

            if (payload.kind === "doom_input" && this.players[message.clientId]) {
                const player = this.players[message.clientId];
                const previousInput = this.inputs[message.clientId];
                const lookDelta = clamp(payload.input.look || 0, -MAX_LOOK_DELTA_PER_INPUT, MAX_LOOK_DELTA_PER_INPUT);
                if (isWeaponName(payload.input.weapon) && player.weapons.indexOf(payload.input.weapon) >= 0) {
                    player.weapon = payload.input.weapon;
                }

                this.inputs[message.clientId] = {
                    forward: clamp(payload.input.forward, -1, 1),
                    strafe: clamp(payload.input.strafe, -1, 1),
                    turn: clamp(payload.input.turn, -1, 1),
                    look: clamp((previousInput?.look || 0) + lookDelta, -MAX_LOOK_DELTA_PER_INPUT, MAX_LOOK_DELTA_PER_INPUT),
                    shoot: payload.input.shoot,
                    weapon: player.weapon
                };
                if (payload.input.shoot) this.shootBuffers[message.clientId] = SHOOT_BUFFER_TIME;
            }
        });

        if (this.gameOver) {
            this.gameOverTimer -= dt;
            return [this.makeUpdateMessage()];
        }

        if (this.phase !== "playing") {
            return [this.makeUpdateMessage()];
        }

        if (this.mode === "timed") {
            this.timeLeft = Math.max(0, this.timeLeft - dt);
            if (this.timeLeft <= 0) {
                this.finishGame(this.getTopPlayerId());
                return [this.makeUpdateMessage()];
            }
        }

        this.matchTime += dt;
        this.updateWeaponPickups(dt);

        Object.keys(this.players).forEach(id => {
            const player = this.players[id];
            const input = this.inputs[id];

            if (player.dead) {
                input.look = 0;
                return;
            }

            if (player.respawn > 0) {
                player.respawn -= dt;
                input.look = 0;
                if (player.respawn <= 0) this.respawnPlayer(id);
                return;
            }

            player.reload = Math.max(0, player.reload - dt);
            this.movePlayer(player, input, dt);
            input.look = 0;
            this.pickupWeapon(player);

            const weapon = WEAPONS[player.weapon];
            const wantsShoot = weapon.auto ? input.shoot : this.shootBuffers[id] > 0;
            if (wantsShoot && player.reload <= 0) {
                this.shoot(id);
                this.shootBuffers[id] = 0;
            }
            else {
                this.shootBuffers[id] = Math.max(0, this.shootBuffers[id] - dt);
            }
        });

        return [this.makeUpdateMessage()];
    }

    isFinished(): boolean {
        return this.gameOver && this.gameOverTimer <= 0;
    }

    private makeUpdateMessage(): OutgoingMsg {
        return {
            payload: {
                kind: "doom_update",
                mode: this.mode,
                phase: this.phase,
                mapName: this.map.name,
                players: this.players,
                weaponPickups: this.weaponPickups,
                timeLeft: this.timeLeft,
                gameOver: this.gameOver,
                winnerId: this.winnerId,
                events: this.events,
                shot: this.lastShot || undefined
            } as DoomServerMsg
        };
    }

    private startMatch(mode: DoomMode, selectedById: string) {
        if (mode !== "battle_royale" && mode !== "timed") return;

        this.mode = mode;
        this.phase = "playing";
        this.timeLeft = mode === "timed" ? TIMED_GAME_TIME : 0;
        this.matchTime = 0;
        this.gameOver = false;
        this.winnerId = undefined;
        this.gameOverTimer = GAME_OVER_TIME;
        this.events = [];

        const spawns = shuffled(this.map.spawns);

        Object.keys(this.players).forEach((id, index) => {
            const spawn = spawns[index % spawns.length];
            const player = this.players[id];

            player.x = spawn.x;
            player.y = spawn.y;
            player.angle = spawn.angle;
            player.life = MAX_LIFE;
            player.score = 0;
            player.reload = 0;
            player.respawn = 0;
            player.dead = false;
            player.moving = false;
            player.weapon = "pistol";
            player.weapons = ["pistol"];
            player.ammo = { pistol: 0 };
        });

        this.weaponPickups = this.makeWeaponPickups();

        const selectedBy = this.players[selectedById];
        const name = selectedBy ? selectedBy.name : "Un player";
        this.addEvent(`${name} ha scelto ${modeName(mode)} - ${this.map.title}`);
    }

    private makeWeaponPickups(): WeaponPickup[] {
        const weapons = matchWeapons(this.map.weaponSpawns.length);
        return shuffled(this.map.weaponSpawns).map((point, index) => ({
            id: `weapon-${index}`,
            x: point.x,
            y: point.y,
            weapon: weapons[index],
            respawn: index < INITIAL_WEAPON_SPAWNS ? 0 : 25 + index * 10
        }));
    }

    private updateWeaponPickups(dt: number) {
        this.weaponPickups.forEach(pickup => {
            if (pickup.respawn <= 0) return;

            pickup.respawn -= dt;
            if (pickup.respawn <= 0) {
                pickup.respawn = 0;
                pickup.weapon = randomWeapon(this.matchTime);
            }
        });
    }

    private addEvent(text: string) {
        this.events.push({
            text,
            time: Date.now()
        });
        this.events = this.events.slice(-7);
    }

    private movePlayer(player: DoomPlayer, input: DoomInput, dt: number) {
        const oldX = player.x;
        const oldY = player.y;

        player.angle += input.turn * ROTATION_SPEED * dt + input.look;
        player.angle = normalizeAngle(player.angle);

        const forwardX = Math.cos(player.angle) * input.forward;
        const forwardY = Math.sin(player.angle) * input.forward;
        const sideX = Math.cos(player.angle + Math.PI / 2) * input.strafe;
        const sideY = Math.sin(player.angle + Math.PI / 2) * input.strafe;

        const nextX = player.x + (forwardX * PLAYER_SPEED + sideX * STRAFE_SPEED) * dt;
        const nextY = player.y + (forwardY * PLAYER_SPEED + sideY * STRAFE_SPEED) * dt;

        const movedX = canMove(this.map, nextX, player.y);
        if (movedX) player.x = nextX;

        const movedY = canMove(this.map, player.x, nextY);
        if (movedY) player.y = nextY;

        const movedDistance = distanceBetween({ x: oldX, y: oldY }, player);
        if (input.forward !== 0 && (!movedX || !movedY) && movedDistance < PLAYER_SPEED * dt * 0.55) {
            const turnSign = input.look < 0 || input.turn < 0 ? -1 : 1;
            if (!this.glideAlongWall(player, turnSign, dt)) this.glideAlongWall(player, -turnSign, dt);
        }

        player.moving = distanceBetween({ x: oldX, y: oldY }, player) > 0.5;
    }

    private glideAlongWall(player: DoomPlayer, direction: number, dt: number): boolean {
        const angle = player.angle + Math.PI / 2 * direction;
        const nextX = player.x + Math.cos(angle) * WALL_GLIDE_SPEED * dt;
        const nextY = player.y + Math.sin(angle) * WALL_GLIDE_SPEED * dt;

        if (!canMove(this.map, nextX, nextY)) return false;

        player.x = nextX;
        player.y = nextY;
        return true;
    }

    private pickupWeapon(player: DoomPlayer) {
        this.weaponPickups.forEach(pickup => {
            if (pickup.respawn > 0) return;
            if (distanceBetween(player, pickup) > WEAPON_PICKUP_RADIUS) return;

            const pickedWeapon = pickup.weapon;
            if (player.weapons.indexOf(pickup.weapon) < 0) {
                player.weapons.push(pickup.weapon);
            }
            player.ammo[pickedWeapon] = (player.ammo[pickedWeapon] || 0) + WEAPONS[pickedWeapon].ammo;

            this.addEvent(`${player.name} ha preso ${WEAPONS[pickedWeapon].name}`);

            pickup.weapon = randomWeapon(this.matchTime);
            pickup.respawn = WEAPONS[pickedWeapon].respawnTime;
        });
    }

    private shoot(shooterId: string) {
        const shooter = this.players[shooterId];
        const weapon = WEAPONS[shooter.weapon];
        if (shooter.weapon !== "pistol" && (shooter.ammo[shooter.weapon] || 0) <= 0) {
            shooter.weapon = "pistol";
            return;
        }

        const shotWeapon = shooter.weapon;
        shooter.reload = weapon.cooldown;
        if (shotWeapon !== "pistol") {
            shooter.ammo[shotWeapon] = (shooter.ammo[shotWeapon] || 0) - 1;
            if ((shooter.ammo[shotWeapon] || 0) <= 0) {
                shooter.weapons = shooter.weapons.filter(weaponName => weaponName !== shotWeapon);
                shooter.weapon = "pistol";
            }
        }

        let hitId: string | undefined = undefined;
        let hitAngleDiff = 0;
        const aim = weapon.shotStyle === "beam" ? weapon.aim * 1.25 : weapon.shotStyle === "bfg" ? weapon.aim * 1.35 : weapon.aim;
        const wallHit = castRay(this.map, shooter.x, shooter.y, shooter.angle, weapon.range);
        let hitDistance = Math.min(weapon.range, wallHit.distance);

        Object.keys(this.players).forEach(id => {
            const target = this.players[id];
            if (id === shooterId || target.dead || target.respawn > 0) return;

            const dx = target.x - shooter.x;
            const dy = target.y - shooter.y;
            const distance = Math.sqrt(dx * dx + dy * dy);
            const angleToTarget = Math.atan2(dy, dx);
            const angleDiff = normalizeAngle(angleToTarget - shooter.angle);
            const wallDistance = castRay(this.map, shooter.x, shooter.y, angleToTarget, distance).distance;

            if (distance < hitDistance &&
                Math.abs(angleDiff) < aim &&
                wallDistance >= distance - PLAYER_RADIUS) {
                hitId = id;
                hitAngleDiff = Math.abs(angleDiff);
                hitDistance = distance;
            }
        });

        let hitX = shooter.x + Math.cos(shooter.angle) * hitDistance;
        let hitY = shooter.y + Math.sin(shooter.angle) * hitDistance;

        if (hitId) {
            const target = this.players[hitId];
            const centerHit = clamp(1 - hitAngleDiff / aim, 0, 1);
            const damage = weapon.shotStyle === "spread" ? weapon.damage * (0.65 + centerHit * 0.35) : weapon.damage;

            hitX = target.x;
            hitY = target.y;
            this.damagePlayer(target, shooter, damage, weapon);
        }

        if (weapon.splashRadius > 0) {
            Object.keys(this.players).forEach(id => {
                const target = this.players[id];
                if (id === shooterId || id === hitId || target.dead || target.respawn > 0) return;

                const splashDistance = distanceBetween(target, { x: hitX, y: hitY });
                if (splashDistance > weapon.splashRadius) return;

                const dx = target.x - shooter.x;
                const dy = target.y - shooter.y;
                const distance = Math.sqrt(dx * dx + dy * dy);
                const angleToTarget = Math.atan2(dy, dx);
                const wallDistance = castRay(this.map, shooter.x, shooter.y, angleToTarget, distance).distance;
                if (wallDistance < distance - PLAYER_RADIUS) return;

                const damage = weapon.damage * 0.65 * (1 - splashDistance / weapon.splashRadius);
                this.damagePlayer(target, shooter, damage, weapon);
            });
        }

        this.lastShot = {
            shooterId,
            x: shooter.x,
            y: shooter.y,
            angle: shooter.angle,
            weapon: shotWeapon,
            hitX,
            hitY,
            hitId
        };
    }

    private damagePlayer(target: DoomPlayer, shooter: DoomPlayer, damage: number, weapon: WeaponInfo) {
        target.life -= Math.max(1, Math.round(damage));

        if (target.life <= 0) {
            target.life = 0;
            shooter.score += 1;
            this.addEvent(`${shooter.name} ha eliminato ${target.name} con ${weapon.name}`);
            this.killPlayer(target, shooter);
        }
    }

    private killPlayer(target: DoomPlayer, shooter: DoomPlayer) {
        if (this.mode === "battle_royale") {
            target.dead = true;
            target.respawn = 0;
            shooter.life = clamp(shooter.life + 20, 0, MAX_LIFE);
            this.checkBattleRoyaleWinner();
        }
        else {
            target.respawn = RESPAWN_TIME;
        }
    }

    private checkBattleRoyaleWinner() {
        const playerIds = Object.keys(this.players);
        if (playerIds.length <= 1) return;

        const aliveIds = playerIds.filter(id => !this.players[id].dead);
        if (aliveIds.length <= 1) this.finishGame(aliveIds[0]);
    }

    private getTopPlayerId(): string | undefined {
        const playerIds = Object.keys(this.players);
        if (playerIds.length === 0) return undefined;

        return playerIds.sort((a, b) => this.players[b].score - this.players[a].score)[0];
    }

    private finishGame(winnerId?: string) {
        this.gameOver = true;
        this.phase = "game_over";
        this.winnerId = winnerId;
        this.gameOverTimer = GAME_OVER_TIME;
        this.addEvent(winnerId ? `${this.players[winnerId].name} ha vinto la partita` : "Partita finita in pareggio");
    }

    private respawnPlayer(id: string) {
        const spawn = this.pickRespawnPoint();
        const player = this.players[id];

        player.x = spawn.x;
        player.y = spawn.y;
        player.angle = spawn.angle;
        player.life = MAX_LIFE;
        player.respawn = 0;
        player.reload = 0;
        player.dead = false;
        player.moving = false;
        player.weapon = "pistol";
        player.weapons = ["pistol"];
        player.ammo = { pistol: 0 };
    }

    private pickRespawnPoint() {
        const alivePlayers = Object.values(this.players).filter(player => !player.dead && player.respawn <= 0);
        const safeSpawns = this.map.spawns.filter(spawn => {
            return alivePlayers.every(player => distanceBetween(player, spawn) > TILE_SIZE * 4);
        });

        if (safeSpawns.length > 0) return randomItem(safeSpawns);
        return randomItem(this.map.spawns);
    }
}

//////////////////////
////// CLIENT ////////
//////////////////////

const DOOM_ASSET_PATH = "/assets/doom";
const SPRITE_PATH = `${DOOM_ASSET_PATH}/sprites/`;

function spriteFile(file: string): string {
    return SPRITE_PATH + file;
}

class SpriteImage {
    private image: HTMLImageElement;
    private loaded: boolean = false;
    private failed: boolean = false;

    constructor(file: string) {
        this.image = new Image();
        this.image.onload = () => this.loaded = true;
        this.image.onerror = () => this.failed = true;
        this.image.src = spriteFile(file);
    }

    draw(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, bottom: boolean = false): boolean {
        if (!this.loaded || this.failed) return false;

        const ratio = this.image.width / this.image.height;
        let drawW = Math.min(w, h * ratio);
        let drawH = drawW / ratio;

        if (drawH > h) {
            drawH = h;
            drawW = drawH * ratio;
        }

        ctx.drawImage(
            this.image,
            x + (w - drawW) / 2,
            bottom ? y + h - drawH : y + (h - drawH) / 2,
            drawW,
            drawH
        );
        return true;
    }
}

class SpriteSet {
    private frames: SpriteImage[];

    constructor(files: string[]) {
        this.frames = files.map(file => new SpriteImage(file));
    }

    draw(ctx: CanvasRenderingContext2D, frame: number, x: number, y: number, w: number, h: number, bottom: boolean = false): boolean {
        if (this.frames.length === 0) return false;

        const safeFrame = Math.floor(frame) % this.frames.length;
        return this.frames[safeFrame].draw(ctx, x, y, w, h, bottom);
    }

    frameCount(): number {
        return this.frames.length;
    }
}

class DoomSprites {
    private enemy: SpriteSet;
    private weapons: Record<WeaponName, SpriteSet>;
    private pickups: Record<WeaponName, SpriteSet>;
    private effects: Record<string, SpriteSet>;

    constructor() {
        this.enemy = new SpriteSet(["PLAYA1.png", "PLAYB1.png", "PLAYC1.png", "PLAYD1.png"]);
        this.weapons = {} as Record<WeaponName, SpriteSet>;
        this.pickups = {} as Record<WeaponName, SpriteSet>;
        this.effects = {
            puff: new SpriteSet(["PUFFA0.png", "PUFFB0.png", "PUFFC0.png", "PUFFD0.png"]),
            rocket: new SpriteSet(["MISLA1.png"]),
            rocketBoom: new SpriteSet(["MISLB0.png", "MISLC0.png", "MISLD0.png"]),
            plasma: new SpriteSet(["PLSSA0.png"]),
            bfg: new SpriteSet(["BFS1A0.png"])
        };

        WEAPON_ORDER.forEach(weapon => {
            this.weapons[weapon] = new SpriteSet(WEAPONS[weapon].frames);
            this.pickups[weapon] = new SpriteSet([WEAPONS[weapon].pickup]);
        });
    }

    drawEnemy(ctx: CanvasRenderingContext2D, frame: number, x: number, y: number, w: number, h: number): boolean {
        return this.enemy.draw(ctx, frame, x, y, w, h, true);
    }

    drawWeapon(ctx: CanvasRenderingContext2D, weapon: WeaponName, frame: number, x: number, y: number, w: number, h: number): boolean {
        return this.weapons[weapon].draw(ctx, frame, x, y, w, h, true);
    }

    drawPickup(ctx: CanvasRenderingContext2D, weapon: WeaponName, x: number, y: number, w: number, h: number): boolean {
        return this.pickups[weapon].draw(ctx, 0, x, y, w, h, true);
    }

    drawEffect(ctx: CanvasRenderingContext2D, name: string, frame: number, x: number, y: number, w: number, h: number): boolean {
        const effect = this.effects[name];
        return effect ? effect.draw(ctx, frame, x, y, w, h) : false;
    }

    enemyFrameCount(): number {
        return this.enemy.frameCount();
    }

    weaponFrameCount(weapon: WeaponName): number {
        return this.weapons[weapon].frameCount();
    }
}

class TextureImage {
    private image: HTMLImageElement;
    private loaded: boolean = false;
    private failed: boolean = false;

    constructor(file: string) {
        this.image = new Image();
        this.image.onload = () => this.loaded = true;
        this.image.onerror = () => this.failed = true;
        this.image.src = file;
    }

    drawColumn(ctx: CanvasRenderingContext2D, textureX: number, x: number, y: number, w: number, h: number): boolean {
        if (!this.loaded || this.failed) return false;

        const oldSmoothing = ctx.imageSmoothingEnabled;
        const sampleX = Math.floor(clamp(textureX, 0, 0.99) * 64) / 64;
        const sx = Math.floor(sampleX * this.image.width);

        ctx.imageSmoothingEnabled = false;
        ctx.drawImage(this.image, sx, 0, 1, this.image.height, x, y, w, h);
        ctx.imageSmoothingEnabled = oldSmoothing;
        return true;
    }
}

class DoomTextures {
    private walls: Record<string, TextureImage>;

    constructor() {
        this.walls = {
            wall_1: new TextureImage(`${DOOM_ASSET_PATH}/textures/wall_1.png`)
        };
    }

    drawWall(ctx: CanvasRenderingContext2D, tile: string, textureX: number, x: number, y: number, w: number, h: number, shade: number): boolean {
        const wall = WALLS[tile] || WALLS["#"];
        const texture = this.walls[wall.texture];
        if (!texture || !texture.drawColumn(ctx, textureX, x, y, w, h)) return false;

        ctx.fillStyle = `rgba(0, 0, 0, ${clamp(1 - shade, 0, 0.72)})`;
        ctx.fillRect(x, y, w, h);
        return true;
    }

    drawFloor(ctx: CanvasRenderingContext2D, screenW: number, screenH: number): boolean {
        const floor = ctx.createLinearGradient(0, screenH / 2, 0, screenH);
        floor.addColorStop(0, "#242321");
        floor.addColorStop(1, "#121211");
        ctx.fillStyle = floor;
        ctx.fillRect(0, screenH / 2, screenW, screenH / 2);
        return true;
    }

    drawCeiling(ctx: CanvasRenderingContext2D, screenW: number, screenH: number): boolean {
        const ceiling = ctx.createLinearGradient(0, 0, 0, screenH / 2);
        ceiling.addColorStop(0, "#090a0a");
        ceiling.addColorStop(1, "#191817");
        ctx.fillStyle = ceiling;
        ctx.fillRect(0, 0, screenW, screenH / 2);
        return true;
    }
}

export class DoomGameClient extends GameClient {
    private players: Record<string, DoomPlayer> | null = null;
    private weaponPickups: WeaponPickup[] = [];
    private mode: DoomMode | null = null;
    private phase: DoomPhase = "mode_select";
    private timeLeft: number = 0;
    private gameOver: boolean = false;
    private winnerId?: string;
    private events: DoomEvent[] = [];
    private exitButton: Button;
    private battleButton: Button;
    private timedButton: Button;
    private userExited: boolean = false;
    private shootPressed: boolean = false;
    private shootHeld: boolean = false;
    private strafeLeft: boolean = false;
    private strafeRight: boolean = false;
    private turnLeft: boolean = false;
    private turnRight: boolean = false;
    private pendingLook: number = 0;
    private lastLookTime: number = 0;
    private lastLookDelta: number = 0;
    private mouseSensitivity: number = DEFAULT_MOUSE_LOOK_SENSITIVITY;
    private shotToDraw: DoomShot | null = null;
    private shotTimer: number = 0;
    private shotDuration: number = 0;
    private animTime: number = 0;
    private sprites: DoomSprites;
    private textures: DoomTextures;
    private sounds: Record<string, HTMLAudioElement> = {};
    private soundsUnlocked: boolean = false;
    private map: DoomMapData = DEFAULT_MAP;
    private selectedWeapon: WeaponName = "pistol";
    private pendingWeapon: WeaponName | null = null;
    private messageQueue: DoomClientMsg[] = [];

    constructor(userInput: UserInput, myId: string) {
        super(userInput, myId);
        this.sprites = new DoomSprites();
        this.textures = new DoomTextures();
        ["pistol", "shotgun", "rocket", "plasma", "bfg", "pickup", "explosion"].forEach(name => {
            this.sounds[name] = new Audio(`${DOOM_ASSET_PATH}/sounds/${name}.wav`);
        });

        const savedSensitivity = localStorage.getItem(MOUSE_SENSITIVITY_KEY);
        if (savedSensitivity !== null && Number.isFinite(Number(savedSensitivity))) {
            this.mouseSensitivity = clamp(Number(savedSensitivity), MIN_MOUSE_LOOK_SENSITIVITY, MAX_MOUSE_LOOK_SENSITIVITY);
        }

        this.exitButton = new Button("exit", this.userInput, () => {
            this.userExited = true;
            this.releaseMouseLook();
        });
        this.exitButton.setColors({ main: "#7b1f1f" });

        this.battleButton = new Button("Battle Royale", this.userInput, () => this.selectMode("battle_royale"));
        this.battleButton.setColors({ main: "#8d2d2d" });

        this.timedButton = new Button("A tempo", this.userInput, () => this.selectMode("timed"));
        this.timedButton.setColors({ main: "#2d6b86" });

        document.addEventListener("keydown", event => {
            if (this.userExited) return;
            this.unlockSounds();

            if (event.code.startsWith("Digit")) {
                const index = Number(event.code.replace("Digit", "")) - 1;
                const weapon = WEAPON_ORDER[index];
                if (weapon && this.canSelectWeapon(weapon)) {
                    this.selectedWeapon = weapon;
                    this.pendingWeapon = weapon;
                }
                event.preventDefault();
            }
            else if (event.code === "Space" && this.phase === "playing") {
                this.shootHeld = true;
                if (!event.repeat) this.shootPressed = true;
                event.preventDefault();
            }
            else if (event.code === "KeyQ") {
                this.strafeLeft = true;
            }
            else if (event.code === "KeyE") {
                this.strafeRight = true;
            }
            else if (event.code === "ArrowLeft") {
                this.turnLeft = true;
                event.preventDefault();
            }
            else if (event.code === "ArrowRight") {
                this.turnRight = true;
                event.preventDefault();
            }
            else if (event.code === "NumpadSubtract") {
                this.changeMouseSensitivity(-1);
                event.preventDefault();
            }
            else if (event.code === "NumpadAdd") {
                this.changeMouseSensitivity(1);
                event.preventDefault();
            }
            else if (event.code === "Escape") {
                this.userExited = true;
                this.releaseMouseLook();
            }
        });

        document.addEventListener("keyup", event => {
            if (event.code === "Space") this.shootHeld = false;
            else if (event.code === "KeyQ") this.strafeLeft = false;
            else if (event.code === "KeyE") this.strafeRight = false;
            else if (event.code === "ArrowLeft") this.turnLeft = false;
            else if (event.code === "ArrowRight") this.turnRight = false;
            else if (event.code === "Escape") {
                this.userExited = true;
                this.releaseMouseLook();
            }
        });

        document.addEventListener("pointerlockchange", () => {
            if (document.pointerLockElement === this.userInput.canvas) return;

            this.pendingLook = 0;
            this.shootHeld = false;
            this.userInput.canvas.style.cursor = "default";
            if (this.phase === "playing" && !this.gameOver && !this.userExited) this.userExited = true;
        });

        document.addEventListener("pointermove", event => {
            if (document.pointerLockElement !== this.userInput.canvas) return;
            this.queueMouseLook(event.movementX, event.timeStamp);
        });

        this.userInput.canvas.addEventListener("pointerdown", event => {
            this.unlockSounds();
            if (!this.userExited && this.phase === "mode_select") {
                if (this.battleButton.isInside(event)) this.selectMode("battle_royale");
                else if (this.timedButton.isInside(event)) this.selectMode("timed");
                else return;

                event.preventDefault();
                return;
            }

            if (!this.userExited && this.phase === "playing") {
                if (this.exitButton.isInside(event)) return;

                if (document.pointerLockElement !== this.userInput.canvas) {
                    this.requestMouseLook();
                    event.preventDefault();
                    return;
                }

                this.shootHeld = true;
                this.shootPressed = true;
                event.preventDefault();
            }
        });
        this.userInput.canvas.addEventListener("pointerup", () => this.shootHeld = false);
        this.userInput.canvas.addEventListener("wheel", event => {
            if (this.userExited || this.phase !== "playing" || event.deltaY === 0) return;

            this.cycleWeapon(event.deltaY > 0 ? 1 : -1);
            event.preventDefault();
            event.stopPropagation();
        }, { passive: false });
        document.addEventListener("mouseup", () => this.shootHeld = false);
    }

    private selectMode(mode: DoomMode) {
        this.requestMouseLook();
        if (this.messageQueue.some(message => message.kind === "doom_select_mode")) return;

        this.messageQueue.push({
            kind: "doom_select_mode",
            mode
        });
    }

    private changeMouseSensitivity(direction: number) {
        this.mouseSensitivity = clamp(
            this.mouseSensitivity + direction * MOUSE_LOOK_SENSITIVITY_STEP,
            MIN_MOUSE_LOOK_SENSITIVITY,
            MAX_MOUSE_LOOK_SENSITIVITY
        );
        localStorage.setItem(MOUSE_SENSITIVITY_KEY, `${this.mouseSensitivity}`);
    }

    private cycleWeapon(direction: number) {
        const me = this.players ? this.players[this.myId] : null;
        const ownedWeapons = WEAPON_ORDER.filter(weapon => !me || me.weapons.indexOf(weapon) >= 0);
        if (ownedWeapons.length <= 1) return;

        const currentWeapon = ownedWeapons.indexOf(this.selectedWeapon) >= 0 ? this.selectedWeapon : me?.weapon || "pistol";
        const currentIndex = ownedWeapons.indexOf(currentWeapon);
        const nextIndex = (currentIndex + direction + ownedWeapons.length) % ownedWeapons.length;
        this.selectedWeapon = ownedWeapons[nextIndex];
        this.pendingWeapon = this.selectedWeapon;
    }

    private queueMouseLook(pixelDelta: number, time: number) {
        if (this.userExited || this.phase !== "playing") return;
        if (!Number.isFinite(pixelDelta) || pixelDelta === 0) return;
        if (time && Math.abs(time - this.lastLookTime) < 2 && pixelDelta === this.lastLookDelta) return;

        this.lastLookTime = time;
        this.lastLookDelta = pixelDelta;

        const fastMove = Math.max(0, Math.abs(pixelDelta) - 4);
        const assist = 1 + clamp(fastMove / 40, 0, 1) * MOUSE_LOOK_ASSIST;
        this.pendingLook = clamp(
            this.pendingLook + pixelDelta * this.mouseSensitivity * assist,
            -MAX_LOOK_DELTA_PER_INPUT,
            MAX_LOOK_DELTA_PER_INPUT
        );
    }

    private consumeMouseLook(): number {
        const look = this.pendingLook;
        this.pendingLook = 0;
        return look;
    }

    private requestMouseLook() {
        if (document.pointerLockElement === this.userInput.canvas) return;
        if (this.userInput.canvas.requestPointerLock) this.userInput.canvas.requestPointerLock();
    }

    private releaseMouseLook() {
        this.pendingLook = 0;
        this.shootHeld = false;
        this.userInput.canvas.style.cursor = "default";
        if (document.pointerLockElement === this.userInput.canvas && document.exitPointerLock) {
            document.exitPointerLock();
        }
    }

    private updateMouseCursor() {
        this.userInput.canvas.style.cursor = this.phase === "playing" &&
            !this.gameOver &&
            !this.userExited &&
            document.pointerLockElement === this.userInput.canvas ? "none" : "default";
    }

    async init(players: Record<string, Player>): Promise<void> {
        return Promise.resolve();
    }

    private canSelectWeapon(weapon: WeaponName): boolean {
        if (!this.players || !this.players[this.myId]) return true;
        return this.players[this.myId].weapons.indexOf(weapon) >= 0;
    }

    draw(ctx: CanvasRenderingContext2D, dt: number) {
        const { screenW, screenH } = this.userInput;
        this.animTime += dt;
        this.updateMouseCursor();

        ctx.fillStyle = "#111111";
        ctx.fillRect(0, 0, screenW, screenH);

        if (this.players === null || !this.players[this.myId]) {
            ctx.fillStyle = "#eeeeee";
            ctx.font = "bold 32px Arial";
            ctx.textAlign = "center";
            ctx.textBaseline = "middle";
            ctx.fillText("Doom", screenW / 2, screenH / 2);
            return;
        }

        if (this.phase === "mode_select") {
            this.drawModeSelect(ctx);
            return;
        }

        const me = this.players[this.myId];
        this.drawWorld(ctx, me);
        this.drawPickups(ctx, me);
        this.drawEnemies(ctx, me);
        this.drawShotTrail(ctx, me);
        this.drawWeapon(ctx, me, dt);
        this.drawKillFeed(ctx);
        this.drawHud(ctx, me);
        this.drawMiniMap(ctx, me);
        this.drawScoreboard(ctx, me);

        if (this.gameOver) this.drawGameOver(ctx);
    }

    handleMessage(message: DoomServerMsg) {
        if (message.kind !== "doom_update") return;

        const oldMe = this.players ? this.players[this.myId] : null;
        this.mode = message.mode;
        this.phase = message.phase;
        this.map = getDoomMap(message.mapName);
        this.players = message.players;
        this.weaponPickups = message.weaponPickups;
        this.timeLeft = message.timeLeft;
        this.gameOver = message.gameOver;
        this.winnerId = message.winnerId;
        this.events = message.events || [];

        if (this.phase !== "playing") this.releaseMouseLook();

        if (this.players[this.myId]) {
            const me = this.players[this.myId];
            const oldAmmo = oldMe ? WEAPON_ORDER.reduce((total, weapon) => total + (oldMe.ammo?.[weapon] || 0), 0) : 0;
            const newAmmo = WEAPON_ORDER.reduce((total, weapon) => total + (me.ammo?.[weapon] || 0), 0);
            if (oldMe && newAmmo > oldAmmo) this.playSound("pickup");

            if (this.pendingWeapon && me.weapon === this.pendingWeapon) {
                this.selectedWeapon = me.weapon;
                this.pendingWeapon = null;
            }
            else if (this.pendingWeapon && me.weapons.indexOf(this.pendingWeapon) < 0) {
                this.selectedWeapon = me.weapon;
                this.pendingWeapon = null;
            }
            else if (!this.pendingWeapon || me.weapons.indexOf(this.selectedWeapon) < 0) {
                this.selectedWeapon = me.weapon;
            }
        }

        if (message.shot) {
            this.shotToDraw = message.shot;
            this.shotTimer = message.shot.weapon === "bfg" ? 0.55 : message.shot.weapon === "rocket" ? 0.42 : message.shot.weapon === "plasma" ? 0.24 : 0.14;
            this.shotDuration = this.shotTimer;
            this.playSound(message.shot.weapon);
            if (message.shot.weapon === "rocket" || message.shot.weapon === "bfg") {
                setTimeout(() => this.playSound("explosion"), 90);
            }
        }
    }

    private playSound(name: string) {
        if (name === "chaingun") name = "pistol";
        const sound = this.sounds[name];
        if (!sound) return;

        sound.volume = 0.55;
        sound.currentTime = 0;
        sound.play().catch(() => {});
    }

    private unlockSounds() {
        if (this.soundsUnlocked) return;
        this.soundsUnlocked = true;

        Object.values(this.sounds).forEach(sound => {
            sound.volume = 0;
            sound.play().then(() => {
                sound.pause();
                sound.currentTime = 0;
                sound.volume = 0.55;
            }).catch(() => {
                sound.volume = 0.55;
            });
        });
    }

    flushMessages(): DoomClientMsg[] {
        const messages = this.messageQueue;
        this.messageQueue = [];

        if (this.phase !== "playing") {
            this.shootPressed = false;
            this.shootHeld = false;
            this.pendingLook = 0;
            return messages;
        }

        const forward = -this.userInput.moveDirectionY;
        const keyboardTurn = (this.turnRight ? 1 : 0) - (this.turnLeft ? 1 : 0);
        const turn = clamp(keyboardTurn, -1, 1);
        const strafe = clamp((this.strafeRight ? 1 : 0) - (this.strafeLeft ? 1 : 0) + this.userInput.moveDirectionX, -1, 1);
        const currentWeapon = this.players && this.players[this.myId] ? this.players[this.myId].weapon : this.selectedWeapon;

        const message: DoomClientMsg = {
            kind: "doom_input",
            input: {
                forward,
                strafe,
                turn,
                look: this.consumeMouseLook(),
                shoot: WEAPONS[currentWeapon].auto ? this.shootHeld : this.shootPressed,
                weapon: this.selectedWeapon
            }
        };

        this.shootPressed = false;
        messages.push(message);
        return messages;
    }

    isFinished(): boolean {
        return this.userExited;
    }

    private getModeTitle(): string {
        if (this.mode === null) return "Doom";
        if (this.mode === "battle_royale") return "Doom Battle Royale";
        return "Doom a tempo";
    }

    private drawModeSelect(ctx: CanvasRenderingContext2D) {
        const { screenW, screenH } = this.userInput;

        ctx.fillStyle = "#101010";
        ctx.fillRect(0, 0, screenW, screenH);

        this.drawMapPreview(ctx);

        ctx.fillStyle = "rgba(0, 0, 0, 0.72)";
        ctx.fillRect(0, 0, screenW, screenH);

        ctx.fillStyle = "#eeeeee";
        ctx.font = "bold 42px Arial";
        ctx.textAlign = "center";
        ctx.textBaseline = "middle";
        ctx.fillText("Doom", screenW / 2, screenH / 2 - 125);

        ctx.fillStyle = "#bbbbbb";
        ctx.font = "20px Arial";
        ctx.fillText("Scegli la modalita della partita", screenW / 2, screenH / 2 - 78);

        const btnW = Math.min(280, screenW * 0.72);
        const btnH = 58;
        const gap = 18;
        const stacked = screenW < 660;
        const startX = stacked ? screenW / 2 - btnW / 2 : screenW / 2 - btnW - gap / 2;
        const y = stacked ? screenH / 2 - btnH - gap / 2 : screenH / 2 - btnH / 2;

        this.battleButton.draw(ctx, startX, y, btnW, btnH);
        this.timedButton.draw(ctx, stacked ? startX : startX + btnW + gap, stacked ? y + btnH + gap : y, btnW, btnH);

        ctx.fillStyle = "#aaaaaa";
        ctx.font = "16px Arial";
        ctx.fillText("Il primo player che clicca avvia la modalita per tutti", screenW / 2, screenH / 2 + 72);

        this.exitButton.draw(ctx, screenW - 105, 20, 90, 34);
    }

    private drawMapPreview(ctx: CanvasRenderingContext2D) {
        const { screenW, screenH } = this.userInput;
        const map = this.map;
        const scale = Math.max(screenW / map.tiles[0].length, screenH / map.tiles.length);

        for (let y = 0; y < map.tiles.length; y++) {
            for (let x = 0; x < map.tiles[y].length; x++) {
                const tile = map.tiles[y][x];
                if (tile === ".") ctx.fillStyle = "#171717";
                else ctx.fillStyle = WALLS[tile]?.miniMap || WALLS["#"].miniMap;
                ctx.fillRect(x * scale, y * scale, scale + 1, scale + 1);
            }
        }
    }

    private drawWorld(ctx: CanvasRenderingContext2D, me: DoomPlayer) {
        const { screenW, screenH } = this.userInput;
        const rayCount = Math.max(1, Math.floor(screenW / 2));
        const columnW = screenW / rayCount;

        this.textures.drawCeiling(ctx, screenW, screenH);
        this.textures.drawFloor(ctx, screenW, screenH);

        for (let i = 0; i < rayCount; i++) {
            const rayPart = i / rayCount;
            const rayAngle = me.angle - FOV / 2 + rayPart * FOV;
            const hit = castRay(this.map, me.x, me.y, rayAngle, MAX_VIEW_DISTANCE);
            const fixedDistance = Math.max(1, hit.distance * Math.cos(rayAngle - me.angle));
            const wallHeight = TILE_SIZE * screenH / fixedDistance;
            const shade = clamp(1 - fixedDistance / MAX_VIEW_DISTANCE, 0.20, 1) * (hit.side === "y" ? 0.82 : 1);
            const wall = WALLS[hit.tile] || WALLS["#"];
            const tileTone = (Math.floor(hit.x / TILE_SIZE) + Math.floor(hit.y / TILE_SIZE)) % 2 === 0 ? 1 : 0.9;
            const light = shade * tileTone;
            const red = Math.floor(wall.r * light);
            const green = Math.floor(wall.g * light);
            const blue = Math.floor(wall.b * light);
            const wallX = i * columnW;
            const wallY = screenH / 2 - wallHeight / 2;

            if (!this.textures.drawWall(ctx, hit.tile, hit.textureX, wallX, wallY, Math.ceil(columnW) + 1, wallHeight, shade)) {
                ctx.fillStyle = `rgb(${red}, ${green}, ${blue})`;
                ctx.fillRect(
                    wallX,
                    wallY,
                    Math.ceil(columnW) + 1,
                    wallHeight
                );
            }
        }
    }

    private drawPickups(ctx: CanvasRenderingContext2D, me: DoomPlayer) {
        const { screenW, screenH } = this.userInput;
        const pickups = this.weaponPickups
            .filter(pickup => pickup.respawn <= 0)
            .map(pickup => {
                const dx = pickup.x - me.x;
                const dy = pickup.y - me.y;
                const distance = Math.sqrt(dx * dx + dy * dy);
                const angle = normalizeAngle(Math.atan2(dy, dx) - me.angle);

                return { pickup, distance, angle };
            })
            .filter(item => Math.abs(item.angle) < FOV / 2)
            .filter(item => castRay(this.map, me.x, me.y, me.angle + item.angle, item.distance).distance >= item.distance - PLAYER_RADIUS)
            .sort((a, b) => b.distance - a.distance);

        pickups.forEach(item => {
            const fixedDistance = item.distance * Math.cos(item.angle);
            const floorLine = screenH / 2 + (TILE_SIZE * screenH / fixedDistance) / 2;
            const pickupH = TILE_SIZE * PICKUP_SPRITE_SCALE * screenH / fixedDistance;
            const pickupW = pickupH;
            const pickupX = screenW / 2 + (item.angle / (FOV / 2)) * screenW / 2;
            const pickupY = floorLine - pickupH;
            const drawn = this.sprites.drawPickup(
                ctx,
                item.pickup.weapon,
                pickupX - pickupW / 2,
                pickupY,
                pickupW,
                pickupH
            );
            if (drawn) return;

            const weapon = WEAPONS[item.pickup.weapon];
            const centerY = pickupY + pickupH / 2;
            ctx.fillStyle = weapon.color;
            ctx.beginPath();
            ctx.moveTo(pickupX, pickupY);
            ctx.lineTo(pickupX + pickupW / 2, centerY);
            ctx.lineTo(pickupX, pickupY + pickupH);
            ctx.lineTo(pickupX - pickupW / 2, centerY);
            ctx.fill();

            ctx.fillStyle = "#111111";
            ctx.fillRect(pickupX - pickupW * 0.3, centerY - pickupH * 0.05, pickupW * 0.6, pickupH * 0.1);
        });
    }

    private drawEnemies(ctx: CanvasRenderingContext2D, me: DoomPlayer) {
        if (!this.players) return;

        const { screenW, screenH } = this.userInput;
        const players = this.players;
        const enemies = Object.keys(players)
            .filter(id => id !== this.myId)
            .map(id => {
                const player = players[id];
                const dx = player.x - me.x;
                const dy = player.y - me.y;
                const distance = Math.sqrt(dx * dx + dy * dy);
                const angle = normalizeAngle(Math.atan2(dy, dx) - me.angle);

                return { player, distance, angle };
            })
            .filter(enemy => !enemy.player.dead)
            .filter(enemy => enemy.player.respawn <= 0)
            .filter(enemy => Math.abs(enemy.angle) < FOV / 2)
            .filter(enemy => castRay(this.map, me.x, me.y, me.angle + enemy.angle, enemy.distance).distance >= enemy.distance - PLAYER_RADIUS)
            .sort((a, b) => b.distance - a.distance);

        enemies.forEach(enemy => {
            const fixedDistance = enemy.distance * Math.cos(enemy.angle);
            const floorLine = screenH / 2 + (TILE_SIZE * screenH / fixedDistance) / 2;
            const playerH = TILE_SIZE * ENEMY_SPRITE_SCALE * screenH / fixedDistance;
            const playerW = playerH * 0.52;
            const playerX = screenW / 2 + (enemy.angle / (FOV / 2)) * screenW / 2;
            const playerY = floorLine - playerH;
            const frame = enemy.player.moving
                ? Math.floor(this.animTime * 6) % this.sprites.enemyFrameCount()
                : 0;

            const drawn = this.sprites.drawEnemy(
                ctx,
                frame,
                playerX - playerW / 2,
                playerY,
                playerW,
                playerH
            );

            if (!drawn) {
                ctx.fillStyle = "#1d2434";
                ctx.fillRect(playerX - playerW / 2, playerY + playerH * 0.28, playerW, playerH * 0.58);
                ctx.fillStyle = "#b28558";
                ctx.fillRect(playerX - playerW * 0.28, playerY, playerW * 0.56, playerH * 0.28);
                ctx.fillStyle = "#0d0d0d";
                ctx.fillRect(playerX - playerW * 0.24, playerY + playerH * 0.09, playerW * 0.48, playerH * 0.06);
            }

            ctx.fillStyle = "#111111";
            ctx.fillRect(playerX - playerW / 2, playerY - 10, playerW, 5);
            ctx.fillStyle = "#b63838";
            ctx.fillRect(playerX - playerW / 2, playerY - 10, playerW * enemy.player.life / MAX_LIFE, 5);

            ctx.font = "bold 13px Arial";
            const nameW = Math.min(Math.max(ctx.measureText(enemy.player.name).width + 14, 42), 120);
            ctx.textAlign = "center";
            ctx.textBaseline = "bottom";
            ctx.fillStyle = "rgba(0, 0, 0, 0.62)";
            ctx.fillRect(playerX - nameW / 2, playerY - 32, nameW, 17);
            ctx.fillStyle = "#eeeeee";
            ctx.fillText(enemy.player.name, playerX, playerY - 14);
        });
    }

    private drawShotTrail(ctx: CanvasRenderingContext2D, me: DoomPlayer) {
        if (!this.shotToDraw || this.shotTimer <= 0) return;

        const { screenW, screenH } = this.userInput;
        const shot = this.shotToDraw;
        const from = shot.shooterId === this.myId ? { x: screenW / 2, y: screenH * 0.62 } : this.projectPoint(me, shot.x, shot.y);
        const to = this.projectPoint(me, shot.hitX, shot.hitY);
        if (!from || !to) return;

        const progress = this.shotDuration > 0 ? 1 - this.shotTimer / this.shotDuration : 1;
        const x = from.x + (to.x - from.x) * progress;
        let y = from.y + (to.y - from.y) * progress;
        const projectile = shot.weapon === "rocket" ? "rocket" : shot.weapon === "plasma" ? "plasma" : shot.weapon === "bfg" ? "bfg" : "";
        const size = shot.weapon === "bfg" ? 58 : shot.weapon === "rocket" ? 36 : shot.weapon === "plasma" ? 30 : 24;

        if (projectile) {
            if (shot.weapon === "rocket") y -= Math.sin(progress * Math.PI) * 55;
            this.sprites.drawEffect(ctx, projectile, 0, x - size / 2, y - size / 2, size, size);
            if (shot.weapon === "rocket" && progress > 0.72) {
                const frame = Math.floor((progress - 0.72) * 10);
                this.sprites.drawEffect(ctx, "rocketBoom", frame, to.x - 42, to.y - 42, 84, 84);
            }
        }
        else if (progress > 0.35) {
            this.sprites.drawEffect(ctx, "puff", Math.floor(progress * 4), to.x - 18, to.y - 18, 36, 36);
        }
    }

    private projectPoint(me: DoomPlayer, x: number, y: number): { x: number, y: number } | null {
        const { screenW, screenH } = this.userInput;
        const dx = x - me.x;
        const dy = y - me.y;
        const distance = Math.sqrt(dx * dx + dy * dy);
        const angle = normalizeAngle(Math.atan2(dy, dx) - me.angle);
        if (distance < 1 || Math.abs(angle) > FOV / 2) return null;

        return {
            x: screenW / 2 + (angle / (FOV / 2)) * screenW / 2,
            y: screenH / 2
        };
    }

    private drawWeapon(ctx: CanvasRenderingContext2D, me: DoomPlayer, dt: number) {
        const { screenW, screenH } = this.userInput;
        const shotIsMine = !!this.shotToDraw && this.shotTimer > 0 && this.shotToDraw.shooterId === this.myId;

        if (this.shotTimer > 0) this.shotTimer -= dt;
        else this.shotToDraw = null;

        if (shotIsMine) {
            const shotWeapon = this.shotToDraw ? WEAPONS[this.shotToDraw.weapon] : WEAPONS[me.weapon];
            const progress = this.shotDuration > 0 ? 1 - this.shotTimer / this.shotDuration : 1;
            this.drawShotFeedback(ctx, this.shotToDraw!, shotWeapon, screenW, screenH, progress);
        }

        const weapon = WEAPONS[me.weapon];
        const gunW = Math.min(screenW * weapon.gunScale, 430);
        const gunH = Math.min(screenH * 0.34, gunW * 0.72);
        const gunX = screenW / 2 - gunW / 2;
        const frameCount = this.sprites.weaponFrameCount(me.weapon);
        const shotProgress = shotIsMine && this.shotDuration > 0 ? 1 - this.shotTimer / this.shotDuration : 0;
        const recoil = shotIsMine ? (1 - shotProgress) * weapon.recoil : 0;
        const gunY = screenH - gunH * 0.92 + recoil;
        const frame = shotIsMine ? clamp(1 + Math.floor(shotProgress * (frameCount - 1)), 0, frameCount - 1) : 0;

        const drawn = this.sprites.drawWeapon(ctx, me.weapon, frame, gunX, gunY, gunW, gunH);
        if (!drawn) {
            ctx.fillStyle = "#111111";
            ctx.fillRect(gunX + gunW * 0.22, gunY + gunH * 0.26, gunW * 0.56, gunH * 0.25);
            ctx.fillStyle = weapon.color;
            ctx.fillRect(gunX + gunW * 0.30, gunY + gunH * 0.10, gunW * 0.40, gunH * 0.20);
            ctx.fillStyle = "#5b4632";
            ctx.fillRect(gunX + gunW * 0.35, gunY + gunH * 0.48, gunW * 0.30, gunH * 0.38);
        }

        ctx.strokeStyle = weapon.shotStyle === "beam" ? "#71c9ff" : weapon.shotStyle === "bfg" ? "#71e889" : "#eeeeee";
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.moveTo(screenW / 2 - 10, screenH / 2);
        ctx.lineTo(screenW / 2 + 10, screenH / 2);
        ctx.moveTo(screenW / 2, screenH / 2 - 10);
        ctx.lineTo(screenW / 2, screenH / 2 + 10);
        ctx.stroke();

        if (weapon.shotStyle === "blast" || weapon.shotStyle === "beam" || weapon.shotStyle === "bfg") {
            ctx.beginPath();
            ctx.arc(screenW / 2, screenH / 2, weapon.shotStyle === "bfg" ? 18 : 14, 0, Math.PI * 2);
            ctx.stroke();
        }
    }

    private drawShotFeedback(ctx: CanvasRenderingContext2D, shot: DoomShot, weapon: WeaponInfo, screenW: number, screenH: number, progress: number) {
        const centerX = screenW / 2;
        const centerY = screenH / 2;
        const muzzleY = screenH * 0.62;
        const strength = clamp(1 - progress, 0, 1);
        const offsets = weapon.shotStyle === "spread" ? [-32, -16, 0, 16, 32] : [0];
        const flash = (42 + weapon.flashSize * 34) * (0.55 + strength * 0.45);

        ctx.save();
        if (weapon.shotStyle === "bfg") {
            ctx.fillStyle = `rgba(92, 255, 128, ${0.04 + strength * 0.05})`;
            ctx.fillRect(0, 0, screenW, screenH);
        }

        ctx.globalAlpha = 0.38 + strength * 0.42;
        ctx.strokeStyle = weapon.traceColor;
        ctx.lineWidth = weapon.shotStyle === "bfg" ? 9 : weapon.shotStyle === "beam" ? 7 : 2;
        offsets.forEach(offset => {
            ctx.beginPath();
            ctx.moveTo(centerX, muzzleY);
            ctx.lineTo(centerX + offset, centerY - 24);
            ctx.stroke();
        });

        if (weapon.splashRadius > 0) {
            ctx.strokeStyle = weapon.flashColor;
            ctx.beginPath();
            ctx.arc(centerX, centerY - 28, 18 + progress * 36, 0, Math.PI * 2);
            ctx.stroke();
        }

        ctx.globalAlpha = 0.48 + strength * 0.42;
        ctx.fillStyle = weapon.flashColor;
        ctx.beginPath();
        ctx.ellipse(centerX, muzzleY - 12, flash * 0.55, flash * 0.34, 0, 0, Math.PI * 2);
        ctx.fill();

        if (shot.hitId) {
            ctx.globalAlpha = 0.9;
            ctx.strokeStyle = "#ff4d3f";
            ctx.lineWidth = 3;
            ctx.beginPath();
            ctx.moveTo(centerX - 12, centerY - 12);
            ctx.lineTo(centerX + 12, centerY + 12);
            ctx.moveTo(centerX + 12, centerY - 12);
            ctx.lineTo(centerX - 12, centerY + 12);
            ctx.stroke();
        }

        ctx.restore();
    }

    private drawHud(ctx: CanvasRenderingContext2D, me: DoomPlayer) {
        if (!this.players) return;

        const { screenW, screenH } = this.userInput;
        const hudH = 90;
        const hudY = screenH - hudH;

        ctx.fillStyle = "rgba(8, 10, 12, 0.95)";
        ctx.fillRect(0, hudY, screenW, hudH);
        ctx.fillStyle = "#c8a64b";
        ctx.fillRect(0, hudY, screenW, 2);

        const hpColor = me.life > 35 ? "#d64d42" : "#d8b041";
        ctx.fillStyle = "rgba(255, 255, 255, 0.06)";
        ctx.fillRect(18, hudY + 14, 168, 60);

        ctx.fillStyle = "#9a9a9a";
        ctx.font = "bold 11px Arial";
        ctx.textAlign = "left";
        ctx.textBaseline = "middle";
        ctx.fillText("HP", 30, hudY + 28);

        ctx.fillStyle = hpColor;
        ctx.font = "bold 34px Arial";
        ctx.textAlign = "left";
        ctx.textBaseline = "middle";
        ctx.fillText(`${me.life}`, 30, hudY + 53);

        ctx.fillStyle = "#20242a";
        ctx.fillRect(88, hudY + 48, 84, 10);
        ctx.fillStyle = hpColor;
        ctx.fillRect(88, hudY + 48, 84 * me.life / MAX_LIFE, 10);

        this.drawWeaponSlots(ctx, me, hudY + 16);

        const rightX = screenW - 230;
        ctx.fillStyle = "rgba(255, 255, 255, 0.06)";
        ctx.fillRect(rightX, hudY + 14, 122, 60);
        ctx.fillRect(screenW - 100, hudY + 14, 82, 60);

        ctx.fillStyle = "#9a9a9a";
        ctx.font = "bold 11px Arial";
        ctx.textAlign = "right";
        ctx.fillText("KILL", rightX + 105, hudY + 29);
        ctx.fillStyle = "#eeeeee";
        ctx.font = "bold 28px Arial";
        ctx.fillText(`${me.score}`, rightX + 105, hudY + 58);

        ctx.fillStyle = "#9a9a9a";
        ctx.font = "bold 11px Arial";
        ctx.fillText(this.mode === "timed" ? "TIME" : "MODE", screenW - 32, hudY + 29);
        ctx.fillStyle = "#eeeeee";
        ctx.font = "bold 24px Arial";
        ctx.fillText(this.mode === "timed" ? formatTime(this.timeLeft) : "BR", screenW - 32, hudY + 58);

        if (me.respawn > 0 || me.dead) {
            ctx.fillStyle = "rgba(0, 0, 0, 0.55)";
            ctx.fillRect(0, 0, screenW, hudY);
            ctx.fillStyle = me.dead ? "#d8b041" : "#eeeeee";
            ctx.font = "bold 44px Arial";
            ctx.textAlign = "center";
            ctx.fillText(me.dead ? "ELIMINATO" : "RESPAWN", screenW / 2, screenH / 2);
        }

        this.drawSensitivitySettings(ctx, screenW - 174, hudY - 48);
        this.exitButton.draw(ctx, screenW - 97, 18, 78, 30);
    }

    private drawSensitivitySettings(ctx: CanvasRenderingContext2D, x: number, y: number) {
        const sensitivityPercent = Math.round(this.mouseSensitivity / DEFAULT_MOUSE_LOOK_SENSITIVITY * 100);

        ctx.fillStyle = "rgba(8, 10, 12, 0.74)";
        ctx.fillRect(x, y, 156, 36);
        ctx.strokeStyle = "rgba(255, 255, 255, 0.16)";
        ctx.strokeRect(x, y, 156, 36);

        ctx.fillStyle = "#9a9a9a";
        ctx.font = "bold 10px Arial";
        ctx.textAlign = "center";
        ctx.textBaseline = "middle";
        ctx.fillText("SENS NUM +/-", x + 78, y + 11);
        ctx.fillStyle = "#eeeeee";
        ctx.font = "bold 15px Arial";
        ctx.fillText(`${sensitivityPercent}%`, x + 78, y + 25);
    }

    private drawWeaponSlots(ctx: CanvasRenderingContext2D, me: DoomPlayer, y: number) {
        const { screenW } = this.userInput;
        const gap = 5;
        const reservedLeft = 200;
        const reservedRight = 250;
        const availableW = Math.max(290, screenW - reservedLeft - reservedRight);
        const slotW = clamp((availableW - gap * (WEAPON_ORDER.length - 1)) / WEAPON_ORDER.length, 58, 84);
        const slotH = 58;
        const totalW = slotW * WEAPON_ORDER.length + gap * (WEAPON_ORDER.length - 1);
        const x = Math.max(reservedLeft, screenW / 2 - totalW / 2);

        WEAPON_ORDER.forEach((weaponName, index) => {
            const slotX = x + index * (slotW + gap);
            const owned = me.weapons.indexOf(weaponName) >= 0;
            const selected = owned && this.selectedWeapon === weaponName;
            const weapon = WEAPONS[weaponName];

            ctx.fillStyle = owned ? "rgba(255, 255, 255, 0.055)" : "rgba(0, 0, 0, 0.24)";
            ctx.fillRect(slotX, y, slotW, slotH);

            if (selected) {
                ctx.fillStyle = "rgba(200, 166, 75, 0.22)";
                ctx.fillRect(slotX, y, slotW, slotH);
                ctx.fillStyle = "#c8a64b";
                ctx.fillRect(slotX, y, slotW, 3);
            }

            ctx.strokeStyle = selected ? "#c8a64b" : "rgba(255, 255, 255, 0.12)";
            ctx.lineWidth = selected ? 2 : 1;
            ctx.strokeRect(slotX, y, slotW, slotH);

            ctx.fillStyle = owned ? weapon.color : "#555555";
            ctx.font = "bold 12px Arial";
            ctx.textAlign = "left";
            ctx.textBaseline = "middle";
            ctx.fillText(`${index + 1}`, slotX + 8, y + 15);

            ctx.fillStyle = owned ? "#eeeeee" : "#777777";
            ctx.font = "bold 12px Arial";
            ctx.fillText(weapon.name, slotX + 8, y + 36, slotW - 14);

            if (owned && weaponName !== "pistol") {
                ctx.fillStyle = "#9a9a9a";
                ctx.font = "bold 10px Arial";
                ctx.textAlign = "right";
                ctx.fillText(`${me.ammo?.[weaponName] || 0}`, slotX + slotW - 8, y + 15);
                ctx.textAlign = "left";
            }

            if (selected && me.reload > 0) {
                const reload = clamp(me.reload / weapon.cooldown, 0, 1);
                ctx.fillStyle = "rgba(255, 255, 255, 0.15)";
                ctx.fillRect(slotX + 8, y + slotH - 10, slotW - 16, 4);
                ctx.fillStyle = "#c8a64b";
                ctx.fillRect(slotX + 8, y + slotH - 10, (slotW - 16) * (1 - reload), 4);
            }
        });
    }

    private getMiniMapLayout() {
        const mapW = this.map.tiles[0].length;
        const mapH = this.map.tiles.length;
        const scale = clamp(Math.floor(Math.min(MINI_MAP_MAX_W / mapW, MINI_MAP_MAX_H / mapH)), 4, 8);
        const w = mapW * scale;
        const h = mapH * scale;

        return {
            x: this.userInput.screenW - w - 18,
            y: 78,
            scale,
            w,
            h
        };
    }

    private drawScoreboard(ctx: CanvasRenderingContext2D, me: DoomPlayer) {
        if (!this.players) return;

        const { screenW } = this.userInput;
        const players = Object.values(this.players).sort((a, b) => b.score - a.score);
        const miniMap = this.getMiniMapLayout();
        const y = Math.max(112, Math.min(miniMap.y + miniMap.h + 42, this.userInput.screenH - 190));
        const x = screenW - 210;
        const w = 192;

        ctx.fillStyle = "rgba(8, 10, 12, 0.74)";
        ctx.fillRect(x, y, w, 92);
        ctx.strokeStyle = "rgba(255, 255, 255, 0.16)";
        ctx.strokeRect(x, y, w, 92);

        ctx.fillStyle = "#a6a6a6";
        ctx.font = "bold 12px Arial";
        ctx.textAlign = "left";
        ctx.textBaseline = "middle";
        ctx.fillText("SCORE", x + 12, y + 18);

        ctx.font = "14px Arial";
        players.slice(0, 4).forEach((player, index) => {
            const status = player.dead ? " out" : player.respawn > 0 ? " respawn" : "";
            ctx.fillStyle = player.name === me.name ? "#c8a64b" : "#eeeeee";
            ctx.fillText(`${player.name}`, x + 12, y + 40 + index * 17, 112);
            ctx.textAlign = "right";
            ctx.fillText(`${player.score}${status}`, x + w - 12, y + 40 + index * 17, 56);
            ctx.textAlign = "left";
        });
    }

    private drawKillFeed(ctx: CanvasRenderingContext2D) {
        const recentEvents = this.events.slice(-6);
        if (recentEvents.length === 0) return;

        const x = 18;
        const y = 18;
        const w = 390;
        const h = 30 + recentEvents.length * 22;

        ctx.fillStyle = "rgba(0, 0, 0, 0.58)";
        ctx.fillRect(x, y, w, h);

        ctx.fillStyle = "#8f8f8f";
        ctx.font = "bold 12px Arial";
        ctx.textAlign = "left";
        ctx.textBaseline = "middle";
        ctx.fillText("EVENTI", x + 12, y + 18);

        ctx.font = "15px Arial";
        recentEvents.forEach((event, index) => {
            ctx.fillStyle = index === recentEvents.length - 1 ? "#eeeeee" : "#bdbdbd";
            ctx.fillText(event.text, x + 12, y + 42 + index * 22);
        });
    }

    private drawMiniMap(ctx: CanvasRenderingContext2D, me: DoomPlayer) {
        if (!this.players) return;

        const players = this.players;
        const map = this.map;
        const miniMap = this.getMiniMapLayout();
        const scale = miniMap.scale;
        const x0 = miniMap.x;
        const y0 = miniMap.y;

        ctx.fillStyle = "rgba(8, 10, 12, 0.74)";
        ctx.fillRect(x0 - 8, y0 - 26, miniMap.w + 16, miniMap.h + 52);
        ctx.strokeStyle = "rgba(255, 255, 255, 0.16)";
        ctx.strokeRect(x0 - 8, y0 - 26, miniMap.w + 16, miniMap.h + 52);

        ctx.fillStyle = "#a6a6a6";
        ctx.font = "bold 11px Arial";
        ctx.textAlign = "left";
        ctx.textBaseline = "middle";
        ctx.fillText("MAPPA", x0, y0 - 13);

        for (let y = 0; y < map.tiles.length; y++) {
            for (let x = 0; x < map.tiles[y].length; x++) {
                const tile = map.tiles[y][x];
                ctx.fillStyle = tile === "." ? "#15191c" : WALLS[tile]?.miniMap || WALLS["#"].miniMap;
                ctx.fillRect(x0 + x * scale, y0 + y * scale, scale, scale);
            }
        }

        this.weaponPickups.forEach(pickup => {
            if (pickup.respawn > 0) return;
            const x = x0 + pickup.x / TILE_SIZE * scale;
            const y = y0 + pickup.y / TILE_SIZE * scale;
            const size = Math.max(4, scale - 1);

            ctx.fillStyle = "#58d9ff";
            ctx.fillRect(
                x - size / 2,
                y - size / 2,
                size,
                size
            );
            ctx.strokeStyle = "rgba(255, 255, 255, 0.72)";
            ctx.strokeRect(x - size / 2, y - size / 2, size, size);
        });

        Object.keys(players).forEach(id => {
            const player = players[id];
            const inactive = player.respawn > 0 || player.dead;
            const isMe = id === this.myId;
            const x = x0 + player.x / TILE_SIZE * scale;
            const y = y0 + player.y / TILE_SIZE * scale;
            const radius = isMe ? 5 : 4;

            ctx.fillStyle = inactive ? "#666666" : isMe ? "#c8a64b" : "#e24b42";
            ctx.strokeStyle = isMe ? "#0a0a0a" : "rgba(255, 255, 255, 0.82)";
            ctx.lineWidth = isMe ? 2 : 1;

            if (isMe) {
                ctx.beginPath();
                ctx.moveTo(
                    x + Math.cos(player.angle) * (radius + 3),
                    y + Math.sin(player.angle) * (radius + 3)
                );
                ctx.lineTo(
                    x + Math.cos(player.angle + 2.45) * radius,
                    y + Math.sin(player.angle + 2.45) * radius
                );
                ctx.lineTo(
                    x + Math.cos(player.angle - 2.45) * radius,
                    y + Math.sin(player.angle - 2.45) * radius
                );
                ctx.closePath();
                ctx.fill();
                ctx.stroke();
            }
            else {
                ctx.beginPath();
                ctx.arc(x, y, radius, 0, Math.PI * 2);
                ctx.fill();
                ctx.stroke();
            }
        });

        const legendY = y0 + miniMap.h + 14;
        ctx.font = "bold 10px Arial";
        ctx.textAlign = "left";
        ctx.textBaseline = "middle";
        this.drawMiniMapLegend(ctx, x0, legendY, "#c8a64b", "TU");
        this.drawMiniMapLegend(ctx, x0 + 42, legendY, "#e24b42", "NEM");
        this.drawMiniMapLegend(ctx, x0 + 93, legendY, "#58d9ff", "ARMI");
    }

    private drawMiniMapLegend(ctx: CanvasRenderingContext2D, x: number, y: number, color: string, label: string) {
        ctx.fillStyle = color;
        ctx.fillRect(x, y - 4, 8, 8);
        ctx.fillStyle = "#eeeeee";
        ctx.fillText(label, x + 12, y);
    }

    private drawGameOver(ctx: CanvasRenderingContext2D) {
        const { screenW, screenH } = this.userInput;
        const winner = this.winnerId && this.players ? this.players[this.winnerId] : null;

        ctx.fillStyle = "rgba(0, 0, 0, 0.72)";
        ctx.fillRect(0, 0, screenW, screenH);

        ctx.fillStyle = "#d8b041";
        ctx.font = "bold 48px Arial";
        ctx.textAlign = "center";
        ctx.textBaseline = "middle";
        ctx.fillText("GAME OVER", screenW / 2, screenH / 2 - 55);

        ctx.fillStyle = "#eeeeee";
        ctx.font = "bold 30px Arial";
        ctx.fillText(winner ? `${winner.name} vince` : "Pareggio", screenW / 2, screenH / 2);

        ctx.font = "18px Arial";
        ctx.fillText("Premi exit per tornare alla lobby", screenW / 2, screenH / 2 + 42);
    }
}
