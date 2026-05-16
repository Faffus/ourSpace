/**
 * HEAD BALL ONLINE — Indie Dark
 *
 * Controlli in gioco:
 *   A / ← = sinistra    D / → = destra
 *   W / ↑ = salta (doppio salto)
 *   Click sinistro = teletrasporto verso palla (cooldown 15s)
 *
 * Selezione personaggio:
 *   A / ← = precedente   D / → = successivo
 *   S / ↵ Enter = conferma
 */

import { getCollisionSide } from '../common';
import { IncomingMsg, OutgoingMsg } from '../server';
import { GameClient, GameServer } from './game';
import { UserInput } from '../client/user-input';

// ─── COSTANTI ────────────────────────────────────────────────────────────────

const CW   = 1000;   // canvas width virtuale
const CH   = 500;    // canvas height virtuale
const GY   = 348;    // ground Y (suolo)
const GW   = 75;     // goal width
const GTY  = 72;     // goal top Y
const GPT  = 10;     // goal post thickness

const PW   = 68;     // player width
const PH   = 96;     // player height
const BR   = 22;     // ball radius

const P_SPEED   = 390;
const P_JUMP_V  = -1180;
const P_GRAV    = 3600;

const B_GRAV    = 1900;
const B_BSX     = 0.88;  // bounce side
const B_BTY     = 0.98;  // bounce top
const B_BGR     = 0.82;  // bounce ground
const B_FRIC    = 0.988;
const B_VSTOP   = 18;
const B_KVX     = 320;   // kickoff vx
const B_KVY     = -480;  // kickoff vy

const TP_DIST   = 50;
const TP_CD_MS  = 15000;

const CD_MS     = 3000;
const MATCH_MS  = 90000;

const DEF_CHAR  = 'classic';

const CHARS = [
    { id: 'classic', name: 'Classic', accent: '#00d8ff', jersey: '#006dff', trim: '#f7fdff' },
    { id: 'wizard',  name: 'Wizard',  accent: '#ffcf33', jersey: '#8b5cf6', trim: '#ffe680' },
    { id: 'ninja',   name: 'Ninja',   accent: '#28ff88', jersey: '#00a84f', trim: '#edfff5' },
];
const CHAR_IDS = new Set(CHARS.map(c => c.id));

// ─── TIPI ─────────────────────────────────────────────────────────────────────

type Seat = 0 | 1;

interface Inp  { moveX: number; jump: boolean; teleport: boolean; }
interface Sel  { characterId: string; confirmed: boolean; }
interface Ball { x: number; y: number; vx: number; vy: number; }
interface Ply  {
    seat: Seat; characterId: string;
    x: number; y: number; vx: number; vy: number;
    w: number; h: number; dir: number;
    onGround: boolean; jumpHeld: boolean; djUsed: boolean;
    tpHeld: boolean; inp: Inp;
}

// ─── HELPER ───────────────────────────────────────────────────────────────────

const clamp  = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));
const safeId = (id: unknown): string =>
    (typeof id === 'string' && CHAR_IDS.has(id.trim())) ? id.trim() : DEF_CHAR;

function mkInp(): Inp  { return { moveX: 0, jump: false, teleport: false }; }

function mkBall(dir = 0): Ball {
    return { x: CW / 2, y: GY - 160, vx: B_KVX * dir, vy: dir !== 0 ? B_KVY : 0 };
}

function mkPlayer(seat: Seat, charId: string): Ply {
    return {
        seat, characterId: charId,
        x: seat === 0 ? 110 : CW - 110 - PW, y: GY - PH,
        vx: 0, vy: 0, w: PW, h: PH, dir: seat === 0 ? 1 : -1,
        onGround: true, jumpHeld: false, djUsed: false, tpHeld: false,
        inp: mkInp(),
    };
}

// ─── COLLISIONI ───────────────────────────────────────────────────────────────

/*
 * getCollisionSide(r1, r2): ritorna il lato di r2 che r1 ha penetrato.
 * "top"   → r1 ha colpito il TOP di r2 (r1 viene da sopra)   → spingi r1 sopra r2
 * "bottom"→ r1 ha colpito il BOTTOM di r2                     → spingi r1 sotto r2
 * "left"  → r1 ha colpito la LEFT di r2                       → spingi r1 a sinistra di r2
 * "right" → r1 ha colpito la RIGHT di r2                      → spingi r1 a destra di r2
 */
