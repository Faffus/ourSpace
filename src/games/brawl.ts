import { GameClient, GameServer } from './game';
import { IncomingMsg, OutgoingMsg } from '../server';
import { UserInput } from '../client/user-input';

// ==========================================
// 1. COSTANTI
// ==========================================

const VIRTUAL_W = 1000;
const VIRTUAL_H = 600;

// Fisica
const GRAVITY        = 1400;
const JUMP_FORCE     = 620;
const MOVE_SPEED     = 360;
const MAX_FALL_SPEED = 1200;
const FRICTION_GROUND = 22;
const FRICTION_AIR    = 5;
const AIR_ACCEL       = 900;

// Limiti arena
const MAP_LIMIT_LEFT   = -150;
const MAP_LIMIT_RIGHT  = 1150;
const MAP_LIMIT_TOP    = -500;
const MAP_LIMIT_BOTTOM = 800;

// Combattimento base
const DAMAGE_PER_HIT   = 10;
const BASE_KNOCKBACK_X = 440;
const BASE_KNOCKBACK_Y = 180;
const KNOCKBACK_SCALE  = 50;
const KNOCKBACK_CAP    = 100.0;
const HITSTUN_DURATION = 0.18;

// Hitbox attacco base (senza powerup)
const ATTACK_W_BASE   = 48;
const ATTACK_H        = 26;
const ATTACK_Y_OFFSET = 6;

// Vite e rispawn
const MAX_LIVES         = 3;
const RESPAWN_TIME      = 2.0;
const KILL_MSG_DURATION = 2.5;

// Power up
const POWERUP_SPAWN_INTERVAL = 8.0;   // secondi tra uno spawn e il successivo
const POWERUP_MAX_ON_MAP     = 2;     // massimo simultanei sulla mappa
const POWERUP_DURATION       = 20.0;  // durata del powerup sul player (secondi)
const POWERUP_RADIUS         = 16;    // raggio hitbox raccolta

// Effetti dei singoli powerup
const PU_ATTACK_BONUS_W  = 40;   // px extra di portata attacco
const PU_HEAL_AMOUNT     = 25;   // % di danno curato
const PU_FORCE_DMG_BONUS = 5;    // danno extra per colpo con powerup forza
const PU_FORCE_KB_BONUS  = 80;   // px/s extra di knockback con powerup forza

// ==========================================
// INTERFACCE
// ==========================================

interface Platform {
    x: number;
    y: number;
    w: number;
    h: number;
    isSolid: boolean;
    speed?: number; // piattaforma mobile: velocita px/s
    xMin?:  number;
    xMax?:  number;
    dir?:   number; // 1 = destra, -1 = sinistra
}

// Tipi di powerup disponibili
type PowerUpType = "attack" | "heal" | "force";

interface PowerUp {
    id:     number;        // id univoco per tracking
    x:      number;
    y:      number;
    type:   PowerUpType;
    active: boolean;       // false = gia raccolto, da rimuovere
}

interface PlayerState {
    x: number;
    y: number;
    w: number;
    h: number;

    vx: number;
    vy: number;

    color: string;

    facingRight:        boolean;
    isOnGround:         boolean;
    jumpsLeft:          number;
    jumpKeyWasPressed:  boolean;

    isAttacking: boolean;
    hasHit:      boolean;
    hitstun:     number;

    damage:       number;
    lives:        number;
    isDead:       boolean;
    respawnTimer: number;
    spawnIndex:   number;

    // Powerup attivo sul player
    activePowerUp:      PowerUpType | null; // tipo attivo, null se nessuno
    powerUpTimer:       number;             // secondi rimasti
}

// ==========================================
// MAPPA
// ==========================================

const PLATFORMS: Platform[] = [
    // Pavimento principale (solido)
    { x: 100, y: 450, w: 800, h: 35, isSolid: true },

    // Piattaforme laterali basse
    { x: 60,  y: 340, w: 120, h: 15, isSolid: false },
    { x: 820, y: 340, w: 120, h: 15, isSolid: false },

    // Piattaforme medie
    { x: 210, y: 290, w: 140, h: 15, isSolid: false },
    { x: 650, y: 290, w: 140, h: 15, isSolid: false },

    // Piattaforma alta centrale
    { x: 420, y: 170, w: 160, h: 15, isSolid: false },

    // Piattaforme laterali alte
    { x: 120, y: 200, w: 110, h: 15, isSolid: false },
    { x: 770, y: 200, w: 110, h: 15, isSolid: false },

    // Piattaforma mobile
    { x: 390, y: 330, w: 130, h: 15, isSolid: false, speed: 90, xMin: 280, xMax: 590, dir: 1 }
];

