import { PERSON_W, PERSON_H, Player, smoothChange } from '../common';
import { IncomingMsg, OutgoingMsg } from '../server';
import { Button } from '../client/ui-elements';
import { GameServer } from '../games/game';
import { GAMES } from '../games/index'

const PERSON_SPEED = 300;

type Person = Player & {
    x: number;
    y: number;
};

// +messaggi
type GameMsg = {
    kind: "game";
    gameId: string;
    data: any;
};

type ServerInitMsg = {
    kind: "init";
    yourId: string;
    people: Record<string, Person>;
    gameProposal?: {
        gameKey: string;
        proposerId: string;
        proposalId: string;
        acceptedPlayerIds: string[];
    }
};

type ServerNameIsTakenMsg = {
    kind: "nameIsTaken";
};

type ServerUpdateMsg = {
    kind: "update";
    people: Record<string, Person>;
};

type ServerExitMsg = {
    kind: "exit";
    id: string;
};

type ServerGameProposalMsg = {
    kind: "gameProposal";
    gameKey: string;
    proposerId: string;
    proposalId: string;
};

type ServerGameProposalAcceptedMsg = {
    kind: "gameProposalAccepted";
    proposalId: string;
    accepterId: string;
};

type GameStartedMsg = {
    kind: "gameStarted";
    gameId: string;
    gameKey: string;
    players: Record<string, Player>;
};

type LobbyServerMsg =
    | ServerInitMsg
    | ServerNameIsTakenMsg
    | ServerUpdateMsg 
    | ServerExitMsg
    | ServerGameProposalMsg
    | ServerGameProposalAcceptedMsg
    | GameStartedMsg
    | GameMsg;

type ClientInitMsg = {
    kind: "init";
    name: string;
    character: string;
};

type ClientMoveMsg = {
    kind: "move";
    x: number;
    y: number;
};

type ClientGameProposalMsg = {
    kind: "gameProposal";
    gameKey: string;
};

type ClientGameProposalAcceptMsg = {
    kind: "gameProposalAccept";
    proposalId: string;
};

type ClientStartGameMsg = {
    kind: "startGame";
    proposalId: string;
};

type LobbyClientMsg = 
    | ClientInitMsg 
    | ClientMoveMsg
    | ClientGameProposalMsg
    | ClientGameProposalAcceptMsg
    | ClientStartGameMsg
    | GameMsg;
// -messaggi


const EPSILON = 0.0001;

const worldW = 1000, worldH = 600;
const worldBounds = {
    top: -worldH/2,
    left: -worldW/2,
    bottom: worldH/2,
    right: worldW/2,
};

//////////////////////
////// SERVER ////////
//////////////////////

export class LobbyServer {
    public people: Record<string, Person>;
    public outgoingMessages: OutgoingMsg[];
    public games: Record<string, GameServer> = {};
    private gameIdCounter: number = 0;
    
    private currentProposal: {
        gameKey: string;
        proposerId: string;
        proposalId: string;
        acceptedPlayerIds: Set<string>;
    } | null = null;
    private proposalIdCounter: number = 0;

    constructor() {
        this.people = {};
        this.outgoingMessages = [];
    }

    clientConnected(id: string) {
        const message = {
            clientId: id,
            payload: {
                kind: 'init',
                yourId: id,
                people: this.people
            } as ServerInitMsg
        };
        if (this.currentProposal)
            message.payload.gameProposal = {
                gameKey: this.currentProposal.gameKey,
                proposerId: this.currentProposal.proposerId,
                proposalId: this.currentProposal.proposalId,
                acceptedPlayerIds: [...this.currentProposal.acceptedPlayerIds]
            }
        this.outgoingMessages.push(message)
    }

    clientClosed(id: string) {
        delete this.people[id];
        
        // If this client was the proposer, cancel the proposal
        if (this.currentProposal && this.currentProposal.proposerId === id) {
            this.currentProposal = null;
        }
        
        // If this client accepted the current proposal, remove them from accepted players
        if (this.currentProposal) {
            this.currentProposal.acceptedPlayerIds.delete(id);
        }
        
        this.outgoingMessages.push({
            payload: {
                kind: 'exit',
                id: id,
            }
        });
    }

