/**
 * Micro Racing - Circuit OurSpace.
 * Architettura: server autoritativo (fisica e regole) + client con interpolazione
 * per ridurre la latenza percepita durante il rendering.
 * Fasi partita: qualifiche -> voto modalita' -> recap griglia -> semaforo -> gara
 * -> DNF/podio.
 * Tracciato: linea centrale a waypoint, fascia traguardo e checkpoint in ordine
 * obbligato per evitare tagli; la progressione lungo il giro usa pre-calcoli
 * delle lunghezze e proiezione su polilinea.
 *
 * Struttura del codice:
 * 1) Tipi e messaggi: contratti condivisi prima di ogni logica.
 * 2) Tracciato e costanti: parametri globali usati ovunque.
 * 3) Helper puri: utilita' riusate da server/client senza stato.
 * 4) Server: simulazione autoritativa e regole di gara.
 * 5) Client: input, interpolazione e rendering canvas.
 */

import { GameClient, GameServer }   from './game';
import { getCharacterDrawFunction } from '../client/characters';
import type { Player }              from '../common';
import type { IncomingMsg, OutgoingMsg } from '../server';
import type { UserInput }           from '../client/user-input';

// Import minimi: base GameServer/GameClient e disegno personaggi per il podio.


// ============================================================================
// TIPI E MESSAGGI
// Contratti condivisi tra server e client: definiti prima per ridurre dipendenze.
// ============================================================================

/** Punto 2D in coordinate mondo (px). */
type Punto = { x: number; y: number };
/** Stato animazione singola riga classifica (client-only). */
type StatoRigaClassifica = {
    y: number; 
    targetY: number;
    lastIndex: number;
    lastBestGiro: number;
    flash: number; 
};
/** Riga classifica completa con delta visivi. */
type RigaClassificaAnimata = {
    id: string;
    auto: StatoAuto; // snapshot completo per disegno e calcoli
    index: number;
    y: number;
    delta: number; // differenza di tempo rispetto alla posizione precedente (positiva = piu' lenta)
    flash: number;
    improved: boolean; // true se ha migliorato il tempo rispetto alla griglia precedente
};
/** Layout UI classifica: separato per riuso in piu' metodi di disegno. */
type LayoutClassifica = { lbX: number; lbW: number; rowH: number; pad: number };
/** Slot podio con metadati di colore/altezza. */
type SlotPodio = { place: number; x: number; h: number; color: string };

/** Stati macchina per sincronizzare UI e regole di gara. */
type Fase = 'qualifiche' | 'voto' | 'recap' | 'gara';
/** Modalita' scelte a voto: string union per payload compatti. */
type ModalitaGara = 'standard' | 'sopravvivenza';

/** Stato completo auto: condiviso server/client, raggruppato per sotto-sistemi. */
interface StatoAuto {
    x: number; y: number; // posizione in px
    xPrecedente: number; yPrecedente: number; // usati per rilevare attraversamento traguardo senza falsi
    angolo: number; vx: number; vy: number; // stato fisico
    // Gara
    giri: number;
    cp: number;             // bitmask checkpoint raccolti nel giro corrente (gara)
    // Qualifiche
    cpQual: number;         // bitmask checkpoint raccolti nel giro corrente (qualifica)
    giroLanciato: boolean;  // false in griglia, true dopo il primo attraversamento valido del traguardo
    migliorGiro: number;    // ms, -1 = nessun giro valido
    tempoGiroAttuale: number; // ms dall'inizio del giro corrente
    sulTraguardo: boolean;  // true = auto attualmente nel raggio del traguardo
                            // usato per l'edge-detection: conta solo l'INGRESSO nel raggio
    giroInvalido: boolean;  // true = e' uscito dalla pista in questo giro (qualifica)
    // Power-up
    turboTimer: number; turboCooldown: number;
    shockwaveCooldown: number; shockwaveTimer: number; spinTimer: number; 
    // Meccaniche speciali
    inScia: boolean;        // true = sta beneficiando della scia
    tempoScia: number;      // secondi continui in scia
    slingshotTimer: number; // secondi rimanenti di boost slingshot
    speedPadCooldown: number;
    // Metadati
    nome: string; character: string;
    finito: boolean; dnf: boolean; posizione: number;
}

/** Speed pad: rettangolo ruotato per boost direzionale. */
interface SpeedPad { x: number; y: number; w: number; h: number; angolo: number; }
/** Ostacolo: usato per eventi random. */
interface StatoOstacolo { x: number; y: number; r: number; angolo: number; }

/** Pacchetto parametri fisici per calcoli in update per-frame. */
interface ParametriFisici {
    accelMax: number;
    velMax: number;
    attritoTotale: number;
}

/** Candidato arrivo: accumula dati per ordinare correttamente i finisher. */
interface CandidatoArrivo {
    auto: StatoAuto;
    haCompletatoGara: boolean;
    progress: number;
}

/** Input normalizzato dal client. */
interface MsgInput {
    kind: 'input';
    su: boolean; giu: boolean;
    turbo: boolean; shockwave: boolean;
    mouseAngolo: number;
}

/** Messaggio di voto modalita'. */
interface MsgVoto {
    kind: 'voto';
    scelta: ModalitaGara;
}

/** Snapshot di stato completo dal server al client. */
interface MsgStato {
    kind: 'stato';
    fase: Fase;
    tempoQual: number;          // secondi rimasti alle qualifiche
    tempoVoto: number;          // secondi rimasti al voto
    tempoRecap: number;         // secondi rimasti al recap
    countdownPartenza: number;  // secondi rimasti al semaforo
    dnfTimer: number;           // secondi rimasti prima del DNF globale (-1 = non attivo)
    auto: Record<string, StatoAuto>;
    garaFinita: boolean;
    gridOrder: string[];
    migliorAssoluto: number;    // ms del giro piu' veloce tra tutti
    votiStandard: number;
    votiSopravvivenza: number;
    modalitaGara: ModalitaGara;
    sopravvivenzaTimer: number;
    ultimoARischio: string | null;
    ostacoliAvvisoTimer: number;
    ostacoli: StatoOstacolo[];
}


// ============================================================================
// TRACCIATO E COSTANTI DI GIOCO
// Descrive il mondo, la pista, le regole temporali e i parametri fisici.
// ============================================================================

const MONDO_W = 4800;
const MONDO_H = 3800;
const LARGHEZZA_PISTA = 160; // ampia per permettere sorpassi side-by-side
const MARGINE_QUALI = 10; // px di tolleranza per evitare falsi track-limits in qualifica

/**
 * Waypoint della linea centrale
 * Il punto 0 e' il primo waypoint DOPO il traguardo sul rettilineo principale,
 * cosi' la griglia di partenza (posizionata ~200px piu' a sud) non coincide mai
 * con il raggio del traguardo all'avvio -> nessun falso "primo giro".
 */
const WAYPOINTS: Punto[] = [
    // Rettilineo principale (lato est, verso nord)
    { x: 3800, y: 2400 },   // 0  - griglia qui (sotto il traguardo)
    { x: 3800, y: 2100 },   // 1  - traguardo a y~2250, tra qui e il punto precedente
    { x: 3800, y: 1800 },   // 2
    { x: 3800, y: 1550 },   // 3
    // Tornante 90 gradi verso ovest (curva 1 - lenta)
    { x: 3700, y: 1380 },   // 4
    { x: 3500, y: 1270 },   // 5
    { x: 3300, y: 1230 },   // 6
    // Rettilineo nord-ovest -> curva veloce sinistra (curva 2)
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
    // Rettilineo ovest -> chicane sx/dx (curve 5+6)
    { x: 1050, y: 1300 },   // 18
    { x:  870, y: 1450 },   // 19
    { x:  780, y: 1620 },   // 20
    { x:  870, y: 1800 },   // 21
    // Grande curva a U verso sud (curva 7 - lenta, tecnica)
    { x:  900, y: 2000 },   // 22
    { x:  820, y: 2200 },   // 23
    { x:  750, y: 2450 },   // 24
    { x:  820, y: 2650 },   // 25
    { x: 1000, y: 2780 },   // 26
    // Rettilineo sud -> doppia chicane dx/sx (curve 8+9)
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
    // -> si ricongiunge a wp[0]
];

/**
 * 8 checkpoint distribuiti uniformemente sul giro.
 * Devono essere attraversati in ordine numerico - impediscono tagli aggressivi
 * e la guida al contrario per gonfiare i tempi.
 */
const CHECKPOINTS = [
    { x: 3500, y: 1270, r: 90 },  // CP1: uscita tornante nord-est
    { x: 2700, y: 1200, r: 90 },  // CP2: rettilineo nord
    { x: 1800, y: 1200, r: 90 },  // CP3: esse centrali
    { x:  870, y: 1450, r: 90 },  // CP4: ingresso chicane ovest
    { x:  750, y: 2450, r: 90 },  // CP5: fondo curva a U
    { x: 1350, y: 2820, r: 90 },  // CP6: rettilineo sud
    { x: 2150, y: 2640, r: 90 },  // CP7: doppia chicane sud-est
    { x: 3200, y: 2750, r: 90 },  // CP8: lancio verso traguardo
];
const TUTTI_CHECKPOINT = (1 << CHECKPOINTS.length) - 1; // bitmask con tutti i checkpoint raccolti, usata per verificare completamento giro
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

// Il traguardo e' una fascia stretta centrata sulla linea di arrivo.
const TRAGUARDO    = { x: 3800, y: 2250 };
const TRAGUARDO_LARGHEZZA = LARGHEZZA_PISTA + 18;
const TRAGUARDO_ALTEZZA = 16;

// Griglia: 16 caselle massime sul rettilineo tra CP7 e CP8, stile F1.
const GRIGLIA_MAX_AUTO = 16;
const GRIGLIA_CASELLA_W = 34;
const GRIGLIA_CASELLA_H = 20;

// La griglia parte nel settore finale: in gara consideriamo gia' fatti CP1..CP7
// cosi' il primo passaggio utile richiede solo CP8 + traguardo.
const MASCHERA_CHECKPOINT_PRE_GRIGLIA = (1 << (CHECKPOINTS.length - 1)) - 1;

const LUNGHEZZE_SEGMENTI = WAYPOINTS.map((p, i) => {
    const next = WAYPOINTS[(i + 1) % WAYPOINTS.length];
    return Math.hypot(next.x - p.x, next.y - p.y);
});
// Precalcoli per progressi e proiezioni lungo il giro.
const DISTANZE_WAYPOINT = distanzeCumulative(LUNGHEZZE_SEGMENTI);
const LUNGHEZZA_TRACCIATO = LUNGHEZZE_SEGMENTI.reduce((tot, len) => tot + len, 0);


// --- Fisica e regole di gara -------------------------------------------------
// Blocchi separati per rendere chiaro quali parametri impattano il feeling.

const ACCEL          = 290;    // px/s^2 accelerazione su asfalto
const FRENO          = 560;    // px/s^2 frenata
const ATTRITO        = 120;    // px/s^2 attrito passivo su asfalto
const STERZO_RAD     = 3.8;   // rad/s velocita' di sterzata
const VEL_MAX        = 315;    // px/s velocita' massima su asfalto

// L'auto non rimbalza ma viene fortemente penalizzata sull'erba.
const ERBA_ACCEL_MULT  = 0.5;   // accelerazione ridotta al 50%
const ERBA_VELMAX_MULT = 0.4;   // velocita' massima ridotta al 40%
const ERBA_ATTRITO_ADD = 10;    // attrito aggiuntivo sull'erba (si somma a ATTRITO)
//   -> attrito totale su erba = 130 px/s^2 - resta lento ma puo' rientrare da fermo

const DRIFT          = 0.86;   // ritenzione velocita' laterale (effetto derapata)

const TURBO_BONUS    = 1.80;
const TURBO_DURATA   = 0.8;    // secondi
const TURBO_RICARICA = 4.0;    // secondi cooldown

const SPIN_OUT_DURATA = 1.4;   // secondi di perdita controllo dopo urti/ostacoli

const SHOCKWAVE_RAGGIO   = 200;  // px
const SHOCKWAVE_DURATA   = 0.55; // secondi
const SHOCKWAVE_RICARICA = 5.0;  // secondi
const SHOCKWAVE_FORZA    = 260;  // px/s di impulso massimo

const SPEED_PAD_BOOST    = 140;  // px/s impulso istantaneo
const SPEED_PAD_COOLDOWN = 0.45; // secondi
const SPEED_PADS: SpeedPad[] = [
    // Pad corti e stretti: premiano traiettorie diverse senza creare una corsia obbligata.
    { x: 3760, y: 2050, w: 54, h: 24, angolo: -Math.PI / 2 },
    { x: 3840, y: 1760, w: 54, h: 24, angolo: -Math.PI / 2 },
    { x: 2940, y: 1165, w: 54, h: 24, angolo: Math.PI },
    { x: 2540, y: 1240, w: 54, h: 24, angolo: Math.PI },
    { x:  820, y: 1760, w: 54, h: 24, angolo: Math.PI / 2 },
    { x:  830, y: 2305, w: 54, h: 24, angolo: 1.9 },
    { x: 1600, y: 2782, w: 54, h: 24, angolo: 0 },
    { x: 2380, y: 2810, w: 54, h: 24, angolo: 0.16 },
    { x: 3190, y: 2790, w: 54, h: 24, angolo: -0.2 },
];

const GIRI_GARA         = 3;
const DURATA_QUALIFICHE = 120;  // due minuti: abbastanza per un giro lanciato senza rendere la lobby lenta
const DURATA_VOTO       = 10;
const DURATA_RECAP      = 8;    // secondi schermata griglia
const DURATA_PARTENZA   = 4;    // secondi semaforo (4 luci, 1 per secondo)
const DNF_TIMEOUT       = 60;   // secondi per tagliare il traguardo dopo il primo arrivo
const DURATA_AVVISO_PODIO = 3;
const DURATA_PODIO = 10;

const SCIA_BONUS      = 1.15;  // +15% vel max quando si e' in scia
const SCIA_DIST_MAX   = 180;   // px: distanza massima per la scia
const SCIA_CONE_BASE  = 18;    // px: apertura base del cono posteriore
const SCIA_CONE_GAIN  = 0.35;  // px laterali per px di distanza (cono allargato)
const SLINGSHOT_TEMPO  = 2.0;   // secondi continuativi in scia per attivare lo slingshot
const SLINGSHOT_BONUS  = 1.25;  // +25% vel max
const SLINGSHOT_DURATA = 1.5;   // secondi

const SOPRAVVIVENZA_INTERVALLO = 15; // secondi tra eliminazioni

const OSTACOLI_INTERVALLO     = 15; // secondi tra eventi random
const OSTACOLI_AVVISO         = 3;  // secondi di preavviso
const OSTACOLI_DURATA         = 8;  // secondi in pista
const OSTACOLI_PER_EVENTO_MIN = 10;
const OSTACOLI_PER_EVENTO_MAX = 15;
const OSTACOLO_RAGGIO         = 17;

const COLORI_AUTO = ['#e74c3c','#3498db','#b7d29b','#f39c12','#9b59b6','#1abc9c','#e67e22','#e91e63'];


// ============================================================================
// INPUT DI RETE
// Normalizza payload esterni prima che entrino nella simulazione autoritativa.
// ============================================================================

/**
 * Stato neutro usato quando manca input dal client.
 * @returns Input con tutte le azioni disabilitate.
 */
function inputNeutro(): MsgInput {
    return {
        kind: 'input',
        su: false, giu: false,
        turbo: false, shockwave: false,
        mouseAngolo: Number.NaN,
    };
}

/**
 * Accetta payload incerto e produce input valido e coerente.
 * @param payload - Payload grezzo ricevuto via rete.
 * @returns Input normalizzato o `null` se non valido.
 */
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
        shockwave: p.shockwave === true,
        mouseAngolo,
    };
}

/**
 * Valida il voto e filtra valori non permessi.
 * @param payload - Payload grezzo ricevuto via rete.
 * @returns Voto normalizzato o `null` se non valido.
 */
function normalizzaVoto(payload: unknown): MsgVoto | null {
    const p = payload as Partial<MsgVoto> | null;
    if (!p || p.kind !== 'voto') return null;
    if (p.scelta !== 'standard' && p.scelta !== 'sopravvivenza') return null;
    return { kind: 'voto', scelta: p.scelta };
}


// ============================================================================
// HELPER GEOMETRICI
// Funzioni pure per pista, traguardo, intersezioni e checkpoint.
// ============================================================================

/**
 * Distanza minima dal punto P al segmento A->B.
 * @param px - Ascissa del punto P.
 * @param py - Ordinata del punto P.
 * @param ax - Ascissa del punto A.
 * @param ay - Ordinata del punto A.
 * @param bx - Ascissa del punto B.
 * @param by - Ordinata del punto B.
 * @returns Distanza minima in px.
 */
function distSegmento(px: number, py: number,
                      ax: number, ay: number, bx: number, by: number): number {
    const dx = bx - ax, dy = by - ay;
    const len2 = dx * dx + dy * dy;
    if (len2 === 0) return Math.hypot(px - ax, py - ay);
    const t = Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / len2));
    return Math.hypot(px - (ax + t * dx), py - (ay + t * dy));
}

/**
 * Restituisce un array con le distanze cumulative dei segmenti.
 * @param lunghezze - Lunghezze dei segmenti in ordine.
 * @returns Distanza cumulativa all'inizio di ogni segmento.
 */
function distanzeCumulative(lunghezze: number[]): number[] {
    let totale = 0;
    return lunghezze.map(len => {
        const inizioSegmento = totale;
        totale += len;
        return inizioSegmento;
    });
}

/**
 * Controllo rapido per il raggio del traguardo (edge detection).
 * @param x - Coordinata x del punto.
 * @param y - Coordinata y del punto.
 * @returns true se il punto e' dentro la fascia del traguardo.
 */
function dentroTraguardo(x: number, y: number): boolean {
    return Math.abs(x - TRAGUARDO.x) <= TRAGUARDO_LARGHEZZA / 2
        && Math.abs(y - TRAGUARDO.y) <= TRAGUARDO_ALTEZZA / 2;
}

