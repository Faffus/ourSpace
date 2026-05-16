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
 *    • Valida i goal e aggiorna il punteggio
 *    • Gestisce i cooldown di tutti i superpoteri
 *    • Invia uno snapshot dello stato ogni tick (~30/s)
 *
 *  CLIENT (HeadBallClient) — gira nel browser:
 *    • Legge la tastiera e invia i comandi al server
 *    • Riceve gli snapshot e disegna il canvas
 *    • NON calcola fisica: mostra solo ciò che il server dice
 *
 *  CONTROLLI
 *  ──────────
 *    A / ←   muovi sinistra        D / →   muovi destra
 *    W / ↑   salta (doppio salto)
 *    Q       ICE (congela avversario, cooldown 20s)
 *    E       BIG HEAD (testa grande, cooldown 15s)
 *    Click   Teletrasporto verso la palla (cooldown 10s)
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
const PW = 68;      // larghezza hitbox
const PH = 96;      // altezza hitbox

// Fisica palla
const BR       = 22;     // raggio palla
const B_GRAV   = 1900;   // gravità palla (px/s²)
const B_BSX    = 0.88;   // attenuazione rimbalzo laterale
const B_BTY    = 0.98;   // attenuazione rimbalzo su traversa/palo
const B_BGR    = 0.82;   // attenuazione rimbalzo a terra
const B_FRIC   = 0.988;  // attrito palla a terra (per frame a 60fps)
const B_VSTOP  = 18;     // soglia velocità verticale sotto cui non rimbalzare
const B_KVX    = 320;    // velocità kickoff orizzontale
const B_KVY    = -480;   // velocità kickoff verticale

// Fisica giocatore
const P_SPEED  = 390;    // velocità orizzontale (px/s)
const P_JUMP_V = -1180;  // impulso salto (px/s, negativo = su)
const P_GRAV   = 3600;   // gravità giocatore (px/s²)

// Durate di gioco
const CD_MS    = 3000;   // countdown pre-partita (ms)
const MATCH_MS = 90000;  // durata partita (ms)

// ── Superpoteri ──────────────────────────────────────────────
// Ogni superpotere ha una durata (quanto dura l'effetto) e un
// cooldown (quanto aspettare prima di riusarlo).
const TP_DIST       = 180;   // distanza teletrasporto (px)
const TP_CD_MS      = 10000; // cooldown teleport (10s)

const ICE_DUR_MS    = 3000;  // durata congelamento avversario (3s)
const ICE_CD_MS     = 20000; // cooldown ice (20s)

const BH_DUR_MS     = 5000;  // durata big head (5s)
const BH_CD_MS      = 15000; // cooldown big head (15s)
const BH_HEAD_MULT  = 1.6;   // moltiplicatore raggio testa con big head

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

type Seat   = 0 | 1;
type Phase  = 'selection' | 'countdown' | 'playing' | 'finished';

/** Input inviato dal client al server ogni volta che cambia. */
interface Inp {
    moveX:    number;   // -1 | 0 | 1
    jump:     boolean;
    teleport: boolean;
    ice:      boolean;
    bigHead:  boolean;
}

interface Sel  { characterId: string; confirmed: boolean; }
interface Ball { x: number; y: number; vx: number; vy: number; }

/** Stato completo di un giocatore (lato server). */
interface Ply {
    seat:        Seat;
    characterId: string;
    x: number; y: number; vx: number; vy: number;
    w: number; h: number;
    dir: number;          // direzione sguardo: +1 destra, -1 sinistra
    onGround:    boolean;
    jumpHeld:    boolean;
    djUsed:      boolean; // doppio salto già usato in aria?
    tpHeld:      boolean;
    iceHeld:     boolean;
    bhHeld:      boolean;
    inp:         Inp;
    // Cooldown superpoteri (ms rimanenti)
    tpCdMs:      number;
    iceCdMs:     number;
    bhCdMs:      number;
    // Effetti attivi
    frozenMs:    number;  // ms rimanenti di congelamento (0 = libero)
    bigHeadMs:   number;  // ms rimanenti di big head (0 = normale)
}

// ═══════════════════════════════════════════════════════════════
//  HELPER
// ═══════════════════════════════════════════════════════════════

const clamp  = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));
const safeId = (id: unknown): string =>
    (typeof id === 'string' && CHAR_IDS.has(id.trim())) ? id.trim() : DEF_CHAR;

function mkInp(): Inp {
    return { moveX: 0, jump: false, teleport: false, ice: false, bigHead: false };
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
        onGround: true, jumpHeld: false, djUsed: false,
        tpHeld: false, iceHeld: false, bhHeld: false,
        inp: mkInp(),
        tpCdMs: 0, iceCdMs: 0, bhCdMs: 0,
        frozenMs: 0, bigHeadMs: 0,
    };
}

// ═══════════════════════════════════════════════════════════════
//  COLLISIONI
// ═══════════════════════════════════════════════════════════════

/**
 * Rimbalzo della palla contro un rettangolo (pali, traversa).
 *
 * getCollisionSide(r1, r2) restituisce il lato di r2 che r1 ha penetrato:
 *   "top"    → r1 ha colpito il tetto di r2  → sposta r1 sopra r2, inverti vy
 *   "bottom" → r1 ha colpito il fondo di r2  → sposta r1 sotto r2, inverti vy
 *   "left"   → r1 ha colpito il lato sinistro → sposta r1 a sinistra, inverti vx
 *   "right"  → r1 ha colpito il lato destro  → sposta r1 a destra, inverti vx
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
 * Collisione palla vs giocatore — due zone circolari: testa e piede.
 * La testa ha priorità: se è già in contatto, il piede viene ignorato.
 *
 * Il parametro headRadius permette di supportare il superpotere Big Head
 * sia visivamente che fisicamente, senza duplicare la logica.
 */
