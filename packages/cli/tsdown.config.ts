import { defineConfig } from "tsdown";

// The core and shared logic are bundled in, so the built file runs on its own
export default defineConfig({
  entry: ["./src/cli.ts"],
  platform: "node",
  format: "esm",
  sourcemap: true,
  clean: true,
  deps: {
    alwaysBundle: [/^@caido-community\/breadcrumb-core/, "shared"],
  },
});
