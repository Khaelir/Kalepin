#!/usr/bin/env node
/**
 * Downloads the multilingual-e5-base ONNX model files for local embedding generation.
 * Run: node scripts/download-model.mjs
 */
import { mkdir, access, writeFile } from 'fs/promises';
import { join } from 'path';

const MODEL_DIR = join(import.meta.dirname, '..', 'models', 'multilingual-e5-base');
const ONNX_BASE = 'https://huggingface.co/Xenova/multilingual-e5-base/resolve/main';

const FILES = [
  { url: `${ONNX_BASE}/onnx/model_quantized.onnx`, name: 'onnx/model_quantized.onnx' },
  { url: `${ONNX_BASE}/tokenizer.json`, name: 'tokenizer.json' },
  { url: `${ONNX_BASE}/tokenizer_config.json`, name: 'tokenizer_config.json' },
  { url: `${ONNX_BASE}/config.json`, name: 'config.json' },
];

async function fileExists(path) {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}

async function download(url, destPath) {
  console.log(`Downloading ${url}...`);
  const res = await fetch(url, { redirect: 'follow' });
  if (!res.ok) throw new Error(`Failed to download ${url}: ${res.status}`);
  const buffer = Buffer.from(await res.arrayBuffer());
  await writeFile(destPath, buffer);
  console.log(`  -> ${destPath} (${(buffer.length / 1024 / 1024).toFixed(1)} MB)`);
}

async function main() {
  await mkdir(MODEL_DIR, { recursive: true });

  for (const file of FILES) {
    const dest = join(MODEL_DIR, file.name);
    // Ensure subdirectory exists (e.g. onnx/)
    await mkdir(join(dest, '..'), { recursive: true });
    if (await fileExists(dest)) {
      console.log(`Skipping ${file.name} (already exists)`);
      continue;
    }
    await download(file.url, dest);
  }

  console.log('Model download complete.');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
