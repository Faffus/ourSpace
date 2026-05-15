/**
 * HEAD BALL ONLINE
 * Autore: Indie Dark
 * Data: 14 Maggio 2026
 *
 * Gioco multiplayer Head Ball (1v1) adattato al framework ourSpace.
 * Esporta HeadBallServer (estende GameServer) e HeadBallClient (estende GameClient).
 */

import { getCollisionSide } from '../common';
import { IncomingMsg, OutgoingMsg } from '../server';
import { GameClient, GameServer } from './game';
import { UserInput } from '../client/user-input';

// ============================================================================
// COSTANTI FISICHE
// ============================================================================

const CANVAS_WIDTH          = 1000;
const CANVAS_HEIGHT         = 500;
const GROUND_Y              = 348;
const GOAL_LINE_X           = 75;
const GOAL_TOP_Y            = 72;
const GOAL_FRAME_THICKNESS  = 10;
const GOAL_POST_THICKNESS   = 10;

const PLAYER_W              = 68;
const PLAYER_H              = 96;
const BALL_RADIUS           = 22;

const PLAYER_SPEED          = 390;
const PLAYER_JUMP_SPEED     = -1180;
const PLAYER_GRAVITY        = 3600;

const BALL_GRAVITY          = 1900;
const BALL_SIDE_BOUNCE      = 0.88;
const BALL_TOP_BOUNCE       = 0.98;
const BALL_GROUND_BOUNCE    = 0.82;
const BALL_FRICTION         = 0.988;
const BALL_STOP_THRESHOLD   = 18;
const BALL_KICKOFF_SPEED    = 320;
const BALL_KICKOFF_LIFT     = -480;

const TELEPORT_DISTANCE     = 50;
const TELEPORT_COOLDOWN_MS  = 15000;

const COUNTDOWN_DURATION_MS = 3000;
const MATCH_DURATION_MS     = 90000;

const DEFAULT_CHARACTER     = 'classic';
const ALLOWED_CHARACTERS    = new Set(['classic', 'wizard', 'ninja']);

const CHARACTER_DEFS = [
    { id: 'classic', name: 'Classic', accent: '#00d8ff', jersey: '#006dff', trim: '#f7fdff' },
    { id: 'wizard',  name: 'Wizard',  accent: '#ffcf33', jersey: '#8b5cf6', trim: '#ffe680' },
    { id: 'ninja',   name: 'Ninja',   accent: '#28ff88', jersey: '#00a84f', trim: '#edfff5' }
];

// ============================================================================
// TIPI
// ============================================================================

type Seat = 0 | 1;

type PlayerInputState = {
    moveX: number;
    jump: boolean;
    teleport: boolean;
};

type SelectionState = {
    characterId: string;
    confirmed: boolean;
};

type BallState = {
    x: number; y: number; vx: number; vy: number;
};

type PlayerState = {
    seat: Seat;
    characterId: string;
    x: number; y: number; vx: number; vy: number;
    w: number; h: number;
    direction: number;
    onGround: boolean;
    jumpWasHeld: boolean;
    doubleJumpUsed: boolean;
    teleportWasHeld: boolean;
    teleportCooldownMs: number;
    input: PlayerInputState;
};

type HeadBallPhase = 'waiting' | 'selection' | 'countdown' | 'playing' | 'finished';

// ============================================================================
// UTILITY
// ============================================================================

function clamp(v: number, lo: number, hi: number): number {
    return Math.max(lo, Math.min(hi, v));
}

function normalizeCharId(id: unknown): string {
    if (typeof id !== 'string' || !ALLOWED_CHARACTERS.has(id.trim())) return DEFAULT_CHARACTER;
    return id.trim();
}

function createInput(): PlayerInputState {
    return { moveX: 0, jump: false, teleport: false };
}

function createBall(kickDir: number = 0): BallState {
    return {
        x: CANVAS_WIDTH / 2,
        y: GROUND_Y - 160,
        vx: BALL_KICKOFF_SPEED * kickDir,
        vy: kickDir !== 0 ? BALL_KICKOFF_LIFT : 0
    };
}

function createPlayer(seat: Seat, characterId: string): PlayerState {
    const x = seat === 0 ? 110 : CANVAS_WIDTH - 110 - PLAYER_W;
    return {
        seat, characterId,
        x, y: GROUND_Y - PLAYER_H,
        vx: 0, vy: 0,
        w: PLAYER_W, h: PLAYER_H,
        direction: seat === 0 ? 1 : -1,
        onGround: true,
        jumpWasHeld: false,
        doubleJumpUsed: false,
        teleportWasHeld: false,
        teleportCooldownMs: 0,
        input: createInput()
    };
}

// ============================================================================
// COLLISIONI
// ============================================================================