    tick(incomingMessages: IncomingMsg[], dt: number): OutgoingMsg[] {
        const messages: OutgoingMsg[] = this.outgoingMessages;
        this.outgoingMessages = [];
        const updatedPeople: Record<string, Person> = {};

        // Separate lobby messages from game messages and group game messages by gameId
        const lobbyMessages: IncomingMsg[] = [];
        const gameMessagesByGameId: Record<string, IncomingMsg[]> = {};
        
        incomingMessages.forEach(message => {
            if (message.payload.kind === "game") {
                const gameMsg = message.payload as GameMsg;
                const gameId = gameMsg.gameId;
                
                if (!gameMessagesByGameId[gameId]) {
                    gameMessagesByGameId[gameId] = [];
                }
                gameMessagesByGameId[gameId].push(message);
            } else {
                lobbyMessages.push(message);
            }
        });
        
        // +lobby
        lobbyMessages.forEach(message => {
            const clientId: string = message.clientId;
            const payload: LobbyClientMsg = message.payload;

            if (payload.kind === "init") {
                if (Object.values(this.people).find(p => p.name === payload.name)) {
                    this.outgoingMessages.push({
                        clientId: clientId,
                        payload: {
                            kind: 'nameIsTaken'
                        }
                    })
                }
                else {
                    const newPerson: Person = {
                        x: 0,
                        y: 0,
                        name: payload.name,
                        character: payload.character,
                    };
                    this.people[clientId] = newPerson;
                    updatedPeople[clientId] = newPerson;
                }
            }
            else if (payload.kind === "move") {
                const person = this.people[clientId]
                if (person) {
                    person.x = payload.x
                    person.y = payload.y
                    updatedPeople[clientId] = person;
                }
            }
            else if (payload.kind === "gameProposal") {
                this.handleGameProposal(clientId, payload.gameKey);
            }
            else if (payload.kind === "gameProposalAccept") {
                if (this.currentProposal && this.currentProposal.proposalId === payload.proposalId) {
                    this.currentProposal.acceptedPlayerIds.add(clientId);
                    messages.push({
                        payload: {
                            kind: 'gameProposalAccepted',
                            proposalId: payload.proposalId,
                            accepterId: clientId
                        } as ServerGameProposalAcceptedMsg
                    })
                }
            }
            else if (payload.kind === "startGame") {
                // Check if this is the proposer starting a proposed game
                if (this.currentProposal && this.currentProposal.proposerId === clientId) {
                    const gameStartedMessage = this.startGameFromProposal();
                    if (gameStartedMessage) messages.push(gameStartedMessage);
                } 
            }
        });

        // mandiamo il messaggio "update" a tutti i client
        const updateMessage: ServerUpdateMsg = {
            kind: "update",
            people: updatedPeople
        };
        messages.push({ payload: updateMessage });
        // -lobby
        
        // +game
        Object.entries(this.games).forEach(([gameId, game]) => {
            // Get messages for this game
            const gameMsgs = gameMessagesByGameId[gameId] || [];
            
            // Extract game data from GameMsg wrapper
            const unwrappedGameMessages: IncomingMsg[] = gameMsgs.map(msg => ({
                clientId: msg.clientId,
                payload: (msg.payload as GameMsg).data
            }));
            
            // Process game tick
            const gameOutgoingMessages = game.tick(unwrappedGameMessages, dt);
            
            // Wrap game messages in GameMsg and add to output
            gameOutgoingMessages.forEach(m => {
                messages.push({
                    clientId: m.clientId,
                    payload: {
                        kind: "game",
                        gameId: gameId,
                        data: m.payload
                    } as GameMsg
                });
            });
            
            if (game.isFinished()) delete this.games[gameId];
        });
        // -game

        return messages;
    }
    
    private handleGameProposal(clientId: string, gameKey: string): void {
        // one proposal at a time
        if (this.currentProposal !== null) return;
        
        this.proposalIdCounter += 1;
        const proposalId = this.proposalIdCounter + '';
        
        this.currentProposal = {
            gameKey: gameKey,
            proposerId: clientId,
            proposalId,
            acceptedPlayerIds: new Set([clientId]) // Proposer auto-accepts
        };
        
        // send proposal to clients
        this.outgoingMessages.push({
            payload: {
                kind: 'gameProposal',
                gameKey,
                proposerId: clientId,
                proposalId
            } as ServerGameProposalMsg
        });
    }
    
    private startGameFromProposal(): OutgoingMsg | null {
        if (this.currentProposal === null) return null;
        
        const { gameKey, acceptedPlayerIds } = this.currentProposal;
        const gameInfo = GAMES[gameKey];
        if (!gameInfo) return null;
        const game: GameServer = new gameInfo.server()
        
        this.gameIdCounter += 1;
        const gameId = this.gameIdCounter + '';
        
        // Get players who accepted the proposal
        const players: Record<string, Player> = {};
        acceptedPlayerIds.forEach(playerId => {
            const person = this.people[playerId];
            if (person) {
                players[playerId] = {
                    name: person.name,
                    character: person.character
                };
            }
        });

        game.init(players);
        this.games[gameId] = game;
        
        this.currentProposal = null;
        
        return {
            payload: {
                kind: "gameStarted",
                gameId, gameKey, players
            }
        };
    }
}

//////////////////////
////// CLIENT ////////
//////////////////////

