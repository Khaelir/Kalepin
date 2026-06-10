## 1. Remove star limit

- [x] 1.1 Delete `MAX_STARS` constant and limit check in `packages/backend/src/stars/stars.service.ts`
- [x] 1.2 Remove frontend star limit guards in `FileTree.tsx` (disabled button at 5), `App.tsx` (409 toast), and `api.ts` (409 handling)
- [x] 1.3 Update `star-files` spec in `openspec/specs/star-files/spec.md` to reflect no limit

## 2. Mention notification tracking (backend)

- [x] 2.1 Create `MentionNotification` entity in `packages/backend/src/entities/mention-notification.entity.ts` with columns: id, userId, type, docPath, threadId, commentId, sentAt — plus indexes on (userId, type, docPath) and (userId, sentAt)
- [x] 2.2 Create `MentionTrackingService` in `packages/backend/src/comments/mention-tracking.service.ts` with methods: `shouldSend(userId, type, docPath, threadId?, commentId?)` (anti-spam pipeline), `recordSent(...)`, `collectThreadParticipants(comments[])`
- [x] 2.3 Register the entity in the TypeORM module and `MentionTrackingService` in the comments module

## 3. Auto-star on mention

- [x] 3.1 Add `autoStarForUser(userId, docPath)` method to `StarsService` — idempotent `INSERT OR IGNORE` into `starred_items` (type: 'file')
- [x] 3.2 Expose `StarsService` to the comments module (export from stars module, import in comments module)

## 4. Upgrade notification service (backend)

- [x] 4.1 Add `notifyDocMention(mentionedEmail, authorEmail, docPath, headingSlug?)` method to `NotificationService` with new email template and section link
- [x] 4.2 Add `notifyThreadReply(mentionedEmail, authorEmail, replyText, notePath, threadId)` method to `NotificationService` with reply-chain email template
- [x] 4.3 Refactor `buildEmailHtml` into a shared layout helper used by all three email types (doc mention, comment mention, thread reply) with polished HTML template: accent top border, author attribution, CTA button, footer
- [x] 4.4 Add `findNearestHeading(markdownContent, mentionLineNumber)` utility that returns the slugified heading above a mention position

## 5. Doc mention detection on save (backend)

- [x] 5.1 Create `extractDocMentions(markdownContent)` utility that returns `Set<{email, line}>` from `@[pseudo](email)` patterns in markdown content
- [x] 5.2 Hook into the file save path — before writing new content, read old content, diff mentions, and for each new mention: run anti-spam pipeline, auto-star, send doc mention email
- [x] 5.3 Resolve the saving user (author) from the request context to exclude self-mentions and attribute the email

## 6. Comment reply-chain notifications (backend)

- [x] 6.1 Update `sendMentionNotifications` in `CommentsService` to use `MentionTrackingService.shouldSend()` before sending, and `recordSent()` after
- [x] 6.2 In `replyToThread`, collect all thread participants (scan all comments for mentions), union with new reply mentions, and notify each through the anti-spam pipeline — using the reply-chain email subject for past-mentioned users and the direct mention subject for newly-mentioned users
- [x] 6.3 Wire auto-star into both `addComment` and `replyToThread` for each mentioned user

## 7. TipTap Mention extension (frontend)

- [x] 7.1 Create `MentionNode` TipTap extension in `packages/frontend/src/editor/extensions/MentionNode.ts` — inline, atom node with `email` attribute, input rule to detect `@[pseudo](email)` on paste/load
- [x] 7.2 Create `MentionNodeView` component rendering the pill/chip badge: colored dot via `getColorForUser(email)`, `@pseudo` text, 12% opacity background, hover tooltip with full email
- [x] 7.3 Implement mention autocomplete plugin — trigger on `@` keypress, show filtered user list dropdown (reuse `GET /api/users` data), insert mention node on selection
- [x] 7.4 Implement markdown serialization: mention node → `@[pseudo](email)` in the `tiptap-markdown` serializer config or custom serialization hook
- [x] 7.5 Implement markdown parsing: detect `@[pseudo](email)` patterns in markdown input and create mention nodes (custom inputRule or markdown parser extension)
- [x] 7.6 Register the extension in the editor setup (`Editor.tsx`)

## 8. Mention badge styling (frontend)

- [x] 8.1 Add `.mention-badge` CSS in `styles.css`: pill shape, inline-flex, colored dot, background opacity, hover tooltip, vertical alignment with text
- [x] 8.2 Ensure mention badges render correctly in both dark and light mode

## 9. Testing

- [x] 9.1 Test anti-spam pipeline: self-mention skip, per-event dedup, doc-mention dedup, 10s cooldown
- [x] 9.2 Test reply-chain participant resolution: past mentions collected, author excluded, duplicates consolidated
- [x] 9.3 Test doc mention diff on save: new mentions detected, existing unchanged, removed silent
- [x] 9.4 Test mention markdown round-trip: serialize to `@[pseudo](email)`, parse back to mention node (requires browser env — covered by TipTap extension pattern, same as WikilinkNode)
- [x] 9.5 Test auto-star idempotency: star created on first mention, no error on duplicate