function resolveBallVsRect(ball: BallState, rect: { x: number; y: number; w: number; h: number }): boolean {
    const br = { x: ball.x - BALL_RADIUS, y: ball.y - BALL_RADIUS, w: BALL_RADIUS * 2, h: BALL_RADIUS * 2 };
    const side = getCollisionSide(br, rect);
    if (side === 'none') return false;
    if (side === 'top')    { ball.y = rect.y - BALL_RADIUS;           ball.vy = -Math.abs(ball.vy) * BALL_TOP_BOUNCE; }
    if (side === 'bottom') { ball.y = rect.y + rect.h + BALL_RADIUS;  ball.vy =  Math.abs(ball.vy) * BALL_TOP_BOUNCE; }
    if (side === 'left')   { ball.x = rect.x - BALL_RADIUS;           ball.vx = -Math.abs(ball.vx) * BALL_SIDE_BOUNCE; }
    if (side === 'right')  { ball.x = rect.x + rect.w + BALL_RADIUS;  ball.vx =  Math.abs(ball.vx) * BALL_SIDE_BOUNCE; }
    return true;
}

function resolveBallPlayerCollision(ball: BallState, player: PlayerState): void {
    const headR   = player.w * 0.48;
    const headCX  = player.x + player.w / 2;
    const headCY  = player.y + player.h * 0.26;
    const dxH = ball.x - headCX, dyH = ball.y - headCY;
    const distH   = Math.sqrt(dxH * dxH + dyH * dyH);
    const hitHead = distH < headR + BALL_RADIUS;

    const footR   = player.w * 0.20;
    const footCX  = player.x + player.w / 2;
    const footCY  = player.y + player.h * 0.88;
    const dxF = ball.x - footCX, dyF = ball.y - footCY;
    const distF   = Math.sqrt(dxF * dxF + dyF * dyF);
    const hitFoot = distF < footR + BALL_RADIUS;

    if (!hitHead && !hitFoot) return;

    const dir   = player.seat === 0 ? 1 : -1;
    const speed = Math.sqrt(ball.vx * ball.vx + ball.vy * ball.vy);

    if (hitHead) {
        const s  = Math.max(distH, 0.001);
        const nx = dxH / s, ny = dyH / s;
        const sp = clamp(Math.max(560, speed), 560, 880);
        ball.vx  = clamp(nx * sp * 0.50 + dir * 0.18 * sp + player.vx * 0.15, -700, 700);
        ball.vy  = clamp(Math.min(ny * sp * 0.50 + (ny < -0.3 ? -920 : -800), -640), -1050, -640);
        const pen = (headR + BALL_RADIUS) - distH;
        ball.x += nx * pen; ball.y += ny * pen;
    } else {
        const s  = Math.max(distF, 0.001);
        const nx = dxF / s, ny = dyF / s;
        const sp = clamp(Math.max(600, speed * 1.15), 600, 1000);
        ball.vx  = clamp(nx * sp * 0.90 + dir * sp * 0.25 + player.vx * 0.25, -1000, 1000);
        ball.vy  = clamp(Math.min(ny * sp * 0.5 - 480, -350), -850, -350);
        const pen = (footR + BALL_RADIUS) - distF;
        ball.x += nx * pen; ball.y += ny * pen;
    }
}

function resolveGoalFrameCollision(ball: BallState, goalX: number, isLeft: boolean): void {
    const goalH    = GROUND_Y - GOAL_TOP_Y;
    const backPostX = isLeft ? goalX : goalX + GOAL_LINE_X - GOAL_POST_THICKNESS;
    resolveBallVsRect(ball, { x: backPostX, y: GOAL_TOP_Y, w: GOAL_POST_THICKNESS, h: goalH });
    resolveBallVsRect(ball, { x: goalX, y: GOAL_TOP_Y, w: GOAL_LINE_X, h: GOAL_FRAME_THICKNESS });
}

// ============================================================================
// SERVER
// ============================================================================

export class HeadBallServer extends GameServer {

    private phase: HeadBallPhase = 'waiting';
    private players: Record<string, PlayerState> = {};
    private playerOrder: string[] = []; // [seat0_id, seat1_id]
    private selections: [SelectionState, SelectionState] = [
        { characterId: DEFAULT_CHARACTER, confirmed: false },
        { characterId: DEFAULT_CHARACTER, confirmed: false }
    ];
    private ball: BallState = createBall();
    private score = { left: 0, right: 0 };
    private timeLeftMs  = MATCH_DURATION_MS;
    private countdownMs = COUNTDOWN_DURATION_MS;
    private winner: 'left' | 'right' | 'draw' | null = null;
    private teleportCooldowns: [number, number] = [0, 0];

    init(players: Record<string, any>): void {
        this.playerOrder = Object.keys(players);
        this.phase = 'selection';

        this.playerOrder.forEach((id, index) => {
            const seat = index as Seat;
            this.players[id] = createPlayer(seat, DEFAULT_CHARACTER);
            this.players[id].input = createInput();
        });

        this.ball = createBall();
        this.score = { left: 0, right: 0 };
        this.winner = null;
        this.selections = [
            { characterId: DEFAULT_CHARACTER, confirmed: false },
            { characterId: DEFAULT_CHARACTER, confirmed: false }
        ];
    }

