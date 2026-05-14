/**
 * Micro Racing - Circuit Ourspace.
 * Server autoritativo Node.js e client canvas interpolato.
 * Fasi: qualifiche, recap griglia, semaforo, gara, DNF/finale.
 */

import { Player }                   from '../common';
import { IncomingMsg, OutgoingMsg } from '../server';
import { GameClient, GameServer }   from './game';
import { UserInput }                from '../client/user-input';
import { getCharacterDrawFunction } from '../client/characters';

type Punto = { x: number; y: number };
type StatoRigaClassifica = {
    y: number;
    targetY: number;
    lastIndex: number;
    lastBestGiro: number;
    flash: number;
};
type RigaClassificaAnimata = {
    id: string;
    auto: StatoAuto;
    index: number;
    y: number;
    delta: number;
    flash: number;
    improved: boolean;
};


//  TRACCIATO

const MONDO_W = 4800;
const MONDO_H = 3800;
const LARGHEZZA_PISTA = 160; // ampia per permettere sorpassi side-by-side
const MARGINE_QUALI = 10; // px di tolleranza per evitare falsi track-limits in qualifica

/**
 * Waypoint della linea centrale (senso orario).
 * Il punto 0 è il primo waypoint DOPO il traguardo sul rettilineo principale,
 * così la griglia di partenza (posizionata ~200px più a sud) non coincide mai
 * con il raggio del traguardo all'avvio → nessun falso "primo giro".
 */
const WAYPOINTS: Punto[] = [
    // Rettilineo principale (lato est, verso nord)
    { x: 3800, y: 2400 },   // 0  — griglia qui (sotto il traguardo)
    { x: 3800, y: 2100 },   // 1  — traguardo a y≈2250, tra qui e il punto precedente
    { x: 3800, y: 1800 },   // 2
    { x: 3800, y: 1550 },   // 3
    // Tornante 90° verso ovest (curva 1 — lenta)
    { x: 3700, y: 1380 },   // 4
    { x: 3500, y: 1270 },   // 5
    { x: 3300, y: 1230 },   // 6
    // Rettilineo nord-ovest → curva veloce sinistra (curva 2)
    { x: 3000, y: 1210 },   // 7
    { x: 2700, y: 1200 },   // 8
    { x: 2450, y: 1250 },   // 9
    { x: 2250, y: 1370 },   // 10
    // Esse veloci S1 destra (curva 3)
    { x: 2100, y: 1280 },   // 11
    { x: 1950, y: 1160 },   // 12
    { x: 1800, y: 1200 },   // 13
    { x: 1680, y: 1320 },   // 14
    // S2 sinistra (curva 4)
    { x: 1550, y: 1240 },   // 15
    { x: 1420, y: 1160 },   // 16
    { x: 1260, y: 1190 },   // 17
    // Rettilineo ovest → chicane sx/dx (curve 5+6)
    { x: 1050, y: 1300 },   // 18
    { x:  870, y: 1450 },   // 19
    { x:  780, y: 1620 },   // 20
    { x:  870, y: 1800 },   // 21
    // Grande curva a U verso sud (curva 7 — lenta, tecnica)
    { x:  900, y: 2000 },   // 22
    { x:  820, y: 2200 },   // 23
    { x:  750, y: 2450 },   // 24
    { x:  820, y: 2650 },   // 25
    { x: 1000, y: 2780 },   // 26
    // Rettilineo sud → doppia chicane dx/sx (curve 8+9)
    { x: 1350, y: 2820 },   // 27
    { x: 1700, y: 2820 },   // 28
    { x: 2000, y: 2750 },   // 29
    { x: 2150, y: 2620 },   // 30
    { x: 2300, y: 2750 },   // 31
    { x: 2500, y: 2820 },   // 32
    // Rettilineo finale verso traguardo (sud-est)
    { x: 2850, y: 2820 },   // 33
    { x: 3200, y: 2750 },   // 34
    { x: 3500, y: 2620 },   // 35
    { x: 3700, y: 2500 },   // 36
    // → si ricongiunge a wp[0]
];

/**
 * 8 checkpoint distribuiti uniformemente sul giro.
 * Devono essere attraversati in ordine numerico — impediscono tagli aggressivi
 * e la guida al contrario per gonfiare i tempi.
 */
const CHECKPOINTS = [
    { x: 3500, y: 1270, r: 90 },  // CP1: uscita tornante nord-est
    { x: 2700, y: 1200, r: 90 },  // CP2: rettilineo nord
    { x: 1800, y: 1200, r: 90 },  // CP3: esse centrali
    { x:  870, y: 1450, r: 90 },  // CP4: ingresso chicane ovest
    { x:  750, y: 2450, r: 90 },  // CP5: fondo curva a U
    { x: 1350, y: 2820, r: 90 },  // CP6: rettilineo sud
    { x: 2150, y: 2620, r: 90 },  // CP7: doppia chicane sud-est
    { x: 3200, y: 2750, r: 90 },  // CP8: lancio verso traguardo
];
const TUTTI_CHECKPOINT = (1 << CHECKPOINTS.length) - 1;
const CHECKPOINTS_WAYPOINT_INDEX = CHECKPOINTS.map(cp => {
    let bestIndex = 0;
    let bestDist = Infinity;

    for (let i = 0; i < WAYPOINTS.length; i++) {
        const wp = WAYPOINTS[i];
        const dist = Math.hypot(cp.x - wp.x, cp.y - wp.y);
        if (dist < bestDist) {
            bestDist = dist;
            bestIndex = i;
        }
    }

    return bestIndex;
});

// Il traguardo è una fascia stretta centrata sulla linea di arrivo.
const TRAGUARDO    = { x: 3800, y: 2250 };
const TRAGUARDO_LARGHEZZA = LARGHEZZA_PISTA + 18;
const TRAGUARDO_ALTEZZA = 16;
// Offset griglia: file alternate a sinistra/destra, avanzano verso sud (y crescente)
const GRIGLIA_BASE = { dx: 35, dy: 90 };

const LUNGHEZZE_SEGMENTI = WAYPOINTS.map((p, i) => {
    const next = WAYPOINTS[(i + 1) % WAYPOINTS.length];
    return Math.hypot(next.x - p.x, next.y - p.y);
});
const DISTANZE_WAYPOINT = distanzeCumulative(LUNGHEZZE_SEGMENTI);
const LUNGHEZZA_TRACCIATO = LUNGHEZZE_SEGMENTI.reduce((tot, len) => tot + len, 0);


//  COSTANTI FISICHE

const ACCEL          = 290;    // px/s² accelerazione su asfalto
const FRENO          = 560;    // px/s² frenata
const ATTRITO        = 120;    // px/s² attrito passivo su asfalto
const STERZO_RAD     = 3.8;   // rad/s velocità di sterzata
const VEL_MAX        = 315;    // px/s velocità massima su asfalto

// L'auto non rimbalza ma viene fortemente penalizzata sull'erba.
const ERBA_ACCEL_MULT  = 0.5;   // accelerazione ridotta al 50%
const ERBA_VELMAX_MULT = 0.4;   // velocità massima ridotta al 40%
const ERBA_ATTRITO_ADD = 10;    // attrito aggiuntivo sull'erba (si somma a ATTRITO)
//   → attrito totale su erba = 130 px/s² — resta lento ma può rientrare da fermo

const DRIFT          = 0.86;   // ritenzione velocità laterale (effetto derapata)

const TURBO_BONUS    = 1.80;
const TURBO_DURATA   = 0.8;    // secondi
const TURBO_RICARICA = 4.0;    // secondi cooldown

const OLIO_RAGGIO    = 20;     // px raggio chiazza
const OLIO_SPIN      = 1.4;    // secondi di spin-out
const OLIO_RICARICA  = 5.0;
const OLIO_VITA      = 25.0;

const GIRI_GARA         = 1;  //TODO 3 , ORA VERSIONE TEST RAPIDA
const DURATA_QUALIFICHE = 100;  // TODO 2 min, ora versione test rapida
const DURATA_RECAP      = 8;    // secondi schermata griglia
const DURATA_PARTENZA   = 4;    // secondi semaforo (4 luci, 1 per secondo)
const DNF_TIMEOUT       = 60;   // secondi per tagliare il traguardo dopo il primo arrivo
const DURATA_AVVISO_PODIO = 3;
const DURATA_PODIO = 10;

const SCIA_BONUS      = 1.15;  // +15% vel max quando si è in scia
const SCIA_DIST_MAX   = 180;   // px: distanza massima per la scia
const SCIA_CONE_BASE  = 18;    // px: apertura base del cono posteriore
const SCIA_CONE_GAIN  = 0.35;  // px laterali per px di distanza (cono allargato)

const COLORI_AUTO = ['#e74c3c','#3498db','#b7d29b','#f39c12','#9b59b6','#1abc9c','#e67e22','#e91e63'];


//  TIPI CONDIVISI  (server ↔ client via JSON)

type Fase = 'qualifiche' | 'recap' | 'gara';

interface StatoAuto {
    x: number; y: number;
    xPrecedente: number; yPrecedente: number;
    a: number; vx: number; vy: number;
    // Gara
    giri: number;
    cp: number;             // bitmask checkpoint raccolti nel giro corrente (gara)
    // Qualifiche
    cpQual: number;         // bitmask checkpoint raccolti nel giro corrente (quali)
    migliorGiro: number;    // ms, -1 = nessun giro valido
    tempoGiroAttuale: number; // ms dall'inizio del giro corrente
    sulTraguardo: boolean;  // true = auto attualmente nel raggio del traguardo
                            // usato per l'edge-detection: conta solo l'INGRESSO nel raggio
    giroInvalido: boolean;  // true = è uscito dalla pista in questo giro (quali)
    // Power-up
    turboTimer: number; turboCooldown: number;
    olioCooldown: number; spinTimer: number;
    // Meccaniche speciali
    inScia: boolean;        // true = sta beneficiando della scia
    // Metadati
    nome: string; character: string;
    finito: boolean; dnf: boolean; posizione: number;
}

interface ChiazzaOlio { x: number; y: number; vita: number; }

interface MsgInput {
    kind: 'input';
    su: boolean; giu: boolean;
    turbo: boolean; olio: boolean;
    mouseAngolo: number;
}

function inputNeutro(): MsgInput {
    return {
        kind: 'input',
        su: false, giu: false,
        turbo: false, olio: false,
        mouseAngolo: Number.NaN,
    };
}

function normalizzaInput(payload: unknown): MsgInput | null {
    const p = payload as Partial<MsgInput> | null;
    if (!p || p.kind !== 'input') return null;
    const mouseAngolo = typeof p.mouseAngolo === 'number' && Number.isFinite(p.mouseAngolo)
        ? p.mouseAngolo
        : Number.NaN;

    return {
        kind: 'input',
        su: p.su === true,
        giu: p.giu === true,
        turbo: p.turbo === true,
        olio: p.olio === true,
        mouseAngolo,
    };
}

interface MsgStato {
    kind: 'stato';
    fase: Fase;
    tempoQual: number;          // secondi rimasti alle qualifiche
    tempoRecap: number;         // secondi rimasti al recap
    countdownPartenza: number;  // secondi rimasti al semaforo
    dnfTimer: number;           // secondi rimasti prima del DNF globale (-1 = non attivo)
    auto: Record<string, StatoAuto>;
    olio: ChiazzaOlio[];
    garaFinita: boolean;
    gridOrder: string[];
    migliorAssoluto: number;    // ms del giro più veloce tra tutti
}


//  FUNZIONI DI UTILITÀ

/** Distanza minima dal punto P al segmento A→B */
function distSegmento(px: number, py: number,
                      ax: number, ay: number, bx: number, by: number): number {
    const dx = bx - ax, dy = by - ay;
    const len2 = dx * dx + dy * dy;
    if (len2 === 0) return Math.hypot(px - ax, py - ay);
    const t = Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / len2));
    return Math.hypot(px - (ax + t * dx), py - (ay + t * dy));
}

/** Restituisce un array con le distanze cumulative dei segmenti, serve per il calcolo della posizione lungo il percorso */
function distanzeCumulative(lunghezze: number[]): number[] {
    let totale = 0;
    return lunghezze.map(len => {
        const inizioSegmento = totale;
        totale += len;
        return inizioSegmento;
    });
}

