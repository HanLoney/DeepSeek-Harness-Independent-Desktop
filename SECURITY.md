# Security Policy

## Supported versions

This repository is a developer preview. Security fixes are applied to the latest commit on the default branch; older commits and generated installers are not maintained release lines.

## Reporting a vulnerability

Please do not disclose credentials, API keys, private configuration files, or an exploitable proof of concept in a public issue. Use GitHub's private vulnerability reporting for [HanLoney/Deepseek-harness-desktop](https://github.com/HanLoney/Deepseek-harness-desktop/security/advisories/new) when it is available. If private reporting is unavailable, open a minimal public issue asking for a private contact channel without including sensitive details.

When reporting, include the affected commit, operating system, reproduction steps, impact, and any safe mitigation. Do not attach `.env` files, logs containing tokens, session stores, or generated runtime directories.

The desktop host disables renderer Node integration, enables context isolation and Chromium sandboxing, denies permission requests, and keeps navigation on the selected loopback origin. These safeguards do not replace safe credential handling: keep API keys in local environment or credential storage and never commit them.
