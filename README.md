# Hass.io Plejd add-on repository

Hass.io add-on for Plejd home automation devices. Gives you the ability to control the Plejd home automation devices through Home Assistant.
It uses MQTT to communicate with Home Assistant and supports auto discovery of the devices in range.

It also supports notifications so that changed made in the Plejd app are propagated to Home Assistant.

## This fork

This is a fork of [icanos/hassio-plejd](https://github.com/icanos/hassio-plejd) that improves how Plejd **scenes** integrate with Home Assistant. Everything else (lights, switches, relays, button/rotary inputs, MQTT auto-discovery, app→HA notifications) works the same as upstream.

What this fork adds/changes compared to upstream:

- **Scenes work as Device Automation triggers.** Scenes are published as `button_short_press` triggers (`subtype: scene`), so they show up correctly in the Home Assistant automation UI. This fixes the upstream "Integration not found" problem when trying to use a scene as a trigger.
- **Scene "Last Triggered" history.** Each scene gets a dedicated Event entity that records when it was last activated, so you can see scene activation history in Home Assistant.
- **Scenes grouped as a single device.** The scene's "Activate" button and its Event entity are grouped under one Plejd device in Home Assistant, instead of being scattered as separate entities.
- **No more ghost scene activations on startup.** Retained MQTT `SET` messages for scenes are ignored (and cleared) on startup, so a scene is not accidentally re-triggered when the add-on restarts. This guard only applies to scenes — retained commands for lights/switches are still honored.
- **Scene "Activate" button stays available.** The scene availability message is now retained, so the activate button does not disappear after a restart.

Upstream remains the canonical project; this fork tracks it and only carries the scene-related changes above.

Thanks to [ha-plejd](https://github.com/klali/ha-plejd) for inspiration.

Disclaimer:
I am in no way affiliated with Plejd and am solely doing this as a hobby project.

**Did you like this? Consider helping me continue the development:**  
[Buy me a coffee](https://www.buymeacoffee.com/w1ANTUb)

[![Gitter](https://badges.gitter.im/hassio-plejd/community.svg)](https://gitter.im/hassio-plejd/community?utm_source=badge&utm_medium=badge&utm_campaign=pr-badge)

## Addons

The repository contains only one addon, [Plejd](plejd/). Please see [Plejd addon readme](plejd/README.md) and [Plejd addon changelog](plejd/CHANGELOG.md) for details.

## License

```
Copyright 2023 Marcus Westin <marcus@sekurbit.se>

Licensed under the Apache License, Version 2.0 (the "License");
you may not use this file except in compliance with the License.
You may obtain a copy of the License at

http://www.apache.org/licenses/LICENSE-2.0

Unless required by applicable law or agreed to in writing, software
distributed under the License is distributed on an "AS IS" BASIS,
WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
See the License for the specific language governing permissions and
limitations under the License.
```
