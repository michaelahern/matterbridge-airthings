import { AirthingsClient, SensorUnits } from 'airthings-consumer-api';
import {
    Matterbridge,
    MatterbridgeEndpoint,
    MatterbridgeDynamicPlatform,
    PlatformConfig,
    airQualitySensor,
    bridgedNode
} from 'matterbridge';
import { AnsiLogger } from 'matterbridge/logger';
import {
    AirQuality,
    CarbonDioxideConcentrationMeasurement,
    ConcentrationMeasurement,
    Pm1ConcentrationMeasurement,
    Pm25ConcentrationMeasurement,
    RadonConcentrationMeasurement,
    RelativeHumidityMeasurement,
    TemperatureMeasurement,
    TotalVolatileOrganicCompoundsConcentrationMeasurement
} from 'matterbridge/matter/clusters';
import { isValidNumber } from 'matterbridge/utils';

export class AirthingsPlatform extends MatterbridgeDynamicPlatform {
    airQuality: MatterbridgeEndpoint | undefined;
    airQualityInterval: NodeJS.Timeout | undefined;
    bridgedDevices = new Map<string, MatterbridgeEndpoint>();

    airthingsClient: AirthingsClient;

    constructor(matterbridge: Matterbridge, log: AnsiLogger, config: PlatformConfig) {
        super(matterbridge, log, config);
        this.log.info('Initializing platform:', this.config.name);

        const clientId = process.env.AIRTHINGS_CLIENT_ID;
        const clientSecret = process.env.AIRTHINGS_CLIENT_SECRET;

        if (!clientId || !clientSecret) {
            console.error('Please set the AIRTHINGS_CLIENT_ID and AIRTHINGS_CLIENT_SECRET environment variables.');
            process.exit(1);
        }

        this.airthingsClient = new AirthingsClient({
            clientId: clientId,
            clientSecret: clientSecret
        });
    }

    override async onStart(reason?: string) {
        this.log.info('onStart called with reason:', reason ?? 'none');

        await this.ready;
        await this.clearSelect();

        const airthingsDevices = await this.airthingsClient.getDevices();
        const airthingsSensors = await this.airthingsClient.getSensors(SensorUnits.Metric);
        await airthingsDevices.devices.forEach(async (device) => {
            const deviceSensors = airthingsSensors.results.find(sensor => sensor.serialNumber === device.serialNumber);

            if (!deviceSensors || !deviceSensors.recorded) {
                this.log.warn(`No sensors found for device ${device.name} (${device.serialNumber})`);
                return;
            }

            const endpoint = new MatterbridgeEndpoint([airQualitySensor, bridgedNode], { uniqueStorageKey: 'Airthings' }, this.config.debug as boolean)
                .createDefaultBridgedDeviceBasicInformationClusterServer(
                    device.name,
                    device.serialNumber,
                    0xfff1,
                    'Airthings',
                    'Airthings Air Quality Sensor',
                    parseInt(this.version.replace(/\D/g, '')),
                    this.version === '' ? 'Unknown' : this.version,
                    parseInt(this.matterbridge.matterbridgeVersion.replace(/\D/g, '')),
                    this.matterbridge.matterbridgeVersion
                )
                .addRequiredClusterServers()
                .addClusterServers([TemperatureMeasurement.Cluster.id, RelativeHumidityMeasurement.Cluster.id]);

            if (device.sensors.includes('co2')) {
                const sensor = deviceSensors.sensors.find(sensor => sensor.sensorType === 'co2');
                if (sensor) {
                    endpoint.createDefaultCarbonDioxideConcentrationMeasurementClusterServer(sensor.value, ConcentrationMeasurement.MeasurementUnit.Ppm, ConcentrationMeasurement.MeasurementMedium.Air);
                }
            }

            if (device.sensors.includes('pm1')) {
                const sensor = deviceSensors.sensors.find(sensor => sensor.sensorType === 'pm1');
                if (sensor) {
                    endpoint.createDefaultPm1ConcentrationMeasurementClusterServer(sensor.value, ConcentrationMeasurement.MeasurementUnit.Mgm3, ConcentrationMeasurement.MeasurementMedium.Air);
                }
            }

            if (device.sensors.includes('pm25')) {
                const sensor = deviceSensors.sensors.find(sensor => sensor.sensorType === 'pm25');
                if (sensor) {
                    endpoint.createDefaultPm25ConcentrationMeasurementClusterServer(sensor.value, ConcentrationMeasurement.MeasurementUnit.Mgm3, ConcentrationMeasurement.MeasurementMedium.Air);
                }
            }
            // .createDefaultRadonConcentrationMeasurementClusterServer(100)
            // .createDefaultTvocMeasurementClusterServer(100);

            this.setSelectDevice(device.serialNumber, device.name, undefined, 'hub');
            await this.registerDevice(endpoint);
            this.bridgedDevices.set(device.serialNumber, endpoint);
        });
    }

    override async onConfigure() {
        await super.onConfigure();
        this.log.info('onConfigure called');

        // Set air quality to Normal
        await this.airQuality?.setAttribute(AirQuality.Cluster.id, 'airQuality', AirQuality.AirQualityEnum.Good, this.airQuality.log);
        await this.airQuality?.setAttribute(TemperatureMeasurement.Cluster.id, 'measuredValue', 2150, this.airQuality.log);
        await this.airQuality?.setAttribute(RelativeHumidityMeasurement.Cluster.id, 'measuredValue', 5500, this.airQuality.log);
        if (this.config.enableConcentrationMeasurements === true) {
            await this.airQuality?.setAttribute(CarbonDioxideConcentrationMeasurement.Cluster.id, 'measuredValue', 400, this.airQuality.log);
            await this.airQuality?.setAttribute(Pm1ConcentrationMeasurement.Cluster.id, 'measuredValue', 100, this.airQuality.log);
            await this.airQuality?.setAttribute(Pm25ConcentrationMeasurement.Cluster.id, 'measuredValue', 100, this.airQuality.log);
            await this.airQuality?.setAttribute(RadonConcentrationMeasurement.Cluster.id, 'measuredValue', 100, this.airQuality.log);
            await this.airQuality?.setAttribute(TotalVolatileOrganicCompoundsConcentrationMeasurement.Cluster.id, 'measuredValue', 100, this.airQuality.log);
        }

        if (this.config.useInterval) {
            // Toggle air quality every minute
            this.airQualityInterval = setInterval(
                async () => {
                    let value = this.airQuality?.getAttribute(AirQuality.Cluster.id, 'airQuality', this.airQuality?.log);
                    if (isValidNumber(value, AirQuality.AirQualityEnum.Good, AirQuality.AirQualityEnum.ExtremelyPoor)) {
                        value = value >= AirQuality.AirQualityEnum.ExtremelyPoor ? AirQuality.AirQualityEnum.Good : value + 1;
                        await this.airQuality?.setAttribute(AirQuality.Cluster.id, 'airQuality', value, this.airQuality.log);
                        this.airQuality?.log.info(`Set air quality to ${value}`);
                    }
                },
                60 * 1000 + 1100
            );
        }
    }

    override async onShutdown(reason?: string) {
        clearInterval(this.airQualityInterval);
        await super.onShutdown(reason);
        this.log.info('onShutdown called with reason:', reason ?? 'none');
        if (this.config.unregisterOnShutdown === true) await this.unregisterAllDevices(500);
    }
}
