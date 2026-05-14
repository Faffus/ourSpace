// Street-fighter inspired 1v1 game.
// The file stays intentionally flat and deterministic to match the existing project style.

import {
    Player,
    Rectangle
} from '../../common';
import type { IncomingMsg, OutgoingMsg } from '../../server';
import { GameClient, GameServer } from '../game';
import { UserInput } from '../../client/user-input';
import { getCharacterDrawFunction } from './characters';
import { AnimationManager, createDefaultFighterAnimationManager } from './fighter-animation';

export type PlayerState =
    | "IDLE"
    | "WALKING"
    | "JUMPING"
    | "CROUCHING"
    | "DASHING"
    | "DODGING"
    | "CHARGING"
    | "ATTACKING_LIGHT"
    | "ATTACKING_HEAVY"
    | "ATTACKING_AERIAL"
    | "ATTACKING_SWEEP"
    | "SPECIAL"
    | "HIT"
    | "BLOCKING"
    | "KNOCKDOWN"
    | "KO";

export type CharacterClass = string;
export type AttackType = "LIGHT" | "HEAVY" | "AERIAL" | "SWEEP" | "PROJECTILE";
export type AttackHeight = "HIGH" | "MID" | "LOW";
export type FacingDirection = "left" | "right";
export type CombatEvent = "HitboxActive" | "HitboxInactive" | "SoundEffect" | "ProjectileSpawn";

const FRAME_RATE = 60;
const FRAME_DT = 1 / FRAME_RATE;
const PLAYER_W = 0.15;
const PLAYER_H = 0.5;
const GROUND_Y = 0.75;

const MAX_HEALTH = 100;
const ROUND_TIME = 99;
const BEST_OF_ROUNDS = 3;
const ROUNDS_TO_WIN = 2;
const COUNTDOWN_FRAMES = 180;
const ROUND_END_FRAMES = 150;
const RESULT_FRAMES = 300;

const MAX_WALK_SPEED = 0.78;
const ACCELERATION = 5.6;
const AIR_ACCELERATION = 2.1;
const FRICTION = 7.0;
const GRAVITY = 5.0;
const FAST_FALL_MULTIPLIER = 1.5;
const JUMP_FORCE = 1.8;
const SECOND_JUMP_MULTIPLIER = 0.7;

const DASH_TOTAL_FRAMES = 14;
const DASH_DISTANCE = 0.38;
const DASH_SPEED = DASH_DISTANCE / (DASH_TOTAL_FRAMES / FRAME_RATE);
const DOUBLE_TAP_WINDOW = 14;

const DODGE_TOTAL_FRAMES = 24;
const DODGE_IFRAMES = 18;
const DODGE_COOLDOWN_FRAMES = 52;
const DODGE_SPEED = 1.0;

const HITSTOP_LIGHT = 3;
const HITSTOP_HEAVY = 5;
const BLOCKSTUN = 8;
const INPUT_BUFFER_SIZE = 15;
const COMBO_TIMEOUT_FRAMES = 90;

export class UserInputFighterExtended extends UserInput {
    // 1. Nuove proprietà pubbliche
    public jump: boolean = false;
    public attackLight: boolean = false;
    public attackHeavy: boolean = false;
    public block: boolean = false;
    public dodge: boolean = false;

    // 2. Logica Special Moves
    public specialInputSequence: string[] = [];
    private lastInputTime: number = 0;
    private readonly INPUT_TIMEOUT = 600;

    // 3. Tracking interno (necessario perché i 'private' della madre sono inaccessibili)
    private _fUp: boolean = false;
    private _fDown: boolean = false;
    private _fLeft: boolean = false;
    private _fRight: boolean = false;

    constructor(canvas: HTMLCanvasElement) {
        // Chiama il costruttore di UserInput (gestisce già Resize, Mouse, Wheel e WASD base)
        super(canvas);

        this.setupFighterListeners();
    }

    private setupFighterListeners() {
        document.addEventListener("keydown", (event) => {
            if (event.repeat) return;

            // Tracciamento tasti direzionali per le combo (copia locale)
            if (event.code == "KeyW") this._fUp = true;
            else if (event.code == "KeyA") this._fLeft = true;
            else if (event.code == "KeyS") this._fDown = true;
            else if (event.code == "KeyD") this._fRight = true;

            // Nuovi tasti Fighter
            else if (event.code == "Space") {
                event.preventDefault();
                this.jump = true;
            }
            else if (event.code == "KeyE") {
                this.attackLight = true;
                this.recordSpecialInput('A');
            }
            else if (event.code == "KeyR") {
                this.attackHeavy = true;
                this.recordSpecialInput('B');
            }
            else if (event.code == "KeyQ") {
                this.block = true;
            }
            else if (event.code == "KeyF" || event.code.startsWith("Shift")) {
                this.dodge = true;
            }

            this.recordDirectionalInput();
        });

        document.addEventListener("keyup", (event) => {
            if (event.code == "KeyW") this._fUp = false;
            else if (event.code == "KeyA") this._fLeft = false;
            else if (event.code == "KeyS") this._fDown = false;
            else if (event.code == "KeyD") this._fRight = false;
            
            else if (event.code == "Space") this.jump = false;
            else if (event.code == "KeyE") this.attackLight = false;
            else if (event.code == "KeyR") this.attackHeavy = false;
            else if (event.code == "KeyQ") this.block = false;
            else if (event.code == "KeyF" || event.code.startsWith("Shift")) this.dodge = false;
        });

        window.addEventListener("blur", () => {
            this.jump = this.attackLight = this.attackHeavy = this.block = this.dodge = false;
            this._fUp = this._fDown = this._fLeft = this._fRight = false;
        });
    }

    private recordDirectionalInput(): void {
        let direction = '';
        if (this._fDown && this._fRight) direction = '3';
        else if (this._fDown && this._fLeft) direction = '1';
        else if (this._fUp && this._fRight) direction = '9';
        else if (this._fUp && this._fLeft) direction = '7';
        else if (this._fRight) direction = '6';
        else if (this._fLeft) direction = '4';
        else if (this._fDown) direction = '2';
        else if (this._fUp) direction = '8';

        if (direction && this.specialInputSequence[this.specialInputSequence.length - 1] !== direction) {
            this.recordSpecialInput(direction);
        }
    }

    private recordSpecialInput(input: string): void {
        const now = Date.now();
        if (now - this.lastInputTime > this.INPUT_TIMEOUT) {
            this.specialInputSequence = [];
        }
        this.specialInputSequence.push(input);
        this.lastInputTime = now;

        if (this.specialInputSequence.length > 10) {
            this.specialInputSequence.shift();
        }
    }

    public checkSpecialInput(sequence: string): boolean {
        const seqLength = sequence.length;
        if (this.specialInputSequence.length < seqLength) return false;
        const lastInputs = this.specialInputSequence.slice(-seqLength).join('');
        return lastInputs === sequence;
    }

    public clearSpecialInput(): void {
        this.specialInputSequence = [];
    }
}

export interface InputAction {
    frame: number;
    direction: string;
    buttons: string[];
}

export interface MotionCommand {
    name: string;
    pattern: string[];
}

export interface Hitbox {
    x: number;        // Position relative to player center
    y: number;        // Position relative to player center
    w: number;        // Width
    h: number;        // Height
    damage: number;
    height: AttackHeight;
    startFrame: number;  // Frame attack becomes active
    endFrame: number;    // Frame attack ends
    knockback: number;
    priority?: number;
    attackType?: AttackType;
    causesKnockdown?: boolean;
}

