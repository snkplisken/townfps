// --- START OF FILE game.js ---

import * as THREE from 'three';
import { PointerLockControls } from 'three/addons/controls/PointerLockControls.js';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { ASSETS, SETTINGS } from './config.js';

// -- Global Variables --
let camera, scene, renderer, controls, gltfLoader;
let isAggro = false;
let isPaused = true;
let isGameOver = false;
let playerHealth = SETTINGS.PLAYER_MAX_HEALTH;

// -- Route & Debug Systems --
const parsedRoutes = {}; // Stores "Route_Enemy1": [{x,z}, {x,z}...]
let isDebugMode = false;
const debugGroup = new THREE.Group(); // Container for debug lines

// -- Assets & Entities --
const loadedModels = { world: null, enemies: [], npcs: [], weapon: null, hands: null };
const mixers = [];
const worldColliders = [];
let mobs = []; 
let bullets = [];
let particles = [];

// -- Player Rig --
let weaponGroup = null;
let isRecoil = false;
const weaponOffset = new THREE.Vector3(0.4, -0.5, -0.5); 
const recoilPos = new THREE.Vector3(0.4, -0.4, -0.4);

// -- Physics State --
let moveForward = false, moveBackward = false, moveLeft = false, moveRight = false;
let canJump = false, isCrouching = false;
const velocity = new THREE.Vector3();
let prevTime = performance.now();

// -- Raycasters --
const downRay = new THREE.Raycaster();
const wallRay = new THREE.Raycaster(); 
const bulletRay = new THREE.Raycaster();

// Optimization
wallRay.far = 5; 
downRay.far = 20; 

init();

function init() {
    // 1. Setup Scene
    scene = new THREE.Scene();
    scene.background = new THREE.Color(0x87CEEB); 
    scene.fog = new THREE.Fog(0x87CEEB, 10, 80); 

    // 2. Camera
    camera = new THREE.PerspectiveCamera(75, window.innerWidth / window.innerHeight, 0.1, 1000);
    camera.position.y = 10; 

    // 3. Renderer
    renderer = new THREE.WebGLRenderer({ 
        antialias: true, 
        powerPreference: "high-performance", 
        logarithmicDepthBuffer: true 
    });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2)); 
    renderer.setSize(window.innerWidth, window.innerHeight);
    renderer.outputColorSpace = THREE.SRGBColorSpace; 
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = THREE.PCFSoftShadowMap; 
    document.body.appendChild(renderer.domElement);

    // 4. Controls & Loader
    controls = new PointerLockControls(camera, document.body);
    gltfLoader = new GLTFLoader();

    // 5. Lighting
    const light = new THREE.HemisphereLight(0xffffff, 0x444444, 1.0);
    scene.add(light);
    
    const dirLight = new THREE.DirectionalLight(0xffffff, 1.2);
    dirLight.position.set(50, 80, 50);
    dirLight.castShadow = true;
    dirLight.shadow.mapSize.width = 2048; 
    dirLight.shadow.mapSize.height = 2048;
    dirLight.shadow.bias = -0.0005;      
    dirLight.shadow.normalBias = 0.05;   
    
    const d = 80; 
    dirLight.shadow.camera.left = -d; dirLight.shadow.camera.right = d;
    dirLight.shadow.camera.top = d; dirLight.shadow.camera.bottom = -d;
    scene.add(dirLight);

    setupInputs();

    // 6. Load & Start
    loadAllAssets(() => {
        setupWorld();
        createPlayerRig();
        startLevel();
        
        // Hide loading screen
        const loadText = document.getElementById('loading-text');
        const instr = document.getElementById('instructions');
        if(loadText) loadText.style.display = 'none';
        if(instr) instr.style.display = 'block';
        
        animate();
    });
}

function startLevel() {
    mobs.forEach(m => scene.remove(m));
    mobs = [];
    
    spawnCategory(SETTINGS.ENEMY_COUNT, true);
    spawnCategory(SETTINGS.NPC_COUNT, false);

    playerHealth = SETTINGS.PLAYER_MAX_HEALTH;
    updateHealthUI();
    isGameOver = false;
    isAggro = false;
    
    const statusEl = document.getElementById('status');
    if(statusEl) {
        statusEl.innerText = "STATUS: HIDDEN";
        statusEl.style.color = "white";
    }
}

