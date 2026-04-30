import { IncomingMsg, OutgoingMsg } from '../server';
import { GameServer, GameClient } from './game';
import { UserInput } from '../client/user-input';

/*
  Space Invaders - Server/Client split (simple, predictable enemy patterns)
  Server: SpaceServer extends GameServer - authoritative state, tick()
  Client: SpaceClient extends GameClient - local input, draw(), flushMessages()

  This file focuses on: Player heat/shield logic, Projectile handling, and
  three enemy behaviours: Pendulum, Jumper, Diver.
*/

// World & entity constants (normalized coordinates: -1..1)
const PLAYER_W = 0.12;
const PLAYER_H = 0.06;
const PLAYER_SPEED = 1.6; // units/sec for local smoothing

const PROJ_W = 0.01;
const PROJ_H = 0.03;
const PLAYER_PROJECTILE_SPEED = -1.8; // negative = up
const ENEMY_PROJECTILE_SPEED = 1.6; // downwards, increased for difficulty

const HEAT_PER_SHOT = 15;
const HEAT_DISSIPATION_RATE = 20; // units/sec
const OVERHEAT_DURATION_MS = 3000;
const SHIELD_DURATION_MS = 1500;
const SHIELD_COOLDOWN_MS = 5000;

type EnemyType = 'PENDULUM' | 'JUMPER' | 'DIVER';

type ProjectileState = {
  x: number; y: number; vx: number; vy: number; w: number; h: number; owner: 'player' | 'enemy'; ownerId?: string; alive?: boolean;
}

type EnemyState = {
  id: number;
  type: EnemyType;
  x: number; y: number; w: number; h: number; vx?: number; vy?: number;
  // pendulum
  baseY?: number; amplitude?: number; frequency?: number; phase?: number; lastPeakFireAt?: number;
  // jumper
  lastJumpAt?: number; direction?: number; jumpIntervalMs?: number;
  // diver
  idleStartAt?: number; diving?: boolean; diveStartDelayMs?: number; diveSpeed?: number; visible?: boolean; lastBlinkAt?: number; blinkMs?: number;
  alive?: boolean;
}

type PlayerRuntimeState = {
  heat: number;
  isOverheated: boolean;
  overheatedUntil: number;
  lastShotAt: number;
  shieldExpiresAt: number;
  shieldCooldownUntil: number;
  // powerups, not fully implemented here but reserved
  powerups?: Record<string, number>;
}

function aabbCollision(a: {x:number;y:number;w:number;h:number}, b: {x:number;y:number;w:number;h:number}){
  return !(a.x + a.w < b.x || a.x > b.x + b.w || a.y + a.h < b.y || a.y > b.y + b.h);
}

// Linear interpolation helper for smoothing positions
function lerp(a: number, b: number, t: number){
  return a + (b - a) * t;
}

/* =====================
   SpaceServer
   ===================== */
export class SpaceServer extends GameServer {
  private players: Record<string, any> = {};
  private playerState: Record<string, PlayerRuntimeState> = {};
  private projectiles: ProjectileState[] = [];
  private enemies: EnemyState[] = [];
  private respawnQueue: { type: EnemyType; respawnAt: number }[] = [];
  private nextEnemyId: number = 1;
  private lives: number = 5;

  init(players) {
    this.players = players;
    this.projectiles = [];
    this.enemies = [];
    this.lives = 5;

    // Initialize player positions and runtime state
    let i = 0;
    Object.keys(players).forEach(id => {
      const p = players[id];
      p.x = (i % 2 === 0) ? -0.4 : 0.4; // left / right start
      p.y = 0.9; // bottom area
      p.w = PLAYER_W; p.h = PLAYER_H;
      // give the second connected player a different color for easy distinction
      p.color = (i % 2 === 0) ? '#88ff88' : '#88ccff';
      // initialize score for players
      p.score = 0;

      this.playerState[id] = {
        heat: 0,
        isOverheated: false,
        overheatedUntil: 0,
        lastShotAt: 0,
        shieldExpiresAt: 0,
        shieldCooldownUntil: 0,
        powerups: {}
      };
      i += 1;
    });

    // spawn an initial predictable wave (rows determine enemy types)
    this.spawnInitialWave(3, 7);
  }

