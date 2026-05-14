import { GameClient } from "../game";
import { Player } from "../../common";
import { Button } from "../../client/ui-elements";
import {
	MC2D_CHUNK_SIZE,
	MC2D_MATCH_DURATION_SECONDS,
	MC2D_MINING_HARDNESS,
	MC2D_MINING_REACH,
	MC2D_WORLD_MAX_X,
	MC2D_WORLD_MAX_Y,
	MC2D_WORLD_MIN_X,
	MC2D_WORLD_MIN_Y,
	MC2D_TOOL_SPEED,
	MC2D_TILE_SIZE_PX
} from "./constants";
import { MC2D_RECIPE_BY_ID, MC2D_RECIPES } from "./recipes";
import { chunkCoordFromTile, chunkKey, distSq, lerp, localTileIndex, sameTile } from "./utils";
import {
	BlockType, ClientPlayerState, Chunk, GameDelta, GameMessage,
	GameSnapshot, LobbyPlayer, PlaceableBlock, PrivatePlayerState,
	PublicPlayerState, TilePos
} from "./types";
import { UserInput } from "../../client/user-input";

const HOTBAR_SLOTS = [
	{ key: "dirt",        label: "Dirt",    tint: "#9b6a3f" },
	{ key: "stone",       label: "Stone",   tint: "#8b96a3" },
	{ key: "trunk",       label: "Trunk",   tint: "#7d4e2e" },
	{ key: "wood",        label: "Wood",    tint: "#a4703f" },
	{ key: "iron",        label: "Iron",    tint: "#c07c4c" },
	{ key: "pickaxe_wood",label: "Pickaxe", tint: "#e2e8f0" }
] as const;

const BLOCK_LABELS: Record<string, string> = {
	air: "Air", grass: "Grass", dirt: "Dirt", trunk: "Trunk",
	stone: "Stone", iron_ore: "Iron Ore", diamond: "Diamond"
};

const BLOCK_COLORS: Record<string, string> = {
	grass:    "#6cab4f",
	dirt:     "#7d5a3a",
	trunk:    "#8a5b36",
	stone:    "#8c96a0",
	iron_ore: "#b77f50",
	diamond:  "#2bc4d1"
};

const MATERIAL_NAMES: Record<string, string> = {
	wood: "Wood", stone: "Stone", trunk: "Trunk",
	iron: "Iron", dirt: "Dirt", diamond: "Diamond"
};

const CRAFT_HOTKEYS: Record<string, string> = {
	Digit1: "craft_pickaxe_wood",
	Digit2: "craft_sword_stone",
	Digit3: "craft_sword_iron",
	Digit4: "upgrade_pickaxe_stone",
	Digit5: "upgrade_pickaxe_iron"
};

const PLACEABLE_HOTKEYS: Record<string, PlaceableBlock> = {
	KeyZ: "dirt",
	KeyX: "stone",
	KeyC: "trunk"
};

const blockColor          = (block: string): string    => BLOCK_COLORS[block]   ?? "#111827";
const formatMaterialName  = (mat: string): string      => MATERIAL_NAMES[mat]   ?? mat;
const clamp               = (value: number, min: number, max: number): number => Math.max(min, Math.min(max, value));

class ClientMessageQueue {
	private queue: any[] = [];

	enqueue(msg: any): void           { this.queue.push(msg); }
	enqueueMany(msgs: any[]): void    { for (const m of msgs) this.queue.push(m); }

	flush(): any[] {
		const out  = this.queue;
		this.queue = [];
		return out;
	}
}

class PlayerInterpolator {
	players: Record<string, ClientPlayerState> = {};

	sync(network: Record<string, PublicPlayerState>): void {
		for (const id in network) {
			const np  = network[id];
			const cur = this.players[id];

			if (!cur) {
				this.players[id] = {
					...np,
					mining: np.mining ? { target: { ...np.mining.target }, elapsedSeconds: np.mining.elapsedSeconds } : null,
					targetX: np.x,
					targetY: np.y
				};
				continue;
			}

			cur.name    = np.name;
			cur.skin    = np.skin;
			cur.vx      = np.vx;
			cur.vy      = np.vy;
			cur.facing  = np.facing;
			cur.hp      = np.hp;
			cur.maxHp   = np.maxHp;
			cur.dead    = np.dead;
			cur.mining  = np.mining ? { target: { ...np.mining.target }, elapsedSeconds: np.mining.elapsedSeconds } : null;
			cur.targetX = np.x;
			cur.targetY = np.y;
		}

		for (const id in this.players) {
			if (!network[id]) delete this.players[id];
		}
	}

	step(dt: number, myId: string): void {
		const alpha = Math.min(1, dt * 16);
		for (const id in this.players) {
			const p = this.players[id];
			if (id === myId) {
				p.x = p.targetX;
				p.y = p.targetY;
			} else {
				p.x = lerp(p.x, p.targetX, alpha);
				p.y = lerp(p.y, p.targetY, alpha);
			}
		}
	}

	getPlayers(): Record<string, ClientPlayerState> { return this.players; }
}

class MinecraftInputController {
	jumpHeld              = false;
	leftMouseDown         = false;
	rightClickRequested   = false;
	exitRequested         = false;
	lastMiningTarget:  TilePos | null = null;
	pointerTile:       TilePos | null = null;
	oneShotMessages:   any[]          = [];

	private readonly onKeyDown:     (e: KeyboardEvent) => void;
	private readonly onKeyUp:       (e: KeyboardEvent) => void;
	private readonly onPointerDown: (e: PointerEvent)  => void;
	private readonly onPointerUp:   (e: PointerEvent)  => void;
	private readonly onContextMenu: (e: MouseEvent)    => void;

