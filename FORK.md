# About this fork

This repository is a fork of
[icanos/hassio-plejd](https://github.com/icanos/hassio-plejd), the original Home
Assistant add-on that bridges Plejd BLE devices to Home Assistant over MQTT.

## Why the fork exists

Two reasons, in order of importance today:

1. **Upstream is no longer maintained.** The original repository has gone a long time
   with no releases and no meaningful response to issues or pull requests. People
   running it still hit bugs and still buy new Plejd hardware that needs support.
   Someone has to keep the lights working — literally — so this fork does.
2. **Scene handling needed work.** The fork originally started to fix how Plejd
   *scenes* integrate with Home Assistant (scenes as Device Automation triggers,
   per-scene "Last Triggered" history, no ghost activations on restart). Those
   changes are described in the [repository README](README.md#this-fork).

## What "maintained" means here

- **Bug triage.** Known issues carried over from upstream are tracked in
  [`TODO.md`](TODO.md) with priorities and status.
- **New hardware.** New Plejd product / hardware ids are added as they show up — see
  the `add-plejd-device` skill and `CLAUDE.md` for the runbook.
- **Regular releases.** The version in [`plejd/config.json`](plejd/config.json) is
  bumped and a [changelog entry](plejd/CHANGELOG.md) added for every fix, not just
  large changes. Releases are published on GitHub, which builds and pushes the
  pre-built images to GHCR.
- **A beta channel.** The **Plejd (beta)** add-on
  ([`plejd-beta/`](plejd-beta/README.md)) ships unreleased changes for testing before
  they land in the stable add-on.

## Relationship to upstream

- The add-on slug (`plejd`), the container image name and the option schema are kept
  compatible with upstream so existing installs update in place rather than needing a
  reinstall.
- If upstream ever revives, useful changes from here can be contributed back.
- All original copyright and the Apache-2.0 license are retained. This add-on was
  originally created by [Marcus Westin](https://github.com/icanos/hassio-plejd) and
  inspired by [ha-plejd](https://github.com/klali/ha-plejd).

## Not affiliated with Plejd

This is a hobby project. It is not affiliated with, endorsed by, or supported by
Plejd.
