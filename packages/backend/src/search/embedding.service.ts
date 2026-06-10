import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import * as path from 'path';
import * as fs from 'fs';

function findModelDir(): string {
  // Try env var first
  if (process.env.EMBEDDING_MODEL_DIR) return process.env.EMBEDDING_MODEL_DIR;
  // Walk up from __dirname to find models/ directory
  let dir = __dirname;
  for (let i = 0; i < 10; i++) {
    const candidate = path.join(dir, 'models', 'multilingual-e5-base');
    if (fs.existsSync(path.join(candidate, 'config.json'))) return candidate;
    dir = path.dirname(dir);
  }
  // Fallback
  return path.join(__dirname, '..', '..', 'models', 'multilingual-e5-base');
}

const MODEL_DIR = findModelDir();

// Dynamic import — @huggingface/transformers is ESM-only
let pipeline: any;
let env: any;
async function loadTransformers() {
  const mod = await import('@huggingface/transformers');
  pipeline = mod.pipeline;
  env = mod.env;
}

@Injectable()
export class EmbeddingService implements OnModuleInit {
  private extractor: any = null;
  private readonly logger = new Logger(EmbeddingService.name);
  private loadingPromise: Promise<void>;
  private resolveLoading!: () => void;

  constructor() {
    this.loadingPromise = new Promise((resolve) => {
      this.resolveLoading = resolve;
    });
  }

  get ready(): boolean {
    return this.extractor !== null;
  }

  /** Resolves when model loading completes (successfully or not). */
  whenReady(): Promise<void> {
    return this.loadingPromise;
  }

  async onModuleInit() {
    // Load in background so it doesn't block other module inits
    this.load().finally(() => this.resolveLoading());
  }

  private async load(): Promise<void> {
    try {
      this.logger.log('Loading embedding model...');
      await loadTransformers();
      // Use local model files, disable remote fetching
      env.localModelPath = MODEL_DIR;
      env.allowRemoteModels = false;
      env.allowLocalModels = true;

      this.extractor = await pipeline('feature-extraction', MODEL_DIR, {
        local_files_only: true,
        dtype: 'q8',
      });
      this.logger.log('Embedding model loaded.');
    } catch (err) {
      this.logger.error('Failed to load embedding model', err);
    }
  }

  async embed(text: string, type: 'query' | 'passage' = 'passage'): Promise<Float32Array> {
    if (!this.extractor) {
      throw new Error('Embedding model not loaded');
    }

    // E5 models require a prefix to distinguish queries from passages
    const prefixedText = type === 'query' ? `query: ${text}` : `passage: ${text}`;

    const output = await this.extractor(prefixedText, {
      pooling: 'mean',
      normalize: true,
    });

    return new Float32Array(output.data);
  }
}
