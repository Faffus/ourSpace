import { mod, PERSON_W, PERSON_H } from '../common';
import { Button, TextInput } from '../client/ui-elements';
import { UserInput } from '../client/user-input';
import { getCharacterDrawFunction, getCharacterNames } from '../client/characters';

export class CharacterSelect {
    private userInput: UserInput;
    
    private characterNames: string[];
    private selectedCharacterIndex: number;
    
    private leftBtn: Button;
    private rightBtn: Button;
    private okBtn: Button;
    private nameInput: TextInput;
    private selectionIsDone: boolean;
    
    private onCharacterSelected: (name: string, character: string) => void;
    
    constructor(userInput: UserInput, onCharacterSelected: (name: string, character: string) => void) {
        this.userInput = userInput;
        this.onCharacterSelected = onCharacterSelected;
        this.selectionIsDone = false;
        
        this.characterNames = getCharacterNames();
        this.selectedCharacterIndex = 0;
        
        this.nameInput = new TextInput(userInput, 'nickname', 20);
        
        this.leftBtn = new Button('<', userInput, () => {
            this.selectedCharacterIndex = mod(this.selectedCharacterIndex + 1, this.characterNames.length);
            console.log(this.characterNames[this.selectedCharacterIndex]);
        });
        
        this.rightBtn = new Button('>', userInput, () => {
            this.selectedCharacterIndex = mod(this.selectedCharacterIndex - 1, this.characterNames.length);
            console.log(this.characterNames[this.selectedCharacterIndex]);
        });
        
        this.okBtn = new Button('ok', userInput, () => {
            if (this.selectionIsDone) return; // bad hack

            const name = (this.nameInput.getValue() || '').trim();
            if (name.length) {
                const character = this.characterNames[this.selectedCharacterIndex];
                this.onCharacterSelected(name, character);
                this.selectionIsDone = true;
            } else {
                alert("insert a nickname");
            }
        });
        this.okBtn.setColors({ main: "#58a515" });
    }
    
    resetSelection() {
        this.selectionIsDone = false;
    }

    draw(ctx: CanvasRenderingContext2D) {
        const { screenW, screenH } = this.userInput;
        const screenSide = Math.min(screenH, screenW);
        const halfSide = 100;

        ctx.save();
        ctx.translate(screenW/2, screenH/2); // centra lo schermo
        ctx.scale(screenSide/2/halfSide, screenSide/2/halfSide);

        const borderWidth = 0.05 * halfSide;
        ctx.beginPath();
        ctx.rect(-halfSide, -halfSide, halfSide*2, halfSide*2);
        ctx.clip();
        ctx.strokeStyle = "#161616";
        ctx.lineWidth = borderWidth;
        ctx.fillStyle = "#acabab";
        ctx.fill();
        ctx.stroke();

        // personaggio
        const characterName = this.characterNames[this.selectedCharacterIndex];
        const characterH = halfSide;
        const characterW = characterH * PERSON_W / PERSON_H;
        const drawPerson = getCharacterDrawFunction(characterName);
        drawPerson(ctx, 0, 0, characterW, characterH);

        const padding = borderWidth * 2;

        // input nickname
        const nameInputW =  1.4 * halfSide;
        const nameInputH = 0.2 * halfSide;
        this.nameInput.draw(ctx, -nameInputW/2, -halfSide + padding, nameInputW, nameInputH);

        // bottoni
        const btnWidth = 0.2 * halfSide;
        const btnHeight = 0.8 * halfSide;
        this.rightBtn.draw(ctx, halfSide - btnWidth - padding, -btnHeight/2, btnWidth, btnHeight);
        this.leftBtn.draw(ctx, -halfSide + padding, -btnHeight/2, btnWidth, btnHeight);
        const okBtnW = 0.8 * halfSide;
        const okBtnH = 0.2 * halfSide;
        this.okBtn.draw(ctx, -okBtnW/2, halfSide - okBtnH - padding, okBtnW, okBtnH);

        ctx.restore();
    }
}