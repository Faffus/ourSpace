import { IncomingMsg, OutgoingMsg } from '../server';
import { GameServer, GameClient } from './game';
import { UserInput } from '../client/user-input';

/*
  Space Invaders - wave-based, server/client split.
  Enemy types: Pendulum (bounces walls, smooth sine-Y), Jumper, Diver.
  All enemies die in 1 hit; difficulty scales through speed and fire rate.
  Power-ups: LIFE (+2 vite squadra) e SHIELD (scudo team per 4.5s).
*/

// ── Constants ─────────────────────────────────────────────────────────────
const PLAYER_W  = 0.12;
const PLAYER_H  = 0.06;
const PLAYER_SPEED = 1.6;

const PROJ_W = 0.015;
const PROJ_H = 0.04;
const PLAYER_PROJ_SPEED = -2.0;
const ENEMY_PROJ_SPEED  =  1.6;

const FIRE_COOLDOWN_MS   = 160;
const HEAT_PER_SHOT      = 14;
const HEAT_DISSIPATION   = 28;
const OVERHEAT_MS        = 1200;
const SHIELD_MS          = 900;
const SHIELD_COOLDOWN_MS = 3000;

const WAVE_TRANSITION_MS = 3000;
const MAX_ACTIVE_PLAYERS = 2;
const WAVE_START_FIRE_DELAY_MS = 1500;  // ritardo prima che i nemici incomincino a sparare

// ── Power-up constants ─────────────────────────────────────────────────────
const POWERUP_DROP_CHANCE = 0.12;   // 12% di probabilità al kill
const POWERUP_W           = 0.07;
const POWERUP_H           = 0.07;
const POWERUP_VY          = 0.38;   // velocità di caduta (unità/sec)
const POWERUP_LIFE_BONUS  = 2;      // vite aggiunte dal power-up LIFE
const POWERUP_SHIELD_MS   = 4500;   // durata scudo team dal power-up SHIELD

// ── Types ──────────────────────────────────────────────────────────────────
type EnemyType   = 'PENDULUM' | 'JUMPER' | 'DIVER';
type PowerUpType = 'LIFE' | 'SHIELD';

type ProjectileState = {
  x: number; y: number; vx: number; vy: number; w: number; h: number;
  owner: 'player' | 'enemy'; ownerId?: string; alive?: boolean;
};

type EnemyState = {
  id: number; type: EnemyType;
  x: number; y: number; w: number; h: number;
  alive?: boolean;
  // PENDULUM
  vx?: number; baseY?: number; amplitude?: number;
  frequency?: number; phase?: number; t?: number; lastFireAt?: number;
  // JUMPER
  lastJumpAt?: number; direction?: number; jumpIntervalMs?: number; lastJumpFireAt?: number;
  // DIVER
  vy?: number; diving?: boolean; idleStartAt?: number; diveStartDelayMs?: number;
  diveSpeed?: number; visible?: boolean; lastBlinkAt?: number; blinkMs?: number;
};

type PowerUpState = {
  x: number; y: number; vy: number; w: number; h: number;
  type: PowerUpType; alive?: boolean;
};

type PlayerRuntimeState = {
  heat: number; isOverheated: boolean; overheatedUntil: number;
  lastShotAt: number; shieldExpiresAt: number; shieldCooldownUntil: number;
};

// ── Helpers ────────────────────────────────────────────────────────────────
function aabb(a: {x:number;y:number;w:number;h:number}, b: {x:number;y:number;w:number;h:number}) {
  return !(a.x+a.w < b.x || a.x > b.x+b.w || a.y+a.h < b.y || a.y > b.y+b.h);
}

function lerp(a: number, b: number, t: number) { return a + (b-a)*t; }

function randomType(): EnemyType {
  return (['PENDULUM','JUMPER','DIVER'] as EnemyType[])[Math.floor(Math.random()*3)];
}

/* =====================================================================
   SpaceServer
   ===================================================================== */
export class SpaceServer extends GameServer {
  private players:     Record<string, any> = {};
  private playerState: Record<string, PlayerRuntimeState> = {};
  private projectiles: ProjectileState[] = [];
  private enemies:     EnemyState[]      = [];
  private powerUps:    PowerUpState[]    = [];   // ← power-up attivi
  private nextId:      number = 1;
  private waveNumber:  number = 1;
  private lives:       number = 5;
  private teamScore:   number = 0;
  private inTransition:        boolean = false;
  private waveTransitionUntil: number  = 0;
  private started:            boolean = false;
  private waveStartTime:      number  = 0;  // timestamp inizio ondata per ritardare il firing