function ballVsPlayer(b: Ball, p: Ply, headRadius: number): void {
    const cx  = p.x + p.w / 2;

    // ─ Testa ─────────────────────────────────
    const hCY = p.y + p.h * 0.26;
    const dxH = b.x - cx, dyH = b.y - hCY;
    const dH  = Math.sqrt(dxH * dxH + dyH * dyH);
    const hitH = dH < headRadius + BR;

    // ─ Piede (solo se testa non colpita) ─────
    const fR   = p.w * 0.20;
    const fCY  = p.y + p.h * 0.88;
    const dxF  = b.x - cx, dyF = b.y - fCY;
    const dF   = Math.sqrt(dxF * dxF + dyF * dyF);
    const hitF = !hitH && dF < fR + BR;

    if (!hitH && !hitF) return;

    // Direzione naturale del giocatore (+1 P1, -1 P2)
    const pDir = p.seat === 0 ? 1 : -1;
    const spd  = Math.sqrt(b.vx * b.vx + b.vy * b.vy);

    if (hitH) {
        // Colpo di testa: direzione dal centro testa verso palla
        const s  = Math.max(dH, 0.001);
        const nx = dxH / s, ny = dyH / s;
        const sp = clamp(Math.max(560, spd), 560, 880);
        b.vx = clamp(nx * sp * 0.50 + pDir * 0.18 * sp + p.vx * 0.15, -700, 700);
        b.vy = clamp(Math.min(ny * sp * 0.50 + (ny < -0.3 ? -920 : -800), -640), -1050, -640);
        // Correzione penetrazione per evitare che la palla resti "dentro" la testa
        b.x += nx * (headRadius + BR - dH);
        b.y += ny * (headRadius + BR - dH);
    } else {
        // Calcio: impulso più forte, direzione laterale accentuata
        const s  = Math.max(dF, 0.001);
        const nx = dxF / s, ny = dyF / s;
        const sp = clamp(Math.max(600, spd * 1.15), 600, 1000);
        b.vx = clamp(nx * sp * 0.90 + pDir * sp * 0.25 + p.vx * 0.25, -1000, 1000);
        b.vy = clamp(Math.min(ny * sp * 0.5 - 480, -350), -850, -350);
        b.x += nx * (fR + BR - dF);
        b.y += ny * (fR + BR - dF);
    }
}

/**
 * Collisione palla vs struttura della porta (palo di fondo + traversa).
 * Chiamata SOLO per la zona esterna: se la palla entra dentro la porta
 * (inGoalZone === true) viene rilevato il gol prima di questa funzione.
 */
function ballVsGoalFrame(b: Ball, goalX: number, isLeft: boolean): void {
    const goalH = GY - GTY;
    // Palo di fondo: è il palo lontano dal campo
    const backX = isLeft ? goalX : goalX + GW - GPT;
    ballVsRect(b, { x: backX, y: GTY, w: GPT, h: goalH });
    // Traversa orizzontale in cima alla porta
    ballVsRect(b, { x: goalX, y: GTY, w: GW,  h: GPT  });
}

// ═══════════════════════════════════════════════════════════════
//  SERVER
// ═══════════════════════════════════════════════════════════════

export class HeadBallServer extends GameServer {