export interface Pushbox {
    x: number;
    y: number;
    w: number;
    h: number;
}

export interface Projectile {
    id: string;
    ownerId: string;
    x: number;
    y: number;
    vx: number;
    facingRight: boolean;
    lifeSpan: number;
    hitbox: Hitbox;
    alreadyHit: Record<string, boolean>;
}

export interface FighterPlayer {
    // Identity & Meta
    id: string;
    playerId: string;
    name: string;
    playerName: string;
    character: string;
    characterType: CharacterClass;

    // Health & Resource
    health: number;
    maxHealth: number;
    superMeter: number;
    defense: number;
    isBlocking: boolean;
    blockReduction: number;
    blockHeight: AttackHeight;

    // Physics & Transform (legacy flat fields kept for the current renderer)
    x: number;
    y: number;
    vx: number;
    vy: number;
    position: { x: number; y: number };
    velocity: { x: number; y: number };
    facing: FacingDirection;
    facingRight: boolean;
    isGrounded: boolean;

    // State Machine
    state: PlayerState;
    currentState: PlayerState;
    stateFrame: number;
    jumpCount: number;
    canJump: boolean;

    // Combat Data
    isAttacking: boolean;
    currentAttack: AttackType | null;
    attackCharge: number;
    chargePercentage: number;
    hitstun: number;
    hitStunFrames: number;
    blockstun: number;
    knockbackX: number;
    knockdownFrames: number;
    isInvulnerable: boolean;
    invulnerabilityFrames: number;
    hitStopFrames: number;
    dodgeCooldownFrames: number;
    alreadyHitTargets: Record<string, boolean>;

    // Attack Input
    inputLight: boolean;
    inputHeavy: boolean;
    inputBlock: boolean;
    inputMove: number; // -1 (left), 0 (idle), 1 (right)
    inputJump: boolean;
    inputCrouch: boolean;
    inputDodge: boolean;
    wasAttackLightPressed: boolean;
    wasAttackHeavyPressed: boolean;
    wasJumpPressed: boolean;
    wasDodgePressed: boolean;
    lastMoveTapFrame: Record<string, number>;

    // Animation & Input
    currentAnimationFrame: number;
    animationTimer: number;
    attackTimer: number;
    damageFlashTimer: number;
    inputQueue: InputAction[];
    specialInputSequence: string[];

    // Match Stats
    roundsWon: number;
    comboCount: number;
    maxCombo: number;
    comboTimer: number;
    totalDamageDealt: number;
}

// AABB Collision Check
const checkAABBCollision = (rect1: Rectangle, rect2: Rectangle): boolean => {
    return rect1.x < rect2.x + rect2.w &&
           rect1.x + rect1.w > rect2.x &&
           rect1.y < rect2.y + rect2.h &&
           rect1.y + rect1.h > rect2.y;
};

// Get hitbox world position from player
const getHitboxWorldPos = (player: FighterPlayer, hitbox: Hitbox): Rectangle => {
    const direction = player.facingRight ? 1 : -1;
    return {
        x: player.x + 0.075 + (hitbox.x * direction) - hitbox.w / 2,
        y: player.y + hitbox.y - hitbox.h / 2,
        w: hitbox.w,
        h: hitbox.h
    };
};

// Get hurtbox (player body) for damage calculation
const getHurtbox = (player: FighterPlayer, boxHeight: AttackHeight = "MID"): Rectangle => {
    const PLAYER_W = 0.15;
    const PLAYER_H = 0.5;
    const crouchScale = player.inputCrouch || player.state === "CROUCHING" ? 0.55 : 1;
    const h = PLAYER_H * crouchScale;
    const top = player.y - h;

    if (boxHeight === "HIGH") {
        return {
            x: player.x,
            y: top,
            w: PLAYER_W,
            h: h * 0.38
        };
    }

    if (boxHeight === "LOW") {
        return {
            x: player.x,
            y: player.y - h * 0.35,
            w: PLAYER_W,
            h: h * 0.35
        };
    }

    return {
        x: player.x,
        y: top + h * 0.22,
        w: PLAYER_W,
        h: h * 0.58
    };
};

const getPushbox = (player: FighterPlayer): Rectangle => {
    const h = player.inputCrouch || player.state === "CROUCHING" ? 0.28 : 0.46;
    return {
        x: player.x + 0.025,
        y: player.y - h,
        w: 0.1,
        h
    };
};


const HADOKEN: MotionCommand = { name: 'hadoken', pattern: ['2', '3', '6P'] };
const SHORYUKEN: MotionCommand = { name: 'shoryuken', pattern: ['6', '2', '3P'] };

type MatchPhase = 'COUNTDOWN' | 'ACTIVE' | 'ROUND_END' | 'RESULTS';

type AttackDefinition = Hitbox & {
    totalFrames: number;
    hitstun: number;
    blockstun: number;
    hitStop: number;
    blockDamageRatio: number;
    priority: number;
    attackType: NonNullable<Hitbox['attackType']>;
};

const ATTACK_LIGHT: AttackDefinition = {
    x: 0.13, y: -0.29, w: 0.1, h: 0.12,
    damage: 5, height: 'MID', startFrame: 4, endFrame: 7, knockback: 0.28,
    totalFrames: 16, hitstun: 10, blockstun: BLOCKSTUN, hitStop: HITSTOP_LIGHT,
    blockDamageRatio: 0.2, priority: 1, attackType: 'LIGHT'
};

const ATTACK_HEAVY: AttackDefinition = {
    x: 0.17, y: -0.28, w: 0.14, h: 0.16,
    damage: 12, height: 'MID', startFrame: 9, endFrame: 16, knockback: 0.58,
    totalFrames: 30, hitstun: 17, blockstun: BLOCKSTUN + 3, hitStop: HITSTOP_HEAVY,
    blockDamageRatio: 0.3, priority: 3, attackType: 'HEAVY'
};

const ATTACK_AERIAL: AttackDefinition = {
    x: 0.1, y: -0.08, w: 0.12, h: 0.2,
    damage: 8, height: 'HIGH', startFrame: 5, endFrame: 14, knockback: 0.38,
    totalFrames: 22, hitstun: 13, blockstun: BLOCKSTUN, hitStop: HITSTOP_LIGHT,
    blockDamageRatio: 0.25, priority: 2, attackType: 'AERIAL'
};

const ATTACK_SWEEP: AttackDefinition = {
    x: 0.14, y: -0.08, w: 0.17, h: 0.1,
    damage: 9, height: 'LOW', startFrame: 8, endFrame: 15, knockback: 0.45,
    totalFrames: 28, hitstun: 14, blockstun: BLOCKSTUN + 1, hitStop: HITSTOP_HEAVY,
    blockDamageRatio: 0.25, priority: 2, attackType: 'SWEEP', causesKnockdown: true
};

const ATTACK_SHORYUKEN: AttackDefinition = {
    x: 0.09, y: -0.33, w: 0.14, h: 0.28,
    damage: 14, height: 'MID', startFrame: 4, endFrame: 13, knockback: 0.5,
    totalFrames: 34, hitstun: 19, blockstun: BLOCKSTUN + 4, hitStop: HITSTOP_HEAVY,
    blockDamageRatio: 0.32, priority: 4, attackType: 'HEAVY'
};