// Posizioni valide per lo spawn dei powerup: [x, y] centrati sopra le piattaforme
const POWERUP_SPAWN_SLOTS = [
    { x: 170, y: 320 },   // sopra piattaforma laterale sinistra bassa
    { x: 870, y: 320 },   // sopra piattaforma laterale destra bassa
    { x: 280, y: 270 },   // sopra piattaforma media sinistra
    { x: 720, y: 270 },   // sopra piattaforma media destra
    { x: 500, y: 150 },   // sopra piattaforma alta centrale
    { x: 175, y: 180 },   // sopra piattaforma laterale alta sinistra
    { x: 825, y: 180 },   // sopra piattaforma laterale alta destra
    { x: 500, y: 430 }    // sopra il pavimento, centro
];

const SPAWN_POSITIONS = [
    { x: 280, y: 360 },
    { x: 620, y: 360 }
];

// ==========================================
// 2. FUNZIONI DI SUPPORTO
// ==========================================

function spawnPlayer(p: PlayerState): void {
    const spawn = SPAWN_POSITIONS[p.spawnIndex];
    p.x = spawn.x;
    p.y = spawn.y;
    p.vx = 0;
    p.vy = 0;
    p.isOnGround        = false;
    p.jumpsLeft         = 2;
    p.jumpKeyWasPressed = false;
    p.isAttacking       = false;
    p.hasHit            = false;
    p.hitstun           = 0;
    p.isDead            = false;
    p.respawnTimer      = 0;
}

function colorName(color: string): string {
    if (color === "#ff0000") {
        return "ROSSO";
    }
    return "BLU";
}

// Sceglie un tipo di powerup casuale tra i tre disponibili
function randomPowerUpType(): PowerUpType {
    const roll = Math.random();
    if (roll < 0.33) {
        return "attack";
    }
    if (roll < 0.66) {
        return "heal";
    }
    return "force";
}

// Colore visivo associato al tipo di powerup
function powerUpColor(type: PowerUpType): string {
    if (type === "attack") {
        return "#00ccff"; // blu elettrico = portata
    }
    if (type === "heal") {
        return "#44ff88"; // verde = cura
    }
    return "#ff8800";     // arancione = forza
}

// Label breve del powerup per l'HUD
function powerUpLabel(type: PowerUpType): string {
    if (type === "attack") {
        return "PORTATA";
    }
    if (type === "heal") {
        return "CURA";
    }
    return "FORZA";
}

// ==========================================
// 3. IL SERVER
// ==========================================
export class BrawlServer extends GameServer {
    private players:       Record<string, PlayerState> = {};
    private winnerMessage: string  = "";
    private gameOver:      boolean = false;
    private killMessage:   string  = "";
    private killTimer:     number  = 0;

    // Powerup presenti sulla mappa
    private powerUps:       PowerUp[] = [];
    private powerUpTimer:   number    = POWERUP_SPAWN_INTERVAL; // countdown prossimo spawn
    private powerUpIdNext:  number    = 0;                      // id progressivo

    // ----------------------------------------
    // INIT
    // ----------------------------------------
    init(players: any): void {
        this.players = players;
        const colors = ["#ff0000", "#0000ff"];
        let i = 0;

        Object.keys(this.players).forEach(id => {
            const p = this.players[id] as PlayerState;

            p.w = 38;
            p.h = 42;

            p.color      = colors[i % 2];
            p.spawnIndex = i;

            p.lives  = MAX_LIVES;
            p.damage = 0;

            p.isDead       = false;
            p.respawnTimer = 0;

            p.activePowerUp = null;
            p.powerUpTimer  = 0;

            spawnPlayer(p);

            if (i === 0) {
                p.facingRight = true;
            } else {
                p.facingRight = false;
            }

            i++;
        });
    }

