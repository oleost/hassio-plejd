const axios = require('axios').default;
const fs = require('fs');

const Configuration = require('./Configuration');
const Logger = require('./Logger');

const {
  API: {
    APP_ID: API_APP_ID,
    BASE_URL: API_BASE_URL,
    LOGIN_URL: API_LOGIN_URL,
    SITE_LIST_URL: API_SITE_LIST_URL,
    SITE_DETAILS_URL: API_SITE_DETAILS_URL,
  },
  DEVICE_TYPES,
} = require('./constants');

const TRAITS = {
  NO_LOAD: 0, // 0b0000
  NON_DIMMABLE: 9, // 0b1001
  DIMMABLE: 11, // 0b1011
  DIMMABLE_COLORTEMP: 15, // 0b1111
};

// `device.traits` is a bitfield, not an enum. The TRAITS values above are the
// specific combinations Plejd's own lights report; TRAIT_BITS lets us test a
// single capability with a bitwise AND, which also works for covers/thermostats
// and any future device that sets extra bits. Bit layout matches
// thomasloven/pyplejd (PlejdTraits).
const TRAIT_BITS = {
  POWER: 0x1, // powerable (on/off load)
  DIM: 0x2, // dimmable
  TEMP: 0x4, // tunable white
  GROUP: 0x8, // groupable
  COVER: 0x10, // coverable (blinds/shades)
  CLIMATE: 0x20, // climate/thermostat
  TILT: 0x40, // cover tilt
  CLIMATE_PWM: 0x80,
};

// InputSetting.buttonType values that represent a physical button/rotary we can
// expose as a Home Assistant device automation. "Scene" and unknown types are
// not exposed. Matches thomasloven/pyplejd input handling.
const PHYSICAL_BUTTON_TYPES = ['PushButton', 'DirectionUp', 'DirectionDown', 'RotateMesh'];

/** True if `bit` is set in the (possibly string) bitfield `value`. */
// eslint-disable-next-line no-bitwise
const hasTrait = (value, bit) => ((parseInt(value, 10) || 0) & bit) === bit;

/** Trimmed string, or undefined if `s` is not a non-blank string. */
const trimmedOrUndef = (s) => (typeof s === 'string' && s.trim() ? s.trim() : undefined);

const logger = Logger.getLogger('plejd-api');

class PlejdApi {
  /** @private @type {import('types/Configuration').Options} */
  config;

  /** @private @type {import('DeviceRegistry')} */
  deviceRegistry;

  /** @private @type {string} */
  sessionToken;

  /** @private @type {string} */
  siteId;

  /** @private @type {import('types/ApiSite').ApiSite} */
  siteDetails;

  /**
   * @param {import("./DeviceRegistry")} deviceRegistry
   */
  constructor(deviceRegistry) {
    this.config = Configuration.getOptions();
    this.deviceRegistry = deviceRegistry;
  }

  async init() {
    logger.info('init()');
    const cache = await this.getCachedCopy();
    const cacheExists = cache && cache.siteId && cache.siteDetails && cache.sessionToken;

    logger.debug(`Prefer cache? ${this.config.preferCachedApiResponse}`);
    logger.debug(`Cache exists? ${cacheExists ? `Yes, created ${cache.dtCache}` : 'No'}`);

    if (this.config.preferCachedApiResponse && cacheExists) {
      logger.info(
        `Cache preferred. Skipping api requests and setting api data to response from ${cache.dtCache}`,
      );
      logger.silly(`Cached response: ${JSON.stringify(cache, null, 2)}`);
      this.siteId = cache.siteId;
      this.siteDetails = cache.siteDetails;
      this.sessionToken = cache.sessionToken;
    } else {
      try {
        await this.login();
        await this.getSites();
        await this.getSiteDetails();
        this.saveCachedCopy();
      } catch (err) {
        if (cacheExists) {
          logger.warn('Failed to get api response, using cached copy instead');
          this.siteId = cache.siteId;
          this.siteDetails = cache.siteDetails;
          this.sessionToken = cache.sessionToken;
        } else {
          logger.error('Api request failed, no cached fallback available', err);
          throw err;
        }
      }
    }

    this.deviceRegistry.setApiSite(this.siteDetails);
    this.getDevices();
  }

