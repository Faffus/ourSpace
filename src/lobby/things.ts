import { changeLighness, ColorHSL, hexToColorHSL, PERSON_H, PERSON_W, Rectangle, smoothChange, toHSLString } from "../common";

export class Arcade {
    rect: Rectangle;
    tallness: number;
    wallThickness: number;
    collisionBoxes: Rectangle[];
    doorWidth: number;
    doorHeight: number;
    frontAlpha: number;
    targetFrontAlpha: number;

    interiorColor: string;
    wallColor: string;
    wallSectionColor: string;
    roofColor: string;
    roofColorLight: string;
    roofColorDark: string;

    private _revealed: boolean = false;
    private _hideDoor: boolean = false;

    constructor(rect: Rectangle, wallThickness: number) {
        this.rect = rect;
        this.tallness = PERSON_H * 3;
        this.wallThickness = wallThickness;
        this.doorWidth = PERSON_W * 4;
        this.doorHeight = PERSON_H * 1.3;
        this.frontAlpha = 1.0;
        this.targetFrontAlpha = this.frontAlpha;

        this.interiorColor = "#373737";
        this.wallColor = "#9e9e9e";
        this.wallSectionColor = "#9e9e9e";
        const roofColor = hexToColorHSL("#c12000");
        this.roofColor = toHSLString(roofColor);
        this.roofColorLight = toHSLString(changeLighness(roofColor, 0.2));
        this.roofColorDark = toHSLString(changeLighness(roofColor, -0.2));

        this.collisionBoxes = this.buildCollisionBoxes();
    }

    doorPosition(): { yCenter: number, left: number, right: number } {
        const yCenter = this.rect.x + this.rect.w / 2;
        const left = yCenter - this.doorWidth / 2;
        const right = yCenter + this.doorWidth / 2;
        return { yCenter, left, right };
    }

    private buildCollisionBoxes(): Rectangle[] {
        const t = this.wallThickness;
        const r = this.rect;
        const wallBottom = r.y + r.h;
        const {  left: doorLeft, right: doorRight } = this.doorPosition();

        return [
            { x: r.x, y: r.y, w: t, h: r.h }, // left wall
            { x: r.x, y: r.y, w: r.w, h: t }, // top wall
            { x: r.x + r.w - t, y: r.y, w: t, h: r.h }, // right wall
            { x: r.x, y: wallBottom - t, w: doorLeft - r.x, h: t }, // bottom-left
            { x: doorRight, y: wallBottom - t, w: r.x + r.w - doorRight, h: t }, // bottom-right
        ];
    }

    isPlayerInside(playerRect: Rectangle): boolean {
        const r = this.rect;
        const { x, y, w, h } = playerRect;
        const xBetween = x > r.x && x + w < r.x + r.w;
        const yBetween = y > r.y && y + h < r.y + r.h;
        return xBetween && yBetween;
    }

    isPlayerEntering(playerRect: Rectangle): boolean {
        const r = this.rect;
        const { x, y, w, h } = playerRect;
        const { left: doorLeft, right: doorRight } = this.doorPosition();
        const xBetween = x >= doorLeft && x + w <= doorRight;
        const yBetween = y < r.y + r.h && y + h > r.y + r.h;
        return xBetween && yBetween;
    }

    update(playerRect: Rectangle) {
        this.targetFrontAlpha = this.isPlayerInside(playerRect) ? 0 : 1;
        this._revealed = this.isPlayerInside(playerRect);
        this._hideDoor = this._revealed || this.isPlayerEntering(playerRect);
    }

    get revealed(): boolean {
        return this._revealed;
    }

    drawSign(ctx: CanvasRenderingContext2D) {
        const w = this.rect.w * 0.45;
        const h = this.rect.w * 0.12;
        const x = this.rect.x + (this.rect.w - w) / 2;
        const y = this.rect.y + this.rect.h * 0.95 - this.doorHeight - h;

        const spacing = h * 0.1;


        ctx.fillStyle = "#101010";
        ctx.fillRect(x, y, w, h);

        const letterCount = 6;
        let letterX = x + spacing;
        const letterY = y + spacing;
        const letterW = (w - (letterCount+1)*spacing) / letterCount;
        const letterH = h - 2*spacing;
        const thickness = letterW * 0.15;
        const letterColor = "#0021f5";

        ctx.save();
        const time = Date.now() / 1000;
        ctx.shadowColor = letterColor;
        ctx.shadowBlur = 2 + 1.5 * (Math.sin(6.28 * 0.2 * time) + 1); 
        ctx.shadowOffsetX = 0;
        ctx.shadowOffsetY = 0;

        ctx.fillStyle = letterColor;

        // A
        ctx.fillRect(letterX, letterY, thickness, letterH);
        ctx.fillRect(letterX + letterW - thickness, letterY, thickness, letterH);
        ctx.fillRect(letterX, letterY, letterW, thickness);
        ctx.fillRect(letterX, letterY + letterH*0.6, letterW, thickness);

        const smallLetterH = letterH * 0.5;
        const smallLetterY = letterY + letterH - smallLetterH;
        // r
        letterX += letterW + spacing;
        const rExtraH = letterH * 0.07;
        ctx.fillRect(letterX, smallLetterY - rExtraH, thickness, smallLetterH + rExtraH);
        ctx.fillRect(letterX, smallLetterY, letterW, thickness);
        ctx.fillRect(letterX + letterW - thickness, smallLetterY, thickness, thickness + rExtraH);

        // c
        letterX += letterW + spacing;
        ctx.fillRect(letterX, smallLetterY, thickness, smallLetterH);
        ctx.fillRect(letterX, smallLetterY, letterW, thickness);
        ctx.fillRect(letterX, smallLetterY + smallLetterH - thickness, letterW, thickness);

        // a
        letterX += letterW + spacing;
        ctx.fillRect(letterX, smallLetterY, letterW, thickness);
        ctx.fillRect(letterX + letterW - thickness, smallLetterY, thickness, smallLetterH);
        ctx.fillRect(letterX, smallLetterY + smallLetterH - thickness, letterW, thickness);
        ctx.fillRect(letterX, smallLetterY + smallLetterH*0.5, thickness, smallLetterH*0.5);
        ctx.fillRect(letterX, smallLetterY + smallLetterH*0.5 - thickness, letterW, thickness);

        // d
        letterX += letterW + spacing;
        ctx.fillRect(letterX, smallLetterY, thickness, smallLetterH);
        ctx.fillRect(letterX, smallLetterY, letterW, thickness);
        ctx.fillRect(letterX, smallLetterY + smallLetterH - thickness, letterW, thickness);
        ctx.fillRect(letterX + letterW - thickness, letterY, thickness, letterH);

        // e
        letterX += letterW + spacing;
        ctx.fillRect(letterX, smallLetterY + smallLetterH - thickness, letterW, thickness);
        ctx.fillRect(letterX, smallLetterY, thickness, smallLetterH);
        ctx.fillRect(letterX, smallLetterY, letterW, thickness);
        ctx.fillRect(letterX + letterW - thickness, smallLetterY, thickness, smallLetterH*0.5);
        ctx.fillRect(letterX, smallLetterY + smallLetterH*0.5, letterW, thickness);

        ctx.restore();
    }