  private spawnInitialWave(rows: number, cols: number){
    const startX = -0.9;
    const spacingX = 1.8 / Math.max(6, cols - 1);
    const startY = -0.8;
    const spacingY = 0.14;

    for(let r=0;r<rows;r++){
      for(let c=0;c<cols;c++){
        let type: EnemyType = 'PENDULUM';
        if (r === 1) type = 'JUMPER';
        if (r === 2) type = 'DIVER';

        const ex = startX + c * spacingX;
        const ey = startY + r * spacingY;
        const e: EnemyState = {
          id: this.nextEnemyId++,
          type,
          x: ex,
          y: ey,
          w: 0.10,
          h: 0.06,
          alive: true
        };

        if (type === 'PENDULUM'){
          // faster pendulum movement and wider amplitude/frequency for challenge
          e.vx = 0.35 * (Math.random() < 0.5 ? 1 : -1);
          e.baseY = ey;
          e.amplitude = 0.10 + Math.random()*0.06;
          e.frequency = 3 + Math.random()*2;
          e.phase = Math.random()*Math.PI*2;
          e.lastPeakFireAt = 0;
        } else if (type === 'JUMPER'){
          // quicker jumps and larger steps
          e.jumpIntervalMs = 1200;
          e.lastJumpAt = Date.now() + Math.random()*e.jumpIntervalMs;
          e.direction = Math.random() < 0.5 ? -1 : 1;
        } else if (type === 'DIVER'){
          // quicker dive trigger and faster dive speed
          e.diving = false;
          e.idleStartAt = 0;
          e.diveStartDelayMs = 2500;
          e.blinkMs = 250;
          e.lastBlinkAt = Date.now();
          e.visible = true;
          e.diveSpeed = 4.2;
        }

        this.enemies.push(e);
      }
    }
  }

  tick(incomingMessages: IncomingMsg[], dt: number): OutgoingMsg[] {
    const now = Date.now();

    // Process incoming messages
    incomingMessages.forEach(m => {
      const id = m.clientId;
      const payload = m.payload;
      if (!this.players[id]) return;

      if (payload.kind === 'move'){
        // authoritative player x from client
        this.players[id].x = Math.max(-1, Math.min(1 - PLAYER_W, payload.x));
      } else if (payload.kind === 'fire'){
        this.handleFire(id, now);
      } else if (payload.kind === 'shield'){
        this.handleShield(id, now);
      }
    });

    // Update player runtime state (heat dissipation & overheated recovery)
    Object.keys(this.players).forEach(id => {
      const st = this.playerState[id];
      if (!st) return;
      // if last shot not recent, dissipate heat
      const firingRecently = (Date.now() - st.lastShotAt) < 250;
      if (!firingRecently) st.heat = Math.max(0, st.heat - HEAT_DISSIPATION_RATE * dt);
      if (st.isOverheated && Date.now() >= st.overheatedUntil){
        st.isOverheated = false;
        st.heat = Math.min(100, 60);
      }
    });

    // Update enemies
    this.updateEnemies(dt, now);

    // Update projectiles
    for(const pr of this.projectiles) {
      if (!pr.alive) continue;
      pr.x += pr.vx * dt;
      pr.y += pr.vy * dt;
    }

    // Collisions: player projectiles -> enemies
    for(const pr of this.projectiles){
      if (!pr.alive) continue;
      if (pr.owner === 'player'){
        for(const en of this.enemies){
          if (!en.alive) continue;
          if (aabbCollision({x: pr.x - pr.w/2, y: pr.y - pr.h/2, w: pr.w, h: pr.h}, {x: en.x, y: en.y, w: en.w, h: en.h})){
            pr.alive = false;
            en.alive = false;
            // award score to shooter if known
            if ((pr as any).ownerId && this.players[(pr as any).ownerId]){
              const shooter = this.players[(pr as any).ownerId];
              shooter.score = (shooter.score || 0) + 1;
            }
            // schedule a respawn for this enemy type at a later time
            this.respawnQueue.push({ type: en.type, respawnAt: now + 2500 + Math.floor(Math.random()*2000) });
            break;
          }
        }
      } else {
        // enemy projectile -> players & shields
        for(const pid of Object.keys(this.players)){
          const p = this.players[pid];
          const st = this.playerState[pid];
          if (!p || !st) continue;
          const shieldActive = st.shieldExpiresAt > Date.now();
          // shield is rectangle in front of player
          if (shieldActive){
            const sw = PLAYER_W * 1.8;
            const sx = p.x + (PLAYER_W - sw)/2;
            const sy = p.y - 0.05;
            if (aabbCollision({x: pr.x - pr.w/2, y: pr.y - pr.h/2, w: pr.w, h: pr.h}, {x: sx, y: sy, w: sw, h: 0.06})){ pr.alive = false; break; }
          }
          if (aabbCollision({x: pr.x - pr.w/2, y: pr.y - pr.h/2, w: pr.w, h: pr.h}, {x: p.x, y: p.y, w: PLAYER_W, h: PLAYER_H})){ pr.alive = false; p.alive = false; this.lives -= 1; break; }
        }
      }
    }

    // Clean up dead projectiles and enemies
    this.projectiles = this.projectiles.filter(p => p.alive !== false && p.y > -2 && p.y < 2);
    this.enemies = this.enemies.filter(e => e.alive !== false);

    // Process pending respawns
    if (this.respawnQueue.length > 0) {
      const due = this.respawnQueue.filter(r => r.respawnAt <= now);
      for (const r of due) {
        this.enemies.push(this.generateEnemy(r.type));
      }
      this.respawnQueue = this.respawnQueue.filter(r => r.respawnAt > now);
    }

    // Attach runtime state (heat/shield) to players so clients can render HUDs
      Object.keys(this.players).forEach(pid => {
        const st = this.playerState[pid];
        if (st) {
          this.players[pid].runtimeState = {
            heat: st.heat,
            isOverheated: st.isOverheated,
            shieldActive: st.shieldExpiresAt > now,
            shieldCooldownMs: Math.max(0, st.shieldCooldownUntil - now),
            shieldTimeLeftMs: Math.max(0, st.shieldExpiresAt - now)
          };
        } else {
          this.players[pid].runtimeState = null;
        }
      });

      // Broadcast state
      return [{ payload: { players: this.players, enemies: this.enemies, projectiles: this.projectiles, lives: this.lives } }];
  }