    // ----------------------------------------
    // TICK
    // ----------------------------------------
    tick(incomingMessages: IncomingMsg[], dt: number): OutgoingMsg[] {

        // --- Piattaforme mobili ---
        PLATFORMS.forEach(plat => {
            if (plat.speed === undefined) {
                return;
            }

            plat.x = plat.x + (plat.speed * plat.dir! * dt);

            if (plat.x >= plat.xMax!) {
                plat.x   = plat.xMax!;
                plat.dir = -1;
            }

            if (plat.x <= plat.xMin!) {
                plat.x   = plat.xMin!;
                plat.dir = 1;
            }
        });

        // --- Kill message timer ---
        if (this.killTimer > 0) {
            this.killTimer = this.killTimer - dt;
            if (this.killTimer <= 0) {
                this.killMessage = "";
                this.killTimer   = 0;
            }
        }

        // --- Spawn powerup ---
        // Contiamo quanti powerup sono ancora attivi sulla mappa
        let activePowerUpsOnMap = 0;
        this.powerUps.forEach(pu => {
            if (pu.active === true) {
                activePowerUpsOnMap = activePowerUpsOnMap + 1;
            }
        });

        // Countdown spawn: scatta solo se c'è spazio
        if (activePowerUpsOnMap < POWERUP_MAX_ON_MAP) {
            this.powerUpTimer = this.powerUpTimer - dt;
            if (this.powerUpTimer <= 0) {
                this.powerUpTimer = POWERUP_SPAWN_INTERVAL;

                // Scegli uno slot casuale tra quelli disponibili
                const slotIndex = Math.floor(Math.random() * POWERUP_SPAWN_SLOTS.length);
                const slot      = POWERUP_SPAWN_SLOTS[slotIndex];

                const newPu: PowerUp = {
                    id:     this.powerUpIdNext,
                    x:      slot.x,
                    y:      slot.y,
                    type:   randomPowerUpType(),
                    active: true
                };

                this.powerUpIdNext = this.powerUpIdNext + 1;
                this.powerUps.push(newPu);
            }
        }

        // Pulizia powerup non attivi (raccolti nei tick precedenti)
        this.powerUps = this.powerUps.filter(pu => pu.active === true);

        // --- A. INPUT ---
        incomingMessages.forEach(msg => {
            const p    = this.players[msg.clientId];
            const keys = msg.payload.keys;

            if (p === undefined) {
                return;
            }

            if (p.isDead === true) {
                return;
            }

            if (p.hitstun > 0) {
                return;
            }

            // Movimento orizzontale
            if (keys.A === true) {
                p.facingRight = false;
                if (p.isOnGround === true) {
                    p.vx = -MOVE_SPEED;
                } else {
                    p.vx = p.vx - (AIR_ACCEL * dt);
                    if (p.vx < -MOVE_SPEED) {
                        p.vx = -MOVE_SPEED;
                    }
                }
            } else if (keys.D === true) {
                p.facingRight = true;
                if (p.isOnGround === true) {
                    p.vx = MOVE_SPEED;
                } else {
                    p.vx = p.vx + (AIR_ACCEL * dt);
                    if (p.vx > MOVE_SPEED) {
                        p.vx = MOVE_SPEED;
                    }
                }
            }

            // Salto doppio
            if (keys.W === true) {
                if (p.jumpKeyWasPressed === false) {
                    if (p.jumpsLeft > 0) {
                        p.vy         = -JUMP_FORCE;
                        p.jumpsLeft  = p.jumpsLeft - 1;
                        p.isOnGround = false;
                    }
                }
                p.jumpKeyWasPressed = true;
            } else {
                p.jumpKeyWasPressed = false;
            }

            // Attacco
            if (keys.SPACE === true) {
                if (p.isAttacking === false) {
                    p.hasHit = false;
                }
                p.isAttacking = true;
            } else {
                p.isAttacking = false;
            }
        });

        // --- B. FISICA E COLLISIONI ---
        Object.keys(this.players).forEach(id => {
            const p = this.players[id];

            // Rispawn
            if (p.isDead === true) {
                p.respawnTimer = p.respawnTimer - dt;
                if (p.respawnTimer <= 0) {
                    spawnPlayer(p);
                    p.damage = 0;
                    // Il powerup si perde alla morte
                    p.activePowerUp = null;
                    p.powerUpTimer  = 0;
                }
                return;
            }

            // Hitstun
            if (p.hitstun > 0) {
                p.hitstun = p.hitstun - dt;
                if (p.hitstun < 0) {
                    p.hitstun = 0;
                }
            }

            // Powerup timer
            if (p.activePowerUp !== null) {
                p.powerUpTimer = p.powerUpTimer - dt;
                if (p.powerUpTimer <= 0) {
                    p.activePowerUp = null;
                    p.powerUpTimer  = 0;
                }
            }

            // Gravita con cap caduta
            p.vy = p.vy + (GRAVITY * dt);
            if (p.vy > MAX_FALL_SPEED) {
                p.vy = MAX_FALL_SPEED;
            }

            // Frizione orizzontale
            const friction = p.isOnGround === true ? FRICTION_GROUND : FRICTION_AIR;

            if (p.vx > 0) {
                p.vx = p.vx - (p.vx * friction * dt);
                if (p.vx < 1) {
                    p.vx = 0;
                }
            } else if (p.vx < 0) {
                p.vx = p.vx - (p.vx * friction * dt);
                if (p.vx > -1) {
                    p.vx = 0;
                }
            }

            const oldX = p.x;
            const oldY = p.y;

            p.x = p.x + (p.vx * dt);
            p.y = p.y + (p.vy * dt);

            p.isOnGround = false;

            // Collisioni piattaforme
            PLATFORMS.forEach(plat => {
                const overlapX = (p.x + p.w > plat.x) && (p.x < plat.x + plat.w);

                if (overlapX === false) {
                    return;
                }

                // Atterraggio dall'alto
                const wasFeetAbove = (oldY + p.h) <= (plat.y + 1);
                const nowFeetBelow = (p.y  + p.h) >= plat.y;

                if (p.vy >= 0) {
                    if (wasFeetAbove === true) {
                        if (nowFeetBelow === true) {
                            p.y          = plat.y - p.h;
                            p.vy         = 0;
                            p.jumpsLeft  = 2;
                            p.isOnGround = true;

                            if (plat.speed !== undefined) {
                                p.x = p.x + (plat.speed * plat.dir! * dt);
                            }
                        }
                    }
                }

                // Testa contro soffitto (solo solide)
                if (plat.isSolid === true) {
                    const wasHeadBelow = oldY >= (plat.y + plat.h - 1);
                    const nowHeadAbove = p.y  <= (plat.y + plat.h);

                    if (p.vy < 0) {
                        if (wasHeadBelow === true) {
                            if (nowHeadAbove === true) {
                                p.y  = plat.y + plat.h;
                                p.vy = 0;
                            }
                        }
                    }
                }
            });

            // --- Raccolta powerup ---
            // Il centro del player e il centro del powerup devono essere entro POWERUP_RADIUS
            const px = p.x + p.w / 2;
            const py = p.y + p.h / 2;

            this.powerUps.forEach(pu => {
                if (pu.active === false) {
                    return;
                }

                const dx   = px - pu.x;
                const dy   = py - pu.y;
                const dist = Math.sqrt(dx * dx + dy * dy);

                if (dist > POWERUP_RADIUS + 20) {
                    return;
                }

                // Raccolto: applica effetto immediato (cura) o attiva stato
                pu.active = false;

                if (pu.type === "heal") {
                    // Cura immediata: riduce il danno
                    p.damage = p.damage - PU_HEAL_AMOUNT;
                    if (p.damage < 0) {
                        p.damage = 0;
                    }
                    // La cura non attiva uno stato persistente
                    return;
                }

                // Gli altri due tipi si attivano come stato con timer
                p.activePowerUp = pu.type;
                p.powerUpTimer  = POWERUP_DURATION;
            });

            // --- Morte ---
            const isOutOfBounds =
                p.x < MAP_LIMIT_LEFT   ||
                p.x > MAP_LIMIT_RIGHT  ||
                p.y < MAP_LIMIT_TOP    ||
                p.y > MAP_LIMIT_BOTTOM;

            if (isOutOfBounds === true) {
                p.lives        = p.lives - 1;
                p.isDead       = true;
                p.respawnTimer = RESPAWN_TIME;

                this.killMessage = "GIOCATORE " + colorName(p.color) + " KO!";
                this.killTimer   = KILL_MSG_DURATION;

                if (p.lives <= 0) {
                    if (this.gameOver === false) {
                        this.gameOver = true;
                        Object.keys(this.players).forEach(otherId => {
                            if (otherId !== id) {
                                const winner = this.players[otherId];
                                this.winnerMessage = "GIOCATORE " + colorName(winner.color) + " VINCE!";
                            }
                        });
                    }
                }
            }
        });

        // --- C. COMBATTIMENTO ---
        Object.keys(this.players).forEach(id => {
            const p = this.players[id];

            if (p.isDead === true) {
                return;
            }

            if (p.isAttacking === false) {
                return;
            }

            if (p.hasHit === true) {
                return;
            }

            // Portata attacco: base + bonus se powerup "attack" attivo
            let currentAttackW = ATTACK_W_BASE;
            if (p.activePowerUp === "attack") {
                currentAttackW = currentAttackW + PU_ATTACK_BONUS_W;
            }

            const attackY = p.y + ATTACK_Y_OFFSET;
            let   attackX = 0;

            if (p.facingRight === true) {
                attackX = p.x + p.w;
            } else {
                attackX = p.x - currentAttackW;
            }

            Object.keys(this.players).forEach(victimId => {
                const victim = this.players[victimId];

                if (victimId === id) {
                    return;
                }

                if (victim.isDead === true) {
                    return;
                }

                const hitX = (attackX < victim.x + victim.w) && (attackX + currentAttackW > victim.x);
                const hitY = (attackY < victim.y + victim.h) && (attackY + ATTACK_H > victim.y);

                if (hitX === false) {
                    return;
                }

                if (hitY === false) {
                    return;
                }

                // Colpito
                p.hasHit = true;

                // Danno base + bonus forza
                let hitDamage = DAMAGE_PER_HIT;
                if (p.activePowerUp === "force") {
                    hitDamage = hitDamage + PU_FORCE_DMG_BONUS;
                }

                victim.damage = victim.damage + hitDamage;

                // Moltiplicatore knockback
                let multiplier = 1 + (victim.damage / KNOCKBACK_SCALE);
                if (multiplier > KNOCKBACK_CAP) {
                    multiplier = KNOCKBACK_CAP;
                }

                // Knockback orizzontale + bonus forza
                let finalVx = BASE_KNOCKBACK_X * multiplier;
                if (p.activePowerUp === "force") {
                    finalVx = finalVx + PU_FORCE_KB_BONUS;
                }

                if (p.facingRight === true) {
                    victim.vx = finalVx;
                } else {
                    victim.vx = -finalVx;
                }

                // Knockback verticale
                victim.vy = -(BASE_KNOCKBACK_Y * multiplier);

                victim.hitstun    = HITSTUN_DURATION;
                victim.isOnGround = false;
                victim.jumpsLeft  = 0;
            });
        });

        return [{ payload: {
            players:       this.players,
            winnerMessage: this.winnerMessage,
            killMessage:   this.killMessage,
            platforms:     PLATFORMS,
            powerUps:      this.powerUps,
            gameOver:      this.gameOver
        }}];
    }

