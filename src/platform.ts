import { AirthingsClient, type SensorResult, SensorUnits } from 'airthings-consumer-api';
import { MatterbridgeEndpoint, MatterbridgeDynamicPlatform, type PlatformConfig, type PlatformMatterbridge, airQualitySensor, bridgedNode, humiditySensor, temperatureSensor } from 'matterbridge';
import { AnsiLogger } from 'matterbridge/logger';
import { AirQualityServer } from 'matterbridge/matter/behaviors';
import { AirQuality, CarbonDioxideConcentrationMeasurement, ConcentrationMeasurement, Pm1ConcentrationMeasurement, Pm25ConcentrationMeasurement, PowerSource, RadonConcentrationMeasurement, RelativeHumidityMeasurement, TemperatureMeasurement, TotalVolatileOrganicCompoundsConcentrationMeasurement } from 'matterbridge/matter/clusters';

export class AirthingsPlatform extends MatterbridgeDynamicPlatform {
    airthingsClient?: AirthingsClient;
    bridgedDevices = new Map<string, MatterbridgeEndpoint>();
    refreshSensorsInterval: NodeJS.Timeout | undefined;

    constructor(matterbridge: PlatformMatterbridge, log: AnsiLogger, config: PlatformConfig) {
        super(matterbridge, log, config);

        const clientId = config.clientId as string ?? process.env.AIRTHINGS_CLIENT_ID;
        const clientSecret = config.clientSecret as string ?? process.env.AIRTHINGS_CLIENT_SECRET;

        if (!clientId || !clientSecret) {
            this.log.error('Missing Airthings Client ID and Secret!');
            this.log.error(' - Platform Config Props: clientId & clientSecret');
            this.log.error(' - Environment Variables: AIRTHINGS_CLIENT_ID & AIRTHINGS_CLIENT_SECRET');
        }
        else {
            config.clientId = clientId;
            config.clientSecret = clientSecret;

            this.airthingsClient = new AirthingsClient({
                clientId: clientId,
                clientSecret: clientSecret
            });
        }
    }

