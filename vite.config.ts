import { defineConfig } from "vite";
import { tanstackStart } from "@tanstack/react-start/plugin/vite";
import tailwindcss from "@tailwindcss/vite";
import tsconfigPaths from "vite-tsconfig-paths";
import { nitro } from "nitro/vite";
import { apiDevPlugin } from "./src/server/vite-api-plugin";

export default defineConfig(({ command }) => ({
  plugins: [
    tanstackStart({
      server: { entry: "server" },
    }),
    tailwindcss(),
    tsconfigPaths(),
    ...(command === "build"
      ? [
          nitro({
            defaultPreset: process.env["NITRO_PRESET"] || "node-server",
          }),
        ]
      : []),
    apiDevPlugin(),
  ],
  resolve: {
    alias: [{ find: "punycode/", replacement: "punycode" }],
  },
  nitro: {
    alias: {
      "punycode/": "punycode",
    },
  },
}));
