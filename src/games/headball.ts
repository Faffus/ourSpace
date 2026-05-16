/**
 * HEAD BALL ONLINE
 * Autore: Indie Dark
 *
 * Gioco multiplayer Head Ball (1v1) adattato al framework ourSpace.
 * Esporta HeadBallServer (estende GameServer) e HeadBallClient (estende GameClient).
 *
 * Controlli in gioco:
 *   A / D          = muovi sinistra / destra
 *   W              = salta (doppio salto disponibile)
 *   Click sinistro = teletrasporto verso la palla (cooldown 15s)
 *
 * Selezione personaggio:
 *   A / D          = personaggio precedente / successivo
 *   S              = conferma
 */

import { getCollisionSide } from '../common';
import { IncomingMsg, OutgoingMsg } from '../server';
import { GameClient, GameServer } from './game';
import { UserInput } from '../client/user-input';

// ============================================================================
// COSTANTI
// ============================================================================

const CANVAS_W             = 1000;
const CANVAS_H             = 500;
const GROUND_Y             = 348;
const GOAL_W               = 75;
const GOAL_TOP_Y           = 72;
const GOAL_POST_T          = 10;

const PLAYER_W             = 68;
const PLAYER_H             = 96;
const BALL_R               = 22;

const PLAYER_SPEED         = 390;
const PLAYER_JUMP_V        = -1180;
const PLAYER_GRAVITY       = 3600;

const BALL_GRAVITY         = 1900;
const BALL_BOUNCE_SIDE     = 0.88;
const BALL_BOUNCE_TOP      = 0.98;
const BALL_BOUNCE_GROUND   = 0.82;
const BALL_FRICTION        = 0.988;
const BALL_STOP_V          = 18;
const BALL_KICKOFF_VX      = 320;
const BALL_KICKOFF_VY      = -480;

const TELEPORT_OFFSET      = 50;
const TELEPORT_COOLDOWN_MS = 15000;

const COUNTDOWN_MS         = 3000;
const MATCH_MS             = 90000;

const DEFAULT_CHAR         = 'classic';

const CHAR_DEFS = [
    { id: 'classic', name: 'Classic', accent: '#00d8ff', jersey: '#006dff', trim: '#f7fdff' },
    { id: 'wizard',  name: 'Wizard',  accent: '#ffcf33', jersey: '#8b5cf6', trim: '#ffe680' },
    { id: 'ninja',   name: 'Ninja',   accent: '#28ff88', jersey: '#00a84f', trim: '#edfff5' },
];
const CHAR_IDS = new Set(CHAR_DEFS.map(c => c.id));

// ============================================================================
// TIPI
// ============================================================================

type Seat = 0 | 1;

interface InputState  { moveX: number; jump: boolean; teleport: boolean; }
interface SelectState { characterId: string; confirmed: boolean; }
interface BallState   { x: number; y: number; vx: number; vy: number; }
interface PlayerState {
    seat: Seat; characterId: string;
    x: number; y: number; vx: number; vy: number;
    w: number; h: number; direction: number;
    onGround: boolean; jumpHeld: boolean; doubleJumpUsed: boolean;
    teleportHeld: boolean; input: InputState;
}

// ============================================================================
// HELPER
// ============================================================================

const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));

function safeCharId(id: unknown): string {
    return (typeof id === 'string' && CHAR_IDS.has(id.trim())) ? id.trim() : DEFAULT_CHAR;
}

function makeInput(): InputState { return { moveX: 0, jump: false, teleport: false }; }

function makeBall(dir = 0): BallState {
    return {
        x: CANVAS_W / 2, y: GROUND_Y - 160,
        vx: BALL_KICKOFF_VX * dir,
        vy: dir !== 0 ? BALL_KICKOFF_VY : 0,
    };
}

function makePlayer(seat: Seat, charId: string): PlayerState {
    return {
        seat, characterId: charId,
        x: seat === 0 ? 110 : CANVAS_W - 110 - PLAYER_W,
        y: GROUND_Y - PLAYER_H,
        vx: 0, vy: 0,
        w: PLAYER_W, h: PLAYER_H,
        direction: seat === 0 ? 1 : -1,
        onGround: true, jumpHeld: false, doubleJumpUsed: false, teleportHeld: false,
        input: makeInput(),
    };
}

// ============================================================================
// COLLISIONI
// ============================================================================

