import { type PlatformConfig, type PlatformMatterbridge } from 'matterbridge';
import { AnsiLogger } from 'matterbridge/logger';
import { AirthingsPlatform } from './platform.js';

export default function initializePlugin(matterbridge: PlatformMatterbridge, log: AnsiLogger, config: PlatformConfig): AirthingsPlatform {
    return new AirthingsPlatform(matterbridge, log, config);
}
