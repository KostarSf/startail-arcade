import { clientEngine } from "./engine";

export type StartailTestApi = {
  ping: () => string;
  respawn: (name: string) => void;
  sendInput: (input: {
    thrust: boolean;
    angle: number;
    fire: boolean;
    firingCompensation?: boolean;
  }) => void;
  configureDebug: (options: {
    drawGrid?: boolean;
    drawWorldBorder?: boolean;
    drawColliders?: boolean;
    simulatedLatencyMs?: number;
    disableInterpolation?: boolean;
      disableReconciliation?: boolean;
  }) => void;
  getSnapshot: () => ReturnType<typeof clientEngine.getRuntimeSnapshot>;
  getDebugNetworkSnapshot: () => ReturnType<
    typeof clientEngine.getDebugNetworkSnapshot
  >;
};

declare global {
  interface Window {
    __STARTAIL_TEST_API__?: StartailTestApi;
  }
}

export function installTestApi() {
  window.__STARTAIL_TEST_API__ = {
    ping: () => "pong",
    respawn: (name: string) => {
      clientEngine.respawn(name);
    },
    sendInput: (input) => {
      clientEngine.sendInputForTest(input);
    },
    configureDebug: (options) => {
      clientEngine.setDebugOptions(options);
    },
    getSnapshot: () => clientEngine.getRuntimeSnapshot(),
    getDebugNetworkSnapshot: () => clientEngine.getDebugNetworkSnapshot(),
  };

  console.info("[agent] test API ready");
}
