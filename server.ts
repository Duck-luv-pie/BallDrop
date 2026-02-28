import express from 'express';
import { createServer } from 'http';
import { Server } from 'socket.io';
import { createServer as createViteServer } from 'vite';
import Matter from 'matter-js';
import { MapData, RaceState, BallState, Player, Vector2, MapInfo } from './src/types';

const PORT = 3000;

// ─── Peg grid generator ────────────────────────────────────────────────────
function makePegGrid(
  startY: number, endY: number,
  rowSpacing: number, colSpacing: number,
  radius: number
): MapData['pegs'] {
  const pegs: MapData['pegs'] = [];
  let row = 0;
  for (let y = startY; y < endY; y += rowSpacing) {
    const offsetX = (row % 2) * (colSpacing / 2);
    for (let x = 60 + offsetX; x < 745; x += colSpacing) {
      pegs.push({ position: { x, y }, radius });
    }
    row++;
  }
  return pegs;
}

// ─── Map 1: The Gauntlet ───────────────────────────────────────────────────
const map1: MapData = {
  id: 'map1',
  name: 'The Gauntlet',
  worldSize: { x: 800, y: 5000 },
  gravity: { x: 0, y: 1.5 },
  spawnPoints: [{ x: 370, y: 80 }, { x: 400, y: 80 }, { x: 430, y: 80 }],
  staticObstacles: [
    // Side walls
    { type: 'rectangle', position: { x: 0, y: 2500 }, size: { x: 40, y: 5000 }, angle: 0 },
    { type: 'rectangle', position: { x: 800, y: 2500 }, size: { x: 40, y: 5000 }, angle: 0 },
    { type: 'rectangle', position: { x: 400, y: 5020 }, size: { x: 800, y: 40 }, angle: 0 },
    // Spawn funnel
    { type: 'rectangle', position: { x: 120, y: 200 }, size: { x: 340, y: 28 }, angle: 0.72 },
    { type: 'rectangle', position: { x: 680, y: 200 }, size: { x: 340, y: 28 }, angle: -0.72 },
    // Section 1 – spinning bars
    { type: 'rectangle', position: { x: 400, y: 450 }, size: { x: 260, y: 24 }, angle: 0, angularVelocity: 0.04 },
    { type: 'rectangle', position: { x: 190, y: 660 }, size: { x: 180, y: 24 }, angle: 0, angularVelocity: -0.05 },
    { type: 'rectangle', position: { x: 610, y: 660 }, size: { x: 180, y: 24 }, angle: 0, angularVelocity: 0.05 },
    // Section 2 – zigzag ramps
    { type: 'rectangle', position: { x: 220, y: 900 }, size: { x: 380, y: 38 }, angle: 0.30 },
    { type: 'rectangle', position: { x: 580, y: 1100 }, size: { x: 380, y: 38 }, angle: -0.30 },
    { type: 'rectangle', position: { x: 220, y: 1300 }, size: { x: 380, y: 38 }, angle: 0.30 },
    { type: 'rectangle', position: { x: 580, y: 1500 }, size: { x: 380, y: 38 }, angle: -0.30 },
    // Section 3 – spinning circles + ramp pair
    { type: 'circle', position: { x: 200, y: 1700 }, radius: 50, angularVelocity: 0.12 },
    { type: 'circle', position: { x: 600, y: 1800 }, radius: 50, angularVelocity: -0.12 },
    { type: 'circle', position: { x: 400, y: 1900 }, radius: 38, angularVelocity: 0.18 },
    // Section 4 – narrow choke with spinner (slanted so marbles never sit flat)
    { type: 'rectangle', position: { x: 148, y: 2100 }, size: { x: 256, y: 30 }, angle: 0.12 },
    { type: 'rectangle', position: { x: 652, y: 2100 }, size: { x: 256, y: 30 }, angle: -0.12 },
    { type: 'rectangle', position: { x: 400, y: 2100 }, size: { x: 80, y: 20 }, angle: 0, angularVelocity: 0.12 },
    // Section 5 – staircase bounce
    { type: 'rectangle', position: { x: 600, y: 2350 }, size: { x: 330, y: 34 }, angle: -0.18 },
    { type: 'rectangle', position: { x: 200, y: 2550 }, size: { x: 330, y: 34 }, angle: 0.18 },
    { type: 'rectangle', position: { x: 600, y: 2750 }, size: { x: 330, y: 34 }, angle: -0.18 },
    { type: 'rectangle', position: { x: 200, y: 2950 }, size: { x: 330, y: 34 }, angle: 0.18 },
    // Section 6 – big spinner + satellite
    { type: 'rectangle', position: { x: 400, y: 3200 }, size: { x: 380, y: 28 }, angle: 0, angularVelocity: 0.03 },
    { type: 'rectangle', position: { x: 220, y: 3420 }, size: { x: 260, y: 24 }, angle: 0, angularVelocity: -0.045 },
    { type: 'rectangle', position: { x: 580, y: 3420 }, size: { x: 260, y: 24 }, angle: 0, angularVelocity: 0.045 },
    // Section 7 – triple wrecking balls
    { type: 'circle', position: { x: 150, y: 3650 }, radius: 55, angularVelocity: 0.20 },
    { type: 'circle', position: { x: 400, y: 3650 }, radius: 45, angularVelocity: -0.20 },
    { type: 'circle', position: { x: 650, y: 3650 }, radius: 55, angularVelocity: 0.20 },
    // Section 8 – steep zigzag
    { type: 'rectangle', position: { x: 200, y: 3900 }, size: { x: 380, y: 44 }, angle: 0.45 },
    { type: 'rectangle', position: { x: 600, y: 4130 }, size: { x: 380, y: 44 }, angle: -0.45 },
    // Section 9 – final approach spinners
    { type: 'rectangle', position: { x: 400, y: 4370 }, size: { x: 320, y: 26 }, angle: 0, angularVelocity: 0.06 },
    { type: 'circle', position: { x: 200, y: 4570 }, radius: 48, angularVelocity: -0.15 },
    { type: 'circle', position: { x: 600, y: 4570 }, radius: 48, angularVelocity: 0.15 },
    // Pre-finish choke (slanted so marbles roll off rather than sit)
    { type: 'rectangle', position: { x: 120, y: 4760 }, size: { x: 200, y: 28 }, angle: 0.15 },
    { type: 'rectangle', position: { x: 680, y: 4760 }, size: { x: 200, y: 28 }, angle: -0.15 },
    { type: 'rectangle', position: { x: 400, y: 4760 }, size: { x: 64, y: 18 }, angle: 0, angularVelocity: 0.10 },
  ],
  pegs: [],
  bumpers: [],
  checkpoints: [],
  finishZone: { x: 0, y: 4880, width: 800, height: 120 },
  path: [
    { x: 400, y: 0 }, { x: 400, y: 1000 }, { x: 400, y: 2000 },
    { x: 400, y: 3000 }, { x: 400, y: 4000 }, { x: 400, y: 5000 }
  ]
};