function ballVsRect(b: Ball, r: {x:number;y:number;w:number;h:number}): boolean {
    const br   = { x: b.x - BR, y: b.y - BR, w: BR * 2, h: BR * 2 };
    const side = getCollisionSide(br, r);
    if (side === 'none') return false;
    // FIX: segni corretti rispetto alla semantica di getCollisionSide
    if (side === 'top')    { b.y = r.y - BR;          b.vy = -Math.abs(b.vy) * B_BTY;  }
    if (side === 'bottom') { b.y = r.y + r.h + BR;    b.vy =  Math.abs(b.vy) * B_BTY;  }
    if (side === 'left')   { b.x = r.x - BR;          b.vx = -Math.abs(b.vx) * B_BSX;  }
    if (side === 'right')  { b.x = r.x + r.w + BR;    b.vx =  Math.abs(b.vx) * B_BSX;  }
    return true;
}

function ballVsPlayer(b: Ball, p: Ply): void {
    const cx = p.x + p.w / 2;

    // Testa
    const hR  = p.w * 0.48, hCY = p.y + p.h * 0.26;
    const dxH = b.x - cx,   dyH = b.y - hCY;
    const dH  = Math.sqrt(dxH * dxH + dyH * dyH);

    // Piede
    const fR  = p.w * 0.20, fCY = p.y + p.h * 0.88;
    const dxF = b.x - cx,   dyF = b.y - fCY;
    const dF  = Math.sqrt(dxF * dxF + dyF * dyF);

    const hitH = dH < hR + BR;
    const hitF = !hitH && dF < fR + BR;  // FIX: piede solo se testa non colpita
    if (!hitH && !hitF) return;

    const pDir = p.seat === 0 ? 1 : -1;
    const spd  = Math.sqrt(b.vx * b.vx + b.vy * b.vy);

    if (hitH) {
        const s  = Math.max(dH, 0.001);
        const nx = dxH / s, ny = dyH / s;
        const sp = clamp(Math.max(560, spd), 560, 880);
        b.vx = clamp(nx * sp * 0.50 + pDir * 0.18 * sp + p.vx * 0.15, -700, 700);
        b.vy = clamp(Math.min(ny * sp * 0.50 + (ny < -0.3 ? -920 : -800), -640), -1050, -640);
        const pen = hR + BR - dH;
        b.x += nx * pen; b.y += ny * pen;
    } else {
        const s  = Math.max(dF, 0.001);
        const nx = dxF / s, ny = dyF / s;
        const sp = clamp(Math.max(600, spd * 1.15), 600, 1000);
        b.vx = clamp(nx * sp * 0.90 + pDir * sp * 0.25 + p.vx * 0.25, -1000, 1000);
        b.vy = clamp(Math.min(ny * sp * 0.5 - 480, -350), -850, -350);
        const pen = fR + BR - dF;
        b.x += nx * pen; b.y += ny * pen;
    }
}

function ballVsGoal(b: Ball, goalX: number, isLeft: boolean): void {
    const goalH = GY - GTY;
    const backX = isLeft ? goalX : goalX + GW - GPT;
    ballVsRect(b, { x: backX, y: GTY, w: GPT, h: goalH });       // palo di fondo
    ballVsRect(b, { x: goalX, y: GTY, w: GW,  h: GPT });         // traversa
}

// ─── SERVER ───────────────────────────────────────────────────────────────────

export class HeadBallServer extends GameServer {

    private phase: 'selection'|'countdown'|'playing'|'finished' = 'selection';
    private players: Record<string, Ply> = {};
    private order: string[] = [];
    private sels: Sel[] = [
        { characterId: DEF_CHAR, confirmed: false },
        { characterId: DEF_CHAR, confirmed: false },
    ];
    private ball: Ball = mkBall();
    private score = { left: 0, right: 0 };
    private timeMs = MATCH_MS;
    private cdMs   = CD_MS;
    private winner: 'left'|'right'|'draw'|null = null;
    private tpCd: [number, number] = [0, 0];

    init(players: Record<string, any>): void {
        this.order  = Object.keys(players);
        this.phase  = 'selection';
        this.score  = { left: 0, right: 0 };
        this.winner = null;
        this.tpCd   = [0, 0];
        this.sels   = [
            { characterId: DEF_CHAR, confirmed: false },
            { characterId: DEF_CHAR, confirmed: false },
        ];
        this.order.forEach((id, i) => { this.players[id] = mkPlayer(i as Seat, DEF_CHAR); });
        this.ball = mkBall();
    }

