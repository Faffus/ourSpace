import { getCollisionSide, Player } from '../common';
import { IncomingMsg, OutgoingMsg } from '../server';
import { GameClient, GameServer } from './game';

const BALL_SIZE = 0.03;
const BORDERS = {
    top: -1,
    bottom: 1,
    left: -2,
    right: 2
}
const BORDERS_W = Math.abs(BORDERS.right - BORDERS.left);
const BORDERS_H = Math.abs(BORDERS.top - BORDERS.bottom);

export class shooterServer extends GameServer{
    private players
    private zombies
    private wawes
    private projectiles
    private score
    private highScore 

    init(players) {
        this.players = players;
        this.projectiles = [];
        this.score = 0;
        this.highScore = 0;

        Object.keys(players).forEach(id =>{
            const player = players[id];
            player.x = 0;
            player.y = 0;

        })

        this.zombies = [
            //TODO posizione random
            {
                x: BORDERS.left,
                y: BORDERS.top,
                vita: 100
            },
            {
                x: BORDERS.right,
                y: BORDERS.bottom,
                vita: 100
            },
        ];
    }

    
    tick(incomingMessages: IncomingMsg[], dt: number): OutgoingMsg[] {
        
        //messaggio move
        // aggiorniamo la posizione dei giocatori che si sono mossi
        incomingMessages.forEach(message => {
            const id = message.clientId;
            const payload = message.payload;

            if (payload.kind === 'move') {
                const player = this.players[id];
                player.x = payload.x;
                player.y = payload.y;
            }
        });
        //messaggio shoot
        return [{
            payload: {
                players: this.players,
                zombies: this.zombies,
            }
        }]
    }
    isFinished(): boolean {
        return false 
    }
}
import { UserInput } from '../client/user-input';

export class shooterClient extends GameClient {
    private players = null;
    private zombies = null;

    constructor(userInput: UserInput, myId: string) {
        super(userInput, myId);
    }
    init(players) {
        this.players = {};
        Object.keys(players).forEach(id => {
            const player = players[id];
            this.players[id] = {
                ...player,
                x: 0,
                y: 0
            };
        });
        return Promise.resolve()
    }

    draw(ctx: CanvasRenderingContext2D, dt: number) {
        if (this.players === null) return;

        const { screenW, screenH, moveDirectionY, moveDirectionX } = this.userInput;

        // +movimento
        const me = this.players[this.myId];
        const speed = 1.3;
        me.x += moveDirectionX * dt * speed;
        me.y += moveDirectionY * dt * speed;
        if (me.x < BORDERS.left) me.x = BORDERS.left;
            else if (me.x > BORDERS.right) me.x = BORDERS.right;

        if (me.y < BORDERS.top) me.y = BORDERS.top;
            else if (me.y > BORDERS.bottom) me.y = BORDERS.bottom;
        // -movimento


        ctx.fillStyle = "#000000";
        ctx.fillRect(0, 0, screenW, screenH);

        ctx.save();
        const scaleX = screenW / BORDERS_W;
        const scaleY = screenH / BORDERS_H;
        const scale = Math.min(scaleX, scaleY);
        ctx.translate(screenW / 2, screenH / 2); 
        ctx.scale(scale, scale);

        ctx.fillStyle = "#00820d";
        ctx.fillRect(BORDERS.left, BORDERS.top, BORDERS_W, BORDERS_H);

        ctx.fillStyle = "#e1e1e1";
        ctx.fillRect(0, -1, 0.05, 2);

        Object.keys(this.players).forEach(id => {
            const player = this.players[id];
            ctx.fillStyle = id === this.myId ? "#ae0f00" : "#1d1d1d";
            const playerSize = 0.08;
            ctx.fillRect(player.x - playerSize / 2, player.y - playerSize / 2, playerSize, playerSize);
        });

        this.zombies.forEach(zombie => {
            const zombieSize = 0.08
            ctx.fillStyle = "#112fd8c0"
            ctx.fillRect(zombie.x - zombieSize / 2, zombie.y - zombieSize / 2, zombieSize, zombieSize)
        });
        ctx.restore();
    }
    handleMessage(message: any) {
         if (this.players === null) {
            this.players = message.players;
        }
        else { // aggiorno solo la posizione degli altri giocatori
            Object.keys(message.players).forEach(id => {
                const newPlayer = message.players[id];
                if (id !== this.myId) {
                    this.players[id].x = newPlayer.x;
                    this.players[id].y = newPlayer.y;
                }
            });

        }
        this.zombies = message.zombies;
    }
    flushMessages(): any[] {
        if (this.players === null) return [];

        const me = this.players[this.myId];
        return [{
            kind: 'move',
            y: me.y,
            x: me.x
        }];
    }
    isFinished(): boolean {
        return false
    }
}