  // ── init ──────────────────────────────────────────────────────────────
  init(players) {
    this.players     = players;
    this.projectiles = [];
    this.enemies     = [];
    this.powerUps    = [];   // ← reset power-up
    this.lives       = 5;
    this.teamScore   = 0;
    this.waveNumber  = 1;
    this.inTransition        = false;
    this.waveTransitionUntil = 0;
    this.started            = false;

    const ids = Object.keys(players || {});
    let assigned = 0;
    for (const id of ids) {
      const p = players[id];
      if (assigned < MAX_ACTIVE_PLAYERS) {
        p.x = assigned === 0 ? -0.4 : 0.4;
        p.y = 0.9; p.w = PLAYER_W; p.h = PLAYER_H;
        p.color = assigned === 0 ? '#88ff88' : '#88ccff';
        p.score = 0; p.isSpectator = false;
        this.playerState[id] = {
          heat: 0, isOverheated: false, overheatedUntil: 0,
          lastShotAt: 0, shieldExpiresAt: 0, shieldCooldownUntil: 0,
        };
        assigned++;
      } else {
        p.isSpectator = true;
        p.x = 0; p.y = 2; p.w = PLAYER_W; p.h = PLAYER_H;
        p.color = '#666666'; p.score = p.score || 0;
      }
    }
  }

  // ── spawnWave ─────────────────────────────────────────────────────────
  private spawnWave() {
    this.waveStartTime = Date.now();  // ← reset timer al inizio della ondata
    const diff  = Math.pow(1.15, this.waveNumber - 1);
    const extra = Math.floor((this.waveNumber - 1) / 2);
    const rows  = Math.min(6, 3 + extra);
    const cols  = Math.min(10, 6 + extra);

    const startX   = -0.85;
    const spacingX = 1.7 / Math.max(cols - 1, 1);
    const startY   = -0.82;
    const spacingY = 0.13;

    for (let r = 0; r < rows; r++) {
      for (let c = 0; c < cols; c++) {
        const type = randomType();
        const ex = startX + c * spacingX;
        const ey = startY + r * spacingY;
        const e: EnemyState = { id: this.nextId++, type, x: ex, y: ey, w: 0.10, h: 0.06, alive: true };

        if (type === 'PENDULUM') {
          e.vx        = (0.18 + Math.random() * 0.15) * diff * (Math.random() < 0.5 ? 1 : -1);
          e.baseY     = ey;
          e.amplitude = 0.05 + Math.random() * 0.05;
          e.frequency = 1.5 + Math.random() * 1.5;
          e.phase     = Math.random() * Math.PI * 2;
          e.t         = 0;
          e.lastFireAt = 0;
        } else if (type === 'JUMPER') {
          e.jumpIntervalMs = Math.max(300, Math.floor(1100 / diff) + Math.floor(Math.random() * 300));
          e.lastJumpAt     = Date.now() + Math.random() * e.jumpIntervalMs;
          e.lastJumpFireAt = 0;
          e.direction      = Math.random() < 0.5 ? -1 : 1;
        } else { // DIVER
          e.diving           = false;
          e.idleStartAt      = 0;
          e.diveStartDelayMs = Math.max(800, Math.floor(2500 / diff) + Math.floor(Math.random() * 800));
          e.blinkMs          = 200 + Math.floor(Math.random() * 150);
          e.lastBlinkAt      = Date.now();
          e.visible          = true;
          e.diveSpeed        = (2.8 + Math.random() * 1.2) * diff;
        }
        this.enemies.push(e);
      }
    }
  }

  private startGame() {
    if (this.started) return;
    this.started = true;
    this.spawnWave();
  }

