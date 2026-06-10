## 1. Fix self-triggered reload loop

- [x] 1.1 In `ot.gateway.ts`, add a session check before broadcasting `file:changed` — if `otService.sessionManager.getSession(event.path)` returns a session, skip the broadcast
- [x] 1.2 Verify that file tree updates (`add`, `unlink`, `addDir`, `unlinkDir`) are NOT suppressed — only `change` events for active sessions

## 2. Fix OT operation composition

- [x] 2.1 Check if `ot-engine.ts` on the server already has a proper `compose` function that can be reused or ported
- [x] 2.2 Implement proper `composeOps(a, b)` in `ot-client.ts` using cursor-walk algorithm: walk both op lists in lockstep, merging retain/insert/delete components correctly
- [x] 2.3 Add unit tests for `composeOps` covering: retain+retain, insert+delete, insert+retain, delete over delete, and the property that `apply(apply(doc, a), b) === apply(doc, compose(a, b))`

## 3. Verify and profile

- [ ] 3.1 Manual test: edit a document and confirm no "File changed externally" toast appears after OT flush _(requires running app)_
- [ ] 3.2 Manual test: edit a file externally (e.g., with a text editor) while no OT session is open and confirm the toast still appears _(requires running app)_
- [ ] 3.3 Profile editor performance on a large document (~100KB+) using browser DevTools Performance tab to establish baseline for future optimization decisions _(requires running app)_