/**
 * Verifica se il punto (cx, cy) e' sull'asfalto.
 * @param cx - Coordinata x del punto.
 * @param cy - Coordinata y del punto.
 * @returns true se il punto e' entro il raggio pista.
 */
function sullaStrada(cx: number, cy: number): boolean {
    return vicinoAlTracciato(cx, cy, LARGHEZZA_PISTA / 2);
}

/**
 * Variante con margine: tollera piccoli errori in qualifica.
 * @param cx - Coordinata x del punto.
 * @param cy - Coordinata y del punto.
 * @param extra - Margine extra in px.
 * @returns true se il punto e' entro il raggio pista + extra.
 */
function sullaStradaConMargine(cx: number, cy: number, extra: number): boolean {
    return vicinoAlTracciato(cx, cy, LARGHEZZA_PISTA / 2 + extra);
}

/**
 * Restituisce true se il punto e' entro la distanza limite dal centro pista.
 * @param cx - Coordinata x del punto.
 * @param cy - Coordinata y del punto.
 * @param limite - Raggio massimo dal centro pista.
 * @returns true se il punto e' vicino al tracciato.
 */
function vicinoAlTracciato(cx: number, cy: number, limite: number): boolean {
    for (let i = 0; i < WAYPOINTS.length; i++) {
        const a = WAYPOINTS[i];
        const b = WAYPOINTS[(i + 1) % WAYPOINTS.length];
        if (distSegmento(cx, cy, a.x, a.y, b.x, b.y) < limite) return true;
    }
    return false;
}

/**
 * Orientazione di tre punti per intersezioni segmenti.
 * @param ax - Ascissa A.
 * @param ay - Ordinata A.
 * @param bx - Ascissa B.
 * @param by - Ordinata B.
 * @param cx - Ascissa C.
 * @param cy - Ordinata C.
 * @returns Valore di orientazione (segno = lato).
 */
function orientazione(ax: number, ay: number, bx: number, by: number, cx: number, cy: number): number {
    return (bx - ax) * (cy - ay) - (by - ay) * (cx - ax);
}

/**
 * Verifica se un punto cade sul segmento (collinearita' gia' verificata).
 * @param ax - Ascissa A.
 * @param ay - Ordinata A.
 * @param bx - Ascissa B.
 * @param by - Ordinata B.
 * @param px - Ascissa P.
 * @param py - Ordinata P.
 * @returns true se il punto e' sul segmento.
 */
function puntoSuSegmento(ax: number, ay: number, bx: number, by: number, px: number, py: number): boolean {
    return px >= Math.min(ax, bx) && px <= Math.max(ax, bx)
        && py >= Math.min(ay, by) && py <= Math.max(ay, by)
        && orientazione(ax, ay, bx, by, px, py) === 0;
}

/**
 * Intersezione segmenti 2D: usata per attraversamento traguardo.
 * @param ax - Ascissa A.
 * @param ay - Ordinata A.
 * @param bx - Ascissa B.
 * @param by - Ordinata B.
 * @param cx - Ascissa C.
 * @param cy - Ordinata C.
 * @param dx - Ascissa D.
 * @param dy - Ordinata D.
 * @returns true se i segmenti si intersecano.
 */
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

/**
 * Rileva attraversamento della fascia traguardo tra posizione precedente e attuale.
 * @param xPrecedente - x del frame precedente.
 * @param yPrecedente - y del frame precedente.
 * @param xAttuale - x del frame corrente.
 * @param yAttuale - y del frame corrente.
 * @returns true se il segmento attraversa la fascia traguardo.
 */
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

/**
 * Hit-test per speed pad ruotato.
 * @param px - Ascissa del punto.
 * @param py - Ordinata del punto.
 * @param rect - Speed pad ruotato.
 * @returns true se il punto e' dentro il rettangolo ruotato.
 */
function puntoInRettangoloRuotato(px: number, py: number, rect: SpeedPad): boolean {
    const dx = px - rect.x;
    const dy = py - rect.y;
    const cos = Math.cos(-rect.angolo);
    const sin = Math.sin(-rect.angolo);
    const rx = dx * cos - dy * sin;
    const ry = dx * sin + dy * cos;
    return Math.abs(rx) <= rect.w / 2 && Math.abs(ry) <= rect.h / 2;
}

/**
 * Restituisce un punto lungo la polyline a progress e offset laterale.
 * @param progress - Distanza lungo il giro (px).
 * @param laterale - Offset laterale (px) rispetto alla linea centrale.
 * @returns Punto mondo calcolato sulla pista.
 */
function puntoLungoTracciato(progress: number, laterale: number): Punto {
    let distanza = ((progress % LUNGHEZZA_TRACCIATO) + LUNGHEZZA_TRACCIATO) % LUNGHEZZA_TRACCIATO;

    for (let i = 0; i < WAYPOINTS.length; i++) {
        const len = LUNGHEZZE_SEGMENTI[i];
        if (distanza > len) {
            distanza -= len;
            continue;
        }

        const a = WAYPOINTS[i];
        const b = WAYPOINTS[(i + 1) % WAYPOINTS.length];
        const t = len === 0 ? 0 : distanza / len;
        const dx = b.x - a.x;
        const dy = b.y - a.y;
        const invLen = len === 0 ? 0 : 1 / len;
        return {
            x: a.x + dx * t - dy * invLen * laterale,
            y: a.y + dy * t + dx * invLen * laterale,
        };
    }

    return WAYPOINTS[0];
}

/**
 * Proietta un punto sulla pista e restituisce la distanza percorsa lungo il giro.
 * @param px - Ascissa del punto.
 * @param py - Ordinata del punto.
 * @returns Progress lungo il giro in px.
 */
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
        // Proiezione ortogonale sul segmento per minimizzare la distanza.
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

/**
 * Aggiorna bitmask dei checkpoint in ordine obbligato.
 * @param mask - Bitmask corrente.
 * @param x - Ascissa posizione auto.
 * @param y - Ordinata posizione auto.
 * @returns Nuova bitmask dopo eventuale attraversamento checkpoint.
 */
function aggiornaCheckpoint(mask: number, x: number, y: number): number {
    let prossimoMask = mask;
    for (let i = 0; i < CHECKPOINTS.length; i++) {
        const bit = 1 << i;
        if (prossimoMask & bit) continue;
        // Ordine obbligato: non si puo' prendere il CP i se manca il precedente.
        if (i > 0 && !(prossimoMask & (1 << (i - 1)))) continue;
        if (Math.hypot(x - CHECKPOINTS[i].x, y - CHECKPOINTS[i].y) < CHECKPOINTS[i].r)
            prossimoMask |= bit;
    }
    return prossimoMask;
}


// ============================================================================
// HELPER DI CLASSIFICA E PROGRESSO
// Calcolano tempi, griglia e ordinamenti senza dipendere dalle classi.
// ============================================================================

/**
 * Normalizza il tempo qualifica per sorting (Infinity se assente).
 * @param auto - Stato auto.
 * @returns Tempo valido o Infinity se mancante.
 */
function tempoQualifica(auto: StatoAuto): number {
    return auto.migliorGiro < 0 ? Infinity : auto.migliorGiro;
}

/**
 * Comparator per tempi di qualifica.
 * @param autoA - Prima auto.
 * @param autoB - Seconda auto.
 * @returns Differenza di tempo (A - B).
 */
function confrontaQualifica(autoA: StatoAuto, autoB: StatoAuto): number {
    return tempoQualifica(autoA) - tempoQualifica(autoB);
}

/**
 * Crea la griglia partenza ordinando per miglior tempo.
 * @param auto - Dizionario auto.
 * @returns Array di id ordinati per tempo.
 */
function calcolaGriglia(auto: Record<string, StatoAuto>): string[] {
    return Object.keys(auto).sort((a, b) => confrontaQualifica(auto[a], auto[b]));
}

/**
 * Miglior tempo assoluto tra tutti i giocatori (-1 se nessuno ha girato).
 * @param auto - Dizionario auto.
 * @returns Miglior tempo in ms o -1.
 */
function calcolaMigliorAssoluto(auto: Record<string, StatoAuto>): number {
    let best = Infinity;
    for (const id in auto) {
        const t = auto[id].migliorGiro;
        if (t >= 0 && t < best) best = t;
    }
    return best === Infinity ? -1 : best;
}

/**
 * Timer base ostacoli: isolato per rendere facile tarare la frequenza.
 * @returns Secondi al prossimo evento ostacoli.
 */
function tempoProssimiOstacoli(): number {
    return OSTACOLI_INTERVALLO;
}

/**
 * Progresso lungo il giro (solo posizione attuale).
 * @param auto - Stato auto.
 * @returns Distanza percorsa lungo il giro in px.
 */
function progressoLungoGiro(auto: StatoAuto): number {
    return proiettaSuTracciato(auto.x, auto.y);
}

/**
 * Progresso complessivo (giri * lunghezza + tratto corrente).
 * @param auto - Stato auto.
 * @returns Progress totale in px.
 */
function progressoGara(auto: StatoAuto): number {
    return auto.giri * LUNGHEZZA_TRACCIATO + progressoLungoGiro(auto);
}

/**
 * Comparator per ordinamento in gara: chi e' piu' avanti prima.
 * @param autoA - Prima auto.
 * @param autoB - Seconda auto.
 * @returns Differenza di progresso (B - A).
 */
function confrontaAutoInGara(autoA: StatoAuto, autoB: StatoAuto): number {
    return progressoGara(autoB) - progressoGara(autoA);
}

/**
 * Converte ms in "m:ss,ddd" (es. 68423 -> "1:08,423").
 * @param ms - Tempo in millisecondi.
 * @returns Stringa formattata.
 */
function formatTempo(ms: number): string {
    if (ms < 0) return '--:--.---';
    const min  = Math.floor(ms / 60000);
    const sec  = Math.floor((ms % 60000) / 1000);
    const mill = Math.floor(ms % 1000);
    return `${min}:${String(sec).padStart(2, '0')},${String(mill).padStart(3, '0')}`;
}

/**
 * Normalizza angolo per evitare salti in interpolazione.
 * @param rad - Angolo in radianti.
 * @returns Angolo normalizzato in [-PI, PI].
 */
function normalizzaAngolo(rad: number): number {
    while (rad > Math.PI) rad -= Math.PI * 2;
    while (rad < -Math.PI) rad += Math.PI * 2;
    return rad;
}


// ============================================================================
// HELPER DI FISICA
// Integrano timer, sterzo, attrito, turbo, erba e spin-out in passi piccoli.
// ============================================================================

/**
 * Aggiorna la fisica dell'auto per dt secondi.
 * Usata sia dal server (tutti) sia internamente per eventuali predizioni lato client.
 *
 * @param auto - Stato auto da aggiornare.
 * @param input - Input normalizzato (acceleratore/freno/angolo).
 * @param dt - Delta time in secondi.
 * @param bonusScia - Moltiplicatore vel max da scia (1 = nessuna scia).
 * @param fuoriPista - true = penalita' erba attive.
 * @returns void
 */
function aggiornaFisica(
    auto: StatoAuto,
    input: { su: boolean; giu: boolean; mouseAngolo: number },
    dt: number,
    bonusScia: number,
    fuoriPista: boolean,
): void {
    aggiornaTimerAuto(auto, dt);
    if (gestisciSpinOut(auto, dt)) return;
    orientaAutoVersoMouse(auto, input.mouseAngolo, dt);

    // Angolo in radianti: seno/coseno sono la base per il vettore forward.
    const fw = { x: Math.cos(auto.angolo), y: Math.sin(auto.angolo) };

    const fisica = calcolaParametriFisici(auto, bonusScia, fuoriPista);

    if (input.su) {
        auto.vx += fw.x * fisica.accelMax * dt;
        auto.vy += fw.y * fisica.accelMax * dt;
    }
    if (input.giu) {
        const v = Math.hypot(auto.vx, auto.vy);
        if (v > 5) {
            auto.vx -= (auto.vx / v) * FRENO * dt;
            auto.vy -= (auto.vy / v) * FRENO * dt;
        }
    }

    // Drift: decompone in avanti + laterale e riduce la laterale
    // per simulare perdita di aderenza senza annullare la velocita' complessiva.
    const fwdVel = auto.vx * fw.x + auto.vy * fw.y;
    const latX   = auto.vx - fw.x * fwdVel;
    const latY   = auto.vy - fw.y * fwdVel;
    auto.vx = fw.x * fwdVel + latX * DRIFT;
    auto.vy = fw.y * fwdVel + latY * DRIFT;

    // Attrito passivo (piu' forte su erba): penalizza la permanenza fuori pista
    // senza impedire il rientro (attrito extra ma accelerazione non azzerata).
    const v = Math.hypot(auto.vx, auto.vy);
    if (v > 0) {
        const f = Math.min(v, fisica.attritoTotale * dt);
        auto.vx -= (auto.vx / v) * f;
        auto.vy -= (auto.vy / v) * f;
    }

    // Limita velocita' massima (modulata da turbo e scia) per evitare
    // accelerazioni illimitate quando input e boost si sommano.
    const vAtt = Math.hypot(auto.vx, auto.vy);
    if (vAtt > fisica.velMax) {
        auto.vx = (auto.vx / vAtt) * fisica.velMax;
        auto.vy = (auto.vy / vAtt) * fisica.velMax;
    }

    auto.x += auto.vx * dt;
    auto.y += auto.vy * dt;

    if (auto.speedPadCooldown <= 0) {
        for (const pad of SPEED_PADS) {
            if (!puntoInRettangoloRuotato(auto.x, auto.y, pad)) continue;
            const dirX = Math.cos(pad.angolo);
            const dirY = Math.sin(pad.angolo);
            auto.vx += dirX * SPEED_PAD_BOOST;
            auto.vy += dirY * SPEED_PAD_BOOST;
            auto.speedPadCooldown = SPEED_PAD_COOLDOWN;
            break;
        }
    }
}

/**
 * Aggiorna i timer interni dell'auto (cooldown e stati temporanei).
 * @param auto - Stato auto da aggiornare.
 * @param dt - Delta time in secondi.
 * @returns void
 */
function aggiornaTimerAuto(auto: StatoAuto, dt: number): void {
    // Timer separati per rendere prevedibili cooldown e stati temporanei.
    if (auto.spinTimer > 0) auto.spinTimer = Math.max(0, auto.spinTimer - dt);
    if (auto.slingshotTimer > 0) auto.slingshotTimer = Math.max(0, auto.slingshotTimer - dt);
    if (auto.shockwaveTimer > 0) auto.shockwaveTimer = Math.max(0, auto.shockwaveTimer - dt);

    if (auto.turboTimer > 0) {
        auto.turboTimer -= dt;
        if (auto.turboTimer <= 0) auto.turboCooldown = TURBO_RICARICA;
    }

    if (auto.turboCooldown > 0) auto.turboCooldown = Math.max(0, auto.turboCooldown - dt);
    if (auto.shockwaveCooldown > 0) auto.shockwaveCooldown = Math.max(0, auto.shockwaveCooldown - dt);
    if (auto.speedPadCooldown > 0) auto.speedPadCooldown = Math.max(0, auto.speedPadCooldown - dt);
}

/**
 * Gestione spin-out: ritorna true se ha consumato tutto il frame.
 * @param auto - Stato auto da aggiornare.
 * @param dt - Delta time in secondi.
 * @returns true se lo spin-out ha consumato il frame corrente.
 */
function gestisciSpinOut(auto: StatoAuto, dt: number): boolean {
    if (auto.spinTimer <= 0) return false;

    auto.angolo += 5.5 * dt;
    const v = Math.hypot(auto.vx, auto.vy);
    if (v > 0) {
        // Lo spin consuma velocita' in modo progressivo: l'auto resta leggibile,
        // ma il giocatore perde abbastanza tempo da percepire l'impatto come rischio reale.
        const f = Math.min(v, ATTRITO * 3 * dt);
        auto.vx -= (auto.vx / v) * f;
        auto.vy -= (auto.vy / v) * f;
    }

    auto.x += auto.vx * dt;
    auto.y += auto.vy * dt;
    return true;
}

/**
 * Sterzo guidato dal mouse con clamp a velocita' costante.
 * @param auto - Stato auto da aggiornare.
 * @param mouseAngolo - Angolo assoluto del mouse (rad).
 * @param dt - Delta time in secondi.
 * @returns void
 */
function orientaAutoVersoMouse(auto: StatoAuto, mouseAngolo: number, dt: number): void {
    if (!Number.isFinite(mouseAngolo)) return;

    const diff = normalizzaAngolo(mouseAngolo - auto.angolo);
    const maxTurn = STERZO_RAD * dt * 1.7;
    auto.angolo += Math.sign(diff) * Math.min(Math.abs(diff), maxTurn);
}

/**
 * Calcola accelerazione/velocita'/attrito con modificatori dinamici.
 * @param auto - Stato auto corrente.
 * @param bonusScia - Moltiplicatore velocita' max (scia/slingshot).
 * @param fuoriPista - true se su erba.
 * @returns Parametri fisici per il frame.
 */
function calcolaParametriFisici(auto: StatoAuto, bonusScia: number, fuoriPista: boolean): ParametriFisici {
    // L'erba taglia soprattutto la velocita' massima, non l'accelerazione assoluta:
    // cosi' l'errore costa caro sul giro ma il rientro non diventa frustrante.
    const accelMax = fuoriPista ? ACCEL * ERBA_ACCEL_MULT : ACCEL;
    const velMax = VEL_MAX
        * (fuoriPista ? ERBA_VELMAX_MULT : 1)
        * (auto.turboTimer > 0 ? TURBO_BONUS : 1)
        * bonusScia;
    const attritoTotale = fuoriPista ? ATTRITO + ERBA_ATTRITO_ADD : ATTRITO;

    return { accelMax, velMax, attritoTotale };
}

/**
 * Posizione di griglia: rettilineo sud orizzontale, auto rivolte a destra.
 * @param i - Indice auto in griglia.
 * @returns Coordinate e angolo di partenza.
 */
function posGriglia(i: number): { x: number; y: number; angolo: number } {
    return {
        x: 3170 - i * 50,
        y: i % 2 === 0 ? 2765 : 2835,
        angolo: 0,
    };
}