	constructor(private readonly userInput: UserInput) {
		this.onKeyDown = (e) => {
			if (e.code === "Space") this.jumpHeld = true;
			if (e.repeat) return;
			if (e.code === "KeyF") { this.oneShotMessages.push({ kind: "attack" }); return; }

			const recipeId = CRAFT_HOTKEYS[e.code];
			if (recipeId) { this.oneShotMessages.push({ kind: "craft", recipeId }); return; }

			const block = PLACEABLE_HOTKEYS[e.code];
			if (block)   { this.oneShotMessages.push({ kind: "select_placeable", block }); }
		};

		this.onKeyUp       = (e) => { if (e.code === "Space") this.jumpHeld = false; };
		this.onPointerDown = (e) => { if (e.button === 0) this.leftMouseDown = true;  if (e.button === 2) this.rightClickRequested = true; };
		this.onPointerUp   = (e) => { if (e.button === 0) this.leftMouseDown = false; };
		this.onContextMenu = (e) => e.preventDefault();

		document.addEventListener("keydown", this.onKeyDown);
		document.addEventListener("keyup",   this.onKeyUp);
		userInput.canvas.addEventListener("pointerdown",   this.onPointerDown);
		userInput.canvas.addEventListener("pointerup",     this.onPointerUp);
		userInput.canvas.addEventListener("contextmenu",   this.onContextMenu);
	}

	screenToTile(camera: { x: number; y: number; zoom: number }): TilePos {
		const scale  = MC2D_TILE_SIZE_PX * camera.zoom;
		const worldX = (this.userInput.mouseX - this.userInput.screenW / 2) / scale + camera.x;
		const worldY = -((this.userInput.mouseY - this.userInput.screenH / 2) / scale) + camera.y;
		return { x: Math.floor(worldX), y: Math.floor(worldY) };
	}

	consumeExitRequested(): boolean {
		if (!this.exitRequested) return false;
		this.exitRequested = false;
		return true;
	}

	getPointerTile(): TilePos | null { return this.pointerTile; }

	dispose(): void {
		document.removeEventListener("keydown", this.onKeyDown);
		document.removeEventListener("keyup",   this.onKeyUp);
		this.userInput.canvas.removeEventListener("pointerdown",   this.onPointerDown);
		this.userInput.canvas.removeEventListener("pointerup",     this.onPointerUp);
		this.userInput.canvas.removeEventListener("contextmenu",   this.onContextMenu);
	}
}

class PixelRenderer {
	private static readonly CHUNK_MASK = MC2D_CHUNK_SIZE - 1;    // 15
	private static readonly CHUNK_SHIFT = 4;                     // log2(16)

	private drawCommonShading(ctx: CanvasRenderingContext2D, x: number, y: number): void {
		ctx.fillStyle = "rgba(255, 255, 255, 0.10)";
		ctx.fillRect(x, y, 1, 0.12);
		ctx.fillStyle = "rgba(0, 0, 0, 0.09)";
		ctx.fillRect(x, y + 0.84, 1, 0.16);
		ctx.fillRect(x + 0.84, y, 0.16, 1);
	}

	private drawGrassTile(ctx: CanvasRenderingContext2D, x: number, y: number): void {
		ctx.fillStyle = "#78bf50";
		ctx.fillRect(x, y, 1, 0.28);
		ctx.fillStyle = "#7b5535";
		ctx.fillRect(x, y + 0.28, 1, 0.72);

		ctx.fillStyle = "rgba(43, 138, 67, 0.42)";
		ctx.fillRect(x + 0.08, y + 0.04, 0.08, 0.17);
		ctx.fillRect(x + 0.34, y + 0.02, 0.07, 0.14);
		ctx.fillRect(x + 0.64, y + 0.05, 0.09, 0.16);
	}

	private drawDirtTile(ctx: CanvasRenderingContext2D, x: number, y: number): void {
		ctx.fillStyle = "#7d5a3a";
		ctx.fillRect(x, y, 1, 1);

		ctx.fillStyle = "rgba(158, 109, 72, 0.30)";
		ctx.fillRect(x + 0.08, y + 0.06, 0.20, 0.12);
		ctx.fillRect(x + 0.54, y + 0.10, 0.20, 0.10);
		ctx.fillRect(x + 0.30, y + 0.18, 0.12, 0.08);

		ctx.fillStyle = "rgba(73, 48, 29, 0.28)";
		ctx.fillRect(x + 0.16, y + 0.56, 0.10, 0.10);
		ctx.fillRect(x + 0.42, y + 0.64, 0.08, 0.08);
		ctx.fillRect(x + 0.68, y + 0.48, 0.08, 0.08);

		ctx.fillStyle = "rgba(121, 84, 52, 0.22)";
		ctx.fillRect(x + 0.22, y + 0.28, 0.10, 0.08);
		ctx.fillRect(x + 0.60, y + 0.30, 0.08, 0.08);
	}

	private drawStoneTile(ctx: CanvasRenderingContext2D, x: number, y: number): void {
		ctx.fillStyle = "#8c96a0";
		ctx.fillRect(x, y, 1, 1);

		ctx.fillStyle = "rgba(255, 255, 255, 0.12)";
		ctx.fillRect(x + 0.08, y + 0.08, 0.20, 0.10);
		ctx.fillRect(x + 0.56, y + 0.10, 0.16, 0.10);
		ctx.fillRect(x + 0.30, y + 0.24, 0.08, 0.06);

		ctx.fillStyle = "rgba(92, 103, 117, 0.34)";
		ctx.fillRect(x + 0.14, y + 0.20, 0.10, 0.08);
		ctx.fillRect(x + 0.36, y + 0.32, 0.08, 0.08);
		ctx.fillRect(x + 0.66, y + 0.22, 0.08, 0.08);
		ctx.fillRect(x + 0.22, y + 0.60, 0.10, 0.08);
		ctx.fillRect(x + 0.54, y + 0.66, 0.10, 0.08);
		ctx.fillRect(x + 0.78, y + 0.44, 0.06, 0.08);
	}