const PROJECTILE_HITBOX: AttackDefinition = {
    x: 0, y: 0, w: 0.11, h: 0.11,
    damage: 8, height: 'MID', startFrame: 0, endFrame: 90, knockback: 0.35,
    totalFrames: 90, hitstun: 13, blockstun: BLOCKSTUN, hitStop: HITSTOP_LIGHT,
    blockDamageRatio: 0.25, priority: 2, attackType: 'PROJECTILE'
};

function initializeFighterPlayer(id: string, playerBase: Player, isPlayer1: boolean): FighterPlayer {
    const x = isPlayer1 ? -0.65 : 0.65 - PLAYER_W;
    const y = GROUND_Y;
    const facingRight = isPlayer1;
    return {
        id,
        playerId: id,
        name: playerBase.name,
        playerName: playerBase.name,
        character: playerBase.character,
        characterType: playerBase.character,

        health: MAX_HEALTH,
        maxHealth: MAX_HEALTH,
        superMeter: 0,
        defense: 0,
        isBlocking: false,
        blockReduction: 0.7,
        blockHeight: 'MID',

        x,
        y,
        vx: 0,
        vy: 0,
        position: { x, y },
        velocity: { x: 0, y: 0 },
        facing: facingRight ? 'right' : 'left',
        facingRight,
        isGrounded: true,

        state: 'IDLE',
        currentState: 'IDLE',
        stateFrame: 0,
        jumpCount: 0,
        canJump: true,

        isAttacking: false,
        currentAttack: null,
        attackCharge: 0,
        chargePercentage: 0,
        hitstun: 0,
        hitStunFrames: 0,
        blockstun: 0,
        knockbackX: 0,
        knockdownFrames: 0,
        isInvulnerable: false,
        invulnerabilityFrames: 0,
        hitStopFrames: 0,
        dodgeCooldownFrames: 0,
        alreadyHitTargets: {},

        inputLight: false,
        inputHeavy: false,
        inputBlock: false,
        inputMove: 0,
        inputJump: false,
        inputCrouch: false,
        inputDodge: false,
        wasAttackLightPressed: false,
        wasAttackHeavyPressed: false,
        wasJumpPressed: false,
        wasDodgePressed: false,
        lastMoveTapFrame: {},

        currentAnimationFrame: 0,
        animationTimer: 0,
        attackTimer: 0,
        damageFlashTimer: 0,
        inputQueue: [],
        specialInputSequence: [],

        roundsWon: 0,
        comboCount: 0,
        maxCombo: 0,
        comboTimer: 0,
        totalDamageDealt: 0
    } as FighterPlayer & { lastMoveInput?: number };
}

function syncPlayerAliases(player: FighterPlayer): void {
    player.position.x = player.x;
    player.position.y = player.y;
    player.velocity.x = player.vx;
    player.velocity.y = player.vy;
    player.facingRight = player.facing === 'right';
    player.currentState = player.state;
    player.hitStunFrames = player.hitstun;
    player.chargePercentage = player.attackCharge;
    player.isInvulnerable = player.invulnerabilityFrames > 0 || player.state === 'DODGING';
    player.canJump = player.jumpCount < 2;
}

function setState(player: FighterPlayer, state: PlayerState, currentAttack: FighterPlayer['currentAttack'] = null): void {
    if (player.state !== state) {
        player.stateFrame = 0;
        player.alreadyHitTargets = {};
    }
    player.state = state;
    player.currentState = state;
    player.currentAttack = currentAttack;
    player.isAttacking = currentAttack !== null;
}

function isAttackState(state: PlayerState): boolean {
    return state === 'ATTACKING_LIGHT' || state === 'ATTACKING_HEAVY' || state === 'ATTACKING_AERIAL' || state === 'ATTACKING_SWEEP' || state === 'SPECIAL';
}

function canStartAction(player: FighterPlayer): boolean {
    return player.state !== 'KO' &&
        player.hitstun <= 0 &&
        player.blockstun <= 0 &&
        player.knockdownFrames <= 0 &&
        player.hitStopFrames <= 0 &&
        !isAttackState(player.state) &&
        player.state !== 'DASHING' &&
        player.state !== 'DODGING';
}

function clamp(value: number, min: number, max: number): number {
    return Math.max(min, Math.min(max, value));
}

function moveTowardZero(value: number, amount: number): number {
    if (Math.abs(value) <= amount) return 0;
    return value > 0 ? value - amount : value + amount;
}

function appendInput(player: FighterPlayer, frame: number): void {
    const direction = getNormalizedDirection(player);
    const buttons: string[] = [];
    if (player.inputLight) buttons.push('P');
    if (player.inputHeavy) buttons.push('H');
    if (player.inputBlock) buttons.push('B');
    if (player.inputJump) buttons.push('J');
    if (player.inputDodge) buttons.push('D');

    const input: InputAction = { frame, direction, buttons };
    player.inputQueue.push(input);
    if (player.inputQueue.length > INPUT_BUFFER_SIZE) player.inputQueue.shift();

    const token = direction + buttons.join('');
    if (token !== player.specialInputSequence[player.specialInputSequence.length - 1]) {
        player.specialInputSequence.push(token);
        if (player.specialInputSequence.length > INPUT_BUFFER_SIZE) player.specialInputSequence.shift();
    }
}

function getNormalizedDirection(player: FighterPlayer): string {
    const forward = player.facingRight ? 1 : -1;
    const move = player.inputMove * forward;

    if (player.inputCrouch && move > 0) return '3';
    if (player.inputCrouch && move < 0) return '1';
    if (player.inputCrouch) return '2';
    if (move > 0) return '6';
    if (move < 0) return '4';
    return '5';
}

function actionToken(input: InputAction): string {
    const hasPunch = input.buttons.includes('P') || input.buttons.includes('H');
    return input.direction + (hasPunch ? 'P' : '');
}

function detectMotion(player: FighterPlayer, command: MotionCommand): boolean {
    const collapsed: string[] = [];
    player.inputQueue.forEach(input => {
        const token = actionToken(input);
        if (token !== collapsed[collapsed.length - 1]) collapsed.push(token);
    });

    let patternIndex = command.pattern.length - 1;
    for (let i = collapsed.length - 1; i >= 0 && patternIndex >= 0; i--) {
        if (collapsed[i] === command.pattern[patternIndex]) patternIndex--;
    }
    return patternIndex < 0;
}

function getAttackDefinition(player: FighterPlayer): AttackDefinition | null {
    switch (player.currentAttack) {
        case 'LIGHT': return ATTACK_LIGHT;
        case 'HEAVY': return ATTACK_HEAVY;
        case 'AERIAL': return ATTACK_AERIAL;
        case 'SWEEP': return ATTACK_SWEEP;
        default:
            if (player.state === 'SPECIAL') return ATTACK_SHORYUKEN;
            return null;
    }
}

function scaledAttack(base: AttackDefinition, attacker: FighterPlayer): AttackDefinition {
    if (base.attackType !== 'HEAVY') return base;
    const multiplier = 1 + Math.min(1, attacker.chargePercentage / 100);
    return {
        ...base,
        damage: Math.round(base.damage * multiplier),
        knockback: base.knockback * multiplier
    };
}