function dentroTraguardo(x: number, y: number): boolean {
    return Math.abs(x - TRAGUARDO.x) <= TRAGUARDO_LARGHEZZA / 2
        && Math.abs(y - TRAGUARDO.y) <= TRAGUARDO_ALTEZZA / 2;
}

/** true se il punto (cx, cy) è sull'asfalto */
function sullaStrada(cx: number, cy: number): boolean {
    for (let i = 0; i < WAYPOINTS.length; i++) {
        const a = WAYPOINTS[i];
        const b = WAYPOINTS[(i + 1) % WAYPOINTS.length];
        if (distSegmento(cx, cy, a.x, a.y, b.x, b.y) < LARGHEZZA_PISTA / 2) return true;
    }
    return false;
}


function sullaStradaConMargine(cx: number, cy: number, extra: number): boolean {
    const limite = LARGHEZZA_PISTA / 2 + extra;
    for (let i = 0; i < WAYPOINTS.length; i++) {
        const a = WAYPOINTS[i];
        const b = WAYPOINTS[(i + 1) % WAYPOINTS.length];
        if (distSegmento(cx, cy, a.x, a.y, b.x, b.y) < limite) return true;
    }
    return false;
}

function orientazione(ax: number, ay: number, bx: number, by: number, cx: number, cy: number): number {
    return (bx - ax) * (cy - ay) - (by - ay) * (cx - ax);
}

function puntoSuSegmento(ax: number, ay: number, bx: number, by: number, px: number, py: number): boolean {
    return px >= Math.min(ax, bx) && px <= Math.max(ax, bx)
        && py >= Math.min(ay, by) && py <= Math.max(ay, by)
        && orientazione(ax, ay, bx, by, px, py) === 0;
}

function segmentiSiIntersecano(
    ax: number, ay: number, bx: number, by: number,
    cx: number, cy: number, dx: number, dy: number,
): boolean {
    const o1 = orientazione(ax, ay, bx, by, cx, cy);
    const o2 = orientazione(ax, ay, bx, by, dx, dy);
    const o3 = orientazione(cx, cy, dx, dy, ax, ay);
    const o4 = orientazione(cx, cy, dx, dy, bx, by);

    if (o1 === 0 && puntoSuSegmento(ax, ay, bx, by, cx, cy)) return true;
    if (o2 === 0 && puntoSuSegmento(ax, ay, bx, by, dx, dy)) return true;
    if (o3 === 0 && puntoSuSegmento(cx, cy, dx, dy, ax, ay)) return true;
    if (o4 === 0 && puntoSuSegmento(cx, cy, dx, dy, bx, by)) return true;

    return (o1 > 0) !== (o2 > 0) && (o3 > 0) !== (o4 > 0);
}

function attraversaTraguardo(
    xPrecedente: number,
    yPrecedente: number,
    xAttuale: number,
    yAttuale: number,
): boolean {
    const left = TRAGUARDO.x - TRAGUARDO_LARGHEZZA / 2;
    const right = TRAGUARDO.x + TRAGUARDO_LARGHEZZA / 2;
    const top = TRAGUARDO.y - TRAGUARDO_ALTEZZA / 2;
    const bottom = TRAGUARDO.y + TRAGUARDO_ALTEZZA / 2;

    if (Math.max(xPrecedente, xAttuale) < left || Math.min(xPrecedente, xAttuale) > right) return false;
    if (Math.max(yPrecedente, yAttuale) < top || Math.min(yPrecedente, yAttuale) > bottom) return false;

    if (dentroTraguardo(xPrecedente, yPrecedente) || dentroTraguardo(xAttuale, yAttuale)) return true;

    return segmentiSiIntersecano(
        xPrecedente, yPrecedente, xAttuale, yAttuale,
        left, top, right, top,
    ) || segmentiSiIntersecano(
        xPrecedente, yPrecedente, xAttuale, yAttuale,
        right, top, right, bottom,
    ) || segmentiSiIntersecano(
        xPrecedente, yPrecedente, xAttuale, yAttuale,
        right, bottom, left, bottom,
    ) || segmentiSiIntersecano(
        xPrecedente, yPrecedente, xAttuale, yAttuale,
        left, bottom, left, top,
    );
}

function proiettaSuTracciato(px: number, py: number): number {
    let bestDist = Infinity;
    let bestProgress = 0;

    for (let i = 0; i < WAYPOINTS.length; i++) {
        const a = WAYPOINTS[i];
        const b = WAYPOINTS[(i + 1) % WAYPOINTS.length];
        const dx = b.x - a.x, dy = b.y - a.y;
        const len2 = dx * dx + dy * dy;
        const t = len2 === 0
            ? 0
            : Math.max(0, Math.min(1, ((px - a.x) * dx + (py - a.y) * dy) / len2));
        const sx = a.x + t * dx;
        const sy = a.y + t * dy;
        const dist = Math.hypot(px - sx, py - sy);

        if (dist < bestDist) {
            bestDist = dist;
            bestProgress = DISTANZE_WAYPOINT[i] + LUNGHEZZE_SEGMENTI[i] * t;
            if (bestProgress >= LUNGHEZZA_TRACCIATO) bestProgress -= LUNGHEZZA_TRACCIATO;
        }
    }

    return bestProgress;
}

function aggiornaCheckpoint(mask: number, x: number, y: number): number {
    let prossimoMask = mask;
    for (let i = 0; i < CHECKPOINTS.length; i++) {
        const bit = 1 << i;
        if (prossimoMask & bit) continue;
        if (i > 0 && !(prossimoMask & (1 << (i - 1)))) continue;
        if (Math.hypot(x - CHECKPOINTS[i].x, y - CHECKPOINTS[i].y) < CHECKPOINTS[i].r)
            prossimoMask |= bit;
    }
    return prossimoMask;
}

function tempoQualifica(auto: StatoAuto): number {
    return auto.migliorGiro < 0 ? Infinity : auto.migliorGiro;
}

function confrontaQualifica(a: StatoAuto, b: StatoAuto): number {
    return tempoQualifica(a) - tempoQualifica(b);
}

function calcolaGriglia(auto: Record<string, StatoAuto>): string[] {
    return Object.keys(auto).sort((a, b) => confrontaQualifica(auto[a], auto[b]));
}

/** Miglior tempo assoluto tra tutti i giocatori (-1 se nessuno ha girato) */
function calcolaMigliorAssoluto(auto: Record<string, StatoAuto>): number {
    let best = Infinity;
    for (const id in auto) {
        const t = auto[id].migliorGiro;
        if (t >= 0 && t < best) best = t;
    }
    return best === Infinity ? -1 : best;
}

const DISTANZA_TRAGUARDO = proiettaSuTracciato(TRAGUARDO.x, TRAGUARDO.y);

function progressoLungoGiro(auto: StatoAuto): number {
    return proiettaSuTracciato(auto.x, auto.y);
}

function progressoGara(auto: StatoAuto): number {
    return auto.giri * LUNGHEZZA_TRACCIATO + progressoLungoGiro(auto);
}

function confrontaAutoInGara(a: StatoAuto, b: StatoAuto): number {
    return progressoGara(b) - progressoGara(a);
}

/** ms → "m:ss,ddd" (es. 68423 → "1:08,423") */
function formatTempo(ms: number): string {
    if (ms < 0) return '--:--.---';
    const min  = Math.floor(ms / 60000);
    const sec  = Math.floor((ms % 60000) / 1000);
    const mill = Math.floor(ms % 1000);
    return `${min}:${String(sec).padStart(2, '0')},${String(mill).padStart(3, '0')}`;
}

function normalizzaAngolo(rad: number): number {
    while (rad > Math.PI) rad -= Math.PI * 2;
    while (rad < -Math.PI) rad += Math.PI * 2;
    return rad;
}

/**
 * Aggiorna la fisica dell'auto per dt secondi.
 * Usata sia dal server (tutti) sia internamente per eventuali predizioni lato client.
 *
 * @param bonusScia   moltiplicatore vel max da scia (1 = nessuna scia)
 * @param fuoriPista  true = penalità erba attive
 */
function aggiornaFisica(
    auto: StatoAuto,
    input: { su: boolean; giu: boolean; mouseAngolo: number },
    dt: number,
    bonusScia: number,
    fuoriPista: boolean,
): void {
    // Aggiorna timer
    if (auto.spinTimer     > 0) auto.spinTimer     = Math.max(0, auto.spinTimer     - dt);
    if (auto.turboTimer    > 0) {
        auto.turboTimer -= dt;
        if (auto.turboTimer <= 0) auto.turboCooldown = TURBO_RICARICA;
    }
    if (auto.turboCooldown > 0) auto.turboCooldown = Math.max(0, auto.turboCooldown - dt);
    if (auto.olioCooldown  > 0) auto.olioCooldown  = Math.max(0, auto.olioCooldown  - dt);

    // Spin-out: ruota vorticosamente e frena da sola
    if (auto.spinTimer > 0) {
        auto.a += 5.5 * dt;
        const v = Math.hypot(auto.vx, auto.vy);
        if (v > 0) {
            const f = Math.min(v, ATTRITO * 3 * dt);
            auto.vx -= (auto.vx / v) * f;
            auto.vy -= (auto.vy / v) * f;
        }
        auto.x += auto.vx * dt;
        auto.y += auto.vy * dt;
        return;
    }

    if (Number.isFinite(input.mouseAngolo)) {
        const diff = normalizzaAngolo(input.mouseAngolo - auto.a);
        const maxTurn = STERZO_RAD * dt * 1.7;
        auto.a += Math.sign(diff) * Math.min(Math.abs(diff), maxTurn);
    }

    const fw = { x: Math.cos(auto.a), y: Math.sin(auto.a) };

    // Parametri fisici modulati dalla superficie e dalla scia
    const accelMax = fuoriPista ? ACCEL * ERBA_ACCEL_MULT : ACCEL;
    const velMax   = VEL_MAX
        * (fuoriPista ? ERBA_VELMAX_MULT : 1)
        * (auto.turboTimer > 0 ? TURBO_BONUS : 1)
        * bonusScia;
    const attritoTot = fuoriPista ? ATTRITO + ERBA_ATTRITO_ADD : ATTRITO;

    if (input.su) {
        auto.vx += fw.x * accelMax * dt;
        auto.vy += fw.y * accelMax * dt;
    }
    if (input.giu) {
        const v = Math.hypot(auto.vx, auto.vy);
        if (v > 5) {
            auto.vx -= (auto.vx / v) * FRENO * dt;
            auto.vy -= (auto.vy / v) * FRENO * dt;
        }
    }

    // Drift: decompone in avanti + laterale e riduce la laterale
    const fwdVel = auto.vx * fw.x + auto.vy * fw.y;
    const latX   = auto.vx - fw.x * fwdVel;
    const latY   = auto.vy - fw.y * fwdVel;
    auto.vx = fw.x * fwdVel + latX * DRIFT;
    auto.vy = fw.y * fwdVel + latY * DRIFT;

    // Attrito passivo (più forte su erba)
    const v = Math.hypot(auto.vx, auto.vy);
    if (v > 0) {
        const f = Math.min(v, attritoTot * dt);
        auto.vx -= (auto.vx / v) * f;
        auto.vy -= (auto.vy / v) * f;
    }

    // Limita velocità massima (modulata da turbo e scia)
    const vAtt = Math.hypot(auto.vx, auto.vy);
    if (vAtt > velMax) {
        auto.vx = (auto.vx / vAtt) * velMax;
        auto.vy = (auto.vy / vAtt) * velMax;
    }

    auto.x += auto.vx * dt;
    auto.y += auto.vy * dt;
}

/** Posizione di griglia: file alternate sinistra/destra, avanzano verso sud */
function posGriglia(i: number): { x: number; y: number; a: number } {
    const lato = i % 2 === 0 ? -1 : 1;
    const fila  = Math.floor(i / 2);
    return {
        x: TRAGUARDO.x + lato * GRIGLIA_BASE.dx,
        y: TRAGUARDO.y + 150 + fila * GRIGLIA_BASE.dy, // 150px sotto il traguardo
        a: -Math.PI / 2,   // punta verso nord ()
    };
}


//  SERVER  —  autoritative, gira su Node.js

export class MicroRacingServer extends GameServer {

