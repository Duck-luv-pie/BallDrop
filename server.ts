import express from 'express';
import { createServer } from 'http';
import { Server } from 'socket.io';
import { createServer as createViteServer } from 'vite';
import path from 'path';
import { mkdirSync, writeFileSync } from 'fs';
import { randomUUID } from 'crypto';
import dotenv from 'dotenv';
import Database from 'better-sqlite3';
import multer from 'multer';
import Matter from 'matter-js';
import { MapData, RaceState, Player, Vector2 } from './src/types';

dotenv.config({ path: '.env.local', quiet: true });
dotenv.config({ quiet: true });

const PORT = Number(process.env.PORT || 3000);
const MUSICFY_API_BASE_URL = process.env.MUSICFY_BASE_URL || 'https://api.musicfy.lol/v1';
const MUSICFY_API_KEY = process.env.MUSICFY_API_KEY;

const DATA_DIR = path.resolve(process.cwd(), 'data');
const STORAGE_DIR = path.resolve(process.cwd(), 'storage');
const AUDIO_STORAGE_DIR = path.join(STORAGE_DIR, 'audio');

mkdirSync(DATA_DIR, { recursive: true });
mkdirSync(AUDIO_STORAGE_DIR, { recursive: true });

const db = new Database(path.join(DATA_DIR, 'ball_drop.sqlite'));
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');

db.exec(`
CREATE TABLE IF NOT EXISTS saved_characters (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  sprite_url TEXT NOT NULL,
  musicfy_voice_id TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  UNIQUE(musicfy_voice_id, name)
);

CREATE TABLE IF NOT EXISTS generated_outputs (
  id TEXT PRIMARY KEY,
  character_name TEXT NOT NULL,
  sprite_url TEXT,
  musicfy_voice_id TEXT NOT NULL,
  source_file_name TEXT,
  remote_audio_url TEXT NOT NULL,
  saved_audio_url TEXT NOT NULL,
  output_type TEXT,
  created_at INTEGER NOT NULL
);
`);

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 30 * 1024 * 1024 }
});

const MUSICFY_OPTIONAL_FIELDS = ['isolate_vocals', 'pitch_shift', 'formant_shift', 'strength'] as const;

interface MusicfyVoice {
  id: string;
  name: string;
  avatarUrl?: string;
}

interface SavedCharacterRecord {
  id: string;
  name: string;
  sprite_url: string;
  musicfy_voice_id: string;
  created_at: number;
  updated_at: number;
}

interface GeneratedOutputRecord {
  id: string;
  character_name: string;
  sprite_url: string | null;
  musicfy_voice_id: string;
  source_file_name: string | null;
  remote_audio_url: string;
  saved_audio_url: string;
  output_type: string | null;
  created_at: number;
}

function getStringValue(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim().length > 0 ? value.trim() : undefined;
}

function normalizeCharacterName(value: string | undefined): string {
  return (value || '').trim().toLowerCase();
}

function isPlaceholderCharacterName(value: string | undefined): boolean {
  const normalized = normalizeCharacterName(value);
  return (
    !normalized ||
    normalized === 'unknown' ||
    normalized === 'unknown song' ||
    normalized === 'unknown character' ||
    normalized === 'musicfy character' ||
    normalized.startsWith('voice ')
  );
}

function normalizeMusicfyVoices(payload: unknown): MusicfyVoice[] {
  const list = Array.isArray(payload)
    ? payload
    : Array.isArray((payload as { voices?: unknown[] })?.voices)
      ? (payload as { voices: unknown[] }).voices
      : Array.isArray((payload as { data?: unknown[] })?.data)
        ? (payload as { data: unknown[] }).data
        : [];

  return list
    .map((raw, index) => {
      if (!raw || typeof raw !== 'object') return null;
      const voice = raw as Record<string, unknown>;
      const id = getStringValue(voice.voice_id) || getStringValue(voice.voiceId) || getStringValue(voice.id);
      if (!id) return null;

      const avatarUrl =
        getStringValue(voice.avatar_url) ||
        getStringValue(voice.avatarUrl) ||
        getStringValue(voice.thumbnail) ||
        getStringValue(voice.image_url) ||
        getStringValue(voice.image);

      return {
        id,
        name:
          getStringValue(voice.name) ||
          getStringValue(voice.title) ||
          getStringValue(voice.artist) ||
          getStringValue(voice.character_name) ||
          getStringValue(voice.characterName) ||
          `Voice ${index + 1}`,
        ...(avatarUrl ? { avatarUrl } : {})
      } satisfies MusicfyVoice;
    })
    .filter((voice): voice is MusicfyVoice => Boolean(voice));
}