    tick(msgs: IncomingMsg[], dt: number): OutgoingMsg[] {
        // ── Messaggi ──
        for (const msg of msgs) {
            const p   = this.players[msg.clientId];
            if (!p) continue;
            const pay  = msg.payload;
            const seat = p.seat;

            if (pay.kind === 'input' && this.phase === 'playing') {
                p.inp = {
                    moveX:    typeof pay.moveX    === 'number'  ? clamp(pay.moveX, -1, 1) : p.inp.moveX,
                    jump:     typeof pay.jump     === 'boolean' ? pay.jump     : p.inp.jump,
                    teleport: typeof pay.teleport === 'boolean' ? pay.teleport : p.inp.teleport,
                };
            }
            if (pay.kind === 'selection:update' && this.phase === 'selection' && !this.sels[seat].confirmed) {
                this.sels[seat].characterId = safeId(pay.characterId);
            }
            if (pay.kind === 'selection:confirm' && this.phase === 'selection' && !this.sels[seat].confirmed) {
                this.sels[seat].characterId = safeId(pay.characterId ?? this.sels[seat].characterId);
                this.sels[seat].confirmed   = true;
                if (this.sels[0].confirmed && this.sels[1].confirmed) this.goCountdown();
            }
        }

        // ── Fasi ──
        if (this.phase === 'countdown') {
            this.cdMs -= dt * 1000;
            if (this.cdMs <= 0) this.goPlaying();
        }
        if (this.phase === 'playing') {
            this.timeMs -= dt * 1000;
            if (this.timeMs <= 0) this.goFinished();
            else                  this.physics(dt);
        }

        return [{ payload: this.snap() }];
    }

    isFinished(): boolean { return this.phase === 'finished'; }

    // ── Transizioni ──

    private goCountdown(): void {
        this.phase  = 'countdown'; this.cdMs = CD_MS;
        this.score  = { left: 0, right: 0 }; this.winner = null; this.tpCd = [0, 0];
        this.ball   = mkBall();
        this.order.forEach((id, i) => { this.players[id] = mkPlayer(i as Seat, this.sels[i].characterId); });
    }
    private goPlaying(): void {
        this.phase  = 'playing'; this.timeMs = MATCH_MS; this.tpCd = [0, 0];
        this.ball   = mkBall(Math.random() < 0.5 ? -1 : 1);
        this.order.forEach((id, i) => { this.players[id] = mkPlayer(i as Seat, this.sels[i].characterId); });
    }
    private afterGoal(scorer: Seat): void {
        this.ball = mkBall(scorer === 0 ? -1 : 1);
        this.order.forEach((id, i) => { this.players[id] = mkPlayer(i as Seat, this.sels[i].characterId); });
    }
    private goFinished(): void {
        this.phase  = 'finished';
        this.winner = this.score.left > this.score.right ? 'left'
                    : this.score.right > this.score.left ? 'right' : 'draw';
    }

    // ── Fisica ──

    private physics(dt: number): void {
        ([0, 1] as Seat[]).forEach(seat => {
            const p = this.players[this.order[seat]];
            if (!p) return;
            this.applyInp(p, seat, dt);
            p.vy += P_GRAV * dt;
            p.x  += p.vx * dt; p.y += p.vy * dt;
            // suolo
            if (p.y >= GY - p.h) { p.y = GY - p.h; p.vy = 0; p.onGround = true; p.djUsed = false; }
            else                  { p.onGround = false; }
            // soffitto
            if (p.y < 0) { p.y = 0; if (p.vy < 0) p.vy = 0; }
            // pareti (esclude zona porte)
            if (p.x < GW)        { p.x = GW;         p.vx = 0; }
            if (p.x > CW-GW-p.w) { p.x = CW-GW-p.w; p.vx = 0; }
        });

        const b = this.ball;
        b.vy += B_GRAV * dt;
        b.x  += b.vx * dt; b.y += b.vy * dt;

        // ── Rilevamento gol ──
        // La palla entra in porta se il suo centro è dentro la zona gol in altezza
        // FIX: condizione corretta — la palla deve essere sotto la traversa e sopra il suolo
        const inGoalZone = b.y > GTY + GPT && b.y < GY;

        if (b.x - BR < 0 && inGoalZone) {
            // Gol nella porta SINISTRA → punto a DESTRA
            this.score.right += 1; this.afterGoal(1); return;
        }
        if (b.x + BR > CW && inGoalZone) {
            // Gol nella porta DESTRA → punto a SINISTRA
            this.score.left += 1; this.afterGoal(0); return;
        }

        // ── Bordi campo (no porte) ──
        if (b.x - BR <= 0 && !inGoalZone)  { b.x = BR;       b.vx = Math.abs(b.vx) * B_BSX;  }
        if (b.x + BR >= CW && !inGoalZone) { b.x = CW - BR;  b.vx = -Math.abs(b.vx) * B_BSX; }
        if (b.y - BR <= 0)                 { b.y = BR;        b.vy = Math.abs(b.vy) * B_BTY;  }
        if (b.y + BR >= GY) {
            b.y   = GY - BR;
            b.vy *= -B_BGR;
            if (Math.abs(b.vy) < B_VSTOP) b.vy = 0;
            b.vx *= Math.pow(B_FRIC, dt * 60);
        }

        // ── Collisioni ──
        ([0, 1] as Seat[]).forEach(seat => {
            const p = this.players[this.order[seat]];
            if (p) ballVsPlayer(b, p);
        });
        ballVsGoal(b, 0, true);
        ballVsGoal(b, CW - GW, false);
    }

