# Sign in with Microsoft (Entra ID)

Kalepin can let your users sign in with their Microsoft 365 / Entra ID work account, next to the usual magic-link email.

What to expect:

- **It's an extra option, not a replacement.** Magic links keep working for everyone. If Microsoft sign-in is misconfigured or its secret expires, users can still get in by email.
- **Existing accounts are matched by email.** Someone who already uses Kalepin via magic link lands in the same account, with the same notes and personal folder, the first time they use Microsoft.
- **`DOMAIN_ALLOWLIST` still applies.** A Microsoft account whose email isn't on an allowed domain is refused, exactly as with magic links.
- **Single tenant only.** Kalepin only accepts accounts from the one Entra tenant you configure. Multi-tenant values (`common`, `organizations`, `consumers`) are refused. See [Why single tenant](#why-single-tenant).
- **Kalepin stores nothing from Microsoft except the link to your account.** Microsoft's tokens are used once to confirm who you are, then discarded. Kalepin never reads your mailbox, calendar or files.
- **Off by default.** Until the three settings below are configured, the login page shows only the magic-link form.

## Before you start

- Kalepin must be reachable over **HTTPS** at a stable public address, and `APP_URL` must be set to that address (for example `https://kalepin.example.com`, with no trailing slash). The only exception Microsoft allows is `http://localhost` for local development.
- In Entra you need permission to **register an application**. Most tenants allow every user to do this.
- One step (granting admin consent) needs an Entra admin: **Global Administrator**, **Application Administrator** or **Cloud Application Administrator**. If that's not you, prepare steps 1–3 and send your IT admin the link to step 4.

## 1. Register the application

1. Open the [Microsoft Entra admin center](https://entra.microsoft.com) and go to **Identity → Applications → App registrations → New registration**.
2. **Name:** `Kalepin`, or anything your users will recognise. It appears on the Microsoft consent screen.
3. **Supported account types:** choose **Accounts in this organizational directory only (Single tenant)**.
4. **Redirect URI:** platform **Web**, value:

   ```
   <APP_URL>/api/auth/sso/microsoft/callback
   ```

   For example `https://kalepin.example.com/api/auth/sso/microsoft/callback`. It must match exactly: scheme, host, path, no trailing slash.

5. Click **Register**.

**Several environments** (preprod, prod, local dev) can share one registration. Add every callback URL under **Authentication → Web → Redirect URIs**:

```
https://kalepin.preprod.example.com/api/auth/sso/microsoft/callback
https://kalepin.example.com/api/auth/sso/microsoft/callback
http://localhost:3000/api/auth/sso/microsoft/callback
```

You can also create one registration per environment if you want separate secrets.

## 2. Copy the two IDs

On the registration's **Overview** page, copy:

| Entra label | Kalepin setting |
|---|---|
| **Directory (tenant) ID** | `SSO_MICROSOFT_TENANT_ID` |
| **Application (client) ID** | `SSO_MICROSOFT_CLIENT_ID` |

Both look like `1b2c3d4e-5f60-7182-93a4-b5c6d7e8f901`.

## 3. Create a client secret

1. Go to **Certificates & secrets → Client secrets → New client secret**.
2. Enter a description (e.g. `Kalepin prod`) and an expiry. The maximum is 24 months.
3. Copy the **Value** column right away. Microsoft only shows it once.

> **Copy the _Value_, not the _Secret ID_.** Both look like random strings; the Secret ID is a GUID and will not work.

Put a reminder in your calendar a few weeks before the expiry date. See [Renewing the client secret](#renewing-the-client-secret).

## 4. Grant permissions (admin)

1. Go to **API permissions → Add a permission → Microsoft Graph → Delegated permissions**.
2. Tick **`openid`**, **`email`** and **`profile`**, then **Add permissions**. (`User.Read`, added by default, is harmless and can stay.)
3. Click **Grant admin consent for _&lt;your organisation&gt;_** and confirm. Each permission's status should turn into a green check.

Kalepin only uses these permissions to learn the user's name and email at sign-in. Without admin consent, users may see "Need admin approval" when they click *Sign in with Microsoft*, because many organisations don't let users approve apps themselves.

## 5. Make sure the email is in the token (recommended)

1. Go to **Token configuration → Add optional claim**.
2. Token type **ID**, tick **`email`**, then **Add**.
3. If Entra asks to also turn on the Microsoft Graph email permission, accept.

Kalepin also reads the sign-in name (`preferred_username`), so this step isn't strictly required. It ensures the real email address is always present, which matters if your sign-in names differ from your email addresses.

## 6. Limit who can sign in (optional)

By default every member of your tenant whose email domain is in `DOMAIN_ALLOWLIST` can use Microsoft sign-in. To restrict it to a group:

1. Go to **Identity → Applications → Enterprise applications → Kalepin → Properties**.
2. Set **Assignment required?** to **Yes**, then **Save**.
3. Under **Users and groups → Add user/group**, add the people or groups allowed in.

This only restricts the Microsoft button. Magic links are still governed by `DOMAIN_ALLOWLIST` alone.

## 7. Configure Kalepin

| Variable | Description |
|---|---|
| `SSO_MICROSOFT_TENANT_ID` | Directory (tenant) ID from step 2. Must be the GUID: `common`, `organizations` and `consumers` are refused. |
| `SSO_MICROSOFT_CLIENT_ID` | Application (client) ID from step 2. |
| `SSO_MICROSOFT_CLIENT_SECRET_FILE` | Path to a file containing the client secret from step 3 (recommended). |
| `SSO_MICROSOFT_CLIENT_SECRET` | Alternative to `_FILE`: the secret value itself. If both are set, the file wins. |
| `SSO_MICROSOFT_AUTHORITY_HOST` | Optional. Defaults to `https://login.microsoftonline.com`. Change it only for a national cloud (e.g. `https://login.microsoftonline.us`). |

Keep the secret out of `docker-compose.yml` by mounting it as a docker secret, the same way as the KEK:

```sh
mkdir -p secrets
printf '%s' 'paste-the-secret-value-here' > ./secrets/ms_client_secret
chmod 0600 ./secrets/ms_client_secret
```

```yaml
secrets:
  ms_client_secret:
    file: ./secrets/ms_client_secret

services:
  kalepin:
    secrets:
      - ms_client_secret
    environment:
      - APP_URL=https://kalepin.example.com
      - DOMAIN_ALLOWLIST=example.com
      - SSO_MICROSOFT_TENANT_ID=1b2c3d4e-5f60-7182-93a4-b5c6d7e8f901
      - SSO_MICROSOFT_CLIENT_ID=9f8e7d6c-5b4a-3928-1706-f5e4d3c2b1a0
      - SSO_MICROSOFT_CLIENT_SECRET_FILE=/run/secrets/ms_client_secret
```

Restart Kalepin. Microsoft sign-in turns on only when all three values are present:

| Configuration | Result |
|---|---|
| None of the `SSO_MICROSOFT_*` variables set | Magic link only, no warning |
| Tenant ID, client ID and secret all set | **Sign in with Microsoft** button appears; the boot log shows `SSO: Microsoft sign-in enabled for tenant <tenant ID>` |
| Some set, some missing | Magic link only; a warning at boot names the missing variable |
| Tenant ID is `common` / `organizations` / `consumers`, or any other non-GUID value | Magic link only; a warning at boot explains that only single-tenant is supported |
| Client ID isn't a GUID, the secret file is missing, unreadable or empty, or the authority host isn't `https://` | Magic link only; a warning at boot names the variable |
| Both `SSO_MICROSOFT_CLIENT_SECRET_FILE` and `SSO_MICROSOFT_CLIENT_SECRET` set | Works, using the file; a warning at boot says the file takes precedence |

All these warnings start with `SSO_MICROSOFT:`. A configuration problem never stops Kalepin from starting.

## 8. Try it

1. Check the boot log for `SSO: Microsoft sign-in enabled for tenant <tenant ID>`.
2. Open Kalepin in a private window. The login page should show **Sign in with Microsoft** above the email form.
3. Click it, sign in with your work account, and accept the consent screen if one appears.
4. You should land back in Kalepin, in the account you already used with magic links.

## How accounts are matched

Microsoft's token carries up to two addresses for the person: their email (`email`) and their sign-in name (`preferred_username`). In most organisations these are the same. Kalepin takes both, normalises them (lower-case, trimmed), drops any whose domain isn't in `DOMAIN_ALLOWLIST`, removes duplicates, then:

| Existing Kalepin accounts matching those addresses | What happens |
|---|---|
| **One** | The user is signed in to that account. |
| **None** | A new account is created with the email address, like a first magic-link login. |
| **Several** (the email and sign-in name each belong to a different Kalepin account) | Sign-in is refused and logged. The user can keep using magic link while an admin sorts out the duplicate. |
| **No allowed address at all** | Sign-in is refused: domain not allowed. |

If the Kalepin account has no display name yet, Kalepin fills it with the name from Microsoft. An existing display name is never changed.

Guests invited into your tenant (Entra B2B) sign in through your tenant too, with their own email address. They are accepted only if that address's domain is in `DOMAIN_ALLOWLIST`.

Email aliases (other addresses that deliver to the same mailbox) are **not** in Microsoft's token. Someone who signed up to Kalepin through an alias gets a new, empty account the first time they use Microsoft. They should keep using magic link with their alias until an admin merges the accounts.

Signing in with Microsoft does not unlock encrypted `_secure/` folders or PIN-protected notes. Those still ask for their passphrase or PIN.

## Renewing the client secret

Client secrets expire. When this one does, the Microsoft button stops working and magic links keep working. To renew it without downtime:

1. In Entra, under **Certificates & secrets**, create a **new** client secret. The old one stays valid until its own expiry.
2. Replace the content of `secrets/ms_client_secret` (or `SSO_MICROSOFT_CLIENT_SECRET`) with the new value.
3. Restart Kalepin and check that Microsoft sign-in works.
4. Delete the old secret in Entra.

## Troubleshooting

### Errors shown on Microsoft's sign-in page

Microsoft displays these with an `AADSTS` code before the user ever gets back to Kalepin:

| Error | Cause | Fix |
|---|---|---|
| `AADSTS50011` — redirect URI mismatch | The callback URL isn't registered, or doesn't match exactly | Check `APP_URL` (https, no trailing slash) and the redirect URI in step 1 |
| `AADSTS700016` — application not found in the directory | Wrong client ID, or the app is registered in another tenant | Recheck both IDs from step 2 |
| `AADSTS65001` / `AADSTS90094` — consent required | Admin consent wasn't granted | Ask an admin to do step 4 |
| `AADSTS50105` — user not assigned | **Assignment required** is on and the user isn't in an assigned group | Add them in step 6, or turn assignment off |

### Errors shown by Kalepin

After returning from Microsoft, Kalepin shows one of these above the login form:

| Message | Cause | Fix |
|---|---|---|
| Email domain not allowed | None of the user's addresses is in `DOMAIN_ALLOWLIST` | Add the domain to the allowlist, or use another account |
| Account from another organisation | The token was issued by a different Entra tenant than `SSO_MICROSOFT_TENANT_ID` | Check the tenant ID in step 2 |
| Several Kalepin accounts match this Microsoft account | The user's email and sign-in name point to two different Kalepin accounts | Use magic link until an admin merges or removes the duplicate |
| Sign-in expired, please try again | More than 10 minutes passed on the Microsoft page, the callback was opened in another browser, or two sign-ins were started at once | Start again from the Kalepin login page |
| Sign-in was cancelled | The user declined on Microsoft's page | Try again |
| Microsoft sign-in failed | Kalepin couldn't exchange the sign-in with Microsoft. The `AADSTS` code is in the Kalepin logs | See below |
| Microsoft sign-in is temporarily unavailable | Kalepin couldn't reach Microsoft | Check outbound HTTPS from the server to `login.microsoftonline.com`; use magic link meanwhile |

For **Microsoft sign-in failed**, look in the Kalepin logs for the `AADSTS` code:

| Code in Kalepin logs | Cause | Fix |
|---|---|---|
| `AADSTS7000215` — invalid client secret | The Secret ID was copied instead of the Value, or there's a typo | Create a new secret and copy its **Value** |
| `AADSTS7000222` — client secret expired | The secret reached its expiry date | [Renew it](#renewing-the-client-secret) |

The **Sign in with Microsoft** button doesn't appear: look for the `SSO_MICROSOFT` warning in the Kalepin logs at boot. It names the missing or invalid setting.

## Why single tenant

Entra lets each organisation's admins set their users' email addresses freely. If Kalepin accepted accounts from **any** tenant and matched them by email, an outsider could create their own tenant, give a user your colleague's address, and sign in to Kalepin as that colleague. The domain allowlist wouldn't help, because the forged address is on your domain.

Pinning one tenant ID means only **your** admins control the addresses Kalepin trusts. That's why Kalepin refuses `common`, `organizations` and `consumers`, and rejects any token issued by another tenant.