    private auto: Record<string, StatoAuto> = {};
    private olio: ChiazzaOlio[] = [];
    private fase: Fase          = 'qualifiche';
    private tempoQual           = DURATA_QUALIFICHE;
    private tempoRecap          = DURATA_RECAP;
    private countdownPartenza   = 0;    // >0 = semaforo attivo, input bloccati
    private dnfTimer            = -1;   // -1 = non attivo
    private gridOrder: string[] = [];
    private garaFinita          = false;
    private totGiocatori        = 0;
    private ultimiInput: Record<string, MsgInput> = {};


    init(giocatori: Record<string, Player>): void {
        let i = 0;
        for (const id in giocatori) {
            const g = posGriglia(i);
            this.auto[id] = {
                x: g.x, y: g.y, xPrecedente: g.x, yPrecedente: g.y,
                a: g.a, vx: 0, vy: 0,
                giri: 0, cp: 0, cpQual: 0,
                migliorGiro: -1, tempoGiroAttuale: 0,
                sulTraguardo: false,   // edge-detection: falso all'avvio
                giroInvalido: false,
                turboTimer: 0, turboCooldown: 0, olioCooldown: 0, spinTimer: 0,
                inScia: false,
                nome: giocatori[id].name, character: giocatori[id].character,
                finito: false, dnf: false, posizione: 0,
            };
            this.ultimiInput[id] = inputNeutro();
            i++;
        }
        this.totGiocatori = i;
    }

    tick(messaggi: IncomingMsg[], dt: number): OutgoingMsg[] {
        const garaAttiva      = this.fase === 'gara' && this.countdownPartenza <= 0;
        const simulazioneOn   = this.fase === 'qualifiche' || garaAttiva;

        this.registraInput(messaggi);
        if (simulazioneOn) this.simulaAuto(dt, garaAttiva);
        else if (this.fase === 'gara') this.tieniFermeLeAuto();

        if (garaAttiva) this.risolviCollisioniAuto();
        if (simulazioneOn) this.aggiornaOlio(dt);

        if      (this.fase === 'qualifiche') this.tickQualifiche(dt);
        else if (this.fase === 'recap')      this.tickRecap(dt);
        else                                 this.tickGara(dt);

        const payload: MsgStato = {
            kind: 'stato', fase: this.fase,
            tempoQual: this.tempoQual, tempoRecap: this.tempoRecap,
            countdownPartenza: this.countdownPartenza, dnfTimer: this.dnfTimer,
            auto: this.auto, olio: this.olio,
            garaFinita: this.garaFinita, gridOrder: this.gridOrder,
            migliorAssoluto: calcolaMigliorAssoluto(this.auto),
        };
        return [{ payload }];
    }

    isFinished(): boolean { return this.garaFinita; }

    private registraInput(messaggi: IncomingMsg[]): void {
        for (const msg of messaggi) {
            const input = normalizzaInput(msg.payload);
            if (!input || !this.auto[msg.clientId]) continue;
            this.ultimiInput[msg.clientId] = input;
        }
    }

    private simulaAuto(dt: number, garaAttiva: boolean): void {
        for (const id in this.auto) {
            const auto = this.auto[id];
            const input = this.ultimiInput[id] ?? inputNeutro();
            if (garaAttiva && auto.finito) continue;

            auto.xPrecedente = auto.x;
            auto.yPrecedente = auto.y;

            this.usaPowerUp(auto, input);

            const fuoriPrima = !sullaStradaConMargine(auto.x, auto.y, MARGINE_QUALI);
            if (this.fase === 'qualifiche' && fuoriPrima) auto.giroInvalido = true;

            const bonusScia = garaAttiva ? this.calcolaBonusScia(id) : 1;
            auto.inScia = bonusScia > 1;
            aggiornaFisica(auto, input, dt, bonusScia, fuoriPrima);

            if (this.fase === 'qualifiche' && !sullaStradaConMargine(auto.x, auto.y, MARGINE_QUALI))
                auto.giroInvalido = true;
        }
    }

    private usaPowerUp(auto: StatoAuto, input: MsgInput): void {
        if (input.turbo && auto.turboTimer <= 0 && auto.turboCooldown <= 0)
            auto.turboTimer = TURBO_DURATA;

        if (this.fase === 'gara' && input.olio && auto.olioCooldown <= 0) {
            auto.olioCooldown = OLIO_RICARICA;
            this.olio.push({
                x: auto.x - Math.cos(auto.a) * 25,
                y: auto.y - Math.sin(auto.a) * 25,
                vita: OLIO_VITA,
            });
        }

        input.turbo = false;
        input.olio = false;
    }

    private tieniFermeLeAuto(): void {
        for (const id in this.auto) {
            this.auto[id].vx = 0;
            this.auto[id].vy = 0;
            this.auto[id].inScia = false;
        }
    }

    private risolviCollisioniAuto(): void {
        const ids = Object.keys(this.auto);
        for (let i = 0; i < ids.length - 1; i++) {
            for (let j = i + 1; j < ids.length; j++) {
                const a = this.auto[ids[i]], b = this.auto[ids[j]];
                if (a.finito || b.finito) continue;

                const d = Math.hypot(a.x - b.x, a.y - b.y);
                if (d >= 12 || d <= 0) continue;

                const nx = (b.x - a.x) / d, ny = (b.y - a.y) / d;
                const ov = (12 - d) / 2;
                a.x -= nx * ov; a.y -= ny * ov;
                b.x += nx * ov; b.y += ny * ov;

                const va = a.vx * nx + a.vy * ny;
                const vb = b.vx * nx + b.vy * ny;
                a.vx += (vb - va) * nx * 0.7; a.vy += (vb - va) * ny * 0.7;
                b.vx += (va - vb) * nx * 0.7; b.vy += (va - vb) * ny * 0.7;
            }
        }
    }

    private aggiornaOlio(dt: number): void {
        this.olio = this.olio.filter(o => (o.vita -= dt) > 0);
        for (const id in this.auto) {
            const auto = this.auto[id];
            if (auto.spinTimer > 0) continue;

            for (const o of this.olio) {
                if (Math.hypot(auto.x - o.x, auto.y - o.y) < OLIO_RAGGIO) {
                    auto.spinTimer = OLIO_SPIN;
                    break;
                }
            }
        }
    }


    private tickQualifiche(dt: number): void {
        this.tempoQual -= dt;

        for (const id in this.auto) {
            const a = this.auto[id];

            // Accumula tempo giro (in millisecondi)
            a.tempoGiroAttuale += dt * 1000;

            a.cpQual = aggiornaCheckpoint(a.cpQual, a.x, a.y);

            // Edge-detection traguardo: il giro si conta solo all'INGRESSO nella fascia di arrivo.
            // Senza questo, ogni tick in cui l'auto è dentro verrebbe contato
            // come un nuovo "passaggio", resettando il cronometro più volte.
            const haAttraversatoTraguardo = attraversaTraguardo(a.xPrecedente, a.yPrecedente, a.x, a.y);
            const nelTraguardo = dentroTraguardo(a.x, a.y);

            if ((nelTraguardo || haAttraversatoTraguardo) && !a.sulTraguardo) {
                // L'auto è appena entrata nel raggio del traguardo
                if ((a.cpQual & TUTTI_CHECKPOINT) === TUTTI_CHECKPOINT) {
                    // Giro valido: salva il tempo se non è invalido e se è il migliore
                    if (!a.giroInvalido) {
                        const t = a.tempoGiroAttuale;
                        if (a.migliorGiro < 0 || t < a.migliorGiro) a.migliorGiro = t;
                    }
                }
                // In ogni caso (giro valido, invalido, o primo passaggio dalla griglia):
                // resetta cronometro e checkpoint per iniziare un giro pulito.
                a.tempoGiroAttuale = 0;
                a.cpQual = 0;
                a.giroInvalido = false;
            }

            a.sulTraguardo = nelTraguardo;
        }

        // Fine qualifiche → calcola griglia e passa al recap
        if (this.tempoQual <= 0) {
            this.tempoQual = 0;
            this.gridOrder = calcolaGriglia(this.auto);
            for (const id in this.auto) { this.auto[id].vx = 0; this.auto[id].vy = 0; }
            this.fase      = 'recap';
            this.tempoRecap = DURATA_RECAP;
        }
    }


    private tickRecap(dt: number): void {
        this.tempoRecap -= dt;
        if (this.tempoRecap <= 0) {
            this.tempoRecap = 0;
            this.avviaGara();
        }
    }

    /** Riposiziona le auto in griglia secondo i risultati delle qualifiche e accende il semaforo */
    private avviaGara(): void {
        this.fase               = 'gara';
        this.countdownPartenza  = DURATA_PARTENZA;
        this.dnfTimer           = -1;

        this.gridOrder.forEach((id, i) => {
            const g = posGriglia(i);
            const a = this.auto[id];
            a.x = g.x; a.y = g.y; a.a = g.a;
            a.xPrecedente = g.x; a.yPrecedente = g.y;
            a.vx = 0; a.vy = 0;
            a.giri = 0; a.cp = 0;
            a.sulTraguardo = false;  // fondamentale: riparte fuori dalla fascia di arrivo
            a.finito = false; a.dnf = false; a.posizione = 0;
            a.giroInvalido = false; a.inScia = false;
        });
    }


    private tickGara(dt: number): void {
        // Semaforo: decrementa il countdown; input bloccati nel tick() sopra
        if (this.countdownPartenza > 0) {
            this.countdownPartenza = Math.max(0, this.countdownPartenza - dt);
            return; // nessuna logica di checkpoint finché non parte
        }

        let finiti = 0;
        const candidati: { auto: StatoAuto; haCompletatoGiri: boolean; progress: number }[] = [];
        let haVincitoreQuestoTick = false;

        for (const id in this.auto) {
            const a = this.auto[id];
            if (a.finito) { finiti++; continue; }

            a.cp = aggiornaCheckpoint(a.cp, a.x, a.y);

            const haAttraversatoTraguardo = attraversaTraguardo(a.xPrecedente, a.yPrecedente, a.x, a.y);
            const nelTraguardo = dentroTraguardo(a.x, a.y);

            if ((nelTraguardo || haAttraversatoTraguardo) && !a.sulTraguardo) {
                if ((a.cp & TUTTI_CHECKPOINT) === TUTTI_CHECKPOINT) {
                    a.giri++;
                    a.cp = 0;

                    const haCompletatoGiri = a.giri >= GIRI_GARA;
                    candidati.push({
                        auto: a,
                        haCompletatoGiri,
                        progress: progressoGara(a),
                    });
                    if (haCompletatoGiri) haVincitoreQuestoTick = true;
                } else if (this.fase === 'qualifiche') {
                    a.cp = 0;
                }
            }

            a.sulTraguardo = nelTraguardo;
        }

        const finitiPrima = finiti;
        const dnfAttivoOra = this.dnfTimer > 0 || (finitiPrima === 0 && haVincitoreQuestoTick);
        const nuoviFiniti = candidati.filter(c => c.haCompletatoGiri || dnfAttivoOra);

        if (nuoviFiniti.length > 0) {
            nuoviFiniti.sort((a, b) => b.progress - a.progress);
            for (const f of nuoviFiniti) {
                f.auto.finito = true;
                f.auto.posizione = ++finiti;
            }
            if (this.dnfTimer < 0 && finitiPrima === 0 && haVincitoreQuestoTick)
                this.dnfTimer = DNF_TIMEOUT;
        }

        // Tutti hanno finito → gara conclusa
        if (finiti >= this.totGiocatori) {
            this.garaFinita = true;
            return;
        }

        // DNF globale: allo scadere del timer, chi non ha finito prende DNF
        if (this.dnfTimer >= 0) {
            this.dnfTimer = Math.max(0, this.dnfTimer - dt);
            if (this.dnfTimer === 0) {
                const nonFiniti = Object.keys(this.auto)
                    .filter(id => !this.auto[id].finito)
                    .sort((a, b) => confrontaAutoInGara(this.auto[a], this.auto[b]));
                for (const id of nonFiniti) {
                    const a = this.auto[id];
                    a.finito    = true;
                    a.dnf       = true;
                    a.posizione = ++finiti;
                }
                this.garaFinita = true;
                this.dnfTimer = -1;
            }
        }
    }

