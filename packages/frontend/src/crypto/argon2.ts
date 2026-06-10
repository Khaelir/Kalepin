// Argon2id wrapper around `argon2-browser`. Two callers in this codebase:
//   1. master-kek.ts derives the passphrase-KEK and recovery-KEK at vault
//      setup, unlock, and rotation time.
//   2. PassphraseSetupDialog calls `selfTuneOnce()` once on first install to
//      pick parameters that fit the device's memory budget.
//
// The `argon2-browser` lib auto-loads its WASM binary from
// `node_modules/argon2-browser/dist/argon2.wasm` by default. Under Vite we
// pass an explicit `?url` so the bundler emits a hashed asset path; under
// vitest/jsdom the lib falls through to a Node `require` path that finds the
// wasm via the package's `dist/` directory, so tests need no extra setup.

// argon2-browser ships UMD without TypeScript types; declare the shape we
// rely on rather than pulling in `@types/argon2-browser`.
type ArgonType = 0 | 1 | 2;
interface Argon2Module {
  ArgonType: { Argon2d: 0; Argon2i: 1; Argon2id: 2 };
  hash(args: {
    pass: string | Uint8Array;
    salt: string | Uint8Array;
    time: number;
    mem: number;
    parallelism: number;
    hashLen: number;
    type: ArgonType;
  }): Promise<{ hash: Uint8Array; hashHex: string; encoded: string }>;
}

let argon2Module: Argon2Module | null = null;

function isRealBrowser(): boolean {
  // Vite-served runtime (real browser or e2e harness). Excludes jsdom which
  // also defines `window` but lacks `fetch` of file:// paths.
  return typeof window !== 'undefined' && typeof (globalThis as any).process?.versions?.node !== 'string';
}

async function loadArgon2(): Promise<Argon2Module> {
  if (argon2Module) return argon2Module;
  const g = globalThis as any;
  if (isRealBrowser()) {
    // Vite resolves the wasm URL at build time. argon2-browser reads
    // `globalThis.argon2WasmPath` before fetching its default location.
    if (!g.argon2WasmPath) {
      const wasmUrl = (await import('argon2-browser/dist/argon2.wasm?url')).default;
      g.argon2WasmPath = wasmUrl;
    }
    // argon2-browser's `loadWasmBinary` checks `global.loadArgon2WasmBinary`
    // *before* the Node-only `require('../dist/argon2.wasm')` branch — so by
    // installing a fetch-based loader here we short-circuit that branch in
    // both `vite dev` (where our plugin transform doesn't fire on @fs URLs)
    // and `vite build` (where @rollup/plugin-commonjs's `require` shim makes
    // `typeof require === 'function'` evaluate true and the inner stripped
    // require returns `undefined`, leading to atob(undefined)).
    if (!g.loadArgon2WasmBinary) {
      g.loadArgon2WasmBinary = async () => {
        const res = await fetch(g.argon2WasmPath);
        if (!res.ok) throw new Error(`failed to fetch argon2.wasm: ${res.status}`);
        return new Uint8Array(await res.arrayBuffer());
      };
    }
  } else {
    // Node-side (vitest): the dist Emscripten module's `instantiateAsync`
    // calls `fetch()` with an absolute filesystem path because Node 25 ships
    // a global `fetch` — and that fetch rejects local paths. Pre-seed
    // `self.Module.wasmBinary` so the dist module's `getBinary` is reached
    // first and reads the bytes synchronously off disk via Emscripten's
    // node-fs `readBinary`.
    //
    // The dist module reads `self.Module`, but Node's plain runtime doesn't
    // define `self`. Alias it to `globalThis` so the read resolves.
    if (typeof (globalThis as any).self === 'undefined') {
      (globalThis as any).self = globalThis;
    }
    if (!g.self.Module || !g.self.Module.wasmBinary) {
      // These imports only run under vitest (the frontend tsconfig has no
      // node types); the dynamic `as any` casts keep tsc happy under DOM.
      const fs = (await import('node:fs' as any)) as { readFileSync(p: string): Uint8Array };
      const mod = (await import('node:module' as any)) as { createRequire(url: string): { resolve(s: string): string } };
      const req = mod.createRequire(import.meta.url);
      const path = req.resolve('argon2-browser/dist/argon2.wasm');
      const bytes = fs.readFileSync(path);
      g.self.Module = { ...(g.self.Module ?? {}), wasmBinary: new Uint8Array(bytes) };
    }
  }
  const mod = (await import('argon2-browser')) as unknown as { default?: Argon2Module } & Argon2Module;
  argon2Module = (mod.default ?? mod) as Argon2Module;
  return argon2Module;
}

