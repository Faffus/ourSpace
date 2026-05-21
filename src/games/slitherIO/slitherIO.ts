import { GameServer, GameClient } from '../game';
import { UserInput } from '../../client/user-input';
import { IncomingMsg, OutgoingMsg } from '../../server';

// ========================== INTERFACCE ==========================
export interface SlitherPlayer {
    id: string;
    name: string;
    skin: string;
    x: number;
    y: number;
    dx: number;
    dy: number;
    score: number;
    lengthTarget: number;
    trail: Array<{ x: number; y: number }>;
    alive: boolean;
    boost: boolean;
    boostMassReserved: number;
    boostTimeLeft: number;
    boostCooldownLeft: number;
}

interface FoodItem {
    id: string;
    x: number;
    y: number;
    color: string;
    rare: boolean;
    points: number;
    growth: number;
}

// ========================== COSTANTI ==========================
const PLAYER_SIZE = 0.25;
const FOOD_SIZE = 0.12;

const MAP_BOUNDS = {
    top: -5,
    bottom: 5,
    left: -8,
    right: 8
};

const MAP_WIDTH = Math.abs(MAP_BOUNDS.right - MAP_BOUNDS.left);
const MAP_HEIGHT = Math.abs(MAP_BOUNDS.bottom - MAP_BOUNDS.top);

const BASE_SPEED = 2.2;
const BOOST_SPEED = 3.6;
const BOOST_DURATION = 3;
const BOOST_COOLDOWN = 10;

const MIN_PLAYER_LENGTH = 1;
const FOOD_COUNT = 34;
const COSMIC_EVENT_INTERVAL = 8;
const CENTER_FOOD_RADIUS = 2;

// ========================== FUNZIONI DI UTILITÀ ========================== 
// selezionare direzioni casuali quando il serpente tocca i bordi
function randomChoice<T>(items: T[]): T {
    return items[Math.floor(Math.random() * items.length)];
}

// spawn cibo evitando che sia troppo vicino ai bordi
function randomGridPosition(): { x: number; y: number } {
    const cols = Math.max(1, Math.floor(MAP_WIDTH / FOOD_SIZE) - 2);
    const rows = Math.max(1, Math.floor(MAP_HEIGHT / FOOD_SIZE) - 2);

    const x = MAP_BOUNDS.left + FOOD_SIZE + Math.floor(Math.random() * cols) * FOOD_SIZE;
    const y = MAP_BOUNDS.top + FOOD_SIZE + Math.floor(Math.random() * rows) * FOOD_SIZE;
    return { x, y };
}

// sovrapposizione quadrati (gestione collisioni)
function squareOverlap(
    x1: number, y1: number, size1: number,
    x2: number, y2: number, size2: number
): boolean {
    return Math.abs(x1 - x2) <= (size1 + size2) / 2 &&
        Math.abs(y1 - y2) <= (size1 + size2) / 2;
}

// nuova direzione serpente quando tocca un bordo
function chooseValidDirectionNearBorder(player: SlitherPlayer): void {
    // Array per memorizzare le direzioni attualmente sicure e percorribili
    const possible: Array<{ dx: number; dy: number }> = [];

    if (player.x > MAP_BOUNDS.left + PLAYER_SIZE) possible.push({ dx: -1, dy: 0 });
    if (player.x < MAP_BOUNDS.right - PLAYER_SIZE) possible.push({ dx: 1, dy: 0 });
    if (player.y > MAP_BOUNDS.top + PLAYER_SIZE) possible.push({ dx: 0, dy: -1 });
    if (player.y < MAP_BOUNDS.bottom - PLAYER_SIZE) possible.push({ dx: 0, dy: 1 });

    // Se non ci sono direzioni sicure ferma il serpente
    if (possible.length === 0) {
        player.dx = 0;
        player.dy = 0;
        return;
    }

    const choice = randomChoice(possible);
    player.dx = choice.dx;
    player.dy = choice.dy;
}

// gestione collisione per evitare di uscire dalla mappa
function keepInsideMap(player: SlitherPlayer): void {
    const halfSize = PLAYER_SIZE / 2;
    let touched = false;

    if (player.x - halfSize < MAP_BOUNDS.left) {
        player.x = MAP_BOUNDS.left + halfSize;
        touched = true;
    }
    if (player.x + halfSize > MAP_BOUNDS.right) {
        player.x = MAP_BOUNDS.right - halfSize;
        touched = true;
    }

    if (player.y - halfSize < MAP_BOUNDS.top) {
        player.y = MAP_BOUNDS.top + halfSize;
        touched = true;
    }
    if (player.y + halfSize > MAP_BOUNDS.bottom) {
        player.y = MAP_BOUNDS.bottom - halfSize;
        touched = true;
    }

    if (touched) chooseValidDirectionNearBorder(player);
}

