import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { User } from '../entities/user.entity';

export type EmailPreference = 'all' | 'mentions' | 'none';
export const EMAIL_PREFERENCES: readonly EmailPreference[] = ['all', 'mentions', 'none'];

/** What an email is about, for preference gating. A reply that @mentions the
 * recipient is a `mention`, not a `reply`. */
export type EmailKind = 'mention' | 'reply' | 'share';

export function isEmailPreference(value: unknown): value is EmailPreference {
  return typeof value === 'string' && (EMAIL_PREFERENCES as readonly string[]).includes(value);
}

/** `all` sends everything; `mentions` drops thread-reply emails; `none` sends nothing. */
export function preferenceAllows(pref: EmailPreference, kind: EmailKind): boolean {
  if (pref === 'none') return false;
  if (pref === 'mentions') return kind !== 'reply';
  return true;
}

@Injectable()
export class NotificationPreferencesService {
  constructor(@InjectRepository(User) private readonly userRepo: Repository<User>) {}

  /** The user's preference; `all` for unknown users or unexpected stored values. */
  async get(email: string): Promise<EmailPreference> {
    const user = await this.userRepo.findOne({ where: { email: email.toLowerCase() } });
    return isEmailPreference(user?.emailNotifications) ? user!.emailNotifications : 'all';
  }

  /** Returns false when no user row exists for `email`. */
  async set(email: string, pref: EmailPreference): Promise<boolean> {
    const result = await this.userRepo.update({ email: email.toLowerCase() }, { emailNotifications: pref });
    return (result.affected ?? 0) > 0;
  }

  async allowsEmail(email: string, kind: EmailKind): Promise<boolean> {
    return preferenceAllows(await this.get(email), kind);
  }
}
