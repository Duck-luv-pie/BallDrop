import express from 'express';
import { createServer } from 'http';
import { Server } from 'socket.io';
import { createServer as createViteServer } from 'vite';
import Matter from 'matter-js';
import { MapData, RaceState, BallState, Player, Vector2 } from './src/types';

const PORT = 3000;

// Sample Map
const sampleMap: MapData = {
  id: 'map1',
  name: 'Dynamic Descent',
  worldSize: { x: 800, y: 3000 },
  gravity: { x: 0, y: 1.5 },
  spawnPoints: [
    { x: 380, y: 100 },
    { x: 400, y: 100 },
    { x: 420, y: 100 }
  ],
  staticObstacles: [
    // Starting funnel - angled to prevent sticking
    { type: 'rectangle', position: { x: 100, y: 200 }, size: { x: 400, y: 40 }, angle: 0.8 },
    { type: 'rectangle', position: { x: 700, y: 200 }, size: { x: 400, y: 40 }, angle: -0.8 },
    
    // Spinning obstacles
    { type: 'rectangle', position: { x: 400, y: 500 }, size: { x: 200, y: 30 }, angle: 0, angularVelocity: 0.05 },
    { type: 'rectangle', position: { x: 200, y: 800 }, size: { x: 150, y: 30 }, angle: 0, angularVelocity: -0.03 },
    { type: 'rectangle', position: { x: 600, y: 800 }, size: { x: 150, y: 30 }, angle: 0, angularVelocity: 0.03 },
    
    // Angled blocks to keep momentum
    { type: 'rectangle', position: { x: 200, y: 1100 }, size: { x: 300, y: 60 }, angle: 0.2 },
    { type: 'rectangle', position: { x: 600, y: 1400 }, size: { x: 300, y: 60 }, angle: -0.2 },
    
    // More spinners
    { type: 'rectangle', position: { x: 400, y: 1700 }, size: { x: 300, y: 30 }, angle: 0, angularVelocity: 0.02 },
    
    // Zig zag with steep angles
    { type: 'rectangle', position: { x: 400, y: 2000 }, size: { x: 500, y: 60 }, angle: 0.5 },
    { type: 'rectangle', position: { x: 400, y: 2300 }, size: { x: 500, y: 60 }, angle: -0.5 },
    
    // Middle spinners
    { type: 'circle', position: { x: 200, y: 2450 }, radius: 40, angularVelocity: 0.15 },
    { type: 'circle', position: { x: 600, y: 2450 }, radius: 40, angularVelocity: -0.15 },
    
    // Narrow pass with spinners
    { type: 'rectangle', position: { x: 150, y: 2650 }, size: { x: 300, y: 40 }, angle: 0 },
    { type: 'rectangle', position: { x: 650, y: 2650 }, size: { x: 300, y: 40 }, angle: 0 },
    { type: 'rectangle', position: { x: 400, y: 2650 }, size: { x: 100, y: 20 }, angle: 0, angularVelocity: 0.1 },
    
    // Spinning circle "kickers"
    { type: 'circle', position: { x: 300, y: 2850 }, radius: 30, angularVelocity: 0.2 },
    { type: 'circle', position: { x: 500, y: 2850 }, radius: 30, angularVelocity: -0.2 },
    
    // Walls
    { type: 'rectangle', position: { x: 0, y: 1500 }, size: { x: 40, y: 3000 }, angle: 0 },
    { type: 'rectangle', position: { x: 800, y: 1500 }, size: { x: 40, y: 3000 }, angle: 0 },
    { type: 'rectangle', position: { x: 400, y: 3000 }, size: { x: 800, y: 40 }, angle: 0 }
  ],
  pegs: [],
  bumpers: [],
  checkpoints: [],
  finishZone: { x: 0, y: 2900, width: 800, height: 100 },
  path: [
    { x: 400, y: 0 },
    { x: 400, y: 500 },
    { x: 400, y: 1000 },
    { x: 400, y: 1500 },
    { x: 400, y: 2000 },
    { x: 400, y: 2500 },
    { x: 400, y: 3000 }
  ]
};

