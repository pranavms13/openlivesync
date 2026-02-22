import { defineConfig } from "tsup";

export default defineConfig({
  entry: ["src/index.ts", "src/react-entry.tsx"],
  format: ["esm"],
  dts: true,
  sourcemap: true,
  clean: true,
  target: "es2020",
  outDir: "dist",
  external: ["react"],
  esbuildOptions(options) {
    options.jsx = "automatic";
  },
});