// ============================================================================
// SERVER AUTORITATIVO
// Riceve input, simula fisica/regole e pubblica lo stato ufficiale della gara.
// ============================================================================

// Il server viene dichiarato prima del client per chiarire la fonte di verita'.
// --- SERVER LOGIC ----------------------------------------------------------

/**
 * Server autoritativo: applica input, simula fisica e regole gara,
 * quindi pubblica lo snapshot ufficiale ai client.
 */
export class MicroRacingServer extends GameServer {

    // --- Stato della partita -------------------------------------------------
    // Campi ordinati per flusso: fase -> timer -> risultati -> ostacoli.

    private auto: Record<string, StatoAuto> = {};
    private fase: Fase          = 'qualifiche';
    private tempoQual           = DURATA_QUALIFICHE;
    private tempoVoto           = DURATA_VOTO;
    private tempoRecap          = DURATA_RECAP;
    private countdownPartenza   = 0;    // >0 = semaforo attivo, input bloccati
    private dnfTimer            = -1;   // -1 = non attivo
    private gridOrder: string[] = [];
    private garaFinita          = false;
    private modalitaGara: ModalitaGara = 'standard';
    private voti: Record<string, ModalitaGara | null> = {};
    private totGiocatori        = 0;
    private ultimiInput: Record<string, MsgInput> = {};
    private sopravvivenzaTimer  = SOPRAVVIVENZA_INTERVALLO;
    private ultimoARischio: string | null = null;
    private ostacoliProssimoEventoTimer = tempoProssimiOstacoli();
    private ostacoliAvvisoTimer = 0;
    private ostacoliAttiviTimer = 0;
    private ostacoliInAvviso: StatoOstacolo[] = [];
    private ostacoliInPista: StatoOstacolo[] = [];


    // --- API richiesta da GameServer ----------------------------------------

    /**
     * Inizializza auto, voti e input partendo dalla lobby.
     * @param giocatori - Dizionario giocatori presenti in lobby.
     * @returns void
     */
    init(giocatori: Record<string, Player>): void {
        let i = 0;
        for (const id in giocatori) {
            const g = posGriglia(i);
            this.auto[id] = {
                x: g.x, y: g.y, xPrecedente: g.x, yPrecedente: g.y,
                angolo: g.angolo, vx: 0, vy: 0,
                giri: 0, cp: 0, cpQual: 0,
                giroLanciato: false,
                migliorGiro: -1, tempoGiroAttuale: 0,
                sulTraguardo: false,   // edge-detection: falso all'avvio
                giroInvalido: false,
                turboTimer: 0, turboCooldown: 0, shockwaveCooldown: 0, shockwaveTimer: 0, spinTimer: 0,
                inScia: false, tempoScia: 0, slingshotTimer: 0, speedPadCooldown: 0,
                nome: giocatori[id].name, character: giocatori[id].character,
                finito: false, dnf: false, posizione: 0,
            };
            this.ultimiInput[id] = inputNeutro();
            this.voti[id] = null;
            i++;
        }
        this.totGiocatori = i;
    }

    /**
     * Entry point del loop: input -> simulazione -> fase -> snapshot.
     * @param messaggi - Messaggi in ingresso del tick corrente.
     * @param dt - Delta time in secondi.
     * @returns Messaggi da inviare ai client.
     */
    tick(messaggi: IncomingMsg[], dt: number): OutgoingMsg[] {
        // Ordine volutamente deterministico: input prima, poi fisica, poi fasi,
        // cosi' le transizioni temporali usano posizioni gia' aggiornate.
        this.registraInput(messaggi);
        this.aggiornaSimulazione(dt);
        this.aggiornaFase(dt);
        return [{ payload: this.creaPayloadStato() }];
    }

    /**
     * Segnale di fine partita per chi gestisce il game loop.
     * @returns true se la gara e' conclusa.
     */
    isFinished(): boolean { return this.garaFinita; }


    // --- Pipeline del tick ---------------------------------------------------

    /**
     * Verifica se la gara e' in movimento (semaforo spento).
     * @returns true se la gara e' attiva e i giocatori possono muoversi.
     */
    private garaInMovimento(): boolean {
        return this.fase === 'gara' && this.countdownPartenza <= 0;
    }

    /**
     * Determina se la simulazione fisica deve avanzare nel tick corrente.
     * @returns true se la fisica e' attiva.
     */
    private simulazioneFisicaAttiva(): boolean {
        return this.fase === 'qualifiche' || this.garaInMovimento();
    }

    /**
     * Esegue un passo di simulazione: fisica, freeze e collisioni.
     * @param dt - Delta time in secondi.
     * @returns void
     */
    private aggiornaSimulazione(dt: number): void {
        const garaAttiva = this.garaInMovimento();
        const simulazioneOn = this.simulazioneFisicaAttiva();

        if (simulazioneOn) this.simulaAuto(dt, garaAttiva);
        else this.tieniFermeLeAuto();

        if (garaAttiva) this.risolviCollisioniAuto();
    }

    /**
     * Aggiorna la fase corrente instradando il tick al sotto-sistema corretto.
     * @param dt - Delta time in secondi.
     * @returns void
     */
    private aggiornaFase(dt: number): void {
        if (this.fase === 'qualifiche') {
            this.tickQualifiche(dt);
            return;
        }

        if (this.fase === 'recap') {
            this.tickRecap(dt);
            return;
        }

        if (this.fase === 'voto') {
            this.tickVoto(dt);
            return;
        }

        this.tickGara(dt);
    }

    /**
     * Crea lo snapshot di stato da inviare ai client.
     * @returns Payload completo dello stato server.
     */
    private creaPayloadStato(): MsgStato {
        const { standard, sopravvivenza } = this.conteggioVoti();
        return {
            kind: 'stato',
            fase: this.fase,
            tempoQual: this.tempoQual,
            tempoVoto: this.tempoVoto,
            tempoRecap: this.tempoRecap,
            countdownPartenza: this.countdownPartenza,
            dnfTimer: this.dnfTimer,
            auto: this.auto,
            garaFinita: this.garaFinita,
            gridOrder: this.gridOrder,
            migliorAssoluto: calcolaMigliorAssoluto(this.auto),
            votiStandard: standard,
            votiSopravvivenza: sopravvivenza,
            modalitaGara: this.modalitaGara,
            sopravvivenzaTimer: this.sopravvivenzaTimer,
            ultimoARischio: this.modalitaGara === 'sopravvivenza' ? this.ultimoARischio : null,
            ostacoliAvvisoTimer: this.ostacoliAvvisoTimer,
            ostacoli: this.ostacoliAvvisoTimer > 0 ? this.ostacoliInAvviso : this.ostacoliInPista,
        };
    }


    // --- Input, power-up e fisica auto --------------------------------------

    /**
     * Registra input e voti in arrivo, validandoli prima della simulazione.
     * @param messaggi - Messaggi ricevuti nel tick corrente.
     * @returns void
     */
    private registraInput(messaggi: IncomingMsg[]): void {
        for (const msg of messaggi) {
            const voto = normalizzaVoto(msg.payload);
            if (voto) {
                this.registraVoto(msg.clientId, voto);
                continue;
            }
            const input = normalizzaInput(msg.payload);
            if (!input || !this.auto[msg.clientId]) continue;
            this.ultimiInput[msg.clientId] = input;
        }
    }

    /**
     * Registra il voto di un giocatore durante la fase voto.
     * @param id - Id giocatore.
     * @param voto - Voto validato.
     * @returns void
     */
    private registraVoto(id: string, voto: MsgVoto): void {
        if (this.fase !== 'voto' || !this.auto[id]) return;
        this.voti[id] = voto.scelta;
    }

    /**
     * Conta i voti per modalita'.
     * @returns Numero voti standard e sopravvivenza.
     */
    private conteggioVoti(): { standard: number; sopravvivenza: number } {
        let standard = 0;
        let sopravvivenza = 0;
        for (const id in this.voti) {
            if (this.voti[id] === 'standard') standard++;
            else if (this.voti[id] === 'sopravvivenza') sopravvivenza++;
        }
        return { standard, sopravvivenza };
    }

    /**
     * Simula tutte le auto attive applicando input, power-up e fisica.
     * @param dt - Delta time in secondi.
     * @param garaAttiva - true se la gara e' in movimento.
     * @returns void
     */
    private simulaAuto(dt: number, garaAttiva: boolean): void {
        for (const id in this.auto) {
            const auto = this.auto[id];
            const input = this.ultimiInput[id] ?? inputNeutro();
            if (garaAttiva && auto.finito) continue;

            this.preparaAutoPerTick(auto);
            this.usaPowerUp(auto, input);
            this.aggiornaFisicaAuto(id, auto, input, dt, garaAttiva);
        }
    }

    /**
     * Salva la posizione precedente per rilevare attraversamenti e contromano.
     * @param auto - Stato auto da aggiornare.
     * @returns void
     */
    private preparaAutoPerTick(auto: StatoAuto): void {
        auto.xPrecedente = auto.x;
        auto.yPrecedente = auto.y;
    }

    /**
     * Aggiorna la fisica di una singola auto con controlli track-limits.
     * @param id - Id giocatore.
     * @param auto - Stato auto.
     * @param input - Input normalizzato.
     * @param dt - Delta time in secondi.
     * @param garaAttiva - true se la gara e' in corso.
     * @returns void
     */
    private aggiornaFisicaAuto(
        id: string,
        auto: StatoAuto,
        input: MsgInput,
        dt: number,
        garaAttiva: boolean,
    ): void {
        const fuoriPistaPrima = !sullaStradaConMargine(auto.x, auto.y, MARGINE_QUALI);
        this.invalidaGiroSeFuori(auto, fuoriPistaPrima);

        const bonusScia = garaAttiva ? this.calcolaBonusScia(id, dt) : 1;
        aggiornaFisica(auto, input, dt, bonusScia, fuoriPistaPrima);

        const fuoriPistaDopo = !sullaStradaConMargine(auto.x, auto.y, MARGINE_QUALI);
        this.invalidaGiroSeFuori(auto, fuoriPistaDopo);
    }

    /**
     * Invalida il giro qualifica se l'auto esce dalla pista dopo il lancio.
     * @param auto - Stato auto.
     * @param fuoriPista - true se il punto e' fuori pista.
     * @returns void
     */
    private invalidaGiroSeFuori(auto: StatoAuto, fuoriPista: boolean): void {
        if (this.fase !== 'qualifiche' || !fuoriPista || !auto.giroLanciato) return;

        auto.giroLanciato = false;
        auto.cp = 0;
        auto.cpQual = 0;
        auto.tempoGiroAttuale = 0;
        auto.giroInvalido = true;
    }

    /**
     * Consuma i power-up in input, trasformandoli in stati server-side.
     * @param auto - Stato auto.
     * @param input - Input del giocatore.
     * @returns void
     */
    private usaPowerUp(auto: StatoAuto, input: MsgInput): void {
        this.provaAttivareTurbo(auto, input);
        this.provaAttivareShockwave(auto, input);
        input.turbo = false;
        input.shockwave = false;
    }

    /**
     * Attiva il turbo se disponibile.
     * @param auto - Stato auto.
     * @param input - Input corrente.
     * @returns void
     */
    private provaAttivareTurbo(auto: StatoAuto, input: MsgInput): void {
        if (input.turbo && auto.turboTimer <= 0 && auto.turboCooldown <= 0)
            auto.turboTimer = TURBO_DURATA;
    }

    /**
     * Attiva shockwave e applica l'impulso ad area se disponibile.
     * @param auto - Stato auto.
     * @param input - Input corrente.
     * @returns void
     */
    private provaAttivareShockwave(auto: StatoAuto, input: MsgInput): void {
        if (this.fase !== 'gara' || !input.shockwave || auto.shockwaveCooldown > 0) return;

        auto.shockwaveCooldown = SHOCKWAVE_RICARICA;
        auto.shockwaveTimer = SHOCKWAVE_DURATA;
        this.applicaShockwave(auto);
    }

    /**
     * Applica un impulso radiale alle auto entro il raggio.
     * @param origine - Auto che genera l'onda d'urto.
     * @returns void
     */
    private applicaShockwave(origine: StatoAuto): void {
        for (const id in this.auto) {
            const bersaglio = this.auto[id];
            if (bersaglio === origine || bersaglio.finito) continue;

            const dx = bersaglio.x - origine.x;
            const dy = bersaglio.y - origine.y;
            const dist = Math.hypot(dx, dy);
            if (dist <= 1 || dist > SHOCKWAVE_RAGGIO) continue;

            const intensita = 1 - dist / SHOCKWAVE_RAGGIO;
            const spinta = SHOCKWAVE_FORZA * intensita;
            bersaglio.vx += (dx / dist) * spinta;
            bersaglio.vy += (dy / dist) * spinta;
        }
    }


    // --- Collisioni ----------------------------------------------------------

    /**
     * Azzerra velocita' e stati temporanei quando la simulazione e' ferma.
     * @returns void
     */
    private tieniFermeLeAuto(): void {
        for (const id in this.auto) {
            this.auto[id].vx = 0;
            this.auto[id].vy = 0;
            this.auto[id].inScia = false;
            this.auto[id].tempoScia = 0;
            this.auto[id].slingshotTimer = 0;
            this.auto[id].shockwaveTimer = 0;
        }
    }

    /**
     * Risolve collisioni pairwise tra tutte le auto.
     * @returns void
     */
    private risolviCollisioniAuto(): void {
        const ids = Object.keys(this.auto);
        for (let i = 0; i < ids.length - 1; i++) {
            for (let j = i + 1; j < ids.length; j++) {
                this.risolviCollisioneCoppia(this.auto[ids[i]], this.auto[ids[j]]);
            }
        }
    }

    /**
     * Risolve la collisione tra due auto con separazione e impulso morbido.
     * @param primaAuto - Prima auto.
     * @param secondaAuto - Seconda auto.
     * @returns void
     */
    private risolviCollisioneCoppia(primaAuto: StatoAuto, secondaAuto: StatoAuto): void {
        if (primaAuto.finito || secondaAuto.finito) return;

        const distanza = Math.hypot(primaAuto.x - secondaAuto.x, primaAuto.y - secondaAuto.y);
        if (distanza >= 12 || distanza <= 0) return;

        const nx = (secondaAuto.x - primaAuto.x) / distanza;
        const ny = (secondaAuto.y - primaAuto.y) / distanza;
        const overlap = (12 - distanza) / 2;
        primaAuto.x -= nx * overlap;
        primaAuto.y -= ny * overlap;
        secondaAuto.x += nx * overlap;
        secondaAuto.y += ny * overlap;

        // Impulso morbido: evita auto incollate senza produrre rimbalzi arcade eccessivi.
        const velocitaPrima = primaAuto.vx * nx + primaAuto.vy * ny;
        const velocitaSeconda = secondaAuto.vx * nx + secondaAuto.vy * ny;
        primaAuto.vx += (velocitaSeconda - velocitaPrima) * nx * 0.7;
        primaAuto.vy += (velocitaSeconda - velocitaPrima) * ny * 0.7;
        secondaAuto.vx += (velocitaPrima - velocitaSeconda) * nx * 0.7;
        secondaAuto.vy += (velocitaPrima - velocitaSeconda) * ny * 0.7;
    }

    // --- Qualifiche ----------------------------------------------------------

    /**
     * Avanza la fase qualifiche: timer e tempi sul giro.
     * @param dt - Delta time in secondi.
     * @returns void
     */
    private tickQualifiche(dt: number): void {
        this.tempoQual -= dt;

        for (const id in this.auto) {
            this.aggiornaAutoQualifica(this.auto[id], dt);
        }

        if (this.tempoQual <= 0) this.concludiQualifiche();
    }

    /**
     * Rileva l'attraversamento del traguardo con edge detection.
     * @param auto - Stato auto.
     * @returns Oggetto con stato nelTraguardo e appenaEntrato.
     */
    private rilevaPassaggioTraguardo(auto: StatoAuto): { nelTraguardo: boolean; appenaEntrato: boolean } {
        const haAttraversato = attraversaTraguardo(auto.xPrecedente, auto.yPrecedente, auto.x, auto.y);
        const nelTraguardo = dentroTraguardo(auto.x, auto.y);
        return {
            nelTraguardo,
            appenaEntrato: (nelTraguardo || haAttraversato) && !auto.sulTraguardo,
        };
    }

    /**
     * Aggiorna il giro di qualifica per una singola auto.
     * @param auto - Stato auto.
     * @param dt - Delta time in secondi.
     * @returns void
     */
    private aggiornaAutoQualifica(auto: StatoAuto, dt: number): void {
        auto.tempoGiroAttuale += dt * 1000;
        auto.cpQual = aggiornaCheckpoint(auto.cpQual, auto.x, auto.y);
        this.gestisciPassaggioQualifica(auto);
    }

    /**
     * Gestisce il passaggio sul traguardo in qualifica (start/stop giro).
     * @param auto - Stato auto.
     * @returns void
     */
    private gestisciPassaggioQualifica(auto: StatoAuto): void {
        const passaggio = this.rilevaPassaggioTraguardo(auto);
        if (passaggio.appenaEntrato) {
            if (!auto.giroLanciato) {
                // Primo attraversamento dalla griglia: avvio il giro senza validare un tempo.
                auto.giroLanciato = true;
                auto.tempoGiroAttuale = 0;
                auto.cpQual = 0;
                auto.giroInvalido = false;
            } else {
                // Giro valido solo con tutti i checkpoint e senza uscita pista.
                this.salvaMigliorGiroSeValido(auto);
                this.resetGiroQualifica(auto);
            }
        }

        auto.sulTraguardo = passaggio.nelTraguardo;
    }

    /**
     * Registra il miglior giro se valido.
     * @param auto - Stato auto.
     * @returns void
     */
    private salvaMigliorGiroSeValido(auto: StatoAuto): void {
        const tuttiCP = (auto.cpQual & TUTTI_CHECKPOINT) === TUTTI_CHECKPOINT;
        if (!auto.giroLanciato || !tuttiCP || auto.giroInvalido) return;

        const tempo = auto.tempoGiroAttuale;
        if (auto.migliorGiro < 0 || tempo < auto.migliorGiro) auto.migliorGiro = tempo;
    }

