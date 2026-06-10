## ADDED Requirements

### Requirement: Fullscreen modal editor
The draw.io editor SHALL open in a fullscreen modal overlay containing a sandboxed iframe.

#### Scenario: Editor modal opens
- **WHEN** the draw.io editor is triggered (via Edit button or /drawio command)
- **THEN** a fullscreen modal overlay appears (similar to image maximize modal)
- **THEN** the modal contains a sandboxed iframe running the draw.io editor
- **THEN** the diagram data is loaded into the editor via postMessage

#### Scenario: Editor modal closes via Escape
- **WHEN** the user presses Escape while the editor modal is open
- **THEN** the modal closes
- **THEN** if there are unsaved changes, the user is prompted to save or discard

#### Scenario: Editor modal closes via close button
- **WHEN** the user clicks the close/X button on the modal
- **THEN** the modal behaves the same as pressing Escape

### Requirement: Sandboxed iframe security
The draw.io editor iframe SHALL be sandboxed with strict security controls.

#### Scenario: Iframe sandbox attributes
- **WHEN** the editor iframe is created
- **THEN** the sandbox attribute is set to `allow-scripts` only
- **THEN** no `allow-same-origin` is present

#### Scenario: Iframe CSP blocks network
- **WHEN** the iframe HTML is constructed
- **THEN** it includes a CSP meta tag with `connect-src: 'none'`
- **THEN** the editor JS cannot make any network requests (fetch, XHR, WebSocket, beacon)

#### Scenario: Iframe cannot access parent
- **WHEN** JS executes inside the iframe
- **THEN** it cannot access the parent window's DOM, cookies, localStorage, or auth tokens

### Requirement: Vendored draw.io JS with lazy loading
The draw.io editor JS SHALL be vendored from a specific release and lazy-loaded.

#### Scenario: No draw.io editor opened
- **WHEN** the user has not opened any draw.io editor in this session
- **THEN** the draw.io JS (~5MB) is NOT loaded

#### Scenario: First editor open triggers load
- **WHEN** the user opens the draw.io editor for the first time in a session
- **THEN** the vendored JS is loaded into the iframe
- **THEN** a loading indicator is shown while the JS loads and initializes

#### Scenario: Subsequent editor opens reuse cached JS
- **WHEN** the user opens the draw.io editor again after closing it
- **THEN** the JS is served from browser cache
- **THEN** the editor opens faster than the first time

### Requirement: Clipboard via postMessage proxy
Clipboard operations inside the draw.io editor SHALL work through a postMessage proxy with Kalepin.

#### Scenario: Copy shapes in draw.io
- **WHEN** the user selects shapes in draw.io and presses Cmd/Ctrl+C
- **THEN** draw.io serializes the selection
- **THEN** a postMessage with the serialized data is sent to the parent
- **THEN** Kalepin validates the content is draw.io XML
- **THEN** Kalepin writes the data to the system clipboard

#### Scenario: Paste into draw.io
- **WHEN** the user presses Cmd/Ctrl+V while the draw.io editor has focus
- **THEN** Kalepin intercepts the paste event
- **THEN** Kalepin reads the system clipboard content
- **THEN** Kalepin validates and sanitizes the clipboard data
- **THEN** Kalepin sends the data to the iframe via postMessage
- **THEN** draw.io processes the pasted content

#### Scenario: Paste of non-draw.io content
- **WHEN** the user pastes text that is not draw.io XML (e.g., plain text)
- **THEN** the content is still forwarded to draw.io (draw.io handles text labels)

#### Scenario: Clipboard validation rejects suspicious content
- **WHEN** clipboard data exceeds a reasonable size limit
- **THEN** the paste operation is silently dropped

### Requirement: Keyboard shortcut coordination
Certain keyboard shortcuts SHALL be forwarded from the iframe to Kalepin via postMessage.

#### Scenario: Cmd/Ctrl+S saves diagram
- **WHEN** the user presses Cmd/Ctrl+S while the draw.io editor is open
- **THEN** draw.io sends a save event via postMessage
- **THEN** Kalepin receives the updated SVG data
- **THEN** Kalepin saves the SVG to `_attachments/` and updates the note reference

#### Scenario: Escape closes editor
- **WHEN** the user presses Escape in the draw.io editor
- **THEN** the iframe sends a close/exit event via postMessage
- **THEN** Kalepin closes the editor modal (with unsaved changes prompt if needed)

#### Scenario: draw.io internal shortcuts work normally
- **WHEN** the user presses Cmd/Ctrl+Z, Cmd/Ctrl+A, Delete, or other standard editing shortcuts
- **THEN** draw.io handles them internally (undo, select all, delete shape, etc.)
- **THEN** no postMessage is sent to Kalepin for these

### Requirement: Save flow with content-addressed naming
Saving a diagram SHALL write the updated SVG to `_attachments/` and update the note's markdown reference.

#### Scenario: Save updates SVG and note reference
- **WHEN** the user saves from the draw.io editor
- **THEN** the updated SVG (with embedded draw.io XML in `content` attribute) is sent to the backend
- **THEN** the backend writes it to `_attachments/` with a new content-addressed filename
- **THEN** the markdown image reference in the note is updated to point to the new filename
- **THEN** the old file is handled by the existing orphan cleanup mechanism

#### Scenario: Save with no changes
- **WHEN** the user saves but the diagram has not been modified
- **THEN** the SVG content hash is unchanged
- **THEN** no new file is written and no reference is updated

### Requirement: draw.io feature configuration
Unused draw.io features SHALL be disabled via draw.io's configuration parameters.

#### Scenario: Cloud storage features disabled
- **WHEN** the draw.io editor initializes
- **THEN** cloud storage integrations (Google Drive, OneDrive, Dropbox) are disabled

#### Scenario: External image loading disabled
- **WHEN** the draw.io editor initializes
- **THEN** loading images from external URLs is disabled (CSP blocks it anyway, but the UI options should also be hidden)

#### Scenario: Sharing features disabled
- **WHEN** the draw.io editor initializes
- **THEN** share/publish functionality is hidden from the UI

### Requirement: Font handling
The draw.io editor SHALL work with vendored fonts or system font fallback, without external font loading.

#### Scenario: Common fonts available
- **WHEN** the draw.io editor renders a diagram using common fonts
- **THEN** the fonts render correctly using vendored font files or system equivalents

#### Scenario: Uncommon font fallback
- **WHEN** a diagram uses a font that is not vendored or available on the system
- **THEN** the text renders using a system fallback font
- **THEN** the diagram layout is preserved (text may reflow slightly)
