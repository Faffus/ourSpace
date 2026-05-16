/**
 * ═══════════════════════════════════════════════════════════════
 *  HEAD BALL ONLINE  —  Indie Dark
 *  Gioco multiplayer 1v1 adattato al framework ourSpace.
 * ═══════════════════════════════════════════════════════════════
 *
 *  ARCHITETTURA CLIENT / SERVER
 *  ─────────────────────────────
 *  SERVER (HeadBallServer) — gira su Node.js, unica fonte di verità:
 *    • Calcola tutta la fisica (posizioni, velocità, collisioni)
 *    • Gestisce lo spawn e la raccolta delle bolle superpoteri
 *    • Valida i goal e aggiorna il punteggio
 *    • Gestisce il cooldown del Teleport
 *    • Invia uno snapshot dello stato ogni tick (~30/s)
 *
 *  CLIENT (HeadBallClient) — gira nel browser:
 *    • Mostra il manuale di gioco al primo avvio
 *    • Legge la tastiera e invia i comandi al server
 *    • Riceve gli snapshot e disegna il canvas
 *    • NON calcola fisica: mostra solo ciò che il server dice
 *
 *  CONTROLLI
 *  ──────────
 *    A / ←        muovi sinistra
 *    D / →        muovi destra
 *    W / ↑        salta  (doppio salto disponibile in aria)
 *    F            Teleport: scatto in avanti (cooldown 10s)
 *
 *  SUPERPOTERI BOLLA
 *    Le bolle appaiono sul campo ogni 15s.
 *    Cammina sopra una bolla per raccoglierla e attivarne l'effetto:
 *      ❄ ICE      — congela l'avversario per 3s
 *      💪 BIG HEAD — testa più grande per 5s (hitbox allargata)
 *
 *  SELEZIONE PERSONAGGIO
 *    A / ←   personaggio precedente    D / →   successivo
 *    S / Enter  conferma
 */

import { getCollisionSide } from '../common';
import { IncomingMsg, OutgoingMsg } from '../server';
import { GameClient, GameServer } from './game';
import { UserInput } from '../client/user-input';

// ═══════════════════════════════════════════════════════════════
//  COSTANTI
// ═══════════════════════════════════════════════════════════════

// Canvas virtuale: tutto il codice usa queste unità, poi il client
// scala al viewport reale → risoluzione dinamica garantita.
const CW  = 1000;   // larghezza canvas virtuale (px)
const CH  = 500;    // altezza canvas virtuale (px)
const GY  = 348;    // Y del suolo
const GW  = 75;     // larghezza porta
const GTY = 72;     // Y cima porta
const GPT = 10;     // spessore pali porta

// Giocatore
const PW = 68;
const PH = 96;

// Fisica palla
const BR      = 22;
const B_GRAV  = 1900;
const B_BSX   = 0.88;
const B_BTY   = 0.98;
const B_BGR   = 0.82;
const B_FRIC  = 0.988;
const B_VSTOP = 18;
const B_KVX   = 320;
const B_KVY   = -480;

// Fisica giocatore
const P_SPEED  = 390;
const P_JUMP_V = -1180;
const P_GRAV   = 3600;

// Durate di gioco
const CD_MS    = 3000;
const MATCH_MS = 90000;

// ── Teleport (unico superpotere da tastiera) ──────────────────
const TP_DIST  = 180;    // distanza scatto in px
const TP_CD_MS = 10000;  // cooldown 10s

// ── Superpoteri bolla ─────────────────────────────────────────
// Le bolle spawnano sul campo. Il giocatore le raccoglie
// toccandole. Al momento della raccolta, parte un timer di
// 15s dopo il quale appare una nuova bolla con tipo casuale.
const BUBBLE_SPAWN_MS  = 15000;  // intervallo spawn bolla (ms)
const BUBBLE_RADIUS    = 20;     // raggio bolla (px)
const ICE_DUR_MS       = 3000;   // durata congelamento (3s)
const BH_DUR_MS        = 5000;   // durata big head (5s)
const BH_HEAD_MULT     = 1.6;    // moltiplicatore raggio testa

const DEF_CHAR = 'classic';

const CHARS = [
    { id: 'classic', name: 'Classic', accent: '#00d8ff', jersey: '#006dff', trim: '#ffffff' },
    { id: 'wizard',  name: 'Wizard',  accent: '#ffcf33', jersey: '#8b5cf6', trim: '#ffe680' },
    { id: 'ninja',   name: 'Ninja',   accent: '#28ff88', jersey: '#00a84f', trim: '#edfff5' },
];
const CHAR_IDS = new Set(CHARS.map(c => c.id));

// ═══════════════════════════════════════════════════════════════
//  TIPI
// ═══════════════════════════════════════════════════════════════

type Seat  = 0 | 1;
type Phase = 'selection' | 'countdown' | 'playing' | 'finished';

/** I tipi di superpotere che una bolla può contenere. */
type PowerupType = 'ice' | 'bighead';

/** Input inviato dal client al server ogni volta che cambia. */
interface Inp {
    moveX:    number;   // -1 | 0 | 1
    jump:     boolean;
    teleport: boolean;  // tasto F
}

interface Sel  { characterId: string; confirmed: boolean; }
interface Ball { x: number; y: number; vx: number; vy: number; }

/**
 * Bolla superpotere sul campo.
 * Spawnata dal server, raccolta quando un giocatore la tocca.
 */
interface Bubble {
    x:    number;
    y:    number;
    type: PowerupType;
}

/** Stato completo di un giocatore (lato server). */
interface Ply {
    seat:        Seat;
    characterId: string;
    x: number; y: number; vx: number; vy: number;
    w: number; h: number;
    dir:         number;      // +1 destra, -1 sinistra
    onGround:    boolean;
    jumpHeld:    boolean;
    djUsed:      boolean;     // doppio salto già usato in aria?
    tpHeld:      boolean;
    inp:         Inp;
    tpCdMs:      number;      // cooldown teleport rimanente (ms)
    frozenMs:    number;      // ms rimanenti di congelamento (0 = libero)
    bigHeadMs:   number;      // ms rimanenti di big head (0 = normale)
}

// ═══════════════════════════════════════════════════════════════
//  HELPER
// ═══════════════════════════════════════════════════════════════

const clamp  = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));
const safeId = (id: unknown): string =>
    (typeof id === 'string' && CHAR_IDS.has(id.trim())) ? id.trim() : DEF_CHAR;

function mkInp(): Inp {
    return { moveX: 0, jump: false, teleport: false };
}

function mkBall(dir = 0): Ball {
    return { x: CW / 2, y: GY - 160, vx: B_KVX * dir, vy: dir !== 0 ? B_KVY : 0 };
}

function mkPlayer(seat: Seat, charId: string): Ply {
    return {
        seat, characterId: charId,
        x: seat === 0 ? 110 : CW - 110 - PW, y: GY - PH,
        vx: 0, vy: 0, w: PW, h: PH,
        dir: seat === 0 ? 1 : -1,
        onGround: true, jumpHeld: false, djUsed: false, tpHeld: false,
        inp: mkInp(),
        tpCdMs: 0, frozenMs: 0, bigHeadMs: 0,
    };
}

/**
 * Genera una bolla in una posizione casuale al centro del campo,
 * evitando le zone porta e il suolo.
 */
