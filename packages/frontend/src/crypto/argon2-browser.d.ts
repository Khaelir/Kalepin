declare module 'argon2-browser' {
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
  const argon2: Argon2Module;
  export default argon2;
  export const ArgonType: Argon2Module['ArgonType'];
}

declare module 'argon2-browser/dist/argon2.wasm?url' {
  const url: string;
  export default url;
}
