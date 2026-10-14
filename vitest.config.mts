import { storybookTest } from "@storybook/addon-vitest/vitest-plugin";
import { playwright } from "@vitest/browser-playwright";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { defineConfig, defineProject } from "vitest/config";

const dirname = path.dirname(fileURLToPath(import.meta.url));

const sharedResolve = {
  alias: {
    "@": path.resolve(dirname, "src"),
  },
  tsconfigPaths: true,
} as const;

export default defineConfig({
  resolve: sharedResolve,
  test: {
    projects: [
      defineProject({
        resolve: sharedResolve,
        test: {
          environment: "node",
          include: ["tests/unit/**/*.test.{mjs,ts,tsx}"],
          name: "unit",
          sequence: {
            groupOrder: 0,
          },
        },
      }),
      defineProject({
        resolve: sharedResolve,
        test: {
          environment: "node",
          fileParallelism: false,
          globalSetup: ["tests/setup/integration-global-setup.ts"],
          include: ["tests/integration/**/*.test.{ts,tsx}"],
          name: "integration",
          pool: "forks",
          sequence: {
            concurrent: false,
            groupOrder: 2,
          },
        },
      }),
      defineProject({
        resolve: sharedResolve,
        test: {
          environment: "node",
          fileParallelism: false,
          globalSetup: ["tests/setup/migration-global-setup.ts"],
          include: ["tests/migrations/**/*.test.mjs"],
          name: "migrations",
          pool: "forks",
          sequence: {
            concurrent: false,
            groupOrder: 3,
          },
          testTimeout: 120_000,
        },
      }),
      {
        extends: true,
        plugins: [
          storybookTest({
            configDir: path.join(dirname, ".storybook"),
          }),
        ],
        test: {
          browser: {
            enabled: true,
            headless: true,
            instances: [{ browser: "chromium" }],
            provider: playwright({}),
          },
          name: "storybook",
          sequence: {
            groupOrder: 1,
          },
          setupFiles: [".storybook/vitest.setup.ts"],
        },
      },
    ],
  },
});