    private applyInp(p: Ply, seat: Seat, dt: number): void {
        p.vx = p.inp.moveX * P_SPEED;
        if (p.inp.moveX !== 0) p.dir = p.inp.moveX > 0 ? 1 : -1;

        // Salto con doppio salto
        if (p.inp.jump && !p.jumpHeld) {
            if (p.onGround)   { p.vy = P_JUMP_V; p.onGround = false; p.djUsed = false; }
            else if (!p.djUsed) { p.vy = P_JUMP_V; p.djUsed = true; }
        }
        p.jumpHeld = p.inp.jump;

        // Teletrasporto
        this.tpCd[seat] = Math.max(0, this.tpCd[seat] - dt * 1000);
        if (p.inp.teleport && !p.tpHeld && this.tpCd[seat] <= 0) {
            const b   = this.ball;
            const off = TP_DIST + BR + p.w / 2;
            p.x = clamp(seat === 0 ? b.x - off : b.x + off - p.w, GW, CW - GW - p.w);
            p.y = clamp(b.y - p.h / 2, 0, GY - p.h);
            p.vx = 0; p.vy = 0;
            this.tpCd[seat] = TP_CD_MS;
        }
        p.tpHeld = p.inp.teleport;
    }

    private snap(): object {
        const active = this.phase === 'playing' || this.phase === 'finished';
        return {
            phase:  this.phase,
            score:  { ...this.score },
            timeMs: Math.max(0, Math.round(this.phase === 'countdown' ? this.cdMs : this.timeMs)),
            ball:   active ? { ...this.ball } : null,
            players: this.order.map((id, i) => {
                const p = this.players[id];
                return { seat: p.seat, characterId: p.characterId, x: p.x, y: p.y, w: p.w, h: p.h, dir: p.dir, tpCdMs: this.tpCd[i as Seat] };
            }),
            sels:   this.sels.map(s => ({ ...s })),
            winner: this.winner,
        };
    }
}

// ─── CLIENT ───────────────────────────────────────────────────────────────────

export class HeadBallClient extends GameClient {

    // Stato dal server
    private phase     = 'selection';
    private sPlayers: any[] = [];
    private ball:     any   = null;
    private score     = { left: 0, right: 0 };
    private timeMs    = MATCH_MS;
    private sels:     any[] = [];
    private winner:   string | null = null;
    private mySeat    = -1;

    // Selezione locale
    private charIdx   = 0;
    private confirmed = false;

    // Input locale — traccia fronte per evitare spam
    private prevMoveX     = 0;
    private prevJump      = false;
    private prevTeleport  = false;
    private prevSelX      = 0;
    private prevConfirm   = false;   // fronte per S / Enter

    // Tasti extra (frecce + Enter) — aggiunti via listener custom
    // perché UserInput ascolta solo W/A/S/D
    private arrowLeft  = false;
    private arrowRight = false;
    private arrowUp    = false;
    private enterKey   = false;

    private clock  = 0;
    private outbox: any[] = [];

    // Scala canvas
    private fit = 1; private ox = 0; private oy = 0;

    constructor(ui: UserInput, myId: string) {
        super(ui, myId);
        // FIX PRINCIPALE: registra frecce e Enter separatamente
        // perché UserInput NON li gestisce
        this.registerExtraKeys();
    }

    private registerExtraKeys(): void {
        document.addEventListener('keydown', (e) => {
            if (e.repeat) return;
            if (e.code === 'ArrowLeft')  this.arrowLeft  = true;
            if (e.code === 'ArrowRight') this.arrowRight = true;
            if (e.code === 'ArrowUp')    this.arrowUp    = true;
            if (e.code === 'Enter')      this.enterKey   = true;
        });
        document.addEventListener('keyup', (e) => {
            if (e.code === 'ArrowLeft')  this.arrowLeft  = false;
            if (e.code === 'ArrowRight') this.arrowRight = false;
            if (e.code === 'ArrowUp')    this.arrowUp    = false;
            if (e.code === 'Enter')      this.enterKey   = false;
        });
        window.addEventListener('blur', () => {
            this.arrowLeft = false; this.arrowRight = false;
            this.arrowUp   = false; this.enterKey   = false;
        });
    }

    async init(players: Record<string, any>): Promise<void> {
        this.mySeat = Object.keys(players).indexOf(this.myId);
        return Promise.resolve();
    }

    // ── Ciclo ──