  // ── tick ──────────────────────────────────────────────────────────────
  tick(incoming: IncomingMsg[], dt: number): OutgoingMsg[] {
    const now = Date.now();

    // Wave transition: wait, then spawn next wave
    if (this.inTransition) {
      if (now >= this.waveTransitionUntil) {
        this.inTransition = false;
        this.waveNumber++;
        this.projectiles = this.projectiles.filter(p => p.owner === 'player');
        this.spawnWave();
      }
      this.attachRuntimeState(now);
      return [{ payload: this.snapshot(now) }];
    }

    // Player inputs
    for (const m of incoming) {
      const { clientId: id, payload } = m;
      const p = this.players[id];
      if (!p || p.isSpectator) continue;
      if (!this.started && payload.kind === 'start') this.startGame();
      if (!this.started) continue;
      if (payload.kind === 'move')   this.players[id].x = Math.max(-1, Math.min(1-PLAYER_W, payload.x));
      if (payload.kind === 'fire')   this.handleFire(id, now);
      if (payload.kind === 'shield') this.handleShield(id, now);
    }

    if (!this.started) {
      this.attachRuntimeState(now);
      return [{ payload: this.snapshot(now) }];
    }

    // Heat dissipation
    for (const id of Object.keys(this.players)) {
      const st = this.playerState[id];
      if (!st) continue;
      if (now - st.lastShotAt > 200) st.heat = Math.max(0, st.heat - HEAT_DISSIPATION * dt);
      if (st.isOverheated && now >= st.overheatedUntil) { st.isOverheated = false; st.heat = 50; }
    }

    // Update enemies
    this.updateEnemies(dt, now);

    // Move projectiles
    for (const pr of this.projectiles) {
      if (!pr.alive) continue;
      pr.x += pr.vx * dt;
      pr.y += pr.vy * dt;
    }

    // ── Move power-ups verso il basso ──────────────────────────────────
    for (const pu of this.powerUps) {
      if (!pu.alive) continue;
      pu.y += pu.vy * dt;
    }

    // Collisions (proiettili + power-up)
    this.resolveCollisions(now);

    // ── Collisione power-up con giocatori ─────────────────────────────
    for (const pu of this.powerUps) {
      if (!pu.alive) continue;
      for (const pid of Object.keys(this.players)) {
        const p  = this.players[pid];
        const st = this.playerState[pid];
        if (!p || !st || p.isSpectator) continue;
        if (aabb(pu, { x: p.x, y: p.y, w: PLAYER_W, h: PLAYER_H })) {
          pu.alive = false;
          if (pu.type === 'LIFE') {
            this.lives += POWERUP_LIFE_BONUS;
          } else { // SHIELD: attiva lo scudo su tutti i giocatori attivi
            for (const sid of Object.keys(this.playerState)) {
              this.playerState[sid].shieldExpiresAt = now + POWERUP_SHIELD_MS;
            }
          }
          break;
        }
      }
    }

    // Clean up
    this.projectiles = this.projectiles.filter(p => p.alive !== false && p.y > -1.5 && p.y < 1.5);
    this.enemies     = this.enemies.filter(e => e.alive !== false);
    this.powerUps    = this.powerUps.filter(pu => pu.alive !== false && pu.y < 1.5);  // ← rimuovi fuori schermo

    // Wave cleared?
    if (this.enemies.length === 0) {
      this.inTransition        = true;
      this.waveTransitionUntil = now + WAVE_TRANSITION_MS;
    }

    this.attachRuntimeState(now);
    return [{ payload: this.snapshot(now) }];
  }

  // ── resolveCollisions ─────────────────────────────────────────────────
  private resolveCollisions(now: number) {
    for (let i = this.projectiles.length - 1; i >= 0; i--) {
      const pr = this.projectiles[i];
      if (!pr.alive) continue;

      if (pr.owner === 'player') {
        const bx = pr.x - pr.w;
        const by = pr.y - pr.h / 2;
        const bw = pr.w * 2;
        const bh = pr.h;
        for (let j = this.enemies.length - 1; j >= 0; j--) {
          const en = this.enemies[j];
          if (!en.alive) continue;
          if (aabb({ x: bx, y: by, w: bw, h: bh }, { x: en.x, y: en.y, w: en.w, h: en.h })) {
            pr.alive = false;
            en.alive = false;
            const ownerId = (pr as any).ownerId;
            if (ownerId && this.players[ownerId])
              this.players[ownerId].score = (this.players[ownerId].score || 0) + 1;
            this.teamScore++;

            // ── Drop power-up casuale ──────────────────────────────────
            if (Math.random() < POWERUP_DROP_CHANCE) {
              const puType: PowerUpType = Math.random() < 0.5 ? 'LIFE' : 'SHIELD';
              this.powerUps.push({
                x:     en.x + (en.w - POWERUP_W) / 2,  // centrato sul nemico
                y:     en.y,
                vy:    POWERUP_VY,
                w:     POWERUP_W,
                h:     POWERUP_H,
                type:  puType,
                alive: true,
              });
            }

            break;
          }
        }
      } else {
        // Enemy bullet → players
        for (const pid of Object.keys(this.players)) {
          const p  = this.players[pid];
          const st = this.playerState[pid];
          if (!p || !st || p.isSpectator) continue;
          if (st.shieldExpiresAt > now) {
            const sw = PLAYER_W * 1.8;
            const sx = p.x + (PLAYER_W - sw) / 2;
            if (aabb({ x: pr.x - pr.w/2, y: pr.y - pr.h/2, w: pr.w, h: pr.h },
                     { x: sx, y: p.y - 0.05, w: sw, h: 0.06 })) { pr.alive = false; break; }
          }
          if (aabb({ x: pr.x - pr.w/2, y: pr.y - pr.h/2, w: pr.w, h: pr.h },
                   { x: p.x, y: p.y, w: PLAYER_W, h: PLAYER_H })) {
            pr.alive = false; this.lives--; break;
          }
        }
      }
    }
  }

