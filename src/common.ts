export const TICK_FREQUENCY = 60; // ticks per second
export const PERSON_W = 40;
export const PERSON_H = 120;
export const EPSILON = 0.0001;

export type Player = {
    name: string;
    character: string;
}

export type Rectangle = {
    x: number; // x position of the top left corner
    y: number; // y position of the top left corner
    w: number; // width
    h: number; // height
}

export const mod = (n: number, m: number) => ((n % m) + m) % m;

export const smoothChange = (from: number, to: number, dt: number, halfLife: number): number => {
    return to + (from - to) * Math.pow(2, -dt / halfLife)
}

export type CollisionSide = "top" | "bottom" | "left" | "right" | "none";

export const getCollisionSide = (rect1: Rectangle, rect2: Rectangle): CollisionSide => {
    const overlapLeft = (rect1.x + rect1.w) - rect2.x;
    const overlapRight = (rect2.x + rect2.w) - rect1.x;
    const overlapTop = (rect1.y + rect1.h) - rect2.y;
    const overlapBottom = (rect2.y + rect2.h) - rect1.y;

    if (overlapLeft <= 0 || overlapRight <= 0 || overlapTop <= 0 || overlapBottom <= 0) {
        return "none";
    }

    const minOverlap = Math.min(overlapLeft, overlapRight, overlapTop, overlapBottom);

    if (minOverlap === overlapTop) return "top";
    if (minOverlap === overlapBottom) return "bottom";
    if (minOverlap === overlapLeft) return "left";
    if (minOverlap === overlapRight) return "right";

    return "none";
}

export const changeLighness = (color: string, percent: number): string => {
    const { h, s, l } = hexToColorHSL(color);
    const newLightness = Math.max(0, Math.min(100, l * (1 + percent)));
    return colorHSLToHex({ h, s, l: newLightness });
}

const toHex = (n: number, pad: number = 0) => n.toString(16).padStart(pad, '0');

type ColorHSL = {
    h: number;
    s: number;
    l: number;
}

const hexToColorHSL = (hex: string): ColorHSL => {
    let r = 0, g = 0, b = 0;
    let cleanedHex = hex.replace("#", "");

    if (cleanedHex.length === 3) {
        r = parseInt(cleanedHex[0], 16); r += r * 16;
        g = parseInt(cleanedHex[1], 16); g += g * 16;
        b = parseInt(cleanedHex[2], 16); b += b * 16;
    } else {
        r = parseInt(cleanedHex.substring(0, 2), 16);
        g = parseInt(cleanedHex.substring(2, 4), 16);
        b = parseInt(cleanedHex.substring(4, 6), 16);
    }

    r /= 255;
    g /= 255;
    b /= 255;

    const max = Math.max(r, g, b);
    const min = Math.min(r, g, b);
    let h = 0;
    let s = 0;
    const l = (max + min) / 2;

    if (max !== min) {
        const d = max - min;
        s = l > 0.5 ? d / (2 - max - min) : d / (max + min);

        switch (max) {
            case r: h = (g - b) / d + (g < b ? 6 : 0); break;
            case g: h = (b - r) / d + 2; break;
            case b: h = (r - g) / d + 4; break;
        }
        h /= 6;
    }

    return {
        h: Math.round(h * 360),
        s: Math.round(s * 100),
        l: Math.round(l * 100)
    };
}

function colorHSLToHex(color: ColorHSL): string {
    let { h, s, l } = color;
    s /= 100;
    l /= 100;
    const c = (1 - Math.abs(2 * l - 1)) * s;
    const x = c * (1 - Math.abs((h / 60) % 2 - 1));
    const m = l - c / 2;

    let r = 0, g = 0, b = 0;
    if (0 <= h && h < 60) {
        r = c; g = x; b = 0;
    } else if (60 <= h && h < 120) {
        r = x; g = c; b = 0;
    } else if (120 <= h && h < 180) {
        r = 0; g = c; b = x;
    } else if (180 <= h && h < 240) {
        r = 0; g = x; b = c;
    } else if (240 <= h && h < 300) {
        r = x; g = 0; b = c;
    } else if (300 <= h && h < 360) {
        r = c; g = 0; b = x;
    }
    r = Math.round((r + m) * 255);
    g = Math.round((g + m) * 255);
    b = Math.round((b + m) * 255);

    return `#${toHex(r, 2)}${toHex(g, 2)}${toHex(b, 2)}`;
}
