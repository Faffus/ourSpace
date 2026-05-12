/**
 * @file game.ts
 * @description Logica di gioco per uno shooter top-down multiplayer con ondate di zombie.
 *
 * Il gioco è diviso in due classi principali:
 *  - `shooterServer`: gira lato server, gestisce fisica, spawn, collisioni e punteggi.
 *  - `shooterClient`: gira lato client, gestisce input, rendering e animazioni.
 *
 * Architettura generale:
 *  - Il server riceve i messaggi di input dai client (posizione, direzione del mouse, sparo).
 *  - Ad ogni tick, aggiorna lo stato del mondo e invia ai client snapshot completi.
 *  - Il client interpola localmente il movimento del giocatore per ridurre la latenza percepita.
 */

import { getCollisionSide, Player } from '../common';
import { IncomingMsg, OutgoingMsg } from '../server';
import { GameClient, GameServer } from './game';

// ============================================================
// COSTANTI DI GAMEPLAY
// ============================================================

/** Bordi del campo di gioco (coordinate mondo). */
const BORDERS = {
  top: -2,
  bottom: 2,
  left: -3,
  right: 3
}

/** Larghezza del campo di gioco in unità mondo. */
const BORDERS_W = Math.abs(BORDERS.right - BORDERS.left);
/** Altezza del campo di gioco in unità mondo. */
const BORDERS_H = Math.abs(BORDERS.top - BORDERS.bottom);

/** Intervallo (secondi) tra uno spawn di zombie e il successivo. */
const SPAWN_INTERVAL = 0.5;
/** Velocità di movimento degli zombie (unità/s). */
const ZOMBIE_SPEED = 0.5;
/** Velocità di movimento del giocatore (unità/s). */
const PLAYER_SPEED = 1.3;
/** Dimensione (lato) del collider del giocatore. */
const PLAYER_SIZE = 0.2;
/** Dimensione (lato) del collider degli zombie. */
const ZOMBIE_SIZE = 0.2;
/** Raggio del proiettile per le collisioni. */
const PROJECTILE_RADIUS = 0.02;
/** Dimensione (lato) delle casse di rifornimento. */
const BOX_SIZE = 0.1;
/** Intervallo (secondi) tra la comparsa di una nuova cassa. */
const BOX_INTERVAL = 10;
/** Pausa (secondi) tra la fine di un'ondata e l'inizio della successiva. */
const WAVE_DELAY = 5;

// ============================================================
// COSTANTI DI UI
// (separate dalle costanti di gameplay perché riguardano solo
//  il rendering lato client e non la logica di simulazione)
// ============================================================

/** Dimensione in pixel dell'icona vita (flask) nella HUD. */
const FLASK_SIZE = 100;


// ============================================================
// SHOOTER SERVER
// ============================================================

/**
 * @class shooterServer
 * @extends GameServer
 * @description Lato server del gioco. Gestisce ogni frame (tick):
 *  - Ricezione input dai client (posizione, mouse, sparo)
 *  - Sistema di ondate: durata, pausa tra ondate, contatore
 *  - Spawn di zombie con indicatori visivi di avviso (pendingSpawns)
 *  - Movimento zombie con separazione reciproca
 *  - Sparo e tipi di armi (pistola, shotgun, mitraglietta)
 *  - Collisioni proiettile→zombie, zombie→giocatore, giocatore→cassa
 *  - Distribuzione dei pickup casuali nelle casse
 */
export class shooterServer extends GameServer {
  /** Mappa degli oggetti player indicizzata per ID client. */
  private players;
  /** Array degli zombie attivi nel mondo. */
  private zombies;
  /** Array dei proiettili attivi nel mondo. */
  private projectiles;
  /** Array delle casse di rifornimento presenti nel mondo. */
  private boxes;

  // RIMOSSO: private highScore — era dichiarato ma mai scritto come campo.
  // Il valore viene calcolato inline nel payload di ritorno del tick.

  /** Numero massimo di zombie contemporanei consentiti nell'ondata corrente. */
  private orde;
  /** Timer accumulatore per il respawn degli zombie (in secondi). */
  private spawnTimer;
  /** Danno inflitto da ogni proiettile agli zombie. */
  private damage;

  /** Posizione X del mouse nel sistema di coordinate mondo, per ogni client. */
  private playerMouseX: { [key: string]: number } = {};
  /** Posizione Y del mouse nel sistema di coordinate mondo, per ogni client. */
  private playerMouseY: { [key: string]: number } = {};
  /** Flag che indica se il client sta tenendo premuto il tasto di fuoco. */
  private playerIsShooting: { [key: string]: boolean } = {};

  /** Numero dell'ondata corrente (parte da 1). */
  private waveCounter;
  /** Durata totale (secondi) dell'ondata corrente. */
  private waveDuration;
  /** Tempo trascorso (secondi) dall'inizio dell'ondata corrente. */
  private currentWaveTimer;

  /** `true` se un'ondata è in corso, `false` durante la pausa. */
  private isWaveActive;
  /** Timer che conta i secondi di pausa tra le ondate. */
  private delayTimer;

  /** Timer accumulatore per la comparsa delle casse. */
  private boxTimer;
  /** Numero di casse attualmente nel mondo (massimo 2). */
  private boxCounter;
  /**
   * Spawn "in attesa": zombie che compariranno dopo un breve delay,
   * segnalati visivamente ai client come cerchi rossi.
   * Ogni elemento: { x, y, timer, delay }
   */
  private pendingSpawns;