    isFinished(): boolean {
        return this.gameOver;
    }
}

// ==========================================
// 4. IL CLIENT
// ==========================================
export class BrawlClient extends GameClient {
    private players:       any    = null;
    private winnerMessage: string = "";
    private killMessage:   string = "";
    private platforms:     any[]  = PLATFORMS;
    private powerUps:      any[]  = [];
    private gameOver: boolean = false;

    // Accumulatore tempo per animazione glow powerup
    private time: number = 0;

    private keys: Record<string, boolean> = {
        A:     false,
        D:     false,
        W:     false,
        SPACE: false
    };

    constructor(userInput: UserInput, myId: string) {
        super(userInput, myId);

        window.addEventListener('keydown', (e) => {
            if (e.code === 'KeyA')  { this.keys.A     = true; }
            if (e.code === 'KeyD')  { this.keys.D     = true; }
            if (e.code === 'KeyW')  { this.keys.W     = true; }
            if (e.code === 'Space') { this.keys.SPACE = true; }
        });

        window.addEventListener('keyup', (e) => {
            if (e.code === 'KeyA')  { this.keys.A     = false; }
            if (e.code === 'KeyD')  { this.keys.D     = false; }
            if (e.code === 'KeyW')  { this.keys.W     = false; }
            if (e.code === 'Space') { this.keys.SPACE = false; }
        });

        // Click sui pulsanti post-match
        // Le coordinate dei pulsanti dipendono da screenW/screenH che cambiano,
        // quindi ricalcoliamo ogni click in base alle dimensioni correnti.
        window.addEventListener('click', (e) => {
            if (this.winnerMessage === "") {
                return;
            }

            const { screenW, screenH } = this.userInput;

            const btnW   = 160;
            const btnH   = 44;
            const gap    = 20;
            const totalW = btnW * 2 + gap;
            const startX = screenW / 2 - totalW / 2;
            const btnY   = screenH / 2 + 20;
            const lobbyX = startX + btnW + gap;

            const mx = e.clientX;
            const my = e.clientY;

            // Click su LOBBY: torna alla pagina precedente (la lobby del professore)
            const inLobby =
                mx >= lobbyX       &&
                mx <= lobbyX + btnW &&
                my >= btnY         &&
                my <= btnY + btnH;

            if ( inLobby ) {
                this.gameOver = true;
            }
        });
    }

