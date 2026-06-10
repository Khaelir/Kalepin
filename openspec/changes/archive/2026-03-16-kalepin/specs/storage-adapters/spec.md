## ADDED Requirements

### Requirement: Storage adapter interface
The system SHALL define a `StorageAdapter` interface that abstracts file operations. The active adapter is configured via environment variable.

#### Scenario: Adapter selection
- **WHEN** the application starts with `STORAGE_ADAPTER=git` in the environment
- **THEN** the system uses the `GitAdapter` for all file operations

#### Scenario: Default adapter
- **WHEN** no `STORAGE_ADAPTER` environment variable is set
- **THEN** the system defaults to the `LocalFSAdapter`

### Requirement: LocalFS adapter
The system SHALL provide a `LocalFSAdapter` that performs file operations using Node.js `fs` APIs. This adapter covers local bind mounts and NFS mounts (NFS is transparent at the filesystem API level).

#### Scenario: Read file
- **WHEN** the adapter reads a file at a given path
- **THEN** it returns the file content as a string using `fs.readFile`

#### Scenario: Write file
- **WHEN** the adapter writes content to a file path
- **THEN** it creates or overwrites the file on disk using `fs.writeFile`

#### Scenario: Watch for changes
- **WHEN** the adapter starts watching the vault directory
- **THEN** it uses chokidar to emit events for file create, modify, and delete

### Requirement: Git adapter
The system SHALL provide a `GitAdapter` that extends `LocalFSAdapter`. Read, list, and watch operations are inherited. Write, delete, and move operations additionally run `git add` and `git commit` on document session close.

#### Scenario: Commit on session close
- **WHEN** the last user disconnects from a document OR an inactivity timeout (e.g., 5 minutes) fires
- **THEN** the adapter runs `git add <changed-files>` followed by `git commit` with a descriptive message

#### Scenario: View file history
- **WHEN** a user requests the history of a file via the Git adapter
- **THEN** the adapter returns a list of commits that modified the file with timestamps and messages

#### Scenario: View file diff
- **WHEN** a user requests a diff between two revisions of a file
- **THEN** the adapter returns the git diff output for that file between the two revisions
