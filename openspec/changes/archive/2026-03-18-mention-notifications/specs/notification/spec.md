# Spec: Mention Email Notification

## Trigger

- When a comment is created (`addComment`) or a reply is posted (`replyToThread`), the backend extracts mentions from the comment text
- For each unique mentioned email (excluding the comment author), a notification email is sent

## Mention Extraction

- Pattern: `/@\[([^\]]+)\]\(([^)]+)\)/g`
- Extracts email addresses from the `(email)` portion of each `@[name](email)` match
- Deduplicates emails (same user mentioned twice in one comment = one email)

## Email Content

- **From:** `SMTP_FROM` env var (default: `noreply@kalepin.app`)
- **To:** mentioned user's email
- **Subject:** `[Kalepin] {author} mentioned you in "{note title}"`
- **Body (HTML):**
  - Who mentioned them (author email or display name)
  - The comment text
  - A direct link to the thread: `{APP_URL}/doc/{path}?thread={threadId}`
- Note title: derived from file path (last segment, extension stripped)

## Delivery

- Sent synchronously via nodemailer (same SMTP config as magic links)
- Dev mode fallback: if `SMTP_USER` is not set, log notification to console
- No retry logic beyond nodemailer defaults
- Failures are logged but do not fail the comment creation (fire-and-forget)

## Exclusions

- Author is never notified of their own mentions
- No notification for thread resolution, deletion, or edits
- No notification for non-mentioned thread participants
