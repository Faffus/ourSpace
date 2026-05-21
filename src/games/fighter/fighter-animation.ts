import { PlayerState } from './fighter';

// Struttura di un singolo keyframe di animazione.
// Descrive la "posa" del personaggio in un dato momento dell'animazione.
export type PoseKeyframe = {
    bodyTilt:  number;               // Inclinazione del corpo in gradi (positivo = avanti, negativo = indietro)
    duration:  number;               // Durata del keyframe in secondi
    armSide:   'front' | 'back';     // Quale braccio è in primo piano (influenza gli effetti visivi degli attacchi)
    opacity:   number;               // Trasparenza del personaggio (1 = opaco, <1 = semi-trasparente)
};

// Funzione shorthand per creare un PoseKeyframe con valori di default.
// Semplifica la scrittura delle animazioni evitando di ripetere ogni campo.
function f(
    bodyTilt: number,
    duration: number,
    armSide: 'front' | 'back' = 'front', // Default: braccio anteriore
    opacity = 1                           // Default: completamente opaco
): PoseKeyframe {
    return { bodyTilt, duration, armSide, opacity };
}

// Struttura di un'animazione: sequenza di keyframe + flag di loop.
type Animation = {
    keyframes: PoseKeyframe[];
    loop:      boolean;        // Se true, l'animazione riparte dall'inizio quando finisce
};

// Posa neutra usata come fallback quando non è disponibile un'animazione per lo stato corrente
const DEFAULT_POSE: PoseKeyframe = f(0, 1 / 12);

// ─── AnimationManager ─────────────────────────────────────────────────────────

// Gestisce le animazioni di un singolo personaggio.
// Tiene traccia dello stato corrente, del keyframe attivo e del tempo trascorso,
// e fornisce al renderer i dati di posa aggiornati ad ogni frame (poseData).
export class AnimationManager {
    private animations: Partial<Record<PlayerState, Animation>> = {}; // Mappa stato → animazione
    private state: PlayerState = 'IDLE';  // Stato corrente
    private elapsed = 0;                  // Tempo accumulato nel keyframe corrente (in secondi)

    public currentAnimationFrame = 0;             // Indice del keyframe attivo
    public facing: 'left' | 'right' = 'right';   // Direzione del personaggio (per specchiare lo sprite)
    public poseData: PoseKeyframe = DEFAULT_POSE; // Dati della posa corrente, letti dal renderer ogni frame

    // Registra un'animazione associandola a uno stato del giocatore.
    addAnimation(state: PlayerState, keyframes: PoseKeyframe[], loop = false): void {
        this.animations[state] = { keyframes, loop };
    }

    // Aggiorna la direzione in cui guarda il personaggio (usata dal renderer per specchiare lo sprite)
    flipSprite(direction: 'left' | 'right'): void {
        this.facing = direction;
    }

    // Cambia lo stato dell'animazione. Se lo stato è già quello corrente, non fa nulla.
    // Al cambio: azzera il timer, torna al primo keyframe e aggiorna subito poseData.
    setState(state: PlayerState): void {
        if (this.state === state) return;
        this.state   = state;
        this.elapsed = 0;
        this.currentAnimationFrame = 0;
        this.poseData = this.animations[state]?.keyframes[0] ?? DEFAULT_POSE;
    }

    // Avanza l'animazione di dt secondi.
    // Quando il tempo nel keyframe corrente è esaurito, passa al successivo.
    // Se loop=true ricomincia dall'inizio, altrimenti si ferma sull'ultimo keyframe.
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

        this.poseData = anim.keyframes[this.currentAnimationFrame]; // Espone la posa corrente al renderer
    }
}

// ─── Animazioni predefinite ───────────────────────────────────────────────────

// Crea e restituisce un AnimationManager già configurato con tutte le animazioni
// standard del personaggio. Ogni stato del gioco ha la propria sequenza di keyframe.
export function createDefaultFighterAnimationManager(): AnimationManager {
    const m = new AnimationManager();

    // Idle: leggera oscillazione (0°→1°→0°) in loop, simula il respiro del personaggio
    m.addAnimation('IDLE', [
        f(  0, 0.15),
        f(  1, 0.15),
        f(  0, 0.15),
    ], true);

    // Move: oscillazione avanti/indietro (5°→-5°) in loop, simula il passo durante la corsa
    m.addAnimation('MOVE', [
        f(  5, 0.10),
        f( -5, 0.10),
    ], true);

    // Jump: corpo inclinato leggermente indietro (-5°), posa statica in loop durante il volo
    m.addAnimation('JUMP', [
        f( -5, 0.30),
    ], true);

    // Crouching: forte inclinazione in avanti (20°), posa singola senza loop
    m.addAnimation('CROUCHING', [
        f( 20, 0.20),
    ]);

    // Dashing: anticipazione indietro (-10°), poi spinta in avanti (15°), in loop
    m.addAnimation('DASHING', [
        f(-10, 0.08),
        f( 15, 0.08),
    ], true);

    // Dodging: inclinazione pronunciata (-20°) con leggera trasparenza, poi recupero (15°)
    m.addAnimation('DODGING', [
        f(-20, 0.15, 'front', 0.9),
        f( 15, 0.15),
    ]);

    // Charging: piccola inclinazione in loop, indica che il personaggio sta caricando il colpo
    m.addAnimation('CHARGING', [
        f(  5, 0.12),
        f(  5, 0.12),
    ], true);

    // Attack: caricamento (braccio indietro, -5°) → impatto (braccio avanti, 20°) → recupero (5°)
    m.addAnimation('ATTACK', [
        f( -5, 0.08, 'back'),   // Anticipazione
        f( 20, 0.07, 'front'),  // Colpo (frame attivo dell'hitbox)
        f(  5, 0.12, 'front'),  // Recupero
    ]);

    // Shoryuken: anticipazione rapida, poi arco ascendente in tre fasi
    m.addAnimation('SHORYUKEN', [
        f( -8, 0.06, 'back'),   // Caricamento
        f(-25, 0.10, 'front'),  // Massima estensione verso l'alto
        f(-15, 0.14, 'front'),  // Discesa
        f(  5, 0.14, 'front'),  // Atterraggio
    ]);

    // Block: corpo inclinato indietro (-15°) in loop, postura difensiva
    m.addAnimation('BLOCK', [
        f(-15, 0.15),
    ], true);

    // Hit: corpo scosso indietro (-10°) con leggera trasparenza (0.85), posa singola
    m.addAnimation('HIT', [
        f(-10, 0.10, 'front', 0.85),
    ]);

    // Knockdown: corpo completamente a terra (90°, orizzontale)
    m.addAnimation('KNOCKDOWN', [
        f( 90, 0.20),
    ]);

    // KO: posa a terra (90°) con trasparenza ridotta (0.7), personaggio eliminato
    m.addAnimation('KO', [
        f( 90, 0.50, 'front', 0.7),
    ]);

    return m;
}