function findAudioUrl(payload: unknown): string | undefined {
  if (!payload) return undefined;
  if (typeof payload === 'string' && payload.startsWith('http')) return payload;
  if (Array.isArray(payload)) {
    for (const item of payload) {
      const nested = findAudioUrl(item);
      if (nested) return nested;
    }
    return undefined;
  }
  if (typeof payload !== 'object') return undefined;

  const obj = payload as Record<string, unknown>;
  const prioritizedKeys = [
    'audio_url',
    'audioUrl',
    'output_url',
    'outputUrl',
    'url',
    'download_url',
    'downloadUrl',
    'result_url',
    'resultUrl'
  ];

  for (const key of prioritizedKeys) {
    const value = obj[key];
    if (typeof value === 'string' && value.startsWith('http')) return value;
  }

  for (const value of Object.values(obj)) {
    const nested = findAudioUrl(value);
    if (nested) return nested;
  }

  return undefined;
}

function sanitizeGeneratedAudioFilename(extension: string): string {
  const normalized = extension.startsWith('.') ? extension : `.${extension}`;
  return `cover_${Date.now()}_${randomUUID().slice(0, 8)}${normalized}`;
}

function guessAudioExtension(url: string, contentType: string | null): string {
  const cleanType = (contentType || '').toLowerCase();
  if (cleanType.includes('wav')) return '.wav';
  if (cleanType.includes('mpeg') || cleanType.includes('mp3')) return '.mp3';
  if (cleanType.includes('ogg')) return '.ogg';
  if (cleanType.includes('flac')) return '.flac';
  if (cleanType.includes('aac')) return '.aac';
  if (cleanType.includes('mp4') || cleanType.includes('m4a')) return '.m4a';

  const pathname = (() => {
    try {
      return new URL(url).pathname;
    } catch {
      return '';
    }
  })();

  const ext = path.extname(pathname).toLowerCase();
  if (ext && ext.length <= 8) return ext;
  return '.wav';
}

function extractOutputFiles(payload: unknown): { url: string; type?: string }[] {
  if (!payload) return [];

  if (Array.isArray(payload)) {
    const files: { url: string; type?: string }[] = [];
    for (const item of payload) files.push(...extractOutputFiles(item));
    return files;
  }

  if (typeof payload !== 'object') return [];
  const obj = payload as Record<string, unknown>;

  const directUrl =
    getStringValue(obj.file_url) ||
    getStringValue(obj.fileUrl) ||
    getStringValue(obj.audio_url) ||
    getStringValue(obj.audioUrl) ||
    getStringValue(obj.url) ||
    getStringValue(obj.download_url) ||
    getStringValue(obj.downloadUrl);

  const directType = getStringValue(obj.type);
  const files: { url: string; type?: string }[] = [];
  if (directUrl) files.push({ url: directUrl, ...(directType ? { type: directType } : {}) });

  for (const value of Object.values(obj)) {
    files.push(...extractOutputFiles(value));
  }

  return files;
}

function pickPreferredOutput(files: { url: string; type?: string }[]): { url: string; type?: string } | undefined {
  if (files.length === 0) return undefined;
  const byType = (target: string) => files.find((file) => file.type?.toLowerCase() === target);
  return byType('combined') || byType('vocals') || files[0];
}

async function downloadAndPersistAudio(remoteUrl: string): Promise<string> {
  const response = await fetch(remoteUrl);
  if (!response.ok) {
    throw new Error(`Failed to download generated audio (${response.status})`);
  }

  const buffer = Buffer.from(await response.arrayBuffer());
  const extension = guessAudioExtension(remoteUrl, response.headers.get('content-type'));
  const filename = sanitizeGeneratedAudioFilename(extension);
  const absolutePath = path.join(AUDIO_STORAGE_DIR, filename);
  writeFileSync(absolutePath, buffer);

  return `/storage/audio/${filename}`;
}

function mapSavedCharacter(record: SavedCharacterRecord) {
  return {
    id: record.id,
    name: record.name,
    spriteUrl: record.sprite_url,
    musicfyVoiceId: record.musicfy_voice_id,
    createdAt: record.created_at,
    updatedAt: record.updated_at
  };
}

