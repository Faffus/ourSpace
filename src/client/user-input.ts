const ZOOM_MIN = 0.1, ZOOM_MAX = 4, ZOOM_SPEED = 0.035;

export class UserInput {
    public canvas: HTMLCanvasElement;
    public screenW: number = 0;
    public screenH: number = 0;
    public moveDirectionX: number = 0;
    public moveDirectionY: number = 0;
    public mouseX: number = 0;
    public mouseY: number = 0;
    public zoom: number = 1;

    private up: boolean = false;
    private down: boolean = false;
    private left: boolean = false;
    private right: boolean = false;

    constructor(canvas: HTMLCanvasElement) {
        this.canvas = canvas;

        const resize = () => {
            this.canvas.width = window.innerWidth; 
            this.canvas.height = window.innerHeight;
            this.screenW = window.innerWidth;
            this.screenH = window.innerHeight;
        };
        resize();
        window.addEventListener('resize', resize);

        // TODO movement on mobile with virtual joystick
        document.addEventListener("keydown", (event) => {
            if (event.repeat) return;

            if (event.code == "KeyW") this.up = true;
            else if (event.code == "KeyA") this.left = true;
            else if (event.code == "KeyS") this.down = true;
            else if (event.code == "KeyD") this.right = true;

            this.updateMoveDirections();
        });
        document.addEventListener("keyup", (event) => {
            if (event.code == "KeyW") this.up = false;
            else if (event.code == "KeyA") this.left = false;
            else if (event.code == "KeyS") this.down = false;
            else if (event.code == "KeyD") this.right = false;

            this.updateMoveDirections();
        });

        window.addEventListener("blur", () => {
            this.moveDirectionX = 0;
            this.moveDirectionY = 0;
        });

        this.canvas.addEventListener('pointermove', (event: PointerEvent) => {
            const bounds = this.canvas.getBoundingClientRect();
            
            const rawX = event.clientX - bounds.left;
            const rawY = event.clientY - bounds.top;

            const scaleX = this.canvas.width / bounds.width;
            const scaleY = this.canvas.height / bounds.height;

            this.mouseX = rawX * scaleX;
            this.mouseY = rawY * scaleY;
        });

        window.addEventListener('wheel', (event) => {
            event.preventDefault();

            if (event.deltaY > 0) {
                this.zoom *= (1 - ZOOM_SPEED);
            } else {
                this.zoom *= (1 + ZOOM_SPEED);
            }

            this.zoom = Math.min(Math.max(ZOOM_MIN, this.zoom), ZOOM_MAX);
        }, { passive: false });
    }

    updateMoveDirections() {
        this.moveDirectionX = 0;
        this.moveDirectionY = 0;
        if (this.up) this.moveDirectionY -= 1;
        if (this.left) this.moveDirectionX -= 1;
        if (this.down) this.moveDirectionY += 1;
        if (this.right) this.moveDirectionX += 1;
    }
}