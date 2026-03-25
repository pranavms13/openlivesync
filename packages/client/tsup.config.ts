import { defineConfig } from "tsup";

export default defineConfig({
  entry: ["src/index.ts", "src/react-entry.tsx", "src/yjs-provider.ts", "src/yjs-react.tsx"],
  format: ["esm"],
  dts: true,
  sourcemap: true,
  clean: true,
  target: "es2020",
  outDir: "dist",
  external: ["react", "yjs", "y-protocols", "lib0"],
  esbuildOptions(options) {
    options.jsx = "automatic";
  },
});