function mkBubble(): Bubble {
    const type: PowerupType = Math.random() < 0.5 ? 'ice' : 'bighead';
    const x = GW + 100 + Math.random() * (CW - GW * 2 - 200);
    const y = GTY + 60  + Math.random() * (GY - GTY - 120);
    return { x, y, type };
}

// ═══════════════════════════════════════════════════════════════
//  COLLISIONI
// ═══════════════════════════════════════════════════════════════

/**
 * Rimbalzo della palla contro un rettangolo (pali, traversa).
 * getCollisionSide restituisce il lato di r2 penetrato da r1:
 *   "top"    → spingi r1 sopra r2, inverti vy
 *   "bottom" → spingi r1 sotto r2, inverti vy
 *   "left"   → spingi r1 a sinistra di r2, inverti vx
 *   "right"  → spingi r1 a destra di r2, inverti vx
 */
function ballVsRect(b: Ball, r: { x: number; y: number; w: number; h: number }): boolean {
    const br   = { x: b.x - BR, y: b.y - BR, w: BR * 2, h: BR * 2 };
    const side = getCollisionSide(br, r);
    if (side === 'none') return false;
    if (side === 'top')    { b.y = r.y - BR;       b.vy = -Math.abs(b.vy) * B_BTY; }
    if (side === 'bottom') { b.y = r.y + r.h + BR; b.vy =  Math.abs(b.vy) * B_BTY; }
    if (side === 'left')   { b.x = r.x - BR;       b.vx = -Math.abs(b.vx) * B_BSX; }
    if (side === 'right')  { b.x = r.x + r.w + BR; b.vx =  Math.abs(b.vx) * B_BSX; }
    return true;
}

/**
 * Collisione palla vs giocatore — testa (priorità) e piede.
 * headRadius è variabile per supportare Big Head sia fisicamente
 * che graficamente con lo stesso valore.
 */
function ballVsPlayer(b: Ball, p: Ply, headRadius: number): void {
    const cx  = p.x + p.w / 2;

    // Zona testa
    const hCY = p.y + p.h * 0.26;
    const dxH = b.x - cx, dyH = b.y - hCY;
    const dH  = Math.sqrt(dxH * dxH + dyH * dyH);
    const hitH = dH < headRadius + BR;

    // Zona piede (solo se testa non colpita, evita doppia forza)
    const fR   = p.w * 0.20;
    const fCY  = p.y + p.h * 0.88;
    const dxF  = b.x - cx, dyF = b.y - fCY;
    const dF   = Math.sqrt(dxF * dxF + dyF * dyF);
    const hitF = !hitH && dF < fR + BR;

    if (!hitH && !hitF) return;

    const pDir = p.seat === 0 ? 1 : -1;
    const spd  = Math.sqrt(b.vx * b.vx + b.vy * b.vy);

    if (hitH) {
        const s  = Math.max(dH, 0.001);
        const nx = dxH / s, ny = dyH / s;
        const sp = clamp(Math.max(560, spd), 560, 880);
        b.vx = clamp(nx * sp * 0.50 + pDir * 0.18 * sp + p.vx * 0.15, -700, 700);
        b.vy = clamp(Math.min(ny * sp * 0.50 + (ny < -0.3 ? -920 : -800), -640), -1050, -640);
        // Correzione penetrazione: evita che la palla resti "dentro" la testa
        b.x += nx * (headRadius + BR - dH);
        b.y += ny * (headRadius + BR - dH);
    } else {
        const s  = Math.max(dF, 0.001);
        const nx = dxF / s, ny = dyF / s;
        const sp = clamp(Math.max(600, spd * 1.15), 600, 1000);
        b.vx = clamp(nx * sp * 0.90 + pDir * sp * 0.25 + p.vx * 0.25, -1000, 1000);
        b.vy = clamp(Math.min(ny * sp * 0.5 - 480, -350), -850, -350);
        b.x += nx * (fR + BR - dF);
        b.y += ny * (fR + BR - dF);
    }
}

/** Rimbalzi sui pali e traversa della porta. */
function ballVsGoalFrame(b: Ball, goalX: number, isLeft: boolean): void {
    const goalH = GY - GTY;
    const backX = isLeft ? goalX : goalX + GW - GPT;
    ballVsRect(b, { x: backX, y: GTY, w: GPT, h: goalH });
    ballVsRect(b, { x: goalX, y: GTY, w: GW,  h: GPT  });
}

// ═══════════════════════════════════════════════════════════════
//  SERVER
// ═══════════════════════════════════════════════════════════════

export class HeadBallServer extends GameServer {

    private phase:  Phase = 'selection';
    private players: Record<string, Ply> = {};
    private order:   string[] = [];
    private sels:    Sel[]    = [
        { characterId: DEF_CHAR, confirmed: false },
        { characterId: DEF_CHAR, confirmed: false },
    ];
    private ball:   Ball   = mkBall();
    private score          = { left: 0, right: 0 };
    private timeMs         = MATCH_MS;
    private cdMs           = CD_MS;
    private winner: 'left' | 'right' | 'draw' | null = null;

    // ── Bolle superpotere ─────────────────────────────────────
    // bubbleSpawnMs: conto alla rovescia fino al prossimo spawn.
    // bubble: la bolla attualmente sul campo (null se non c'è).
    private bubble:        Bubble | null = null;
    private bubbleSpawnMs: number        = BUBBLE_SPAWN_MS;

    // ── Lifecycle ────────────────────────────────────────────────

    init(players: Record<string, any>): void {
        this.order  = Object.keys(players);
        this.phase  = 'selection';
        this.score  = { left: 0, right: 0 };
        this.winner = null;
        this.sels   = [
            { characterId: DEF_CHAR, confirmed: false },
            { characterId: DEF_CHAR, confirmed: false },
        ];
        this.order.forEach((id, i) => { this.players[id] = mkPlayer(i as Seat, DEF_CHAR); });
        this.ball          = mkBall();
        this.bubble        = null;
        this.bubbleSpawnMs = BUBBLE_SPAWN_MS;
    }

    tick(msgs: IncomingMsg[], dt: number): OutgoingMsg[] {
        this.processMessages(msgs);
        this.updatePhase(dt);
        return [{ payload: this.buildSnapshot() }];
    }

    isFinished(): boolean {
        return this.phase === 'finished';
    }

    // ── Messaggi ─────────────────────────────────────────────────

    private processMessages(msgs: IncomingMsg[]): void {
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
    }

    // ── Transizioni di fase ──────────────────────────────────────

    private updatePhase(dt: number): void {
        if (this.phase === 'countdown') {
            this.cdMs -= dt * 1000;
            if (this.cdMs <= 0) this.goPlaying();
        }
        if (this.phase === 'playing') {
            this.timeMs -= dt * 1000;
            if (this.timeMs <= 0) this.goFinished();
            else                  this.physics(dt);
        }
    }

    private goCountdown(): void {
        this.phase  = 'countdown'; this.cdMs = CD_MS;
        this.score  = { left: 0, right: 0 }; this.winner = null;
        this.ball   = mkBall();
        this.bubble        = null;
        this.bubbleSpawnMs = BUBBLE_SPAWN_MS;
        this.order.forEach((id, i) => { this.players[id] = mkPlayer(i as Seat, this.sels[i].characterId); });
    }