// --- ASSET LOADING ---
function loadAllAssets(onComplete) {
    const totalItems = (ASSETS.world ? 1 : 0) + ASSETS.enemies.length + ASSETS.npcs.length + (ASSETS.weapon ? 1 : 0) + (ASSETS.hands ? 1 : 0);
    if (totalItems === 0) { onComplete(); return; }

    const manager = new THREE.LoadingManager();
    manager.onLoad = () => { console.log('✅ Assets Loaded'); onComplete(); };
    setTimeout(() => { if(manager.isLoading) onComplete(); }, 8000); 

    const loader = new GLTFLoader(manager);
    const load = (path, destArray, isSingle, name) => {
        if(!path) return;
        loader.load(path, (gltf) => {
            const model = gltf.scene;
            model.traverse(c => { 
                if(c.isMesh) { 
                    c.castShadow = true; 
                    c.receiveShadow = true; 
                    if(c.material.map) c.material.map.anisotropy = renderer.capabilities.getMaxAnisotropy();
                } 
            });
            if(gltf.animations.length > 0) model.userData.rawClips = gltf.animations;
            
            if(isSingle) {
                if(name === 'world') loadedModels.world = model;
                if(name === 'weapon') loadedModels.weapon = model;
                if(name === 'hands') loadedModels.hands = model;
            } else {
                destArray.push(model);
            }
        });
    };

    if(ASSETS.world) load(ASSETS.world, null, true, "world");
    ASSETS.enemies.forEach(p => load(p, loadedModels.enemies, false, "Enemy"));
    ASSETS.npcs.forEach(p => load(p, loadedModels.npcs, false, "NPC"));
    if(ASSETS.weapon) load(ASSETS.weapon, null, true, "weapon");
    if(ASSETS.hands) load(ASSETS.hands, null, true, "hands");
}

function setupMixer(mesh, rawClips) {
    if (!rawClips || rawClips.length === 0) return null;
    const mixer = new THREE.AnimationMixer(mesh);
    mesh.userData.actions = {}; 
    rawClips.forEach(clip => {
        const action = mixer.clipAction(clip);
        mesh.userData.actions[clip.name] = action;
    });
    mixers.push(mixer);
    return mixer;
}

// --- ROUTE SYSTEM ---
function extractRoutesFromWorld(worldScene) {
    worldScene.traverse((obj) => {
        // Find meshes starting with "Route_"
        if (obj.isMesh && obj.name.startsWith("Route_")) {
            const points = [];
            const posAttribute = obj.geometry.attributes.position;
            
            // Convert mesh vertices to path points
            for (let i = 0; i < posAttribute.count; i++) {
                const localVec = new THREE.Vector3();
                localVec.fromBufferAttribute(posAttribute, i);
                
                // IMPORTANT: Convert to world space
                obj.localToWorld(localVec);
                
                points.push({ x: localVec.x, z: localVec.z });
            }

            parsedRoutes[obj.name] = points;
            console.log(`✅ Path Loaded: ${obj.name} (${points.length} pts)`);

            // Hide mesh and mark it so it's not a wall
            obj.visible = false; 
            obj.userData.isRoute = true;
        }
    });
}

function toggleDebugMode() {
    isDebugMode = !isDebugMode;
    
    if (isDebugMode) {
        scene.add(debugGroup);
        debugGroup.clear();
        console.log("🐞 DEBUG MODE: ON");

        // Draw lines for every route
        for (const [name, points] of Object.entries(parsedRoutes)) {
            if (!points || points.length === 0) continue;

            const positions = [];
            points.forEach(pt => {
                // Draw at height 5 so we can see them above ground
                positions.push(pt.x, 5.0, pt.z);
            });

            const geometry = new THREE.BufferGeometry();
            geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));

            // Red for Enemies, Green for NPCs
            const isEnemyRoute = name.toLowerCase().includes('enemy');
            const color = isEnemyRoute ? 0xff0000 : 0x00ff00;

            const material = new THREE.LineBasicMaterial({ color: color, linewidth: 2 });
            const line = new THREE.Line(geometry, material);
            debugGroup.add(line);
        }
    } else {
        scene.remove(debugGroup);
        console.log("🐞 DEBUG MODE: OFF");
    }
}

