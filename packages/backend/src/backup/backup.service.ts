import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { SchedulerRegistry } from '@nestjs/schedule';
import { CronJob } from 'cron';
import { S3Client, ListObjectsV2Command, DeleteObjectsCommand, GetObjectCommand } from '@aws-sdk/client-s3';
import { Upload } from '@aws-sdk/lib-storage';
import * as tar from 'tar';
import * as fs from 'fs';
import * as path from 'path';
import { ArchiveService } from '../archive/archive.service';

export interface BackupConfig {
  bucket: string;
  region: string;
  accessKeyId: string;
  secretAccessKey: string;
  prefix: string;
  schedule: string;
  retentionDays: number;
  endpoint?: string;
}

export interface BackupResult {
  key: string;
  size: number;
  duration: number;
}

export interface BackupListItem {
  key: string;
  size: number;
  lastModified: Date;
}

@Injectable()
export class BackupService implements OnModuleInit {
  private readonly logger = new Logger(BackupService.name);
  private config: BackupConfig;
  private s3: S3Client;
  private backupInProgress = false;

  constructor(
    private readonly schedulerRegistry: SchedulerRegistry,
    private readonly archiveService: ArchiveService,
  ) {}

  onModuleInit() {
    this.validateAndLoadConfig();
    this.initS3Client();
    this.registerCronJob();
    this.logger.log(
      `S3 backup enabled — bucket: ${this.config.bucket}, schedule: ${this.config.schedule}`,
    );
  }

  private validateAndLoadConfig() {
    const required = {
      S3_BACKUP_BUCKET: process.env.S3_BACKUP_BUCKET,
      S3_BACKUP_REGION: process.env.S3_BACKUP_REGION,
      S3_BACKUP_ACCESS_KEY_ID: process.env.S3_BACKUP_ACCESS_KEY_ID,
      S3_BACKUP_SECRET_ACCESS_KEY: process.env.S3_BACKUP_SECRET_ACCESS_KEY,
    };

    const missing = Object.entries(required)
      .filter(([, v]) => !v)
      .map(([k]) => k);

    if (missing.length > 0) {
      throw new Error(
        `S3 backup is enabled (S3_BACKUP_BUCKET is set) but required env vars are missing: ${missing.join(', ')}`,
      );
    }

    this.config = {
      bucket: required.S3_BACKUP_BUCKET!,
      region: required.S3_BACKUP_REGION!,
      accessKeyId: required.S3_BACKUP_ACCESS_KEY_ID!,
      secretAccessKey: required.S3_BACKUP_SECRET_ACCESS_KEY!,
      prefix: process.env.S3_BACKUP_PREFIX || 'backups',
      schedule: process.env.S3_BACKUP_SCHEDULE || '0 3 * * *',
      retentionDays: parseInt(process.env.S3_BACKUP_RETENTION_DAYS || '30', 10),
      endpoint: process.env.S3_BACKUP_ENDPOINT || undefined,
    };
  }

  private initS3Client() {
    this.s3 = new S3Client({
      region: this.config.region,
      credentials: {
        accessKeyId: this.config.accessKeyId,
        secretAccessKey: this.config.secretAccessKey,
      },
      ...(this.config.endpoint && {
        endpoint: this.config.endpoint,
        forcePathStyle: true,
      }),
    });
  }

  private registerCronJob() {
    const job = new CronJob(this.config.schedule, () => this.scheduledBackup());
    this.schedulerRegistry.addCronJob('s3-backup', job);
    job.start();
  }

  private async scheduledBackup() {
    try {
      await this.runBackup();
    } catch (err) {
      this.logger.error('Scheduled backup failed', err);
    }
  }

