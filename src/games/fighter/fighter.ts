// Street-fighter inspired 1v1 game.
// Flat, deterministic, no enterprise patterns.

import { Player, Rectangle } from '../../common';
import type { IncomingMsg, OutgoingMsg } from '../../server';
import { GameClient, GameServer } from '../game';
import { UserInput } from '../../client/user-input';
import { getCharacterDrawFunction } from '../../client/characters';
import { AnimationManager, createDefaultFighterAnimationManager } from './fighter-animation';

// ─── Constants ───────────────────────────────────────────────────────────────

const FRAME_RATE       = 60;
const FRAME_DT         = 1 / FRAME_RATE;
const PLAYER_W         = 0.15;
const PLAYER_H         = 0.5;
const GROUND_Y         = 0.75;

const MAX_HEALTH       = 100;
const ROUND_TIME       = 99;
const ROUNDS_TO_WIN    = 2;
const BEST_OF_ROUNDS   = 3;
const COUNTDOWN_FRAMES = 180;
const ROUND_END_FRAMES = 150;
const RESULT_FRAMES    = 300;

const MAX_WALK_SPEED   = 0.78;
const ACCELERATION     = 5.6;
const AIR_ACCELERATION = 2.1;
const FRICTION         = 7.0;
const GRAVITY          = 5.0;
const FAST_FALL        = 1.5;
const JUMP_FORCE       = 1.8;
const DOUBLE_JUMP_MULT = 0.7;

const DASH_FRAMES      = 14;
const DASH_SPEED       = 0.38 / (DASH_FRAMES / FRAME_RATE);
const DOUBLE_TAP_WIN   = 14;

const DODGE_FRAMES     = 24;
const DODGE_IFRAMES    = 18;
const DODGE_COOLDOWN   = 52;
const DODGE_SPEED      = 1.0;

const BLOCKSTUN        = 8;
const COMBO_TIMEOUT    = 90;
const INPUT_BUFFER     = 15;

// ─── Types ────────────────────────────────────────────────────────────────────

export type PlayerState = 'IDLE' | 'MOVE' | 'JUMP' | 'ATTACK' | 'BLOCK' | 'HIT' | 'KO'
    | 'CROUCHING' | 'DASHING' | 'DODGING' | 'CHARGING' | 'KNOCKDOWN';

export type AttackType = 'LIGHT' | 'HEAVY' | 'AERIAL' | 'SWEEP' | 'PROJECTILE';
export type AttackHeight = 'HIGH' | 'MID' | 'LOW';
type MatchPhase = 'COUNTDOWN' | 'ACTIVE' | 'ROUND_END' | 'RESULTS';

export interface FighterPlayer {
    id: string;
    name: string;
    character: string;

    health: number;
    superMeter: number;

    x: number;
    y: number;
    vx: number;
    vy: number;
    facing: 'left' | 'right';
    isGrounded: boolean;

    state: PlayerState;
    stateFrame: number;
    jumpCount: number;

    attackType: AttackType | null;
    attackTimer: number;
    attackCharge: number;
    hitstun: number;
    blockstun: number;
    knockbackX: number;
    knockdownFrames: number;
    invFrames: number;
    hitstopFrames: number;
    dodgeCooldown: number;
    alreadyHit: Record<string, boolean>;
    blockHeight: AttackHeight;
    isBlocking: boolean;

    inputMove: number;
    inputJump: boolean;
    inputLight: boolean;
    inputHeavy: boolean;
    inputBlock: boolean;
    inputCrouch: boolean;
    inputDodge: boolean;
    prevLight: boolean;
    prevHeavy: boolean;
    prevJump: boolean;
    prevDodge: boolean;
    lastMoveTapFrame: Record<string, number>;
    inputQueue: string[];

    currentAnimationFrame: number;
    animationTimer: number;
    damageFlashTimer: number;

    roundsWon: number;
    comboCount: number;
    maxCombo: number;
    comboTimer: number;
    totalDamageDealt: number;
}

interface AttackDef {
    x: number; y: number; w: number; h: number;
    damage: number;
    height: AttackHeight;
    startFrame: number;
    endFrame: number;
    totalFrames: number;
    knockback: number;
    hitstun: number;
    blockstun: number;
    hitstop: number;
    causesKnockdown?: boolean;
}

export interface Projectile {
    id: string;
    ownerId: string;
    x: number;
    y: number;
    vx: number;
    lifeSpan: number;
    alreadyHit: Record<string, boolean>;
}

// ─── Attack Definitions ───────────────────────────────────────────────────────

const ATTACK_LIGHT: AttackDef = {
    x: 0.13, y: -0.29, w: 0.10, h: 0.12,
    damage: 5, height: 'MID', startFrame: 4, endFrame: 7, totalFrames: 16,
    knockback: 0.28, hitstun: 10, blockstun: BLOCKSTUN, hitstop: 3
};
const ATTACK_HEAVY: AttackDef = {
    x: 0.17, y: -0.28, w: 0.14, h: 0.16,
    damage: 12, height: 'MID', startFrame: 9, endFrame: 16, totalFrames: 30,
    knockback: 0.58, hitstun: 17, blockstun: BLOCKSTUN + 3, hitstop: 5
};
const ATTACK_AERIAL: AttackDef = {
    x: 0.10, y: -0.08, w: 0.12, h: 0.20,
    damage: 8, height: 'HIGH', startFrame: 5, endFrame: 14, totalFrames: 22,
    knockback: 0.38, hitstun: 13, blockstun: BLOCKSTUN, hitstop: 3
};
const ATTACK_SWEEP: AttackDef = {
    x: 0.14, y: -0.08, w: 0.17, h: 0.10,
    damage: 9, height: 'LOW', startFrame: 8, endFrame: 15, totalFrames: 28,
    knockback: 0.45, hitstun: 14, blockstun: BLOCKSTUN + 1, hitstop: 5,
    causesKnockdown: true
};
const ATTACK_UPPERCUT: AttackDef = {
    x: 0.09, y: -0.33, w: 0.14, h: 0.28,
    damage: 14, height: 'MID', startFrame: 4, endFrame: 13, totalFrames: 34,
    knockback: 0.50, hitstun: 19, blockstun: BLOCKSTUN + 4, hitstop: 5
};
const ATTACK_PROJECTILE: AttackDef = {
    x: 0, y: 0, w: 0.11, h: 0.11,
    damage: 8, height: 'MID', startFrame: 0, endFrame: 90, totalFrames: 90,
    knockback: 0.35, hitstun: 13, blockstun: BLOCKSTUN, hitstop: 3
};

