# Plejd add-on for Home Assistant

Home Assistant add-on for [Plejd](https://www.plejd.com/) home automation devices. Control your Plejd lights, switches and relays from Home Assistant over Bluetooth (BLE), with MQTT auto-discovery of the devices in range. Changes made in the Plejd app are propagated back to Home Assistant.

This is a maintained fork. For requirements, installation and what this fork changes, see the [repository README](../README.md). The document below covers configuration, supported devices, usage and troubleshooting once the add-on is installed.

Disclaimer: I am in no way affiliated with Plejd and am doing this solely as a hobby project.

## Configuration

### Simple MQTT configuration

When you are using the official Mosquitto Broker from the Home Assistant Add-on store, minimal configuration is required.
Create a user in [Configuration -&gt; Users](https://my.home-assistant.io/redirect/users/) named e.g. mqtt-api-user.

| Parameter    | Value                                            |
| ------------ | ------------------------------------------------ |
| mqttBroker   | mqtt://                                          |
| mqttUsername | Arbitrary Home Assistant User e.g. mqtt-api-user |
| mqttPassword | Users password                                   |

### Advanced MQTT configuration

For more advanced installations, you need to add the MQTT integration to Home Assistant either by going to Configuration -> Integrations and clicking the Add Integration button, or by adding the following to your `configuration.yaml` file:

```yaml
mqtt:
  broker: [point to your broker IP eg. 'mqtt://localhost']
  username: [username of mqtt broker]
  password: !secret mqtt_password
  discovery: true
  discovery_prefix: homeassistant
```

The above is used to notify the add-on when Home Assistant has started successfully and let the add-on send the discovery response (containing information about all Plejd devices found).

### Configuration parameters

The plugin needs you to configure some settings before working. You find these on the Add-on page after you've installed it.

| Parameter            | Value                                                                                                                                                                                    |
| -------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| site                 | Name of your Plejd site, the name is displayed in the Plejd app (top bar).                                                                                                               |
| username             | Email/username of your Plejd account, this is used to fetch the crypto key and devices from the Plejd API.                                                                               |
| password             | Password of your Plejd account, this is used to fetch the crypto key and devices from the Plejd API.                                                                                     |
| mqttBroker           | URL of the MQTT Broker, eg. mqtt://                                                                                                                                                      |
| mqttUsername         | Username of the MQTT broker                                                                                                                                                              |
| mqttPassword         | Password of the MQTT broker                                                                                                                                                              |
| includeRoomsAsLights | Adds all rooms as lights, making it possible to turn on/off lights by room instead. Setting this to false will ignore all rooms.                                                         |
| updatePlejdClock     | Hourly update Plejd devices' clock if out of sync. Clock is used for time-based scenes. Not recommended if you have a Plejd gateway. Clock updates may flicker scene-controlled devices. |
| logLevel             | Minimim log level. Supported values are `error`, `warn`, `info`, `debug`, `verbose`, `silly` with increasing amount of logging. Do not log more than `info` for production purposes.     |
| connectionTimeout    | Number of seconds to wait when scanning and connecting. Might need to be tweaked on platforms other than RPi 4. Defaults to: 2 seconds.                                                  |
| writeQueueWaitTime   | Wait time between message sent to Plejd over BLE, defaults to 400. If that doesn't work, try changing the value higher in steps of 50.                                                   |

## Plejd devices and corresponding Home Assistant devices

Plejd output devices typically appears as either lights or switches in Home Assistant depending on how they are configured.

| Device    | Home Assistant Role      | Comment                                                                                                                                |
| --------- | ------------------------ | -------------------------------------------------------------------------------------------------------------------------------------- |
| CTR-01    | Light, Switch            | 1-channel relay with 0-10V output, 3500 VA (Relay, Light, Other)                                                                       |
| DAL-01    | Light                    | Dali broadcast with dimmer and tuneable white support                                                                                  |
| DIM-01    | Light                    | 1-channel dimmer LED, 300 VA (Original, LC and LC2 hardware versions)                                                                  |
| DIM-01-2P | Light                    | 1-channel dimmer LED with 2-pole breaking, 300 VA                                                                                      |
| DIM-02    | Light                    | 2-channel dimmer LED, 2\*100 VA (Original and LC hardware versions)                                                                    |
| DWN-01    | Light                    | Smart tunable downlight with a built-in dimmer function, 8W                                                                            |
| DWN-02    | Light                    | Smart tunable downlight with a built-in dimmer function, 8W                                                                            |
| EXT-01    | Extender                 | Plejd mesh extender and battery backup                                                                                                 |
| LED-10    | Light                    | 1-channel LED dimmer/driver, 10 W                                                                                                      |
| LED-75    | Light                    | 1-channel LED dimmer/driver with tuneable white, 10 W                                                                                  |
| OUT-02    | Light                    | Smart outdoor wall luminaire with tunable white (2,200–4,000K)                                                                         |
| REL-01    | Light, Switch            | 1 channel relay, 3500 VA (Relay, Light, Other)                                                                                         |
| REL-01-2P | Light, Switch            | 1-channel relay with 2-pole 3500 VA (Relay, Light, Other)                                                                              |
| REL-02    | Light, Switch            | 2-channel relay with combined 3500 VA (Relay, Light, Other)                                                                            |
| RTR-01    | -                        | -                                                                                                                                      |
| SPD-01    | Light                    | Smart plug with dimming capability, trailing edge                                                                                      |
| SPR-01    | Light, Switch            | Smart plug on/off with relay, 3500 VA (Relay, Light, Other)                                                                            |
| WPH-01    | Device Automation        | Wireless push button, 4 buttons. 2 channels, on/off per channel, type:button_short_press, subtype:button_1, button_2,button_3,button_4 |
| WRT-01    | Device Automation        | Wireless rotary button, type:button_short_press, subtype:button_1                                                                      |
| GWY-01    | Sensor                   | Gateway to enable control via internet and integrations                                                                                |
| Scene     | Scene, Device Automation | type:scene, subtype:trigger                                                                                                            |
| Room      | Area, Light              | Can be changed by Home Assistant, If includeRoomsAsLights is set to true                                                               |

## Transitions

Transitions from Home Assistant are supported (for dimmable devices) when transition is longer than 1 second. Plejd will do a bit of internal transitioning (default soft start is 0.1 seconds).

This implementation will transition each device independently, meaning that brightness change might be choppy if transitioning many devices at once or a changing brightness a lot in a limited time. Hassio-plejd's communication channel seems to handle a few updates per second, this is the combined value for all devices.

Transition points will be skipped if the queue of messages to be sent is over a certain threshold, by default equal to the number of devices in the system. Total transition time is prioritized rather than smoothness.

Recommendations

- Only transition a few devices at a time when possible
- Entire rooms can be transitioned efficiently after setting includeRoomsAsLights to true
- Expect 5-10 brightness changes per second, meaning 5 devices => 1-2 updates per device per second
- ... meaning that SLOW transitions will work well (wake-up light, gradually fade over a minute, ...), but quick ones will only work well for few devices or small relative changes in brightness
- When experiencing choppy quick transitions, turn transitioning off and let the Plejd hardware do the work instead

## Voice control and HomeKit

With the Google Home integration in Home Assistant, you can get voice control for your Plejd lights right away, check this out for more information:
<https://www.home-assistant.io/integrations/google_assistant/>

Prefer HomeKit? Check this out for more information on how you can get your Plejd lights controlled using HomeKit:
<https://www.home-assistant.io/integrations/homekit/>

## Troubleshooting

If you're having issues to get the addon working, there are a few things you can look into:

- Increase log level of plugin to debug, verbose or silly in configuration and restart addon. Refer to the "Logs" section below for information on how to get the full logs.
- Make sure MQTT is correctly configured. If using the HomeAssistant Supervisor (HassIO) Addon mosquitto, changing from `broker: "mqtt://localhost"` to `broker: "core-mosquitto"` can sometimes help (username and password as before)
- Make sure that the MQTT integration works! Config => Integrations => MQTT => Configure => Listen to "#" (everything), then publish to topic `home-assistant/switch/1/power` and make sure you see the message below when listening
- Make sure BT is working
  - Go to HA console (login as "root", write `login` to access normal terminal (or SSH or similar)
  - Start `bluetoothctl` interactive command
  - Write `list` and make sure it finds the Bluetooth device. If no device is found you need to fix this first!
  - Look in Plejd addon log and make sure there is no `unable to find a bluetooth adapter` line
- Make sure signal strength is "good enough". The BLE adapter needs to be reasonably close to a Plejd device. Look at the RSSI reading in the debug logs. In some cases an RSSI of -80 dBm works well, in other cases a higher value such as -40 dBm is required to work.
- You should get verbose/debug logs similar to: `Found Plejd service on ...` => `Discovered ... with RSSI ...` => `Inspecting ...` => `Connecting ...` => `Connected` => `Connected device is a Plejd device ...` => `BLE Connected to ...` => `Bluetooth connected. Plejd BLE up and running!`. After this sequence (which could fail multiple times before finally succeeding) you should get quite frequent `Raw event received ...` from the Plejd mesh. When updating state you should see in the logs `Sending 8 byte(s) of data to Plejd ...`.
- Listen to `#` in the MQTT integration and watch Plejd mqtt messages come in
  - Initial device discovery messages originate from the Plejd API, so if you set up that correctly you should get new devices in HA
  - Plejd log will show something like `discovered light (DIM-01) named ....`
  - State change messages originate from the Plejd Bluetooth connection, so if you get those you should be able to listen to Plejd state changes as well as being able to set states!
  - Initial sync may take many minutes until all devices have the correct on/off/brightness states in HA
- MQTT in Home Assistant will send birth and will messages that this addon listens to. If you have cases where Home Assistant sends these before this addon starts, consider reconfiguring Home Assistant MQTT to retain birth and will messages. See <https://www.home-assistant.io/integrations/mqtt/>
- One Plejd device means max one BLE connection, meaning using the Plejd app over BT will disconnect the addon BLE connection
  - It seems you can kick yourself out (by connecting using the app) even when you have multiple devices if the app happens to connect to the same device as the addon is using

### Startup error message

When starting the add-on, the log may display this message:

```log
parse error: Expected string key before ':' at line 1, column 4
[08:56:24] ERROR: Unknown HTTP error occured
```

The add-on still works as expected. This is a known issue that is being looked into.

## Logs

Logs are color coded and can be accessed on the Log tab of the addon. If you set log level to debug, verbose or silly you will generate a lot of log output
that will quickly scroll out of view. Logs can be exported through Docker that hosts all Home Assistant addons. To do that:

- SSH or console access the HA installation
- Identify the docker container name using `docker container ls` (NAMES column). Example name used `addon_local_plejd`
- tail logs: `tail -f addon_local_plejd`
- tail logs, strip color coding and save to file `docker logs -f addon_local_plejd | sed 's/\x1b\[[0-9;]*m//g' > /config/plejd.log` (output file might need to be adjusted)

### View logs in the VS Code add-on

Logs extracted as above can easily be viewed in the VS Code Home Assistant addon, which will default to using the excellent `Log File Highlighter` extension to parse the file.
Out of the box you can for example view elapsed time by selecting multiple lines and keeping an eye in the status bar. If you're feeling fancy you can get back the removed color information by adding something like below to the the `settings.json` configuration of VS Code.

```JSON
{
  // other settings
  // ...
  "logFileHighlighter.customPatterns": [
    {
        "pattern": "ERR",
        "foreground": "#af1f1f",
        "fontStyle": "bold",
    },
    {
        "pattern": "WRN",
        "foreground": "#af6f00",
        "fontStyle": "bold",
    },
    {
      "pattern": "INF",
      "foreground": "#44d",
      "fontStyle": "bold"
    },
    {
      "pattern": "VRB",
      "foreground": "#4a4",
    },
    {
      "pattern": "DBG",
      "foreground": "#4a4",
    },
    {
      "pattern": "SIL",
      "foreground": "#999"
    },
    {
      "pattern": "\\[.*\\]",
      "foreground": "#666"
    }
  ]
}
```

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
