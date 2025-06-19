# Matterbridge Airthings

[![npm](https://badgen.net/npm/v/matterbridge-airthings)](https://www.npmjs.com/package/matterbridge-airthings)
[![node](https://badgen.net/npm/node/matterbridge-airthings)](https://www.npmjs.com/package/matterbridge-airthings)
[![downloads](https://badgen.net/npm/dt/matterbridge-airthings)](https://www.npmjs.com/package/matterbridge-airthings)
[![Ask DeepWiki](https://deepwiki.com/badge.svg)](https://deepwiki.com/michaelahern/matterbridge-airthings)

A [Matterbridge](https://github.com/Luligu/matterbridge) plugin for [Airthings](https://www.airthings.com) air quality monitors via the  [Airthings Consumer API](https://consumer-api-doc.airthings.com/).

## Requirements

 * [Matterbridge](https://github.com/Luligu/matterbridge)
 * One or more supported [Airthings](https://www.airthings.com/) air quality monitors
 * At least one Airthings SmartLink Hub ([View Plus](https://www.airthings.com/view-plus), [View Radon](https://www.airthings.com/view-radon))

### Supported Devices

| Airthings Device                                                     | Serial Number |
| -------------------------------------------------------------------- | ------------- |
| [Airthings View Plus](https://www.airthings.com/view-plus)           | 2960xxxxxx    |
| [Airthings View Radon](https://www.airthings.com/view-radon)         | 2989xxxxxx    |
| [Airthings Wave Enhance](https://www.airthings.com/wave-enhance)     | 3210xxxxxx    |
| [Airthings Wave Enhance](https://www.airthings.com/wave-enhance)     | 3220xxxxxx    |
| [Airthings Wave Plus](https://www.airthings.com/wave-plus)           | 2930xxxxxx    |
| [Airthings Wave Radon](https://www.airthings.com/wave-radon)         | 2950xxxxxx    |
| [Airthings Wave Mini](https://www.airthings.com/wave-mini)           | 2920xxxxxx    |

Note: Airthings Wave devices require an Airthings SmartLink Hub ([View Plus](https://www.airthings.com/view-plus), [View Radon](https://www.airthings.com/view-radon)) to continuously push measurement data to the Airthings Cloud.

## Configuration

Field                          | Description
-------------------------------|------------
**clientId**                   | (required) Client ID generated in the [Airthings Dashboard](https://consumer-api-doc.airthings.com/dashboard)
**clientSecret**               | (required) Client Secret generated in the [Airthings Dashboard](https://consumer-api-doc.airthings.com/dashboard)
**refreshInterval**            | (optional) Interval in seconds for refreshing sensor data, default is 120s<br/>_Note: The Airthings Consumer API has a [rate limit of 120 requests per hour](https://consumer-api-doc.airthings.com/docs/api/rate-limit)_
**debug**                      | (optional) Enable debug logging, disabled by default

### How to request an Airthings API Client ID & Secret

Login to the [Airthings Dashboard](https://consumer-api-doc.airthings.com/dashboard) and go to *Create New Application*.

## Matter Device Types

### Temperature & Humidity Sensors

### Air Quality Sensors

Air Quality Sensors are a composite of Radon, Particulate Matter (PM2.5), Volatile Organic Compound (VOC), Carbon Dioxide (CO₂), and Humidity sensors, depending on the sensors supported by your device and your plugin configuration. Air Quality values (Good, Fair, Poor) are based on [Airthings-defined thresholds](https://help.airthings.com/en/articles/5367327-view-understanding-the-sensor-thresholds) for each sensor.

Sensor                            | 🟢 Good       | 🟠 Fair                            | 🔴 Poor            |
----------------------------------|---------------|------------------------------------|--------------------|
Radon                             | <100 Bq/m³    | ≥100 and <150 Bq/m³                | ≥150 Bq/m³         |
Particulate Matter (PM2.5)        | <10 μg/m³     | ≥10 and <25 μg/m³                  | ≥25 μg/m³          |
Volatile Organic Compounds (VOCs) | <250 ppb      | ≥250 and <2000 ppb                 | ≥2000 ppb          |
Carbon Dioxide (CO₂)              | <800 ppm      | ≥800 and <1000 ppm                 | ≥1000 ppm          |
Humidity                          | ≥30 and <60 % | ≥25 and <30 % <br /> ≥60 and <70 % | <25 % <br /> ≥70 % |

Notes:
* This plugin converts Volatile Organic Compound (VOC) measurements from ppb (units Airthings devices report) to µg/m³ (units expected by Apple HomeKit).