    /**
     * Calcola il bonus scia per l'auto `idFollower`.
     * Un'auto è in scia se si trova nel cono posteriore dell'auto davanti:
     *   - distanza < SCIA_DIST_MAX
     *   - proiezione lungo l'asse del leader > 0 (è dietro)
     *   - distanza laterale < SCIA_CONE_BASE + distanza * SCIA_CONE_GAIN
     */
    private calcolaBonusScia(idFollower: string): number {
        const follower = this.auto[idFollower];
        if (!follower) return 1;

        for (const id in this.auto) {
            if (id === idFollower) continue;
            const leader = this.auto[id];
            if (!leader || leader.finito) continue;

            const dx = follower.x - leader.x;
            const dy = follower.y - leader.y;
            const dist = Math.hypot(dx, dy);
            if (dist > SCIA_DIST_MAX || dist < 8) continue;

            // Asse del leader: forward e laterale
            const fwX = Math.cos(leader.a);
            const fwY = Math.sin(leader.a);

            // "lungoAsse" > 0 significa che il follower è DIETRO il leader
            const lungoAsse = -(dx * fwX + dy * fwY);
            if (lungoAsse <= 0) continue;

            // Distanza laterale dall'asse del leader
            const laterale = Math.abs(dx * (-fwY) + dy * fwX);
            const aperturaCono = SCIA_CONE_BASE + lungoAsse * SCIA_CONE_GAIN;

            if (laterale <= aperturaCono) return SCIA_BONUS;
        }

        return 1;
    }
}


//  CLIENT  —  gira nel browser, solo rendering e invio input

export class MicroRacingClient extends GameClient {

    // Stato ricevuto dal server (fonte di verità)
    private statoServer: Record<string, StatoAuto> | null = null;
    // Versioni interpolate per rendering fluido (anti-scatto da rete)
    private renderAuto: Record<string, StatoAuto> = {};

    private olioServer: ChiazzaOlio[]  = [];
    private fase: Fase                 = 'qualifiche';
    private tempoQual                  = DURATA_QUALIFICHE;
    private tempoRecap                 = DURATA_RECAP;
    private countdownPartenza          = 0;
    private dnfTimer                   = -1;
    private garaFinita                 = false;
    private gridOrder: string[]        = [];
    private migliorAssoluto            = -1;
    private colori: Record<string, string> = {};

    // Telecamera: segue l'auto del giocatore locale con smooth lerp
    private camX = TRAGUARDO.x;
    private camY = TRAGUARDO.y;
    private readonly ZOOM = 1.65;

    private trackCanvas: HTMLCanvasElement | null = null;
    private tasti = { su: false, giu: false, turbo: false, olio: false };
    private turboPremuto = false;
    private olioPremuto = false;
    private mouseSterzoAttivo = false;
    private animTime       = 0;
    private garaFinitaTimer = -1;
    private wrongWayTimer = 0;
    private classificaAnim: Record<string, StatoRigaClassifica> = {};
    private classificaAnimFase: 'qualifiche' | 'gara' | null = null;

    // goFlashTimer: dura ~0.9s dopo il GO! per mostrare il testo verde
    private goFlashTimer = 0;

    constructor(userInput: UserInput, myId: string) {
        super(userInput, myId);
        this.registraTasti();
    }


    async init(giocatori: Record<string, Player>): Promise<void> {
        let i = 0;
        for (const id in giocatori) this.colori[id] = COLORI_AUTO[i++ % COLORI_AUTO.length];
        this.trackCanvas = this.costruisciCanvas();
    }

    handleMessage(msg: MsgStato): void {
        if (msg.kind !== 'stato') return;

        // Rileva il momento in cui il semaforo scatta a 0 → mostra "GO!"
        const countdownPrecedente = this.countdownPartenza;
        this.fase               = msg.fase;
        this.tempoQual          = msg.tempoQual;
        this.tempoRecap         = msg.tempoRecap;
        this.countdownPartenza  = msg.countdownPartenza;
        this.dnfTimer           = msg.dnfTimer;
        this.olioServer         = msg.olio;
        this.garaFinita         = msg.garaFinita;
        this.gridOrder          = msg.gridOrder;
        this.migliorAssoluto    = msg.migliorAssoluto;

        if (countdownPrecedente > 0 && this.countdownPartenza <= 0 && this.fase === 'gara')
            this.goFlashTimer = 0.9;

        if (this.garaFinita && this.garaFinitaTimer < 0)
            this.garaFinitaTimer = DURATA_AVVISO_PODIO + DURATA_PODIO;

        // Prima ricezione: inizializza renderAuto
        if (!this.statoServer) {
            this.statoServer = msg.auto;
            for (const id in msg.auto) this.renderAuto[id] = { ...msg.auto[id] };
            return;
        }

        // Aggiorna stato server; gestisce entrate/uscite di giocatori
        for (const id in msg.auto) {
            if (!this.statoServer[id]) this.renderAuto[id] = { ...msg.auto[id] };
            this.statoServer[id] = msg.auto[id];
        }
        for (const id in this.statoServer)
            if (!msg.auto[id]) { delete this.statoServer[id]; delete this.renderAuto[id]; }
    }

    flushMessages(): MsgInput[] {
        const input: MsgInput = {
            kind: 'input',
            ...this.tasti,
            mouseAngolo: this.calcolaAngoloMouse(),
        };
        this.tasti.turbo = false;
        this.tasti.olio = false;
        return [input];
    }

    isFinished(): boolean { return this.garaFinitaTimer === 0; }


    draw(ctx: CanvasRenderingContext2D, dt: number): void {
        if (!this.statoServer) return;
        this.animTime += dt;
        if (this.garaFinitaTimer > 0) this.garaFinitaTimer = Math.max(0, this.garaFinitaTimer - dt);
        if (this.goFlashTimer    > 0) this.goFlashTimer    = Math.max(0, this.goFlashTimer    - dt);

        const { screenW: W, screenH: H } = this.userInput;
        const me = this.statoServer[this.myId];

        if (me) this.aggiornaContromano(me, dt);
        else this.wrongWayTimer = 0;

        this.interpolaRenderAuto(dt);

        // Camera: durante il recap va al centro del tracciato; altrimenti segue il giocatore
        if (this.fase === 'recap') {
            const cx = MONDO_W / 2, cy = MONDO_H / 2;
            this.camX += (cx - this.camX) * Math.min(1, dt * 3);
            this.camY += (cy - this.camY) * Math.min(1, dt * 3);
        } else if (me) {
            this.camX += (me.x - this.camX) * Math.min(1, dt * 9);
            this.camY += (me.y - this.camY) * Math.min(1, dt * 9);
        }

        ctx.fillStyle = '#3a7d44';
        ctx.fillRect(0, 0, W, H);

        ctx.save();
        ctx.translate(W / 2, H / 2);
        ctx.scale(this.ZOOM, this.ZOOM);
        ctx.translate(-this.camX, -this.camY);

        if (this.trackCanvas) ctx.drawImage(this.trackCanvas, 0, 0);
        for (const o of this.olioServer)          this.disegnaOlio(ctx, o);
        for (const id in this.renderAuto)          this.disegnaAuto(ctx, id, this.renderAuto[id]);

        ctx.restore();

        if (this.fase === 'recap') {
            this.disegnaRecap(ctx, W, H);
        } else {
            this.disegnaHUD(ctx, me, W, H);
            this.disegnaSemaforo(ctx, W);
            this.disegnaClassifica(ctx, W, dt);
            if (this.garaFinitaTimer < 0) this.disegnaAvvisoContromano(ctx, W, H);
            if (this.garaFinitaTimer >= 0) this.disegnaFinale(ctx, me, W, H);
        }
    }


    /**
     * Avvicina renderAuto verso statoServer ogni frame.
     * Posizione e angolo vengono interpolati (lerp) per nascondere la latenza di rete.
     * Tutti gli altri campi sono autorevoli e vengono copiati direttamente.
     */
    private interpolaRenderAuto(dt: number): void {
        if (!this.statoServer) return;
        const alpha = Math.min(1, dt * 15);

        for (const id in this.statoServer) {
            const t = this.statoServer[id];
            const c = this.renderAuto[id] ?? { ...t };

            // Lerp posizione
            c.x += (t.x - c.x) * alpha;
            c.y += (t.y - c.y) * alpha;

            // Lerp angolo sul percorso più breve (evita giri da 360°)
            let da = t.a - c.a;
            while (da >  Math.PI) da -= Math.PI * 2;
            while (da < -Math.PI) da += Math.PI * 2;
            c.a += da * alpha;

            // Campi gameplay: sempre autorevoli
            c.vx = t.vx; c.vy = t.vy;
            c.xPrecedente = t.xPrecedente; c.yPrecedente = t.yPrecedente;
            c.giri = t.giri; c.cp = t.cp; c.cpQual = t.cpQual;
            c.turboTimer = t.turboTimer; c.turboCooldown = t.turboCooldown;
            c.olioCooldown = t.olioCooldown; c.spinTimer = t.spinTimer;
            c.inScia = t.inScia; c.giroInvalido = t.giroInvalido;
            c.sulTraguardo = t.sulTraguardo;
            c.nome = t.nome; c.character = t.character;
            c.finito = t.finito; c.dnf = t.dnf; c.posizione = t.posizione;
            c.migliorGiro = t.migliorGiro; c.tempoGiroAttuale = t.tempoGiroAttuale;

            this.renderAuto[id] = c;
        }
    }

    /**
     * Anima la classifica facendo scorrere i riquadri verso la nuova posizione.
     * Quando cambia l'ordine, il box si muove invece di saltare di colpo.
     */
    private aggiornaClassificaAnimata(voci: [string, StatoAuto][], dt: number): RigaClassificaAnimata[] {
        const faseClassifica = this.fase === 'qualifiche' ? 'qualifiche' : 'gara';
        if (this.classificaAnimFase !== faseClassifica) {
            this.classificaAnimFase = faseClassifica;
            this.classificaAnim = {};
        }

        const rowH = 24;
        const pad = 8;
        const smoothing = Math.min(1, dt * 12);
        const present = new Set<string>();
        const animati: RigaClassificaAnimata[] = [];

        voci.forEach(([id, auto], index) => {
            const targetY = 10 + rowH * (index + 1) + pad;
            const bestGiroAttuale = auto.migliorGiro;
            let stato = this.classificaAnim[id];

            if (!stato) {
                stato = {
                    y: targetY,
                    targetY,
                    lastIndex: index,
                    lastBestGiro: bestGiroAttuale,
                    flash: 0,
                };
            }

            const delta = stato.lastIndex - index;
            const migliorato = faseClassifica === 'qualifiche'
                && bestGiroAttuale > 0
                && (stato.lastBestGiro < 0 || bestGiroAttuale < stato.lastBestGiro - 1);

            if (delta !== 0 || migliorato) stato.flash = 1;

            stato.targetY = targetY;
            stato.y += (stato.targetY - stato.y) * smoothing;
            stato.flash = Math.max(0, stato.flash - dt * 2.1);
            stato.lastIndex = index;
            stato.lastBestGiro = bestGiroAttuale;

            this.classificaAnim[id] = stato;
            present.add(id);
            animati.push({
                id,
                auto,
                index,
                y: stato.y,
                delta,
                flash: stato.flash,
                improved: migliorato,
            });
        });

        for (const id in this.classificaAnim) {
            if (!present.has(id)) delete this.classificaAnim[id];
        }

        return animati.sort((a, b) => a.y - b.y || a.index - b.index);
    }

    private calcolaAngoloMouse(): number {
        const me = this.statoServer?.[this.myId];
        if (!me || !this.mouseSterzoAttivo || this.userInput.screenW <= 0 || this.userInput.screenH <= 0)
            return Number.NaN;

        const mouseWorldX = this.camX + (this.userInput.mouseX - this.userInput.screenW / 2) / this.ZOOM;
        const mouseWorldY = this.camY + (this.userInput.mouseY - this.userInput.screenH / 2) / this.ZOOM;
        const dx = mouseWorldX - me.x;
        const dy = mouseWorldY - me.y;

        if (Math.hypot(dx, dy) < 12) return me.a;
        return Math.atan2(dy, dx);
    }

