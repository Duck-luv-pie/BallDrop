import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { io, Socket } from 'socket.io-client';
import { MapData, RaceState, Player, BallState, ServerToClientEvents, ClientToServerEvents } from './types';
import { Renderer } from './game/Renderer';
import { Trophy, Play, Camera, Upload, LoaderCircle, Music2 } from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';

interface MusicfyVoice {
  id: string;
  name: string;
  avatarUrl?: string;
}

interface GeneratedCover {
  playerId: string;
  playerName: string;
  status: 'processing' | 'success' | 'error';
  audioUrl?: string;
  error?: string;
}

interface SavedCharacter {
  id: string;
  name: string;
  spriteUrl: string;
  musicfyVoiceId: string;
  createdAt: number;
  updatedAt: number;
}

interface SavedOutput {
  id: string;
  characterName: string;
  spriteUrl?: string | null;
  musicfyVoiceId: string;
  sourceFileName?: string | null;
  remoteAudioUrl: string;
  savedAudioUrl: string;
  outputType?: string | null;
  createdAt: number;
}

interface CharacterLibraryItem {
  id: string;
  name: string;
  spriteUrl: string;
  musicfyVoiceId: string;
  outputCount: number;
  latestOutput: SavedOutput | null;
  sortAt: number;
}

const MAX_CHARACTER_PNG_BYTES = 5 * 1024 * 1024;

function getErrorMessage(value: unknown, fallback: string): string {
  if (typeof value === 'string' && value.trim().length > 0) return value;
  if (value && typeof value === 'object') {
    const detail = (value as { detail?: unknown }).detail;
    if (typeof detail === 'string' && detail.trim().length > 0) return detail;
    const error = (value as { error?: unknown }).error;
    if (typeof error === 'string' && error.trim().length > 0) return error;
  }
  return fallback;
}

function fileToDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const value = reader.result;
      if (typeof value === 'string') {
        resolve(value);
      } else {
        reject(new Error('Unable to read image file.'));
      }
    };
    reader.onerror = () => reject(new Error('Unable to read image file.'));
    reader.readAsDataURL(file);
  });
}

function normalizeCharacterName(name: string | null | undefined): string {
  return (name || '').trim().toLowerCase();
}

function makeCharacterKey(name: string | null | undefined, musicfyVoiceId: string): string {
  return `${musicfyVoiceId}::${normalizeCharacterName(name)}`;
}

function fallbackSpriteForVoice(musicfyVoiceId: string): string {
  return `https://picsum.photos/seed/${encodeURIComponent(musicfyVoiceId)}/100/100`;
}

function isPlaceholderCharacterName(name: string | null | undefined): boolean {
  const normalized = normalizeCharacterName(name);
  return (
    !normalized ||
    normalized === 'unknown' ||
    normalized === 'unknown song' ||
    normalized === 'unknown character' ||
    normalized === 'musicfy character' ||
    normalized.startsWith('voice ')
  );
}

