import { startMockOidcIssuer } from './mock-oidc-issuer';
import { SSO_CALLBACK_URL } from './playwright.config';

// The mock Microsoft issuer lives in the runner process for the whole run.
// The backend only contacts it on the first SSO start (discovery is lazy), so
// it doesn't matter that the web servers may boot first.
export default async function globalSetup() {
  const issuer = await startMockOidcIssuer({ redirectUri: SSO_CALLBACK_URL });
  return () => issuer.close();
}