    /**
     * Reset del giro di qualifica per ripartire da stato pulito.
     * @param auto - Stato auto.
     * @returns void
     */
    private resetGiroQualifica(auto: StatoAuto): void {
        // Il reset avviene anche al primo passaggio non valido: cosi' il giro
        // successivo parte sempre da una base pulita e non eredita track-limits.
        auto.tempoGiroAttuale = 0;
        auto.cpQual = 0;
        auto.giroInvalido = false;
    }

    /**
     * Chiude la fase qualifiche e avvia il voto modalita'.
     * @returns void
     */
    private concludiQualifiche(): void {
        this.tempoQual = 0;
        this.gridOrder = calcolaGriglia(this.auto);
        this.tieniFermeLeAuto();
        this.fase = 'voto';
        this.tempoVoto = DURATA_VOTO;
        this.modalitaGara = 'standard';
        for (const id in this.voti) this.voti[id] = null;
    }


    // --- Recap e griglia di partenza ----------------------------------------

    /**
     * Avanza il recap griglia e avvia la gara allo scadere.
     * @param dt - Delta time in secondi.
     * @returns void
     */
    private tickRecap(dt: number): void {
        this.tempoRecap -= dt;
        if (this.tempoRecap <= 0) {
            this.tempoRecap = 0;
            this.avviaGara();
        }
    }

    /**
     * Stabilisce la modalita' di gara in base ai voti (con spareggio random).
     * @param dt - Delta time in secondi.
     * @returns void
     */
    private tickVoto(dt: number): void { //stabilisce la modalità di gara in base ai voti dei giocatori
        this.tempoVoto -= dt;
        if (this.tempoVoto > 0) return;

        this.tempoVoto = 0;
        const { standard, sopravvivenza } = this.conteggioVoti();
        this.modalitaGara = sopravvivenza > standard 
            ? 'sopravvivenza' 
            : sopravvivenza === standard 
                ? (Math.random() < 0.5 ? 'sopravvivenza' : 'standard')
                : 'standard';
        this.fase = 'recap';
        this.tempoRecap = DURATA_RECAP;
    }

    /**
     * Riposiziona le auto in griglia secondo i risultati delle qualifiche e accende il semaforo.
     * @returns void
     */
    private avviaGara(): void {
        this.fase               = 'gara';
        this.countdownPartenza  = DURATA_PARTENZA;
        this.dnfTimer           = -1;
        this.sopravvivenzaTimer = SOPRAVVIVENZA_INTERVALLO;
        this.ostacoliProssimoEventoTimer = tempoProssimiOstacoli();
        this.ostacoliAvvisoTimer = 0;
        this.ostacoliAttiviTimer = 0;
        this.ostacoliInAvviso = [];
        this.ostacoliInPista    = [];

        const ordine = this.gridOrder.length > 0 ? this.gridOrder : Object.keys(this.auto);
        ordine.forEach((id, i) => {
            const g = posGriglia(i);
            const a = this.auto[id];
            if (a) this.resetAutoPerGara(a, g);
        });
    }

    /**
     * Reset completo dello stato auto per la partenza gara.
     * @param auto - Stato auto da reimpostare.
     * @param griglia - Coordinate e angolo di partenza.
     * @returns void
     */
    private resetAutoPerGara(auto: StatoAuto, griglia: { x: number; y: number; angolo: number }): void {
        auto.x = griglia.x;
        auto.y = griglia.y;
        auto.angolo = griglia.angolo;
        auto.xPrecedente = griglia.x;
        auto.yPrecedente = griglia.y;
        auto.vx = 0;
        auto.vy = 0;
        auto.giri = 0;
        auto.cp = MASCHERA_CHECKPOINT_PRE_GRIGLIA;
        auto.giroLanciato = false;
        // La griglia parte sotto la fascia: forzare false evita un falso passaggio al primo tick utile.
        auto.sulTraguardo = false;
        auto.finito = false;
        auto.dnf = false;
        auto.posizione = 0;
        auto.giroInvalido = false;
        auto.inScia = false;
        auto.tempoScia = 0;
        auto.slingshotTimer = 0;
        auto.shockwaveCooldown = 0;
        auto.shockwaveTimer = 0;
        auto.speedPadCooldown = 0;
    }


    // --- Gara, arrivi e DNF --------------------------------------------------

    /**
     * Avanza la gara: semaforo, ostacoli, arrivi, DNF o sopravvivenza.
     * @param dt - Delta time in secondi.
     * @returns void
     */
    private tickGara(dt: number): void {
        if (this.aggiornaCountdownPartenza(dt)) return;

        // Ordine fisso: ostacoli -> arrivi -> modalita' speciali,
        // per garantire determinismo negli stati finali del tick.
        this.updateOstacoli(dt);

        const finitiPrima = this.contaAutoFinite();
        const candidati = this.raccogliPassaggiGara();
        const haVincitoreQuestoTick = candidati.some(c => c.haCompletatoGara);
        let finiti = this.assegnaNuoviArrivi(candidati, finitiPrima, haVincitoreQuestoTick);

        if (this.modalitaGara === 'standard' && this.tuttiHannoConcluso(finiti)) {
            this.garaFinita = true;
            return;
        }

        if (this.modalitaGara === 'sopravvivenza') {
            finiti = this.aggiornaSopravvivenza(dt, finiti);
            this.garaFinita = this.sopravvivenzaConclusa();
            return;
        }

        finiti = this.aggiornaDnfGlobale(dt, finiti);
        if (this.tuttiHannoConcluso(finiti)) this.garaFinita = true;
    }

    /**
     * Aggiorna il countdown semaforo.
     * @param dt - Delta time in secondi.
     * @returns true se il countdown e' ancora attivo.
     */
    private aggiornaCountdownPartenza(dt: number): boolean {
        if (this.countdownPartenza <= 0) return false;

        this.countdownPartenza = Math.max(0, this.countdownPartenza - dt);
        return true;
    }

    /**
     * Conta quante auto hanno terminato la gara.
     * @returns Numero auto finite.
     */
    private contaAutoFinite(): number {
        let finiti = 0;
        for (const id in this.auto) if (this.auto[id].finito) finiti++;
        return finiti;
    }

    /**
     * Raccoglie le auto che hanno completato il giro valido nel tick.
     * @returns Lista candidati all'arrivo.
     */
    private raccogliPassaggiGara(): CandidatoArrivo[] {
        const candidati: CandidatoArrivo[] = [];

        for (const id in this.auto) {
            const auto = this.auto[id];
            if (auto.finito) continue;

            auto.cp = aggiornaCheckpoint(auto.cp, auto.x, auto.y);
            this.registraPassaggioGara(auto, candidati);
        }

        return candidati;
    }

    /**
     * Registra il passaggio sul traguardo in gara e aggiorna giri.
     * @param auto - Stato auto.
     * @param candidati - Lista candidati arrivo da aggiornare.
     * @returns void
     */
    private registraPassaggioGara(auto: StatoAuto, candidati: CandidatoArrivo[]): void {
        const passaggio = this.rilevaPassaggioTraguardo(auto);

        if (passaggio.appenaEntrato) {
            if (!auto.giroLanciato) {
                // Il passaggio di lancio dalla griglia non deve chiudere alcun giro.
                auto.giroLanciato = true;
                auto.cp = 0;
            } else {
                const tuttiCP = (auto.cp & TUTTI_CHECKPOINT) === TUTTI_CHECKPOINT;
                if (!tuttiCP) {
                    auto.sulTraguardo = passaggio.nelTraguardo;
                    return;
                }

                auto.giri++;
                auto.cp = 0;
                if (this.modalitaGara === 'standard') {
                    candidati.push({
                        auto,
                        haCompletatoGara: auto.giri >= GIRI_GARA,
                        progress: progressoGara(auto),
                    });
                }
            }
        }

        auto.sulTraguardo = passaggio.nelTraguardo;
    }

    /**
     * Assegna posizioni di arrivo e avvia il DNF globale se necessario.
     * @param candidati - Candidati all'arrivo.
     * @param finitiPrima - Numero arrivi gia' registrati.
     * @param haVincitoreQuestoTick - true se e' arrivato il primo.
     * @returns Numero totale di auto finite.
     */
    private assegnaNuoviArrivi(
        candidati: CandidatoArrivo[],
        finitiPrima: number,
        haVincitoreQuestoTick: boolean,
    ): number {
        let finiti = finitiPrima;
        const dnfGiaAttivo = this.dnfTimer > 0;
        const dnfParteOra = finitiPrima === 0 && haVincitoreQuestoTick;
        const classificaAperta = dnfGiaAttivo || dnfParteOra;
        const nuoviFiniti = candidati.filter(c => c.haCompletatoGara || classificaAperta);

        nuoviFiniti.sort((a, b) => b.progress - a.progress);
        for (const candidato of nuoviFiniti) {
            candidato.auto.finito = true;
            candidato.auto.posizione = ++finiti;
        }

        if (this.dnfTimer < 0 && dnfParteOra) this.dnfTimer = DNF_TIMEOUT;
        return finiti;
    }

    /**
     * Gestisce il timer DNF globale e forza gli arrivi allo scadere.
     * @param dt - Delta time in secondi.
     * @param finiti - Numero auto gia' finite.
     * @returns Numero aggiornato di auto finite.
     */
    private aggiornaDnfGlobale(dt: number, finiti: number): number {
        if (this.dnfTimer < 0) return finiti;

        this.dnfTimer = Math.max(0, this.dnfTimer - dt);
        if (this.dnfTimer > 0) return finiti;

        const nonFiniti = Object.keys(this.auto)
            .filter(id => !this.auto[id].finito)
            .sort((a, b) => confrontaAutoInGara(this.auto[a], this.auto[b]));

        for (const id of nonFiniti) {
            const auto = this.auto[id];
            auto.finito = true;
            auto.dnf = true;
            auto.posizione = ++finiti;
        }

        this.dnfTimer = -1;
        return finiti;
    }

    /**
     * Gestisce la modalita' sopravvivenza ed elimina l'ultimo a intervalli.
     * @param dt - Delta time in secondi.
     * @param finiti - Numero auto gia' finite.
     * @returns Numero aggiornato di auto finite.
     */
    private aggiornaSopravvivenza(dt: number, finiti: number): number {
        this.ultimoARischio = this.idUltimoAttivo();

        if (this.contaAutoAttive() <= 1) {
            this.promuoviVincitoreSopravvivenza();
            return this.contaAutoFinite();
        }

        this.sopravvivenzaTimer -= dt;
        if (this.sopravvivenzaTimer > 0) return finiti;

        this.sopravvivenzaTimer = SOPRAVVIVENZA_INTERVALLO;
        const eliminato = this.eliminaUltimoInGara();
        if (!eliminato) return finiti;
        this.promuoviVincitoreSopravvivenza();
        return this.contaAutoFinite();
    }

    /**
     * Elimina l'auto ultima in classifica.
     * @returns true se e' stata eliminata un'auto.
     */
    private eliminaUltimoInGara(): boolean {
        const attivi = Object.values(this.auto)
            .filter(a => !a.finito)
            .sort((a, b) => confrontaAutoInGara(a, b));

        if (attivi.length <= 1) return false;
        const ultimo = attivi[attivi.length - 1];
        ultimo.finito = true;
        ultimo.dnf = true;
        ultimo.vx = 0;
        ultimo.vy = 0;
        ultimo.posizione = attivi.length;
        return true;
    }

    /**
     * Conta quante auto sono ancora attive in gara.
     * @returns Numero auto attive.
     */
    private contaAutoAttive(): number {
        let attive = 0;
        for (const id in this.auto) if (!this.auto[id].finito) attive++;
        return attive;
    }

    /**
     * Restituisce l'id dell'ultimo pilota attivo in gara.
     * @returns Id giocatore o null se non disponibile.
     */
    private idUltimoAttivo(): string | null {
        const ids = Object.keys(this.auto)
            .filter(id => !this.auto[id].finito)
            .sort((a, b) => confrontaAutoInGara(this.auto[a], this.auto[b]));
        return ids.length > 1 ? ids[ids.length - 1] : null;
    }

    /**
     * Promuove l'ultimo rimasto a vincitore in sopravvivenza.
     * @returns void
     */
    private promuoviVincitoreSopravvivenza(): void {
        const attivi = Object.values(this.auto).filter(a => !a.finito);
        if (attivi.length !== 1) return;

        const vincitore = attivi[0];
        vincitore.finito = true;
        vincitore.dnf = false;
        vincitore.vx = 0;
        vincitore.vy = 0;
        vincitore.posizione = 1;
    }

    /**
     * Verifica se la sopravvivenza e' conclusa.
     * @returns true se non restano auto attive.
     */
    private sopravvivenzaConclusa(): boolean {
        return this.modalitaGara === 'sopravvivenza' && this.contaAutoAttive() === 0;
    }

    /**
     * Aggiorna lo stato degli ostacoli (avviso -> attivi -> cooldown).
     * @param dt - Delta time in secondi.
     * @returns void
     */
    private updateOstacoli(dt: number): void {
        if (this.ostacoliAttiviTimer > 0) {
            this.ostacoliAttiviTimer = Math.max(0, this.ostacoliAttiviTimer - dt);
            this.risolviCollisioniOstacoli();

            if (this.ostacoliAttiviTimer === 0) {
                this.ostacoliProssimoEventoTimer = tempoProssimiOstacoli();
                this.ostacoliInPista = [];
            }
            return;
        }

        if (this.ostacoliAvvisoTimer > 0) {
            this.ostacoliAvvisoTimer = Math.max(0, this.ostacoliAvvisoTimer - dt);
            if (this.ostacoliAvvisoTimer === 0) {
                this.ostacoliInPista = this.ostacoliInAvviso;
                this.ostacoliInAvviso = [];
                this.ostacoliAttiviTimer = OSTACOLI_DURATA;
            }
            return;
        }

        this.ostacoliProssimoEventoTimer -= dt;
        if (this.ostacoliProssimoEventoTimer <= 0) {
            this.ostacoliInAvviso = this.generaOstacoliRandom();
            this.ostacoliAvvisoTimer = OSTACOLI_AVVISO;
        }
    }

    /**
     * Genera un set di ostacoli distribuiti lungo il giro.
     * @returns Lista di ostacoli con posizione e angolo.
     */
    private generaOstacoliRandom(): StatoOstacolo[] {
        const ostacoli: StatoOstacolo[] = [];
        const count = OSTACOLI_PER_EVENTO_MIN
            + Math.floor(Math.random() * (OSTACOLI_PER_EVENTO_MAX - OSTACOLI_PER_EVENTO_MIN + 1));
        const base = Math.random() * LUNGHEZZA_TRACCIATO;
        const spacing = LUNGHEZZA_TRACCIATO / count;
        const laterali = [-52, -26, 0, 26, 52];

        for (let i = 0; i < count; i++) {
            const jitter = (Math.random() - 0.5) * 260;
            const laterale = laterali[i % laterali.length] + (Math.random() - 0.5) * 12;
            // Distribuzione lungo la polyline: spacing uniforma gli ostacoli,
            // jitter aggiunge varianza per evitare pattern ripetitivi.
            const p = puntoLungoTracciato(base + spacing * i + jitter, laterale);
            ostacoli.push({ x: p.x, y: p.y, r: OSTACOLO_RAGGIO, angolo: Math.random() * Math.PI * 2 });
        }

        return ostacoli;
    }

    /**
     * Applica spin-out alle auto che toccano un ostacolo.
     * @returns void
     */
    private risolviCollisioniOstacoli(): void {
        for (const id in this.auto) {
            const auto = this.auto[id];
            if (auto.finito || auto.spinTimer > 0) continue;

            for (const ostacolo of this.ostacoliInPista) {
                if (Math.hypot(auto.x - ostacolo.x, auto.y - ostacolo.y) > ostacolo.r + 8) continue;
                auto.spinTimer = SPIN_OUT_DURATA;
                auto.vx *= 0.35;
                auto.vy *= 0.35;
                break;
            }
        }
    }

    /**
     * Verifica se tutte le auto hanno concluso (arrivate o DNF).
     * @param finiti - Numero auto finite.
     * @returns true se la gara e' conclusa per tutti.
     */
    private tuttiHannoConcluso(finiti: number): boolean {
        return finiti >= this.totGiocatori;
    }


    // --- Scia ---------------------------------------------------------------

     /**
      * Calcola il bonus scia per l'auto `idFollower`.
      * Un'auto e' in scia se si trova nel cono posteriore dell'auto davanti:
      *   - distanza < SCIA_DIST_MAX
      *   - proiezione lungo l'asse del leader > 0 (e' dietro)
      *   - distanza laterale < SCIA_CONE_BASE + distanza * SCIA_CONE_GAIN
      * Dopo SLINGSHOT_TEMPO in scia continua, si attiva lo slingshot temporaneo.
      * @param idFollower - Id dell'auto che riceve il beneficio.
      * @param dt - Delta time in secondi.
      * @returns Moltiplicatore di velocita' massima.
      */
    private calcolaBonusScia(idFollower: string, dt: number): number {
        const follower = this.auto[idFollower];
        if (!follower) return 1;
        let inScia = false;

        for (const id in this.auto) {
            if (id === idFollower) continue;
            const leader = this.auto[id];
            if (!leader || leader.finito) continue;

            const dx = follower.x - leader.x;
            const dy = follower.y - leader.y;
            const dist = Math.hypot(dx, dy);
            if (dist > SCIA_DIST_MAX || dist < 8) continue;

            // Asse del leader: forward e laterale (radianti) per misurare
            // proiezione longitudinale e distanza laterale rispetto alla scia.
            const fwX = Math.cos(leader.angolo);
            const fwY = Math.sin(leader.angolo);

            // "lungoAsse" > 0 significa che il follower e' DIETRO il leader
            // (proiezione negativa del vettore follower->leader sull'asse forward).
            const lungoAsse = -(dx * fwX + dy * fwY);
            if (lungoAsse <= 0) continue;

            // Distanza laterale dall'asse del leader
            const laterale = Math.abs(dx * (-fwY) + dy * fwX);
            const aperturaCono = SCIA_CONE_BASE + lungoAsse * SCIA_CONE_GAIN;

            if (laterale <= aperturaCono) {
                inScia = true;
                break;
            }
        }

        if (inScia) {
            follower.tempoScia += dt;
            if (follower.tempoScia >= SLINGSHOT_TEMPO && follower.slingshotTimer <= 0) {
                follower.slingshotTimer = SLINGSHOT_DURATA;
                follower.tempoScia = 0;
            }
        } else {
            follower.tempoScia = 0;
        }

        follower.inScia = inScia;

        if (follower.slingshotTimer > 0) return SLINGSHOT_BONUS;
        if (inScia) return SCIA_BONUS;
        return 1;
    }
}


