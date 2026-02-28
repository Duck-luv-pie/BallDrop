import React, { useEffect, useRef, useState, useMemo } from 'react';
import { io, Socket } from 'socket.io-client';
import { MapData, RaceState, Player, BallState, ServerToClientEvents, ClientToServerEvents } from './types';
import { Renderer } from './game/Renderer';
import { Trophy, Play, Camera, ChevronRight, User, Image as ImageIcon } from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';

const App: React.FC = () => {
  const [socket, setSocket] = useState<Socket<ServerToClientEvents, ClientToServerEvents> | null>(null);
  const [players, setPlayers] = useState<Player[]>([]);
  const [raceState, setRaceState] = useState<RaceState | null>(null);
  const [map, setMap] = useState<MapData | null>(null);
  const [joined, setJoined] = useState(true);
  const [playerName, setPlayerName] = useState('');
  const [spriteUrl, setSpriteUrl] = useState('');
  const [results, setResults] = useState<{ playerId: string; name: string; rank: number; time: number }[] | null>(null);
  const [showGo, setShowGo] = useState(false);

  const canvasRef = useRef<HTMLCanvasElement>(null);
  const popupRef = useRef<HTMLDivElement>(null);
  const rendererRef = useRef<Renderer | null>(null);
  const cameraRef = useRef({ x: 400, y: 0, zoom: 0.8 });
  const trackedLeaderIdRef = useRef<string | null>(null);
  const pendingLeaderRef = useRef<{ id: string; since: number } | null>(null);
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
      setPlayers(prev => [...prev, player]);
    });

    newSocket.on('playerLeft', (playerId) => {
      setPlayers(prev => prev.filter(p => p.id !== playerId));
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
  }, [joined]);

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

          const currentTracked = balls.find(ball => ball.id === trackedLeaderIdRef.current) || topBall;

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

          const trackedLeader = balls.find(ball => ball.id === trackedLeaderIdRef.current) || topBall;

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

  const winner = useMemo(() => {
    if (!results || results.length === 0) return null;
    return results[0];
  }, [results]);

  const winnerPlayer = useMemo(() => {
    if (!winner) return null;
    return players.find(player => player.id === winner.playerId) || null;
  }, [players, winner]);

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

      {/* Leaderboard: Right Side */}
      <div className="absolute top-16 right-4 bottom-16 w-48 z-10 pointer-events-none">
        <div className="bg-black/40 backdrop-blur-md border border-white/10 p-4 rounded-2xl shadow-xl pointer-events-auto max-h-full overflow-y-auto">
          <div className="space-y-2">
            {(Object.values(raceState?.balls || {}) as BallState[])
              .sort((a, b) => b.progress - a.progress)
              .map((ball, idx) => {
                const player = players.find(p => p.id === ball.id);
                return (
                  <div key={ball.id} className="flex items-center justify-between gap-2 p-1.5 rounded-lg bg-white/5 border border-white/5">
                    <div className="flex items-center gap-2">
                      <span className="text-[10px] font-black text-white/40">{idx + 1}</span>
                      <span className="text-xs font-black uppercase tracking-tighter truncate max-w-[80px]">{player?.name}</span>
                    </div>
                    {ball.finished && <Trophy className="w-3 h-3 text-yellow-400" />}
                  </div>
                );
              })}
          </div>
        </div>
      </div>

      {/* Main Canvas */}
      <canvas
        ref={canvasRef}
        width={canvasSize.width}
        height={canvasSize.height}
        className="w-full h-full cursor-crosshair"
      />

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
                  <div key={res.playerId} className={`flex items-center justify-between p-2 rounded-lg border ${idx === 0 ? 'bg-white/10 border-white/30' : 'bg-white/5 border-white/10'}`}>
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
      </div>
    </div>
  );
};

export default App;