  /**
   * Inizializza il server con la lista dei player.
   * Viene chiamata una sola volta all'avvio della partita.
   * @param players - Mappa player (chiave = clientId, valore = oggetto player).
   */
  init(players) {
    this.players = players;
    this.projectiles = [];
    this.zombies = [];
    this.spawnTimer = 0;
    this.orde = 5;          // zombie max nell'ondata iniziale
    this.damage = 35;       // danno base per proiettile

    // Inizializzazione sistema ondate
    this.waveCounter = 1;
    this.waveDuration = 20; // durata in secondi della prima ondata
    this.currentWaveTimer = 0;
    this.delayTimer = 0;
    this.isWaveActive = true;

    // Inizializzazione casse
    this.boxTimer = 0;
    this.boxCounter = 0;
    this.boxes = [];
    this.pendingSpawns = [];

    // Posizione iniziale e statistiche per ogni player
    Object.keys(players).forEach(id => {
      const player = players[id];
      player.x = 0;
      player.y = 0;
      player.score = 0;
      player.life = 3;

      player.fireRate = 0.4;        // cadenza di fuoco in secondi tra spari
      player.weaponMode = 'pistol'; // arma iniziale
      player.lastShotTime = 0;      // tempo trascorso dall'ultimo sparo
      this.playerIsShooting[id] = false;
    });
  }