    draw(ctx: CanvasRenderingContext2D, dt: number): void {
        const { screenW, screenH } = this.userInput;
        this.fit = Math.min(screenW / CW, screenH / CH);
        this.ox  = (screenW - CW * this.fit) / 2;
        this.oy  = (screenH - CH * this.fit) / 2;
        this.clock += dt;

        this.readInput();

        ctx.fillStyle = '#07111c';
        ctx.fillRect(0, 0, screenW, screenH);
        ctx.save();
        ctx.translate(this.ox, this.oy);
        ctx.scale(this.fit, this.fit);
        ctx.beginPath(); ctx.rect(0, 0, CW, CH); ctx.clip();

        this.gBg(ctx);
        this.gPitch(ctx);

        if (this.phase !== 'waiting' && this.phase !== 'selection') {
            this.sPlayers.forEach(p => this.gPlayer(ctx, p));
            if (this.ball) this.gBall(ctx, this.ball);
        }
        if (this.phase === 'countdown') this.gCountdown(ctx);
        this.gHUD(ctx);
        if (this.phase === 'selection' || this.phase === 'waiting') this.gSelection(ctx);
        if (this.phase === 'finished') this.gResult(ctx);

        ctx.restore();
    }

    handleMessage(msg: any): void {
        if (!msg) return;
        if ('phase'   in msg) this.phase    = msg.phase;
        if ('score'   in msg) this.score    = msg.score;
        if ('timeMs'  in msg) this.timeMs   = msg.timeMs;
        if ('ball'    in msg) this.ball     = msg.ball;      // null OK (selezione)
        if ('players' in msg) this.sPlayers = msg.players;
        if ('sels'    in msg) this.sels     = msg.sels;
        if ('winner'  in msg) this.winner   = msg.winner;
        // Aggiorna mySeat se init non ha trovato l'id nell'ordine
        if (this.mySeat === -1 && msg.players) {
            const idx = (msg.players as any[]).findIndex((p: any) => p.seat !== undefined);
            // L'ordine corretto viene da init(); questo è solo un fallback
        }
    }

    flushMessages(): any[] {
        const out = [...this.outbox]; this.outbox = []; return out;
    }

    // Il framework smonta il client se isFinished() === true — teniamo false
    isFinished(): boolean { return false; }

    // ── Input ──

    private readInput(): void {
        const ui = this.userInput;

        // Valori effettivi combinando W/A/S/D + frecce
        const moveX    = ui.moveDirectionX !== 0 ? ui.moveDirectionX
                       : this.arrowLeft ? -1 : this.arrowRight ? 1 : 0;
        const moveUp   = ui.moveDirectionY < 0 || this.arrowUp;
        const moveDown = ui.moveDirectionY > 0;
        const confirm  = moveDown || this.enterKey;

        // ── Selezione ──
        if (this.phase === 'selection' && !this.confirmed) {
            // Cambio personaggio (fronte di salita su moveX)
            if (moveX !== this.prevSelX) {
                if (moveX > 0) {
                    this.charIdx = (this.charIdx + 1) % CHARS.length;
                    this.outbox.push({ kind: 'selection:update', characterId: CHARS[this.charIdx].id });
                } else if (moveX < 0) {
                    this.charIdx = (this.charIdx - 1 + CHARS.length) % CHARS.length;
                    this.outbox.push({ kind: 'selection:update', characterId: CHARS[this.charIdx].id });
                }
                this.prevSelX = moveX;
            }
            // Conferma (fronte — evita spam su tasto tenuto)
            if (confirm && !this.prevConfirm) {
                this.confirmed = true;
                this.outbox.push({ kind: 'selection:confirm', characterId: CHARS[this.charIdx].id });
            }
            this.prevConfirm = confirm;
            return;
        }

        // ── Gioco ──
        if (this.phase === 'playing') {
            const jump     = moveUp;
            const teleport = ui.isMouseLeftPressed;

            // Invia solo se qualcosa è cambiato (diff)
            if (moveX !== this.prevMoveX || jump !== this.prevJump || teleport !== this.prevTeleport) {
                this.prevMoveX    = moveX;
                this.prevJump     = jump;
                this.prevTeleport = teleport;
                this.outbox.push({ kind: 'input', moveX, jump, teleport });
            }
        }
    }

    // ── Grafica ──

    private gBg(ctx: CanvasRenderingContext2D): void {
        ctx.fillStyle = '#68c8ff'; ctx.fillRect(0, 0, CW, GY);
        ctx.fillStyle = '#239c3d'; ctx.fillRect(0, GY, CW, CH - GY);
        ctx.fillStyle = '#126d2b'; ctx.fillRect(0, GY, CW, 7);

        ctx.save();
        const clouds = [{ x:140,y:60,s:1.0,sp:.22 },{ x:390,y:48,s:1.18,sp:.18 },{ x:760,y:62,s:.95,sp:.15 }];
        clouds.forEach(c => {
            const x = c.x + (this.clock * c.sp * 18) % 240;
            ctx.globalAlpha = 0.28; ctx.fillStyle = '#fff';
            ctx.beginPath(); ctx.ellipse(x, c.y, 46*c.s, 18*c.s, 0, 0, Math.PI*2); ctx.fill();
            ctx.beginPath(); ctx.ellipse(x+28*c.s, c.y-8*c.s, 32*c.s, 14*c.s, 0, 0, Math.PI*2); ctx.fill();
        });
        ctx.restore();
    }

