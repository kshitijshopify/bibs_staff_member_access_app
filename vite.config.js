import { reactRouter } from "@react-router/dev/vite";
import { defineConfig, loadEnv } from "vite";
import tsconfigPaths from "vite-tsconfig-paths";

export default defineConfig(({ mode }) => {
  // Running `npx vite dev` directly — developing against a live store without
  // `shopify app dev` — means nothing injects the app's env vars, and Vite
  // does not copy .env onto process.env (it only exposes VITE_* to the client).
  // Fill in whatever is missing so the host/port config below and the app
  // server both see it. Real environment variables still win, so the Shopify
  // CLI keeps control when it is the one starting Vite.
  const fileEnv = loadEnv(mode, process.cwd(), "");
  for (const [key, value] of Object.entries(fileEnv)) {
    if (process.env[key] === undefined) {
      process.env[key] = value;
    }
  }

  // Related: https://github.com/remix-run/remix/issues/2835#issuecomment-1144102176
  // Replace the HOST env var with SHOPIFY_APP_URL so that it doesn't break the Vite server.
  // The CLI will eventually stop passing in HOST,
  // so we can remove this workaround after the next major release.
  if (
    process.env.HOST &&
    (!process.env.SHOPIFY_APP_URL ||
      process.env.SHOPIFY_APP_URL === process.env.HOST)
  ) {
    process.env.SHOPIFY_APP_URL = process.env.HOST;
    delete process.env.HOST;
  }

  const host = new URL(process.env.SHOPIFY_APP_URL || "http://localhost")
    .hostname;
  let hmrConfig;

  if (host === "localhost") {
    hmrConfig = {
      protocol: "ws",
      host: "localhost",
      port: 64999,
      clientPort: 64999,
    };
  } else {
    hmrConfig = {
      protocol: "wss",
      host: host,
      port: parseInt(process.env.FRONTEND_PORT) || 8002,
      clientPort: 443,
    };
  }

  return {
    server: {
      allowedHosts: [host],
      cors: {
        // Let the cors middleware answer OPTIONS itself (204) instead of
        // passing it down the chain. React Router rejects OPTIONS outright
        // with `Invalid request method "OPTIONS"` -> 405. Under
        // `shopify app dev` the CLI proxy answered preflights before Vite saw
        // them; running Vite directly, nothing sits in front of it.
        preflightContinue: false,
      },
      port: Number(process.env.PORT || 3000),
      hmr: hmrConfig,
      fs: {
        // See https://vitejs.dev/config/server-options.html#server-fs-allow for more information
        allow: ["app", "node_modules"],
      },
    },
    plugins: [reactRouter(), tsconfigPaths()],
    build: {
      assetsInlineLimit: 0,
    },
    optimizeDeps: {
      include: ["@shopify/app-bridge-react"],
    },
  };
});
