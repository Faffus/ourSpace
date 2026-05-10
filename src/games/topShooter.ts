import { getCollisionSide, Player } from '../common';
import { IncomingMsg, OutgoingMsg } from '../server';
import { GameClient, GameServer } from './game';

const BORDERS = {
  top: -1,
  bottom: 1,
  left: -2,
  right: 2
}

const BORDERS_W = Math.abs(BORDERS.right - BORDERS.left);
const BORDERS_H = Math.abs(BORDERS.top - BORDERS.bottom);
const SPAWN_INTERVAL = 0.5;
const ZOMBIE_SPEED = 0.5;
const PLAYER_SPEED = 1.3;
const PLAYER_SIZE = 0.2;
const ZOMBIE_SIZE = 0.2;
const PROJECTILE_RADIUS = 0.02;
const BOX_SIZE = 0.04;
const BOX_INTERVAL = 10;
const WAVE_DELAY = 5;




export class shooterServer extends GameServer {
  private players;
  private zombies;
  private projectiles;
  private boxes;

  private highScore;
  private orde;
  private spawnTimer;
  private damage;
  private playerMouseX: { [key: string]: number } = {};
  private playerMouseY: { [key: string]: number } = {};
  private playerIsShooting: { [key: string]: boolean } = {};

  private waveCounter;
  private waveDuration;
  private currentWaveTimer;

  private isWaveActive
  private delayTimer

  private boxTimer;
  private boxCounter;

  init(players) {
    this.players = players;
    this.projectiles = [];
    this.zombies = [];
    this.spawnTimer = 0;
    this.orde = 5;
    this.damage = 35;

    this.waveCounter = 1;
    this.waveDuration = 20;
    this.currentWaveTimer = 0;
    this.delayTimer = 0;
    this.isWaveActive = true;

    this.boxTimer = 0;
    this.boxCounter = 0;
    this.boxes = [];

    Object.keys(players).forEach(id => {
      const player = players[id];
      player.x = 0;
      player.y = 0;
      player.score = 0;
      player.life = 3;

      player.fireRate = 0.4;
      player.weaponMode = 'pistol';
      player.lastShotTime = 0;
      this.playerIsShooting[id] = false;
    });
  }