    private gPitch(ctx: CanvasRenderingContext2D): void {
        ctx.save();
        ctx.strokeStyle = 'rgba(255,255,255,0.35)'; ctx.lineWidth = 2; ctx.setLineDash([10, 8]);
        ctx.beginPath(); ctx.moveTo(CW/2, GTY); ctx.lineTo(CW/2, GY); ctx.stroke();
        ctx.setLineDash([]); ctx.restore();
        this.gGoal(ctx, 0, true);
        this.gGoal(ctx, CW - GW, false);
    }

    private gGoal(ctx: CanvasRenderingContext2D, gx: number, isLeft: boolean): void {
        const goalH = GY - GTY, T = GPT;
        const frontX = isLeft ? gx + GW - T : gx;
        const backX  = isLeft ? gx          : gx + GW - T;
        const netX   = isLeft ? backX + T : frontX + T;
        const netW   = GW - T * 2;

        // Rete
        ctx.fillStyle = 'rgba(160,200,240,0.10)'; ctx.fillRect(netX, GTY+T, netW, goalH-T);
        ctx.save();
        ctx.beginPath(); ctx.rect(netX, GTY+T, netW, goalH-T); ctx.clip();
        ctx.strokeStyle = 'rgba(210,235,255,0.35)'; ctx.lineWidth = 0.8;
        for (let x = netX+8; x < netX+netW; x += 8) { ctx.beginPath(); ctx.moveTo(x, GTY+T); ctx.lineTo(x, GY); ctx.stroke(); }
        for (let y = GTY+T+8; y < GY; y += 8)        { ctx.beginPath(); ctx.moveTo(netX, y); ctx.lineTo(netX+netW, y); ctx.stroke(); }
        ctx.restore();

        // Pali
        ctx.fillStyle = '#c0ccd8'; ctx.fillRect(frontX, GTY, T, goalH);
        ctx.globalAlpha = 0.55; ctx.fillStyle = '#7f8b96'; ctx.fillRect(backX, GTY+T, T, goalH-T);
        ctx.globalAlpha = 1;
        ctx.fillStyle = '#c0ccd8'; ctx.fillRect(gx, GTY, GW, T);  // traversa
    }

    private gPlayer(ctx: CanvasRenderingContext2D, p: any): void {
        if (!p) return;
        const char = CHARS.find(c => c.id === p.characterId) ?? CHARS[0];
        const cx   = p.x + p.w / 2;
        const hR   = p.w * 0.48, hCY = p.y + p.h * 0.26;

        ctx.save();
        // Ombra
        ctx.globalAlpha = 0.22; ctx.fillStyle = '#000';
        ctx.beginPath(); ctx.ellipse(cx, GY-2, p.w*0.42, 7, 0, 0, Math.PI*2); ctx.fill();
        ctx.globalAlpha = 1;

        // Scarpini
        const fR = p.w*0.18, fCY = p.y+p.h*0.88, sp = p.w*0.28;
        [-1,1].forEach(s => {
            const fx = cx + s * sp;
            ctx.fillStyle = '#1a1a2e'; ctx.beginPath(); ctx.ellipse(fx, fCY, fR, fR*0.75, 0, 0, Math.PI*2); ctx.fill();
            ctx.fillStyle = char.trim; ctx.beginPath(); ctx.ellipse(fx, fCY-fR*0.15, fR*0.9, fR*0.35, 0, 0, Math.PI*2); ctx.fill();
        });

        // Testa
        const g = ctx.createRadialGradient(cx-hR*0.3, hCY-hR*0.3, hR*0.1, cx, hCY, hR);
        g.addColorStop(0,'#ffe0c2'); g.addColorStop(0.7,'#f5c09a'); g.addColorStop(1,'#d4895a');
        ctx.beginPath(); ctx.arc(cx, hCY, hR, 0, Math.PI*2);
        ctx.fillStyle = g; ctx.fill();
        ctx.strokeStyle = 'rgba(0,0,0,0.18)'; ctx.lineWidth = 1.5; ctx.stroke();

        // Fascia maglia
        ctx.fillStyle = char.jersey;
        ctx.beginPath(); ctx.ellipse(cx, hCY-hR*0.78, hR*0.88, hR*0.32, 0, 0, Math.PI*2); ctx.fill();

        // Occhi
        const eO = hR*0.34, eY = hCY-hR*0.08;
        ctx.fillStyle = '#fff';
        [cx-eO, cx+eO].forEach(ex => { ctx.beginPath(); ctx.ellipse(ex, eY, hR*0.22, hR*0.26, 0, 0, Math.PI*2); ctx.fill(); });
        ctx.fillStyle = '#1a0a00';
        const d = p.dir ?? 1;
        [cx-eO, cx+eO].forEach(ex => { ctx.beginPath(); ctx.arc(ex + d*hR*0.06, eY+hR*0.04, hR*0.13, 0, Math.PI*2); ctx.fill(); });

        // Label P1/P2
        ctx.fillStyle = p.seat === 0 ? '#4ac7ff' : '#ff7272';
        ctx.font = `bold ${Math.round(hR*0.44)}px sans-serif`;
        ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
        ctx.fillText(p.seat === 0 ? 'P1' : 'P2', cx, hCY - hR*1.45);

        // Barra cooldown TP
        if (p.tpCdMs > 0) {
            const pct = 1 - p.tpCdMs / TP_CD_MS;
            ctx.fillStyle = 'rgba(0,0,0,0.4)'; ctx.fillRect(p.x, p.y-10, p.w, 4);
            ctx.fillStyle = '#ffc66e';          ctx.fillRect(p.x, p.y-10, p.w*pct, 4);
        }

        ctx.restore();
    }