/** Argon2id KDF parameters serialized into envelope `kdf_params`. */
export interface Argon2Params {
  /** Memory in KiB. */
  memKiB: number;
  /** Iterations. */
  iterations: number;
  /** Lanes. */
  parallelism: number;
}

/**
 * Defaults for new vaults. Sized to make offline brute-forcing of low-entropy
 * passphrases meaningfully expensive: 128 MiB and 3 iterations is ~5x the cost
 * of OWASP's 2024 minimum and crosses the GPU-cache threshold on commodity
 * hardware. {@link selfTuneOnce} can scale these down on memory-constrained
 * devices, but never below {@link MIN_ARGON2_PARAMS}. Existing vaults keep
 * their original params (carried in the envelope's `kdf_params`).
 */
export const DEFAULT_ARGON2_PARAMS: Argon2Params = {
  memKiB: 128 * 1024,
  iterations: 3,
  parallelism: 1,
};

/** Hard floor enforced when reading existing vaults or self-tuning. */
export const MIN_ARGON2_PARAMS: Argon2Params = {
  memKiB: 64 * 1024,
  iterations: 2,
  parallelism: 1,
};

/** Derive a 32-byte key from a passphrase + 16-byte salt with Argon2id. */
export async function deriveArgon2(
  passphrase: string | Uint8Array,
  salt: Uint8Array,
  params: Argon2Params = DEFAULT_ARGON2_PARAMS,
): Promise<Uint8Array> {
  if (salt.length !== 16) {
    throw new Error(`argon2 salt must be exactly 16 bytes, got ${salt.length}`);
  }
  const argon2 = await loadArgon2();
  const result = await argon2.hash({
    pass: passphrase,
    salt,
    time: params.iterations,
    mem: params.memKiB,
    parallelism: params.parallelism,
    hashLen: 32,
    type: argon2.ArgonType.Argon2id,
  });
  return result.hash;
}

/**
 * Encode {salt, mem, iter, par} into the layout the envelope's `kdf_params`
 * field carries. Backend's parser is byte-compatible:
 *   bytes 0..15  = salt
 *   bytes 16..19 = memKiB (LE u32)
 *   bytes 20..21 = iterations (LE u16)
 *   byte  22     = parallelism (u8)
 */
export function encodeArgon2Params(salt: Uint8Array, params: Argon2Params): Uint8Array {
  if (salt.length !== 16) throw new Error('salt must be 16 bytes');
  const out = new Uint8Array(23);
  out.set(salt, 0);
  const view = new DataView(out.buffer, out.byteOffset, out.byteLength);
  view.setUint32(16, params.memKiB, true);
  view.setUint16(20, params.iterations, true);
  view.setUint8(22, params.parallelism);
  return out;
}

export function decodeArgon2Params(buf: Uint8Array): { salt: Uint8Array; params: Argon2Params } {
  if (buf.length !== 23) {
    throw new Error(`argon2 kdf_params must be 23 bytes, got ${buf.length}`);
  }
  const salt = buf.slice(0, 16);
  const view = new DataView(buf.buffer, buf.byteOffset, buf.byteLength);
  return {
    salt,
    params: {
      memKiB: view.getUint32(16, true),
      iterations: view.getUint16(20, true),
      parallelism: view.getUint8(22),
    },
  };
}