  tick(incomingMessages: IncomingMsg[], dt: number): OutgoingMsg[] {
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

    // Spawn scatole
    this.boxTimer += dt;
    if (this.boxCounter < 2 && this.boxTimer >= BOX_INTERVAL) {
      this.boxTimer = 0;
      const randomX = (Math.random() - 0.5) * 2;
      const randomY = (Math.random() - 0.5) * 2;
      this.boxes.push({ x: randomX, y: randomY });
      this.boxCounter += 1;
      console.log("scatole: " + this.boxCounter);
    }


    // --- LOGICA ONDATE E DELAY ---
    if (this.isWaveActive) {
      this.currentWaveTimer += dt;
      if (this.currentWaveTimer >= this.waveDuration) {
        this.isWaveActive = false; // Finisce l'ondata
        this.currentWaveTimer = 0;
        this.delayTimer = 0;
        this.zombies =[];
        console.log("Ondata terminata! Pausa di 5 secondi...");
      }
    } else {
      this.delayTimer += dt;
      if (this.delayTimer >= WAVE_DELAY) {
        this.isWaveActive = true; // Inizia nuova ondata
        this.waveCounter += 1;
        this.waveDuration += 5;
        this.orde += 2;
        console.log(`Inizia Ondata ${this.waveCounter}!`);
      }
    }

    // --- SPAWN ZOMBIE (Solo se l'ondata è attiva) ---
    this.spawnTimer += dt;
    if (this.isWaveActive && this.spawnTimer >= SPAWN_INTERVAL && this.zombies.length < this.orde) {
      this.spawnTimer = 0;
      const randomX = (Math.random() - 0.5) * 4;
      const randomY = (Math.random() - 0.5) * 4;
      this.zombies.push({ x: randomX, y: randomY, vita: 100 });
    }

    // --- Gestione proiettili ---
    Object.keys(this.players).forEach(id => {
      const player = this.players[id];
      player.lastShotTime += dt;

      // 1. Definiamo la cadenza in base all'arma
      let currentFireRate = player.fireRate || 0.4; // Default (0.4)
      const wm = (player.weaponMode || '').toLowerCase();

      if (wm.includes('machine')) {
        currentFireRate = 0.1; // Molto più veloce!
      } else if (wm.includes('shot')) {
        currentFireRate = 0.3; // Più lenta
      } else if (wm.includes('pistol')) {
        currentFireRate = player.fireRate || currentFireRate;
      }

      // 2. Usiamo currentFireRate per il controllo
      if (this.playerIsShooting[id] && player.lastShotTime >= currentFireRate) {
        player.lastShotTime = 0;

        const dx = this.playerMouseX[id] - player.x;
        const dy = this.playerMouseY[id] - player.y;
        const distance = Math.sqrt(dx * dx + dy * dy);

        if (distance > 0) {
          const dirX = dx / distance;
          const dirY = dy / distance;

          // Se è shotgun, spariamo 3 proiettili a ventaglio
          if (wm.includes('shot')) {
            const spreadDeg = 20; // angolo totale in gradi
            const spreadRad = (spreadDeg * Math.PI) / 180;
            const angles = [-spreadRad / 2, 0, spreadRad / 2];
            const pelletSpeed = 4;
            const pelletLife = 1.0;
            for (const a of angles) {
              const cos = Math.cos(a);
              const sin = Math.sin(a);
              const rvx = dirX * cos - dirY * sin;
              const rvy = dirX * sin + dirY * cos;
              this.projectiles.push({
                x: player.x,
                y: player.y,
                vx: rvx * pelletSpeed,
                vy: rvy * pelletSpeed,
                life: pelletLife,
                playerId: id
              });
            }
          } else {
            // Creazione proiettile singolo (default)
            this.projectiles.push({
              x: player.x, y: player.y,
              vx: dirX * 4, vy: dirY * 4,
              life: 1.5, playerId: id
            });
          }
        }
      }
    });

    // Movimento proiettili e pulizia
    this.projectiles.forEach(p => {
      p.x += p.vx * dt;
      p.y += p.vy * dt;
      p.life -= dt;
    });
    this.projectiles = this.projectiles.filter(p => p.life > 0);

   // --- MOVIMENTO ZOMBIE CON SEPARAZIONE ---
    this.zombies.forEach((zombie, index) => {
      let closestPlayer = null;
      let minDistance = Infinity;

      // 1. Trova il giocatore più vicino
      Object.keys(this.players).forEach(id => {
        const player = this.players[id];
        if (player.life <= 0) return; // Ignora i player morti
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

      // 2. Calcola direzione verso il player
      if (closestPlayer) {
        const dx = closestPlayer.x - zombie.x;
        const dy = closestPlayer.y - zombie.y;
        const len = Math.sqrt(dx * dx + dy * dy);
        if (len > 0) {
          moveX += (dx / len) * ZOMBIE_SPEED;
          moveY += (dy / len) * ZOMBIE_SPEED;
        }
      }

      // 3. LOGICA DI SEPARAZIONE (Evita sovrapposizioni)
      const SEPARATION_DIST = ZOMBIE_SIZE * 1.2; // Distanza minima tra zombie
      const SEPARATION_FORCE = 0.8; // Forza dell'allontanamento

      this.zombies.forEach((otherZombie, otherIndex) => {
        if (index === otherIndex) return; // Non controllare se stesso

        const dx = zombie.x - otherZombie.x;
        const dy = zombie.y - otherZombie.y;
        const dist = Math.sqrt(dx * dx + dy * dy);

        if (dist < SEPARATION_DIST && dist > 0) {
          // Spinge lo zombie nella direzione opposta all'altro zombie
          moveX += (dx / dist) * SEPARATION_FORCE;
          moveY += (dy / dist) * SEPARATION_FORCE;
        }
      });

      // 4. Applica il movimento finale
      zombie.x += moveX * dt;
      zombie.y += moveY * dt;
    });

   

    // Gestione collisione proiettile -> zombie
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

          this.projectiles.splice(i, 1);

          if (zombie.vita <= 0) {
            this.zombies.splice(j, 1);
            const shooterId = projectile.playerId;
            if (shooterId && this.players[shooterId]) {
              this.players[shooterId].score += 1;
              console.log("player" + shooterId + ", score: " + this.players[shooterId].score);
            }
          }

          break;
        }
      }
    }