// Genera un ID univoco per oggetti
function createId(prefix: string): string {
    return `${prefix}-${Math.floor(Math.random() * 1000000)}`;
}

// ========================== SERVER ==========================

export class SlitherServer extends GameServer {
    private players: Record<string, SlitherPlayer> = {};
    private foods: FoodItem[] = [];
    private remains: FoodItem[] = [];
    private cosmicTimer = 0;
    private gameOver = false;
    private winnerId: string | null = null; 
    private gameOverTimestamp = 0;
    private readonly GAME_OVER_DELAY = 5000;

    init(players: Record<string, any>) {
        this.players = {};
        this.foods = [];
        this.remains = [];
        this.cosmicTimer = 0;
        this.gameOver = false;
        this.winnerId = null;

        Object.keys(players).forEach(id => {
            const data = players[id] || {};

            this.players[id] = {
                id,
                name: data.name || `Giocatore${id}`,
                skin: '#cc6600',
                x: (Math.random() - 0.5) * MAP_WIDTH * 0.6,
                y: (Math.random() - 0.5) * MAP_HEIGHT * 0.6,
                dx: Math.random() < 0.5 ? -1 : 1,
                dy: 0,
                score: 0,
                lengthTarget: MIN_PLAYER_LENGTH,
                trail: [],
                alive: true,
                boost: false,
                boostMassReserved: 0,
                boostTimeLeft: data.boostTimeLeft || BOOST_DURATION,
                boostCooldownLeft: data.boostCooldownLeft || 0,
            };
        });

        this.spawnFoodUntilBalanced();
    }

    private spawnFoodUntilBalanced(): void {
        while (this.foods.length + this.remains.length < FOOD_COUNT) {
            const pos = randomGridPosition();
            const isCenter = Math.abs(pos.x) < CENTER_FOOD_RADIUS && Math.abs(pos.y) < CENTER_FOOD_RADIUS;

            this.foods.push({
                id: createId('food'),
                x: pos.x,
                y: pos.y,
                color: isCenter ? '#8811cc' : '#77cc11',
                rare: isCenter,

                points: isCenter ? 3 : 1,
                growth: isCenter ? 3 : 1,
            });
        }
    }

    // Spawna cibo speciale "cosmic" blu
    private spawnCosmicFood(): void {
        for (let i = 0; i < 5; i++) {
            const pos = randomGridPosition();
            this.foods.push({
                id: createId('cosmic'),
                x: pos.x,
                y: pos.y,
                color: '#33ccff',
                rare: true,
                points: 5,
                growth: 5,
            });
        }
    }

    private normalizeDirection(player: SlitherPlayer): void {
        const len = Math.sqrt(player.dx * player.dx + player.dy * player.dy);
        if (len === 0) return;
        player.dx /= len;
        player.dy /= len;
    }

    private collectAlivePlayers(): SlitherPlayer[] {
        return Object.values(this.players).filter(p => p.alive);
    }

    private detectPlayerCollision(): void {
        const alive = this.collectAlivePlayers();

        alive.forEach(attacker => {
            const headX = attacker.x;
            const headY = attacker.y;

            Object.values(this.players).forEach(target => {
                if (!target.alive || target.id === attacker.id) return;

                // Testa contro testa
                if (squareOverlap(headX, headY, PLAYER_SIZE, target.x, target.y, PLAYER_SIZE)) {
                    this.handlePlayerDeath(attacker);
                    return;
                }

                // Testa contro coda
                for (const segment of target.trail) {
                    if (squareOverlap(headX, headY, PLAYER_SIZE, segment.x, segment.y, PLAYER_SIZE)) {
                        this.handlePlayerDeath(attacker);
                        return;
                    }
                }
            });
        });
    }

    private handlePlayerDeath(player: SlitherPlayer): void {
        player.alive = false;
        player.trail = [];
        player.boost = false;
    }

