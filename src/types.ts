export interface Vector2 {
  x: number;
  y: number;
}

export interface MapData {
  id: string;
  name: string;
  worldSize: Vector2;
  gravity: Vector2;
  spawnPoints: Vector2[];
  staticObstacles: Obstacle[];
  pegs: Peg[];
  bumpers: Bumper[];
  checkpoints: Vector2[][]; // Array of line segments
  finishZone: {
    x: number;
    y: number;
    width: number;
    height: number;
  };
  path: Vector2[]; // Polyline for progress calculation
}

export interface Obstacle {
  type: 'rectangle' | 'polygon' | 'circle';
  position: Vector2;
  size?: Vector2; // for rectangle
  radius?: number; // for circle
  vertices?: Vector2[]; // for polygon
  angle?: number;
  angularVelocity?: number; // radians per tick
  restitution?: number;
  friction?: number;
}

export interface Peg {
  position: Vector2;
  radius: number;
}

export interface Bumper {
  position: Vector2;
  radius: number;
  restitution: number;
}

export interface Player {
  id: string;
  name: string;
  spriteUrl: string;
  color: string;
  musicfyVoiceId?: string;
}

export interface BallState {
  id: string;
  position: Vector2;
  velocity: Vector2;
  angle: number;
  progress: number;
  finished: boolean;
  finishTime?: number;
  rank?: number;
}

export interface RaceState {
  status: 'waiting' | 'countdown' | 'racing' | 'finished';
  countdown: number;
  mapId: string;
  balls: Record<string, BallState>;
  startTime?: number;
}

export interface ServerToClientEvents {
  raceUpdate: (state: RaceState) => void;
  raceStart: (map: MapData) => void;
  raceEnd: (results: { playerId: string; name: string; rank: number; time: number }[]) => void;
  playerJoined: (player: Player) => void;
  playerLeft: (playerId: string) => void;
  init: (data: { players: Player[]; currentRace: RaceState | null; map: MapData | null }) => void;
}

export interface ClientToServerEvents {
  join: (player: { name: string; spriteUrl: string; musicfyVoiceId?: string }) => void;
  addMusicfyPlayer: (player: { name: string; spriteUrl: string; musicfyVoiceId: string }) => void;
  removePlayer: (playerId: string) => void;
  startRace: (mapId: string) => void;
}
