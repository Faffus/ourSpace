import { PrivatePlayerState, PublicPlayerState, ServerPlayerState, ToolTier } from "./types";

export const toPublicPlayerState = (player: ServerPlayerState): PublicPlayerState => {
    return {
        id: player.id,
        name: player.name,
        skin: player.skin,
        x: player.x,
        y: player.y,
        vx: player.vx,
        vy: player.vy,
        facing: player.facing,
        hp: player.hp,
        maxHp: player.maxHp,
        dead: player.dead
    };
};

export const toPrivatePlayerState = (player: ServerPlayerState): PrivatePlayerState => {
    return {
        id: player.id,
        inventory: { ...player.inventory },
        pickaxeTier: resolveBestToolTier(player.inventory),
        weaponTier: resolveBestWeaponTier(player.inventory),
        selectedPlaceable: player.selectedPlaceable
    };
};

export const resolveBestToolTier = (inventory: ServerPlayerState["inventory"]): ToolTier => {
    if (inventory.pickaxe_iron > 0) return "iron";
    if (inventory.pickaxe_stone > 0) return "stone";
    if (inventory.pickaxe_wood > 0) return "wood";
    return "hand";
};

export const resolveBestWeaponTier = (inventory: ServerPlayerState["inventory"]): ToolTier => {
    if (inventory.sword_iron > 0) return "iron";
    if (inventory.sword_stone > 0) return "stone";
    return "hand";
};
