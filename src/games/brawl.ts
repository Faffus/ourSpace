import { GameClient, GameServer } from './game';
import { IncomingMsg, OutgoingMsg } from '../server';
import { UserInput } from '../client/user-input';

// ==========================================
// 1. COSTANTI E MAPPA DI GIOCO
// Definiamo queste cose fuori dalle classi così 
// sia il Server che il Client possono leggerle.
// ==========================================
const VIRTUAL_W = 1000; // Larghezza fissa del nostro mondo
const VIRTUAL_H = 600;  // Altezza fissa del nostro mondo

// COSTANTI DELLA FISICA
const GRAVITY = 1500;    // Forza di gravità (spinge verso il basso)
const JUMP_FORCE = 800;  // Potenza del salto
const MOVE_SPEED = 300;  // Velocità di camminata

// Definiamo un "tipo" per ricordarci come è fatta una piattaforma
interface Platform {
    x: number;
    y: number;
    w: number; // width (larghezza)
    h: number; // height (altezza)
    isSolid: boolean; // true = non puoi passarci da sotto, false = puoi attraversarla
}

// Ecco lo scheletro della nostra mappa!
const PLATFORMS: Platform[] = [
    // Piattaforma principale: è solida!
    { x: 150, y: 450, w: 700, h: 40, isSolid: true },
    
    // Piattaforme fluttuanti: NON sono solide (ci salti attraverso)
    { x: 200, y: 300, w: 150, h: 15, isSolid: false },
    { x: 650, y: 300, w: 150, h: 15, isSolid: false },
    { x: 425, y: 180, w: 150, h: 15, isSolid: false }
];

// ==========================================
// 2. IL SERVER (Fisica e Logica)
// ==========================================
export class BrawlServer extends GameServer {
    private players: any;

    init(players: any) {
        this.players = players;
        const colors = ["#ff0000", "#0000ff"]; // Rosso per P1, Blu per P2
        let i = 0; // contatore per identificare il player

        // Inizializziamo i dati base per ogni giocatore connesso
        // Cicla per ogni giocatore al interno di quelli passati dal server. 
        Object.keys(this.players).forEach(id => {
            const player = this.players[id]; // estrapola id univoco del player selezionato

            player.x = 300 + (i * 300); // Li posizioniamo distanti (300 e 600) perche se i e 0 sta a 300 , se e 1 va a 600
            player.y = 200;             // Partono dall'alto e cadranno giù
            player.w = 40;              // Larghezza del quadrato
            player.h = 40;              // Altezza del quadrato
            player.vx = 0;              // Velocità orizzontale
            player.vy = 0;              // Velocità verticale
            player.color = colors[i % 2];
            
            // Variabili per il nuovo salto
            player.canJump = true;             // true se ha una "carica" di salto disponibile
            player.jumpKeyWasPressed = false;  // Ci ricorda se nel frame precedente W era già premuto
            
            player.facingRight = (i === 0); // Se i e uguale a 0 imposta true
            player.isAttacking = false;
            i++;
        });
    }

    tick(incomingMessages: IncomingMsg[], dt: number): OutgoingMsg[] {
        // --- A. LETTURA DEGLI INPUT DEI GIOCATORI ---
        incomingMessages.forEach(msg => {
            const p = this.players[msg.clientId];
            const keys = msg.payload.keys; // Tasti ricevuti dal Client
            
            if (!p) {
                return;
            }

            // Movimento Sinistra
            if (keys.A) {
                p.vx = -MOVE_SPEED;
                p.facingRight = false;
            }
            // Movimento Destra
            else if (keys.D) {
                p.vx = MOVE_SPEED;
                p.facingRight = true;
            }
            // Fermo se non premo nulla
            else {
                p.vx = 0; 
            }

            // Salto (anche in aria, a patto di avere canJump a true)
            if (keys.W) {
                // Salta SOLO se ha la carica (canJump) E se non stava già tenendo premuto W dal frame prima
                if (p.canJump === true && p.jumpKeyWasPressed === false) {
                    p.vy = -JUMP_FORCE; // Spinta verso l'alto (Y negativa in Canvas)
                    p.canJump = false;  // Consuma la carica del salto!
                }
                // Segna che in questo istante il tasto W è fisicamente premuto
                p.jumpKeyWasPressed = true; 
            } else {
                // Se non sto premendo W, resetto questo controllo
                p.jumpKeyWasPressed = false; 
            }

            // Attacco
            if (keys.SPACE) {
                p.isAttacking = true;
            } else {
                p.isAttacking = false;
            }
        });

        // --- B. FISICA E COLLISIONI ---
        Object.values(this.players).forEach((p: any) => {
            // Applichiamo la gravità costantemente
            p.vy += GRAVITY * dt; 
            
            // Salviamo la vecchia Y prima di muoverlo
            const oldY = p.y; 

            // Muoviamo il giocatore
            p.x += p.vx * dt;
            p.y += p.vy * dt;

            // Controllo collisioni con le piattaforme
            PLATFORMS.forEach(plat => {
                // Controllo se il giocatore si trova orizzontalmente in linea con la piattaforma
                if (p.x + p.w > plat.x && p.x < plat.x + plat.w) {
                    
                    // 1. ATTERRAGGIO (Vale per tutte le piattaforme)
                    // Se sto cadendo (vy >= 0) ed ero SOPRA la piattaforma prima del tick...
                    if (p.vy >= 0 && oldY + p.h <= plat.y + 0.1) {
                        // ...e ora ho superato la linea della piattaforma
                        if (p.y + p.h >= plat.y) {
                            p.y = plat.y - p.h; // Lo posiziono esattamente appoggiato sopra
                            p.vy = 0;           // Fermo la caduta
                            p.canJump = true;   // RICARICO IL SALTO! Ha toccato terra.
                        }
                    }

                    // 2. TESTATA DAL BASSO (Vale SOLO per la piattaforma solida)
                    // Se sto saltando in alto (vy < 0) e sbatto sotto la piattaforma...
                    if (plat.isSolid === true && p.vy < 0 && oldY >= plat.y + plat.h - 0.1) {
                        if (p.y <= plat.y + plat.h) {
                            p.y = plat.y + plat.h; // Lo blocco sotto
                            p.vy = 0;              // Fermo il salto, inizia a cadere
                        }
                    }
                }
            });
        });

        // Inviamo a tutti i client le nuove posizioni calcolate
        return [{ payload: { players: this.players } }];
    }