	private drawTrunkTile(ctx: CanvasRenderingContext2D, x: number, y: number): void {
		ctx.fillStyle = "#8a5b36";
		ctx.fillRect(x, y, 1, 1);

		ctx.fillStyle = "rgba(101, 62, 34, 0.78)";
		ctx.fillRect(x + 0.16, y, 0.06, 1);
		ctx.fillRect(x + 0.46, y, 0.08, 1);
		ctx.fillRect(x + 0.72, y, 0.05, 1);

		ctx.fillStyle = "rgba(171, 121, 75, 0.26)";
		ctx.fillRect(x + 0.08, y + 0.10, 0.12, 0.12);
		ctx.fillRect(x + 0.58, y + 0.58, 0.10, 0.10);
		ctx.fillRect(x + 0.26, y + 0.34, 0.08, 0.08);
	}

	private drawIronTile(ctx: CanvasRenderingContext2D, x: number, y: number): void {
		ctx.fillStyle = "#8d949d";
		ctx.fillRect(x, y, 1, 1);

		ctx.fillStyle = "rgba(255, 255, 255, 0.10)";
		ctx.fillRect(x + 0.07, y + 0.06, 0.22, 0.15);

		ctx.fillStyle = "rgba(186, 128, 82, 0.90)";
		ctx.fillRect(x + 0.12, y + 0.18, 0.10, 0.10);
		ctx.fillRect(x + 0.30, y + 0.30, 0.10, 0.10);
		ctx.fillRect(x + 0.52, y + 0.18, 0.10, 0.10);
		ctx.fillRect(x + 0.64, y + 0.42, 0.09, 0.09);
		ctx.fillRect(x + 0.34, y + 0.66, 0.10, 0.10);

		ctx.fillStyle = "rgba(120, 78, 46, 0.70)";
		ctx.fillRect(x + 0.22, y + 0.24, 0.04, 0.04);
		ctx.fillRect(x + 0.56, y + 0.24, 0.04, 0.04);
	}

	private drawDiamondTile(ctx: CanvasRenderingContext2D, x: number, y: number): void {
		ctx.fillStyle = "#2bc4d1";
		ctx.fillRect(x, y, 1, 1);

		ctx.fillStyle = "rgba(255, 255, 255, 0.18)";
		ctx.fillRect(x + 0.08, y + 0.08, 0.22, 0.20);
		ctx.fillRect(x + 0.42, y + 0.26, 0.18, 0.18);

		ctx.fillStyle = "rgba(8, 120, 132, 0.36)";
		ctx.fillRect(x + 0.54, y + 0.56, 0.26, 0.22);
		ctx.fillRect(x + 0.16, y + 0.58, 0.14, 0.14);

		ctx.fillStyle = "rgba(255, 255, 255, 0.34)";
		ctx.fillRect(x + 0.66, y + 0.14, 0.08, 0.08);
	}

	private drawTileTexture(ctx: CanvasRenderingContext2D, block: string, x: number, y: number): void {
		switch (block) {
			case "grass":
				this.drawGrassTile(ctx, x, y);
				break;
			case "dirt":
				this.drawDirtTile(ctx, x, y);
				break;
			case "stone":
				this.drawStoneTile(ctx, x, y);
				break;
			case "trunk":
				this.drawTrunkTile(ctx, x, y);
				break;
			case "iron_ore":
				this.drawIronTile(ctx, x, y);
				break;
			case "diamond":
				this.drawDiamondTile(ctx, x, y);
				break;
			default:
				ctx.fillStyle = blockColor(block);
				ctx.fillRect(x, y, 1, 1);
		}

		this.drawCommonShading(ctx, x, y);
	}

	drawWorld(
		ctx:                     CanvasRenderingContext2D,
		screenW:                 number,
		screenH:                 number,
		chunks:                  Record<string, Chunk>,
		players:                 Record<string, ClientPlayerState>,
		camera:                  { x: number; y: number; zoom: number },
		myId:                    string,
		miningTarget:            TilePos | null,
		miningTargetReachable:   boolean,
		diamondPos:              TilePos | null
	): void {
		this.drawBackground(ctx, screenW, screenH);

		ctx.save();
		ctx.translate(screenW / 2, screenH / 2);
		ctx.scale(camera.zoom * MC2D_TILE_SIZE_PX, -camera.zoom * MC2D_TILE_SIZE_PX);
		ctx.translate(-camera.x, -camera.y);

		this.drawTiles(ctx, chunks);
		this.drawPlayers(ctx, players, myId);
		this.drawMiningTarget(ctx, miningTarget, miningTargetReachable);
		this.drawDiamondPing(ctx, diamondPos);

		ctx.restore();
	}

	drawBackground(ctx: CanvasRenderingContext2D, w: number, h: number): void {
		const sky = ctx.createLinearGradient(0, 0, 0, h);
		sky.addColorStop(0,    "#77bde0");
		sky.addColorStop(0.52, "#4d8db3");
		sky.addColorStop(1,    "#16202b");
		ctx.fillStyle = sky;
		ctx.fillRect(0, 0, w, h);
	}

	drawTiles(ctx: CanvasRenderingContext2D, chunks: Record<string, Chunk>): void {
		const MASK  = PixelRenderer.CHUNK_MASK;
		const SHIFT = PixelRenderer.CHUNK_SHIFT;
		const SIZE  = MC2D_CHUNK_SIZE;

		for (const key in chunks) {
			const chunk = chunks[key];
			const tiles = chunk.tiles;
			const baseX = chunk.chunkX * SIZE;
			const baseY = chunk.chunkY * SIZE;

			for (let i = 0; i < tiles.length; i++) {
				const block = tiles[i];
				if (block === "air") continue;

				const tileX = baseX + (i  & MASK);
				const tileY = baseY + (i >> SHIFT);

				this.drawTileTexture(ctx, block, tileX, tileY);
			}
		}
	}