  /**
   * Aggiornamento principale: viene chiamato ogni frame lato server.
   * Elabora i messaggi in entrata, aggiorna la fisica e restituisce
   * lo snapshot di stato da inviare a tutti i client.
   *
   * @param incomingMessages - Messaggi ricevuti dai client in questo frame.
   * @param dt - Delta time in secondi dall'ultimo tick.
   * @returns Array di messaggi in uscita da inviare broadcast ai client.
   */
  tick(incomingMessages: IncomingMsg[], dt: number): OutgoingMsg[] {

    // ----------------------------------------------------------
    // 1. LETTURA INPUT CLIENT
    // ----------------------------------------------------------
    // Per ogni messaggio di tipo 'move', aggiorna posizione e stato
    // di fuoco del player corrispondente.
    incomingMessages.forEach(message => {
      const id = message.clientId;
      const payload = message.payload;

      if (payload.kind === 'move') {
        const player = this.players[id];
        player.x = payload.x;
        player.y = payload.y;
        this.playerMouseX[id] = payload.mouseX || 0;
        this.playerMouseY[id] = payload.mouseY || 0;
        this.playerIsShooting[id] = payload.isShooting || false;
      }
    });

    // ----------------------------------------------------------
    // 2. SPAWN CASSE DI RIFORNIMENTO
    // ----------------------------------------------------------
    // Ogni BOX_INTERVAL secondi, se ci sono meno di 2 casse nel mondo,
    // ne spawna una in posizione casuale.
    this.boxTimer += dt;
    if (this.boxCounter < 2 && this.boxTimer >= BOX_INTERVAL) {
      this.boxTimer = 0;
      const randomX = (Math.random() - 0.5) * 4;
      const randomY = (Math.random() - 0.5) * 4;
      this.boxes.push({ x: randomX, y: randomY });
      this.boxCounter += 1;
      console.log("scatole: " + this.boxCounter);
    }

    // ----------------------------------------------------------
    // 3. LOGICA ONDATE (WAVE SYSTEM)
    // ----------------------------------------------------------
    // Alterna tra fase attiva (zombie in campo) e pausa (prep. per la prossima ondata).
    if (this.isWaveActive) {
      this.currentWaveTimer += dt;
      if (this.currentWaveTimer >= this.waveDuration) {
        // Fine ondata: svuota zombie e avvia pausa
        this.isWaveActive = false;
        this.currentWaveTimer = 0;
        this.delayTimer = 0;
        this.zombies = [];
        this.pendingSpawns = [];
        console.log("Ondata terminata! Pausa di 5 secondi...");
      }
    } else {
      // Pausa tra ondate: conta i secondi prima di iniziare la prossima
      this.delayTimer += dt;
      if (this.delayTimer >= WAVE_DELAY) {
        this.isWaveActive = true;
        this.waveCounter += 1;
        this.waveDuration += 5;   // ogni ondata dura 5 secondi in più
        this.orde += 2;           // ogni ondata aggiunge 2 zombie al massimo
        console.log(`Inizia Ondata ${this.waveCounter}!`);
      }
    }

    // ----------------------------------------------------------
    // 4. SPAWN ZOMBIE CON INDICATORE DI AVVISO
    // ----------------------------------------------------------
    // Ad ogni SPAWN_INTERVAL, se l'ondata è attiva, genera un gruppo
    // di 4-5 "pending spawn" che diventano zombie reali dopo 0.5s.
    // I pending spawn sono visibili ai client come cerchi rossi semitrasparenti.
    this.spawnTimer += dt;
    if (this.isWaveActive && this.spawnTimer >= SPAWN_INTERVAL) {
      this.spawnTimer = 0;
      const desiredGroup = Math.floor(Math.random() * 2) + 4; // 4 o 5 zombie per gruppo
      // Non superare il limite di zombie+pendingSpawn contemporanei
      const availableSlots = Math.max(0, this.orde - (this.zombies.length + this.pendingSpawns.length));
      const groupCount = Math.min(desiredGroup, availableSlots);
      if (groupCount > 0) {
        for (let i = 0; i < groupCount; i++) {
          const randomX = (Math.random() - 0.5) * 5;
          const randomY = (Math.random() - 0.5) * 5;
          this.pendingSpawns.push({ x: randomX, y: randomY, timer: 0, delay: 0.5 });
        }
      }
    }

    // Aggiorna i pending spawn: quando il loro timer raggiunge il delay,
    // li trasforma in zombie veri e propri.
    for (let i = this.pendingSpawns.length - 1; i >= 0; i--) {
      const ps = this.pendingSpawns[i];
      ps.timer += dt;
      if (ps.timer >= ps.delay) {
        this.zombies.push({ x: ps.x, y: ps.y, vita: 100 });
        this.pendingSpawns.splice(i, 1);
      }
    }

    // ----------------------------------------------------------
    // 5. GESTIONE SPARO E PROIETTILI
    // ----------------------------------------------------------
    // Per ogni player che sta sparando, genera proiettili in direzione
    // del cursore del mouse. La cadenza e la modalità variano per arma:
    //   - pistola:      1 proiettile, cadenza ~0.4s
    //   - mitraglietta: 1 proiettile, cadenza 0.1s (molto più rapida)
    //   - shotgun:      3 proiettili a ventaglio, cadenza 0.3s
    Object.keys(this.players).forEach(id => {
      const player = this.players[id];
      player.lastShotTime += dt;

      // Determina la cadenza di fuoco in base all'arma equipaggiata
      let currentFireRate = player.fireRate || 0.4;
      const wm = (player.weaponMode || '').toLowerCase();

      if (wm.includes('machine')) {
        currentFireRate = 0.1;
      } else if (wm.includes('shot')) {
        currentFireRate = 0.3;
      }
      // 'pistol' usa già il valore di default assegnato sopra

      // Spara solo se il cooldown è scaduto e il tasto è premuto
      if (this.playerIsShooting[id] && player.lastShotTime >= currentFireRate) {
        player.lastShotTime = 0;

        // Calcola la direzione normalizzata verso il mouse
        const dx = this.playerMouseX[id] - player.x;
        const dy = this.playerMouseY[id] - player.y;
        const distance = Math.sqrt(dx * dx + dy * dy);

        if (distance > 0) {
          const dirX = dx / distance;
          const dirY = dy / distance;

          if (wm.includes('shot')) {
            // Shotgun: 3 proiettili sparati a ventaglio (±10° dal centro)
            const spreadDeg = 20;
            const spreadRad = (spreadDeg * Math.PI) / 180;
            const angles = [-spreadRad / 2, 0, spreadRad / 2];
            const pelletSpeed = 4;
            const pelletLife = 1.0;
            for (const a of angles) {
              const cos = Math.cos(a);
              const sin = Math.sin(a);
              // Ruota la direzione di 'a' radianti con matrice di rotazione 2D
              const rvx = dirX * cos - dirY * sin;
              const rvy = dirX * sin + dirY * cos;
              this.projectiles.push({
                x: player.x, y: player.y,
                vx: rvx * pelletSpeed, vy: rvy * pelletSpeed,
                life: pelletLife, playerId: id
              });
            }
          } else {
            // Pistola o mitraglietta: proiettile singolo
            this.projectiles.push({
              x: player.x, y: player.y,
              vx: dirX * 4, vy: dirY * 4,
              life: 1.5, playerId: id
            });
          }
        }
      }
    });

    // Aggiorna posizione di tutti i proiettili e rimuove quelli scaduti
    this.projectiles.forEach(p => {
      p.x += p.vx * dt;
      p.y += p.vy * dt;
      p.life -= dt;
    });
    this.projectiles = this.projectiles.filter(p => p.life > 0);

    // ----------------------------------------------------------
    // 6. MOVIMENTO ZOMBIE CON SEPARAZIONE
    // ----------------------------------------------------------
    // Ogni zombie si avvicina al player più vicino ancora in vita.
    // Un secondo vettore di separazione impedisce agli zombie di
    // sovrapporsi tra loro, simulando un comportamento da branco.
    this.zombies.forEach((zombie, index) => {
      let closestPlayer = null;
      let minDistance = Infinity;

      // Trova il player più vicino ancora in vita
      Object.keys(this.players).forEach(id => {
        const player = this.players[id];
        if (player.life <= 0) return;
        const dx = player.x - zombie.x;
        const dy = player.y - zombie.y;
        const dist = Math.sqrt(dx * dx + dy * dy);
        if (dist < minDistance) {
          minDistance = dist;
          closestPlayer = player;
        }
      });

      let moveX = 0;
      let moveY = 0;

      // Forza di inseguimento verso il player
      if (closestPlayer) {
        const dx = closestPlayer.x - zombie.x;
        const dy = closestPlayer.y - zombie.y;
        const len = Math.sqrt(dx * dx + dy * dy);
        if (len > 0) {
          moveX += (dx / len) * ZOMBIE_SPEED;
          moveY += (dy / len) * ZOMBIE_SPEED;
        }
      }

      // Forza di separazione: se due zombie sono troppo vicini,
      // si spingono l'un l'altro nella direzione opposta.
      const SEPARATION_DIST = ZOMBIE_SIZE * 1.2;
      const SEPARATION_FORCE = 0.8;

      this.zombies.forEach((otherZombie, otherIndex) => {
        if (index === otherIndex) return;
        const dx = zombie.x - otherZombie.x;
        const dy = zombie.y - otherZombie.y;
        const dist = Math.sqrt(dx * dx + dy * dy);
        if (dist < SEPARATION_DIST && dist > 0) {
          moveX += (dx / dist) * SEPARATION_FORCE;
          moveY += (dy / dist) * SEPARATION_FORCE;
        }
      });

      // Applica il vettore di movimento finale
      zombie.x += moveX * dt;
      zombie.y += moveY * dt;
    });

    // ----------------------------------------------------------
    // 7. COLLISIONI PROIETTILE → ZOMBIE
    // ----------------------------------------------------------
    // Itera in ordine inverso per rimuovere elementi in sicurezza.
    // Se un proiettile colpisce uno zombie:
    //   - il proiettile viene rimosso
    //   - lo zombie subisce danno
    //   - se la vita dello zombie scende a 0, viene rimosso e
    //     il player che ha sparato guadagna 1 punto
    for (let i = this.projectiles.length - 1; i >= 0; i--) {
      const projectile = this.projectiles[i];

      for (let j = this.zombies.length - 1; j >= 0; j--) {
        const zombie = this.zombies[j];
        const ballRect = {
          x: projectile.x - PROJECTILE_RADIUS,
          y: projectile.y - PROJECTILE_RADIUS,
          w: PROJECTILE_RADIUS * 2,
          h: PROJECTILE_RADIUS * 2
        };
        const zombieRect = {
          x: zombie.x - ZOMBIE_SIZE / 2,
          y: zombie.y - ZOMBIE_SIZE / 2,
          w: ZOMBIE_SIZE,
          h: ZOMBIE_SIZE
        };

        if (getCollisionSide(ballRect, zombieRect) !== 'none') {
          zombie.vita -= this.damage;
          console.log("zombie vita: " + zombie.vita);
          this.projectiles.splice(i, 1); // rimuovi proiettile

          if (zombie.vita <= 0) {
            this.zombies.splice(j, 1); // rimuovi zombie
            const shooterId = projectile.playerId;
            if (shooterId && this.players[shooterId]) {
              this.players[shooterId].score += 1;
              console.log("player" + shooterId + ", score: " + this.players[shooterId].score);
            }
          }
          break; // un proiettile colpisce al massimo uno zombie
        }
      }
    }

    // ----------------------------------------------------------
    // 8. COLLISIONI ZOMBIE → PLAYER
    // ----------------------------------------------------------
    // Se uno zombie tocca un player, lo zombie viene rimosso (si "immola")
    // e il player perde 1 vita. Se le vite scendono a 0, il player è morto.
    Object.keys(this.players).forEach(id => {
      const player = this.players[id];
      if (player.life <= 0) return; // player già morto: ignora

      const playerRect = {
        x: player.x - PLAYER_SIZE / 2,
        y: player.y - PLAYER_SIZE / 2,
        w: PLAYER_SIZE,
        h: PLAYER_SIZE
      };

      for (let j = this.zombies.length - 1; j >= 0; j--) {
        const zombie = this.zombies[j];
        const zombieRect = {
          x: zombie.x - ZOMBIE_SIZE / 2,
          y: zombie.y - ZOMBIE_SIZE / 2,
          w: ZOMBIE_SIZE,
          h: ZOMBIE_SIZE
        };

        if (getCollisionSide(playerRect, zombieRect) !== 'none') {
          this.zombies.splice(j, 1);
          player.life -= 1;
          console.log(`Player ${id} colpito! Vite: ${player.life}`);
          if (player.life <= 0) {
            console.log(`Player ${id} è MORTO`);
          }
        }
      }
    });

    // ----------------------------------------------------------
    // 9. COLLISIONI PLAYER → CASSA (PICKUP)
    // ----------------------------------------------------------
    // Quando un player raccoglie una cassa, viene estratto casualmente
    // uno tra 3 possibili premi:
    //   - indice 0: vita extra (solo se non già al massimo di 3)
    //   - indice 1: shotgun
    //   - indice 2: mitraglietta
    Object.keys(this.players).forEach(id => {
      const player = this.players[id];
      const playerRect = {
        x: player.x - PLAYER_SIZE / 2,
        y: player.y - PLAYER_SIZE / 2,
        w: PLAYER_SIZE,
        h: PLAYER_SIZE
      };

      for (let j = this.boxes.length - 1; j >= 0; j--) {
        const box = this.boxes[j];
        const boxRect = {
          x: box.x - BOX_SIZE / 2,
          y: box.y - BOX_SIZE / 2,
          w: BOX_SIZE,
          h: BOX_SIZE
        };

        if (getCollisionSide(playerRect, boxRect) !== 'none') {
          const boxIndex = Math.floor(Math.random() * 3);
          this.boxCounter -= 1;
          this.boxes.splice(j, 1);

          if (boxIndex === 1) {
            player.weaponMode = 'shotgun';
            console.log("il player ha ottenuto: " + player.weaponMode);
          } else if (boxIndex === 2) {
            player.weaponMode = 'machineGun';
            console.log("il player ha ottenuto: " + player.weaponMode);
          } else {
            // Vita extra solo se sotto il massimo
            if (player.life < 3) {
              player.life += 1;
              console.log("il player ha ottenuto vita");
            }
          }
        }
      }
    });

    // ----------------------------------------------------------
    // 10. OUTPUT SNAPSHOT
    // ----------------------------------------------------------
    // Restituisce lo stato completo del mondo da inviare a tutti i client.
    // L'highScore è calcolato inline qui (non serve tenerlo come campo
    // della classe perché è solo un derivato degli score dei player).
    // Il campo `pendingSpawns` include il tempo rimanente normalizzato
    // così il client può animare l'indicatore di avviso.
    return [{
      payload: {
        players: this.players,
        zombies: this.zombies,
        projectiles: this.projectiles,
        boxes: this.boxes,
        pendingSpawns: this.pendingSpawns.map((ps: any) => ({
          x: ps.x,
          y: ps.y,
          remaining: Math.max(0, ps.delay - ps.timer),
          delay: ps.delay
        })),
        wave: this.waveCounter,
        isPaused: !this.isWaveActive,
        // Durante l'ondata: secondi rimasti. Durante la pausa: secondi alla prossima.
        timer: this.isWaveActive
          ? Math.ceil(this.waveDuration - this.currentWaveTimer)
          : Math.ceil(WAVE_DELAY - this.delayTimer),
        highScore: Math.max(...Object.values(this.players).map((p: any) => p.score), 0)
      }
    }];
  }