// ============================================================================
// CLIENT CANVAS
// Interpola lo stato ricevuto, invia input e disegna mondo, HUD e finali.
// ============================================================================

// --- CLIENT LOGIC ----------------------------------------------------------

/**
 * Client di rendering: interpola lo stato server e disegna il mondo su canvas.
 */
export class MicroRacingClient extends GameClient {

    // --- Stato ricevuto e interpolato ---------------------------------------

    // Stato ricevuto dal server (fonte di verita')
    private statoServer: Record<string, StatoAuto> | null = null;
    // Versioni interpolate per rendering fluido (anti-scatto da rete)
    private renderAuto: Record<string, StatoAuto> = {};

    private fase: Fase                 = 'qualifiche';
    private tempoQual                  = DURATA_QUALIFICHE;
    private tempoVoto                  = DURATA_VOTO;
    private tempoRecap                 = DURATA_RECAP;
    private countdownPartenza          = 0;
    private dnfTimer                   = -1;
    private gridOrder: string[]        = [];
    private migliorAssoluto            = -1;
    private votiStandard               = 0;
    private votiSopravvivenza          = 0;
    private modalitaGara: ModalitaGara = 'standard';
    private sopravvivenzaTimer         = SOPRAVVIVENZA_INTERVALLO;
    private ultimoARischio: string | null = null;
    private ostacoliAvvisoTimer        = 0;
    private ostacoliServer: StatoOstacolo[] = [];
    private colori: Record<string, string> = {};

    // Telecamera: segue l'auto del giocatore locale con smooth lerp
    private camX = TRAGUARDO.x;
    private camY = TRAGUARDO.y;
    private readonly ZOOM = 1.65;

    private trackCanvas: HTMLCanvasElement | null = null;
    private tasti = { su: false, giu: false, turbo: false, shockwave: false };
    private turboPremuto = false;
    private shockwavePremuto = false;
    private mouseSterzoAttivo = false;
    private animTime       = 0;
    private garaFinitaTimer = -1;
    private wrongWayTimer = 0;
    private classificaAnim: Record<string, StatoRigaClassifica> = {};
    private classificaAnimFase: 'qualifiche' | 'gara' | null = null;

    private votoSelezionato: ModalitaGara | null = null;
    private votoDaInviare: ModalitaGara | null = null;

    // goFlashTimer: dura ~0.9s dopo il GO! per mostrare il testo verde
    private goFlashTimer = 0;


    // --- Lifecycle e messaggi ------------------------------------------------

    /**
     * Costruisce il client legando input e id locale.
     * @param userInput - Gestore input/canvas.
     * @param myId - Id del giocatore locale.
     */
    constructor(userInput: UserInput, myId: string) {
        super(userInput, myId);
        this.registraTasti();
    }


    /**
     * Inizializza colori e cache del tracciato.
     * @param giocatori - Dizionario giocatori in lobby.
     * @returns Promise risolta quando il canvas e' pronto.
     */
    async init(giocatori: Record<string, Player>): Promise<void> {
        let i = 0;
        for (const id in giocatori) this.colori[id] = COLORI_AUTO[i++ % COLORI_AUTO.length];
        this.trackCanvas = this.costruisciCanvas();
    }

