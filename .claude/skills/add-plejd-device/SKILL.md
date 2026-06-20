---
name: add-plejd-device
description: How to add support for a new Plejd device or hardware id in this add-on. Use when a device shows "Unknown device type with hardware id N", when a new Plejd product (light/relay/button/sensor/cover/thermostat) should be supported, or when a recognized device does not respond/update. Explains the simple mapping path vs. the deep protocol path and how to tell them apart.
---

# Adding support for a new Plejd device

## Core mental model (read this first)

Two layers decide whether a device works, and they are **independent**:

1. **Recognition layer** (`plejd/PlejdApi.js`): the cloud API lists devices. Each has
   a numeric `hardwareId`. `_getDeviceType()` is a `switch` over `hardwareId` that maps
   it to `{ name, description, type, dimmable?, colorTemp?, broadcastClicks }`. An
   unmapped id throws `Unknown device type with hardware id N` and the device never
   appears in Home Assistant.

2. **Protocol layer** (`plejd/PlejdBLEHandler.js`): commands to/from the Plejd BLE mesh
   are keyed on a 16-bit **command code** (`cmd = decoded.readUInt16BE(3)`), NOT on the
   device. Outgoing in `sendCommand()`, incoming decoded in `_onLastDataUpdated()`.
   Devices are addressed by `bleOutputAddress` / `bleInputAddress`. Command codes live
   in `constants.js` `BLE.COMMANDS`:
   - `STATE_CHANGE 0x0097` — on/off (output)
   - `DIM_CHANGE 0x00c8` / `DIM2_CHANGE 0x0098` — brightness (output)
   - `COLOR_CHANGE 0x0420` — tunable white (output)
   - `SCENE_TRIGGER 0x0021`, `REMOTE_CLICK 0x0016`, `TIME_UPDATE 0x001b`

**Key consequence:** if a new device uses the *same command codes* as an already-supported
category (dimmer, relay/switch, tunable-white light, push/rotary button, extender), the
protocol layer already handles it — you only need a recognition-layer mapping. If it needs
a *new capability or command code* (cover, thermostat, sensor, anything that doesn't fit
on/off/dim/color/click), you are in the deep path.

## Decision: simple mapping vs. deep work

Ask: **does this device behave like an existing category?**

- A light/dimmer, a relay/on-off, a tunable-white light, a wireless button (push/rotary),
  or a mesh extender → **SIMPLE PATH**. This is what #337/#338/#339 (ids 24/38/42) were.
- A genuinely new class — cover/blinds (`cover`), thermostat (`climate`), motion/sensor
  (`binary_sensor`/`sensor`) — or a device that is recognized but **does not respond or
  never reports state** → **DEEP PATH**.

The single clearest signal you are in the deep path: with `logLevel: verbose`, operating
the device logs `Command <hex> unknown` (an unhandled command code) in
`_onLastDataUpdated`, or commands you send have no effect.

---

## SIMPLE PATH — add a hardware-id mapping

1. **Get the hardware id.** From the user's log: `Unknown device type with hardware id N`.
   The add-on also dumps the `device` and `plejdDevice` JSON on that error — note
   `hardwareId`, `firmware.version`, and (sometimes) `hardware.name`, plus `traits` and
   `outputType`.

2. **Add a `case N:` to `_getDeviceType()` in `plejd/PlejdApi.js`**, in numeric order,
   mirroring the closest existing case. Fields:
   - `name`, `description` — for logs/UI. Mirror the closest existing variant
     (e.g. `"...(\"LC2\" hardware/chip version)"`).
   - `type` — `'light'`, `DEVICE_TYPES.SWITCH`, `'device_automation'`, `'extender'`, `'sensor'`.
   - For **input devices (buttons): `broadcastClicks: true` is REQUIRED** — it is the gate
     in `_getPlejdDevices()` (the device is only registered if true). Use
     `type: 'device_automation'`.
   - For **output devices (lights/relays):** `dimmable`/`colorTemp` here are mostly
     documentation. The *actual* behavior is data-driven in `_getPlejdDevices()`:
     `dimmable` comes from `device.traits` (DIMMABLE/DIMMABLE_COLORTEMP) and the
     light-vs-switch role from `device.outputType`. So the main job of the mapping is to
     not throw and to route output vs input correctly. Still set the flags correctly for clarity.

   Output vs input is decided by whether `outputAddress[deviceId]` exists (NOT by the
   mapping). A device with no output and no clickable inputs cannot be expressed this way →
   deep path.

