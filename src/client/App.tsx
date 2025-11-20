import "./index.css";
import { useStats } from "./store";
import { DebugDialog } from "./DebugDialog";
import { clientEngine } from "./engine";

export function App() {
  return (
    <>
      <div className="p-4 z-10">
        <PlayerStats />
      </div>
      <RespawnButton />
      <DebugDialog />
    </>
  );
}

function PlayerStats() {
  const stats = useStats();

  const predictedServerTime = Math.floor(performance.now() + stats.offset);

  return (
    <div className="font-mono">
      <p className="text-sm">Player ID: {stats.playerId}</p>
      <p className="text-sm">
        FPS: {Math.round(stats.fps || 0)}
      </p>
      <p className="text-sm">
        Position: {Math.floor((stats.playerObject?.x ?? 0) * 10) / 10},{" "}
        {Math.floor((stats.playerObject?.y ?? 0) * 10) / 10}
      </p>
      <p className="text-sm">Rotation: {stats.playerObject?.rotation}</p>
      <p className="text-sm">Objects: {stats.objectsCount}</p>
      {stats.hasTimeSync ? (
        <>
          <p className="text-xs text-gray-500">
            Ping: {Math.floor((stats.latency / 2) * 100) / 100}
          </p>
          <p className="text-xs text-gray-500">
            Offset: {Math.floor(stats.offset * 100) / 100}
          </p>
          <p className="text-xs text-gray-500">
            Server Time Estimated: {predictedServerTime}
          </p>
        </>
      ) : null}
    </div>
  );
}

function RespawnButton() {
  const stats = useStats();

  // Show button only after receiving server:player-initialize (playerId is set)
  // and when playerObject is null (not spawned yet or destroyed)
  // Hide button when playerObject exists (player is alive and spawned)
  const shouldShow = stats.playerId !== null && stats.playerObject === null;

  if (!shouldShow) return null;

  // Show "Respawn" if deathPosition is set (player died), otherwise "Play" (waiting to spawn)
  const buttonText = stats.deathPosition !== null ? "RESPAWN" : "PLAY";

  const handleClick = () => {
    // Send respawn command to spawn the player ship
    // This works for both initial spawn (deathPosition is null) and respawn after death
    clientEngine.respawn();
  };

  return (
    <div className="fixed inset-0 flex items-center justify-center z-50 pointer-events-none">
      <button
        onClick={handleClick}
        className="respawn-button pointer-events-auto"
      >
        {buttonText}
      </button>
    </div>
  );
}

export default App;