    private goPlaying(): void {
        this.phase  = 'playing'; this.timeMs = MATCH_MS;
        this.ball   = mkBall(Math.random() < 0.5 ? -1 : 1);
        this.order.forEach((id, i) => { this.players[id] = mkPlayer(i as Seat, this.sels[i].characterId); });
    }

    private resetAfterGoal(scoringSeat: Seat): void {
        this.ball = mkBall(scoringSeat === 0 ? -1 : 1);
        this.order.forEach((id, i) => { this.players[id] = mkPlayer(i as Seat, this.sels[i].characterId); });
    }

    private goFinished(): void {
        this.phase  = 'finished';
        this.winner = this.score.left > this.score.right ? 'left'
                    : this.score.right > this.score.left ? 'right'
                    : 'draw';
    }

    // ── Motore fisico ────────────────────────────────────────────

    private physics(dt: number): void {
        const dtMs = dt * 1000;

        ([0, 1] as Seat[]).forEach(seat => {
            const p = this.players[this.order[seat]];
            if (!p) return;

            // Decrementa timer effetti attivi
            p.frozenMs  = Math.max(0, p.frozenMs  - dtMs);
            p.bigHeadMs = Math.max(0, p.bigHeadMs - dtMs);
            p.tpCdMs    = Math.max(0, p.tpCdMs    - dtMs);

            // Se congelato: solo gravità, nessun input
            if (p.frozenMs > 0) {
                p.vx  = 0;
                p.vy += P_GRAV * dt;
                p.y  += p.vy * dt;
                if (p.y >= GY - p.h) { p.y = GY - p.h; p.vy = 0; }
                return;
            }

            this.applyInput(p, dt);

            p.vy += P_GRAV * dt;
            p.x  += p.vx * dt;
            p.y  += p.vy * dt;

            // Suolo
            if (p.y >= GY - p.h) { p.y = GY - p.h; p.vy = 0; p.onGround = true; p.djUsed = false; }
            else                  { p.onGround = false; }
            // Soffitto
            if (p.y < 0) { p.y = 0; if (p.vy < 0) p.vy = 0; }
            // Pareti (esclude zona porta)
            if (p.x < GW)          { p.x = GW;          p.vx = 0; }
            if (p.x > CW - GW - PW){ p.x = CW - GW - PW; p.vx = 0; }
        });

        this.updateBall(dt);
        this.updateBubble(dt);
    }

    private applyInput(p: Ply, dt: number): void {
        const inp = p.inp;

        // Movimento orizzontale
        p.vx = inp.moveX * P_SPEED;
        if (inp.moveX !== 0) p.dir = inp.moveX > 0 ? 1 : -1;

        // ── Salto con doppio salto ────────────────────────────────
        // jumpHeld: fronte del tasto, evita che tenere W
        // consumi immediatamente sia il salto che il doppio salto.
        if (inp.jump && !p.jumpHeld) {
            if (p.onGround) {
                // Primo salto da terra
                p.vy = P_JUMP_V; p.onGround = false; p.djUsed = false;
            } else if (!p.djUsed) {
                // Doppio salto in aria
                p.vy = P_JUMP_V; p.djUsed = true;
            }
        }
        p.jumpHeld = inp.jump;

        // ── Teleport (unico superpotere da tastiera) ──────────────
        // Scatto di TP_DIST px nella direzione corrente del giocatore.
        // Validato lato server: il client non può barare sul cooldown.
        if (inp.teleport && !p.tpHeld && p.tpCdMs <= 0) {
            const dir = inp.moveX !== 0 ? inp.moveX : p.dir;
            p.x      = clamp(p.x + dir * TP_DIST, GW, CW - GW - p.w);
            p.tpCdMs = TP_CD_MS;
        }
        p.tpHeld = inp.teleport;
    }

    // ── Bolle superpotere ─────────────────────────────────────────

    /**
     * Gestione dello spawn e della raccolta delle bolle.
     *
     * LOGICA:
     * 1. Se non c'è nessuna bolla sul campo, il timer scorre.
     * 2. Quando il timer arriva a 0, spawnamo una bolla casuale.
     * 3. Ogni tick, controlliamo se un giocatore tocca la bolla.
     *    Se sì: applica l'effetto al giocatore, rimuovi la bolla,
     *    e fai ripartire il timer per la prossima.
     */
    private updateBubble(dt: number): void {
        const dtMs = dt * 1000;

        // Fase 1: nessuna bolla presente → decrementa timer spawn
        if (this.bubble === null) {
            this.bubbleSpawnMs -= dtMs;
            if (this.bubbleSpawnMs <= 0) {
                this.bubble        = mkBubble();
                this.bubbleSpawnMs = BUBBLE_SPAWN_MS; // reset per la prossima
            }
            return;
        }

        // Fase 2: bolla presente → controlla raccolta da un giocatore
        const bub = this.bubble;
        for (const seat of [0, 1] as Seat[]) {
            const p = this.players[this.order[seat]];
            if (!p) continue;

            // Collisione cerchio (bolla) vs rettangolo (giocatore):
            // usiamo il punto del rettangolo più vicino al centro bolla.
            const nearX = clamp(bub.x, p.x, p.x + p.w);
            const nearY = clamp(bub.y, p.y, p.y + p.h);
            const dx    = bub.x - nearX;
            const dy    = bub.y - nearY;

            if (dx * dx + dy * dy < BUBBLE_RADIUS * BUBBLE_RADIUS) {
                // Il giocatore ha raccolto la bolla → applica effetto
                this.applyBubble(p, seat, bub.type);
                this.bubble        = null;  // bolla rimossa dal campo
                this.bubbleSpawnMs = BUBBLE_SPAWN_MS; // nuovo timer spawn
                break; // una sola raccolta per tick
            }
        }
    }

    /**
     * Applica l'effetto della bolla raccolta al giocatore p.
     * ICE: congela l'AVVERSARIO per ICE_DUR_MS.
     * BIGHEAD: ingrandisce la TESTA DEL RACCOGLITORE per BH_DUR_MS.
     */
    private applyBubble(p: Ply, seat: Seat, type: PowerupType): void {
        if (type === 'ice') {
            const oppId = this.order[1 - seat as Seat];
            if (oppId && this.players[oppId]) {
                this.players[oppId].frozenMs = ICE_DUR_MS;
            }
        } else {
            // bighead: effetto sul giocatore che l'ha raccolta
            p.bigHeadMs = BH_DUR_MS;
        }
    }

    private updateBall(dt: number): void {
        const b = this.ball;

        b.vy += B_GRAV * dt;
        b.x  += b.vx * dt;
        b.y  += b.vy * dt;

        // ── Rilevamento gol ───────────────────────────────────────
        // Il test usa il CENTRO della palla: se supera la linea di
        // porta mentre è nella zona altezza corretta → gol immediato,
        // nessun rimbalzo interno possibile.
        const inGoalZone = b.y > GTY + GPT && b.y < GY;

        if (b.x < GW && inGoalZone) {
            this.score.right += 1; this.resetAfterGoal(1); return;
        }
        if (b.x > CW - GW && inGoalZone) {
            this.score.left += 1;  this.resetAfterGoal(0); return;
        }

        // Bordi campo (disattivati nella zona porta per non bloccare il gol)
        if (b.x - BR <= 0 && !inGoalZone)  { b.x = BR;       b.vx =  Math.abs(b.vx) * B_BSX; }
        if (b.x + BR >= CW && !inGoalZone) { b.x = CW - BR;  b.vx = -Math.abs(b.vx) * B_BSX; }
        if (b.y - BR <= 0) { b.y = BR; b.vy = Math.abs(b.vy) * B_BTY; }
        if (b.y + BR >= GY) {
            b.y   = GY - BR;
            b.vy *= -B_BGR;
            if (Math.abs(b.vy) < B_VSTOP) b.vy = 0;
            b.vx *= Math.pow(B_FRIC, dt * 60);
        }

        // Collisioni palla vs giocatori
        ([0, 1] as Seat[]).forEach(seat => {
            const p = this.players[this.order[seat]];
            if (!p) return;
            const headR = p.w * 0.48 * (p.bigHeadMs > 0 ? BH_HEAD_MULT : 1);
            ballVsPlayer(b, p, headR);
        });

        // Rimbalzi pali/traversa (solo fuori dalla zona gol)
        if (!inGoalZone) {
            ballVsGoalFrame(b, 0, true);
            ballVsGoalFrame(b, CW - GW, false);
        }
    }

