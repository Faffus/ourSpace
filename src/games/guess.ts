import { Player } from '../common';
import { IncomingMsg, OutgoingMsg } from '../server';
import { GameServer, GameClient } from './game';
import { UserInput } from '../client/user-input';
import { Button } from '../client/ui-elements';

// Game messages
type GuessGameServerMsg = {
    kind: "guess_game_update";
    gameState: GameState;
    lastGuess?: {
        playerName: string;
        guess: number;
        result: "too_low" | "too_high" | "correct";
    };
};

type GuessGameClientMsg = {
    kind: "guess_submit";
    guess: number;
};

type GameState = {
    targetNumber: number;
    minRange: number;
    maxRange: number;
    guesses: Array<{
        playerId: string;
        playerName: string;
        guess: number;
        timestamp: number;
    }>;
    gameOver: boolean;
    winnerId?: string;
};

// Server-side player state
type GuessPlayer = Player & {
    score: number;
};

//////////////////////
////// SERVER ////////
//////////////////////

export class GuessGameServer extends GameServer {
    private gameState: GameState;
    private gamePlayers: Record<string, GuessPlayer>;
    private initMessage: GuessGameServerMsg;

    constructor() {
        super();

        this.gameState = {
            targetNumber: Math.floor(Math.random() * 100) + 1, // Random number between 1 and 100
            minRange: 1,
            maxRange: 100,
            guesses: [],
            gameOver: false
        };
    }

    init(players: Record<string, Player>) {
        this.gamePlayers = {};
        Object.entries(players).forEach(([id, player]) => {
            this.gamePlayers[id] = {
                ...player,
                score: 0
            };
        });

        this.initMessage = {
            kind: "guess_game_update",
            gameState: this.gameState
        }
    }

    tick(incomingMessages: IncomingMsg[], dt: number): OutgoingMsg[] {
        const outgoingMessages: OutgoingMsg[] = [];

        if (this.initMessage) {
            outgoingMessages.push({
                payload: this.initMessage
            });
            this.initMessage = null;
        }

        incomingMessages.forEach(message => {
            const clientId = message.clientId;
            const payload = message.payload;
            
            if (payload.kind === "guess_submit" && !this.gameState.gameOver) {
                const guess = payload.guess;
                const player = this.gamePlayers[clientId];
                
                if (player && guess >= this.gameState.minRange && guess <= this.gameState.maxRange) {
                    // Record the guess
                    this.gameState.guesses.push({
                        playerId: clientId,
                        playerName: player.name,
                        guess: guess,
                        timestamp: Date.now()
                    });
                    
                    // Check the guess
                    let result: "too_low" | "too_high" | "correct";
                    if (guess < this.gameState.targetNumber) {
                        result = "too_low";
                    } else if (guess > this.gameState.targetNumber) {
                        result = "too_high";
                    } else {
                        result = "correct";
                        this.gameState.gameOver = true;
                        this.gameState.winnerId = clientId;
                        player.score += 1;
                    }
                    
                    // Send update to all players
                    outgoingMessages.push({
                        payload: {
                            kind: "guess_game_update",
                            gameState: this.gameState,
                            lastGuess: {
                                playerName: player.name,
                                guess: guess,
                                result: result
                            }
                        }
                    });
                }
            }
        });

        return outgoingMessages;
    }

    isFinished(): boolean {
        return this.gameState.gameOver;
    }
}

//////////////////////
////// CLIENT ////////
//////////////////////

export class GuessGameClient extends GameClient {
    private gameState: GameState | null = null;
    private lastGuessResult: any = null;
    private currentGuess: string = "";
    private messageQueue: GuessGameClientMsg[] = [];
    private userExited: boolean = false;
    private exitButton: Button;

    private players: Record<string, Player>;

    constructor(userInput: UserInput, myId: string) {
        super(userInput, myId);
        
        document.addEventListener('keydown', (e) => {
            if (e.key === 'Enter' && this.currentGuess.trim() !== '') {
                const guess = parseInt(this.currentGuess);
                if (!isNaN(guess)) {
                    this.messageQueue.push({
                        kind: "guess_submit",
                        guess: guess
                    });
                    this.currentGuess = "";
                }
            } else if (e.key === 'Backspace') {
                this.currentGuess = this.currentGuess.slice(0, -1);
            } else if (e.key >= '0' && e.key <= '9') {
                this.currentGuess += e.key;
            }
        });

        this.exitButton = new Button("exit", this.userInput, () => {
            this.userExited = true;
        })
    }