    tick(incomingMessages: IncomingMsg[], dtSec: number): OutgoingMsg[] {
        // Processa i messaggi in arrivo
        for (const msg of incomingMessages) {
            const id  = msg.clientId;
            const pay = msg.payload;
            const player = this.players[id];
            if (!player) continue;
            const seat = player.seat;

            if (pay.kind === 'input' && this.phase === 'playing') {
                player.input = {
                    moveX:    typeof pay.moveX    === 'number'  ? clamp(pay.moveX, -1, 1) : player.input.moveX,
                    jump:     typeof pay.jump     === 'boolean' ? pay.jump     : player.input.jump,
                    teleport: typeof pay.teleport === 'boolean' ? pay.teleport : player.input.teleport
                };
            }

            if (pay.kind === 'selection:update' && this.phase === 'selection') {
                if (!this.selections[seat].confirmed) {
                    this.selections[seat].characterId = normalizeCharId(pay.characterId);
                }
            }

            if (pay.kind === 'selection:confirm' && this.phase === 'selection') {
                if (!this.selections[seat].confirmed) {
                    this.selections[seat].characterId = normalizeCharId(pay.characterId ?? this.selections[seat].characterId);
                    this.selections[seat].confirmed   = true;
                }
                // Se entrambi hanno confermato, avvia countdown
                if (this.selections[0].confirmed && this.selections[1].confirmed) {
                    this.startCountdown();
                }
            }
        }

        // Aggiorna lo stato in base alla fase
        if (this.phase === 'countdown') {
            this.countdownMs -= dtSec * 1000;
            if (this.countdownMs <= 0) this.beginPlaying();
        }

        if (this.phase === 'playing') {
            this.timeLeftMs -= dtSec * 1000;
            if (this.timeLeftMs <= 0) {
                this.finishGame();
            } else {
                this.updatePhysics(dtSec);
            }
        }

        return [{ payload: this.buildSnapshot() }]; // nessun clientId = broadcast a tutti
    }

    isFinished(): boolean {
        return this.phase === 'finished';
    }

    // ── Transizioni di fase ─────────────────────────────────────────────────

    private startCountdown(): void {
        this.phase       = 'countdown';
        this.countdownMs = COUNTDOWN_DURATION_MS;
        this.score       = { left: 0, right: 0 };
        this.winner      = null;
        this.ball        = createBall();
        this.playerOrder.forEach((id, i) => {
            const char = this.selections[i as Seat].characterId;
            this.players[id] = createPlayer(i as Seat, char);
        });
    }

    private beginPlaying(): void {
        this.phase      = 'playing';
        this.timeLeftMs = MATCH_DURATION_MS;
        const dir = Math.random() < 0.5 ? -1 : 1;
        this.ball = createBall(dir);
        this.playerOrder.forEach((id, i) => {
            const char = this.selections[i as Seat].characterId;
            this.players[id] = createPlayer(i as Seat, char);
        });
    }

    private resetAfterGoal(scoringSeat: Seat): void {
        const kickDir = scoringSeat === 0 ? -1 : 1;
        this.ball = createBall(kickDir);
        this.playerOrder.forEach((id, i) => {
            const char = this.selections[i as Seat].characterId;
            this.players[id] = createPlayer(i as Seat, char);
        });
    }

    private finishGame(): void {
        this.phase  = 'finished';
        this.winner = this.score.left > this.score.right ? 'left'
                    : this.score.right > this.score.left ? 'right'
                    : 'draw';
    }

    // ── Fisica ──────────────────────────────────────────────────────────────

    private updatePhysics(dt: number): void {
        const seats: Seat[] = [0, 1];

        // Giocatori
        seats.forEach(seat => {
            const id = this.playerOrder[seat];
            if (!id) return;
            const p = this.players[id];
            this.handlePlayerInput(p, seat, dt);

            p.vy += PLAYER_GRAVITY * dt;
            p.x  += p.vx * dt;
            p.y  += p.vy * dt;

            const maxY = GROUND_Y - p.h;
            if (p.y >= maxY) { p.y = maxY; p.vy = 0; p.onGround = true; p.doubleJumpUsed = false; }
            else              { p.onGround = false; }
            if (p.y < 0) { p.y = 0; if (p.vy < 0) p.vy = 0; }

            const minX = GOAL_LINE_X, maxX = CANVAS_WIDTH - GOAL_LINE_X - p.w;
            if (p.x < minX) { p.x = minX; p.vx = 0; }
            if (p.x > maxX) { p.x = maxX; p.vx = 0; }
        });

        // Palla
        const ball = this.ball;
        ball.vy += BALL_GRAVITY * dt;
        ball.x  += ball.vx * dt;
        ball.y  += ball.vy * dt;

        const inGoalHeight = ball.y - BALL_RADIUS > GOAL_TOP_Y + GOAL_FRAME_THICKNESS
                          && ball.y + BALL_RADIUS < GROUND_Y;

        if (ball.x + BALL_RADIUS < GOAL_LINE_X && inGoalHeight) {
            this.score.right += 1;
            this.resetAfterGoal(1);
            return;
        }
        if (ball.x - BALL_RADIUS > CANVAS_WIDTH - GOAL_LINE_X && inGoalHeight) {
            this.score.left += 1;
            this.resetAfterGoal(0);
            return;
        }

        if (ball.x - BALL_RADIUS <= 0 && !inGoalHeight) { ball.x = BALL_RADIUS; ball.vx *= -BALL_SIDE_BOUNCE; }
        if (ball.x + BALL_RADIUS >= CANVAS_WIDTH && !inGoalHeight) { ball.x = CANVAS_WIDTH - BALL_RADIUS; ball.vx *= -BALL_SIDE_BOUNCE; }
        if (ball.y - BALL_RADIUS <= 0) { ball.y = BALL_RADIUS; ball.vy *= -BALL_TOP_BOUNCE; }
        if (ball.y + BALL_RADIUS >= GROUND_Y) {
            ball.y   = GROUND_Y - BALL_RADIUS;
            ball.vy *= -BALL_GROUND_BOUNCE;
            if (Math.abs(ball.vy) < BALL_STOP_THRESHOLD) ball.vy = 0;
            ball.vx *= Math.pow(BALL_FRICTION, dt * 60);
        }

        seats.forEach(seat => {
            const id = this.playerOrder[seat];
            if (id) resolveBallPlayerCollision(ball, this.players[id]);
        });
        resolveGoalFrameCollision(ball, 0, true);
        resolveGoalFrameCollision(ball, CANVAS_WIDTH - GOAL_LINE_X, false);
    }

