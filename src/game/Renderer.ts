import { MapData, BallState, Player, RaceState, Vector2 } from '../types';

export class Renderer {
  private ctx: CanvasRenderingContext2D;
  private canvas: HTMLCanvasElement;
  private camera: { x: number; y: number; zoom: number } = { x: 0, y: 0, zoom: 1 };
  private images: Map<string, HTMLImageElement> = new Map();

  constructor(canvas: HTMLCanvasElement) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d')!;
  }

  setCamera(x: number, y: number, zoom: number) {
    this.camera = { x, y, zoom };
  }

  private async loadImage(url: string): Promise<HTMLImageElement> {
    if (this.images.has(url)) return this.images.get(url)!;
    return new Promise((resolve, reject) => {
      const img = new Image();
      img.src = url;
      img.onload = () => {
        this.images.set(url, img);
        resolve(img);
      };
      img.onerror = reject;
    });
  }

  private ballTrails: Map<string, Vector2[]> = new Map();

  render(map: MapData, race: RaceState, players: Player[]) {
    const { ctx, canvas, camera } = this;
    ctx.clearRect(0, 0, canvas.width, canvas.height);

    if (race.status === 'countdown' && race.countdown === 3) {
      this.ballTrails.clear();
    }

    ctx.save();
    // Apply camera transform
    ctx.translate(canvas.width / 2, canvas.height / 2);
    ctx.scale(camera.zoom, camera.zoom);
    ctx.translate(-camera.x, -camera.y);

    // Draw Map Background (Bright Blue like in the images)
    ctx.fillStyle = '#00d4ff'; 
    ctx.fillRect(0, 0, map.worldSize.x, map.worldSize.y);

    // Draw Static Obstacles (Black rectangles and circles)
    ctx.fillStyle = '#000000';
    map.staticObstacles.forEach(obs => {
      ctx.save();
      ctx.translate(obs.position.x, obs.position.y);
      
      let angle = obs.angle || 0;
      if (obs.angularVelocity && race.status === 'racing' && race.startTime) {
        const elapsedTicks = (Date.now() - race.startTime) / (1000 / 60);
        angle += obs.angularVelocity * elapsedTicks;
      }
      
      ctx.rotate(angle);
      if (obs.type === 'rectangle') {
        ctx.fillRect(-obs.size!.x / 2, -obs.size!.y / 2, obs.size!.x, obs.size!.y);
      } else if (obs.type === 'circle') {
        ctx.beginPath();
        ctx.arc(0, 0, obs.radius!, 0, Math.PI * 2);
        ctx.fill();
        // Draw a line to show rotation
        ctx.strokeStyle = '#fff';
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.moveTo(0, 0);
        ctx.lineTo(obs.radius!, 0);
        ctx.stroke();
      }
      ctx.restore();
    });

    // Draw Pegs (black circles)
    ctx.fillStyle = '#000000';
    map.pegs.forEach(peg => {
      ctx.beginPath();
      ctx.arc(peg.position.x, peg.position.y, peg.radius, 0, Math.PI * 2);
      ctx.fill();
    });

    // Draw Bumpers (black circles with a white ring so they're distinguishable)
    map.bumpers.forEach(bumper => {
      ctx.beginPath();
      ctx.arc(bumper.position.x, bumper.position.y, bumper.radius, 0, Math.PI * 2);
      ctx.fillStyle = '#000000';
      ctx.fill();
      ctx.strokeStyle = '#ffffff';
      ctx.lineWidth = 3;
      ctx.stroke();
    });

    // Draw Finish Zone (Checkered)
    const cellSize = 40;
    for (let x = map.finishZone.x; x < map.finishZone.x + map.finishZone.width; x += cellSize) {
      for (let y = map.finishZone.y; y < map.finishZone.y + map.finishZone.height; y += cellSize) {
        ctx.fillStyle = (Math.floor(x / cellSize) + Math.floor(y / cellSize)) % 2 === 0 ? '#fff' : '#000';
        ctx.fillRect(x, y, cellSize, cellSize);
      }
    }
    ctx.strokeStyle = '#fff';
    ctx.lineWidth = 8;
    ctx.strokeRect(map.finishZone.x, map.finishZone.y, map.finishZone.width, map.finishZone.height);

    // Draw Trails
    Object.entries(race.balls).forEach(([id, ball]) => {
      if (ball.finished) return;
      
      let trail = this.ballTrails.get(id) || [];
      trail.push({ x: ball.position.x, y: ball.position.y });
      if (trail.length > 30) trail.shift();
      this.ballTrails.set(id, trail);

      if (trail.length > 1) {
        for (let i = 0; i < trail.length - 1; i++) {
          const ratio = i / trail.length;
          ctx.beginPath();
          ctx.moveTo(trail[i].x, trail[i].y);
          ctx.lineTo(trail[i + 1].x, trail[i + 1].y);
          ctx.strokeStyle = `rgba(255, 255, 255, ${ratio * 0.5})`;
          ctx.lineWidth = ratio * 15;
          ctx.lineCap = 'round';
          ctx.stroke();
        }
      }
    });

    // Draw Balls
    Object.entries(race.balls).forEach(([id, ball]) => {
      const player = players.find(p => p.id === id);
      if (!player) return;

      ctx.save();
      ctx.translate(ball.position.x, ball.position.y);
      ctx.rotate(ball.angle);

      // Draw white circle background for the sprite
      ctx.beginPath();
      ctx.arc(0, 0, 20, 0, Math.PI * 2);
      ctx.fillStyle = '#ffffff';
      ctx.fill();
      ctx.strokeStyle = '#000000';
      ctx.lineWidth = 2;
      ctx.stroke();

      // Draw sprite if available
      if (player.spriteUrl) {
        const img = this.images.get(player.spriteUrl);
        if (img) {
          ctx.save();
          ctx.beginPath();
          ctx.arc(0, 0, 18, 0, Math.PI * 2);
          ctx.clip();
          ctx.drawImage(img, -18, -18, 36, 36);
          ctx.restore();
        } else {
          this.loadImage(player.spriteUrl);
        }
      }

      ctx.restore();

      // Draw Name Label (White text with black stroke)
      ctx.save();
      ctx.translate(ball.position.x, ball.position.y - 45);
      const name = player.name;
      ctx.font = '900 32px Inter';
      ctx.textAlign = 'center';
      
      // Stroke
      ctx.strokeStyle = '#000000';
      ctx.lineWidth = 12;
      ctx.lineJoin = 'round';
      ctx.strokeText(name, 0, 0);
      
      // Fill
      ctx.fillStyle = '#ffffff';
      ctx.fillText(name, 0, 0);
      ctx.restore();
    });

    ctx.restore();
  }
}