	drawPlayers(ctx: CanvasRenderingContext2D, players: Record<string, ClientPlayerState>, myId: string): void {
		const BODY_W = 0.68, BODY_H = 1.8;

		for (const id in players) {
			const p = players[id];
			ctx.globalAlpha = p.dead ? 0.4 : 1;

			ctx.fillStyle = p.skin;
			ctx.fillRect(p.x - BODY_W / 2, p.y - BODY_H / 2, BODY_W, BODY_H);

			ctx.fillStyle = "rgba(18, 18, 18, 0.55)";
			ctx.fillRect(p.x - 0.5, p.y + 1.02, 1, 0.18);

			ctx.fillStyle = "#22c55e";
			ctx.fillRect(p.x - 0.5, p.y + 1.02, Math.max(0, Math.min(1, p.hp / p.maxHp)), 0.18);
		}

		ctx.globalAlpha = 1;
	}

	drawMiningTarget(ctx: CanvasRenderingContext2D, target: TilePos | null, reachable: boolean): void {
		if (!target) return;
		ctx.lineWidth   = 2 / (MC2D_TILE_SIZE_PX * 0.6);
		ctx.strokeStyle = reachable ? "#f8fafc" : "#ef4444";
		ctx.strokeRect(target.x, target.y, 1, 1);
	}

	drawDiamondPing(ctx: CanvasRenderingContext2D, pos: TilePos | null): void {
		if (!pos) return;
		ctx.fillStyle = "rgba(41, 184, 197, 0.45)";
		ctx.fillRect(pos.x, pos.y, 1, 1);
	}
}

export class MinecraftDiamondRushClient extends GameClient {
	networkQueue:  ClientMessageQueue;
	controller:    MinecraftInputController;
	interpolator:  PlayerInterpolator;
	renderer:      PixelRenderer;
	chunks:        Record<string, Chunk>;
	lobbyPlayers:  Record<string, LobbyPlayer>;
	privateState:  PrivatePlayerState | null;
	summary:       GameSnapshot["summary"] | GameDelta["summary"] | null;
	matchEndsAtMs: number;
	diamondPos:    TilePos | null;
	camera:        { x: number; y: number; zoom: number };
	wantsExit:     boolean;
	disposed:      boolean;
	exitButton:    Button;

	pointerReachable = false;
	pointerBlock: string | null = null;

	constructor(userInput: UserInput, myId: string) {
		super(userInput, myId);
		this.networkQueue  = new ClientMessageQueue();
		this.controller    = new MinecraftInputController(userInput);
		this.interpolator  = new PlayerInterpolator();
		this.renderer      = new PixelRenderer();
		this.chunks        = {};
		this.lobbyPlayers  = {};
		this.privateState  = null;
		this.summary       = null;
		this.matchEndsAtMs = Date.now() + MC2D_MATCH_DURATION_SECONDS * 1000;
		this.diamondPos    = null;
		this.camera        = { x: 0, y: 0, zoom: 1 };
		this.wantsExit     = false;
		this.disposed      = false;
		this.exitButton    = new Button("Torna alla lobby", this.userInput, () => { this.wantsExit = true; });
		this.exitButton.setColors({ main: "#2563eb" });
	}

	private getUiScale(): number {
		const shortestSide = Math.min(this.userInput.screenW, this.userInput.screenH);
		return Math.max(0.85, Math.min(1.35, shortestSide / 900));
	}

	private clampCameraToWorld(): void {
		const scale = this.camera.zoom * MC2D_TILE_SIZE_PX;
		const halfViewW = this.userInput.screenW / (2 * scale);
		const halfViewH = this.userInput.screenH / (2 * scale);
		const worldMinX = MC2D_WORLD_MIN_X;
		const worldMaxX = MC2D_WORLD_MAX_X + 1;
		const worldMinY = MC2D_WORLD_MIN_Y;
		const worldMaxY = MC2D_WORLD_MAX_Y + 1;
		const minCameraX = worldMinX + halfViewW;
		const maxCameraX = worldMaxX - halfViewW;
		const minCameraY = worldMinY + halfViewH;
		const maxCameraY = worldMaxY - halfViewH;

		this.camera.x = minCameraX <= maxCameraX ? clamp(this.camera.x, minCameraX, maxCameraX) : (worldMinX + worldMaxX) / 2;
		this.camera.y = minCameraY <= maxCameraY ? clamp(this.camera.y, minCameraY, maxCameraY) : (worldMinY + worldMaxY) / 2;
	}

	init(players: Record<string, Player>): Promise<void> {
		Object.assign(this.lobbyPlayers, players);
		return Promise.resolve()
	}

	draw(ctx: CanvasRenderingContext2D, dt: number): void {
		if (!this.privateState) { this.drawWaitingScreen(ctx); return; }

		const players = this.interpolator.getPlayers();
		const me      = players[this.myId];

		if (!this.summary) {
			this.networkQueue.enqueueMany(this.collectInputMessages());
			this.interpolator.step(dt, this.myId);

			if (me) {
				const t      = Math.min(1, dt * 14);
				this.camera.x += (me.x - this.camera.x) * t;
				this.camera.y += (me.y - this.camera.y) * t;
			}

			this.clampCameraToWorld();

			this.updatePointerState(me);
			this.networkQueue.enqueueMany(this.collectPointerMessages());
		}

		this.renderer.drawWorld(
			ctx, this.userInput.screenW, this.userInput.screenH,
			this.chunks, players, this.camera,
			this.myId, this.controller.getPointerTile(), this.pointerReachable, this.diamondPos
		);

		this.drawPlayerLabels(ctx, players);
		this.drawTopInfo(ctx, me);
		this.drawRecipeSidebar(ctx);
		this.drawHotbar(ctx);
		this.drawPickaxeSlot(ctx);
		this.drawHoverBlockInfo(ctx, me);

		if (this.summary) this.drawSummaryOverlay(ctx);
	}