import { CharacterSelect } from './character-select';
import { GameSelect } from './game-select';
import { getCharacterDrawFunction } from '../client/characters';
import { UserInput } from '../client/user-input';
import { GameClient } from '../games/game';

type ClientPerson = Person & {
    xTarget: number;
    yTarget: number;
};

export class LobbyClient {
    public userInput: any;

    public myId: string | null;
    public people: Record<string, ClientPerson>;
    public prevX: number = 0;
    public prevY: number = 0;
    public camera: { x: number, y: number, zoom: number };

    public characterSelect: CharacterSelect;
    public gameSelect: GameSelect;

    public gamesBtn: Button;

    public outgoingMessages: LobbyClientMsg[] = [];
    
    public currentGame: GameClient | null = null;
    public currentGameId: string | null = null;

    constructor(userInput: UserInput) {
        this.userInput = userInput;
        this.myId = null;
        this.camera = { x: 0, y: 0, zoom: 1.0 };
        this.people = {};

        this.characterSelect = new CharacterSelect(this.userInput, (name, character) => {
            if (this.getMe()) return; // do nothing if already initialized
            this.outgoingMessages.push({
                kind: "init",
                name: name,
                character: character
            });
        });

        const onGameSelected = (gameKey: string) => {
            this.outgoingMessages.push({
                kind: 'gameProposal',
                gameKey: gameKey
            });
        };
        const onGameJoined = (proposalId: string) => {
            this.outgoingMessages.push({
                kind: 'gameProposalAccept',
                proposalId
            });
        };
        const onGameStarted = (proposalId: string) => {
            this.outgoingMessages.push({
                kind: 'startGame',
                proposalId
            });
        };
        this.gameSelect = new GameSelect( userInput,
            onGameSelected, onGameJoined, onGameStarted);

        this.gamesBtn = new Button('Games', userInput, () => {
            this.gameSelect.show();
        });
    }

    draw(ctx: CanvasRenderingContext2D, dt: number) {
        if (this.currentGame) {
            this.currentGame.draw(ctx, dt);
        } else if (this.gameSelect.isShowing()) {
            this.gameSelect.draw(ctx);
        } else {
            const me = this.getMe();
            if (me) this.drawLobby(ctx, me, dt);
            else this.characterSelect.draw(ctx);
        }
    }

    private drawLobby(ctx: CanvasRenderingContext2D, me: ClientPerson, dt: number) {
        const {
            screenW, screenH, zoom,
            moveDirectionX, moveDirectionY
        } = this.userInput;

        // gestione movimento
        me.xTarget = me.xTarget + moveDirectionX * dt * PERSON_SPEED;
        me.yTarget = me.yTarget + moveDirectionY * dt * PERSON_SPEED;

        // controllo che il giocatore non esca dallo spazio di gioco
        if (me.yTarget - PERSON_H/2 < worldBounds.top) me.yTarget = worldBounds.top + PERSON_H/2 + EPSILON;
        if (me.yTarget + PERSON_H/2 > worldBounds.bottom) me.yTarget = worldBounds.bottom - PERSON_H/2 - EPSILON;
        if (me.xTarget - PERSON_W/2 < worldBounds.left) me.xTarget = worldBounds.left + PERSON_W/2 + EPSILON;
        if (me.xTarget + PERSON_W/2 > worldBounds.right) me.xTarget = worldBounds.right - PERSON_W/2 - EPSILON;

        // la camera segue il giocatore
        this.camera.x = me.x;
        this.camera.y = me.y;
        this.camera.zoom = zoom;

        // pulisci lo schermo
        ctx.beginPath();
        ctx.rect(0, 0, screenW, screenH);
        ctx.fillStyle = "#000";
        ctx.fill();

        ctx.save();

        ctx.translate(screenW/2, screenH/2); // centra lo schermo
        ctx.scale(this.camera.zoom, this.camera.zoom); // applica lo zoom
        ctx.translate(-this.camera.x, -this.camera.y); // sposta relativamente alla camera

        // disegna lo sfondo del "mondo" (campo da gioco)
        ctx.beginPath();
        ctx.rect(worldBounds.left, worldBounds.top, worldW, worldH);
        ctx.fillStyle = "#58a515";
        ctx.fill();

        // sposta le persone e disegnale
        Object.values(this.people).forEach((person) => {
            if (person.xTarget)
                person.x = smoothChange(person.x, person.xTarget, dt, 0.05);
            if (person.yTarget)
                person.y = smoothChange(person.y, person.yTarget, dt, 0.05);

            const drawPerson = getCharacterDrawFunction(person.character);
            drawPerson(ctx, person.x, person.y, PERSON_W, PERSON_H, );
            drawPersonName(ctx, person);
        });

        ctx.restore();
        
        this.gamesBtn.draw(ctx, screenW - 110, 10, 100, 30);
    }

