/*********************************
 *
 * Node Helper for MMM-PirateSkyForecast
 *
 * Weather requests are centralized here so that multiple
 * instances of the module share the same API request.
 *
 * Each unique combination of API key, location, units,
 * and language is fetched at most once every 15 minutes.
 *
 *********************************/

var NodeHelper = require("node_helper");
var request = require("request");
var moment = require("moment");

module.exports = NodeHelper.create({

  // Cached weather data, keyed by request parameters.
  weatherCache: {},

  // Active timers, keyed by request parameters.
  weatherTimers: {},

  // Registered module instances, keyed by request parameters.
  subscribers: {},

  CACHE_INTERVAL: 15 * 60 * 1000, // 15 minutes

  start: function() {
    console.log(
      "====================== Starting node_helper for module [" +
      this.name +
      "]"
    );

    this.weatherCache = {};
    this.weatherTimers = {};
    this.subscribers = {};
  },

  /*
   * Create a consistent key for a particular weather request.
   *
   * Instances with the same API key, location, units and language
   * will share the same API request.
   */
  getCacheKey: function(payload) {
    return [
      payload.apikey,
      payload.latitude,
      payload.longitude,
      payload.units,
      payload.language
    ].join("|");
  },

  /*
   * Register an instance of the module.
   *
   * If data is already cached, send it immediately.
   * Otherwise start a polling cycle for this location.
   */
  registerInstance: function(payload) {

    var self = this;
    var cacheKey = this.getCacheKey(payload);

    if (!this.subscribers[cacheKey]) {
      this.subscribers[cacheKey] = {};
    }

    this.subscribers[cacheKey][payload.instanceId] = true;

    // If we already have data, immediately send the cached data
    // so newly started/reloaded instances don't have to wait.
    if (this.weatherCache[cacheKey]) {
      this.sendWeatherData(cacheKey);
    }

    // If this is the first instance using this request, start polling.
    if (!this.weatherTimers[cacheKey]) {

      // Fetch immediately.
      this.fetchWeather(payload);

      // Then fetch once every 15 minutes.
      this.weatherTimers[cacheKey] = setInterval(function() {
        self.fetchWeather(payload);
      }, this.CACHE_INTERVAL);

      console.log(
        "[MMM-PirateSkyForecast] Started shared 15-minute polling for " +
        payload.latitude + "," + payload.longitude
      );
    }
  },

  /*
   * Make the actual PirateWeather API request.
   */
  fetchWeather: function(payload) {

    var self = this;
    var cacheKey = this.getCacheKey(payload);

    if (payload.apikey == null || payload.apikey == "") {
      console.log(
        "[MMM-PirateSkyForecast] " +
        moment().format("D-MMM-YY HH:mm") +
        " ** ERROR ** No API key configured."
      );
      return;
    }

    if (
      payload.latitude == null ||
      payload.latitude == "" ||
      payload.longitude == null ||
      payload.longitude == ""
    ) {
      console.log(
        "[MMM-PirateSkyForecast] " +
        moment().format("D-MMM-YY HH:mm") +
        " ** ERROR ** Latitude and/or longitude not provided."
      );
      return;
    }

    var url =
      "https://api.pirateweather.net/forecast/" +
      payload.apikey +
      "/" +
      payload.latitude +
      "," +
      payload.longitude +
      "?units=" +
      payload.units +
      "&lang=" +
      payload.language;

    console.log(
      "[MMM-PirateSkyForecast] Fetching weather for " +
      payload.latitude +
      "," +
      payload.longitude
    );

    request(
      {
        url: url,
        method: "GET"
      },
      function(error, response, body) {

        if (!error && response && response.statusCode == 200) {

          try {

            var resp = JSON.parse(body);

            // Store the data in the shared cache.
            self.weatherCache[cacheKey] = resp;

            // Broadcast the new data to every instance.
            self.sendWeatherData(cacheKey);

            console.log(
              "[MMM-PirateSkyForecast] Weather data updated for " +
              payload.latitude +
              "," +
              payload.longitude
            );

          } catch (parseError) {

            console.log(
              "[MMM-PirateSkyForecast] " +
              moment().format("D-MMM-YY HH:mm") +
              " ** ERROR ** Could not parse API response: " +
              parseError
            );

          }

        } else {

          console.log(
            "[MMM-PirateSkyForecast] " +
            moment().format("D-MMM-YY HH:mm") +
            " ** ERROR ** " +
            (error || ("HTTP status " +
              (response ? response.statusCode : "unknown")))
          );

        }

      }
    );
  },

  /*
   * Send cached weather data to every module instance.
   *
   * Because sendSocketNotification broadcasts to all instances,
   * the cacheKey is included so each instance can decide whether
   * the data belongs to it.
   */
  sendWeatherData: function(cacheKey) {

    if (!this.weatherCache[cacheKey]) {
      return;
    }

    this.sendSocketNotification(
      "DARK_SKY_FORECAST_DATA",
      {
        cacheKey: cacheKey,
        weatherData: this.weatherCache[cacheKey]
      }
    );
  },

  socketNotificationReceived: function(notification, payload) {

    if (notification === "DARK_SKY_FORECAST_REGISTER") {

      this.registerInstance(payload);

    }

  }

});