function ballVsRect(ball: BallState, rect: {x:number;y:number;w:number;h:number}): boolean {
    const br   = { x: ball.x - BALL_R, y: ball.y - BALL_R, w: BALL_R * 2, h: BALL_R * 2 };
    const side = getCollisionSide(br, rect);
    if (side === 'none') return false;
    if (side === 'top')    { ball.y = rect.y - BALL_R;          ball.vy = -Math.abs(ball.vy) * BALL_BOUNCE_TOP;  }
    if (side === 'bottom') { ball.y = rect.y + rect.h + BALL_R; ball.vy =  Math.abs(ball.vy) * BALL_BOUNCE_TOP;  }
    if (side === 'left')   { ball.x = rect.x - BALL_R;          ball.vx = -Math.abs(ball.vx) * BALL_BOUNCE_SIDE; }
    if (side === 'right')  { ball.x = rect.x + rect.w + BALL_R; ball.vx =  Math.abs(ball.vx) * BALL_BOUNCE_SIDE; }
    return true;
}

function ballVsPlayer(ball: BallState, p: PlayerState): void {
    const cx = p.x + p.w / 2;
    const hR  = p.w * 0.48, hCY = p.y + p.h * 0.26;
    const dxH = ball.x - cx, dyH = ball.y - hCY;
    const dH  = Math.sqrt(dxH * dxH + dyH * dyH);
    const fR  = p.w * 0.20, fCY = p.y + p.h * 0.88;
    const dxF = ball.x - cx, dyF = ball.y - fCY;
    const dF  = Math.sqrt(dxF * dxF + dyF * dyF);

    const hitH = dH < hR + BALL_R;
    const hitF = dF < fR + BALL_R;
    if (!hitH && !hitF) return;

    const dir = p.seat === 0 ? 1 : -1;
    const spd = Math.sqrt(ball.vx * ball.vx + ball.vy * ball.vy);

    if (hitH) {
        const s = Math.max(dH, 0.001);
        const nx = dxH / s, ny = dyH / s;
        const sp = clamp(Math.max(560, spd), 560, 880);
        ball.vx = clamp(nx * sp * 0.50 + dir * 0.18 * sp + p.vx * 0.15, -700, 700);
        ball.vy = clamp(Math.min(ny * sp * 0.50 + (ny < -0.3 ? -920 : -800), -640), -1050, -640);
        ball.x += nx * (hR + BALL_R - dH);
        ball.y += ny * (hR + BALL_R - dH);
    } else {
        const s = Math.max(dF, 0.001);
        const nx = dxF / s, ny = dyF / s;
        const sp = clamp(Math.max(600, spd * 1.15), 600, 1000);
        ball.vx = clamp(nx * sp * 0.90 + dir * sp * 0.25 + p.vx * 0.25, -1000, 1000);
        ball.vy = clamp(Math.min(ny * sp * 0.5 - 480, -350), -850, -350);
        ball.x += nx * (fR + BALL_R - dF);
        ball.y += ny * (fR + BALL_R - dF);
    }
}

function ballVsGoalFrame(ball: BallState, goalX: number, isLeft: boolean): void {
    const goalH = GROUND_Y - GOAL_TOP_Y;
    const backX = isLeft ? goalX : goalX + GOAL_W - GOAL_POST_T;
    ballVsRect(ball, { x: backX, y: GOAL_TOP_Y, w: GOAL_POST_T, h: goalH });
    ballVsRect(ball, { x: goalX, y: GOAL_TOP_Y, w: GOAL_W,      h: GOAL_POST_T });
}

// ============================================================================
// SERVER
// ============================================================================

export class HeadBallServer extends GameServer {

    private phase: 'selection'|'countdown'|'playing'|'finished' = 'selection';
    private players: Record<string, PlayerState> = {};
    private order:   string[]      = [];
    private sels:    SelectState[] = [
        { characterId: DEFAULT_CHAR, confirmed: false },
        { characterId: DEFAULT_CHAR, confirmed: false },
    ];
    private ball:   BallState          = makeBall();
    private score   = { left: 0, right: 0 };
    private timeMs  = MATCH_MS;
    private cdMs    = COUNTDOWN_MS;
    private winner: 'left'|'right'|'draw'|null = null;
    private tpCd:   [number, number]   = [0, 0];

    init(players: Record<string, any>): void {
        this.order  = Object.keys(players);
        this.phase  = 'selection';
        this.score  = { left: 0, right: 0 };
        this.winner = null;
        this.tpCd   = [0, 0];
        this.sels   = [
            { characterId: DEFAULT_CHAR, confirmed: false },
            { characterId: DEFAULT_CHAR, confirmed: false },
        ];
        this.order.forEach((id, i) => {
            this.players[id] = makePlayer(i as Seat, DEFAULT_CHAR);
        });
        this.ball = makeBall();
    }