  async runBackup(): Promise<BackupResult> {
    if (this.backupInProgress) {
      this.logger.warn('Backup already in progress, skipping');
      throw new Error('Backup already in progress');
    }

    this.backupInProgress = true;
    const start = Date.now();
    let tmpDir: string | undefined;

    try {
      const { archivePath, tmpDir: dir } = await this.createArchive();
      tmpDir = dir;
      const result = await this.uploadToS3(archivePath);
      await this.pruneOldBackups();
      const duration = Date.now() - start;
      this.logger.log(
        `Backup complete — key: ${result.key}, size: ${result.size} bytes, duration: ${duration}ms`,
      );
      return { key: result.key, size: result.size, duration };
    } finally {
      this.backupInProgress = false;
      if (tmpDir) {
        fs.promises.rm(tmpDir, { recursive: true, force: true }).catch(() => {});
      }
    }
  }

  get isBackupInProgress(): boolean {
    return this.backupInProgress;
  }

  async createArchive(): Promise<{ archivePath: string; tmpDir: string }> {
    return this.archiveService.createArchive();
  }

  async uploadToS3(archivePath: string): Promise<{ key: string; size: number }> {
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
    const key = `${this.config.prefix}/kalepin-backup-${timestamp}.tar.gz`;
    const stat = await fs.promises.stat(archivePath);
    const stream = fs.createReadStream(archivePath);

    const upload = new Upload({
      client: this.s3,
      params: {
        Bucket: this.config.bucket,
        Key: key,
        Body: stream,
        ContentType: 'application/gzip',
      },
    });

    await upload.done();
    return { key, size: stat.size };
  }

  async pruneOldBackups(): Promise<number> {
    if (this.config.retentionDays === 0) {
      return 0;
    }

    const cutoff = new Date();
    cutoff.setDate(cutoff.getDate() - this.config.retentionDays);

    const listResult = await this.s3.send(
      new ListObjectsV2Command({
        Bucket: this.config.bucket,
        Prefix: `${this.config.prefix}/kalepin-backup-`,
      }),
    );

    const toDelete = (listResult.Contents || []).filter(
      (obj) => obj.LastModified && obj.LastModified < cutoff,
    );

    if (toDelete.length === 0) {
      return 0;
    }

    await this.s3.send(
      new DeleteObjectsCommand({
        Bucket: this.config.bucket,
        Delete: {
          Objects: toDelete.map((obj) => ({ Key: obj.Key })),
        },
      }),
    );

    this.logger.log(`Pruned ${toDelete.length} old backup(s)`);
    return toDelete.length;
  }

  async listBackups(): Promise<BackupListItem[]> {
    const listResult = await this.s3.send(
      new ListObjectsV2Command({
        Bucket: this.config.bucket,
        Prefix: `${this.config.prefix}/kalepin-backup-`,
      }),
    );

    return (listResult.Contents || [])
      .map((obj) => ({
        key: obj.Key!,
        size: obj.Size || 0,
        lastModified: obj.LastModified!,
      }))
      .sort((a, b) => b.lastModified.getTime() - a.lastModified.getTime());
  }

  async restoreFromS3(key: string): Promise<void> {
    const vaultPath = path.resolve(process.env.VAULT_PATH || './data/vault');
    const dataDir = path.dirname(vaultPath);

    // 1. Download archive from S3
    const response = await this.s3.send(
      new GetObjectCommand({ Bucket: this.config.bucket, Key: key }),
    );
    if (!response.Body) {
      throw new Error(`Backup not found: ${key}`);
    }

    // 2. Write to a temp file
    const tmpArchivePath = path.join(dataDir, `restore-${Date.now()}.tar.gz`);
    const bodyStream = response.Body as NodeJS.ReadableStream;
    const writeStream = fs.createWriteStream(tmpArchivePath);
    await new Promise<void>((resolve, reject) => {
      bodyStream.pipe(writeStream);
      writeStream.on('finish', resolve);
      writeStream.on('error', reject);
    });

    // 3. Delegate to ArchiveService for atomic restore
    try {
      await this.archiveService.restoreFromArchive(tmpArchivePath);
      this.logger.log(`Restore complete from ${key}`);
    } finally {
      await fs.promises.unlink(tmpArchivePath).catch(() => {});
    }
  }
}