  // ── updateEnemies ─────────────────────────────────────────────────────
  private updateEnemies(dt: number, now: number) {
    const diff = Math.pow(1.15, this.waveNumber - 1);    const canEnemiesFire = now - this.waveStartTime >= WAVE_START_FIRE_DELAY_MS;
    for (const e of this.enemies) {
      if (!e.alive) continue;

      switch (e.type) {
        case 'PENDULUM': {
          e.x += (e.vx || 0) * dt;
          if (e.x < -0.95)       { e.x = -0.95;       e.vx =  Math.abs(e.vx || 0); }
          if (e.x + e.w > 0.95)  { e.x = 0.95 - e.w;  e.vx = -Math.abs(e.vx || 0); }

          e.t = (e.t || 0) + dt;
          e.y = (e.baseY || 0) + (e.amplitude || 0) * Math.sin((e.frequency || 1) * e.t + (e.phase || 0));

          if (canEnemiesFire) {
            const fireCooldown = Math.max(500, Math.floor(2200 / diff));
            if (now - (e.lastFireAt || 0) > fireCooldown) {
              e.lastFireAt = now;
              this.spawnEnemyBullet(e.x + e.w/2, e.y + e.h, 0, ENEMY_PROJ_SPEED * diff);
              if (diff > 1.5 && Math.random() < 0.35) {
                this.spawnEnemyBullet(e.x + e.w/2, e.y + e.h,  0.18 * diff, ENEMY_PROJ_SPEED * diff);
                this.spawnEnemyBullet(e.x + e.w/2, e.y + e.h, -0.18 * diff, ENEMY_PROJ_SPEED * diff);
              }
            }
          }
          break;
        }

        case 'JUMPER': {
          if (!e.lastJumpAt) e.lastJumpAt = now;
          if (now - e.lastJumpAt >= (e.jumpIntervalMs || 1200)) {
            e.lastJumpAt = now;
            const step  = 0.20 * (e.direction || 1);
            const nextX = (e.x || 0) + step;
            if (nextX < -0.95 || nextX + e.w > 0.95) {
              e.direction = -(e.direction || 1);
              e.y = Math.min(0.75, e.y + 0.07);
            } else {
              e.x = nextX;
            }
            if (canEnemiesFire) {
              const jumpFireCooldown = Math.max(400, Math.floor(1600 / diff));
              if (now - (e.lastJumpFireAt || 0) > jumpFireCooldown) {
                e.lastJumpFireAt = now;
                this.spawnEnemyBullet(e.x + e.w/2, e.y + e.h, 0, ENEMY_PROJ_SPEED * diff);
              }
            }
          }
          break;
        }

        case 'DIVER': {
          const playerBelow = Object.values(this.players).some((p: any) => !p.isSpectator && p.y > e.y);
          if (!e.diving) {
            if (playerBelow) {
              if (!e.idleStartAt) e.idleStartAt = now;
              if (now - (e.lastBlinkAt || 0) >= (e.blinkMs || 250)) {
                e.visible     = !e.visible;
                e.lastBlinkAt = now;
              }
              if (now - e.idleStartAt >= (e.diveStartDelayMs || 2500)) {
                e.diving = true; e.vy = e.diveSpeed || 3.0; e.visible = true;
              }
            } else {
              e.idleStartAt = 0; e.visible = true;
            }
          } else {
            e.y += (e.vy || 0) * dt;
            if (e.y > 1.2) e.alive = false;
          }
          break;
        }
      }
    }
  }

  private spawnEnemyBullet(x: number, y: number, vx: number, vy: number) {
    this.projectiles.push({ x, y, vx, vy, w: PROJ_W, h: PROJ_H, owner: 'enemy', alive: true });
  }

  // ── handleFire ────────────────────────────────────────────────────────
  private handleFire(clientId: string, now: number) {
    const p  = this.players[clientId];
    const st = this.playerState[clientId];
    if (!p || !st) return;
    if (st.isOverheated && now < st.overheatedUntil) return;

    const fireCooldown = Math.max(80, FIRE_COOLDOWN_MS - (this.waveNumber - 1) * 12);
    if (now - st.lastShotAt < fireCooldown) return;

    st.lastShotAt = now;
    st.heat = Math.min(100, st.heat + HEAT_PER_SHOT);
    if (st.heat >= 100) { st.isOverheated = true; st.overheatedUntil = now + OVERHEAT_MS; }

    if (this.waveNumber >= 3) {
      // Spread shot da ondata 3
      this.projectiles.push({ x: p.x + PLAYER_W / 2, y: p.y, vx: -0.18, vy: PLAYER_PROJ_SPEED, w: PROJ_W, h: PROJ_H, owner: 'player', ownerId: clientId, alive: true });
      this.projectiles.push({ x: p.x + PLAYER_W / 2, y: p.y, vx:  0,    vy: PLAYER_PROJ_SPEED, w: PROJ_W, h: PROJ_H, owner: 'player', ownerId: clientId, alive: true });
      this.projectiles.push({ x: p.x + PLAYER_W / 2, y: p.y, vx:  0.18, vy: PLAYER_PROJ_SPEED, w: PROJ_W, h: PROJ_H, owner: 'player', ownerId: clientId, alive: true });
    } else {
      this.projectiles.push({ x: p.x + PLAYER_W / 2, y: p.y, vx: 0, vy: PLAYER_PROJ_SPEED, w: PROJ_W, h: PROJ_H, owner: 'player', ownerId: clientId, alive: true });
    }
  }

