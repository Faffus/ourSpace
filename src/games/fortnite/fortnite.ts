import { PERSON_W, PERSON_H, Player, smoothChange } from '../../common';
import { Button } from '../../client/ui-elements';
import { GAMES } from '../../games/index'
import { getCollisionSide } from '../../common';
import { IncomingMsg, OutgoingMsg } from '../../server';
import { GameClient, GameServer } from '../game';
import { drawPersonName } from '../../lobby/index';

const PERSON_SPEED = 300;

type WeaponType = 'pistol' | 'pump' | 'sniper' | 'assault' | 'grenade' | 'pickaxe' | 'shield' | 'medkit';

const WEAPONS = ['pistol', 'pump', 'sniper', 'assault', 'grenade', 'pickaxe', 'shield', 'medkit'] as const;

const WEAPON_IMAGE_FILES: Record<WeaponType, string> = {
    pistol: 'pistola.png',
    pump: 'pompa.png',
    sniper: 'cecchino.png',
    assault: 'assalto.png',
    grenade: 'granata.png',
    pickaxe: 'piccone.png',
    shield: 'scudo.png',
    medkit: 'medikit.png'
};

const WEAPON_DEFINITIONS: Record<WeaponType, {
    displayName: string;
    color: string;
    cooldown: number;
    damage: number;
    range: number;
    speed: number;
    spread: number;
    pellets: number;
    size: number;
}> = {
    pistol: { displayName: 'Pistol', color: '#f1c40f', cooldown: 0.26, damage: 20, range: 900, speed: 1200, spread: 0.02, pellets: 1, size: 4 },
    pump: { displayName: 'Shotgun', color: '#e74c3c', cooldown: 0.85, damage: 18, range: 520, speed: 800, spread: 0.22, pellets: 6, size: 5 },
    sniper: { displayName: 'Sniper', color: '#3498db', cooldown: 1.6, damage: 110, range: 1700, speed: 2200, spread: 0.005, pellets: 1, size: 3 },
    assault: { displayName: 'Assault', color: '#2ecc71', cooldown: 0.14, damage: 22, range: 1100, speed: 1400, spread: 0.06, pellets: 1, size: 4 },
    grenade: { displayName: 'Grenade', color: '#9b59b6', cooldown: 1.25, damage: 70, range: 650, speed: 560, spread: 0, pellets: 1, size: 12 },
    pickaxe: { displayName: 'Pickaxe', color: '#d35400', cooldown: 0.55, damage: 40, range: 120, speed: 950, spread: 0.15, pellets: 1, size: 5 },
    shield: { displayName: 'Shield', color: '#2980b9', cooldown: 0.3, damage: 0, range: 0, speed: 0, spread: 0, pellets: 0, size: 0 },
    medkit: { displayName: 'Medkit', color: '#c0392b', cooldown: 0.3, damage: 0, range: 0, speed: 0, spread: 0, pellets: 0, size: 0 },
};

type Bullet = {
    id: string;
    x: number;
    y: number;
    vx: number;
    vy: number;
    speed: number;
    remainingRange: number;
    weapon: WeaponType;
    ownerId: string;
    damage: number;
    radius: number;
    color: string;
    explosive?: boolean;
};

type HitEffect = {
    x: number;
    y: number;
    type: 'muzzle' | 'hit' | 'explosion';
    t: number;
};

type Crate = {
    x: number;
    y: number;
    opened: boolean;
};

type GroundItem = {
    id: string;
    x: number;
    y: number;
    weapon: WeaponType;
};

type Person = Player & {
    x: number;
    y: number;
    weapon: WeaponType;
    health: number;
    shield: number;
    inventory: WeaponType[];
    alive: boolean;
};

// +messaggi
type GameMsg = {
    kind: "game";
    gameId: string;
    data: any;
};

type ServerInitMsg = {
    kind: "init";
    yourId: string;
    people: Record<string, Person>;
    gameProposal?: {
        gameKey: string;
        proposerId: string;
        proposalId: string;
        acceptedPlayerIds: string[];
    }
};

type ServerNameIsTakenMsg = {
    kind: "nameIsTaken";
};

type ServerUpdateMsg = {
    kind: "update";
    people: Record<string, Person>;
    lines: {x: number, y: number, direction: 'vertical' | 'horizontal'}[];
    crates: Crate[];
    groundItems: GroundItem[];
    bullets?: Bullet[];
    effects?: HitEffect[];
};

type ServerExitMsg = {
    kind: "exit";
    id: string;
};

type ServerGameProposalMsg = {
    kind: "gameProposal";
    gameKey: string;
    proposerId: string;
    proposalId: string;
};

type ServerGameProposalAcceptedMsg = {
    kind: "gameProposalAccepted";
    proposalId: string;
    accepterId: string;
};

type GameStartedMsg = {
    kind: "gameStarted";
    gameId: string;
    gameKey: string;
    players: Record<string, Player>;
};

type LobbyServerMsg =
    | ServerInitMsg
    | ServerNameIsTakenMsg
    | ServerUpdateMsg 
    | ServerExitMsg
    | ServerGameProposalMsg
    | ServerGameProposalAcceptedMsg
    | GameStartedMsg
    | GameMsg;

type ClientInitMsg = {
    kind: "init";
    name: string;
    character: string;
};

type ClientMoveMsg = {
    kind: "move";
    x: number;
    y: number;
};

type ClientGameProposalMsg = {
    kind: "gameProposal";
    gameKey: string;
};

type ClientGameProposalAcceptMsg = {
    kind: "gameProposalAccept";
    proposalId: string;
};

type ClientStartGameMsg = {
    kind: "startGame";
    proposalId: string;
};

type ClientAddLineMsg = {
    kind: "addLine";
    x: number;
    y: number;
    direction: 'vertical' | 'horizontal';
};

type ClientOpenCrateMsg = {
    kind: "openCrate";
    x: number;
    y: number;
};

type ClientDropItemMsg = {
    kind: "dropItem";
    slotIndex: number;
    x: number;
    y: number;
};

type ClientReorderInventoryMsg = {
    kind: "reorderInventory";
    fromIndex: number;
    toIndex: number;
};

type ClientPickUpItemMsg = {
    kind: "pickUpItem";
    id: string;
};

type ClientShootMsg = {
    kind: "shoot";
    targetX: number;
    targetY: number;
};

type LobbyClientMsg = 
    | ClientInitMsg 
    | ClientMoveMsg
    | ClientGameProposalMsg
    | ClientGameProposalAcceptMsg
    | ClientStartGameMsg
    | ClientAddLineMsg
    | ClientOpenCrateMsg
    | ClientDropItemMsg
    | ClientReorderInventoryMsg
    | ClientPickUpItemMsg
    | ClientShootMsg
    | GameMsg;

// -messaggi

const EPSILON = 0.0001;