function getAttackDef(player: FighterPlayer): AttackDef | null {
    switch (player.attackType) {
        case 'LIGHT':      return ATTACK_LIGHT;
        case 'HEAVY':      return ATTACK_HEAVY;
        case 'AERIAL':     return ATTACK_AERIAL;
        case 'SWEEP':      return ATTACK_SWEEP;
        case 'PROJECTILE': return ATTACK_UPPERCUT; // shoryuken uses HEAVY slot via PROJECTILE state
        default:           return null;
    }
}

// ─── Input ────────────────────────────────────────────────────────────────────

export class UserInputFighterExtended extends UserInput {
    public jump: boolean = false;
    public attackLight: boolean = false;
    public attackHeavy: boolean = false;
    public block: boolean = false;
    public dodge: boolean = false;

    // Simple special move tracking: remember last few inputs
    public inputSequence: string[] = [];
    private lastInputTime: number = 0;
    private _up = false; private _down = false;
    private _left = false; private _right = false;

    constructor(canvas: HTMLCanvasElement) {
        super(canvas);
        this.setupListeners();
    }

    private setupListeners(): void {
        document.addEventListener('keydown', e => {
            if (e.repeat) return;
            if (e.code === 'KeyW') { this._up = true; this.recordDir(); }
            else if (e.code === 'KeyA') { this._left = true; this.recordDir(); }
            else if (e.code === 'KeyS') { this._down = true; this.recordDir(); }
            else if (e.code === 'KeyD') { this._right = true; this.recordDir(); }
            else if (e.code === 'Space') { e.preventDefault(); this.jump = true; }
            else if (e.code === 'KeyE') { this.attackLight = true; this.record('A'); }
            else if (e.code === 'KeyR') { this.attackHeavy = true; this.record('B'); }
            else if (e.code === 'KeyQ') { this.block = true; }
            else if (e.code === 'KeyF' || e.code.startsWith('Shift')) { this.dodge = true; }
        });
        document.addEventListener('keyup', e => {
            if (e.code === 'KeyW') this._up = false;
            else if (e.code === 'KeyA') this._left = false;
            else if (e.code === 'KeyS') this._down = false;
            else if (e.code === 'KeyD') this._right = false;
            else if (e.code === 'Space') this.jump = false;
            else if (e.code === 'KeyE') this.attackLight = false;
            else if (e.code === 'KeyR') this.attackHeavy = false;
            else if (e.code === 'KeyQ') this.block = false;
            else if (e.code === 'KeyF' || e.code.startsWith('Shift')) this.dodge = false;
        });
        window.addEventListener('blur', () => {
            this.jump = this.attackLight = this.attackHeavy = this.block = this.dodge = false;
        });
    }

    private recordDir(): void {
        let d = '';
        if (this._down && this._right) d = '3';
        else if (this._down && this._left) d = '1';
        else if (this._up && this._right) d = '9';
        else if (this._up && this._left) d = '7';
        else if (this._right) d = '6';
        else if (this._left) d = '4';
        else if (this._down) d = '2';
        else if (this._up) d = '8';
        if (d) this.record(d);
    }

    private record(input: string): void {
        const now = Date.now();
        if (now - this.lastInputTime > 600) this.inputSequence = [];
        this.lastInputTime = now;
        if (this.inputSequence[this.inputSequence.length - 1] !== input) {
            this.inputSequence.push(input);
            if (this.inputSequence.length > 10) this.inputSequence.shift();
        }
    }

    // Check if last N inputs match a pattern like "236A"
    public checkSequence(pattern: string): boolean {
        const tail = this.inputSequence.slice(-pattern.length).join('');
        return tail === pattern;
    }

    public clearSequence(): void { this.inputSequence = []; }
}

// ─── Player Factory ───────────────────────────────────────────────────────────

function createPlayer(id: string, base: Player, isPlayer1: boolean): FighterPlayer {
    const x = isPlayer1 ? -0.65 : 0.65 - PLAYER_W;
    return {
        id, name: base.name, character: base.character,
        health: MAX_HEALTH, superMeter: 0,
        x, y: GROUND_Y, vx: 0, vy: 0,
        facing: isPlayer1 ? 'right' : 'left',
        isGrounded: true,
        state: 'IDLE', stateFrame: 0, jumpCount: 0,
        attackType: null, attackTimer: 0, attackCharge: 0,
        hitstun: 0, blockstun: 0, knockbackX: 0,
        knockdownFrames: 0, invFrames: 0, hitstopFrames: 0,
        dodgeCooldown: 0, alreadyHit: {},
        blockHeight: 'MID', isBlocking: false,
        inputMove: 0, inputJump: false, inputLight: false, inputHeavy: false,
        inputBlock: false, inputCrouch: false, inputDodge: false,
        prevLight: false, prevHeavy: false, prevJump: false, prevDodge: false,
        lastMoveTapFrame: {}, inputQueue: [],
        currentAnimationFrame: 0, animationTimer: 0, damageFlashTimer: 0,
        roundsWon: 0, comboCount: 0, maxCombo: 0, comboTimer: 0, totalDamageDealt: 0
    };
}