	handleMessage(message: GameMessage): void {
		if (message.kind === "snapshot") this.applySnapshot(message);
		else                             this.applyDelta(message);
	}

	flushMessages(): any[]    { return this.networkQueue.flush(); }
	isFinished():    boolean  { return this.wantsExit; }

	collectInputMessages(): any[] {
		const msgs: any[] = [{
			kind:  "input",
			left:  this.userInput.moveDirectionX < -0.1,
			right: this.userInput.moveDirectionX >  0.1,
			jump:  this.controller.jumpHeld || this.userInput.moveDirectionY < -0.1
		}];

		if (this.controller.oneShotMessages.length) {
			for (const m of this.controller.oneShotMessages) msgs.push(m);
			this.controller.oneShotMessages = [];
		}

		return msgs;
	}

	collectPointerMessages(): any[] {
		const msgs:    any[]       = [];
		const pointer: TilePos | null = this.controller.pointerTile;

		if (this.controller.leftMouseDown && pointer && this.pointerReachable) {
			if (!this.controller.lastMiningTarget || !sameTile(this.controller.lastMiningTarget, pointer)) {
				msgs.push({ kind: "mine_start", target: { ...pointer } });
				this.controller.lastMiningTarget = { ...pointer };
			}
		} else if (this.controller.lastMiningTarget) {
			msgs.push({ kind: "mine_stop" });
			this.controller.lastMiningTarget = null;
		}

		if (this.controller.rightClickRequested && pointer && this.privateState) {
			msgs.push({ kind: "place_block", target: { ...pointer }, block: this.privateState.selectedPlaceable });
		}

		this.controller.rightClickRequested = false;
		return msgs;
	}

	updatePointerState(me: ClientPlayerState | undefined): void {
		const pt = this.controller.screenToTile(this.camera);
		this.controller.pointerTile = pt;
		this.pointerBlock           = pt ? this.getBlockAt(pt) : null;

		if (me && pt) {
			const cx = pt.x + 0.5, cy = pt.y + 0.5;
			this.pointerReachable = (me.x - cx) * (me.x - cx) + (me.y - cy) * (me.y - cy)
				<= MC2D_MINING_REACH * MC2D_MINING_REACH;
		} else {
			this.pointerReachable = false;
		}
	}

	canCraftRecipe(recipeId: string): boolean {
		if (!this.privateState) return false;
		const recipe = MC2D_RECIPE_BY_ID[recipeId];
		if (!recipe) return false;
		const inv = this.privateState.inventory;
		for (const mat in recipe.requires) {
			if ((inv[mat as keyof typeof inv] as number) < recipe.requires[mat]) return false;
		}
		return true;
	}

	applySnapshot(snapshot: GameSnapshot): void {
		this.matchEndsAtMs = snapshot.matchEndsAtMs;
		this.summary       = snapshot.summary;
		this.privateState  = snapshot.self;
		if (snapshot.diamondPos) this.diamondPos = { ...snapshot.diamondPos };

		this.interpolator.sync(snapshot.players);

		for (const key in this.chunks) delete this.chunks[key];
		for (const chunk of snapshot.chunks) {
			this.chunks[chunkKey(chunk.chunkX, chunk.chunkY)] = {
				chunkX: chunk.chunkX,
				chunkY: chunk.chunkY,
				tiles:  [...chunk.tiles]
			};
		}
	}

	applyDelta(delta: GameDelta): void {
		this.matchEndsAtMs = delta.matchEndsAtMs;
		this.summary       = delta.summary;
		if (delta.diamondPos) this.diamondPos = { ...delta.diamondPos };
		if (delta.self)       this.privateState = delta.self;

		this.interpolator.sync(delta.players);
		for (const update of delta.blockUpdates) this.applyBlockUpdate(update);
	}

	applyBlockUpdate(update: { pos: TilePos; block: BlockType }): void {
		const coords = chunkCoordFromTile(update.pos.x, update.pos.y);
		const key    = chunkKey(coords.chunkX, coords.chunkY);

		if (!this.chunks[key]) {
			this.chunks[key] = {
				chunkX: coords.chunkX,
				chunkY: coords.chunkY,
				tiles:  new Array(MC2D_CHUNK_SIZE * MC2D_CHUNK_SIZE).fill("air")
			};
		}

		this.chunks[key].tiles[localTileIndex(update.pos.x, update.pos.y)] = update.block;
	}

	getBlockAt(tile: TilePos): string | null {
		const coords = chunkCoordFromTile(tile.x, tile.y);
		const chunk  = this.chunks[chunkKey(coords.chunkX, coords.chunkY)];
		return chunk ? (chunk.tiles[localTileIndex(tile.x, tile.y)] ?? null) : null;
	}

	screenToTile(screenX: number, screenY: number): TilePos {
		const scale  = MC2D_TILE_SIZE_PX * this.camera.zoom;
		const worldX = (screenX - this.userInput.screenW / 2) / scale + this.camera.x;
		const worldY = -((screenY - this.userInput.screenH / 2) / scale) + this.camera.y;
		return { x: Math.floor(worldX), y: Math.floor(worldY) };
	}

	worldToScreen(worldX: number, worldY: number): { x: number; y: number } {
		const scale = this.camera.zoom * MC2D_TILE_SIZE_PX;
		return {
			x: this.userInput.screenW / 2 + (worldX - this.camera.x) * scale,
			y: this.userInput.screenH / 2 - (worldY - this.camera.y) * scale
		};
	}

	drawPlayerLabels(ctx: CanvasRenderingContext2D, players: Record<string, ClientPlayerState>): void {
		const uiScale = this.getUiScale();
		ctx.font          = `${Math.round(14 * uiScale)}px monospace`;
		ctx.textAlign     = "center";
		ctx.textBaseline  = "middle";

		for (const id in players) {
			const p      = players[id];
			const screen = this.worldToScreen(p.x, p.y + 1.45);

			ctx.fillStyle = "rgba(0, 0, 0, 0.68)";
			ctx.fillRect(screen.x - 54 * uiScale, screen.y - 16 * uiScale, 108 * uiScale, 16 * uiScale);

			ctx.fillStyle = "#f8fafc";
			ctx.fillText(p.name, screen.x, screen.y - 8 * uiScale);

			ctx.fillStyle = "#ffffff";
			ctx.fillText(`${Math.ceil(p.hp)} HP`, screen.x, screen.y - 24 * uiScale);
		}
	}

