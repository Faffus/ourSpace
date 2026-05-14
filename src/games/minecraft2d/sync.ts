import { MiningState, PrivatePlayerState, PublicPlayerState, ServerPlayerState, ToolTier } from "./types";

const copyMiningState = (mining: MiningState): MiningState => {
	if (!mining) return null;
	return {
		target: { ...mining.target },
		elapsedSeconds: mining.elapsedSeconds
	};
};

export const toPublicPlayerState = (p: ServerPlayerState): PublicPlayerState => ({
	id: p.id, name: p.name, skin: p.skin,
	x: p.x, y: p.y, vx: p.vx, vy: p.vy,
	facing: p.facing, hp: p.hp, maxHp: p.maxHp, dead: p.dead,
	mining: copyMiningState(p.mining)
});

export const toPrivatePlayerState = (p: ServerPlayerState): PrivatePlayerState => ({
	id: p.id,
	inventory: { ...p.inventory },
	pickaxeTier: resolveBestToolTier(p.inventory),
	weaponTier:  resolveBestWeaponTier(p.inventory),
	selectedPlaceable: p.selectedPlaceable
});

export const resolveBestToolTier = (inv: ServerPlayerState["inventory"]): ToolTier => {
	if (inv.pickaxe_iron  > 0) return "iron";
	if (inv.pickaxe_stone > 0) return "stone";
	if (inv.pickaxe_wood  > 0) return "wood";
	return "hand";
};

export const resolveBestWeaponTier = (inv: ServerPlayerState["inventory"]): ToolTier => {
	if (inv.sword_iron  > 0) return "iron";
	if (inv.sword_stone > 0) return "stone";
	return "hand";
};