// ─── State helpers ────────────────────────────────────────────────────────────

function setState(player: FighterPlayer, state: PlayerState, attackType: AttackType | null = null): void {
    if (player.state !== state) {
        player.stateFrame = 0;
        player.alreadyHit = {};
    }
    player.state = state;
    player.attackType = attackType;
}

function isAttacking(player: FighterPlayer): boolean {
    return player.state === 'ATTACK';
}

function canAct(player: FighterPlayer): boolean {
    return player.state !== 'KO'
        && player.hitstun <= 0
        && player.blockstun <= 0
        && player.knockdownFrames <= 0
        && player.hitstopFrames <= 0
        && !isAttacking(player)
        && player.state !== 'DASHING'
        && player.state !== 'DODGING';
}

function clamp(v: number, lo: number, hi: number): number {
    return v < lo ? lo : v > hi ? hi : v;
}

// ─── Collision / Hitbox helpers ───────────────────────────────────────────────

function aabb(a: Rectangle, b: Rectangle): boolean {
    return a.x < b.x + b.w && a.x + a.w > b.x && a.y < b.y + b.h && a.y + a.h > b.y;
}

function hitboxRect(player: FighterPlayer, atk: AttackDef): Rectangle {
    const dir = player.facing === 'right' ? 1 : -1;
    return {
        x: player.x + 0.075 + atk.x * dir - atk.w / 2,
        y: player.y + atk.y - atk.h / 2,
        w: atk.w, h: atk.h
    };
}

function hurtbox(player: FighterPlayer, height: AttackHeight = 'MID'): Rectangle {
    const crouch = player.inputCrouch || player.state === 'CROUCHING' ? 0.55 : 1;
    const h = PLAYER_H * crouch;
    const top = player.y - h;
    if (height === 'HIGH') return { x: player.x, y: top,              w: PLAYER_W, h: h * 0.38 };
    if (height === 'LOW')  return { x: player.x, y: player.y - h * 0.35, w: PLAYER_W, h: h * 0.35 };
    return { x: player.x, y: top + h * 0.22, w: PLAYER_W, h: h * 0.58 };
}

function pushbox(player: FighterPlayer): Rectangle {
    const h = player.inputCrouch || player.state === 'CROUCHING' ? 0.28 : 0.46;
    return { x: player.x + 0.025, y: player.y - h, w: 0.1, h };
}

// ─── Special move detection ───────────────────────────────────────────────────
// Queue stores direction tokens ("2","3","6") and button tokens ("A","B").
// Hadoken: down, down-forward, forward + light  →  "236A"
// Shoryuken: forward, down, down-forward + light → "623A"

function appendToQueue(player: FighterPlayer, token: string): void {
    if (player.inputQueue[player.inputQueue.length - 1] !== token) {
        player.inputQueue.push(token);
        if (player.inputQueue.length > INPUT_BUFFER) player.inputQueue.shift();
    }
}

function updateInputQueue(player: FighterPlayer): void {
    // Direction
    const fwd = player.facing === 'right' ? 1 : -1;
    const move = player.inputMove * fwd;
    let dir = '5';
    if (player.inputCrouch && move > 0) dir = '3';
    else if (player.inputCrouch && move < 0) dir = '1';
    else if (player.inputCrouch) dir = '2';
    else if (move > 0) dir = '6';
    else if (move < 0) dir = '4';
    appendToQueue(player, dir);

    if (player.inputLight && !player.prevLight) appendToQueue(player, 'A');
    if (player.inputHeavy && !player.prevHeavy) appendToQueue(player, 'B');
}

function matchSequence(queue: string[], pattern: string): boolean {
    const needed = pattern.split('');
    let qi = queue.length - 1;
    for (let pi = needed.length - 1; pi >= 0 && qi >= 0; qi--) {
        if (queue[qi] === needed[pi]) pi--;
    }
    return true; // if we exit the inner loop naturally, all matched
    // Actually need proper logic:
}

function detectSpecial(player: FighterPlayer, pattern: string): boolean {
    const tokens = pattern.split('');
    let ti = tokens.length - 1;
    for (let qi = player.inputQueue.length - 1; qi >= 0 && ti >= 0; qi--) {
        if (player.inputQueue[qi] === tokens[ti]) ti--;
    }
    return ti < 0;
}

// ─── Combat actions ───────────────────────────────────────────────────────────

function startAttack(player: FighterPlayer, type: AttackType): void {
    setState(player, 'ATTACK', type);
    const def = getAttackDef(player);
    player.attackTimer = def ? def.totalFrames : 20;
}

function startUppercut(player: FighterPlayer): void {
    setState(player, 'ATTACK', 'PROJECTILE'); // reuse PROJECTILE slot for shoryuken
    player.attackTimer = ATTACK_UPPERCUT.totalFrames;
    player.invFrames = 6;
    player.vy = -JUMP_FORCE * 0.45;
    player.jumpCount = Math.max(player.jumpCount, 1);
}

function spawnProjectile(owner: FighterPlayer, frame: number): Projectile {
    const dir = owner.facing === 'right' ? 1 : -1;
    return {
        id: `${owner.id}-${frame}-${Math.random().toString(36).slice(2, 7)}`,
        ownerId: owner.id,
        x: owner.x + PLAYER_W / 2 + dir * 0.17,
        y: owner.y - PLAYER_H * 0.42,
        vx: dir * 0.95,
        lifeSpan: 90,
        alreadyHit: {}
    };
}

