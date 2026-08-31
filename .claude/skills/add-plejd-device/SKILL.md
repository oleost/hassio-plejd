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
   unmapped id returns `null` and `_inferDeviceType()` takes over — it classifies the
   device from structured cloud fields (`outputType`, the `traits` bitfield,
   `inputSetting.buttonType`) and the device still appears in Home Assistant (logged as
   `inferred`). Only a genuinely unclassifiable device, or a category with no handler yet
   (cover / thermostat / motion), is skipped. Adding a `case N:` is still worth it — it
   gives the device a proper name/description and pins its behaviour instead of guessing.

2. **Protocol layer** (`plejd/PlejdBLEHandler.js`): commands to/from the Plejd BLE mesh
   are keyed on a 16-bit **command code** (`cmd = decoded.readUInt16BE(3)`), NOT on the
   device. Outgoing in `sendCommand()`, incoming decoded in `_onLastDataUpdated()`.
   Devices are addressed by `bleOutputAddress` / `bleInputAddress`. Command codes live
   in `constants.js` `BLE.COMMANDS`:
   - `STATE_CHANGE 0x0097` — on/off (output)
   - `DIM_CHANGE 0x00c8` / `DIM2_CHANGE 0x0098` — brightness (output)
   - `COLOR_CHANGE 0x0420` — tunable-white set + slider-stream report (output)
   - `COLOR_TEMP_CHANGE 0x0101` — settled tunable-white report (`<addr> 01 03 01 01 <kelvin LE>`)
   - `SCENE_TRIGGER 0x0021`, `REMOTE_CLICK 0x0016`, `TIME_UPDATE 0x001b`

