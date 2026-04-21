import { getCollisionSide } from '../common';
import { IncomingMsg, OutgoingMsg } from '../server';
import { GameClient, GameServer } from './game';

const PLAYER_W = 0.04;
const PLAYER_H = 0.15;
const BALL_RADIUS = 0.03;
const WINNING_SCORE = 100;
const BORDERS = {
    top: -1,
    bottom: 1,
    left: -2,
    right: 2
}
const BORDERS_W = Math.abs(BORDERS.right - BORDERS.left);
const BORDERS_H = Math.abs(BORDERS.top - BORDERS.bottom);

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
        const step = 0.08;
        let leftX = BORDERS.left + step;
        let rightX = BORDERS.right - step - PLAYER_W;
        Object.keys(players).forEach(id => {
            const player = players[id];
            if (i % 2 === 0) {
                player.x = leftX;
                player.y = 0;
                leftX += step;
            }
            else {
                player.x = rightX;
                player.y = 0;
                rightX -= step;
            }
            i += 1;
        });

        setInterval(() => {
            const randomSignX = Math.random() > 0.5 ? 1 : -1;
            const randomSignY = Math.random() > 0.5 ? 1 : -1;
            const ball = {
                x: 0,
                y: 0,
                vx: randomSignX * (0.1 + Math.random() * 0.35) * 2,
                vy: randomSignY * (0.1 + Math.random() * 0.35)
            };
            this.balls.push(ball);
        }, 500);
    }

    tick(incomingMessages: IncomingMsg[], dt: number): OutgoingMsg[] {
        // aggiorniamo la posizione dei giocatori che si sono mossi
        incomingMessages.forEach(message => {
            const id = message.clientId;
            const payload = message.payload;

            if (payload.kind === 'move') {
                const player = this.players[id];
                player.y = payload.y;
            }
        });

        // iteriamo l'array di palle partendo dalla fine, cosi' possiamo
        // eliminare quelle che escono dai bordi destro e sinisto
        for (let i = this.balls.length - 1; i >= 0; i--) {
            const ball = this.balls[i]
            ball.x += ball.vx * dt;
            ball.y += ball.vy * dt;

            // collisioni palla/bordo
            if (ball.y + BALL_RADIUS > BORDERS.bottom) {
                ball.vy *= -1;
                ball.y = BORDERS.bottom - BALL_RADIUS;
            }
            else if (ball.y - BALL_RADIUS < BORDERS.top) {
                ball.vy *= -1;
                ball.y = BORDERS.top + BALL_RADIUS;
            }
            else if (ball.x + BALL_RADIUS > BORDERS.right) {
                this.leftScore += 1;
                this.balls.splice(i, 1);
            }
            else if (ball.x - BALL_RADIUS < BORDERS.left) {
                this.rightScore += 1;
                this.balls.splice(i, 1);
            }

            this.handleBallToPlayerCollisions(ball);
        };

        return [{
            payload: {
                players: this.players,
                balls: this.balls,
                leftScore: this.leftScore,
                rightScore: this.rightScore
            }
        }]
    }

    isFinished(): boolean {
        return this.leftScore  == WINNING_SCORE
            || this.rightScore == WINNING_SCORE;
    }

    handleBallToPlayerCollisions(ball) {
        Object.keys(this.players).forEach(id => {
            const player = this.players[id];
            const playerRect = { x: player.x, y: player.y, w: PLAYER_W, h: PLAYER_H };
            const ballRect = { x: ball.x - BALL_RADIUS, y: ball.y - BALL_RADIUS, w: BALL_RADIUS * 2, h: BALL_RADIUS * 2 };

            const side = getCollisionSide(ballRect, playerRect);
            if (side === "top") {
                ball.vy *= -1;
                ball.y = player.y - BALL_RADIUS;
            }
            else if (side === "bottom") {
                ball.vy *= -1;
                ball.y = player.y + PLAYER_H + BALL_RADIUS;
            }
            else if (side === "left") {
                ball.vx *= -1;
                ball.x = player.x - BALL_RADIUS;
            }
            else if (side === "right") {
                ball.vx *= -1;
                ball.x = player.x + PLAYER_W + BALL_RADIUS;
            }
        });
    }
}

import { UserInput } from '../client/user-input';

export class PongClient extends GameClient {
    private players = null;
    private balls;
    private leftScore;
    private rightScore;

    constructor(userInput: UserInput, myId: string) {
        super(userInput, myId);
    }

    init(players) {
    }

    draw(ctx: CanvasRenderingContext2D, dt: number) {
        if (this.players === null) return;

        const { screenW, screenH, moveDirectionY } = this.userInput;

        // +movimento
        const me = this.players[this.myId];
        me.y += moveDirectionY * dt * 1.3;

        if (me.y < BORDERS.top) me.y = BORDERS.top;
        else if (me.y + PLAYER_H > BORDERS.bottom) me.y = BORDERS.bottom - PLAYER_H;
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
            ctx.fillRect(player.x, player.y, PLAYER_W, PLAYER_H);
        });

        this.balls.forEach(ball => {
            ctx.fillStyle = "#4500ce";
            ctx.beginPath();
            ctx.arc(ball.x, ball.y, BALL_RADIUS, 0, 2*Math.PI);
            ctx.fill();
        });

        ctx.restore();

        ctx.textAlign = "center";
        ctx.textBaseline = "top";
        ctx.lineWidth = 0.01;
        ctx.font = `24px Arial`;
        ctx.fillStyle = "#eeeeee";
        const marginLR = 60;
        const marginTop = 20;
        ctx.fillText(this.leftScore+'/'+WINNING_SCORE, marginLR, marginTop);
        ctx.fillText(this.rightScore+'/'+WINNING_SCORE, screenW - marginLR, marginTop);
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
        this.leftScore = message.leftScore;
        this.rightScore = message.rightScore;
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
        // TODO aggiungere messaggio finale vinto/perso prima di uscire
        return this.leftScore  == WINNING_SCORE
            || this.rightScore == WINNING_SCORE;
    }
}