  /**
   * La partita termina quando tutti i player hanno vita ≤ 0.
   * @returns `true` se la partita è finita.
   */
  isFinished(): boolean {
    return Object.keys(this.players).every(id => this.players[id].life <= 0);
  }
}


// ============================================================
// SHOOTER CLIENT
// ============================================================

import { UserInput } from '../client/user-input';

/**
 * @class shooterClient
 * @extends GameClient
 * @description Lato client del gioco. Responsabile di:
 *  - Catturare input di mouse e tastiera
 *  - Applicare predizione locale del movimento (client-side prediction)
 *  - Renderizzare tutti gli elementi di gioco sul canvas
 *  - Gestire le animazioni a sprite sheet di player e zombie
 *  - Mostrare l'UI (ondata, timer, score, vite, game over)
 */
export class shooterClient extends GameClient {
  /** Stato locale dei player (aggiornato dallo snapshot server). */
  private players = null;
  /** Stato locale degli zombie (aggiornato dallo snapshot server). */
  private zombies = [];
  /** Stato locale dei proiettili (aggiornato dallo snapshot server). */
  private projectiles = [];
  /** Stato locale delle casse (aggiornato dallo snapshot server). */
  private boxes = [];
  /** Spawn in attesa ricevuti dal server (cerchi rossi di avviso). */
  private pendingSpawns = [];
  /** `true` se il mouse sinistro è premuto (sparo attivo). */
  private isShooting = false;

