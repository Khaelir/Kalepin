import { Injectable } from '@nestjs/common';

// Shared in-process event bus so OAuth-side revocation can sweep MCP sessions
// without OAuthService depending on McpService (which would form a cycle:
// McpModule → AuthModule → OAuthModule → McpModule). Subscribers register at
// module init; emit is fire-and-forget.

export type OAuthRevocationReason = 'user' | 'replay' | 'expired' | 'sweep';

export interface AccessTokenRevocation {
  grantId: number;
  tokenHashes: string[];
  reason: OAuthRevocationReason;
}

export interface ApiKeyRevocation {
  apiKeyId: number;
}

export type OAuthRefreshKind = 'refresh' | 'leeway' | 'replay_detected';

export interface OAuthRefreshEvent {
  kind: OAuthRefreshKind;
  grantId: number;
  userId: number;
  durationMs: number;
  success: boolean;
  errorMessage?: string;
}

export interface OAuthGrantRevokedEvent {
  grantId: number;
  userId: number;
  reason: OAuthRevocationReason;
}

type RevocationListener = (rev: AccessTokenRevocation) => void;
type ApiKeyRevocationListener = (rev: ApiKeyRevocation) => void;
type RefreshListener = (ev: OAuthRefreshEvent) => void;
type GrantRevokedListener = (ev: OAuthGrantRevokedEvent) => void;

@Injectable()
export class OAuthEventBus {
  private revocationListeners = new Set<RevocationListener>();
  private apiKeyListeners = new Set<ApiKeyRevocationListener>();
  private refreshListeners = new Set<RefreshListener>();
  private grantRevokedListeners = new Set<GrantRevokedListener>();

  onAccessTokensRevoked(listener: RevocationListener): () => void {
    this.revocationListeners.add(listener);
    return () => this.revocationListeners.delete(listener);
  }

  emitAccessTokensRevoked(rev: AccessTokenRevocation): void {
    for (const l of this.revocationListeners) {
      try {
        l(rev);
      } catch {
        // Listener errors must not break the revocation flow.
      }
    }
  }

  onApiKeyRevoked(listener: ApiKeyRevocationListener): () => void {
    this.apiKeyListeners.add(listener);
    return () => this.apiKeyListeners.delete(listener);
  }

  emitApiKeyRevoked(rev: ApiKeyRevocation): void {
    for (const l of this.apiKeyListeners) {
      try {
        l(rev);
      } catch {
        // Listener errors must not break the revocation flow.
      }
    }
  }

  onRefresh(listener: RefreshListener): () => void {
    this.refreshListeners.add(listener);
    return () => this.refreshListeners.delete(listener);
  }

  emitRefresh(ev: OAuthRefreshEvent): void {
    for (const l of this.refreshListeners) {
      try {
        l(ev);
      } catch {
        // Listener errors must not break the refresh flow.
      }
    }
  }

  onGrantRevoked(listener: GrantRevokedListener): () => void {
    this.grantRevokedListeners.add(listener);
    return () => this.grantRevokedListeners.delete(listener);
  }

  emitGrantRevoked(ev: OAuthGrantRevokedEvent): void {
    for (const l of this.grantRevokedListeners) {
      try {
        l(ev);
      } catch {
        // Listener errors must not break the revocation flow.
      }
    }
  }
}