	drawTopInfo(ctx: CanvasRenderingContext2D, me: ClientPlayerState | undefined): void {
		const uiScale = this.getUiScale();
		const secondsLeft = Math.max(0, (this.matchEndsAtMs - Date.now()) / 1000);
		const W           = this.userInput.screenW;
		const pad         = 12 * uiScale;
		const topY        = 10 * uiScale;
		const topH        = 52 * uiScale;
			const topW        = Math.max(0, W - pad * 2);

		ctx.fillStyle     = "rgba(0, 0, 0, 0.62)";
			ctx.fillRect(pad, topY, topW, topH);

		ctx.fillStyle     = "#f8fafc";
		ctx.font          = `${Math.round(16 * uiScale)}px monospace`;
		ctx.textAlign     = "left";
		ctx.textBaseline  = "middle";

		const name   = me?.name ?? this.lobbyPlayers[this.myId]?.name ?? "Player";
		const hp     = me ? Math.ceil(me.hp) : 0;
		const depth  = me ? Math.max(0, Math.floor(-me.y)) : 0;
		const tool   = this.privateState?.pickaxeTier ?? "hand";
		const weapon = this.privateState?.weaponTier  ?? "hand";

		ctx.fillText(
			`${name} | Time ${Math.ceil(secondsLeft)}s | HP ${hp} | Depth ${depth} | Tool ${tool} | Weapon ${weapon}`,
			24 * uiScale, topY + topH / 2
		);
	}

	drawRecipeSidebar(ctx: CanvasRenderingContext2D): void {
		const uiScale = this.getUiScale();
		const margin = Math.round(12 * uiScale);
		const basePanelW = 280;
		const basePanelH = 250 + MC2D_RECIPES.length * 50;
		const maxPanelW = Math.max(0, this.userInput.screenW - margin * 2);
		const maxPanelH = Math.max(0, this.userInput.screenH - Math.round(72 * uiScale) - margin);
		const panelScale = Math.min(uiScale, maxPanelW / basePanelW, maxPanelH / basePanelH);
		if (panelScale <= 0) return;

		const panelW = Math.round(basePanelW * panelScale);
		const panelH = Math.round(basePanelH * panelScale);
		const panelX = Math.max(margin, this.userInput.screenW - panelW - margin);
		const panelY = Math.round(72 * panelScale);

		ctx.fillStyle   = "rgba(3, 7, 18, 0.72)";
		ctx.fillRect(panelX, panelY, panelW, panelH);
		ctx.strokeStyle = "rgba(248, 250, 252, 0.18)";
		ctx.lineWidth   = Math.max(1, Math.round(2 * panelScale));
		ctx.strokeRect(panelX, panelY, panelW, panelH);

		ctx.fillStyle    = "#f8fafc";
		ctx.font         = `bold ${Math.round(15 * panelScale)}px monospace`;
		ctx.textAlign    = "left";
		ctx.textBaseline = "top";
		ctx.fillText("Objective: mine diamond", panelX + 12 * panelScale, panelY + 10 * panelScale);
		ctx.font = `bold ${Math.round(16 * panelScale)}px monospace`;
		ctx.fillText("Recipes", panelX + 12 * panelScale, panelY + 38 * panelScale);

		let cursorY = panelY + 64 * panelScale;
		for (const recipe of MC2D_RECIPES) {
			const craftable = this.canCraftRecipe(recipe.id);
			const materials = Object.entries(recipe.requires)
				.map(([mat, amt]) => `${formatMaterialName(mat)} x${amt}`)
				.join("  ");

			ctx.fillStyle = craftable ? "rgba(34, 197, 94, 0.14)" : "rgba(255, 255, 255, 0.06)";
			ctx.fillRect(panelX + 8 * panelScale, cursorY - 2 * panelScale, panelW - 16 * panelScale, 44 * panelScale);

			ctx.fillStyle = craftable ? "#86efac" : "#f8fafc";
			ctx.font      = `bold ${Math.round(13 * panelScale)}px monospace`;
			ctx.fillText(`${recipe.key}. ${recipe.label}`, panelX + 12 * panelScale, cursorY);

			ctx.font      = `${Math.round(12 * panelScale)}px monospace`;
			ctx.fillStyle = "#cbd5e1";
			ctx.fillText(materials, panelX + 12 * panelScale, cursorY + 16 * panelScale);

			cursorY += 50 * panelScale;
		}

		cursorY += 8 * panelScale;
		ctx.fillStyle = "#f8fafc";
		ctx.font      = `bold ${Math.round(15 * panelScale)}px monospace`;
		ctx.fillText("Base controls", panelX + 12 * panelScale, cursorY);

		ctx.font      = `${Math.round(12 * panelScale)}px monospace`;
		ctx.fillStyle = "#cbd5e1";
		const controls = [
			"A/D move", "W or Space jump", "Mouse aim",
			"left click mine", "right click place",
			"F attack", "Z/X/C select block", "1-5 craft"
		];
		for (let i = 0; i < controls.length; i++) {
			ctx.fillText(controls[i], panelX + 12 * panelScale, cursorY + 20 * panelScale + i * 16 * panelScale);
		}
	}

