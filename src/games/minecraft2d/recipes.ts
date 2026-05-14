export type Recipe = {
	id: string;
	key: string;
	label: string;
	requires: Record<string, number>;
	gives?: Record<string, number>;
};

export const MC2D_RECIPES: Recipe[] = [
	{ id: "craft_pickaxe_wood",   key: "1", label: "Wood Pickaxe",   requires: { wood: 3 },                gives: { pickaxe_wood: 1  } },
	{ id: "craft_sword_stone",    key: "2", label: "Stone Sword",    requires: { wood: 1, stone: 3 },      gives: { sword_stone: 1   } },
	{ id: "craft_sword_iron",     key: "3", label: "Iron Sword",     requires: { wood: 1, iron: 3 },       gives: { sword_iron: 1    } },
	{ id: "upgrade_pickaxe_stone",key: "4", label: "Stone Pickaxe",  requires: { wood: 2, stone: 4 },      gives: { pickaxe_stone: 1 } },
	{ id: "upgrade_pickaxe_iron", key: "5", label: "Iron Pickaxe",   requires: { wood: 2, iron: 4 },       gives: { pickaxe_iron: 1  } },
];

export const MC2D_RECIPE_BY_ID  = Object.fromEntries(MC2D_RECIPES.map(r => [r.id,  r])) as Record<string, Recipe>;
export const MC2D_RECIPE_BY_KEY = Object.fromEntries(MC2D_RECIPES.map(r => [r.key, r])) as Record<string, Recipe>;
