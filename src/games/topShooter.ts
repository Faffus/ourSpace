import { getCollisionSide, Player} from '../common';
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
const PLAYER_SIZE = 0.08;
const ZOMBIE_SIZE = 0.08;
const PROJECTILE_RADIUS = 0.02;
const FIRE_RATE = 0.4 
const BOX_SIZE = 0.04
const BOX_INTERVAL = 10;

export class shooterServer extends GameServer {
    private players;
    private zombies;
    private projectiles: any[] = []; // Inizializzato come array
    private boxes;
    
    private highScore;
    private orde;
    private spawnTimer;
    private shooterTimer;
    private damage;
    private playerMouseX: { [key: string]: number } = {};
    private playerMouseY: { [key: string]: number } = {};
    // MODIFICA: Aggiunto stato per sapere se il player sta cliccando
    private playerIsShooting: { [key: string]: boolean } = {};
    
    private waveCounter;
    private zombiesSpawned: number = 0;

    private boxTimer;
    private boxCounter;

    private death;
    init(players) {
        this.players = players;
        this.projectiles = [];
        this.highScore = 0;
        this.orde = 10;
        this.zombies = [];
        this.spawnTimer = 0;
        this.shooterTimer = 0;
        this.damage = 35;
        this.waveCounter = 0;
        this.zombiesSpawned = 0;

        this.boxTimer = 0;
        this.boxCounter = 0;
        this.boxes = [];

        this.death = false;
        Object.keys(players).forEach(id => {
            const player = players[id];
            player.x = 0;
            player.y = 0;
            player.score = 0;
            this.playerIsShooting[id] = false;
            player.life = 3;
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
                // MODIFICA: Riceviamo lo stato del click dal client
                this.playerIsShooting[id] = payload.isShooting || false;
            }
        });

        this.boxTimer += dt;
        if(this.boxCounter < 2 && this.boxTimer >= BOX_INTERVAL){
            this.boxTimer = 0;
            const randomX = (Math.random() - 0.5) * 2;
            const randomY = (Math.random() - 0.5) * 2;
            this.boxes.push({x: randomX, y: randomY})
            this.boxCounter += 1
            console.log("scatole: " + this.boxCounter)
        }
        // Spawn zombie solo durante la fase di spawn dell'ondata (fino a raggiungere this.orde)
        this.spawnTimer += dt;
        if (this.spawnTimer >= SPAWN_INTERVAL && this.zombiesSpawned < this.orde) {
            this.spawnTimer = 0;
            const randomX = (Math.random() - 0.5) * 4;
            const randomY = (Math.random() - 0.5) * 4;
            this.zombies.push({ x: randomX, y: randomY, vita: 100 });
            this.zombiesSpawned += 1;
            
        }

        // Controlla se la wave è completata (tutti gli zombie uccisi e almeno alcuni erano stati spawnati)
        if (this.zombiesSpawned > 0 && this.zombies.length === 0) {
            // Inizia una nuova wave con 2 zombie in più
            this.orde += 2;
            this.zombiesSpawned = 0; // Reset per la nuova ondata
            this.waveCounter += 1;
            console.log("Nuova ondata! Zombie totali: " + this.orde);
            console.log("ondata num: " + this.waveCounter);
        }

        // MODIFICA: Gestione Proiettili (Logica di Sparo)
        //___________________________________________________________________________
        //TODO: inseire fire rate e modalita di sparo come variabili e no costanti 
        //___________________________________________________________________________
        this.shooterTimer += dt;
        if (this.shooterTimer >= FIRE_RATE) {
            this.shooterTimer = 0;
            Object.keys(this.players).forEach(id => {
                // Spara solo se il player sta premendo il tasto
                if (this.playerIsShooting[id]) {
                    const player = this.players[id];
                    const targetX = this.playerMouseX[id];
                    const targetY = this.playerMouseY[id];

                    // Calcolo direzione (vettore unitario)
                    const dx = targetX - player.x;
                    const dy = targetY - player.y;
                    const distance = Math.sqrt(dx * dx + dy * dy);

                    if (distance > 0) {
                        this.projectiles.push({
                            x: player.x,
                            y: player.y,
                            vx: (dx / distance) * 4, // Velocità X fissa
                            vy: (dy / distance) * 4, // Velocità Y fissa
                            life: 1.5, // Il proiettile sparisce dopo 1.5 secondi
                            playerId: id // Traccia chi ha sparato il proiettile
                        });
                    }
                }
            });
        }
        

