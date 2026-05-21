// Street-fighter inspired 1v1 game.
// Flat, deterministic, no enterprise patterns.

import { Player, Rectangle } from '../../common';
import type { IncomingMsg, OutgoingMsg } from '../../server';
import { GameClient, GameServer } from '../game';
import { UserInput } from '../../client/user-input';
import { getCharacterDrawFunction } from '../../client/characters';
import { AnimationManager, createDefaultFighterAnimationManager } from './fighter-animation';

// ─── Constants ───────────────────────────────────────────────────────────────
// Tutte le costanti numeriche del gioco, raggruppate per categoria.
// Cambiarle qui modifica il bilanciamento globale senza toccare la logica.

const FRAME_RATE       = 60;          // Aggiornamenti di gioco al secondo (logica server)
const FRAME_DT         = 1 / FRAME_RATE; // Durata di un frame in secondi (~0.0167s)
const PLAYER_W         = 0.15;        // Larghezza del personaggio in unità di gioco (spazio normalizzato -1..1)
const PLAYER_H         = 0.5;         // Altezza del personaggio
const GROUND_Y         = 0.75;        // Coordinata Y del pavimento (asse Y cresce verso il basso)

const MAX_HEALTH       = 100;         // Punti vita massimi per ogni giocatore
const ROUND_TIME       = 99;          // Durata massima di un round in secondi
const ROUNDS_TO_WIN    = 2;           // Round necessari per vincere il match
const BEST_OF_ROUNDS   = 3;           // Formato "best of N" del match
const COUNTDOWN_FRAMES = 180;         // Frame di countdown prima che il round inizi (3 secondi a 60fps)
const ROUND_END_FRAMES = 150;         // Frame di pausa alla fine di ogni round
const RESULT_FRAMES    = 300;         // Frame di pausa sulla schermata risultati finali

const MAX_WALK_SPEED   = 0.78;        // Velocità massima di camminata
const ACCELERATION     = 5.6;         // Accelerazione orizzontale a terra
const AIR_ACCELERATION = 2.1;         // Accelerazione orizzontale in aria (ridotta per meno controllo)
const FRICTION         = 7.0;         // Decelerazione (attrito) che frena il movimento
const GRAVITY          = 5.0;         // Forza di gravità applicata ogni frame quando in aria
const FAST_FALL        = 1.5;         // Moltiplicatore di gravità durante la caduta (vy > 0)
const JUMP_FORCE       = 1.8;         // Forza verticale del salto (negativa = verso l'alto)
const DOUBLE_JUMP_MULT = 0.7;         // Riduzione della forza per il doppio salto

const DASH_FRAMES      = 14;          // Durata del dash in frame
const DASH_SPEED       = 0.38 / (DASH_FRAMES / FRAME_RATE); // Velocità del dash (distanza / tempo)
const DOUBLE_TAP_WIN   = 14;          // Finestra temporale (frame) per rilevare il doppio tap direzionale

const DODGE_FRAMES     = 24;          // Durata totale della schivata
const DODGE_IFRAMES    = 18;          // Frame di invulnerabilità durante la schivata
const DODGE_COOLDOWN   = 52;          // Frame di attesa prima di poter schivare di nuovo
const DODGE_SPEED      = 1.0;         // Velocità di spostamento durante la schivata

const BLOCKSTUN        = 8;           // Frame base di stun quando un attacco viene bloccato
const COMBO_TIMEOUT    = 90;          // Frame entro cui un secondo colpo conta come combo
const INPUT_BUFFER     = 15;          // Numero massimo di token salvati nella coda input per le mosse speciali

// ─── Types ────────────────────────────────────────────────────────────────────
// Definizioni dei tipi TypeScript che descrivono lo stato del gioco.

// Tutti i possibili stati in cui può trovarsi un personaggio
export type PlayerState = 'IDLE' | 'MOVE' | 'JUMP' | 'ATTACK' | 'BLOCK' | 'HIT' | 'KO'
    | 'CROUCHING' | 'DASHING' | 'DODGING' | 'CHARGING' | 'KNOCKDOWN' | 'SHORYUKEN';

// Tipi di attacco disponibili
export type AttackType = 'LIGHT' | 'HEAVY' | 'AERIAL' | 'SWEEP' | 'PROJECTILE'|'SHORYUKEN';
// Altezza dell'hitbox di un attacco (determina se può essere bloccato accucciati o in piedi)
export type AttackHeight = 'HIGH' | 'MID' | 'LOW';
// Fasi del match (countdown → combattimento → fine round → risultati)
type MatchPhase = 'COUNTDOWN' | 'ACTIVE' | 'ROUND_END' | 'RESULTS';

// Struttura completa di un giocatore: posizione, fisica, stato, input, statistiche
export interface FighterPlayer {
    id: string;
    name: string;
    character: string;

    health: number;       // Vita attuale
    superMeter: number;   // Barra super (0-100), si riempie colpendo o subendo colpi

    x: number;            // Posizione orizzontale
    y: number;            // Posizione verticale
    vx: number;           // Velocità orizzontale
    vy: number;           // Velocità verticale
    facing: 'left' | 'right'; // Direzione verso cui è rivolto il personaggio
    isGrounded: boolean;  // True se il personaggio è a contatto col pavimento

    state: PlayerState;   // Stato corrente della macchina a stati
    stateFrame: number;   // Quanti frame è trascorso nello stato corrente
    jumpCount: number;    // 0 = non ha saltato, 1 = un salto, 2 = doppio salto usato

    attackType: AttackType | null; // Tipo di attacco in corso (null se non attacca)
    attackTimer: number;           // Frame rimanenti dell'attacco corrente
    attackCharge: number;          // Carica accumulata per l'attacco HEAVY (0-100)
    hitstun: number;               // Frame rimasti di stun dopo aver subito un colpo
    blockstun: number;             // Frame rimasti di stun dopo aver bloccato
    knockbackX: number;            // Velocità di spinta orizzontale applicata dal colpo ricevuto
    knockdownFrames: number;       // Frame rimasti nella caduta a terra (knockdown)
    invFrames: number;             // Frame di invulnerabilità rimanenti (es. durante la schivata)
    hitstopFrames: number;         // Frame di "freeze" cinematografico al momento del colpo
    dodgeCooldown: number;         // Frame di cooldown prima della prossima schivata
    alreadyHit: Record<string, boolean>; // Mappa degli avversari già colpiti in questo attacco (evita doppi colpi)
    blockHeight: AttackHeight;     // Altezza attuale del blocco
    isBlocking: boolean;           // True se il personaggio sta bloccando attivamente

    // Input correnti del frame (inviati dal client al server ogni tick)
    inputMove: number;    // -1 = sinistra, 0 = fermo, 1 = destra
    inputJump: boolean;
    inputLight: boolean;
    inputHeavy: boolean;
    inputBlock: boolean;
    inputCrouch: boolean;
    inputDodge: boolean;

    // Input del frame precedente (usati per rilevare la "pressione" vs "tenuto premuto")
    prevLight: boolean;
    prevHeavy: boolean;
    prevJump: boolean;
    prevDodge: boolean;
    prevInputMove: number;

    lastMoveTapFrame: Record<string, number>; // Frame dell'ultimo tap direzionale per rilevare il doppio tap (dash)
    inputQueue: string[];                     // Coda degli input direzionali/bottoni per le mosse speciali

    currentAnimationFrame: number; // Frame corrente dell'animazione
    damageFlashTimer: number;      // Timer per il flash bianco quando si subisce danno

    // Statistiche del match
    roundsWon: number;
    comboCount: number;       // Combo corrente
    maxCombo: number;         // Combo massima raggiunta nel match
    comboTimer: number;       // Timer per mantenere la combo attiva
    totalDamageDealt: number; // Danno totale inflitto (mostrato a fine match)
}

// Definizione di un attacco: geometria dell'hitbox, danni e valori di gameplay
interface AttackDef {
    x: number; y: number; w: number; h: number; // Offset e dimensioni dell'hitbox rispetto al personaggio
    damage: number;        // Danno inflitto
    height: AttackHeight;  // Altezza (HIGH/MID/LOW) che determina quali blocchi lo fermano
    startFrame: number;    // Frame in cui l'hitbox diventa attiva
    endFrame: number;      // Frame in cui l'hitbox si disattiva
    totalFrames: number;   // Durata totale dell'animazione dell'attacco
    knockback: number;     // Forza di spinta orizzontale sul difensore
    hitstun: number;       // Frame di stun inflitti al difensore colpito
    blockstun: number;     // Frame di stun inflitti al difensore che blocca
    hitstop: number;       // Frame di freeze per entrambi i personaggi al momento del colpo
    causesKnockdown?: boolean; // Se true, il difensore cade a terra (knockdown)
}

