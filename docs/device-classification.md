# How this add-on decides what a Plejd device is

## TL;DR

`PlejdApi._getDeviceType()` is a `switch` over the numeric `hardwareId` from the
Plejd cloud API. When it doesn't recognize an id it returns `null`, and
`PlejdApi._inferDeviceType()` then derives the type from **structured API fields**
instead:

- **inputs** → `inputSetting.buttonType`
- **outputs** → `device.outputType` + the `device.traits` bitfield

An unrecognized device is only skipped now if it is genuinely unclassifiable, or
if it is a category this add-on has no handler for yet (cover / thermostat /
motion — logged clearly, skipped, will appear automatically once support lands).

## Why it used to just throw (and why that changed)

Git history (`plejd/PlejdApi.js`):

- **2021 (`5a21290`):** the original `_getDeviceType` returned
  `{name:'-unknown-', type:'light'}` for ids it couldn't identify; only the
  `default:` branch threw.
- **Oct 2022 (`12a8f4e`):** the call was wrapped in `try/catch` — commit message:
  _"Catch errors due to unknown device type to avoid addon crashing"_. So the
  throw was always a **non-fatal per-device skip**, never a deliberate "fail".
- **Oct 2022 (`f016058`):** the `-unknown-` placeholders were replaced with real
  per-id mappings from a community device list. Every id now had to be mapped
  explicitly or it threw — a side effect of filling in the table, not a design
  decision.
- Upstream then went dormant before adopting a structured approach.

The reference implementation **`thomasloven/pyplejd`** (same protocol, same cloud
API) has since **deleted its hardware-id table entirely** (`const.py`, fully
commented out) and classifies purely from `traits` / `outputType` / `buttonType`
(`pyplejd/interface/__init__.py`). This add-on now does the same as a fallback,
keeping the id table only for nice names/descriptions and known quirks.

## The `traits` bitfield

`device.traits` is a **bitfield**, not an enum. Bit layout (matches
`pyplejd` `PlejdTraits`):

| Bit    | Name        | Meaning                   |
| ------ | ----------- | ------------------------- |
| `0x01` | POWER       | powerable on/off load     |
| `0x02` | DIM         | dimmable                  |
| `0x04` | TEMP        | tunable white             |
| `0x08` | GROUP       | groupable                 |
| `0x10` | COVER       | coverable (blinds/shades) |
| `0x20` | CLIMATE     | thermostat                |
| `0x40` | TILT        | cover tilt                |
| `0x80` | CLIMATE_PWM | PWM thermostat            |

Plejd's own lights report `9` (POWER+GROUP, non-dimmable), `11` (+DIM) or `15`
(+TEMP). The old code compared `traits` for exact equality with those values,
which silently misreads anything with extra bits set (covers, thermostats). The
code now tests individual bits (`hasTrait(traits, TRAIT_BITS.DIM)`).

## `outputType`

`device.outputType` from the cloud API is authoritative for the light-vs-relay
role and can also be `COVERABLE` / `CLIMATE`. The explicit id mapping's `type`
field is only a starting point — `outputType` overrides it.

## `buttonType` (inputs)

`inputSetting.buttonType` ∈ `PushButton | DirectionUp | DirectionDown |
RotateMesh | Scene`. The first four are physical buttons/rotaries we expose as
Home Assistant device automations; `Scene` and unknown/empty types are not
exposed.

## Adding real cover / thermostat / motion support

Detection already lands those devices in `_inferDeviceType()` with an
`unsupported` marker. Turning that into working entities is protocol + discovery
work (new command-code decode/encode in `PlejdBLEHandler`, new discovery payloads
in `MqttClient`, routing in `PlejdAddon`). `pyplejd` has working implementations
to reference — see the `add-plejd-device` skill, section "Protocol reference &
prior art", and `thomasloven/pyplejd/pyplejd/ble/lastdata.py`.

Tunable-white colour temperature (`0x04` TEMP trait) is **not** in that
"unsupported" set — it is a light and is fully handled. Since 0.23.1 the add-on
also decodes the incoming colour-temperature reports so Plejd-app changes sync
back to Home Assistant: `0x0101` (settled Kelvin, `<addr> 01 03 01 01 <kelvin
LE>`) and `0x0420` (the app's live slider stream, `<addr> 01 10 04 20 03 01 11
<kelvin BE>` on a colour-channel address 1–3 slots above the output address). See the
`BLE_CMD_COLOR_CHANGE || BLE_CMD_COLOR_TEMP_CHANGE` branch in
`PlejdBLEHandler._onLastDataUpdated`.

Relevant command codes (from `pyplejd`):

- Cover state: `0x0098` / `0x00C8` with a position-bits payload (not dim).
- Cover set: `0x0420` minipackage, Source type `0x08`, Window Control + Tilt.
- Thermostat: `0x045C` setpoint (LE, 0.1 °C), `0x0461` mode / PWM duty.
- Motion / lux / battery: `0x0420` incoming minipackages (Source=`0x03` motion,
  Lux, Battery Info). Needs the `motionSensors` array from the site response,
  which `plejd/types/ApiSite.d.ts` does not model yet.
