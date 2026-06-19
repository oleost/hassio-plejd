# Plejd (beta)

Beta channel for the [Plejd add-on](../plejd/README.md). It is a thin pointer that
pulls a **pre-built beta image** from GHCR so you can test unreleased changes without
manual file copying — the actual code lives in `../plejd/` and is built by CI.

## How it works

This add-on has no source of its own. Its `config.json` sets
`image: ghcr.io/oleost/{arch}-hassio-plejd` and a beta `version`, so Home Assistant
pulls `ghcr.io/oleost/{arch}-hassio-plejd:<version>` — the image built from the beta
branch via the build workflow (`workflow_dispatch`).

## Testing a beta

1. You already have this repository added (same URL as the stable add-on:
   <https://github.com/oleost/hassio-plejd>). Both **Plejd** and **Plejd (beta)** show
   up in the Add-on Store.
2. Install **Plejd (beta)** and configure it exactly like the stable add-on.
3. Run only one of the two at a time — they would compete for the same Bluetooth
   adapter and Plejd mesh connection (one BLE connection per Plejd device).

Configuration options are identical to the stable add-on — see the
[stable add-on documentation](../plejd/README.md).

## Maintainer notes

To publish a new beta: build the beta image from the feature branch
(`gh workflow run build.yaml --ref <branch> -R oleost/hassio-plejd`), then bump
`version` here to the matching tag. Keep this folder out of the build workflow's
trigger paths — it ships no code, only the pointer.