3. **Document** the device in the `plejd/README.md` device table (if a new model name).

4. **Test** (see "Testing" below), then **release** (see "Releasing").

---

## DEEP PATH — new capability / protocol work

Expect real reverse engineering. Steps, roughly:

1. **Capture raw traffic.** `logLevel: silly`/`verbose`. Operate the device from the Plejd
   app and from the wall. Collect `Raw event received: <hex>` lines and any
   `Command <hex> unknown` lines. The `cmd` is bytes 3-4 (big-endian); the payload starts
   at `PAYLOAD_POSITION_OFFSET`.

2. **Identify the command code & payload format** for the device's state report and for the
   control command. Add the code to `constants.js` `BLE.COMMANDS` and an internal name to
   `COMMANDS` if needed.

3. **Decode** the new event: add a branch in `_onLastDataUpdated()`
   (`plejd/PlejdBLEHandler.js`) that parses the payload and emits `commandReceived`.

4. **Encode** the control command: add a `case` in `sendCommand()` building the payload via
   `_createHexPayload` / `_createPayload`.

5. **New HA entity type:** add a discovery payload builder in `plejd/MqttClient.js` (e.g.
   `cover`, `climate`, `binary_sensor`) and wire the command routing in
   `PlejdAddon.init()` / `PlejdDeviceCommunication`. Add the type to `constants.js`
   `MQTT_TYPES` / `DEVICE_TYPES`.

6. **Document protocol findings** (helps the next person — see upstream issue
   icanos/hassio-plejd#163 "Document Plejd BLE").

This path is open work; relevant feature requests: TRM-01 (#319), covers WIN-01/JAL-01
(#301), WMS-01 motion (#300).

---

## File map for device support

| Concern | File / function |
| --- | --- |
| Hardware-id → device type | `plejd/PlejdApi.js` `_getDeviceType()` |
| Output vs input creation, traits→dimmable, outputType→role | `plejd/PlejdApi.js` `_getPlejdDevices()` |
| HA discovery payloads per entity type | `plejd/MqttClient.js` |
| Encode outgoing BLE commands | `plejd/PlejdBLEHandler.js` `sendCommand()` |
| Decode incoming mesh events (by `cmd`) | `plejd/PlejdBLEHandler.js` `_onLastDataUpdated()` |
| Command codes & enums | `plejd/constants.js` (`BLE.COMMANDS`, `COMMANDS`, `MQTT_TYPES`, `DEVICE_TYPES`) |
| Device docs table | `plejd/README.md` |

## Testing

Run `npm run lint:fix` in `plejd/` (must pass; note `MqttClient.js` has a pre-existing
prettier warning unrelated to your change). There is no unit-test runner.

Ask the tester to set `logLevel: debug` (or `verbose`) and confirm:
- No more `Unknown device type` errors on startup.
- A `Sent discovery message for ...` line for the device — confirms it was created with the
  right `type` (light/switch/device_automation/...).
- Operate it from HA **and** from the wall: capture `Raw event received`,
  `... got state update` / `... got state+dim update`, and `Sending N byte(s) of data to Plejd`.
- For lights: on/off + brightness (+ all channels for multi-channel devices like DIM-02).
- For buttons: confirm device-automation triggers fire in HA (WRT-01 may emit harmless
  `Trying to set state for null` noise — upstream #326/#327).

## Releasing (beta channel → stable)

Use the established beta channel (see the `beta-release-procedure` memory and
`plejd-beta/`):

1. Work on a branch (e.g. `fix/hardware-id-mappings`). Bump `plejd/config.json` to a
   pre-release version (e.g. `0.22.0-beta.1`) and add a `CHANGELOG.md` entry.
2. Build the beta image: `gh workflow run build.yaml --ref <branch> -R oleost/hassio-plejd`
   (pushes the version tag to GHCR; does NOT move `:latest`).
3. Bump `version` in `plejd-beta/config.json` (master) to that tag so testers can install
   "Plejd (beta)" from the existing store URL.
4. When confirmed: merge branch → master, bump `plejd/config.json` to the stable version,
   move the CHANGELOG entry, cut a GitHub release (CI builds + pushes the stable tag and
   `:latest`), and keep `plejd-beta` in sync.