    // Gestione collisione zombie -> player
    Object.keys(this.players).forEach(id => {
      const player = this.players[id];
      if (player.life <= 0) return;

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

     //gestione collisioni player -> scatola
    Object.keys(this.players).forEach(id =>{
      const player = this.players[id];
      const playerRect = {
        x: player.x - PLAYER_SIZE / 2,
        y: player.y - PLAYER_SIZE / 2,
        w: PLAYER_SIZE,
        h: PLAYER_SIZE
      };

      for(let j= this.boxes.length-1; j>=0; j--){
        const box = this.boxes[j];
        const boxRect = {
          x: box.x - BOX_SIZE/2,
          y: box.y - BOX_SIZE/2,
          w: BOX_SIZE,
          h: BOX_SIZE
        };

        if(getCollisionSide(playerRect, boxRect)!== 'none'){
          const boxIndex = Math.floor(Math.random()*3);
          this.boxCounter -= 1;
          this.boxes.splice(j, 1);
          if(boxIndex === 1){
            player.weaponMode = 'shotgun';
            console.log("il player ha ottenuto: "+player.weaponMode)
          }
          else if(boxIndex === 2){
            player.weaponMode = 'machineGun';
            console.log("il player ha ottenuto: "+player.weaponMode)
          }
          else {
            if(player.life < 3){
              player.life += 1;
              console.log("il player ha ottenuto vita ")
            }
          }


        }
      }
    })
    // Nel tick, aggiorniamo il return
    return [{
      payload: {
        players: this.players,
        zombies: this.zombies,
        projectiles: this.projectiles,
        boxes: this.boxes,
        wave: this.waveCounter,
        isPaused: !this.isWaveActive,
        timer: this.isWaveActive 
          ? Math.ceil(this.waveDuration - this.currentWaveTimer) 
          : Math.ceil(WAVE_DELAY - this.delayTimer),
        highScore: Math.max(...Object.values(this.players).map((p: any) => p.score), 0)
      }
    }];
  }

  isFinished(): boolean {
    return Object.keys(this.players).every(id => this.players[id].life <= 0);
  }
}

import { UserInput } from '../client/user-input';

export class shooterClient extends GameClient {
  private players = null;
  private zombies = [];
  private projectiles = [];
  private boxes = [];
  private isShooting = false;

  private gameMouseX = 0;
  private gameMouseY = 0;

  private currentWave = 1;
  private waveTimer = 0;
  private isPaused = false;

  private highScore = 0;
  private pendingGameOver = false;
  private gameOverTimer = 0;
  private gameOverDelay = 5;

  // -----------------------------
  // ZOMBIE ANIMATION
  // -----------------------------
  private zombieAnimTimer = 0;
  private ZOMBIE_FRAME_COUNT = 4;
  private ZOMBIE_ANIM_SPEED = 8;

  // -----------------------------
  // PLAYER ANIMATION
  // -----------------------------
  private playerAnimTimer = 0;
  private PLAYER_FRAME_COUNT = 4;
  private PLAYER_ANIM_SPEED = 8;

  constructor(userInput: UserInput, myId: string) {
    super(userInput, myId);

    addEventListener("mousedown", () => this.isShooting = true);
    addEventListener("mouseup", () => this.isShooting = false);

    addEventListener("mousemove", (event) => {
      const canvas = document.querySelector('canvas');
      if (!canvas) return;

      const rect = canvas.getBoundingClientRect();
      const screenW = canvas.width;
      const screenH = canvas.height;

      const scale = Math.min(screenW / BORDERS_W, screenH / BORDERS_H);

      this.gameMouseX = ((event.clientX - rect.left) - screenW / 2) / scale;
      this.gameMouseY = ((event.clientY - rect.top) - screenH / 2) / scale;
    });
  }

  async init(players) {
    this.players = {};
    this.zombies = [];
    this.projectiles = [];
    this.boxes = [];

    Object.keys(players).forEach(id => {
      this.players[id] = { ...players[id], x: 0, y: 0 };
    });

    const folder = '/assets/topShooter';

    await this.assets.loadImage('zombie', `${folder}/zombie-walk.png`);
    await this.assets.loadImage('player', `${folder}/Walk.png`);

    return Promise.resolve();
  }

