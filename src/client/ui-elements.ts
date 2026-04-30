import { UserInput } from './user-input';
import { Rectangle } from '../common';

export abstract class ClickableRectangle {
    protected userInput: UserInput;
    protected rect: Rectangle;
    protected onClickCallback: () => void;
    protected transformMatrix: DOMMatrix;

    constructor(userInput: UserInput, onClickCallback: () => void) {
        this.userInput = userInput;
        this.rect = { x: 0, y: 0, w: 0, h: 0 };
        this.onClickCallback = onClickCallback;
        this.transformMatrix = new DOMMatrix();

        userInput.canvas.addEventListener('pointerdown', e => this.onPointerDown(e));
        userInput.canvas.addEventListener('pointerup', e => this.onPointerUp(e));
    }

    abstract onPointerDown(e: PointerEvent);
    abstract onPointerUp(e: PointerEvent);

    isInside(e: PointerEvent) {
        const { canvas } = this.userInput;
        const bounds = canvas.getBoundingClientRect();
        
        const rawX = e.clientX - bounds.left;
        const rawY = e.clientY - bounds.top;

        // handle case when canvas css size differs from its actual size
        const scaleX = canvas.width / bounds.width;
        const scaleY = canvas.height / bounds.height;
        const canvasMouseX = rawX * scaleX;
        const canvasMouseY = rawY * scaleY;

        const mousePoint = new DOMPoint(canvasMouseX, canvasMouseY);
        const invertedMatrix = this.transformMatrix.inverse();
        const localPoint = mousePoint.matrixTransform(invertedMatrix);

        const rect = this.rect;
        return localPoint.x >= rect.x && localPoint.x <= rect.x + rect.w &&
               localPoint.y >= rect.y && localPoint.y <= rect.y + rect.h;
    };

    updateRectangle(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number) {
        this.rect.x = x;
        this.rect.y = y;
        this.rect.w = w;
        this.rect.h = h;
        this.transformMatrix = ctx.getTransform();
    }
}

type ButtonColors = {
    main?: string;
    text?: string;
    shadow?: string;
}

export class Button extends ClickableRectangle {
    private text: string;
    private colors: ButtonColors;
    private isPressed: boolean;

    constructor(text: string, userInput: UserInput, onClickCallback: () => void) {
        super(userInput, onClickCallback);
        this.text = text;
        this.colors = {};
        this.isPressed = false;
    }

    onPointerDown(e: PointerEvent) {
        if (this.isInside(e)) this.isPressed = true;
    }
    onPointerUp(e: PointerEvent) {
        if (this.isPressed && this.isInside(e)) this.onClickCallback();
        this.isPressed = false;
    }

    draw(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number) {
        this.updateRectangle(ctx, x, y, w, h);

        const mainColor = this.colors.main || "#d18800";
        const textColor = this.colors.text || "#e6e6e6";
        const shadowColor = this.colors.shadow || "#161616";

        const shadowOffset = Math.min(w, h) * 0.07;
        const pushOffset = this.isPressed ? shadowOffset * 0.5 : 0;

        // ombra
        ctx.beginPath();
        ctx.rect(x + shadowOffset, y + shadowOffset, w, h);
        ctx.fillStyle = shadowColor;
        ctx.fill();

        // bottone
        ctx.beginPath();
        ctx.rect(x + pushOffset, y + pushOffset, w, h);
        ctx.fillStyle = mainColor;
        ctx.fill();

        // testo
        ctx.fillStyle = textColor;
        ctx.font = `bold ${Math.floor(Math.min(w, h) * 0.5)}px Arial`;
        ctx.textAlign = "center";
        ctx.textBaseline = "middle";
        ctx.fillText(this.text, x + w / 2 + pushOffset, y + h / 2 + pushOffset);
    }

    setColors(newColors: ButtonColors): void {
        this.colors = { ...this.colors, ...newColors };
    }

    setLabel(text: string): void {
        this.text = text;
    }
}

const EMPTY_FUNCTION = () => {};

export class TextInput extends ClickableRectangle {
    private text: string;
    private isFocused: boolean;
    private placeholder: string;

    constructor(userInput: UserInput, placeholder: string = "") {
        super(userInput, EMPTY_FUNCTION);

        this.text = "";
        this.isFocused = false;
        this.placeholder = placeholder;

        document.addEventListener('keydown', (e) => {
            if (!this.isFocused) return;

            if (e.key === "Backspace") {
                this.text = this.text.slice(0, -1);
            } else if (e.key.length === 1) {
                this.text += e.key;
            }
        });
    }

    onPointerDown(e: PointerEvent) {
        this.isFocused = this.isInside(e);
    }

    onPointerUp(e: PointerEvent) {}

    isInside(e: PointerEvent) {
        const { canvas, screenW, screenH } = this.userInput;
        const bounds = canvas.getBoundingClientRect();
        const pos = {
            x: e.clientX - bounds.left - screenW/2,
            y: e.clientY - bounds.top - screenH/2
        };
        const rect = this.rect;
        return pos.x >= rect.x && pos.x <= rect.x + rect.w &&
               pos.y >= rect.y && pos.y <= rect.y + rect.h;
    }

    draw(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number) {
        this.updateRectangle(ctx, x, y, w, h);

        const leftPadding = 10;

        // +sfondo
        ctx.beginPath();
        ctx.rect(x, y, w, h);
        ctx.fillStyle = "#eeeeee";
        ctx.fill();
        // -sfondo

        // +bordi
        const borderThickness = Math.min(h, w) * 0.1;
        ctx.beginPath();
        ctx.rect(x - borderThickness, y, borderThickness, h);
        ctx.rect(x + w, y, borderThickness, h);
        ctx.rect(x, y - borderThickness, w, borderThickness);
        ctx.rect(x, y + h, w, borderThickness);
        ctx.fillStyle = this.isFocused ? "#d18800" : "#161616";
        ctx.fill();
        // -bordi

        // +testo
        ctx.font = `${Math.floor(h * 0.5)}px Arial`;
        ctx.textAlign = "left";
        ctx.textBaseline = "middle";

        if (this.text.length > 0) {
            ctx.fillStyle = "#161616";
            ctx.fillText(this.text, x + leftPadding, y + h / 2);
        } else {
            ctx.fillStyle = "#555555";
            ctx.fillText(this.placeholder, x + leftPadding, y + h / 2);
        }
        // -testo

        // +cursore
        if (this.isFocused) {
            if (Math.floor(Date.now() / 500) % 2 === 0) {
                const textWidth = ctx.measureText(this.text.length > 0 ? this.text : "").width;
                const cursorX = x + leftPadding + textWidth + 2;
                
                ctx.beginPath();
                ctx.moveTo(cursorX, y + h * 0.2);
                ctx.lineTo(cursorX, y + h * 0.8);
                ctx.lineWidth = 2;
                ctx.strokeStyle = "#161616";
                ctx.stroke();
            }
        }
        // -cursore
    }

    getValue(): string {
        return this.text;
    }
}