    private gBall(ctx: CanvasRenderingContext2D, b: any): void {
        const { x, y } = b;
        ctx.save();
        ctx.globalAlpha = 0.18; ctx.fillStyle = '#000';
        ctx.beginPath(); ctx.ellipse(x, GY-3, BR*0.9, BR*0.3, 0, 0, Math.PI*2); ctx.fill();
        ctx.globalAlpha = 1;

        const g = ctx.createRadialGradient(x-BR*0.35, y-BR*0.35, BR*0.05, x, y, BR);
        g.addColorStop(0,'#fff'); g.addColorStop(0.4,'#f0f0f0'); g.addColorStop(1,'#9090a0');
        ctx.beginPath(); ctx.arc(x, y, BR, 0, Math.PI*2);
        ctx.fillStyle = g; ctx.fill();
        ctx.strokeStyle = '#555'; ctx.lineWidth = 1.5; ctx.stroke();

        ctx.strokeStyle = '#333'; ctx.lineWidth = 1;
        const v = [[0,-1],[0.951,-0.309],[0.588,0.809],[-0.588,0.809],[-0.951,-0.309]];
        ctx.beginPath();
        v.forEach(([vx,vy],i) => {
            const px = x + vx*BR*0.48, py = y + vy*BR*0.48;
            i === 0 ? ctx.moveTo(px,py) : ctx.lineTo(px,py);
        });
        ctx.closePath(); ctx.stroke();
        ctx.restore();
    }

    private gHUD(ctx: CanvasRenderingContext2D): void {
        const tot  = Math.ceil(Math.max(0, this.timeMs) / 1000);
        const time = this.phase === 'countdown'
            ? String(Math.max(0, Math.ceil(this.timeMs / 1000)))
            : `${String(Math.floor(tot/60)).padStart(2,'0')}:${String(tot%60).padStart(2,'0')}`;

        ctx.save();
        ctx.font = 'bold 28px sans-serif'; ctx.textAlign = 'center'; ctx.textBaseline = 'top';
        ctx.fillStyle = 'rgba(0,0,0,0.5)';
        ctx.fillText(String(this.score.left),  162, 14);
        ctx.fillText(time,                     CW/2+1, 14);
        ctx.fillText(String(this.score.right), CW-158, 14);
        ctx.fillStyle = '#4ac7ff'; ctx.fillText(String(this.score.left),  160, 12);
        ctx.fillStyle = '#fff';    ctx.fillText(time,                     CW/2, 12);
        ctx.fillStyle = '#ff7272'; ctx.fillText(String(this.score.right), CW-160, 12);
        ctx.restore();
    }

    private gCountdown(ctx: CanvasRenderingContext2D): void {
        ctx.save();
        ctx.fillStyle = 'rgba(7,12,20,0.55)'; ctx.fillRect(0, 0, CW, CH);
        const n = Math.max(0, Math.ceil(this.timeMs / 1000));
        ctx.fillStyle = '#fff'; ctx.font = '800 96px sans-serif';
        ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
        ctx.fillText(n > 0 ? String(n) : 'Via!', CW/2, CH/2-16);
        ctx.font = '600 18px sans-serif'; ctx.fillStyle = 'rgba(228,238,255,0.8)';
        ctx.fillText('Pronti?', CW/2, CH/2+44);
        ctx.restore();
    }