async function startServer() {
  const app = express();
  const httpServer = createServer(app);
  const io = new Server(httpServer, {
    cors: { origin: '*' }
  });

  // Physics Engine
  const engine = Matter.Engine.create();
  const world = engine.world;
  engine.gravity.y = 1;

  let players: Map<string, Player> = new Map([
    ['p1', { id: 'p1', name: 'Rigby', spriteUrl: 'https://picsum.photos/seed/rigby/100/100', color: '#ff4444' }],
    ['p2', { id: 'p2', name: 'Obama', spriteUrl: 'https://picsum.photos/seed/obama/100/100', color: '#4444ff' }],
    ['p3', { id: 'p3', name: 'Joe', spriteUrl: 'https://picsum.photos/seed/joe/100/100', color: '#44ff44' }]
  ]);
  let raceState: RaceState = {
    status: 'waiting',
    countdown: 0,
    mapId: sampleMap.id,
    balls: {}
  };

  let ballBodies: Map<string, Matter.Body> = new Map();
  let spinningBodies: Matter.Body[] = [];
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
    
    // Static obstacles
    map.staticObstacles.forEach(obs => {
      let body;
      if (obs.type === 'rectangle') {
        body = Matter.Bodies.rectangle(obs.position.x, obs.position.y, obs.size!.x, obs.size!.y, {
          isStatic: !obs.angularVelocity,
          angle: obs.angle || 0,
          restitution: obs.restitution || 0.5,
          friction: obs.friction || 0.1
        });
        
        if (obs.angularVelocity) {
          spinningBodies.push(body);
          Matter.Body.setStatic(body, true);
        }
      } else if (obs.type === 'circle') {
        body = Matter.Bodies.circle(obs.position.x, obs.position.y, obs.radius!, {
          isStatic: !obs.angularVelocity,
          restitution: obs.restitution || 0.8,
          friction: obs.friction || 0.1
        });
        
        if (obs.angularVelocity) {
          spinningBodies.push(body);
          Matter.Body.setStatic(body, true);
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

    // Bumpers
    map.bumpers.forEach(bumper => {
      const body = Matter.Bodies.circle(bumper.position.x, bumper.position.y, bumper.radius, {
        isStatic: true,
        restitution: bumper.restitution
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
      // Update spinning obstacles
      sampleMap.staticObstacles.forEach((obs, idx) => {
        if (obs.angularVelocity) {
          const body = spinningBodies.find(b => 
            Math.abs(b.position.x - obs.position.x) < 1 && 
            Math.abs(b.position.y - obs.position.y) < 1
          );
          if (body) {
            Matter.Body.setAngle(body, body.angle + obs.angularVelocity);
          }
        }
      });

      Matter.Engine.update(engine, 1000 / 60);

      const now = Date.now();

      for (const [id, body] of ballBodies.entries()) {
        const ball = raceState.balls[id];
        if (!ball) continue;

        if (!ball.finished) {
          ball.position = { x: body.position.x, y: body.position.y };
          ball.velocity = { x: body.velocity.x, y: body.velocity.y };
          ball.angle = body.angle;
          ball.progress = calculateProgress(ball.position, sampleMap.path);

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
          if (ball.position.y > sampleMap.finishZone.y) {
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
      map: sampleMap
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

    socket.on('startRace', () => {
      if (raceState.status === 'racing' || raceState.status === 'countdown') return;

      if (raceEndTimeout !== null) {
        clearTimeout(raceEndTimeout);
        raceEndTimeout = null;
      }

      setupMap(sampleMap);
      
      // Reset balls
      raceState.balls = {};
      ballBodies.forEach(body => Matter.World.remove(world, body));
      ballBodies.clear();

      // Use the hardcoded players
      Array.from(players.values()).forEach((player, index) => {
        const spawn = sampleMap.spawnPoints[index % sampleMap.spawnPoints.length];
        const offset = (Math.random() - 0.5) * 40;
        const body = Matter.Bodies.circle(spawn.x + offset, spawn.y, 20, {
          restitution: 0.6,
          friction: 0.005,
          frictionAir: 0.001
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

      io.emit('raceStart', sampleMap);
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
