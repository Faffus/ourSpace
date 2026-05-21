import { GameServer, GameClient } from "./game";
import { UserInput } from "../client/user-input";
import { GuessGameClient, GuessGameServer } from "./guess";
import { GuessSongClient, GuessSongServer } from "./guess-song";
import { PongClient, PongServer } from "./multi-pong";
import { shooterClient, shooterServer } from "./topShooter";
import { BrawlClient , BrawlServer } from "./brawl";
import { MicroRacingClient, MicroRacingServer } from "./micro-racing";
import { MinecraftDiamondRushClient, MinecraftDiamondRushServer } from "./minecraft2d";
import { DoomGameClient, DoomGameServer } from "./doom";
import { FortniteClient, FortniteServer } from "./fortnite/fortnite";
import { HeadBallClient, HeadBallServer } from "./headball"; 
import { FighterClient, FighterServer } from "./fighter/fighter";
import { SlitherClient, SlitherServer } from "./slitherIO/slitherIO";
import { SpaceClient, SpaceServer } from "./space-invaders";

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
    "guess-song": {
        client: GuessSongClient,
        server: GuessSongServer,
        name: 'Guess the Song',
        minPlayers: 1,
        maxPlayers: 4
    },
    pong: {
        client: PongClient,
        server: PongServer,
        name: 'Pong',
    },
    shooter: {
        server: shooterServer,
        client: shooterClient,
        name:'topShooter',
        minPlayers: 1,
        maxPlayers: 4
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
        name: 'Minecraft Diamond Rush',
        minPlayers: 1,
        maxPlayers: 99
    },
    doom: {
        client: DoomGameClient,
        server: DoomGameServer,
        name: 'Doom',
        minPlayers: 1,
        maxPlayers: 99
    },
    fortnite: {
        client: FortniteClient,
        server: FortniteServer,
        name: 'Fortnite',
        minPlayers: 1,
        maxPlayers: 99
    },
    headball: {                        
        client: HeadBallClient,
        server: HeadBallServer,
        name: 'Head Ball',
        minPlayers: 2,
        maxPlayers: 2
    },
    fighter: {
        client: FighterClient,
        server: FighterServer,
        name: 'Fighter',
        minPlayers: 2,
        maxPlayers: 2
    },
    slitherIO: {
        client: SlitherClient,
        server: SlitherServer,
        name: 'SlitherIO',
        minPlayers: 2,
        maxPlayers: 10
    },
    spaceInvaders:{
        client: SpaceClient,
        server: SpaceServer,
        name: 'Space Invaders',
        minPlayers: 1,
        maxPlayers: 2
    }
}