function setupWorld() {
    if (loadedModels.world) {
        const world = loadedModels.world;
        world.scale.setScalar(ASSETS.worldScale);
        scene.add(world);
        
        // 1. Extract Routes
        extractRoutesFromWorld(world);

        // 2. Setup Colliders (Ignore routes)
        world.traverse((child) => {
            if (child.isMesh && !child.userData.isRoute) {
                worldColliders.push(child);
                child.material.side = THREE.DoubleSide; 
            }
        });
    } else {
        const floor = new THREE.Mesh(new THREE.PlaneGeometry(600, 600), new THREE.MeshStandardMaterial({ color: 0x2e2e2e }));
        floor.rotation.x = -Math.PI / 2;
        scene.add(floor);
        worldColliders.push(floor);
    }
}

function spawnCategory(count, isEnemy) {
    const boxGeo = new THREE.BoxGeometry(1, 2, 1);
    boxGeo.translate(0, 1, 0);

    for(let i=0; i<count; i++) {
        let x = 0, y = 0, z = 0;
        let assignedRoute = null;
        
        // DYNAMIC NAME MATCHING
        // Enemy #1 looks for "Route_Enemy1"
        const indexSuffix = i + 1; 
        const targetRouteName = isEnemy ? `Route_Enemy${indexSuffix}` : `Route_NPC${indexSuffix}`;

        if (parsedRoutes[targetRouteName]) {
            assignedRoute = parsedRoutes[targetRouteName];
            
            // Spawn at start of path
            x = assignedRoute[0].x;
            z = assignedRoute[0].z;
            
            // Snap to floor
            const spawnRayStart = new THREE.Vector3(x, 50, z);
            downRay.set(spawnRayStart, new THREE.Vector3(0, -1, 0));
            const hits = downRay.intersectObjects(worldColliders, true);
            if(hits.length > 0) y = hits[0].point.y;
            
            console.log(`Mob ${i} assigned to ${targetRouteName}`);
        } 
        else {
            // Random spawn if no route found
            let attempts = 0;
            let validSpot = false;
            while(!validSpot && attempts < 50) {
                x = (Math.random() - 0.5) * 80; 
                z = (Math.random() - 0.5) * 80;
                downRay.set(new THREE.Vector3(x, 50, z), new THREE.Vector3(0, -1, 0));
                const hits = downRay.intersectObjects(worldColliders, true);
                if(hits.length > 0) { y = hits[0].point.y; validSpot = true; }
                attempts++;
            }
        }

        // Create Mesh
        let mob;
        let scale = 1;
        const modelList = isEnemy ? loadedModels.enemies : loadedModels.npcs;
        
        if (modelList.length > 0) {
            mob = modelList[Math.floor(Math.random() * modelList.length)].clone();
            scale = isEnemy ? ASSETS.enemyScale : ASSETS.npcScale;
            if(modelList[0].userData.rawClips) setupMixer(mob, modelList[0].userData.rawClips);
        } else {
            const color = isEnemy ? 0xff0000 : 0x00ff00;
            mob = new THREE.Mesh(boxGeo, new THREE.MeshStandardMaterial({ color: color }));
            mob.castShadow = true;
        }

        mob.scale.setScalar(scale);
        mob.position.set(x, y || 0, z);
        
        mob.userData = { 
            type: isEnemy ? 'enemy' : 'npc', 
            velocity: new THREE.Vector3(), 
            changeTime: 0, 
            shootTimer: Math.random() * 2, 
            currentAnim: '',
            
            // Path Logic
            route: assignedRoute,
            waypointIndex: 0,
            waitTime: 0
        };
        
        scene.add(mob);
        mobs.push(mob);
    }
}