function tryDash(player: FighterPlayer, frame: number): boolean {
    const p = player as FighterPlayer & { _lastMove?: number; _dashDir?: number };
    const prev = p._lastMove ?? 0;
    p._lastMove = player.inputMove;

    if (player.inputMove === 0 || prev !== 0 || !canAct(player) || player.inputCrouch) return false;

    const key = player.inputMove > 0 ? 'right' : 'left';
    const last = player.lastMoveTapFrame[key] ?? -999;
    player.lastMoveTapFrame[key] = frame;

    if (frame - last <= DOUBLE_TAP_WIN) {
        p._dashDir = player.inputMove;
        setState(player, 'DASHING');
        player.vx = player.inputMove * DASH_SPEED;
        return true;
    }
    return false;
}

function tryDodge(player: FighterPlayer): boolean {
    if (!player.inputDodge || player.prevDodge || !canAct(player) || player.dodgeCooldown > 0) return false;
    const dir = player.inputMove !== 0 ? player.inputMove : (player.facing === 'right' ? 1 : -1);
    setState(player, 'DODGING');
    player.invFrames = DODGE_IFRAMES;
    player.dodgeCooldown = DODGE_COOLDOWN;
    player.vx = dir * DODGE_SPEED;
    return true;
}

// ─── Player update ────────────────────────────────────────────────────────────

function updatePlayer(
    player: FighterPlayer,
    opponent: FighterPlayer | null,
    frame: number,
    onProjectile: (p: Projectile) => void
): void {
    updateInputQueue(player);

    if (player.state === 'KO') return;

    // Timers
    if (player.damageFlashTimer > 0) player.damageFlashTimer--;
    if (player.comboTimer > 0) player.comboTimer--; else player.comboCount = 0;
    if (player.dodgeCooldown > 0) player.dodgeCooldown--;
    if (player.invFrames > 0) player.invFrames--;

    if (player.hitstopFrames > 0) { player.hitstopFrames--; return; }

    player.stateFrame++;

    if (player.hitstun > 0) {
        player.hitstun--;
        setState(player, 'HIT');
        return;
    }
    if (player.knockdownFrames > 0) {
        player.knockdownFrames--;
        setState(player, 'KNOCKDOWN');
        return;
    }
    if (player.blockstun > 0) {
        player.blockstun--;
        setState(player, 'BLOCK');
        return;
    }

    if (player.state === 'ATTACK') {
        const def = getAttackDef(player);
        if (def && player.stateFrame > def.totalFrames) {
            player.attackCharge = 0;
            setState(player, player.isGrounded ? 'IDLE' : 'JUMP');
        }
        return;
    }

    if (player.state === 'DASHING') {
        if (player.stateFrame >= DASH_FRAMES) setState(player, player.isGrounded ? 'IDLE' : 'JUMP');
        return;
    }
    if (player.state === 'DODGING') {
        if (player.stateFrame >= DODGE_FRAMES) setState(player, player.isGrounded ? 'IDLE' : 'JUMP');
        return;
    }
    if (player.state === 'CHARGING') {
        if (player.inputHeavy) { player.attackCharge = clamp(player.attackCharge + 4, 0, 100); return; }
        startAttack(player, 'HEAVY');
        return;
    }

    // Auto-face opponent
    if (opponent) {
        player.facing = opponent.x + PLAYER_W / 2 >= player.x + PLAYER_W / 2 ? 'right' : 'left';
    }

    if (tryDash(player, frame)) return;
    if (tryDodge(player)) return;

    const lightPressed = player.inputLight && !player.prevLight;
    const heavyPressed = player.inputHeavy && !player.prevHeavy;
    const jumpPressed  = player.inputJump  && !player.prevJump;

    if (jumpPressed && player.jumpCount < 2) {
        player.vy = player.jumpCount === 0 ? -JUMP_FORCE : -JUMP_FORCE * DOUBLE_JUMP_MULT;
        player.jumpCount++;
        player.isGrounded = false;
        setState(player, 'JUMP');
        return;
    }

    if (lightPressed && canAct(player)) {
        // Shoryuken: forward, down, down-forward + light
        if (detectSpecial(player, '623A')) { startUppercut(player); player.inputQueue = []; return; }
        // Hadoken: down, down-forward, forward + light
        if (detectSpecial(player, '236A')) {
            setState(player, 'ATTACK', 'PROJECTILE');
            player.attackTimer = 22;
            onProjectile(spawnProjectile(player, frame));
            player.inputQueue = [];
            return;
        }
        startAttack(player, player.isGrounded ? 'LIGHT' : 'AERIAL');
        return;
    }

    if (heavyPressed && canAct(player)) {
        if (player.inputCrouch && player.isGrounded) startAttack(player, 'SWEEP');
        else if (player.isGrounded) setState(player, 'CHARGING');
        else startAttack(player, 'AERIAL');
        return;
    }

    if (player.inputBlock && player.isGrounded && canAct(player)) {
        player.isBlocking = true;
        player.blockHeight = player.inputCrouch ? 'LOW' : 'MID';
        setState(player, 'BLOCK');
        return;
    }
    player.isBlocking = false;

    if (player.inputCrouch && player.isGrounded && canAct(player)) {
        setState(player, 'CROUCHING');
        return;
    }

    if (!player.isGrounded) setState(player, 'JUMP');
    else if (Math.abs(player.vx) > 0.04 || player.inputMove !== 0) setState(player, 'MOVE');
    else setState(player, 'IDLE');
}

// ─── Physics ──────────────────────────────────────────────────────────────────

