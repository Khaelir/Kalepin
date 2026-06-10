## MODIFIED Requirements

### Requirement: Embed notes using local ONNX model
The system SHALL generate vector embeddings for all markdown notes using the all-MiniLM-L6-v2 model running locally via ONNX Runtime. Embeddings SHALL be 384-dimensional Float32 vectors. For documents with an active OT session, embedding generation SHALL be deferred according to the embedding-deferral capability; for all other writes, embedding remains synchronous on write.

#### Scenario: Note is embedded on creation
- **WHEN** a new markdown file is added to the vault with no active OT session
- **THEN** the system generates embeddings for each chunk of the note and stores them in the database

#### Scenario: Note is re-embedded on change without active session
- **WHEN** an existing markdown file is modified and has no active OT session
- **THEN** the system removes old embeddings for that path and generates new embeddings for the updated content

#### Scenario: Note with active OT session defers embedding
- **WHEN** an existing markdown file is modified by an OT flush and the document has at least one connected client
- **THEN** the system does NOT generate the embedding immediately; the deferral logic from the embedding-deferral capability applies

#### Scenario: Embeddings are removed on deletion
- **WHEN** a markdown file is deleted from the vault
- **THEN** the system removes all embeddings associated with that file path