// --- PLAYER & PHYSICS ---
function createPlayerRig() {
    weaponGroup = new THREE.Group();
    if (loadedModels.hands) {
        const hands = loadedModels.hands.clone();
        hands.scale.setScalar(ASSETS.handsScale);
        weaponGroup.add(hands);
        if(loadedModels.hands.userData.rawClips) {
            setupMixer(hands, loadedModels.hands.userData.rawClips);
            playAnimationFuzzy(hands, 'idle');
        }
    } else {
        const armGeo = new THREE.BoxGeometry(0.15, 0.15, 0.8);
        const armMat = new THREE.MeshStandardMaterial({ color: 0xffdbac });
        const arm = new THREE.Mesh(armGeo, armMat);
        arm.position.set(0.2, -0.2, 0.4);
        weaponGroup.add(arm);
    }

    if (loadedModels.weapon) {
        const gun = loadedModels.weapon.clone();
        gun.scale.setScalar(ASSETS.weaponScale);
        weaponGroup.add(gun);
    } else {
        const gunMat = new THREE.MeshStandardMaterial({ color: 0x333333 });
        const gunBody = new THREE.Mesh(new THREE.BoxGeometry(0.1, 0.15, 0.6), gunMat);
        gunBody.position.set(0.2, 0.05, -0.2);
        weaponGroup.add(gunBody);
    }
    weaponGroup.position.copy(weaponOffset);
    camera.add(weaponGroup);
}

function updatePlayerPhysics(delta) {
    if(isGameOver) return;

    velocity.y -= SETTINGS.GRAVITY * delta;
    const speed = isCrouching ? SETTINGS.CROUCH_SPEED : SETTINGS.WALK_SPEED;
    const targetHeight = isCrouching ? SETTINGS.CROUCH_HEIGHT : SETTINGS.PLAYER_HEIGHT;

    const forward = new THREE.Vector3();
    camera.getWorldDirection(forward);
    forward.y = 0; forward.normalize();
    const right = new THREE.Vector3();
    right.crossVectors(forward, new THREE.Vector3(0, 1, 0)).normalize();

    velocity.x = 0; velocity.z = 0;
    if (moveForward) { velocity.x += forward.x * speed; velocity.z += forward.z * speed; }
    if (moveBackward) { velocity.x -= forward.x * speed; velocity.z -= forward.z * speed; }
    if (moveRight) { velocity.x += right.x * speed; velocity.z += right.z * speed; }
    if (moveLeft) { velocity.x -= right.x * speed; velocity.z -= right.z * speed; }

    const intendedX = velocity.x * delta;
    const intendedZ = velocity.z * delta;

    if (Math.abs(intendedX) > 0.0001) {
        const dirX = new THREE.Vector3(Math.sign(intendedX), 0, 0);
        if (!checkWallCollision(dirX, Math.abs(intendedX))) camera.position.x += intendedX;
    }
    if (Math.abs(intendedZ) > 0.0001) {
        const dirZ = new THREE.Vector3(0, 0, Math.sign(intendedZ));
        if (!checkWallCollision(dirZ, Math.abs(intendedZ))) camera.position.z += intendedZ;
    }

    // Raycast Origin Correction for Crouching
    const rayOrigin = camera.position.clone();
    const RAY_BUFFER = 2.0; 
    rayOrigin.y += RAY_BUFFER; 
    
    downRay.set(rayOrigin, new THREE.Vector3(0, -1, 0));
    const hits = downRay.intersectObjects(worldColliders, true);

    if (hits.length > 0) {
        const realDistance = hits[0].distance - RAY_BUFFER;
        const groundY = hits[0].point.y;
        if (realDistance < targetHeight + 0.5 && velocity.y <= 0) {
            camera.position.y = groundY + targetHeight;
            velocity.y = 0;
            canJump = true;
        } else {
            camera.position.y += velocity.y * delta;
        }
    } else {
        camera.position.y += velocity.y * delta;
    }
    
    if (camera.position.y < -50) { 
        velocity.y = 0; camera.position.set(0, 10, 0); takeDamage(20); 
    }
}

function checkWallCollision(direction, distance) {
    const origin = camera.position.clone();
    origin.y -= 1.0;
    wallRay.set(origin, direction);
    const hits = wallRay.intersectObjects(worldColliders, true);
    if (hits.length > 0 && hits[0].distance < SETTINGS.PLAYER_RADIUS + distance) return true;
    return false;
}

