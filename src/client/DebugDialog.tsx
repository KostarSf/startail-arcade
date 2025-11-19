import { useState } from "react";
import { clientEngine } from "./engine";

export function DebugDialog() {
  const [drawGrid, setDrawGrid] = useState(() => clientEngine.getDrawGrid());
  const [drawWorldBorder, setDrawWorldBorder] = useState(() =>
    clientEngine.getDrawWorldBorder()
  );
  const [latencyInput, setLatencyInput] = useState(() =>
    clientEngine.getSimulatedLatency().toString()
  );

  const handleGridToggle = (checked: boolean) => {
    setDrawGrid(checked);
    clientEngine.setDrawGrid(checked);
    // State and URL param updated, no reload needed - grid system reads current state via getters
  };

  const handleWorldBorderToggle = (checked: boolean) => {
    setDrawWorldBorder(checked);
    clientEngine.setDrawWorldBorder(checked);
    // State and URL param updated, no reload needed - grid system reads current state via getters
  };

  const handleLatencyBlur = () => {
    const numValue = parseInt(latencyInput, 10);
    if (!isNaN(numValue) && numValue >= 0) {
      clientEngine.setSimulatedLatency(numValue);
      // Update URL param
      const url = new URL(window.location.href);
      if (numValue > 0) {
        url.searchParams.set("sim-latency", numValue.toString());
      } else {
        url.searchParams.delete("sim-latency");
      }
      window.history.replaceState({}, "", url.toString());
      // No reload needed - simulated latency is read dynamically
    } else {
      // Reset to current value if invalid
      setLatencyInput(clientEngine.getSimulatedLatency().toString());
    }
  };

  const handleLatencyKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Enter") {
      handleLatencyBlur();
    }
  };

  return (
    <div className="absolute top-4 right-4 bg-gray-900 bg-opacity-90 border border-gray-700 rounded p-4 pointer-events-auto z-50">
      <h3 className="text-white font-bold mb-3 text-sm">Debug</h3>
      <div className="space-y-3">
        <label className="flex items-center gap-2 text-white text-sm cursor-pointer">
          <input
            type="checkbox"
            checked={drawGrid}
            onChange={(e) => handleGridToggle(e.target.checked)}
            className="w-4 h-4"
          />
          <span>Draw Grid</span>
        </label>
        <label className="flex items-center gap-2 text-white text-sm cursor-pointer">
          <input
            type="checkbox"
            checked={drawWorldBorder}
            onChange={(e) => handleWorldBorderToggle(e.target.checked)}
            className="w-4 h-4"
          />
          <span>World Border</span>
        </label>
        <div className="flex items-center gap-2">
          <label className="text-white text-sm whitespace-nowrap">
            Simulated Latency:
          </label>
          <input
            type="number"
            value={latencyInput}
            onChange={(e) => setLatencyInput(e.target.value)}
            onBlur={handleLatencyBlur}
            onKeyDown={handleLatencyKeyDown}
            min="0"
            className="w-20 px-2 py-1 bg-gray-800 text-white border border-gray-600 rounded text-sm"
          />
          <span className="text-gray-400 text-xs">ms</span>
        </div>
      </div>
    </div>
  );
}