    tick(msgs: IncomingMsg[], dt: number): OutgoingMsg[] {
        for (const msg of msgs) {
            const id  = msg.clientId;
            const pay = msg.payload;
            const p   = this.players[id];
            if (!p) continue;
            const seat = p.seat;

            if (pay.kind === 'input' && this.phase === 'playing') {
                p.input = {
                    moveX:    typeof pay.moveX    === 'number'  ? clamp(pay.moveX, -1, 1) : p.input.moveX,
                    jump:     typeof pay.jump     === 'boolean' ? pay.jump     : p.input.jump,
                    teleport: typeof pay.teleport === 'boolean' ? pay.teleport : p.input.teleport,
                };
            }

            if (pay.kind === 'selection:update' && this.phase === 'selection') {
                if (!this.sels[seat].confirmed)
                    this.sels[seat].characterId = safeCharId(pay.characterId);
            }

            if (pay.kind === 'selection:confirm' && this.phase === 'selection') {
                if (!this.sels[seat].confirmed) {
                    this.sels[seat].characterId = safeCharId(pay.characterId ?? this.sels[seat].characterId);
                    this.sels[seat].confirmed   = true;
                }
                if (this.sels[0].confirmed && this.sels[1].confirmed)
                    this.startCountdown();
            }
        }

        if (this.phase === 'countdown') {
            this.cdMs -= dt * 1000;
            if (this.cdMs <= 0) this.startPlaying();
        }

        if (this.phase === 'playing') {
            this.timeMs -= dt * 1000;
            if (this.timeMs <= 0) this.finishGame();
            else                  this.physics(dt);
        }

        return [{ payload: this.snapshot() }];
    }

    isFinished(): boolean { return this.phase === 'finished'; }

    private startCountdown(): void {
        this.phase  = 'countdown';
        this.cdMs   = COUNTDOWN_MS;
        this.score  = { left: 0, right: 0 };
        this.winner = null;
        this.tpCd   = [0, 0];
        this.ball   = makeBall();
        this.order.forEach((id, i) => {
            this.players[id] = makePlayer(i as Seat, this.sels[i].characterId);
        });
    }

    private startPlaying(): void {
        this.phase  = 'playing';
        this.timeMs = MATCH_MS;
        this.tpCd   = [0, 0];
        this.ball   = makeBall(Math.random() < 0.5 ? -1 : 1);
        this.order.forEach((id, i) => {
            this.players[id] = makePlayer(i as Seat, this.sels[i].characterId);
        });
    }

    private resetAfterGoal(scorer: Seat): void {
        this.ball = makeBall(scorer === 0 ? -1 : 1);
        this.order.forEach((id, i) => {
            this.players[id] = makePlayer(i as Seat, this.sels[i].characterId);
        });
    }

    private finishGame(): void {
        this.phase  = 'finished';
        this.winner = this.score.left > this.score.right ? 'left'
                    : this.score.right > this.score.left ? 'right'
                    : 'draw';
    }

    private physics(dt: number): void {
        ([0, 1] as Seat[]).forEach(seat => {
            const p = this.players[this.order[seat]];
            if (!p) return;
            this.applyInput(p, seat, dt);

            p.vy += PLAYER_GRAVITY * dt;
            p.x  += p.vx * dt;
            p.y  += p.vy * dt;

            if (p.y >= GROUND_Y - p.h) { p.y = GROUND_Y - p.h; p.vy = 0; p.onGround = true; p.doubleJumpUsed = false; }
            else { p.onGround = false; }
            if (p.y < 0) { p.y = 0; if (p.vy < 0) p.vy = 0; }

            const minX = GOAL_W, maxX = CANVAS_W - GOAL_W - p.w;
            if (p.x < minX) { p.x = minX; p.vx = 0; }
            if (p.x > maxX) { p.x = maxX; p.vx = 0; }
        });

        const b = this.ball;
        b.vy += BALL_GRAVITY * dt;
        b.x  += b.vx * dt;
        b.y  += b.vy * dt;

        const inGoalH = b.y - BALL_R > GOAL_TOP_Y + GOAL_POST_T && b.y + BALL_R < GROUND_Y;

        if (b.x + BALL_R < GOAL_W && inGoalH) {
            this.score.right += 1;
            this.resetAfterGoal(1);
            return;
        }
        if (b.x - BALL_R > CANVAS_W - GOAL_W && inGoalH) {
            this.score.left += 1;
            this.resetAfterGoal(0);
            return;
        }

        if (b.x - BALL_R <= 0 && !inGoalH)        { b.x = BALL_R;           b.vx *= -BALL_BOUNCE_SIDE; }
        if (b.x + BALL_R >= CANVAS_W && !inGoalH)  { b.x = CANVAS_W - BALL_R; b.vx *= -BALL_BOUNCE_SIDE; }
        if (b.y - BALL_R <= 0)                     { b.y = BALL_R;           b.vy *= -BALL_BOUNCE_TOP;  }
        if (b.y + BALL_R >= GROUND_Y) {
            b.y   = GROUND_Y - BALL_R;
            b.vy *= -BALL_BOUNCE_GROUND;
            if (Math.abs(b.vy) < BALL_STOP_V) b.vy = 0;
            b.vx *= Math.pow(BALL_FRICTION, dt * 60);
        }

        ([0, 1] as Seat[]).forEach(seat => {
            const p = this.players[this.order[seat]];
            if (p) ballVsPlayer(b, p);
        });
        ballVsGoalFrame(b, 0, true);
        ballVsGoalFrame(b, CANVAS_W - GOAL_W, false);
    }