function updatePhysics(player: FighterPlayer): void {
    if (player.state === 'KO' || player.hitstopFrames > 0) return;

    // Knockback decays
    if (player.knockbackX !== 0) {
        player.vx = player.knockbackX;
        const decay = FRICTION * 0.35 * FRAME_DT;
        player.knockbackX = Math.abs(player.knockbackX) <= decay ? 0
            : player.knockbackX > 0 ? player.knockbackX - decay : player.knockbackX + decay;
    }

    const locked = player.inputCrouch || player.state === 'BLOCK' || player.state === 'CHARGING'
        || isAttacking(player) || player.hitstun > 0 || player.blockstun > 0 || player.knockdownFrames > 0;

    if (player.state === 'DASHING' || player.state === 'DODGING') {
        // Slow down naturally during dash/dodge
        const decay = FRICTION * 0.18 * FRAME_DT;
        player.vx = Math.abs(player.vx) <= decay ? 0 : player.vx > 0 ? player.vx - decay : player.vx + decay;
    } else if (!locked) {
        const accel = player.isGrounded ? ACCELERATION : AIR_ACCELERATION;
        if (player.inputMove !== 0) {
            player.vx = clamp(player.vx + player.inputMove * accel * FRAME_DT, -MAX_WALK_SPEED, MAX_WALK_SPEED);
        } else {
            const dec = FRICTION * FRAME_DT;
            player.vx = Math.abs(player.vx) <= dec ? 0 : player.vx > 0 ? player.vx - dec : player.vx + dec;
        }
    } else if (player.isGrounded && player.knockbackX === 0) {
        const dec = FRICTION * FRAME_DT;
        player.vx = Math.abs(player.vx) <= dec ? 0 : player.vx > 0 ? player.vx - dec : player.vx + dec;
    }

    if (!player.isGrounded) {
        player.vy += GRAVITY * (player.vy > 0 ? FAST_FALL : 1) * FRAME_DT;
    }

    player.x += player.vx * FRAME_DT;
    player.y += player.vy * FRAME_DT;

    if (player.y >= GROUND_Y) {
        player.y = GROUND_Y;
        if (player.vy > 0) player.vy = 0;
        player.isGrounded = true;
        player.jumpCount = 0;
        if (player.state === 'JUMP') setState(player, Math.abs(player.vx) > 0.04 ? 'MOVE' : 'IDLE');
    } else {
        player.isGrounded = false;
    }

    player.x = clamp(player.x, -1, 1 - PLAYER_W);
}

function separatePlayers(players: FighterPlayer[]): void {
    if (players.length < 2) return;
    const a = players[0], b = players[1];
    const pa = pushbox(a), pb = pushbox(b);
    if (!aabb(pa, pb)) return;

    const overlap = Math.min(pa.x + pa.w - pb.x, pb.x + pb.w - pa.x) / 2 + 0.001;
    if (a.x < b.x) { a.x -= overlap; b.x += overlap; }
    else            { a.x += overlap; b.x -= overlap; }
    a.x = clamp(a.x, -1, 1 - PLAYER_W);
    b.x = clamp(b.x, -1, 1 - PLAYER_W);
}

// ─── Combat resolution ────────────────────────────────────────────────────────

function applyHit(attacker: FighterPlayer, defender: FighterPlayer, atk: AttackDef): void {
    if (defender.state === 'KO' || defender.invFrames > 0) return;
    if (attacker.alreadyHit[defender.id]) return;
    attacker.alreadyHit[defender.id] = true;

    // Block check
    const blocked = defender.isBlocking
        && (atk.height !== 'LOW' || defender.blockHeight === 'LOW');

    const damage = blocked ? Math.max(1, Math.floor(atk.damage * 0.2)) : atk.damage;
    defender.health = Math.max(0, defender.health - damage);
    defender.damageFlashTimer = blocked ? 8 : 18;
    defender.hitstopFrames = atk.hitstop;
    attacker.hitstopFrames = atk.hitstop;
    attacker.superMeter = clamp(attacker.superMeter + damage * 1.8, 0, 100);
    defender.superMeter = clamp(defender.superMeter + damage * 0.8, 0, 100);
    attacker.totalDamageDealt += damage;

    if (blocked) {
        defender.blockstun = atk.blockstun;
        setState(defender, 'BLOCK');
    } else {
        defender.hitstun = atk.hitstun;
        defender.knockbackX = atk.knockback * (defender.x > attacker.x ? 1 : -1);
        if (atk.causesKnockdown) defender.knockdownFrames = 60;
        setState(defender, atk.causesKnockdown ? 'KNOCKDOWN' : 'HIT');

        attacker.comboCount = attacker.comboTimer > 0 ? attacker.comboCount + 1 : 1;
        attacker.comboTimer = COMBO_TIMEOUT;
        attacker.maxCombo = Math.max(attacker.maxCombo, attacker.comboCount);
    }
}

function resolveCombat(players: FighterPlayer[]): void {
    if (players.length < 2) return;
    const [a, b] = players;

    const getStrike = (p: FighterPlayer) => {
        const def = getAttackDef(p);
        if (!def) return null;
        if (p.stateFrame < def.startFrame || p.stateFrame > def.endFrame) return null;
        // Scale heavy attack by charge
        if (p.attackType === 'HEAVY' && p.attackCharge > 0) {
            const m = 1 + Math.min(1, p.attackCharge / 100);
            return { rect: hitboxRect(p, def), def: { ...def, damage: Math.round(def.damage * m), knockback: def.knockback * m } };
        }
        return { rect: hitboxRect(p, def), def };
    };

    const sa = getStrike(a);
    const sb = getStrike(b);

    if (sa) if (!sb || !aabb(sa.rect, sb.rect)) {
        if (aabb(sa.rect, hurtbox(b, sa.def.height))) applyHit(a, b, sa.def);
    }
    if (sb) if (!sa || !aabb(sb.rect, sa.rect)) {
        if (aabb(sb.rect, hurtbox(a, sb.def.height))) applyHit(b, a, sb.def);
    }
}