  /** @returns {Promise<import('types/ApiSite').CachedSite>} */
  // eslint-disable-next-line class-methods-use-this
  async getCachedCopy() {
    logger.info('Getting cached api response from disk');

    try {
      const rawData = await fs.promises.readFile('/data/cachedApiResponse.json');
      const cachedCopy = JSON.parse(rawData.toString());

      return cachedCopy;
    } catch (err) {
      logger.warn('No cached api response could be read. This is normal on the first run', err);
      return null;
    }
  }

  async saveCachedCopy() {
    logger.info('Saving cached copy');
    try {
      /** @type {import('types/ApiSite').CachedSite} */
      const cachedSite = {
        siteId: this.siteId,
        siteDetails: this.siteDetails,
        sessionToken: this.sessionToken,
        dtCache: new Date().toISOString(),
      };
      const rawData = JSON.stringify(cachedSite);
      await fs.promises.writeFile('/data/cachedApiResponse.json', rawData);
    } catch (err) {
      logger.error('Failed to save cache of api response', err);
    }
  }

  async login() {
    logger.info('login()');
    logger.info(`logging into ${this.config.site}`);

    logger.debug(`sending POST to ${API_BASE_URL}${API_LOGIN_URL}`);

    try {
      const response = await this._getAxiosInstance().post(API_LOGIN_URL, {
        username: this.config.username,
        password: this.config.password,
      });

      logger.info('got session token response');
      this.sessionToken = response.data.sessionToken;

      if (!this.sessionToken) {
        logger.error('No session token received');
        throw new Error('API: No session token received.');
      }
    } catch (error) {
      if (error.response.status === 400) {
        logger.error('Server returned status 400. probably invalid credentials, please verify.');
      } else if (error.response.status === 403) {
        logger.error(
          'Server returned status 403, forbidden. Plejd service does this sometimes, despite correct credentials. Possibly throttling logins. Waiting a long time often fixes this.',
        );
      } else {
        logger.error('Unable to retrieve session token response: ', error);
      }
      logger.verbose(`Error details: ${JSON.stringify(error.response, null, 2)}`);

      throw new Error(`API: Unable to retrieve session token response: ${error}`);
    }
  }

  async getSites() {
    logger.info('Get all Plejd sites for account...');

    logger.debug(`sending POST to ${API_BASE_URL}${API_SITE_LIST_URL}`);

    try {
      const response = await this._getAxiosInstance().post(API_SITE_LIST_URL);

      const sites = response.data.result;
      logger.info(
        `Got site list response with ${sites.length}: ${sites.map((s) => s.site.title).join(', ')}`,
      );
      logger.silly('All sites found:');
      logger.silly(JSON.stringify(sites, null, 2));

      const site = sites.find((x) => x.site.title === this.config.site);

      if (!site) {
        logger.error(`Failed to find a site named ${this.config.site}`);
        throw new Error(`API: Failed to find a site named ${this.config.site}`);
      }

      logger.info(`Site found matching configuration name ${this.config.site}`);
      logger.silly(JSON.stringify(site, null, 2));
      this.siteId = site.site.siteId;
    } catch (error) {
      logger.error('error: unable to retrieve list of sites. error: ', error);
      throw new Error(`API: unable to retrieve list of sites. error: ${error}`);
    }
  }

  async getSiteDetails() {
    logger.info(`Get site details for ${this.siteId}...`);

    logger.debug(`sending POST to ${API_BASE_URL}${API_SITE_DETAILS_URL}`);

    try {
      const response = await this._getAxiosInstance().post(API_SITE_DETAILS_URL, {
        siteId: this.siteId,
      });

      logger.info('got site details response');

      if (response.data.result.length === 0) {
        logger.error(`No site with ID ${this.siteId} was found.`);
        throw new Error(`API: No site with ID ${this.siteId} was found.`);
      }

      this.siteDetails = response.data.result[0];

      logger.info(`Site details for site id ${this.siteId} found`);
      logger.silly(JSON.stringify(this.siteDetails, null, 2));

      if (!this.siteDetails.plejdMesh.cryptoKey) {
        throw new Error('API: No crypto key set for site');
      }
    } catch (error) {
      logger.error(`Unable to retrieve site details for ${this.siteId}. error: `, error);
      throw new Error(`API: Unable to retrieve site details. error: ${error}`);
    }
  }