    isFinished(): boolean {
        // Il gioco finisce quando un giocatore perde tutte le vite (da implementare)
        return false; 
    }
}

// ==========================================
// 3. IL CLIENT (Grafica e Input)
// ==========================================
export class BrawlClient extends GameClient {
    private players: any = null;
    
    // Oggetto per tenere traccia dei tasti premuti
    private keys: Record<string, boolean> = { A: false, D: false, W: false, SPACE: false };

    constructor(userInput: UserInput, myId: string) {
        super(userInput, myId);

        // Ascoltiamo la tastiera sul browser quando un tasto VIENE PREMUTO
        window.addEventListener('keydown', (e) => {
            if (e.code === 'KeyA') {
                this.keys.A = true;
            }
            if (e.code === 'KeyD') {
                this.keys.D = true;
            }
            if (e.code === 'KeyW') {
                this.keys.W = true;
            }
            if (e.code === 'Space') {
                this.keys.SPACE = true;
            }
        });

        // Ascoltiamo la tastiera sul browser quando un tasto VIENE RILASCIATO
        window.addEventListener('keyup', (e) => {
            if (e.code === 'KeyA') {
                this.keys.A = false;
            }
            if (e.code === 'KeyD') {
                this.keys.D = false;
            }
            if (e.code === 'KeyW') {
                this.keys.W = false;
            }
            if (e.code === 'Space') {
                this.keys.SPACE = false;
            }
        });
    }

    init(players: any) {
        // Setup iniziale del client
    }

    handleMessage(message: any) {
        // Aggiorniamo le posizioni ricevute dal server. 
        // Uso un if/else lungo per assicurarmi di leggere dal 'payload' se esiste
        if (message.payload && message.payload.players) {
            this.players = message.payload.players;
        } else {
            this.players = message.players;
        }
    }

    flushMessages(): any[] {
        // Inviamo i tasti che stiamo premendo al server in questo esatto momento
        return [{
            kind: 'input',
            keys: {
                A: this.keys.A,
                D: this.keys.D,
                W: this.keys.W,
                SPACE: this.keys.SPACE
            }
        }];
    }

    draw(ctx: CanvasRenderingContext2D, dt: number) {
        // Se non ci sono i giocatori, fermiamo il disegno
        if (!this.players) {
            return;
        }

        const { screenW, screenH } = this.userInput;

        // --- A. DISEGNO LO SFONDO ---
        ctx.fillStyle = "#87CEEB"; 
        ctx.fillRect(0, 0, screenW, screenH);

        // --- B. TELECAMERA (ZOOM) ---
        ctx.save(); 
        const scaleX = screenW / VIRTUAL_W;
        const scaleY = screenH / VIRTUAL_H;
        const scale = Math.min(scaleX, scaleY); 
        const offsetX = (screenW - VIRTUAL_W * scale) / 2;
        const offsetY = (screenH - VIRTUAL_H * scale) / 2;
        ctx.translate(offsetX, offsetY);
        ctx.scale(scale, scale);

        // --- C. DISEGNO LA MAPPA ---
        PLATFORMS.forEach(plat => {
            if (plat.isSolid === true) {
                ctx.fillStyle = "#696969"; // Grigio per solido
            } else {
                ctx.fillStyle = "#2E8B57"; // Verde per le altre (attraversabili)
            }
            ctx.fillRect(plat.x, plat.y, plat.w, plat.h);
            ctx.strokeStyle = "#000000";
            ctx.lineWidth = 3;
            ctx.strokeRect(plat.x, plat.y, plat.w, plat.h);
        });

        // --- D. DISEGNO I GIOCATORI E L'ATTACCO ---
        Object.keys(this.players).forEach(id => {
            const p = this.players[id];
            
            // Disegno il corpo del personaggio
            ctx.fillStyle = p.color;
            ctx.fillRect(p.x, p.y, p.w, p.h);

            // Se sta attaccando, disegno l'hitbox gialla!
            if (p.isAttacking === true) {
                ctx.fillStyle = "yellow";
                const attackWidth = 40;
                const attackHeight = 20;
                const yOffset = 10; // Lo posizioniamo a metà del personaggio

                if (p.facingRight === true) {
                    // Attacco verso destra: parte dalla destra del personaggio (p.x + p.w)
                    ctx.fillRect(p.x + p.w, p.y + yOffset, attackWidth, attackHeight);
                } else {
                    // Attacco verso sinistra: parte PRIMA della sinistra del personaggio (p.x - attackWidth)
                    ctx.fillRect(p.x - attackWidth, p.y + yOffset, attackWidth, attackHeight);
                }
            }
        });

        ctx.restore(); // Fine fotocamera
    }

    isFinished(): boolean {
        return false;
    }
}