function startAttack(player: FighterPlayer, attackType: NonNullable<FighterPlayer['currentAttack']>): void {
    const stateByAttack: Record<string, PlayerState> = {
        LIGHT: 'ATTACKING_LIGHT',
        HEAVY: 'ATTACKING_HEAVY',
        AERIAL: 'ATTACKING_AERIAL',
        SWEEP: 'ATTACKING_SWEEP',
        PROJECTILE: 'SPECIAL'
    };
    setState(player, stateByAttack[attackType], attackType);
    player.attackTimer = getAttackDefinition(player)?.totalFrames ?? 20;
}

function startSpecialUppercut(player: FighterPlayer): void {
    setState(player, 'SPECIAL', 'HEAVY');
    player.attackTimer = ATTACK_SHORYUKEN.totalFrames;
    player.invulnerabilityFrames = 6;
    player.vy = -JUMP_FORCE * 0.45;
    player.jumpCount = Math.max(player.jumpCount, 1);
}

function spawnProjectile(owner: FighterPlayer, frame: number): Projectile {
    const direction = owner.facingRight ? 1 : -1;
    return {
        id: `${owner.id}-${frame}-${Math.random().toString(36).slice(2, 7)}`,
        ownerId: owner.id,
        x: owner.x + PLAYER_W / 2 + direction * 0.17,
        y: owner.y - PLAYER_H * 0.42,
        vx: direction * 0.95,
        facingRight: owner.facingRight,
        lifeSpan: 90,
        hitbox: PROJECTILE_HITBOX,
        alreadyHit: {}
    };
}

function maybeStartDash(player: FighterPlayer, frame: number): boolean {
    const dynamicPlayer = player as FighterPlayer & { lastMoveInput?: number; dashDirection?: number };
    const previousMove = dynamicPlayer.lastMoveInput ?? 0;
    const currentMove = player.inputMove;

    if (currentMove !== 0 && previousMove === 0 && canStartAction(player) && !player.inputCrouch) {
        const key = currentMove > 0 ? 'right' : 'left';
        const lastTap = player.lastMoveTapFrame[key] ?? -999;
        player.lastMoveTapFrame[key] = frame;
        if (frame - lastTap <= DOUBLE_TAP_WINDOW) {
            dynamicPlayer.dashDirection = currentMove;
            setState(player, 'DASHING', null);
            player.vx = currentMove * DASH_SPEED;
            return true;
        }
    }

    dynamicPlayer.lastMoveInput = currentMove;
    return false;
}

function maybeStartDodge(player: FighterPlayer): boolean {
    if (player.inputDodge && !player.wasDodgePressed && canStartAction(player) && player.dodgeCooldownFrames <= 0) {
        const direction = player.inputMove !== 0 ? player.inputMove : (player.facingRight ? 1 : -1);
        setState(player, 'DODGING', null);
        player.invulnerabilityFrames = DODGE_IFRAMES;
        player.dodgeCooldownFrames = DODGE_COOLDOWN_FRAMES;
        player.vx = direction * DODGE_SPEED;
        return true;
    }
    return false;
}

function updatePlayerState(player: FighterPlayer, opponent: FighterPlayer | null, frame: number, onProjectile: (projectile: Projectile) => void): void {
    appendInput(player, frame);

    if (player.state === 'KO') {
        syncPlayerAliases(player);
        return;
    }

    if (player.damageFlashTimer > 0) player.damageFlashTimer--;
    if (player.comboTimer > 0) player.comboTimer--;
    else player.comboCount = 0;
    if (player.dodgeCooldownFrames > 0) player.dodgeCooldownFrames--;
    if (player.invulnerabilityFrames > 0) player.invulnerabilityFrames--;

    if (player.hitStopFrames > 0) {
        player.hitStopFrames--;
        syncPlayerAliases(player);
        return;
    }

    player.stateFrame++;

    if (player.hitstun > 0) {
        player.hitstun--;
        setState(player, 'HIT', null);
        return;
    }

    if (player.knockdownFrames > 0) {
        player.knockdownFrames--;
        setState(player, 'KNOCKDOWN', null);
        return;
    }

    if (player.blockstun > 0) {
        player.blockstun--;
        setState(player, 'BLOCKING', null);
        return;
    }

    if (isAttackState(player.state)) {
        const attack = getAttackDefinition(player);
        if (attack && player.stateFrame > attack.totalFrames) {
            player.attackCharge = 0;
            player.chargePercentage = 0;
            setState(player, player.isGrounded ? 'IDLE' : 'JUMPING', null);
        }
        return;
    }

    if (player.state === 'DASHING') {
        if (player.stateFrame >= DASH_TOTAL_FRAMES) {
            setState(player, player.isGrounded ? 'IDLE' : 'JUMPING', null);
        }
        return;
    }

    if (player.state === 'DODGING') {
        if (player.stateFrame >= DODGE_TOTAL_FRAMES) {
            setState(player, player.isGrounded ? 'IDLE' : 'JUMPING', null);
        }
        return;
    }

    if (player.state === 'CHARGING') {
        if (player.inputHeavy) {
            player.attackCharge = clamp(player.attackCharge + 4, 0, 100);
            return;
        }
        startAttack(player, 'HEAVY');
        return;
    }

    if (opponent) player.facing = opponent.x + PLAYER_W / 2 >= player.x + PLAYER_W / 2 ? 'right' : 'left';

    if (maybeStartDash(player, frame)) return;
    if (maybeStartDodge(player)) return;

    const lightPressed = player.inputLight && !player.wasAttackLightPressed;
    const heavyPressed = player.inputHeavy && !player.wasAttackHeavyPressed;
    const jumpPressed = player.inputJump && !player.wasJumpPressed;

    if (jumpPressed && player.jumpCount < 2) {
        const impulse = player.jumpCount === 0 ? JUMP_FORCE : JUMP_FORCE * SECOND_JUMP_MULTIPLIER;
        player.vy = -impulse;
        player.jumpCount++;
        player.isGrounded = false;
        setState(player, 'JUMPING', null);
        return;
    }

    if (lightPressed && canStartAction(player)) {
        if (detectMotion(player, SHORYUKEN)) {
            startSpecialUppercut(player);
            player.specialInputSequence = [];
            player.inputQueue = [];
            return;
        }
        if (detectMotion(player, HADOKEN)) {
            setState(player, 'SPECIAL', 'PROJECTILE');
            player.attackTimer = 22;
            onProjectile(spawnProjectile(player, frame));
            player.specialInputSequence = [];
            player.inputQueue = [];
            return;
        }
        startAttack(player, player.isGrounded ? 'LIGHT' : 'AERIAL');
        return;
    }

    if (heavyPressed && canStartAction(player)) {
        if (player.inputCrouch && player.isGrounded) startAttack(player, 'SWEEP');
        else if (player.isGrounded) setState(player, 'CHARGING', null);
        else startAttack(player, 'AERIAL');
        return;
    }

    if (player.inputBlock && player.isGrounded && canStartAction(player)) {
        player.isBlocking = true;
        player.blockHeight = player.inputCrouch ? 'LOW' : 'MID';
        setState(player, 'BLOCKING', null);
        return;
    }
    player.isBlocking = false;

    if (player.inputCrouch && player.isGrounded && canStartAction(player)) {
        setState(player, 'CROUCHING', null);
        return;
    }

    if (!player.isGrounded) {
        setState(player, 'JUMPING', null);
    } else if (Math.abs(player.vx) > 0.04 || player.inputMove !== 0) {
        setState(player, 'WALKING', null);
    } else {
        setState(player, 'IDLE', null);
    }
}

