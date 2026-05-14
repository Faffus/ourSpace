import { CombatEvent, PlayerState } from './fighter';

type PoseKeyframe = {
    armAngle: number;
    legAngle: number;
    bodyTilt: number;
    armExtension: number;
    opacity: number;
    duration: number;
    armSide?: 'front' | 'back'; // front = attacco in avanti, back = attacco indietro
};

type AttackAnimation = {
    keyframes: PoseKeyframe[];
    loop: boolean;
    hitFrame?: number;
};

export class AnimationManager {
    private animations: Partial<Record<PlayerState, AttackAnimation>> = {};
    private state: PlayerState = "IDLE";
    private elapsed: number = 0;
    private frameCursor: number = 0;
    public currentAnimationFrame: number = 0;
    public facing: 'left' | 'right' = 'right';
    public poseData: PoseKeyframe | null = null;

    addAnimation(state: PlayerState, keyframes: PoseKeyframe[], loop: boolean = false, hitFrame?: number): void {
        this.animations[state] = { keyframes, loop, hitFrame };
    }

    setState(state: PlayerState): void {
        if (this.state === state) return;
        this.state = state;
        this.elapsed = 0;
        this.frameCursor = 0;
        const animation = this.animations[this.state];
        this.poseData = animation?.keyframes[0] ?? this.getDefaultPose();
    }

    updateAnimation(deltaTime: number): CombatEvent[] {
        const animation = this.animations[this.state];
        if (!animation || animation.keyframes.length === 0) {
            this.poseData = this.getDefaultPose();
            return [];
        }

        this.elapsed += deltaTime;
        const currentKeyframe = animation.keyframes[this.frameCursor];
        const frameDuration = currentKeyframe?.duration ?? 1 / 12;
        const events: CombatEvent[] = [];

        if (this.elapsed >= frameDuration) {
            this.elapsed = 0;
            this.frameCursor += 1;

            if (this.frameCursor >= animation.keyframes.length) {
                this.frameCursor = animation.loop ? 0 : animation.keyframes.length - 1;
            }

            this.currentAnimationFrame = this.frameCursor;
            if (this.frameCursor === animation.hitFrame) {
                events.push("HitboxActive" as CombatEvent);
            }
        }

        this.poseData = animation.keyframes[this.frameCursor] ?? this.getDefaultPose();
        return events;
    }

    flipSprite(direction: 'left' | 'right'): void {
        this.facing = direction;
    }

    private getDefaultPose(): PoseKeyframe {
        return {
            armAngle: 0,
            legAngle: 0,
            bodyTilt: 0,
            armExtension: 0,
            opacity: 1,
            duration: 1 / 12,
            armSide: 'front'
        };
    }
}