  private handleFire(clientId: string, now: number){
    const p = this.players[clientId];
    const st = this.playerState[clientId];
    if (!p || !st) return;
    if (st.isOverheated && now < st.overheatedUntil) return;
    if (now - st.lastShotAt < 120) return; // fire rate limit

    st.lastShotAt = now;
    // heat handling
    st.heat += HEAT_PER_SHOT;
    if (st.heat >= 100){ st.heat = 100; st.isOverheated = true; st.overheatedUntil = now + OVERHEAT_DURATION_MS; }

    // spawn player projectile from player's center
    const proj: ProjectileState = {
      x: p.x + PLAYER_W/2,
      y: p.y,
      vx: 0,
      vy: PLAYER_PROJECTILE_SPEED,
      w: PROJ_W,
      h: PROJ_H,
      owner: 'player', ownerId: clientId,
      alive: true
    };
    this.projectiles.push(proj);
  }

  private handleShield(clientId: string, now: number){
    const st = this.playerState[clientId];
    if (!st) return;
    if (now < st.shieldCooldownUntil) return; // on cooldown
    st.shieldExpiresAt = now + SHIELD_DURATION_MS;
    st.shieldCooldownUntil = now + SHIELD_COOLDOWN_MS;
  }

  private updateEnemies(dt: number, now: number){
    const bounds = { left: -1, right: 1 };

    for(const e of this.enemies){
      if (!e.alive) continue;
      switch(e.type){
        case 'PENDULUM':
          e.x += (e.vx || 0) * dt;
          e.y = (e.baseY || 0) + (e.amplitude || 0) * Math.sin((e.frequency||1) * e.x + (e.phase||0));
          // fire at peaks
          const sinVal = Math.sin((e.frequency||1) * e.x + (e.phase||0));
          if (sinVal > 0.9 && (!e.lastPeakFireAt || now - e.lastPeakFireAt > 700)){
            e.lastPeakFireAt = now;
            // main downward shot
            this.projectiles.push({ x: e.x + e.w/2, y: e.y + e.h, vx: 0, vy: ENEMY_PROJECTILE_SPEED, w: PROJ_W, h: PROJ_H, owner: 'enemy', alive: true });
            // occasionally add spread shots for added difficulty
            if (Math.random() < 0.35) {
              this.projectiles.push({ x: e.x + e.w/2 + 0.03, y: e.y + e.h, vx: 0.14, vy: ENEMY_PROJECTILE_SPEED, w: PROJ_W, h: PROJ_H, owner: 'enemy', alive: true });
              this.projectiles.push({ x: e.x + e.w/2 - 0.03, y: e.y + e.h, vx: -0.14, vy: ENEMY_PROJECTILE_SPEED, w: PROJ_W, h: PROJ_H, owner: 'enemy', alive: true });
            }
          }
          // wrap horizontally
          if (e.x < bounds.left - 0.2) e.x = bounds.right + 0.2;
          if (e.x > bounds.right + 0.2) e.x = bounds.left - 0.2;
          break;

        case 'JUMPER':
          if (!e.lastJumpAt) e.lastJumpAt = now;
          if (now - e.lastJumpAt >= (e.jumpIntervalMs || 1200)){
            e.lastJumpAt = now;
            const step = 0.22 * (e.direction || 1);
            const target = (e.x || 0) + step;
            if (target < bounds.left || target + e.w > bounds.right){
              e.direction = -(e.direction || 1);
              e.y += 0.06;
            } else {
              e.x = target;
            }
          }
          break;

        case 'DIVER':
          const anyPlayerBelow = Object.values(this.players).some((p:any) => p.y > e.y);
          if (!e.diving){
            if (anyPlayerBelow){
              if (!e.idleStartAt) e.idleStartAt = now;
              if (!e.lastBlinkAt || now - e.lastBlinkAt >= (e.blinkMs||300)){
                e.visible = !e.visible; e.lastBlinkAt = now;
              }
              if (now - e.idleStartAt >= (e.diveStartDelayMs||3000)){
                e.diving = true; e.vy = e.diveSpeed || 3.2; e.visible = true;
              }
            } else {
              e.idleStartAt = 0; e.visible = true;
            }
          } else {
            e.y += (e.vy||0) * dt;
            if (e.y > 1.3) e.alive = false;
          }
          break;
      }
    }
  }