    init(players: Record<string, Player>) {
        this.players = players;
        return Promise.resolve();
    }

    draw(ctx: CanvasRenderingContext2D, dt: number) {
        const { screenW, screenH } = this.userInput;
        
        // Clear screen
        ctx.fillStyle = "#1a1a2e";
        ctx.fillRect(0, 0, screenW, screenH);
        
        // Draw game title
        ctx.fillStyle = "#ffffff";
        ctx.font = "bold 48px Arial";
        ctx.textAlign = "center";
        ctx.fillText("Guess the Number", screenW / 2, 80);
        
        if (!this.gameState) {
            // Waiting for game state
            ctx.font = "24px Arial";
            ctx.fillText("Waiting for game to start...", screenW / 2, screenH / 2);
            return;
        }
        
        // Draw game info
        ctx.font = "24px Arial";
        ctx.fillText(`Range: ${this.gameState.minRange} - ${this.gameState.maxRange}`, screenW / 2, 140);
        
        if (this.gameState.gameOver) {
            // Game over screen
            ctx.fillStyle = "#4CAF50";
            ctx.font = "bold 36px Arial";
            if (this.gameState.winnerId) {
                const winner = this.players[this.gameState.winnerId];
                ctx.fillText(`${winner?.name || "Someone"} guessed correctly!`, screenW / 2, screenH / 2 - 50);
                ctx.fillText(`The number was ${this.gameState.targetNumber}`, screenW / 2, screenH / 2);
                this.exitButton.draw(ctx, screenW/2 - 50, screenH - 50, 100, 40);
            }
        } else {
            // Game in progress
            ctx.fillStyle = "#ffffff";
            ctx.font = "20px Arial";
            ctx.fillText("Type a number and press Enter to guess", screenW / 2, screenH / 2 - 100);
            
            // Draw current guess input
            ctx.fillStyle = "#333333";
            ctx.fillRect(screenW / 2 - 100, screenH / 2 - 50, 200, 60);
            ctx.fillStyle = "#ffffff";
            ctx.font = "32px Arial";
            ctx.fillText(this.currentGuess || "?", screenW / 2, screenH / 2 - 20);
            
            // Draw last guess result
            if (this.lastGuessResult) {
                ctx.font = "24px Arial";
                const result = this.lastGuessResult;
                let resultText = "";
                let resultColor = "#ffffff";
                
                switch (result.result) {
                    case "too_low":
                        resultText = `${result.playerName} guessed ${result.guess} - Too low!`;
                        resultColor = "#FF9800";
                        break;
                    case "too_high":
                        resultText = `${result.playerName} guessed ${result.guess} - Too high!`;
                        resultColor = "#FF5722";
                        break;
                    case "correct":
                        resultText = `${result.playerName} guessed ${result.guess} - Correct!`;
                        resultColor = "#4CAF50";
                        break;
                }
                
                ctx.fillStyle = resultColor;
                ctx.fillText(resultText, screenW / 2, screenH / 2 + 50);
            }
            
            // Draw guess history
            if (this.gameState.guesses.length > 0) {
                ctx.fillStyle = "#666666";
                ctx.font = "18px Arial";
                ctx.textAlign = "left";
                ctx.fillText("Recent guesses:", 50, screenH - 150);
                
                // Show last 5 guesses
                const recentGuesses = this.gameState.guesses.slice(-5);
                recentGuesses.forEach((guess, index) => {
                    const yPos = screenH - 100 + (index * 25);
                    ctx.fillText(`${guess.playerName}: ${guess.guess}`, 50, yPos);
                });
                ctx.textAlign = "center";
            }
        }
        
        // Draw player scores
        ctx.fillStyle = "#888888";
        ctx.font = "20px Arial";
        ctx.textAlign = "left";
        ctx.fillText("Players:", screenW - 200, 50);
        
        Object.values(this.players).forEach((player, index) => {
            const yPos = 80 + (index * 30);
            ctx.fillText(`${player.name}: ${(player as any).score || 0}`, screenW - 200, yPos);
        });
        ctx.textAlign = "center";
    }

    handleMessage(message: any) {
        if (message.kind === "guess_game_update") {
            this.gameState = message.gameState;
            this.lastGuessResult = message.lastGuess;
        }
    }

    flushMessages(): any[] {
        const messages = this.messageQueue;
        this.messageQueue = [];
        return messages;
    }

    isFinished(): boolean {
        return this.userExited;
    }
}