    override async onStart(reason?: string) {
        if (!this.airthingsClient) {
            return;
        }

        this.log.info('[onStart]', reason);

        await this.ready;
        await this.clearSelect();

        const devicesResponse = await this.airthingsClient.getDevices();
        const sensorsResponse = await this.airthingsClient.getSensors(SensorUnits.Metric);
        for (const device of devicesResponse.devices) {
            const deviceSensors = sensorsResponse.results.find(r => r.serialNumber === device.serialNumber);

            if (!deviceSensors || !deviceSensors.recorded) {
                this.log.warn(`No active sensors found for device ${device.name} (${device.serialNumber})!`);
                continue;
            }

            const battery = deviceSensors.batteryPercentage;
            const temp = deviceSensors.sensors.find(s => s.sensorType === 'temp');
            const humidity = deviceSensors.sensors.find(s => s.sensorType === 'humidity');
            const co2 = deviceSensors.sensors.find(s => s.sensorType === 'co2');
            const pm1 = deviceSensors.sensors.find(s => s.sensorType === 'pm1');
            const pm25 = deviceSensors.sensors.find(s => s.sensorType === 'pm25');
            const radon = deviceSensors.sensors.find(s => s.sensorType === 'radonShortTermAvg');
            const voc = deviceSensors.sensors.find(s => s.sensorType === 'voc');

            const endpoint = new MatterbridgeEndpoint([bridgedNode], { id: 'Airthings-' + device.serialNumber }, this.config.debug as boolean)
                .createDefaultBridgedDeviceBasicInformationClusterServer(
                    device.name,
                    device.serialNumber,
                    0xfff1,
                    'Airthings',
                    device.type.replace(/_/g, ' ').toLowerCase().replace(/\b\w/g, char => char.toUpperCase()),
                    parseInt(this.version.replace(/\D/g, '')),
                    this.version,
                    parseInt(this.matterbridge.matterbridgeVersion.replace(/\D/g, '')),
                    this.matterbridge.matterbridgeVersion
                )
                .createDefaultPowerSourceRechargeableBatteryClusterServer(
                    battery !== undefined ? battery * 2 : undefined,
                    battery !== undefined && battery > 20 ? PowerSource.BatChargeLevel.Ok : PowerSource.BatChargeLevel.Warning)
                .addRequiredClusterServers();

            endpoint.name = `Airthings ${device.type.replace(/_/g, ' ').toLowerCase().replace(/\b\w/g, char => char.toUpperCase())}`;

            endpoint.addChildDeviceType('Temperature', temperatureSensor)
                .createDefaultTemperatureMeasurementClusterServer(temp ? temp.value * 100 : undefined)
                .addRequiredClusterServers();

            endpoint.addChildDeviceType('Humidity', humiditySensor)
                .createDefaultRelativeHumidityMeasurementClusterServer(humidity ? humidity.value * 100 : undefined)
                .addRequiredClusterServers();

            endpoint.addChildDeviceType('AirQuality', airQualitySensor)
                .createDefaultAirQualityClusterServer(this.#getAirQuality(deviceSensors))
                .createDefaultCarbonDioxideConcentrationMeasurementClusterServer(co2?.value, ConcentrationMeasurement.MeasurementUnit.Ppm, ConcentrationMeasurement.MeasurementMedium.Air)
                .createDefaultPm1ConcentrationMeasurementClusterServer(pm1?.value, ConcentrationMeasurement.MeasurementUnit.Ugm3, ConcentrationMeasurement.MeasurementMedium.Air)
                .createDefaultPm25ConcentrationMeasurementClusterServer(pm25?.value, ConcentrationMeasurement.MeasurementUnit.Ugm3, ConcentrationMeasurement.MeasurementMedium.Air)
                .createDefaultRadonConcentrationMeasurementClusterServer(radon?.value, ConcentrationMeasurement.MeasurementUnit.Bqm3, ConcentrationMeasurement.MeasurementMedium.Air)
                .createDefaultTvocMeasurementClusterServer(voc ? Math.round(voc.value * 2.2727) : undefined, ConcentrationMeasurement.MeasurementUnit.Ugm3, ConcentrationMeasurement.MeasurementMedium.Air)
                .addRequiredClusterServers();

            this.setSelectDevice(device.serialNumber, device.name, undefined, 'hub');
            await this.registerDevice(endpoint);
            this.bridgedDevices.set(device.serialNumber, endpoint);
        }
    }

    override async onConfigure() {
        await super.onConfigure();

        const refreshSensors = async () => {
            if (!this.airthingsClient) {
                return;
            };

            const airthingsSensors = await this.airthingsClient.getSensors(SensorUnits.Metric);
            for (const device of airthingsSensors.results) {
                const endpoint = this.bridgedDevices.get(device.serialNumber);
                if (endpoint) {
                    this.log.debug(`Refreshing sensors for ${device.serialNumber}:`, device);

                    const tempEndpoint = endpoint.getChildEndpointByName('Temperature');
                    const humidityEndpoint = endpoint.getChildEndpointByName('Humidity');
                    const airQualityEndpoint = endpoint.getChildEndpointByName('AirQuality');
                    await airQualityEndpoint?.setAttribute(AirQuality.Cluster.id, 'airQuality', this.#getAirQuality(device), endpoint.log);

                    const batteryPercentage = device.batteryPercentage;
                    if (batteryPercentage !== undefined) {
                        await endpoint.setAttribute(PowerSource.Cluster.id, 'batPercentRemaining', batteryPercentage * 2, endpoint.log);
                        await endpoint.setAttribute(PowerSource.Cluster.id, 'batChargeLevel', batteryPercentage > 20 ? PowerSource.BatChargeLevel.Ok : PowerSource.BatChargeLevel.Warning, endpoint.log);
                    }

                    const temp = device.sensors.find(s => s.sensorType === 'temp');
                    if (temp) {
                        await tempEndpoint?.setAttribute(TemperatureMeasurement.Cluster.id, 'measuredValue', temp.value * 100, endpoint.log);
                    }

                    const humidity = device.sensors.find(s => s.sensorType === 'humidity');
                    if (humidity) {
                        await humidityEndpoint?.setAttribute(RelativeHumidityMeasurement.Cluster.id, 'measuredValue', humidity.value * 100, endpoint.log);
                    }

                    const co2 = device.sensors.find(s => s.sensorType === 'co2');
                    if (co2) {
                        await airQualityEndpoint?.setAttribute(CarbonDioxideConcentrationMeasurement.Cluster.id, 'measuredValue', co2.value, endpoint.log);
                    }

                    const pm1 = device.sensors.find(s => s.sensorType === 'pm1');
                    if (pm1) {
                        await airQualityEndpoint?.setAttribute(Pm1ConcentrationMeasurement.Cluster.id, 'measuredValue', pm1.value, endpoint.log);
                    }

                    const pm25 = device.sensors.find(s => s.sensorType === 'pm25');
                    if (pm25) {
                        await airQualityEndpoint?.setAttribute(Pm25ConcentrationMeasurement.Cluster.id, 'measuredValue', pm25.value, endpoint.log);
                    }

                    const radon = device.sensors.find(s => s.sensorType === 'radonShortTermAvg');
                    if (radon) {
                        await airQualityEndpoint?.setAttribute(RadonConcentrationMeasurement.Cluster.id, 'measuredValue', radon.value, endpoint.log);
                    }

                    const voc = device.sensors.find(s => s.sensorType === 'voc');
                    if (voc) {
                        await airQualityEndpoint?.setAttribute(TotalVolatileOrganicCompoundsConcentrationMeasurement.Cluster.id, 'measuredValue', Math.round(voc.value * 2.2727), endpoint.log);
                    }
                }
            }
        };

        refreshSensors();
        this.refreshSensorsInterval = setInterval(refreshSensors, (this.config.refreshInterval as number ?? 120) * 1000);
    }

    override async onShutdown(reason?: string) {
        clearInterval(this.refreshSensorsInterval);

        await super.onShutdown(reason);
        this.log.info('[onShutdown]', reason);

        if (this.config.unregisterOnShutdown === true) {
            await this.unregisterAllDevices(500);
        }
    }

    #getAirQuality(lastResult: SensorResult) {
        let aq = AirQuality.AirQualityEnum.Unknown;

        const co2Sensor = lastResult.sensors.find(x => x.sensorType === 'co2');
        if (co2Sensor /* && !this.airthingsConfig.co2AirQualityDisabled */) {
            if (co2Sensor.value >= 1000) {
                aq = Math.max(aq, AirQuality.AirQualityEnum.Poor);
            }
            else if (co2Sensor.value >= 800) {
                aq = Math.max(aq, AirQuality.AirQualityEnum.Fair);
            }
            else {
                aq = Math.max(aq, AirQuality.AirQualityEnum.Good);
            }
        }

        const humiditySensor = lastResult.sensors.find(x => x.sensorType === 'humidity');
        if (humiditySensor /* && !this.airthingsConfig.humidityAirQualityDisabled */) {
            if (humiditySensor.value < 25 || humiditySensor.value >= 70) {
                aq = Math.max(aq, AirQuality.AirQualityEnum.Poor);
            }
            else if (humiditySensor.value < 30 || humiditySensor.value >= 60) {
                aq = Math.max(aq, AirQuality.AirQualityEnum.Fair);
            }
            else {
                aq = Math.max(aq, AirQuality.AirQualityEnum.Good);
            }
        }

        const pm25Sensor = lastResult.sensors.find(x => x.sensorType === 'pm25');
        if (pm25Sensor /* && !this.airthingsConfig.pm25AirQualityDisabled */) {
            if (pm25Sensor.value >= 25) {
                aq = Math.max(aq, AirQuality.AirQualityEnum.Poor);
            }
            else if (pm25Sensor.value >= 10) {
                aq = Math.max(aq, AirQuality.AirQualityEnum.Fair);
            }
            else {
                aq = Math.max(aq, AirQuality.AirQualityEnum.Good);
            }
        }

        const radonShortTermAvgSensor = lastResult.sensors.find(x => x.sensorType === 'radonShortTermAvg');
        if (radonShortTermAvgSensor /* && !this.airthingsConfig.radonAirQualityDisabled */) {
            if (radonShortTermAvgSensor.value >= 150) {
                aq = Math.max(aq, AirQuality.AirQualityEnum.Poor);
            }
            else if (radonShortTermAvgSensor.value >= 100) {
                aq = Math.max(aq, AirQuality.AirQualityEnum.Fair);
            }
            else {
                aq = Math.max(aq, AirQuality.AirQualityEnum.Good);
            }
        }

        const vocSensor = lastResult.sensors.find(x => x.sensorType === 'voc');
        if (vocSensor /* && !this.airthingsConfig.vocAirQualityDisabled */) {
            if (vocSensor.value >= 2000) {
                aq = Math.max(aq, AirQuality.AirQualityEnum.Poor);
            }
            else if (vocSensor.value >= 250) {
                aq = Math.max(aq, AirQuality.AirQualityEnum.Fair);
            }
            else {
                aq = Math.max(aq, AirQuality.AirQualityEnum.Good);
            }
        }

        return aq;
    }
}

MatterbridgeEndpoint.prototype.createDefaultAirQualityClusterServer = function (airQuality = AirQuality.AirQualityEnum.Unknown): MatterbridgeEndpoint {
    // @ts-expect-error exactOptionalPropertyTypes
    this.behaviors.require(AirQualityServer.with(AirQuality.Feature.Fair), { airQuality });
    return this;
};
