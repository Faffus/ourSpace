import { getCollisionSide, Player } from '../common';
import { IncomingMsg, OutgoingMsg } from '../server';
import { GameClient, GameServer } from './game';

const PLAYER_W = 0.04;
const PLAYER_H = 0.15;

const BALL_RADIUS = 0.03;

export class PongServer extends GameServer {

    private players;
    private balls;
    private leftScore;
    private rightScore;

    init(players) {
        this.players = players;
        this.balls = [];
        this.leftScore = 0;
        this.rightScore = 0;

        let i = 0;
        Object.keys(players).forEach(id => {
            const player = players[id];
            if (i % 2 === 0) {
                player.x = -0.97;
                player.y = 0;
            }
            else {
                player.x = 0.97 - PLAYER_W;
                player.y = 0;
            }
            i += 1;
        });

        // TODO meccanismo che genera le palle
        setInterval(() => {
            const randomSign = Math.random() > 0.5 ? 1 : -1;
            const ball = {
                x: 0,
                y: 0,
                vx: randomSign * (0.1 + Math.random() * 0.2),
                vy: 0.1 + Math.random() * 0.2
            };
            this.balls.push(ball);
        }, 2500);
    }

    tick(
        incomingMessages: IncomingMsg[],
        dt: number
    ): OutgoingMsg[] {
        incomingMessages.forEach(message => {
            const id = message.clientId;
            const payload = message.payload;

            if (payload.kind === 'move') {
                const player = this.players[id];
                player.y = payload.y;
            }
        });

        // TODO far muovere le palle
        const indexesRemove = [];
        let i = 0;
        this.balls.forEach((ball) => {
            ball.x += ball.vx * dt;
            ball.y += ball.vy * dt;

            if (ball.y + BALL_RADIUS > 1) {
                ball.vy *= -1;
                ball.y = 1 - BALL_RADIUS;
            }
            if (ball.y - BALL_RADIUS < -1) {
                ball.vy *= -1;
                ball.y = -1 + BALL_RADIUS;
            }

            if (ball.x + BALL_RADIUS > 1) {
                this.leftScore += 1;
                indexesRemove.push(i);
            }
            if (ball.x - BALL_RADIUS < -1) {
                this.rightScore += 1;
                indexesRemove.push(i);
            }
            i += 1;

            Object.keys(this.players).forEach(id => {
                const player = this.players[id];
                const playerRect = {
                    x: player.x,
                    y: player.y,
                    w: PLAYER_W,
                    h: PLAYER_H 
                };

                const ballRect = {
                    x: ball.x - BALL_RADIUS,
                    y: ball.y - BALL_RADIUS,
                    w: BALL_RADIUS * 2,
                    h: BALL_RADIUS * 2
                };

                const side = getCollisionSide(ballRect, playerRect);
                if (side === "top") {

                } else if (side === "bottom") {
                    
                } else if (side === "left") {
                    
                } else if (side === "right") {
                    ball.vx *= -1;
                    ball.x = player.x + PLAYER_W + BALL_RADIUS;
                }
            });
        });

        for (let i=indexesRemove.length - 1; i >= 0; i--) {
            this.balls.splice(i, 1);
        }

        // TODO gestire collisioni palla/bordi
        // TODO gestire collisioni palla/giocatore

        return [{
            payload: {
                players: this.players,
                balls: this.balls
            }
        }]
    }

    isFinished(): boolean {
        return false;
    }
}

import { UserInput } from '../client/user-input';
import { get } from 'node:http';

export class PongClient extends GameClient {

    private players = null;
    private balls;

    constructor(userInput: UserInput, myId: string) {
        super(userInput, myId);
    }

    init(players) {
    }

    draw(ctx: CanvasRenderingContext2D, dt: number) {
        console.log(this.balls);
        if (this.players === null) return;

        const { screenW, screenH, moveDirectionY } = this.userInput;

        // gestione movimento 
        const me = this.players[this.myId];
        me.y += moveDirectionY * dt * 1.3;
        // TODO non far uscire il giocatore dallo schermo
        if (me.y < -1) me.y = -1;
        else if (me.y + PLAYER_H > 1) me.y = 1 - PLAYER_H;

        ctx.save();
        ctx.translate(screenW/2, screenH/2); // (0,0) al centro
        ctx.scale(screenW/2, screenH/2); // coordinate normalizzate

        ctx.fillStyle = "#00820d";
        ctx.fillRect(-1, -1, 2, 2);

        ctx.fillStyle = "#e1e1e1";
        ctx.fillRect(0, -1, 0.05, 2);

        Object.keys(this.players).forEach(id => {
            const player = this.players[id];
            ctx.fillStyle = "#1d1d1d";
            ctx.fillRect(player.x, player.y, PLAYER_W, PLAYER_H);
        });

        this.balls.forEach(ball => {
            ctx.fillStyle = "#4500ce";
            ctx.beginPath();
            ctx.arc(ball.x, ball.y, BALL_RADIUS, 0, 2*Math.PI);
            ctx.fill();
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
                    this.players[id].y = newPlayer.y
                }
            });
        }
        this.balls = message.balls;
    }

    flushMessages(): any[] {
        if (this.players === null) return [];

        const me = this.players[this.myId];
        return [{
            kind: 'move',
            y: me.y
        }];
    }

    isFinished(): boolean {
        return false;
    }
}
