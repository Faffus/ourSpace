import { PlayerState } from './fighter';

export type PoseKeyframe = {
    armAngle:     number;
    legAngle:     number;
    bodyTilt:     number;
    armExtension: number;
    duration:     number;
    armSide:      'front' | 'back';
    opacity:      number;
};

type Animation = {
    keyframes: PoseKeyframe[];
    loop:      boolean;
};

// Shorthand: armSide and opacity almost always stay at defaults
function f(
    armAngle: number,
    legAngle: number,
    bodyTilt: number,
    armExtension: number,
    duration: number,
    armSide: 'front' | 'back' = 'front',
    opacity = 1
): PoseKeyframe {
    return { armAngle, legAngle, bodyTilt, armExtension, duration, armSide, opacity };
}

const DEFAULT_POSE: PoseKeyframe = f(0, 0, 0, 0, 1 / 12);

export class AnimationManager {
    private animations: Partial<Record<PlayerState, Animation>> = {};
    private state: PlayerState = 'IDLE';
    private elapsed = 0;

    public currentAnimationFrame = 0;
    public facing: 'left' | 'right' = 'right';
    public poseData: PoseKeyframe = DEFAULT_POSE;

    addAnimation(state: PlayerState, keyframes: PoseKeyframe[], loop = false): void {
        this.animations[state] = { keyframes, loop };
    }

    flipSprite(direction: 'left' | 'right'): void {
        this.facing = direction;
    }

    setState(state: PlayerState): void {
        if (this.state === state) return;
        this.state   = state;
        this.elapsed = 0;
        this.currentAnimationFrame = 0;
        this.poseData = this.animations[state]?.keyframes[0] ?? DEFAULT_POSE;
    }

    updateAnimation(dt: number): void {
        const anim = this.animations[this.state];
        if (!anim || anim.keyframes.length === 0) { this.poseData = DEFAULT_POSE; return; }

        this.elapsed += dt;
        const frameDuration = anim.keyframes[this.currentAnimationFrame].duration;

        if (this.elapsed >= frameDuration) {
            this.elapsed = 0;
            this.currentAnimationFrame++;
            if (this.currentAnimationFrame >= anim.keyframes.length)
                this.currentAnimationFrame = anim.loop ? 0 : anim.keyframes.length - 1;
        }

        this.poseData = anim.keyframes[this.currentAnimationFrame];
    }
}

export function createDefaultFighterAnimationManager(): AnimationManager {
    const m = new AnimationManager();

    m.addAnimation('IDLE', [
        f(  0,   0,   0,  0.00, 0.15),
        f( -5,  -2,   1,  0.00, 0.15),
        f(  0,   0,   0,  0.00, 0.15),
    ], true);

    m.addAnimation('MOVE', [
        f( 15,  10,   2,  0.10, 0.1),
        f(-15, -10,  -2,  0.05, 0.1),
        f( 10,   5,   1,  0.08, 0.1),
    ], true);

    m.addAnimation('JUMP', [
        f(-30, -25,  -5,  0.20, 0.3),
    ], true);

    m.addAnimation('CROUCHING', [
        f( 10,  40,  20, -0.10, 0.2),
    ]);

    m.addAnimation('DASHING', [
        f(  5, -15, -10,  0.15, 0.08),
        f(-10,  20,  15,  0.10, 0.08),
    ], true);

    m.addAnimation('DODGING', [
        f(-45, -30, -20, -0.20, 0.15, 'front', 0.9),
        f( 30,  25,  15,  0.10, 0.15),
    ]);

    m.addAnimation('CHARGING', [
        f(-20,   5,   5,  0.30, 0.12),
        f(-25,   5,   5,  0.35, 0.12),
    ], true);

    // ATTACK animations — attacchi ora usano state='ATTACK', distinti da attackType nel renderer
    m.addAnimation('ATTACK', [
        f(-15,   5,  -5, -0.10, 0.08, 'back'),
        f( 55,  10,  20,  0.45, 0.07),
        f( 20,   5,   5,  0.20, 0.12),
    ], false);

    m.addAnimation('BLOCK', [
        f(-30,  10, -15,  0.25, 0.15),
    ], true);

    m.addAnimation('HIT', [
        f( 20, -10, -10,  0.00, 0.10, 'front', 0.85),
    ]);

    m.addAnimation('KNOCKDOWN', [
        f( 45,  60,  90,  0.20, 0.20),
    ]);

    m.addAnimation('KO', [
        f( 45,  60,  90,  0.20, 0.50, 'front', 0.7),
    ]);

    return m;
}