    // ── Snapshot ─────────────────────────────────────────────────

    private buildSnapshot(): object {
        const active = this.phase === 'playing' || this.phase === 'finished';
        return {
            phase:   this.phase,
            score:   { ...this.score },
            timeMs:  Math.max(0, Math.round(this.phase === 'countdown' ? this.cdMs : this.timeMs)),
            ball:    active ? { ...this.ball } : null,
            players: this.order.map(id => {
                const p = this.players[id];
                return {
                    seat: p.seat, characterId: p.characterId,
                    x: p.x, y: p.y, w: p.w, h: p.h, dir: p.dir,
                    tpCdMs:    p.tpCdMs,
                    frozenMs:  p.frozenMs,
                    bigHeadMs: p.bigHeadMs,
                };
            }),
            // La bolla viene inviata al client per il rendering
            bubble:  this.bubble ? { ...this.bubble } : null,
            // Tempo rimanente prima del prossimo spawn (per la UI)
            bubbleSpawnMs: this.bubble ? 0 : Math.max(0, Math.round(this.bubbleSpawnMs)),
            sels:    this.sels.map(s => ({ ...s })),
            winner:  this.winner,
        };
    }
}

// ═══════════════════════════════════════════════════════════════
//  CLIENT
// ═══════════════════════════════════════════════════════════════

export class HeadBallClient extends GameClient {

    // ── Stato dal server ──────────────────────────────────────────
    private phase          = 'selection';
    private sPlayers:  any[]        = [];
    private ball:      any          = null;
    private score          = { left: 0, right: 0 };
    private timeMs         = MATCH_MS;
    private sels:      any[]        = [];
    private winner:    string|null  = null;
    private mySeat         = -1;
    private bubble:    any          = null;
    private bubbleSpawnMs  = BUBBLE_SPAWN_MS;

    // ── Selezione personaggio ─────────────────────────────────────
    private charIdx   = 0;
    private confirmed = false;

    // ── Input diff ────────────────────────────────────────────────
    private prev         = { moveX: 0, jump: false, teleport: false };
    private prevSelX     = 0;
    private prevConfirm  = false;

    // ── Tasti extra (frecce, Enter, F) ────────────────────────────
    // UserInput del prof gestisce solo W/A/S/D.
    private keys: Record<string, boolean> = {};

    // ── Manuale di gioco ──────────────────────────────────────────
    // showManual: true finché il giocatore non clicca "Gioca!".
    // Il manuale appare sopra tutto, il gioco non parte prima.
    private showManual = true;

    private clock = 0;
    private outbox: any[] = [];
    private fit = 1; private ox = 0; private oy = 0;

    constructor(ui: UserInput, myId: string) {
        super(ui, myId);
        this.registerKeys();
        this.registerManualClick(ui);
    }

    /** Registra frecce, Enter e F — non gestiti da UserInput. */
    private registerKeys(): void {
        document.addEventListener('keydown', (e) => { if (!e.repeat) this.keys[e.code] = true;  });
        document.addEventListener('keyup',   (e) => { this.keys[e.code] = false; });
        window.addEventListener('blur',      ()  => { Object.keys(this.keys).forEach(k => { this.keys[k] = false; }); });
    }

    /**
     * Registra il click sul canvas per chiudere il manuale.
     * Usiamo le coordinate virtuali per capire se il click
     * è caduto sul pulsante "Gioca!".
     */
    private registerManualClick(ui: UserInput): void {
        ui.canvas.addEventListener('click', (e) => {
            if (!this.showManual) return;
            // Converti le coordinate schermo in coordinate virtuali
            const bounds = ui.canvas.getBoundingClientRect();
            const rawX   = (e.clientX - bounds.left) * (ui.canvas.width  / bounds.width);
            const rawY   = (e.clientY - bounds.top)  * (ui.canvas.height / bounds.height);
            const vx     = (rawX - this.ox) / this.fit;
            const vy     = (rawY - this.oy) / this.fit;
            // Area del pulsante "Gioca!" (centrato a CW/2, CH*0.78)
            const bw = 160, bh = 44;
            const bx = CW / 2 - bw / 2, by = CH * 0.72;
            if (vx >= bx && vx <= bx + bw && vy >= by && vy <= by + bh) {
                this.showManual = false;
            }
        });
    }

    async init(players: Record<string, any>): Promise<void> {
        this.mySeat = Object.keys(players).indexOf(this.myId);
        return Promise.resolve();
    }

    // ── Ciclo principale ──────────────────────────────────────────

    draw(ctx: CanvasRenderingContext2D, dt: number): void {
        const { screenW, screenH } = this.userInput;
        this.fit = Math.min(screenW / CW, screenH / CH);
        this.ox  = (screenW - CW * this.fit) / 2;
        this.oy  = (screenH - CH * this.fit) / 2;
        this.clock += dt;

        // Leggi input solo se il manuale è chiuso
        if (!this.showManual) this.readInput();

        ctx.fillStyle = '#07111c';
        ctx.fillRect(0, 0, screenW, screenH);

        ctx.save();
        ctx.translate(this.ox, this.oy);
        ctx.scale(this.fit, this.fit);
        ctx.beginPath(); ctx.rect(0, 0, CW, CH); ctx.clip();

        this.drawBackground(ctx);
        this.drawPitch(ctx);

        if (this.phase !== 'waiting' && this.phase !== 'selection') {
            this.sPlayers.forEach(p => this.drawPlayer(ctx, p));
            if (this.ball) this.drawBall(ctx, this.ball);
            if (this.bubble) this.drawBubble(ctx, this.bubble);
            this.drawBubbleTimer(ctx);
        }

        if (this.phase === 'countdown') this.drawCountdown(ctx);
        this.drawHUD(ctx);
        if (this.phase === 'selection' || this.phase === 'waiting') this.drawSelection(ctx);
        if (this.phase === 'finished') this.drawResult(ctx);

        // Il manuale si sovrappone a tutto
        if (this.showManual) this.drawManual(ctx);

        ctx.restore();
    }

    handleMessage(msg: any): void {
        if (!msg) return;
        if ('phase'         in msg) this.phase         = msg.phase;
        if ('score'         in msg) this.score         = msg.score;
        if ('timeMs'        in msg) this.timeMs        = msg.timeMs;
        if ('ball'          in msg) this.ball          = msg.ball;
        if ('players'       in msg) this.sPlayers      = msg.players;
        if ('sels'          in msg) this.sels          = msg.sels;
        if ('winner'        in msg) this.winner        = msg.winner;
        if ('bubble'        in msg) this.bubble        = msg.bubble;
        if ('bubbleSpawnMs' in msg) this.bubbleSpawnMs = msg.bubbleSpawnMs;
    }