const worldW = 4000, worldH = 4000;
const worldBounds = {
    top: -worldH/2,
    left: -worldW/2,
    bottom: worldH/2,
    right: worldW/2,
};




//////////////////////
////// SERVER ////////
//////////////////////

export class FortniteServer extends GameServer {

    private players: Record<string, Person>;
    private bullets: Bullet[] = [];
    private lastShotTimestamps: Record<string, number> = {};
    private initialUpdatePending: boolean = false;
    private permanentLines: {x: number, y: number, direction: 'vertical' | 'horizontal'}[] = [];
    private crates: Crate[] = [];
    private groundItems: GroundItem[] = [];
    private hitEffects: HitEffect[] = [];

    private getSpawnPositions(count: number): { x: number; y: number }[] {
        const margin = 200;
        const spacing = 150;

        const topLeft = (n: number) =>
            Array.from({ length: n }, (_, i) => ({
                x: worldBounds.left + margin,
                y: worldBounds.top + margin + i * spacing
            }));
        const topRight = (n: number) =>
            Array.from({ length: n }, (_, i) => ({
                x: worldBounds.right - margin,
                y: worldBounds.top + margin + i * spacing
            }));
        const bottomLeft = (n: number) =>
            Array.from({ length: n }, (_, i) => ({
                x: worldBounds.left + margin,
                y: worldBounds.bottom - margin - i * spacing
            }));
        const bottomRight = (n: number) =>
            Array.from({ length: n }, (_, i) => ({
                x: worldBounds.right - margin,
                y: worldBounds.bottom - margin - i * spacing
            }));

        switch (count) {
            case 1:
                return [{ x: 0, y: 0 }];
            case 2:
                return [...topLeft(1), ...bottomRight(1)];
            case 4:
                return [...topLeft(2), ...bottomRight(2)];
            case 6:
                return [...topLeft(3), ...topRight(3)];
            case 8:
                return [...topLeft(2), ...topRight(2), ...bottomLeft(2), ...bottomRight(2)];
            default:
                // fallback per numeri non previsti: allinea sul centro o distribuisce nei quattro angoli
                if (count % 2 !== 0) {
                    return [{ x: 0, y: 0 }];
                }
                const positions: { x: number; y: number }[] = [];
                const half = count / 2;
                positions.push(...topLeft(Math.ceil(half / 2)));
                positions.push(...topRight(Math.floor(half / 2)));
                positions.push(...bottomLeft(Math.ceil(half / 2)));
                positions.push(...bottomRight(Math.floor(half / 2)));
                return positions.slice(0, count);
        }
    }

    init(players: Record<string, Player>) {
        this.players = {};
        this.bullets = [];
        this.lastShotTimestamps = {};
        // Pistolina, pompa, cecchino, assalto, granata, piccone, scudo, medikit.
        this.initialUpdatePending = true;
        this.permanentLines = [];
        this.groundItems = [];
        this.hitEffects = [];

        // Inizializza casse: 3 per ogni angolo e centro
        this.crates = [
            {x: worldBounds.left + 150, y: worldBounds.top + 150, opened: false},
            {x: worldBounds.left + 250, y: worldBounds.top + 150, opened: false},
            {x: worldBounds.left + 150, y: worldBounds.top + 250, opened: false},
            {x: worldBounds.right - 150, y: worldBounds.top + 150, opened: false},
            {x: worldBounds.right - 250, y: worldBounds.top + 150, opened: false},
            {x: worldBounds.right - 150, y: worldBounds.top + 250, opened: false},
            {x: worldBounds.left + 150, y: worldBounds.bottom - 150, opened: false},
            {x: worldBounds.left + 250, y: worldBounds.bottom - 150, opened: false},
            {x: worldBounds.left + 150, y: worldBounds.bottom - 250, opened: false},
            {x: worldBounds.right - 150, y: worldBounds.bottom - 150, opened: false},
            {x: worldBounds.right - 250, y: worldBounds.bottom - 150, opened: false},
            {x: worldBounds.right - 150, y: worldBounds.bottom - 250, opened: false},
            {x: 0, y: 0, opened: false}
        ];

        const spawnPositions = this.getSpawnPositions(Object.keys(players).length);
        Object.entries(players).forEach(([id, player], index) => {
            const spawn = spawnPositions[index] || { x: 0, y: 0 };
            this.players[id] = {
                ...player,
                x: spawn.x,
                y: spawn.y,
                weapon: 'pickaxe' as WeaponType,
                health: 100,
                shield: 0,
                inventory: [],
                alive: true
            };
        });
    }

    private spawnGroundItems(weaponList: WeaponType[], x: number, y: number) {
        const radius = 120;
        weaponList.forEach((weapon, index) => {
            const angle = (Math.PI * 2 / weaponList.length) * index;
            const distance = 40 + Math.random() * 40;
            this.groundItems.push({
                id: `${weapon}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
                x: x + Math.cos(angle) * distance,
                y: y + Math.sin(angle) * distance,
                weapon
            });
        });
    }

    tick(incomingMessages: IncomingMsg[], dt: number): OutgoingMsg[] {
        const outgoingMessages: OutgoingMsg[] = [];
        const updatedPeople: Record<string, Person> = {};

        if (this.initialUpdatePending) {
            outgoingMessages.push({
                payload: {
                    kind: "update",
                    people: this.players,
                    lines: this.permanentLines,
                    crates: this.crates,
                    groundItems: this.groundItems,
                    bullets: this.bullets,
                    effects: this.hitEffects
                }
            });
            this.initialUpdatePending = false;
        }

        // Gestisci i messaggi in arrivo
        incomingMessages.forEach(message => {
            const clientId = message.clientId;
            const payload = message.payload;
            const player = this.players[clientId];

            if (payload.kind === "move") {
                if (player && player.alive) {
                    let newX = payload.x;
                    let newY = payload.y;
                    
                    // controlla collisioni con linee permanenti usando AABB
                    for (let line of this.permanentLines) {
                        const personLeft = newX - PERSON_W / 2;
                        const personRight = newX + PERSON_W / 2;
                        const personTop = newY - PERSON_H / 2;
                        const personBottom = newY + PERSON_H / 2;
                        
                        if (line.direction === 'vertical') {
                            const lineLeft = line.x - 5;
                            const lineRight = line.x + 5;
                            const lineTop = line.y;
                            const lineBottom = line.y + 200;
                            if (personLeft < lineRight && personRight > lineLeft &&
                                personTop < lineBottom && personBottom > lineTop) {
                                newX = player.x;
                            }
                        } else if (line.direction === 'horizontal') {
                            const lineLeft = line.x;
                            const lineRight = line.x + 200;
                            const lineTop = line.y - 5;
                            const lineBottom = line.y + 5;
                            if (personLeft < lineRight && personRight > lineLeft &&
                                personTop < lineBottom && personBottom > lineTop) {
                                newY = player.y;
                            }
                        }
                    }
                    
                    player.x = newX;
                    player.y = newY;
                    updatedPeople[clientId] = player;
                }
            }

            if (payload.kind === "addLine") {
                this.permanentLines.push({x: payload.x, y: payload.y, direction: payload.direction});
            }

            if (payload.kind === "openCrate") {
                if (player && player.alive) {
                    const crate = this.crates.find(c => c.x === payload.x && c.y === payload.y && !c.opened);
                    if (crate) {
                        const dist = Math.sqrt((player.x - crate.x) ** 2 + (player.y - crate.y) ** 2);
                        if (dist < 100) {
                            crate.opened = true;
                            const weapons = ['pistol', 'pump', 'sniper', 'assault', 'grenade'] as WeaponType[];
                            const randomWeapons = weapons.sort(() => 0.5 - Math.random()).slice(0, 2);
                            const generatedItems: WeaponType[] = [...randomWeapons, 'shield', 'medkit'];
                            const availableSlots = 5 - player.inventory.length;
                            const toInventory = generatedItems.slice(0, availableSlots);
                            const toGround = generatedItems.slice(availableSlots);
                            player.inventory.push(...toInventory);
                            if (toGround.length > 0) {
                                this.spawnGroundItems(toGround, crate.x, crate.y);
                            }
                            updatedPeople[clientId] = player;
                        }
                    }
                }
            }

            if (payload.kind === "dropItem") {
                if (player && player.alive) {
                    const item = player.inventory[payload.slotIndex];
                    if (item) {
                        player.inventory.splice(payload.slotIndex, 1);
                        this.groundItems.push({
                            id: `${item}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
                            x: payload.x,
                            y: payload.y,
                            weapon: item
                        });
                        updatedPeople[clientId] = player;
                    }
                }
            }

