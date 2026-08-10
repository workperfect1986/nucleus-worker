import { Plugin } from "vite";

export function sites(): Plugin {
  return {
    name: "sites-vite-plugin-placeholder",
    // Minimal placeholder — original project may enhance this. Keeps builds working after cleaning node_modules.
  } as Plugin;
}