    async init(players: any): Promise<void> {
        return Promise.resolve();
    }

    handleMessage(message: any): void {
        if (message.payload !== undefined) {
            if (message.payload.players !== undefined) {
                this.players = message.payload.players;
            }
            if (message.payload.winnerMessage !== undefined) {
                this.winnerMessage = message.payload.winnerMessage;
            }
            if (message.payload.killMessage !== undefined) {
                this.killMessage = message.payload.killMessage;
            }
            if (message.payload.platforms !== undefined) {
                this.platforms = message.payload.platforms;
            }
            if (message.payload.powerUps !== undefined) {
                this.powerUps = message.payload.powerUps;
            }
            if (message.payload.gameOver !== undefined) {
                this.gameOver = message.payload.gameOver;
            }
        } else {
            if (message.players !== undefined) {
                this.players = message.players;
            }
            if (message.winnerMessage !== undefined) {
                this.winnerMessage = message.winnerMessage;
            }
            if (message.killMessage !== undefined) {
                this.killMessage = message.killMessage;
            }
            if (message.platforms !== undefined) {
                this.platforms = message.platforms;
            }
            if (message.powerUps !== undefined) {
                this.powerUps = message.powerUps;
            }
        }
    }

    flushMessages(): any[] {
        return [{
            kind: 'input',
            keys: {
                A:     this.keys.A,
                D:     this.keys.D,
                W:     this.keys.W,
                SPACE: this.keys.SPACE
            }
        }];
    }