    private deltaProgressoLungoGiro(x: number, y: number, px: number, py: number): number {
        const now = proiettaSuTracciato(x, y);
        const prev = proiettaSuTracciato(px, py);
        let delta = now - prev;
        const half = LUNGHEZZA_TRACCIATO / 2;
        if (delta > half) delta -= LUNGHEZZA_TRACCIATO;
        else if (delta < -half) delta += LUNGHEZZA_TRACCIATO;
        return delta;
    }

    private isContromano(me: StatoAuto): boolean {
        const dx = me.x - me.xPrecedente;
        const dy = me.y - me.yPrecedente;
        const dist = Math.hypot(dx, dy);
        if (dist < 3) return false;
        const delta = this.deltaProgressoLungoGiro(me.x, me.y, me.xPrecedente, me.yPrecedente);
        return delta < -4;
    }

    private aggiornaContromano(me: StatoAuto, dt: number): void {
        if (this.fase === 'recap') {
            this.wrongWayTimer = 0;
            return;
        }
        const contromano = this.isContromano(me);
        this.wrongWayTimer = contromano
            ? Math.min(1, this.wrongWayTimer + dt * 2)
            : Math.max(0, this.wrongWayTimer - dt * 1.4);
    }

    private disegnaAvvisoContromano(ctx: CanvasRenderingContext2D, W: number, H: number): void {
        if (this.wrongWayTimer <= 0) return;
        const alpha = Math.min(1, this.wrongWayTimer);
        const boxW = 300;
        const boxH = 34;
        const x = W / 2 - boxW / 2;
        const y = H - 110;
        ctx.fillStyle = `rgba(0,0,0,${0.55 * alpha})`;
        ctx.fillRect(x, y, boxW, boxH);
        ctx.textAlign = 'center';
        ctx.font = 'bold 18px Arial';
        ctx.fillStyle = `rgba(255,80,80,${alpha})`;
        ctx.fillText('CONTROMANO', W / 2, y + 23);
    }


    private disegnaAuto(ctx: CanvasRenderingContext2D, id: string, auto: StatoAuto): void {
        const colore = this.colori[id] ?? '#fff';
        const sonoIo = id === this.myId;
        // hw = half-width, hh = half-height (nel sistema ruotato: hh negativo = muso)
        const hw = 5, hh = 10;

        ctx.save();

        // Ghosting in qualifica: le auto avversarie sono semi-trasparenti
        if (this.fase === 'qualifiche' && !sonoIo) ctx.globalAlpha = 0.45;

        ctx.translate(auto.x, auto.y);
        ctx.rotate(auto.a + Math.PI / 2);

        // --- OMBRA ---
        ctx.fillStyle = 'rgba(0,0,0,0.25)';
        ctx.beginPath();
        ctx.ellipse(1.5, 2, hw + 2, hh, 0, 0, Math.PI * 2);
        ctx.fill();

        // --- PNEUMATICI (4 rettangoli scuri che sbordano lateralmente) ---
        const tW = 3.5, tH = 4;
        ctx.fillStyle = '#111';
        ctx.beginPath(); ctx.roundRect(-hw - tW + 0.5, -hh + 2,      tW, tH, 1); ctx.fill(); // ant sx
        ctx.beginPath(); ctx.roundRect( hw - 0.5,       -hh + 2,      tW, tH, 1); ctx.fill(); // ant dx
        ctx.beginPath(); ctx.roundRect(-hw - tW + 0.5,  hh - 2 - tH, tW, tH, 1); ctx.fill(); // post sx
        ctx.beginPath(); ctx.roundRect( hw - 0.5,        hh - 2 - tH, tW, tH, 1); ctx.fill(); // post dx
        // cerchio ruota (cerchione)
        ctx.fillStyle = 'rgba(255,255,255,0.22)';
        for (const [tx, ty] of [
            [-hw - tW/2 + 0.5, -hh + 2 + tH/2],
            [ hw + tW/2 - 0.5, -hh + 2 + tH/2],
            [-hw - tW/2 + 0.5,  hh - 2 - tH/2],
            [ hw + tW/2 - 0.5,  hh - 2 - tH/2],
        ] as [number,number][]) {
            ctx.beginPath(); ctx.arc(tx, ty, 1.3, 0, Math.PI * 2); ctx.fill();
        }

        // --- ALA ANTERIORE (sottile barra larga, colorata al centro) ---
        ctx.fillStyle = auto.finito ? '#555' : '#111';
        ctx.beginPath(); ctx.roundRect(-hw - 5, -hh - 2, (hw + 5) * 2, 2.5, 1); ctx.fill();
        ctx.fillStyle = auto.finito ? '#777' : colore;
        ctx.fillRect(-3, -hh - 2, 6, 2.5);

        // --- CORPO PRINCIPALE a ogiva ---
        ctx.fillStyle = auto.finito ? '#888' : colore;
        ctx.beginPath();
        ctx.moveTo(0,       -hh);       // punta muso
        ctx.lineTo( hw*0.55, -hh + 3.5); // spalla ant dx
        ctx.lineTo( hw,      -hh + 6);   // fianco ant dx
        ctx.lineTo( hw,       hh - 5);   // fianco post dx
        ctx.lineTo( hw*0.75,  hh);       // coda dx
        ctx.lineTo(-hw*0.75,  hh);       // coda sx
        ctx.lineTo(-hw,       hh - 5);   // fianco post sx
        ctx.lineTo(-hw,      -hh + 6);   // fianco ant sx
        ctx.lineTo(-hw*0.55, -hh + 3.5); // spalla ant sx
        ctx.closePath();
        ctx.fill();

        // bordo corpo
        ctx.strokeStyle = sonoIo ? '#fff' : 'rgba(0,0,0,0.45)';
        ctx.lineWidth   = sonoIo ? 1.2 : 0.7;
        ctx.stroke();

        // --- STRISCIA CENTRALE (livrea) ---
        ctx.fillStyle = 'rgba(255,255,255,0.18)';
        ctx.beginPath();
        ctx.moveTo(0, -hh + 1);
        ctx.lineTo(1.5, -hh + 6);
        ctx.lineTo(1.5, hh - 2);
        ctx.lineTo(-1.5, hh - 2);
        ctx.lineTo(-1.5, -hh + 6);
        ctx.closePath();
        ctx.fill();

        // --- SIDEPODS (riflesso chiaro sui fianchi) ---
        ctx.fillStyle = 'rgba(255,255,255,0.10)';
        ctx.beginPath(); ctx.ellipse(-hw * 0.72, 1, 1.5, 4.5, 0, 0, Math.PI * 2); ctx.fill();
        ctx.beginPath(); ctx.ellipse( hw * 0.72, 1, 1.5, 4.5, 0, 0, Math.PI * 2); ctx.fill();

        // --- COCKPIT / HALO (zona scura) ---
        ctx.fillStyle = 'rgba(0,0,0,0.60)';
        ctx.beginPath(); ctx.ellipse(0, -1.5, 2.8, 4.5, 0, 0, Math.PI * 2); ctx.fill();

        // --- CASCO PILOTA ---
        ctx.fillStyle = sonoIo ? '#f1c40f' : '#ddd';
        ctx.beginPath(); ctx.arc(0, -2, 1.9, 0, Math.PI * 2); ctx.fill();
        ctx.fillStyle = 'rgba(120,200,255,0.55)';
        ctx.beginPath(); ctx.ellipse(0, -3.2, 1.3, 0.8, 0, 0, Math.PI * 2); ctx.fill(); // visiera

        // --- ALA POSTERIORE ---
        ctx.fillStyle = auto.finito ? '#555' : '#111';
        ctx.beginPath(); ctx.roundRect(-hw - 3.5, hh + 1, (hw + 3.5) * 2, 2.5, 1); ctx.fill();
        ctx.fillStyle = auto.finito ? '#777' : colore;
        ctx.fillRect(-2.5, hh + 1, 5, 2.5);

        // --- FIAMMA TURBO con flickering ---
        if (auto.turboTimer > 0) {
            const len = 5 + Math.sin(this.animTime * 25) * 2;
            ctx.fillStyle = '#ff7700'; ctx.shadowColor = '#ffaa00'; ctx.shadowBlur = 6;
            ctx.beginPath();
            ctx.moveTo(-2.5, hh + 4); ctx.lineTo(0, hh + 4 + len); ctx.lineTo(2.5, hh + 4);
            ctx.closePath(); ctx.fill(); ctx.shadowBlur = 0;
        }

        // --- CERCHIO SPIN-OUT ---
        if (auto.spinTimer > 0) {
            ctx.strokeStyle = '#ffff00'; ctx.lineWidth = 1.2; ctx.setLineDash([3, 3]);
            ctx.beginPath(); ctx.arc(0, 0, hh * 1.1, 0, Math.PI * 2); ctx.stroke();
            ctx.setLineDash([]);
        }

        ctx.restore();

        // Nome sopra l'auto (sempre orizzontale, fuori dalla rotazione)
        ctx.save();
        ctx.font = `bold ${sonoIo ? 8 : 7}px Arial`; ctx.textAlign = 'center';
        if (this.fase === 'qualifiche' && !sonoIo) ctx.globalAlpha = 0.45;
        ctx.fillStyle = 'rgba(0,0,0,0.55)';
        ctx.fillRect(auto.x - 18, auto.y - hh - 12, 36, 10);
        ctx.fillStyle = sonoIo ? '#ffff88' : '#fff';
        ctx.fillText(auto.nome.substring(0, 8), auto.x, auto.y - hh - 4);
        ctx.restore();
    }

    private disegnaOlio(ctx: CanvasRenderingContext2D, o: ChiazzaOlio): void {
        ctx.save();
        ctx.globalAlpha = Math.min(0.9, o.vita / 5);
        ctx.fillStyle = '#111';
        ctx.beginPath(); ctx.ellipse(o.x, o.y, OLIO_RAGGIO, OLIO_RAGGIO * 0.55, 0, 0, Math.PI * 2); ctx.fill();
        const g = ctx.createRadialGradient(o.x - 4, o.y - 2, 1, o.x, o.y, OLIO_RAGGIO);
        g.addColorStop(0, 'rgba(140,0,255,0.5)'); g.addColorStop(0.6, 'rgba(0,210,180,0.25)'); g.addColorStop(1, 'rgba(0,0,0,0)');
        ctx.fillStyle = g;
        ctx.beginPath(); ctx.ellipse(o.x, o.y, OLIO_RAGGIO, OLIO_RAGGIO * 0.55, 0, 0, Math.PI * 2); ctx.fill();
        ctx.restore();
    }


