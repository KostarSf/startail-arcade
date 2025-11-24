import { level } from "@/shared/game/entities/player";
import { useEffect, useRef, useState } from "react";
import {
  adjectives,
  animals,
  uniqueNamesGenerator,
} from "unique-names-generator";
import cursorImage from "./assets/images/cursor.png";
import { AudioSettings } from "./AudioSettings";
import { DebugDialog } from "./DebugDialog";
import { clientEngine } from "./engine";
import "./index.css";
import { useStats } from "./store";

const VERSION = "v0.3.2";
const DEBUG = false;

export function App() {
  // Set custom cursor on mount
  useEffect(() => {
    document.body.style.cursor = `url(${cursorImage}), auto`;
    return () => {
      document.body.style.cursor = "";
    };
  }, []);

  return (
    <>
      <ConnectionError />
      <div className="p-4 z-10">
        <PlayerStats />
      </div>
      <GameTagline />
      <Leaderboard />
      <Radar />
      <LevelBar />
      <FloatingScoreTexts />
      <RespawnButton />
      <BottomRightButtons />
      {DEBUG ? <DebugDialog /> : null}
    </>
  );
}

function GameTagline() {
  const stats = useStats();

  // Only show tagline when player is not spawned (when respawn button would show)
  const showTagline =
    stats.playerId !== null &&
    stats.playerObject === null &&
    stats.deathPosition === null;

  const showComponent = stats.playerObject === null;

  if (!showComponent) return null;

  return (
    <div className="fixed top-20 left-0 right-0 flex justify-center z-40 pointer-events-none">
      <div className="game-tagline pointer-events-none">
        <h1 className="game-title">STARTAIL ARCADE</h1>
        {showTagline ? (
          <>
            <p className="tagline-line">Destroy asteroids.</p>
            <p className="tagline-line">Eliminate rivals.</p>
            <p className="tagline-line">Climb the leaderboard.</p>
          </>
        ) : null}
      </div>
    </div>
  );
}

function PlayerStats() {
  const stats = useStats();

  const predictedServerTime = Math.floor(performance.now() + stats.offset);

  const formatNetworkSpeed = (kbPerSecond: number): string => {
    const roundedKbPerSecond = kbPerSecond.toFixed(1);

    const kbitPerSecond = kbPerSecond * 8;
    if (kbitPerSecond >= 1000) {
      const mbitPerSecond = kbitPerSecond / 1000;
      return `${mbitPerSecond.toFixed(1)}mbit / ${roundedKbPerSecond}kb`;
    }
    return `${Math.round(kbitPerSecond)}kbit / ${roundedKbPerSecond}kb`;
  };

  const serverTickDuration = stats.tickDuration.toFixed(1);
  const serverTps = Math.min(
    Math.round((1000 / stats.tickDuration) * 10) / 10,
    20
  );

  return (
    <div className="font-mono">
      {DEBUG ? <p className="text-sm">Player ID: {stats.playerId}</p> : null}
      <p className="text-sm">FPS: {Math.round(stats.fps || 0)}</p>
      <p className="text-xs text-gray-500">objects: {stats.objectsCount}</p>
      {DEBUG ? (
        <>
          <p className="text-sm">
            pos: {Math.floor((stats.playerObject?.x ?? 0) * 10) / 10},{" "}
            {Math.floor((stats.playerObject?.y ?? 0) * 10) / 10}
          </p>
          <p className="text-sm">rot: {stats.playerObject?.rotation}</p>
        </>
      ) : null}
      {stats.hasTimeSync ? (
        <>
          <p className="text-xs text-gray-500">
            income: {formatNetworkSpeed(stats.inboundBytesPerSecond)}
          </p>
          <p className="text-xs text-gray-500">
            outcome: {formatNetworkSpeed(stats.outboundBytesPerSecond)}
          </p>
          <p className="text-xs text-gray-500">
            tps: {serverTps} / {serverTickDuration}ms
          </p>
          <p className="text-xs text-gray-500">
            ping: {(stats.latency / 2).toFixed(1)}
          </p>
          {DEBUG ? (
            <>
              <p className="text-xs text-gray-500">
                offset: {Math.floor(stats.offset * 100) / 100}
              </p>
              <p className="text-xs text-gray-500">
                server time: {predictedServerTime}
              </p>
            </>
          ) : null}
        </>
      ) : null}
    </div>
  );
}