    handleMessage(message: LobbyServerMsg) {
        if (message.kind === "gameStarted") {
            this.gameSelect.scratchGameProposal();
            this.gameSelect.hide();

            // ignore if already in a game of if i'm not in players list
            if (this.currentGame || !message.players[this.myId]) return;

            const gameInfo = GAMES[message.gameKey];
            if (!gameInfo) return;
            this.currentGame = new gameInfo.client(this.userInput, this.myId!);
            this.currentGame.init(message.players);
            this.currentGameId = message.gameId;
        }
        else if (message.kind === "gameProposal") {
            const { proposerId, proposalId, gameKey } = message;
            const proposer = this.people[proposerId];
            const isProposer = proposerId === this.myId;
            const players = {[proposerId]: proposer }
            this.gameSelect.initGameProposal(proposalId, proposerId, players, isProposer, gameKey);
        }
        else if (message.kind === "gameProposalAccepted") {
            const { proposalId, accepterId } = message;
            const accepter = this.people[message.accepterId];
            this.gameSelect.addPlayerToProposal(proposalId, accepterId, accepter);
        }
        else if (message.kind === "game") {
            if (this.currentGame && message.gameId === this.currentGameId) {
                this.currentGame.handleMessage(message.data);
            }
        }
        else if (message.kind === "init") {
            this.myId = message.yourId;
            const clientPeople = message.people as Record<string, ClientPerson>;
            Object.values(clientPeople).forEach(person => {
                person.xTarget = person.x;
                person.yTarget = person.y;
            });
            this.people = clientPeople;

            if (message.gameProposal) {
                const { proposalId, proposerId, gameKey, acceptedPlayerIds } = message.gameProposal;
                const isProposer = proposerId === this.myId;
                const playersWhoAccepted: Record<string, Player> = {};
                acceptedPlayerIds.forEach(id => playersWhoAccepted[id] = this.people[id]);
                this.gameSelect.initGameProposal(proposalId, proposerId, playersWhoAccepted, isProposer, gameKey);
            }
        }
        else if (message.kind === "nameIsTaken") {
            alert("nickname is already taken");
        }
        else if (message.kind === "update") {
            const updateMsg = message;
            Object.entries(updateMsg.people as Record<string, Person>).forEach(entry => {
                const id: string = entry[0];
                const updatedPerson: Person = entry[1];
                if (id !== this.myId) {
                    const personToUpdate = this.people[id];
                    if (personToUpdate) {
                        personToUpdate.xTarget = updatedPerson.x;
                        personToUpdate.yTarget = updatedPerson.y;
                    }
                }
                if (!this.people[id]) {
                    const clientPerson = updatedPerson as ClientPerson;
                    clientPerson.xTarget = clientPerson.x;
                    clientPerson.yTarget = clientPerson.y;
                    this.people[id] = clientPerson;
                }
            });
        }
        else if (message.kind === "exit") {
            delete this.people[message.id];
        }
    }

    flushMessages(): LobbyClientMsg[] {
        const messages: any[] = this.outgoingMessages;
        this.outgoingMessages = [];

        const me = this.getMe();
        if (me) {
            const distX = Math.abs(me.x - this.prevX)
            const distY = Math.abs(me.y - this.prevY)
            if (distX > EPSILON || distY > EPSILON) {
                this.prevX = me.x
                this.prevY = me.y
                messages.push({
                    kind: "move",
                    x: me.x, 
                    y: me.y
                });
            }
        }
        
        if (this.currentGame) {
            if (this.currentGame.isFinished()) {
                this.currentGame = null;
                this.currentGameId = null;
            }
            else {
                const gameMessages = this.currentGame.flushMessages();
                gameMessages.forEach((message) => {
                    messages.push({
                        kind: "game",
                        gameId: this.currentGameId!,
                        data: message
                    });
                })
            }
        }

        return messages;
    }

    private getMe(): ClientPerson | null {
        return this.myId ? this.people[this.myId] : null;
    }
} 

export function drawPersonName(ctx: CanvasRenderingContext2D, person: Person) {
    const fontSize = Math.floor(PERSON_H * 0.15);
    ctx.font = `${fontSize}px Arial`;

    const nameY = person.y - PERSON_H/2 - fontSize - PERSON_H*0.08;
    const nameWidth = ctx.measureText(person.name).width;
    const padding = 4;

    ctx.fillStyle = "rgba(0, 0, 0, 0.5)"; 
    ctx.fillRect(
        person.x - (nameWidth / 2) - padding, 
        nameY - padding, 
        nameWidth + (padding * 2), 
        fontSize + (padding * 2)
    );

    ctx.textAlign = "center";
    ctx.textBaseline = "top";
    ctx.lineWidth = 4;
    ctx.fillStyle = "#eeeeee";
    ctx.fillText(person.name, person.x, nameY);
}