    private handlePlayerInput(p: PlayerState, seat: Seat, dt: number): void {
        const inp = p.input;
        p.vx = inp.moveX * PLAYER_SPEED;
        if (inp.moveX !== 0) p.direction = inp.moveX > 0 ? 1 : -1;

        if (inp.jump && !p.jumpWasHeld) {
            if (p.onGround) { p.vy = PLAYER_JUMP_SPEED; p.onGround = false; p.doubleJumpUsed = false; }
            else if (!p.doubleJumpUsed) { p.vy = PLAYER_JUMP_SPEED; p.doubleJumpUsed = true; }
        }
        p.jumpWasHeld = inp.jump;

        this.teleportCooldowns[seat] = Math.max(0, this.teleportCooldowns[seat] - dt * 1000);
        if (inp.teleport && !p.teleportWasHeld && this.teleportCooldowns[seat] <= 0) {
            const ball   = this.ball;
            const offset = TELEPORT_DISTANCE + BALL_RADIUS + p.w / 2;
            p.x = clamp(seat === 0 ? ball.x - offset : ball.x + offset - p.w, 0, CANVAS_WIDTH - p.w);
            p.y = clamp(ball.y - p.h / 2, 0, GROUND_Y - p.h);
            p.vx = 0; p.vy = 0;
            this.teleportCooldowns[seat] = TELEPORT_COOLDOWN_MS;
        }
        p.teleportWasHeld = inp.teleport;
    }

    private buildSnapshot(): object {
        const playersOut: any[] = this.playerOrder.map((id, i) => {
            const p = this.players[id];
            return {
                seat: p.seat,
                characterId: p.characterId,
                x: p.x, y: p.y, w: p.w, h: p.h,
                direction: p.direction,
                teleportCooldownMs: this.teleportCooldowns[i as Seat]
            };
        });

        return {
            phase:       this.phase,
            score:       this.score,
            timeLeftMs:  Math.max(0, Math.round(this.phase === 'countdown' ? this.countdownMs : this.timeLeftMs)),
            ball:        this.phase === 'playing' || this.phase === 'finished' ? { ...this.ball } : null,
            players:     playersOut,
            selections:  [{ ...this.selections[0] }, { ...this.selections[1] }],
            winner:      this.winner
        };
    }
}

// ============================================================================
// CLIENT
// ============================================================================

export class HeadBallClient extends GameClient {

    // Stato ricevuto dal server
    private gamePhase: string = 'waiting';
    private serverPlayers: any[] = [];
    private ball: any = null;
    private score = { left: 0, right: 0 };
    private timeLeftMs = MATCH_DURATION_MS;
    private selections: any[] = [];
    private winner: string | null = null;
    private mySeat: number = -1;

    // UI selezione
    private selectedCharIndex = 0;
    private selectionConfirmed = false;

    // Animazione
    private sceneClock = 0;
    private ballTrail: Array<{ x: number; y: number; age: number }> = [];

    // Scala canvas→virtuale
    private scaleX = 1;
    private scaleY = 1;
    private offsetX = 0;
    private offsetY = 0;

    // Messaggi da inviare al server
    private outbox: any[] = [];

    constructor(userInput: UserInput, myId: string) {
        super(userInput, myId);
    }

    async init(players: Record<string, any>): Promise<void> {
        // Determina il mio seat in base all'ordine dei giocatori
        const ids = Object.keys(players);
        this.mySeat = ids.indexOf(this.myId);
        return Promise.resolve();
    }