  // ── handleShield ──────────────────────────────────────────────────────
  private handleShield(clientId: string, now: number) {
    const st = this.playerState[clientId];
    if (!st || now < st.shieldCooldownUntil) return;
    st.shieldExpiresAt    = now + SHIELD_MS;
    st.shieldCooldownUntil = now + SHIELD_COOLDOWN_MS;
  }

  // ── snapshot / runtimeState ───────────────────────────────────────────
  private snapshot(now: number) {
    return {
      players:          this.players,
      enemies:          this.enemies,
      projectiles:      this.projectiles,
      powerUps:         this.powerUps,        // ← incluso nel payload
      lives:            this.lives,
      teamScore:        this.teamScore,
      waveNumber:       this.waveNumber,
      inTransition:     this.inTransition,
      transitionMsLeft: this.inTransition ? Math.max(0, this.waveTransitionUntil - now) : 0,
    };
  }

  private attachRuntimeState(now: number) {
    for (const pid of Object.keys(this.players)) {
      const st = this.playerState[pid];
      this.players[pid].runtimeState = st ? {
        heat:             st.heat,
        isOverheated:     st.isOverheated,
        shieldActive:     st.shieldExpiresAt > now,
        shieldCooldownMs: Math.max(0, st.shieldCooldownUntil - now),
      } : null;
    }
  }

  isFinished(): boolean { return this.lives <= 0; }
}

/* =====================================================================
   SpaceClient
   ===================================================================== */
export class SpaceClient extends GameClient {
  private players:       Record<string, any> = null;
  private enemies:       EnemyState[]        = [];
  private serverEnemies: EnemyState[]        = [];
  private projectiles:   ProjectileState[]   = [];
  private powerUps:      PowerUpState[]      = [];   // ← power-up client
  private messageQueue:  any[]               = [];
  private lives:         number              = 5;
  private teamScore:     number              = 0;
  private waveNumber:    number              = 1;
  private inTransition:  boolean             = false;
  private transitionMsLeft: number           = 0;
  private started:        boolean             = false;
  private gameOver:      boolean             = false;
  private returnRequested: boolean           = false;

  private localShieldUntil:         number = 0;
  private localShieldCooldownUntil: number = 0;

  private fireHeld:      boolean = false;
  private lastAutoFireAt: number = 0;

  constructor(userInput: UserInput, myId: string) {
    super(userInput, myId);

    document.addEventListener('keydown', (e) => {
      const me = this.players?.[this.myId];
      if (me?.isSpectator || this.gameOver) {
        if (e.code === 'Enter' || e.code === 'Escape') this.requestReturnToLobby();
        return;
      }
      if (e.code === 'Space' || e.code === 'Enter') {
        if (!this.started) {
          this.started = true;
          this.messageQueue.push({ kind: 'start' });
          return;
        }
        if (!this.fireHeld) {
          this.messageQueue.push({ kind: 'fire' });
          this.lastAutoFireAt = Date.now();
        }
        this.fireHeld = true;
      }
      if (e.code === 'ShiftLeft' || e.code === 'ShiftRight' ||
          e.code === 'ControlLeft' || e.code === 'ControlRight') {
        const now = Date.now();
        if (now >= this.localShieldCooldownUntil) {
          this.messageQueue.push({ kind: 'shield' });
          this.localShieldUntil         = now + SHIELD_MS;
          this.localShieldCooldownUntil  = now + SHIELD_COOLDOWN_MS;
        }
      }
    });

    document.addEventListener('keyup', (e) => {
      if (e.code === 'Space' || e.code === 'Enter') this.fireHeld = false;
    });
  }

  async init(players) { this.players = players; }

