import "./index.css";
import { useStats } from "./store";

export function App() {
  return (
    <div className="p-4 z-10">
      <PlayerStats />
    </div>
  );
}

function PlayerStats() {
  const stats = useStats();

  const predictedServerTime = Math.floor(performance.now() + stats.offset);

  return (
    <div>
      <p className="text-sm">Player ID: {stats.playerId}</p>
      <p className="text-sm">Rotation: {stats.playerObject?.rotation}</p>
      <p className="text-sm">
        Position: {stats.playerObject?.x}, {stats.playerObject?.y}
      </p>
      {stats.hasTimeSync ? (
        <>
          <p className="text-xs text-gray-500">
            Ping: {Math.floor((stats.latency / 2) * 100) / 100}
          </p>
          <p className="text-xs text-gray-500">
            Offset: {Math.floor(stats.offset * 100) / 100}
          </p>
          <p className="text-xs text-gray-500">
            Server Time Prediction: {predictedServerTime}
          </p>
        </>
      ) : null}
    </div>
  );
}

export default App;