        // MODIFICA: Movimento Proiettili e Pulizia
        this.projectiles.forEach(p => {
            p.x += p.vx * dt;
            p.y += p.vy * dt;
            p.life -= dt;
        });
        // Rimuovi proiettili "morti" per non rallentare il server
        this.projectiles = this.projectiles.filter(p => p.life > 0);

        // Movimento Zombie verso giocatore (invariato)
        this.zombies.forEach(zombie => {
            let closestPlayer = null;
            let minDistance = Infinity;
            Object.keys(this.players).forEach(id => {
                const player = this.players[id];
                const dx = player.x - zombie.x;
                const dy = player.y - zombie.y;
                const dist = Math.sqrt(dx * dx + dy * dy);
                if (dist < minDistance) { { minDistance = dist; closestPlayer = player; } }
            });

            if (closestPlayer) {
                const dx = closestPlayer.x - zombie.x;
                const dy = closestPlayer.y - zombie.y;
                const len = Math.sqrt(dx * dx + dy * dy);
                if (len > 0) {
                    zombie.x += (dx / len) * ZOMBIE_SPEED * dt;
                    zombie.y += (dy / len) * ZOMBIE_SPEED * dt;
                }
            }
        });
         //TODO: gestione collisioni player zombie
         //TODO: gestione collisioni player scatola
         //gestione collisione proiettile zombie
         for(let i = this.projectiles.length -1; i>= 0; i--){
            const projectile = this.projectiles[i];
            
            for(let j = this.zombies.length -1; j>=0; j--){
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

                if(getCollisionSide(ballRect, zombieRect) !== 'none'){
                    zombie.vita -= this.damage;
                    console.log("zombie vita: " + zombie.vita);

                    this.projectiles.splice(i, 1);

                    if(zombie.vita <= 0){
                        this.zombies.splice(j,1);
                        const shooterId = projectile.playerId;
                        if(shooterId && this.players[shooterId]) {
                            this.players[shooterId].score += 1;
                            console.log("player" + shooterId + ", score: " + this.players[shooterId].score);
                        }
                    }

                    break;
                }
            }

            // 2. GESTIONE COLLISIONE ZOMBIE -> PLAYER (Nuova e Corretta)
            Object.keys(this.players).forEach(id => {
                const player = this.players[id];
                // Se il giocatore è già morto, non controllare collisioni
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
                        // Rimuoviamo lo zombie che ha colpito il giocatore (altrimenti lo uccide in un frame)
                        this.zombies.splice(j, 1); 
                        player.life -= 1;
                        console.log(`Player ${id} colpito! Vite: ${player.life}`);
                        
                        if (player.life <= 0) {
                            
                            console.log(`Player ${id} è MORTO`);
                        }
                    }
                }
            });
         }

        return [{
            payload: {
                players: this.players,
                zombies: this.zombies,
                projectiles: this.projectiles,
                boxes: this.boxes
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
    
    // MODIFICA: Memorizziamo il mouse in coordinate di "gioco"
    private gameMouseX = 0;
    private gameMouseY = 0;

    constructor(userInput: UserInput, myId: string) {
        super(userInput, myId);

        addEventListener("mousedown", () => this.isShooting = true);
        addEventListener("mouseup", () => this.isShooting = false);
        
        // MODIFICA: Il mousemove deve essere consapevole della scala del canvas
        addEventListener("mousemove", (event) => {
            const canvas = document.querySelector('canvas');
            if (!canvas) return;
            
            const rect = canvas.getBoundingClientRect();
            const screenW = canvas.width;
            const screenH = canvas.height;
            
            // Calcolo scala (deve essere identico a quello nel draw)
            const scale = Math.min(screenW / BORDERS_W, screenH / BORDERS_H);
            
            // Trasformazione: Pixel -> Coordinate Gioco (-2 a 2)
            this.gameMouseX = ((event.clientX - rect.left) - screenW / 2) / scale;
            this.gameMouseY = ((event.clientY - rect.top) - screenH / 2) / scale;
        });
    }

    init(players) {
        this.players = {};
        this.zombies = [];
        this.projectiles = [];
        this.boxes = [];
        Object.keys(players).forEach(id => {
            this.players[id] = { ...players[id], x: 0, y: 0 };
        });
        return Promise.resolve();
    }

    draw(ctx: CanvasRenderingContext2D, dt: number) {
        if (this.players === null) return;

        const { screenW, screenH, moveDirectionY, moveDirectionX } = this.userInput;

        // Movimento locale (Predictive)
        const me = this.players[this.myId];
        me.x += moveDirectionX * dt * PLAYER_SPEED;
        me.y += moveDirectionY * dt * PLAYER_SPEED;
        
        // Collisioni bordi
        me.x = Math.max(BORDERS.left, Math.min(BORDERS.right, me.x));
        me.y = Math.max(BORDERS.top, Math.min(BORDERS.bottom, me.y));

        // Pulizia sfondo
        ctx.fillStyle = "#000000";
        ctx.fillRect(0, 0, screenW, screenH);

        ctx.save();
        const scale = Math.min(screenW / BORDERS_W, screenH / BORDERS_H);
        ctx.translate(screenW / 2, screenH / 2); 
        ctx.scale(scale, scale);

        // Erba e campo
        ctx.fillStyle = "#00820d";
        ctx.fillRect(BORDERS.left, BORDERS.top, BORDERS_W, BORDERS_H);

        // Disegno Giocatori
        Object.keys(this.players).forEach(id => {
            const player = this.players[id];
            ctx.fillStyle = id === this.myId ? "#ae0f00" : "#1d1d1d";
            ctx.fillRect(player.x - PLAYER_SIZE / 2, player.y - PLAYER_SIZE / 2, PLAYER_SIZE, PLAYER_SIZE);
        });

        // Disegno Zombie
        this.zombies.forEach(zombie => {
            ctx.fillStyle = "#112fd8c0";
            ctx.fillRect(zombie.x - ZOMBIE_SIZE / 2, zombie.y - ZOMBIE_SIZE / 2, ZOMBIE_SIZE, ZOMBIE_SIZE);
        });

        // MODIFICA: Disegno Proiettili (sempre, se presenti nell'array ricevuto dal server)
        if (this.projectiles) {
            this.projectiles.forEach(projectile => {
                ctx.fillStyle = "rgba(248, 232, 5, 0.99)";
                ctx.beginPath();
                ctx.arc(projectile.x, projectile.y, PROJECTILE_RADIUS, 0, Math.PI * 2);
                ctx.fill();
            });
        }

        this.boxes.forEach(boxe=>{
            ctx.fillStyle = "rgba(163, 98, 0, 0.82)"
            ctx.fillRect(boxe.x - BOX_SIZE /2, boxe.y - BOX_SIZE /2, BOX_SIZE, BOX_SIZE);
        })
        ctx.restore();

        //tenere fuori dal restore la logica di disegno dello score

        const myScore = this.players[this.myId].score;
        console.log("my score:" + myScore)
        ctx.textAlign = "center";
        ctx.textBaseline = "top";
        ctx.lineWidth = 0.01;
        ctx.font = `24px Arial`;
        ctx.fillStyle = "#eeeeee";
        const marginLR = 60;
        const marginTop = 20;
        ctx.fillText(myScore, marginLR, marginTop);
    }

    handleMessage(message: any) {
        if (!this.players) {
            this.players = message.players;
        } else {
            Object.keys(message.players).forEach(id => {
                if (id !== this.myId) {
                    this.players[id].x = message.players[id].x;
                    this.players[id].y = message.players[id].y;
                    this.players[id].score = message.players[id].score;
                } else {
                    // Aggiorna anche il proprio score dal server
                    this.players[id].score = message.players[id].score;
                }
            });
        }
        this.zombies = message.zombies;
        // MODIFICA: Sincronizziamo sempre i proiettili dal server
        this.projectiles = message.projectiles;

        this.boxes = message.boxes;
    }

    flushMessages(): any[] {
        if (this.players === null) return [];

        const me = this.players[this.myId];
        return [{
            kind: 'move',
            y: me.y,
            x: me.x,
            // MODIFICA: Invia le coordinate di gioco e lo stato del click
            mouseX: this.gameMouseX,
            mouseY: this.gameMouseY,
            isShooting: this.isShooting
        }];
    }

    isFinished(): boolean {
        const me = this.players[this.myId];
        return me && me.life <= 0;
    }
}