    flushMessages(): any[] {
        const out = [...this.outbox]; this.outbox = []; return out;
    }

    isFinished(): boolean { return false; }

    // ── Input ─────────────────────────────────────────────────────

    private readInput(): void {
        const ui = this.userInput;
        const k  = this.keys;

        const moveX    = ui.moveDirectionX !== 0 ? ui.moveDirectionX
                       : k['ArrowLeft'] ? -1 : k['ArrowRight'] ? 1 : 0;
        const moveUp   = ui.moveDirectionY < 0 || k['ArrowUp'];
        const moveDown = ui.moveDirectionY > 0 || k['ArrowDown'];
        const confirm  = moveDown || k['Enter'];

        // ── Selezione personaggio ─────────────────────────────────
        if (this.phase === 'selection' && !this.confirmed) {
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
            if (confirm && !this.prevConfirm) {
                this.confirmed = true;
                this.outbox.push({ kind: 'selection:confirm', characterId: CHARS[this.charIdx].id });
            }
            this.prevConfirm = confirm;
            return;
        }

        // ── Gioco ─────────────────────────────────────────────────
        if (this.phase === 'playing') {
            const cur = {
                moveX,
                jump:     moveUp,
                teleport: k['KeyF'] === true,   // F = teleport
            };
            const changed = (Object.keys(cur) as (keyof typeof cur)[])
                .some(key => cur[key] !== this.prev[key]);
            if (changed) {
                this.outbox.push({ kind: 'input', ...cur });
                this.prev = { ...cur };
            }
        }
    }

    // ═══════════════════════════════════════════════════════════════
    //  GRAFICA
    //  Tutte le misure derivano da p.w / p.h o dalle costanti CW/CH
    //  → risoluzione dinamica garantita a qualsiasi schermo.
    // ═══════════════════════════════════════════════════════════════

    private drawBackground(ctx: CanvasRenderingContext2D): void {
        ctx.fillStyle = '#68c8ff'; ctx.fillRect(0, 0, CW, GY);
        ctx.fillStyle = '#239c3d'; ctx.fillRect(0, GY, CW, CH - GY);
        ctx.fillStyle = '#126d2b'; ctx.fillRect(0, GY, CW, 7);

        // Nuvole animate
        ctx.save();
        const clouds = [
            { x: 140, y: 60,  s: 1.00, sp: 0.22 },
            { x: 390, y: 48,  s: 1.18, sp: 0.18 },
            { x: 760, y: 62,  s: 0.95, sp: 0.15 },
        ];
        clouds.forEach(c => {
            const x = ((c.x + this.clock * c.sp * 18) % (CW + 100)) - 50;
            ctx.globalAlpha = 0.30; ctx.fillStyle = '#fff';
            ctx.beginPath(); ctx.ellipse(x,          c.y,       46*c.s, 18*c.s, 0, 0, Math.PI*2); ctx.fill();
            ctx.beginPath(); ctx.ellipse(x+28*c.s,   c.y-8*c.s, 32*c.s, 14*c.s, 0, 0, Math.PI*2); ctx.fill();
        });
        ctx.restore();
    }

    private drawPitch(ctx: CanvasRenderingContext2D): void {
        ctx.save();
        ctx.strokeStyle = 'rgba(255,255,255,0.35)'; ctx.lineWidth = 2; ctx.setLineDash([10, 8]);
        ctx.beginPath(); ctx.moveTo(CW/2, GTY); ctx.lineTo(CW/2, GY); ctx.stroke();
        ctx.setLineDash([]); ctx.restore();
        this.drawGoal(ctx, 0,      true);
        this.drawGoal(ctx, CW-GW, false);
    }

    private drawGoal(ctx: CanvasRenderingContext2D, gx: number, isLeft: boolean): void {
        const goalH = GY - GTY, T = GPT;
        const frontX = isLeft ? gx + GW - T : gx;
        const backX  = isLeft ? gx          : gx + GW - T;
        const netX   = isLeft ? backX + T : frontX + T;
        const netW   = GW - T * 2;

        ctx.fillStyle = 'rgba(160,200,240,0.10)'; ctx.fillRect(netX, GTY+T, netW, goalH-T);
        ctx.save();
        ctx.beginPath(); ctx.rect(netX, GTY+T, netW, goalH-T); ctx.clip();
        ctx.strokeStyle = 'rgba(210,235,255,0.35)'; ctx.lineWidth = 0.8;
        for (let x = netX+8; x < netX+netW; x += 8) { ctx.beginPath(); ctx.moveTo(x, GTY+T); ctx.lineTo(x, GY); ctx.stroke(); }
        for (let y = GTY+T+8; y < GY; y += 8)        { ctx.beginPath(); ctx.moveTo(netX, y); ctx.lineTo(netX+netW, y); ctx.stroke(); }
        ctx.restore();

        ctx.fillStyle = '#c0ccd8'; ctx.fillRect(frontX, GTY, T, goalH);
        ctx.globalAlpha = 0.55; ctx.fillStyle = '#7f8b96'; ctx.fillRect(backX, GTY+T, T, goalH-T);
        ctx.globalAlpha = 1;
        ctx.fillStyle = '#c0ccd8'; ctx.fillRect(gx, GTY, GW, T);
    }