    // ----------------------------------------
    // DRAW
    // ----------------------------------------
    draw(ctx: CanvasRenderingContext2D, dt: number): void {
        if (this.players === null) {
            return;
        }

        this.time = this.time + dt;

        const { screenW, screenH } = this.userInput;

        // Sfondo gradiente scuro
        const grad = ctx.createLinearGradient(0, 0, 0, screenH);
        grad.addColorStop(0,   "#1a1a2e");
        grad.addColorStop(0.6, "#16213e");
        grad.addColorStop(1,   "#0f3460");
        ctx.fillStyle = grad;
        ctx.fillRect(0, 0, screenW, screenH);

        // Trasformazione camera
        ctx.save();
        const scaleX  = screenW / VIRTUAL_W;
        const scaleY  = screenH / VIRTUAL_H;
        const scale   = Math.min(scaleX, scaleY);
        const offsetX = (screenW - VIRTUAL_W * scale) / 2;
        const offsetY = (screenH - VIRTUAL_H * scale) / 2;
        ctx.translate(offsetX, offsetY);
        ctx.scale(scale, scale);

        // Piattaforme
        this.drawPlatforms(ctx);

        // Powerup sulla mappa
        this.drawPowerUps(ctx);

        // Giocatori
        this.drawPlayers(ctx);

        ctx.restore();

        // HUD (fuori dalla camera)
        this.drawHUD(ctx, screenW, screenH);

        // Messaggi centrali in alto
        this.drawMessages(ctx, screenW, screenH);
    }

    // ----------------------------------------
    // DRAW: piattaforme
    // ----------------------------------------
    private drawPlatforms(ctx: CanvasRenderingContext2D): void {
        this.platforms.forEach((plat: any) => {
            const isMobile = plat.speed !== undefined;

            // Ombra
            ctx.fillStyle = "rgba(0, 0, 0, 0.3)";
            ctx.fillRect(plat.x + 4, plat.y + 6, plat.w, plat.h);

            if (plat.isSolid === true) {
                ctx.fillStyle = "#4a4a5a";
                ctx.fillRect(plat.x, plat.y, plat.w, plat.h);
                // Bordo superiore chiaro
                ctx.fillStyle = "#6a6a7a";
                ctx.fillRect(plat.x, plat.y, plat.w, 6);
            } else if (isMobile === true) {
                ctx.fillStyle = "#7a4a2a";
                ctx.fillRect(plat.x, plat.y, plat.w, plat.h);
                ctx.fillStyle = "#c07840";
                ctx.fillRect(plat.x, plat.y, plat.w, 5);
            } else {
                ctx.fillStyle = "#2a5a38";
                ctx.fillRect(plat.x, plat.y, plat.w, plat.h);
                ctx.fillStyle = "#48a060";
                ctx.fillRect(plat.x, plat.y, plat.w, 5);
            }
        });
    }

    // ----------------------------------------
    // DRAW: powerup sulla mappa
    // ----------------------------------------
    private drawPowerUps(ctx: CanvasRenderingContext2D): void {
        this.powerUps.forEach((pu: any) => {
            if (pu.active === false) {
                return;
            }

            const color = powerUpColor(pu.type as PowerUpType);

            // Glow pulsante: varia l'alpha con il seno del tempo
            const pulse     = Math.sin(this.time * 4) * 0.3 + 0.5;
            const glowSize  = 22 + Math.sin(this.time * 4) * 4;

            // Alone esterno
            ctx.fillStyle = color.replace(")", ", " + (pulse * 0.4) + ")").replace("rgb", "rgba");
            ctx.beginPath();
            ctx.arc(pu.x, pu.y, glowSize, 0, Math.PI * 2);
            ctx.fill();

            // Cerchio principale
            ctx.fillStyle = color;
            ctx.beginPath();
            ctx.arc(pu.x, pu.y, 14, 0, Math.PI * 2);
            ctx.fill();

            // Bordo bianco
            ctx.strokeStyle = "rgba(255, 255, 255, 0.8)";
            ctx.lineWidth   = 2;
            ctx.beginPath();
            ctx.arc(pu.x, pu.y, 14, 0, Math.PI * 2);
            ctx.stroke();

            // Icona testuale al centro
            ctx.fillStyle  = "#ffffff";
            ctx.font       = "bold 11px Arial";
            ctx.textAlign  = "center";

            if (pu.type === "attack") {
                ctx.fillText("+A", pu.x, pu.y + 4);
            }

            if (pu.type === "heal") {
                ctx.fillText("+H", pu.x, pu.y + 4);
            }

            if (pu.type === "force") {
                ctx.fillText("+F", pu.x, pu.y + 4);
            }
        });
    }