    /**
     * Riceve lo snapshot server e aggiorna lo stato locale.
     * @param msg - Messaggio di stato autoritativo.
     * @returns void
     */
    handleMessage(msg: MsgStato): void {
        if (msg.kind !== 'stato') return;

        // Rileva il momento in cui il semaforo scatta a 0 -> mostra "GO!"
        const countdownPrecedente = this.countdownPartenza;
        this.fase               = msg.fase;
        this.tempoQual          = msg.tempoQual;
        this.tempoVoto          = msg.tempoVoto;
        this.tempoRecap         = msg.tempoRecap;
        this.countdownPartenza  = msg.countdownPartenza;
        this.dnfTimer           = msg.dnfTimer;
        this.gridOrder          = msg.gridOrder;
        this.migliorAssoluto    = msg.migliorAssoluto;
        this.votiStandard       = msg.votiStandard;
        this.votiSopravvivenza  = msg.votiSopravvivenza;
        this.modalitaGara       = msg.modalitaGara;
        this.sopravvivenzaTimer = msg.sopravvivenzaTimer;
        this.ultimoARischio     = msg.ultimoARischio;
        this.ostacoliAvvisoTimer = msg.ostacoliAvvisoTimer;
        this.ostacoliServer     = msg.ostacoli;

        if (this.fase !== 'voto') this.votoDaInviare = null;

        if (countdownPrecedente > 0 && this.countdownPartenza <= 0 && this.fase === 'gara')
            this.goFlashTimer = 0.9;

        if (msg.garaFinita && this.garaFinitaTimer < 0)
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

    /**
     * Prepara gli input da inviare nel tick corrente.
     * @returns Lista di messaggi input/voto.
     */
    flushMessages(): (MsgInput | MsgVoto)[] {
        const input: MsgInput = {
            kind: 'input',
            ...this.tasti,
            mouseAngolo: this.calcolaAngoloMouse(),
        };
        this.tasti.turbo = false;
        this.tasti.shockwave = false;

        const messaggi: (MsgInput | MsgVoto)[] = [input];
        if (this.fase === 'voto' && this.votoDaInviare) {
            messaggi.push({ kind: 'voto', scelta: this.votoDaInviare });
            this.votoDaInviare = null;
        }
        return messaggi;
    }

    /**
     * Indica se il client ha terminato la sequenza di fine gara.
     * @returns true se il flow post-gara e' concluso.
     */
    isFinished(): boolean { return this.garaFinitaTimer === 0; }


    // --- Pipeline di rendering ----------------------------------------------

    /**
     * Disegna un frame completo (mondo + overlay).
     * @param ctx - Contesto canvas 2D.
     * @param dt - Delta time in secondi.
     * @returns void
     */
    draw(ctx: CanvasRenderingContext2D, dt: number): void {
        if (!this.statoServer) return;
        this.aggiornaTimerRender(dt);

        const { screenW: W, screenH: H } = this.userInput;
        const me = this.statoServer[this.myId];

        this.aggiornaStatoVisuale(me, dt);
        this.disegnaMondo(ctx, W, H);
        this.disegnaOverlay(ctx, me, W, H, dt);
    }

    /**
     * Aggiorna i timer di animazione lato client.
     * @param dt - Delta time in secondi.
     * @returns void
     */
    private aggiornaTimerRender(dt: number): void {
        this.animTime += dt;
        if (this.garaFinitaTimer > 0) this.garaFinitaTimer = Math.max(0, this.garaFinitaTimer - dt);
        if (this.goFlashTimer    > 0) this.goFlashTimer    = Math.max(0, this.goFlashTimer    - dt);
    }

    /**
     * Aggiorna contromano, interpolazione e camera.
     * @param me - Stato auto del giocatore locale.
     * @param dt - Delta time in secondi.
     * @returns void
     */
    private aggiornaStatoVisuale(me: StatoAuto | undefined, dt: number): void {
        if (me) this.aggiornaContromano(me, dt);
        else this.wrongWayTimer = 0;

        this.interpolaRenderAuto(dt);
        this.aggiornaCamera(me, dt);
    }

    /**
     * Aggiorna la camera con smoothing (lerp) verso il target.
     * @param me - Stato auto del giocatore locale.
     * @param dt - Delta time in secondi.
     * @returns void
     */
    private aggiornaCamera(me: StatoAuto | undefined, dt: number): void {
        if (this.fase === 'recap') {
            const cx = MONDO_W / 2, cy = MONDO_H / 2;
            this.camX += (cx - this.camX) * Math.min(1, dt * 3);
            this.camY += (cy - this.camY) * Math.min(1, dt * 3);
        } else if (me) {
            this.camX += (me.x - this.camX) * Math.min(1, dt * 9);
            this.camY += (me.y - this.camY) * Math.min(1, dt * 9);
        }
    }

    /**
     * Disegna pista, ostacoli e auto nel mondo di gioco.
     * @param ctx - Contesto canvas 2D.
     * @param W - Larghezza schermo in px.
     * @param H - Altezza schermo in px.
     * @returns void
     */
    private disegnaMondo(ctx: CanvasRenderingContext2D, W: number, H: number): void {
        ctx.fillStyle = '#3a7d44';
        ctx.fillRect(0, 0, W, H);

        ctx.save();
        // Trasformazione camera: schermo -> mondo (centra e applica zoom).
        ctx.translate(W / 2, H / 2);
        ctx.scale(this.ZOOM, this.ZOOM);
        ctx.translate(-this.camX, -this.camY);

        if (this.trackCanvas) ctx.drawImage(this.trackCanvas, 0, 0);
        this.disegnaSpeedPads(ctx);
        this.disegnaOstacoli(ctx);
        for (const id in this.renderAuto)          this.disegnaAuto(ctx, id, this.renderAuto[id]);

        ctx.restore();
    }

    /**
     * Disegna gli speed pad con animazione di scorrimento.
     * @param ctx - Contesto canvas 2D.
     * @returns void
     */
    private disegnaSpeedPads(ctx: CanvasRenderingContext2D): void {
        const stride = 24;
        const offset = (this.animTime * 140) % stride;

        for (const pad of SPEED_PADS) {
            ctx.save();
            ctx.translate(pad.x, pad.y);
            ctx.rotate(pad.angolo);

            ctx.fillStyle = 'rgba(255,215,0,0.22)';
            ctx.fillRect(-pad.w / 2, -pad.h / 2, pad.w, pad.h);
            ctx.strokeStyle = 'rgba(255,235,120,0.9)';
            ctx.lineWidth = 2;

            for (let x = -pad.w / 2 - stride + offset; x < pad.w / 2 + stride; x += stride) {
                ctx.beginPath();
                ctx.moveTo(x, -pad.h / 2 + 4);
                ctx.lineTo(x + 8, 0);
                ctx.lineTo(x, pad.h / 2 - 4);
                ctx.stroke();
            }

            ctx.restore();
        }
    }

    /**
     * Disegna gli ostacoli, con modalità avviso o attiva.
     * @param ctx - Contesto canvas 2D.
     * @returns void
     */
    private disegnaOstacoli(ctx: CanvasRenderingContext2D): void {
        if (this.ostacoliServer.length === 0) return;

        const inAvviso = this.ostacoliAvvisoTimer > 0;
        const pulse = 0.5 + 0.5 * Math.sin(this.animTime * 10);

        for (const ostacolo of this.ostacoliServer) {
            ctx.save();
            ctx.translate(ostacolo.x, ostacolo.y);
            ctx.rotate(ostacolo.angolo);

            if (inAvviso) {
                ctx.strokeStyle = `rgba(255,210,0,${0.35 + pulse * 0.45})`;
                ctx.lineWidth = 3;
                ctx.setLineDash([8, 6]);
                ctx.beginPath();
                ctx.arc(0, 0, ostacolo.r + 8 + pulse * 6, 0, Math.PI * 2);
                ctx.stroke();
                ctx.setLineDash([]);
                this.disegnaBanana(ctx, ostacolo.r, 0.35 + pulse * 0.25);
            } else {
                this.disegnaBanana(ctx, ostacolo.r, 1);
            }

            ctx.restore();
        }
    }

    /**
     * Disegna una "banana" (ostacolo) scalata e trasparente.
     * @param ctx - Contesto canvas 2D.
     * @param r - Raggio base.
     * @param alpha - Trasparenza complessiva.
     * @returns void
     */
    private disegnaBanana(ctx: CanvasRenderingContext2D, r: number, alpha: number): void {
        const s = r / OSTACOLO_RAGGIO;

        ctx.save();
        ctx.scale(s, s);
        ctx.lineCap = 'round';
        ctx.lineJoin = 'round';
        ctx.shadowColor = `rgba(0,0,0,${0.35 * alpha})`;
        ctx.shadowBlur = 5;
        ctx.shadowOffsetY = 3;

        ctx.fillStyle = `rgba(255,210,35,${alpha})`;
        ctx.strokeStyle = `rgba(120,75,14,${alpha})`;
        ctx.lineWidth = 2.2;
        ctx.beginPath();
        ctx.moveTo(-19, 5);
        ctx.bezierCurveTo(-11, -18, 12, -20, 21, 2);
        ctx.bezierCurveTo(10, -7, -4, -4, -15, 12);
        ctx.bezierCurveTo(-17, 10, -18, 8, -19, 5);
        ctx.closePath();
        ctx.fill();
        ctx.stroke();

        // Faccia interna piu' chiara: rende la sagoma leggibile come banana, non come arco generico.
        ctx.shadowBlur = 0;
        ctx.shadowOffsetY = 0;
        ctx.strokeStyle = `rgba(255,244,140,${0.85 * alpha})`;
        ctx.lineWidth = 2.4;
        ctx.beginPath();
        ctx.moveTo(-11, 4);
        ctx.bezierCurveTo(-3, -9, 10, -10, 16, -1);
        ctx.stroke();

        ctx.strokeStyle = `rgba(222,166,26,${0.85 * alpha})`;
        ctx.lineWidth = 1.2;
        ctx.beginPath();
        ctx.moveTo(-14, 8);
        ctx.bezierCurveTo(-5, -1, 6, -3, 14, 1);
        ctx.stroke();

        ctx.fillStyle = `rgba(80,48,14,${alpha})`;
        ctx.beginPath();
        ctx.ellipse(-19, 5, 3, 4, -0.7, 0, Math.PI * 2);
        ctx.fill();
        ctx.beginPath();
        ctx.ellipse(21, 2, 2.4, 3.2, -0.9, 0, Math.PI * 2);
        ctx.fill();

        ctx.restore();
    }

    /**
     * Disegna HUD e schermate di overlay in base alla fase.
     * @param ctx - Contesto canvas 2D.
     * @param me - Stato auto del giocatore locale.
     * @param W - Larghezza schermo in px.
     * @param H - Altezza schermo in px.
     * @param dt - Delta time in secondi.
     * @returns void
     */
    private disegnaOverlay(
        ctx: CanvasRenderingContext2D,
        me: StatoAuto | undefined,
        W: number,
        H: number,
        dt: number,
    ): void {
        if (this.fase === 'voto') {
            this.disegnaVoto(ctx, W, H);
        } else if (this.fase === 'recap') {
            this.disegnaRecap(ctx, W, H);
        } else {
            this.disegnaHUD(ctx, me, W, H);
            this.disegnaSemaforo(ctx, W);
            this.disegnaClassifica(ctx, W, dt);
            if (this.ostacoliAvvisoTimer > 0) this.disegnaAvvisoOstacoli(ctx, W);
            if (this.devoMostrareAvvisoEliminazione()) this.disegnaAvvisoEliminazione(ctx, W, H);
            if (this.garaFinitaTimer < 0) this.disegnaAvvisoContromano(ctx, W, H);
            if (this.garaFinitaTimer >= 0) this.disegnaFinale(ctx, me, W, H);
        }
    }


    // --- Interpolazione e classifica animata --------------------------------

    /**
     * Avvicina renderAuto verso statoServer ogni frame.
     * Posizione e angolo vengono interpolati (lerp) per nascondere la latenza di rete.
     * Tutti gli altri campi sono autorevoli e vengono copiati direttamente.
     * @param dt - Delta time in secondi.
     * @returns void
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

            // Lerp angolo sul percorso piu' breve (evita giri da 360 gradi)
            let deltaAngolo = t.angolo - c.angolo;
            while (deltaAngolo >  Math.PI) deltaAngolo -= Math.PI * 2;
            while (deltaAngolo < -Math.PI) deltaAngolo += Math.PI * 2;
            c.angolo += deltaAngolo * alpha;

            // Campi gameplay: sempre autorevoli
            c.vx = t.vx; c.vy = t.vy;
            c.xPrecedente = t.xPrecedente; c.yPrecedente = t.yPrecedente;
            c.giri = t.giri; c.cp = t.cp; c.cpQual = t.cpQual;
            c.turboTimer = t.turboTimer; c.turboCooldown = t.turboCooldown;
            c.shockwaveCooldown = t.shockwaveCooldown; c.shockwaveTimer = t.shockwaveTimer;
            c.spinTimer = t.spinTimer;
            c.inScia = t.inScia; c.tempoScia = t.tempoScia; c.slingshotTimer = t.slingshotTimer;
            c.speedPadCooldown = t.speedPadCooldown; c.giroInvalido = t.giroInvalido;
            c.sulTraguardo = t.sulTraguardo; c.giroLanciato = t.giroLanciato;
            c.nome = t.nome; c.character = t.character;
            c.finito = t.finito; c.dnf = t.dnf; c.posizione = t.posizione;
            c.migliorGiro = t.migliorGiro; c.tempoGiroAttuale = t.tempoGiroAttuale;

            this.renderAuto[id] = c;
        }
    }

    /**
     * Anima la classifica facendo scorrere i riquadri verso la nuova posizione.
     * Quando cambia l'ordine, il box si muove invece di saltare di colpo.
     * @param voci - Voci classifica ordinate.
     * @param dt - Delta time in secondi.
     * @returns Lista di righe animate con metadati visivi.
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


    // --- Input locale, camera e avvisi guida --------------------------------

    /**
     * Calcola l'angolo assoluto (rad) tra auto locale e mouse.
     * @returns Angolo in radianti o NaN se non attivo.
     */
    private calcolaAngoloMouse(): number {
        const me = this.statoServer?.[this.myId];
        if (!me || !this.mouseSterzoAttivo || this.userInput.screenW <= 0 || this.userInput.screenH <= 0)
            return Number.NaN;

        const mouseWorldX = this.camX + (this.userInput.mouseX - this.userInput.screenW / 2) / this.ZOOM;
        const mouseWorldY = this.camY + (this.userInput.mouseY - this.userInput.screenH / 2) / this.ZOOM;
        const dx = mouseWorldX - me.x;
        const dy = mouseWorldY - me.y;

        if (Math.hypot(dx, dy) < 12) return me.angolo;
        // atan2 restituisce radianti, coerenti con tutta la fisica/rotazione.
        return Math.atan2(dy, dx);
    }

    /**
     * Calcola il delta di progresso lungo il giro, gestendo il wrap-around.
     * @param x - x corrente.
     * @param y - y corrente.
     * @param px - x precedente.
     * @param py - y precedente.
     * @returns Delta progresso in px (puo' essere negativo).
     */
    private deltaProgressoLungoGiro(x: number, y: number, px: number, py: number): number {
        const now = proiettaSuTracciato(x, y);
        const prev = proiettaSuTracciato(px, py);
        let delta = now - prev;
        // Wrap-around: evita salti quando si supera 0 o la lunghezza totale.
        const half = LUNGHEZZA_TRACCIATO / 2;
        if (delta > half) delta -= LUNGHEZZA_TRACCIATO;
        else if (delta < -half) delta += LUNGHEZZA_TRACCIATO;
        return delta;
    }

    /**
     * Verifica se l'auto procede contromano rispetto al progresso pista.
     * @param me - Stato auto locale.
     * @returns true se il delta progresso e' negativo oltre soglia.
     */
    private isContromano(me: StatoAuto): boolean {
        const dx = me.x - me.xPrecedente;
        const dy = me.y - me.yPrecedente;
        const dist = Math.hypot(dx, dy);
        if (dist < 3) return false;
        const delta = this.deltaProgressoLungoGiro(me.x, me.y, me.xPrecedente, me.yPrecedente);
        return delta < -4;
    }

    /**
     * Aggiorna il timer di avviso contromano con easing.
     * @param me - Stato auto locale.
     * @param dt - Delta time in secondi.
     * @returns void
     */
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

    /**
     * Disegna l'avviso contromano a schermo.
     * @param ctx - Contesto canvas 2D.
     * @param W - Larghezza schermo in px.
     * @param H - Altezza schermo in px.
     * @returns void
     */
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

    /**
     * Disegna l'avviso di ostacoli imminenti.
     * @param ctx - Contesto canvas 2D.
     * @param W - Larghezza schermo in px.
     * @returns void
     */
    private disegnaAvvisoOstacoli(ctx: CanvasRenderingContext2D, W: number): void {
        const pulse = 0.55 + 0.45 * Math.sin(this.animTime * 10);
        const alpha = Math.min(1, pulse + this.ostacoliAvvisoTimer / OSTACOLI_AVVISO);
        ctx.save();
        ctx.fillStyle = `rgba(0,0,0,${0.6 * alpha})`;
        ctx.fillRect(W / 2 - 190, 54, 380, 36);
        ctx.textAlign = 'center';
        ctx.font = 'bold 18px Arial';
        ctx.fillStyle = `rgba(255,210,70,${alpha})`;
        ctx.fillText('OSTACOLI IN ARRIVO!', W / 2, 78);
        ctx.restore();
    }

    /**
     * Decide se mostrare l'avviso eliminazione in sopravvivenza.
     * @returns true se il giocatore e' ultimo e a rischio.
     */
    private devoMostrareAvvisoEliminazione(): boolean {
        return this.modalitaGara === 'sopravvivenza'
            && this.fase === 'gara'
            && this.countdownPartenza <= 0
            && this.garaFinitaTimer < 0
            && this.ultimoARischio === this.myId;
    }

    /**
     * Disegna l'avviso eliminazione (sopravvivenza).
     * @param ctx - Contesto canvas 2D.
     * @param W - Larghezza schermo in px.
     * @param H - Altezza schermo in px.
     * @returns void
     */
    private disegnaAvvisoEliminazione(ctx: CanvasRenderingContext2D, W: number, H: number): void {
        const sec = Math.max(0, Math.ceil(this.sopravvivenzaTimer));
        const pulse = 0.55 + 0.45 * Math.sin(this.animTime * 12);
        const alpha = sec <= 5 ? pulse : 0.72;
        const boxW = 360;
        const boxH = 50;
        const x = W / 2 - boxW / 2;
        const y = H - 174;

        ctx.save();
        ctx.fillStyle = `rgba(0,0,0,${0.72 * alpha})`;
        ctx.fillRect(x, y, boxW, boxH);
        ctx.strokeStyle = `rgba(255,80,80,${alpha})`;
        ctx.lineWidth = 2;
        ctx.strokeRect(x, y, boxW, boxH);
        ctx.textAlign = 'center';
        ctx.font = 'bold 18px Arial';
        ctx.fillStyle = `rgba(255,95,80,${alpha})`;
        ctx.fillText('SEI ULTIMO: RISCHIO ELIMINAZIONE', W / 2, y + 22);
        ctx.font = 'bold 15px Arial';
        ctx.fillStyle = '#fff';
        ctx.fillText(`Prossimo taglio tra ${sec}s`, W / 2, y + 40);
        ctx.restore();
    }

    /**
     * Disegna la schermata di voto modalita'.
     * @param ctx - Contesto canvas 2D.
     * @param W - Larghezza schermo in px.
     * @param H - Altezza schermo in px.
     * @returns void
     */
    private disegnaVoto(ctx: CanvasRenderingContext2D, W: number, H: number): void {
        ctx.save();
        ctx.fillStyle = 'rgba(0,0,0,0.72)';
        ctx.fillRect(0, 0, W, H);

        ctx.textAlign = 'center';
        ctx.font = 'bold 40px Arial';
        ctx.fillStyle = '#f1c40f';
        ctx.fillText('VOTA LA MODALITA', W / 2, 80);
        ctx.font = 'bold 18px Arial';
        ctx.fillStyle = '#fff';
        ctx.fillText(`Tempo rimasto: ${Math.max(0, Math.ceil(this.tempoVoto))}s`, W / 2, 115);

        const boxW = Math.min(320, Math.max(240, W * 0.38));
        const boxH = 116;
        const gap = 32;
        const stack = W < 720;
        const y = stack ? H / 2 - boxH - 12 : H / 2 - boxH / 2;
        const startX = stack ? W / 2 - boxW / 2 : W / 2 - boxW - gap / 2;

        this.disegnaBoxVoto(
            ctx, startX, y, boxW, boxH,
            '1 - GARA STANDARD',
            'Tre giri, vince chi chiude davanti.',
            this.votiStandard,
            this.votoSelezionato === 'standard',
        );
        this.disegnaBoxVoto(
            ctx,
            stack ? startX : startX + boxW + gap,
            stack ? y + boxH + 18 : y,
            boxW,
            boxH,
            '2 - SOPRAVVIVENZA',
            'Nessun giro: ogni 15s fuori l ultimo.',
            this.votiSopravvivenza,
            this.votoSelezionato === 'sopravvivenza',
        );

        ctx.font = '12px Arial';
        ctx.fillStyle = 'rgba(255,255,255,0.55)';
        ctx.fillText('Premi 1 o 2 per votare', W / 2, stack ? y + boxH * 2 + 58 : y + boxH + 42);
        ctx.restore();
    }

    /**
     * Disegna un box voto con titolo, descrizione e conteggio.
     * @param ctx - Contesto canvas 2D.
     * @param x - Coordinata x box.
     * @param y - Coordinata y box.
     * @param w - Larghezza box.
     * @param h - Altezza box.
     * @param label - Titolo box.
     * @param descrizione - Testo descrittivo.
     * @param count - Numero voti.
     * @param selected - true se selezionato dal giocatore.
     * @returns void
     */
    private disegnaBoxVoto(
        ctx: CanvasRenderingContext2D,
        x: number,
        y: number,
        w: number,
        h: number,
        label: string,
        descrizione: string,
        count: number,
        selected: boolean,
    ): void {
        ctx.fillStyle = selected ? 'rgba(52,152,219,0.3)' : 'rgba(255,255,255,0.08)';
        ctx.fillRect(x, y, w, h);
        ctx.strokeStyle = selected ? '#7ecfff' : 'rgba(255,255,255,0.2)';
        ctx.lineWidth = 2;
        ctx.strokeRect(x, y, w, h);

        ctx.textAlign = 'center';
        ctx.font = 'bold 16px Arial';
        ctx.fillStyle = '#fff';
        ctx.fillText(label, x + w / 2, y + 30);
        ctx.font = '13px Arial';
        ctx.fillStyle = 'rgba(255,255,255,0.72)';
        ctx.fillText(descrizione, x + w / 2, y + 58);
        ctx.font = 'bold 26px Arial';
        ctx.fillStyle = selected ? '#7ecfff' : '#f1c40f';
        ctx.fillText(String(count), x + w / 2, y + 92);
    }


    // --- Rendering auto, scia e shockwave -----------------------------------

    /**
     * Disegna una singola auto con effetti (turbo, scia, spin).
     * @param ctx - Contesto canvas 2D.
     * @param id - Id giocatore.
     * @param auto - Stato auto interpolato.
     * @returns void
     */
    private disegnaAuto(ctx: CanvasRenderingContext2D, id: string, auto: StatoAuto): void {
        const colore = this.colori[id] ?? '#fff';
        const sonoIo = id === this.myId;
        // hw = half-width, hh = half-height (nel sistema ruotato: hh negativo = muso)
        const hw = 5, hh = 10;

        if (auto.shockwaveTimer > 0) this.disegnaShockwave(ctx, auto);
        if (auto.slingshotTimer > 0) this.disegnaVentoSlingshot(ctx, auto, sonoIo);
        if (auto.inScia || auto.speedPadCooldown > 0)
            this.disegnaSciaAuto(ctx, auto, sonoIo || auto.speedPadCooldown > 0);

        ctx.save();

        // Ghosting in qualifica: le auto avversarie sono semi-trasparenti
        if (this.fase === 'qualifiche' && !sonoIo) ctx.globalAlpha = 0.45;

        ctx.translate(auto.x, auto.y);
        // +PI/2 per allineare il muso dell'auto all'asse Y del disegno.
        ctx.rotate(auto.angolo + Math.PI / 2);

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

    /**
     * Disegna la scia dietro l'auto.
     * @param ctx - Contesto canvas 2D.
     * @param auto - Stato auto.
     * @param intensa - true per scia potenziata.
     * @returns void
     */
    private disegnaSciaAuto(ctx: CanvasRenderingContext2D, auto: StatoAuto, intensa: boolean): void {
        ctx.save();
        ctx.translate(auto.x, auto.y);
        ctx.rotate(auto.angolo);

        const pulse = 0.5 + 0.5 * Math.sin(this.animTime * 18);
        const lunghezza = intensa ? 64 : 48;
        const alpha = intensa ? 0.22 + pulse * 0.08 : 0.14 + pulse * 0.05;
        const grad = ctx.createLinearGradient(-lunghezza, 0, -8, 0);
        grad.addColorStop(0, 'rgba(80,190,255,0)');
        grad.addColorStop(0.45, `rgba(80,190,255,${alpha})`);
        grad.addColorStop(1, 'rgba(220,255,255,0.06)');

        ctx.fillStyle = grad;
        ctx.beginPath();
        ctx.moveTo(-10, -7);
        ctx.lineTo(-lunghezza, -18 - pulse * 3);
        ctx.lineTo(-lunghezza * 0.82, 0);
        ctx.lineTo(-lunghezza, 18 + pulse * 3);
        ctx.lineTo(-10, 7);
        ctx.closePath();
        ctx.fill();

        ctx.strokeStyle = `rgba(180,235,255,${alpha * 0.8})`;
        ctx.lineWidth = 1;
        for (let i = 0; i < 3; i++) {
            const offset = (i - 1) * 6;
            ctx.beginPath();
            ctx.moveTo(-14, offset);
            ctx.lineTo(-lunghezza + i * 7, offset * 2.1);
            ctx.stroke();
        }

        ctx.restore();
    }

    /**
     * Disegna l'onda d'urto attorno all'auto.
     * @param ctx - Contesto canvas 2D.
     * @param auto - Stato auto.
     * @returns void
     */
    private disegnaShockwave(ctx: CanvasRenderingContext2D, auto: StatoAuto): void {
        const progress = 1 - auto.shockwaveTimer / SHOCKWAVE_DURATA;
        const r = SHOCKWAVE_RAGGIO * Math.min(1, Math.max(0, progress));
        const alpha = 0.28 * (1 - Math.min(1, progress));

        ctx.save();
        ctx.strokeStyle = `rgba(120,200,255,${alpha})`;
        ctx.lineWidth = 3;
        ctx.beginPath();
        ctx.arc(auto.x, auto.y, r, 0, Math.PI * 2);
        ctx.stroke();
        ctx.restore();
    }

    /**
     * Disegna il vento visivo dello slingshot.
     * @param ctx - Contesto canvas 2D.
     * @param auto - Stato auto.
     * @param intensa - true per effetto piu' evidente.
     * @returns void
     */
    private disegnaVentoSlingshot(ctx: CanvasRenderingContext2D, auto: StatoAuto, intensa: boolean): void {
        ctx.save();
        ctx.translate(auto.x, auto.y);
        ctx.rotate(auto.angolo);

        const pulse = 0.5 + 0.5 * Math.sin(this.animTime * 22);
        const baseAlpha = intensa ? 0.55 : 0.38;
        const life = Math.min(1, auto.slingshotTimer / SLINGSHOT_DURATA);
        ctx.strokeStyle = `rgba(255,255,255,${baseAlpha * (0.6 + pulse * 0.4) * life})`;
        ctx.lineWidth = 1.4;

        for (let i = 0; i < 4; i++) {
            const offset = (i - 1.5) * 4;
            const len = 18 + i * 4 + pulse * 6;
            ctx.beginPath();
            ctx.moveTo(-10, offset);
            ctx.lineTo(-10 - len, offset + (i % 2 === 0 ? 2 : -2));
            ctx.stroke();
        }

        ctx.restore();
    }

    // --- HUD, minimappa e controlli visuali ---------------------------------

    /**
     * Disegna HUD (tempi, giri, power-up, velocita', minimappa).
     * @param ctx - Contesto canvas 2D.
     * @param me - Stato auto locale.
     * @param W - Larghezza schermo in px.
     * @param H - Altezza schermo in px.
     * @returns void
     */
    private disegnaHUD(ctx: CanvasRenderingContext2D, me: StatoAuto | undefined, W: number, H: number): void {
        if (!me) return;
        const p = 14;

        const pannelloH = this.fase === 'qualifiche'
            ? 195
            : this.modalitaGara === 'sopravvivenza' ? 165 : 130;
        ctx.fillStyle = 'rgba(0,0,0,0.58)';
        ctx.fillRect(p - 3, p - 3, 242, pannelloH);

        if (this.fase === 'qualifiche') {
            // Timer qualifiche
            ctx.font = 'bold 14px Arial'; ctx.textAlign = 'left'; ctx.fillStyle = '#f1c40f';
            ctx.fillText('QUALIFICHE', p, p + 16);

            const min = Math.floor(this.tempoQual / 60);
            const sec = Math.ceil(this.tempoQual % 60);
            ctx.font = 'bold 36px Arial';
            ctx.fillStyle = this.tempoQual < 30 ? '#e74c3c' : '#fff';
            ctx.fillText(`${min}:${String(sec).padStart(2, '0')}`, p, p + 56);

            this.disegnaFeedbackGiroInvalido(ctx, me, p, p + 62);

            ctx.fillStyle = 'rgba(255,255,255,0.12)';
            ctx.fillRect(p, p + 78, 225, 1);

            // Tre righe tempi
            this.disegnaRigaTempo(ctx, p, p + 96,  'Giro corrente', formatTempo(me.tempoGiroAttuale), '#fff');
            this.disegnaRigaTempo(ctx, p, p + 116, 'Mio miglior giro', formatTempo(me.migliorGiro), '#7fff7f');
            this.disegnaRigaTempo(ctx, p, p + 136, 'Miglior assoluto', formatTempo(this.migliorAssoluto), '#f1c40f');

        } else {
            if (this.modalitaGara === 'sopravvivenza') {
                this.disegnaHudSopravvivenza(ctx, me, p);
            } else {
                // Gara standard: contatore giri
                ctx.font = 'bold 26px Arial'; ctx.textAlign = 'left'; ctx.fillStyle = '#fff';
                ctx.fillText(`Giro ${Math.min(me.giri + 1, GIRI_GARA)} / ${GIRI_GARA}`, p, p + 30);
            }

            // Timer DNF in cima allo schermo
            if (this.modalitaGara === 'standard' && this.dnfTimer >= 0 && this.countdownPartenza <= 0) {
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
                const sciaY = this.modalitaGara === 'sopravvivenza' ? p + 82 : p + 42;
                ctx.fillRect(p - 3, sciaY, 130, 22);
                ctx.font = 'bold 13px Arial'; ctx.textAlign = 'left'; ctx.fillStyle = '#7ecfff';
                ctx.fillText('SCIA ATTIVA', p + 4, sciaY + 15);
            }
        }

        // Barre turbo e shockwave
        const turboY = this.fase === 'qualifiche'
            ? p + 152
            : this.modalitaGara === 'sopravvivenza' ? p + 112 : p + 52;
        const turboPct = me.turboTimer > 0
            ? me.turboTimer / TURBO_DURATA
            : Math.max(0, 1 - me.turboCooldown / TURBO_RICARICA);
        this.disegnaBarra(ctx, p, turboY, 185, 12, turboPct,
            me.turboTimer > 0 ? '#ff6a00' : turboPct >= 1 ? '#00aaff' : '#004488', 'TURBO [SPAZIO]');

        const shockPct = Math.max(0, 1 - me.shockwaveCooldown / SHOCKWAVE_RICARICA);
        this.disegnaBarra(ctx, p, turboY + 28, 185, 12, shockPct, '#222', 'SHOCKWAVE [SHIFT]', true);

        // Velocita' (in basso a destra)
        const vel = Math.round(Math.hypot(me.vx, me.vy));
        ctx.fillStyle = 'rgba(0,0,0,0.55)';
        ctx.fillRect(W - 118, H - 44, 110, 36);
        ctx.font = 'bold 22px Arial'; ctx.textAlign = 'right'; ctx.fillStyle = '#fff';
        ctx.fillText(`${vel} m/s`, W - 10, H - 14);

        this.disegnaMiniMappa(ctx, me, W, H);
    }

    /**
     * Disegna HUD specifico per la modalita' sopravvivenza.
     * @param ctx - Contesto canvas 2D.
     * @param me - Stato auto locale.
     * @param p - Padding base.
     * @returns void
     */
    private disegnaHudSopravvivenza(ctx: CanvasRenderingContext2D, me: StatoAuto, p: number): void {
        const sec = Math.max(0, Math.ceil(this.sopravvivenzaTimer));
        const attive = this.contaAutoAttiveClient();
        const rischio = this.ultimoARischio === this.myId && !me.finito;

        ctx.font = 'bold 18px Arial';
        ctx.textAlign = 'left';
        ctx.fillStyle = '#ffcf5a';
        ctx.fillText('SOPRAVVIVENZA', p, p + 18);

        ctx.font = 'bold 34px Arial';
        ctx.fillStyle = sec <= 5 ? '#ff6b6b' : '#fff';
        ctx.fillText(`${sec}s`, p, p + 56);

        ctx.font = '13px Arial';
        ctx.fillStyle = 'rgba(255,255,255,0.72)';
        ctx.fillText('alla prossima eliminazione', p + 68, p + 43);
        ctx.fillText(`Auto rimaste: ${attive}`, p + 68, p + 61);

        if (rischio) {
            ctx.fillStyle = 'rgba(255,70,70,0.20)';
            ctx.fillRect(p - 3, p + 68, 190, 22);
            ctx.font = 'bold 13px Arial';
            ctx.fillStyle = '#ff8c7a';
            ctx.fillText('SEI A RISCHIO', p + 4, p + 83);
        }
    }

    /**
     * Conta le auto ancora attive secondo lo stato client.
     * @returns Numero auto non finite.
     */
    private contaAutoAttiveClient(): number {
        if (!this.statoServer) return 0;
        return Object.values(this.statoServer).filter(a => !a.finito).length;
    }

    /**
     * Disegna un feedback di giro invalido in qualifica.
     * @param ctx - Contesto canvas 2D.
     * @param me - Stato auto locale.
     * @param x - Coordinata x box.
     * @param y - Coordinata y box.
     * @returns void
     */
    private disegnaFeedbackGiroInvalido(
        ctx: CanvasRenderingContext2D,
        me: StatoAuto,
        x: number,
        y: number,
    ): void {
        if (!me.giroInvalido) return;

        const pulse = 0.65 + 0.35 * Math.sin(this.animTime * 10);
        ctx.save();
        ctx.fillStyle = `rgba(231,76,60,${0.22 + pulse * 0.12})`;
        ctx.fillRect(x, y, 220, 20);
        ctx.strokeStyle = `rgba(255,145,130,${0.5 + pulse * 0.35})`;
        ctx.strokeRect(x + 0.5, y + 0.5, 219, 19);
        ctx.font = 'bold 11px Arial';
        ctx.textAlign = 'left';
        ctx.fillStyle = '#ffd6d0';
        ctx.fillText('GIRO INVALIDO - fuori pista', x + 8, y + 14);
        ctx.restore();
    }

    /**
     * Disegna minimappa con tracciato e posizione auto locale.
     * @param ctx - Contesto canvas 2D.
     * @param me - Stato auto locale.
     * @param W - Larghezza schermo in px.
     * @param H - Altezza schermo in px.
     * @returns void
     */
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
        ctx.rotate(me.angolo);
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

    /**
     * Riga etichetta + valore allineati a sinistra/destra nel pannello HUD.
     * @param ctx - Contesto canvas 2D.
     * @param x - Coordinata x base.
     * @param y - Coordinata y base.
     * @param etichetta - Testo etichetta.
     * @param valore - Testo valore.
     * @param coloreValore - Colore valore.
     * @returns void
     */
    private disegnaRigaTempo(ctx: CanvasRenderingContext2D,
        x: number, y: number, etichetta: string, valore: string, coloreValore: string): void {
        ctx.font = '11px Arial'; ctx.textAlign = 'left'; ctx.fillStyle = '#aaa';
        ctx.fillText(etichetta, x, y);
        ctx.font = 'bold 13px Arial'; ctx.textAlign = 'right'; ctx.fillStyle = coloreValore;
        ctx.fillText(valore, x + 232, y);
    }

    /**
     * Disegna una barra di progresso con etichetta.
     * @param ctx - Contesto canvas 2D.
     * @param x - Coordinata x barra.
     * @param y - Coordinata y barra.
     * @param w - Larghezza barra.
     * @param h - Altezza barra.
     * @param pct - Percentuale [0..1].
     * @param colore - Colore base.
     * @param etichetta - Testo etichetta.
     * @param iridescente - true per gradient dinamico.
     * @returns void
     */
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
     * Disegna 4 luci rosse che si accendono una per secondo,
     * poi tutte si spengono e compare "GO!" in verde.
     *
     * La logica di scaglionamento usa DURATA_PARTENZA=4 secondi:
     *   - elapsed 0->1s: 1 luce accesa
     *   - elapsed 1->2s: 2 luci accese
     *   - elapsed 2->3s: 3 luci accese
     *   - elapsed 3->4s: 4 luci accese
     *   - countdown = 0: tutte spente + "GO!" per goFlashTimer secondi
     * @param ctx - Contesto canvas 2D.
     * @param W - Larghezza schermo in px.
     * @returns void
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


    // --- Classifica, recap e finale -----------------------------------------

    /**
     * Disegna la classifica laterale con animazione.
     * @param ctx - Contesto canvas 2D.
     * @param W - Larghezza schermo in px.
     * @param dt - Delta time in secondi.
     * @returns void
     */
    private disegnaClassifica(ctx: CanvasRenderingContext2D, W: number, dt: number): void {
        if (!this.statoServer) return;

        const voci = this.vociClassifica();
        const layout = { lbW: 228, rowH: 24, pad: 8, lbX: W - 228 - 10 };
        this.disegnaSfondoClassifica(ctx, layout, voci.length);

        const tempoLeader = calcolaMigliorAssoluto(this.statoServer);
        for (const riga of this.aggiornaClassificaAnimata(voci, dt)) {
            this.disegnaRigaClassifica(ctx, riga, layout, tempoLeader);
        }
    }

    /**
     * Produce l'elenco voci classifica ordinato per fase e modalita'.
     * @returns Array di coppie [id, auto].
     */
    private vociClassifica(): [string, StatoAuto][] {
        if (!this.statoServer) return [];
        const voci = Object.entries(this.statoServer);

        if (this.fase === 'qualifiche') {
            return voci.sort((a, b) => confrontaQualifica(a[1], b[1]));
        }

        if (this.modalitaGara === 'sopravvivenza') {
            const inGara = voci
                .filter(([, auto]) => !auto.finito)
                .sort((a, b) => confrontaAutoInGara(a[1], b[1]));
            const eliminati = voci
                .filter(([, auto]) => auto.finito)
                .sort((a, b) => a[1].posizione - b[1].posizione);
            return [...inGara, ...eliminati];
        }

        // In gara: prima gli arrivati, poi chi e' ancora in pista ordinato per progresso.
        const finiti = voci
            .filter(([, auto]) => auto.finito)
            .sort((a, b) => {
                if (a[1].dnf !== b[1].dnf) return a[1].dnf ? 1 : -1;
                return a[1].posizione - b[1].posizione;
            });
        const inGara = voci
            .filter(([, auto]) => !auto.finito)
            .sort((a, b) => confrontaAutoInGara(a[1], b[1]));

        return [...finiti, ...inGara];
    }

    /**
     * Disegna il pannello di sfondo della classifica.
     * @param ctx - Contesto canvas 2D.
     * @param layout - Layout classifica.
     * @param numeroRighe - Numero righe visibili.
     * @returns void
     */
    private disegnaSfondoClassifica(
        ctx: CanvasRenderingContext2D,
        layout: LayoutClassifica,
        numeroRighe: number,
    ): void {
        const { lbX, lbW, rowH, pad } = layout;
        ctx.fillStyle = 'rgba(0,0,0,0.65)';
        ctx.fillRect(lbX, 10, lbW, rowH * (numeroRighe + 1) + pad);
        ctx.font = 'bold 12px Arial';
        ctx.textAlign = 'left';
        ctx.fillStyle = '#f1c40f';
        const titolo = this.fase === 'qualifiche'
            ? 'TEMPI QUALIFICHE'
            : this.modalitaGara === 'sopravvivenza' ? 'SOPRAVVIVENZA' : 'CLASSIFICA GARA';
        ctx.fillText(titolo, lbX + pad, 26);
    }

    /**
     * Disegna una riga classifica con colori, delta e flash.
     * @param ctx - Contesto canvas 2D.
     * @param riga - Riga animata.
     * @param layout - Layout classifica.
     * @param tempoLeader - Miglior tempo assoluto (qualifiche).
     * @returns void
     */
    private disegnaRigaClassifica(
        ctx: CanvasRenderingContext2D,
        riga: RigaClassificaAnimata,
        layout: LayoutClassifica,
        tempoLeader: number,
    ): void {
        const { lbX, lbW, rowH, pad } = layout;
        const { id, auto, index, y, delta, flash, improved } = riga;
        const sonoIo = id === this.myId;
        const migliorato = this.fase === 'qualifiche' && improved;
        const accent = this.coloreAccentoClassifica(delta, migliorato);
        const rowY = y - 11;

        ctx.fillStyle = sonoIo
            ? 'rgba(52,152,219,0.28)'
            : index % 2 === 0 ? 'rgba(255,255,255,0.05)' : 'rgba(0,0,0,0.1)';
        ctx.fillRect(lbX, rowY, lbW, rowH - 2);

        this.disegnaFlashClassifica(ctx, lbX, rowY, lbW, rowH, delta, flash);

        ctx.fillStyle = this.colori[id] ?? '#fff';
        ctx.fillRect(lbX + pad, rowY, 9, 12);

        ctx.font = sonoIo ? 'bold 11px Arial' : '11px Arial';
        ctx.fillStyle = sonoIo ? '#ffff88' : '#fff';
        ctx.textAlign = 'left';
        ctx.fillText((index + 1) + '. ' + auto.nome.substring(0, 9), lbX + pad + 13, y);

        this.disegnaValoreClassifica(ctx, auto, lbX + lbW - pad, y, tempoLeader, accent, migliorato);
        this.disegnaDeltaClassifica(ctx, lbX + lbW - 44, y, delta, accent, migliorato);
    }

    /**
     * Calcola il colore accento per una riga classifica.
     * @param delta - Delta posizione.
     * @param migliorato - true se ha migliorato il tempo.
     * @returns Colore CSS.
     */
    private coloreAccentoClassifica(delta: number, migliorato: boolean): string {
        if (this.fase === 'qualifiche') return migliorato ? '#7fff7f' : '#f1c40f';
        return delta > 0 ? '#7fff7f' : delta < 0 ? '#ff9b9b' : '#f1c40f';
    }

    /**
     * Disegna flash di variazione posizione o miglioramento.
     * @param ctx - Contesto canvas 2D.
     * @param x - Coordinata x riga.
     * @param y - Coordinata y riga.
     * @param w - Larghezza riga.
     * @param rowH - Altezza riga.
     * @param delta - Delta posizione.
     * @param flash - Intensita' flash [0..1].
     * @returns void
     */
    private disegnaFlashClassifica(
        ctx: CanvasRenderingContext2D,
        x: number,
        y: number,
        w: number,
        rowH: number,
        delta: number,
        flash: number,
    ): void {
        if (flash > 0) {
            ctx.fillStyle = this.fase === 'qualifiche'
                ? 'rgba(127,255,127,' + (0.25 * flash) + ')'
                : delta > 0
                    ? 'rgba(127,255,127,' + (0.22 * flash) + ')'
                    : 'rgba(255,107,107,' + (0.18 * flash) + ')';
            ctx.fillRect(x, y, w, rowH - 2);
        }

        if (this.fase === 'qualifiche' && delta !== 0) {
            ctx.fillStyle = delta > 0 ? 'rgba(127,255,127,0.12)' : 'rgba(255,107,107,0.12)';
            ctx.fillRect(x, y, w, rowH - 2);
        }
    }

    /**
     * Disegna il valore principale di una riga classifica.
     * @param ctx - Contesto canvas 2D.
     * @param auto - Stato auto.
     * @param x - Coordinata x testo.
     * @param y - Coordinata y testo.
     * @param tempoLeader - Miglior tempo assoluto.
     * @param accent - Colore accento.
     * @param migliorato - true se migliorato.
     * @returns void
     */
    private disegnaValoreClassifica(
        ctx: CanvasRenderingContext2D,
        auto: StatoAuto,
        x: number,
        y: number,
        tempoLeader: number,
        accent: string,
        migliorato: boolean,
    ): void {
        ctx.textAlign = 'right';
        ctx.font = '10px Arial';

        if (this.fase === 'qualifiche') {
            if (migliorato && auto.migliorGiro > 0) {
                ctx.fillStyle = accent;
                ctx.fillText(formatTempo(auto.migliorGiro), x, y);
            } else if (auto.migliorGiro > 0 && tempoLeader > 0) {
                ctx.fillStyle = '#ccc';
                ctx.fillText('+' + (auto.migliorGiro - tempoLeader) + ' ms', x, y);
            } else {
                ctx.fillStyle = '#555';
                ctx.fillText('--', x, y);
            }
            return;
        }

        if (this.modalitaGara === 'sopravvivenza') {
            if (auto.finito) {
                ctx.fillStyle = '#bbb';
                ctx.fillText('P' + auto.posizione, x, y);
            } else if (this.ultimoARischio && this.statoServer?.[this.ultimoARischio] === auto) {
                ctx.fillStyle = '#ff9b9b';
                ctx.fillText('RISCHIO', x, y);
            } else {
                ctx.fillStyle = accent;
                ctx.fillText('IN GARA', x, y);
            }
            return;
        }

        if (auto.dnf) {
            ctx.fillStyle = '#ff9b9b';
            ctx.fillText('DNF', x, y);
        } else if (auto.finito) {
            ctx.fillStyle = '#bbb';
            ctx.fillText('OK ARR.', x, y);
        } else {
            ctx.fillStyle = accent;
            ctx.fillText('G' + (auto.giri + 1), x, y);
        }
    }

    /**
     * Disegna il delta posizione e la label PB.
     * @param ctx - Contesto canvas 2D.
     * @param x - Coordinata x testo.
     * @param y - Coordinata y testo.
     * @param delta - Delta posizione.
     * @param accent - Colore accento.
     * @param migliorato - true se migliorato.
     * @returns void
     */
    private disegnaDeltaClassifica(
        ctx: CanvasRenderingContext2D,
        x: number,
        y: number,
        delta: number,
        accent: string,
        migliorato: boolean,
    ): void {
        if (this.fase === 'gara' && delta !== 0) {
            ctx.textAlign = 'center';
            ctx.font = 'bold 10px Arial';
            ctx.fillStyle = accent;
            ctx.fillText((delta > 0 ? '+' : '-') + Math.abs(delta), x, y);
        }

        if (migliorato) {
            ctx.textAlign = 'center';
            ctx.font = 'bold 9px Arial';
            ctx.fillStyle = '#7fff7f';
            ctx.fillText('PB', x, y - 10);
        }
    }


    /**
     * Schermata tra qualifiche e gara.
     * Mostra la griglia di partenza DALL'ULTIMO AL PRIMO
     * l'ultimo qualificato e' in cima, la pole e' in fondo evidenziata in oro.
     * @param ctx - Contesto canvas 2D.
     * @param W - Larghezza schermo in px.
     * @param H - Altezza schermo in px.
     * @returns void
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

        const nomeModalita = this.modalitaGara === 'sopravvivenza' ? 'SOPRAVVIVENZA' : 'GARA STANDARD';
        const descrizioneModalita = this.modalitaGara === 'sopravvivenza'
            ? 'Voto concluso: nessun giro, ogni 15s l ultimo viene eliminato'
            : 'Voto concluso: gara classica a 3 giri';
        ctx.font = 'bold 16px Arial';
        ctx.fillStyle = this.modalitaGara === 'sopravvivenza' ? '#ffcf5a' : '#7ecfff';
        ctx.fillText(`HA VINTO: ${nomeModalita}`, W / 2, 184);
        ctx.font = '13px Arial';
        ctx.fillStyle = 'rgba(255,255,255,0.65)';
        ctx.fillText(descrizioneModalita, W / 2, 204);

        ctx.fillStyle = 'rgba(255,255,255,0.12)';
        ctx.fillRect(W / 2 - 190, 216, 380, 1);

        const gridRev     = [...this.gridOrder].reverse();
        const tempoLeader = this.gridOrder.length > 0
            ? (this.statoServer[this.gridOrder[0]]?.migliorGiro ?? -1)
            : -1;

        const rigaH = 44, startY = 226, listaW = 440;
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
                ctx.fillText('POLE', listaX + 76, ry + rigaH * 0.66 - 16);
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


    /**
     * Disegna la sequenza finale (avviso podio o podio).
     * @param ctx - Contesto canvas 2D.
     * @param me - Stato auto locale.
     * @param W - Larghezza schermo in px.
     * @param H - Altezza schermo in px.
     * @returns void
     */
    private disegnaFinale(ctx: CanvasRenderingContext2D, me: StatoAuto | undefined, W: number, H: number): void {
        if (this.garaFinitaTimer > DURATA_PODIO) {
            this.disegnaAvvisoPodio(ctx, me, W, H);
        } else {
            this.disegnaPodio(ctx, W, H);
        }
    }

    /**
     * Disegna la schermata di transizione prima del podio.
     * @param ctx - Contesto canvas 2D.
     * @param me - Stato auto locale.
     * @param W - Larghezza schermo in px.
     * @param H - Altezza schermo in px.
     * @returns void
     */
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
            const messaggioFinale = this.modalitaGara === 'sopravvivenza'
                ? `Hai concluso P${me.posizione}!`
                : me.dnf ? 'DNF - non hai completato la gara in tempo' : `Hai concluso P${me.posizione}!`;
            ctx.fillText(messaggioFinale, W / 2, H / 2 - 55);
        }

        ctx.font = 'bold 30px Arial';
        ctx.fillStyle = '#fff';
        ctx.fillText('Il podio sta per iniziare', W / 2, H / 2 + 25);
        ctx.font = 'bold 72px Arial';
        ctx.fillStyle = '#7ecfff';
        ctx.fillText(String(secondi), W / 2, H / 2 + 110);
    }