  // Create a new enemy instance for respawn with varied positions by type
  private generateEnemy(type: EnemyType): EnemyState {
    const startX = -0.9 + Math.random() * 1.8;
    let ex = startX;
    let ey = -0.8;
    const e: EnemyState = {
      id: this.nextEnemyId++,
      type,
      x: ex,
      y: ey,
      w: 0.10,
      h: 0.06,
      alive: true
    };

    if (type === 'PENDULUM'){
      e.vx = 0.3 * (Math.random() < 0.5 ? 1 : -1);
      e.baseY = ey + (Math.random()*0.06 - 0.02);
      e.amplitude = 0.08 + Math.random()*0.06;
      e.frequency = 2 + Math.random()*2;
      e.phase = Math.random()*Math.PI*2;
      e.lastPeakFireAt = 0;
    } else if (type === 'JUMPER'){
      e.jumpIntervalMs = 1100 + Math.floor(Math.random()*800);
      e.lastJumpAt = Date.now() + Math.random()*e.jumpIntervalMs;
      e.direction = Math.random() < 0.5 ? -1 : 1;
      e.y = -0.7 + Math.random()*0.06;
    } else if (type === 'DIVER'){
      e.diving = false;
      e.idleStartAt = 0;
      e.diveStartDelayMs = 2000 + Math.floor(Math.random()*1500);
      e.blinkMs = 200 + Math.floor(Math.random()*150);
      e.lastBlinkAt = Date.now();
      e.visible = true;
      e.diveSpeed = 4 + Math.random()*1.5;
      e.x = -0.9 + Math.random()*1.8;
      e.y = -0.95 + Math.random()*0.08;
    }
    return e;
  }

  isFinished(): boolean { return this.lives <= 0; }
}

/* =====================
   SpaceClient
   ===================== */
export class SpaceClient extends GameClient {
  private players: Record<string, any> = null;
  private enemies: EnemyState[] = [];
  private serverEnemies: EnemyState[] = [];
  private projectiles: ProjectileState[] = [];
  private messageQueue: any[] = [];
  private lives: number = 5;
  private localShieldUntil: number = 0;
  private localShieldCooldownUntil: number = 0;

