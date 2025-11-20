// --- START OF FILE config.js ---

export const ASSETS = {
    world: 'assets/bus_stop.glb', 
    worldScale: 1.0,

    enemies: [], 
    enemyScale: 1.0,

    npcs: [],    
    npcScale: 1.0,

    weapon: null, 
    weaponScale: 1.0,
    hands: null,  
    handsScale: 1.0
};

export const SETTINGS = {
    GRAVITY: 20.0,
    WALK_SPEED: 8.0,
    CROUCH_SPEED: 4.0,
    JUMP_FORCE: 10.0,
    PLAYER_HEIGHT: 1.6,
    CROUCH_HEIGHT: 0.8, // <--- ADDED THIS (Prevents NaN errors)
    PLAYER_RADIUS: 0.5,
    
    // -- NEW SETTINGS --
    ENEMY_COUNT: 10,
    NPC_COUNT: 10,
    PLAYER_MAX_HEALTH: 100
};