  /** Posizione X del cursore nel sistema di coordinate mondo. */
  private gameMouseX = 0;
  /** Posizione Y del cursore nel sistema di coordinate mondo. */
  private gameMouseY = 0;

  /** Numero dell'ondata corrente (ricevuto dal server). */
  private currentWave = 1;
  /** Secondi rimasti nell'ondata (o alla prossima), ricevuti dal server. */
  private waveTimer = 0;
  /** `true` durante la pausa tra ondate. */
  private isPaused = false;

  /** Miglior punteggio di squadra (ricevuto dal server). */
  private highScore = 0;
  /** `true` se la sequenza di game over è in corso. */
  private pendingGameOver = false;
  /** Tempo trascorso (secondi) dall'inizio del game over. */
  private gameOverTimer = 0;
  /** Secondi di attesa nella schermata di game over prima di tornare in lobby. */
  private gameOverDelay = 5;

  // --- Animazione zombie ---
  /** Timer globale per l'animazione degli zombie. */
  private zombieAnimTimer = 0;
  /** Numero di frame nella sprite sheet degli zombie. */
  private ZOMBIE_FRAME_COUNT = 4;
  /** Frame al secondo dell'animazione zombie. */
  private ZOMBIE_ANIM_SPEED = 8;

  // --- Animazione player ---
  /** Timer globale per l'animazione dei player. */
  private playerAnimTimer = 0;
  /** Numero di frame nella sprite sheet del player. */
  private PLAYER_FRAME_COUNT = 4;
  /** Frame al secondo dell'animazione player. */
  private PLAYER_ANIM_SPEED = 8;

  /**
   * Costruttore: registra i listener per mouse e touch.
   * @param userInput - Oggetto che espone input da tastiera e gamepad.
   * @param myId - ID univoco di questo client nella sessione.
   */
  constructor(userInput: UserInput, myId: string) {
    super(userInput, myId);

    // Tasto sinistro del mouse: attiva/disattiva il fuoco
    addEventListener("mousedown", () => this.isShooting = true);
    addEventListener("mouseup", () => this.isShooting = false);

    // Mousemove: converte le coordinate schermo in coordinate mondo,
    // tenendo conto della scala e del traslamento del canvas.
    addEventListener("mousemove", (event) => {
      const canvas = document.querySelector('canvas');
      if (!canvas) return;

      const rect = canvas.getBoundingClientRect();
      const screenW = canvas.width;
      const screenH = canvas.height;

      // Scala uniforme che mantiene le proporzioni del campo di gioco
      const scale = Math.min(screenW / BORDERS_W, screenH / BORDERS_H);

      // Trasforma da coordinate schermo (origine in alto a sinistra)
      // a coordinate mondo (origine al centro del canvas)
      this.gameMouseX = ((event.clientX - rect.left) - screenW / 2) / scale;
      this.gameMouseY = ((event.clientY - rect.top) - screenH / 2) / scale;
    });
  }

