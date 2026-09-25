/*********************************
  Node Helper for MMM-PirateSkyForecast.

  This helper makes ONE shared API request and broadcasts
  the result to all MMM-PirateSkyForecast instances.

  Data is cached for 15 minutes.
*********************************/

const Log = require("logger");
const NodeHelper = require("node_helper");
const moment = require("moment");

module.exports = NodeHelper.create({

  // Shared cache for all instances of MMM-PirateSkyForecast
  weatherCache: {},

  // Track requests currently in progress so multiple instances
  // requesting at the same time don't cause multiple API calls.
  pendingRequests: {},

  start() {
    Log.log(`Starting node_helper for module [${this.name}]`);
  },

  socketNotificationReceived(notification, payload) {

    if (notification !== "DARK_SKY_FORECAST_GET") {
      return;
    }

    // Validate configuration
    if (payload.apikey === null || payload.apikey === "") {
      Log.log(
        `[MMM-PirateSkyForecast] ${moment().format("D-MMM-YY HH:mm")} ` +
        `** ERROR ** No API key configured.`
      );
      return;
    }

    if (
      payload.latitude === null ||
      payload.latitude === "" ||
      payload.longitude === null ||
      payload.longitude === ""
    ) {
      Log.log(
        `[MMM-PirateSkyForecast] ${moment().format("D-MMM-YY HH:mm")} ` +
        `** ERROR ** Latitude and/or longitude not provided.`
      );
      return;
    }

    /*
     * Create a cache key based on the actual API parameters.
     *
     * This means that if you have multiple instances using the
     * same location/API key/units/language, they all share one
     * API request.
     *
     * If you have two different locations, they will correctly
     * have separate cache entries.
     */
    const cacheKey = [
      payload.apikey,
      payload.latitude,
      payload.longitude,
      payload.units,
      payload.language
    ].join("|");

    const now = Date.now();
    const cacheLifetime = 15 * 60 * 1000; // 15 minutes

    /*
     * If we have valid cached data, broadcast it without
     * contacting Pirate Weather.
     */
    if (
      this.weatherCache[cacheKey] &&
      now - this.weatherCache[cacheKey].timestamp < cacheLifetime
    ) {
      Log.debug(
        `[MMM-PirateSkyForecast] Using cached weather data`
      );

      this.sendSocketNotification(
        "DARK_SKY_FORECAST_DATA",
        this.weatherCache[cacheKey].data
      );

      return;
    }

    /*
     * If another instance has already started the API request,
     * don't start another one.
     */
    if (this.pendingRequests[cacheKey]) {
      Log.debug(
        `[MMM-PirateSkyForecast] API request already in progress`
      );
      return;
    }

    this.pendingRequests[cacheKey] = true;

    this.requestData(payload, cacheKey);
  },

  async requestData(payload, cacheKey) {

    const url =
      `https://api.pirateweather.net/forecast/` +
      `${payload.apikey}/` +
      `${payload.latitude},${payload.longitude}` +
      `?units=${payload.units}` +
      `&lang=${payload.language}`;

    Log.debug(
      `[MMM-PirateSkyForecast] Getting data from Pirate Weather: ${url}`
    );

    try {

      const response = await fetch(url);

      if (!response.ok) {
        throw new Error(`HTTP error! status: ${response.status}`);
      }

      const data = await response.json();

      /*
       * Store the response in the shared cache.
       */
      this.weatherCache[cacheKey] = {
        timestamp: Date.now(),
        data: data
      };

      Log.log(
        `[MMM-PirateSkyForecast] Weather API request successful. ` +
        `Broadcasting to all instances.`
      );

      /*
       * IMPORTANT:
       *
       * sendSocketNotification broadcasts this notification
       * to all instances of the module.
       *
       * We deliberately do NOT include/filter by instanceId.
       */
      this.sendSocketNotification(
        "DARK_SKY_FORECAST_DATA",
        data
      );

    } catch (error) {

      Log.error(
        `[MMM-PirateSkyForecast] ` +
        `${moment().format("D-MMM-YY HH:mm")} ` +
        `** ERROR ** ${error}`
      );

    } finally {

      /*
       * Allow another request after this one finishes.
       */
      delete this.pendingRequests[cacheKey];
    }
  }

});