  // ── draw ──────────────────────────────────────────────────────────────
  draw(ctx: CanvasRenderingContext2D, dt: number) {
    const { screenW, screenH, moveDirectionX } = this.userInput;
    const canvas   = this.userInput.canvas;
    const canvasW  = canvas.width;
    const canvasH  = canvas.height;
    const cssWidth = canvas.getBoundingClientRect().width || screenW || canvasW;
    const dprScale = canvasW / cssWidth || window.devicePixelRatio || 1;

    // Schermata iniziale (nessun player ancora)
    if (!this.players && !this.started) {
      ctx.save();
      ctx.fillStyle = '#001022';
      ctx.fillRect(0, 0, canvasW, canvasH);
      ctx.fillStyle = '#fff';
      ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      ctx.font = `${Math.max(22, Math.round(32 * dprScale))}px Arial`;
      ctx.fillText('Space Invaders', canvasW / 2, canvasH * 0.30);
      ctx.font = `${Math.max(12, Math.round(18 * dprScale))}px Arial`;
      ctx.fillText('Premi Space o Enter per iniziare', canvasW / 2, canvasH * 0.48);
      ctx.fillText('Muovi: A/D o frecce', canvasW / 2, canvasH * 0.58);
      ctx.fillText('Spara: Space/Enter (tieni premuto)', canvasW / 2, canvasH * 0.64);
      ctx.fillText('Scudo: Shift o Ctrl', canvasW / 2, canvasH * 0.70);
      ctx.restore();
      return;
    }
    if (!this.players) return;

    if (!this.started && !this.gameOver) {
      ctx.save();
      ctx.fillStyle = 'rgba(0,0,0,0.65)';
      ctx.fillRect(0, 0, canvasW, canvasH);
      ctx.fillStyle = '#fff';
      ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      ctx.font = `${Math.max(22, Math.round(32 * dprScale))}px Arial`;
      ctx.fillText('Space Invaders', canvasW / 2, canvasH * 0.30);
      ctx.font = `${Math.max(12, Math.round(18 * dprScale))}px Arial`;
      ctx.fillText('Premi Space o Enter per iniziare', canvasW / 2, canvasH * 0.48);
      ctx.fillText('Muovi: A/D o frecce', canvasW / 2, canvasH * 0.58);
      ctx.fillText('Spara: Space/Enter (tieni premuto)', canvasW / 2, canvasH * 0.64);
      ctx.fillText('Scudo: Shift o Ctrl', canvasW / 2, canvasH * 0.70);
      ctx.restore();
      return;
    }

    // Auto-fire mentre Space è tenuto
    if (this.fireHeld && !this.gameOver) {
      const now = Date.now();
      if (now - this.lastAutoFireAt >= FIRE_COOLDOWN_MS) {
        this.messageQueue.push({ kind: 'fire' });
        this.lastAutoFireAt = now;
      }
    }

    // Predizione posizione locale del giocatore
    const me = this.players[this.myId];
    if (me && !this.gameOver && !me.isSpectator) {
      me.x += moveDirectionX * dt * PLAYER_SPEED;
      me.x = Math.max(-1, Math.min(1 - PLAYER_W, me.x));
      const sx = (me as any)._serverX;
      if (typeof sx === 'number') me.x = lerp(me.x, sx, Math.min(1, dt * 8));
    }

    // Smooth giocatori remoti
    if (!this.gameOver) {
      for (const pid of Object.keys(this.players)) {
        if (pid === this.myId) continue;
        const other = this.players[pid];
        const sx = (other as any)._serverX;
        if (typeof sx === 'number') other.x = lerp(other.x, sx, Math.min(1, dt * 8));
      }
    }

    // ── Spazio di disegno normalizzato ───────────────────────────────
    ctx.save();
    ctx.translate(screenW / 2, screenH / 2);
    ctx.scale(screenW / 2, screenH / 2);

    // Sfondo
    ctx.fillStyle = '#001022';
    ctx.fillRect(-1, -1, 2, 2);

    // Giocatori
    for (const id of Object.keys(this.players)) {
      const p  = this.players[id];
      const st = p.runtimeState;
      const isMe = id === this.myId;

      ctx.fillStyle = p.color || '#88ff88';
      ctx.fillRect(p.x, p.y, PLAYER_W, PLAYER_H);

      const shieldOn = (isMe && Date.now() < this.localShieldUntil) || !!(st?.shieldActive);
      if (shieldOn) {
        const sw = PLAYER_W * 1.8;
        ctx.fillStyle = 'rgba(80,160,255,0.45)';
        ctx.fillRect(p.x + (PLAYER_W - sw) / 2, p.y - 0.05, sw, 0.06);
      }

      if (st) {
        ctx.fillStyle = '#222';
        ctx.fillRect(p.x, p.y - 0.04, PLAYER_W, 0.02);
        ctx.fillStyle = st.isOverheated ? '#ff3333' : '#ffcc00';
        ctx.fillRect(p.x, p.y - 0.04, (st.heat / 100) * PLAYER_W, 0.02);
        const cdMs   = isMe ? Math.max(st.shieldCooldownMs || 0, Math.max(0, this.localShieldCooldownUntil - Date.now())) : (st.shieldCooldownMs || 0);
        const cdFrac = Math.min(1, cdMs / SHIELD_COOLDOWN_MS);
        ctx.fillStyle = '#444'; ctx.fillRect(p.x, p.y + PLAYER_H + 0.015, PLAYER_W, 0.01);
        ctx.fillStyle = '#00aaff'; ctx.fillRect(p.x, p.y + PLAYER_H + 0.015, PLAYER_W * (1 - cdFrac), 0.01);
      }
    }

    // Nemici
    const alpha = Math.min(1, dt * 12);
    for (const e of this.enemies) {
      const se = this.serverEnemies.find(s => s.id === e.id);
      if (se) {
        const dx = Math.abs(se.x - e.x), dy = Math.abs(se.y - e.y);
        e.x = dx > 0.3  ? se.x : lerp(e.x, se.x, alpha);
        e.y = dy > 0.25 ? se.y : lerp(e.y, se.y, alpha);
        e.visible = se.visible;
        e.type = se.type; e.w = se.w; e.h = se.h;
      }
      if (e.type === 'DIVER' && e.visible === false) continue;
      ctx.fillStyle = e.type === 'PENDULUM' ? '#9bdfef' : e.type === 'JUMPER' ? '#ffd59e' : '#ff9090';
      ctx.fillRect(e.x, e.y, e.w, e.h);
    }

    // Proiettili
    for (const pr of this.projectiles) {
      ctx.fillStyle = pr.owner === 'player' ? '#ffffff' : '#ff4444';
      ctx.fillRect(pr.x - pr.w / 2, pr.y - pr.h / 2, pr.w, pr.h);
    }

    // ── Power-up ──────────────────────────────────────────────────────
    for (const pu of this.powerUps) {
      // LIFE  → rettangolo verde con una croce bianca
      // SHIELD → rettangolo azzurro con uno scudo bianco (semplice triangolo)
      if (pu.type === 'LIFE') {
        ctx.fillStyle = '#33dd55';
        ctx.fillRect(pu.x, pu.y, pu.w, pu.h);
        // croce bianca
        ctx.fillStyle = '#ffffff';
        const cx = pu.x + pu.w / 2, cy = pu.y + pu.h / 2;
        const arm = pu.w * 0.28, thick = pu.h * 0.14;
        ctx.fillRect(cx - thick / 2, cy - arm, thick, arm * 2); // verticale
        ctx.fillRect(cx - arm, cy - thick / 2, arm * 2, thick); // orizzontale
      } else { // SHIELD
        ctx.fillStyle = '#33aaff';
        ctx.fillRect(pu.x, pu.y, pu.w, pu.h);
        // scudo (arco semplificato con fillRect + bezier)
        ctx.fillStyle = '#ffffff';
        ctx.beginPath();
        const sx = pu.x + pu.w / 2, sy = pu.y + pu.h * 0.18;
        const sr = pu.w * 0.34;
        ctx.moveTo(sx - sr, sy);
        ctx.lineTo(sx + sr, sy);
        ctx.lineTo(sx + sr, sy + sr * 0.9);
        ctx.quadraticCurveTo(sx, sy + sr * 2.0, sx - sr, sy + sr * 0.9);
        ctx.closePath();
        ctx.fill();
      }
    }

    ctx.restore();

    // ── HUD ──────────────────────────────────────────────────────────
    ctx.save();
    ctx.textBaseline = 'top'; ctx.textAlign = 'center';
    const fLg = Math.max(12, Math.round(20 * dprScale));
    const fSm = Math.max(10, Math.round(14 * dprScale));
    const hY  = Math.max(8,  Math.round(18 * dprScale));
    const hX  = Math.round(canvasW / 2);
    ctx.fillStyle = '#fff';
    ctx.font = `${fLg}px Arial`;
    ctx.fillText(`Vite: ${this.lives}`, hX, hY);
    ctx.font = `${fSm}px Arial`;
    ctx.fillText(`Punteggio: ${this.teamScore}  |  Ondata: ${this.waveNumber}`, hX, hY + fLg + 4);
    ctx.restore();

    // ── Legenda power-up (angolo in basso a sinistra) ─────────────────
    ctx.save();
    ctx.textBaseline = 'middle'; ctx.textAlign = 'left';
    ctx.font = `${Math.max(9, Math.round(12 * dprScale))}px Arial`;
    const legX = Math.round(8 * dprScale);
    const legY = canvasH - Math.round(38 * dprScale);
    const sq   = Math.round(12 * dprScale);
    ctx.fillStyle = '#33dd55'; ctx.fillRect(legX, legY, sq, sq);
    ctx.fillStyle = '#ccc';    ctx.fillText('+2 vite', legX + sq + 4, legY + sq / 2);
    ctx.fillStyle = '#33aaff'; ctx.fillRect(legX, legY + sq + 4, sq, sq);
    ctx.fillStyle = '#ccc';    ctx.fillText('scudo team', legX + sq + 4, legY + sq + 4 + sq / 2);
    ctx.restore();

    // ── Wave transition overlay ──────────────────────────────────────
    if (this.inTransition) {
      const secLeft = Math.ceil(this.transitionMsLeft / 1000);
      ctx.save();
      ctx.fillStyle = 'rgba(0,0,0,0.55)'; ctx.fillRect(0, 0, canvasW, canvasH);
      ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      ctx.fillStyle = '#fff';
      ctx.font = `${Math.max(18, Math.round(42 * dprScale))}px Arial`;
      ctx.fillText(`Ondata ${this.waveNumber} completata!`, canvasW/2, canvasH * 0.38);
      ctx.fillStyle = '#aaddff';
      ctx.font = `${Math.max(13, Math.round(22 * dprScale))}px Arial`;
      ctx.fillText(`Ondata ${this.waveNumber + 1} in arrivo tra ${secLeft}…`, canvasW/2, canvasH * 0.50);
      ctx.restore();
    }

    // ── Game Over overlay ────────────────────────────────────────────
    if (this.gameOver) {
      ctx.save();
      ctx.fillStyle = 'rgba(0,0,0,0.65)'; ctx.fillRect(0, 0, canvasW, canvasH);
      ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      ctx.fillStyle = '#fff';
      ctx.font = `${Math.max(18, Math.round(48 * dprScale))}px Arial`;
      ctx.fillText('Game Over', canvasW/2, canvasH * 0.28);
      ctx.fillStyle = '#aaddff';
      ctx.font = `${Math.max(14, Math.round(24 * dprScale))}px Arial`;
      ctx.fillText(`Punteggio finale: ${this.teamScore}`, canvasW/2, canvasH * 0.42);
      ctx.fillStyle = '#888';
      ctx.font = `${Math.max(11, Math.round(15 * dprScale))}px Arial`;
      ctx.fillText('Premi Enter o Escape per tornare alla lobby', canvasW/2, canvasH * 0.82);
      ctx.restore();
    }
  }