// --- GAME LOGIC ---
function updateMobs(delta) {
    if(isGameOver) return;
    
    mobs.forEach(mob => {
        const isEnemy = mob.userData.type === 'enemy';
        let isMoving = false;
        let moveSpeed = 3.5;

        const distToPlayer = mob.position.distanceTo(camera.position);
        if(distToPlayer > 80) return; 

        // 1. COMBAT AI (Priority)
        if (isEnemy && isAggro) {
             const lookDir = new THREE.Vector3().subVectors(camera.position, mob.position).normalize();
             lookDir.y = 0; 
             mob.lookAt(camera.position.x, mob.position.y, camera.position.z);

             if (distToPlayer > 3) {
                 mob.position.add(lookDir.multiplyScalar(4.0 * delta));
                 isMoving = true;
                 moveSpeed = 4.0;
             }

             mob.userData.shootTimer -= delta;
             if (mob.userData.shootTimer <= 0) {
                 shootBullet(mob, false);
                 if(mob.userData.actions) playOneShotAnimation(mob, 'shoot');
                 mob.userData.shootTimer = 1.0 + Math.random() * 2;
             }
        } 
        // 2. PATH FOLLOWING AI (Mesh Vertices)
        else if (mob.userData.route && mob.userData.route.length > 0) {
            const route = mob.userData.route;
            const idx = mob.userData.waypointIndex;
            const targetPoint = route[idx];
            
            // Horizontal distance check
            const dx = targetPoint.x - mob.position.x;
            const dz = targetPoint.z - mob.position.z;
            const distToWaypoint = Math.sqrt(dx*dx + dz*dz);

            // Small threshold for mesh vertices
            if (distToWaypoint < 0.5) {
                mob.userData.waypointIndex = (idx + 1) % route.length; 
            } else {
                const moveDir = new THREE.Vector3(dx, 0, dz).normalize();
                mob.position.add(moveDir.multiplyScalar(moveSpeed * delta));
                
                const lookTarget = new THREE.Vector3(targetPoint.x, mob.position.y, targetPoint.z);
                mob.lookAt(lookTarget);
                isMoving = true;
            }
        }
        // 3. IDLE WANDER (Fallback)
        else {
            mob.userData.changeTime -= delta;
            if(mob.userData.changeTime <= 0) {
                mob.userData.velocity.set((Math.random()-0.5)*3, 0, (Math.random()-0.5)*3);
                mob.userData.changeTime = 2 + Math.random() * 3;
            }
            const moveVec = mob.userData.velocity.clone().multiplyScalar(delta);
            mob.position.add(moveVec);
            
            const target = mob.position.clone().add(mob.userData.velocity);
            mob.lookAt(target.x, mob.position.y, target.z);
            isMoving = true;
        }
        
        // Gravity / Ground Snap
        const rayOrigin = mob.position.clone();
        rayOrigin.y += 1.0;
        downRay.set(rayOrigin, new THREE.Vector3(0, -1, 0));
        const hits = downRay.intersectObjects(worldColliders, true);
        if(hits.length > 0) mob.position.y = hits[0].point.y; 
        else mob.position.y -= 9.8 * delta; 

        // Animations
        if(mob.userData.actions) {
            if(isMoving) {
                if(isEnemy && isAggro) playAnimationFuzzy(mob, 'Run') || playAnimationFuzzy(mob, 'Walk');
                else playAnimationFuzzy(mob, 'Walk');
            } else playAnimationFuzzy(mob, 'Idle');
        }
    });
}

function updateBullets(delta) {
    for (let i = bullets.length - 1; i >= 0; i--) {
        const b = bullets[i];
        const oldPos = b.position.clone();
        b.position.add(b.userData.velocity.clone().multiplyScalar(delta));
        b.userData.life -= delta;

        const dist = b.position.distanceTo(oldPos);
        const dir = b.position.clone().sub(oldPos).normalize();
        bulletRay.set(oldPos, dir);
        bulletRay.far = dist; 

        const targets = [...worldColliders, ...mobs];
        const intersects = bulletRay.intersectObjects(targets, true);
        
        let hitPlayer = false;
        if(!b.userData.isPlayerBullet && b.position.distanceTo(camera.position) < 1.0) hitPlayer = true;

        if (hitPlayer) {
            takeDamage(10); 
            scene.remove(b); bullets.splice(i, 1);
            continue;
        }

        if (intersects.length > 0) {
            let hitObj = intersects[0].object;
            while(hitObj.parent && hitObj.parent !== scene) {
                if(mobs.includes(hitObj.parent)) { hitObj = hitObj.parent; break; }
                hitObj = hitObj.parent;
            }
            const isMob = mobs.includes(hitObj);

            if (b.userData.isPlayerBullet) {
                if (isMob) {
                    triggerAggro();
                    createExplosion(hitObj.position, 0xff0000);
                    scene.remove(hitObj);
                    mobs.splice(mobs.indexOf(hitObj), 1);
                } else createExplosion(intersects[0].point, 0xffffaa);
            } else createExplosion(intersects[0].point, 0x555555);
            
            scene.remove(b); bullets.splice(i, 1);
        } else if (b.userData.life <= 0) {
            scene.remove(b); bullets.splice(i, 1);
        }
    }
}