function updateProjectiles(projectiles: Projectile[], players: Record<string, FighterPlayer>): Projectile[] {
    return projectiles.filter(proj => {
        proj.x += proj.vx * FRAME_DT;
        proj.lifeSpan--;
        if (proj.lifeSpan <= 0 || proj.x < -1.2 || proj.x > 1.2) return false;

        const pr = {
            x: proj.x - ATTACK_PROJECTILE.w / 2,
            y: proj.y - ATTACK_PROJECTILE.h / 2,
            w: ATTACK_PROJECTILE.w,
            h: ATTACK_PROJECTILE.h
        };
        for (const defender of Object.values(players)) {
            if (defender.id === proj.ownerId || proj.alreadyHit[defender.id]) continue;
            if (aabb(pr, hurtbox(defender, 'MID'))) {
                const owner = players[proj.ownerId];
                if (owner) { proj.alreadyHit[defender.id] = true; applyHit(owner, defender, ATTACK_PROJECTILE); }
                return false;
            }
        }
        return true;
    });
}

// ─── Server ───────────────────────────────────────────────────────────────────

export class FighterServer extends GameServer {
    private players: Record<string, FighterPlayer> = {};
    private projectiles: Projectile[] = [];
    private frame = 0;
    private accumulator = 0;
    private roundTime = ROUND_TIME;
    private phase: MatchPhase = 'COUNTDOWN';
    private countdownFrames = COUNTDOWN_FRAMES;
    private roundEndFrames = 0;
    private resultFrames = RESULT_FRAMES;
    private roundNumber = 1;
    private roundWinner: string | null = null;
    private matchWinner: string | null = null;

    init(playerBaseData: Record<string, Player>): void {
        Object.keys(playerBaseData).slice(0, 2).forEach((id, i) => {
            this.players[id] = createPlayer(id, playerBaseData[id], i === 0);
        });
        this.resetRound(false);
    }

    tick(msgs: IncomingMsg[], dt: number): OutgoingMsg[] {
        msgs.forEach(msg => {
            const p = this.players[msg.clientId];
            if (!p || msg.payload.kind !== 'move') return;
            p.inputMove   = clamp(msg.payload.moveDir || 0, -1, 1);
            p.inputJump   = !!msg.payload.jump;
            p.inputLight  = !!msg.payload.attackLight;
            p.inputHeavy  = !!msg.payload.attackHeavy;
            p.inputBlock  = !!msg.payload.block;
            p.inputCrouch = !!msg.payload.crouch;
            p.inputDodge  = !!msg.payload.dodge;
        });

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

    private stepFrame(): void {
        this.frame++;

        if (this.phase === 'COUNTDOWN') {
            if (--this.countdownFrames <= 0) this.phase = 'ACTIVE';
            this.endFrameInputs();
            return;
        }
        if (this.phase === 'ROUND_END') {
            if (--this.roundEndFrames <= 0) {
                if (this.matchWinner) this.phase = 'RESULTS';
                else this.resetRound(true);
            }
            this.endFrameInputs();
            return;
        }
        if (this.phase === 'RESULTS') {
            this.resultFrames--;
            this.endFrameInputs();
            return;
        }

        const list = Object.values(this.players);
        list.forEach(p => {
            const opp = list.find(o => o.id !== p.id) ?? null;
            updatePlayer(p, opp, this.frame, proj => this.projectiles.push(proj));
        });
        list.forEach(updatePhysics);
        separatePlayers(list);
        resolveCombat(list);
        this.projectiles = updateProjectiles(this.projectiles, this.players);

        this.roundTime = Math.max(0, this.roundTime - FRAME_DT);
        this.checkRoundEnd();
        this.endFrameInputs();
    }

    private endFrameInputs(): void {
        Object.values(this.players).forEach(p => {
            p.prevLight = p.inputLight;
            p.prevHeavy = p.inputHeavy;
            p.prevJump  = p.inputJump;
            p.prevDodge = p.inputDodge;
        });
    }

    private resetRound(advance: boolean): void {
        Object.keys(this.players).forEach((id, i) => {
            const old = this.players[id];
            this.players[id] = createPlayer(id, { name: old.name, character: old.character }, i === 0);
            this.players[id].roundsWon       = old.roundsWon;
            this.players[id].totalDamageDealt = old.totalDamageDealt;
            this.players[id].maxCombo        = old.maxCombo;
        });
        this.projectiles      = [];
        this.roundTime        = ROUND_TIME;
        this.phase            = 'COUNTDOWN';
        this.countdownFrames  = COUNTDOWN_FRAMES;
        this.roundEndFrames   = 0;
        this.roundWinner      = null;
        if (advance) this.roundNumber++;
    }

    private checkRoundEnd(): void {
        if (this.phase !== 'ACTIVE') return;
        const ids = Object.keys(this.players);
        const dead = ids.find(id => this.players[id].health <= 0);

        if (dead) {
            this.endRound(ids.find(id => id !== dead) ?? null);
            return;
        }
        if (this.roundTime <= 0) {
            const [first, second] = ids.map(id => this.players[id]).sort((a, b) => b.health - a.health);
            this.endRound(first.health > (second?.health ?? -1) ? first.id : null);
        }
    }

    private endRound(winner: string | null): void {
        this.phase          = 'ROUND_END';
        this.roundEndFrames = ROUND_END_FRAMES;
        this.roundWinner    = winner;
        if (winner && this.players[winner]) this.players[winner].roundsWon++;
        Object.values(this.players).forEach(p => { if (p.health <= 0) setState(p, 'KO'); });
        const champ = Object.values(this.players).find(p => p.roundsWon >= ROUNDS_TO_WIN);
        if (champ) this.matchWinner = champ.id;
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
            winner: this.matchWinner ?? this.roundWinner,
            matchWinner: this.matchWinner
        };
    }
}

