import { createRoot } from "react-dom/client";

import { App } from "./App";
import { init } from "./engine";

function start() {
  const root = createRoot(document.getElementById("ui")!);
  root.render(<App />);
  init(document.getElementById("game")!);
}

if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", start);
} else {
  start();
}