    draw(ctx: CanvasRenderingContext2D, dt: number): void {
        const { screenW, screenH } = this.userInput;

        // Aggiorna scala
        const fitScale = Math.min(screenW / CANVAS_WIDTH, screenH / CANVAS_HEIGHT);
        this.scaleX  = fitScale;
        this.scaleY  = fitScale;
        this.offsetX = (screenW  - CANVAS_WIDTH  * fitScale) / 2;
        this.offsetY = (screenH  - CANVAS_HEIGHT * fitScale) / 2;

        this.sceneClock += dt;

        // Leggi input tastiera e invia al server
        this.readInput();

        // --- Disegno ---
        ctx.clearRect(0, 0, screenW, screenH);
        ctx.save();
        ctx.fillStyle = '#07111c';
        ctx.fillRect(0, 0, screenW, screenH);
        ctx.translate(this.offsetX, this.offsetY);
        ctx.scale(this.scaleX, this.scaleY);

        ctx.beginPath();
        ctx.rect(0, 0, CANVAS_WIDTH, CANVAS_HEIGHT);
        ctx.clip();

        this.drawBackground(ctx);
        this.drawPitch(ctx);

        if (this.gamePhase !== 'waiting' && this.gamePhase !== 'selection') {
            this.serverPlayers.forEach(p => this.drawCharacter(ctx, p));
            if (this.ball) this.drawBall(ctx, this.ball);
        }

        if (this.gamePhase === 'countdown') {
            this.drawCountdown(ctx);
        }

        this.drawHUD(ctx);

        if (this.gamePhase === 'selection' || this.gamePhase === 'waiting') {
            this.drawSelectionPanel(ctx);
        }

        if (this.gamePhase === 'finished') {
            this.drawResultPanel(ctx);
        }

        ctx.restore();
    }

    handleMessage(message: any): void {
        if (!message) return;
        this.gamePhase   = message.phase      ?? this.gamePhase;
        this.score       = message.score      ?? this.score;
        this.timeLeftMs  = message.timeLeftMs ?? this.timeLeftMs;
        this.ball        = message.ball       ?? null;
        this.serverPlayers = message.players  ?? this.serverPlayers;
        this.selections  = message.selections ?? this.selections;
        this.winner      = message.winner     ?? null;
    }

    flushMessages(): any[] {
        const msgs = [...this.outbox];
        this.outbox = [];
        return msgs;
    }

    isFinished(): boolean {
        return this.gamePhase === 'finished';
    }

    // ── Input ───────────────────────────────────────────────────────────────

    private prevMoveX:    number  = 0;
    private prevJump:     boolean = false;
    private prevTeleport: boolean = false;
    private prevSelMoveX: number  = 0;

    private readInput(): void {
        const inp = this.userInput;

        // Selezione personaggio: A/D cambiano personaggio, S conferma
        if (this.gamePhase === 'selection' && !this.selectionConfirmed) {
            const selMoveX = inp.moveDirectionX;
            if (selMoveX !== this.prevSelMoveX) {
                this.prevSelMoveX = selMoveX;
                if (selMoveX > 0) {
                    this.selectedCharIndex = (this.selectedCharIndex + 1) % CHARACTER_DEFS.length;
                    this.outbox.push({ kind: 'selection:update', characterId: CHARACTER_DEFS[this.selectedCharIndex].id });
                } else if (selMoveX < 0) {
                    this.selectedCharIndex = (this.selectedCharIndex - 1 + CHARACTER_DEFS.length) % CHARACTER_DEFS.length;
                    this.outbox.push({ kind: 'selection:update', characterId: CHARACTER_DEFS[this.selectedCharIndex].id });
                }
            }
            // S (moveDirectionY > 0) = conferma selezione
            if (inp.moveDirectionY > 0) {
                this.selectionConfirmed = true;
                this.outbox.push({ kind: 'selection:confirm', characterId: CHARACTER_DEFS[this.selectedCharIndex].id });
            }
            return;
        }

        // Gioco: A/D movimento, W salto, click sinistro teletrasporto
        if (this.gamePhase === 'playing') {
            const moveX    = inp.moveDirectionX;
            const jump     = inp.moveDirectionY < 0;
            const teleport = inp.isMouseLeftPressed;

            if (moveX !== this.prevMoveX || jump !== this.prevJump || teleport !== this.prevTeleport) {
                this.prevMoveX    = moveX;
                this.prevJump     = jump;
                this.prevTeleport = teleport;
                this.outbox.push({ kind: 'input', moveX, jump, teleport });
            }
        }
    }

    // ── Disegno campo ───────────────────────────────────────────────────────

    private drawBackground(ctx: CanvasRenderingContext2D): void {
        ctx.fillStyle = '#68c8ff';
        ctx.fillRect(0, 0, CANVAS_WIDTH, GROUND_Y);
        ctx.fillStyle = '#239c3d';
        ctx.fillRect(0, GROUND_Y, CANVAS_WIDTH, CANVAS_HEIGHT - GROUND_Y);
        ctx.fillStyle = '#126d2b';
        ctx.fillRect(0, GROUND_Y, CANVAS_WIDTH, 7);

        // Nuvole
        ctx.save();
        ctx.globalAlpha = 0.25;
        ctx.fillStyle   = 'rgba(255,255,255,0.9)';
        const clouds = [{ x: 140, y: 60, s: 1.0, sp: 0.22 }, { x: 390, y: 48, s: 1.18, sp: 0.18 }, { x: 760, y: 62, s: 0.95, sp: 0.15 }];
        clouds.forEach(c => {
            const x = c.x + (this.sceneClock * c.sp * 18) % 220;
            ctx.beginPath(); ctx.ellipse(x, c.y, 46 * c.s, 18 * c.s, 0, 0, Math.PI * 2); ctx.fill();
            ctx.beginPath(); ctx.ellipse(x + 28 * c.s, c.y - 8 * c.s, 32 * c.s, 14 * c.s, 0, 0, Math.PI * 2); ctx.fill();
        });
        ctx.restore();
    }

