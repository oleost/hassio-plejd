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

- [~] **Unknown hardware ids in general — graceful fallback.** `_getDeviceType()` no
      longer throws on an unmapped id; `_inferDeviceType()` classifies from
      `device.traits` / `device.outputType` / `inputSetting.buttonType` (approach
      borrowed from `thomasloven/pyplejd`, which dropped its hw-id table entirely).
      Plain lights/relays/buttons with unknown ids now work automatically. Covers,
      thermostats and motion sensors are detected and logged as "not yet supported"
      then skipped. Branch `feat/graceful-device-fallback`; rationale + `pyplejd`
      command-code notes in `docs/device-classification.md`. beta.2-3 fold in the #325
      discovery fix and the unnamed-switch fix below. When confirmed: merge → master,
      cut stable `0.23.0`. This makes most future "unknown hardware id" reports
      non-issues.

## P1 — Real bugs, broad impact, clear fix

- [~] **#325 — `Cannot read property 'publish' of undefined` on eager discovery.**
      Confirmed the pattern in our fork: `PlejdAddon.init()` called
      `sendDiscoveryToHomeAssistant()` right after `mqttClient.init()`, before the
      broker connection was up — publishing into a not-yet-connected client and
      duplicating every discovery message (seen in a real 0.23.0-beta.1 startup log).
      Fixed on `feat/graceful-device-fallback` (since 0.23.0-beta.2): removed the
      premature call; `sendDiscoveryToHomeAssistant()` now no-ops unless
      `this.client.connected`. Discovery still fires from the `connected` handler and
      on every HA birth message. Ships with the graceful-fallback beta.

## P2 — Real logic bugs, more nuanced

- [ ] **#255 — Min brightness mismatch (HA 0 = off, Plejd 0 = on/min).**
      Transition down to 0 misbehaves (jumps from full brightness instead of from min).
      Fix idea from reporter: swap 0 ↔ 1 when translating brightness between Plejd and
      HA (don't scale, precision is only 0..255). Touches brightness handling in
      `plejd/PlejdDeviceCommunication.js` (transitions) and the BLE encode/decode.

- [ ] **#152 — Room brightness never updated on state changes.**
      With `includeRoomsAsLights = true`, room brightness is only set from HA, never
      recalculated when member lights change → broken room transitions (e.g. goodnight
      fade). Reporter suggests computing room brightness as MAX of member lights on each
      update. Design-adjacent; touches room/output state aggregation.

- [ ] **#269 — Scenes with å/ä/ö not imported.**
      Scene names with non-ASCII characters silently fail to import (character encoding).
      In this fork's scene domain. Check scene parsing/import in `plejd/PlejdApi.js` /
      `plejd/Scene.js`.

## P3 — Real but cosmetic / log-noise only

- [x] **Wireless-switch (WPH-01) naming.** The input branch produced `name: undefined`
      in the discovery `device` block. **Root cause (confirmed from a real user's
      verbose log):** Plejd's cloud API returns Device objects *without a `title` key
      at all* for input-only devices in that site — output devices all have titles,
      the WPH-01 entries don't (`No outputSettings found for undefined (E7BC883987E6)`
      — the `undefined` is `device.title`). Only one `devices[]` entry per WPH-01, so
      no sibling to recover a title from. Upstream / pyplejd / hass-plejd all read
      only `device.title` too — they would all show these nameless. The good names HA
      shows for this user are **residual** from an earlier add-on run. Fixed on
      `feat/graceful-device-fallback` (0.23.0-beta.3): when there is no title, leave
      the discovery `name` unset so HA keeps whatever it has (do NOT substitute the
      room name — beta.2 did briefly and it would overwrite good residual names). The
      `devices[]` sibling-title lookup added as a best effort finds nothing here and
      falls through harmlessly. `InputDevice` gained `roomName`; the trigger device
      block now also sends `suggested_area`. Related to but not the same as #326/#327.

- [ ] **`Command 101 unknown` = `0x0101` tunable-white colortemp report, not decoded.**
      Seen in a real user's verbose log from DWN-01 downlights (tunable white):
      `4d01030101b80b` etc. decode to `cmd 0x0101` which `_onLastDataUpdated` doesn't
      handle (only `0x0420` colortemp). pyplejd calls this
      `CMD_TUNABLE_WHITE_TEMPERATURE = 0x0101`. Consequence: Home Assistant never gets
      live colour-temperature state from these lights (setting still works). Add a
      branch in `PlejdBLEHandler._onLastDataUpdated` for `0x0101`. Low priority,
      pre-existing, independent of the fallback work.

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
- #247 — Bluetooth-proxy support
- #186 — Healthcheck/ping
- #185 — Virtual device
- #163 — Document the Plejd BLE protocol (partly done in `docs/device-classification.md`)
