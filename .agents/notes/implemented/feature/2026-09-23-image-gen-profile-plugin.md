# Agent Note: Image generation remains a profile opt-in

Status: implemented

English | [中文](2026-09-23-image-gen-profile-plugin.zh.md)

## Problem

Image generation calls a separately configured image API and accepts image references that can contain user-provided bytes. Mounting that network behavior in every profile would make it part of shipped defaults without an explicit deployment decision.

## Decision

The image-generation tool is a standalone workspace package and is not mounted by `dsh-base` or `dsh-web-app`. A profile owner installs the package and adds its Cordis row to that profile's patch. The package includes both host and browser plugin entries so an installed Web profile can render generated attachments and manage its settings.

The repository keeps the upstream runtime as checked-in JavaScript under `src/` because the supplied source tree contains no TypeScript implementation: `src/runtime.js` is the host plugin, `src/client.js` the browser classic script, with hand-owned type declarations beside the runtime. The workspace build compiles those declarations and bundles the three published artifacts (`lib/index.js`, `lib/invariant.js`, `lib/client.js`); package packing is reproducible from the repository checkout.

## Alternatives considered

- **Mount image generation in every Web profile.** Rejected because it adds an image-provider request path and a credentialed endpoint to defaults without opt-in.
- **Keep the source only in the user installation directory.** Rejected because it leaves no reviewable, commit-addressable source or package artifact in the Harness checkout.
- **Reconstruct TypeScript sources from compiled JavaScript.** Rejected because the original source is unavailable; reconstruction would make an unverified rewrite part of the migration.

## Consequences

Profile owners must choose to install and compose the plugin. The checked-in JavaScript remains the source artifact for its behavior until upstream TypeScript sources are available. Workspace checks cover package metadata and invariant registration; focused runtime tests cover the settings route and image request behavior.