  // ── handleMessage ─────────────────────────────────────────────────────
  handleMessage(message: any) {
    const srvPlayers = message.players || {};

    if (!this.players) {
      this.players = {};
      for (const id of Object.keys(srvPlayers)) {
        this.players[id] = { ...srvPlayers[id] };
        (this.players[id] as any)._serverX = srvPlayers[id].x;
      }
    } else {
      for (const id of Object.keys(srvPlayers)) {
        const srv = srvPlayers[id];
        if (id === this.myId) {
          const local = this.players[id] || {};
          this.players[id] = { ...srv, x: local.x ?? srv.x };
          (this.players[id] as any)._serverX = srv.x;
          this.players[id].runtimeState = srv.runtimeState;
        } else {
          if (!this.players[id]) this.players[id] = { ...srv };
          else {
            this.players[id].runtimeState = srv.runtimeState;
            if (srv.color && !this.players[id].color) this.players[id].color = srv.color;
          }
          (this.players[id] as any)._serverX = srv.x;
        }
      }
    }

    // Sync nemici
    this.serverEnemies = message.enemies || [];
    if (!this.enemies || this.enemies.length === 0) {
      this.enemies = this.serverEnemies.map(e => ({ ...e }));
    } else {
      for (const se of this.serverEnemies) {
        const disp = this.enemies.find(d => d.id === se.id);
        if (!disp) this.enemies.push({ ...se });
        else { disp.w = se.w; disp.h = se.h; disp.type = se.type; disp.visible = se.visible; }
      }
      this.enemies = this.enemies.filter(d => this.serverEnemies.some(s => s.id === d.id));
    }

    // ── Sync power-up dal server ───────────────────────────────────
    this.powerUps = message.powerUps || [];

    if (!this.started && (message.enemies || []).length) this.started = true;
    this.projectiles      = message.projectiles    || [];
    this.lives            = message.lives;
    this.teamScore        = message.teamScore       ?? this.teamScore;
    this.waveNumber       = message.waveNumber      ?? this.waveNumber;
    this.inTransition     = !!message.inTransition;
    this.transitionMsLeft = message.transitionMsLeft ?? 0;

    if (this.lives <= 0 && !this.gameOver) {
      this.gameOver = true; this.messageQueue = [];
    }
  }

  // ── flushMessages ─────────────────────────────────────────────────────
  flushMessages(): any[] {
    if (!this.players || this.gameOver) return [];
    const me = this.players[this.myId];
    if (!me || me.isSpectator) return [];
    const msgs = [{ kind: 'move', x: me.x }, ...this.messageQueue];
    this.messageQueue = [];
    return msgs;
  }

  public requestReturnToLobby() { this.returnRequested = true; }
  isFinished(): boolean { return this.returnRequested; }
}