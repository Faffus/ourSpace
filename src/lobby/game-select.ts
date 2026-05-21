import { mod, Player, PERSON_W, PERSON_H } from '../common';
import { Button } from '../client/ui-elements';
import { UserInput } from '../client/user-input';
import { getCharacterDrawFunction } from '../client/characters';
import { GAMES } from '../games/index'

export class GameSelect {
    private userInput: UserInput;
    private isVisible: boolean;
    
    private leftBtn: Button;
    private rightBtn: Button;
    private playBtn: Button;
    private exitBtn: Button;

    private gameKeys: string[];
    private selectedGameKeyIndex: number;
    private onGameSelected: (gameKey: string) => void;

    private gameProposal: {
        proposalId: string;
        proposerId: string;
        players: Record<string, Player>;
        isProposer: boolean;
        proposerName: string;
        gameName: string;
        gameKey: string;
    } | null = null;

    private joinedGame: boolean;
    private joinBtn: Button;
    private startBtn: Button;
    private onGameJoined: (proposalId: string) => void;
    private onGameStarted: (proposalId: string) => void;
    
    constructor(
        userInput: UserInput,
        onGameSelected: (gameKey: string) => void,
        onGameJoined: (proposalId: string) => void,
        onGameStarted: (proposalId: string) => void,
    ) {
        this.userInput = userInput;
        this.onGameSelected = onGameSelected;
        this.onGameJoined = onGameJoined;
        this.onGameStarted = onGameStarted;
        this.isVisible = false;
        this.joinedGame = false;
        this.gameKeys = Object.keys(GAMES);
        this.selectedGameKeyIndex = 0;
        
        this.leftBtn = new Button('<', userInput, () => {
            this.selectedGameKeyIndex = mod(this.selectedGameKeyIndex - 1, this.gameKeys.length);
        });
        
        this.rightBtn = new Button('>', userInput, () => {
            this.selectedGameKeyIndex = mod(this.selectedGameKeyIndex + 1, this.gameKeys.length);
        });
        
        this.playBtn = new Button('play', userInput, () => {
            if (this.gameProposal !== null) return;
            if (!this.isShowing()) return; // bad hack

            const gameKey = this.gameKeys[this.selectedGameKeyIndex];
            this.onGameSelected(gameKey);
        });
        this.playBtn.setColors({ main: "#58a515" });

        this.exitBtn = new Button('exit', userInput, () => {
            if (this.gameProposal !== null) return;
            if (!this.isShowing()) return; // bad hack

            if (this.joinedGame) this.exitJoinedGame();
            else this.hide();
        });
        this.exitBtn.setColors({ main: "#a51515" });

        this.joinBtn = new Button('join', userInput, () => {
            if (this.gameProposal === null) return;
            if (!this.isShowing()) return; // bad hack

            this.onGameJoined(this.gameProposal.proposalId);
            this.joinedGame = true;
        });

        this.startBtn = new Button('start', userInput, () => {
            if (this.gameProposal === null) return;
            if (!this.isShowing()) return; // bad hack

            const { gameKey, players } = this.gameProposal;
            const { minPlayers } = GAMES[gameKey];
            const minPlayersOk = !minPlayers || minPlayers <= Object.keys(players).length
            if (minPlayersOk)
                this.onGameStarted(this.gameProposal.proposalId);
            else
                alert(`You need at least ${minPlayers} players to start the game`);
        });
    }
    