  getDevices() {
    logger.info('Getting devices from site details response...');

    if (this.siteDetails.gateways && this.siteDetails.gateways.length) {
      this.siteDetails.gateways.forEach((gwy) => {
        logger.info(`Plejd gateway '${gwy.title}' found on site`);
      });
    } else {
      logger.info('No Plejd gateway found on site');
    }

    this._getPlejdDevices();
    this._getRoomDevices();
    this._getSceneDevices();

    // Diagnostic: the BLE address maps (not secret). Helps pin down which address
    // a tunable device streams colour temperature on when it isn't the main one.
    logger.debug(
      `Address maps — deviceAddress: ${JSON.stringify(
        this.siteDetails.deviceAddress,
      )}, outputAddress: ${JSON.stringify(
        this.siteDetails.outputAddress,
      )}, roomAddress: ${JSON.stringify(this.siteDetails.roomAddress)}`,
    );
  }

  _getAxiosInstance() {
    const headers = {
      'X-Parse-Application-Id': API_APP_ID,
      'Content-Type': 'application/json',
    };

    if (this.sessionToken) {
      headers['X-Parse-Session-Token'] = this.sessionToken;
    }

    return axios.create({
      baseURL: API_BASE_URL,
      headers,
    });
  }

  /**
   * Map a known Plejd `hardwareId` to a device type descriptor.
   *
   * Returns `null` for an unrecognized hardware id — the caller then falls back
   * to `_inferDeviceType()`, which derives the type from `device.traits` /
   * `device.outputType` / `inputSetting.buttonType` instead. This used to throw;
   * see `docs/device-classification.md` for the rationale.
   *
   * @returns {{name: string, description: string, type: string, dimmable?: boolean,
   *   colorTemp?: boolean, broadcastClicks: boolean} | null}
   */
  // eslint-disable-next-line class-methods-use-this
  _getDeviceType(plejdDevice) {
    // Type name is also sometimes available in device.hardware.name
    // (maybe only when GWY-01 is present?)

    switch (parseInt(plejdDevice.hardwareId, 10)) {
      case 1:
        return {
          name: 'DIM-01',
          description: '1-channel dimmer LED, 300 VA',
          type: 'light',
          dimmable: true,
          broadcastClicks: false,
        };
      case 2:
        return {
          name: 'DIM-02',
          description: '2-channel dimmer LED, 2*100 VA',
          type: 'light',
          dimmable: true,
          broadcastClicks: false,
        };
      case 3:
        return {
          name: 'CTR-01',
          description: '1-channel relay with 0-10V output, 3500 VA',
          type: 'light',
          dimmable: false,
          broadcastClicks: false,
        };
      // Gateway doesn't show up in devices list in API response
      // case 4:
      //   return {
      //     name: 'GWY-01',
      //     description: 'Gateway to enable control via internet and integrations',
      //     type: 'sensor',
      //     dimmable: false,
      //     broadcastClicks: false,
      //   };
      case 5:
        return {
          name: 'LED-10',
          description: '1-channel LED dimmer/driver, 10 W',
          type: 'light',
          dimmable: true,
          broadcastClicks: false,
        };
      case 6:
        return {
          name: 'WPH-01',
          description:
            'Wireless push button, 4 buttons. 2 channels, on and off buttons for each channel',
          type: 'device_automation',
          dimmable: false,
          broadcastClicks: true,
        };
      case 7:
        // Unknown, pre-release (?) version, kept for backwards compatibility. See https://github.com/icanos/hassio-plejd/issues/250
        return {
          name: 'REL-01',
          description: '1 channel relay, 3500 VA',
          type: DEVICE_TYPES.SWITCH,
          dimmable: false,
          broadcastClicks: false,
        };
      case 8:
        return {
          name: 'SPR-01',
          description: 'Smart plug on/off with relay, 3500 VA',
          type: DEVICE_TYPES.SWITCH,
          dimmable: false,
          broadcastClicks: false,
        };
      case 10:
        return {
          name: 'WRT-01',
          description: 'Wireless rotary button',
          type: 'device_automation',
          dimmable: false,
          broadcastClicks: true,
        };
      case 11:
        return {
          name: 'DIM-01-2P',
          description: '1-channel dimmer LED with 2-pole breaking, 300 VA',
          type: 'light',
          dimmable: true,
          broadcastClicks: false,
        };
      case 12:
        return {
          name: 'DAL-01',
          description: 'Dali broadcast with dimmer and tuneable white support',
          type: 'light',
          dimmable: true,
          colorTemp: true,
          broadcastClicks: false,
        };
      // 13: Non-dimmable generic light
      case 14:
        return {
          name: 'DIM-01',
          description: '1-channel dimmer LED, 300 VA ("LC" hardware/chip version)',
          type: 'light',
          dimmable: true,
          broadcastClicks: false,
        };
      case 15:
        return {
          name: 'DIM-02',
          description: '2-channel dimmer LED, 2*100 VA ("LC" hardware/chip version)',
          type: 'light',
          dimmable: true,
          broadcastClicks: false,
        };
      case 17:
        return {
          name: 'REL-01-2P',
          description: '1-channel relay with 2-pole 3500 VA',
          type: DEVICE_TYPES.SWITCH,
          dimmable: false,
          broadcastClicks: false,
        };
      case 18:
        return {
          name: 'REL-02',
          description: '2-channel relay with combined 3500 VA',
          type: DEVICE_TYPES.SWITCH,
          dimmable: false,
          broadcastClicks: false,
        };
      case 19:
        return {
          name: 'EXT-01',
          description: 'Plejd mesh extender and battery backup',
          type: 'extender',
          dimmable: false,
          broadcastClicks: false,
        };
      case 20:
        return {
          // Unknown, pre-release (?) version, kept for backwards compatibility. See https://github.com/icanos/hassio-plejd/issues/250
          name: 'SPR-01',
          description: 'Smart plug on/off with relay, 3500 VA',
          type: 'device_automation',
          dimmable: false,
          broadcastClicks: false,
        };
      case 22:
        return {
          name: 'DIM-01',
          description: '1-channel dimmer LED, 300 VA ("LC2" hardware/chip version 2024 Q2)',
          type: 'light',
          dimmable: true,
          broadcastClicks: false,
        };
      case 24:
        // See https://github.com/icanos/hassio-plejd/issues/337
        return {
          name: 'DIM-02',
          description: '2-channel dimmer LED, 2*100 VA ("LC2" hardware/chip version)',
          type: 'light',
          dimmable: true,
          broadcastClicks: false,
        };
      case 36:
        return {
          name: 'LED-75',
          description: '1-channel LED dimmer/driver with tuneable white, 10 W',
          type: 'light',
          dimmable: true,
          colorTemp: true,
          broadcastClicks: false,
        };
      case 38:
        // See https://github.com/icanos/hassio-plejd/issues/338 and /332
        return {
          name: 'WPH-01',
          description:
            'Wireless push button, 4 buttons. 2 channels, on and off buttons for each channel ("LC" hardware/chip version)',
          type: 'device_automation',
          dimmable: false,
          broadcastClicks: true,
        };
      case 40:
        return {
          name: 'SPD-01',
          description: 'Smart plug with dimming capability, trailing edge, 100w',
          type: 'light',
          dimmable: true,
          broadcastClicks: false,
        };
      case 42:
        // See https://github.com/icanos/hassio-plejd/issues/339
        return {
          name: 'WRT-01',
          description: 'Wireless rotary button (newer hardware/chip version)',
          type: 'device_automation',
          dimmable: false,
          broadcastClicks: true,
        };
      case 135:
        return {
          name: 'OUT-02', // Specifically the hardware id is from a OUT-02-U, with outlet
          description:
            'OUT-02 is a smart outdoor wall luminaire with tunable white (2,200–4,000K), built-in LED and dimmer. The product is available in two versions: OUT-02-U, with built-in outlet (two sockets), and OUT-02, without outlet.',
          type: 'light',
          dimmable: true,
          colorTemp: true,
          broadcastClicks: false,
        };
      case 167:
        return {
          name: 'DWN-01',
          description: 'Smart tunable downlight with a built-in dimmer function, 8W',
          type: 'light',
          dimmable: true,
          colorTemp: true,
          broadcastClicks: false,
        };
      case 199:
        return {
          name: 'DWN-02',
          description: 'Smart tunable downlight with a built-in dimmer function, 8W',
          type: 'light',
          dimmable: true,
          colorTemp: true,
          broadcastClicks: false,
        };
      // Unrecognized hardware id. Don't throw — let the caller infer the type
      // from device traits / outputType. If it's a plain light/relay/button it
      // will still work; please open an issue with the hardware id so it can be
      // added explicitly here (nicer name + description).
      default:
        return null;
    }
  }