    tick(incomingMessages: IncomingMsg[], dt: number): OutgoingMsg[] {
        if (this.gameOver) {
            return [{
                payload: {
                    players: this.players,
                    foods: this.foods,
                    remains: this.remains,
                    gameOver: true,
                    winnerId: this.winnerId
                }
            }];
        }

        incomingMessages.forEach(msg => {
            const player = this.players[msg.clientId];
            if (!player || !player.alive) return;

            const payload = msg.payload;
            if (payload.kind !== 'input') return;
            if (typeof payload.dx === 'number' && typeof payload.dy === 'number') {
                player.dx = payload.dx;
                player.dy = payload.dy;
                this.normalizeDirection(player);
            }

            if (typeof payload.boost === 'boolean') {
                // può attivare turbo solo se non è in cooldown
                if (payload.boost) {
                    if (player.boostCooldownLeft <= 0 && player.boostTimeLeft > 0) {
                        player.boost = true;
                    }
                } else {
                    player.boost = false;
                }
            }
        });

        Object.values(this.players).forEach(player => {
            if (!player.alive) return;

            // cooldown turbo
            if (player.boostCooldownLeft > 0) {
                player.boostCooldownLeft -= dt;

                if (player.boostCooldownLeft < 0) {
                    player.boostCooldownLeft = 0;
                }
            }

            // gestione turbo
            if (player.boost && player.boostCooldownLeft <= 0) {
                player.boostTimeLeft -= dt;

                if (player.boostTimeLeft <= 0) {
                    player.boost = false;
                    player.boostTimeLeft = 0;
                    player.boostCooldownLeft = BOOST_COOLDOWN;
                }
            } else {
                // ricarica turbo quando non lo usa
                if (!player.boost && player.boostCooldownLeft <= 0) {
                    player.boostTimeLeft = BOOST_DURATION;
                }
            }

            const speed =
                player.boost &&
                player.boostCooldownLeft <= 0 &&
                player.boostTimeLeft > 0
                    ? BOOST_SPEED
                    : BASE_SPEED;

            player.x += player.dx * speed * dt;
            player.y += player.dy * speed * dt;

            keepInsideMap(player);

            player.trail.unshift({ x: player.x, y: player.y });

            while (player.trail.length > player.lengthTarget) {
                player.trail.pop();
            }

            this.foods = this.foods.filter(food => {
                if (squareOverlap(player.x, player.y, PLAYER_SIZE, food.x, food.y, FOOD_SIZE)) {
                    player.score += food.points;

                    player.lengthTarget = Math.max(
                        MIN_PLAYER_LENGTH,
                        player.lengthTarget + food.growth
                    );

                    return false;
                }
                return true;
            });
        });

        this.detectPlayerCollision();

        this.cosmicTimer += dt;
        if (this.cosmicTimer >= COSMIC_EVENT_INTERVAL) {
            this.cosmicTimer = 0;
            this.spawnCosmicFood();
        }

        this.spawnFoodUntilBalanced();

        const alivePlayers = this.collectAlivePlayers();
        if (!this.gameOver && alivePlayers.length <= 1) {
            this.gameOver = true;
            this.gameOverTimestamp = Date.now();

            this.winnerId = alivePlayers.length === 1 ? alivePlayers[0].id : null;
        }

        return [{
            payload: {
                players: this.players,
                foods: this.foods,
                remains: this.remains,
                gameOver: this.gameOver,
                winnerId: this.winnerId
            }
        }];
    }

    isFinished(): boolean {
        if (!this.gameOver) return false;
        return Date.now() - this.gameOverTimestamp >= this.GAME_OVER_DELAY;
    }
}

// ========================== CLIENT ==========================

export class SlitherClient extends GameClient {
    private players: Record<string, SlitherPlayer> = null;
    private localPlayerDead = false;
    private foods: FoodItem[] = [];
    private gameOver = false;
    private winnerId: string | null = null;
    private gameOverText = '';

    private gameOverTimestamp = 0;
    private readonly GAME_OVER_DISPLAY_DURATION = 5000;

    private boostActive = false;

    constructor(userInput: UserInput, myId: string) {
        super(userInput, myId);

        window.addEventListener('keydown', (event) => {
            if (event.code === 'Space') this.boostActive = true;
        });

        window.addEventListener('keyup', (event) => {
            if (event.code === 'Space') this.boostActive = false;
        });
    }