  /**
   * Inizializzazione asincrona: carica gli asset grafici necessari.
   * @param players - Mappa iniziale dei player ricevuta dal server.
   */
  async init(players) {
    this.players = {};
    this.zombies = [];
    this.projectiles = [];
    this.boxes = [];

    // Copia superficiale dei dati player con posizione iniziale al centro
    Object.keys(players).forEach(id => {
      this.players[id] = { ...players[id], x: 0, y: 0 };
    });

    const folder = '/assets/topShooter';

    // Caricamento sprite sheet e immagini UI
    await this.assets.loadImage('zombie', `${folder}/zombie-walk.png`);
    await this.assets.loadImage('player', `${folder}/Walk.png`);
    await this.assets.loadImage('box', `${folder}/box.png`);
    await this.assets.loadImage('life', `${folder}/flask.png`);

    return Promise.resolve();
  }

  /**
   * Rendering principale: viene chiamato ogni frame lato client.
   * Disegna in ordine: sfondo, mappa, indicatori spawn, player,
   * zombie, proiettili, casse, UI e schermata di game over.
   *
   * @param ctx - Contesto 2D del canvas.
   * @param dt - Delta time in secondi dall'ultimo frame.
   */
  draw(ctx: CanvasRenderingContext2D, dt: number) {
    if (this.players === null) return;

    const { screenW, screenH, moveDirectionY, moveDirectionX } = this.userInput;

    const me = this.players[this.myId];

    // ----------------------------------------------------------
    // PREDIZIONE LOCALE DEL MOVIMENTO (client-side prediction)
    // ----------------------------------------------------------
    // Il player locale viene mosso immediatamente in base all'input,
    // senza attendere la risposta del server, per eliminare la latenza percepita.
    // Il reset di pendingGameOver/gameOverTimer qui sotto è stato RIMOSSO
    // perché ridondante: quei valori vengono impostati a true solo quando
    // me.life <= 0, quindi non possono essere true quando il player è vivo.
    if (me && me.life > 0) {
      me.x += moveDirectionX * dt * PLAYER_SPEED;
      me.y += moveDirectionY * dt * PLAYER_SPEED;

      // Clamp entro i bordi del campo
      me.x = Math.max(BORDERS.left, Math.min(BORDERS.right, me.x));
      me.y = Math.max(BORDERS.top, Math.min(BORDERS.bottom, me.y));
    }

    // ----------------------------------------------------------
    // SFONDO E SISTEMA DI COORDINATE MONDO
    // ----------------------------------------------------------
    // Il fillRect nero viene eseguito una sola volta qui.
    // (In precedenza era duplicato: una chiamata inutile precedeva
    //  il blocco di movimento del player e veniva subito sovrascritta.)
    ctx.fillStyle = "#000000";
    ctx.fillRect(0, 0, screenW, screenH);

    ctx.save();

    // Applica la trasformazione: origine al centro, scala uniforme
    const scale = Math.min(screenW / BORDERS_W, screenH / BORDERS_H);
    ctx.translate(screenW / 2, screenH / 2);
    ctx.scale(scale, scale);

    // ----------------------------------------------------------
    // MAPPA (rettangolo verde che rappresenta il campo di gioco)
    // ----------------------------------------------------------
    ctx.fillStyle = "#00820d";
    ctx.fillRect(BORDERS.left, BORDERS.top, BORDERS_W, BORDERS_H);

    // ----------------------------------------------------------
    // INDICATORI DI SPAWN (cerchi rossi semitrasparenti)
    // ----------------------------------------------------------
    // Mostrano dove comparirà il prossimo zombie. L'opacità del riempimento
    // diminuisce man mano che il delay si avvicina alla scadenza (frac: 1→0),
    // dando un effetto di "lampeggio" che avvisa il giocatore.
    if (this.pendingSpawns && this.pendingSpawns.length > 0) {
      const MARKER_RADIUS = 0.25;
      this.pendingSpawns.forEach((sp: any) => {
        const remaining = sp.remaining !== undefined ? sp.remaining : (sp.delay || 0.5);
        const delay = sp.delay || 0.5;
        // frac va da 1 (appena creato) a 0 (sta per spawnare)
        const frac = Math.max(0, Math.min(1, remaining / delay));

        ctx.beginPath();
        ctx.strokeStyle = `rgba(255,0,0,${frac * 0.9})`; // bordo: svanisce con frac
        ctx.lineWidth = 0.01;
        ctx.arc(sp.x, sp.y, MARKER_RADIUS, 0, Math.PI * 2);
        ctx.stroke();

        ctx.fillStyle = `rgba(255,0,0,${frac * 0.12})`; // riempimento: svanisce con frac
        ctx.fill();
      });
    }

    // ----------------------------------------------------------
    // PLAYER ANIMATI (sprite sheet Walk.png)
    // ----------------------------------------------------------
    // La sprite sheet ha 4 colonne (frame) e 4 righe (direzioni):
    //   riga 0 = fronte, 1 = dietro, 2 = destra, 3 = sinistra
    this.playerAnimTimer += dt;
    const playerFrame = Math.floor(this.playerAnimTimer * this.PLAYER_ANIM_SPEED) % this.PLAYER_FRAME_COUNT;
    const playerSprite = this.assets.images['player'];

    if (playerSprite) {
      const sw = 30; // larghezza di un singolo frame nella sprite sheet
      const sh = 32; // altezza di un singolo frame nella sprite sheet

      Object.keys(this.players).forEach(id => {
        const player = this.players[id];
        if (!player || player.life <= 0) return;

        ctx.save();
        ctx.translate(player.x, player.y);

        // Seleziona la riga della sprite sheet in base alla direzione
        // (solo per il player locale; gli altri restano sulla riga 0)
        let directionRow = 0;
        if (id === this.myId) {
          if (moveDirectionY > 0)      directionRow = 0; // fronte
          else if (moveDirectionY < 0) directionRow = 1; // dietro
          else if (moveDirectionX > 0) directionRow = 2; // destra
          else if (moveDirectionX < 0) directionRow = 3; // sinistra
        }

        // Se il player è fermo, mostra il frame 0 (idle)
        const isMoving = moveDirectionX !== 0 || moveDirectionY !== 0;
        const currentFrame = isMoving ? playerFrame : 0;

        ctx.drawImage(
          playerSprite,
          currentFrame * sw, directionRow * sh, // sorgente: posizione nel foglio
          sw, sh,                                // sorgente: dimensione frame
          -PLAYER_SIZE / 2, -PLAYER_SIZE / 2,   // destinazione: centrata sul player
          PLAYER_SIZE, PLAYER_SIZE
        );

        ctx.restore();
      });
    }

    // ----------------------------------------------------------
    // ZOMBIE ANIMATI (sprite sheet zombie-walk.png)
    // ----------------------------------------------------------
    // La sprite sheet ha ZOMBIE_FRAME_COUNT frame disposti orizzontalmente.
    this.zombieAnimTimer += dt;
    const zombieFrame = Math.floor(this.zombieAnimTimer * this.ZOMBIE_ANIM_SPEED) % this.ZOMBIE_FRAME_COUNT;
    const zombieSprite = this.assets.images['zombie'];

    if (zombieSprite) {
      const sw = zombieSprite.width / this.ZOMBIE_FRAME_COUNT;
      const sh = zombieSprite.height;

      this.zombies.forEach(zombie => {
        ctx.save();
        ctx.translate(zombie.x, zombie.y);
        ctx.drawImage(
          zombieSprite,
          zombieFrame * sw, 0, // sorgente: frame corrente
          sw, sh,
          -ZOMBIE_SIZE / 2, -ZOMBIE_SIZE / 2,
          ZOMBIE_SIZE, ZOMBIE_SIZE
        );
        ctx.restore();
      });
    } else {
      // Fallback se lo sprite non è ancora caricato: rettangolo blu
      this.zombies.forEach(zombie => {
        ctx.fillStyle = "#112fd8c0";
        ctx.fillRect(zombie.x - ZOMBIE_SIZE / 2, zombie.y - ZOMBIE_SIZE / 2, ZOMBIE_SIZE, ZOMBIE_SIZE);
      });
    }

    // ----------------------------------------------------------
    // PROIETTILI
    // ----------------------------------------------------------
    // this.projectiles è sempre inizializzato nell'init, quindi il
    // controllo di esistenza è superfluo ma mantenuto per robustezza.
    this.projectiles.forEach(projectile => {
      ctx.fillStyle = "rgba(248, 232, 5, 0.99)";
      ctx.beginPath();
      ctx.arc(projectile.x, projectile.y, PROJECTILE_RADIUS, 0, Math.PI * 2);
      ctx.fill();
    });

    // ----------------------------------------------------------
    // CASSE DI RIFORNIMENTO
    // ----------------------------------------------------------
    this.boxes.forEach(box => {
      ctx.drawImage(
        this.assets.images.box,
        box.x - BOX_SIZE / 2,
        box.y - BOX_SIZE / 2,
        BOX_SIZE,
        BOX_SIZE
      );
    });

    ctx.restore(); // ripristina il sistema di coordinate originale

    // ==========================================================
    // UI (coordinate schermo, fuori dalla trasformazione mondo)
    // ==========================================================

    // Numero ondata (in alto al centro)
    ctx.fillStyle = "#ffffff";
    ctx.font = "bold 24px Arial";
    ctx.textAlign = "center";
    ctx.fillText(`ONDATA ${this.currentWave}`, screenW / 2, 30);

    // Timer ondata o countdown alla prossima
    if (this.isPaused) {
      ctx.fillStyle = "#ffcc00";
      ctx.font = "20px Arial";
      ctx.fillText(`PROSSIMA ONDATA IN: ${this.waveTimer}s`, screenW / 2, 60);
      ctx.font = "bold 40px Arial";
      ctx.fillText("PREPARATI!", screenW / 2, screenH / 2 - 50);
    } else {
      ctx.fillStyle = "#ffffff";
      ctx.font = "18px Arial";
      ctx.fillText(`TEMPO RIMASTO: ${this.waveTimer}s`, screenW / 2, 60);
    }

    // Score in alto a destra
    const myScore = this.players[this.myId].score;
    ctx.textAlign = "right";
    ctx.fillStyle = "#eeeeee";
    ctx.fillText(`SCORE: ${myScore}`, screenW - 20, 30);

    // Indicatore vita (icona + numero) in basso a destra
    const myLife = this.players[this.myId].life;
    const fx = screenW - 140;
    const fy = screenH - 100;
    const lifeSprite = this.assets.images['life'];

    if (lifeSprite) {
      ctx.drawImage(lifeSprite, fx, fy, FLASK_SIZE, FLASK_SIZE);
    }

    ctx.fillStyle = "#da2323";
    ctx.font = "bold 28px Arial";
    ctx.textAlign = "left";
    ctx.textBaseline = "middle";
    ctx.fillText(`x${myLife}`, fx + 80, fy + FLASK_SIZE / 2);

    // ----------------------------------------------------------
    // SCHERMATA DI GAME OVER
    // ----------------------------------------------------------
    // Mostrata quando il player locale esaurisce le vite.
    // Dopo gameOverDelay secondi, segnala la fine della partita.
    if (me && me.life <= 0) {
      if (!this.pendingGameOver) {
        this.pendingGameOver = true;
        this.gameOverTimer = 0;
      }
      this.gameOverTimer += dt;

      ctx.save();

      // Overlay scuro semitrasparente
      ctx.fillStyle = "rgba(0, 0, 0, 0.7)";
      ctx.fillRect(0, 0, screenW, screenH);

      ctx.fillStyle = "#ff0000";
      ctx.font = "bold 72px Arial";
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      ctx.fillText("GAME OVER", screenW / 2, screenH / 2 - 40);

      ctx.fillStyle = "#ffffff";
      ctx.font = "32px Arial";
      ctx.fillText(`HIGHSCORE DI SQUADRA: ${this.highScore}`, screenW / 2, screenH / 2 + 50);

      ctx.font = "20px Arial";
      ctx.fillText(`Il tuo score: ${me.score || 0}`, screenW / 2, screenH / 2 + 90);

      ctx.font = "16px Arial";
      const remaining = Math.max(0, Math.ceil(this.gameOverDelay - this.gameOverTimer));
      ctx.fillText(`Torna alla lobby in: ${remaining}s`, screenW / 2, screenH / 2 + 130);

      ctx.restore();
    }
  }