function updatePlayerPhysics(player: FighterPlayer): void {
    if (player.state === 'KO') return;

    const frozen = player.hitStopFrames > 0;
    if (frozen) return;

    if (player.knockbackX !== 0) {
        player.vx = player.knockbackX;
        player.knockbackX = moveTowardZero(player.knockbackX, FRICTION * 0.35 * FRAME_DT);
    }

    const movementLocked = player.inputCrouch || player.state === 'BLOCKING' || player.state === 'CHARGING' || isAttackState(player.state) || player.hitstun > 0 || player.blockstun > 0 || player.knockdownFrames > 0;

    if (player.state === 'DASHING' || player.state === 'DODGING') {
        player.vx = moveTowardZero(player.vx, FRICTION * 0.18 * FRAME_DT);
    } else if (!movementLocked) {
        const acceleration = player.isGrounded ? ACCELERATION : AIR_ACCELERATION;
        if (player.inputMove !== 0) {
            player.vx = clamp(player.vx + player.inputMove * acceleration * FRAME_DT, -MAX_WALK_SPEED, MAX_WALK_SPEED);
        } else {
            player.vx = moveTowardZero(player.vx, FRICTION * FRAME_DT);
        }
    } else if (player.isGrounded && player.knockbackX === 0) {
        player.vx = moveTowardZero(player.vx, FRICTION * FRAME_DT);
    }

    if (!player.isGrounded) {
        const gravityScale = player.vy > 0 ? FAST_FALL_MULTIPLIER : 1;
        player.vy += GRAVITY * gravityScale * FRAME_DT;
    }

    player.x += player.vx * FRAME_DT;
    player.y += player.vy * FRAME_DT;

    if (player.y >= GROUND_Y) {
        player.y = GROUND_Y;
        if (player.vy > 0) player.vy = 0;
        player.isGrounded = true;
        player.jumpCount = 0;
        if (player.state === 'JUMPING') setState(player, Math.abs(player.vx) > 0.04 ? 'WALKING' : 'IDLE', null);
    } else {
        player.isGrounded = false;
    }

    player.x = clamp(player.x, -1, 1 - PLAYER_W);
    syncPlayerAliases(player);
}

function separatePushboxes(players: FighterPlayer[]): void {
    if (players.length < 2) return;
    for (let i = 0; i < players.length; i++) {
        for (let j = i + 1; j < players.length; j++) {
            const a = players[i];
            const b = players[j];
            const boxA = getPushbox(a);
            const boxB = getPushbox(b);
            if (!checkAABBCollision(boxA, boxB)) continue;

            const overlap = Math.min(boxA.x + boxA.w - boxB.x, boxB.x + boxB.w - boxA.x);
            const separation = overlap / 2 + 0.001;
            if (a.x < b.x) {
                a.x -= separation;
                b.x += separation;
            } else {
                a.x += separation;
                b.x -= separation;
            }
            a.x = clamp(a.x, -1, 1 - PLAYER_W);
            b.x = clamp(b.x, -1, 1 - PLAYER_W);
            syncPlayerAliases(a);
            syncPlayerAliases(b);
        }
    }
}

type ActiveStrike = {
    player: FighterPlayer;
    attack: AttackDefinition;
    rect: ReturnType<typeof getHitboxWorldPos>;
};

function activeStrike(player: FighterPlayer): ActiveStrike | null {
    const base = getAttackDefinition(player);
    if (!base) return null;
    if (player.stateFrame < base.startFrame || player.stateFrame > base.endFrame) return null;
    const attack = scaledAttack(base, player);
    return { player, attack, rect: getHitboxWorldPos(player, attack) };
}

function canBlock(defender: FighterPlayer, hitbox: Hitbox): boolean {
    if (!defender.isBlocking) return false;
    if (hitbox.height === 'LOW') return defender.blockHeight === 'LOW';
    return defender.blockHeight === 'MID' || defender.blockHeight === 'HIGH';
}

function applyDamage(attacker: FighterPlayer, defender: FighterPlayer, hitbox: AttackDefinition): void {
    if (defender.state === 'KO' || defender.isInvulnerable || defender.invulnerabilityFrames > 0) return;
    if (attacker.alreadyHitTargets[defender.id]) return;
    attacker.alreadyHitTargets[defender.id] = true;

    const blocked = canBlock(defender, hitbox);
    const rawDamage = blocked ? Math.max(1, Math.floor(hitbox.damage * hitbox.blockDamageRatio * defender.blockReduction)) : hitbox.damage;
    const damage = Math.max(1, Math.round(rawDamage * (1 - defender.defense)));

    defender.health = Math.max(0, defender.health - damage);
    defender.damageFlashTimer = blocked ? 8 : 18;
    defender.hitStopFrames = hitbox.hitStop;
    attacker.hitStopFrames = hitbox.hitStop;
    attacker.superMeter = clamp(attacker.superMeter + damage * 1.8, 0, 100);
    defender.superMeter = clamp(defender.superMeter + damage * 0.8, 0, 100);

    if (blocked) {
        defender.blockstun = hitbox.blockstun;
        setState(defender, 'BLOCKING', null);
    } else {
        defender.hitstun = hitbox.hitstun;
        const directionAwayFromAttacker = defender.x > attacker.x ? 1 : -1;
        defender.knockbackX = hitbox.knockback * directionAwayFromAttacker;
        if (hitbox.causesKnockdown) defender.knockdownFrames = 60;
        setState(defender, hitbox.causesKnockdown ? 'KNOCKDOWN' : 'HIT', null);

        attacker.comboCount = attacker.comboTimer > 0 ? attacker.comboCount + 1 : 1;
        attacker.comboTimer = COMBO_TIMEOUT_FRAMES;
        attacker.maxCombo = Math.max(attacker.maxCombo, attacker.comboCount);
    }

    attacker.totalDamageDealt += damage;
}

function resolveMeleeCombat(players: FighterPlayer[]): void {
    if (players.length < 2) return;
    const [a, b] = players;
    const strikeA = activeStrike(a);
    const strikeB = activeStrike(b);

    let aAllowed = true;
    let bAllowed = true;
    if (strikeA && strikeB && checkAABBCollision(strikeA.rect, strikeB.rect)) {
        if (strikeA.attack.priority > strikeB.attack.priority) bAllowed = false;
        if (strikeB.attack.priority > strikeA.attack.priority) aAllowed = false;
    }

    if (strikeA && aAllowed && checkAABBCollision(strikeA.rect, getHurtbox(b, strikeA.attack.height))) {
        applyDamage(a, b, strikeA.attack);
    }
    if (strikeB && bAllowed && checkAABBCollision(strikeB.rect, getHurtbox(a, strikeB.attack.height))) {
        applyDamage(b, a, strikeB.attack);
    }
}

function projectileRect(projectile: Projectile) {
    return {
        x: projectile.x - projectile.hitbox.w / 2,
        y: projectile.y - projectile.hitbox.h / 2,
        w: projectile.hitbox.w,
        h: projectile.hitbox.h
    };
}