    /**
     * Disegna un personaggio compatto: testa + busto + piedi.
     * Tutti i valori sono proporzionali a p.w/p.h.
     *
     * Effetti speciali:
     *   - Congelato (frozenMs > 0): overlay ghiaccio azzurro
     *   - Big Head  (bigHeadMs > 0): testa ingrandita di BH_HEAD_MULT
     *   - Occhi e piedi seguono la direzione p.dir
     */
    private drawPlayer(ctx: CanvasRenderingContext2D, p: any): void {
        if (!p) return;
        const char      = CHARS.find(c => c.id === p.characterId) ?? CHARS[0];
        const cx        = p.x + p.w / 2;
        const isFrozen  = p.frozenMs  > 0;
        const isBigHead = p.bigHeadMs > 0;
        const d         = p.dir ?? 1;

        // Raggio testa: amplificato se big head attivo
        const baseR = p.w * 0.48;
        const headR = baseR * (isBigHead ? BH_HEAD_MULT : 1);
        const headCY = p.y + p.h * 0.35;

        // Centro busto
        const bodyY  = p.y + p.h * 0.68;
        const bodyRX = p.w * 0.28;
        const bodyRY = p.h * 0.20;

        ctx.save();

        // Ombra a terra
        ctx.globalAlpha = 0.20; ctx.fillStyle = '#000';
        ctx.beginPath(); ctx.ellipse(cx, GY-2, p.w*0.40, 6, 0, 0, Math.PI*2); ctx.fill();
        ctx.globalAlpha = 1;

        // Busto (ellisse con colore maglia)
        ctx.fillStyle = char.jersey;
        ctx.beginPath(); ctx.ellipse(cx, bodyY, bodyRX, bodyRY, 0, 0, Math.PI*2); ctx.fill();

        // Piedi: quello nella direzione del movimento avanza leggermente
        const fR = p.w*0.16, fCY = p.y+p.h*0.90, spread = p.w*0.22;
        [-1, 1].forEach(side => {
            const advance = side === d ? 3 : 0;
            const fx = cx + side * spread + advance;
            ctx.fillStyle = '#1a1a2e';
            ctx.beginPath(); ctx.ellipse(fx, fCY, fR, fR*0.65, 0, 0, Math.PI*2); ctx.fill();
            ctx.fillStyle = char.trim;
            ctx.beginPath(); ctx.ellipse(fx, fCY-fR*0.18, fR*0.85, fR*0.30, 0, 0, Math.PI*2); ctx.fill();
        });

        // Testa con gradiente radiale (effetto 3D)
        const skinG = ctx.createRadialGradient(
            cx - headR*0.3, headCY - headR*0.3, headR*0.05,
            cx, headCY, headR
        );
        skinG.addColorStop(0,    '#ffe8cc');
        skinG.addColorStop(0.65, '#f5c09a');
        skinG.addColorStop(1,    '#d4895a');
        ctx.beginPath(); ctx.arc(cx, headCY, headR, 0, Math.PI*2);
        ctx.fillStyle = skinG; ctx.fill();
        ctx.strokeStyle = 'rgba(0,0,0,0.15)'; ctx.lineWidth = 1.5; ctx.stroke();

        // Fascia/capelli (colore maglia)
        ctx.fillStyle = char.jersey;
        ctx.beginPath(); ctx.ellipse(cx, headCY-headR*0.72, headR*0.85, headR*0.30, 0, 0, Math.PI*2); ctx.fill();

        // Occhi + pupille (direzione dinamica)
        const eOX = headR*0.32, eY = headCY-headR*0.05;
        const eRX = headR*0.20, eRY = headR*0.24;
        ctx.fillStyle = '#fff';
        [cx-eOX, cx+eOX].forEach(ex => { ctx.beginPath(); ctx.ellipse(ex, eY, eRX, eRY, 0, 0, Math.PI*2); ctx.fill(); });
        ctx.fillStyle = '#1a0800';
        [cx-eOX, cx+eOX].forEach(ex => { ctx.beginPath(); ctx.arc(ex + d*eRX*0.35, eY+eRY*0.10, eRX*0.55, 0, Math.PI*2); ctx.fill(); });
        // Riflesso
        ctx.fillStyle = 'rgba(255,255,255,0.75)';
        [cx-eOX, cx+eOX].forEach(ex => { ctx.beginPath(); ctx.arc(ex+d*eRX*0.35-eRX*0.2, eY-eRY*0.25, eRX*0.20, 0, Math.PI*2); ctx.fill(); });

        // Effetto congelato: overlay azzurro + cristalli
        if (isFrozen) {
            ctx.globalAlpha = 0.42; ctx.fillStyle = '#a0e8ff';
            ctx.beginPath(); ctx.arc(cx, headCY, headR, 0, Math.PI*2); ctx.fill();
            ctx.beginPath(); ctx.ellipse(cx, bodyY, bodyRX, bodyRY, 0, 0, Math.PI*2); ctx.fill();
            ctx.globalAlpha = 1;
            ctx.strokeStyle = '#c8f0ff'; ctx.lineWidth = 1.5;
            [[0,-1],[0.866,0.5],[-0.866,0.5]].forEach(([cx2,cy2]) => {
                ctx.beginPath(); ctx.moveTo(cx, headCY);
                ctx.lineTo(cx + cx2*headR*0.9, headCY + cy2*headR*0.9); ctx.stroke();
            });
        }

        // Label P1 / P2
        ctx.fillStyle = p.seat === 0 ? '#4ac7ff' : '#ff7272';
        ctx.font = `bold ${Math.round(headR*0.42)}px sans-serif`;
        ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
        ctx.fillText(p.seat === 0 ? 'P1' : 'P2', cx, headCY - headR*1.40);

        // Barra cooldown Teleport sopra il giocatore
        if (p.tpCdMs > 0) {
            const pct = 1 - p.tpCdMs / TP_CD_MS;
            const bx = p.x, by = p.y - 14, bw = p.w, bh = 5;
            ctx.fillStyle = 'rgba(0,0,0,0.35)'; ctx.fillRect(bx, by, bw, bh);
            ctx.fillStyle = '#ffc66e';           ctx.fillRect(bx, by, bw * pct, bh);
            ctx.strokeStyle = 'rgba(255,255,255,0.2)'; ctx.lineWidth = 0.5; ctx.strokeRect(bx, by, bw, bh);
            ctx.fillStyle = 'rgba(255,255,255,0.6)';
            ctx.font = `${Math.round(bh*1.8)}px sans-serif`;
            ctx.textAlign = 'left'; ctx.textBaseline = 'bottom';
            ctx.fillText('TP', bx, by);
        }

        ctx.restore();
    }

    /**
     * Disegna la bolla superpotere sul campo.
     * La bolla pulsa leggermente grazie a Math.sin(clock).
     */
    private drawBubble(ctx: CanvasRenderingContext2D, bub: any): void {
        const pulse = 1 + Math.sin(this.clock * 3) * 0.08;
        const r     = BUBBLE_RADIUS * pulse;
        const color = bub.type === 'ice' ? '#7df0ff' : '#a0ff80';
        const icon  = bub.type === 'ice' ? '❄'       : '💪';

        ctx.save();

        // Alone luminoso
        const glow = ctx.createRadialGradient(bub.x, bub.y, r * 0.3, bub.x, bub.y, r * 1.8);
        glow.addColorStop(0,   color + 'aa');
        glow.addColorStop(1,   color + '00');
        ctx.beginPath(); ctx.arc(bub.x, bub.y, r * 1.8, 0, Math.PI * 2);
        ctx.fillStyle = glow; ctx.fill();

        // Corpo bolla
        ctx.beginPath(); ctx.arc(bub.x, bub.y, r, 0, Math.PI * 2);
        ctx.fillStyle   = color + 'cc'; ctx.fill();
        ctx.strokeStyle = color;        ctx.lineWidth = 2; ctx.stroke();

        // Icona centrale
        ctx.font         = `${Math.round(r * 1.1)}px sans-serif`;
        ctx.textAlign    = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText(icon, bub.x, bub.y);

        ctx.restore();
    }

    /**
     * Mostra nella HUD il conto alla rovescia fino alla prossima bolla.
     * Visibile solo quando non c'è una bolla attiva sul campo.
     */
    private drawBubbleTimer(ctx: CanvasRenderingContext2D): void {
        if (this.bubble !== null) return;
        const secs = Math.ceil(this.bubbleSpawnMs / 1000);
        ctx.save();
        ctx.fillStyle    = 'rgba(255,255,255,0.55)';
        ctx.font         = `${Math.round(CW * 0.018)}px sans-serif`;
        ctx.textAlign    = 'center';
        ctx.textBaseline = 'top';
        ctx.fillText(`⚡ prossima bolla: ${secs}s`, CW / 2, GY + 10);
        ctx.restore();
    }

