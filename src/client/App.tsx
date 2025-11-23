import { useEffect, useState } from "react";
import {
  adjectives,
  animals,
  uniqueNamesGenerator,
} from "unique-names-generator";
import { AudioSettings } from "./AudioSettings";
import { DebugDialog } from "./DebugDialog";
import { clientEngine } from "./engine";
import "./index.css";
import { useStats } from "./store";
import cursorImage from "./assets/images/cursor.png";

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

  // Generate default unique 2-word name on mount
  useEffect(() => {
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

    setPlayerName(defaultName);
  }, []);

  // Show button only after receiving server:player-initialize (playerId is set)
  // and when playerObject is null (not spawned yet or destroyed)
  // Hide button when playerObject exists (player is alive and spawned)
  const shouldShow = stats.playerId !== null && stats.playerObject === null;

  if (!shouldShow) return null;

  // Show "Respawn" if deathPosition is set (player died), otherwise "Play" (waiting to spawn)
  const buttonText = stats.deathPosition !== null ? "RESPAWN" : "PLAY";

  const handleSubmit = (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    // Play click sound
    clientEngine.playUIClick();
    // Send respawn command to spawn the player ship
    // This works for both initial spawn (deathPosition is null) and respawn after death
    clientEngine.respawn(playerName);
  };

  return (
    <>
      <p className="fixed bottom-4 left-5 z-50 pointer-events-none font-mono text-xs">v0.1.1</p>
      <form
        onSubmit={handleSubmit}
        className="fixed inset-0 flex flex-col items-center justify-center z-50 pointer-events-none"
      >
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
        <button
          type="submit"
          className="respawn-button pointer-events-auto"
          onMouseEnter={() => clientEngine.playUIHover()}
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

  // Only show radar when player is alive
  if (!stats.playerObject || !stats.radarData) return null;

  // Account for border (3px) and padding (3px) - inner space is 144x144
  const radarSize = 144;
  const worldRadius = stats.worldRadius;

  return (
    <div className="radar-container">
      {stats.radarData.map((point, index) => {
        // Calculate normalized position (0 to 1)
        const normalizedX = (point.x + worldRadius) / (2 * worldRadius);
        const normalizedY = (point.y + worldRadius) / (2 * worldRadius);

        // Convert to radar pixel position
        const radarX = normalizedX * radarSize;
        const radarY = normalizedY * radarSize;

        const isPlayer = point.type === "player";
        const dotSize = isPlayer ? 4 : 3;

        return (
          <div
            key={`${point.type}-${index}`}
            className={`radar-dot ${
              isPlayer ? "radar-dot-player" : "radar-dot-ship"
            }`}
            style={{
              left: `${radarX}px`,
              top: `${radarY}px`,
              width: `${dotSize}px`,
              height: `${dotSize}px`,
              transform: `translate(-${dotSize / 2}px, -${dotSize / 2}px)`,
            }}
          />
        );
      })}
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