function shootBullet(sourceObj, isPlayer) {
    if(isPlayer && !weaponGroup) return;

    const bulletGeo = new THREE.SphereGeometry(0.08, 8, 8);
    const color = isPlayer ? 0xffff00 : 0xff0000;
    const bullet = new THREE.Mesh(bulletGeo, new THREE.MeshBasicMaterial({ color: color }));

    if(isPlayer) {
        const startPos = new THREE.Vector3(0, 0, -1); 
        startPos.applyMatrix4(weaponGroup.matrixWorld);
        bullet.position.copy(startPos);
    } else {
        bullet.position.copy(sourceObj.position);
        bullet.position.y += 1.2; 
    }
    
    const shootDir = new THREE.Vector3();
    if(isPlayer) camera.getWorldDirection(shootDir); 
    else shootDir.subVectors(camera.position, sourceObj.position).normalize();
    
    bullet.userData = { velocity: shootDir.multiplyScalar(isPlayer ? 100 : 30), life: 3.0, isPlayerBullet: isPlayer };
    scene.add(bullet);
    bullets.push(bullet);
}

function takeDamage(amount) {
    if(isGameOver) return;
    playerHealth -= amount;
    if(playerHealth < 0) playerHealth = 0;
    updateHealthUI();
    
    const overlay = document.getElementById('hit-overlay');
    if(overlay) {
        overlay.style.opacity = 0.8;
        setTimeout(() => { overlay.style.opacity = 0; }, 200);
    }
    if(playerHealth <= 0) triggerGameOver();
}

function updateHealthUI() {
    const percent = (playerHealth / SETTINGS.PLAYER_MAX_HEALTH) * 100;
    const bar = document.getElementById('health-bar');
    const text = document.getElementById('health-text');
    if(bar && text) {
        bar.style.width = percent + '%';
        text.innerText = Math.ceil(playerHealth) + '%';
        bar.style.backgroundColor = percent < 30 ? '#ff0000' : '#00ff00';
    }
}

function triggerGameOver() {
    isGameOver = true;
    controls.unlock(); 
    const instr = document.getElementById('instructions');
    const go = document.getElementById('game-over');
    const blocker = document.getElementById('blocker');
    if(instr) instr.style.display = 'none';
    if(go) go.style.display = 'block';
    if(blocker) blocker.style.display = 'flex';
}

function triggerAggro() {
    if(!isAggro) {
        isAggro = true;
        const statusEl = document.getElementById('status');
        if(statusEl) {
            statusEl.innerText = "STATUS: UNDER ATTACK!";
            statusEl.style.color = "red";
        }
    }
}

function animate() {
    requestAnimationFrame(animate);
    if (isPaused) return; 
    
    const time = performance.now();
    const delta = (time - prevTime) / 1000;
    prevTime = time;

    mixers.forEach(m => m.update(delta));
    updatePlayerPhysics(delta);

    if (weaponGroup) {
        if (isRecoil) {
            weaponGroup.position.lerp(recoilPos, 20 * delta);
            weaponGroup.rotation.x = THREE.MathUtils.lerp(weaponGroup.rotation.x, 0.2, 20 * delta);
            if (weaponGroup.position.distanceTo(recoilPos) < 0.01) isRecoil = false;
        } else {
            weaponGroup.position.lerp(weaponOffset, 10 * delta);
            weaponGroup.rotation.x = THREE.MathUtils.lerp(weaponGroup.rotation.x, 0, 10 * delta);
        }
    }

    updateMobs(delta);
    updateBullets(delta);
    for (let i = particles.length - 1; i >= 0; i--) {
        const p = particles[i];
        p.userData.life -= delta;
        p.position.add(p.userData.velocity.clone().multiplyScalar(delta));
        if (p.userData.life <= 0) { scene.remove(p); particles.splice(i, 1); }
    }

    renderer.render(scene, camera);
}

