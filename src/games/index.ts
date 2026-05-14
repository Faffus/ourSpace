import { GameServer, GameClient } from "./game";
import { UserInput } from "../client/user-input";
import { GuessGameClient, GuessGameServer } from "./guess";
import { PongClient, PongServer } from "./multi-pong";
import { shooterClient, shooterServer } from "./topShooter";
import { BrawlClient , BrawlServer } from "./brawl";
import { MicroRacingClient, MicroRacingServer } from "./micro-racing";
import { MinecraftDiamondRushClient, MinecraftDiamondRushServer } from "./minecraft2d";

export type GameInfo = {
    client: new (userInput: UserInput, myId: string) => GameClient;
    server: new () => GameServer;
    name: string;
    minPlayers?: number;
    maxPlayers?: number;
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
        name: 'Pong',
        minPlayers: 2,
        maxPlayers: 2
    },

    shooter: {
        server: shooterServer,
        client: shooterClient,
        name:'topShooter',
        minPlayers: 1
    },
    brawl: {
        client: BrawlClient,
        server: BrawlServer,
        name: 'TOTAL STK BATTLE 67'
    },
    microracing: {
        client: MicroRacingClient,
        server: MicroRacingServer,
        name: 'Micro Racing'
    },
    minecraft2d: {
        client: MinecraftDiamondRushClient,
        server: MinecraftDiamondRushServer,
        name: 'Minecraft Diamond Rush'
    }
}