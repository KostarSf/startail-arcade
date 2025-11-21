import { createRoot } from "react-dom/client";

import { App } from "./App";
import { init } from "./engine";

async function checkSupport() {
  try {
    const response = await fetch("/check-support");
    const data = await response.json();
    if (!data.supported) {
      window.location.href = "/not-supported";
      return false;
    }
    return true;
  } catch (error) {
    console.error("Failed to check support:", error);
    return true; // Allow to continue if check fails
  }
}

async function start() {
  const isSupported = await checkSupport();
  if (!isSupported) {
    return;
  }

  const root = createRoot(document.getElementById("ui")!);
  root.render(<App />);
  init(document.getElementById("game")!);
}

if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", start);
} else {
  start();
}