  /**
   * Derive a device type descriptor for a device whose `hardwareId` is not in
   * `_getDeviceType()`. Uses structured fields from the cloud API rather than a
   * lookup table:
   *   - inputs: `inputSetting.buttonType`
   *   - outputs: `device.outputType` + `device.traits` bitfield
   *
   * A descriptor with `unsupported` set means the device was recognized but this
   * add-on has no handler for that category yet (cover/thermostat/motion) — the
   * caller logs it and skips it rather than creating a broken entity.
   *
   * @returns {{name: string, description: string, type: string, dimmable?: boolean,
   *   colorTemp?: boolean, broadcastClicks?: boolean, inferred: true,
   *   unsupported?: string} | null}
   */
  // eslint-disable-next-line class-methods-use-this
  _inferDeviceType(device, plejdDevice, inputSetting) {
    const { traits } = device;
    const hardwareId = plejdDevice ? plejdDevice.hardwareId : 'unknown';
    const notes = plejdDevice && plejdDevice.firmware ? plejdDevice.firmware.notes : null;

    // `name` here is the MODEL string (shown as the HA device model), not the
    // user's device name. From the firmware notes: "wph-01-lc-v4.41.3 ..." -> "wph-01-lc".
    let name = `Unknown (hardware id ${hardwareId})`;
    if (notes && typeof notes === 'string' && notes.trim()) {
      name = notes.trim().split(/\s+/)[0];
    }

    // --- Input device (button / rotary) ---
    if (inputSetting) {
      if (PHYSICAL_BUTTON_TYPES.includes(inputSetting.buttonType)) {
        return {
          name,
          description: `Wireless button (inferred from buttonType=${inputSetting.buttonType}, hardware id ${hardwareId})`,
          type: 'device_automation',
          dimmable: false,
          broadcastClicks: true,
          inferred: true,
        };
      }
      // "Scene" buttons and unknown/empty button types are not exposed.
      return null;
    }

    // --- Output device ---
    if (hasTrait(traits, TRAIT_BITS.CLIMATE) || device.outputType === 'CLIMATE') {
      return {
        name,
        description: `Thermostat (hardware id ${hardwareId})`,
        type: 'climate',
        inferred: true,
        unsupported: 'thermostat',
      };
    }
    if (hasTrait(traits, TRAIT_BITS.COVER) || device.outputType === 'COVERABLE') {
      return {
        name,
        description: `Cover / blind (hardware id ${hardwareId})`,
        type: 'cover',
        inferred: true,
        unsupported: 'cover',
      };
    }
    if (device.outputType === 'RELAY') {
      return {
        name,
        description: `Relay (inferred, hardware id ${hardwareId})`,
        type: DEVICE_TYPES.SWITCH,
        dimmable: false,
        broadcastClicks: false,
        inferred: true,
      };
    }
    if (device.outputType === 'LIGHT' || hasTrait(traits, TRAIT_BITS.POWER)) {
      const dimmable = hasTrait(traits, TRAIT_BITS.DIM);
      return {
        name,
        description: `${dimmable ? 'Dimmable light' : 'Light'} (inferred, hardware id ${hardwareId})`,
        type: 'light',
        dimmable,
        colorTemp: hasTrait(traits, TRAIT_BITS.TEMP),
        broadcastClicks: false,
        inferred: true,
      };
    }

    return null;
  }

