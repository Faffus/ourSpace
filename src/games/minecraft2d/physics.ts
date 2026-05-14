import {
	MC2D_PLAYER_GRAVITY,
	MC2D_PLAYER_HALF_HEIGHT,
	MC2D_PLAYER_HALF_WIDTH,
	MC2D_PLAYER_JUMP_SPEED,
	MC2D_PLAYER_MOVE_SPEED
} from "./constants";
import { PlayerInput, ServerPlayerState } from "./types";

const EPSILON = 0.0001;

type World = { isSolidAt(tileX: number, tileY: number): boolean };

export const stepPlayerPhysics = (
	body: ServerPlayerState,
	input: PlayerInput,
	world: World,
	dt: number,
	speedMultiplier: number
): void => {
	body.vx = ((input.right ? 1 : 0) - (input.left ? 1 : 0)) * MC2D_PLAYER_MOVE_SPEED * speedMultiplier;

	if (body.onGround && input.jump) {
		body.vy = MC2D_PLAYER_JUMP_SPEED;
		body.onGround = false;
	}

	body.vy += MC2D_PLAYER_GRAVITY * dt;

	resolveHorizontal(body, world, dt);
	resolveVertical(body, world, dt);

	if (Math.abs(body.vx) > EPSILON) body.facing = body.vx > 0 ? 1 : -1;
};

const resolveHorizontal = (body: ServerPlayerState, world: World, dt: number): void => {
	let nextX = body.x + body.vx * dt;

	const botTile = Math.floor(body.y - MC2D_PLAYER_HALF_HEIGHT + EPSILON);
	const topTile = Math.floor(body.y + MC2D_PLAYER_HALF_HEIGHT - EPSILON);

	if (body.vx > 0) {
		const tileX = Math.floor(nextX + MC2D_PLAYER_HALF_WIDTH);
		for (let ty = botTile; ty <= topTile; ty++) {
			if (world.isSolidAt(tileX, ty)) {
				nextX  = tileX - MC2D_PLAYER_HALF_WIDTH - EPSILON;
				body.vx = 0;
				break;
			}
		}
	} else if (body.vx < 0) {
		const tileX = Math.floor(nextX - MC2D_PLAYER_HALF_WIDTH);
		for (let ty = botTile; ty <= topTile; ty++) {
			if (world.isSolidAt(tileX, ty)) {
				nextX  = tileX + 1 + MC2D_PLAYER_HALF_WIDTH + EPSILON;
				body.vx = 0;
				break;
			}
		}
	}

	body.x = nextX;
};

const resolveVertical = (body: ServerPlayerState, world: World, dt: number): void => {
	let nextY = body.y + body.vy * dt;
	body.onGround = false;

	// Cache tile bounds once — same rationale as resolveHorizontal.
	const leftTile  = Math.floor(body.x - MC2D_PLAYER_HALF_WIDTH  + EPSILON);
	const rightTile = Math.floor(body.x + MC2D_PLAYER_HALF_WIDTH  - EPSILON);

	if (body.vy > 0) {
		const tileY = Math.floor(nextY + MC2D_PLAYER_HALF_HEIGHT);
		for (let tx = leftTile; tx <= rightTile; tx++) {
			if (world.isSolidAt(tx, tileY)) {
				nextY  = tileY - MC2D_PLAYER_HALF_HEIGHT - EPSILON;
				body.vy = 0;
				break;
			}
		}
	} else if (body.vy < 0) {
		const tileY = Math.floor(nextY - MC2D_PLAYER_HALF_HEIGHT);
		for (let tx = leftTile; tx <= rightTile; tx++) {
			if (world.isSolidAt(tx, tileY)) {
				nextY       = tileY + 1 + MC2D_PLAYER_HALF_HEIGHT + EPSILON;
				body.vy     = 0;
				body.onGround = true;
				break;
			}
		}
	}

	body.y = nextY;
};