// ─── Client ───────────────────────────────────────────────────────────────────

export class FighterClient extends GameClient {
    private players: Record<string, FighterPlayer> | null = null;
    private projectiles: Projectile[] = [];
    private animations: Record<string, AnimationManager> = {};
    private roundTime = ROUND_TIME;
    private phase: MatchPhase = 'COUNTDOWN';
    private countdown = 3;
    private roundNumber = 1;
    private roundWinner: string | null = null;
    private matchWinner: string | null = null;
    private gameOverTimer = 0;
    private input: UserInputFighterExtended;

    constructor(userInput: UserInput, myId: string) {
        const fi = userInput instanceof UserInputFighterExtended
            ? userInput
            : new UserInputFighterExtended(userInput.canvas);
        super(fi, myId);
        this.input = fi;
    }

    async init(playerBaseData: Record<string, Player>): Promise<void> {
        this.players = {};
        Object.keys(playerBaseData).slice(0, 2).forEach((id, i) => {
            this.players![id] = createPlayer(id, playerBaseData[id], i === 0);
            this.animations[id] = createDefaultFighterAnimationManager();
        });
    }

    draw(ctx: CanvasRenderingContext2D, dt: number): void {
        if (!this.players) return;
        const { screenW, screenH } = this.input;

        ctx.save();
        ctx.translate(screenW / 2, screenH / 2);
        ctx.scale(screenW / 2, screenH / 2);
        this.drawStage(ctx);
        this.drawProjectiles(ctx);
        Object.values(this.players).forEach(p => this.drawPlayer(ctx, p, dt));
        ctx.restore();

        this.drawUI(ctx, screenW, screenH);
        this.drawRoundInfo(ctx, screenW, screenH, dt);
    }

    handleMessage(message: any): void {
        if (!this.players) return;
        const payload = message.payload ?? message;

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

        if (payload.projectiles !== undefined) this.projectiles  = payload.projectiles;
        if (payload.roundTime   !== undefined) this.roundTime    = payload.roundTime;
        if (payload.phase       !== undefined) this.phase        = payload.phase;
        if (payload.countdown   !== undefined) this.countdown    = payload.countdown;
        if (payload.roundNumber !== undefined) this.roundNumber  = payload.roundNumber;
        if (payload.roundWinner !== undefined) this.roundWinner  = payload.roundWinner;
        if (payload.matchWinner !== undefined) this.matchWinner  = payload.matchWinner;
    }

    flushMessages(): any[] {
        return [{
            kind: 'move',
            moveDir:      this.input.moveDirectionX,
            jump:         this.input.jump,
            attackLight:  this.input.attackLight,
            attackHeavy:  this.input.attackHeavy,
            block:        this.input.block,
            crouch:       this.input.moveDirectionY > 0,
            dodge:        this.input.dodge
        }];
    }

    isFinished(): boolean {
        return this.phase === 'RESULTS' && this.matchWinner !== null && this.gameOverTimer > 4;
    }