// Struttura di un proiettile (fireball/hadoken) in volo
export interface Projectile {
    id: string;
    ownerId: string;        // ID del giocatore che ha lanciato il proiettile
    x: number;
    y: number;
    vx: number;             // Velocità orizzontale (direzione del lancio)
    lifeSpan: number;       // Frame di vita rimanenti prima che scompaia
    alreadyHit: Record<string, boolean>; // Avversari già colpiti (ogni proiettile colpisce una volta)
}

// ─── Attack Definitions ───────────────────────────────────────────────────────
// Oggetti statici con i valori di ogni attacco. Sono costanti di bilanciamento:
// modificarli cambia solo i numeri, non la logica di combattimento.

// Attacco leggero: rapido, poco danno, hitbox piccola
const ATTACK_LIGHT: AttackDef = {
    x: 0.13, y: -0.29, w: 0.10, h: 0.12,
    damage: 5, height: 'MID', startFrame: 4, endFrame: 7, totalFrames: 16,
    knockback: 0.28, hitstun: 10, blockstun: BLOCKSTUN, hitstop: 3
};
// Attacco pesante: lento, molto danno, hitbox grande; può essere caricato
const ATTACK_HEAVY: AttackDef = {
    x: 0.17, y: -0.28, w: 0.14, h: 0.16,
    damage: 12, height: 'MID', startFrame: 9, endFrame: 16, totalFrames: 30,
    knockback: 0.58, hitstun: 17, blockstun: BLOCKSTUN + 3, hitstop: 5
};
// Attacco aereo: eseguibile solo in volo, hitbox verticale
const ATTACK_AERIAL: AttackDef = {
    x: 0.10, y: -0.08, w: 0.12, h: 0.20,
    damage: 8, height: 'HIGH', startFrame: 5, endFrame: 14, totalFrames: 22,
    knockback: 0.38, hitstun: 13, blockstun: BLOCKSTUN, hitstop: 3
};
// Sweep: colpo basso che causa knockdown, bloccabile solo accucciati
const ATTACK_SWEEP: AttackDef = {
    x: 0.14, y: -0.08, w: 0.17, h: 0.10,
    damage: 9, height: 'LOW', startFrame: 8, endFrame: 15, totalFrames: 28,
    knockback: 0.45, hitstun: 14, blockstun: BLOCKSTUN + 1, hitstop: 5,
    causesKnockdown: true
};
// Shoryuken (uppercut): mossa speciale, molto danno, hitbox verticale lunga
const ATTACK_UPPERCUT: AttackDef = {
    x: 0.09, y: -0.33, w: 0.14, h: 0.28,
    damage: 14, height: 'MID', startFrame: 4, endFrame: 13, totalFrames: 34,
    knockback: 0.50, hitstun: 19, blockstun: BLOCKSTUN + 4, hitstop: 5
};
// Proiettile (Hadoken): colpo a distanza, si muove orizzontalmente
const ATTACK_PROJECTILE: AttackDef = {
    x: 0, y: 0, w: 0.11, h: 0.11,
    damage: 8, height: 'MID', startFrame: 0, endFrame: 22, totalFrames: 22,
    knockback: 0.35, hitstun: 13, blockstun: BLOCKSTUN, hitstop: 3
};

// Restituisce la definizione dell'attacco corrente del giocatore (o null se non sta attaccando)
function getAttackDef(player: FighterPlayer): AttackDef | null {
    switch (player.attackType) {
        case 'LIGHT':      return ATTACK_LIGHT;
        case 'HEAVY':      return ATTACK_HEAVY;
        case 'AERIAL':     return ATTACK_AERIAL;
        case 'SWEEP':      return ATTACK_SWEEP;
        case 'SHORYUKEN':  return ATTACK_UPPERCUT;
        case 'PROJECTILE': return ATTACK_PROJECTILE;
        default:           return null;
    }
}

// ─── Input ────────────────────────────────────────────────────────────────────

// Estensione della classe base UserInput con i controlli specifici del picchiaduro.
// Gestisce tastiera (WASD + Space + E/R/Q/F) e tiene traccia della sequenza di input
// per il riconoscimento delle mosse speciali (es. "236A" per l'Hadoken).
export class UserInputFighterExtended extends UserInput {
    public jump: boolean = false;
    public attackLight: boolean = false;
    public attackHeavy: boolean = false;
    public block: boolean = false;
    public dodge: boolean = false;

    // Simple special move tracking: remember last few inputs
    public inputSequence: string[] = [];
    private lastInputTime: number = 0;
    // Stato interno dei 4 tasti direzionali (up/down/left/right)
    private _up = false; private _down = false;
    private _left = false; private _right = false;

    constructor(canvas: HTMLCanvasElement) {
        super(canvas);
        this.setupListeners();
    }

    // Registra gli event listener su keydown e keyup.
    // keydown: imposta i flag booleani corrispondenti al tasto premuto e registra la direzione/azione.
    // keyup: azzera i flag quando il tasto viene rilasciato.
    // blur (finestra perde focus): azzera tutti gli input per evitare tasti "bloccati".
    private setupListeners(): void {
        document.addEventListener('keydown', e => {
            if (e.repeat) return; // Ignora gli eventi di ripetizione automatica del SO
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
            // Sicurezza: rilascia tutti i tasti se la finestra perde il focus
            this.jump = this.attackLight = this.attackHeavy = this.block = this.dodge = false;
        });
    }

    // Converte la combinazione di tasti direzionali premuti in un token numpad
    // (stile arcade: 2=giù, 4=sx, 6=dx, 8=su, 1=giù-sx, 3=giù-dx, ecc.)
    // e lo aggiunge alla sequenza di input per il rilevamento delle mosse speciali.
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

    // Aggiunge un token (direzione o bottone) alla sequenza di input.
    // Se sono passati più di 600ms dall'ultimo input, la sequenza viene azzerata
    // (input troppo vecchi non devono attivare mosse speciali).
    // Evita duplicati consecutivi e mantiene la sequenza a max 10 elementi (sliding window).
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
    // Verifica se la coda degli input termina con il pattern specificato.
    // Usato per riconoscere le mosse speciali (Hadoken "236A", Shoryuken "22B").
    public checkSequence(pattern: string): boolean {
        const tail = this.inputSequence.slice(-pattern.length).join('');
        return tail === pattern;
    }

    // Svuota la sequenza di input (chiamata dopo che una mossa speciale è stata eseguita)
    public clearSequence(): void { this.inputSequence = []; }
}

// ─── Player Factory ───────────────────────────────────────────────────────────

// Crea un nuovo oggetto FighterPlayer con tutti i valori iniziali azzerati/predefiniti.
// isPlayer1 determina la posizione di partenza (sinistra o destra) e la direzione iniziale.
function createPlayer(id: string, base: Player, isPlayer1: boolean): FighterPlayer {
    const x = isPlayer1 ? -0.65 : 0.65 - PLAYER_W; // Posizione X iniziale simmetrica
    return {
        id, name: base.name, character: base.character,
        health: MAX_HEALTH, superMeter: 0,
        x, y: GROUND_Y, vx: 0, vy: 0,
        facing: isPlayer1 ? 'right' : 'left', // I due giocatori si fronteggiano all'inizio
        isGrounded: true,
        state: 'IDLE', stateFrame: 0, jumpCount: 0,
        attackType: null, attackTimer: 0, attackCharge: 0,
        hitstun: 0, blockstun: 0, knockbackX: 0,
        knockdownFrames: 0, invFrames: 0, hitstopFrames: 0,
        dodgeCooldown: 0, alreadyHit: {},
        blockHeight: 'MID', isBlocking: false,
        inputMove: 0, inputJump: false, inputLight: false, inputHeavy: false,
        inputBlock: false, inputCrouch: false, inputDodge: false,
        prevLight: false, prevHeavy: false, prevJump: false, prevDodge: false, prevInputMove: 0,
        lastMoveTapFrame: {}, inputQueue: [],
        currentAnimationFrame: 0,  damageFlashTimer: 0,
        roundsWon: 0, comboCount: 0, maxCombo: 0, comboTimer: 0, totalDamageDealt: 0
    };
}

// ─── State helpers ────────────────────────────────────────────────────────────

// Cambia lo stato del giocatore. Se lo stato è diverso dal precedente,
// azzera stateFrame e alreadyHit (necessario per ripartire da frame 0 e
// permettere all'hitbox di colpire nuovamente nell'attacco successivo).
function setState(player: FighterPlayer, state: PlayerState, attackType: AttackType | null = null): void {
    if (player.state !== state) {
        player.stateFrame = 0;
        player.alreadyHit = {};
    }
    player.state = state;
    player.attackType = attackType;
}

// Restituisce true se il giocatore sta eseguendo un attacco
function isAttacking(player: FighterPlayer): boolean {
    return player.state === 'ATTACK';
}

