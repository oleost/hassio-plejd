# TODO — upstream issue triage

Triage of open issues on [icanos/hassio-plejd](https://github.com/icanos/hassio-plejd/issues)
(the upstream this repo is forked from), assessing which are real bugs worth fixing
here. Feature requests and unclear/likely-not-our-bug reports are listed at the bottom
for reference but are not scheduled.

Legend: `[ ]` todo · `[~]` needs triage · `[x]` done/closed for us

---

## Resolved / not pursuing

- [x] **#320 — Scene not triggering scene entity, `device id null`.** This is the
      reason this fork exists; fixed by the scene rework. No further action.
- [x] **#331 — Crash loop on Node 12 base (`||=` in `@so-ric/colorspace`).** Assumed
      fixed: this fork builds on `hassio-addons/base 21.0.0` (see `plejd/build.yaml`),
      which ships a modern Node. Not spending more energy unless it resurfaces.
- [x] **#336 — aarch64 build failure (musl conflict on base 18.2.0).** Assumed fixed:
      base bumped to 21.0.0, CI builds per-arch on native runners, and users pull
      pre-built images instead of building locally. Not pursuing.

- [x] **#339 / #338 / #332 / #337 — Unknown device hardware id `42`, `38`, `24`.**
      Newer hardware revisions reported ids not mapped in the device-type lookup.
      Fixed together in `plejd/PlejdApi.js` (`_getDeviceType` cases 24/38/42), shipped
      in **stable 0.22.0** (2026-08-29).
      - `24` = DIM-02-LC2 (firmware 6.43.3, output) — confirmed working by the #337
        reporter on the beta.
      - `38` = WPH-01-LC (`wph-01-lc-v4.41.3`, "2024Q3 Release", input) and
        `42` = WRT-01 (wireless rotary, input) — shipped to stable unconfirmed, with a
        "feedback welcome" note in the changelog and README. Recognition-only change,
        no risk to other devices. Reopen only if a reporter says it still fails.

- [x] **Unknown hardware ids in general — graceful fallback.** `_getDeviceType()` no
      longer throws on an unmapped id; `_inferDeviceType()` classifies from
      `device.traits` / `device.outputType` / `inputSetting.buttonType` (approach
      borrowed from `thomasloven/pyplejd`, which dropped its hw-id table entirely).
      Plain lights/relays/buttons with unknown ids now work automatically. Covers,
      thermostats and motion sensors are detected and logged as "not yet supported"
      then skipped. Rationale + `pyplejd` command-code notes in
      `docs/device-classification.md`. Shipped in **stable 0.23.0** (2026-08-31,
      PR #1). This makes most future "unknown hardware id" reports non-issues.

## P1 — Real bugs, broad impact, clear fix

- [x] **#325 — `Cannot read property 'publish' of undefined` on eager discovery.**
      Confirmed the pattern in our fork: `PlejdAddon.init()` called
      `sendDiscoveryToHomeAssistant()` right after `mqttClient.init()`, before the
      broker connection was up — publishing into a not-yet-connected client and
      duplicating every discovery message (seen in a real 0.23.0-beta.1 startup log).
      Removed the premature call; `sendDiscoveryToHomeAssistant()` now no-ops unless
      `this.client.connected`. Discovery still fires from the `connected` handler and
      on every HA birth message. Shipped in **stable 0.23.0** (2026-08-31).

## P2 — Real logic bugs, more nuanced

- [~] **#255 — Min brightness mismatch (HA 0 = off, Plejd 0 = on/min).**
      Largely a non-issue in this fork. The receive direction is already handled:
      `PlejdDeviceCommunication._bleCommandReceived` maps `dim === 0 && state === 1` →
      `dim = 1`, so a Plejd load sitting on its app-configured minimum shows in HA as
      "on, ~0%" (1/255 rounds to 0% in the card) and never as off / full. Verified on a
      real setup 2026-08-31.
      The send direction *cannot* be fixed: HA's light model defines brightness 0 ≡ off,
      and `_setLightState` maps any `brightness <= 0` to `TURN_OFF`. "On but held at
      absolute minimum from the HA slider" is not expressible in HA for any light. The
      Plejd app's sub-1% minimum-brightness calibration is Plejd's own and not exposed.
      Only remainder: the reporter's narrow claim that `light.turn_off` *with a
      `transition:`* from minimum animates full→0 instead of min→0. Not reproduced in
      current code (`_transitionTo` reads `initialBrightness` from the stored dim, which
      is 1 at minimum); likely an old-upstream artefact. Low value, hard to repro —
      revisit only if someone reports the transition glitch on this fork.

- [~] **#152 — Room brightness never updated on state changes.**
      **The feature** (`includeRoomsAsLights = true`, `PlejdApi._getRoomDevices`): a Plejd
      room is a mesh **group address**, so one BLE write dims/fades every light in it
      atomically. That is its whole point — a HA light group would instead send N separate
      writes through the rate-limited queue (slow, lights cascade instead of moving
      together). Also matches how the Plejd app / wall panels model rooms.
      **What's broken:** the room entity has no state of its own in the mesh — Plejd emits
      events per light address, never for the room address. So the room entity only updates
      when *HA* commands the room; change a member any other way (Plejd app, wall switch,
      the member's own HA entity) and the room entity goes stale. Stale value → next room
      transition starts from the wrong brightness. Worst case is a long "good night"
      fade-to-off: the room entity turns off instantly (optimistic) while members are still
      fading, and members can flicker back on as their transitions finish — two overlapping
      representations of the same physical lights fighting.
      **Options:** (A) recompute room state on every member `stateChanged` —
      `state = OR(members)`, `brightness = MAX(members)` (what the Plejd app does),
      debounced, behind the flag; medium effort in the state-routing layer, needs a tester
      who actually uses the feature. (B) fix only the transition interaction; fragile,
      separate entities. (C) document that HA Areas + light groups / labels are the
      recommended way to control rooms now (this feature predates mature HA areas/groups),
      keep `includeRoomsAsLights` for the efficient single-write case with a known-limitation
      note.
      **Decision:** C done (see `plejd/README.md`). Not scheduling A — niche feature, no
      active reporter on this fork. Revisit A if a user asks.

- [x] **#269 — Scenes with å/ä/ö not imported.** Old upstream report (2022, pre-TS-rewrite
      monolith — that code is gone). This fork's scene handling uses the scene UUID
      (`scene.sceneId`) for every MQTT topic and `unique_id`; the title is only a UTF-8
      JSON string value in the discovery payload (`name`). No title-based filtering, slug
      or `.replace()` anywhere in `PlejdApi._getSceneDevices` / `SceneManager` / `Scene`.
      User confirms scenes with `ø` import fine, and ä/ö take the identical code path.
      Reopen only if an å/ä/ö scene actually goes missing.

## P3 — Real but cosmetic / log-noise only

- [x] **Wireless-switch (WPH-01 / WRT-01) naming.** The input branch produced
      `name: undefined` in the discovery `device` block. **Root cause (found in a
      real user's silly-level API dump):** when a switch's buttons are individually
      assigned to loads, Plejd leaves `Device.title` empty and stores the label on
      **`plejdDevice.installationLocation`** instead (also adds a `diagnostics`
      field). No add-on read that — upstream / pyplejd / hass-plejd all use only
      `device.title`. (A different user in icanos#338 had a plain `Device.title` and
      no `installationLocation` — so it varies by how the switch is configured.)
      Fixed on `feat/graceful-device-fallback` (0.23.0-beta.4): name =
      `device.title` → `plejdDevice.installationLocation` (trimmed — has trailing
      spaces) → sibling `devices[]` title → unset (HA keeps existing name). Output
      branch uses the same chain. `types/ApiSite.d.ts` `PlejdDevice` gained
      `installationLocation?` + `diagnostics?`. `InputDevice` gained `roomName`;
      trigger block sends `suggested_area`. beta.2's room-name substitution (would
      overwrite good names) was reverted in beta.3, replaced entirely in beta.4.
      HA-side confirmed (WebSocket registry): all 10 WPH-01 had residual
      `original_name`, `name_by_user: null`, `created_at: 0` (pre-2024.8); MQTT
      integration rebuilt 2026-03-10. Related to but not the same as #326/#327.

- [x] **Tunable-white colour-temperature changes made outside HA didn't reach HA.**
      Shipped in **0.23.1-beta.4** (2026-08-31, branch `beta/0.23.1`, commit `16219f2`),
      verified end-to-end on a real DWN-01. Two report paths, both were unhandled:
      - **Settled value** — a standalone `cmd 0x0101` packet, `<addr> 01 03 01 01 <kelvin LE>`,
        from the device's own address. No branch for it → `Command 101 unknown` → dropped.
        Now decoded (`readUInt16LE` at `PAYLOAD_POSITION_OFFSET`, Kelvin).
      - **Plejd-app slider stream** — `cmd 0x0420` packets, `<addr> 01 10 04 20 03 01 11 <kelvin BE>`,
        on a separate "colour channel" BLE address 1–2 slots above the device's main output
        address, which the site data (`outputAddress` / `deviceAddress` / `roomAddress`)
        does not tie to the device. Resolved by nearest-address lookup (X−1..X−3 for a
        tunable-white output) + `DeviceRegistry.aliasOutputAddress` so later events on that
        address go straight through.
      - Also fixed: the `0x0420` branch computed the colour temp but emitted an empty
        payload (`Set color state to undefined`); a colour-only report set `data.state`
        undefined → told HA the light was off (now keeps current state); the `01 02 01 01 00`
        companion packet + any colour report on an unregistered address are dropped quietly
        (no more null spam); `DeviceRegistry.setOutputState` stores `colorTemp` on any
        numeric value (old guard was chicken-and-egg).

- [ ] **`cmd 0x0038` unknown from DWN-01 after a colour change.** Seen 2026-08-31 in a
      verbose log right after setting colour on the trappoppgang spot:
      `58 01 03 00 38 00 00 13 00 00 00 29 00 …` from the device's own address (88), and a
      6-byte `5a 01 02 00 38 00` companion from the colour-channel address (90). Logged
      `Command 38 unknown` and ignored. Looks like a settings/diagnostics report, not
      colour — HA doesn't need it. Low priority; decode only if it turns out to carry
      something useful (dim curve? load diagnostics?).

- Side-finding (2026-08-31), **not an add-on bug: "hidden by integration" on 9 of 28
  Plejd lights** (mixed DWN-01 / LED-10 / DIM-01-2P). The discovery payload has no
  `enabled_by_default` / `entity_category` / hide flag — verified identical for a hidden
  and a visible DWN-01 via `mqtt/device/debug_info`. The Plejd `hiddenFromIntegrations`
  cloud field is unused (upstream removed the handling in `5687087`, 2021). Stale HA
  entity-registry state from a past manual/bulk hide; a fresh identical discovery does not
  un-hide an entity. Fix is HA-side: entity settings → toggle "Visible".

- [ ] **#327 — Input devices logged as `null` in verbose logs.**
      Pinpointed by reporter: `PlejdBLEHandler.js` (~line 875-877) uses
      `getOutputDeviceByBleOutputAddress()` for what may be an *input* device, which
      returns null. Needs an input-address lookup fallback. Verbose logs only.

- [ ] **#326 — WRT-01 "Trying to set state for null" warnings.**
      Same root cause as #327 — WRT-01s have no output of their own (they control other
      devices), so events resolve to null and emit warnings. Harmless but noisy; handle
      input-only devices gracefully. Fix together with #327.

## Needs triage (may be hardware/user/feature, not confirmed our bug)

- [~] **#311 — "Error trying to create output device"; dimmers + shutters missing.**
      Partly missing cover/shutter support (feature), partly a possible mapping error.
      Log is in a .docx attachment — needs extraction/review.
- [~] **#194 — Develop branch: items reported incorrectly online.** Vague, likely stale.

---

## Feature requests (not bugs — separate backlog, not scheduled)

New device classes: detection already lands these in `_inferDeviceType()` (0.23.0-beta.1)
with an `unsupported` marker; making them controllable is protocol + discovery work.
Needs a tester with the actual hardware. `thomasloven/pyplejd` has working
decode/encode — see `docs/device-classification.md` and the `add-plejd-device` skill.

- #301 / #311 — Blinds/shutters support (WIN-01, JAL-01) — HA `cover`. pyplejd:
  state via `0x0098`/`0x00C8` position bits, set via `0x0420` minipackage source `0x08`.
- #319 — TRM-01 (thermostat) support — HA `climate`. pyplejd: `0x045C` setpoint,
  `0x0461` mode/PWM.
- #300 — WMS-01 motion sensor support — HA `binary_sensor`/`sensor`. Read-only; lowest
  risk of the three. Needs the `motionSensors` array (not in `types/ApiSite.d.ts` yet).
- #247 — **Bluetooth-proxy / ESP32 support.** The add-on talks to BlueZ directly
  (`dbus-next`), so it only sees local HCI adapters — hence "requires an exclusive USB
  dongle". The ESP32 BT-proxy support other Plejd projects have is HA-core's work
  (`habluetooth` / `bleak-esphome` translating GATT ↔ ESPHome native API); an add-on
  can't borrow it. Nothing in the Plejd protocol needs a dongle.
  **Realistic path (if ever): option A** — a Node ESPHome-native-API client (protobuf,
  TCP:6053) as a second BLE backend behind `PlejdBLEHandler`, talking to a dedicated
  ESP32 with `bluetooth_proxy: active: true` (~8 protobuf message types: advertisement /
  connect / GATT get-services|read|write|notify). Stays single-language; risk is Node
  ESPHome-BLE library maturity for *active* GATT (worst case: vendor the ~8 handlers —
  the proto is public/stable). Rejected: a Python sidecar (polyglot image, IPC,
  two dep sets); custom ESP32 firmware (a from-scratch C++ project, no shared codebase
  with the JS add-on — only shared protocol docs + test vectors). Shape: keep BlueZ as
  default, add a `bleTransport: bluez | esphome` option, beta-test with one ESP32.
- #186 — Healthcheck/ping
- #185 — Virtual device
- #163 — Document the Plejd BLE protocol (partly done in `docs/device-classification.md`)