  /**
   * Riceve e applica lo snapshot di stato inviato dal server.
   * Aggiorna tutti gli oggetti di gioco locali, senza sovrascrivere
   * la posizione locale del player controllato da questo client
   * (che è già stata aggiornata dalla predizione locale).
   *
   * @param message - Payload dello snapshot ricevuto dal server.
   */
  handleMessage(message: any) {
    if (!this.players) {
      // Prima ricezione: inizializza l'array player locale
      this.players = {};
      Object.keys(message.players).forEach(id => {
        this.players[id] = { ...message.players[id] };
      });
    } else {
      Object.keys(message.players).forEach(id => {
        if (!this.players[id]) {
          this.players[id] = { ...message.players[id] };
          return;
        }
        // Per gli altri player, aggiorna la posizione dal server.
        // Il proprio player (myId) mantiene la posizione locale (predizione client).
        if (id !== this.myId) {
          this.players[id].x = message.players[id].x;
          this.players[id].y = message.players[id].y;
        }
        // Aggiorna sempre score, vita e arma dal server (dati autorevoli)
        this.players[id].score = message.players[id].score;
        this.players[id].life = message.players[id].life;
        if (message.players[id].weaponMode !== undefined) {
          this.players[id].weaponMode = message.players[id].weaponMode;
        }
      });
    }

    // Aggiorna tutti gli altri oggetti di gioco dallo snapshot
    this.zombies = message.zombies;
    this.projectiles = message.projectiles;
    this.boxes = message.boxes;
    this.pendingSpawns = message.pendingSpawns || [];

    this.highScore = message.highScore;
    this.currentWave = message.wave;
    this.waveTimer = message.timer;
    this.isPaused = message.isPaused;
  }

  /**
   * Produce i messaggi da inviare al server in questo frame.
   * Contiene la posizione aggiornata del player, la direzione
   * del mouse e lo stato del tasto di fuoco.
   *
   * @returns Array di messaggi (vuoto se il player è morto o non ancora inizializzato).
   */
  flushMessages(): any[] {
    if (this.players === null) return [];
    const me = this.players[this.myId];
    if (!me || me.life <= 0) return []; // player morto: smette di inviare input

    return [{
      kind: 'move',
      x: me.x,
      y: me.y,
      mouseX: this.gameMouseX,
      mouseY: this.gameMouseY,
      isShooting: this.isShooting
    }];
  }

  /**
   * Indica al framework che il client ha terminato la partita
   * e deve tornare alla lobby.
   * La condizione è soddisfatta quando il countdown di game over è scaduto.
   *
   * @returns `true` se la partita è conclusa per questo client.
   */
  isFinished(): boolean {
    if (!this.players) return false;
    return this.pendingGameOver && this.gameOverTimer >= this.gameOverDelay;
  }
}