    init(players: Record<string, any>) {
        this.players = {};
        Object.keys(players).forEach(id => {
            const p = players[id];
            this.players[id] = {
                id,
                name: p.name || `Giocatore${id}`,
                skin: '#ff6600',
                x: p.x || 0,
                y: p.y || 0,
                dx: p.dx || 1,
                dy: p.dy || 0,
                score: p.score || 0,
                lengthTarget: p.lengthTarget || MIN_PLAYER_LENGTH,
                trail: Array.isArray(p.trail) ? p.trail.slice(0, p.lengthTarget) : [],
                alive: p.alive !== false,
                boost: false,
                boostMassReserved: 0,
                boostTimeLeft: p.boostTimeLeft || BOOST_DURATION,
                boostCooldownLeft: p.boostCooldownLeft || 0,
            };
        });
        return Promise.resolve();
    }

    private worldToScreenTransform(ctx: CanvasRenderingContext2D, screenW: number, screenH: number): void {
        ctx.translate(screenW / 2, screenH / 2);
        const scale = Math.min(screenW / MAP_WIDTH, screenH / MAP_HEIGHT);
        ctx.scale(scale, scale);
    }

    private drawSquare(ctx: CanvasRenderingContext2D, x: number, y: number, size: number, color: string): void {
        ctx.fillStyle = color;
        ctx.fillRect(x - size / 2, y - size / 2, size, size);
    }

    private drawLeaderboard(ctx: CanvasRenderingContext2D, screenW: number, screenH: number): void {
        if (!this.players) return;

        const list = Object.values(this.players)
            .sort((a, b) => b.score - a.score || a.name.localeCompare(b.name));

        const width = screenW * 0.28;
        const x = screenW - width - 20;
        const y = 20;

        ctx.fillStyle = 'rgba(0, 0, 0, 0.6)';
        ctx.fillRect(x, y, width, Math.min(screenH * 0.45, list.length * 28 + 60));

        ctx.fillStyle = '#ffffff';
        ctx.font = '20px Arial';
        ctx.textAlign = 'left';
        ctx.fillText('Classifica', x + 12, y + 28);

        // Giocatori (max 5)
        list.slice(0, 5).forEach((player, index) => {
            const rowY = y + 58 + index * 28;
            ctx.fillStyle = index === 0 ? '#ffcc33' : '#cccccc';
            ctx.fillText(`${index + 1}. ${player.name}`, x + 12, rowY);
            ctx.fillText(`P:${player.score}`, x + width - 68, rowY);
        });
    }

    private drawStatus(ctx: CanvasRenderingContext2D, screenW: number, screenH: number): void {
        const me = this.players?.[this.myId];
        if (!me) return;

        ctx.fillStyle = '#ffffff';
        ctx.font = '18px Arial';
        ctx.textAlign = 'left';

        ctx.fillText(`Nome: ${me.name}`, 20, 30);
        ctx.fillText(`Lunghezza: ${me.lengthTarget}`, 20, 58);
        ctx.fillText(`Punteggio: ${me.score}`, 20, 86);
        const boostText = me.boostCooldownLeft > 0 ? `Cooldown: ${me.boostCooldownLeft.toFixed(1)}s` : `Turbo: ${me.boostTimeLeft.toFixed(1)}s`;
        ctx.fillText(boostText, 20, 114);
        ctx.fillText('W A S D per girare, SPACE per sprint', 20, 142);
    }

    private drawGameOverOverlay(ctx: CanvasRenderingContext2D, screenW: number, screenH: number): void {
        ctx.fillStyle = '#000000';
        ctx.fillRect(0, 0, screenW, screenH);

        ctx.fillStyle = '#ffffff';
        ctx.font = 'bold 34px Arial';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText(this.gameOverText, screenW / 2, screenH / 2 - 40);

        const elapsed = Date.now() - this.gameOverTimestamp;
        const remaining = Math.ceil((this.GAME_OVER_DISPLAY_DURATION - elapsed) / 1000);
        if (remaining > 0) {
            ctx.font = '24px Arial';
            ctx.fillText(`Torna alla lobby tra ${remaining} secondi...`, screenW / 2, screenH / 2 + 40);
        }
    }