    private gSelection(ctx: CanvasRenderingContext2D): void {
        const px = CW/2-220, py = CH/2-170, pw = 440, ph = 340;
        ctx.save();
        ctx.fillStyle = 'rgba(9,18,32,0.92)';
        this.rr(ctx, px, py, pw, ph, 24); ctx.fill();
        ctx.strokeStyle = 'rgba(255,255,255,0.15)'; ctx.lineWidth = 1.5;
        this.rr(ctx, px, py, pw, ph, 24); ctx.stroke();

        const char = CHARS[this.charIdx];
        ctx.textAlign = 'center'; ctx.textBaseline = 'top';

        ctx.fillStyle = 'rgba(238,245,255,0.6)'; ctx.font = '11px sans-serif';
        ctx.fillText('HEAD BALL ONLINE', CW/2, py+18);

        ctx.fillStyle = '#eef5ff'; ctx.font = 'bold 20px sans-serif';
        ctx.fillText(
            this.confirmed           ? 'Pronto! In attesa avversario...' :
            this.phase === 'waiting' ? 'In attesa di avversario...'      :
                                       'Scegli il tuo personaggio',
            CW/2, py+40
        );

        // Orb personaggio
        const ox2 = CW/2, oy2 = py+135;
        const gg = ctx.createRadialGradient(ox2-18, oy2-18, 4, ox2, oy2, 48);
        gg.addColorStop(0,'#fff'); gg.addColorStop(0.5, char.accent); gg.addColorStop(1, char.jersey);
        ctx.beginPath(); ctx.arc(ox2, oy2, 48, 0, Math.PI*2);
        ctx.fillStyle = gg; ctx.fill();
        ctx.strokeStyle = 'rgba(255,255,255,0.25)'; ctx.lineWidth = 2; ctx.stroke();

        ctx.fillStyle = '#eef5ff'; ctx.font = 'bold 17px sans-serif';
        ctx.fillText(char.name, CW/2, py+205);

        if (!this.confirmed && this.phase === 'selection') {
            // Frecce visive
            ctx.fillStyle = 'rgba(255,255,255,0.5)'; ctx.font = '22px sans-serif';
            ctx.textBaseline = 'middle';
            ctx.fillText('◀', ox2-72, oy2); ctx.fillText('▶', ox2+72, oy2);
            ctx.textBaseline = 'top';
            ctx.fillStyle = 'rgba(238,245,255,0.65)'; ctx.font = '13px sans-serif';
            ctx.fillText('A / ←  ·  D / →   per cambiare', CW/2, py+244);
            ctx.fillStyle = 'rgba(104,214,141,0.9)'; ctx.font = 'bold 14px sans-serif';
            ctx.fillText('S / Enter   per confermare', CW/2, py+268);
        } else if (this.confirmed) {
            ctx.fillStyle = '#68d68d'; ctx.font = 'bold 14px sans-serif';
            ctx.fillText('✓ Confermato!', CW/2, py+252);
        }

        // Stato avversario
        const oppSel = this.sels[this.mySeat === 0 ? 1 : 0];
        if (oppSel) {
            const oppName = CHARS.find(c => c.id === oppSel.characterId)?.name ?? '?';
            ctx.fillStyle = 'rgba(238,245,255,0.45)'; ctx.font = '12px sans-serif';
            ctx.fillText(
                oppSel.confirmed ? `Avversario pronto (${oppName})` : 'Avversario sta scegliendo...',
                CW/2, py+ph-18
            );
        }
        ctx.restore();
    }

    private gResult(ctx: CanvasRenderingContext2D): void {
        const px = CW/2-210, py = CH/2-90;
        ctx.save();
        ctx.fillStyle = 'rgba(9,18,32,0.94)'; this.rr(ctx, px, py, 420, 180, 28); ctx.fill();
        ctx.fillStyle = '#eef5ff'; ctx.font = 'bold 30px sans-serif';
        ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
        ctx.fillText(
            this.winner === 'draw' ? 'Pareggio!' : this.winner === 'left' ? 'Vince P1  🎉' : 'Vince P2  🎉',
            CW/2, CH/2-22
        );
        ctx.fillStyle = 'rgba(238,245,255,0.55)'; ctx.font = '14px sans-serif';
        ctx.fillText(`${this.score.left} - ${this.score.right}`, CW/2, CH/2+18);
        ctx.fillText('Attendi la prossima partita...', CW/2, CH/2+44);
        ctx.restore();
    }

    private rr(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number): void {
        ctx.beginPath();
        ctx.moveTo(x+r, y); ctx.lineTo(x+w-r, y); ctx.arcTo(x+w, y,     x+w, y+r,     r);
        ctx.lineTo(x+w, y+h-r);                    ctx.arcTo(x+w, y+h,   x+w-r, y+h,   r);
        ctx.lineTo(x+r, y+h);                      ctx.arcTo(x,   y+h,   x,     y+h-r, r);
        ctx.lineTo(x, y+r);                        ctx.arcTo(x,   y,     x+r,   y,     r);
        ctx.closePath();
    }
}