function RespawnButton() {
  const stats = useStats();
  const [playerName, setPlayerName] = useState<string>("");

  // Load name from localStorage on mount, or generate new one if missing
  useEffect(() => {
    const STORAGE_KEY = "playerName";

    // Try to load from localStorage
    const savedName = localStorage.getItem(STORAGE_KEY);

    if (savedName && savedName.trim().length > 0 && savedName.length <= 20) {
      // Use saved name if valid
      setPlayerName(savedName.trim());
    } else {
      // Generate default unique 2-word name if not found or invalid
      let defaultName: string | undefined;

      let attempts = 0;

      while (
        !defaultName ||
        defaultName.length > 20 ||
        stats.players.some((p) => p.name === defaultName)
      ) {
        defaultName = uniqueNamesGenerator({
          dictionaries: [adjectives, animals],
          separator: " ",
          length: 2,
          style: "capital",
        });

        attempts++;

        if (attempts > 10) break;
      }

      if (defaultName) {
        setPlayerName(defaultName);
      }
    }
  }, []);

  // Show button only after receiving server:player-initialize (playerId is set)
  // and when playerObject is null (not spawned yet or destroyed)
  // Hide button when playerObject exists (player is alive and spawned)
  // Also show during reconnection to indicate status
  const shouldShow =
    (stats.playerId !== null && stats.playerObject === null) ||
    stats.isReconnecting;

  if (!shouldShow) return null;

  // Show different text based on reconnecting state
  let buttonText: string;
  let isDisabled = false;

  if (stats.isReconnecting) {
    buttonText = "RECONNECTING...";
    isDisabled = true;
  } else {
    // Show "Respawn" if deathPosition is set (player died), otherwise "Play" (waiting to spawn)
    buttonText = stats.deathPosition !== null ? "RESPAWN" : "PLAY";
  }

  const handleSubmit = (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    if (isDisabled) return; // Don't allow submit while reconnecting

    // Save current username to localStorage when player starts to play
    const trimmedName = playerName.trim();
    if (trimmedName.length > 0 && trimmedName.length <= 20) {
      localStorage.setItem("playerName", trimmedName);
    }

    // Play click sound
    clientEngine.playUIClick();
    // Send respawn command to spawn the player ship
    // This works for both initial spawn (deathPosition is null) and respawn after death
    clientEngine.respawn(trimmedName);
  };

  return (
    <>
      <p className="fixed bottom-4 left-5 z-50 pointer-events-none font-mono text-xs">
        {VERSION}
      </p>
      <form
        onSubmit={handleSubmit}
        className="fixed inset-0 flex flex-col items-center justify-center z-50 pointer-events-none"
      >
        {!stats.isReconnecting && (
          <div className="mb-4 pointer-events-auto">
            <input
              type="text"
              value={playerName}
              onChange={(e) => setPlayerName(e.target.value)}
              onKeyDown={() => clientEngine.playUIType()}
              onFocus={() => clientEngine.playUIHover()}
              className="name-input"
              placeholder="Enter your name"
              maxLength={20}
            />
            {stats.respawnError && (
              <div className="respawn-error">{stats.respawnError}</div>
            )}
          </div>
        )}
        <button
          type="submit"
          className={`respawn-button pointer-events-auto ${
            stats.isReconnecting ? "reconnecting" : ""
          }`}
          onMouseEnter={() =>
            !stats.isReconnecting && clientEngine.playUIHover()
          }
          disabled={isDisabled}
        >
          {buttonText}
        </button>
      </form>
    </>
  );
}