    private applyInput(p: PlayerState, seat: Seat, dt: number): void {
        const inp = p.input;
        p.vx = inp.moveX * PLAYER_SPEED;
        if (inp.moveX !== 0) p.direction = inp.moveX > 0 ? 1 : -1;

        if (inp.jump && !p.jumpHeld) {
            if (p.onGround) { p.vy = PLAYER_JUMP_V; p.onGround = false; p.doubleJumpUsed = false; }
            else if (!p.doubleJumpUsed) { p.vy = PLAYER_JUMP_V; p.doubleJumpUsed = true; }
        }
        p.jumpHeld = inp.jump;

        this.tpCd[seat] = Math.max(0, this.tpCd[seat] - dt * 1000);
        if (inp.teleport && !p.teleportHeld && this.tpCd[seat] <= 0) {
            const b = this.ball;
            const off = TELEPORT_OFFSET + BALL_R + p.w / 2;
            p.x = clamp(seat === 0 ? b.x - off : b.x + off - p.w, 0, CANVAS_W - p.w);
            p.y = clamp(b.y - p.h / 2, 0, GROUND_Y - p.h);
            p.vx = 0; p.vy = 0;
            this.tpCd[seat] = TELEPORT_COOLDOWN_MS;
        }
        p.teleportHeld = inp.teleport;
    }

    private snapshot(): object {
        const isActive = this.phase === 'playing' || this.phase === 'finished';
        return {
            phase:      this.phase,
            score:      { ...this.score },
            timeMs:     Math.max(0, Math.round(this.phase === 'countdown' ? this.cdMs : this.timeMs)),
            ball:       isActive ? { ...this.ball } : null,
            players:    this.order.map((id, i) => {
                const p = this.players[id];
                return { seat: p.seat, characterId: p.characterId, x: p.x, y: p.y, w: p.w, h: p.h, direction: p.direction, tpCdMs: this.tpCd[i as Seat] };
            }),
            selections: this.sels.map(s => ({ ...s })),
            winner:     this.winner,
        };
    }
}

// ============================================================================
// CLIENT
// ============================================================================

export class HeadBallClient extends GameClient {

    private phase      = 'selection';
    private sPlayers:  any[] = [];
    private ball:      any   = null;
    private score      = { left: 0, right: 0 };
    private timeMs     = MATCH_MS;
    private selections: any[] = [];
    private winner:    string | null = null;
    private mySeat     = -1;

    // Selezione
    private charIdx   = 0;
    private confirmed = false;
    private prevSelY  = 0;

    // Input diff
    private prevMoveX    = 0;
    private prevJump     = false;
    private prevTeleport = false;
    private prevSelX     = 0;

    private clock  = 0;
    private outbox: any[] = [];

    // Scala canvas virtuale
    private sx = 1; private sy = 1;
    private ox = 0; private oy = 0;

    constructor(userInput: UserInput, myId: string) { super(userInput, myId); }

    async init(players: Record<string, any>): Promise<void> {
        this.mySeat = Object.keys(players).indexOf(this.myId);
        return Promise.resolve();
    }

    draw(ctx: CanvasRenderingContext2D, dt: number): void {
        const { screenW, screenH } = this.userInput;
        const fit  = Math.min(screenW / CANVAS_W, screenH / CANVAS_H);
        this.sx = fit; this.sy = fit;
        this.ox = (screenW - CANVAS_W * fit) / 2;
        this.oy = (screenH - CANVAS_H * fit) / 2;
        this.clock += dt;

        this.readInput();

        ctx.fillStyle = '#07111c';
        ctx.fillRect(0, 0, screenW, screenH);

        ctx.save();
        ctx.translate(this.ox, this.oy);
        ctx.scale(this.sx, this.sy);
        ctx.beginPath(); ctx.rect(0, 0, CANVAS_W, CANVAS_H); ctx.clip();

        this.gfxBackground(ctx);
        this.gfxPitch(ctx);

        if (this.phase !== 'waiting' && this.phase !== 'selection') {
            this.sPlayers.forEach(p => this.gfxPlayer(ctx, p));
            if (this.ball) this.gfxBall(ctx, this.ball);
        }

        if (this.phase === 'countdown') this.gfxCountdown(ctx);

        this.gfxHUD(ctx);

        if (this.phase === 'selection' || this.phase === 'waiting') this.gfxSelection(ctx);
        if (this.phase === 'finished')                               this.gfxResult(ctx);

        ctx.restore();
    }

