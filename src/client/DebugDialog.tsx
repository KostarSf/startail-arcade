import { useState } from "react";
import { clientEngine } from "./engine";

export function DebugDialog() {
  const [isOpen, setIsOpen] = useState(false);
  const [drawGrid, setDrawGrid] = useState(() => clientEngine.getDrawGrid());
  const [drawWorldBorder, setDrawWorldBorder] = useState(() =>
    clientEngine.getDrawWorldBorder()
  );
  const [drawColliders, setDrawColliders] = useState(() =>
    clientEngine.getDrawColliders()
  );
  const [disableInterpolation, setDisableInterpolation] = useState(() =>
    clientEngine.getDisableInterpolation()
  );
  const [disableReconciliation, setDisableReconciliation] = useState(() =>
    clientEngine.getDisableReconciliation()
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

  const handleDrawCollidersToggle = (checked: boolean) => {
    setDrawColliders(checked);
    clientEngine.setDrawColliders(checked);
  };

  const handleDisableInterpolationToggle = (checked: boolean) => {
    setDisableInterpolation(checked);
    clientEngine.setDisableInterpolation(checked);
  };

  const handleDisableReconciliationToggle = (checked: boolean) => {
    setDisableReconciliation(checked);
    clientEngine.setDisableReconciliation(checked);
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
    <div className="absolute top-4 right-4 pointer-events-auto z-50 flex flex-col items-end gap-2">
      <button
        type="button"
        onClick={() => setIsOpen((current) => !current)}
        className="rounded border border-gray-700 bg-gray-900/90 px-3 py-2 text-sm font-bold text-white"
      >
        {isOpen ? "Hide Debug" : "Debug"}
      </button>
      {isOpen ? (
        <div className="rounded border border-gray-700 bg-gray-900/90 p-4">
          <h3 className="mb-3 text-sm font-bold text-white">Debug</h3>
          <div className="space-y-3">
            <label className="flex cursor-pointer items-center gap-2 text-sm text-white">
              <input
                type="checkbox"
                checked={drawGrid}
                onChange={(e) => handleGridToggle(e.target.checked)}
                className="h-4 w-4"
              />
              <span>Draw Grid</span>
            </label>
            <label className="flex cursor-pointer items-center gap-2 text-sm text-white">
              <input
                type="checkbox"
                checked={drawColliders}
                onChange={(e) => handleDrawCollidersToggle(e.target.checked)}
                className="h-4 w-4"
              />
              <span>Draw Colliders</span>
            </label>
            <label className="flex cursor-pointer items-center gap-2 text-sm text-white">
              <input
                type="checkbox"
                checked={drawWorldBorder}
                onChange={(e) => handleWorldBorderToggle(e.target.checked)}
                className="h-4 w-4"
              />
              <span>World Border</span>
            </label>
            <label className="flex cursor-pointer items-center gap-2 text-sm text-white">
              <input
                type="checkbox"
                checked={disableInterpolation}
                onChange={(e) =>
                  handleDisableInterpolationToggle(e.target.checked)
                }
                className="h-4 w-4"
              />
              <span>Disable Interpolation</span>
            </label>
            <label className="flex cursor-pointer items-center gap-2 text-sm text-white">
              <input
                type="checkbox"
                checked={disableReconciliation}
                onChange={(e) =>
                  handleDisableReconciliationToggle(e.target.checked)
                }
                className="h-4 w-4"
              />
              <span>Disable Reconciliation</span>
            </label>
            <div className="flex items-center gap-2">
              <label className="whitespace-nowrap text-sm text-white">
                Simulated Latency:
              </label>
              <input
                type="number"
                value={latencyInput}
                onChange={(e) => setLatencyInput(e.target.value)}
                onBlur={handleLatencyBlur}
                onKeyDown={handleLatencyKeyDown}
                min="0"
                className="w-20 rounded border border-gray-600 bg-gray-800 px-2 py-1 text-sm text-white"
              />
              <span className="text-xs text-gray-400">ms</span>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}
