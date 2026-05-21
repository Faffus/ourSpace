import { UserInput } from './user-input';
import { Rectangle } from '../common';

export abstract class ClickableRectangle {
    protected userInput: UserInput;
    protected rect: Rectangle;
    protected onClickCallback: () => void;
    protected transformMatrix: DOMMatrix;
    protected enabled: boolean;

    constructor(userInput: UserInput, onClickCallback: () => void) {
        this.userInput = userInput;
        this.rect = { x: 0, y: 0, w: 0, h: 0 };
        this.onClickCallback = onClickCallback;
        this.transformMatrix = new DOMMatrix();
        this.enabled = true;

        userInput.canvas.addEventListener('pointerdown', e => this.onPointerDown(e));
        userInput.canvas.addEventListener('pointerup', e => this.onPointerUp(e));
    }

    setEnabled(value: boolean) {
        this.enabled = value;
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
        const localPoint = this.transformMatrix
            ? mousePoint.matrixTransform(this.transformMatrix.inverse())
            : mousePoint;

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

        this.userInput.canvas.addEventListener('pointercancel', () => {
            this.isPressed = false;
        });
    }

    setEnabled(value: boolean) {
        super.setEnabled(value);
        if (!value) {
            this.isPressed = false;
        }
    }

    onPointerDown(e: PointerEvent) {
        if (!this.enabled) return;
        if (this.isInside(e)) {
            this.isPressed = true;
            e.preventDefault();
        }
    }
    onPointerUp(e: PointerEvent) {
        if (!this.enabled) {
            this.isPressed = false;
            return;
        }
        if (this.isPressed && this.isInside(e)) {
            this.onClickCallback();
            e.preventDefault();
        }
        this.isPressed = false;
    }

    draw(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number) {
        this.updateRectangle(ctx, x, y, w, h);

        const defaultMain = this.enabled ? "#d18800" : "#555555";
        const defaultText = this.enabled ? "#e6e6e6" : "#aaaaaa";
        const mainColor = this.colors.main || defaultMain;
        const textColor = this.colors.text || defaultText;
        const shadowColor = this.colors.shadow || "#161616";

        const shadowOffset = Math.min(w, h) * 0.07;
        const pushOffset = this.enabled && this.isPressed ? shadowOffset * 0.5 : 0;

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
        ctx.font = `bold ${Math.min(w, h) * 0.5}px Arial`;
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
    private maxLength: number | null;

    constructor(userInput: UserInput, placeholder: string = "", maxLength: number | null = null) {
        super(userInput, EMPTY_FUNCTION);

        this.text = "";
        this.isFocused = false;
        this.placeholder = placeholder;
        this.maxLength = maxLength;

        document.addEventListener('keydown', (e) => {
            if (!this.isFocused) return;

            if (e.key === "Backspace") {
                this.text = this.text.slice(0, -1);
            } else if (e.key.length === 1) {
                if (this.maxLength === null || this.text.length < this.maxLength)
                    this.text += e.key;
            }
        });
    }

    onPointerDown(e: PointerEvent) {
        if (!this.enabled) return;
        this.isFocused = this.isInside(e);
        if (this.isFocused) e.preventDefault();
    }

    onPointerUp(e: PointerEvent) {
        if (!this.enabled) return;
        if (this.isInside(e)) {
            this.isFocused = true;
            e.preventDefault();
        }
    }

    draw(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number) {
        this.updateRectangle(ctx, x, y, w, h);
        const leftPadding = w * 0.01;

        ctx.save();

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

        // +sfondo
        ctx.beginPath();
        ctx.rect(x, y, w, h);
        ctx.clip();
        ctx.fillStyle = "#eeeeee";
        ctx.fill();
        // -sfondo

        // +testo
        ctx.font = `${h * 0.5}px Arial`;
        ctx.textAlign = "left";
        ctx.textBaseline = "middle";

        if (this.text.length > 0) {
            ctx.fillStyle = "#161616";
            ctx.fillText(this.text, x + leftPadding, y + h / 2);
        } else if (!this.isFocused) {
            ctx.fillStyle = "#555555";
            ctx.fillText(this.placeholder, x + leftPadding, y + h / 2);
        }
        // -testo

        // +cursore
        if (this.isFocused) {
            if (Math.floor(Date.now() / 500) % 2 === 0) {
                const textWidth = ctx.measureText(this.text.length > 0 ? this.text : "").width;
                const cursorX = x + leftPadding + textWidth + h*0.1; // xdsff
                
                ctx.beginPath();
                ctx.moveTo(cursorX, y + h * 0.2);
                ctx.lineTo(cursorX, y + h * 0.8);
                ctx.lineWidth = h * 0.07;
                ctx.strokeStyle = "#161616";
                ctx.stroke();
            }
        }
        // -cursore

        ctx.restore();
    }

    getValue(): string {
        return this.text;
    }
}