    private disegnaHUD(ctx: CanvasRenderingContext2D, me: StatoAuto | undefined, W: number, H: number): void {
        if (!me) return;
        const p = 14;

        const pannelloH = this.fase === 'qualifiche' ? 195 : 130;
        ctx.fillStyle = 'rgba(0,0,0,0.58)';
        ctx.fillRect(p - 3, p - 3, 242, pannelloH);

        if (this.fase === 'qualifiche') {
            // Timer qualifiche
            ctx.font = 'bold 14px Arial'; ctx.textAlign = 'left'; ctx.fillStyle = '#f1c40f';
            ctx.fillText('⏱ QUALIFICHE', p, p + 16);

            const min = Math.floor(this.tempoQual / 60);
            const sec = Math.ceil(this.tempoQual % 60);
            ctx.font = 'bold 36px Arial';
            ctx.fillStyle = this.tempoQual < 30 ? '#e74c3c' : '#fff';
            ctx.fillText(`${min}:${String(sec).padStart(2, '0')}`, p, p + 56);

            // Avviso giro invalido
            if (me.giroInvalido) {
                ctx.font = 'bold 11px Arial'; ctx.fillStyle = '#ff6b6b';
                ctx.fillText('⚠ GIRO INVALIDO (fuori pista)', p, p + 72);
            }

            ctx.fillStyle = 'rgba(255,255,255,0.12)';
            ctx.fillRect(p, p + 78, 225, 1);

            // Tre righe tempi
            this.disegnaRigaTempo(ctx, p, p + 96,  'Giro corrente', formatTempo(me.tempoGiroAttuale), '#fff');
            this.disegnaRigaTempo(ctx, p, p + 116, 'Mio miglior giro', formatTempo(me.migliorGiro), '#7fff7f');
            this.disegnaRigaTempo(ctx, p, p + 136, 'Miglior assoluto', formatTempo(this.migliorAssoluto), '#f1c40f');

        } else {
            // Gara: contatore giri
            ctx.font = 'bold 26px Arial'; ctx.textAlign = 'left'; ctx.fillStyle = '#fff';
            ctx.fillText(`Giro ${Math.min(me.giri + 1, GIRI_GARA)} / ${GIRI_GARA}`, p, p + 30);

            // Timer DNF in cima allo schermo
            if (this.dnfTimer >= 0 && this.countdownPartenza <= 0) {
                const sec = Math.ceil(this.dnfTimer);
                ctx.fillStyle = 'rgba(0,0,0,0.65)';
                ctx.fillRect(W / 2 - 105, 10, 210, 34);
                ctx.textAlign = 'center'; ctx.font = 'bold 15px Arial';
                ctx.fillStyle = sec <= 10 ? '#ff6b6b' : '#f1c40f';
                ctx.fillText(`Gara termina tra ${sec}s`, W / 2, 32);
            }

            // Indicatore scia
            if (me.inScia) {
                ctx.fillStyle = 'rgba(0,150,255,0.18)';
                ctx.fillRect(p - 3, p + 42, 130, 22);
                ctx.font = 'bold 13px Arial'; ctx.textAlign = 'left'; ctx.fillStyle = '#7ecfff';
                ctx.fillText('⚡ SCIA ATTIVA', p + 4, p + 57);
            }
        }

        // Barre turbo e olio
        const turboY = this.fase === 'qualifiche' ? p + 152 : p + 52;
        const turboPct = me.turboTimer > 0
            ? me.turboTimer / TURBO_DURATA
            : Math.max(0, 1 - me.turboCooldown / TURBO_RICARICA);
        this.disegnaBarra(ctx, p, turboY, 185, 12, turboPct,
            me.turboTimer > 0 ? '#ff6a00' : turboPct >= 1 ? '#00aaff' : '#004488', 'TURBO [SPAZIO]');

        const olioPct = Math.max(0, 1 - me.olioCooldown / OLIO_RICARICA);
        this.disegnaBarra(ctx, p, turboY + 28, 185, 12, olioPct, '#222', 'OLIO [SHIFT]', true);

        // Velocità (in basso a destra)
        const vel = Math.round(Math.hypot(me.vx, me.vy));
        ctx.fillStyle = 'rgba(0,0,0,0.55)';
        ctx.fillRect(W - 118, H - 44, 110, 36);
        ctx.font = 'bold 22px Arial'; ctx.textAlign = 'right'; ctx.fillStyle = '#fff';
        ctx.fillText(`${vel} m/s`, W - 10, H - 14);

        this.disegnaMiniMappa(ctx, me, W, H);
    }

    private disegnaMiniMappa(ctx: CanvasRenderingContext2D, me: StatoAuto, W: number, H: number): void {
        const size = 150;
        const pad = 12;
        const x = W - size - pad;
        const y = H - size - pad - 52;

        ctx.save();
        ctx.fillStyle = 'rgba(0,0,0,0.55)';
        ctx.fillRect(x - 3, y - 3, size + 6, size + 6);
        ctx.fillStyle = 'rgba(20,20,20,0.85)';
        ctx.fillRect(x, y, size, size);

        // Tracciato
        ctx.strokeStyle = 'rgba(255,255,255,0.35)';
        ctx.lineWidth = 2;
        ctx.lineJoin = 'round';
        ctx.beginPath();
        for (let i = 0; i <= WAYPOINTS.length; i++) {
            const p = WAYPOINTS[i % WAYPOINTS.length];
            const mx = x + (p.x / MONDO_W) * size;
            const my = y + (p.y / MONDO_H) * size;
            if (i === 0) ctx.moveTo(mx, my); else ctx.lineTo(mx, my);
        }
        ctx.stroke();

        // Auto giocatore
        const px = x + (me.x / MONDO_W) * size;
        const py = y + (me.y / MONDO_H) * size;
        ctx.translate(px, py);
        ctx.rotate(me.a);
        ctx.fillStyle = '#f1c40f';
        ctx.strokeStyle = 'rgba(0,0,0,0.6)';
        ctx.lineWidth = 1.2;
        ctx.beginPath();
        ctx.moveTo(7, 0);
        ctx.lineTo(-5, -4);
        ctx.lineTo(-3, 0);
        ctx.lineTo(-5, 4);
        ctx.closePath();
        ctx.fill();
        ctx.stroke();

        ctx.restore();
    }

    /** Riga etichetta + valore allineati a sinistra/destra nel pannello HUD */
    private disegnaRigaTempo(ctx: CanvasRenderingContext2D,
        x: number, y: number, etichetta: string, valore: string, coloreValore: string): void {
        ctx.font = '11px Arial'; ctx.textAlign = 'left'; ctx.fillStyle = '#aaa';
        ctx.fillText(etichetta, x, y);
        ctx.font = 'bold 13px Arial'; ctx.textAlign = 'right'; ctx.fillStyle = coloreValore;
        ctx.fillText(valore, x + 232, y);
    }

    private disegnaBarra(ctx: CanvasRenderingContext2D,
        x: number, y: number, w: number, h: number,
        pct: number, colore: string, etichetta: string, iridescente = false): void {
        ctx.fillStyle = 'rgba(0,0,0,0.45)'; ctx.fillRect(x - 1, y - 1, w + 2, h + 2);
        ctx.fillStyle = colore; ctx.fillRect(x, y, w * pct, h);
        if (iridescente && pct > 0) {
            const g = ctx.createLinearGradient(x, y, x + w * pct, y);
            g.addColorStop(0, 'rgba(140,0,255,0.6)'); g.addColorStop(1, 'rgba(0,255,200,0.6)');
            ctx.fillStyle = g; ctx.fillRect(x, y, w * pct, h);
        }
        ctx.font = 'bold 10px Arial'; ctx.textAlign = 'left'; ctx.fillStyle = '#bbb';
        ctx.fillText(etichetta, x, y + h + 11);
    }


    /**
     * Disegna 4 luci rosse che si accendono una per secondo (simulando il semaforo F1),
     * poi tutte si spengono e compare "GO!" in verde.
     *
     * La logica di scaglionamento usa DURATA_PARTENZA=4 secondi:
     *   - elapsed 0→1s: 1 luce accesa
     *   - elapsed 1→2s: 2 luci accese
     *   - elapsed 2→3s: 3 luci accese
     *   - elapsed 3→4s: 4 luci accese
     *   - countdown = 0: tutte spente + "GO!" per goFlashTimer secondi
     */
    private disegnaSemaforo(ctx: CanvasRenderingContext2D, W: number): void {
        const inPreStart  = this.fase === 'gara' && this.countdownPartenza > 0;
        const inGoFlash   = this.fase === 'gara' && this.countdownPartenza <= 0 && this.goFlashTimer > 0;
        if (!inPreStart && !inGoFlash) return;

        ctx.fillStyle = 'rgba(0,0,0,0.60)';
        ctx.fillRect(W / 2 - 150, 10, 300, 88);

        // Calcola quante luci sono accese in base al tempo trascorso
        const elapsed  = DURATA_PARTENZA - this.countdownPartenza;
        const nAccese  = inPreStart ? Math.max(0, Math.min(4, Math.ceil(elapsed))) : 0;

        for (let i = 0; i < 4; i++) {
            const x = W / 2 - 90 + i * 60;
            const y = 52;
            const accesa = inPreStart && i < nAccese;

            // Bagliore rosso sulle luci accese
            if (accesa) {
                ctx.shadowColor = '#ff3b30'; ctx.shadowBlur = 18;
            }
            ctx.beginPath();
            ctx.arc(x, y, 20, 0, Math.PI * 2);
            ctx.fillStyle = accesa ? '#ff3b30' : '#3a1515';
            ctx.fill();
            ctx.strokeStyle = 'rgba(255,255,255,0.15)'; ctx.lineWidth = 2;
            ctx.stroke();
            ctx.shadowBlur = 0;
        }

        ctx.textAlign = 'center';
        if (inPreStart) {
            // Numero di secondi rimasti
            ctx.font = 'bold 16px Arial'; ctx.fillStyle = '#fff';
            ctx.fillText(String(Math.ceil(this.countdownPartenza)), W / 2, 86);
        } else {
            // GO! in verde, con fade-out
            ctx.font = 'bold 28px Arial';
            ctx.fillStyle = `rgba(100,255,100,${this.goFlashTimer / 0.9})`;
            ctx.fillText('GO!', W / 2, 74);
        }
    }


    private disegnaClassifica(ctx: CanvasRenderingContext2D, W: number, dt: number): void {
        if (!this.statoServer) return;

        let voci: [string, StatoAuto][];
        if (this.fase === 'qualifiche') {
            voci = Object.entries(this.statoServer).sort((a, b) => confrontaQualifica(a[1], b[1]));
        } else {
            // In gara: chi ha finito prima, poi chi è ancora in pista per giri
            const finiti = Object.entries(this.statoServer)
                .filter(([, a]) => a.finito)
                .sort((a, b) => {
                    if (a[1].dnf !== b[1].dnf) return a[1].dnf ? 1 : -1;
                    return a[1].posizione - b[1].posizione;
                });
            const inGara = Object.entries(this.statoServer)
                .filter(([, a]) => !a.finito)
                .sort((a, b) => confrontaAutoInGara(a[1], b[1]));
            voci = [...finiti, ...inGara];
        }

        const lbW = 228, rowH = 24, pad = 8;
        const lbX = W - lbW - 10;
        ctx.fillStyle = 'rgba(0,0,0,0.65)';
        ctx.fillRect(lbX, 10, lbW, rowH * (voci.length + 1) + pad);
        ctx.font = 'bold 12px Arial'; ctx.textAlign = 'left'; ctx.fillStyle = '#f1c40f';
        ctx.fillText(this.fase === 'qualifiche' ? 'TEMPI QUALIFICHE' : 'CLASSIFICA GARA', lbX + pad, 26);

        const tempoLeader = calcolaMigliorAssoluto(this.statoServer);
        const righe = this.aggiornaClassificaAnimata(voci, dt);

        righe.forEach((riga) => {
            const { id, auto, index, y, delta, flash, improved } = riga;
            const sonoIo = id === this.myId;
            const migliorato = this.fase === 'qualifiche' && improved;
            const accent = this.fase === 'qualifiche'
                ? (migliorato ? '#7fff7f' : '#f1c40f')
                : (delta > 0 ? '#7fff7f' : delta < 0 ? '#ff9b9b' : '#f1c40f');

            const rowX = lbX;
            const rowY = y - 11;

            ctx.fillStyle = sonoIo
                ? 'rgba(52,152,219,0.28)'
                : index % 2 === 0 ? 'rgba(255,255,255,0.05)' : 'rgba(0,0,0,0.1)';
            ctx.fillRect(rowX, rowY, lbW, rowH - 2);

            if (flash > 0) {
                ctx.fillStyle = this.fase === 'qualifiche'
                    ? `rgba(127,255,127,${0.25 * flash})`
                    : delta > 0
                        ? `rgba(127,255,127,${0.22 * flash})`
                        : `rgba(255,107,107,${0.18 * flash})`;
                ctx.fillRect(rowX, rowY, lbW, rowH - 2);
            }

            if (this.fase === 'qualifiche' && delta !== 0) {
                ctx.fillStyle = delta > 0 ? 'rgba(127,255,127,0.12)' : 'rgba(255,107,107,0.12)';
                ctx.fillRect(rowX, rowY, lbW, rowH - 2);
            }

            // Pastiglia colore auto
            ctx.fillStyle = this.colori[id] ?? '#fff';
            ctx.fillRect(lbX + pad, y - 11, 9, 12);

            // Nome pilota
            ctx.font = sonoIo ? 'bold 11px Arial' : '11px Arial';
            ctx.fillStyle = sonoIo ? '#ffff88' : '#fff';
            ctx.textAlign = 'left';
            ctx.fillText(`${index + 1}. ${auto.nome.substring(0, 9)}`, lbX + pad + 13, y);

            // Tempo / stato
            ctx.textAlign = 'right'; ctx.font = '10px Arial';
            if (this.fase === 'qualifiche') {
                if (migliorato && auto.migliorGiro > 0) {
                    ctx.fillStyle = accent;
                    ctx.fillText(formatTempo(auto.migliorGiro), lbX + lbW - pad, y);
                } else if (auto.migliorGiro > 0 && tempoLeader > 0) {
                    ctx.fillStyle = '#ccc';
                    ctx.fillText(`+${auto.migliorGiro - tempoLeader} ms`, lbX + lbW - pad, y);
                } else {
                    ctx.fillStyle = '#555';
                    ctx.fillText('--', lbX + lbW - pad, y);
                }
            } else {
                if (auto.dnf) {
                    ctx.fillStyle = '#ff9b9b';
                    ctx.fillText('DNF', lbX + lbW - pad, y);
                } else if (auto.finito) {
                    ctx.fillStyle = '#bbb';
                    ctx.fillText('✓ ARR.', lbX + lbW - pad, y);
                } else {
                    ctx.fillStyle = accent;
                    ctx.fillText(`G${auto.giri + 1}`, lbX + lbW - pad, y);
                }
            }

            if (this.fase === 'gara' && delta !== 0) {
                ctx.textAlign = 'center';
                ctx.font = 'bold 10px Arial';
                ctx.fillStyle = accent;
                ctx.fillText(delta > 0 ? `▲${Math.abs(delta)}` : `▼${Math.abs(delta)}`, lbX + lbW - 44, y);
            }

            if (migliorato) {
                ctx.textAlign = 'center';
                ctx.font = 'bold 9px Arial';
                ctx.fillStyle = '#7fff7f';
                ctx.fillText('PB', lbX + lbW - 44, y - 10);
            }
        });
    }