    private drawPitch(ctx: CanvasRenderingContext2D): void {
        // Linea centrale
        ctx.save();
        ctx.strokeStyle = 'rgba(255,255,255,0.35)';
        ctx.lineWidth   = 2;
        ctx.setLineDash([10, 8]);
        ctx.beginPath(); ctx.moveTo(CANVAS_WIDTH / 2, GOAL_TOP_Y); ctx.lineTo(CANVAS_WIDTH / 2, GROUND_Y); ctx.stroke();
        ctx.setLineDash([]);
        ctx.restore();

        this.drawGoal(ctx, 0);
        this.drawGoal(ctx, CANVAS_WIDTH - GOAL_LINE_X);
    }

    private drawGoal(ctx: CanvasRenderingContext2D, goalX: number): void {
        const isLeft = goalX === 0;
        const goalH  = GROUND_Y - GOAL_TOP_Y;
        const T      = GOAL_POST_THICKNESS;
        const frontX = isLeft ? goalX + GOAL_LINE_X - T : goalX;
        const backX  = isLeft ? goalX                   : goalX + GOAL_LINE_X - T;
        const netX   = isLeft ? backX + T : frontX + T;
        const netW   = GOAL_LINE_X - T * 2;

        // Rete
        ctx.fillStyle = 'rgba(160,200,240,0.10)';
        ctx.fillRect(netX, GOAL_TOP_Y + T, netW, goalH - T);

        // Maglie
        ctx.save();
        ctx.beginPath(); ctx.rect(netX, GOAL_TOP_Y + T, netW, goalH - T); ctx.clip();
        ctx.strokeStyle = 'rgba(210,235,255,0.40)'; ctx.lineWidth = 0.8;
        for (let nx2 = netX + 8; nx2 < netX + netW; nx2 += 8) { ctx.beginPath(); ctx.moveTo(nx2, GOAL_TOP_Y + T); ctx.lineTo(nx2, GROUND_Y); ctx.stroke(); }
        for (let ny  = GOAL_TOP_Y + T + 8; ny < GROUND_Y; ny += 8) { ctx.beginPath(); ctx.moveTo(netX, ny); ctx.lineTo(netX + netW, ny); ctx.stroke(); }
        ctx.restore();

        // Pali
        ctx.fillStyle = '#c0ccd8';
        ctx.fillRect(frontX, GOAL_TOP_Y, T, goalH);
        ctx.globalAlpha = 0.55; ctx.fillStyle = '#7f8b96';
        ctx.fillRect(backX, GOAL_TOP_Y + T, T, goalH - T);
        ctx.globalAlpha = 1;
        ctx.fillStyle = '#c0ccd8';
        ctx.fillRect(goalX, GOAL_TOP_Y, GOAL_LINE_X, T);
    }

    // ── Disegno personaggio ─────────────────────────────────────────────────

    private drawCharacter(ctx: CanvasRenderingContext2D, p: any): void {
        if (!p) return;
        const char = CHARACTER_DEFS.find(c => c.id === p.characterId) ?? CHARACTER_DEFS[0];
        const cx   = p.x + p.w / 2;
        const headR = p.w * 0.48;
        const headCY = p.y + p.h * 0.26;

        ctx.save();

        // Ombra
        ctx.save();
        ctx.globalAlpha = 0.22;
        ctx.fillStyle   = '#000';
        ctx.beginPath();
        ctx.ellipse(cx, GROUND_Y - 2, p.w * 0.42, 7, 0, 0, Math.PI * 2);
        ctx.fill();
        ctx.restore();

        // Scarpini
        const footR   = p.w * 0.18;
        const footCY  = p.y + p.h * 0.88;
        const footSpread = p.w * 0.28;
        [-1, 1].forEach(side => {
            const fx = cx + side * footSpread;
            ctx.fillStyle = '#1a1a2e';
            ctx.beginPath(); ctx.ellipse(fx, footCY, footR, footR * 0.75, 0, 0, Math.PI * 2); ctx.fill();
            ctx.fillStyle = char.trim;
            ctx.beginPath(); ctx.ellipse(fx, footCY - footR * 0.15, footR * 0.9, footR * 0.35, 0, 0, Math.PI * 2); ctx.fill();
        });

        // Testa
        const grad = ctx.createRadialGradient(cx - headR * 0.3, headCY - headR * 0.3, headR * 0.1, cx, headCY, headR);
        grad.addColorStop(0, '#ffe0c2'); grad.addColorStop(0.7, '#f5c09a'); grad.addColorStop(1, '#d4895a');
        ctx.beginPath(); ctx.arc(cx, headCY, headR, 0, Math.PI * 2);
        ctx.fillStyle = grad; ctx.fill();
        ctx.strokeStyle = 'rgba(0,0,0,0.18)'; ctx.lineWidth = 1.5; ctx.stroke();

        // Maglia (parte alta testa)
        ctx.fillStyle = char.jersey;
        ctx.beginPath(); ctx.ellipse(cx, headCY - headR * 0.78, headR * 0.88, headR * 0.32, 0, 0, Math.PI * 2); ctx.fill();

        // Occhi
        const eyeOffX = headR * 0.34;
        const eyeY    = headCY - headR * 0.08;
        ctx.fillStyle = '#fff';
        [cx - eyeOffX, cx + eyeOffX].forEach(ex => {
            ctx.beginPath(); ctx.ellipse(ex, eyeY, headR * 0.22, headR * 0.26, 0, 0, Math.PI * 2); ctx.fill();
        });
        const pupilDir = p.direction ?? 1;
        ctx.fillStyle = '#1a0a00';
        [cx - eyeOffX, cx + eyeOffX].forEach(ex => {
            ctx.beginPath(); ctx.arc(ex + pupilDir * headR * 0.06, eyeY + headR * 0.04, headR * 0.13, 0, Math.PI * 2); ctx.fill();
        });

        // Indicatore seat
        ctx.fillStyle   = p.seat === 0 ? '#4ac7ff' : '#ff7272';
        ctx.font        = `bold ${Math.round(headR * 0.44)}px Sora, sans-serif`;
        ctx.textAlign   = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText(p.seat === 0 ? 'P1' : 'P2', cx, headCY - headR * 1.45);

        ctx.restore();
    }