    private drawBall(ctx: CanvasRenderingContext2D, b: any): void {
        const { x, y } = b;
        ctx.save();

        ctx.globalAlpha = 0.18; ctx.fillStyle = '#000';
        ctx.beginPath(); ctx.ellipse(x, GY-3, BR*0.9, BR*0.28, 0, 0, Math.PI*2); ctx.fill();
        ctx.globalAlpha = 1;

        const g = ctx.createRadialGradient(x-BR*0.35, y-BR*0.35, BR*0.05, x, y, BR);
        g.addColorStop(0, '#fff'); g.addColorStop(0.4, '#f0f0f0'); g.addColorStop(1, '#8888a0');
        ctx.beginPath(); ctx.arc(x, y, BR, 0, Math.PI*2);
        ctx.fillStyle = g; ctx.fill();
        ctx.strokeStyle = '#666'; ctx.lineWidth = 1.5; ctx.stroke();

        ctx.strokeStyle = '#333'; ctx.lineWidth = 1;
        const verts = [[0,-1],[0.951,-0.309],[0.588,0.809],[-0.588,0.809],[-0.951,-0.309]];
        ctx.beginPath();
        verts.forEach(([vx,vy],i) => {
            const px = x+vx*BR*0.48, py = y+vy*BR*0.48;
            i===0 ? ctx.moveTo(px,py) : ctx.lineTo(px,py);
        });
        ctx.closePath(); ctx.stroke();
        ctx.restore();
    }

    private drawHUD(ctx: CanvasRenderingContext2D): void {
        const tot  = Math.ceil(Math.max(0, this.timeMs) / 1000);
        const time = this.phase === 'countdown'
            ? String(Math.max(0, Math.ceil(this.timeMs / 1000)))
            : `${String(Math.floor(tot/60)).padStart(2,'0')}:${String(tot%60).padStart(2,'0')}`;

        ctx.save();
        ctx.font = `bold ${Math.round(CW*0.028)}px sans-serif`;
        ctx.textAlign = 'center'; ctx.textBaseline = 'top';
        ctx.fillStyle = 'rgba(0,0,0,0.5)';
        ctx.fillText(String(this.score.left),  CW*0.16+1, 13);
        ctx.fillText(time,                     CW/2+1,    13);
        ctx.fillText(String(this.score.right), CW*0.84+1, 13);
        ctx.fillStyle = '#4ac7ff'; ctx.fillText(String(this.score.left),  CW*0.16, 12);
        ctx.fillStyle = '#fff';    ctx.fillText(time,                     CW/2,    12);
        ctx.fillStyle = '#ff7272'; ctx.fillText(String(this.score.right), CW*0.84, 12);
        ctx.restore();
    }

    private drawCountdown(ctx: CanvasRenderingContext2D): void {
        ctx.save();
        ctx.fillStyle = 'rgba(7,12,20,0.55)'; ctx.fillRect(0, 0, CW, CH);
        const n = Math.max(0, Math.ceil(this.timeMs / 1000));
        ctx.fillStyle = '#fff'; ctx.font = `800 ${Math.round(CH*0.20)}px sans-serif`;
        ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
        ctx.fillText(n > 0 ? String(n) : 'Via!', CW/2, CH/2-16);
        ctx.font = `600 ${Math.round(CH*0.038)}px sans-serif`;
        ctx.fillStyle = 'rgba(228,238,255,0.8)';
        ctx.fillText('Pronti?', CW/2, CH/2+50);
        ctx.restore();
    }

    private drawSelection(ctx: CanvasRenderingContext2D): void {
        const pw = CW*0.44, ph = CH*0.70;
        const px = (CW-pw)/2, py = (CH-ph)/2;
        ctx.save();
        ctx.fillStyle = 'rgba(9,18,32,0.93)'; this.rr(ctx,px,py,pw,ph,24); ctx.fill();
        ctx.strokeStyle = 'rgba(255,255,255,0.15)'; ctx.lineWidth = 1.5; this.rr(ctx,px,py,pw,ph,24); ctx.stroke();

        const char = CHARS[this.charIdx];
        ctx.textAlign = 'center'; ctx.textBaseline = 'top';
        ctx.fillStyle = 'rgba(238,245,255,0.55)'; ctx.font = `${Math.round(CH*0.022)}px sans-serif`;
        ctx.fillText('HEAD BALL ONLINE', CW/2, py+18);
        ctx.fillStyle = '#eef5ff'; ctx.font = `bold ${Math.round(CH*0.042)}px sans-serif`;
        ctx.fillText(
            this.confirmed           ? 'Pronto! In attesa avversario...' :
            this.phase === 'waiting' ? 'In attesa di avversario...'      :
                                       'Scegli il tuo personaggio',
            CW/2, py+42
        );

        const orbX = CW/2, orbY = py+ph*0.42, orbR = Math.round(pw*0.115);
        const gg = ctx.createRadialGradient(orbX-orbR*0.35,orbY-orbR*0.35,orbR*0.05,orbX,orbY,orbR);
        gg.addColorStop(0,'#fff'); gg.addColorStop(0.5,char.accent); gg.addColorStop(1,char.jersey);
        ctx.beginPath(); ctx.arc(orbX,orbY,orbR,0,Math.PI*2); ctx.fillStyle=gg; ctx.fill();
        ctx.strokeStyle='rgba(255,255,255,0.25)'; ctx.lineWidth=2; ctx.stroke();
        ctx.fillStyle='#eef5ff'; ctx.font=`bold ${Math.round(CH*0.036)}px sans-serif`;
        ctx.fillText(char.name, CW/2, orbY+orbR+10);

        if (!this.confirmed && this.phase === 'selection') {
            ctx.fillStyle='rgba(255,255,255,0.5)'; ctx.font=`${Math.round(CH*0.048)}px sans-serif`;
            ctx.textBaseline='middle';
            ctx.fillText('◀', orbX-orbR*1.8, orbY); ctx.fillText('▶', orbX+orbR*1.8, orbY);
            ctx.textBaseline='top';
            ctx.fillStyle='rgba(238,245,255,0.6)'; ctx.font=`${Math.round(CH*0.026)}px sans-serif`;
            ctx.fillText('A / ←  ·  D / →   cambia', CW/2, py+ph*0.75);
            ctx.fillStyle='rgba(104,214,141,0.9)'; ctx.font=`bold ${Math.round(CH*0.028)}px sans-serif`;
            ctx.fillText('S / Enter   conferma', CW/2, py+ph*0.84);
        } else if (this.confirmed) {
            ctx.fillStyle='#68d68d'; ctx.font=`bold ${Math.round(CH*0.030)}px sans-serif`;
            ctx.fillText('✓ Confermato!', CW/2, py+ph*0.80);
        }

        const oppSel = this.sels[this.mySeat === 0 ? 1 : 0];
        if (oppSel) {
            const oppName = CHARS.find(c => c.id === oppSel.characterId)?.name ?? '?';
            ctx.fillStyle='rgba(238,245,255,0.40)'; ctx.font=`${Math.round(CH*0.024)}px sans-serif`;
            ctx.fillText(oppSel.confirmed ? `Avversario pronto (${oppName})` : 'Avversario sta scegliendo...', CW/2, py+ph-20);
        }
        ctx.restore();
    }