  /**
   * Plejd API properties parsed
   *
   * * `devices` - physical Plejd devices, duplicated for devices with multiple outputs
   *   devices: [{deviceId, title, objectId, ...}, {...}]
   * * `deviceAddress` - BLE address of each physical device
   *   deviceAddress: {[deviceId]: bleDeviceAddress}
   * * `outputSettings` - lots of info about load settings, also links devices to output index
   *   outputSettings: [{deviceId, output, deviceParseId, ...}]  //deviceParseId === objectId above
   * * `outputAddress`: BLE address of [0] main output and [n] other output (loads)
   *   outputAddress: {[deviceId]: {[output]: bleDeviceAddress}}
   * * `inputSettings` - detailed settings for inputs (buttons, RTR-01, ...), scenes triggered, ...
   *   inputSettings: [{deviceId, input, ...}]  //deviceParseId === objectId above
   * * `inputAddress` - Links inputs to what BLE device they control, or 255 for unassigned/scene
   *   inputAddress: {[deviceId]: {[input]: bleDeviceAddress}}
   */
  _getPlejdDevices() {
    this.deviceRegistry.clearPlejdDevices();

    this.siteDetails.devices.forEach((device) => {
      this.deviceRegistry.addPhysicalDevice(device);

      const outputSettings = this.siteDetails.outputSettings.find(
        (x) => x.deviceParseId === device.objectId,
      );

      if (!outputSettings) {
        logger.verbose(
          `No outputSettings found for ${device.title} (${device.deviceId}), assuming output 0`,
        );
      }
      const deviceOutput = outputSettings ? outputSettings.output : 0;
      const outputAddress = this.siteDetails.outputAddress[device.deviceId];

      if (outputAddress) {
        const bleOutputAddress = outputAddress[deviceOutput];

        if (device.traits === TRAITS.NO_LOAD) {
          logger.warn(
            `Device ${device.title} (${device.deviceId}) has no load configured and will be excluded`,
          );
        } else {
          const uniqueOutputId = this.deviceRegistry.getUniqueOutputId(
            device.deviceId,
            deviceOutput,
          );

          const plejdDevice = this.siteDetails.plejdDevices.find(
            (x) => x.deviceId === device.deviceId,
          );

          // `device.traits` is a bitfield — test the DIM bit rather than matching
          // exact combinations, so covers/thermostats/future devices don't slip
          // through as "not dimmable" by accident.
          const dimmable = hasTrait(device.traits, TRAIT_BITS.DIM);

          // Alternate approach looks at outputSettings.dimCurve and outputSettings.predefinedLoad
          // 1. outputSettings.dimCurve === null: Not dimmable
          // 2. outputSettings.dimCurve NOT IN ["NonDimmable", "RelayNormal"]: Dimmable
          // 3. outputSettings.predefinedLoad !== null && outputSettings.predefinedLoad.loadType === "DWN": Dimmable

          try {
            const decodedDeviceType =
              this._getDeviceType(plejdDevice) || this._inferDeviceType(device, plejdDevice, null);

            if (!decodedDeviceType) {
              logger.warn(
                `Could not determine a device type for output device ${device.title} (hardware id ${plejdDevice.hardwareId}). Skipping it. --- PLEASE OPEN AN ISSUE at https://github.com/oleost/hassio-plejd/issues/ WITH THIS AND THE NEXT LOG ROWS ---`,
              );
              logger.warn(`device (from API response): ${JSON.stringify(device, null, 2)}`);
              logger.warn(
                `plejdDevice (from API response): ${JSON.stringify(plejdDevice, null, 2)}`,
              );
              return;
            }

            if (decodedDeviceType.unsupported) {
              logger.warn(
                `Device ${device.title} (hardware id ${plejdDevice.hardwareId}) is a ${decodedDeviceType.unsupported}. It is recognized but not yet supported by this add-on and will be skipped for now — it will appear automatically once ${decodedDeviceType.unsupported} support is added. Track/nudge at https://github.com/oleost/hassio-plejd/issues/`,
              );
              return;
            }

            if (decodedDeviceType.inferred) {
              logger.warn(
                `Hardware id ${plejdDevice.hardwareId} (${device.title}) is not explicitly mapped; treating it as a ${decodedDeviceType.type} (dimmable=${!!decodedDeviceType.dimmable}) based on device traits/outputType. Please open an issue at https://github.com/oleost/hassio-plejd/issues/ with this hardware id so it can be added explicitly.`,
              );
            }

            let loadType = decodedDeviceType.type;
            if (device.outputType === 'RELAY') {
              loadType = 'switch';
            } else if (device.outputType === 'LIGHT') {
              loadType = 'light';
            }

            const room = this.siteDetails.rooms.find((x) => x.roomId === device.roomId);
            const roomTitle = room ? room.title : undefined;

            // Output devices are normally named via device.title; fall back to
            // plejdDevice.installationLocation for parity with the input branch.
            const outputName =
              device.title || trimmedOrUndef(plejdDevice && plejdDevice.installationLocation);

            /** @type {import('types/DeviceRegistry').OutputDevice} */
            const outputDevice = {
              bleOutputAddress,
              colorTemp: null,
              colorTempSettings: outputSettings ? outputSettings.colorTemperature : null,
              deviceId: device.deviceId,
              dimmable,
              name: outputName,
              output: deviceOutput,
              roomId: device.roomId,
              roomName: roomTitle,
              state: undefined,
              type: loadType,
              typeDescription: decodedDeviceType.description,
              typeName: decodedDeviceType.name,
              version: plejdDevice.firmware.version,
              uniqueId: uniqueOutputId,
            };

            this.deviceRegistry.addOutputDevice(outputDevice);

            // Tunable-white devices (DWN-01, …) stream colour-temperature changes
            // on a DIFFERENT BLE address than their on/off/dim output — the
            // physical `deviceAddress`, and/or a further entry in
            // `outputAddress[deviceId]`. Neither has a `devices[]` entry, so the
            // loop never registers it. Alias every such address for this device
            // to the same output so its colour-temp reports resolve instead of
            // logging as `Device null`.
            Object.entries(outputAddress).forEach(([outIdx, aliasAddress]) => {
              if (Number(outIdx) !== deviceOutput && typeof aliasAddress === 'number') {
                this.deviceRegistry.aliasOutputAddress(aliasAddress, uniqueOutputId);
              }
            });
            const physicalAddress = this.siteDetails.deviceAddress[device.deviceId];
            if (typeof physicalAddress === 'number' && physicalAddress !== bleOutputAddress) {
              this.deviceRegistry.aliasOutputAddress(physicalAddress, uniqueOutputId);
            }
          } catch (error) {
            logger.error(`Error trying to create output device: ${error}`);
            logger.warn(
              `device (from API response) when error happened: ${JSON.stringify(device, null, 2)}`,
            );
            logger.warn(
              `plejdDevice (from API response) when error happened: ${JSON.stringify(
                plejdDevice,
                null,
                2,
              )}`,
            );
          }
        }
      } else {
        // The device does not have an output. It can be assumed to be a WPH-01, WRT-01, or EXT-01
        // Filter inputSettings for available buttons
        const inputSettings = this.siteDetails.inputSettings.filter(
          (x) => x.deviceId === device.deviceId,
        );

        // For each found button, register the device as an inputDevice
        inputSettings.forEach((input) => {
          const bleInputAddress = this.siteDetails.deviceAddress[input.deviceId];
          logger.verbose(
            `Found input device (${input.deviceId}), with input ${input.input} having BLE address (${bleInputAddress})`,
          );

          const plejdDevice = this.siteDetails.plejdDevices.find(
            (x) => x.deviceId === device.deviceId,
          );

          const uniqueInputId = this.deviceRegistry.getUniqueInputId(device.deviceId, input.input);

          const inputRoom = this.siteDetails.rooms.find((x) => x.roomId === device.roomId);
          const inputRoomName = inputRoom ? inputRoom.title : undefined;

          // Name resolution for a wireless switch, in priority order:
          //  1. device.title — set when the switch is a standalone named device
          //  2. plejdDevice.installationLocation — where Plejd stores the switch
          //     label when its buttons are individually assigned to loads (this
          //     is the common case; device.title is then empty)
          //  3. any other devices[] entry for the same deviceId that has a title
          const siblingTitled = this.siteDetails.devices.find(
            (x) => x.deviceId === device.deviceId && x.title,
          );
          const inputTitle =
            device.title ||
            trimmedOrUndef(plejdDevice && plejdDevice.installationLocation) ||
            (siblingTitled && siblingTitled.title);

          try {
            const decodedDeviceType =
              this._getDeviceType(plejdDevice) || this._inferDeviceType(device, plejdDevice, input);

            if (decodedDeviceType && decodedDeviceType.inferred) {
              logger.warn(
                `Input device hardware id ${plejdDevice.hardwareId} (${inputTitle}) is not explicitly mapped; exposing input ${input.input} as a device automation based on buttonType=${input.buttonType}. Please open an issue at https://github.com/oleost/hassio-plejd/issues/ with this hardware id.`,
              );
            }

            if (decodedDeviceType && decodedDeviceType.broadcastClicks) {
              if (!inputTitle) {
                // No name from Plejd (no title, no installationLocation) — leave
                // it unset so Home Assistant keeps any name it already has.
                logger.verbose(
                  `Input device ${device.deviceId} (${decodedDeviceType.name}) has no name in the Plejd data; leaving discovery name unset.`,
                );
              }

              /** @type {import('types/DeviceRegistry').InputDevice} */
              const inputDevice = {
                bleInputAddress,
                deviceId: device.deviceId,
                name: inputTitle || undefined,
                input: input.input,
                roomId: device.roomId,
                roomName: inputRoomName,
                type: decodedDeviceType.type,
                typeDescription: decodedDeviceType.description,
                typeName: decodedDeviceType.name,
                version: plejdDevice.firmware.version,
                uniqueId: uniqueInputId,
              };
              this.deviceRegistry.addInputDevice(inputDevice);
            } else if (!decodedDeviceType) {
              logger.verbose(
                `Input ${input.input} on ${inputTitle || device.deviceId} (hardware id ${plejdDevice.hardwareId}, buttonType=${input.buttonType}) is not a physical button and will not be exposed.`,
              );
            }
          } catch (error) {
            logger.error(`Error trying to create input device: ${error}`);
            logger.warn(
              `device (from API response) when error happened: ${JSON.stringify(device, null, 2)}`,
            );
            logger.warn(
              `plejdDevice (from API response) when error happened: ${JSON.stringify(
                plejdDevice,
                null,
                2,
              )}`,
            );
          }
        });
      }
    });
  }