// ─── Map 2: Peg Paradise ───────────────────────────────────────────────────
const map2: MapData = {
  id: 'map2',
  name: 'Peg Paradise',
  worldSize: { x: 800, y: 5000 },
  gravity: { x: 0, y: 1.2 },
  spawnPoints: [{ x: 360, y: 80 }, { x: 400, y: 80 }, { x: 440, y: 80 }],
  staticObstacles: [
    // Side walls
    { type: 'rectangle', position: { x: 0, y: 2500 }, size: { x: 40, y: 5000 }, angle: 0 },
    { type: 'rectangle', position: { x: 800, y: 2500 }, size: { x: 40, y: 5000 }, angle: 0 },
    { type: 'rectangle', position: { x: 400, y: 5020 }, size: { x: 800, y: 40 }, angle: 0 },
    // Spawn funnel
    { type: 'rectangle', position: { x: 130, y: 200 }, size: { x: 320, y: 28 }, angle: 0.65 },
    { type: 'rectangle', position: { x: 670, y: 200 }, size: { x: 320, y: 28 }, angle: -0.65 },
    // Deflector platforms – break up the peg field at intervals
    { type: 'rectangle', position: { x: 600, y: 1000 }, size: { x: 200, y: 24 }, angle: -0.2 },
    { type: 'rectangle', position: { x: 200, y: 1000 }, size: { x: 200, y: 24 }, angle: 0.2 },
    { type: 'rectangle', position: { x: 400, y: 1600 }, size: { x: 260, y: 28 }, angle: 0, angularVelocity: 0.02 },
    { type: 'rectangle', position: { x: 600, y: 2200 }, size: { x: 200, y: 24 }, angle: -0.2 },
    { type: 'rectangle', position: { x: 200, y: 2200 }, size: { x: 200, y: 24 }, angle: 0.2 },
    { type: 'rectangle', position: { x: 400, y: 2800 }, size: { x: 260, y: 28 }, angle: 0, angularVelocity: -0.02 },
    { type: 'rectangle', position: { x: 600, y: 3400 }, size: { x: 200, y: 24 }, angle: -0.2 },
    { type: 'rectangle', position: { x: 200, y: 3400 }, size: { x: 200, y: 24 }, angle: 0.2 },
    { type: 'rectangle', position: { x: 400, y: 4000 }, size: { x: 260, y: 28 }, angle: 0, angularVelocity: 0.03 },
    { type: 'rectangle', position: { x: 600, y: 4500 }, size: { x: 200, y: 24 }, angle: -0.15 },
    { type: 'rectangle', position: { x: 200, y: 4500 }, size: { x: 200, y: 24 }, angle: 0.15 },
  ],
  pegs: makePegGrid(350, 4800, 110, 80, 10),
  bumpers: [
    { position: { x: 400, y: 700 }, radius: 28, restitution: 1.8 },
    { position: { x: 200, y: 1300 }, radius: 22, restitution: 1.6 },
    { position: { x: 600, y: 1300 }, radius: 22, restitution: 1.6 },
    { position: { x: 400, y: 1900 }, radius: 28, restitution: 1.8 },
    { position: { x: 150, y: 2500 }, radius: 22, restitution: 1.6 },
    { position: { x: 650, y: 2500 }, radius: 22, restitution: 1.6 },
    { position: { x: 400, y: 3100 }, radius: 28, restitution: 1.8 },
    { position: { x: 200, y: 3700 }, radius: 22, restitution: 1.6 },
    { position: { x: 600, y: 3700 }, radius: 22, restitution: 1.6 },
    { position: { x: 400, y: 4250 }, radius: 28, restitution: 1.8 },
  ],
  checkpoints: [],
  finishZone: { x: 0, y: 4880, width: 800, height: 120 },
  path: [
    { x: 400, y: 0 }, { x: 400, y: 1000 }, { x: 400, y: 2000 },
    { x: 400, y: 3000 }, { x: 400, y: 4000 }, { x: 400, y: 5000 }
  ]
};

