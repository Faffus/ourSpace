import { Player } from '../common';
import { IncomingMsg, OutgoingMsg } from '../server';

export abstract class GameServer {
    abstract init(players: Record<string, Player>);

    abstract tick(
        incomingMessages: IncomingMsg[],
        dt: number
    ): OutgoingMsg[];

    abstract isFinished(): boolean;
}

/////////////////////////////////////////

import { UserInput } from '../client/user-input';

export abstract class GameClient {
    protected userInput: UserInput;
    protected myId: string;
    protected assets: AssetManager;

    constructor(userInput: UserInput, myId: string) {
        this.userInput = userInput;
        this.myId = myId;
        this.assets = new AssetManager();
    }
    abstract init(players: Record<string, Player>): Promise<void>;
    abstract draw(ctx: CanvasRenderingContext2D, dt: number);
    abstract handleMessage(message: any);
    abstract flushMessages(): any[];
    abstract isFinished(): boolean;
}

/////////////////////////////////////////

export class AssetManager {
    public images: Record<string, HTMLImageElement> = {};
    public sounds: Record<string, HTMLAudioElement> = {};

    loadImage(key: string, url: string): Promise<void> {
        return new Promise((resolve, reject) => {
            const img = new Image();
            img.onload = () => {
                this.images[key] = img;
                resolve();
            };
            img.onerror = () => reject(`Failed to load image: ${url}`);
            img.src = url;
        });
    }

    loadSound(key: string, url: string) {
        this.sounds[key] = new Audio(url);
    }
}