export function createDefaultFighterAnimationManager(): AnimationManager {
    const manager = new AnimationManager();

    manager.addAnimation("IDLE", [
        { armAngle: 0, legAngle: 0, bodyTilt: 0, armExtension: 0, opacity: 1, duration: 0.15 },
        { armAngle: -5, legAngle: -2, bodyTilt: 1, armExtension: 0, opacity: 1, duration: 0.15 },
        { armAngle: 0, legAngle: 0, bodyTilt: 0, armExtension: 0, opacity: 1, duration: 0.15 }
    ], true);

    manager.addAnimation("WALKING", [
        { armAngle: 15, legAngle: 10, bodyTilt: 2, armExtension: 0.1, opacity: 1, duration: 0.1 },
        { armAngle: -15, legAngle: -10, bodyTilt: -2, armExtension: 0.05, opacity: 1, duration: 0.1 },
        { armAngle: 10, legAngle: 5, bodyTilt: 1, armExtension: 0.08, opacity: 1, duration: 0.1 }
    ], true);

    manager.addAnimation("JUMPING", [
        { armAngle: -30, legAngle: -25, bodyTilt: -5, armExtension: 0.2, opacity: 1, duration: 0.3 }
    ], true);

    manager.addAnimation("CROUCHING", [
        { armAngle: 10, legAngle: 40, bodyTilt: 20, armExtension: -0.1, opacity: 1, duration: 0.2 }
    ], false);

    manager.addAnimation("DASHING", [
        { armAngle: 5, legAngle: -15, bodyTilt: -10, armExtension: 0.15, opacity: 1, duration: 0.08 },
        { armAngle: -10, legAngle: 20, bodyTilt: 15, armExtension: 0.1, opacity: 1, duration: 0.08 }
    ], true);

    manager.addAnimation("DODGING", [
        { armAngle: -45, legAngle: -30, bodyTilt: -20, armExtension: -0.2, opacity: 0.9, duration: 0.15 },
        { armAngle: 30, legAngle: 25, bodyTilt: 15, armExtension: 0.1, opacity: 1, duration: 0.15 }
    ], false);

    manager.addAnimation("CHARGING", [
        { armAngle: -20, legAngle: 5, bodyTilt: 5, armExtension: 0.3, opacity: 1, duration: 0.12 },
        { armAngle: -25, legAngle: 5, bodyTilt: 5, armExtension: 0.35, opacity: 1, duration: 0.12 }
    ], true);

    // Light Attack: quick jab with arm coming from lowered position
    manager.addAnimation("ATTACKING_LIGHT", [
        { armAngle: -15, legAngle: 5, bodyTilt: -5, armExtension: -0.1, opacity: 1, duration: 0.08, armSide: 'back' },
        { armAngle: 45, legAngle: 5, bodyTilt: 10, armExtension: 0.4, opacity: 1, duration: 0.06, armSide: 'front' },
        { armAngle: 20, legAngle: 5, bodyTilt: 5, armExtension: 0.2, opacity: 1, duration: 0.1, armSide: 'front' }
    ], false, 1);

    // Heavy Attack: powerful punch with full body rotation
    manager.addAnimation("ATTACKING_HEAVY", [
        { armAngle: -30, legAngle: 10, bodyTilt: -15, armExtension: -0.2, opacity: 1, duration: 0.12, armSide: 'back' },
        { armAngle: 60, legAngle: 15, bodyTilt: 30, armExtension: 0.5, opacity: 1, duration: 0.08, armSide: 'front' },
        { armAngle: 30, legAngle: 10, bodyTilt: 15, armExtension: 0.25, opacity: 1, duration: 0.14, armSide: 'front' }
    ], false, 1);

    // Aerial Attack: upward strike while jumping
    manager.addAnimation("ATTACKING_AERIAL", [
        { armAngle: -60, legAngle: -20, bodyTilt: -25, armExtension: 0.1, opacity: 1, duration: 0.1, armSide: 'back' },
        { armAngle: 50, legAngle: -15, bodyTilt: 20, armExtension: 0.45, opacity: 1, duration: 0.08, armSide: 'front' },
        { armAngle: 0, legAngle: -10, bodyTilt: 0, armExtension: 0, opacity: 1, duration: 0.12, armSide: 'front' }
    ], false, 1);

    // Sweep: low leg attack
    manager.addAnimation("ATTACKING_SWEEP", [
        { armAngle: 0, legAngle: 45, bodyTilt: 25, armExtension: 0, opacity: 1, duration: 0.12, armSide: 'front' },
        { armAngle: 10, legAngle: 60, bodyTilt: 35, armExtension: 0.1, opacity: 1, duration: 0.08, armSide: 'front' },
        { armAngle: 5, legAngle: 40, bodyTilt: 20, armExtension: 0.05, opacity: 1, duration: 0.15, armSide: 'front' }
    ], false, 1);

    // Special (Shoryuken): rising uppercut
    manager.addAnimation("SPECIAL", [
        { armAngle: -45, legAngle: -10, bodyTilt: -20, armExtension: -0.15, opacity: 1, duration: 0.1, armSide: 'back' },
        { armAngle: 80, legAngle: 20, bodyTilt: 40, armExtension: 0.55, opacity: 1, duration: 0.08, armSide: 'front' },
        { armAngle: 60, legAngle: 25, bodyTilt: 30, armExtension: 0.4, opacity: 1, duration: 0.12, armSide: 'front' }
    ], false, 1);

    manager.addAnimation("HIT", [
        { armAngle: 20, legAngle: -10, bodyTilt: -10, armExtension: 0, opacity: 0.85, duration: 0.1 }
    ], false);

    manager.addAnimation("BLOCKING", [
        { armAngle: -30, legAngle: 10, bodyTilt: -15, armExtension: 0.25, opacity: 1, duration: 0.15 }
    ], true);

    manager.addAnimation("KNOCKDOWN", [
        { armAngle: 45, legAngle: 60, bodyTilt: 90, armExtension: 0.2, opacity: 1, duration: 0.2 }
    ], false);

    manager.addAnimation("KO", [
        { armAngle: 45, legAngle: 60, bodyTilt: 90, armExtension: 0.2, opacity: 0.7, duration: 0.5 }
    ], false);

    return manager;
}
