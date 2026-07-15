# Changelog

All notable changes to `pi-review` are documented here.

## Format

- Keep `## [Unreleased]` at the top.
- Use release headers as `## [X.Y.Z] - YYYY-MM-DD`.
- Group entries under `### Added`, `### Changed`, `### Fixed` (optionally `### Removed` / `### Security`).
- Keep entries short and operator/user-facing.

## [Unreleased]

### Added

- None.

### Changed

- None.

### Fixed

- None.

## [1.2.0] - 2026-07-14

### Added

- Added persistent global and project configuration for the review thinking level.

### Changed

- None.

### Fixed

- None.

## [1.1.6] - 2026-07-10

### Added

- None.

### Changed

- Restored the default review thinking level to `high`.

### Fixed

- None.

## [1.1.5] - 2026-07-09

### Added

- None.

### Changed

- Increased the default review thinking level to `xhigh` for deeper analysis.

### Fixed

- None.

## [1.1.4] - 2026-06-23

### Added

- None.

### Changed

- Tightened review validation instructions to use adversarial validators for uncertain or high-risk findings.

### Fixed

- None.

## [1.1.3] - 2026-06-12

### Added

- None.

### Changed

- Added a validation pass to challenge candidate review findings before reporting them.

### Fixed

- None.

## [1.1.2] - 2026-05-21

### Added

- None.

### Changed

- Added tighter subagent-based review orchestration for large or context-heavy changes.

### Fixed

- None.

## [1.1.1] - 2026-05-07

### Added

- None.

### Changed

- Switched the pi coding-agent imports and dependencies to the `@earendil-works` scope at `^0.74.0`.

### Fixed

- None.

## [1.1.0] - 2026-05-07

### Added

- Added `/review-back` to return to the reviewed branch with the review findings prefilled in the editor.

### Changed

- None.

### Fixed

- None.

## [1.0.1] - 2026-05-06

### Added

- None.

### Changed

- Updated review instructions to check completeness against stated task requirements and acceptance criteria.
- Updated review instructions to avoid stopping after the first few findings and perform a final missed-issue pass.

### Fixed

- None.

## [1.0.0] - 2026-04-27

### Added

- Initial public release of the `/review` pi extension.
- Added a README preview screenshot showing example review findings and recommendations.
- Added new-branch maintainer review flow with conversation context, optional focus text, and temporary high-thinking mode.
- Added npm trusted-publishing release workflow, release validation scripts, and release runbook.

### Changed

- None.

### Fixed

- None.
