import { PERSON_W, PERSON_H, Player, smoothChange } from '../../common';
import { Button } from '../../client/ui-elements';
import { GAMES } from '../../games/index'
import { getCollisionSide } from '../../common';
import { IncomingMsg, OutgoingMsg } from '../../server';
import { GameClient, GameServer } from '../game';
import { drawPersonName } from '../../lobby/index';

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

const worldW = 4000, worldH = 4000;
const worldBounds = {
    top: -worldH/2,
    left: -worldW/2,
    bottom: worldH/2,
    right: worldW/2,
};




//////////////////////
////// SERVER ////////
//////////////////////

export class FortniteServer extends GameServer {

    private players: Record<string, Person>;
    private bullets: any[];
    private weapons: any[];
    private initialUpdatePending: boolean = false;

    private getSpawnPositions(count: number): { x: number; y: number }[] {
        const margin = 200;
        const spacing = 150;

        const topLeft = (n: number) =>
            Array.from({ length: n }, (_, i) => ({
                x: worldBounds.left + margin,
                y: worldBounds.top + margin + i * spacing
            }));
        const topRight = (n: number) =>
            Array.from({ length: n }, (_, i) => ({
                x: worldBounds.right - margin,
                y: worldBounds.top + margin + i * spacing
            }));
        const bottomLeft = (n: number) =>
            Array.from({ length: n }, (_, i) => ({
                x: worldBounds.left + margin,
                y: worldBounds.bottom - margin - i * spacing
            }));
        const bottomRight = (n: number) =>
            Array.from({ length: n }, (_, i) => ({
                x: worldBounds.right - margin,
                y: worldBounds.bottom - margin - i * spacing
            }));

        switch (count) {
            case 1:
                return [{ x: 0, y: 0 }];
            case 2:
                return [...topLeft(1), ...bottomRight(1)];
            case 4:
                return [...topLeft(2), ...bottomRight(2)];
            case 6:
                return [...topLeft(3), ...topRight(3)];
            case 8:
                return [...topLeft(2), ...topRight(2), ...bottomLeft(2), ...bottomRight(2)];
            default:
                // fallback per numeri non previsti: allinea sul centro o distribuisce nei quattro angoli
                if (count % 2 !== 0) {
                    return [{ x: 0, y: 0 }];
                }
                const positions: { x: number; y: number }[] = [];
                const half = count / 2;
                positions.push(...topLeft(Math.ceil(half / 2)));
                positions.push(...topRight(Math.floor(half / 2)));
                positions.push(...bottomLeft(Math.ceil(half / 2)));
                positions.push(...bottomRight(Math.floor(half / 2)));
                return positions.slice(0, count);
        }
    }

    init(players: Record<string, Player>) {
        this.players = {};
        this.bullets = [];
        this.weapons = [];
        this.initialUpdatePending = true;

        const spawnPositions = this.getSpawnPositions(Object.keys(players).length);
        Object.entries(players).forEach(([id, player], index) => {
            const spawn = spawnPositions[index] || { x: 0, y: 0 };
            this.players[id] = {
                ...player,
                x: spawn.x,
                y: spawn.y
            };
        });
    }

    tick(incomingMessages: IncomingMsg[], dt: number): OutgoingMsg[] {
        const outgoingMessages: OutgoingMsg[] = [];
        const updatedPeople: Record<string, Person> = {};

        if (this.initialUpdatePending) {
            outgoingMessages.push({
                payload: {
                    kind: "update",
                    people: this.players
                }
            });
            this.initialUpdatePending = false;
        }

        // Gestisci i messaggi in arrivo
        incomingMessages.forEach(message => {
            const clientId = message.clientId;
            const payload = message.payload;

            if (payload.kind === "move") {
                const player = this.players[clientId];
                if (player) {
                    player.x = payload.x;
                    player.y = payload.y;
                    updatedPeople[clientId] = player;
                }
            }
        });

        // Se ci sono state modifiche, invia un update a tutti i client
        if (Object.keys(updatedPeople).length > 0) {
            outgoingMessages.push({
                payload: {
                    kind: "update",
                    people: updatedPeople
                }
            });
        }

        return outgoingMessages;
    }

    isFinished(): boolean {
        return false;
    }   
}






//////////////////////
////// CLIENT ////////
//////////////////////


import { UserInput } from '../../client/user-input';

type ClientPerson = Person;

import { getCharacterDrawFunction } from '../../client/characters';

type ClientPersonExtended = ClientPerson & {
    xTarget: number;
    yTarget: number;
};

export class FortniteClient extends GameClient {

    public people: Record<string, ClientPersonExtended>;
    public camera: { x: number, y: number, zoom: number };
    public gamesBtn: Button;

    constructor(userInput: UserInput, myId: string) {
        super(userInput, myId);
        this.people = {};
        this.camera = { x: 0, y: 0, zoom: 1 };
        this.gamesBtn = new Button('Games', userInput, () => {});
    }

