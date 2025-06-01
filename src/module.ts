import { Matterbridge, PlatformConfig } from 'matterbridge';
import { AnsiLogger } from 'matterbridge/logger';
import { AirthingsPlatform } from './platform.js';

export default function initializePlugin(matterbridge: Matterbridge, log: AnsiLogger, config: PlatformConfig): AirthingsPlatform {
    return new AirthingsPlatform(matterbridge, log, config);
}
