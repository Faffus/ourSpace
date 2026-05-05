import {
    MC2D_PLAYER_GRAVITY,
    MC2D_PLAYER_HALF_HEIGHT,
    MC2D_PLAYER_HALF_WIDTH,
    MC2D_PLAYER_JUMP_SPEED,
    MC2D_PLAYER_MOVE_SPEED
} from "./constants";
import { PlayerInput, ServerPlayerState } from "./types";

const EPSILON = 0.0001;

export const stepPlayerPhysics = (
    body: ServerPlayerState,
    input: PlayerInput,
    world: { isSolidAt(tileX: number, tileY: number): boolean },
    dt: number,
    speedMultiplier: number
): void => {
    let moveDir = 0;
    if (input.left) moveDir -= 1;
    if (input.right) moveDir += 1;

    body.vx = moveDir * MC2D_PLAYER_MOVE_SPEED * speedMultiplier;

    if (body.onGround && input.jump) {
        body.vy = MC2D_PLAYER_JUMP_SPEED;
        body.onGround = false;
    }

    body.vy += MC2D_PLAYER_GRAVITY * dt;

    resolveHorizontal(body, world, dt);
    resolveVertical(body, world, dt);

    if (Math.abs(body.vx) > EPSILON) {
        body.facing = body.vx >= 0 ? 1 : -1;
    }
};

const resolveHorizontal = (
    body: ServerPlayerState,
    world: { isSolidAt(tileX: number, tileY: number): boolean },
    dt: number
): void => {
    let nextX = body.x + body.vx * dt;
    const bottom = body.y - MC2D_PLAYER_HALF_HEIGHT + EPSILON;
    const top = body.y + MC2D_PLAYER_HALF_HEIGHT - EPSILON;

    if (body.vx > 0) {
        const right = nextX + MC2D_PLAYER_HALF_WIDTH;
        const tileX = Math.floor(right);
        for (let tileY = Math.floor(bottom); tileY <= Math.floor(top); tileY += 1) {
            if (world.isSolidAt(tileX, tileY)) {
                nextX = tileX - MC2D_PLAYER_HALF_WIDTH - EPSILON;
                body.vx = 0;
                break;
            }
        }
    } else if (body.vx < 0) {
        const left = nextX - MC2D_PLAYER_HALF_WIDTH;
        const tileX = Math.floor(left);
        for (let tileY = Math.floor(bottom); tileY <= Math.floor(top); tileY += 1) {
            if (world.isSolidAt(tileX, tileY)) {
                nextX = tileX + 1 + MC2D_PLAYER_HALF_WIDTH + EPSILON;
                body.vx = 0;
                break;
            }
        }
    }

    body.x = nextX;
};

const resolveVertical = (
    body: ServerPlayerState,
    world: { isSolidAt(tileX: number, tileY: number): boolean },
    dt: number
): void => {
    let nextY = body.y + body.vy * dt;
    const left = body.x - MC2D_PLAYER_HALF_WIDTH + EPSILON;
    const right = body.x + MC2D_PLAYER_HALF_WIDTH - EPSILON;
    body.onGround = false;

    if (body.vy > 0) {
        const top = nextY + MC2D_PLAYER_HALF_HEIGHT;
        const tileY = Math.floor(top);
        for (let tileX = Math.floor(left); tileX <= Math.floor(right); tileX += 1) {
            if (world.isSolidAt(tileX, tileY)) {
                nextY = tileY - MC2D_PLAYER_HALF_HEIGHT - EPSILON;
                body.vy = 0;
                break;
            }
        }
    } else if (body.vy < 0) {
        const bottom = nextY - MC2D_PLAYER_HALF_HEIGHT;
        const tileY = Math.floor(bottom);
        for (let tileX = Math.floor(left); tileX <= Math.floor(right); tileX += 1) {
            if (world.isSolidAt(tileX, tileY)) {
                nextY = tileY + 1 + MC2D_PLAYER_HALF_HEIGHT + EPSILON;
                body.vy = 0;
                body.onGround = true;
                break;
            }
        }
    }

    body.y = nextY;
};