  draw(ctx: CanvasRenderingContext2D, dt: number) {
    if (this.players === null) return;

    const { screenW, screenH, moveDirectionY, moveDirectionX } = this.userInput;

    ctx.fillStyle = "#000000";
    ctx.fillRect(0, 0, screenW, screenH);

    const me = this.players[this.myId];

    // -----------------------------
    // MOVIMENTO LOCALE PLAYER
    // -----------------------------
    if (me && me.life > 0) {
      me.x += moveDirectionX * dt * PLAYER_SPEED;
      me.y += moveDirectionY * dt * PLAYER_SPEED;

      me.x = Math.max(BORDERS.left, Math.min(BORDERS.right, me.x));
      me.y = Math.max(BORDERS.top, Math.min(BORDERS.bottom, me.y));

      this.pendingGameOver = false;
      this.gameOverTimer = 0;
    }

    ctx.fillStyle = "#000000";
    ctx.fillRect(0, 0, screenW, screenH);

    ctx.save();

    const scale = Math.min(screenW / BORDERS_W, screenH / BORDERS_H);

    ctx.translate(screenW / 2, screenH / 2);
    ctx.scale(scale, scale);

    // -----------------------------
    // MAPPA
    // -----------------------------
    ctx.fillStyle = "#00820d";
    ctx.fillRect(BORDERS.left, BORDERS.top, BORDERS_W, BORDERS_H);

    // =========================================================
    // PLAYER ANIMATI
    // =========================================================

    this.playerAnimTimer += dt;

    const playerFrame =
      Math.floor(this.playerAnimTimer * this.PLAYER_ANIM_SPEED)
      % this.PLAYER_FRAME_COUNT;

    const playerSprite = this.assets.images['player'];

    if (playerSprite) {

      const sw = 30;
      const sh = 32;

      Object.keys(this.players).forEach(id => {

        const player = this.players[id];

        if (!player || player.life <= 0) return;

        ctx.save();

        ctx.translate(player.x, player.y);

        // -----------------------------
        // DIREZIONE
        // -----------------------------
        let directionRow = 0;

        if (id === this.myId) {

          if (moveDirectionY > 0) {
            directionRow = 0; // FRONT
          }
          else if (moveDirectionY < 0) {
            directionRow = 1; // BACK
          }
          else if (moveDirectionX > 0) {
            directionRow = 2; // RIGHT
          }
          else if (moveDirectionX < 0) {
            directionRow = 3; // LEFT
          }
        }

        // -----------------------------
        // IDLE / WALK
        // -----------------------------
        const isMoving =
          moveDirectionX !== 0 || moveDirectionY !== 0;

        const currentFrame = isMoving ? playerFrame : 0;

        ctx.drawImage(
          playerSprite,

          currentFrame * sw,
          directionRow * sh,

          sw,
          sh,

          -PLAYER_SIZE / 2,
          -PLAYER_SIZE / 2,

          PLAYER_SIZE,
          PLAYER_SIZE
        );

        ctx.restore();
      });
    }

    // =========================================================
    // ZOMBIE ANIMATI
    // =========================================================

    this.zombieAnimTimer += dt;

    const zombieFrame =
      Math.floor(this.zombieAnimTimer * this.ZOMBIE_ANIM_SPEED)
      % this.ZOMBIE_FRAME_COUNT;

    const zombieSprite = this.assets.images['zombie'];

    if (zombieSprite) {

      const sw = zombieSprite.width / this.ZOMBIE_FRAME_COUNT;
      const sh = zombieSprite.height;

      this.zombies.forEach(zombie => {

        ctx.save();

        ctx.translate(zombie.x, zombie.y);

        ctx.drawImage(
          zombieSprite,

          zombieFrame * sw,
          0,

          sw,
          sh,

          -ZOMBIE_SIZE / 2,
          -ZOMBIE_SIZE / 2,

          ZOMBIE_SIZE,
          ZOMBIE_SIZE
        );

        ctx.restore();
      });

    } else {

      this.zombies.forEach(zombie => {
        ctx.fillStyle = "#112fd8c0";

        ctx.fillRect(
          zombie.x - ZOMBIE_SIZE / 2,
          zombie.y - ZOMBIE_SIZE / 2,
          ZOMBIE_SIZE,
          ZOMBIE_SIZE
        );
      });
    }

    // =========================================================
    // PROIETTILI
    // =========================================================

    if (this.projectiles) {

      this.projectiles.forEach(projectile => {

        ctx.fillStyle = "rgba(248, 232, 5, 0.99)";

        ctx.beginPath();

        ctx.arc(
          projectile.x,
          projectile.y,
          PROJECTILE_RADIUS,
          0,
          Math.PI * 2
        );

        ctx.fill();
      });
    }

    // =========================================================
    // SCATOLE
    // =========================================================

    this.boxes.forEach(boxe => {

      ctx.fillStyle = "rgba(163, 98, 0, 0.82)";

      ctx.fillRect(
        boxe.x - BOX_SIZE / 2,
        boxe.y - BOX_SIZE / 2,
        BOX_SIZE,
        BOX_SIZE
      );
    });

    ctx.restore();

    // =========================================================
    // UI
    // =========================================================

    ctx.fillStyle = "#ffffff";
    ctx.font = "bold 24px Arial";
    ctx.textAlign = "center";

    ctx.fillText(`ONDATA ${this.currentWave}`, screenW / 2, 30);

    if (this.isPaused) {

      ctx.fillStyle = "#ffcc00";
      ctx.font = "20px Arial";

      ctx.fillText(
        `PROSSIMA ONDATA IN: ${this.waveTimer}s`,
        screenW / 2,
        60
      );

      ctx.font = "bold 40px Arial";

      ctx.fillText(
        "PREPARATI!",
        screenW / 2,
        screenH / 2 - 50
      );

    } else {

      ctx.fillStyle = "#ffffff";
      ctx.font = "18px Arial";

      ctx.fillText(
        `TEMPO RIMASTO: ${this.waveTimer}s`,
        screenW / 2,
        60
      );
    }

    // =========================================================
    // SCORE
    // =========================================================

    const myScore = this.players[this.myId].score;

    ctx.textAlign = "right";
    ctx.fillStyle = "#eeeeee";

    ctx.fillText(
      `SCORE: ${myScore}`,
      screenW - 20,
      30
    );

    // =========================================================
    // GAME OVER
    // =========================================================

    if (me && me.life <= 0) {

      if (!this.pendingGameOver) {
        this.pendingGameOver = true;
        this.gameOverTimer = 0;
      }

      this.gameOverTimer += dt;

      ctx.save();

      ctx.fillStyle = "rgba(0, 0, 0, 0.7)";
      ctx.fillRect(0, 0, screenW, screenH);

      ctx.fillStyle = "#ff0000";
      ctx.font = "bold 72px Arial";
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";

      ctx.fillText(
        "GAME OVER",
        screenW / 2,
        screenH / 2 - 40
      );

      ctx.fillStyle = "#ffffff";
      ctx.font = "32px Arial";

      ctx.fillText(
        `HIGHSCORE DI SQUADRA: ${this.highScore}`,
        screenW / 2,
        screenH / 2 + 50
      );

      ctx.font = "20px Arial";

      ctx.fillText(
        `Il tuo score: ${me.score || 0}`,
        screenW / 2,
        screenH / 2 + 90
      );

      ctx.font = "16px Arial";

      const remaining =
        Math.max(
          0,
          Math.ceil(this.gameOverDelay - this.gameOverTimer)
        );

      ctx.fillText(
        `Torna alla lobby in: ${remaining}s`,
        screenW / 2,
        screenH / 2 + 130
      );

      ctx.restore();
    }
  }

  handleMessage(message: any) {

    if (!this.players) {

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

        if (id !== this.myId) {
          this.players[id].x = message.players[id].x;
          this.players[id].y = message.players[id].y;
        }

        this.players[id].score = message.players[id].score;
        this.players[id].life = message.players[id].life;

        if (message.players[id].weaponMode !== undefined) {
          this.players[id].weaponMode = message.players[id].weaponMode;
        }
      });
    }

    this.zombies = message.zombies;
    this.projectiles = message.projectiles;
    this.boxes = message.boxes;

    this.highScore = message.highScore;

    this.currentWave = message.wave;
    this.waveTimer = message.timer;
    this.isPaused = message.isPaused;
  }

  flushMessages(): any[] {

    if (this.players === null) return [];

    const me = this.players[this.myId];

    if (!me || me.life <= 0) return [];

    return [{
      kind: 'move',
      y: me.y,
      x: me.x,
      mouseX: this.gameMouseX,
      mouseY: this.gameMouseY,
      isShooting: this.isShooting
    }];
  }

  isFinished(): boolean {

    if (!this.players) return false;

    return (
      this.pendingGameOver &&
      this.gameOverTimer >= this.gameOverDelay
    );
  }
}