	drawHotbar(ctx: CanvasRenderingContext2D): void {
		if (!this.privateState) return;
		const uiScale = this.getUiScale();
		const margin = Math.round(12 * uiScale);
		let slotSize = Math.max(18, Math.round(58 * uiScale));
		let spacing = Math.max(2, Math.round(8 * uiScale));
		const availableW = Math.max(0, this.userInput.screenW - margin * 2);
		let totalW = HOTBAR_SLOTS.length * slotSize + (HOTBAR_SLOTS.length - 1) * spacing;
		if (availableW > 0 && totalW > availableW) {
			const fit = availableW / totalW;
			slotSize = Math.max(18, Math.floor(slotSize * fit));
			spacing = Math.max(2, Math.floor(spacing * fit));
			totalW = HOTBAR_SLOTS.length * slotSize + (HOTBAR_SLOTS.length - 1) * spacing;
		}
		const startX   = Math.max(margin, (this.userInput.screenW - totalW) / 2);
		const y        = Math.max(margin, this.userInput.screenH - slotSize - margin);
		const hotbarScale = slotSize / 58;

		for (let idx = 0; idx < HOTBAR_SLOTS.length; idx++) {
			const slot     = HOTBAR_SLOTS[idx];
			const x        = startX + idx * (slotSize + spacing);
			const quantity = this.privateState!.inventory[slot.key as keyof typeof this.privateState.inventory] as number;
			const selected = slot.key === this.privateState!.selectedPlaceable;

			ctx.fillStyle   = "rgba(15, 23, 42, 0.84)";
			ctx.fillRect(x, y, slotSize, slotSize);

			ctx.strokeStyle = selected ? "#facc15" : "rgba(248, 250, 252, 0.35)";
			ctx.lineWidth   = selected ? Math.max(2, Math.round(3 * hotbarScale)) : Math.max(1, Math.round(2 * hotbarScale));
			ctx.strokeRect(x, y, slotSize, slotSize);

			ctx.fillStyle  = slot.tint;
			ctx.fillRect(x + 8 * hotbarScale, y + 8 * hotbarScale, Math.max(0, slotSize - 16 * hotbarScale), 20 * hotbarScale);

			ctx.fillStyle    = "#f8fafc";
			ctx.font         = `bold ${Math.max(8, Math.round(10 * hotbarScale))}px monospace`;
			ctx.textAlign    = "center";
			ctx.textBaseline = "middle";
			ctx.fillText(slot.label, x + slotSize / 2, y + 20 * hotbarScale);

			ctx.textAlign    = "right";
			ctx.textBaseline = "bottom";
			ctx.font         = `${Math.max(9, Math.round(15 * hotbarScale))}px monospace`;
			ctx.fillText(`${quantity}`, x + slotSize - 7 * hotbarScale, y + slotSize - 7 * hotbarScale);
		}
	}

	drawPickaxeSlot(ctx: CanvasRenderingContext2D): void {
		if (!this.privateState) return;
		const uiScale = this.getUiScale();
		const margin = Math.round(12 * uiScale);
		let slotSize = Math.max(18, Math.round(64 * uiScale));
		let gap = Math.max(2, Math.round(10 * uiScale));
		const availableW = Math.max(0, this.userInput.screenW - margin * 2);
		let totalW = slotSize * 2 + gap;
		if (availableW > 0 && totalW > availableW) {
			const fit = availableW / totalW;
			slotSize = Math.max(18, Math.floor(slotSize * fit));
			gap = Math.max(2, Math.floor(gap * fit));
			totalW = slotSize * 2 + gap;
		}
		const x = Math.max(margin, this.userInput.screenW - margin - totalW);
		const y = Math.max(margin, this.userInput.screenH - slotSize - margin);
		this.drawGearSlot(ctx, x,                 y, slotSize, "Pickaxe", this.privateState.pickaxeTier, "#e2e8f0");
		this.drawGearSlot(ctx, x + slotSize + gap, y, slotSize, "Sword",   this.privateState.weaponTier,  "#fcd34d");
	}

	drawHoverBlockInfo(ctx: CanvasRenderingContext2D, me: ClientPlayerState | undefined): void {
		if (!this.controller.pointerTile) return;
		const uiScale = this.getUiScale();
		const label       = this.pointerBlock ? (BLOCK_LABELS[this.pointerBlock] ?? this.pointerBlock) : "Unknown";
		const reachText   = this.pointerReachable ? "in reach" : "out of reach";
		const margin      = Math.round(12 * uiScale);
		const basePanelH  = this.getMiningProgress(me) !== null ? 60 : 44;
		const maxPanelW   = Math.max(0, this.userInput.screenW - margin * 2);
		const maxPanelH   = Math.max(0, this.userInput.screenH - margin * 2);
		const panelScale  = Math.min(uiScale, maxPanelW / 210, maxPanelH / basePanelH);
		if (panelScale <= 0) return;
		const panelW      = Math.round(210 * panelScale);
		const panelH      = Math.round(basePanelH * panelScale);
		const panelX      = clamp(this.userInput.mouseX + 14 * panelScale, margin, Math.max(margin, this.userInput.screenW - panelW - margin));
		const panelY      = clamp(this.userInput.mouseY - 32 * panelScale, margin, Math.max(margin, this.userInput.screenH - panelH - margin));

		ctx.fillStyle = this.pointerReachable ? "rgba(15, 23, 42, 0.88)" : "rgba(127, 29, 29, 0.86)";
		const miningProgress = this.getMiningProgress(me);
		ctx.fillRect(panelX, panelY, panelW, panelH);

		ctx.fillStyle    = "#f8fafc";
		ctx.font         = `${Math.round(14 * panelScale)}px monospace`;
		ctx.textAlign    = "left";
		ctx.textBaseline = "top";
		ctx.fillText(label, panelX + 8 * panelScale, panelY + 4 * panelScale);
		ctx.fillText(reachText, panelX + 8 * panelScale, panelY + 20 * panelScale);

		if (!this.pointerReachable && me) {
			const dist = Math.sqrt(distSq(me, { x: this.controller.pointerTile.x + 0.5, y: this.controller.pointerTile.y + 0.5 }));
			ctx.fillText(`dist ${dist.toFixed(2)}`, panelX + 118 * panelScale, panelY + 20 * panelScale);
		}

		if (miningProgress !== null) {
			const barX = panelX + 8 * panelScale;
			const barY = panelY + 40 * panelScale;
			const barW = panelW - 16 * panelScale;
			ctx.fillStyle = "rgba(255, 255, 255, 0.12)";
			ctx.fillRect(barX, barY, barW, 6 * panelScale);
			ctx.fillStyle = "#22c55e";
			ctx.fillRect(barX, barY, barW * miningProgress, 6 * panelScale);
			ctx.strokeStyle = "rgba(255, 255, 255, 0.22)";
			ctx.lineWidth = Math.max(1, Math.round(panelScale));
			ctx.strokeRect(barX + 0.5, barY + 0.5, barW - 1, 5 * panelScale);
		}
	}