// ─── Map 3: Chaos Canyon ───────────────────────────────────────────────────
const map3: MapData = {
  id: 'map3',
  name: 'Chaos Canyon',
  worldSize: { x: 800, y: 5000 },
  gravity: { x: 0, y: 1.8 },
  spawnPoints: [{ x: 370, y: 80 }, { x: 400, y: 80 }, { x: 430, y: 80 }],
  staticObstacles: [
    // Side walls
    { type: 'rectangle', position: { x: 0, y: 2500 }, size: { x: 40, y: 5000 }, angle: 0 },
    { type: 'rectangle', position: { x: 800, y: 2500 }, size: { x: 40, y: 5000 }, angle: 0 },
    { type: 'rectangle', position: { x: 400, y: 5020 }, size: { x: 800, y: 40 }, angle: 0 },
    // Spawn funnel – tight
    { type: 'rectangle', position: { x: 110, y: 200 }, size: { x: 300, y: 28 }, angle: 0.78 },
    { type: 'rectangle', position: { x: 690, y: 200 }, size: { x: 300, y: 28 }, angle: -0.78 },
    // Section 1 – canyon walls (narrow pass, slanted to deflect marbles inward)
    { type: 'rectangle', position: { x: 150, y: 500 }, size: { x: 260, y: 30 }, angle: 0.15 },
    { type: 'rectangle', position: { x: 650, y: 500 }, size: { x: 260, y: 30 }, angle: -0.15 },
    { type: 'rectangle', position: { x: 400, y: 460 }, size: { x: 60, y: 22 }, angle: 0, angularVelocity: 0.14 },
    // Section 2 – wrecking balls + ramps
    { type: 'circle', position: { x: 200, y: 750 }, radius: 60, angularVelocity: 0.18 },
    { type: 'circle', position: { x: 600, y: 750 }, radius: 60, angularVelocity: -0.18 },
    { type: 'rectangle', position: { x: 400, y: 950 }, size: { x: 200, y: 26 }, angle: 0, angularVelocity: 0.06 },
    { type: 'rectangle', position: { x: 200, y: 1150 }, size: { x: 360, y: 38 }, angle: 0.38 },
    { type: 'rectangle', position: { x: 600, y: 1350 }, size: { x: 360, y: 38 }, angle: -0.38 },
    // Section 3 – tight canyon with multi-spinners
    // Plates shortened (170 → right edge at 225) so gap to spinner (left edge 285) is 60px > marble diameter
    { type: 'rectangle', position: { x: 140, y: 1600 }, size: { x: 170, y: 28 }, angle: 0.12 },
    { type: 'rectangle', position: { x: 660, y: 1600 }, size: { x: 170, y: 28 }, angle: -0.12 },
    { type: 'rectangle', position: { x: 320, y: 1600 }, size: { x: 70, y: 20 }, angle: 0, angularVelocity: 0.16 },
    { type: 'rectangle', position: { x: 480, y: 1600 }, size: { x: 70, y: 20 }, angle: 0, angularVelocity: -0.16 },
    // Section 4 – massive spinning cross
    { type: 'rectangle', position: { x: 400, y: 1900 }, size: { x: 400, y: 26 }, angle: 0, angularVelocity: 0.035 },
    { type: 'rectangle', position: { x: 400, y: 1900 }, size: { x: 26, y: 400 }, angle: 0, angularVelocity: 0.035 },
    // Section 5 – three wrecking balls
    { type: 'circle', position: { x: 150, y: 2200 }, radius: 65, angularVelocity: 0.22 },
    { type: 'circle', position: { x: 400, y: 2200 }, radius: 55, angularVelocity: -0.22 },
    { type: 'circle', position: { x: 650, y: 2200 }, radius: 65, angularVelocity: 0.22 },
    // Section 6 – long steep zigzag
    { type: 'rectangle', position: { x: 200, y: 2500 }, size: { x: 420, y: 44 }, angle: 0.48 },
    { type: 'rectangle', position: { x: 600, y: 2780 }, size: { x: 420, y: 44 }, angle: -0.48 },
    { type: 'rectangle', position: { x: 200, y: 3060 }, size: { x: 420, y: 44 }, angle: 0.48 },
    // Section 7 – quad spinners
    { type: 'rectangle', position: { x: 200, y: 3350 }, size: { x: 200, y: 22 }, angle: 0, angularVelocity: -0.07 },
    { type: 'rectangle', position: { x: 600, y: 3350 }, size: { x: 200, y: 22 }, angle: 0, angularVelocity: 0.07 },
    { type: 'rectangle', position: { x: 200, y: 3550 }, size: { x: 200, y: 22 }, angle: 0, angularVelocity: 0.07 },
    { type: 'rectangle', position: { x: 600, y: 3550 }, size: { x: 200, y: 22 }, angle: 0, angularVelocity: -0.07 },
    // Section 8 – wrecking ball finale
    { type: 'circle', position: { x: 400, y: 3800 }, radius: 80, angularVelocity: 0.25 },
    { type: 'circle', position: { x: 170, y: 4020 }, radius: 55, angularVelocity: -0.20 },
    { type: 'circle', position: { x: 630, y: 4020 }, radius: 55, angularVelocity: 0.20 },
    // Section 9 – final sprint maze walls
    { type: 'rectangle', position: { x: 600, y: 4280 }, size: { x: 380, y: 32 }, angle: -0.22 },
    { type: 'rectangle', position: { x: 200, y: 4460 }, size: { x: 380, y: 32 }, angle: 0.22 },
    { type: 'rectangle', position: { x: 400, y: 4640 }, size: { x: 240, y: 26 }, angle: 0, angularVelocity: 0.08 },
    // Pre-finish choke (slanted so marbles roll off rather than sit)
    { type: 'rectangle', position: { x: 120, y: 4790 }, size: { x: 200, y: 26 }, angle: 0.15 },
    { type: 'rectangle', position: { x: 680, y: 4790 }, size: { x: 200, y: 26 }, angle: -0.15 },
  ],
  pegs: [],
  bumpers: [],
  checkpoints: [],
  finishZone: { x: 0, y: 4880, width: 800, height: 120 },
  path: [
    { x: 400, y: 0 }, { x: 400, y: 1000 }, { x: 400, y: 2000 },
    { x: 400, y: 3000 }, { x: 400, y: 4000 }, { x: 400, y: 5000 }
  ]
};