    draw(ctx: CanvasRenderingContext2D, dt: number) {
        if (!this.players) return;

        const screenW = this.userInput.screenW;
        const screenH = this.userInput.screenH;

        ctx.fillStyle = '#1a4f1a';
        ctx.fillRect(0, 0, screenW, screenH);

        ctx.save();
        this.worldToScreenTransform(ctx, screenW, screenH);

        ctx.fillStyle = '#2e7d32';
        ctx.fillRect(MAP_BOUNDS.left, MAP_BOUNDS.top, MAP_WIDTH, MAP_HEIGHT);

        this.foods.forEach(item => this.drawSquare(ctx, item.x, item.y, FOOD_SIZE, item.color));

        Object.values(this.players).forEach(player => {
            if (!player.alive) return;

            for (let i = 1; i < player.trail.length; i++) {
                const segment = player.trail[i];
                const alpha = 0.4 + 0.6 * (1 - i / Math.max(1, player.trail.length));
                ctx.globalAlpha = alpha;
                this.drawSquare(ctx, segment.x, segment.y, PLAYER_SIZE, player.skin);
            }

            ctx.globalAlpha = 1;
            this.drawSquare(ctx, player.x, player.y, PLAYER_SIZE, player.skin);
        });

        ctx.restore();

        this.drawLeaderboard(ctx, screenW, screenH);
        this.drawStatus(ctx, screenW, screenH);

        if (this.gameOver) {
            this.drawGameOverOverlay(ctx, screenW, screenH);
        }
    }

    handleMessage(message: any) {
        if (!this.players) this.init(message.players || {});

        if (message.players) {
            Object.keys(message.players).forEach(id => {
                const p = message.players[id];
                const current = this.players[id];

                this.players[id] = {
                    id,
                    name: p.name || current?.name,
                    skin: current?.skin,
                    x: p.x,
                    y: p.y,
                    dx: p.dx || current?.dx,
                    dy: p.dy || current?.dy,
                    score: p.score || 0,
                    lengthTarget: p.lengthTarget || MIN_PLAYER_LENGTH,
                    trail: Array.isArray(p.trail) ? p.trail.slice(0, p.lengthTarget) : current?.trail || [],
                    alive: p.alive !== false,
                    boost: p.boost || false,
                    boostMassReserved: 0,
                    boostTimeLeft: p.boostTimeLeft || BOOST_DURATION,
                    boostCooldownLeft: p.boostCooldownLeft || 0,
                };
            });
        }

        if (Array.isArray(message.foods)) this.foods = message.foods;

        const me = this.players[this.myId];

        // PLAYER LOCALE MORTO
        if (me && !me.alive && !this.localPlayerDead) {
            this.localPlayerDead = true;

            this.gameOver = true;
            this.gameOverTimestamp = Date.now();

            this.gameOverText = `${me.name} hai perso con punteggio: ${me.score}`;
        }

        // FINE PARTITA GLOBALE
        if (message.gameOver && !this.gameOver) {
            this.gameOver = true;
            this.gameOverTimestamp = Date.now();

            this.winnerId = message.winnerId || null;

            if (me && me.alive && this.winnerId === this.myId) {
                this.gameOverText = `${me.name} hai vinto con punteggio: ${me.score}`;
            } else {
                this.gameOverText = 'Partita terminata';
            }
        }
    }

    // evitare traffico inutile (il palyer morto smette subito di inviare input al server)
    flushMessages(): any[] {
        if (!this.players?.[this.myId]) return [];

        const me = this.players[this.myId];

        if (!me.alive) return [];

        const dx = this.userInput.moveDirectionX;
        const dy = this.userInput.moveDirectionY;

        return [{
            kind: 'input',
            boost: this.boostActive,
            ...(dx !== 0 || dy !== 0 ? { dx, dy } : {})
        }];
    }

    isFinished(): boolean {
        if (!this.gameOver) return false;
        return Date.now() - this.gameOverTimestamp >= this.GAME_OVER_DISPLAY_DURATION;
    }

    getPlayerStatus() {
        if (!this.players?.[this.myId]) {
            return { currentLength: 0, score: 0, playerName: '', ranking: 0 };
        }

        const sorted = Object.values(this.players).sort((a, b) => b.score - a.score || a.name.localeCompare(b.name));

        const rank = sorted.findIndex(p => p.id === this.myId) + 1;
        const me = this.players[this.myId];

        return {
            currentLength: me.lengthTarget,
            score: me.score,
            playerName: me.name,
            ranking: rank
        };
    }

    getLeaderboard() {
        if (!this.players) return [];

        return Object.values(this.players)
            .sort((a, b) => b.score - a.score || a.name.localeCompare(b.name))
            .map((p, i) => ({
                name: p.name,
                score: p.score,
                rank: i + 1
            }));
    }
}