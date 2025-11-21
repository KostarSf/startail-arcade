import { useEffect, useState } from "react";
import {
  adjectives,
  animals,
  uniqueNamesGenerator,
} from "unique-names-generator";
import { DebugDialog } from "./DebugDialog";
import { clientEngine } from "./engine";
import "./index.css";
import { useStats } from "./store";

const DEBUG = false;

export function App() {
  return (
    <>
      <div className="p-4 z-10">
        <PlayerStats />
      </div>
      <RespawnButton />
      <HelpButton />
      {DEBUG ? <DebugDialog /> : null}
    </>
  );
}

function PlayerStats() {
  const stats = useStats();

  const predictedServerTime = Math.floor(performance.now() + stats.offset);

  return (
    <div className="font-mono">
      {DEBUG ? <p className="text-sm">Player ID: {stats.playerId}</p> : null}
      <p className="text-sm">FPS: {Math.round(stats.fps || 0)}</p>
      <p className="text-xs text-gray-500">Objects: {stats.objectsCount}</p>
      {DEBUG ? (
        <>
          <p className="text-sm">
            Position: {Math.floor((stats.playerObject?.x ?? 0) * 10) / 10},{" "}
            {Math.floor((stats.playerObject?.y ?? 0) * 10) / 10}
          </p>
          <p className="text-sm">Rotation: {stats.playerObject?.rotation}</p>
        </>
      ) : null}
      {stats.hasTimeSync ? (
        <>
          <p className="text-xs text-gray-500">
            Ping: {Math.floor((stats.latency / 2) * 100) / 100}
          </p>
          {DEBUG ? (
            <>
              <p className="text-xs text-gray-500">
                Offset: {Math.floor(stats.offset * 100) / 100}
              </p>
              <p className="text-xs text-gray-500">
                Server Time Estimated: {predictedServerTime}
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
    const defaultName = uniqueNamesGenerator({
      dictionaries: [adjectives, animals],
      separator: " ",
      length: 2,
      style: "capital",
    });
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
    // Send respawn command to spawn the player ship
    // This works for both initial spawn (deathPosition is null) and respawn after death
    clientEngine.respawn(playerName);
  };

  return (
    <form
      onSubmit={handleSubmit}
      className="fixed inset-0 flex flex-col items-center justify-center z-50 pointer-events-none"
    >
      <div className="mb-4 pointer-events-auto">
        <input
          type="text"
          value={playerName}
          onChange={(e) => setPlayerName(e.target.value)}
          className="name-input"
          placeholder="Enter your name"
          maxLength={20}
        />
      </div>
      <button type="submit" className="respawn-button pointer-events-auto">
        {buttonText}
      </button>
    </form>
  );
}

function HelpButton() {
  return (
    <div className="fixed bottom-4 right-4 z-50 pointer-events-none">
      <div className="relative group">
        <button className="help-button pointer-events-auto" aria-label="Help">
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
    </div>
  );
}

export default App;