// Restituisce true se il giocatore può eseguire un'azione (non è bloccato da stun, KO, dash, ecc.)
// Usato come guard prima di accettare qualsiasi input offensivo o di movimento.
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

// Utility: limita un valore numerico nell'intervallo [lo, hi]
function clamp(v: number, lo: number, hi: number): number {
    return v < lo ? lo : v > hi ? hi : v;
}

// ─── Collision / Hitbox helpers ───────────────────────────────────────────────

// Axis-Aligned Bounding Box: restituisce true se due rettangoli si sovrappongono.
// Usato per rilevare collisioni tra hitbox e hurtbox.
function aabb(a: Rectangle, b: Rectangle): boolean {
    return a.x < b.x + b.w && a.x + a.w > b.x && a.y < b.y + b.h && a.y + a.h > b.y;
}

// Calcola il rettangolo dell'hitbox dell'attacco nel mondo di gioco,
// tenendo conto della direzione in cui è rivolto il personaggio (facing).
function hitboxRect(player: FighterPlayer, atk: AttackDef): Rectangle {
    const dir = player.facing === 'right' ? 1 : -1; // Specchia l'offset se il personaggio guarda a sinistra
    return {
        x: player.x + 0.075 + atk.x * dir - atk.w / 2,
        y: player.y + atk.y - atk.h / 2,
        w: atk.w, h: atk.h
    };
}

// Calcola la hurtbox (area vulnerabile) del difensore in base all'altezza dell'attacco.
// Se il personaggio è accucciato, la hurtbox è più bassa e corta.
// HIGH colpisce la testa, LOW i piedi, MID il corpo centrale.
function hurtbox(player: FighterPlayer, height: AttackHeight = 'MID'): Rectangle {
    const crouch = player.inputCrouch || player.state === 'CROUCHING' ? 0.55 : 1;
    const h = PLAYER_H * crouch;
    const top = player.y - h;
    if (height === 'HIGH') return { x: player.x, y: top,              w: PLAYER_W, h: h * 0.38 };
    if (height === 'LOW')  return { x: player.x, y: player.y - h * 0.35, w: PLAYER_W, h: h * 0.35 };
    return { x: player.x, y: top + h * 0.22, w: PLAYER_W, h: h * 0.58 };
}

// Calcola la pushbox: il rettangolo usato per la separazione fisica tra i due personaggi
// (impedisce che si sovrappongano). È più stretto della hurtbox.
function pushbox(player: FighterPlayer): Rectangle {
    const h = player.inputCrouch || player.state === 'CROUCHING' ? 0.28 : 0.46;
    return { x: player.x + 0.025, y: player.y - h, w: 0.1, h };
}

// ─── Special move detection ───────────────────────────────────────────────────
// Hadoken: down, down-forward, forward + light  →  "236A"
// Shoryuken: down, down + heavy → "22B"

// Aggiunge un token alla coda di input del giocatore (lato server),
// evitando duplicati consecutivi e mantenendo la dimensione massima definita da INPUT_BUFFER.
function appendToQueue(player: FighterPlayer, token: string): void {
    if (player.inputQueue[player.inputQueue.length - 1] !== token) {
        player.inputQueue.push(token);
        if (player.inputQueue.length > INPUT_BUFFER) player.inputQueue.shift();
    }
}

// Ogni frame, traduce lo stato degli input del giocatore (movimento, accovacciato, bottoni)
// in token numerpad e li aggiunge alla coda. Questo permette di riconoscere le sequenze
// di mosse speciali guardando la storia degli input recenti.
function updateInputQueue(player: FighterPlayer): void {
    // Calcola la direzione rispetto al verso in cui guarda il personaggio
    // (forward = verso l'avversario, indipendentemente dal lato dello schermo)
    const fwd = player.facing === 'right' ? 1 : -1;
    const move = player.inputMove * fwd;
    let dir = '5'; // '5' = neutro (nessuna direzione)
    if (player.inputCrouch && move > 0) dir = '3';      // Giù-avanti
    else if (player.inputCrouch && move < 0) dir = '1'; // Giù-indietro
    else if (player.inputCrouch) dir = '2';              // Giù
    else if (move > 0) dir = '6';                        // Avanti
    else if (move < 0) dir = '4';                        // Indietro
    appendToQueue(player, dir);

    // Aggiunge i token dei bottoni solo sul frame in cui vengono premuti (edge detection)
    if (player.inputLight && !player.prevLight) appendToQueue(player, 'A');
    if (player.inputHeavy && !player.prevHeavy) appendToQueue(player, 'B');
}

// Verifica se la coda di input contiene il pattern specificato (ricerca da destra verso sinistra).
// Non richiede che i token siano consecutivi (basta che appaiano nell'ordine corretto).
// Restituisce true se l'intera sequenza del pattern è stata trovata.
function detectSpecial(player: FighterPlayer, pattern: string): boolean {
    const tokens = pattern.split('');
    let ti = tokens.length - 1;
    for (let qi = player.inputQueue.length - 1; qi >= 0 && ti >= 0; qi--) {
        if (player.inputQueue[qi] === tokens[ti]) ti--;
    }
    return ti < 0; // true se tutti i token del pattern sono stati trovati
}

// ─── Combat actions ───────────────────────────────────────────────────────────

// Avvia un attacco: imposta lo stato ATTACK, il tipo, e il timer basato sulla
// durata totale dell'attacco definita in AttackDef.
function startAttack(player: FighterPlayer, type: AttackType): void {
    setState(player, 'ATTACK', type);
    const def = getAttackDef(player);
    player.attackTimer = def ? def.totalFrames : 20;
}

// Avvia la mossa speciale Shoryuken (uppercut):
// - imposta brevemente i frame di invulnerabilità (6 frame di iframes)
// - applica una piccola spinta verso l'alto (simula il salto dell'uppercut)
// - usa attackTimer per la durata totale della mossa
function startUppercut(player: FighterPlayer): void {
    setState(player, 'ATTACK', 'SHORYUKEN');
    player.attackTimer = ATTACK_UPPERCUT.totalFrames;
    player.invFrames = 6;             // Invulnerabilità brevissima all'avvio della mossa
    player.vy = -JUMP_FORCE * 0.45;  // Piccolo salto verso l'alto durante l'uppercut
    player.jumpCount = Math.max(player.jumpCount, 1); // Conta come salto usato
}

// Crea un nuovo proiettile (Hadoken) lanciato dal giocatore owner.
// Il proiettile parte davanti al personaggio, si muove orizzontalmente
// nella direzione in cui guarda e ha una durata di 90 frame.
function spawnProjectile(owner: FighterPlayer, frame: number): Projectile {
    const dir = owner.facing === 'right' ? 1 : -1;
    return {
        id: `${owner.id}-${frame}-${Math.random().toString(36).slice(2, 7)}`, // ID univoco
        ownerId: owner.id,
        x: owner.x + PLAYER_W / 2 + dir * 0.17, // Nasce davanti al personaggio
        y: owner.y - PLAYER_H * 0.42,            // Altezza metà del personaggio
        vx: dir * 0.95,                           // Velocità nella direzione del lancio
        lifeSpan: 90,                             // Scompare dopo 90 frame (~1.5 secondi)
        alreadyHit: {}
    };
}

// Tenta di eseguire un dash (scatto veloce).
// Il dash si attiva con il doppio tap direzionale (due pressioni rapide nella stessa direzione,
// entro DOUBLE_TAP_WIN frame). Restituisce true se il dash è partito, false altrimenti.
function tryDash(player: FighterPlayer, frame: number): boolean {
    const prev = player.prevInputMove;

    // Controlli preliminari: il giocatore deve premere una direzione nuova, essere libero di agire
    if (player.inputMove === 0 || prev !== 0 || !canAct(player) || player.inputCrouch) return false;

    const key = player.inputMove > 0 ? 'right' : 'left';
    const last = player.lastMoveTapFrame[key] ?? -999;
    player.lastMoveTapFrame[key] = frame; // Registra il frame del tap corrente

    // Se il tap precedente era entro la finestra temporale → attiva il dash
    if (frame - last <= DOUBLE_TAP_WIN) {
        setState(player, 'DASHING');
        player.vx = player.inputMove * DASH_SPEED;
        return true;
    }
    return false;
}

// Tenta di eseguire una schivata.
// Richiede: tasto dodge appena premuto (non tenuto), canAct, e nessun cooldown attivo.
// La schivata applica invulnerabilità per DODGE_IFRAMES frame e avvia un cooldown.
function tryDodge(player: FighterPlayer): boolean {
    if (!player.inputDodge || player.prevDodge || !canAct(player) || player.dodgeCooldown > 0) return false;
    const dir = player.inputMove !== 0 ? player.inputMove : (player.facing === 'right' ? 1 : -1);
    setState(player, 'DODGING');
    player.invFrames = DODGE_IFRAMES;   // Frame di invulnerabilità
    player.dodgeCooldown = DODGE_COOLDOWN;
    player.vx = dir * DODGE_SPEED;      // Spinta nella direzione del movimento (o in avanti se neutro)
    return true;
}