    draw(ctx: CanvasRenderingContext2D) {
        const { screenW, screenH } = this.userInput;
        const side = Math.min(screenH, screenW);

        ctx.fillStyle = "#eeeeee";
        ctx.fillRect(0, 0, screenW, screenH);
        ctx.save();
        ctx.translate(screenW/2, screenH/2); // centra lo schermo

        const borderWidth = 20;
        ctx.beginPath();
        ctx.rect(-side/2, -side/2, side, side);
        ctx.clip();
        ctx.strokeStyle = "#161616";
        ctx.lineWidth = borderWidth;
        ctx.fillStyle = "#acabab";
        ctx.fill();
        ctx.stroke();

        if (this.gameProposal === null) { // select game
            const gameKey = this.gameKeys[this.selectedGameKeyIndex];
            const gameName = GAMES[gameKey].name;
            
            ctx.fillStyle = "#000";
            ctx.font = "bold 32px Arial";
            ctx.textAlign = "center";
            ctx.textBaseline = "middle";
            ctx.fillText(gameName, 0, 0);
            
            const padding = borderWidth + 5;

            // bottoni
            const btnWidth = side * 0.1;
            const btnHeight = side  * 0.4;
            this.rightBtn.draw(ctx, side/2 - btnWidth - padding, -btnHeight/2, btnWidth, btnHeight);
            this.leftBtn.draw(ctx, -side/2 + padding, -btnHeight/2, btnWidth, btnHeight);
            const okBtnW = side * 0.3;
            const okBtnH = side * 0.1;
            this.exitBtn.draw(ctx, -side*0.4, side/2 - okBtnH - padding, okBtnW, okBtnH);
            this.playBtn.draw(ctx, side*0.1, side/2 - okBtnH - padding, okBtnW, okBtnH);
        }
        else { // joined game waiting for it to start
            const { proposerName, gameName, players } = this.gameProposal;
            const playersVertPadding = side*0.2;

            ctx.fillStyle = "#000";
            ctx.font = "bold 22px Arial";
            ctx.textAlign = "center";
            ctx.textBaseline = "top";
            ctx.fillText(`${proposerName} wants to play ${gameName}`, 0, -side/2 + side*0.03);

            const playersList = Object.values(players);
            this.drawPlayers(ctx, playersList, side, -side/2 + playersVertPadding, side/2 - playersVertPadding);

            const padding = borderWidth + side * 0.03;
            const btnW = side * 0.3;
            const btnH = side * 0.1;
            if (this.gameProposal.isProposer)
                this.startBtn.draw(ctx, side*0.1, side/2 - btnH - padding, btnW, btnH);
            else if (!this.joinedGame)
                this.joinBtn.draw(ctx, -side*0.4, side/2 - btnH - padding, btnW, btnH);
        }
        ctx.restore();
    }

    drawPlayers(ctx: CanvasRenderingContext2D, playersList: Player[], side: number, yTop: number, yBottom: number) {
        let h = yBottom - yTop;
        let w = side;
        let playersPerRow = 2;
        let numberOfRows = 2;
        while (playersPerRow * numberOfRows < playersList.length) {
            if (playersPerRow <= numberOfRows) playersPerRow++;
            else numberOfRows++;
        }

        const playerSpacingW = w / playersPerRow;
        const playerSpacingH = h / numberOfRows;
        const startX = -w/2 + playerSpacingW/2
        const playerH = playerSpacingH * 0.8;
        const playerW = playerH * PERSON_W / PERSON_H;
        
        playersList.forEach((player, index) => {
            const x = startX + playerSpacingW * (index % playersPerRow);
            const y = yTop + playerSpacingH * Math.floor(index / playersPerRow);
            
            const drawPerson = getCharacterDrawFunction(player.character);
            drawPerson(ctx, x, y, playerW, playerH);
            
            ctx.fillStyle = "#000";
            ctx.textAlign = "center";
            ctx.textBaseline = "top";
            ctx.fillText(player.name, x, y + playerH/2 + 2);
        });
    }

    initGameProposal(proposalId: string, proposerId: string, players: Record<string, Player>, isProposer: boolean, gameKey: string) {
        // const players = { [proposerId]: proposer };
        const proposerName = players[proposerId].name;
        const gameName = GAMES[gameKey].name;
        this.gameProposal = {
            proposalId, proposerId, players, isProposer,
            proposerName, gameName, gameKey
        };
        this.joinedGame = false;
    }

    addPlayerToProposal(proposalId: string, playerId: string, player: Player) {
        if (this.gameProposal === null) return;
        if (this.gameProposal.proposalId !== proposalId) return;
        this.gameProposal.players[playerId] = player;
    }

    scratchGameProposal() {
        this.gameProposal = null;
    }

    exitJoinedGame() {
        this.joinedGame = false;
    }

    show() { this.isVisible = true; }
    hide() { this.isVisible = false; }
    isShowing() { return this.isVisible; }
}