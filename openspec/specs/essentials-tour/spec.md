## Purpose

Guided tour that introduces core editor features to new users on first login.

## Requirements

### Requirement: Auto-trigger for new users
The essentials tour SHALL automatically start when a user logs in and has never completed it (no entry in `completedTours` for `essentials`). It SHALL start after the workspace has fully loaded (file tree populated, WebSocket connected).

#### Scenario: First login
- **WHEN** a new user logs in for the first time and the workspace finishes loading
- **THEN** the essentials tour starts automatically at step 1

#### Scenario: Returning user who completed the tour
- **WHEN** a user who has completed the essentials tour logs in
- **THEN** the essentials tour does NOT auto-start

### Requirement: 10-step essentials flow
The essentials tour SHALL consist of exactly 10 steps in this order:

1. **Welcome** (passive, centered card): "Your collaborative markdown workspace. Let's get you started."
2. **Create a note** (active, target: New File button): "Click here to create a note." Waits for the InputModal to appear.
3. **Name it** (active, target: InputModal): Input pre-filled with "Tutorial - {username}". "Give it a name — or keep this one. Hit Enter." Waits for file creation.
4. **Try a slash command** (active, target: editor area): "Type / to see what you can insert." Waits for slash menu to appear.
5. **Insert a table** (active, target: /table entry in slash menu): "Select Table." Waits for table insertion.
6. **Slash commands explained** (passive, target: inserted content area): "Tables, tasks, code blocks, callouts — all from /."
7. **Find anything** (passive, target: search button): "Cmd+K to search across all your notes."
8. **Start a discussion** (passive, target: comments panel area): "Select text and add a comment. Your team sees it in real-time."
9. **See what changed** (passive, target: changes icon, with B-lite illustration): "When your team edits notes, changes appear here."
10. **Done** (passive, centered card): "Hit ? anytime to revisit or discover new features." Shows [Keep it] / [Delete it] prompt for tutorial note.

#### Scenario: Full essentials tour completion
- **WHEN** a new user goes through all 10 steps and clicks [Done]
- **THEN** the tour is marked as completed and the user is prompted to keep or delete the tutorial note

#### Scenario: User skips at step 5
- **WHEN** a user clicks [Skip] on step 5
- **THEN** the tour exits, the tutorial note remains (it was already created), and the tour is NOT marked as completed

### Requirement: Tutorial note naming
The tutorial note SHALL be named "Tutorial - {username}" where {username} is derived from the user's email address (everything before the @ sign). The name SHALL be pre-filled in the InputModal at step 3.

#### Scenario: User with email alice@example.com
- **WHEN** the essentials tour reaches step 3 (Name it)
- **THEN** the InputModal is pre-filled with "Tutorial - alice"

### Requirement: Tutorial note cleanup prompt
The final step (step 10) SHALL display two buttons alongside [Done]: [Keep it] and [Delete it]. [Delete it] SHALL delete the tutorial note file from the vault. [Keep it] SHALL leave it as-is.

#### Scenario: User clicks Delete it
- **WHEN** the user clicks [Delete it] on step 10
- **THEN** the tutorial note file is deleted from the vault and the file tree refreshes

#### Scenario: User clicks Keep it
- **WHEN** the user clicks [Keep it] on step 10
- **THEN** the tutorial note remains in the vault

### Requirement: Slash menu guided to /table
Step 5 SHALL highlight the /table entry in the slash menu. The step advances when a table is inserted into the editor (not just when the menu item is clicked — the table must actually appear).

#### Scenario: User selects /table
- **WHEN** the user clicks /table in the slash menu during step 5
- **THEN** a table is inserted into the editor and the tour advances to step 6