// ─── Player update ────────────────────────────────────────────────────────────

// Funzione principale di aggiornamento del giocatore, eseguita ogni frame.
// Ordine di priorità:
// 1. Aggiorna la coda input per le mosse speciali
// 2. Decrementa tutti i timer (flash, combo, cooldown, invulnerabilità)
// 3. Se in hitstop: congela tutto (freeze cinematografico)
// 4. Gestisce hitstun, knockdown, blockstun (il giocatore non può agire)
// 5. Gestisce la fine degli stati ATTACK, DASHING, DODGING, CHARGING
// 6. Auto-faccia verso l'avversario
// 7. Tenta dash/dodge
// 8. Processa gli input offensivi (salto, attacchi, mosse speciali, blocco, accovacciata)
// 9. Determina lo stato di idle/move/jump in base alla situazione
function updatePlayer(
    player: FighterPlayer,
    opponent: FighterPlayer | null,
    frame: number,
    onProjectile: (p: Projectile) => void
): void {
    updateInputQueue(player);

    if (player.state === 'KO') return; // Il personaggio KO non fa nulla

    // Decremento timer vari ogni frame
    if (player.damageFlashTimer > 0) player.damageFlashTimer--;
    if (player.comboTimer > 0) player.comboTimer--; else player.comboCount = 0;
    if (player.dodgeCooldown > 0) player.dodgeCooldown--;
    if (player.invFrames > 0) player.invFrames--;

    // Hitstop: entrambi i personaggi si "congelano" per qualche frame al momento del colpo
    if (player.hitstopFrames > 0) { player.hitstopFrames--; return; }

    player.stateFrame++; // Conta i frame nello stato corrente

    // Hitstun: il personaggio non può fare nulla, rimane in stato HIT
    if (player.hitstun > 0) {
        player.hitstun--;
        setState(player, 'HIT');
        return;
    }
    // Knockdown: il personaggio è a terra dopo un colpo che causa caduta
    if (player.knockdownFrames > 0) {
        player.knockdownFrames--;
        setState(player, 'KNOCKDOWN');
        return;
    }
    // Blockstun: il personaggio ha bloccato ma non può ancora agire
    if (player.blockstun > 0) {
        player.blockstun--;
        setState(player, 'BLOCK');
        return;
    }

    // Fine dell'animazione di attacco: torna a IDLE o JUMP
    if (player.state === 'ATTACK' || player.state === 'SHORYUKEN') {
        const def = getAttackDef(player);
        if (def && player.stateFrame > def.totalFrames) {
            player.attackCharge = 0; // Azzera la carica dell'attacco pesante
            setState(player, player.isGrounded ? 'IDLE' : 'JUMP');
        }
        return;
    }

    // Fine del dash: torna a IDLE o JUMP
    if (player.state === 'DASHING') {
        if (player.stateFrame >= DASH_FRAMES) setState(player, player.isGrounded ? 'IDLE' : 'JUMP');
        return;
    }
    // Fine della schivata: torna a IDLE o JUMP
    if (player.state === 'DODGING') {
        if (player.stateFrame >= DODGE_FRAMES) setState(player, player.isGrounded ? 'IDLE' : 'JUMP');
        return;
    }
    // Stato CHARGING: accumula carica finché il tasto heavy è tenuto premuto.
    // Quando viene rilasciato, scatena l'attacco pesante caricato.
    if (player.state === 'CHARGING') {
        if (player.inputHeavy) { player.attackCharge = clamp(player.attackCharge + 4, 0, 100); return; }
        startAttack(player, 'HEAVY');
        return;
    }

    // Auto-face opponent: il personaggio guarda sempre verso l'avversario
    if (opponent) {
        player.facing = opponent.x + PLAYER_W / 2 >= player.x + PLAYER_W / 2 ? 'right' : 'left';
    }

    // Tentativi di azioni speciali di movimento (hanno priorità sugli attacchi)
    if (tryDash(player, frame)) return;
    if (tryDodge(player)) return;

    // Edge detection dei bottoni: true solo nel frame in cui vengono premuti (non se tenuti)
    const lightPressed = player.inputLight && !player.prevLight;
    const heavyPressed = player.inputHeavy && !player.prevHeavy;
    const jumpPressed  = player.inputJump  && !player.prevJump;

    // Salto e doppio salto: il secondo salto ha forza ridotta (DOUBLE_JUMP_MULT)
    if (jumpPressed && player.jumpCount < 2) {
        player.vy = player.jumpCount === 0 ? -JUMP_FORCE : -JUMP_FORCE * DOUBLE_JUMP_MULT;
        player.jumpCount++;
        player.isGrounded = false;
        setState(player, 'JUMP');
        return;
    }

    if (lightPressed && canAct(player)) {
        // Hadoken: down, down-forward, forward + light
        // Richiede il pattern "236A" e la barra super piena (100)
        if (detectSpecial(player, '236A') && player.superMeter >= 100) {
            player.superMeter = 0; // Consuma la barra super
            setState(player, 'ATTACK', 'PROJECTILE');
            player.attackTimer = 22;
            onProjectile(spawnProjectile(player, frame)); // Crea il proiettile
            player.inputQueue = []; // Svuota la coda per evitare doppi trigger
            return;
        }
        // Attacco leggero a terra, aereo in volo
        startAttack(player, player.isGrounded ? 'LIGHT' : 'AERIAL');
        return;
    }

    if (heavyPressed && canAct(player)) {
        // Shoryuken: forward, down, down + heavy
        // Richiede il pattern "22B" e la barra super piena (100)
        if (detectSpecial(player, '22B') && player.superMeter >= 100) {
            player.superMeter = 0;
            startUppercut(player);
            player.inputQueue = [];
            return;
        }
        if (player.inputCrouch && player.isGrounded) startAttack(player, 'SWEEP'); // Sweep accucciato
        else if (player.isGrounded) setState(player, 'CHARGING');                  // Carica l'heavy
        else startAttack(player, 'AERIAL');                                         // Aereo in volo
        return;
    }

    // Blocco: solo a terra, solo se libero di agire
    if (player.inputBlock && player.isGrounded && canAct(player)) {
        player.isBlocking = true;
        player.blockHeight = player.inputCrouch ? 'LOW' : 'MID'; // Blocco basso o medio
        setState(player, 'BLOCK');
        return;
    }
    player.isBlocking = false; // Se non si preme block, non si sta bloccando

    // Accovacciata
    if (player.inputCrouch && player.isGrounded && canAct(player)) {
        setState(player, 'CROUCHING');
        return;
    }

    // Determinazione dello stato di default in base alla situazione
    if (!player.isGrounded) setState(player, 'JUMP');
    else if (Math.abs(player.vx) > 0.04 || player.inputMove !== 0) setState(player, 'MOVE');
    else setState(player, 'IDLE');
}

// ─── Physics ──────────────────────────────────────────────────────────────────