	getMiningProgress(me: ClientPlayerState | undefined): number | null {
		if (!me || !me.mining || !this.controller.pointerTile || !sameTile(me.mining.target, this.controller.pointerTile) || !this.privateState) return null;
		if (!this.pointerBlock || this.pointerBlock === "air") return null;

		const hardness = MC2D_MINING_HARDNESS[this.pointerBlock as keyof typeof MC2D_MINING_HARDNESS] ?? 1;
		const speed    = MC2D_TOOL_SPEED[this.privateState.pickaxeTier] ?? 1;
		const required  = Math.max(0.15, hardness / speed);
		return Math.max(0, Math.min(1, me.mining.elapsedSeconds / required));
	}

	drawSummaryOverlay(ctx: CanvasRenderingContext2D): void {
		if (!this.summary) return;
		const { screenW: W, screenH: H } = this.userInput;
		const uiScale = this.getUiScale();
		const me = this.interpolator.getPlayers()[this.myId];
		const winnerName = this.summary.winnerId
			? (this.interpolator.getPlayers()[this.summary.winnerId]?.name || this.lobbyPlayers[this.summary.winnerId]?.name || "Unknown")
			: null;
		const won = this.summary.winnerId === this.myId;
		const title = this.summary.winnerId === null
			? "Pareggio"
			: won
				? "Hai vinto"
				: "Hai perso";
		const reasonText = this.summary.reason === "diamond_found"
			? (won
				? "Hai trovato il diamante"
				: winnerName
					? `${winnerName} ha trovato il diamante`
					: "Il diamante e stato trovato")
			: (this.summary.winnerId === null
				? "Tempo scaduto, pareggio"
				: won
					? "Sei rimasto il piu vicino al diamante"
					: winnerName
						? `${winnerName} era piu vicino al diamante`
						: "Un altro giocatore era piu vicino al diamante");

		ctx.fillStyle    = "rgba(0, 0, 0, 0.75)";
		ctx.fillRect(0, 0, W, H);

		ctx.fillStyle    = "#ffffff";
		ctx.font         = `bold ${Math.round(42 * uiScale)}px monospace`;
		ctx.textAlign    = "center";
		ctx.textBaseline = "middle";

		ctx.fillText(title, W / 2, H / 2 - 24 * uiScale);

		ctx.font = `${Math.round(20 * uiScale)}px monospace`;
		ctx.fillText(reasonText, W / 2, H / 2 + 20 * uiScale);
		ctx.fillText(me ? `Giocatore: ${me.name}` : "Match concluso", W / 2, H / 2 + 56 * uiScale);

		const btnW = Math.max(0, Math.min(300 * uiScale, W - 48 * uiScale));
		const btnH = Math.max(0, 52 * uiScale);
		const btnX = clamp(W / 2 - btnW / 2, 24 * uiScale, Math.max(24 * uiScale, W - btnW - 24 * uiScale));
		const btnY = clamp(H / 2 + 92 * uiScale, 24 * uiScale, Math.max(24 * uiScale, H - btnH - 24 * uiScale));
		if (btnW > 0 && btnH > 0) this.exitButton.draw(ctx, btnX, btnY, btnW, btnH);
	}

	drawWaitingScreen(ctx: CanvasRenderingContext2D): void {
		const uiScale = this.getUiScale();
		ctx.fillStyle    = "#0f172a";
		ctx.fillRect(0, 0, this.userInput.screenW, this.userInput.screenH);
		ctx.fillStyle    = "#e2e8f0";
		ctx.font         = `${Math.round(28 * uiScale)}px monospace`;
		ctx.textAlign    = "center";
		ctx.textBaseline = "middle";
		ctx.fillText("Preparing Minecraft Diamond Rush", this.userInput.screenW / 2, this.userInput.screenH / 2);
	}

	drawGearSlot(
		ctx:      CanvasRenderingContext2D,
		x:        number, y: number, slotSize: number,
		title:    string, tier: string, tint: string
	): void {
		ctx.fillStyle   = "rgba(10, 14, 24, 0.88)";
		ctx.fillRect(x, y, slotSize, slotSize);
		ctx.strokeStyle = tint;
		ctx.lineWidth   = 2;
		ctx.strokeRect(x, y, slotSize, slotSize);
		ctx.fillStyle   = tint;
		ctx.fillRect(x + 8, y + 8, slotSize - 16, 18);
		ctx.fillStyle    = "#f8fafc";
		ctx.font         = `bold ${Math.max(9, Math.round(slotSize * 0.19))}px monospace`;
		ctx.textAlign    = "center";
		ctx.textBaseline = "top";
		ctx.fillText(title, x + slotSize / 2, y + 8);
		ctx.font = `bold ${Math.max(10, Math.round(slotSize * 0.2))}px monospace`;
		ctx.fillText(tier === "hand" ? "HAND" : tier.toUpperCase(), x + slotSize / 2, y + 30);
	}

	dispose(): void {
		if (this.disposed) return;
		this.disposed = true;
		this.controller.dispose();
	}
}