  constructor(userInput: UserInput, myId: string){
    super(userInput, myId);

    // Simple key mapping for fire/shield (both Space/Enter and Shift/Ctrl)
    document.addEventListener('keydown', (e) => {
      if (e.code === 'Space' || e.code === 'Enter') this.messageQueue.push({ kind: 'fire' });
      if (e.code === 'ShiftLeft' || e.code === 'ShiftRight' || e.code === 'ControlLeft' || e.code === 'ControlRight'){
        const now = Date.now();
        if (now >= this.localShieldCooldownUntil){
          this.messageQueue.push({ kind: 'shield' });
          // immediate visual feedback and local cooldown prediction
          this.localShieldUntil = now + SHIELD_DURATION_MS;
          this.localShieldCooldownUntil = now + SHIELD_COOLDOWN_MS;
        }
      }
    });
  }

  init(players){ this.players = players; }

  draw(ctx: CanvasRenderingContext2D, dt: number){
    if (!this.players) return;

    const { screenW, screenH, moveDirectionX } = this.userInput;

    // Local smoothing movement for the local player
    const me = this.players[this.myId];
    if (me){
      // apply immediate local input
      me.x += moveDirectionX * dt * PLAYER_SPEED;
      // clamp locally
      if (me.x < -1) me.x = -1;
      if (me.x + PLAYER_W > 1) me.x = 1 - PLAYER_W;
      // Smoothly correct toward server authoritative position when available
      const serverX = (me as any)._serverX;
      if (typeof serverX === 'number'){
        // use lerp for smooth correction towards server value
        const alpha = Math.min(1, dt * 8);
        me.x = lerp(me.x, serverX, alpha);
      }
    }

    // Smooth other players toward their server positions
    const playerSmoothingAlpha = Math.min(1, dt * 8);
    Object.keys(this.players).forEach(pid => {
      if (pid === this.myId) return;
      const other = this.players[pid];
      if (!other) return;
      const sx = (other as any)._serverX;
      if (typeof sx === 'number') other.x = lerp(other.x, sx, playerSmoothingAlpha);
    });

    // Draw in normalized coordinates: translate/scale like other games
    ctx.save();
    ctx.translate(screenW/2, screenH/2);
    ctx.scale(screenW/2, screenH/2);

    // background
    ctx.fillStyle = '#001022'; ctx.fillRect(-1, -1, 2, 2);

    // players
    Object.keys(this.players).forEach(id => {
      const p = this.players[id];
      const color = p.color || '#88ff88';
      ctx.fillStyle = color;
      ctx.fillRect(p.x, p.y, PLAYER_W, PLAYER_H);
      // draw shield: prefer immediate local feedback for local player
      const st = (p as any).runtimeState;
      const isLocal = id === this.myId;
      const localShieldActive = isLocal && Date.now() < this.localShieldUntil;
      const serverShieldActive = !!(st && st.shieldActive);
      if (localShieldActive || serverShieldActive){
        const sw = PLAYER_W * 1.8; const sx = p.x + (PLAYER_W - sw)/2; const sy = p.y - 0.05;
        ctx.fillStyle = 'rgba(80,160,255,0.45)'; ctx.fillRect(sx, sy, sw, 0.06);
      }

      // draw heat bar & shield cooldown if available (server-provided runtimeState)
      if (st){
        // background for heat
        ctx.fillStyle = '#333'; ctx.fillRect(p.x, p.y - 0.04, PLAYER_W, 0.02);
        // heat fill
        ctx.fillStyle = st.isOverheated ? '#ff3333' : '#ffcc00';
        const heatW = (st.heat / 100) * PLAYER_W;
        ctx.fillRect(p.x, p.y - 0.04, heatW, 0.02);

        // shield cooldown indicator (under player) - use the larger of server-side and local predicted cooldown
        let cdMs = st.shieldCooldownMs || 0;
        if (isLocal){
          const localCd = Math.max(0, this.localShieldCooldownUntil - Date.now());
          cdMs = Math.max(cdMs, localCd);
        }
        const cdFrac = Math.min(1, cdMs / SHIELD_COOLDOWN_MS);
        ctx.fillStyle = '#555'; ctx.fillRect(p.x, p.y + PLAYER_H + 0.02, PLAYER_W, 0.01);
        ctx.fillStyle = '#00aaff'; ctx.fillRect(p.x, p.y + PLAYER_H + 0.02, PLAYER_W * (1 - cdFrac), 0.01);
      }
    });

    // enemies: smoothly lerp display enemies toward latest server snapshot
    const enemyAlpha = Math.min(1, dt * 10);
    this.enemies.forEach(e => {
      const serverE = this.serverEnemies.find(s => s.id === e.id);
      if (serverE) {
        e.x = lerp(e.x, serverE.x, enemyAlpha);
        e.y = lerp(e.y, serverE.y, enemyAlpha);
        e.visible = serverE.visible;
      }
      if (e.type === 'DIVER' && e.visible === false) return;
      ctx.fillStyle = e.type === 'PENDULUM' ? '#9bdfef' : e.type === 'JUMPER' ? '#ffd59e' : '#ff9090';
      ctx.fillRect(e.x, e.y, e.w, e.h);
    });

    // projectiles
    this.projectiles.forEach(p => {
      ctx.fillStyle = p.owner === 'player' ? '#ffffff' : '#ff4444';
      ctx.fillRect(p.x - p.w/2, p.y - p.h/2, p.w, p.h);
    });

    ctx.restore();

    // HUD
    ctx.fillStyle = '#fff'; ctx.font = '20px Arial'; ctx.fillText(`Lives: ${this.lives}`, 12, 24);
    // Draw player scores
    ctx.font = '14px Arial';
    let sy = 44;
    Object.keys(this.players || {}).forEach(id => {
      const p = this.players[id];
      const score = (p && p.score) ? p.score : 0;
      const name = (p && p.name) ? p.name : id;
      ctx.fillText(`${name}: ${score}`, 12, sy);
      sy += 18;
    });
  }