// Aggiorna posizione e velocità del giocatore ogni frame (integrazione Eulero).
// Gestisce: decadimento del knockback, accelerazione/freno orizzontale,
// gravità e fast fall, atterraggio, limiti del palcoscenico.
function updatePhysics(player: FighterPlayer): void {
    if (player.state === 'KO' || player.hitstopFrames > 0) return; // Nessuna fisica se KO o in hitstop

    // Knockback: forza orizzontale applicata da un colpo subito, decade per attrito
    if (player.knockbackX !== 0) {
        player.vx = player.knockbackX;
        const decay = FRICTION * 0.35 * FRAME_DT;
        player.knockbackX = Math.abs(player.knockbackX) <= decay ? 0
            : player.knockbackX > 0 ? player.knockbackX - decay : player.knockbackX + decay;
    }

    // "Locked": stati in cui il giocatore non può muoversi volontariamente
    const locked = player.inputCrouch || player.state === 'BLOCK' || player.state === 'CHARGING'
        || isAttacking(player) || player.hitstun > 0 || player.blockstun > 0 || player.knockdownFrames > 0;

    if (player.state === 'DASHING' || player.state === 'DODGING') {
        // Slow down naturally during dash/dodge
        // Il vx è già stato impostato in tryDash/tryDodge; qui decade naturalmente
        const decay = FRICTION * 0.18 * FRAME_DT;
        player.vx = Math.abs(player.vx) <= decay ? 0 : player.vx > 0 ? player.vx - decay : player.vx + decay;
    } else if (!locked) {
        // Movimento volontario: accelera verso la direzione dell'input, frena se neutro
        const accel = player.isGrounded ? ACCELERATION : AIR_ACCELERATION;
        if (player.inputMove !== 0) {
            player.vx = clamp(player.vx + player.inputMove * accel * FRAME_DT, -MAX_WALK_SPEED, MAX_WALK_SPEED);
        } else {
            const dec = FRICTION * FRAME_DT;
            player.vx = Math.abs(player.vx) <= dec ? 0 : player.vx > 0 ? player.vx - dec : player.vx + dec;
        }
    } else if (player.isGrounded && player.knockbackX === 0) {
        // A terra e bloccato ma senza knockback: applica solo l'attrito per fermarsi
        const dec = FRICTION * FRAME_DT;
        player.vx = Math.abs(player.vx) <= dec ? 0 : player.vx > 0 ? player.vx - dec : player.vx + dec;
    }

    // Gravità: accelera la caduta; FAST_FALL aumenta la gravità durante la discesa (vy > 0)
    if (!player.isGrounded) {
        player.vy += GRAVITY * (player.vy > 0 ? FAST_FALL : 1) * FRAME_DT;
    }

    // Integrazione della posizione (Eulero esplicito)
    player.x += player.vx * FRAME_DT;
    player.y += player.vy * FRAME_DT;

    // Atterraggio: se il personaggio tocca o supera il pavimento
    if (player.y >= GROUND_Y) {
        player.y = GROUND_Y;
        if (player.vy > 0) player.vy = 0; // Azzera solo la velocità di caduta
        player.isGrounded = true;
        player.jumpCount = 0; // Reimposta i salti disponibili
        // Transizione automatica allo stato corretto all'atterraggio
        if (player.state === 'JUMP') setState(player, Math.abs(player.vx) > 0.04 ? 'MOVE' : 'IDLE');
    } else {
        player.isGrounded = false;
    }

    // Limiti laterali del palcoscenico: il personaggio non può uscire dall'arena
    player.x = clamp(player.x, -1, 1 - PLAYER_W);
}

// Separa i due giocatori se le loro pushbox si sovrappongono.
// Calcola la sovrapposizione e sposta entrambi nella direzione opposta in egual misura.
// Rispetta i limiti del palcoscenico anche dopo la separazione.
function separatePlayers(players: FighterPlayer[]): void {
    if (players.length < 2) return;
    const a = players[0], b = players[1];
    const pa = pushbox(a), pb = pushbox(b);
    if (!aabb(pa, pb)) return; // Nessuna sovrapposizione: non fare nulla

    // Calcola la metà della sovrapposizione + piccolo margine per evitare re-collisione
    const overlap = Math.min(pa.x + pa.w - pb.x, pb.x + pb.w - pa.x) / 2 + 0.001;
    if (a.x < b.x) { a.x -= overlap; b.x += overlap; }
    else            { a.x += overlap; b.x -= overlap; }
    a.x = clamp(a.x, -1, 1 - PLAYER_W);
    b.x = clamp(b.x, -1, 1 - PLAYER_W);
}

// ─── Combat resolution ────────────────────────────────────────────────────────

// Applica l'effetto di un colpo andato a segno sull'attaccante e sul difensore.
// Gestisce: block check (danno ridotto se bloccato), danno alla vita, super meter,
// hitstop, hitstun/blockstun, knockback, knockdown, combo counter.
function applyHit(attacker: FighterPlayer, defender: FighterPlayer, atk: AttackDef): void {
    if (defender.state === 'KO' || defender.invFrames > 0) return; // Non colpire chi è già KO o invulnerabile
    if (attacker.alreadyHit[defender.id]) return; // Ogni attacco colpisce il difensore una sola volta
    attacker.alreadyHit[defender.id] = true;

    // Block check: l'attacco è bloccato se il difensore sta bloccando E l'altezza è compatibile
    // (es. un LOW non viene bloccato con blocco MID)
    const blocked = defender.isBlocking
        && (atk.height !== 'LOW' || defender.blockHeight === 'LOW');

    // Danno ridotto al 20% se bloccato, almeno 1
    const damage = blocked ? Math.max(1, Math.floor(atk.damage * 0.2)) : atk.damage;
    defender.health = Math.max(0, defender.health - damage);
    defender.damageFlashTimer = blocked ? 8 : 18; // Flash più breve se bloccato

    // Hitstop: entrambi i personaggi si fermano per qualche frame (feedback visivo del colpo)
    defender.hitstopFrames = atk.hitstop;
    attacker.hitstopFrames = atk.hitstop;

    // La barra super si riempie colpendo (più per l'attaccante) o subendo colpi (meno per il difensore)
    attacker.superMeter = clamp(attacker.superMeter + damage * 1.8, 0, 100);
    defender.superMeter = clamp(defender.superMeter + damage * 0.8, 0, 100);
    attacker.totalDamageDealt += damage;

    if (blocked) {
        // Colpo bloccato: solo blockstun, nessun knockback
        defender.blockstun = atk.blockstun;
        setState(defender, 'BLOCK');
    } else {
        // Colpo subito: hitstun, knockback, eventuale knockdown
        defender.hitstun = atk.hitstun;
        defender.knockbackX = atk.knockback * (defender.x > attacker.x ? 1 : -1); // Direzione del knockback
        if (atk.causesKnockdown) defender.knockdownFrames = 60; // 1 secondo di knockdown
        setState(defender, atk.causesKnockdown ? 'KNOCKDOWN' : 'HIT');

        // Aggiorna il contatore combo dell'attaccante
        attacker.comboCount = attacker.comboTimer > 0 ? attacker.comboCount + 1 : 1;
        attacker.comboTimer = COMBO_TIMEOUT; // Resetta il timer di combo
        attacker.maxCombo = Math.max(attacker.maxCombo, attacker.comboCount);
    }
}

// Risolve il combattimento tra i due giocatori ogni frame.
// Per ogni giocatore attivo, calcola se l'hitbox del suo attacco interseca
// la hurtbox dell'avversario (tenendo conto dell'altezza).
// Caso speciale: se le due hitbox si scontrano (clashing), nessuno subisce danno.
// Se il giocatore usa l'attacco HEAVY con carica, il danno e il knockback vengono scalati.
function resolveCombat(players: FighterPlayer[]): void {
    if (players.length < 2) return;
    const [a, b] = players;

    // Costruisce il dato di attacco attivo per un giocatore (null se non è nel frame attivo dell'hitbox)
    const getStrike = (p: FighterPlayer) => {
        const def = getAttackDef(p);
        if (!def) return null;
        // L'hitbox è attiva solo tra startFrame e endFrame
        if (p.stateFrame < def.startFrame || p.stateFrame > def.endFrame) return null;
        // Scale heavy attack by charge
        if (p.attackType === 'HEAVY' && p.attackCharge > 0) {
            const m = 1 + Math.min(1, p.attackCharge / 100); // Moltiplicatore massimo 2x
            return { rect: hitboxRect(p, def), def: { ...def, damage: Math.round(def.damage * m), knockback: def.knockback * m } };
        }
        return { rect: hitboxRect(p, def), def };
    };

    const sa = getStrike(a);
    const sb = getStrike(b);

    // Applica il colpo di A su B solo se B non sta anche colpendo con la sua hitbox nello stesso punto (clash)
    if (sa) if (!sb || !aabb(sa.rect, sb.rect)) {
        if (aabb(sa.rect, hurtbox(b, sa.def.height))) applyHit(a, b, sa.def);
    }
    // Stesso per B su A
    if (sb) if (!sa || !aabb(sb.rect, sa.rect)) {
        if (aabb(sb.rect, hurtbox(a, sb.def.height))) applyHit(b, a, sb.def);
    }
}

// Aggiorna tutti i proiettili in volo ogni frame.
// Muove ciascun proiettile, decrementa la sua durata di vita,
// e controlla le collisioni con tutti i difensori (tranne il proprietario).
// Restituisce solo i proiettili ancora validi (filtra quelli scaduti, fuori schermo o che hanno colpito).
function updateProjectiles(projectiles: Projectile[], players: Record<string, FighterPlayer>): Projectile[] {
    return projectiles.filter(proj => {
        proj.x += proj.vx * FRAME_DT; // Aggiorna la posizione
        proj.lifeSpan--;
        // Rimuovi se scaduto o fuori dall'arena
        if (proj.lifeSpan <= 0 || proj.x < -1.2 || proj.x > 1.2) return false;

        // Rettangolo di collisione del proiettile
        const pr = {
            x: proj.x - ATTACK_PROJECTILE.w / 2,
            y: proj.y - ATTACK_PROJECTILE.h / 2,
            w: ATTACK_PROJECTILE.w,
            h: ATTACK_PROJECTILE.h
        };
        // Controlla collisione con ogni difensore (escluso il proprietario e chi è già stato colpito)
        for (const defender of Object.values(players)) {
            if (defender.id === proj.ownerId || proj.alreadyHit[defender.id]) continue;
            if (aabb(pr, hurtbox(defender, 'MID'))) {
                const owner = players[proj.ownerId];
                if (owner) { proj.alreadyHit[defender.id] = true; applyHit(owner, defender, ATTACK_PROJECTILE); }
                return false; // Il proiettile scompare dopo aver colpito
            }
        }
        return true; // Il proiettile continua a esistere
    });
}

