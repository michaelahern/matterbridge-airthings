import { AirthingsClient, SensorResult, SensorUnits } from 'airthings-consumer-api';
import { Matterbridge, MatterbridgeEndpoint, MatterbridgeDynamicPlatform, PlatformConfig, airQualitySensor, bridgedNode, humiditySensor, powerSource, temperatureSensor } from 'matterbridge';
import { AnsiLogger } from 'matterbridge/logger';
import { AirQuality, PowerSource, RelativeHumidityMeasurement, TemperatureMeasurement } from 'matterbridge/matter/clusters';

export class AirthingsPlatform extends MatterbridgeDynamicPlatform {
    airthingsClient: AirthingsClient;
    bridgedDevices = new Map<string, MatterbridgeEndpoint>();
    refreshSensorsInterval: NodeJS.Timeout | undefined;

    constructor(matterbridge: Matterbridge, log: AnsiLogger, config: PlatformConfig) {
        super(matterbridge, log, config);
        this.log.info('[init]');

        const clientId = process.env.AIRTHINGS_CLIENT_ID;
        const clientSecret = process.env.AIRTHINGS_CLIENT_SECRET;

        if (!clientId || !clientSecret) {
            this.log.error('Must set the AIRTHINGS_CLIENT_ID and AIRTHINGS_CLIENT_SECRET environment variables, exiting...');
            process.exit(1);
        }

        this.airthingsClient = new AirthingsClient({
            clientId: clientId,
            clientSecret: clientSecret
        });
    }

    override async onStart(reason?: string) {
        this.log.info('[onStart]', reason);

        await this.ready;
        await this.clearSelect();

        const devicesResponse = await this.airthingsClient.getDevices();
        const sensorsResponse = await this.airthingsClient.getSensors(SensorUnits.Metric);
        for (const device of devicesResponse.devices) {
            const deviceSensors = sensorsResponse.results.find(r => r.serialNumber === device.serialNumber);

            if (!deviceSensors) {
                this.log.warn(`No sensors found for device ${device.name} (${device.serialNumber})!`);
                continue;
            }

            const battery = deviceSensors.batteryPercentage;
            const temp = deviceSensors.sensors.find(s => s.sensorType === 'temp')?.value;
            const humidity = deviceSensors.sensors.find(s => s.sensorType === 'humidity')?.value;

            const endpoint = new MatterbridgeEndpoint([bridgedNode, powerSource], { uniqueStorageKey: 'Airthings-' + device.serialNumber }, this.config.debug as boolean)
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
                .createDefaultPowerSourceReplaceableBatteryClusterServer(battery ? battery * 2 : undefined)
                .addRequiredClusterServers();

            endpoint.addChildDeviceType('Temperature', temperatureSensor)
                .createDefaultTemperatureMeasurementClusterServer(temp ? temp * 100 : undefined)
                .addRequiredClusterServers();

            endpoint.addChildDeviceType('Humidity', humiditySensor)
                .createDefaultRelativeHumidityMeasurementClusterServer(humidity ? humidity * 100 : undefined)
                .addRequiredClusterServers();

            endpoint.addChildDeviceType('AirQuality', airQualitySensor)
                .createDefaultAirQualityClusterServer(this.#getAirQuality(deviceSensors))
                .addRequiredClusterServers();

            this.setSelectDevice(device.serialNumber, device.name, undefined, 'hub');
            await this.registerDevice(endpoint);
            this.bridgedDevices.set(device.serialNumber, endpoint);
        }
    }

    override async onConfigure() {
        await super.onConfigure();
        this.log.info('[onConfigure]');

        const refreshSensors = async () => {
            const airthingsSensors = await this.airthingsClient.getSensors(SensorUnits.Metric);
            for (const device of airthingsSensors.results) {
                const endpoint = this.bridgedDevices.get(device.serialNumber);
                if (endpoint) {
                    this.log.debug(`Refreshing sensors for ${device.serialNumber}:`, device);

                    const batteryPercentage = device.batteryPercentage;
                    if (batteryPercentage !== undefined) {
                        await endpoint.setAttribute(PowerSource.Cluster.id, 'batPercentRemaining', batteryPercentage * 2, endpoint.log);
                    }

                    const temp = device.sensors.find(s => s.sensorType === 'temp')?.value;
                    const tempEndpoint = endpoint.getChildEndpointByName('Temperature');
                    if (temp !== undefined && tempEndpoint) {
                        await tempEndpoint.setAttribute(TemperatureMeasurement.Cluster.id, 'measuredValue', temp * 100, endpoint.log);
                    }

                    const humidity = device.sensors.find(s => s.sensorType === 'humidity')?.value;
                    const humidityEndpoint = endpoint.getChildEndpointByName('Humidity');
                    if (humidity !== undefined && humidityEndpoint) {
                        await humidityEndpoint.setAttribute(RelativeHumidityMeasurement.Cluster.id, 'measuredValue', humidity * 100, endpoint.log);
                    }

                    const airQualityEndpoint = endpoint.getChildEndpointByName('AirQuality');
                    if (airQualityEndpoint) {
                        await airQualityEndpoint.setAttribute(AirQuality.Cluster.id, 'airQuality', this.#getAirQuality(device), endpoint.log);
                    }
                }
            }
        };

        refreshSensors();
        this.refreshSensorsInterval = setInterval(refreshSensors, 120 * 1000);
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