**Key consequence:** if a new device uses the _same command codes_ as an already-supported
category (dimmer, relay/switch, tunable-white light, push/rotary button, extender), the
protocol layer already handles it — you only need a recognition-layer mapping. If it needs
a _new capability or command code_ (cover, thermostat, sensor, anything that doesn't fit
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

1. **Get the hardware id.** From the user's log (shows at the default level — it's a
   `warn`): `Hardware id N (<title>) is not explicitly mapped; treating it as a <type> …`
   (or, for inputs, `Input device hardware id N … is not explicitly mapped`). The
   surrounding block dumps the `device` and `plejdDevice` JSON — note
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
     documentation. The _actual_ behavior is data-driven in `_getPlejdDevices()`:
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
(#301), WMS-01 motion (#300). `thomasloven/pyplejd` already has working decode/encode for
thermostats, covers and light sensors — use it as a reference implementation (see
"Protocol reference & prior art" below).

---

## Protocol reference & prior art

There is no official spec — the protocol was reverse-engineered by the community. Before
doing deep-path work, read these:

- **icanos/hassio-plejd issue [#163 "Document Plejd BLE"](https://github.com/icanos/hassio-plejd/issues/163)**
  — the de-facto protocol doc (command codes, message layout, device ids, button mapping,
  time format), with the original reverse-engineer **@klali** contributing in the comments.
- **`klali/ha-plejd`** (`custom_components/plejd/`) — the original Python implementation;
  best reference for crypto/auth and the light-level state read. The crypto key is in the
  Plejd app's `site.json` (`.PlejdMesh.CryptoKey`); output addresses in
  `.PlejdMesh._outputAddresses`.
- **`thomasloven/pyplejd`** (`README.md`) — the most up-to-date consolidated
  protocol doc. Started from #163 ("Much information below is taken from
  icanos/hassio-plejd#163") and extends it with device classes this add-on does not yet
  support: **thermostat** (`0x045C` setpoint LE 0.1 °C, `0x0461` mode + PWM), **cover**
  (`0x0420` "minipackage", source-type `0x08`, position 0–255 + tilt), light sensor
  WMS-01, battery. (Tunable-white colour-temperature reporting — `0x0101` / `0x0420` —
  is now handled here, since 0.23.1.) Also
  notes the generalised frame `AA VV TT CC CC PAYLOAD` (`TT` = `00` write / `01` ack /
  `02` reply / `10` do-not-respond) and the "send the dim byte twice for 255 levels
  without endianness" trick. Consumed by the `thomasloven/hass-plejd` custom component
  (native HA Bluetooth, not an add-on) — a good place to cross-check decode logic.
- **`plejd/types/*.d.ts`** in this repo — the cloud API shapes are documented here.
- This repo's `PlejdBLEHandler._encryptDecrypt()` / `_createChallengeResponse()` — the
  AES auth/encrypt scheme (challenge-response with the crypto key).

Concrete facts that are easy to get wrong (from #163 / @klali, not obvious from our code):

- **Message layout:** `device id | command/request | command | data`.
- **command/request prefix:** `0110` = command (no response), `0102` = read (request a
  response). Match `BLE_REQUEST_NO_RESPONSE` / `BLE_REQUEST_RESPONSE` in `PlejdBLEHandler`.
- **Commands are 2-byte big-endian** (`readUInt16BE(3)`): `0021` scene, `0097` state,
  `0098` dim+state ("DIM2"), `00c8` dim+state ("DIM"), `0016` button, `001b` time.
- **Special device ids:** `00` = broadcast (can set ALL lights at once with no delay —
  also wireless buttons), `01` = time broadcast, `02` = scenes. Numeric `03-255` = real
  BLE device id.
- **Dim is 2-byte little-endian** (0–65535); HA only uses 1 byte. Max brightness needs
  `ffff` — hence `sendCommand` writes `(brightness << 8) | brightness` but decode keeps
  only the high byte.
- **Time** is a 32-bit little-endian unix timestamp.
- **Button data[0]:** WPH-01 `00..03` = the four buttons (`button_1..4`); WRT-01 `00` =
  rotary (`button_1`).
- **Reading current state on demand:** the `LIGHTLEVEL_UUID` (`31ba0003-…`) can be queried
  to read current output state (≈10 bytes/output: `0`=id, `1`=state, `5-6`=dim LE). klali
  implements this; **this add-on does not** — useful if a new device type needs explicit
  state polling.

---

## File map for device support

| Concern                                                    | File / function                                                                 |
| ---------------------------------------------------------- | ------------------------------------------------------------------------------- |
| Hardware-id → device type                                  | `plejd/PlejdApi.js` `_getDeviceType()`                                          |
| Output vs input creation, traits→dimmable, outputType→role | `plejd/PlejdApi.js` `_getPlejdDevices()`                                        |
| HA discovery payloads per entity type                      | `plejd/MqttClient.js`                                                           |
| Encode outgoing BLE commands                               | `plejd/PlejdBLEHandler.js` `sendCommand()`                                      |
| Decode incoming mesh events (by `cmd`)                     | `plejd/PlejdBLEHandler.js` `_onLastDataUpdated()`                               |
| Command codes & enums                                      | `plejd/constants.js` (`BLE.COMMANDS`, `COMMANDS`, `MQTT_TYPES`, `DEVICE_TYPES`) |
| Device docs table                                          | `plejd/README.md`                                                               |

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

**One accumulating beta branch per stable release.** Named `beta/X.Y.Z` (the target
version), it collects every fix headed for that release — you do NOT need a branch per
fix. See the `beta-release-procedure` and `stable-release-via-pr` memories.

### Adding a fix to the current beta

1. Branch exists as `beta/X.Y.Z`. Commit the fix straight to it (or develop on a
   throwaway `fix/…` branch and `git merge` it in — do that only when a fix is risky
   enough that you might want to drop it).
2. Bump `plejd/config.json` `version` to the next `X.Y.Z-beta.N`. Add / extend the
   `**Fixed:**` bullets under the `## [X.Y.Z]` heading (which already carries a `> Beta —
…` blockquote). Keep bullets final-release quality — don't tag them `(beta.N)`.
3. Lint (`plejd/` — on Windows: `npm install --ignore-scripts` once, then
   `node_modules/.bin/eslint` + `prettier`; a plain `npm install` fails on the native BLE
   dep).
4. Push the branch. `gh workflow run build.yaml --ref beta/X.Y.Z -R oleost/hassio-plejd`
   → builds + pushes `ghcr.io/oleost/{arch}-hassio-plejd:X.Y.Z-beta.N` (does NOT move
   `:latest`).
5. Bump `version` in `plejd-beta/config.json` **on master** to `X.Y.Z-beta.N`, push
   master. Testers update the "Plejd (beta)" add-on from the existing store URL.

### Promoting to stable (when the beta is confirmed)

Via a **pull request** (not a direct push to master — the established practice):

a. On `beta/X.Y.Z`: `git merge origin/master`; in the CHANGELOG delete the `> Beta — …`
blockquote and set the date; bump `plejd/config.json` **and** `plejd-beta/config.json`
to `X.Y.Z`; lint.
b. `gh pr create -R oleost/hassio-plejd --base master` with a body summarising the release.
c. Wait for the build CI (`build.yaml`, build-only on PRs — both arches green), then
`gh pr merge --merge` (a real merge commit — **never squash**).
d. `gh release create X.Y.Z -R oleost/hassio-plejd` right after merge — CI then builds +
pushes `:X.Y.Z` and moves `:latest`.
e. Delete `beta/X.Y.Z` (merged; `delete_branch_on_merge` handles the remote).