function onMouseClick(event) {
    if(isPaused) {
        if(isGameOver) startLevel();
        return;
    }
    if(event.button !== 0) return;
    isRecoil = true;
    shootBullet(camera, true);
    if(loadedModels.hands && weaponGroup && weaponGroup.children[0]) {
        playOneShotAnimation(weaponGroup.children[0], 'shoot');
        playOneShotAnimation(weaponGroup.children[0], 'fire');
    }
}

function createExplosion(pos, color) {
    const geo = new THREE.BoxGeometry(0.2, 0.2, 0.2);
    const mat = new THREE.MeshBasicMaterial({ color: color });
    for (let i = 0; i < 6; i++) {
        const mesh = new THREE.Mesh(geo, mat);
        mesh.position.copy(pos);
        mesh.userData.velocity = new THREE.Vector3((Math.random()-0.5)*5, (Math.random()-0.5)*5, (Math.random()-0.5)*5);
        mesh.userData.life = 0.5;
        scene.add(mesh);
        particles.push(mesh);
    }
}

function playAnimationFuzzy(obj, keyword) {
    if (!obj.userData.actions) return;
    if(obj.userData.currentAnim && obj.userData.currentAnim.toLowerCase().includes(keyword.toLowerCase())) return;
    for (const [name, action] of Object.entries(obj.userData.actions)) {
        if (name.toLowerCase().includes(keyword.toLowerCase())) {
            for(const a of Object.values(obj.userData.actions)) a.stop();
            action.reset().play();
            obj.userData.currentAnim = name;
            return true;
        }
    }
    return false;
}

function playOneShotAnimation(obj, keyword) {
    if (!obj.userData.actions) return;
    for (const [name, action] of Object.entries(obj.userData.actions)) {
        if (name.toLowerCase().includes(keyword.toLowerCase())) {
            action.reset();
            action.setLoop(THREE.LoopOnce);
            action.clampWhenFinished = true;
            action.play();
            return;
        }
    }
}

function setupInputs() {
    const blocker = document.getElementById('blocker');
    blocker.addEventListener('click', () => {
        if(isGameOver) startLevel();
        controls.lock();
    });
    controls.addEventListener('lock', () => { 
        blocker.style.display = 'none'; 
        isPaused = false; 
        prevTime = performance.now(); 
    });
    controls.addEventListener('unlock', () => { 
        blocker.style.display = 'flex'; 
        isPaused = true; 
        const instr = document.getElementById('instructions');
        const go = document.getElementById('game-over');
        if(isGameOver) {
            if(instr) instr.style.display = 'none';
            if(go) go.style.display = 'block';
        } else {
            if(instr) {
                instr.innerHTML = "PAUSED";
                instr.style.display = 'block';
            }
            if(go) go.style.display = 'none';
        }
    });
    document.addEventListener('mousedown', onMouseClick);
    document.addEventListener('keydown', (e) => {
        switch (e.code) {
            case 'KeyW': moveForward = true; break;
            case 'KeyA': moveLeft = true; break;
            case 'KeyS': moveBackward = true; break;
            case 'KeyD': moveRight = true; break;
            case 'Space': if (canJump) { velocity.y += SETTINGS.JUMP_FORCE; canJump = false; } break;
            case 'Tab': e.preventDefault(); isCrouching = true; break;
            
            // --- DEBUG MODE ---
            case 'KeyP': toggleDebugMode(); break;
        }
    });
    document.addEventListener('keyup', (e) => {
        switch (e.code) {
            case 'KeyW': moveForward = false; break;
            case 'KeyA': moveLeft = false; break;
            case 'KeyS': moveBackward = false; break;
            case 'KeyD': moveRight = false; break;
            case 'Tab': isCrouching = false; break;
        }
    });
    window.addEventListener('resize', () => {
        camera.aspect = window.innerWidth / window.innerHeight;
        camera.updateProjectionMatrix();
        renderer.setSize(window.innerWidth, window.innerHeight);
    });
}