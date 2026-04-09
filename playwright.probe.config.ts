import { defineConfig } from "@playwright/test";

export default defineConfig({
  testDir: "./tests/probe",
  timeout: 120_000,
  fullyParallel: false,
  use: {
    headless: true,
    launchOptions: {
      args: [
        "--enable-webgl",
        "--ignore-gpu-blocklist",
        "--use-angle=swiftshader",
      ],
    },
  },
});