    init(players: Record<string, Player>) {
        Object.entries(players).forEach(([id, player]) => {
            const clientPerson: ClientPersonExtended = {
                ...player,
                x: 0,
                y: 0,
                xTarget: 0,
                yTarget: 0
            };
            this.people[id] = clientPerson;
        });
    }

    // disegna la lobby (spazio di gioco, personaggi, ecc)
    private drawLobby(ctx: CanvasRenderingContext2D, me: ClientPersonExtended, dt: number) {
            const {
                screenW, screenH, zoom,
                moveDirectionX, moveDirectionY, mouseX, mouseY
            } = this.userInput;
    
            // gestione movimento immediato come nel multi-pong
            me.x += moveDirectionX * dt * PERSON_SPEED;
            me.y += moveDirectionY * dt * PERSON_SPEED;
    
            // controllo che il giocatore non esca dallo spazio di gioco
            if (me.y - PERSON_H/2 < worldBounds.top) me.y = worldBounds.top + PERSON_H/2 + EPSILON;
            if (me.y + PERSON_H/2 > worldBounds.bottom) me.y = worldBounds.bottom - PERSON_H/2 - EPSILON;
            if (me.x - PERSON_W/2 < worldBounds.left) me.x = worldBounds.left + PERSON_W/2 + EPSILON;
            if (me.x + PERSON_W/2 > worldBounds.right) me.x = worldBounds.right - PERSON_W/2 - EPSILON;
    
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
    
            // interpola le posizioni dei giocatori avversari
            Object.values(this.people).forEach((person) => {
                if (person !== me) {
                    person.x = smoothChange(person.x, person.xTarget, dt, 0.1);
                    person.y = smoothChange(person.y, person.yTarget, dt, 0.1);
                }
            });
    
            // sposta le persone e disegnale
            Object.values(this.people).forEach((person) => {
                const drawPerson = getCharacterDrawFunction(person.character);
                drawPerson(ctx, person.x, person.y, PERSON_W, PERSON_H, );
                drawPersonName(ctx, person);
                
                // disegna il puntatore verso il mouse solo per il giocatore stesso
                if (person === me) {
                    // converti coordinate mouse da screen space a world space
                    const mouseCenterX = mouseX - screenW / 2;
                    const mouseCenterY = mouseY - screenH / 2;
                    const mouseWorldX = me.x + mouseCenterX / this.camera.zoom;
                    const mouseWorldY = me.y + mouseCenterY / this.camera.zoom;
                    
                    // calcola angolo verso il cursore
                    const dx = mouseWorldX - me.x;
                    const dy = mouseWorldY - me.y;
                    const angle = Math.atan2(dy, dx);
                    
                    // disegna rettangolo nero (20px x 5px) ruotato verso il cursore
                    ctx.save();
                    ctx.translate(me.x, me.y);
                    ctx.rotate(angle);
                    ctx.fillStyle = "#000";
                    ctx.fillRect(-15, -7.5, 50, 12);
                    ctx.fillRect(-15, -7.5, 70, 8);
                    ctx.restore();
                }
            });
    
            ctx.restore();
            
        }




    draw(ctx: CanvasRenderingContext2D, dt: number) {
        const me = this.getMe() as ClientPersonExtended | null;
        if (me) {
            this.drawLobby(ctx, me, dt);
        }
    }

    handleMessage(message: any) {
        if (message.kind === "update") {
            const updateMsg = message;
            // Se è il primo update, inizializza tutte le posizioni
            const isFirstUpdate = Object.values(this.people).every(p => p.x === 0 && p.y === 0);

            Object.entries(updateMsg.people as Record<string, Person>).forEach(entry => {
                const id: string = entry[0];
                const updatedPerson: Person = entry[1];
                if( this.myId!==id || isFirstUpdate){
                    if (this.people[id]) {
                        // Aggiorna target posizione per interpolazione smooth
                        this.people[id].xTarget = updatedPerson.x;
                        this.people[id].yTarget = updatedPerson.y;
                        // Se è il primo update, imposta anche la posizione attuale
                        if (isFirstUpdate) {
                            this.people[id].x = updatedPerson.x;
                            this.people[id].y = updatedPerson.y;
                        }
                    } else {
                        // Aggiungi nuovo giocatore
                        this.people[id] = { 
                            ...updatedPerson,
                            xTarget: updatedPerson.x,
                            yTarget: updatedPerson.y
                        } as ClientPersonExtended;
                    }
                }
                
            });
        }
    }

    flushMessages(): any[] {
        const messages: any[] = [];

        const me = this.getMe();
        if (me) {
            messages.push({
                kind: "move",
                x: me.x,
                y: me.y
            });
        }

        return messages;
    }

    private getMe(): ClientPersonExtended | null {
        return this.myId ? this.people[this.myId] : null;
    }

    isFinished(): boolean {
        return false;
    }
    

}