function updateProjectiles(projectiles: Projectile[], players: Record<string, FighterPlayer>): Projectile[] {
    const alive: Projectile[] = [];
    projectiles.forEach(projectile => {
        projectile.x += projectile.vx * FRAME_DT;
        projectile.lifeSpan--;
        if (projectile.lifeSpan <= 0 || projectile.x < -1.2 || projectile.x > 1.2) return;

        Object.values(players).forEach(defender => {
            if (defender.id === projectile.ownerId || projectile.alreadyHit[defender.id]) return;
            if (checkAABBCollision(projectileRect(projectile), getHurtbox(defender, projectile.hitbox.height))) {
                const owner = players[projectile.ownerId];
                if (owner) {
                    projectile.alreadyHit[defender.id] = true;
                    applyDamage(owner, defender, PROJECTILE_HITBOX);
                    projectile.lifeSpan = 0;
                }
            }
        });

        if (projectile.lifeSpan > 0) alive.push(projectile);
    });
    return alive;
}

export class FighterServer extends GameServer {
    private players: Record<string, FighterPlayer> = {};
    private projectiles: Projectile[] = [];
    private frame: number = 0;
    private accumulator: number = 0;
    private roundTime: number = ROUND_TIME;
    private phase: MatchPhase = 'COUNTDOWN';
    private countdownFrames: number = COUNTDOWN_FRAMES;
    private roundEndFrames: number = 0;
    private resultFrames: number = RESULT_FRAMES;
    private roundNumber: number = 1;
    private roundWinner: string | null = null;
    private matchWinner: string | null = null;

    init(playerBaseData: Record<string, Player>): void {
        const playerIds = Object.keys(playerBaseData).slice(0, 2);
        let index = 0;
        playerIds.forEach(id => {
            this.players[id] = initializeFighterPlayer(id, playerBaseData[id], index === 0);
            index++;
        });
        this.resetRound(false);
    }

    tick(incomingMessages: IncomingMsg[], dt: number): OutgoingMsg[] {
        this.processInputs(incomingMessages);

        this.accumulator += Math.min(dt, 0.08);
        let steps = 0;
        while (this.accumulator >= FRAME_DT && steps < 5) {
            this.stepFrame();
            this.accumulator -= FRAME_DT;
            steps++;
        }

        return [{ payload: this.snapshot() }];
    }

    isFinished(): boolean {
        return this.phase === 'RESULTS' && this.resultFrames <= 0;
    }

    private processInputs(incomingMessages: IncomingMsg[]): void {
        incomingMessages.forEach(message => {
            const player = this.players[message.clientId];
            if (!player || message.payload.kind !== 'move') return;

            player.inputMove = clamp(message.payload.moveDir || 0, -1, 1);
            player.inputJump = !!message.payload.jump;
            player.inputLight = !!message.payload.attackLight;
            player.inputHeavy = !!message.payload.attackHeavy;
            player.inputBlock = !!message.payload.block;
            player.inputCrouch = !!message.payload.crouch;
            player.inputDodge = !!message.payload.dodge;
        });
    }

    private stepFrame(): void {
        this.frame++;

        if (this.phase === 'COUNTDOWN') {
            this.countdownFrames--;
            if (this.countdownFrames <= 0) this.phase = 'ACTIVE';
            this.finishFrameInputs();
            return;
        }

        if (this.phase === 'ROUND_END') {
            this.roundEndFrames--;
            if (this.roundEndFrames <= 0) {
                if (this.matchWinner) this.phase = 'RESULTS';
                else this.resetRound(true);
            }
            this.finishFrameInputs();
            return;
        }

        if (this.phase === 'RESULTS') {
            this.resultFrames--;
            this.finishFrameInputs();
            return;
        }

        const playerList = Object.values(this.players);
        playerList.forEach(player => {
            const opponent = playerList.find(other => other.id !== player.id) || null;
            updatePlayerState(player, opponent, this.frame, projectile => this.projectiles.push(projectile));
        });
        playerList.forEach(updatePlayerPhysics);
        separatePushboxes(playerList);
        resolveMeleeCombat(playerList);
        this.projectiles = updateProjectiles(this.projectiles, this.players);

        this.roundTime = Math.max(0, this.roundTime - FRAME_DT);
        this.checkRoundEnd();
        this.finishFrameInputs();
    }

    private finishFrameInputs(): void {
        Object.values(this.players).forEach(player => {
            player.wasAttackLightPressed = player.inputLight;
            player.wasAttackHeavyPressed = player.inputHeavy;
            player.wasJumpPressed = player.inputJump;
            player.wasDodgePressed = player.inputDodge;
            syncPlayerAliases(player);
        });
    }

    private resetRound(advanceRound: boolean): void {
        const ids = Object.keys(this.players);
        ids.forEach((id, index) => {
            const existing = this.players[id];
            const roundsWon = existing.roundsWon;
            const totalDamageDealt = existing.totalDamageDealt;
            const maxCombo = existing.maxCombo;
            this.players[id] = initializeFighterPlayer(id, { name: existing.name, character: existing.character }, index === 0);
            this.players[id].roundsWon = roundsWon;
            this.players[id].totalDamageDealt = totalDamageDealt;
            this.players[id].maxCombo = maxCombo;
        });
        this.projectiles = [];
        this.roundTime = ROUND_TIME;
        this.phase = 'COUNTDOWN';
        this.countdownFrames = COUNTDOWN_FRAMES;
        this.roundEndFrames = 0;
        this.roundWinner = null;
        if (advanceRound) this.roundNumber++;
    }

    private checkRoundEnd(): void {
        if (this.phase !== 'ACTIVE') return;
        const ids = Object.keys(this.players);
        const defeated = ids.find(id => this.players[id].health <= 0);

        if (defeated) {
            const winner = ids.find(id => id !== defeated) || null;
            this.endRound(winner);
            return;
        }

        if (this.roundTime <= 0) {
            const sorted = ids.map(id => this.players[id]).sort((a, b) => b.health - a.health);
            const winner = sorted[0] && sorted[0].health > (sorted[1]?.health ?? -1) ? sorted[0].id : null;
            this.endRound(winner);
        }
    }

    private endRound(winner: string | null): void {
        this.phase = 'ROUND_END';
        this.roundEndFrames = ROUND_END_FRAMES;
        this.roundWinner = winner;
        if (winner && this.players[winner]) {
            this.players[winner].roundsWon++;
        }

        Object.values(this.players).forEach(player => {
            if (player.health <= 0) setState(player, 'KO', null);
        });

        const matchWinner = Object.values(this.players).find(player => player.roundsWon >= ROUNDS_TO_WIN);
        if (matchWinner) this.matchWinner = matchWinner.id;
    }

    private snapshot() {
        return {
            players: this.players,
            projectiles: this.projectiles,
            roundTime: this.roundTime,
            roundActive: this.phase === 'ACTIVE',
            phase: this.phase,
            countdown: Math.ceil(this.countdownFrames / FRAME_RATE),
            roundNumber: this.roundNumber,
            bestOf: BEST_OF_ROUNDS,
            roundWinner: this.roundWinner,
            winner: this.matchWinner || this.roundWinner,
            matchWinner: this.matchWinner
        };
    }
}

export class FighterClient extends GameClient {
    private players: Record<string, FighterPlayer> | null = null;
    private projectiles: Projectile[] = [];
    private animations: Record<string, AnimationManager> = {};
    private roundTime: number = ROUND_TIME;
    private roundActive: boolean = false;
    private phase: MatchPhase = 'COUNTDOWN';
    private countdown: number = 3;
    private roundNumber: number = 1;
    private roundWinner: string | null = null;
    private matchWinner: string | null = null;
    private gameOverTimer: number = 0;