    // ----------------------------------------
    // DRAW: giocatori con occhi e fascetta
    // ----------------------------------------
    private drawPlayers(ctx: CanvasRenderingContext2D): void {
        Object.keys(this.players).forEach(id => {
            const p = this.players[id];

            if (p.isDead === true) {
                return;
            }

            const cx = p.x + p.w / 2; // centro X del player

            // Ombra ellittica sul pavimento
            ctx.fillStyle = "rgba(0, 0, 0, 0.2)";
            ctx.beginPath();
            ctx.ellipse(cx, 455, p.w / 2, 5, 0, 0, Math.PI * 2);
            ctx.fill();

            // Glow del powerup attivo attorno al body
            if (p.activePowerUp !== null) {
                const puColor   = powerUpColor(p.activePowerUp as PowerUpType);
                const glowAlpha = Math.sin(this.time * 6) * 0.3 + 0.45;
                ctx.fillStyle   = puColor.replace(")", ", " + glowAlpha + ")").replace("rgb", "rgba");
                ctx.fillRect(p.x - 5, p.y - 5, p.w + 10, p.h + 10);
            }

            // --- Body ---
            ctx.fillStyle = p.color;
            ctx.fillRect(p.x, p.y, p.w, p.h);

            // Highlight superiore per dare volume
            ctx.fillStyle = "rgba(255, 255, 255, 0.20)";
            ctx.fillRect(p.x + 2, p.y + 2, p.w - 4, p.h * 0.30);

            // Contorno body
            ctx.strokeStyle = "rgba(0, 0, 0, 0.75)";
            ctx.lineWidth   = 2;
            ctx.strokeRect(p.x, p.y, p.w, p.h);

            // --- Fascetta sportiva in testa ---
            // Fascia bianca sopra il body
            ctx.fillStyle = "white";
            ctx.fillRect(p.x, p.y, p.w, 8);

            // Striscia colorata al centro della fascetta
            ctx.fillStyle = p.color === "#ff0000" ? "#aa0000" : "#0000aa";
            ctx.fillRect(p.x, p.y + 2, p.w, 4);

            // Contorno fascetta
            ctx.strokeStyle = "rgba(0,0,0,0.5)";
            ctx.lineWidth   = 1;
            ctx.strokeRect(p.x, p.y, p.w, 8);

            // --- Occhi ---
            // Gli occhi cambiano lato in base alla direzione
            // Occhio destro e sinistro: sfondo bianco + pupilla nera
            const eyeY      = p.y + 14;
            const eyeRadius = 4;

            let eyeLeftX  = 0;
            let eyeRightX = 0;

            // Gli occhi si trovano sul lato della faccia (dove il player guarda)
            if (p.facingRight === true) {
                // Faccia a destra: occhi sul lato destro del body
                eyeLeftX  = p.x + p.w - 22;
                eyeRightX = p.x + p.w - 8;
            } else {
                // Faccia a sinistra: occhi sul lato sinistro del body
                eyeLeftX  = p.x + 8;
                eyeRightX = p.x + 22;
            }

            // Bianco dell'occhio sinistro
            ctx.fillStyle = "white";
            ctx.beginPath();
            ctx.arc(eyeLeftX, eyeY, eyeRadius, 0, Math.PI * 2);
            ctx.fill();

            // Bianco dell'occhio destro
            ctx.beginPath();
            ctx.arc(eyeRightX, eyeY, eyeRadius, 0, Math.PI * 2);
            ctx.fill();

            // Pupilla sinistra: leggermente spostata nella direzione di sguardo
            ctx.fillStyle = "#111111";
            ctx.beginPath();

            if (p.facingRight === true) {
                ctx.arc(eyeLeftX + 1,  eyeY, 2, 0, Math.PI * 2);
            } else {
                ctx.arc(eyeLeftX - 1,  eyeY, 2, 0, Math.PI * 2);
            }

            ctx.fill();

            // Pupilla destra
            ctx.beginPath();

            if (p.facingRight === true) {
                ctx.arc(eyeRightX + 1, eyeY, 2, 0, Math.PI * 2);
            } else {
                ctx.arc(eyeRightX - 1, eyeY, 2, 0, Math.PI * 2);
            }

            ctx.fill();

            // Contorno occhi
            ctx.strokeStyle = "rgba(0,0,0,0.4)";
            ctx.lineWidth   = 1;
            ctx.beginPath();
            ctx.arc(eyeLeftX,  eyeY, eyeRadius, 0, Math.PI * 2);
            ctx.stroke();
            ctx.beginPath();
            ctx.arc(eyeRightX, eyeY, eyeRadius, 0, Math.PI * 2);
            ctx.stroke();

            // --- Percentuale danno sopra il player ---
            // Colore che vira verso il rosso con l'aumentare del danno
            const dmgRatio = Math.min(p.damage / 150, 1);
            const r        = Math.round(180 + dmgRatio * 75);
            const g        = Math.round(180 - dmgRatio * 160);
            ctx.fillStyle  = "rgb(" + r + ", " + g + ", 80)";
            ctx.font       = "bold 14px Arial";
            ctx.textAlign  = "center";
            ctx.fillText(p.damage + "%", cx, p.y - 6);

            // --- Effetto attacco ---
            // Calcola portata attuale (con eventuale bonus powerup)
            let currentAttackW = ATTACK_W_BASE;
            if (p.activePowerUp === "attack") {
                currentAttackW = currentAttackW + PU_ATTACK_BONUS_W;
            }

            if (p.isAttacking === true) {
                // Alone arancione esterno
                ctx.fillStyle = "rgba(255, 180, 0, 0.30)";
                if (p.facingRight === true) {
                    ctx.fillRect(p.x + p.w - 4,      p.y + ATTACK_Y_OFFSET - 5, currentAttackW + 8, ATTACK_H + 10);
                } else {
                    ctx.fillRect(p.x - currentAttackW - 4, p.y + ATTACK_Y_OFFSET - 5, currentAttackW + 8, ATTACK_H + 10);
                }

                // Hitbox gialla
                ctx.fillStyle = "rgba(255, 220, 0, 0.80)";
                if (p.facingRight === true) {
                    ctx.fillRect(p.x + p.w,      p.y + ATTACK_Y_OFFSET, currentAttackW, ATTACK_H);
                } else {
                    ctx.fillRect(p.x - currentAttackW, p.y + ATTACK_Y_OFFSET, currentAttackW, ATTACK_H);
                }
            }
        });
    }