    private phase:  Phase  = 'selection';
    private players: Record<string, Ply> = {};
    private order:   string[] = [];   // order[seat] = clientId
    private sels:    Sel[]    = [
        { characterId: DEF_CHAR, confirmed: false },
        { characterId: DEF_CHAR, confirmed: false },
    ];
    private ball:   Ball   = mkBall();
    private score          = { left: 0, right: 0 };
    private timeMs         = MATCH_MS;
    private cdMs           = CD_MS;
    private winner: 'left' | 'right' | 'draw' | null = null;

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
        this.ball = mkBall();
    }

    /**
     * Chiamato dal framework ~30 volte al secondo.
     * dt = tempo trascorso dall'ultimo tick in SECONDI (es. 0.033).
     * Restituisce i messaggi da inviare ai client.
     */
    tick(msgs: IncomingMsg[], dt: number): OutgoingMsg[] {
        this.processMessages(msgs);
        this.updatePhase(dt);
        // Un solo messaggio senza clientId = broadcast a tutti
        return [{ payload: this.buildSnapshot() }];
    }

    /**
     * Il server dichiara la partita finita: il framework ferma il lobby.
     * Diventa true solo quando la fase è 'finished'.
     */
    isFinished(): boolean {
        return this.phase === 'finished';
    }

    // ── Elaborazione messaggi in arrivo ──────────────────────────

    private processMessages(msgs: IncomingMsg[]): void {
        for (const msg of msgs) {
            const p   = this.players[msg.clientId];
            if (!p) continue;
            const pay  = msg.payload;
            const seat = p.seat;

            // Input di gioco (accettato solo se si sta giocando)
            if (pay.kind === 'input' && this.phase === 'playing') {
                p.inp = {
                    moveX:    typeof pay.moveX    === 'number'  ? clamp(pay.moveX, -1, 1) : p.inp.moveX,
                    jump:     typeof pay.jump     === 'boolean' ? pay.jump     : p.inp.jump,
                    teleport: typeof pay.teleport === 'boolean' ? pay.teleport : p.inp.teleport,
                    ice:      typeof pay.ice      === 'boolean' ? pay.ice      : p.inp.ice,
                    bigHead:  typeof pay.bigHead  === 'boolean' ? pay.bigHead  : p.inp.bigHead,
                };
            }

            // Selezione personaggio
            if (pay.kind === 'selection:update' && this.phase === 'selection' && !this.sels[seat].confirmed) {
                this.sels[seat].characterId = safeId(pay.characterId);
            }
            if (pay.kind === 'selection:confirm' && this.phase === 'selection' && !this.sels[seat].confirmed) {
                this.sels[seat].characterId = safeId(pay.characterId ?? this.sels[seat].characterId);
                this.sels[seat].confirmed   = true;
                // Entrambi pronti → avvia countdown
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
        // In 'selection' e 'finished' non facciamo nulla
    }

    private goCountdown(): void {
        this.phase  = 'countdown'; this.cdMs = CD_MS;
        this.score  = { left: 0, right: 0 }; this.winner = null;
        this.ball   = mkBall();
        this.order.forEach((id, i) => { this.players[id] = mkPlayer(i as Seat, this.sels[i].characterId); });
    }

    private goPlaying(): void {
        this.phase  = 'playing'; this.timeMs = MATCH_MS;
        this.ball   = mkBall(Math.random() < 0.5 ? -1 : 1);
        this.order.forEach((id, i) => { this.players[id] = mkPlayer(i as Seat, this.sels[i].characterId); });
    }

    private resetAfterGoal(scoringSeat: Seat): void {
        // La palla torna al centro con kickoff verso chi ha subito il gol
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

        // Aggiorna giocatori
        ([0, 1] as Seat[]).forEach(seat => {
            const p = this.players[this.order[seat]];
            if (!p) return;

            // Tick timer effetti e cooldown
            p.frozenMs   = Math.max(0, p.frozenMs   - dtMs);
            p.bigHeadMs  = Math.max(0, p.bigHeadMs  - dtMs);
            p.tpCdMs     = Math.max(0, p.tpCdMs     - dtMs);
            p.iceCdMs    = Math.max(0, p.iceCdMs     - dtMs);
            p.bhCdMs     = Math.max(0, p.bhCdMs     - dtMs);

            // Se congelato, il giocatore non può muoversi
            if (p.frozenMs > 0) {
                p.vx = 0;
                // Applica solo gravità per farlo restare a terra
                p.vy += P_GRAV * dt;
                p.y  += p.vy * dt;
                if (p.y >= GY - p.h) { p.y = GY - p.h; p.vy = 0; }
                return;
            }

            this.applyInput(p, seat, dt);

            // Integrazione posizione con delta time
            p.vy += P_GRAV * dt;
            p.x  += p.vx * dt;
            p.y  += p.vy * dt;

            // Collisione suolo
            if (p.y >= GY - p.h) { p.y = GY - p.h; p.vy = 0; p.onGround = true; p.djUsed = false; }
            else                  { p.onGround = false; }
            // Soffitto
            if (p.y < 0) { p.y = 0; if (p.vy < 0) p.vy = 0; }
            // Pareti (il giocatore non entra nella zona porta)
            const minX = GW, maxX = CW - GW - p.w;
            if (p.x < minX) { p.x = minX; p.vx = 0; }
            if (p.x > maxX) { p.x = maxX; p.vx = 0; }
        });

        this.updateBall(dt);
    }

    private applyInput(p: Ply, seat: Seat, dt: number): void {
        const inp = p.inp;

        // Movimento orizzontale
        p.vx = inp.moveX * P_SPEED;
        if (inp.moveX !== 0) p.dir = inp.moveX > 0 ? 1 : -1;

        // ── Salto con doppio salto ────────────────────────────────
        // Il fronte del tasto (jumpHeld) evita che tenere premuto
        // consumi il doppio salto istantaneamente.
        if (inp.jump && !p.jumpHeld) {
            if (p.onGround) {
                p.vy = P_JUMP_V; p.onGround = false; p.djUsed = false;
            } else if (!p.djUsed) {
                p.vy = P_JUMP_V; p.djUsed = true;
            }
        }
        p.jumpHeld = inp.jump;

        // ── SUPERPOTERE: Teleport ─────────────────────────────────
        // Teletrasporto di TP_DIST px nella direzione del movimento.
        // Validato lato server per evitare cheating.
        if (inp.teleport && !p.tpHeld && p.tpCdMs <= 0) {
            const dir = inp.moveX !== 0 ? inp.moveX : p.dir;
            p.x = clamp(p.x + dir * TP_DIST, GW, CW - GW - p.w);
            p.tpCdMs = TP_CD_MS;
        }
        p.tpHeld = inp.teleport;

        // ── SUPERPOTERE: ICE ──────────────────────────────────────
        // Congela l'avversario per ICE_DUR_MS ms.
        // L'effetto si applica all'altro giocatore (seat 1-seat).
        if (inp.ice && !p.iceHeld && p.iceCdMs <= 0) {
            const oppId = this.order[1 - seat as Seat];
            if (oppId && this.players[oppId]) {
                this.players[oppId].frozenMs = ICE_DUR_MS;
            }
            p.iceCdMs = ICE_CD_MS;
        }
        p.iceHeld = inp.ice;

        // ── SUPERPOTERE: Big Head ─────────────────────────────────
        // Aumenta il raggio fisico della testa per BH_DUR_MS ms.
        // Il moltiplicatore BH_HEAD_MULT è usato sia qui (fisica)
        // che nel client (grafica), garantendo coerenza.
        if (inp.bigHead && !p.bhHeld && p.bhCdMs <= 0) {
            p.bigHeadMs = BH_DUR_MS;
            p.bhCdMs    = BH_CD_MS;
        }
        p.bhHeld = inp.bigHead;
    }

    private updateBall(dt: number): void {
        const b = this.ball;

        b.vy += B_GRAV * dt;
        b.x  += b.vx * dt;
        b.y  += b.vy * dt;

        // ── RILEVAMENTO GOL ───────────────────────────────────────
        // Usiamo il CENTRO della palla per il test: se b.x è oltre
        // la linea di porta E la palla è nella zona altezza porta,
        // il gol è immediato — nessun rimbalzo interno possibile.
        //
        // inGoalZone: la palla è verticalmente all'interno della porta
        // (sotto la traversa, sopra il suolo).
        const inGoalZone = b.y > GTY + GPT && b.y < GY;

        if (b.x < GW && inGoalZone) {
            // Palla in porta SINISTRA → punto a DESTRA
            this.score.right += 1;
            this.resetAfterGoal(1);
            return; // stop: palla e giocatori resettati
        }
        if (b.x > CW - GW && inGoalZone) {
            // Palla in porta DESTRA → punto a SINISTRA
            this.score.left += 1;
            this.resetAfterGoal(0);
            return;
        }

        // ── BORDI DEL CAMPO ───────────────────────────────────────
        // I bordi laterali si attivano solo fuori dalla zona porta
        // per non bloccare la palla che sta entrando in porta.
        if (b.x - BR <= 0 && !inGoalZone)  { b.x = BR;       b.vx =  Math.abs(b.vx) * B_BSX; }
        if (b.x + BR >= CW && !inGoalZone) { b.x = CW - BR;  b.vx = -Math.abs(b.vx) * B_BSX; }
        // Soffitto
        if (b.y - BR <= 0) { b.y = BR; b.vy = Math.abs(b.vy) * B_BTY; }
        // Suolo
        if (b.y + BR >= GY) {
            b.y   = GY - BR;
            b.vy *= -B_BGR;
            // Sotto la soglia di velocità la palla smette di rimbalzare
            if (Math.abs(b.vy) < B_VSTOP) b.vy = 0;
            // Attrito: decelera la palla orizzontalmente quando rotola
            b.vx *= Math.pow(B_FRIC, dt * 60);
        }

        // ── COLLISIONI PALLA VS GIOCATORI ─────────────────────────
        ([0, 1] as Seat[]).forEach(seat => {
            const p = this.players[this.order[seat]];
            if (!p) return;
            // Il raggio della testa dipende dal superpotere Big Head
            const headR = p.w * 0.48 * (p.bigHeadMs > 0 ? BH_HEAD_MULT : 1);
            ballVsPlayer(b, p, headR);
        });

        // Rimbalzi sui pali/traversa (solo se NON è già in zona gol)
        if (!inGoalZone) {
            ballVsGoalFrame(b, 0, true);
            ballVsGoalFrame(b, CW - GW, false);
        }
    }

    // ── Snapshot ─────────────────────────────────────────────────

    /**
     * Costruisce lo stato da inviare ai client ogni tick.
     * Contiene tutto ciò che serve per il rendering (posizioni,
     * cooldown, effetti attivi) ma NON i dati interni del server
     * (inp, jumpHeld, ecc.) che sono inutili per il client.
     */
    private buildSnapshot(): object {
        const active = this.phase === 'playing' || this.phase === 'finished';
        return {
            phase:   this.phase,
            score:   { ...this.score },
            timeMs:  Math.max(0, Math.round(this.phase === 'countdown' ? this.cdMs : this.timeMs)),
            ball:    active ? { ...this.ball } : null,
            players: this.order.map((id, i) => {
                const p = this.players[id];
                return {
                    seat:        p.seat,
                    characterId: p.characterId,
                    x: p.x, y: p.y, w: p.w, h: p.h,
                    dir:         p.dir,
                    // Cooldown e stati attivi (per la UI del client)
                    tpCdMs:      p.tpCdMs,
                    iceCdMs:     p.iceCdMs,
                    bhCdMs:      p.bhCdMs,
                    frozenMs:    p.frozenMs,
                    bigHeadMs:   p.bigHeadMs,
                };
            }),
            sels:    this.sels.map(s => ({ ...s })),
            winner:  this.winner,
        };
    }
}

// ═══════════════════════════════════════════════════════════════
//  CLIENT
// ═══════════════════════════════════════════════════════════════

export class HeadBallClient extends GameClient {

    // ── Stato ricevuto dal server (snapshot) ──────────────────────
    private phase     = 'selection';
    private sPlayers: any[] = [];
    private ball:     any   = null;
    private score     = { left: 0, right: 0 };
    private timeMs    = MATCH_MS;
    private sels:     any[] = [];
    private winner:   string | null = null;
    private mySeat    = -1;

    // ── Selezione personaggio (stato locale) ──────────────────────
    private charIdx   = 0;
    private confirmed = false;

    // ── Input diff: inviamo solo quando qualcosa cambia ───────────
    private prev = { moveX: 0, jump: false, teleport: false, ice: false, bigHead: false };

    // ── Fronte tasto per selezione ────────────────────────────────
    private prevSelX    = 0;
    private prevConfirm = false;

    // ── Tasti aggiuntivi (frecce + Enter + Q + E) ─────────────────
    // UserInput del prof gestisce solo W/A/S/D.
    // Registriamo i tasti extra direttamente sul documento.
    private keys: Record<string, boolean> = {};

    private clock  = 0;    // clock per animazioni (secondi)
    private outbox: any[] = [];

    // Scala dal canvas virtuale al viewport reale
    private fit = 1;
    private ox  = 0;  // offset X
    private oy  = 0;  // offset Y

    constructor(ui: UserInput, myId: string) {
        super(ui, myId);
        this.registerKeys();
    }

    /**
     * Registra i tasti che UserInput non gestisce:
     * frecce, Enter (conferma selezione), Q (ice), E (big head).
     */
    private registerKeys(): void {
        const down = (e: KeyboardEvent) => { if (!e.repeat) this.keys[e.code] = true; };
        const up   = (e: KeyboardEvent) => { this.keys[e.code] = false; };
        const blur = () => { Object.keys(this.keys).forEach(k => { this.keys[k] = false; }); };
        document.addEventListener('keydown', down);
        document.addEventListener('keyup',   up);
        window.addEventListener('blur',      blur);
    }

    async init(players: Record<string, any>): Promise<void> {
        this.mySeat = Object.keys(players).indexOf(this.myId);
        return Promise.resolve();
    }

    // ── Ciclo principale (chiamato dal framework ogni frame) ───────

    draw(ctx: CanvasRenderingContext2D, dt: number): void {
        const { screenW, screenH } = this.userInput;

        // Calcola la scala per adattare il canvas virtuale al viewport
        // mantenendo le proporzioni (letterbox/pillarbox)
        this.fit = Math.min(screenW / CW, screenH / CH);
        this.ox  = (screenW - CW * this.fit) / 2;
        this.oy  = (screenH - CH * this.fit) / 2;
        this.clock += dt;

        this.readInput();

        // Sfondo esterno (fuori dal canvas virtuale)
        ctx.fillStyle = '#07111c';
        ctx.fillRect(0, 0, screenW, screenH);

        // Trasformazione: da coordinate virtuali a coordinate schermo
        ctx.save();
        ctx.translate(this.ox, this.oy);
        ctx.scale(this.fit, this.fit);
        // Clip al canvas virtuale per non sforare
        ctx.beginPath(); ctx.rect(0, 0, CW, CH); ctx.clip();

        this.drawBackground(ctx);
        this.drawPitch(ctx);

        // Disegna giocatori e palla solo durante il gioco
        if (this.phase !== 'waiting' && this.phase !== 'selection') {
            this.sPlayers.forEach(p => this.drawPlayer(ctx, p));
            if (this.ball) this.drawBall(ctx, this.ball);
        }

        if (this.phase === 'countdown') this.drawCountdown(ctx);

        this.drawHUD(ctx);

        if (this.phase === 'selection' || this.phase === 'waiting') this.drawSelection(ctx);
        if (this.phase === 'finished')                               this.drawResult(ctx);

        ctx.restore();
    }

    /** Riceve lo snapshot del server e aggiorna lo stato locale. */
    handleMessage(msg: any): void {
        if (!msg) return;
        if ('phase'   in msg) this.phase    = msg.phase;
        if ('score'   in msg) this.score    = msg.score;
        if ('timeMs'  in msg) this.timeMs   = msg.timeMs;
        if ('ball'    in msg) this.ball     = msg.ball;
        if ('players' in msg) this.sPlayers = msg.players;
        if ('sels'    in msg) this.sels     = msg.sels;
        if ('winner'  in msg) this.winner   = msg.winner;
    }

    flushMessages(): any[] {
        const out = [...this.outbox]; this.outbox = []; return out;
    }

    /**
     * Il client non si dichiara mai finito: il framework smonterebbe
     * il canvas e il pannello finale non sarebbe visibile.
     * È il SERVER che gestisce la fine con il proprio isFinished().
     */
    isFinished(): boolean { return false; }

    // ── Lettura input e invio al server ───────────────────────────

    private readInput(): void {
        const ui = this.userInput;
        const k  = this.keys;

        // Combina W/A/S/D con frecce (entrambi funzionano)
        const moveX   = ui.moveDirectionX !== 0 ? ui.moveDirectionX
                      : k['ArrowLeft'] ? -1 : k['ArrowRight'] ? 1 : 0;
        const moveUp  = ui.moveDirectionY < 0  || k['ArrowUp'];
        const moveDown = ui.moveDirectionY > 0 || k['ArrowDown'];
        const confirm  = moveDown || k['Enter'];

        // ── Selezione personaggio ─────────────────────────────────
        if (this.phase === 'selection' && !this.confirmed) {
            // Cambio personaggio sul fronte del tasto (evita scroll rapido)
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
            // Conferma sul fronte (evita spam se il tasto resta premuto)
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
                moveX:    moveX,
                jump:     moveUp,
                teleport: ui.isMouseLeftPressed,
                ice:      k['KeyQ'] === true,
                bigHead:  k['KeyE'] === true,
            };
            // Invia solo se qualcosa è cambiato (risparmia banda)
            const changed = (Object.keys(cur) as (keyof typeof cur)[])
                .some(k2 => cur[k2] !== this.prev[k2]);
            if (changed) {
                this.outbox.push({ kind: 'input', ...cur });
                this.prev = { ...cur };
            }
        }
    }

    // ═══════════════════════════════════════════════════════════════
    //  GRAFICA
    //  Tutte le misure sono proporzionali a CW/CH o alle dimensioni
    //  del giocatore (p.w, p.h) → risoluzione dinamica.
    // ═══════════════════════════════════════════════════════════════

    private drawBackground(ctx: CanvasRenderingContext2D): void {
        // Cielo
        ctx.fillStyle = '#68c8ff'; ctx.fillRect(0, 0, CW, GY);
        // Erba
        ctx.fillStyle = '#239c3d'; ctx.fillRect(0, GY, CW, CH - GY);
        // Linea erba scura
        ctx.fillStyle = '#126d2b'; ctx.fillRect(0, GY, CW, 7);

        // Nuvole animate: si spostano lentamente verso destra
        ctx.save();
        const clouds = [
            { x: 140, y: 60,  s: 1.00, sp: 0.22 },
            { x: 390, y: 48,  s: 1.18, sp: 0.18 },
            { x: 760, y: 62,  s: 0.95, sp: 0.15 },
        ];
        clouds.forEach(c => {
            const x = ((c.x + this.clock * c.sp * 18) % (CW + 100)) - 50;
            ctx.globalAlpha = 0.30;
            ctx.fillStyle   = '#fff';
            ctx.beginPath(); ctx.ellipse(x,           c.y,        46 * c.s, 18 * c.s, 0, 0, Math.PI * 2); ctx.fill();
            ctx.beginPath(); ctx.ellipse(x + 28*c.s,  c.y-8*c.s,  32 * c.s, 14 * c.s, 0, 0, Math.PI * 2); ctx.fill();
        });
        ctx.restore();
    }

    private drawPitch(ctx: CanvasRenderingContext2D): void {
        // Linea centrale tratteggiata
        ctx.save();
        ctx.strokeStyle = 'rgba(255,255,255,0.35)';
        ctx.lineWidth   = 2;
        ctx.setLineDash([10, 8]);
        ctx.beginPath(); ctx.moveTo(CW / 2, GTY); ctx.lineTo(CW / 2, GY); ctx.stroke();
        ctx.setLineDash([]);
        ctx.restore();

        this.drawGoal(ctx, 0,       true);
        this.drawGoal(ctx, CW - GW, false);
    }

    private drawGoal(ctx: CanvasRenderingContext2D, gx: number, isLeft: boolean): void {
        const goalH = GY - GTY;
        const T     = GPT;
        // Palo anteriore (lato campo) e posteriore (fondo porta)
        const frontX = isLeft ? gx + GW - T : gx;
        const backX  = isLeft ? gx          : gx + GW - T;
        const netX   = isLeft ? backX + T   : frontX + T;
        const netW   = GW - T * 2;

        // Rete semitrasparente
        ctx.fillStyle = 'rgba(160,200,240,0.10)';
        ctx.fillRect(netX, GTY + T, netW, goalH - T);

        // Griglia della rete
        ctx.save();
        ctx.beginPath(); ctx.rect(netX, GTY + T, netW, goalH - T); ctx.clip();
        ctx.strokeStyle = 'rgba(210,235,255,0.35)'; ctx.lineWidth = 0.8;
        for (let x = netX + 8; x < netX + netW; x += 8) {
            ctx.beginPath(); ctx.moveTo(x, GTY + T); ctx.lineTo(x, GY); ctx.stroke();
        }
        for (let y = GTY + T + 8; y < GY; y += 8) {
            ctx.beginPath(); ctx.moveTo(netX, y); ctx.lineTo(netX + netW, y); ctx.stroke();
        }
        ctx.restore();

        // Pali
        ctx.fillStyle   = '#c0ccd8'; ctx.fillRect(frontX, GTY, T, goalH);
        ctx.globalAlpha = 0.55;
        ctx.fillStyle   = '#7f8b96'; ctx.fillRect(backX,  GTY + T, T, goalH - T);
        ctx.globalAlpha = 1;
        // Traversa
        ctx.fillStyle   = '#c0ccd8'; ctx.fillRect(gx, GTY, GW, T);
    }

    /**
     * Disegna un personaggio con design compatto testa+corpo+piedi.
     * Tutte le misure derivano da p.w e p.h → scala automatica.
     *
     * Effetti visivi:
     *   - Congelato (frozenMs > 0): overlay azzurro ghiaccio
     *   - Big Head (bigHeadMs > 0): testa ingrandita di BH_HEAD_MULT
     *   - Occhi e piedi seguono la direzione p.dir
     */
    private drawPlayer(ctx: CanvasRenderingContext2D, p: any): void {
        if (!p) return;
        const char   = CHARS.find(c => c.id === p.characterId) ?? CHARS[0];
        const cx     = p.x + p.w / 2;
        const isFrozen  = p.frozenMs  > 0;
        const isBigHead = p.bigHeadMs > 0;

        // ── Proporzioni derivate da p.w ──────────────────────────
        // Tutto proporzionale: funziona a qualsiasi risoluzione.
        const baseHeadR = p.w * 0.48;
        const headR     = baseHeadR * (isBigHead ? BH_HEAD_MULT : 1);
        const headCY    = p.y + p.h * 0.35; // centro testa (più in basso = più compatto)

        // Centro corpo/gambe (sotto la testa)
        const bodyY     = p.y + p.h * 0.68;
        const bodyRX    = p.w * 0.28;
        const bodyRY    = p.h * 0.20;

        ctx.save();

        // ── Ombra a terra ────────────────────────────────────────
        ctx.globalAlpha = 0.20;
        ctx.fillStyle   = '#000';
        ctx.beginPath();
        ctx.ellipse(cx, GY - 2, p.w * 0.40, 6, 0, 0, Math.PI * 2);
        ctx.fill();
        ctx.globalAlpha = 1;

        // ── Corpo / busto ────────────────────────────────────────
        // Ellisse verticale che unisce testa e gambe visivamente
        ctx.fillStyle = char.jersey;
        ctx.beginPath();
        ctx.ellipse(cx, bodyY, bodyRX, bodyRY, 0, 0, Math.PI * 2);
        ctx.fill();

        // ── Piedi ────────────────────────────────────────────────
        // Due scarpe ellittiche. Quella nella direzione del movimento
        // è leggermente avanzata per sembrare "in passo".
        const fR     = p.w * 0.16;
        const fCY    = p.y + p.h * 0.90;
        const spread = p.w * 0.22;
        const d      = p.dir ?? 1;
        [-1, 1].forEach(side => {
            // Il piede nella direzione del movimento avanza di 3px
            const advance = side === d ? 3 : 0;
            const fx = cx + side * spread + advance;
            ctx.fillStyle = '#1a1a2e';
            ctx.beginPath();
            ctx.ellipse(fx, fCY, fR, fR * 0.65, 0, 0, Math.PI * 2);
            ctx.fill();
            // Striscetta colorata sulla scarpa
            ctx.fillStyle = char.trim;
            ctx.beginPath();
            ctx.ellipse(fx, fCY - fR * 0.18, fR * 0.85, fR * 0.30, 0, 0, Math.PI * 2);
            ctx.fill();
        });

        // ── Testa ────────────────────────────────────────────────
        // Gradiente radiale per effetto 3D (luce in alto a sinistra)
        const skinG = ctx.createRadialGradient(
            cx - headR * 0.3, headCY - headR * 0.3, headR * 0.05,
            cx, headCY, headR
        );
        skinG.addColorStop(0,   '#ffe8cc');
        skinG.addColorStop(0.65,'#f5c09a');
        skinG.addColorStop(1,   '#d4895a');

        ctx.beginPath();
        ctx.arc(cx, headCY, headR, 0, Math.PI * 2);
        ctx.fillStyle = skinG;
        ctx.fill();
        ctx.strokeStyle = 'rgba(0,0,0,0.15)';
        ctx.lineWidth   = 1.5;
        ctx.stroke();

        // Fascia/capelli in cima alla testa con il colore della maglia
        ctx.fillStyle = char.jersey;
        ctx.beginPath();
        ctx.ellipse(cx, headCY - headR * 0.72, headR * 0.85, headR * 0.30, 0, 0, Math.PI * 2);
        ctx.fill();

        // ── Occhi ────────────────────────────────────────────────
        // Le pupille seguono la direzione p.dir → sguardo dinamico
        const eyeOffX = headR * 0.32;
        const eyeY    = headCY - headR * 0.05;
        const eyeRX   = headR * 0.20;
        const eyeRY   = headR * 0.24;
        ctx.fillStyle = '#fff';
        [cx - eyeOffX, cx + eyeOffX].forEach(ex => {
            ctx.beginPath();
            ctx.ellipse(ex, eyeY, eyeRX, eyeRY, 0, 0, Math.PI * 2);
            ctx.fill();
        });
        // Pupille spostate nella direzione dello sguardo
        ctx.fillStyle = '#1a0800';
        [cx - eyeOffX, cx + eyeOffX].forEach(ex => {
            ctx.beginPath();
            ctx.arc(ex + d * eyeRX * 0.35, eyeY + eyeRY * 0.10, eyeRX * 0.55, 0, Math.PI * 2);
            ctx.fill();
        });
        // Riflesso bianco nell'occhio
        ctx.fillStyle = 'rgba(255,255,255,0.8)';
        [cx - eyeOffX, cx + eyeOffX].forEach(ex => {
            ctx.beginPath();
            ctx.arc(ex + d * eyeRX * 0.35 - eyeRX * 0.2, eyeY - eyeRY * 0.25, eyeRX * 0.20, 0, Math.PI * 2);
            ctx.fill();
        });

        // ── Effetto CONGELATO ─────────────────────────────────────
        // Overlay azzurro semitrasparente su tutto il personaggio
        if (isFrozen) {
            ctx.globalAlpha = 0.45;
            ctx.fillStyle   = '#a0e8ff';
            ctx.beginPath(); ctx.arc(cx, headCY, headR, 0, Math.PI * 2); ctx.fill();
            ctx.beginPath(); ctx.ellipse(cx, bodyY, bodyRX, bodyRY, 0, 0, Math.PI * 2); ctx.fill();
            ctx.globalAlpha = 1;
            // Cristalli di ghiaccio (semplici linee)
            ctx.strokeStyle = '#c8f0ff'; ctx.lineWidth = 1.5;
            const crystals = [[0,-1],[0.866,0.5],[-0.866,0.5]];
            crystals.forEach(([cx2, cy2]) => {
                ctx.beginPath();
                ctx.moveTo(cx, headCY);
                ctx.lineTo(cx + cx2 * headR * 0.9, headCY + cy2 * headR * 0.9);
                ctx.stroke();
            });
        }

        // ── Label P1 / P2 ─────────────────────────────────────────
        ctx.fillStyle    = p.seat === 0 ? '#4ac7ff' : '#ff7272';
        ctx.font         = `bold ${Math.round(headR * 0.42)}px sans-serif`;
        ctx.textAlign    = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText(p.seat === 0 ? 'P1' : 'P2', cx, headCY - headR * 1.40);

        // ── Barre cooldown superpoteri ────────────────────────────
        this.drawCooldownBars(ctx, p);

        ctx.restore();
    }

    /**
     * Disegna tre mini-barre sopra il giocatore, una per superpotere.
     * La barra si riempie man mano che il cooldown scende.
     * Colori: oro = teleport, ciano = ice, verde = big head.
     */
    private drawCooldownBars(ctx: CanvasRenderingContext2D, p: any): void {
        const bars = [
            { cdMs: p.tpCdMs,  maxMs: TP_CD_MS,  color: '#ffc66e', label: 'TP' },
            { cdMs: p.iceCdMs, maxMs: ICE_CD_MS,  color: '#7df0ff', label: 'ICE' },
            { cdMs: p.bhCdMs,  maxMs: BH_CD_MS,   color: '#68d68d', label: 'BH' },
        ];
        const barW = p.w / bars.length - 2;
        const barH = 4;
        bars.forEach((bar, i) => {
            const bx  = p.x + i * (barW + 2);
            const by  = p.y - 12;
            const pct = bar.cdMs > 0 ? 1 - bar.cdMs / bar.maxMs : 1; // 1 = pronto
            ctx.fillStyle = 'rgba(0,0,0,0.35)';
            ctx.fillRect(bx, by, barW, barH);
            ctx.fillStyle = pct < 1 ? 'rgba(255,255,255,0.2)' : bar.color;
            ctx.fillRect(bx, by, barW * pct, barH);
        });
    }

    private drawBall(ctx: CanvasRenderingContext2D, b: any): void {
        const { x, y } = b;
        ctx.save();

        // Ombra a terra (proiettata sul suolo)
        ctx.globalAlpha = 0.18; ctx.fillStyle = '#000';
        ctx.beginPath();
        ctx.ellipse(x, GY - 3, BR * 0.9, BR * 0.28, 0, 0, Math.PI * 2);
        ctx.fill();
        ctx.globalAlpha = 1;

        // Sfera con gradiente radiale (luce in alto a sinistra)
        const g = ctx.createRadialGradient(x - BR * 0.35, y - BR * 0.35, BR * 0.05, x, y, BR);
        g.addColorStop(0,   '#ffffff');
        g.addColorStop(0.4, '#f0f0f0');
        g.addColorStop(1,   '#8888a0');
        ctx.beginPath(); ctx.arc(x, y, BR, 0, Math.PI * 2);
        ctx.fillStyle = g; ctx.fill();
        ctx.strokeStyle = '#666'; ctx.lineWidth = 1.5; ctx.stroke();

        // Pentagono centrale (pattern pallone da calcio)
        ctx.strokeStyle = '#333'; ctx.lineWidth = 1;
        const verts = [[0,-1],[0.951,-0.309],[0.588,0.809],[-0.588,0.809],[-0.951,-0.309]];
        ctx.beginPath();
        verts.forEach(([vx, vy], i) => {
            const px = x + vx * BR * 0.48, py = y + vy * BR * 0.48;
            i === 0 ? ctx.moveTo(px, py) : ctx.lineTo(px, py);
        });
        ctx.closePath(); ctx.stroke();
        ctx.restore();
    }

    private drawHUD(ctx: CanvasRenderingContext2D): void {
        const tot  = Math.ceil(Math.max(0, this.timeMs) / 1000);
        const mm   = String(Math.floor(tot / 60)).padStart(2, '0');
        const ss   = String(tot % 60).padStart(2, '0');
        const time = this.phase === 'countdown'
            ? String(Math.max(0, Math.ceil(this.timeMs / 1000)))
            : `${mm}:${ss}`;

        ctx.save();
        ctx.font         = `bold ${Math.round(CW * 0.028)}px sans-serif`;
        ctx.textAlign    = 'center';
        ctx.textBaseline = 'top';

        // Ombra per leggibilità su qualsiasi sfondo
        ctx.fillStyle = 'rgba(0,0,0,0.5)';
        ctx.fillText(String(this.score.left),  CW * 0.16 + 1, 13);
        ctx.fillText(time,                     CW / 2 + 1,    13);
        ctx.fillText(String(this.score.right), CW * 0.84 + 1, 13);

        ctx.fillStyle = '#4ac7ff'; ctx.fillText(String(this.score.left),  CW * 0.16, 12);
        ctx.fillStyle = '#ffffff'; ctx.fillText(time,                     CW / 2,    12);
        ctx.fillStyle = '#ff7272'; ctx.fillText(String(this.score.right), CW * 0.84, 12);

        ctx.restore();
    }

    private drawCountdown(ctx: CanvasRenderingContext2D): void {
        ctx.save();
        ctx.fillStyle = 'rgba(7,12,20,0.55)';
        ctx.fillRect(0, 0, CW, CH);

        const n = Math.max(0, Math.ceil(this.timeMs / 1000));
        ctx.fillStyle    = '#ffffff';
        ctx.font         = `800 ${Math.round(CH * 0.20)}px sans-serif`;
        ctx.textAlign    = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText(n > 0 ? String(n) : 'Via!', CW / 2, CH / 2 - 16);

        ctx.font      = `600 ${Math.round(CH * 0.038)}px sans-serif`;
        ctx.fillStyle = 'rgba(228,238,255,0.8)';
        ctx.fillText('Pronti?', CW / 2, CH / 2 + 50);
        ctx.restore();
    }

    private drawSelection(ctx: CanvasRenderingContext2D): void {
        const pw = CW * 0.44, ph = CH * 0.70;
        const px = (CW - pw) / 2, py = (CH - ph) / 2;

        ctx.save();
        ctx.fillStyle = 'rgba(9,18,32,0.93)';
        this.roundRect(ctx, px, py, pw, ph, 24); ctx.fill();
        ctx.strokeStyle = 'rgba(255,255,255,0.15)'; ctx.lineWidth = 1.5;
        this.roundRect(ctx, px, py, pw, ph, 24); ctx.stroke();

        const char = CHARS[this.charIdx];
        ctx.textAlign = 'center'; ctx.textBaseline = 'top';

        ctx.fillStyle = 'rgba(238,245,255,0.55)';
        ctx.font      = `${Math.round(CH * 0.022)}px sans-serif`;
        ctx.fillText('HEAD BALL ONLINE', CW / 2, py + 18);

        ctx.fillStyle = '#eef5ff';
        ctx.font      = `bold ${Math.round(CH * 0.042)}px sans-serif`;
        ctx.fillText(
            this.confirmed           ? 'Pronto! In attesa avversario...' :
            this.phase === 'waiting' ? 'In attesa di avversario...'      :
                                       'Scegli il tuo personaggio',
            CW / 2, py + 42
        );

        // Preview personaggio (pallina colorata)
        const orbX = CW / 2, orbY = py + ph * 0.42;
        const orbR = Math.round(pw * 0.115);
        const gg   = ctx.createRadialGradient(orbX - orbR * 0.35, orbY - orbR * 0.35, orbR * 0.05, orbX, orbY, orbR);
        gg.addColorStop(0, '#fff'); gg.addColorStop(0.5, char.accent); gg.addColorStop(1, char.jersey);
        ctx.beginPath(); ctx.arc(orbX, orbY, orbR, 0, Math.PI * 2);
        ctx.fillStyle = gg; ctx.fill();
        ctx.strokeStyle = 'rgba(255,255,255,0.25)'; ctx.lineWidth = 2; ctx.stroke();

        ctx.fillStyle = '#eef5ff';
        ctx.font      = `bold ${Math.round(CH * 0.036)}px sans-serif`;
        ctx.fillText(char.name, CW / 2, orbY + orbR + 10);

        if (!this.confirmed && this.phase === 'selection') {
            ctx.fillStyle    = 'rgba(255,255,255,0.5)';
            ctx.font         = `${Math.round(CH * 0.048)}px sans-serif`;
            ctx.textBaseline = 'middle';
            ctx.fillText('◀', orbX - orbR * 1.8, orbY);
            ctx.fillText('▶', orbX + orbR * 1.8, orbY);
            ctx.textBaseline = 'top';

            ctx.fillStyle = 'rgba(238,245,255,0.6)';
            ctx.font      = `${Math.round(CH * 0.026)}px sans-serif`;
            ctx.fillText('A / ←  ·  D / →   cambia', CW / 2, py + ph * 0.75);
            ctx.fillStyle = 'rgba(104,214,141,0.9)';
            ctx.font      = `bold ${Math.round(CH * 0.028)}px sans-serif`;
            ctx.fillText('S / Enter   conferma', CW / 2, py + ph * 0.84);
        } else if (this.confirmed) {
            ctx.fillStyle = '#68d68d';
            ctx.font      = `bold ${Math.round(CH * 0.030)}px sans-serif`;
            ctx.fillText('✓ Confermato!', CW / 2, py + ph * 0.80);
        }

        // Stato avversario
        const oppSel = this.sels[this.mySeat === 0 ? 1 : 0];
        if (oppSel) {
            const oppName = CHARS.find(c => c.id === oppSel.characterId)?.name ?? '?';
            ctx.fillStyle = 'rgba(238,245,255,0.40)';
            ctx.font      = `${Math.round(CH * 0.024)}px sans-serif`;
            ctx.fillText(
                oppSel.confirmed ? `Avversario pronto (${oppName})` : 'Avversario sta scegliendo...',
                CW / 2, py + ph - 20
            );
        }
        ctx.restore();
    }

    private drawResult(ctx: CanvasRenderingContext2D): void {
        const pw = CW * 0.44, ph = CH * 0.38;
        const px = (CW - pw) / 2, py = (CH - ph) / 2;
        ctx.save();
        ctx.fillStyle = 'rgba(9,18,32,0.95)';
        this.roundRect(ctx, px, py, pw, ph, 28); ctx.fill();

        ctx.textAlign    = 'center';
        ctx.textBaseline = 'middle';

        ctx.fillStyle = '#eef5ff';
        ctx.font      = `bold ${Math.round(CH * 0.064)}px sans-serif`;
        ctx.fillText(
            this.winner === 'draw'  ? 'Pareggio!'     :
            this.winner === 'left'  ? 'Vince P1  🎉' : 'Vince P2  🎉',
            CW / 2, py + ph * 0.32
        );

        ctx.fillStyle = 'rgba(238,245,255,0.60)';
        ctx.font      = `${Math.round(CH * 0.034)}px sans-serif`;
        ctx.fillText(`${this.score.left} - ${this.score.right}`, CW / 2, py + ph * 0.58);
        ctx.fillText('Attendi la prossima partita...', CW / 2, py + ph * 0.80);
        ctx.restore();
    }

    // ── Utility ───────────────────────────────────────────────────

    /** Disegna un rettangolo con angoli arrotondati (path, non fill/stroke). */
    private roundRect(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number): void {
        ctx.beginPath();
        ctx.moveTo(x + r, y);
        ctx.lineTo(x + w - r, y);    ctx.arcTo(x + w, y,     x + w, y + r,     r);
        ctx.lineTo(x + w, y + h - r); ctx.arcTo(x + w, y + h, x + w - r, y + h, r);
        ctx.lineTo(x + r, y + h);    ctx.arcTo(x,     y + h, x,     y + h - r, r);
        ctx.lineTo(x,     y + r);    ctx.arcTo(x,     y,     x + r, y,         r);
        ctx.closePath();
    }
}