    private fighterInput: UserInputFighterExtended;

    constructor(userInput: UserInput, myId: string) {
        const fighterInput = userInput instanceof UserInputFighterExtended
            ? userInput
            : new UserInputFighterExtended(userInput.canvas);

        super(fighterInput, myId);
        this.fighterInput = fighterInput;
    }

    async init(playerBaseData: Record<string, Player>): Promise<void> {
        const playerIds = Object.keys(playerBaseData).slice(0, 2);
        this.players = {};
        playerIds.forEach((id, index) => {
            this.players![id] = initializeFighterPlayer(id, playerBaseData[id], index === 0);
            this.animations[id] = createDefaultFighterAnimationManager();
        });
    }

    draw(ctx: CanvasRenderingContext2D, dt: number): void {
        if (!this.players) return;

        const { screenW, screenH } = this.fighterInput;

        ctx.save();
        ctx.translate(screenW / 2, screenH / 2);
        ctx.scale(screenW / 2, screenH / 2);
        this.drawStage(ctx);
        this.drawProjectiles(ctx);
        Object.values(this.players).forEach(player => this.drawPlayer(ctx, player, dt));
        ctx.restore();

        this.drawUI(ctx, screenW, screenH);
        this.drawRoundInfo(ctx, screenW, screenH, dt);
    }

    handleMessage(message: any): void {
        if (!this.players) return;
        const payload = message.payload || message;

        if (payload.players) {
            Object.keys(payload.players).forEach(id => {
                if (!this.players![id]) {
                    this.players![id] = payload.players[id];
                    this.animations[id] = createDefaultFighterAnimationManager();
                } else {
                    Object.assign(this.players![id], payload.players[id]);
                }
            });
        }

        if (payload.projectiles) this.projectiles = payload.projectiles;
        if (payload.roundTime !== undefined) this.roundTime = payload.roundTime;
        if (payload.roundActive !== undefined) this.roundActive = payload.roundActive;
        if (payload.phase !== undefined) this.phase = payload.phase;
        if (payload.countdown !== undefined) this.countdown = payload.countdown;
        if (payload.roundNumber !== undefined) this.roundNumber = payload.roundNumber;
        if (payload.roundWinner !== undefined) this.roundWinner = payload.roundWinner;
        if (payload.matchWinner !== undefined) this.matchWinner = payload.matchWinner;
    }

    flushMessages(): any[] {
        return [{
            kind: 'move',
            moveDir: this.fighterInput.moveDirectionX,
            jump: this.fighterInput.jump,
            attackLight: this.fighterInput.attackLight,
            attackHeavy: this.fighterInput.attackHeavy,
            block: this.fighterInput.block,
            crouch: this.fighterInput.moveDirectionY > 0,
            dodge: this.fighterInput.dodge
        }];
    }

    isFinished(): boolean {
        return this.phase === 'RESULTS' && this.matchWinner !== null && this.gameOverTimer > 4;
    }

    private drawStage(ctx: CanvasRenderingContext2D): void {
        const gradient = ctx.createLinearGradient(0, -1, 0, 1);
        gradient.addColorStop(0, '#101032');
        gradient.addColorStop(0.55, '#231544');
        gradient.addColorStop(1, '#151515');
        ctx.fillStyle = gradient;
        ctx.fillRect(-1, -1, 2, 2);

        ctx.fillStyle = '#38323d';
        ctx.fillRect(-1, GROUND_Y, 2, 1 - GROUND_Y);

        ctx.strokeStyle = 'rgba(255,255,255,0.12)';
        ctx.lineWidth = 0.006;
        for (let x = -1; x <= 1; x += 0.1) {
            ctx.beginPath();
            ctx.moveTo(x, GROUND_Y);
            ctx.lineTo(x - 0.25, 1);
            ctx.stroke();
        }
    }

    private drawProjectiles(ctx: CanvasRenderingContext2D): void {
        this.projectiles.forEach(projectile => {
            ctx.save();
            ctx.translate(projectile.x, projectile.y);
            const pulse = 1 + 0.12 * Math.sin(Date.now() / 45);
            ctx.scale(pulse, pulse);
            ctx.fillStyle = '#55d6ff';
            ctx.beginPath();
            ctx.arc(0, 0, 0.055, 0, Math.PI * 2);
            ctx.fill();
            ctx.strokeStyle = '#ffffff';
            ctx.lineWidth = 0.008;
            ctx.stroke();
            ctx.restore();
        });
    }

    private drawPlayer(ctx: CanvasRenderingContext2D, player: FighterPlayer, dt: number): void {
        const animation = this.animations[player.id] || createDefaultFighterAnimationManager();
        this.animations[player.id] = animation;
        animation.setState(player.state);
        animation.flipSprite(player.facingRight ? 'right' : 'left');
        animation.updateAnimation(dt);
        player.currentAnimationFrame = animation.currentAnimationFrame;

        ctx.save();

        const drawPerson = getCharacterDrawFunction(player.character);
        const characterCenterX = player.x + PLAYER_W / 2;
        const crouchScale = player.state === 'CROUCHING' || player.inputCrouch ? 0.58 : 1;
        const characterH = PLAYER_H * crouchScale;
        const characterCenterY = player.y - characterH / 2;

        ctx.beginPath();
        ctx.ellipse(player.x + PLAYER_W / 2, GROUND_Y, PLAYER_W / 2, 0.03, 0, 0, Math.PI * 2);
        ctx.fillStyle = 'rgba(0,0,0,0.35)';
        ctx.fill();

        ctx.save();
        ctx.translate(characterCenterX, characterCenterY);
        if (!player.facingRight) ctx.scale(-1, 1);
        const flash = player.damageFlashTimer > 0 && Math.floor(player.damageFlashTimer / 2) % 2 === 0;
        const alpha = animation.poseData?.opacity ?? 1;
        ctx.globalAlpha = alpha;

        // Apply animation pose transformations
        if (animation.poseData) {
            const pose = animation.poseData;
            ctx.rotate((pose.bodyTilt * Math.PI) / 180 * 0.3);
        }

        drawPerson(ctx, 0, 0, PLAYER_W, characterH, flash ? { skinColor: '#ffffff', magicColor: '#ffffff' } : {});
        this.drawPoseEffects(ctx, player, animation.poseData);
        ctx.restore();

        ctx.save();
        ctx.translate(characterCenterX, characterCenterY);

        if (player.isBlocking) {
            ctx.strokeStyle = '#9b59ff';
            ctx.lineWidth = 0.012;
            ctx.strokeRect(-PLAYER_W / 2 - 0.02, -characterH / 2 - 0.02, PLAYER_W + 0.04, characterH + 0.04);
        }

        if (player.invulnerabilityFrames > 0) {
            ctx.strokeStyle = '#8df7ff';
            ctx.lineWidth = 0.008;
            ctx.beginPath();
            ctx.ellipse(0, 0, PLAYER_W * 0.75, characterH * 0.55, 0, 0, Math.PI * 2);
            ctx.stroke();
        }

        ctx.restore();

        ctx.restore();
    }