const App: React.FC = () => {
  const [socket, setSocket] = useState<Socket<ServerToClientEvents, ClientToServerEvents> | null>(null);
  const [players, setPlayers] = useState<Player[]>([]);
  const [raceState, setRaceState] = useState<RaceState | null>(null);
  const [map, setMap] = useState<MapData | null>(null);
  const [results, setResults] = useState<{ playerId: string; name: string; rank: number; time: number }[] | null>(null);
  const [showGo, setShowGo] = useState(false);

  const [musicfyVoices, setMusicfyVoices] = useState<MusicfyVoice[]>([]);
  const [isLoadingVoices, setIsLoadingVoices] = useState(false);
  const [voicesError, setVoicesError] = useState<string | null>(null);
  const [selectedVoiceId, setSelectedVoiceId] = useState('');
  const [characterName, setCharacterName] = useState('');
  const [characterSpriteUrl, setCharacterSpriteUrl] = useState('');
  const [characterImageError, setCharacterImageError] = useState<string | null>(null);
  const [isReadingCharacterImage, setIsReadingCharacterImage] = useState(false);
  const [savedCharacters, setSavedCharacters] = useState<SavedCharacter[]>([]);
  const [savedCharacterId, setSavedCharacterId] = useState('');
  const [savedCharactersError, setSavedCharactersError] = useState<string | null>(null);

  const [selectedSingerIds, setSelectedSingerIds] = useState<string[]>([]);
  const [songFile, setSongFile] = useState<File | null>(null);
  const [isolateVocals, setIsolateVocals] = useState(true);
  const [isGeneratingCovers, setIsGeneratingCovers] = useState(false);
  const [coverError, setCoverError] = useState<string | null>(null);
  const [generatedCovers, setGeneratedCovers] = useState<GeneratedCover[]>([]);
  const [savedOutputs, setSavedOutputs] = useState<SavedOutput[]>([]);
  const [savedOutputsError, setSavedOutputsError] = useState<string | null>(null);

  const canvasRef = useRef<HTMLCanvasElement>(null);
  const popupRef = useRef<HTMLDivElement>(null);
  const rendererRef = useRef<Renderer | null>(null);
  const cameraRef = useRef({ x: 400, y: 0, zoom: 0.8 });
  const trackedLeaderIdRef = useRef<string | null>(null);
  const pendingLeaderRef = useRef<{ id: string; since: number } | null>(null);
  const leaderSongAudioRef = useRef<HTMLAudioElement>(null);
  const activeLeaderSongUrlRef = useRef<string | null>(null);
  const [canvasSize, setCanvasSize] = useState({ width: 1100, height: 700 });

  useEffect(() => {
    const newSocket: Socket<ServerToClientEvents, ClientToServerEvents> = io();
    setSocket(newSocket);

    newSocket.on('init', (data) => {
      setPlayers(data.players);
      setRaceState(data.currentRace);
      setMap(data.map);
    });

    newSocket.on('playerJoined', (player) => {
      setPlayers((prev) => {
        const existingIndex = prev.findIndex((p) => p.id === player.id);
        if (existingIndex === -1) return [...prev, player];

        const next = [...prev];
        next[existingIndex] = player;
        return next;
      });
    });

    newSocket.on('playerLeft', (playerId) => {
      setPlayers((prev) => prev.filter((p) => p.id !== playerId));
    });

    newSocket.on('raceUpdate', (state) => {
      setRaceState((prev) => {
        if (prev?.status === 'countdown' && state.status === 'racing') {
          setShowGo(true);
          window.setTimeout(() => setShowGo(false), 900);
        }
        return state;
      });
    });

    newSocket.on('raceStart', (mapData) => {
      setMap(mapData);
      setResults(null);
    });

    newSocket.on('raceEnd', (res) => {
      setResults(res);
    });

    return () => {
      newSocket.disconnect();
    };
  }, []);

  useEffect(() => {
    if (canvasRef.current && !rendererRef.current) {
      rendererRef.current = new Renderer(canvasRef.current);
    }
  }, []);

  useEffect(() => {
    if (!popupRef.current) return;

    const updateSize = () => {
      if (!popupRef.current) return;
      setCanvasSize({
        width: Math.max(320, Math.floor(popupRef.current.clientWidth)),
        height: Math.max(240, Math.floor(popupRef.current.clientHeight))
      });
    };

    updateSize();
    const observer = new ResizeObserver(updateSize);
    observer.observe(popupRef.current);

    return () => observer.disconnect();
  }, []);

  const loadMusicfyVoices = useCallback(async () => {
    setIsLoadingVoices(true);
    setVoicesError(null);

    try {
      const response = await fetch('/api/musicfy/voices');
      const payload = (await response.json().catch(() => ({}))) as {
        voices?: MusicfyVoice[];
        error?: unknown;
        detail?: unknown;
      };

      if (!response.ok) {
        throw new Error(getErrorMessage(payload.detail ?? payload.error, 'Failed to fetch Musicfy voices.'));
      }

      const voices = Array.isArray(payload.voices) ? payload.voices : [];
      setMusicfyVoices(voices);

      if (voices.length > 0) {
        const first = voices[0];
        setSelectedVoiceId(first.id);
        setCharacterName(first.name);
        setCharacterSpriteUrl(first.avatarUrl || `https://picsum.photos/seed/${encodeURIComponent(first.id)}/100/100`);
      }
    } catch (error) {
      setVoicesError(error instanceof Error ? error.message : 'Failed to load Musicfy voices.');
    } finally {
      setIsLoadingVoices(false);
    }
  }, []);

  const loadSavedCharacters = useCallback(async () => {
    setSavedCharactersError(null);
    try {
      const response = await fetch('/api/characters');
      const payload = (await response.json().catch(() => ({}))) as {
        characters?: SavedCharacter[];
        error?: unknown;
        detail?: unknown;
      };
      if (!response.ok) {
        throw new Error(getErrorMessage(payload.detail ?? payload.error, 'Failed to load saved characters.'));
      }

      const characters = Array.isArray(payload.characters) ? payload.characters : [];
      setSavedCharacters(characters);
    } catch (error) {
      setSavedCharactersError(error instanceof Error ? error.message : 'Failed to load saved characters.');
    }
  }, []);

  const loadSavedOutputs = useCallback(async () => {
    setSavedOutputsError(null);
    try {
      const response = await fetch('/api/generated-outputs?limit=200');
      const payload = (await response.json().catch(() => ({}))) as {
        outputs?: SavedOutput[];
        error?: unknown;
        detail?: unknown;
      };
      if (!response.ok) {
        throw new Error(getErrorMessage(payload.detail ?? payload.error, 'Failed to load saved outputs.'));
      }
      setSavedOutputs(Array.isArray(payload.outputs) ? payload.outputs : []);
    } catch (error) {
      setSavedOutputsError(error instanceof Error ? error.message : 'Failed to load saved outputs.');
    }
  }, []);

  useEffect(() => {
    loadSavedCharacters();
    loadSavedOutputs();
  }, [loadSavedCharacters, loadSavedOutputs]);

  const preferredCharacterNameByVoiceId = useMemo(() => {
    const namesByVoiceId = new Map<string, string>();
    const rememberName = (voiceId: string, name: string | null | undefined) => {
      if (!voiceId || isPlaceholderCharacterName(name)) return;
      if (!namesByVoiceId.has(voiceId)) {
        namesByVoiceId.set(voiceId, name!.trim());
      }
    };

    for (const character of savedCharacters) {
      rememberName(character.musicfyVoiceId, character.name);
    }
    for (const output of savedOutputs) {
      rememberName(output.musicfyVoiceId, output.characterName);
    }
    for (const voice of musicfyVoices) {
      rememberName(voice.id, voice.name);
    }

    return namesByVoiceId;
  }, [savedCharacters, savedOutputs, musicfyVoices]);

  const resolveCharacterName = useCallback(
    (voiceId: string, candidateName: string | null | undefined): string => {
      if (!isPlaceholderCharacterName(candidateName)) {
        return candidateName!.trim();
      }

      const preferred = preferredCharacterNameByVoiceId.get(voiceId);
      if (preferred) return preferred;

      return voiceId ? `Character ${voiceId.slice(0, 6)}` : 'Character';
    },
    [preferredCharacterNameByVoiceId]
  );

  const characterLibrary = useMemo(() => {
    const outputGroups = new Map<string, SavedOutput[]>();
    const voiceOutputGroups = new Map<string, SavedOutput[]>();

    for (const output of savedOutputs) {
      const normalizedOutputName = resolveCharacterName(output.musicfyVoiceId, output.characterName);
      const key = makeCharacterKey(normalizedOutputName, output.musicfyVoiceId);
      const group = outputGroups.get(key);
      if (group) {
        group.push(output);
      } else {
        outputGroups.set(key, [output]);
      }

      const voiceGroup = voiceOutputGroups.get(output.musicfyVoiceId);
      if (voiceGroup) {
        voiceGroup.push(output);
      } else {
        voiceOutputGroups.set(output.musicfyVoiceId, [output]);
      }
    }

    for (const group of outputGroups.values()) {
      group.sort((a, b) => b.createdAt - a.createdAt);
    }
    for (const group of voiceOutputGroups.values()) {
      group.sort((a, b) => b.createdAt - a.createdAt);
    }

    const items: CharacterLibraryItem[] = [];
    const consumedOutputKeys = new Set<string>();
    const addedCharacterKeys = new Set<string>();

    for (const character of savedCharacters) {
      const displayName = resolveCharacterName(character.musicfyVoiceId, character.name);
      const key = makeCharacterKey(displayName, character.musicfyVoiceId);
      if (addedCharacterKeys.has(key)) continue;
      addedCharacterKeys.add(key);
      const exactOutputs = outputGroups.get(key) || [];
      const outputsForCharacter = exactOutputs.length > 0 ? exactOutputs : voiceOutputGroups.get(character.musicfyVoiceId) || [];
      const latestOutput = outputsForCharacter[0] || null;
      if (exactOutputs.length > 0) consumedOutputKeys.add(key);

      items.push({
        id: character.id,
        name: displayName,
        spriteUrl: character.spriteUrl || latestOutput?.spriteUrl || fallbackSpriteForVoice(character.musicfyVoiceId),
        musicfyVoiceId: character.musicfyVoiceId,
        outputCount: outputsForCharacter.length,
        latestOutput,
        sortAt: latestOutput?.createdAt || character.updatedAt || character.createdAt
      });
    }

    for (const [key, outputsForCharacter] of outputGroups.entries()) {
      if (consumedOutputKeys.has(key)) continue;
      const latestOutput = outputsForCharacter[0] || null;
      if (!latestOutput) continue;

      const displayName = resolveCharacterName(latestOutput.musicfyVoiceId, latestOutput.characterName);
      const itemId = `generated:${key}`;
      items.push({
        id: itemId,
        name: displayName,
        spriteUrl: latestOutput.spriteUrl || fallbackSpriteForVoice(latestOutput.musicfyVoiceId),
        musicfyVoiceId: latestOutput.musicfyVoiceId,
        outputCount: outputsForCharacter.length,
        latestOutput,
        sortAt: latestOutput.createdAt
      });
    }

    items.sort((a, b) => b.sortAt - a.sortAt);
    return items;
  }, [resolveCharacterName, savedCharacters, savedOutputs]);

  useEffect(() => {
    setSavedCharacterId((current) => {
      if (current && characterLibrary.some((item) => item.id === current)) return current;
      return characterLibrary[0]?.id || '';
    });
  }, [characterLibrary]);

  const selectedSavedCharacter = useMemo(
    () => characterLibrary.find((item) => item.id === savedCharacterId) || null,
    [characterLibrary, savedCharacterId]
  );

  const musicfyPlayers = useMemo(() => players.filter((player) => Boolean(player.musicfyVoiceId)), [players]);

  useEffect(() => {
    const currentMusicfyIds = musicfyPlayers.map((player) => player.id);
    setSelectedSingerIds((prev) => {
      const kept = prev.filter((id) => currentMusicfyIds.includes(id));
      return kept.length > 0 ? kept : currentMusicfyIds;
    });
  }, [musicfyPlayers]);

  const handleVoiceSelect = (voiceId: string) => {
    setSelectedVoiceId(voiceId);
    const voice = musicfyVoices.find((item) => item.id === voiceId);
    if (!voice) return;

    setCharacterName(voice.name);
    setCharacterSpriteUrl(voice.avatarUrl || `https://picsum.photos/seed/${encodeURIComponent(voice.id)}/100/100`);
    setCharacterImageError(null);
  };

  const handleCharacterPngUpload = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const input = event.currentTarget;
    const file = input.files?.[0];
    if (!file) return;

    setCharacterImageError(null);

    const isPng = file.type === 'image/png' || file.name.toLowerCase().endsWith('.png');
    if (!isPng) {
      setCharacterImageError('Please upload a PNG file.');
      input.value = '';
      return;
    }

    if (file.size > MAX_CHARACTER_PNG_BYTES) {
      setCharacterImageError('PNG is too large. Max size is 5MB.');
      input.value = '';
      return;
    }

    setIsReadingCharacterImage(true);
    try {
      const dataUrl = await fileToDataUrl(file);
      setCharacterSpriteUrl(dataUrl);
    } catch (error) {
      setCharacterImageError(error instanceof Error ? error.message : 'Failed to read PNG file.');
    } finally {
      setIsReadingCharacterImage(false);
      input.value = '';
    }
  };

  const persistCharacter = useCallback(
    async (character: { name: string; spriteUrl: string; musicfyVoiceId: string }) => {
      const response = await fetch('/api/characters', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(character)
      });
      const payload = (await response.json().catch(() => ({}))) as {
        error?: unknown;
        detail?: unknown;
      };
      if (!response.ok) {
        throw new Error(getErrorMessage(payload.detail ?? payload.error, 'Failed to save character.'));
      }
      await loadSavedCharacters();
      setSavedCharactersError(null);
    },
    [loadSavedCharacters]
  );

  const handleUploadCharacter = () => {
    if (!socket) {
      setCoverError('Socket is not connected yet.');
      return;
    }

    if (!selectedVoiceId) {
      setCoverError('Choose a Musicfy character first.');
      return;
    }

    const selectedVoice = musicfyVoices.find((voice) => voice.id === selectedVoiceId);
    const name = resolveCharacterName(selectedVoiceId, characterName.trim() || selectedVoice?.name || 'Musicfy Character');
    const spriteUrl =
      characterSpriteUrl.trim() ||
      selectedVoice?.avatarUrl ||
      `https://picsum.photos/seed/${encodeURIComponent(selectedVoiceId)}/100/100`;

    socket.emit('addMusicfyPlayer', {
      name,
      spriteUrl,
      musicfyVoiceId: selectedVoiceId
    });

    setCoverError(null);

    persistCharacter({
      name,
      spriteUrl,
      musicfyVoiceId: selectedVoiceId
    }).catch((error) => {
      setSavedCharactersError(error instanceof Error ? error.message : 'Failed to save character.');
    });
  };

  const handleSelectSavedCharacter = (id: string) => {
    setSavedCharacterId(id);
    const character = characterLibrary.find((item) => item.id === id);
    if (!character) return;

    setCharacterName(character.name);
    setCharacterSpriteUrl(character.spriteUrl);
    setSelectedVoiceId(character.musicfyVoiceId);
    setCharacterImageError(null);
  };

  const addCharacterToRace = async (character: CharacterLibraryItem) => {
    if (!socket) {
      setCoverError('Socket is not connected yet.');
      return;
    }
    const resolvedName = resolveCharacterName(character.musicfyVoiceId, character.name);
    socket.emit('addMusicfyPlayer', {
      name: resolvedName,
      spriteUrl: character.spriteUrl,
      musicfyVoiceId: character.musicfyVoiceId
    });

    setCoverError(null);
    setSelectedVoiceId(character.musicfyVoiceId);
    setCharacterName(resolvedName);
    setCharacterSpriteUrl(character.spriteUrl);

    try {
      await persistCharacter({
        name: resolvedName,
        spriteUrl: character.spriteUrl,
        musicfyVoiceId: character.musicfyVoiceId
      });
    } catch (error) {
      setSavedCharactersError(error instanceof Error ? error.message : 'Failed to save character.');
    }
  };

  const handleUseSavedCharacter = async () => {
    const character = characterLibrary.find((item) => item.id === savedCharacterId);
    if (!character) {
      setSavedCharactersError('Select a saved character first.');
      return;
    }
    await addCharacterToRace(character);
  };

  const handleUseLibraryCharacter = async (id: string) => {
    setSavedCharacterId(id);
    const character = characterLibrary.find((item) => item.id === id);
    if (!character) {
      setSavedCharactersError('Character not found in saved library.');
      return;
    }
    await addCharacterToRace(character);
  };

  const handleToggleSinger = (playerId: string) => {
    setSelectedSingerIds((prev) => {
      if (prev.includes(playerId)) return prev.filter((id) => id !== playerId);
      return [...prev, playerId];
    });
  };

  const handleGenerateCovers = async () => {
    if (!songFile) {
      setCoverError('Upload a song first.');
      return;
    }

    const selectedPlayers = musicfyPlayers.filter(
      (player) => selectedSingerIds.includes(player.id) && player.musicfyVoiceId
    );

    if (selectedPlayers.length === 0) {
      setCoverError('Select at least one Musicfy player to sing.');
      return;
    }

    const selectedPlayersWithNames = selectedPlayers.map((player) => ({
      player,
      displayName: resolveCharacterName(player.musicfyVoiceId!, player.name)
    }));

    setIsGeneratingCovers(true);
    setCoverError(null);
    setGeneratedCovers(
      selectedPlayersWithNames.map(({ player, displayName }) => ({
        playerId: player.id,
        playerName: displayName,
        status: 'processing'
      }))
    );

    const covers = await Promise.all(
      selectedPlayersWithNames.map(async ({ player, displayName }): Promise<GeneratedCover> => {
        try {
          const formData = new FormData();
          formData.append('file', songFile);
          formData.append('voice_id', player.musicfyVoiceId!);
          formData.append('isolate_vocals', String(isolateVocals));
          formData.append('character_name', displayName);
          formData.append('character_sprite_url', player.spriteUrl);
          formData.append('source_file_name', songFile.name);

          const response = await fetch('/api/musicfy/convert-voice', {
            method: 'POST',
            body: formData
          });

          const payload = (await response.json().catch(() => ({}))) as {
            audioUrl?: unknown;
            savedAudioUrl?: unknown;
            error?: unknown;
            detail?: unknown;
          };

          if (!response.ok) {
            throw new Error(getErrorMessage(payload.detail ?? payload.error, 'Musicfy conversion failed.'));
          }

          const audioUrl =
            (typeof payload.savedAudioUrl === 'string' ? payload.savedAudioUrl : undefined) ||
            (typeof payload.audioUrl === 'string' ? payload.audioUrl : undefined);
          if (!audioUrl) {
            throw new Error('Musicfy returned no audio URL.');
          }

          return {
            playerId: player.id,
            playerName: displayName,
            status: 'success',
            audioUrl
          };
        } catch (error) {
          return {
            playerId: player.id,
            playerName: displayName,
            status: 'error',
            error: error instanceof Error ? error.message : 'Unknown conversion error.'
          };
        }
      })
    );

    setGeneratedCovers(covers);

    const allFailed = covers.every((cover) => cover.status === 'error');
    if (allFailed) {
      setCoverError('All conversions failed. Check your Musicfy API key and try another file.');
    }

    setIsGeneratingCovers(false);
    await loadSavedOutputs();
  };

  // Game Loop
  useEffect(() => {
    let animationFrameId: number;
    const LEADER_SWITCH_GRACE_MS = 140;
    const LEADER_SWITCH_MARGIN = 10;

    const loop = () => {
      if (rendererRef.current && map && raceState) {
        // Camera logic: follow leader vertically with switch grace period
        const balls = Object.values(raceState.balls) as BallState[];
        if (balls.length > 0) {
          const now = performance.now();
          const sortedByProgress = [...balls].sort((a, b) => b.progress - a.progress);
          const topBall = sortedByProgress[0];

          if (!trackedLeaderIdRef.current) {
            trackedLeaderIdRef.current = topBall.id;
          }

          const currentTracked = balls.find((ball) => ball.id === trackedLeaderIdRef.current) || topBall;

          if (topBall.id !== currentTracked.id) {
            const progressGap = topBall.progress - currentTracked.progress;

            if (progressGap > LEADER_SWITCH_MARGIN) {
              trackedLeaderIdRef.current = topBall.id;
              pendingLeaderRef.current = null;
            } else if (pendingLeaderRef.current?.id === topBall.id) {
              if (now - pendingLeaderRef.current.since >= LEADER_SWITCH_GRACE_MS) {
                trackedLeaderIdRef.current = topBall.id;
                pendingLeaderRef.current = null;
              }
            } else {
              pendingLeaderRef.current = { id: topBall.id, since: now };
            }
          } else {
            pendingLeaderRef.current = null;
          }

          const trackedLeader = balls.find((ball) => ball.id === trackedLeaderIdRef.current) || topBall;

          // Keep horizontal camera centered on course; only follow vertical movement.
          const targetX = 400;
          const targetY = trackedLeader.position.y;

          cameraRef.current.x += (targetX - cameraRef.current.x) * 0.12;
          cameraRef.current.y += (targetY - cameraRef.current.y) * 0.1;

          rendererRef.current.setCamera(cameraRef.current.x, cameraRef.current.y, cameraRef.current.zoom);
        } else {
          // If no balls, center on the course and reset tracked leader state.
          trackedLeaderIdRef.current = null;
          pendingLeaderRef.current = null;
          cameraRef.current.x += (400 - cameraRef.current.x) * 0.1;
          cameraRef.current.y += (0 - cameraRef.current.y) * 0.1;
          rendererRef.current.setCamera(cameraRef.current.x, cameraRef.current.y, cameraRef.current.zoom);
        }

        rendererRef.current.render(map, raceState, players);
      }
      animationFrameId = requestAnimationFrame(loop);
    };

    loop();
    return () => cancelAnimationFrame(animationFrameId);
  }, [map, raceState, players]);

  const handleStartRace = () => {
    if (socket) {
      socket.emit('startRace', 'map1');
    }
  };

  const handleRemovePlayer = (playerId: string) => {
    if (!socket) {
      setCoverError('Socket is not connected yet.');
      return;
    }
    socket.emit('removePlayer', playerId);
  };

  const winner = useMemo(() => {
    if (!results || results.length === 0) return null;
    return results[0];
  }, [results]);

  const winnerPlayer = useMemo(() => {
    if (!winner) return null;
    return players.find((player) => player.id === winner.playerId) || null;
  }, [players, winner]);

  const liveLeaderPlayer = useMemo(() => {
    if (!raceState || raceState.status !== 'racing') return null;
    const balls = Object.values(raceState.balls) as BallState[];
    if (balls.length === 0) return null;

    const leaderBall = [...balls].sort((a, b) => b.progress - a.progress)[0];
    return players.find((player) => player.id === leaderBall.id) || null;
  }, [players, raceState]);

  const successfulCoverByPlayerId = useMemo(() => {
    const coversByPlayer = new Map<string, GeneratedCover>();
    for (const cover of generatedCovers) {
      if (cover.status !== 'success' || !cover.audioUrl) continue;
      coversByPlayer.set(cover.playerId, cover);
    }
    return coversByPlayer;
  }, [generatedCovers]);

  const latestSavedOutputByVoiceId = useMemo(() => {
    const outputsByVoice = new Map<string, SavedOutput>();
    for (const output of savedOutputs) {
      const existing = outputsByVoice.get(output.musicfyVoiceId);
      if (!existing || output.createdAt > existing.createdAt) {
        outputsByVoice.set(output.musicfyVoiceId, output);
      }
    }
    return outputsByVoice;
  }, [savedOutputs]);

  const latestSavedOutputByCharacterName = useMemo(() => {
    const outputsByName = new Map<string, SavedOutput>();
    for (const output of savedOutputs) {
      const key = normalizeCharacterName(resolveCharacterName(output.musicfyVoiceId, output.characterName));
      if (!key) continue;
      const existing = outputsByName.get(key);
      if (!existing || output.createdAt > existing.createdAt) {
        outputsByName.set(key, output);
      }
    }
    return outputsByName;
  }, [resolveCharacterName, savedOutputs]);

  const liveLeaderSong = useMemo(() => {
    if (!liveLeaderPlayer) return null;

    const generatedCover = successfulCoverByPlayerId.get(liveLeaderPlayer.id);
    if (generatedCover?.audioUrl) {
      return { audioUrl: generatedCover.audioUrl, source: 'session' as const };
    }

    if (liveLeaderPlayer.musicfyVoiceId) {
      const savedOutput = latestSavedOutputByVoiceId.get(liveLeaderPlayer.musicfyVoiceId);
      if (savedOutput?.savedAudioUrl) {
        return { audioUrl: savedOutput.savedAudioUrl, source: 'saved' as const };
      }
    }

    const fallbackByName = latestSavedOutputByCharacterName.get(
      normalizeCharacterName(resolveCharacterName(liveLeaderPlayer.musicfyVoiceId || '', liveLeaderPlayer.name))
    );
    if (!fallbackByName?.savedAudioUrl) return null;

    return { audioUrl: fallbackByName.savedAudioUrl, source: 'saved' as const };
  }, [liveLeaderPlayer, successfulCoverByPlayerId, latestSavedOutputByVoiceId, latestSavedOutputByCharacterName]);

  const liveLeaderSongUrl = liveLeaderSong?.audioUrl ?? null;

  useEffect(() => {
    const audio = leaderSongAudioRef.current;
    if (!audio) return;

    const shouldPlayLeaderSong = raceState?.status === 'racing' && Boolean(liveLeaderSongUrl);
    if (!shouldPlayLeaderSong) {
      if (activeLeaderSongUrlRef.current) {
        audio.pause();
        audio.removeAttribute('src');
        audio.load();
        activeLeaderSongUrlRef.current = null;
      }
      return;
    }

    if (activeLeaderSongUrlRef.current !== liveLeaderSongUrl) {
      activeLeaderSongUrlRef.current = liveLeaderSongUrl;
      audio.src = liveLeaderSongUrl!;
      audio.currentTime = 0;
      audio.load();
    }

    void audio.play().catch(() => undefined);
  }, [liveLeaderSongUrl, raceState?.status]);

  return (
    <div className="min-h-screen w-full bg-[#0a0a0a] text-white font-sans flex items-center justify-center p-4">
      <div
        ref={popupRef}
        className="relative w-full max-w-[1200px] h-[86vh] max-h-[760px] min-h-[520px] bg-[#050505] rounded-3xl border border-white/10 shadow-2xl overflow-hidden"
      >
        {/* HUD: Top Bar */}
        <div className="absolute top-0 left-0 right-0 p-4 flex justify-between items-start z-10 pointer-events-none">
          <div className="flex flex-col gap-2 pointer-events-auto">
            <div className="bg-black/40 backdrop-blur-md border border-white/10 p-3 rounded-xl flex items-center gap-3 shadow-xl">
              <Trophy className="w-4 h-4 text-emerald-400" />
              <p className="text-sm font-black uppercase tracking-tighter">{map?.name || 'Marble Race'}</p>
            </div>
          </div>

          {liveLeaderPlayer && (
            <div className="absolute left-1/2 -translate-x-1/2 top-4 pointer-events-none">
              <div className="bg-black/45 backdrop-blur-md border border-white/10 px-4 py-3 rounded-2xl shadow-xl flex items-center gap-3">
                <img
                  src={liveLeaderPlayer.spriteUrl}
                  alt={liveLeaderPlayer.name}
                  className="w-16 h-16 rounded-full border-2 border-white/40 object-cover"
                />
                <div className="min-w-0">
                  <p className="text-xs font-black uppercase tracking-tighter truncate max-w-[170px]">{liveLeaderPlayer.name}</p>
                  <p className="text-[10px] uppercase tracking-[0.2em] text-emerald-200/80">
                    {liveLeaderSong ? 'Now Playing' : 'No song yet'}
                  </p>
                </div>
              </div>
            </div>
          )}

          <div className="flex flex-col items-end gap-2 pointer-events-auto">
            {(raceState?.status === 'waiting' || raceState?.status === 'finished') && (
              <button
                onClick={handleStartRace}
                className="bg-white text-black font-black px-6 py-3 rounded-xl transition-all shadow-xl flex items-center gap-2 uppercase tracking-tighter hover:scale-105 active:scale-95"
              >
                <Play className="w-4 h-4 fill-current" /> {raceState?.status === 'finished' ? 'Restart' : 'Start'}
              </button>
            )}
          </div>
        </div>

        {(raceState?.status === 'countdown' || showGo) && (
          <div className="absolute inset-0 flex items-center justify-center pointer-events-none z-50">
            <motion.div
              key={showGo ? 'go' : raceState?.countdown}
              initial={{ scale: 0.5, opacity: 0 }}
              animate={{ scale: 1.2, opacity: 1 }}
              exit={{ scale: 2, opacity: 0 }}
              className="text-white font-black text-[200px] drop-shadow-[0_10px_10px_rgba(0,0,0,0.5)] stroke-black"
              style={{ WebkitTextStroke: '8px black' }}
            >
              {showGo ? 'GO!' : raceState?.countdown}
            </motion.div>
          </div>
        )}

        {/* Musicfy Controls */}
        <div className="absolute top-16 left-4 bottom-16 w-72 z-10 pointer-events-none">
          <div className="bg-black/40 backdrop-blur-md border border-white/10 p-4 rounded-2xl shadow-xl pointer-events-auto max-h-full overflow-y-auto space-y-3">
            <div className="flex items-center justify-between gap-3">
              <p className="text-[10px] font-black uppercase tracking-[0.2em] text-white/50">Musicfy Studio</p>
              <button
                onClick={loadMusicfyVoices}
                disabled={isLoadingVoices}
                className="text-[10px] font-black uppercase tracking-tighter px-2 py-1 rounded-lg border border-white/20 bg-white/10 hover:bg-white/20 disabled:opacity-60"
              >
                {isLoadingVoices ? (
                  <span className="inline-flex items-center gap-1">
                    <LoaderCircle className="w-3 h-3 animate-spin" /> Loading
                  </span>
                ) : (
                  'Load Characters'
                )}
              </button>
            </div>

            {voicesError && <p className="text-[11px] text-red-300">{voicesError}</p>}

            <div className="space-y-1">
              <label className="text-[10px] font-black uppercase tracking-[0.2em] text-white/40">Saved Characters + Songs</label>
              <select
                value={savedCharacterId}
                onChange={(event) => handleSelectSavedCharacter(event.target.value)}
                className="w-full bg-black/60 border border-white/15 rounded-lg px-2 py-2 text-xs font-semibold outline-none focus:border-white/40"
              >
                <option value="">Select saved character</option>
                {characterLibrary.map((character) => (
                  <option key={character.id} value={character.id}>
                    {character.name}
                    {character.outputCount > 0 ? ` (${character.outputCount} song${character.outputCount === 1 ? '' : 's'})` : ''}
                  </option>
                ))}
              </select>
              <button
                onClick={handleUseSavedCharacter}
                disabled={!savedCharacterId}
                className="w-full bg-white/15 text-white font-black px-3 py-1.5 rounded-lg text-[10px] uppercase tracking-tighter disabled:opacity-50"
              >
                Use Saved Character
              </button>
              {savedCharactersError && <p className="text-[11px] text-red-300">{savedCharactersError}</p>}
              {selectedSavedCharacter && (
                <div className="mt-2 p-2 rounded-lg bg-white/5 border border-white/10 space-y-1">
                  <div className="flex items-center gap-2">
                    <img
                      src={selectedSavedCharacter.spriteUrl}
                      alt={selectedSavedCharacter.name}
                      className="w-9 h-9 rounded-full border border-white/20 object-cover"
                    />
                    <div className="min-w-0">
                      <p className="text-xs font-black tracking-tighter truncate">{selectedSavedCharacter.name}</p>
                      <p className="text-[10px] uppercase tracking-[0.15em] text-white/45">
                        {selectedSavedCharacter.outputCount > 0
                          ? `${selectedSavedCharacter.outputCount} saved song${selectedSavedCharacter.outputCount === 1 ? '' : 's'}`
                          : 'No saved songs yet'}
                      </p>
                    </div>
                  </div>
                  {selectedSavedCharacter.latestOutput?.savedAudioUrl ? (
                    <audio controls src={selectedSavedCharacter.latestOutput.savedAudioUrl} className="w-full h-8" />
                  ) : (
                    <p className="text-[11px] text-white/50">Generate a song to attach one to this character.</p>
                  )}
                </div>
              )}
            </div>

            <div className="space-y-1">
              <label className="text-[10px] font-black uppercase tracking-[0.2em] text-white/40">Character</label>
              <select
                value={selectedVoiceId}
                onChange={(event) => handleVoiceSelect(event.target.value)}
                className="w-full bg-black/60 border border-white/15 rounded-lg px-2 py-2 text-xs font-semibold outline-none focus:border-white/40"
              >
                <option value="">Select Musicfy character</option>
                {musicfyVoices.map((voice) => (
                  <option key={voice.id} value={voice.id}>
                    {voice.name}
                  </option>
                ))}
              </select>
            </div>

            <div className="space-y-1">
              <label className="text-[10px] font-black uppercase tracking-[0.2em] text-white/40">Player Name</label>
              <input
                value={characterName}
                onChange={(event) => setCharacterName(event.target.value)}
                placeholder="Character name"
                className="w-full bg-black/60 border border-white/15 rounded-lg px-2 py-2 text-xs font-semibold outline-none focus:border-white/40"
              />
            </div>

            <div className="space-y-1">
              <label className="text-[10px] font-black uppercase tracking-[0.2em] text-white/40">Image URL</label>
              <input
                value={characterSpriteUrl}
                onChange={(event) => setCharacterSpriteUrl(event.target.value)}
                placeholder="https://..."
                className="w-full bg-black/60 border border-white/15 rounded-lg px-2 py-2 text-xs font-semibold outline-none focus:border-white/40"
              />
            </div>

            <div className="space-y-1">
              <label className="text-[10px] font-black uppercase tracking-[0.2em] text-white/40">Or Upload PNG</label>
              <input
                type="file"
                accept=".png,image/png"
                onChange={handleCharacterPngUpload}
                className="w-full text-xs file:mr-2 file:px-2 file:py-1 file:rounded file:border-0 file:bg-white/15 file:text-white file:font-semibold"
              />
              {isReadingCharacterImage && <p className="text-[11px] text-white/60">Reading PNG...</p>}
              {characterImageError && <p className="text-[11px] text-red-300">{characterImageError}</p>}
            </div>

            <button
              onClick={handleUploadCharacter}
              className="w-full bg-white text-black font-black px-3 py-2 rounded-xl transition-all shadow-xl flex items-center justify-center gap-2 uppercase text-xs tracking-tighter hover:scale-[1.02] active:scale-95"
            >
              <Upload className="w-3.5 h-3.5" /> Upload Character
            </button>

            <div className="border-t border-white/10" />

            <div className="flex items-center gap-2">
              <Music2 className="w-4 h-4 text-emerald-300" />
              <p className="text-[10px] font-black uppercase tracking-[0.2em] text-white/50">Song To Voice</p>
            </div>

            {musicfyPlayers.length === 0 ? (
              <p className="text-[11px] text-white/50">Upload a Musicfy character first, then choose who should sing.</p>
            ) : (
              <div className="space-y-1">
                {musicfyPlayers.map((player) => (
                  <label key={player.id} className="flex items-center gap-2 text-xs bg-white/5 border border-white/10 rounded-lg px-2 py-1.5">
                    <input
                      type="checkbox"
                      checked={selectedSingerIds.includes(player.id)}
                      onChange={() => handleToggleSinger(player.id)}
                    />
                    <span className="truncate">{player.name}</span>
                  </label>
                ))}
              </div>
            )}

            <div className="space-y-1">
              <label className="text-[10px] font-black uppercase tracking-[0.2em] text-white/40">Song File</label>
              <input
                type="file"
                accept="audio/*"
                onChange={(event) => setSongFile(event.target.files?.[0] || null)}
                className="w-full text-xs file:mr-2 file:px-2 file:py-1 file:rounded file:border-0 file:bg-white/15 file:text-white file:font-semibold"
              />
            </div>

            <label className="flex items-center gap-2 text-xs text-white/70">
              <input type="checkbox" checked={isolateVocals} onChange={(event) => setIsolateVocals(event.target.checked)} />
              Isolate vocals before conversion
            </label>

            <button
              onClick={handleGenerateCovers}
              disabled={isGeneratingCovers}
              className="w-full bg-emerald-300 text-black font-black px-3 py-2 rounded-xl transition-all shadow-xl uppercase text-xs tracking-tighter hover:scale-[1.02] active:scale-95 disabled:opacity-70"
            >
              {isGeneratingCovers ? 'Generating...' : 'Upload Song & Generate'}
            </button>

            {coverError && <p className="text-[11px] text-red-300">{coverError}</p>}

            {generatedCovers.length > 0 && (
              <div className="space-y-2">
                {generatedCovers.map((cover) => (
                  <div key={cover.playerId} className="p-2 rounded-lg bg-white/5 border border-white/10 space-y-1">
                    <p className="text-xs font-black tracking-tighter">{cover.playerName}</p>
                    {cover.status === 'processing' && <p className="text-[11px] text-white/50">Processing...</p>}
                    {cover.status === 'error' && <p className="text-[11px] text-red-300">{cover.error}</p>}
                    {cover.status === 'success' && cover.audioUrl && (
                      <audio controls src={cover.audioUrl} className="w-full h-8" />
                    )}
                  </div>
                ))}
              </div>
            )}

            <div className="border-t border-white/10" />
            <p className="text-[10px] font-black uppercase tracking-[0.2em] text-white/50">Character Library</p>
            {savedOutputsError && <p className="text-[11px] text-red-300">{savedOutputsError}</p>}
            {characterLibrary.length === 0 ? (
              <p className="text-[11px] text-white/50">No saved characters or songs yet.</p>
            ) : (
              <div className="space-y-2">
                {characterLibrary.slice(0, 12).map((character) => (
                  <div key={character.id} className="p-2 rounded-lg bg-white/5 border border-white/10 space-y-1.5">
                    <div className="flex items-center gap-2">
                      <img
                        src={character.spriteUrl}
                        alt={character.name}
                        className="w-8 h-8 rounded-full border border-white/20 object-cover"
                      />
                      <div className="min-w-0 flex-1">
                        <p className="text-xs font-black tracking-tighter truncate">{character.name}</p>
                        <p className="text-[10px] uppercase tracking-[0.15em] text-white/45">
                          {character.outputCount} song{character.outputCount === 1 ? '' : 's'}
                        </p>
                      </div>
                      <button
                        onClick={() => {
                          void handleUseLibraryCharacter(character.id);
                        }}
                        className="px-2 py-1 rounded bg-white/15 text-[10px] font-black uppercase tracking-tighter hover:bg-white/25"
                      >
                        Add
                      </button>
                    </div>
                    {character.latestOutput?.savedAudioUrl ? (
                      <audio controls src={character.latestOutput.savedAudioUrl} className="w-full h-8" />
                    ) : (
                      <p className="text-[11px] text-white/50">No song saved for this character yet.</p>
                    )}
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>

        {/* Leaderboard: Right Side */}
        <div className="absolute top-16 right-4 bottom-16 w-48 z-10 pointer-events-none">
          <div className="bg-black/40 backdrop-blur-md border border-white/10 p-4 rounded-2xl shadow-xl pointer-events-auto max-h-full overflow-y-auto">
            <div className="space-y-2">
              {(Object.values(raceState?.balls || {}) as BallState[])
                .sort((a, b) => b.progress - a.progress)
                .map((ball, idx) => {
                  const player = players.find((p) => p.id === ball.id);
                  return (
                    <div key={ball.id} className="flex items-center justify-between gap-2 p-1.5 rounded-lg bg-white/5 border border-white/5">
                      <div className="flex items-center gap-2">
                        <span className="text-[10px] font-black text-white/40">{idx + 1}</span>
                        <span className="text-xs font-black uppercase tracking-tighter truncate max-w-[80px]">{player?.name}</span>
                        <button
                          onClick={() => handleRemovePlayer(ball.id)}
                          className="w-4 h-4 rounded bg-white/10 text-[10px] font-black leading-none text-white/70 hover:bg-red-500/80 hover:text-white"
                          title={`Remove ${player?.name || 'player'}`}
                        >
                          x
                        </button>
                      </div>
                      {ball.finished && <Trophy className="w-3 h-3 text-yellow-400" />}
                    </div>
                  );
                })}
            </div>
          </div>
        </div>

        {/* Main Canvas */}
        <canvas ref={canvasRef} width={canvasSize.width} height={canvasSize.height} className="w-full h-full cursor-crosshair" />

        {/* Results Modal */}
        <AnimatePresence>
          {results && (
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              className="absolute inset-0 z-50 flex items-center justify-center p-4 pointer-events-none"
            >
              <motion.div
                initial={{ scale: 0.9, y: 24, opacity: 0 }}
                animate={{ scale: 1, y: 0, opacity: 1 }}
                exit={{ scale: 0.9, y: 24, opacity: 0 }}
                className="w-[320px] max-w-full bg-black/90 rounded-2xl border border-white/15 p-4 shadow-2xl pointer-events-auto"
              >
                <div className="flex items-center justify-between mb-3">
                  <h2 className="text-xs font-black uppercase tracking-[0.2em] text-white/50">Winner</h2>
                  <button
                    onClick={() => setResults(null)}
                    className="text-xs font-black uppercase tracking-tighter text-white/60 hover:text-white"
                  >
                    Close
                  </button>
                </div>

                {winner && (
                  <div className="mb-4 p-3 rounded-xl border border-white/20 bg-white/10 text-center">
                    {winnerPlayer?.spriteUrl && (
                      <img
                        src={winnerPlayer.spriteUrl}
                        alt={winner.name}
                        className="w-14 h-14 rounded-full mx-auto mb-2 border-2 border-white/40 object-cover"
                      />
                    )}
                    <p className="text-xl font-black tracking-tighter">{winner.name} wins!</p>
                  </div>
                )}

                <div className="space-y-1.5">
                  {results.slice(0, 3).map((res, idx) => (
                    <div
                      key={res.playerId}
                      className={`flex items-center justify-between p-2 rounded-lg border ${
                        idx === 0 ? 'bg-white/10 border-white/30' : 'bg-white/5 border-white/10'
                      }`}
                    >
                      <div className="flex items-center gap-3">
                        <span className={`text-sm font-black ${idx === 0 ? 'text-white' : 'text-white/30'}`}>{idx + 1}</span>
                        <span className="text-xs font-black tracking-tighter">{res.name}</span>
                      </div>
                      <span className="font-mono text-xs text-white/40">{(res.time / 1000).toFixed(2)}s</span>
                    </div>
                  ))}
                </div>
              </motion.div>
            </motion.div>
          )}
        </AnimatePresence>

        {/* Footer Info */}
        <div className="absolute bottom-4 left-4 z-10">
          <div className="bg-black/40 backdrop-blur-md border border-white/10 px-3 py-1.5 rounded-xl text-[10px] font-black uppercase tracking-tighter text-white/40 flex items-center gap-2">
            <Camera className="w-3 h-3" /> Tracking Leader
          </div>
        </div>

        <audio ref={leaderSongAudioRef} loop preload="none" className="hidden" />
      </div>
    </div>
  );
};

export default App;