    // ----------------------------------------
    // HUD: pannelli in alto a sinistra e destra
    // ----------------------------------------
    private drawHUD(ctx: CanvasRenderingContext2D, screenW: number, screenH: number): void {
        const playerIds = Object.keys(this.players);

        playerIds.forEach((id, index) => {
            const p = this.players[id];

            let hudX = 16;
            if (index === 1) {
                hudX = screenW - 170;
            }
            const hudY  = 10;
            const hudW  = 154;
            const hudH  = p.activePowerUp !== null ? 72 : 52; // si allarga con powerup attivo

            // Sfondo
            ctx.fillStyle = "rgba(0, 0, 0, 0.65)";
            ctx.fillRect(hudX, hudY, hudW, hudH);

            // Bordo colorato del player
            ctx.strokeStyle = p.color;
            ctx.lineWidth   = 2;
            ctx.strokeRect(hudX, hudY, hudW, hudH);

            ctx.font      = "bold 13px Arial";
            ctx.textAlign = "left";

            // Riga 1: danno o respawn
            if (p.isDead === true) {
                ctx.fillStyle = "#888888";
                ctx.fillText("RESPAWN...", hudX + 8, hudY + 20);
            } else {
                ctx.fillStyle = "white";
                ctx.fillText("DANNO: " + p.damage + "%", hudX + 8, hudY + 20);
            }

            // Riga 2: vite
            ctx.fillStyle = p.color;
            ctx.fillText("VITE: " + p.lives + " / " + MAX_LIVES, hudX + 8, hudY + 40);

            // Riga 3 (solo se powerup attivo): tipo + timer
            if (p.activePowerUp !== null) {
                const puColor  = powerUpColor(p.activePowerUp as PowerUpType);
                const label    = powerUpLabel(p.activePowerUp as PowerUpType);
                const timerSec = Math.ceil(p.powerUpTimer);

                ctx.fillStyle = puColor;
                ctx.fillText(label + " " + timerSec + "s", hudX + 8, hudY + 60);
            }
        });
    }

    // ----------------------------------------
    // Messaggi centrali: KO e vittoria, in alto
    // ----------------------------------------
    private drawMessages(ctx: CanvasRenderingContext2D, screenW: number, screenH: number): void {
        // Messaggi nella zona alta, testo semplice senza sfondo
        const msgY = 62;

        // KO: solo testo arancione
        if (this.killMessage !== "") {
            ctx.fillStyle = "#ff6622";
            ctx.font      = "bold 20px Arial";
            ctx.textAlign = "center";
            ctx.fillText(this.killMessage, screenW / 2, msgY);
        }

        // Vittoria: testo dorato + pulsanti sotto
        if (this.winnerMessage !== "") {
            ctx.fillStyle = "#FFD700";
            ctx.font      = "bold 26px Arial";
            ctx.textAlign = "center";
            ctx.fillText(this.winnerMessage, screenW / 2, msgY);

            // Pulsanti post-match centrati a meta schermo
            this.drawEndButtons(ctx, screenW, screenH);
        }
    }

    // ----------------------------------------
    // Pulsanti fine match: RIVINCITA e LOBBY
    // ----------------------------------------
    private drawEndButtons(ctx: CanvasRenderingContext2D, screenW: number, screenH: number): void {
        const btnW   = 160;
        const btnH   = 44;
        const gap    = 20;
        const totalW = btnW * 2 + gap;
        const startX = screenW / 2 - totalW / 2;
        const btnY   = screenH / 2 + 20;

        // Pulsante LOBBY
        const lobbyX = startX + btnW + gap;
        ctx.fillStyle = "rgba(60, 60, 180, 0.85)";
        ctx.fillRect(lobbyX, btnY, btnW, btnH);
        ctx.strokeStyle = "#8888ff";
        ctx.lineWidth   = 2;
        ctx.strokeRect(lobbyX, btnY, btnW, btnH);
        ctx.fillStyle   = "white";
        ctx.font        = "bold 16px Arial";
        ctx.textAlign   = "center";
        ctx.fillText("TORNA LOBBY", lobbyX + btnW / 2, btnY + 28);
    }

    isFinished(): boolean {
        return this.gameOver;
    }
}