import { defineConfig } from "@playwright/test";

export default defineConfig({
  testDir: "./tests/probe",
  timeout: 120_000,
  fullyParallel: false,
  use: {
    channel: process.env.PLAYWRIGHT_CHANNEL || undefined,
    headless: process.env.PROBE_HEADED !== "1",
    launchOptions: {
      args: [
        "--enable-webgl",
        "--ignore-gpu-blocklist",
        "--use-angle=swiftshader",
      ],
    },
  },
});