// ─── Server ───────────────────────────────────────────────────────────────────

// FighterServer è il motore autoritativo del gioco (gira lato server).
// Mantiene lo stato di verità: giocatori, proiettili, fase del match, timer.
// Riceve gli input dai client tramite tick() e avanza la simulazione a frame fissi (60fps).
// Invia lo snapshot dello stato aggiornato ai client ad ogni tick.
export class FighterServer extends GameServer {
    private players: Record<string, FighterPlayer> = {};
    private projectiles: Projectile[] = [];
    private frame = 0;          // Contatore di frame assoluto
    private accumulator = 0;    // Accumulatore di tempo per il loop a frame fissi
    private roundTime = ROUND_TIME;
    private phase: MatchPhase = 'COUNTDOWN';
    private countdownFrames = COUNTDOWN_FRAMES;
    private roundEndFrames = 0;
    private resultFrames = RESULT_FRAMES;
    private roundNumber = 1;
    private roundWinner: string | null = null;
    private matchWinner: string | null = null;

    // Inizializza il server con i dati dei giocatori (max 2).
    // Crea i FighterPlayer e avvia il primo round (senza avanzare il numero).
    init(playerBaseData: Record<string, Player>): void {
        Object.keys(playerBaseData).slice(0, 2).forEach((id, i) => {
            this.players[id] = createPlayer(id, playerBaseData[id], i === 0);
        });
        this.resetRound(false);
    }

    // Chiamata ad ogni aggiornamento di rete (tick variabile).
    // 1. Applica gli input ricevuti dai client ai rispettivi giocatori.
    // 2. Usa un accumulator per eseguire un numero intero di stepFrame() a 60fps fissi,
    //    indipendentemente dalla frequenza di chiamata di tick().
    // 3. Restituisce lo snapshot dello stato attuale da inviare ai client.
    tick(msgs: IncomingMsg[], dt: number): OutgoingMsg[] {
        // Applica gli input di ogni messaggio al giocatore corrispondente
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

        // Fixed timestep loop: esegue al massimo 5 step per tick per evitare spiral of death
        this.accumulator += Math.min(dt, 0.08);
        let steps = 0;
        while (this.accumulator >= FRAME_DT && steps < 5) {
            this.stepFrame();
            this.accumulator -= FRAME_DT;
            steps++;
        }
        return [{ payload: this.snapshot() }];
    }

    // Il server ha finito quando la fase è RESULTS e i frame di attesa sono esauriti
    isFinished(): boolean {
        return this.phase === 'RESULTS' && this.resultFrames <= 0;
    }

    // Esegue un singolo frame di simulazione del gioco (chiamato da tick()).
    // Gestisce la macchina a stati del match: COUNTDOWN → ACTIVE → ROUND_END → RESULTS.
    // In fase ACTIVE: aggiorna tutti i giocatori, la fisica, la separazione, il combattimento e i proiettili.
    private stepFrame(): void {
        this.frame++;

        // COUNTDOWN: attende che il conto alla rovescia finisca prima di iniziare il round
        if (this.phase === 'COUNTDOWN') {
            if (--this.countdownFrames <= 0) this.phase = 'ACTIVE';
            this.endFrameInputs();
            return;
        }
        // ROUND_END: attende la pausa di fine round, poi decide se è fine match o nuovo round
        if (this.phase === 'ROUND_END') {
            if (--this.roundEndFrames <= 0) {
                if (this.matchWinner) this.phase = 'RESULTS';
                else this.resetRound(true); // Avanza al prossimo round
            }
            this.endFrameInputs();
            return;
        }
        // RESULTS: attende i frame finali prima di terminare la sessione
        if (this.phase === 'RESULTS') {
            this.resultFrames--;
            this.endFrameInputs();
            return;
        }

        // ACTIVE: logica di gioco principale
        const list = Object.values(this.players);
        list.forEach(p => {
            const opp = list.find(o => o.id !== p.id) ?? null;
            updatePlayer(p, opp, this.frame, proj => this.projectiles.push(proj));
        });
        list.forEach(updatePhysics);   // Fisica separata (posizione, gravità, attrito)
        separatePlayers(list);          // Risoluzione delle collisioni fisiche tra i due personaggi
        resolveCombat(list);            // Rilevamento hitbox e applicazione dei danni
        this.projectiles = updateProjectiles(this.projectiles, this.players);

        this.roundTime = Math.max(0, this.roundTime - FRAME_DT); // Decrementa il timer del round
        this.checkRoundEnd(); // Controlla se il round è finito
        this.endFrameInputs();
    }

    // Copia gli input correnti nei "prev" per il frame successivo.
    // Permette di rilevare "appena premuto" vs "tenuto premuto" nel frame successivo.
    private endFrameInputs(): void {
        Object.values(this.players).forEach(p => {
            p.prevLight     = p.inputLight;
            p.prevHeavy     = p.inputHeavy;
            p.prevJump      = p.inputJump;
            p.prevDodge     = p.inputDodge;
            p.prevInputMove = p.inputMove;
        });
    }

    // Resetta lo stato del round ricreando i FighterPlayer (vita piena, posizione iniziale, ecc.)
    // ma preservando le statistiche di match (roundsWon, totalDamageDealt, maxCombo).
    // Se advance=true, incrementa il numero del round.
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

    // Verifica se il round è terminato (un giocatore senza vita, o timer esaurito).
    // In caso di timeout, vince chi ha più vita; in caso di pareggio esatto, nessuno vince il round.
    private checkRoundEnd(): void {
        if (this.phase !== 'ACTIVE') return;
        const ids = Object.keys(this.players);
        const dead = ids.find(id => this.players[id].health <= 0);

        if (dead) {
            // Il giocatore che ha ancora vita vince il round
            this.endRound(ids.find(id => id !== dead) ?? null);
            return;
        }
        if (this.roundTime <= 0) {
            // Timeout: vince chi ha più vita
            const [first, second] = ids.map(id => this.players[id]).sort((a, b) => b.health - a.health);
            this.endRound(first.health > (second?.health ?? -1) ? first.id : null);
        }
    }

    // Conclude il round: imposta la fase ROUND_END, assegna il round al vincitore,
    // mette in stato KO chi ha 0 vita, e controlla se qualcuno ha raggiunto ROUNDS_TO_WIN.
    private endRound(winner: string | null): void {
        this.phase          = 'ROUND_END';
        this.roundEndFrames = ROUND_END_FRAMES;
        this.roundWinner    = winner;
        if (winner && this.players[winner]) this.players[winner].roundsWon++;
        Object.values(this.players).forEach(p => { if (p.health <= 0) setState(p, 'KO'); });
        // Controlla se c'è un vincitore del match
        const champ = Object.values(this.players).find(p => p.roundsWon >= ROUNDS_TO_WIN);
        if (champ) this.matchWinner = champ.id;
    }

    // Crea un oggetto "snapshot" con tutto lo stato del gioco da inviare ai client.
    // Il client usa questo per sincronizzare la sua visualizzazione con lo stato server.
    private snapshot() {
        return {
            players: this.players,
            projectiles: this.projectiles,
            roundTime: this.roundTime,
            roundActive: this.phase === 'ACTIVE',
            phase: this.phase,
            countdown: Math.ceil(this.countdownFrames / FRAME_RATE), // In secondi interi
            roundNumber: this.roundNumber,
            bestOf: BEST_OF_ROUNDS,
            roundWinner: this.roundWinner,
            winner: this.matchWinner ?? this.roundWinner,
            matchWinner: this.matchWinner
        };
    }
}

// ─── Client ───────────────────────────────────────────────────────────────────

// FighterClient gestisce il lato grafico e di input del gioco (gira nel browser).
// Riceve gli snapshot dal server tramite handleMessage() e li usa per aggiornare
// lo stato locale da disegnare. Non esegue logica di gioco autoritativa.
export class FighterClient extends GameClient {
    private players: Record<string, FighterPlayer> | null = null;
    private projectiles: Projectile[] = [];
    private animations: Record<string, AnimationManager> = {}; // Gestori animazione per ogni giocatore
    private roundTime = ROUND_TIME;
    private phase: MatchPhase = 'COUNTDOWN';
    private countdown = 3;
    private roundNumber = 1;
    private roundWinner: string | null = null;
    private matchWinner: string | null = null;
    private gameOverTimer = 0; // Timer post-match prima di uscire dalla schermata risultati
    private input: UserInputFighterExtended;

