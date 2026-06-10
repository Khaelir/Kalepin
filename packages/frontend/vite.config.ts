import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import path from 'path';
import { readFileSync } from 'fs';

const rootPkg = JSON.parse(readFileSync(path.resolve(__dirname, '../../package.json'), 'utf-8'));

const backendUrl = process.env.BACKEND_URL || 'http://localhost:3000';

// Frontend feature flags. Read from `process.env` at build time and injected
// via `define:` below so the rest of the codebase imports a typed boolean
// (`SECURE_FOLDER_ENABLED` from `src/feature-flags.ts`) instead of touching
// raw env vars. Default off.
function readEnvBool(value: string | undefined): boolean {
  if (typeof value !== 'string') return false;
  const v = value.trim().toLowerCase();
  return v === '1' || v === 'true' || v === 'yes' || v === 'on';
}
const secureFolderEnabled = readEnvBool(process.env.E2E_SECURE_FOLDER);

export default defineConfig({
  plugins: [
    react(),
    {
      name: 'drawio-cors',
      configureServer(server) {
        // draw.io runs in a sandboxed iframe (opaque origin) — XHR needs CORS
        server.middlewares.use((req, res, next) => {
          if (req.url?.startsWith('/drawio/')) {
            res.setHeader('Access-Control-Allow-Origin', '*');
          }
          next();
        });
      },
    },
    {
      // argon2-browser/lib/argon2.js has a Node-only branch that does
      // `require('../dist/argon2.wasm')`, gated by `typeof require ===
      // 'function'`. In a browser bundle that gate is supposed to be false,
      // but @rollup/plugin-commonjs injects a `require` shim that makes
      // `typeof require === 'function'` evaluate true at runtime — so the
      // Node branch fires, the stripped require returns `undefined`, and
      // `decodeWasmBinary(undefined)` calls `atob(undefined)` and throws
      // "The string to be decoded is not correctly encoded".
      //
      // Force both gates to `false` so the browser falls through to the
      // `fetch(global.argon2WasmPath)` path, which our `crypto/argon2.ts`
      // pre-seeds with a Vite-emitted asset URL.
      name: 'argon2-browser-strip-cjs-wasm-require',
      enforce: 'pre',
      transform(code, id) {
        if (!id.includes('argon2-browser')) return;
        if (!/[\\/]lib[\\/]argon2\.js$/.test(id) && !id.endsWith('lib/argon2.js')) return;
        const original = code;
        code = code.replace(
          /if \(typeof require === 'function'\) \{[\s\S]*?\n {8}\}/g,
          'if (false) { /* stripped by vite for browser bundle */ }',
        );
        if (code === original) return;
        return { code, map: null };
      },
    },
  ],
  define: {
    __APP_VERSION__: JSON.stringify(process.env.APP_VERSION || rootPkg.version),
    __E2E_SECURE_FOLDER_ENABLED__: JSON.stringify(secureFolderEnabled),
  },
  optimizeDeps: {
    // argon2-browser/lib/argon2.js has a Node-only branch that does
    // `require('../dist/argon2.wasm')`. Esbuild's pre-bundle tries to convert
    // that into an ESM wasm import and bails with "ESM integration proposal
    // for Wasm is not supported currently". Pre-strip the entire `if (typeof
    // require === 'function') { ... }` block before esbuild sees it so the
    // wasm-fetch path is the only branch left. This is the dev-mode twin of
    // the Vite `transform` plugin above, which catches the same gate when
    // Rollup processes the file during `vite build`.
    esbuildOptions: {
      plugins: [
        {
          name: 'argon2-browser-strip-cjs-wasm-require',
          setup(build) {
            build.onLoad({ filter: /argon2-browser[\\/]lib[\\/]argon2\.js$/ }, async (args) => {
              const fs = await import('node:fs/promises');
              const code = await fs.readFile(args.path, 'utf8');
              return {
                contents: code.replace(
                  /if \(typeof require === 'function'\) \{[\s\S]*?\n {8}\}/g,
                  'if (false) { /* stripped by vite for browser bundle */ }',
                ),
                loader: 'js',
              };
            });
          },
        },
      ],
    },
  },
  resolve: {
    alias: {
      '@kalepin/shared': path.resolve(__dirname, '../shared/src'),
    },
  },
  server: {
    proxy: {
      '/api': backendUrl,
      '/ws': {
        target: backendUrl.replace(/^http/, 'ws'),
        ws: true,
      },
    },
  },
  // `vite preview` (used by the E2E_USE_BUILD=1 Playwright mode) doesn't
  // inherit `server.proxy`, so wire the same passthrough explicitly.
  preview: {
    proxy: {
      '/api': backendUrl,
      '/ws': {
        target: backendUrl.replace(/^http/, 'ws'),
        ws: true,
      },
    },
  },
});
