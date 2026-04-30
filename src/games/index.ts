import { GameServer, GameClient } from "./game";
import { UserInput } from "../client/user-input";
import { GuessGameClient, GuessGameServer } from "./guess";
import { PongClient, PongServer } from "./multi-pong";
import { FortniteClient, FortniteServer } from "./fortnite/fortnite";

export type GameInfo = {
    client: new (userInput: UserInput, myId: string) => GameClient;
    server: new () => GameServer;
    name: string;
}

export const GAMES: Record<string, GameInfo> = {
    guess: {
        client: GuessGameClient,
        server: GuessGameServer,
        name: 'Guess the number'
    },
    pong: {
        client: PongClient,
        server: PongServer,
        name: 'Pong'
    },
    fortnite: {
        client: FortniteClient,
        server: FortniteServer,
        name: 'Fortnite'
    }
}