  handleMessage(message: any){
    // Merge server snapshot with local state and separate server enemies for smoothing.
    const srvPlayers = message.players || {};
    if (!this.players) {
      this.players = {};
      Object.keys(srvPlayers).forEach(id => {
        this.players[id] = { ...srvPlayers[id] };
        (this.players[id] as any)._serverX = srvPlayers[id].x;
      });
    } else {
      Object.keys(srvPlayers).forEach(id => {
        const server = srvPlayers[id];
        if (id === this.myId) {
          const local = this.players[id] || {};
          const preservedX = local.x !== undefined ? local.x : server.x;
          this.players[id] = { ...server, x: preservedX };
          (this.players[id] as any)._serverX = server.x;
          this.players[id].runtimeState = server.runtimeState;
        } else {
          if (!this.players[id]) {
            this.players[id] = { ...server };
            (this.players[id] as any)._serverX = server.x;
          } else {
            // keep local display x, but set server correction target and runtime info
            (this.players[id] as any)._serverX = server.x;
            this.players[id].runtimeState = server.runtimeState;
            if (server.color && !this.players[id].color) this.players[id].color = server.color;
          }
        }
      });
    }

    // store authoritative enemy snapshot; prepare display enemies if first time
    this.serverEnemies = message.enemies || [];
    if (!this.enemies || this.enemies.length === 0) {
      this.enemies = this.serverEnemies.map(e => ({ ...e }));
    } else {
      // update/insert display enemies and mark removals
      for (const se of this.serverEnemies) {
        const disp = this.enemies.find(d => d.id === se.id);
        if (!disp) this.enemies.push({ ...se });
        else {
          (disp as any)._serverX = se.x;
          (disp as any)._serverY = se.y;
          disp.visible = se.visible;
          disp.w = se.w; disp.h = se.h; disp.type = se.type;
        }
      }
      // remove display enemies that the server no longer has
      this.enemies = this.enemies.filter(d => this.serverEnemies.some(s => s.id === d.id));
    }

    // projectiles and lives are displayed directly
    this.projectiles = message.projectiles || [];
    this.lives = message.lives;
  }

  flushMessages(): any[] {
    if (!this.players) return [];
    const me = this.players[this.myId];
    if (!me) return [];

    const msgs = [];
    msgs.push({ kind: 'move', x: me.x });
    // append queued actions (fire/shield)
    msgs.push(...this.messageQueue);
    this.messageQueue = [];
    return msgs;
  }

  isFinished(): boolean { return this.lives <= 0; }
}
