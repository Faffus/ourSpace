export const TICK_FREQUENCY = 20; // ticks per second
export const PERSON_W = 40;
export const PERSON_H = 120;

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