    private drawResult(ctx: CanvasRenderingContext2D): void {
        const pw = CW*0.44, ph = CH*0.38, px = (CW-pw)/2, py = (CH-ph)/2;
        ctx.save();
        ctx.fillStyle = 'rgba(9,18,32,0.95)'; this.rr(ctx,px,py,pw,ph,28); ctx.fill();
        ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
        ctx.fillStyle = '#eef5ff'; ctx.font = `bold ${Math.round(CH*0.064)}px sans-serif`;
        ctx.fillText(
            this.winner==='draw' ? 'Pareggio!' : this.winner==='left' ? 'Vince P1  🎉' : 'Vince P2  🎉',
            CW/2, py+ph*0.32
        );
        ctx.fillStyle='rgba(238,245,255,0.60)'; ctx.font=`${Math.round(CH*0.034)}px sans-serif`;
        ctx.fillText(`${this.score.left} - ${this.score.right}`, CW/2, py+ph*0.58);
        ctx.fillText('Attendi la prossima partita...', CW/2, py+ph*0.80);
        ctx.restore();
    }

    /**
     * Manuale di gioco — pannello sovrapposto a tutto.
     * Spiega i comandi e come funzionano le bolle.
     * Il gioco non riceve input finché showManual === true.
     * Il pulsante "Gioca!" è registrato in registerManualClick().
     */
    private drawManual(ctx: CanvasRenderingContext2D): void {
        // Sfondo semi-opaco sopra tutto
        ctx.save();
        ctx.fillStyle = 'rgba(5, 12, 24, 0.82)';
        ctx.fillRect(0, 0, CW, CH);

        const pw = CW * 0.62, ph = CH * 0.86;
        const px = (CW - pw) / 2, py = (CH - ph) / 2;

        ctx.fillStyle = 'rgba(10, 20, 38, 0.97)';
        this.rr(ctx, px, py, pw, ph, 28); ctx.fill();
        ctx.strokeStyle = 'rgba(255,255,255,0.15)'; ctx.lineWidth = 1.5;
        this.rr(ctx, px, py, pw, ph, 28); ctx.stroke();

        const cx = CW / 2;
        ctx.textAlign = 'center'; ctx.textBaseline = 'top';

        // Titolo
        ctx.fillStyle = '#eef5ff';
        ctx.font = `800 ${Math.round(CH * 0.058)}px sans-serif`;
        ctx.fillText('⚽ HEAD BALL ONLINE', cx, py + 22);

        // Sottotitolo
        ctx.fillStyle = 'rgba(238,245,255,0.55)';
        ctx.font = `${Math.round(CH * 0.026)}px sans-serif`;
        ctx.fillText('Manuale di gioco', cx, py + 74);

        // ── Sezione Controlli ──────────────────────────────────────
        const lineH  = CH * 0.068;
        const col1   = px + pw * 0.08;   // colonna icona
        const col2   = px + pw * 0.22;   // colonna testo
        let   rowY   = py + 108;

        ctx.textAlign    = 'left';
        ctx.textBaseline = 'middle';

        const rows = [
            { icon: '←→', label: 'A / ←  D / →',  desc: 'Muovi il personaggio' },
            { icon: '↑',  label: 'W / ↑',           desc: 'Salta  (premi di nuovo in aria = doppio salto)' },
            { icon: '⚡', label: 'F',                desc: `Teleport — scatta avanti  (cooldown ${TP_CD_MS/1000}s)` },
        ];

        rows.forEach(row => {
            ctx.fillStyle = 'rgba(255,255,255,0.18)';
            this.rr(ctx, px + pw*0.04, rowY - lineH*0.42, pw*0.92, lineH*0.84, 10); ctx.fill();

            ctx.fillStyle = '#ffd966';
            ctx.font = `bold ${Math.round(CH * 0.038)}px sans-serif`;
            ctx.fillText(row.icon, col1 + 16, rowY);

            ctx.fillStyle = '#4ac7ff';
            ctx.font = `bold ${Math.round(CH * 0.030)}px sans-serif`;
            ctx.fillText(row.label, col2, rowY);

            ctx.fillStyle = '#eef5ff';
            ctx.font = `${Math.round(CH * 0.028)}px sans-serif`;
            ctx.fillText(row.desc, col2 + pw * 0.28, rowY);

            rowY += lineH;
        });

        // ── Sezione Bolle ──────────────────────────────────────────
        rowY += lineH * 0.3;
        ctx.textAlign = 'center'; ctx.textBaseline = 'top';
        ctx.fillStyle = 'rgba(255,255,255,0.55)';
        ctx.font = `${Math.round(CH * 0.026)}px sans-serif`;
        ctx.fillText('── Superpoteri Bolla ──', cx, rowY);
        rowY += lineH * 0.65;

        const bubbleRows = [
            { icon: '❄', color: '#7df0ff', desc: `ICE — Congela l'avversario per ${ICE_DUR_MS/1000}s` },
            { icon: '💪', color: '#a0ff80', desc: `BIG HEAD — Testa enorme per ${BH_DUR_MS/1000}s  (hitbox più grande!)` },
        ];
        bubbleRows.forEach(row => {
            ctx.textAlign    = 'left';
            ctx.textBaseline = 'middle';
            ctx.fillStyle = 'rgba(255,255,255,0.18)';
            this.rr(ctx, px+pw*0.04, rowY-lineH*0.42, pw*0.92, lineH*0.84, 10); ctx.fill();

            ctx.font = `${Math.round(CH*0.038)}px sans-serif`;
            ctx.fillText(row.icon, col1 + 14, rowY);

            ctx.fillStyle = row.color;
            ctx.font = `${Math.round(CH*0.028)}px sans-serif`;
            ctx.fillText(row.desc, col2, rowY);

            rowY += lineH;
        });

        // Nota spawn bolle
        rowY += lineH * 0.2;
        ctx.textAlign = 'center'; ctx.textBaseline = 'top';
        ctx.fillStyle = 'rgba(238,245,255,0.45)';
        ctx.font = `${Math.round(CH*0.024)}px sans-serif`;
        ctx.fillText(`Le bolle appaiono ogni ${BUBBLE_SPAWN_MS/1000}s — cammina sopra per raccoglierle!`, cx, rowY);

        // ── Pulsante Gioca! ────────────────────────────────────────
        // Coordinata Y deve combaciare con quella in registerManualClick()
        const bw = 160, bh = 44, bx = cx - bw/2, by = CH * 0.72;
        const btnGrad = ctx.createLinearGradient(bx, by, bx, by + bh);
        btnGrad.addColorStop(0, '#68d68d'); btnGrad.addColorStop(1, '#2f9360');
        ctx.fillStyle = btnGrad; this.rr(ctx, bx, by, bw, bh, 14); ctx.fill();
        ctx.strokeStyle = 'rgba(255,255,255,0.25)'; ctx.lineWidth = 1;
        this.rr(ctx, bx, by, bw, bh, 14); ctx.stroke();

        ctx.fillStyle    = '#07111c';
        ctx.font         = `800 ${Math.round(bh*0.50)}px sans-serif`;
        ctx.textAlign    = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText('🎮  GIOCA!', cx, by + bh / 2);

        ctx.restore();
    }

    // ── Utility ───────────────────────────────────────────────────

    private rr(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number): void {
        ctx.beginPath();
        ctx.moveTo(x+r, y); ctx.lineTo(x+w-r, y); ctx.arcTo(x+w, y,     x+w, y+r,     r);
        ctx.lineTo(x+w, y+h-r);                    ctx.arcTo(x+w, y+h,   x+w-r, y+h,   r);
        ctx.lineTo(x+r, y+h);                      ctx.arcTo(x,   y+h,   x,     y+h-r, r);
        ctx.lineTo(x,   y+r);                      ctx.arcTo(x,   y,     x+r,   y,     r);
        ctx.closePath();
    }
}