    // ── Disegno palla ───────────────────────────────────────────────────────

    private drawBall(ctx: CanvasRenderingContext2D, ball: any): void {
        if (!ball) return;
        const { x, y } = ball;
        const R = BALL_RADIUS;

        ctx.save();

        // Ombra
        ctx.globalAlpha = 0.18;
        ctx.fillStyle   = '#000';
        ctx.beginPath(); ctx.ellipse(x, GROUND_Y - 3, R * 0.9, R * 0.3, 0, 0, Math.PI * 2); ctx.fill();
        ctx.globalAlpha = 1;

        // Sfera
        const g = ctx.createRadialGradient(x - R * 0.35, y - R * 0.35, R * 0.05, x, y, R);
        g.addColorStop(0, '#ffffff'); g.addColorStop(0.4, '#f0f0f0'); g.addColorStop(1, '#a0a0a8');
        ctx.beginPath(); ctx.arc(x, y, R, 0, Math.PI * 2);
        ctx.fillStyle = g; ctx.fill();
        ctx.strokeStyle = '#666'; ctx.lineWidth = 1.5; ctx.stroke();

        // Pentagoni pallone
        ctx.strokeStyle = '#333'; ctx.lineWidth = 1;
        const pts = [[0, -1], [0.951, -0.309], [0.588, 0.809], [-0.588, 0.809], [-0.951, -0.309]];
        ctx.beginPath();
        pts.forEach(([px, py], i) => {
            const qx = x + px * R * 0.48, qy = y + py * R * 0.48;
            i === 0 ? ctx.moveTo(qx, qy) : ctx.lineTo(qx, qy);
        });
        ctx.closePath(); ctx.stroke();

        ctx.restore();
    }

    // ── HUD ─────────────────────────────────────────────────────────────────

    private drawHUD(ctx: CanvasRenderingContext2D): void {
        const timeStr = this.gamePhase === 'countdown'
            ? String(Math.max(0, Math.ceil(this.timeLeftMs / 1000)))
            : this.formatTime(this.timeLeftMs);

        // Punteggio e timer
        ctx.save();
        ctx.font         = 'bold 28px Orbitron, sans-serif';
        ctx.textAlign    = 'center';
        ctx.textBaseline = 'top';

        ctx.fillStyle = '#4ac7ff';
        ctx.fillText(String(this.score.left),  160, 12);
        ctx.fillStyle = '#fff';
        ctx.fillText(timeStr,                  CANVAS_WIDTH / 2, 12);
        ctx.fillStyle = '#ff7272';
        ctx.fillText(String(this.score.right), CANVAS_WIDTH - 160, 12);

        ctx.restore();
    }

    private formatTime(ms: number): string {
        const tot = Math.ceil(Math.max(0, ms) / 1000);
        return `${String(Math.floor(tot / 60)).padStart(2, '0')}:${String(tot % 60).padStart(2, '0')}`;
    }

    // ── Pannello countdown ──────────────────────────────────────────────────

    private drawCountdown(ctx: CanvasRenderingContext2D): void {
        ctx.save();
        ctx.fillStyle = 'rgba(7,12,20,0.5)';
        ctx.fillRect(0, 0, CANVAS_WIDTH, CANVAS_HEIGHT);
        ctx.fillStyle = 'rgba(255,255,255,0.92)';
        ctx.font      = '800 88px Orbitron, sans-serif';
        ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
        ctx.fillText(String(Math.max(0, Math.ceil(this.timeLeftMs / 1000))), CANVAS_WIDTH / 2, CANVAS_HEIGHT / 2 - 18);
        ctx.font      = '600 18px Sora, sans-serif';
        ctx.fillStyle = 'rgba(228,238,255,0.84)';
        ctx.fillText('Pronti?', CANVAS_WIDTH / 2, CANVAS_HEIGHT / 2 + 44);
        ctx.restore();
    }

