## ADDED Requirements

### Requirement: Pre-built model Docker image
The system SHALL provide a dedicated Docker image containing the ONNX embedding model, published to `ghcr.io/Khaelir/kalepin-models:e5-base`.

#### Scenario: Model image is built by CI
- **WHEN** `packages/backend/scripts/download-model.mjs` changes on the main branch
- **THEN** CI SHALL build `Dockerfile.models` and push the image to `ghcr.io/Khaelir/kalepin-models:e5-base`

#### Scenario: Model image can be rebuilt manually
- **WHEN** a developer triggers the `build-model-image` workflow via `workflow_dispatch`
- **THEN** CI SHALL rebuild and push the model image regardless of file changes

### Requirement: Main Dockerfile uses pre-built model image
The main `Dockerfile` SHALL reference `ghcr.io/Khaelir/kalepin-models:e5-base` as the model build stage instead of downloading from HuggingFace at build time.

#### Scenario: Docker build with pre-built model
- **WHEN** the main Docker image is built
- **THEN** the model stage SHALL pull from the pre-built image (no HuggingFace download)
- **THEN** the runtime stage SHALL COPY model files from the pre-built image stage as before

### Requirement: Registry-based Docker cache
The `build-prod.yml` workflow SHALL use `type=registry` cache with a fixed tag so cache is shared across all tag pushes.

#### Scenario: Cache shared across tag pushes
- **WHEN** a new `v*` tag is pushed
- **THEN** the build SHALL read cache from `ghcr.io/Khaelir/kalepin:cache`
- **THEN** the build SHALL write cache to `ghcr.io/Khaelir/kalepin:cache` with `mode=max`

#### Scenario: Cached layers are reused
- **WHEN** a build runs and the dependency layer has not changed since the last build
- **THEN** the dependency install step SHALL be a cache hit (not re-executed)