    // Se l'input fornito non è già un UserInputFighterExtended, ne crea uno nuovo
    // (compatibilità con la classe base UserInput)
    constructor(userInput: UserInput, myId: string) {
        const fi = userInput instanceof UserInputFighterExtended
            ? userInput
            : new UserInputFighterExtended(userInput.canvas);
        super(fi, myId);
        this.input = fi;
    }

    // Inizializza il client: crea i FighterPlayer locali e i loro AnimationManager
    async init(playerBaseData: Record<string, Player>): Promise<void> {
        this.players = {};
        Object.keys(playerBaseData).slice(0, 2).forEach((id, i) => {
            this.players![id] = createPlayer(id, playerBaseData[id], i === 0);
            this.animations[id] = createDefaultFighterAnimationManager();
        });
    }

    // Disegna un frame completo: palcoscenico, proiettili, personaggi, HUD, info round.
    // Usa una trasformazione canvas per lavorare in coordinate normalizzate (-1..1).
    draw(ctx: CanvasRenderingContext2D, dt: number): void {
        if (!this.players) return;
        const { screenW, screenH } = this.input;

        ctx.save();
        // Trasformazione: centro del canvas = (0,0), scala = metà larghezza/altezza
        ctx.translate(screenW / 2, screenH / 2);
        ctx.scale(screenW / 2, screenH / 2);
        this.drawStage(ctx);
        this.drawProjectiles(ctx);
        Object.values(this.players).forEach(p => this.drawPlayer(ctx, p, dt));
        ctx.restore();

        // HUD e info round in pixel assoluti (sopra la scena normalizzata)
        this.drawUI(ctx, screenW, screenH);
        this.drawRoundInfo(ctx, screenW, screenH, dt);
    }

    // Aggiorna lo stato locale del client con i dati ricevuti dal server.
    // Per i giocatori già esistenti usa Object.assign (aggiornamento parziale),
    // per i nuovi li crea da zero con il proprio AnimationManager.
    handleMessage(message: any): void {
        if (!this.players) return;
        const payload = message.payload ?? message;

        if (payload.players) {
            Object.keys(payload.players).forEach(id => {
                if (!this.players![id]) {
                    this.players![id] = payload.players[id];
                    this.animations[id] = createDefaultFighterAnimationManager();
                } else {
                    Object.assign(this.players![id], payload.players[id]); // Merge dei campi aggiornati
                }
            });
        }

        // Aggiorna i campi di stato del match se presenti nel payload
        if (payload.projectiles !== undefined) this.projectiles  = payload.projectiles;
        if (payload.roundTime   !== undefined) this.roundTime    = payload.roundTime;
        if (payload.phase       !== undefined) this.phase        = payload.phase;
        if (payload.countdown   !== undefined) this.countdown    = payload.countdown;
        if (payload.roundNumber !== undefined) this.roundNumber  = payload.roundNumber;
        if (payload.roundWinner !== undefined) this.roundWinner  = payload.roundWinner;
        if (payload.matchWinner !== undefined) this.matchWinner  = payload.matchWinner;
    }

    // Raccoglie gli input del frame corrente e li serializza in un messaggio da inviare al server.
    // Viene chiamato ogni frame; il server riceverà questi dati nel prossimo tick().
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

    // Il client ha finito quando la partita è in RESULTS, c'è un vincitore,
    // e sono passati più di 4 secondi dalla schermata risultati
    isFinished(): boolean {
        return this.phase === 'RESULTS' && this.matchWinner !== null && this.gameOverTimer > 4;
    }

    // Disegna il palcoscenico: sfondo con gradiente viola/scuro, pavimento grigio,
    // e linee prospettiche verticali sul pavimento per dare profondità.
    private drawStage(ctx: CanvasRenderingContext2D): void {
        const grad = ctx.createLinearGradient(0, -1, 0, 1);
        grad.addColorStop(0,    '#101032');
        grad.addColorStop(0.55, '#231544');
        grad.addColorStop(1,    '#151515');
        ctx.fillStyle = grad;
        ctx.fillRect(-1, -1, 2, 2); // Sfondo completo

        ctx.fillStyle = '#38323d';
        ctx.fillRect(-1, GROUND_Y, 2, 1 - GROUND_Y); // Pavimento

        // Linee prospettiche sul pavimento
        ctx.strokeStyle = 'rgba(255,255,255,0.12)';
        ctx.lineWidth = 0.006;
        for (let x = -1; x <= 1; x += 0.1) {
            ctx.beginPath();
            ctx.moveTo(x, GROUND_Y);
            ctx.lineTo(x - 0.25, 1);
            ctx.stroke();
        }
    }

    // Disegna tutti i proiettili attivi come cerchi azzurri con un effetto di pulsazione
    // (scala oscillante nel tempo tramite Math.sin per simulare l'energia del proiettile).
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

    // Disegna un singolo personaggio con animazione, ombra, effetti di blocco/invulnerabilità
    // e gli effetti visivi degli attacchi. Usa l'AnimationManager per aggiornare il frame
    // dell'animazione e ottenere i dati della posa (inclinazione, opacità, ecc.).
    private drawPlayer(ctx: CanvasRenderingContext2D, player: FighterPlayer, dt: number): void {
        const anim = this.animations[player.id] ?? createDefaultFighterAnimationManager();
        this.animations[player.id] = anim;
        anim.setState(player.state);       // Sincronizza lo stato dell'animazione con lo stato del gioco
        anim.flipSprite(player.facing);    // Specchia il personaggio in base alla direzione
        anim.updateAnimation(dt);          // Avanza il frame dell'animazione

        const drawPerson = getCharacterDrawFunction(player.character);
        const cx = player.x + PLAYER_W / 2; // Centro orizzontale del personaggio
        const crouchScale = player.state === 'CROUCHING' || player.inputCrouch ? 0.58 : 1; // Schiaccia il personaggio se accovacciato
        const ch = PLAYER_H * crouchScale;
        const cy = player.y - ch / 2;

        ctx.save();
        // Ombra ellittica a terra
        ctx.beginPath();
        ctx.ellipse(cx, GROUND_Y, PLAYER_W / 2, 0.03, 0, 0, Math.PI * 2);
        ctx.fillStyle = 'rgba(0,0,0,0.35)';
        ctx.fill();

        // Disegno del personaggio
        ctx.save();
        ctx.translate(cx, cy);
        if (player.facing === 'left') ctx.scale(-1, 1); // Specchia orizzontalmente
        if (anim.poseData) ctx.rotate((anim.poseData.bodyTilt * Math.PI) / 180 * 0.3); // Inclinazione del corpo
        ctx.globalAlpha = anim.poseData?.opacity ?? 1;

        // Flash bianco quando si subisce danno (ogni 2 frame)
        const flash = player.damageFlashTimer > 0 && Math.floor(player.damageFlashTimer / 2) % 2 === 0;
        drawPerson(ctx, 0, 0, PLAYER_W, ch, flash ? { skinColor: '#ffffff', magicColor: '#ffffff' } : {});
        this.drawAttackEffect(ctx, player, anim.poseData); // Effetti visivi dell'attacco
        ctx.restore();

        // Block/invuln overlays
        ctx.save();
        ctx.translate(cx, cy);
        if (player.isBlocking) {
            // Rettangolo viola attorno al personaggio durante il blocco
            ctx.strokeStyle = '#9b59ff';
            ctx.lineWidth = 0.012;
            ctx.strokeRect(-PLAYER_W / 2 - 0.02, -ch / 2 - 0.02, PLAYER_W + 0.04, ch + 0.04);
        }
        if (player.invFrames > 0) {
            // Ellisse azzurra attorno al personaggio durante l'invulnerabilità (schivata/shoryuken)
            ctx.strokeStyle = '#8df7ff';
            ctx.lineWidth = 0.008;
            ctx.beginPath();
            ctx.ellipse(0, 0, PLAYER_W * 0.75, ch * 0.55, 0, 0, Math.PI * 2);
            ctx.stroke();
        }
        ctx.restore();

        ctx.restore();
    }

