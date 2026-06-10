## ADDED Requirements

### Requirement: Image upload via API
The system SHALL accept image uploads via `POST /api/files/upload` as multipart form data with a `file` field and a `docPath` field. The system SHALL validate that the file is an allowed image type (`image/png`, `image/jpeg`, `image/gif`, `image/webp`, `image/svg+xml`) and does not exceed 50MB. The system SHALL store the file in `_attachments/` at the vault root, named as the first 16 characters of the file's SHA-256 hash with the original file extension. The system SHALL return the hash-based filename and the relative path from `docPath` to the stored file.

#### Scenario: Successful image upload
- **WHEN** a user uploads a valid 2MB PNG image with `docPath` set to `notes/my-doc.md`
- **THEN** the system stores the file as `_attachments/{sha256-prefix}.png` and returns `{ name: "{sha256-prefix}.png", relativePath: "../_attachments/{sha256-prefix}.png" }`

#### Scenario: Duplicate image upload
- **WHEN** a user uploads an image that produces the same SHA-256 prefix as an existing file in `_attachments/`
- **THEN** the system skips writing the file and returns the existing filename and computed relative path

#### Scenario: File exceeds size limit
- **WHEN** a user uploads a file larger than 50MB
- **THEN** the system rejects the upload with a 413 Payload Too Large error

#### Scenario: Invalid file type
- **WHEN** a user uploads a file with MIME type `application/pdf`
- **THEN** the system rejects the upload with a 400 Bad Request error indicating the file type is not allowed

### Requirement: Image serving via API
The system SHALL serve image files from `_attachments/` via `GET /api/files/attachment?name={filename}`. The endpoint SHALL validate that the requested filename contains no path traversal characters and exists in `_attachments/`. The response SHALL include the correct `Content-Type` header based on file extension.

#### Scenario: Serve existing image
- **WHEN** a client requests `GET /api/files/attachment?name=a3f2b1c9d4e5f6a7.png`
- **THEN** the system responds with the binary content of `_attachments/a3f2b1c9d4e5f6a7.png` and `Content-Type: image/png`

#### Scenario: Request non-existent image
- **WHEN** a client requests an attachment name that does not exist in `_attachments/`
- **THEN** the system responds with 404 Not Found

#### Scenario: Path traversal attempt
- **WHEN** a client requests `GET /api/files/attachment?name=../../etc/passwd`
- **THEN** the system rejects the request with a 400 Bad Request error

### Requirement: Clipboard paste inserts image
The editor SHALL intercept clipboard paste events containing image data. When an image is pasted, the editor SHALL upload the image to the server, receive the relative path, and insert `![image](relative-path)` at the cursor position. The inserted text SHALL be sent through the OT layer as a normal text operation.

#### Scenario: Paste screenshot from clipboard
- **WHEN** a user pastes image data from the clipboard while editing `notes/my-doc.md`
- **THEN** the editor uploads the image, and inserts `![image](../_attachments/{hash}.png)` at the cursor position

#### Scenario: Paste text with no image
- **WHEN** a user pastes plain text from the clipboard
- **THEN** the editor handles the paste normally without triggering image upload

### Requirement: Slash command to insert image
The editor SHALL provide an `/image` slash command that opens a file picker dialog. When a file is selected, the editor SHALL upload it and insert the markdown image reference at the cursor position.

#### Scenario: Insert image via slash command
- **WHEN** a user types `/image` and selects a JPEG file from the file picker
- **THEN** the editor uploads the file and inserts `![image](../_attachments/{hash}.jpg)` at the cursor position

#### Scenario: Cancel file picker
- **WHEN** a user types `/image` and cancels the file picker dialog
- **THEN** no image is inserted and the editor returns to normal editing state

### Requirement: Image rendering in editor
The TipTap editor SHALL render markdown image references as visible images. For relative paths containing `_attachments/`, the editor SHALL fetch the image via `GET /api/files/attachment?name={filename}` with the JWT auth header, convert the response to a blob URL, and set that as the `<img src>`. The editor SHALL cache blob URLs in a per-session in-memory map keyed by filename to avoid redundant fetches. Images from other sources (external URLs, other relative paths) SHALL be rendered as-is.

#### Scenario: Render Kalepin attachment
- **WHEN** the editor encounters `![photo](../_attachments/a3f2b1c9.png)` in the markdown
- **THEN** it fetches `/api/files/attachment?name=a3f2b1c9.png` with the JWT auth header, creates a blob URL, and renders an `<img>` tag with the blob URL as `src`

#### Scenario: Render cached attachment
- **WHEN** the editor encounters a second reference to `../_attachments/a3f2b1c9.png` in the same session
- **THEN** it reuses the cached blob URL without making another API request

#### Scenario: Render external URL image
- **WHEN** the editor encounters `![photo](https://example.com/img.png)` in the markdown
- **THEN** it renders an `<img>` tag with `src="https://example.com/img.png"` unchanged

### Requirement: Path rewriting on document move
When a markdown document is moved to a different directory, the system SHALL update all `_attachments/` relative path references in the document content to reflect the new location. The image files in `_attachments/` SHALL NOT be moved.

#### Scenario: Move document to deeper directory
- **WHEN** `notes/doc.md` containing `![](../_attachments/abc.png)` is moved to `notes/sub/doc.md`
- **THEN** the reference is updated to `![](../../_attachments/abc.png)`

#### Scenario: Move document to shallower directory
- **WHEN** `notes/sub/doc.md` containing `![](../../_attachments/abc.png)` is moved to `doc.md`
- **THEN** the reference is updated to `![](._attachments/abc.png)`

#### Scenario: Move document within same directory
- **WHEN** `notes/doc.md` is renamed to `notes/renamed.md`
- **THEN** the `_attachments/` references remain unchanged

### Requirement: Attachments directory auto-creation
The system SHALL automatically create the `_attachments/` directory at the vault root when the first image is uploaded, if it does not already exist.

#### Scenario: First image upload creates directory
- **WHEN** a user uploads an image and `_attachments/` does not exist
- **THEN** the system creates `_attachments/` and stores the image inside it