    private drawStage(ctx: CanvasRenderingContext2D): void {
        const grad = ctx.createLinearGradient(0, -1, 0, 1);
        grad.addColorStop(0,    '#101032');
        grad.addColorStop(0.55, '#231544');
        grad.addColorStop(1,    '#151515');
        ctx.fillStyle = grad;
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
        this.projectiles.forEach(p => {
            ctx.save();
            ctx.translate(p.x, p.y);
            ctx.scale(1 + 0.12 * Math.sin(Date.now() / 45), 1 + 0.12 * Math.sin(Date.now() / 45));
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
        const anim = this.animations[player.id] ?? createDefaultFighterAnimationManager();
        this.animations[player.id] = anim;
        anim.setState(player.state);
        anim.flipSprite(player.facing);
        anim.updateAnimation(dt);
        player.currentAnimationFrame = anim.currentAnimationFrame;

        const drawPerson = getCharacterDrawFunction(player.character);
        const cx = player.x + PLAYER_W / 2;
        const crouchScale = player.state === 'CROUCHING' || player.inputCrouch ? 0.58 : 1;
        const ch = PLAYER_H * crouchScale;
        const cy = player.y - ch / 2;

        ctx.save();
        // Shadow
        ctx.beginPath();
        ctx.ellipse(cx, GROUND_Y, PLAYER_W / 2, 0.03, 0, 0, Math.PI * 2);
        ctx.fillStyle = 'rgba(0,0,0,0.35)';
        ctx.fill();

        // Character
        ctx.save();
        ctx.translate(cx, cy);
        if (player.facing === 'left') ctx.scale(-1, 1);
        if (anim.poseData) ctx.rotate((anim.poseData.bodyTilt * Math.PI) / 180 * 0.3);
        ctx.globalAlpha = anim.poseData?.opacity ?? 1;

        const flash = player.damageFlashTimer > 0 && Math.floor(player.damageFlashTimer / 2) % 2 === 0;
        drawPerson(ctx, 0, 0, PLAYER_W, ch, flash ? { skinColor: '#ffffff', magicColor: '#ffffff' } : {});
        this.drawAttackEffect(ctx, player, anim.poseData);
        ctx.restore();

        // Block/invuln overlays
        ctx.save();
        ctx.translate(cx, cy);
        if (player.isBlocking) {
            ctx.strokeStyle = '#9b59ff';
            ctx.lineWidth = 0.012;
            ctx.strokeRect(-PLAYER_W / 2 - 0.02, -ch / 2 - 0.02, PLAYER_W + 0.04, ch + 0.04);
        }
        if (player.invFrames > 0) {
            ctx.strokeStyle = '#8df7ff';
            ctx.lineWidth = 0.008;
            ctx.beginPath();
            ctx.ellipse(0, 0, PLAYER_W * 0.75, ch * 0.55, 0, 0, Math.PI * 2);
            ctx.stroke();
        }
        ctx.restore();

        ctx.restore();
    }

    private drawAttackEffect(ctx: CanvasRenderingContext2D, player: FighterPlayer, pose?: any): void {
        const side = pose?.armSide === 'front' ? 1 : -1;
        switch (player.attackType) {
            case 'LIGHT':
                ctx.fillStyle = '#f1c40f';
                ctx.fillRect(PLAYER_W * (0.2 + side * 0.3), -PLAYER_H * 0.2, PLAYER_W * 0.5, PLAYER_H * 0.08);
                break;
            case 'HEAVY':
            case 'PROJECTILE': // shoryuken reuses PROJECTILE slot
                ctx.fillStyle = '#e74c3c';
                ctx.fillRect(PLAYER_W * (0.15 + side * 0.4), -PLAYER_H * 0.24, PLAYER_W * 0.7, PLAYER_H * 0.12);
                break;
            case 'SWEEP':
                ctx.fillStyle = '#f39c12';
                ctx.fillRect(0, PLAYER_H * 0.12, PLAYER_W, PLAYER_H * 0.06);
                break;
            case 'AERIAL':
                ctx.fillStyle = '#3498db';
                ctx.fillRect(PLAYER_W * (0.1 + side * 0.25), -PLAYER_H * 0.3, PLAYER_W * 0.4, PLAYER_H * 0.1);
                break;
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
        const margin = 50, barW = w * 0.28, barH = 34;

        ids.forEach((id, i) => {
            const p = this.players![id];
            const left = i === 0;
            const x = left ? margin : w - margin - barW;
            const y = 42;
            const ax = left ? x : x + barW;

            ctx.font = 'bold 28px Impact';
            ctx.fillStyle = 'white';
            ctx.textAlign = left ? 'left' : 'right';
            ctx.fillText(p.name.toUpperCase(), ax, y - 12);

            // HP bar
            ctx.fillStyle = '#333';
            ctx.fillRect(x, y, barW, barH);
            const hpW = Math.max(0, p.health / MAX_HEALTH) * barW;
            ctx.fillStyle = p.health > 55 ? '#27ae60' : p.health > 25 ? '#f1c40f' : '#c0392b';
            ctx.fillRect(left ? x : x + barW - hpW, y, hpW, barH);
            ctx.strokeStyle = 'white';
            ctx.lineWidth = 3;
            ctx.strokeRect(x, y, barW, barH);

            // HP number
            ctx.fillStyle = 'white';
            ctx.font = 'bold 18px Arial';
            ctx.textAlign = 'center';
            ctx.fillText(`${Math.ceil(p.health)}`, x + barW / 2, y + 24);

            // Super meter
            const my = y + barH + 10;
            ctx.fillStyle = '#1d2635';
            ctx.fillRect(x, my, barW, 12);
            const meterW = (p.superMeter / 100) * barW;
            ctx.fillStyle = '#3498db';
            ctx.fillRect(left ? x : x + barW - meterW, my, meterW, 12);

            // Round wins
            ctx.font = 'bold 22px Arial';
            ctx.fillText(
                '●'.repeat(p.roundsWon) + '○'.repeat(Math.max(0, ROUNDS_TO_WIN - p.roundsWon)),
                x + barW / 2, my + 36
            );

            // Combo
            if (p.comboCount >= 2 && p.comboTimer > 0) {
                ctx.font = 'bold 34px Impact';
                ctx.fillStyle = '#ffef5a';
                ctx.textAlign = left ? 'left' : 'right';
                ctx.fillText(`${p.comboCount} COMBO!`, ax, 150);
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
            const name = this.players?.[this.roundWinner]?.name ?? 'Player';
            ctx.fillStyle = 'rgba(0,0,0,0.45)';
            ctx.fillRect(0, 0, w, h);
            ctx.font = 'bold 70px Impact';
            ctx.fillStyle = '#ffef5a';
            ctx.fillText(`${name} wins the round`, w / 2, h / 2);
        }

        if (this.phase === 'RESULTS' && this.matchWinner) {
            this.gameOverTimer += dt;
            const winner = this.players?.[this.matchWinner]?.name ?? 'Player';
            ctx.fillStyle = 'rgba(0,0,0,0.78)';
            ctx.fillRect(0, 0, w, h);
            ctx.font = 'bold 84px Impact';
            ctx.fillStyle = this.matchWinner === this.myId ? '#27ae60' : '#c0392b';
            ctx.fillText(this.matchWinner === this.myId ? 'YOU WIN!' : 'YOU LOSE!', w / 2, h / 2 - 110);
            ctx.font = 'bold 34px Arial';
            ctx.fillStyle = 'white';
            ctx.fillText(`${winner} wins the match`, w / 2, h / 2 - 58);
            ctx.font = '24px Arial';
            Object.values(this.players ?? {}).forEach((p, i) => {
                ctx.fillText(`${p.name}: ${p.totalDamageDealt} dmg | max combo ${p.maxCombo}`, w / 2, h / 2 + i * 34);
            });
        } else if (this.phase !== 'RESULTS') {
            this.gameOverTimer = 0;
        }

        ctx.font = '16px Arial';
        ctx.fillStyle = 'rgba(255,255,255,0.72)';
        ctx.textAlign = 'center';
        ctx.fillText('A/D move | S crouch | Space jump/double jump | E light/special | hold R heavy | Q block | F/Shift dodge', w / 2, h - 24);
    }
}