    private drawPoseEffects(ctx: CanvasRenderingContext2D, player: FighterPlayer, poseData?: any): void {
        if (player.state === 'ATTACKING_LIGHT') {
            ctx.fillStyle = '#f1c40f';
            const direction = poseData?.armSide === 'front' ? 1 : -1;
            ctx.fillRect(PLAYER_W * (0.2 + direction * 0.3), -PLAYER_H * 0.2, PLAYER_W * 0.5, PLAYER_H * 0.08);
        }
        if (player.state === 'ATTACKING_HEAVY' || player.state === 'SPECIAL') {
            ctx.fillStyle = '#e74c3c';
            const direction = poseData?.armSide === 'front' ? 1 : -1;
            ctx.fillRect(PLAYER_W * (0.15 + direction * 0.4), -PLAYER_H * 0.24, PLAYER_W * 0.7, PLAYER_H * 0.12);
        }
        if (player.state === 'ATTACKING_SWEEP') {
            ctx.fillStyle = '#f39c12';
            ctx.fillRect(0, PLAYER_H * 0.12, PLAYER_W, PLAYER_H * 0.06);
        }
        if (player.state === 'ATTACKING_AERIAL') {
            ctx.fillStyle = '#3498db';
            const direction = poseData?.armSide === 'front' ? 1 : -1;
            ctx.fillRect(PLAYER_W * (0.1 + direction * 0.25), -PLAYER_H * 0.3, PLAYER_W * 0.4, PLAYER_H * 0.1);
        }
        if (player.state === 'CHARGING') {
            ctx.strokeStyle = '#ffef5a';
            ctx.lineWidth = 0.008;
            ctx.beginPath();
            ctx.arc(0, 0, PLAYER_W * (0.8 + player.attackCharge / 180), 0, Math.PI * 2);
            ctx.stroke();
        }
    }

    private drawUI(ctx: CanvasRenderingContext2D, w: number, h: number): void {
        if (!this.players) return;
        const ids = Object.keys(this.players);
        const margin = 50;
        const barWidth = w * 0.28;
        const barHeight = 34;

        ids.forEach((id, index) => {
            const player = this.players![id];
            const isLeft = index === 0;
            const x = isLeft ? margin : w - margin - barWidth;
            const y = 42;
            const alignX = isLeft ? x : x + barWidth;

            ctx.font = 'bold 28px Impact';
            ctx.fillStyle = 'white';
            ctx.textAlign = isLeft ? 'left' : 'right';
            ctx.fillText(player.name.toUpperCase(), alignX, y - 12);

            ctx.fillStyle = '#333';
            ctx.fillRect(x, y, barWidth, barHeight);

            const hpPercent = Math.max(0, player.health / player.maxHealth);
            const hpWidth = hpPercent * barWidth;
            ctx.fillStyle = player.health > 55 ? '#27ae60' : player.health > 25 ? '#f1c40f' : '#c0392b';
            if (isLeft) ctx.fillRect(x, y, hpWidth, barHeight);
            else ctx.fillRect(x + (barWidth - hpWidth), y, hpWidth, barHeight);

            ctx.strokeStyle = 'white';
            ctx.lineWidth = 3;
            ctx.strokeRect(x, y, barWidth, barHeight);

            const meterY = y + barHeight + 10;
            ctx.fillStyle = '#1d2635';
            ctx.fillRect(x, meterY, barWidth, 12);
            const meterWidth = (player.superMeter / 100) * barWidth;
            ctx.fillStyle = '#3498db';
            if (isLeft) ctx.fillRect(x, meterY, meterWidth, 12);
            else ctx.fillRect(x + (barWidth - meterWidth), meterY, meterWidth, 12);

            ctx.fillStyle = 'white';
            ctx.font = 'bold 18px Arial';
            ctx.textAlign = 'center';
            ctx.fillText(`${Math.ceil(player.health)}`, x + barWidth / 2, y + 24);

            ctx.font = 'bold 22px Arial';
            ctx.fillText('●'.repeat(player.roundsWon) + '○'.repeat(Math.max(0, ROUNDS_TO_WIN - player.roundsWon)), x + barWidth / 2, meterY + 36);

            if (player.comboCount >= 2 && player.comboTimer > 0) {
                ctx.font = 'bold 34px Impact';
                ctx.fillStyle = '#ffef5a';
                ctx.textAlign = isLeft ? 'left' : 'right';
                ctx.fillText(`${player.comboCount} COMBO!`, alignX, 150);
            }
        });

        ctx.font = 'bold 42px Impact';
        ctx.fillStyle = '#c0392b';
        ctx.textAlign = 'center';
        ctx.fillText('VS', w / 2, 76);

        ctx.font = 'bold 22px Arial';
        ctx.fillStyle = 'white';
        ctx.fillText(`Round ${this.roundNumber}`, w / 2, 146);
    }

    private drawRoundInfo(ctx: CanvasRenderingContext2D, w: number, h: number, dt: number): void {
        ctx.font = 'bold 42px Arial';
        ctx.fillStyle = this.roundTime > 10 ? '#ffffff' : '#c0392b';
        ctx.textAlign = 'center';
        ctx.fillText(`${Math.ceil(Math.max(0, this.roundTime))}`, w / 2, 120);

        if (this.phase === 'COUNTDOWN') {
            ctx.fillStyle = 'rgba(0,0,0,0.35)';
            ctx.fillRect(0, 0, w, h);
            ctx.font = 'bold 110px Impact';
            ctx.fillStyle = '#ffffff';
            ctx.fillText(this.countdown > 0 ? `${this.countdown}` : 'FIGHT', w / 2, h / 2);
        }

        if (this.phase === 'ROUND_END' && this.roundWinner) {
            const winnerName = this.players?.[this.roundWinner]?.name ?? 'Player';
            ctx.fillStyle = 'rgba(0,0,0,0.45)';
            ctx.fillRect(0, 0, w, h);
            ctx.font = 'bold 70px Impact';
            ctx.fillStyle = '#ffef5a';
            ctx.fillText(`${winnerName} wins the round`, w / 2, h / 2);
        }

        if (this.phase === 'RESULTS' && this.matchWinner) {
            this.gameOverTimer += dt;
            const winnerText = this.matchWinner === this.myId ? 'YOU WIN!' : 'YOU LOSE!';
            const winnerName = this.players?.[this.matchWinner]?.name ?? 'Player';
            ctx.fillStyle = 'rgba(0,0,0,0.78)';
            ctx.fillRect(0, 0, w, h);
            ctx.font = 'bold 84px Impact';
            ctx.fillStyle = this.matchWinner === this.myId ? '#27ae60' : '#c0392b';
            ctx.fillText(winnerText, w / 2, h / 2 - 110);
            ctx.font = 'bold 34px Arial';
            ctx.fillStyle = 'white';
            ctx.fillText(`${winnerName} wins the match`, w / 2, h / 2 - 58);

            const rows = Object.values(this.players ?? {}).map(p => `${p.name}: ${p.totalDamageDealt} dmg | max combo ${p.maxCombo}`);
            ctx.font = '24px Arial';
            rows.forEach((row, index) => ctx.fillText(row, w / 2, h / 2 + index * 34));
        } else if (this.phase !== 'RESULTS') {
            this.gameOverTimer = 0;
        }

        this.drawControls(ctx, w, h);
    }

    private drawControls(ctx: CanvasRenderingContext2D, w: number, h: number): void {
        ctx.font = '16px Arial';
        ctx.fillStyle = 'rgba(255,255,255,0.72)';
        ctx.textAlign = 'center';
        ctx.fillText('A/D move | S crouch | Space jump/double jump | E light/special | hold R heavy | Q block | F/Shift dodge', w / 2, h - 24);
    }
}