    /**
     * Schermata tra qualifiche e gara.
     * Mostra la griglia di partenza DALL'ULTIMO AL PRIMO (come in F1/MotoGP):
     * l'ultimo qualificato è in cima, la pole è in fondo evidenziata in oro.
     */
    private disegnaRecap(ctx: CanvasRenderingContext2D, W: number, H: number): void {
        if (!this.statoServer) return;

        ctx.fillStyle = 'rgba(0,0,0,0.85)'; ctx.fillRect(0, 0, W, H);

        ctx.textAlign = 'center';
        ctx.font = 'bold 38px Arial'; ctx.fillStyle = '#f1c40f';
        ctx.fillText('GRIGLIA DI PARTENZA', W / 2, 52);
        ctx.font = '17px Arial'; ctx.fillStyle = '#aaa';
        ctx.fillText('La gara inizia tra...', W / 2, 80);

        const cd = Math.ceil(this.tempoRecap);
        ctx.font = 'bold 50px Arial'; ctx.fillStyle = '#fff';
        ctx.fillText(String(cd), W / 2, 140);

        const progresso = 1 - this.tempoRecap / DURATA_RECAP;
        const barW = 260, barX = W / 2 - barW / 2;
        ctx.fillStyle = 'rgba(255,255,255,0.12)'; ctx.fillRect(barX, 150, barW, 7);
        ctx.fillStyle = '#f1c40f'; ctx.fillRect(barX, 150, barW * progresso, 7);

        ctx.fillStyle = 'rgba(255,255,255,0.12)';
        ctx.fillRect(W / 2 - 190, 168, 380, 1);

        const gridRev     = [...this.gridOrder].reverse();
        const tempoLeader = this.gridOrder.length > 0
            ? (this.statoServer[this.gridOrder[0]]?.migliorGiro ?? -1)
            : -1;

        const rigaH = 44, startY = 178, listaW = 440;
        const listaX = W / 2 - listaW / 2;

        gridRev.forEach((id, idx) => {
            const auto = this.statoServer![id];
            if (!auto) return;

            const posGrig = this.gridOrder.length - idx; // 1 = pole (in fondo alla lista invertita)
            const isPole  = posGrig === 1;
            const sonoIo  = id === this.myId;
            const ry      = startY + idx * rigaH;

            // Sfondo riga
            ctx.fillStyle = isPole
                ? 'rgba(200,155,30,0.35)'
                : sonoIo
                    ? 'rgba(52,152,219,0.28)'
                    : idx % 2 === 0 ? 'rgba(255,255,255,0.05)' : 'rgba(0,0,0,0.1)';
            ctx.fillRect(listaX, ry, listaW, rigaH - 2);

            // Posizione griglia (grande, a sinistra)
            ctx.font = `bold ${isPole ? 26 : 22}px Arial`; ctx.textAlign = 'left';
            ctx.fillStyle = isPole ? '#f1c40f' : sonoIo ? '#7ecfff' : '#888';
            ctx.fillText(`P${posGrig}`, listaX + 10, ry + rigaH * 0.68);

            // Pastiglia colore auto
            ctx.fillStyle = this.colori[id] ?? '#fff';
            ctx.fillRect(listaX + 58, ry + 12, 10, rigaH - 26);

            // Nome pilota
            ctx.font = sonoIo ? 'bold 15px Arial' : '14px Arial';
            ctx.fillStyle = sonoIo ? '#ffff88' : '#fff';
            ctx.fillText(auto.nome.substring(0, 14), listaX + 76, ry + rigaH * 0.66);

            // Etichetta pole
            if (isPole) {
                ctx.font = '11px Arial'; ctx.fillStyle = '#f1c40f';
                ctx.fillText('🏆 POLE', listaX + 76, ry + rigaH * 0.66 - 16);
            }

            // Tempo qualifiche (a destra)
            ctx.textAlign = 'right'; ctx.font = isPole ? 'bold 13px Arial' : '12px Arial';
            if (isPole && auto.migliorGiro > 0) {
                ctx.fillStyle = '#7fff7f';
                ctx.fillText(formatTempo(auto.migliorGiro), listaX + listaW - 10, ry + rigaH * 0.66);
            } else if (auto.migliorGiro > 0 && tempoLeader > 0) {
                ctx.fillStyle = '#ccc';
                ctx.fillText(`+${auto.migliorGiro - tempoLeader} ms`, listaX + listaW - 10, ry + rigaH * 0.66);
            } else {
                ctx.fillStyle = '#555';
                ctx.fillText('senza tempo', listaX + listaW - 10, ry + rigaH * 0.66);
            }
        });

        ctx.textAlign = 'center'; ctx.font = '12px Arial'; ctx.fillStyle = 'rgba(255,255,255,0.35)';
        ctx.fillText('Le macchine vengono riposizionate automaticamente', W / 2, startY + rigaH * gridRev.length + 20);
    }


    private disegnaFinale(ctx: CanvasRenderingContext2D, me: StatoAuto | undefined, W: number, H: number): void {
        if (this.garaFinitaTimer > DURATA_PODIO) {
            this.disegnaAvvisoPodio(ctx, me, W, H);
        } else {
            this.disegnaPodio(ctx, W, H);
        }
    }

    private disegnaAvvisoPodio(ctx: CanvasRenderingContext2D, me: StatoAuto | undefined, W: number, H: number): void {
        const secondi = Math.max(1, Math.ceil(this.garaFinitaTimer - DURATA_PODIO));

        ctx.fillStyle = 'rgba(0,0,0,0.78)';
        ctx.fillRect(0, 0, W, H);
        ctx.textAlign = 'center';
        ctx.font = 'bold 54px Arial';
        ctx.fillStyle = '#f1c40f';
        ctx.fillText('GARA FINITA!', W / 2, H / 2 - 105);

        if (me?.finito) {
            ctx.font = 'bold 26px Arial';
            ctx.fillStyle = '#fff';
            ctx.fillText(me.dnf ? 'DNF - non hai completato la gara in tempo' : `Hai concluso P${me.posizione}!`, W / 2, H / 2 - 55);
        }

        ctx.font = 'bold 30px Arial';
        ctx.fillStyle = '#fff';
        ctx.fillText('Il podio sta per iniziare', W / 2, H / 2 + 25);
        ctx.font = 'bold 72px Arial';
        ctx.fillStyle = '#7ecfff';
        ctx.fillText(String(secondi), W / 2, H / 2 + 110);
    }

    private disegnaPodio(ctx: CanvasRenderingContext2D, W: number, H: number): void {
        const topTre = this.topTreFinale();
        const tempoRimasto = Math.max(0, Math.ceil(this.garaFinitaTimer));

        ctx.save();

        const bg = ctx.createLinearGradient(0, 0, 0, H);
        bg.addColorStop(0, '#17181d');
        bg.addColorStop(0.55, '#0d0f12');
        bg.addColorStop(1, '#050506');
        ctx.fillStyle = bg;
        ctx.fillRect(0, 0, W, H);

        const glowSinistra = ctx.createRadialGradient(W * 0.18, H * 0.16, 0, W * 0.18, H * 0.16, Math.max(W, H) * 0.7);
        glowSinistra.addColorStop(0, 'rgba(255, 71, 58, 0.22)');
        glowSinistra.addColorStop(0.55, 'rgba(255, 71, 58, 0.08)');
        glowSinistra.addColorStop(1, 'rgba(255, 71, 58, 0)');
        ctx.fillStyle = glowSinistra;
        ctx.fillRect(0, 0, W, H);

        const glowDestra = ctx.createRadialGradient(W * 0.82, H * 0.18, 0, W * 0.82, H * 0.18, Math.max(W, H) * 0.65);
        glowDestra.addColorStop(0, 'rgba(241, 196, 15, 0.18)');
        glowDestra.addColorStop(0.55, 'rgba(241, 196, 15, 0.05)');
        glowDestra.addColorStop(1, 'rgba(241, 196, 15, 0)');
        ctx.fillStyle = glowDestra;
        ctx.fillRect(0, 0, W, H);

        const floorTop = H - 132;
        const floorGrad = ctx.createLinearGradient(0, floorTop, 0, H);
        floorGrad.addColorStop(0, 'rgba(255,255,255,0.04)');
        floorGrad.addColorStop(1, 'rgba(0,0,0,0.32)');
        ctx.fillStyle = floorGrad;
        ctx.fillRect(0, floorTop, W, 132);
        ctx.strokeStyle = 'rgba(255,255,255,0.05)';
        ctx.lineWidth = 2;
        for (let x = -40; x < W + 60; x += 120) {
            ctx.beginPath();
            ctx.moveTo(x, floorTop + 22);
            ctx.lineTo(x + 44, H);
            ctx.stroke();
        }

        const bannerY = 18;
        const bannerH = 30;
        const bannerW = Math.min(W * 0.64, 440);
        const bannerX = W / 2 - bannerW / 2;
        const cellsX = 18;
        const cellW = bannerW / cellsX;
        const cellH = bannerH / 2;
        ctx.fillStyle = '#0a0a0a';
        ctx.fillRect(bannerX - 4, bannerY - 4, bannerW + 8, bannerH + 8);
        for (let row = 0; row < 2; row++) {
            for (let col = 0; col < cellsX; col++) {
                ctx.fillStyle = (row + col) % 2 === 0 ? '#f5f5f5' : '#101010';
                ctx.fillRect(bannerX + col * cellW, bannerY + row * cellH, cellW + 0.2, cellH + 0.2);
            }
        }
        ctx.fillStyle = 'rgba(255,255,255,0.12)';
        ctx.fillRect(bannerX, bannerY, bannerW, 2);
        ctx.fillStyle = 'rgba(255,64,64,0.78)';
        ctx.fillRect(bannerX, bannerY + bannerH - 3, bannerW, 3);

        ctx.textAlign = 'center';
        ctx.font = 'bold 46px Arial';
        ctx.fillStyle = '#f4f1e6';
        ctx.fillText('PODIO', W / 2, 80);
        ctx.font = 'bold 16px Arial';
        ctx.fillStyle = '#ffcf5a';
        ctx.fillText(`Ritorno alla lobby in ${tempoRimasto}s`, W / 2, 106);

        const baseY = H - 70;
        const stepW = Math.min(190, W * 0.25);
        const gap = Math.min(22, W * 0.03);
        const centerX = W / 2;
        const layout = [
            { place: 2, x: centerX - stepW - gap, h: 150, color: '#c0c8d8' },
            { place: 1, x: centerX,               h: 220, color: '#f1c40f' },
            { place: 3, x: centerX + stepW + gap, h: 115, color: '#cd7f32' },
        ];

        for (const slot of layout) {
            const auto = topTre[slot.place - 1];
            const stepX = slot.x - stepW / 2;
            const stepY = baseY - slot.h;
            const topH = 16;

            ctx.fillStyle = 'rgba(0,0,0,0.35)';
            ctx.fillRect(stepX + 10, stepY + 12, stepW, slot.h);

            const faceGrad = ctx.createLinearGradient(0, stepY, 0, stepY + slot.h);
            faceGrad.addColorStop(0, slot.place === 1 ? '#ffd95a' : slot.color);
            faceGrad.addColorStop(1, slot.place === 1 ? '#7a5f10' : '#4d5058');
            ctx.fillStyle = faceGrad;
            ctx.fillRect(stepX, stepY, stepW, slot.h);

            const topGrad = ctx.createLinearGradient(0, stepY, 0, stepY + topH);
            topGrad.addColorStop(0, '#2b2f37');
            topGrad.addColorStop(1, '#5e6572');
            ctx.fillStyle = topGrad;
            ctx.fillRect(stepX, stepY, stepW, topH);

            ctx.fillStyle = 'rgba(255,255,255,0.16)';
            ctx.fillRect(stepX, stepY, stepW, 4);
            ctx.fillStyle = 'rgba(0,0,0,0.2)';
            ctx.fillRect(stepX, stepY + slot.h - 5, stepW, 5);

            ctx.font = 'bold 54px Arial';
            ctx.textAlign = 'center';
            ctx.fillStyle = 'rgba(0,0,0,0.28)';
            ctx.fillText(String(slot.place), slot.x + 2, stepY + slot.h * 0.48 + 4);
            ctx.fillStyle = slot.place === 1 ? '#fff7b1' : '#eef1f7';
            ctx.fillText(String(slot.place), slot.x, stepY + slot.h * 0.48);

            if (!auto) continue;

            const draw = getCharacterDrawFunction(auto.character);
            if (draw) draw(ctx, slot.x, stepY - 56, 48, 112);

            const nameW = Math.min(170, stepW + 12);
            const nameH = 24;
            const nameX = slot.x - nameW / 2;
            const nameY = stepY - 144;
            ctx.fillStyle = 'rgba(8,8,10,0.84)';
            ctx.fillRect(nameX, nameY, nameW, nameH);
            ctx.strokeStyle = slot.place === 1 ? '#f1c40f' : 'rgba(255,255,255,0.16)';
            ctx.lineWidth = 1.5;
            ctx.strokeRect(nameX, nameY, nameW, nameH);

            ctx.font = 'bold 15px Arial';
            ctx.fillStyle = '#fff';
            ctx.fillText(auto.nome.substring(0, 16), slot.x, nameY + 17);

            ctx.font = 'bold 13px Arial';
            ctx.fillStyle = auto.dnf ? '#ff9b9b' : '#dce8ff';
            ctx.fillText(auto.dnf ? 'DNF' : `P${auto.posizione}`, slot.x, stepY + slot.h - 14);
        }

        ctx.restore();
    }

