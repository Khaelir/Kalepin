// RFC 7591 Dynamic Client Registration request body. Field shapes follow the
// spec; we only persist the subset we care about, but accept and ignore the
// rest so well-formed registrations from spec-compliant clients succeed.
export interface DcrRegistrationRequest {
  client_name?: string;
  redirect_uris: string[];
  client_uri?: string;
  software_id?: string;
  software_version?: string;
  token_endpoint_auth_method?: string;
  grant_types?: string[];
  response_types?: string[];
  scope?: string;
  // Spec-allowed extras we pass through to dcr_metadata for audit but do not
  // act on:
  contacts?: string[];
  logo_uri?: string;
  policy_uri?: string;
  tos_uri?: string;
}

export interface DcrRegistrationResponse {
  client_id: string;
  client_id_issued_at: number;
  redirect_uris: string[];
  client_name: string;
  client_uri?: string;
  software_id?: string;
  token_endpoint_auth_method: 'none';
  grant_types: ['authorization_code', 'refresh_token'];
  response_types: ['code'];
}

// Token endpoint inputs (form-urlencoded, RFC 6749 §4.1.3 / §6).
export interface TokenAuthorizationCodeRequest {
  grant_type: 'authorization_code';
  code: string;
  redirect_uri: string;
  client_id: string;
  code_verifier: string;
}

export interface TokenRefreshRequest {
  grant_type: 'refresh_token';
  refresh_token: string;
  client_id: string;
  scope?: string;
}

export type TokenRequest = TokenAuthorizationCodeRequest | TokenRefreshRequest;

export interface TokenSuccessResponse {
  access_token: string;
  refresh_token: string;
  token_type: 'Bearer';
  expires_in: number;
  scope: string;
}

export interface TokenErrorResponse {
  error:
    | 'invalid_request'
    | 'invalid_client'
    | 'invalid_grant'
    | 'unauthorized_client'
    | 'unsupported_grant_type'
    | 'invalid_scope';
  error_description?: string;
}

// Revocation endpoint (RFC 7009).
export interface RevokeRequest {
  token: string;
  token_type_hint?: 'access_token' | 'refresh_token';
}

// Consent screen API (frontend-facing, JSON over the existing JWT-authenticated
// /api surface).
export interface AuthorizeRequestDetails {
  request_id: string;
  client: {
    client_id: string;
    name: string;
    client_uri: string | null;
    verified: boolean;
  };
  redirect_uri: string;
  redirect_domain: string;
  requested_scope: string[];
  user: { email: string };
  existing_grant: { created_at: string } | null;
}

export interface AuthorizeApproveRequest {
  granted_scope: string[];
}

export interface AuthorizeRedirectResponse {
  redirect_to: string;
}