function mapGeneratedOutput(record: GeneratedOutputRecord) {
  return {
    id: record.id,
    characterName: record.character_name,
    spriteUrl: record.sprite_url,
    musicfyVoiceId: record.musicfy_voice_id,
    sourceFileName: record.source_file_name,
    remoteAudioUrl: record.remote_audio_url,
    savedAudioUrl: record.saved_audio_url,
    outputType: record.output_type,
    createdAt: record.created_at
  };
}

function sanitizeUploadFilename(originalName: string | undefined, mimetype: string | undefined): string {
  const extFromName = path.extname(originalName || '').toLowerCase();
  const cleanedExt = extFromName.replace(/[^a-z0-9.]/g, '');

  const mimeExtMap: Record<string, string> = {
    'audio/mpeg': '.mp3',
    'audio/mp3': '.mp3',
    'audio/wav': '.wav',
    'audio/x-wav': '.wav',
    'audio/mp4': '.m4a',
    'audio/x-m4a': '.m4a',
    'audio/aac': '.aac',
    'audio/ogg': '.ogg',
    'audio/flac': '.flac'
  };

  const safeExt =
    (cleanedExt && cleanedExt.length <= 8 ? cleanedExt : undefined) ||
    (mimetype ? mimeExtMap[mimetype] : undefined) ||
    '.mp3';

  return `upload${safeExt.startsWith('.') ? safeExt : `.${safeExt}`}`;
}

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
  app.use(express.json({ limit: '12mb' }));
  app.use('/storage', express.static(STORAGE_DIR));

  const selectSavedCharactersStmt = db.prepare(`
    SELECT id, name, sprite_url, musicfy_voice_id, created_at, updated_at
    FROM saved_characters
    ORDER BY updated_at DESC
  `);
  const upsertSavedCharacterStmt = db.prepare(`
    INSERT INTO saved_characters (id, name, sprite_url, musicfy_voice_id, created_at, updated_at)
    VALUES (@id, @name, @sprite_url, @musicfy_voice_id, @created_at, @updated_at)
    ON CONFLICT(musicfy_voice_id, name)
    DO UPDATE SET
      sprite_url = excluded.sprite_url,
      updated_at = excluded.updated_at
  `);
  const selectSavedCharacterByKeyStmt = db.prepare(`
    SELECT id, name, sprite_url, musicfy_voice_id, created_at, updated_at
    FROM saved_characters
    WHERE musicfy_voice_id = ? AND name = ?
    LIMIT 1
  `);
  const selectLatestSavedCharacterByVoiceStmt = db.prepare(`
    SELECT id, name, sprite_url, musicfy_voice_id, created_at, updated_at
    FROM saved_characters
    WHERE musicfy_voice_id = ?
    ORDER BY updated_at DESC
    LIMIT 1
  `);
  const selectGeneratedOutputsStmt = db.prepare(`
    SELECT id, character_name, sprite_url, musicfy_voice_id, source_file_name, remote_audio_url, saved_audio_url, output_type, created_at
    FROM generated_outputs
    ORDER BY created_at DESC
    LIMIT ?
  `);
  const insertGeneratedOutputStmt = db.prepare(`
    INSERT INTO generated_outputs (
      id, character_name, sprite_url, musicfy_voice_id, source_file_name, remote_audio_url, saved_audio_url, output_type, created_at
    )
    VALUES (
      @id, @character_name, @sprite_url, @musicfy_voice_id, @source_file_name, @remote_audio_url, @saved_audio_url, @output_type, @created_at
    )
  `);

  const httpServer = createServer(app);
  const io = new Server(httpServer, {
    cors: { origin: '*' }
  });

  // Physics Engine
  const engine = Matter.Engine.create();
  const world = engine.world;
  engine.gravity.y = 1;

  let players: Map<string, Player> = new Map();
  let nextPlayerId = 1;
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

  function makeColor() {
    return `hsl(${Math.random() * 360}, 70%, 50%)`;
  }

  function makePlayer(id: string, data: { name: string; spriteUrl: string; musicfyVoiceId?: string }): Player {
    return {
      id,
      name: data.name,
      spriteUrl: data.spriteUrl,
      color: makeColor(),
      musicfyVoiceId: data.musicfyVoiceId
    };
  }

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

  app.get('/api/characters', (_req, res) => {
    try {
      const rows = selectSavedCharactersStmt.all() as SavedCharacterRecord[];
      return res.json({ characters: rows.map(mapSavedCharacter) });
    } catch (error) {
      return res.status(500).json({
        error: 'Failed to load saved characters',
        detail: error instanceof Error ? error.message : String(error)
      });
    }
  });

  app.post('/api/characters', (req, res) => {
    const name = getStringValue(req.body?.name);
    const spriteUrl = getStringValue(req.body?.spriteUrl);
    const musicfyVoiceId = getStringValue(req.body?.musicfyVoiceId);

    if (!name || !spriteUrl || !musicfyVoiceId) {
      return res.status(400).json({
        error: 'Missing required fields',
        message: 'Expected name, spriteUrl, and musicfyVoiceId'
      });
    }

    try {
      const now = Date.now();
      upsertSavedCharacterStmt.run({
        id: randomUUID(),
        name,
        sprite_url: spriteUrl,
        musicfy_voice_id: musicfyVoiceId,
        created_at: now,
        updated_at: now
      });

      const saved = selectSavedCharacterByKeyStmt.get(musicfyVoiceId, name) as SavedCharacterRecord | undefined;
      if (!saved) {
        return res.status(500).json({ error: 'Character save succeeded but could not be read back.' });
      }

      return res.json({ character: mapSavedCharacter(saved) });
    } catch (error) {
      return res.status(500).json({
        error: 'Failed to save character',
        detail: error instanceof Error ? error.message : String(error)
      });
    }
  });

  app.get('/api/generated-outputs', (req, res) => {
    const rawLimit = Number(req.query.limit || 30);
    const limit = Number.isFinite(rawLimit) ? Math.max(1, Math.min(200, Math.floor(rawLimit))) : 30;

    try {
      const rows = selectGeneratedOutputsStmt.all(limit) as GeneratedOutputRecord[];
      return res.json({ outputs: rows.map(mapGeneratedOutput) });
    } catch (error) {
      return res.status(500).json({
        error: 'Failed to load generated outputs',
        detail: error instanceof Error ? error.message : String(error)
      });
    }
  });

  app.get('/api/musicfy/voices', async (_req, res) => {
    if (!MUSICFY_API_KEY) {
      return res.status(500).json({
        error: 'Missing MUSICFY_API_KEY',
        message: 'Set MUSICFY_API_KEY in .env.local before calling Musicfy routes.'
      });
    }

    try {
      const upstream = await fetch(`${MUSICFY_API_BASE_URL}/voices`, {
        headers: {
          Authorization: `Bearer ${MUSICFY_API_KEY}`
        }
      });

      const payload = await upstream.json().catch(() => ({}));
      if (!upstream.ok) {
        return res.status(upstream.status).json({
          error: 'Musicfy voices request failed',
          detail: payload
        });
      }

      return res.json({
        voices: normalizeMusicfyVoices(payload),
        raw: payload
      });
    } catch (error) {
      return res.status(500).json({
        error: 'Unable to fetch Musicfy voices',
        detail: error instanceof Error ? error.message : String(error)
      });
    }
  });

  app.post('/api/musicfy/convert-voice', upload.single('file'), async (req, res) => {
    if (!MUSICFY_API_KEY) {
      return res.status(500).json({
        error: 'Missing MUSICFY_API_KEY',
        message: 'Set MUSICFY_API_KEY in .env.local before calling Musicfy routes.'
      });
    }

    if (!req.file) {
      return res.status(400).json({ error: 'Missing audio file in "file" form field.' });
    }

    const voiceId = getStringValue(req.body.voice_id);
    if (!voiceId) {
      return res.status(400).json({ error: 'Missing voice_id form field.' });
    }

    try {
      const formData = new FormData();
      const safeFilename = sanitizeUploadFilename(req.file.originalname, req.file.mimetype);
      formData.append(
        'file',
        new Blob([req.file.buffer], { type: req.file.mimetype || 'application/octet-stream' }),
        safeFilename
      );
      formData.append('voice_id', voiceId);

      for (const field of MUSICFY_OPTIONAL_FIELDS) {
        const value = getStringValue(req.body[field]);
        if (value) formData.append(field, value);
      }

      const upstream = await fetch(`${MUSICFY_API_BASE_URL}/convert-voice`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${MUSICFY_API_KEY}`
        },
        body: formData
      });

      const payload = await upstream.json().catch(() => ({}));
      const audioUrl = findAudioUrl(payload);
      const outputFiles = extractOutputFiles(payload);
      const preferredOutput = pickPreferredOutput(outputFiles);

      if (!upstream.ok) {
        return res.status(upstream.status).json({
          error: 'Musicfy convert-voice request failed',
          detail: payload
        });
      }

      const selectedOutput = preferredOutput?.url || audioUrl;
      if (!selectedOutput) {
        return res.status(500).json({
          error: 'Musicfy response did not include a usable audio URL',
          detail: payload
        });
      }

      const savedAudioUrl = await downloadAndPersistAudio(selectedOutput);
      const createdAt = Date.now();
      const outputId = randomUUID();
      const requestedCharacterName = getStringValue(req.body.character_name) || getStringValue(req.body.characterName);
      const latestSavedCharacterForVoice = selectLatestSavedCharacterByVoiceStmt.get(voiceId) as
        | SavedCharacterRecord
        | undefined;
      const characterName = !isPlaceholderCharacterName(requestedCharacterName)
        ? requestedCharacterName!
        : !isPlaceholderCharacterName(latestSavedCharacterForVoice?.name)
          ? latestSavedCharacterForVoice!.name
          : `Character ${voiceId.slice(0, 6)}`;
      const characterSpriteUrl =
        getStringValue(req.body.character_sprite_url) ||
        getStringValue(req.body.characterSpriteUrl) ||
        latestSavedCharacterForVoice?.sprite_url ||
        `https://picsum.photos/seed/${encodeURIComponent(voiceId)}/100/100`;
      const sourceFileName = getStringValue(req.body.source_file_name) || req.file.originalname || null;

      upsertSavedCharacterStmt.run({
        id: randomUUID(),
        name: characterName,
        sprite_url: characterSpriteUrl,
        musicfy_voice_id: voiceId,
        created_at: createdAt,
        updated_at: createdAt
      });
      const savedCharacter = selectSavedCharacterByKeyStmt.get(voiceId, characterName) as
        | SavedCharacterRecord
        | undefined;
      const resolvedCharacterSpriteUrl = savedCharacter?.sprite_url || characterSpriteUrl;

      insertGeneratedOutputStmt.run({
        id: outputId,
        character_name: characterName,
        sprite_url: resolvedCharacterSpriteUrl,
        musicfy_voice_id: voiceId,
        source_file_name: sourceFileName,
        remote_audio_url: selectedOutput,
        saved_audio_url: savedAudioUrl,
        output_type: preferredOutput?.type || null,
        created_at: createdAt
      });

      return res.json({
        audioUrl: selectedOutput,
        savedAudioUrl,
        outputId,
        raw: payload
      });
    } catch (error) {
      return res.status(500).json({
        error: 'Unable to convert voice with Musicfy',
        detail: error instanceof Error ? error.message : String(error)
      });
    }
  });

  io.on('connection', (socket) => {
    console.log('User connected:', socket.id);

    socket.emit('init', {
      players: Array.from(players.values()),
      currentRace: raceState,
      map: sampleMap
    });

    socket.on('join', (data: { name: string; spriteUrl: string; musicfyVoiceId?: string }) => {
      const player = makePlayer(socket.id, data);
      players.set(socket.id, player);
      io.emit('playerJoined', player);
    });

    socket.on('addMusicfyPlayer', (data: { name: string; spriteUrl: string; musicfyVoiceId: string }) => {
      if (!getStringValue(data.musicfyVoiceId)) return;

      const id = `mf_${nextPlayerId++}`;
      const player = makePlayer(id, {
        name: getStringValue(data.name) || `Musicfy ${nextPlayerId}`,
        spriteUrl: getStringValue(data.spriteUrl) || `https://picsum.photos/seed/${encodeURIComponent(id)}/100/100`,
        musicfyVoiceId: data.musicfyVoiceId
      });
      players.set(id, player);
      io.emit('playerJoined', player);
    });

    socket.on('removePlayer', (playerId: string) => {
      const normalizedPlayerId = getStringValue(playerId);
      if (!normalizedPlayerId) return;
      if (!players.has(normalizedPlayerId)) return;

      players.delete(normalizedPlayerId);
      ballStuckTime.delete(normalizedPlayerId);

      const body = ballBodies.get(normalizedPlayerId);
      if (body) {
        Matter.World.remove(world, body);
        ballBodies.delete(normalizedPlayerId);
      }

      if (raceState.balls[normalizedPlayerId]) {
        delete raceState.balls[normalizedPlayerId];
      }

      if (Object.keys(raceState.balls).length === 0 && (raceState.status === 'countdown' || raceState.status === 'racing')) {
        raceState.status = 'waiting';
        raceState.countdown = 0;
        delete raceState.startTime;
      }

      io.emit('playerLeft', normalizedPlayerId);
      io.emit('raceUpdate', raceState);
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

      // Spawn all available players.
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