function Leaderboard() {
  const stats = useStats();

  // Only show leaderboard when player is alive
  if (!stats.playerObject) return null;

  // Filter alive players and sort by score descending
  const alivePlayers = stats.players
    .filter((p) => p.alive)
    .sort((a, b) => b.score - a.score);

  // Take top 5
  let topPlayers = alivePlayers.slice(0, 5);

  // Always show local player - if not in top 5, add as 6th
  const currentPlayer = stats.players.find((p) => p.id === stats.playerId);
  const isPlayerInTop5 = topPlayers.some((p) => p.id === stats.playerId);

  if (currentPlayer && currentPlayer.alive && !isPlayerInTop5) {
    topPlayers = [...topPlayers, currentPlayer];
  }

  // Calculate score range for normalization
  const maxScore = topPlayers[0]?.score ?? 0;
  const minScore = topPlayers[topPlayers.length - 1]?.score ?? 0;
  const scoreRange = maxScore - minScore;

  // Total player count
  const totalPlayers = stats.players.length;

  return (
    <div className="fixed top-4 right-4 z-10 pointer-events-none">
      <div className="leaderboard">
        <div className="leaderboard-title">TOP PLAYERS</div>
        <div className="leaderboard-list">
          {topPlayers.map((player, index) => {
            const isCurrentPlayer = player.id === stats.playerId;
            const normalizedScore =
              scoreRange > 0 ? (player.score - minScore) / scoreRange : 1;
            const barWidth = Math.max(normalizedScore * 240, 24); // Min 24px

            // Show separator before 6th player if it's the current player
            const showSeparator = index === 5 && isCurrentPlayer;

            // Calculate player's actual rank in all alive players
            const playerRank =
              alivePlayers.findIndex((p) => p.id === player.id) + 1;

            return (
              <div key={player.id}>
                {showSeparator && <div className="leaderboard-separator" />}
                <div className="leaderboard-item">
                  <div
                    className={`leaderboard-bar ${
                      isCurrentPlayer ? "current-player" : ""
                    }`}
                    style={{ width: `${barWidth}px` }}
                  />
                  <div className="leaderboard-text">
                    <span className="leaderboard-rank">#{playerRank}</span>
                    <span className="leaderboard-name">{player.name}</span>
                    <span className="leaderboard-score">{player.score}</span>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
        <div className="leaderboard-footer">PLAYERS: {totalPlayers}</div>
      </div>
    </div>
  );
}

function Radar() {
  const stats = useStats();
  const canvasRef = useRef<HTMLCanvasElement>(null);

  // Account for border (3px) and padding (3px) - inner space is 144x144
  const radarSize = 144;
  const worldRadius = stats.worldRadius;

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || !stats.radarData) return;

    const ctx = canvas.getContext("2d", { alpha: true });
    if (!ctx) return;

    // Optimize canvas rendering
    ctx.imageSmoothingEnabled = false;

    // Clear canvas
    ctx.clearRect(0, 0, radarSize, radarSize);

    // Group dots by type for efficient batch rendering
    const players: typeof stats.radarData = [];
    const ships: typeof stats.radarData = [];
    const asteroids: typeof stats.radarData = [];

    for (const point of stats.radarData) {
      if (point.type === "player") {
        players.push(point);
      } else if (point.type === "asteroid") {
        asteroids.push(point);
      } else {
        ships.push(point);
      }
    }

    // Draw asteroids (most common, smallest)
    if (asteroids.length > 0) {
      ctx.fillStyle = "#505050";
      ctx.shadowColor = "#505050";
      ctx.shadowBlur = 2;
      for (const point of asteroids) {
        const normalizedX = (point.x + worldRadius) / (2 * worldRadius);
        const normalizedY = (point.y + worldRadius) / (2 * worldRadius);
        const radarX = normalizedX * radarSize;
        const radarY = normalizedY * radarSize;
        ctx.beginPath();
        ctx.arc(radarX, radarY, 1, 0, Math.PI * 2);
        ctx.fill();
      }
    }

    // Draw ships
    if (ships.length > 0) {
      ctx.fillStyle = "white";
      ctx.shadowColor = "white";
      ctx.shadowBlur = 2;
      for (const point of ships) {
        const normalizedX = (point.x + worldRadius) / (2 * worldRadius);
        const normalizedY = (point.y + worldRadius) / (2 * worldRadius);
        const radarX = normalizedX * radarSize;
        const radarY = normalizedY * radarSize;
        ctx.beginPath();
        ctx.arc(radarX, radarY, 1.5, 0, Math.PI * 2);
        ctx.fill();
      }
    }

    // Draw player (usually just one)
    if (players.length > 0) {
      ctx.fillStyle = "#fbbf24";
      ctx.shadowColor = "#fbbf24";
      ctx.shadowBlur = 4;
      for (const point of players) {
        const normalizedX = (point.x + worldRadius) / (2 * worldRadius);
        const normalizedY = (point.y + worldRadius) / (2 * worldRadius);
        const radarX = normalizedX * radarSize;
        const radarY = normalizedY * radarSize;
        ctx.beginPath();
        ctx.arc(radarX, radarY, 2, 0, Math.PI * 2);
        ctx.fill();
      }
    }

    // Reset shadow for next frame
    ctx.shadowBlur = 0;
  }, [stats.radarData, worldRadius, radarSize]);

  // Only show radar when player is alive
  if (!stats.playerObject || !stats.radarData) return null;

  return (
    <div className="radar-container">
      <canvas
        ref={canvasRef}
        width={radarSize}
        height={radarSize}
        className="radar-canvas"
      />
    </div>
  );
}

function ConnectionError() {
  const stats = useStats();

  if (!stats.connectionError) return null;

  return (
    <div className="connection-error-overlay">
      <div className="connection-error-container">
        <div className="connection-error-title">CONNECTION FAILED</div>
        <div className="connection-error-message">
          Unable to connect to the game server.
          <br />
          Please wait a bit and try again.
        </div>
        <button
          onClick={() => {
            clientEngine.playUIClick();
            window.location.reload();
          }}
          onMouseEnter={() => clientEngine.playUIHover()}
          className="connection-error-button"
        >
          RELOAD PAGE
        </button>
      </div>
    </div>
  );
}

function HelpButton() {
  return (
    <div className="relative group pointer-events-auto">
      <button
        className="help-button"
        aria-label="Help"
        onMouseEnter={() => clientEngine.playUIHover()}
      >
        ?
      </button>
      <div className="help-dialog opacity-0 invisible group-hover:opacity-100 group-hover:visible transition-opacity duration-200 pointer-events-auto">
        <div className="help-dialog-content">
          <div className="help-item">
            <span className="help-key">MOUSE</span>
            <span className="help-action">rotate</span>
          </div>
          <div className="help-item">
            <span className="help-key">W</span>
            <span className="help-action">accelerate</span>
          </div>
          <div className="help-item">
            <span className="help-key">LMB</span>
            <span className="help-action">fire</span>
          </div>
          <div className="help-item">
            <span className="help-key">Shift</span>
            <span className="help-action">freeze camera</span>
          </div>
        </div>
      </div>
    </div>
  );
}

function LevelBar() {
  const stats = useStats();

  // Only show level bar when player exists and is alive
  if (!stats.playerObject) return null;

  // Get current player from players array
  const currentPlayer = stats.players.find((p) => p.id === stats.playerId);
  if (!currentPlayer) return null;

  // Use player's score as XP
  const xp = currentPlayer.score;
  const currentLevel = level.levelFromXp(xp);

  // Calculate XP progress to next level
  const xpForCurrentLevel = level.xpTotalForLevel(currentLevel);
  const xpForNextLevel = level.xpTotalForLevel(currentLevel + 1);
  const xpNeededForNextLevel = xpForNextLevel - xpForCurrentLevel;
  const xpProgress = xp - xpForCurrentLevel;
  const progressPercent = Math.min(
    (xpProgress / xpNeededForNextLevel) * 100,
    100
  );

  return (
    <div className="level-bar">
      <div className="level-bar-label">LEVEL {currentLevel}</div>
      <div className="level-bar-progress-container">
        <div
          className="level-bar-progress-fill"
          style={{ width: `${progressPercent}%` }}
        />
      </div>
    </div>
  );
}

function FloatingScoreTexts() {
  const floatingScoreTexts = useStats((state) => state.floatingScoreTexts);
  const removeFloatingScoreText = useStats((state) => state.removeFloatingScoreText);

  useEffect(() => {
    // Clean up old texts (older than 1.2 seconds to ensure animation completes)
    const interval = setInterval(() => {
      const now = performance.now();
      floatingScoreTexts.forEach((text) => {
        if (now - text.startTime > 1200) {
          removeFloatingScoreText(text.id);
        }
      });
    }, 100);

    return () => clearInterval(interval);
  }, [floatingScoreTexts, removeFloatingScoreText]);

  if (floatingScoreTexts.length === 0) return null;

  return (
    <>
      {floatingScoreTexts.map((text) => (
        <FloatingScoreText
          key={text.id}
          id={text.id}
          value={text.value}
          startTime={text.startTime}
        />
      ))}
    </>
  );
}

function FloatingScoreText({
  id,
  value,
  startTime,
}: {
  id: number;
  value: number;
  startTime: number;
}) {
  const removeFloatingScoreText = useStats((state) => state.removeFloatingScoreText);
  const [opacity, setOpacity] = useState(1);
  const [translateY, setTranslateY] = useState(0);

  useEffect(() => {
    const duration = 1000; // 1 second
    let animationFrame: number;

    // Ease-out cubic function: starts fast, slows down
    const easeOutCubic = (t: number): number => {
      return 1 - Math.pow(1 - t, 3);
    };

    const animate = () => {
      const now = performance.now();
      const elapsed = now - startTime;
      const linearProgress = Math.min(elapsed / duration, 1);

      // Apply easing function for smooth deceleration
      const easedProgress = easeOutCubic(linearProgress);

      // Fly up: move from 0 to -60px with easing
      setTranslateY(-60 * easedProgress);

      // Fade out: opacity from 1 to 0 with easing
      setOpacity(1 - easedProgress);

      if (linearProgress < 1) {
        animationFrame = requestAnimationFrame(animate);
      } else {
        // Remove from store when animation completes
        removeFloatingScoreText(id);
      }
    };

    animationFrame = requestAnimationFrame(animate);

    return () => {
      if (animationFrame) {
        cancelAnimationFrame(animationFrame);
      }
    };
  }, [id, startTime, removeFloatingScoreText]);

  return (
    <div
      className="floating-score-text"
      style={{
        opacity,
        transform: `translateX(-50%) translateY(${translateY}px)`,
      }}
    >
      +{value}
    </div>
  );
}

function BottomRightButtons() {
  return (
    <div className="fixed bottom-4 right-4 z-50 pointer-events-none">
      <div className="flex flex-row items-end gap-2">
        {/* Help button to the left, sound button to the right */}
        <HelpButton />
        <AudioSettings />
      </div>
    </div>
  );
}

export default App;
