# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

A Home Assistant **add-on** that bridges Plejd home automation devices (lights, switches, relays, scenes, wireless buttons) to Home Assistant. The add-on talks to the Plejd mesh over Bluetooth Low Energy (via BlueZ on D-Bus) and to Home Assistant over MQTT (with auto-discovery). It is a Node.js application packaged as a Home Assistant add-on container.

The repository is an add-on **repository** (added to the HA Add-on Store). The actual add-on lives entirely in `plejd/`; the repo root only holds `repository.json`, `README.md`, and CI.

This is a fork of [icanos/hassio-plejd](https://github.com/icanos/hassio-plejd). The fork's distinguishing changes are scene-related (scenes as Device Automation triggers, scene history Event entities, retained-message handling) plus a pre-built GHCR image pipeline. See the root `README.md` "This fork" section for specifics.

## Commands

All npm commands run from the `plejd/` directory:

```bash
cd plejd
npm install            # install dependencies
npm run lint           # prettier --check + eslint (both)
npm run lint:fix       # prettier --write + eslint --fix
```

There is **no test runner and no build step** for the JS. `plejd/test/test.ble.bluez.js` is a manual smoke script (run with `node test/test.ble.bluez.js` after hardcoding a `cryptoKey`), not an automated test — it requires real BLE hardware and a Plejd mesh.

Linting follows the Airbnb base config with project-specific overrides in `plejd/.eslintrc.js` (notably: `_`-prefixed "private" members allowed, function hoisting allowed). Prettier config is at repo root `.prettierrc.js` (100 col, single quotes, trailing commas). Always run `npm run lint:fix` before committing.

## Architecture

The app is event-driven. `main.js` instantiates a single `PlejdAddon` (in `PlejdAddon.js`) which constructs and wires together all the major components and is the **central message router** between Plejd and Home Assistant. Read `PlejdAddon.init()` first — it is the map of how everything connects.

### The components (all in `plejd/`)

- **`DeviceRegistry.js`** — the shared in-memory state store. Holds the crypto key, all physical/output/input/scene devices, and the many id-mapping dictionaries (e.g. `outputUniqueIdByBleOutputAddress`). Nearly every other component takes the registry in its constructor; it is the single source of truth that decouples the API, BLE, and MQTT layers.
- **`PlejdApi.js`** — logs into Plejd's cloud HTTP API to fetch the site, devices, and the **crypto key** required to talk to the mesh. Caches the response to `/data/cachedApiResponse.json`; the `preferCachedApiResponse` option (and automatic fallback on API failure) reads from that cache instead of hitting the network. Populates the `DeviceRegistry`.
- **`PlejdBLEHandler.js`** — the lowest layer. Talks to BlueZ over D-Bus (`dbus-next`) to scan, connect, authenticate (challenge/response using the crypto key), and exchange encrypted packets with the mesh. Decodes raw mesh events (state/dim/scene/button) and encodes outgoing commands. This is the largest and most protocol-heavy file.
- **`PlejdDeviceCommunication.js`** — sits on top of the BLE handler. Owns the **write queue** (rate-limited BLE writes, `writeQueueWaitTime`), retry logic, and brightness **transitions** (interpolating dim steps over time). Emits high-level `stateChanged` / `buttonPressed` / `sceneTriggered` events upward.
- **`MqttClient.js`** — connects to the MQTT broker, publishes Home Assistant **auto-discovery** config, state, and availability topics, and subscribes to HA commands. Encodes the device→topic naming scheme (see the `getTopicName`/`getBaseTopic` helpers at the top). Emits `stateChanged` (command from HA) and `connected` events.
- **`SceneManager.js` / `Scene.js` / `SceneStep.js`** — scenes are not real Plejd devices; a scene is a list of steps (per-device target states). `SceneManager.executeScene()` replays those steps through `PlejdDeviceCommunication`.
- **`Configuration.js`** — static singleton that reads add-on options from `/data/options.json` merged over defaults in `/plejd/config.json`. Call `Configuration.getOptions()` / `getAddonInfo()` anywhere; secrets are scrubbed from log output.
- **`Logger.js`** — Winston-based, color-coded, namespaced loggers via `Logger.getLogger('name')`. Log level comes from the `logLevel` option.
- **`constants.js`** — BLE command codes, BlueZ/D-Bus interface names, Plejd GATT UUIDs, and the MQTT type/topic/state enums. Shared across layers.

### Data flow

- **HA → Plejd (command):** MQTT message → `MqttClient` emits `stateChanged` → `PlejdAddon` routes it → `PlejdDeviceCommunication.turnOn/turnOff` (or `SceneManager.executeScene` for scenes) → write queue → `PlejdBLEHandler` → mesh. Switches/scenes get an optimistic state echoed straight back to HA (no mesh confirmation).
- **Plejd → HA (event):** mesh packet → `PlejdBLEHandler` decodes → `PlejdDeviceCommunication` emits `stateChanged`/`buttonPressed`/`sceneTriggered` → `PlejdAddon` → `MqttClient` publishes to HA.

The `DeviceRegistry` translates between Plejd's multiple id spaces (BLE addresses, device ids, output unique ids, scene ids) at each hop — when adding device handling, that mapping is usually where the work is.

### Runtime / packaging

- The container is built from a Home Assistant base image (`build.yaml` pins the base; `Dockerfile` installs Node, BlueZ, D-Bus build deps, runs `npm install`). It needs `host_network`, `host_dbus`, and `apparmor: false` (see `config.json`) for BLE access.
- The s6 service scripts live in `plejd/rootfs/`: `etc/services.d/plejd/run` → `usr/bin/plejd.sh` → `node /plejd/main.js`. `etc/cont-init.d/10-plejd-perms` fixes script perms at startup.
- `main.js` wraps everything in a try/catch that **restarts the whole add-on after 60s** on any catastrophic error.

### CI / releases

`.github/workflows/build.yaml` builds the add-on image per-arch (`aarch64`, `amd64`) on native runners using `home-assistant/builder`. It builds-only on push/PR; it builds **and pushes to GHCR** only on published release or manual dispatch. Home Assistant pulls these pre-built images (`image` field in `config.json`) rather than building locally.

**The version lives in `plejd/config.json`** and drives the image tag. Bump it there, and add a matching entry to `plejd/CHANGELOG.md`, when releasing.

## Adding a new Plejd device / hardware id

Recognition (`PlejdApi._getDeviceType`, a `switch` over `hardwareId`) and the BLE protocol
(`PlejdBLEHandler`, keyed on command codes) are independent layers. A device that behaves
like an existing category (light/relay/button/extender) usually needs only a new mapping
case; a new capability (cover/thermostat/sensor) needs protocol + discovery work. The
full runbook (decision tree, file map, testing, beta release) is the **`add-plejd-device`
skill** — invoke it for this task.

## Conventions

- The version in `plejd/config.json` is the single source of truth for the add-on version (also surfaced via `Configuration.getAddonInfo()`).
- Type hints are provided through JSDoc referencing `.d.ts` files in `plejd/types/` (no TypeScript compilation; `jsconfig.json` enables editor checking).
- Inter-component communication is via Node `EventEmitter` events with `static EVENTS` enums on each class — prefer that pattern over direct cross-component calls.