    draw(ctx: CanvasRenderingContext2D, dt: number) {
        this.frontAlpha = smoothChange(this.frontAlpha, this.targetFrontAlpha, dt, 0.07);
        const r = this.rect;
        ctx.fillStyle = this.interiorColor;
        ctx.fillRect(r.x, r.y, r.w, r.h);
    }

    drawFront(ctx: CanvasRenderingContext2D) {
        const r = this.rect;
        const wallBottom = r.y + r.h;
        const doorY = wallBottom - this.doorHeight;
        const { yCenter: doorCenter, left: doorLeft, right: doorRight } = this.doorPosition();

        // interior walls
        ctx.fillStyle = this.wallSectionColor;
        for (const box of this.collisionBoxes) {
            ctx.fillRect(box.x, box.y, box.w, box.h);
        }

        // +frontWall
        ctx.globalAlpha = this.frontAlpha;
        ctx.fillStyle = this.wallColor;
        ctx.beginPath();
        ctx.moveTo(r.x, r.y);
        ctx.lineTo(r.x + r.w, r.y);
        ctx.lineTo(r.x + r.w, r.y + r.h);
        ctx.lineTo(doorRight, r.y + r.h);
        ctx.lineTo(doorRight, r.y + r.h - this.doorHeight);
        ctx.lineTo(doorLeft, r.y + r.h - this.doorHeight);
        ctx.lineTo(doorLeft, r.y + r.h);
        ctx.lineTo(r.x, r.y + r.h);
        ctx.closePath();
        ctx.fill();
        // -frontWall
        
        this.drawSign(ctx);

        // +door
        if (!this._hideDoor) {
            ctx.fillStyle = "#75bedb";
            ctx.fillRect(doorLeft, doorY, this.doorWidth, this.doorHeight);

            const frameThickness = this.doorWidth * 0.05;
            ctx.fillStyle = "#6d5656";
            ctx.fillRect(doorLeft, doorY, frameThickness, this.doorHeight);
            ctx.fillRect(doorCenter - frameThickness, doorY, frameThickness, this.doorHeight);
            ctx.fillRect(doorCenter, doorY, frameThickness, this.doorHeight);
            ctx.fillRect(doorRight - frameThickness, doorY, frameThickness, this.doorHeight);
            ctx.fillRect(doorLeft, doorY, this.doorWidth, frameThickness);
            ctx.fillRect(doorLeft, doorY + this.doorHeight - frameThickness, this.doorWidth, frameThickness);
        }
        // -door

        // +roof
        const roofH = this.wallThickness;
        const roofExtraW = roofH * 0.6;
        const roofBottom = r.y + r.h - this.tallness; 
        const roofTop = roofBottom - roofH;

        ctx.fillStyle = this.roofColor;
        ctx.fillRect(r.x, r.y - this.tallness - roofH, r.w, r.h);

        ctx.beginPath();
        ctx.moveTo(r.x - roofExtraW, roofBottom);
        ctx.lineTo(r.x + r.w + roofExtraW, roofBottom);
        ctx.lineTo(r.x + r.w, roofTop);
        ctx.lineTo(r.x, roofTop);
        ctx.closePath();
        ctx.fillStyle = this.roofColorLight;
        ctx.fill();

        ctx.beginPath();
        ctx.moveTo(r.x - roofExtraW, roofBottom);
        ctx.lineTo(r.x, roofTop);
        ctx.lineTo(r.x, roofTop - r.h);
        ctx.lineTo(r.x - roofExtraW, roofBottom - r.h);
        ctx.closePath();
        ctx.fillStyle = this.roofColorDark;
        ctx.fill();

        ctx.beginPath();
        ctx.moveTo(r.x + r.w + roofExtraW, roofBottom);
        ctx.lineTo(r.x + r.w, roofTop);
        ctx.lineTo(r.x + r.w, roofTop - r.h);
        ctx.lineTo(r.x + r.w + roofExtraW, roofTop - r.h + roofH);
        ctx.closePath();
        ctx.fillStyle = this.roofColorDark;
        ctx.fill();
        // -roof
        ctx.globalAlpha = 1;
    }
}