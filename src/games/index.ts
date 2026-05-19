import { GameServer, GameClient } from "./game";
import { UserInput } from "../client/user-input";
import { GuessGameClient, GuessGameServer } from "./guess";
import { PongClient, PongServer } from "./multi-pong";
import { MinecraftDiamondRushClient, MinecraftDiamondRushServer } from "./minecraft2d.js";

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
    minecraft2d: {
        client: MinecraftDiamondRushClient,
        server: MinecraftDiamondRushServer,
        name: 'Minecraft Diamond Rush'
    }
}