    /**
     * Disegna il podio con top 3 e timer rientro lobby.
     * @param ctx - Contesto canvas 2D.
     * @param W - Larghezza schermo in px.
     * @param H - Altezza schermo in px.
     * @returns void
     */
    private disegnaPodio(ctx: CanvasRenderingContext2D, W: number, H: number): void {
        const topTre = this.topTreFinale();
        const tempoRimasto = Math.max(0, Math.ceil(this.garaFinitaTimer));

        ctx.save();
        this.disegnaSfondoPodio(ctx, W, H);
        this.disegnaBannerScacchiPodio(ctx, W);
        this.disegnaTitoloPodio(ctx, W, tempoRimasto);
        this.disegnaGradiniPodio(ctx, W, H, topTre);
        ctx.restore();
    }

    /**
     * Disegna sfondo e illuminazione del podio.
     * @param ctx - Contesto canvas 2D.
     * @param W - Larghezza schermo in px.
     * @param H - Altezza schermo in px.
     * @returns void
     */
    private disegnaSfondoPodio(ctx: CanvasRenderingContext2D, W: number, H: number): void {
        const bg = ctx.createLinearGradient(0, 0, 0, H);
        bg.addColorStop(0, '#17181d');
        bg.addColorStop(0.55, '#0d0f12');
        bg.addColorStop(1, '#050506');
        ctx.fillStyle = bg;
        ctx.fillRect(0, 0, W, H);

        this.disegnaGlowPodio(ctx, W, H, W * 0.18, H * 0.16, Math.max(W, H) * 0.7, 'rgba(255, 71, 58, 0.22)', 'rgba(255, 71, 58, 0.08)');
        this.disegnaGlowPodio(ctx, W, H, W * 0.82, H * 0.18, Math.max(W, H) * 0.65, 'rgba(241, 196, 15, 0.18)', 'rgba(241, 196, 15, 0.05)');
        this.disegnaPavimentoPodio(ctx, W, H);
    }