            if (payload.kind === "reorderInventory") {
                if (player && player.alive) {
                    const item = player.inventory.splice(payload.fromIndex, 1)[0];
                    if (item) {
                        player.inventory.splice(payload.toIndex, 0, item);
                        updatedPeople[clientId] = player;
                    }
                }
            }

            if (payload.kind === "pickUpItem") {
                if (player && player.alive) {
                    const item = this.groundItems.find(i => i.id === payload.id);
                    if (item) {
                        const dist = Math.sqrt((player.x - item.x) ** 2 + (player.y - item.y) ** 2);
                        if (dist < 100 && player.inventory.length < 5) {
                            player.inventory.push(item.weapon);
                            this.groundItems = this.groundItems.filter(i => i.id !== payload.id);
                            updatedPeople[clientId] = player;
                        }
                    }
                }
            }

            if (payload.kind === "shoot") {
                if (player && player.alive) {
                    const weaponDef = WEAPON_DEFINITIONS[player.weapon];
                    const now = Date.now();
                    const lastShot = this.lastShotTimestamps[clientId] || 0;
                    if (weaponDef && now - lastShot >= weaponDef.cooldown * 1000) {
                        this.lastShotTimestamps[clientId] = now;
                        const dx = payload.targetX - player.x;
                        const dy = payload.targetY - player.y;
                        const baseAngle = Math.atan2(dy, dx);

                        const addBullet = (angle: number, range: number, speed: number, damage: number, radius: number, explosive = false) => {
                            this.bullets.push({
                                id: `${player.weapon}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
                                x: player.x,
                                y: player.y,
                                vx: Math.cos(angle) * speed,
                                vy: Math.sin(angle) * speed,
                                speed,
                                remainingRange: range,
                                weapon: player.weapon,
                                ownerId: clientId,
                                damage,
                                radius,
                                color: weaponDef.color,
                                explosive
                            });
                        };

                        if (player.weapon === 'pump') {
                            for (let i = 0; i < weaponDef.pellets; i++) {
                                const spreadAngle = (Math.random() - 0.5) * weaponDef.spread;
                                addBullet(baseAngle + spreadAngle, weaponDef.range, weaponDef.speed, weaponDef.damage, weaponDef.size);
                            }
                        } else if (player.weapon === 'grenade') {
                            addBullet(baseAngle, weaponDef.range, weaponDef.speed, weaponDef.damage, weaponDef.size, true);
                        } else if (player.weapon === 'pickaxe') {
                            const hitRange = weaponDef.range;
                            Object.entries(this.players).forEach(([targetId, target]) => {
                                if (targetId === clientId || !target.alive) return;
                                const dist = Math.sqrt((target.x - player.x) ** 2 + (target.y - player.y) ** 2);
                                if (dist < hitRange) {
                                    const effectiveDamage = weaponDef.damage;
                                    const shieldHit = Math.min(target.shield, effectiveDamage);
                                    target.shield = Math.max(0, target.shield - effectiveDamage);
                                    const left = effectiveDamage - shieldHit;
                                    target.health = Math.max(0, target.health - left);
                                    if (target.health <= 0) {
                                        target.alive = false;
                                    }
                                    updatedPeople[targetId] = target;
                                    this.hitEffects.push({ x: target.x, y: target.y, type: 'hit', t: 0 });
                                }
                            });
                        } else {
                            addBullet(baseAngle, weaponDef.range, weaponDef.speed, weaponDef.damage, weaponDef.size);
                        }
                    }
                }
            }
        });

        // Aggiorna le munizioni attive e gli effetti visivi
        this.bullets.forEach(bullet => {
            bullet.x += bullet.vx * dt;
            bullet.y += bullet.vy * dt;
            bullet.remainingRange -= bullet.speed * dt;

            const owner = this.players[bullet.ownerId];
            if (bullet.explosive && bullet.remainingRange <= 0) {
                this.hitEffects.push({ x: bullet.x, y: bullet.y, type: 'explosion', t: 0 });
                Object.entries(this.players).forEach(([targetId, target]) => {
                    if (targetId === bullet.ownerId || !target.alive) return;
                    const dist = Math.sqrt((target.x - bullet.x) ** 2 + (target.y - bullet.y) ** 2);
                    if (dist < 140) {
                        const effectiveDamage = Math.round(bullet.damage * (1 - dist / 140));
                        const shieldHit = Math.min(target.shield, effectiveDamage);
                        target.shield = Math.max(0, target.shield - effectiveDamage);
                        const left = effectiveDamage - shieldHit;
                        target.health = Math.max(0, target.health - left);
                        if (target.health <= 0) target.alive = false;
                        updatedPeople[targetId] = target;
                    }
                });
                bullet.remainingRange = -1;
            }

            Object.entries(this.players).forEach(([targetId, target]) => {
                if (targetId === bullet.ownerId || !target.alive) return;
                if (bullet.remainingRange <= 0) return;
                const dx = Math.abs(target.x - bullet.x);
                const dy = Math.abs(target.y - bullet.y);
                if (dx < PERSON_W / 2 && dy < PERSON_H / 2) {
                    const effectiveDamage = bullet.damage;
                    const shieldHit = Math.min(target.shield, effectiveDamage);
                    target.shield = Math.max(0, target.shield - effectiveDamage);
                    const left = effectiveDamage - shieldHit;
                    target.health = Math.max(0, target.health - left);
                    if (target.health <= 0) target.alive = false;
                    updatedPeople[targetId] = target;
                    this.hitEffects.push({ x: bullet.x, y: bullet.y, type: 'hit', t: 0 });
                    bullet.remainingRange = -1;
                }
            });
        });

        this.bullets = this.bullets.filter(bullet => bullet.remainingRange > 0);
        this.hitEffects.forEach(effect => effect.t += dt);
        this.hitEffects = this.hitEffects.filter(effect => effect.t < 0.4);

        if (Object.keys(updatedPeople).length > 0 || this.bullets.length > 0 || this.hitEffects.length > 0) {
            outgoingMessages.push({
                payload: {
                    kind: "update",
                    people: updatedPeople,
                    lines: this.permanentLines,
                    crates: this.crates,
                    groundItems: this.groundItems,
                    bullets: this.bullets,
                    effects: this.hitEffects
                }
            });
        }

        return outgoingMessages;
    }

    isFinished(): boolean {
        return false;
    }   
}






//////////////////////
////// CLIENT ////////
//////////////////////


import { UserInput } from '../../client/user-input';

type ClientPerson = Person;

import { getCharacterDrawFunction } from '../../client/characters';

type ClientPersonExtended = ClientPerson & {
    xTarget: number;
    yTarget: number;
    weapon: WeaponType;
    health: number;
    shield: number;
    alive: boolean;
};

export class FortniteClient extends GameClient {

    public people: Record<string, ClientPersonExtended>;
    public camera: { x: number, y: number, zoom: number };
    public gamesBtn: Button;
    private buildingMode: boolean = false;
    private permanentLines: {x: number, y: number, direction: 'vertical' | 'horizontal'}[] = [];
    private pendingMessages: any[] = [];
    private weaponSprites: Partial<Record<WeaponType, HTMLCanvasElement>> = {};
    private crates: Crate[] = [];
    private groundItems: GroundItem[] = [];
    private bullets: Bullet[] = [];
    private hitEffects: HitEffect[] = [];
    private currentSlot: number = 0; // 0-4 inventory, 5 pickaxe
    private inventoryMenuOpen: boolean = false;
    private draggingSlotIndex: number | null = null;
    private dragStartX: number = 0;
    private dragStartY: number = 0;
    private lastMouseLeftPressed: boolean = false;
    private dragWeapon: WeaponType | null = null;
    private lastShotTime: number = 0;
    private buildingModeActive: boolean = false;
    private ePressed: boolean = false;
    private iPressed: boolean = false;

    constructor(userInput: UserInput, myId: string) {
        super(userInput, myId);
        this.people = {};
        this.camera = { x: 0, y: 0, zoom: 1 };
        this.gamesBtn = new Button('Games', userInput, () => {});

        document.addEventListener("keydown", (event) => {
            if (event.repeat) return;

            if (event.code == "KeyE") this.ePressed = true;
            else if (event.code == "KeyI") {
                event.preventDefault();
                this.iPressed = !this.iPressed;
            } else if (event.code == "KeyQ") this.buildingModeActive = !this.buildingModeActive;
        });
        document.addEventListener("keyup", (event) => {
            if (event.code == "KeyE") this.ePressed = false;
        });

        window.addEventListener('wheel', (event) => {
            event.preventDefault();

            // Cambia slot con la rotella
            if (event.deltaY > 0) {
                this.currentSlot = (this.currentSlot + 1) % 6;
            } else {
                this.currentSlot = (this.currentSlot - 1 + 6) % 6;
            }
        }, { passive: false });
    }

    async init(players: Record<string, Player>) {
        await this.loadWeaponAssets();

        Object.entries(players).forEach(([id, player]) => {
            const clientPerson: ClientPersonExtended = {
                ...player,
                x: 0,
                y: 0,
                xTarget: 0,
                yTarget: 0,
                weapon: 'pickaxe',
                health: 100,
                shield: 0,
                inventory: [],
                alive: true
            };
            this.people[id] = clientPerson;
        });
        return Promise.resolve();
    }

    private async loadWeaponAssets() {
        const assetFolder = 'assets/fortnite';
        await Promise.all(Object.entries(WEAPON_IMAGE_FILES).map(async ([weapon, file]) => {
            const key = weapon as WeaponType;
            try {
                await this.assets.loadImage(key, `${assetFolder}/${file}`);
                const img = this.assets.images[key];
                if (img) {
                    this.weaponSprites[key] = this.createTransparentSprite(img);
                }
            } catch {
                // immagine non trovata, usiamo il fallback grafico
            }
        }));
    }

    private createTransparentSprite(image: HTMLImageElement): HTMLCanvasElement {
        const canvas = document.createElement('canvas');
        canvas.width = image.width;
        canvas.height = image.height;
        const ctx = canvas.getContext('2d');
        if (!ctx) return canvas;
        ctx.drawImage(image, 0, 0);
        const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
        const data = imageData.data;
        for (let i = 0; i < data.length; i += 4) {
            if (data[i] > 240 && data[i + 1] > 240 && data[i + 2] > 240) {
                data[i + 3] = 0;
            }
        }
        ctx.putImageData(imageData, 0, 0);
        return canvas;
    }

    private getWeaponRenderSize(weapon: WeaponType): number {
        switch (weapon) {
            case 'grenade':
                return 40;
            case 'shield':
                return 40;
            case 'medkit':
                return 70;
            default:
                return 100;
        }
    }

    private drawWeapon(ctx: CanvasRenderingContext2D, x: number, y: number, angle: number, weapon: WeaponType, size?: number) {
        ctx.save();
        ctx.translate(x, y);
        ctx.rotate(angle);

        let scale = 1;
        const sprite = this.weaponSprites[weapon];
        if (sprite) {
            if (size) {
                scale = size / Math.max(sprite.width, sprite.height);
                ctx.scale(scale, scale);
            }
            ctx.drawImage(sprite, -sprite.width / 2, -sprite.height / 2);
            ctx.restore();
            return;
        }

        if (size) {
            const baseSize = weapon === 'grenade' ? 24 : weapon === 'shield' ? 40 : weapon === 'medkit' ? 30 : 70;
            scale = size / baseSize;
            ctx.scale(scale, scale);
        }
        
        switch(weapon) {
            case 'pistol':
                ctx.fillStyle = "#000";
                ctx.fillRect(-15, -7.5, 50, 12);
                ctx.fillRect(-15, -7.5, 70, 8);
                break;
            case 'pump':
                ctx.fillStyle = "#444";
                ctx.fillRect(-15, -10, 50, 15);
                ctx.fillRect(20, -8, 25, 11);
                break;
            case 'sniper':
                ctx.fillStyle = "#333";
                ctx.fillRect(-15, -5, 70, 10);
                ctx.fillRect(35, -8, 15, 16);
                break;
            case 'assault':
                ctx.fillStyle = "#222";
                ctx.fillRect(-15, -9, 55, 14);
                ctx.fillRect(25, -12, 18, 20);
                break;
            case 'grenade':
                ctx.fillStyle = "#0f0";
                ctx.beginPath();
                ctx.arc(20, 0, 12, 0, Math.PI * 2);
                ctx.fill();
                break;
            case 'pickaxe':
                ctx.fillStyle = "#8B4513";
                ctx.fillRect(-15, -8, 40, 16);
                ctx.fillStyle = "#FFD700";
                ctx.fillRect(15, -15, 7, 30);
                ctx.fillStyle = "#FFD700";
                ctx.fillRect(20, -25, 10, 10);
                ctx.fillStyle = "#FFD700";
                ctx.fillRect(10, -5, 10, 10);
                break;
            case 'shield':
                ctx.fillStyle = "#0088ff";
                ctx.beginPath();
                ctx.rect(-20, -20, 40, 40);
                ctx.fill();
                ctx.strokeStyle = "#fff";
                ctx.lineWidth = 2;
                ctx.stroke();
                break;
            case 'medkit':
                ctx.fillStyle = "#ff0000";
                ctx.fillRect(-15, -15, 30, 30);
                ctx.fillStyle = "#fff";
                ctx.fillRect(-5, -12, 10, 4);
                ctx.fillRect(-12, -5, 4, 10);
                break;

        }
        
        ctx.restore();
    }

    private drawBullet(ctx: CanvasRenderingContext2D, bullet: Bullet) {
        ctx.save();
        ctx.globalAlpha = 0.85;
        ctx.fillStyle = bullet.color;
        ctx.shadowColor = bullet.color;
        ctx.shadowBlur = 8;
        if (bullet.weapon === 'grenade') {
            ctx.beginPath();
            ctx.arc(bullet.x, bullet.y, bullet.radius, 0, Math.PI * 2);
            ctx.fill();
        } else {
            ctx.beginPath();
            ctx.arc(bullet.x, bullet.y, bullet.radius, 0, Math.PI * 2);
            ctx.fill();
        }
        ctx.restore();
    }

    private drawHitEffect(ctx: CanvasRenderingContext2D, effect: HitEffect) {
        const progress = effect.t / 0.4;
        ctx.save();
        if (effect.type === 'muzzle') {
            ctx.strokeStyle = `rgba(255,255,220,${1 - progress})`;
            ctx.lineWidth = 3;
            ctx.beginPath();
            ctx.arc(effect.x, effect.y, 15 + progress * 10, 0, Math.PI * 2);
            ctx.stroke();
        } else if (effect.type === 'hit') {
            ctx.strokeStyle = `rgba(255,80,80,${1 - progress})`;
            ctx.lineWidth = 3;
            ctx.beginPath();
            ctx.arc(effect.x, effect.y, 20 + progress * 15, 0, Math.PI * 2);
            ctx.stroke();
        } else {
            ctx.strokeStyle = `rgba(255,255,255,${1 - progress})`;
            ctx.lineWidth = 5;
            ctx.beginPath();
            ctx.arc(effect.x, effect.y, 30 + progress * 25, 0, Math.PI * 2);
            ctx.stroke();
        }
        ctx.restore();
    }

    private drawCrosshair(ctx: CanvasRenderingContext2D, x: number, y: number) {
        ctx.save();
        ctx.strokeStyle = 'rgba(255,255,255,0.85)';
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.arc(x, y, 12, 0, Math.PI * 2);
        ctx.stroke();
        ctx.beginPath();
        ctx.moveTo(x - 18, y);
        ctx.lineTo(x - 6, y);
        ctx.moveTo(x + 6, y);
        ctx.lineTo(x + 18, y);
        ctx.moveTo(x, y - 18);
        ctx.lineTo(x, y - 6);
        ctx.moveTo(x, y + 6);
        ctx.lineTo(x, y + 18);
        ctx.stroke();
        ctx.restore();
    }

    // disegna la lobby (spazio di gioco, personaggi, ecc)
    private drawLobby(ctx: CanvasRenderingContext2D, me: ClientPersonExtended, dt: number) {
            const {
                screenW, screenH, zoom,
                moveDirectionX, moveDirectionY, mouseX, mouseY
            } = this.userInput;
    
            this.buildingMode = this.buildingModeActive;
            this.inventoryMenuOpen = this.iPressed;
            const mouseLeft = this.userInput.isMouseLeftPressed;
            const justPressed = mouseLeft && !this.lastMouseLeftPressed;
            const justReleased = !mouseLeft && this.lastMouseLeftPressed;
            const slotMenuX = 20;
            const slotMenuY = 20;
            const slotMenuW = 220;
            const slotMenuH = 340;
            const menuSlotSize = 50;
            const menuSlotSpacing = 10;
            const slotAreaY = slotMenuY + 40;

            const getSlotIndexAtPosition = (mx: number, my: number) => {
                if (mx < slotMenuX + 10 || mx > slotMenuX + 10 + menuSlotSize || my < slotAreaY || my > slotAreaY + 5 * (menuSlotSize + menuSlotSpacing) - menuSlotSpacing) {
                    return -1;
                }
                const index = Math.floor((my - slotAreaY) / (menuSlotSize + menuSlotSpacing));
                return index >= 0 && index < 5 ? index : -1;
            };

            if (justPressed && this.inventoryMenuOpen) {
                const clickedSlot = getSlotIndexAtPosition(mouseX, mouseY);
                if (clickedSlot >= 0) {
                    const weapon = me.inventory[clickedSlot];
                    if (weapon) {
                        this.draggingSlotIndex = clickedSlot;
                        this.dragStartX = mouseX;
                        this.dragStartY = mouseY;
                        this.dragWeapon = weapon;
                    }
                }
            }

            if (this.draggingSlotIndex !== null && justReleased) {
                const mouseInMenu = mouseX >= slotMenuX && mouseX <= slotMenuX + slotMenuW && mouseY >= slotMenuY && mouseY <= slotMenuY + slotMenuH;
                const releaseSlot = getSlotIndexAtPosition(mouseX, mouseY);
                if (mouseInMenu && releaseSlot >= 0) {
                    if (releaseSlot !== this.draggingSlotIndex) {
                        this.sendMessage({kind: "reorderInventory", fromIndex: this.draggingSlotIndex, toIndex: releaseSlot});
                    }
                } else {
                    const mouseCenterX = mouseX - screenW / 2;
                    const mouseCenterY = mouseY - screenH / 2;
                    const dropX = me.x + mouseCenterX / this.camera.zoom;
                    const dropY = me.y + mouseCenterY / this.camera.zoom;
                    this.sendMessage({kind: "dropItem", slotIndex: this.draggingSlotIndex, x: dropX, y: dropY});
                    me.inventory.splice(this.draggingSlotIndex, 1);
                }
                this.draggingSlotIndex = null;
                this.dragWeapon = null;
            }

            this.lastMouseLeftPressed = mouseLeft;

            if (justReleased && !this.inventoryMenuOpen && !this.buildingMode && this.draggingSlotIndex === null) {
                const mouseCenterX = mouseX - screenW / 2;
                const mouseCenterY = mouseY - screenH / 2;
                const mouseWorldX = me.x + mouseCenterX / this.camera.zoom;
                const mouseWorldY = me.y + mouseCenterY / this.camera.zoom;
                const nearbyItem = this.groundItems.find(item => 
                    Math.sqrt((mouseWorldX - item.x) ** 2 + (mouseWorldY - item.y) ** 2) < 100
                );
                if (nearbyItem) {
                    this.sendMessage({kind: "pickUpItem", id: nearbyItem.id});
                }
            }
            // aggiorna l'arma selezionata
            me.weapon = this.currentSlot === 5 ? 'pickaxe' : (me.inventory[this.currentSlot] || 'pickaxe');
    
            // gestione movimento immediato come nel multi-pong
            let newX = me.x + moveDirectionX * dt * PERSON_SPEED;
            let newY = me.y + moveDirectionY * dt * PERSON_SPEED;
            
            // verifica collisioni con linee permanenti PRIMA di muoversi
            for (let line of this.permanentLines) {
                const personLeft = newX - PERSON_W / 2;
                const personRight = newX + PERSON_W / 2;
                const personTop = newY - PERSON_H / 2;
                const personBottom = newY + PERSON_H / 2;
                
                if (line.direction === 'vertical') {
                    // linea verticale: da (line.x - 5, line.y) a (line.x + 5, line.y + 200)
                    const lineLeft = line.x - 5;
                    const lineRight = line.x + 5;
                    const lineTop = line.y;
                    const lineBottom = line.y + 200;
                    
                    // se ci sarebbe collisione, blocca movimento X
                    if (personLeft < lineRight && personRight > lineLeft &&
                        personTop < lineBottom && personBottom > lineTop) {
                        newX = me.x;
                    }
                } else if (line.direction === 'horizontal') {
                    // linea orizzontale: da (line.x, line.y - 5) a (line.x + 200, line.y + 5)
                    const lineLeft = line.x;
                    const lineRight = line.x + 200;
                    const lineTop = line.y - 5;
                    const lineBottom = line.y + 5;
                    
                    // se ci sarebbe collisione, blocca movimento Y
                    if (personLeft < lineRight && personRight > lineLeft &&
                        personTop < lineBottom && personBottom > lineTop) {
                        newY = me.y;
                    }
                }
            }
            
            me.x = newX;
            me.y = newY;
    
            // controllo che il giocatore non esca dallo spazio di gioco
            if (me.y - PERSON_H/2 < worldBounds.top) me.y = worldBounds.top + PERSON_H/2 + EPSILON;
            if (me.y + PERSON_H/2 > worldBounds.bottom) me.y = worldBounds.bottom - PERSON_H/2 - EPSILON;
            if (me.x - PERSON_W/2 < worldBounds.left) me.x = worldBounds.left + PERSON_W/2 + EPSILON;
            if (me.x + PERSON_W/2 > worldBounds.right) me.x = worldBounds.right - PERSON_W/2 - EPSILON;

            // Gestisci apertura casse con 'e'
            if (this.ePressed) {
                const nearbyCrate = this.crates.find(crate => 
                    !crate.opened && 
                    Math.sqrt((me.x - crate.x) ** 2 + (me.y - crate.y) ** 2) < 100
                );
                if (nearbyCrate) {
                    this.sendMessage({kind: "openCrate", x: nearbyCrate.x, y: nearbyCrate.y});
                }
            }

            // la camera segue il giocatore
            this.camera.x = me.x;
            this.camera.y = me.y;
            this.camera.zoom = zoom;
    
            // converti coordinate mouse da screen space a world space
            const mouseCenterX = mouseX - screenW / 2;
            const mouseCenterY = mouseY - screenH / 2;
            const mouseWorldX = me.x + mouseCenterX / this.camera.zoom;
            const mouseWorldY = me.y + mouseCenterY / this.camera.zoom;
            const weaponDef = WEAPON_DEFINITIONS[me.weapon];

            if (!this.buildingMode && !this.inventoryMenuOpen && me.alive && this.userInput.isMouseLeftPressed) {
                const now = Date.now();
                if (now - this.lastShotTime >= weaponDef.cooldown * 1000 && me.weapon !== 'shield' && me.weapon !== 'medkit') {
                    this.lastShotTime = now;
                    this.sendMessage({kind: "shoot", targetX: mouseWorldX, targetY: mouseWorldY});
                    this.hitEffects.push({ x: me.x + Math.cos(Math.atan2(mouseWorldY - me.y, mouseWorldX - me.x)) * 20, y: me.y + Math.sin(Math.atan2(mouseWorldY - me.y, mouseWorldX - me.x)) * 20, type: 'muzzle', t: 0 });
                }
            }

            if (this.buildingMode && this.userInput.isMouseLeftPressed) {
                const xSnapped = Math.round(mouseWorldX / 200) * 200;
                const ySnapped = Math.round(mouseWorldY / 200) * 200;
                const distX = Math.abs(mouseWorldX - me.x);
                const distY = Math.abs(mouseWorldY - me.y);
                const direction = distX >= distY ? 'vertical' : 'horizontal';
                this.sendMessage({kind: "addLine", x: xSnapped, y: ySnapped, direction});
            }

            // pulisci lo schermo con un cielo dinamico
            const skyGradient = ctx.createLinearGradient(0, 0, 0, screenH);
            skyGradient.addColorStop(0, '#74c5ff');
            skyGradient.addColorStop(0.5, '#7ec9ff');
            skyGradient.addColorStop(1, '#93e9ff');
            ctx.fillStyle = skyGradient;
            ctx.fillRect(0, 0, screenW, screenH);

            // piccolo sole e nubi stilizzate
            ctx.save();
            ctx.fillStyle = 'rgba(255,255,255,0.8)';
            ctx.beginPath();
            ctx.arc(screenW * 0.85, screenH * 0.15, 50, 0, Math.PI * 2);
            ctx.fill();
            ctx.fillStyle = 'rgba(255,255,255,0.4)';
            ctx.beginPath();
            ctx.ellipse(screenW * 0.25, screenH * 0.18, 90, 30, 0, 0, Math.PI * 2);
            ctx.fill();
            ctx.beginPath();
            ctx.ellipse(screenW * 0.38, screenH * 0.13, 80, 25, 0, 0, Math.PI * 2);
            ctx.fill();
            ctx.restore();

            ctx.save();
            ctx.translate(screenW/2, screenH/2); // centra lo schermo
            ctx.scale(this.camera.zoom, this.camera.zoom); // applica lo zoom
            ctx.translate(-this.camera.x, -this.camera.y); // sposta relativamente alla camera

            // disegna lo sfondo del "mondo" (campo da gioco)
            const groundGradient = ctx.createLinearGradient(0, worldBounds.top, 0, worldBounds.bottom);
            groundGradient.addColorStop(0, '#4f9e12');
            groundGradient.addColorStop(1, '#2e6f0b');
            ctx.fillStyle = groundGradient;
            ctx.fillRect(worldBounds.left, worldBounds.top, worldW, worldH);

            // disegna colline sullo sfondo
            ctx.fillStyle = 'rgba(15, 96, 32, 0.65)';
            ctx.beginPath();
            ctx.moveTo(worldBounds.left, worldBounds.top + 700);
            ctx.quadraticCurveTo(-800, worldBounds.top + 100, 0, worldBounds.top + 450);
            ctx.quadraticCurveTo(500, worldBounds.top + 680, 1200, worldBounds.top + 450);
            ctx.quadraticCurveTo(2000, worldBounds.top + 200, worldBounds.right, worldBounds.top + 700);
            ctx.lineTo(worldBounds.right, worldBounds.bottom);
            ctx.lineTo(worldBounds.left, worldBounds.bottom);
            ctx.closePath();
            ctx.fill();

            // disegna la griglia verde scuro
            ctx.fillStyle = "#004400";
            // linee verticali
            for (let x = worldBounds.left; x <= worldBounds.right; x += 200) {
                ctx.fillRect(x - 5, worldBounds.top, 10, worldH);
            }
            // linee orizzontali
            for (let y = worldBounds.top; y <= worldBounds.bottom; y += 200) {
                ctx.fillRect(worldBounds.left, y - 5, worldW, 10);
            }
    
            // disegna casse
            ctx.fillStyle = "#8B4513";
            for (let crate of this.crates) {
                if (!crate.opened) {
                    ctx.fillRect(crate.x - 25, crate.y - 25, 50, 50);
                }
            }
    
            // disegna linee permanenti marrone
            ctx.fillStyle = "#8B4513";
            for (let line of this.permanentLines) {
                if (line.direction === 'vertical') {
                    ctx.fillRect(line.x - 5, line.y, 10, 200);
                } else {
                    ctx.fillRect(line.x, line.y - 5, 200, 10);
                }
            }
    
            // disegna linea temporanea azzurra se in modalità costruzione
            if (this.buildingMode) {
                // snappo le coordinate al grid di 200
                const xSnapped = Math.round(mouseWorldX / 200) * 200;
                const ySnapped = Math.round(mouseWorldY / 200) * 200;
                
                // determina direzione basandomi sulla distanza del mouse dal player
                const distX = Math.abs(mouseWorldX - me.x);
                const distY = Math.abs(mouseWorldY - me.y);
                const direction = distX >= distY ? 'vertical' : 'horizontal';
                
                ctx.fillStyle = "#00FFFF";
                if (direction === 'vertical') {
                    ctx.fillRect(xSnapped - 5, ySnapped, 10, 200);
                } else {
                    ctx.fillRect(xSnapped, ySnapped - 5, 200, 10);
                }
            }
    
            // disegna proiettili e effetti
            this.bullets.forEach(bullet => this.drawBullet(ctx, bullet));
            this.hitEffects.forEach(effect => this.drawHitEffect(ctx, effect));

            // interpola le posizioni dei giocatori avversari
            Object.values(this.people).forEach((person) => {
                if (person !== me) {
                    person.x = smoothChange(person.x, person.xTarget, dt, 0.1);
                    person.y = smoothChange(person.y, person.yTarget, dt, 0.1);
                }
            });

            // sposta le persone e disegnale
            Object.values(this.people).forEach((person) => {
                const drawPerson = getCharacterDrawFunction(person.character);
                drawPerson(ctx, person.x, person.y, PERSON_W, PERSON_H);
                drawPersonName(ctx, person);
                
                if (person === me) {
                    const dx = mouseWorldX - me.x;
                    const dy = mouseWorldY - me.y;
                    const angle = Math.atan2(dy, dx);
                    this.drawWeapon(ctx, me.x, me.y, angle, me.weapon, this.getWeaponRenderSize(me.weapon));
                }
            });

            // disegna oggetti a terra
            for (let item of this.groundItems) {
                this.drawWeapon(ctx, item.x, item.y, 0, item.weapon, 36);
            }

            ctx.restore();

            ctx.save();
            ctx.fillStyle = 'rgba(0, 0, 0, 0.35)';
            ctx.fillRect(20, 20, 280, 100);
            ctx.fillStyle = '#fff';
            ctx.font = 'bold 20px Arial';
            ctx.textAlign = 'left';
            ctx.fillText('BATTLE ROYALE', 32, 48);
            ctx.font = '14px Arial';
            const aliveCount = Object.values(this.people).filter(p => p.alive).length;
            ctx.fillText(`Alive: ${aliveCount}/${Object.keys(this.people).length}`, 32, 70);
            ctx.fillText(`Weapon: ${weaponDef.displayName}`, 32, 92);
            ctx.restore();

            if (!me.alive) {
                ctx.save();
                ctx.fillStyle = 'rgba(0, 0, 0, 0.75)';
                ctx.fillRect(0, 0, screenW, screenH);
                ctx.fillStyle = '#ff5e5e';
                ctx.font = 'bold 60px Arial';
                ctx.textAlign = 'center';
                ctx.fillText('ELIMINATED', screenW / 2, screenH / 2 - 20);
                ctx.font = '20px Arial';
                ctx.fillStyle = '#fff';
                ctx.fillText('Respawn not yet available', screenW / 2, screenH / 2 + 20);
                ctx.restore();
            }

            if (!this.inventoryMenuOpen && !this.buildingMode) {
                this.drawCrosshair(ctx, mouseX, mouseY);
            }

            const barWidth = 500;
            const barHeight = 20;
            const barX = (screenW - barWidth) / 2;
            const shieldBarY = screenH - 120;
            const healthBarY = screenH - 85;

            // Barra scudo (azzurra)
            ctx.fillStyle = "#0088ff";
            ctx.fillRect(barX, shieldBarY, barWidth * (me.shield / 100), barHeight);
            ctx.strokeStyle = "#fff";
            ctx.lineWidth = 2;
            ctx.strokeRect(barX, shieldBarY, barWidth, barHeight);

            // Barra salute (verde)
            ctx.fillStyle = "#00ff00";
            ctx.fillRect(barX, healthBarY, barWidth * (me.health / 100), barHeight);
            ctx.strokeStyle = "#fff";
            ctx.lineWidth = 2;
            ctx.strokeRect(barX, healthBarY, barWidth, barHeight);

            // Valori dentro le barre a destra
            ctx.fillStyle = "#fff";
            ctx.font = "16px Arial";
            ctx.textAlign = "right";
            ctx.fillText(`${me.shield}/100`, barX + barWidth - 10, shieldBarY + barHeight - 5);
            ctx.fillText(`${me.health}/100`, barX + barWidth - 10, healthBarY + barHeight - 5);

            if (this.inventoryMenuOpen) {
                // Disegna il menu laterale TAB
                const menuX = 20;
                const menuY = 20;
                const menuW = 220;
                const menuH = 340;
                ctx.fillStyle = "rgba(0,0,0,0.75)";
                ctx.fillRect(menuX, menuY, menuW, menuH);
                ctx.strokeStyle = "#fff";
                ctx.lineWidth = 2;
                ctx.strokeRect(menuX, menuY, menuW, menuH);
                ctx.fillStyle = "#fff";
                ctx.textAlign = "left";
                ctx.font = "18px Arial";
                ctx.fillText("Inventory", menuX + 12, menuY + 28);
                ctx.font = "14px Arial";
                ctx.fillText("Drag items to reorder or drop outside", menuX + 12, menuY + 50);

                const menuSlotY = menuY + 70;
                const menuSlotHeight = 50;
                for (let i = 0; i < 5; i++) {
                    const slotX = menuX + 10;
                    const slotY = menuSlotY + i * (menuSlotHeight + 10);
                    ctx.fillStyle = this.draggingSlotIndex === i ? "#444" : "#222";
                    ctx.fillRect(slotX, slotY, menuW - 20, menuSlotHeight);
                    ctx.strokeStyle = "#fff";
                    ctx.lineWidth = 2;
                    ctx.strokeRect(slotX, slotY, menuW - 20, menuSlotHeight);
                    const weapon = me.inventory[i];
                    if (weapon) {
                        ctx.save();
                        ctx.translate(slotX + 30, slotY + menuSlotHeight / 2);
                        this.drawWeapon(ctx, 0, 0, 0, weapon, 36);
                        ctx.restore();
                        ctx.fillStyle = "#fff";
                        ctx.textAlign = "left";
                        ctx.fillText(weapon, slotX + 60, slotY + 30);
                    } else {
                        ctx.fillStyle = "#999";
                        ctx.textAlign = "left";
                        ctx.fillText("Empty slot", slotX + 15, slotY + 30);
                    }
                }

                if (this.draggingSlotIndex !== null && this.dragWeapon) {
                    ctx.save();
                    ctx.translate(mouseX, mouseY);
                    this.drawWeapon(ctx, 0, 0, 0, this.dragWeapon, 36);
                    ctx.restore();
                }
            }

            // Disegna gli slot degli oggetti in basso a destra
            const slotSize = 50;
            const slotSpacing = 8;
            const totalSlots = 6;
            const startX = screenW - totalSlots * slotSize - (totalSlots - 1) * slotSpacing - 20;
            const startY = screenH - slotSize - 20;
            
            for (let i = 0; i < 5; i++) {
                const x = startX + i * (slotSize + slotSpacing);
                const y = startY;
                
                // Sfondo slot
                ctx.fillStyle = i === this.currentSlot ? "#444" : "#222";
                ctx.fillRect(x, y, slotSize, slotSize);
                ctx.strokeStyle = "#fff";
                ctx.lineWidth = 2;
                ctx.strokeRect(x, y, slotSize, slotSize);
                
                // Disegna oggetto se presente
                const weapon = me.inventory[i];
                if (weapon) {
                    ctx.save();
                    ctx.translate(x + slotSize / 2, y + slotSize / 2);
                    this.drawWeapon(ctx, 0, 0, 0, weapon, 36);
                    ctx.restore();
                }
            }
            
            // Slot piccone separato (sempre presente)
            const pickaxeX = startX + 5 * (slotSize + slotSpacing);
            const pickaxeY = startY;
            ctx.fillStyle = this.currentSlot === 5 ? "#444" : "#222";
            ctx.fillRect(pickaxeX, pickaxeY, slotSize, slotSize);
            ctx.strokeStyle = "#fff";
            ctx.lineWidth = 2;
            ctx.strokeRect(pickaxeX, pickaxeY, slotSize, slotSize);
            
            ctx.save();
            ctx.translate(pickaxeX + slotSize / 2, pickaxeY + slotSize / 2);
            this.drawWeapon(ctx, 0, 0, 0, 'pickaxe', 36);
            ctx.restore();
            
        }




    draw(ctx: CanvasRenderingContext2D, dt: number) {
        const me = this.getMe() as ClientPersonExtended | null;
        if (me) {
            this.drawLobby(ctx, me, dt);
        }
    }

    handleMessage(message: any) {
        if (message.kind === "update") {
            const updateMsg = message;
            // Se è il primo update, inizializza tutte le posizioni
            const isFirstUpdate = Object.values(this.people).every(p => p.x === 0 && p.y === 0);

            Object.entries(updateMsg.people as Record<string, Person>).forEach(entry => {
                const id: string = entry[0];
                const updatedPerson: Person = entry[1];
                if (this.people[id]) {
                    // Aggiorna sempre stati dati come salute, scudo e inventario
                    this.people[id].health = updatedPerson.health;
                    this.people[id].shield = updatedPerson.shield;
                    this.people[id].inventory = updatedPerson.inventory;
                    this.people[id].alive = updatedPerson.alive;

                    if (this.myId !== id || isFirstUpdate) {
                        // Aggiorna target posizione per interpolazione smooth
                        this.people[id].xTarget = updatedPerson.x;
                        this.people[id].yTarget = updatedPerson.y;
                        if (isFirstUpdate) {
                            this.people[id].x = updatedPerson.x;
                            this.people[id].y = updatedPerson.y;
                        }
                    }
                } else {
                    // Aggiungi nuovo giocatore
                    this.people[id] = {
                        ...updatedPerson,
                        xTarget: updatedPerson.x,
                        yTarget: updatedPerson.y,
                        alive: updatedPerson.alive
                    } as ClientPersonExtended;
                }
            });
            this.permanentLines = updateMsg.lines || this.permanentLines;
            this.crates = updateMsg.crates || this.crates;
            this.groundItems = updateMsg.groundItems || this.groundItems;
            this.bullets = updateMsg.bullets || this.bullets;
            this.hitEffects = updateMsg.effects || this.hitEffects;
        }
    }

    flushMessages(): any[] {
        const messages: any[] = [];

        const me = this.getMe();
        if (me) {
            messages.push({
                kind: "move",
                x: me.x,
                y: me.y
            });
        }

        messages.push(...this.pendingMessages);
        this.pendingMessages = [];

        return messages;
    }

    private sendMessage(message: any) {
        this.pendingMessages.push(message);
    }

    private getMe(): ClientPersonExtended | null {
        return this.myId ? this.people[this.myId] : null;
    }

    isFinished(): boolean {
        return false;
    }
    

}

