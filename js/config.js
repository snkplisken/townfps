// --- START OF FILE config.js ---

export const ASSETS = {
    // Your GLB file must contain meshes named "Route_Enemy1", "Route_NPC1", etc.
    // created by converting Curves to Meshes in Blender.
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
    
    // Physics Dimensions
    PLAYER_HEIGHT: 1.6,
    CROUCH_HEIGHT: 0.8, 
    PLAYER_RADIUS: 0.5,
    
    // Match these counts to the number of paths you created in Blender
    // e.g. If you made Route_Enemy1 through Route_Enemy5, set this to 5.
    ENEMY_COUNT: 5, 
    NPC_COUNT: 5,
    PLAYER_MAX_HEALTH: 100
};