    // ── Pannello selezione personaggio ──────────────────────────────────────

    private drawSelectionPanel(ctx: CanvasRenderingContext2D): void {
        const px = CANVAS_WIDTH / 2 - 220, py = CANVAS_HEIGHT / 2 - 160;
        const pw = 440, ph = 320;

        ctx.save();
        ctx.fillStyle = 'rgba(9,18,32,0.88)';
        this.roundRect(ctx, px, py, pw, ph, 24);
        ctx.fill();
        ctx.strokeStyle = 'rgba(255,255,255,0.14)'; ctx.lineWidth = 1.5;
        this.roundRect(ctx, px, py, pw, ph, 24);
        ctx.stroke();

        const char = CHARACTER_DEFS[this.selectedCharIndex];

        // Titolo
        ctx.fillStyle    = 'rgba(238,245,255,0.7)';
        ctx.font         = '600 11px Sora, sans-serif';
        ctx.textAlign    = 'center'; ctx.textBaseline = 'top';
        ctx.fillText('INDIE DARK', CANVAS_WIDTH / 2, py + 18);

        ctx.fillStyle    = '#eef5ff';
        ctx.font         = 'bold 22px Orbitron, sans-serif';
        const title = this.selectionConfirmed ? 'Personaggio bloccato'
                    : this.gamePhase === 'waiting' ? 'In attesa...'
                    : 'Scegli personaggio';
        ctx.fillText(title, CANVAS_WIDTH / 2, py + 38);

        // Preview orb
        const orbX = CANVAS_WIDTH / 2, orbY = py + 130;
        const g = ctx.createRadialGradient(orbX - 18, orbY - 18, 5, orbX, orbY, 44);
        g.addColorStop(0, '#fff'); g.addColorStop(0.5, char.accent); g.addColorStop(1, char.jersey);
        ctx.beginPath(); ctx.arc(orbX, orbY, 44, 0, Math.PI * 2);
        ctx.fillStyle = g; ctx.fill();
        ctx.strokeStyle = 'rgba(255,255,255,0.2)'; ctx.lineWidth = 2; ctx.stroke();

        // Nome personaggio
        ctx.fillStyle = '#eef5ff'; ctx.font = 'bold 16px Sora, sans-serif';
        ctx.fillText(char.name, CANVAS_WIDTH / 2, py + 192);

        if (!this.selectionConfirmed && this.gamePhase === 'selection') {
            // Frecce
            ctx.fillStyle = 'rgba(255,255,255,0.7)'; ctx.font = 'bold 20px Sora, sans-serif';
            ctx.fillText('←  ARROW  →', CANVAS_WIDTH / 2, py + 222);
            ctx.fillStyle = 'rgba(104,214,141,0.9)'; ctx.font = 'bold 14px Sora, sans-serif';
            ctx.fillText('premi ENTER per confermare', CANVAS_WIDTH / 2, py + 252);
        } else if (this.selectionConfirmed) {
            ctx.fillStyle = '#68d68d'; ctx.font = 'bold 14px Sora, sans-serif';
            ctx.fillText('✓ Confermato — in attesa avversario', CANVAS_WIDTH / 2, py + 232);
        }

        ctx.restore();
    }

    // ── Pannello risultato ──────────────────────────────────────────────────

    private drawResultPanel(ctx: CanvasRenderingContext2D): void {
        const px = CANVAS_WIDTH / 2 - 200, py = CANVAS_HEIGHT / 2 - 100;
        ctx.save();
        ctx.fillStyle = 'rgba(9,18,32,0.92)';
        this.roundRect(ctx, px, py, 400, 200, 24); ctx.fill();

        ctx.fillStyle = '#eef5ff'; ctx.font = 'bold 28px Orbitron, sans-serif';
        ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
        const msg = this.winner === 'draw' ? 'Pareggio!'
                  : this.winner === 'left' ? 'Vince P1 🎉'
                  : 'Vince P2 🎉';
        ctx.fillText(msg, CANVAS_WIDTH / 2, CANVAS_HEIGHT / 2 - 20);
        ctx.fillStyle = 'rgba(238,245,255,0.6)'; ctx.font = '14px Sora, sans-serif';
        ctx.fillText('Attendi la prossima partita...', CANVAS_WIDTH / 2, CANVAS_HEIGHT / 2 + 24);
        ctx.restore();
    }

    // ── Helper roundRect ────────────────────────────────────────────────────

    private roundRect(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number): void {
        ctx.beginPath();
        ctx.moveTo(x + r, y);
        ctx.lineTo(x + w - r, y); ctx.arcTo(x + w, y,     x + w, y + r,     r);
        ctx.lineTo(x + w, y + h - r); ctx.arcTo(x + w, y + h, x + w - r, y + h, r);
        ctx.lineTo(x + r, y + h); ctx.arcTo(x,     y + h, x,     y + h - r, r);
        ctx.lineTo(x, y + r); ctx.arcTo(x,     y,     x + r,   y,         r);
        ctx.closePath();
    }
}