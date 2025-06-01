import { AirthingsClient, SensorUnits } from 'airthings-consumer-api';
import { Matterbridge, MatterbridgeEndpoint, MatterbridgeDynamicPlatform, PlatformConfig, bridgedNode, humiditySensor, powerSource, temperatureSensor } from 'matterbridge';
import { AnsiLogger } from 'matterbridge/logger';
import { PowerSource, RelativeHumidityMeasurement, TemperatureMeasurement } from 'matterbridge/matter/clusters';

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
                this.log.warn(`No active sensors found for device ${device.name} (${device.serialNumber})!`);
                continue;
            }

            const battery = deviceSensors.batteryPercentage;
            const temp = deviceSensors.sensors.find(s => s.sensorType === 'temp')?.value;
            const humidity = deviceSensors.sensors.find(s => s.sensorType === 'humidity')?.value;

            const endpoint = new MatterbridgeEndpoint([bridgedNode, powerSource, temperatureSensor, humiditySensor], { uniqueStorageKey: 'Airthings' + device.serialNumber }, this.config.debug as boolean)
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
                .createDefaultTemperatureMeasurementClusterServer(temp ? temp * 100 : undefined)
                .createDefaultRelativeHumidityMeasurementClusterServer(humidity ? humidity * 100 : undefined);

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
                    if (batteryPercentage) {
                        await endpoint.setAttribute(PowerSource.Cluster.id, 'batPercentRemaining', batteryPercentage * 2, endpoint.log);
                    }

                    const temp = device.sensors.find(s => s.sensorType === 'temp')?.value;
                    if (temp) {
                        await endpoint.setAttribute(TemperatureMeasurement.Cluster.id, 'measuredValue', temp * 100, endpoint.log);
                    }

                    const humidity = device.sensors.find(s => s.sensorType === 'humidity')?.value;
                    if (humidity) {
                        await endpoint.setAttribute(RelativeHumidityMeasurement.Cluster.id, 'measuredValue', humidity * 100, endpoint.log);
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
}