    // Disegna l'effetto visivo dell'attacco corrente del personaggio (rettangoli colorati che
    // rappresentano pugni, calci, ecc.). Ogni tipo di attacco ha colore e posizione diversi.
    // Per lo SHORYUKEN l'effetto ruota durante l'animazione. Per la CHARGING mostra un cerchio
    // pulsante che cresce con la carica accumulata.
    private drawAttackEffect(ctx: CanvasRenderingContext2D, player: FighterPlayer, pose?: any): void {
        const side = pose?.armSide === 'front' ? 1 : -1; // Lato del braccio che colpisce
        switch (player.attackType) {
            case 'LIGHT':
                ctx.fillStyle = '#f1c40f'; // Giallo
                ctx.fillRect(PLAYER_W * (0.2 + side * 0.3), -PLAYER_H * 0.2, PLAYER_W * 0.5, PLAYER_H * 0.08);
                break;
            case 'HEAVY':
                ctx.fillStyle = '#e74c3c'; // Rosso
                ctx.fillRect(PLAYER_W * (0.15 + side * 0.4), -PLAYER_H * 0.24, PLAYER_W * 0.7, PLAYER_H * 0.12);
                break;
            case 'SHORYUKEN': {
                // L'effetto ruota progressivamente durante l'esecuzione della mossa
                const t = Math.min(1, player.stateFrame / ATTACK_UPPERCUT.totalFrames);
                const angle = (player.facing === 'right' ? -1 : 1) * (Math.PI / 2) * t;
                ctx.save();
                ctx.translate(PLAYER_W * 0.15, -PLAYER_H * 0.24);
                ctx.rotate(angle);
                ctx.fillStyle = '#e74c3c';
                ctx.fillRect(0, -PLAYER_H * 0.06, PLAYER_W * 0.7, PLAYER_H * 0.12);
                ctx.restore();
                break;
            }
            case 'SWEEP':
                ctx.fillStyle = '#f39c12'; // Arancio
                ctx.fillRect(0, PLAYER_H * 0.12, PLAYER_W, PLAYER_H * 0.06);
                break;
            case 'AERIAL':
                ctx.fillStyle = '#3498db'; // Blu
                ctx.fillRect(PLAYER_W * (0.1 + side * 0.25), -PLAYER_H * 0.3, PLAYER_W * 0.4, PLAYER_H * 0.1);
                break;
        }
        if (player.state === 'CHARGING') {
            // Cerchio che cresce con la carica accumulata
            ctx.strokeStyle = '#ffef5a';
            ctx.lineWidth = 0.008;
            ctx.beginPath();
            ctx.arc(0, 0, PLAYER_W * (0.8 + player.attackCharge / 180), 0, Math.PI * 2);
            ctx.stroke();
        }
    }

    // Disegna l'HUD (heads-up display): barre della vita, barre super, round vinti, combo.
    // Ogni giocatore ha la propria barra sul lato corrispondente dello schermo.
    // Il colore della barra vita cambia da verde (>55%) a giallo (>25%) a rosso (<25%).
    private drawUI(ctx: CanvasRenderingContext2D, w: number, h: number): void {
        if (!this.players) return;
        const ids = Object.keys(this.players);
        const margin = 50, barW = w * 0.28, barH = 34;

        ids.forEach((id, i) => {
            const p = this.players![id];
            const left = i === 0; // Il giocatore 0 è a sinistra
            const x = left ? margin : w - margin - barW;
            const y = 42;
            const ax = left ? x : x + barW; // Anchor per il testo allineato

            // Nome del giocatore
            ctx.font = 'bold 28px Impact';
            ctx.fillStyle = 'white';
            ctx.textAlign = left ? 'left' : 'right';
            ctx.fillText(p.name.toUpperCase(), ax, y - 12);

            // HP bar
            ctx.fillStyle = '#333'; // Sfondo della barra
            ctx.fillRect(x, y, barW, barH);
            const hpW = Math.max(0, p.health / MAX_HEALTH) * barW;
            // Colore della barra in base alla vita rimanente
            ctx.fillStyle = p.health > 55 ? '#27ae60' : p.health > 25 ? '#f1c40f' : '#c0392b';
            // La barra del giocatore 2 si svuota da destra verso sinistra
            ctx.fillRect(left ? x : x + barW - hpW, y, hpW, barH);
            ctx.strokeStyle = 'white';
            ctx.lineWidth = 3;
            ctx.strokeRect(x, y, barW, barH);

            // HP number
            ctx.fillStyle = 'white';
            ctx.font = 'bold 18px Arial';
            ctx.textAlign = 'center';
            ctx.fillText(`${Math.ceil(p.health)}`, x + barW / 2, y + 24);

            // Super meter (barra blu sotto la vita)
            const my = y + barH + 10;
            ctx.fillStyle = '#1d2635';
            ctx.fillRect(x, my, barW, 12);
            const meterW = (p.superMeter / 100) * barW;
            ctx.fillStyle = '#3498db';
            ctx.fillRect(left ? x : x + barW - meterW, my, meterW, 12);

            // Round wins: cerchi pieni per i round vinti, vuoti per quelli da vincere
            ctx.font = 'bold 22px Arial';
            ctx.fillText(
                '●'.repeat(p.roundsWon) + '○'.repeat(Math.max(0, ROUNDS_TO_WIN - p.roundsWon)),
                x + barW / 2, my + 36
            );

            // Combo counter: visibile solo se combo >= 2 e il timer è attivo
            if (p.comboCount >= 2 && p.comboTimer > 0) {
                ctx.font = 'bold 34px Impact';
                ctx.fillStyle = '#ffef5a';
                ctx.textAlign = left ? 'left' : 'right';
                ctx.fillText(`${p.comboCount} COMBO!`, ax, 150);
            }
        });

        // "VS" centrale
        ctx.font = 'bold 42px Impact';
        ctx.fillStyle = '#c0392b';
        ctx.textAlign = 'center';
        ctx.fillText('VS', w / 2, 76);

        // Numero del round corrente
        ctx.font = 'bold 22px Arial';
        ctx.fillStyle = 'white';
        ctx.fillText(`Round ${this.roundNumber}`, w / 2, 146);
    }

    // Disegna le informazioni legate alla fase del match:
    // - Timer del round (diventa rosso sotto 10 secondi)
    // - Overlay semitrasparente + testo durante il COUNTDOWN
    // - Overlay + nome del vincitore durante ROUND_END
    // - Overlay finale con statistiche durante RESULTS (vincitore match, danno totale, max combo)
    // - Istruzioni dei controlli in basso allo schermo
    private drawRoundInfo(ctx: CanvasRenderingContext2D, w: number, h: number, dt: number): void {
        // Timer del round: rosso se meno di 10 secondi
        ctx.font = 'bold 42px Arial';
        ctx.fillStyle = this.roundTime > 10 ? '#ffffff' : '#c0392b';
        ctx.textAlign = 'center';
        ctx.fillText(`${Math.ceil(Math.max(0, this.roundTime))}`, w / 2, 120);

        if (this.phase === 'COUNTDOWN') {
            // Schermata di countdown prima del round
            ctx.fillStyle = 'rgba(0,0,0,0.35)';
            ctx.fillRect(0, 0, w, h);
            ctx.font = 'bold 110px Impact';
            ctx.fillStyle = '#ffffff';
            ctx.fillText(this.countdown > 0 ? `${this.countdown}` : 'FIGHT', w / 2, h / 2);
        }

        if (this.phase === 'ROUND_END' && this.roundWinner) {
            // Annuncio del vincitore del round
            const name = this.players?.[this.roundWinner]?.name ?? 'Player';
            ctx.fillStyle = 'rgba(0,0,0,0.45)';
            ctx.fillRect(0, 0, w, h);
            ctx.font = 'bold 70px Impact';
            ctx.fillStyle = '#ffef5a';
            ctx.fillText(`${name} wins the round`, w / 2, h / 2);
        }

        if (this.phase === 'RESULTS' && this.matchWinner) {
            // Schermata finale: YOU WIN / YOU LOSE, statistiche dei giocatori
            this.gameOverTimer += dt; // Accumula il tempo per uscire automaticamente
            const winner = this.players?.[this.matchWinner]?.name ?? 'Player';
            ctx.fillStyle = 'rgba(0,0,0,0.78)';
            ctx.fillRect(0, 0, w, h);
            ctx.font = 'bold 84px Impact';
            // Verde se hai vinto, rosso se hai perso
            ctx.fillStyle = this.matchWinner === this.myId ? '#27ae60' : '#c0392b';
            ctx.fillText(this.matchWinner === this.myId ? 'YOU WIN!' : 'YOU LOSE!', w / 2, h / 2 - 110);
            ctx.font = 'bold 34px Arial';
            ctx.fillStyle = 'white';
            ctx.fillText(`${winner} wins the match`, w / 2, h / 2 - 58);
            ctx.font = '24px Arial';
            // Statistiche di entrambi i giocatori (danno totale e combo massima)
            Object.values(this.players ?? {}).forEach((p, i) => {
                ctx.fillText(`${p.name}: ${p.totalDamageDealt} dmg | max combo ${p.maxCombo}`, w / 2, h / 2 + i * 34);
            });
        } else if (this.phase !== 'RESULTS') {
            this.gameOverTimer = 0; // Resetta il timer se non siamo in RESULTS
        }

        // Istruzioni dei controlli (sempre visibili in basso)
        ctx.font = '16px Arial';
        ctx.fillStyle = 'rgba(255,255,255,0.72)';
        ctx.textAlign = 'center';
        ctx.fillText('A/D move | S crouch | Space jump/double jump | E light/special | hold R heavy | Q block | F/Shift dodge', w / 2, h - 24);
    }
}