    private topTreFinale(): StatoAuto[] {
        if (!this.statoServer) return [];
        return Object.values(this.statoServer)
            .filter(a => a.finito)
            .sort((a, b) => {
                if (a.dnf !== b.dnf) return a.dnf ? 1 : -1;
                return a.posizione - b.posizione;
            })
            .slice(0, 3);
    }

    private costruisciCanvas(): HTMLCanvasElement {
        const oc = document.createElement('canvas');
        oc.width = MONDO_W; oc.height = MONDO_H;
        const c = oc.getContext('2d')!;

        // Erba con righe alternate per profondità visiva
        c.fillStyle = '#2d6a35'; c.fillRect(0, 0, MONDO_W, MONDO_H);
        c.fillStyle = '#2a6130';
        for (let y = 0; y < MONDO_H; y += 60) c.fillRect(0, y, MONDO_W, 30);

        // Asfalto (linea spessa che segue i waypoint)
        c.strokeStyle = '#4a4a4a'; c.lineWidth = LARGHEZZA_PISTA;
        c.lineCap = 'round'; c.lineJoin = 'round';
        c.beginPath(); c.moveTo(WAYPOINTS[0].x, WAYPOINTS[0].y);
        for (let i = 1; i <= WAYPOINTS.length; i++)
            c.lineTo(WAYPOINTS[i % WAYPOINTS.length].x, WAYPOINTS[i % WAYPOINTS.length].y);
        c.stroke();

        this.disegnaCordoliEsterni(c);

        // Linea tratteggiata centrale
        c.strokeStyle = 'rgba(255,255,255,0.20)'; c.lineWidth = 2; c.setLineDash([18, 14]);
        c.beginPath(); c.moveTo(WAYPOINTS[0].x, WAYPOINTS[0].y);
        for (let i = 1; i <= WAYPOINTS.length; i++)
            c.lineTo(WAYPOINTS[i % WAYPOINTS.length].x, WAYPOINTS[i % WAYPOINTS.length].y);
        c.stroke(); c.setLineDash([]);

        // Checkpoint visivi: linee tratteggiate trasversali, sottili e fuse con l'asfalto.
        for (let i = 0; i < CHECKPOINTS.length; i++) {
            const cp = CHECKPOINTS[i];
            const wpIndex = CHECKPOINTS_WAYPOINT_INDEX[i];
            const prev = WAYPOINTS[(wpIndex - 1 + WAYPOINTS.length) % WAYPOINTS.length];
            const next = WAYPOINTS[(wpIndex + 1) % WAYPOINTS.length];
            const tx = next.x - prev.x;
            const ty = next.y - prev.y;
            const laneAngle = Math.atan2(ty, tx);
            const lineAngle = laneAngle + Math.PI / 2;
            const lineLen = LARGHEZZA_PISTA * 0.92;
            const dashCount = 9;
            const dashLen = lineLen / (dashCount * 2 - 1);

            c.save();
            c.translate(cp.x, cp.y);
            c.rotate(lineAngle);

            c.strokeStyle = 'rgba(255, 255, 255, 0.92)';
            c.lineWidth = 3;
            c.lineCap = 'round';
            for (let d = 0; d < dashCount; d++) {
                const start = -lineLen / 2 + d * dashLen * 2;
                c.beginPath();
                c.moveTo(start, 0);
                c.lineTo(start + dashLen, 0);
                c.stroke();
            }

            c.rotate(-lineAngle);
            c.fillStyle = 'rgba(255,255,255,0.65)';
            c.font = 'bold 12px sans-serif';
            c.textAlign = 'center';
            c.textBaseline = 'middle';
            c.fillText(String(i + 1), 0, -14);
            c.restore();
        }

        // Traguardo a scacchi bianchi/neri, centrato sulla linea di arrivo
        const t = TRAGUARDO;
        const bandW = TRAGUARDO_LARGHEZZA;
        const bandH = TRAGUARDO_ALTEZZA;
        const cellsX = 18;
        const cellW = bandW / cellsX;
        const cellH = bandH / 2;

        c.fillStyle = '#0a0a0a';
        c.fillRect(t.x - bandW / 2 - 4, t.y - bandH / 2 - 4, bandW + 8, bandH + 8);

        for (let row = 0; row < 2; row++)
            for (let col = 0; col < cellsX; col++) {
                c.fillStyle = (row + col) % 2 === 0 ? '#f5f5f5' : '#101010';
                c.fillRect(t.x - bandW / 2 + col * cellW, t.y - bandH / 2 + row * cellH, cellW + 0.2, cellH + 0.2);
            }

        c.fillStyle = 'rgba(255,255,255,0.12)';
        c.fillRect(t.x - bandW / 2, t.y - bandH / 2 - 3, bandW, 2);
        c.fillStyle = 'rgba(255,64,64,0.8)';
        c.fillRect(t.x - bandW / 2, t.y + bandH / 2 + 1, bandW, 3);

        // Texture asfalto: puntini casuali per varietà visiva
        c.fillStyle = 'rgba(0,0,0,0.07)';
        for (let i = 0; i < 10000; i++) {
            const rx = Math.random() * MONDO_W;
            const ry = Math.random() * MONDO_H;
            if (sullaStrada(rx, ry)) c.fillRect(rx, ry, 2, 2);
        }

        return oc;
    }

    private disegnaCordoliEsterni(c: CanvasRenderingContext2D): void {
        const raggio = LARGHEZZA_PISTA / 2 + 7;
        const profondita = 12;
        const lunghezzaStriscia = 18;
        const angoloMinimo = 0.22;

        c.save();
        c.lineWidth = profondita;
        c.lineCap = 'butt';

        for (let i = 0; i < WAYPOINTS.length; i++) {
            const prev = WAYPOINTS[(i - 1 + WAYPOINTS.length) % WAYPOINTS.length];
            const curr = WAYPOINTS[i];
            const next = WAYPOINTS[(i + 1) % WAYPOINTS.length];
            const inDir = this.normalizzaPunto({ x: curr.x - prev.x, y: curr.y - prev.y });
            const outDir = this.normalizzaPunto({ x: next.x - curr.x, y: next.y - curr.y });
            const cambioDirezione = Math.hypot(outDir.x - inDir.x, outDir.y - inDir.y);
            if (cambioDirezione < angoloMinimo) continue;

            const latoEsterno = inDir.x * outDir.y - inDir.y * outDir.x >= 0 ? -1 : 1;
            const normaleIn = this.normaleLaterale(inDir, latoEsterno);
            const normaleOut = this.normaleLaterale(outDir, latoEsterno);
            const start = Math.atan2(normaleIn.y, normaleIn.x);
            const delta = this.deltaAngoloMinimo(start, Math.atan2(normaleOut.y, normaleOut.x));
            const lunghezzaArco = Math.abs(delta) * raggio;
            const strisce = Math.max(3, Math.ceil(lunghezzaArco / lunghezzaStriscia));

            for (let s = 0; s < strisce; s++) {
                const t0 = s / strisce;
                const t1 = (s + 1) / strisce;
                c.strokeStyle = s % 2 === 0 ? '#cc0000' : '#ffffff';
                c.beginPath();
                c.arc(
                    curr.x,
                    curr.y,
                    raggio,
                    start + delta * t0,
                    start + delta * t1,
                    delta < 0,
                );
                c.stroke();
            }
        }

        c.restore();
    }

    private normalizzaPunto(p: Punto): Punto {
        const len = Math.hypot(p.x, p.y);
        return len === 0 ? { x: 0, y: 0 } : { x: p.x / len, y: p.y / len };
    }

    private normaleLaterale(dir: Punto, lato: -1 | 1): Punto {
        return lato === 1
            ? { x: -dir.y, y: dir.x }
            : { x: dir.y, y: -dir.x };
    }

    private deltaAngoloMinimo(from: number, to: number): number {
        let delta = to - from;
        while (delta > Math.PI) delta -= Math.PI * 2;
        while (delta < -Math.PI) delta += Math.PI * 2;
        return delta;
    }


    private registraTasti(): void {
        const set = (e: KeyboardEvent, v: boolean) => {
            const isGameKey =
                e.code === 'KeyW' || e.code === 'ArrowUp' ||
                e.code === 'KeyS' || e.code === 'ArrowDown' ||
                e.code === 'Space' ||
                e.code === 'ShiftLeft' || e.code === 'ShiftRight';
            if (isGameKey) e.preventDefault();

            if (e.code === 'KeyW' || e.code === 'ArrowUp')         this.tasti.su    = v;
            if (e.code === 'KeyS' || e.code === 'ArrowDown')       this.tasti.giu   = v;
            if (e.code === 'Space') {
                if (v) {
                    if (!this.turboPremuto) this.tasti.turbo = true;
                    this.turboPremuto = true;
                    e.preventDefault();
                } else {
                    this.turboPremuto = false;
                }
            }
            if (e.code === 'ShiftLeft' || e.code === 'ShiftRight') {
                if (v) {
                    if (!this.olioPremuto) this.tasti.olio = true;
                    this.olioPremuto = true;
                } else {
                    this.olioPremuto = false;
                }
            }
        };
        document.addEventListener('keydown', e => set(e, true));
        document.addEventListener('keyup',   e => set(e, false));
        this.userInput.canvas.addEventListener('pointermove', () => { this.mouseSterzoAttivo = true; });
    }
}