    /**
     * Disegna un glow radiale di sfondo.
     * @param ctx - Contesto canvas 2D.
     * @param W - Larghezza schermo in px.
     * @param H - Altezza schermo in px.
     * @param x - Centro glow x.
     * @param y - Centro glow y.
     * @param r - Raggio glow.
     * @param centro - Colore centro.
     * @param meta - Colore intermedio.
     * @returns void
     */
    private disegnaGlowPodio(
        ctx: CanvasRenderingContext2D,
        W: number,
        H: number,
        x: number,
        y: number,
        r: number,
        centro: string,
        meta: string,
    ): void {
        const glow = ctx.createRadialGradient(x, y, 0, x, y, r);
        glow.addColorStop(0, centro);
        glow.addColorStop(0.55, meta);
        glow.addColorStop(1, 'rgba(0,0,0,0)');
        ctx.fillStyle = glow;
        ctx.fillRect(0, 0, W, H);
    }

    /**
     * Disegna il pavimento del podio con pattern.
     * @param ctx - Contesto canvas 2D.
     * @param W - Larghezza schermo in px.
     * @param H - Altezza schermo in px.
     * @returns void
     */
    private disegnaPavimentoPodio(ctx: CanvasRenderingContext2D, W: number, H: number): void {
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
    }

    /**
     * Disegna il banner a scacchi in alto al podio.
     * @param ctx - Contesto canvas 2D.
     * @param W - Larghezza schermo in px.
     * @returns void
     */
    private disegnaBannerScacchiPodio(ctx: CanvasRenderingContext2D, W: number): void {
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
    }

    /**
     * Disegna il titolo del podio e il countdown.
     * @param ctx - Contesto canvas 2D.
     * @param W - Larghezza schermo in px.
     * @param tempoRimasto - Secondi al rientro.
     * @returns void
     */
    private disegnaTitoloPodio(ctx: CanvasRenderingContext2D, W: number, tempoRimasto: number): void {
        ctx.textAlign = 'center';
        ctx.font = 'bold 46px Arial';
        ctx.fillStyle = '#f4f1e6';
        ctx.fillText('PODIO', W / 2, 80);
        ctx.font = 'bold 16px Arial';
        ctx.fillStyle = '#ffcf5a';
        ctx.fillText('Ritorno alla lobby in ' + tempoRimasto + 's', W / 2, 106);
    }

    /**
     * Disegna i gradini del podio e i piloti sopra.
     * @param ctx - Contesto canvas 2D.
     * @param W - Larghezza schermo in px.
     * @param H - Altezza schermo in px.
     * @param topTre - Lista top 3 in ordine di posizione.
     * @returns void
     */
    private disegnaGradiniPodio(ctx: CanvasRenderingContext2D, W: number, H: number, topTre: StatoAuto[]): void {
        const baseY = H - 70;
        const stepW = Math.min(190, W * 0.25);
        const gap = Math.min(22, W * 0.03);
        const centerX = W / 2;
        const layout: SlotPodio[] = [
            { place: 2, x: centerX - stepW - gap, h: 150, color: '#c0c8d8' },
            { place: 1, x: centerX,               h: 220, color: '#f1c40f' },
            { place: 3, x: centerX + stepW + gap, h: 115, color: '#cd7f32' },
        ];

        for (const slot of layout) {
            const stepY = this.disegnaGradinoPodio(ctx, slot, stepW, baseY);
            const auto = topTre[slot.place - 1];
            if (auto) this.disegnaPilotaPodio(ctx, auto, slot, stepW, stepY);
        }
    }

    /**
     * Disegna un singolo gradino podio.
     * @param ctx - Contesto canvas 2D.
     * @param slot - Slot del podio (posizione/colore).
     * @param stepW - Larghezza gradino.
     * @param baseY - Base verticale podio.
     * @returns Coordinata y del top gradino.
     */
    private disegnaGradinoPodio(ctx: CanvasRenderingContext2D, slot: SlotPodio, stepW: number, baseY: number): number {
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

        return stepY;
    }

    /**
     * Disegna il personaggio e nome sul gradino del podio.
     * @param ctx - Contesto canvas 2D.
     * @param auto - Stato auto del pilota.
     * @param slot - Slot del podio.
     * @param stepW - Larghezza gradino.
     * @param stepY - Coordinata y top gradino.
     * @returns void
     */
    private disegnaPilotaPodio(
        ctx: CanvasRenderingContext2D,
        auto: StatoAuto,
        slot: SlotPodio,
        stepW: number,
        stepY: number,
    ): void {
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
        const labelPosizione = this.modalitaGara === 'sopravvivenza'
            ? 'P' + auto.posizione
            : auto.dnf ? 'DNF' : 'P' + auto.posizione;
        ctx.fillStyle = auto.dnf && this.modalitaGara !== 'sopravvivenza' ? '#ff9b9b' : '#dce8ff';
        ctx.fillText(labelPosizione, slot.x, stepY + slot.h - 14);
    }

    /**
     * Restituisce le prime tre auto finite, ordinate per posizione.
     * @returns Array dei top 3.
     */
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


    // --- Canvas statico del circuito ----------------------------------------

    /**
     * Costruisce il canvas statico del circuito (cache).
     * @returns Canvas pre-renderizzato del tracciato.
     */
    private costruisciCanvas(): HTMLCanvasElement {
        const canvas = document.createElement('canvas');
        canvas.width = MONDO_W;
        canvas.height = MONDO_H;
        const ctx = canvas.getContext('2d')!;

        this.disegnaSfondoPrato(ctx);
        this.disegnaAsfalto(ctx);
        this.disegnaLineaCentrale(ctx);
        this.disegnaCheckpointPista(ctx);
        this.disegnaTraguardo(ctx);
        this.disegnaCaselleGriglia(ctx);
        this.disegnaTextureAsfalto(ctx);

        return canvas;
    }

    /**
     * Disegna lo sfondo del prato con bandature.
     * @param ctx - Contesto canvas 2D.
     * @returns void
     */
    private disegnaSfondoPrato(ctx: CanvasRenderingContext2D): void {
        ctx.fillStyle = '#2d6a35';
        ctx.fillRect(0, 0, MONDO_W, MONDO_H);
        ctx.fillStyle = '#2a6130';
        for (let y = 0; y < MONDO_H; y += 60) ctx.fillRect(0, y, MONDO_W, 30);
    }

    /**
     * Disegna il nastro asfaltato seguendo la polilinea del circuito.
     * @param ctx - Contesto canvas 2D.
     * @returns void
     */
    private disegnaAsfalto(ctx: CanvasRenderingContext2D): void {
        ctx.strokeStyle = '#4a4a4a';
        ctx.lineWidth = LARGHEZZA_PISTA;
        ctx.lineCap = 'round';
        ctx.lineJoin = 'round';
        this.tracciaPolilineaCircuito(ctx);
        ctx.stroke();
    }

    /**
     * Disegna la linea centrale tratteggiata.
     * @param ctx - Contesto canvas 2D.
     * @returns void
     */
    private disegnaLineaCentrale(ctx: CanvasRenderingContext2D): void {
        ctx.strokeStyle = 'rgba(255,255,255,0.20)';
        ctx.lineWidth = 2;
        ctx.setLineDash([18, 14]);
        this.tracciaPolilineaCircuito(ctx);
        ctx.stroke();
        ctx.setLineDash([]);
    }

    /**
     * Traccia la polilinea chiusa dei waypoint.
     * @param ctx - Contesto canvas 2D.
     * @returns void
     */
    private tracciaPolilineaCircuito(ctx: CanvasRenderingContext2D): void {
        ctx.beginPath();
        ctx.moveTo(WAYPOINTS[0].x, WAYPOINTS[0].y);
        for (let i = 1; i <= WAYPOINTS.length; i++) {
            const punto = WAYPOINTS[i % WAYPOINTS.length];
            ctx.lineTo(punto.x, punto.y);
        }
    }

    /**
     * Disegna tutti i checkpoint sul circuito.
     * @param ctx - Contesto canvas 2D.
     * @returns void
     */
    private disegnaCheckpointPista(ctx: CanvasRenderingContext2D): void {
        for (let i = 0; i < CHECKPOINTS.length; i++) {
            this.disegnaCheckpoint(ctx, i);
        }
    }

    /**
     * Disegna un singolo checkpoint con linea perpendicolare alla pista.
     * @param ctx - Contesto canvas 2D.
     * @param index - Indice checkpoint.
     * @returns void
     */
    private disegnaCheckpoint(ctx: CanvasRenderingContext2D, index: number): void {
        const cp = CHECKPOINTS[index];
        const wpIndex = CHECKPOINTS_WAYPOINT_INDEX[index];
        const prev = WAYPOINTS[(wpIndex - 1 + WAYPOINTS.length) % WAYPOINTS.length];
        const next = WAYPOINTS[(wpIndex + 1) % WAYPOINTS.length];
        const tx = next.x - prev.x;
        const ty = next.y - prev.y;
        const lineAngle = Math.atan2(ty, tx) + Math.PI / 2;

        ctx.save();
        ctx.translate(cp.x, cp.y);
        ctx.rotate(lineAngle);
        this.disegnaLineaCheckpoint(ctx);
        ctx.rotate(-lineAngle);
        this.disegnaNumeroCheckpoint(ctx, index + 1);
        ctx.restore();
    }

    /**
     * Disegna la linea tratteggiata di un checkpoint.
     * @param ctx - Contesto canvas 2D.
     * @returns void
     */
    private disegnaLineaCheckpoint(ctx: CanvasRenderingContext2D): void {
        const lineLen = LARGHEZZA_PISTA * 0.92;
        const dashCount = 9;
        const dashLen = lineLen / (dashCount * 2 - 1);

        ctx.strokeStyle = 'rgba(255, 255, 255, 0.92)';
        ctx.lineWidth = 3;
        ctx.lineCap = 'round';
        for (let d = 0; d < dashCount; d++) {
            const start = -lineLen / 2 + d * dashLen * 2;
            ctx.beginPath();
            ctx.moveTo(start, 0);
            ctx.lineTo(start + dashLen, 0);
            ctx.stroke();
        }
    }

    /**
     * Disegna il numero del checkpoint.
     * @param ctx - Contesto canvas 2D.
     * @param numero - Numero checkpoint (1-based).
     * @returns void
     */
    private disegnaNumeroCheckpoint(ctx: CanvasRenderingContext2D, numero: number): void {
        ctx.fillStyle = 'rgba(255,255,255,0.65)';
        ctx.font = 'bold 12px sans-serif';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText(String(numero), 0, -14);
    }

    /**
     * Disegna la fascia del traguardo a scacchi.
     * @param ctx - Contesto canvas 2D.
     * @returns void
     */
    private disegnaTraguardo(ctx: CanvasRenderingContext2D): void {
        const t = TRAGUARDO;
        const bandW = TRAGUARDO_LARGHEZZA;
        const bandH = TRAGUARDO_ALTEZZA;
        const cellsX = 18;
        const cellW = bandW / cellsX;
        const cellH = bandH / 2;

        ctx.fillStyle = '#0a0a0a';
        ctx.fillRect(t.x - bandW / 2 - 4, t.y - bandH / 2 - 4, bandW + 8, bandH + 8);

        for (let row = 0; row < 2; row++) {
            for (let col = 0; col < cellsX; col++) {
                ctx.fillStyle = (row + col) % 2 === 0 ? '#f5f5f5' : '#101010';
                ctx.fillRect(t.x - bandW / 2 + col * cellW, t.y - bandH / 2 + row * cellH, cellW + 0.2, cellH + 0.2);
            }
        }

        ctx.fillStyle = 'rgba(255,255,255,0.12)';
        ctx.fillRect(t.x - bandW / 2, t.y - bandH / 2 - 3, bandW, 2);
        ctx.fillStyle = 'rgba(255,64,64,0.8)';
        ctx.fillRect(t.x - bandW / 2, t.y + bandH / 2 + 1, bandW, 3);
    }

    /**
     * Disegna una texture puntinata sull'asfalto per dare profondita'.
     * @param ctx - Contesto canvas 2D.
     * @returns void
     */
    private disegnaTextureAsfalto(ctx: CanvasRenderingContext2D): void {
        ctx.fillStyle = 'rgba(0,0,0,0.07)';
        for (let i = 0; i < 10000; i++) {
            const rx = Math.random() * MONDO_W;
            const ry = Math.random() * MONDO_H;
            if (sullaStrada(rx, ry)) ctx.fillRect(rx, ry, 2, 2);
        }
    }


    /**
     * Disegna tutte le caselle di griglia sul rettilineo di partenza.
     * @param ctx - Contesto canvas 2D.
     * @returns void
     */
    private disegnaCaselleGriglia(ctx: CanvasRenderingContext2D): void {
    for (let i = 0; i < GRIGLIA_MAX_AUTO; i++) {
        this.disegnaCasellaGriglia(ctx, posGriglia(i));
    }
}

    /**
     * Disegna una singola casella di griglia.
     * @param ctx - Contesto canvas 2D.
     * @param slot - Coordinate/angolo del box.
     * @returns void
     */
    private disegnaCasellaGriglia( 
        ctx: CanvasRenderingContext2D,
        slot: { x: number; y: number; angolo: number },
    ): void {
        const x = -GRIGLIA_CASELLA_W / 2;
        const y = -GRIGLIA_CASELLA_H / 2;

        ctx.save();
        ctx.translate(slot.x, slot.y);
        ctx.rotate(slot.angolo);

        // rettangolo bianco con lato sinistro mancante
        ctx.strokeStyle = 'rgba(255,255,255,0.96)';
        ctx.lineWidth = 3;
        ctx.lineCap = 'round';

        ctx.beginPath();
        ctx.moveTo(x, y);
        ctx.lineTo(x + GRIGLIA_CASELLA_W, y);
        ctx.lineTo(x + GRIGLIA_CASELLA_W, y + GRIGLIA_CASELLA_H);
        ctx.lineTo(x, y + GRIGLIA_CASELLA_H);
        ctx.stroke();

        ctx.restore();
    }


    // --- Registrazione input da tastiera/mouse ------------------------------

    /**
     * Registra gli handler di tastiera e mouse per i controlli.
     * @returns void
     */
    private registraTasti(): void {
        const set = (e: KeyboardEvent, v: boolean) => {
            const isGameKey =
                e.code === 'KeyW' || e.code === 'ArrowUp' ||
                e.code === 'KeyS' || e.code === 'ArrowDown' ||
                e.code === 'Space' ||
                e.code === 'ShiftLeft' || e.code === 'ShiftRight' ||
                e.code === 'Digit1' || e.code === 'Digit2' ||
                e.code === 'Numpad1' || e.code === 'Numpad2';
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
                    if (!this.shockwavePremuto) this.tasti.shockwave = true;
                    this.shockwavePremuto = true;
                } else {
                    this.shockwavePremuto = false;
                }
            }
            if (v && (e.code === 'Digit1' || e.code === 'Numpad1' || e.code === 'Digit2' || e.code === 'Numpad2')) {
                if (this.fase !== 'voto') return;
                const scelta = (e.code === 'Digit1' || e.code === 'Numpad1') ? 'standard' : 'sopravvivenza';
                this.votoSelezionato = scelta;
                this.votoDaInviare = scelta;
            }
        };
        document.addEventListener('keydown', e => set(e, true));
        document.addEventListener('keyup',   e => set(e, false));
        this.userInput.canvas.addEventListener('pointermove', () => { this.mouseSterzoAttivo = true; });
    }
}