const allMaps: MapData[] = [map1, map2, map3];

const mapInfoList: MapInfo[] = [
  { id: 'map1', name: 'The Gauntlet', description: 'Spinning blades, tight passages, and steep zigzag ramps. A mechanical gauntlet.', difficulty: 3, theme: '#f59e0b' },
  { id: 'map2', name: 'Peg Paradise', description: 'Navigate a sea of pegs and bouncing bumpers. Luck and physics collide.', difficulty: 2, theme: '#06b6d4' },
  { id: 'map3', name: 'Chaos Canyon', description: 'Wrecking balls, razor-tight corridors, and spinning crosses. Maximum chaos.', difficulty: 5, theme: '#ef4444' },
];

async function startServer() {
  const app = express();
  const httpServer = createServer(app);
  const io = new Server(httpServer, {
    cors: { origin: '*' }
  });

  // Physics Engine – tuned for stable marble simulation
  const engine = Matter.Engine.create({
    positionIterations: 10,
    velocityIterations: 8,
    constraintIterations: 4,
  });
  const world = engine.world;

  let players: Map<string, Player> = new Map([
    ['p1', { id: 'p1', name: 'Rigby', spriteUrl: 'https://picsum.photos/seed/rigby/100/100', color: '#ff4444' }],
    ['p2', { id: 'p2', name: 'Obama', spriteUrl: 'https://picsum.photos/seed/obama/100/100', color: '#4444ff' }],
    ['p3', { id: 'p3', name: 'Joe', spriteUrl: 'https://picsum.photos/seed/joe/100/100', color: '#44ff44' }]
  ]);
  let currentMap: MapData = allMaps[0];
  engine.gravity.y = currentMap.gravity.y;

  let raceState: RaceState = {
    status: 'waiting',
    countdown: 0,
    mapId: currentMap.id,
    balls: {}
  };

  let ballBodies: Map<string, Matter.Body> = new Map();
  // Kinematic spinners: non-static bodies whose position is locked each tick
  let spinningBodies: Matter.Body[] = [];
  let spinningBodyOrigins: Map<Matter.Body, { x: number; y: number }> = new Map();
  let spinningBodyTargetAV: Map<Matter.Body, number> = new Map();
  let ballStuckTime: Map<string, number> = new Map();
  let raceEndTimeout: ReturnType<typeof setTimeout> | null = null;

  function finalizeRace() {
    if (raceState.status !== 'racing') return;

    raceState.status = 'finished';
    raceState.countdown = 0;

    const orderedBalls = Object.entries(raceState.balls).sort(([, a], [, b]) => {
      if (a.finished !== b.finished) return a.finished ? -1 : 1;
      if (a.finished && b.finished) return (a.rank || 999) - (b.rank || 999);
      return b.progress - a.progress;
    });

    const results = orderedBalls.map(([id, ball], idx) => ({
      playerId: id,
      name: players.get(id)?.name || 'Unknown',
      rank: ball.rank || idx + 1,
      time: ball.finishTime || 0
    }));

    io.emit('raceUpdate', raceState);
    io.emit('raceEnd', results);
  }

  function setupMap(map: MapData) {
    Matter.World.clear(world, false);
    spinningBodies = [];
    spinningBodyOrigins.clear();
    spinningBodyTargetAV.clear();

    // Static obstacles
    map.staticObstacles.forEach(obs => {
      let body: Matter.Body | undefined;

      if (obs.angularVelocity) {
        // ── Kinematic spinner ──────────────────────────────────────────────
        // Non-static so Matter.js uses its angular velocity in collision impulse
        // (setAngle on a static body gives no kick – that's the old glitch).
        // Very high mass + frictionAir:0 so marbles cannot deflect it.
        // We lock linear position / velocity every tick in update().
        const spinnerOpts = {
          isStatic: false,
          angle: obs.angle || 0,
          frictionAir: 0,
          restitution: obs.restitution ?? 0.3,
          friction: obs.friction ?? 0.05,
        };
        if (obs.type === 'rectangle') {
          body = Matter.Bodies.rectangle(obs.position.x, obs.position.y, obs.size!.x, obs.size!.y, spinnerOpts);
        } else if (obs.type === 'circle') {
          body = Matter.Bodies.circle(obs.position.x, obs.position.y, obs.radius!, spinnerOpts);
        }
        if (body) {
          // Enormous mass so no marble can meaningfully move it
          Matter.Body.setMass(body, 1e6);
          Matter.Body.setAngularVelocity(body, obs.angularVelocity);
          spinningBodies.push(body);
          spinningBodyOrigins.set(body, { x: obs.position.x, y: obs.position.y });
          spinningBodyTargetAV.set(body, obs.angularVelocity);
        }
      } else {
        // ── Static (non-spinning) obstacle ────────────────────────────────
        const staticOpts = {
          isStatic: true,
          angle: obs.angle || 0,
          restitution: obs.restitution ?? (obs.type === 'circle' ? 0.5 : 0.3),
          friction: obs.friction ?? 0.05,
        };
        if (obs.type === 'rectangle') {
          body = Matter.Bodies.rectangle(obs.position.x, obs.position.y, obs.size!.x, obs.size!.y, staticOpts);
        } else if (obs.type === 'circle') {
          body = Matter.Bodies.circle(obs.position.x, obs.position.y, obs.radius!, staticOpts);
        }
      }

      if (body) Matter.World.add(world, body);
    });

    // Pegs
    map.pegs.forEach(peg => {
      const body = Matter.Bodies.circle(peg.position.x, peg.position.y, peg.radius, {
        isStatic: true,
        restitution: 0.8
      });
      Matter.World.add(world, body);
    });

    // Bumpers – clamp restitution to ≤1.0 so balls never gain energy on bounce
    map.bumpers.forEach(bumper => {
      const body = Matter.Bodies.circle(bumper.position.x, bumper.position.y, bumper.radius, {
        isStatic: true,
        restitution: Math.min(bumper.restitution, 1.0)
      });
      Matter.World.add(world, body);
    });
  }

  function calculateProgress(pos: Vector2, path: Vector2[]): number {
    if (path.length < 2) return pos.y;

    let totalProgress = 0;
    let minDistance = Infinity;
    let bestProgress = 0;

    for (let i = 0; i < path.length - 1; i++) {
      const p1 = path[i];
      const p2 = path[i + 1];

      // Vector from p1 to p2
      const dx = p2.x - p1.x;
      const dy = p2.y - p1.y;
      const lengthSq = dx * dx + dy * dy;
      const length = Math.sqrt(lengthSq);

      if (lengthSq === 0) continue;

      // Project pos onto segment p1-p2
      let t = ((pos.x - p1.x) * dx + (pos.y - p1.y) * dy) / lengthSq;
      t = Math.max(0, Math.min(1, t));

      const closestX = p1.x + t * dx;
      const closestY = p1.y + t * dy;

      const distSq = Math.pow(pos.x - closestX, 2) + Math.pow(pos.y - closestY, 2);

      if (distSq < minDistance) {
        minDistance = distSq;
        bestProgress = totalProgress + t * length;
      }

      totalProgress += length;
    }

    return bestProgress;
  }

  function update() {
    if (raceState.status === 'racing') {
      // ── Kinematic spinner motor ──────────────────────────────────────────
      // Must happen BEFORE the engine step so the engine sees the correct
      // angular velocity for this tick's collision impulse calculation.
      for (const [body, origin] of spinningBodyOrigins.entries()) {
        const av = spinningBodyTargetAV.get(body) ?? 0;
        // Lock position (counteract any drift from high-mass collisions)
        Matter.Body.setPosition(body, { x: origin.x, y: origin.y });
        Matter.Body.setVelocity(body, { x: 0, y: 0 });
        // Re-apply angular velocity so frictionAir doesn't bleed it dry
        Matter.Body.setAngularVelocity(body, av);
      }

      Matter.Engine.update(engine, 1000 / 60);

      const now = Date.now();

      for (const [id, body] of ballBodies.entries()) {
        const ball = raceState.balls[id];
        if (!ball) continue;

        if (!ball.finished) {
          ball.position = { x: body.position.x, y: body.position.y };
          ball.velocity = { x: body.velocity.x, y: body.velocity.y };
          ball.angle = body.angle;
          ball.progress = calculateProgress(ball.position, currentMap.path);

          // Stuck detection
          const speed = Math.sqrt(body.velocity.x ** 2 + body.velocity.y ** 2);
          if (speed < 0.2) {
            const stuckTime = (ballStuckTime.get(id) || 0) + 1;
            ballStuckTime.set(id, stuckTime);

            if (stuckTime > 120) { // 2 seconds at 60fps
              // Apply random impulse
              const force = {
                x: (Math.random() - 0.5) * 0.05,
                y: (Math.random() - 0.5) * 0.05
              };
              Matter.Body.applyForce(body, body.position, force);
              ballStuckTime.set(id, 0); // Reset after nudge
            }
          } else {
            ballStuckTime.set(id, 0);

            // Periodic tiny nudge to prevent perfect balance
            if (now % 3000 < 20) { // Every ~3 seconds
              Matter.Body.applyForce(body, body.position, {
                x: (Math.random() - 0.5) * 0.005,
                y: (Math.random() - 0.5) * 0.005
              });
            }
          }

          // Check finish
          if (ball.position.y > currentMap.finishZone.y) {
            ball.finished = true;
            ball.finishTime = now - (raceState.startTime || now);
            ball.rank = Object.values(raceState.balls).filter(b => b.finished).length;
          }
        }
      }

      const hasFirstFinisher = Object.values(raceState.balls).some(ball => ball.finished);
      if (hasFirstFinisher && raceEndTimeout === null) {
        raceEndTimeout = setTimeout(() => {
          raceEndTimeout = null;
          finalizeRace();
        }, 500);
      }

      io.emit('raceUpdate', raceState);
    }
  }

  setInterval(update, 1000 / 60);

  io.on('connection', (socket) => {
    console.log('User connected:', socket.id);

    socket.emit('init', {
      players: Array.from(players.values()),
      currentRace: raceState,
      map: currentMap,
      maps: mapInfoList
    });

    socket.on('join', (data: { name: string; spriteUrl: string }) => {
      const player: Player = {
        id: socket.id,
        name: data.name,
        spriteUrl: data.spriteUrl,
        color: `hsl(${Math.random() * 360}, 70%, 50%)`
      };
      players.set(socket.id, player);
      io.emit('playerJoined', player);
    });

    socket.on('startRace', (mapId: string) => {
      if (raceState.status === 'racing' || raceState.status === 'countdown') return;

      // Select the requested map (fall back to first map)
      currentMap = allMaps.find(m => m.id === mapId) ?? allMaps[0];
      engine.gravity.y = currentMap.gravity.y;
      raceState.mapId = currentMap.id;

      if (raceEndTimeout !== null) {
        clearTimeout(raceEndTimeout);
        raceEndTimeout = null;
      }

      setupMap(currentMap);

      // Reset balls
      raceState.balls = {};
      ballBodies.forEach(body => Matter.World.remove(world, body));
      ballBodies.clear();

      // Use the hardcoded players
      Array.from(players.values()).forEach((player, index) => {
        const spawn = currentMap.spawnPoints[index % currentMap.spawnPoints.length];
        const offset = (Math.random() - 0.5) * 40;
        const body = Matter.Bodies.circle(spawn.x + offset, spawn.y, 20, {
          // Matches planning-doc spec: moderate bounce, realistic friction
          restitution: 0.4,
          friction: 0.1,
          frictionAir: 0.008,
          density: 0.002,
        });
        Matter.World.add(world, body);
        ballBodies.set(player.id, body);

        raceState.balls[player.id] = {
          id: player.id,
          position: { x: body.position.x, y: body.position.y },
          velocity: { x: 0, y: 0 },
          angle: 0,
          progress: 0,
          finished: false
        };
      });

      raceState.status = 'countdown';
      raceState.countdown = 3;
      io.emit('raceUpdate', raceState);

      const countdownInterval = setInterval(() => {
        raceState.countdown--;
        if (raceState.countdown <= 0) {
          clearInterval(countdownInterval);
          raceState.status = 'racing';
          raceState.startTime = Date.now();
        }
        io.emit('raceUpdate', raceState);
      }, 1000);

      io.emit('raceStart', currentMap);
    });

    socket.on('disconnect', () => {
      // Don't remove hardcoded players on disconnect
      console.log('User disconnected:', socket.id);
    });
  });

  // Vite middleware for development
  if (process.env.NODE_ENV !== 'production') {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  } else {
    app.use(express.static('dist'));
  }

  httpServer.listen(PORT, '0.0.0.0', () => {
    console.log(`Server running on http://localhost:${PORT}`);
  });
}

startServer();