    handleMessage(msg: any): void {
        if (!msg) return;
        // Aggiorna ogni campo solo se presente nello snapshot
        if ('phase'      in msg) this.phase      = msg.phase;
        if ('score'      in msg) this.score      = msg.score;
        if ('timeMs'     in msg) this.timeMs     = msg.timeMs;
        if ('ball'       in msg) this.ball       = msg.ball;
        if ('players'    in msg) this.sPlayers   = msg.players;
        if ('selections' in msg) this.selections = msg.selections;
        if ('winner'     in msg) this.winner     = msg.winner;

        // Aggiorna mySeat se possibile
        if (this.mySeat === -1 && msg.players) {
            const idx = (msg.players as any[]).findIndex((_: any, i: number) => {
                return this.myId === this.myId; // placeholder, l'ordine viene da init
            });
        }
    }

    flushMessages(): any[] {
        const out = [...this.outbox];
        this.outbox = [];
        return out;
    }

    // Non ritornare mai true: il framework smonta il client e il gioco scompare
    isFinished(): boolean { return false; }

    // ── Input ─────────────────────────────────────────────────────────────────

    private readInput(): void {
        const inp = this.userInput;

        if (this.phase === 'selection' && !this.confirmed) {
            const selX = inp.moveDirectionX;
            if (selX !== this.prevSelX) {
                if (selX > 0) {
                    this.charIdx = (this.charIdx + 1) % CHAR_DEFS.length;
                    this.outbox.push({ kind: 'selection:update', characterId: CHAR_DEFS[this.charIdx].id });
                } else if (selX < 0) {
                    this.charIdx = (this.charIdx - 1 + CHAR_DEFS.length) % CHAR_DEFS.length;
                    this.outbox.push({ kind: 'selection:update', characterId: CHAR_DEFS[this.charIdx].id });
                }
                this.prevSelX = selX;
            }
            // S = conferma, solo sul fronte di salita (evita spam)
            const selY = inp.moveDirectionY;
            if (selY > 0 && this.prevSelY <= 0) {
                this.confirmed = true;
                this.outbox.push({ kind: 'selection:confirm', characterId: CHAR_DEFS[this.charIdx].id });
            }
            this.prevSelY = selY;
            return;
        }

        if (this.phase === 'playing') {
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

    // ── Grafica ───────────────────────────────────────────────────────────────

    private gfxBackground(ctx: CanvasRenderingContext2D): void {
        ctx.fillStyle = '#68c8ff';
        ctx.fillRect(0, 0, CANVAS_W, GROUND_Y);
        ctx.fillStyle = '#239c3d';
        ctx.fillRect(0, GROUND_Y, CANVAS_W, CANVAS_H - GROUND_Y);
        ctx.fillStyle = '#126d2b';
        ctx.fillRect(0, GROUND_Y, CANVAS_W, 7);

        ctx.save();
        const clouds = [{ x: 140, y: 60, s: 1.0, sp: 0.22 }, { x: 390, y: 48, s: 1.18, sp: 0.18 }, { x: 760, y: 62, s: 0.95, sp: 0.15 }];
        clouds.forEach(c => {
            const x = c.x + (this.clock * c.sp * 18) % 220;
            ctx.globalAlpha = 0.28;
            ctx.fillStyle   = 'rgba(255,255,255,0.9)';
            ctx.beginPath(); ctx.ellipse(x, c.y, 46 * c.s, 18 * c.s, 0, 0, Math.PI * 2); ctx.fill();
            ctx.beginPath(); ctx.ellipse(x + 28 * c.s, c.y - 8 * c.s, 32 * c.s, 14 * c.s, 0, 0, Math.PI * 2); ctx.fill();
        });
        ctx.restore();
    }

    private gfxPitch(ctx: CanvasRenderingContext2D): void {
        ctx.save();
        ctx.strokeStyle = 'rgba(255,255,255,0.35)';
        ctx.lineWidth   = 2;
        ctx.setLineDash([10, 8]);
        ctx.beginPath(); ctx.moveTo(CANVAS_W / 2, GOAL_TOP_Y); ctx.lineTo(CANVAS_W / 2, GROUND_Y); ctx.stroke();
        ctx.setLineDash([]);
        ctx.restore();
        this.gfxGoal(ctx, 0, true);
        this.gfxGoal(ctx, CANVAS_W - GOAL_W, false);
    }

    private gfxGoal(ctx: CanvasRenderingContext2D, gx: number, isLeft: boolean): void {
        const goalH  = GROUND_Y - GOAL_TOP_Y;
        const T      = GOAL_POST_T;
        const frontX = isLeft ? gx + GOAL_W - T : gx;
        const backX  = isLeft ? gx              : gx + GOAL_W - T;
        const netX   = isLeft ? backX + T : frontX + T;
        const netW   = GOAL_W - T * 2;

        ctx.fillStyle = 'rgba(160,200,240,0.10)';
        ctx.fillRect(netX, GOAL_TOP_Y + T, netW, goalH - T);

        ctx.save();
        ctx.beginPath(); ctx.rect(netX, GOAL_TOP_Y + T, netW, goalH - T); ctx.clip();
        ctx.strokeStyle = 'rgba(210,235,255,0.35)'; ctx.lineWidth = 0.8;
        for (let nx = netX + 8; nx < netX + netW; nx += 8) { ctx.beginPath(); ctx.moveTo(nx, GOAL_TOP_Y + T); ctx.lineTo(nx, GROUND_Y); ctx.stroke(); }
        for (let ny = GOAL_TOP_Y + T + 8; ny < GROUND_Y; ny += 8) { ctx.beginPath(); ctx.moveTo(netX, ny); ctx.lineTo(netX + netW, ny); ctx.stroke(); }
        ctx.restore();

        ctx.fillStyle   = '#c0ccd8';
        ctx.fillRect(frontX, GOAL_TOP_Y, T, goalH);
        ctx.globalAlpha = 0.55;
        ctx.fillStyle   = '#7f8b96';
        ctx.fillRect(backX, GOAL_TOP_Y + T, T, goalH - T);
        ctx.globalAlpha = 1;
        ctx.fillStyle   = '#c0ccd8';
        ctx.fillRect(gx, GOAL_TOP_Y, GOAL_W, T);
    }

    private gfxPlayer(ctx: CanvasRenderingContext2D, p: any): void {
        if (!p) return;
        const char = CHAR_DEFS.find(c => c.id === p.characterId) ?? CHAR_DEFS[0];
        const cx   = p.x + p.w / 2;
        const hR   = p.w * 0.48;
        const hCY  = p.y + p.h * 0.26;

        ctx.save();

        // Ombra
        ctx.globalAlpha = 0.22; ctx.fillStyle = '#000';
        ctx.beginPath(); ctx.ellipse(cx, GROUND_Y - 2, p.w * 0.42, 7, 0, 0, Math.PI * 2); ctx.fill();
        ctx.globalAlpha = 1;

        // Scarpini
        const fR = p.w * 0.18, fCY = p.y + p.h * 0.88, spread = p.w * 0.28;
        [-1, 1].forEach(side => {
            const fx = cx + side * spread;
            ctx.fillStyle = '#1a1a2e';
            ctx.beginPath(); ctx.ellipse(fx, fCY, fR, fR * 0.75, 0, 0, Math.PI * 2); ctx.fill();
            ctx.fillStyle = char.trim;
            ctx.beginPath(); ctx.ellipse(fx, fCY - fR * 0.15, fR * 0.9, fR * 0.35, 0, 0, Math.PI * 2); ctx.fill();
        });

        // Testa
        const g = ctx.createRadialGradient(cx - hR * 0.3, hCY - hR * 0.3, hR * 0.1, cx, hCY, hR);
        g.addColorStop(0, '#ffe0c2'); g.addColorStop(0.7, '#f5c09a'); g.addColorStop(1, '#d4895a');
        ctx.beginPath(); ctx.arc(cx, hCY, hR, 0, Math.PI * 2);
        ctx.fillStyle = g; ctx.fill();
        ctx.strokeStyle = 'rgba(0,0,0,0.18)'; ctx.lineWidth = 1.5; ctx.stroke();

        // Fascia maglia
        ctx.fillStyle = char.jersey;
        ctx.beginPath(); ctx.ellipse(cx, hCY - hR * 0.78, hR * 0.88, hR * 0.32, 0, 0, Math.PI * 2); ctx.fill();

        // Occhi
        const eOff = hR * 0.34, eY = hCY - hR * 0.08;
        ctx.fillStyle = '#fff';
        [cx - eOff, cx + eOff].forEach(ex => { ctx.beginPath(); ctx.ellipse(ex, eY, hR * 0.22, hR * 0.26, 0, 0, Math.PI * 2); ctx.fill(); });
        ctx.fillStyle = '#1a0a00';
        const dir = p.direction ?? 1;
        [cx - eOff, cx + eOff].forEach(ex => { ctx.beginPath(); ctx.arc(ex + dir * hR * 0.06, eY + hR * 0.04, hR * 0.13, 0, Math.PI * 2); ctx.fill(); });

        // Label P1/P2
        ctx.fillStyle = p.seat === 0 ? '#4ac7ff' : '#ff7272';
        ctx.font = `bold ${Math.round(hR * 0.44)}px sans-serif`;
        ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
        ctx.fillText(p.seat === 0 ? 'P1' : 'P2', cx, hCY - hR * 1.45);

        // Barra cooldown teletrasporto
        if (p.tpCdMs > 0) {
            const pct = 1 - p.tpCdMs / TELEPORT_COOLDOWN_MS;
            ctx.fillStyle = 'rgba(0,0,0,0.4)'; ctx.fillRect(p.x, p.y - 10, p.w, 4);
            ctx.fillStyle = '#ffc66e';          ctx.fillRect(p.x, p.y - 10, p.w * pct, 4);
        }

        ctx.restore();
    }

    private gfxBall(ctx: CanvasRenderingContext2D, b: any): void {
        const { x, y } = b;
        ctx.save();
        ctx.globalAlpha = 0.18; ctx.fillStyle = '#000';
        ctx.beginPath(); ctx.ellipse(x, GROUND_Y - 3, BALL_R * 0.9, BALL_R * 0.3, 0, 0, Math.PI * 2); ctx.fill();
        ctx.globalAlpha = 1;

        const g = ctx.createRadialGradient(x - BALL_R * 0.35, y - BALL_R * 0.35, BALL_R * 0.05, x, y, BALL_R);
        g.addColorStop(0, '#fff'); g.addColorStop(0.4, '#f0f0f0'); g.addColorStop(1, '#9090a0');
        ctx.beginPath(); ctx.arc(x, y, BALL_R, 0, Math.PI * 2);
        ctx.fillStyle = g; ctx.fill();
        ctx.strokeStyle = '#555'; ctx.lineWidth = 1.5; ctx.stroke();

        ctx.strokeStyle = '#333'; ctx.lineWidth = 1;
        const verts = [[0,-1],[0.951,-0.309],[0.588,0.809],[-0.588,0.809],[-0.951,-0.309]];
        ctx.beginPath();
        verts.forEach(([vx, vy], i) => {
            const px = x + vx * BALL_R * 0.48, py = y + vy * BALL_R * 0.48;
            i === 0 ? ctx.moveTo(px, py) : ctx.lineTo(px, py);
        });
        ctx.closePath(); ctx.stroke();
        ctx.restore();
    }

    private gfxHUD(ctx: CanvasRenderingContext2D): void {
        const tot  = Math.ceil(Math.max(0, this.timeMs) / 1000);
        const time = this.phase === 'countdown'
            ? String(Math.max(0, Math.ceil(this.timeMs / 1000)))
            : `${String(Math.floor(tot / 60)).padStart(2,'0')}:${String(tot % 60).padStart(2,'0')}`;

        ctx.save();
        ctx.font = 'bold 28px sans-serif'; ctx.textAlign = 'center'; ctx.textBaseline = 'top';
        // Ombra
        ctx.fillStyle = 'rgba(0,0,0,0.5)';
        ctx.fillText(String(this.score.left),  162, 14);
        ctx.fillText(time,                     CANVAS_W / 2 + 1, 14);
        ctx.fillText(String(this.score.right), CANVAS_W - 158, 14);
        // Testo
        ctx.fillStyle = '#4ac7ff'; ctx.fillText(String(this.score.left),  160, 12);
        ctx.fillStyle = '#fff';    ctx.fillText(time,                     CANVAS_W / 2, 12);
        ctx.fillStyle = '#ff7272'; ctx.fillText(String(this.score.right), CANVAS_W - 160, 12);
        ctx.restore();
    }

    private gfxCountdown(ctx: CanvasRenderingContext2D): void {
        ctx.save();
        ctx.fillStyle = 'rgba(7,12,20,0.55)'; ctx.fillRect(0, 0, CANVAS_W, CANVAS_H);
        const n = Math.max(0, Math.ceil(this.timeMs / 1000));
        ctx.fillStyle = '#fff'; ctx.font = '800 96px sans-serif';
        ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
        ctx.fillText(n > 0 ? String(n) : 'Via!', CANVAS_W / 2, CANVAS_H / 2 - 16);
        ctx.font = '600 18px sans-serif'; ctx.fillStyle = 'rgba(228,238,255,0.8)';
        ctx.fillText('Pronti?', CANVAS_W / 2, CANVAS_H / 2 + 44);
        ctx.restore();
    }

    private gfxSelection(ctx: CanvasRenderingContext2D): void {
        const px = CANVAS_W / 2 - 220, py = CANVAS_H / 2 - 170;
        const pw = 440, ph = 340;

        ctx.save();
        ctx.fillStyle = 'rgba(9,18,32,0.92)';
        this.rrect(ctx, px, py, pw, ph, 24); ctx.fill();
        ctx.strokeStyle = 'rgba(255,255,255,0.15)'; ctx.lineWidth = 1.5;
        this.rrect(ctx, px, py, pw, ph, 24); ctx.stroke();

        const char = CHAR_DEFS[this.charIdx];

        ctx.fillStyle = 'rgba(238,245,255,0.6)'; ctx.font = '600 11px sans-serif';
        ctx.textAlign = 'center'; ctx.textBaseline = 'top';
        ctx.fillText('HEAD BALL ONLINE', CANVAS_W / 2, py + 18);

        ctx.fillStyle = '#eef5ff'; ctx.font = 'bold 20px sans-serif';
        ctx.fillText(
            this.confirmed        ? 'Pronto! In attesa avversario...' :
            this.phase === 'waiting' ? 'In attesa di avversario...' :
            'Scegli il tuo personaggio',
            CANVAS_W / 2, py + 40
        );

        // Orb
        const orbX = CANVAS_W / 2, orbY = py + 135;
        const gg = ctx.createRadialGradient(orbX - 18, orbY - 18, 4, orbX, orbY, 48);
        gg.addColorStop(0, '#fff'); gg.addColorStop(0.5, char.accent); gg.addColorStop(1, char.jersey);
        ctx.beginPath(); ctx.arc(orbX, orbY, 48, 0, Math.PI * 2);
        ctx.fillStyle = gg; ctx.fill();
        ctx.strokeStyle = 'rgba(255,255,255,0.25)'; ctx.lineWidth = 2; ctx.stroke();

        ctx.fillStyle = '#eef5ff'; ctx.font = 'bold 17px sans-serif';
        ctx.fillText(char.name, CANVAS_W / 2, py + 205);

        if (!this.confirmed && this.phase === 'selection') {
            ctx.fillStyle = 'rgba(255,255,255,0.5)'; ctx.font = '22px sans-serif';
            ctx.fillText('◀', orbX - 72, orbY + 4);
            ctx.fillText('▶', orbX + 72, orbY + 4);

            ctx.fillStyle = 'rgba(238,245,255,0.65)'; ctx.font = '13px sans-serif';
            ctx.fillText('A / D  per cambiare personaggio', CANVAS_W / 2, py + 244);
            ctx.fillStyle = 'rgba(104,214,141,0.9)'; ctx.font = 'bold 14px sans-serif';
            ctx.fillText('S  per confermare', CANVAS_W / 2, py + 268);
        } else if (this.confirmed) {
            ctx.fillStyle = '#68d68d'; ctx.font = 'bold 14px sans-serif';
            ctx.fillText('✓ Confermato!', CANVAS_W / 2, py + 252);
        }

        // Stato avversario
        const oppIdx = this.mySeat === 0 ? 1 : 0;
        const oppSel = this.selections[oppIdx];
        if (oppSel) {
            const oppName = CHAR_DEFS.find(c => c.id === oppSel.characterId)?.name ?? '?';
            const oppTxt  = oppSel.confirmed ? `Avversario pronto (${oppName})` : 'Avversario sta scegliendo...';
            ctx.fillStyle = 'rgba(238,245,255,0.45)'; ctx.font = '12px sans-serif';
            ctx.fillText(oppTxt, CANVAS_W / 2, py + ph - 18);
        }

        ctx.restore();
    }

    private gfxResult(ctx: CanvasRenderingContext2D): void {
        const px = CANVAS_W / 2 - 210, py = CANVAS_H / 2 - 90;
        ctx.save();
        ctx.fillStyle = 'rgba(9,18,32,0.94)';
        this.rrect(ctx, px, py, 420, 180, 28); ctx.fill();

        ctx.fillStyle = '#eef5ff'; ctx.font = 'bold 30px sans-serif';
        ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
        ctx.fillText(
            this.winner === 'draw'  ? 'Pareggio!' :
            this.winner === 'left'  ? 'Vince P1  🎉' : 'Vince P2  🎉',
            CANVAS_W / 2, CANVAS_H / 2 - 22
        );
        ctx.fillStyle = 'rgba(238,245,255,0.55)'; ctx.font = '14px sans-serif';
        ctx.fillText(`${this.score.left} - ${this.score.right}`, CANVAS_W / 2, CANVAS_H / 2 + 18);
        ctx.fillText('Attendi la prossima partita...', CANVAS_W / 2, CANVAS_H / 2 + 44);
        ctx.restore();
    }

    private rrect(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number): void {
        ctx.beginPath();
        ctx.moveTo(x + r, y);
        ctx.lineTo(x + w - r, y);    ctx.arcTo(x + w, y,     x + w, y + r,     r);
        ctx.lineTo(x + w, y + h - r); ctx.arcTo(x + w, y + h, x + w - r, y + h, r);
        ctx.lineTo(x + r, y + h);    ctx.arcTo(x,     y + h, x,     y + h - r, r);
        ctx.lineTo(x, y + r);        ctx.arcTo(x,     y,     x + r, y,         r);
        ctx.closePath();
    }
}