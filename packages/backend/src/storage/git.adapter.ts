import { execFile } from 'child_process';
import { promisify } from 'util';
import { LocalFSAdapter } from './local-fs.adapter';
import { Commit } from './storage-adapter.interface';

const exec = promisify(execFile);

export class GitAdapter extends LocalFSAdapter {
  private async git(...args: string[]): Promise<string> {
    const { stdout } = await exec('git', args, { cwd: this.vaultPath });
    return stdout.trim();
  }

  async commitAll(message: string): Promise<void> {
    try {
      await this.git('add', '-A');
      await this.git('commit', '-m', message);
    } catch (err: unknown) {
      const error = err as { stdout?: string };
      // Ignore "nothing to commit"
      if (error.stdout?.includes('nothing to commit')) return;
      throw err;
    }
  }

  async history(filePath: string): Promise<Commit[]> {
    const resolved = this.resolve(filePath);
    const log = await this.git(
      'log',
      '--format=%H|%s|%an|%aI',
      '--',
      resolved,
    );
    if (!log) return [];
    return log.split('\n').map((line) => {
      const [hash, message, author, date] = line.split('|');
      return { hash, message, author, date };
    });
  }

  async diff(filePath: string, rev1: string, rev2: string): Promise<string> {
    const resolved = this.resolve(filePath);
    return this.git('diff', rev1, rev2, '--', resolved);
  }
}