  _getRoomDevices() {
    if (this.config.includeRoomsAsLights) {
      logger.debug('includeRoomsAsLights is set to true, adding rooms too.');
      this.siteDetails.rooms.forEach((room) => {
        const { roomId } = room;
        const roomAddress = this.siteDetails.roomAddress[roomId];

        const deviceIdsByRoom = this.deviceRegistry.getOutputDeviceIdsByRoomId(roomId);

        const dimmable =
          deviceIdsByRoom &&
          deviceIdsByRoom.some(
            (deviceId) => this.deviceRegistry.getOutputDevice(deviceId).dimmable,
          );

        /** @type {import('types/DeviceRegistry').OutputDevice} */
        const newDevice = {
          bleOutputAddress: roomAddress,
          deviceId: null,
          colorTemp: null,
          dimmable,
          name: room.title,
          output: undefined,
          roomId: undefined,
          roomName: undefined,
          state: undefined,
          type: 'light',
          typeDescription: 'A Plejd room',
          typeName: 'Room',
          uniqueId: roomId,
          version: undefined,
        };

        this.deviceRegistry.addOutputDevice(newDevice);
      });
      logger.debug('includeRoomsAsLights done.');
    }
  }

  _getSceneDevices() {
    this.deviceRegistry.clearSceneDevices();
    // add scenes as switches
    const scenes = [...this.siteDetails.scenes];

    scenes.forEach((scene) => {
      const sceneNum = this.siteDetails.sceneIndex[scene.sceneId];
      /** @type {import('types/DeviceRegistry').OutputDevice} */
      const newScene = {
        bleOutputAddress: sceneNum,
        colorTemp: null,
        deviceId: undefined,
        dimmable: false,
        name: scene.title,
        output: undefined,
        roomId: undefined,
        roomName: undefined,
        state: false,
        type: DEVICE_TYPES.SCENE,
        typeDescription: 'A Plejd scene',
        typeName: DEVICE_TYPES.SCENE,
        version: undefined,
        uniqueId: scene.sceneId,
      };

      this.deviceRegistry.addScene(newScene);
    });
  }
}

module.exports = PlejdApi;
