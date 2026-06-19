# Plejd add-on for Home Assistant

Home Assistant add-on for [Plejd](https://www.plejd.com/) home automation devices. It lets you control your Plejd lights, switches and relays from Home Assistant over Bluetooth (BLE), uses MQTT to talk to Home Assistant, and auto-discovers the devices in range. Changes made in the Plejd app are propagated back to Home Assistant.

This is an add-on **repository** that you add to the Home Assistant Add-on Store. It contains a single add-on, [Plejd](plejd/). Once installed, see the [add-on documentation](plejd/README.md) for configuration and usage.

## This fork

This is a fork of [icanos/hassio-plejd](https://github.com/icanos/hassio-plejd) that improves how Plejd **scenes** integrate with Home Assistant. Everything else (lights, switches, relays, button/rotary inputs, MQTT auto-discovery, app→HA notifications) works the same as upstream.

What this fork adds/changes compared to upstream:

- **Scenes work as Device Automation triggers.** Scenes are published as `button_short_press` triggers (`subtype: scene`), so they show up correctly in the Home Assistant automation UI. This fixes the upstream "Integration not found" problem when trying to use a scene as a trigger.
- **Scene "Last Triggered" history.** Each scene gets a dedicated Event entity that records when it was last activated, so you can see scene activation history in Home Assistant.
- **Scenes grouped as a single device.** The scene's "Activate" button and its Event entity are grouped under one Plejd device in Home Assistant, instead of being scattered as separate entities.
- **No more ghost scene activations on startup.** Retained MQTT `SET` messages for scenes are ignored (and cleared) on startup, so a scene is not accidentally re-triggered when the add-on restarts. This guard only applies to scenes — retained commands for lights/switches are still honored.
- **Scene "Activate" button stays available.** The scene availability message is now retained, so the activate button does not disappear after a restart.

This fork tracks upstream and carries the scene-related changes above, plus a
pre-built image pipeline (see the add-on [changelog](plejd/CHANGELOG.md)).

## Requirements

- A Bluetooth (BLE) adapter — see "Tested on" below.
- An MQTT broker (the [Mosquitto broker Home Assistant add-on](https://github.com/home-assistant/addons/blob/master/mosquitto/DOCS.md) works perfectly well).

### Tested on

The add-on has been tested on the following platforms:

- Odroid-n2+ / Home Assistant Blue / Home Assistant Operating System ("HassOS") / BT ASUS USB-BT400 - Chipset: Broadcom BCM20702A1-0b05-17cb
- Raspberry Pi 4 with Home Assistant ("Hass.io") / Built-in BT
- Raspberry Pi 4 with Home Assistant ("Hass.io"/aarch64) / Built-in BT
- Raspberry Pi 3+ with Home Assistant ("Hass.io") / Built-in BT
- Intel NUC7i5BNH with Home Assistant Operating System ("HassOS") intel NUC image / Built-in BT
- Windows 10 Pro host / Oracle VirtualBox 6.1 / Home Assistant VBox image / Deltaco BT-118 with Cambridge Silicon Radio chipset / Windows + Zadig to change driver to WinUSB
- Windows 10 host / Oracle Virtualbox 6.1 / Home Assistant VBox image / ASUS BT400
- Mac OS Catalina 10.15.1 with Node v. 13.2.0
- Home Assistant Yellow with RPI 4 compute module / Built-in BT
- HP EliteDesk 800 G3 DM / Proxmox 7.5-3 / HAOS / Deltaco BT-118 with Cambridge Silicon Radio chipset

Supported Plejd devices are listed in the [add-on documentation](plejd/README.md#plejd-devices-and-corresponding-home-assistant-devices).

## Installation

### Easy installation

- Browse to your Home Assistant installation in a web browser and click on `Settings` in the navigation bar to the left.
- Click on `Add-ons`.
- Click on `Add-on Store` in the bottom right corner of that page.
- Click on the three vertical dots to the far right and choose `Repositories`.
- Paste the URL to this repo <https://github.com/oleost/hassio-plejd> in the `Add` field and hit `Add`.
- Scroll down and you should find a Plejd add-on that can be installed. Open it and install.
- Configure the add-on (see the [add-on documentation](plejd/README.md)).
- Enjoy!

### Manual installation

Browse your Home Assistant installation using a tool that allows you to manage files, e.g. SCP, SMB or an SFTP client.

- Open the `/addons` directory.
- Create a new folder named `hassio-plejd`.
- Copy all files from the `plejd` subdirectory of this repository (not the top level, which contains `repository.json`) into that newly created folder.
- Browse to your Home Assistant installation in a web browser and click on `Settings` in the navigation bar to the left.
- Click on `Add-ons`.
- Click on `Add-on Store` in the bottom right corner of that page.
- Click on the three vertical dots to the far right and choose `Check for updates`.
- A new Local Add-on named Plejd should appear. Open it and install.
- Enjoy!

### Older or development versions

To install older versions, follow the "Manual installation" instructions above, but copy the code from [one of the releases](https://github.com/oleost/hassio-plejd/releases).

### More details

See the separate [Details](plejd/Details.md) document for more detailed instructions regarding Home Assistant, Mosquitto, etc.

## Credits

This add-on was originally created by [Marcus Westin (icanos/hassio-plejd)](https://github.com/icanos/hassio-plejd)
and inspired by [ha-plejd](https://github.com/klali/ha-plejd). This repository is
a fork that continues development of that work. All original copyright and the
Apache-2.0 license are retained — see [License](#license) below.

Disclaimer: I am in no way affiliated with Plejd and am doing this solely as a hobby project.

## Developing

The code in this project follows the [Airbnb JavaScript guide](https://github.com/airbnb/javascript) with a few exceptions. Do run the `npm run lint:fix` command in the `plejd` folder (after running `npm install`) and fix any remaining issues before committing. If copying the plugin locally to your Home Assistant instance _do not include the node_modules directory_, strange errors will happen during build!

For a nice developer experience it is very convenient to have `eslint` and `prettier` installed in your favorite editor (such as VS Code) and use the "format on save" option (or invoke formatting by Alt+Shift+F in VS Code). Any code issues should appear in the problems window inside the editor, as well as when running the command above.

For partial type hinting you can run

- `npm install --global typings`
- `typings install`

When contributing, please do so by forking the repo and then using pull requests towards the `master` branch.

## License

```text
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
