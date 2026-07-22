import { cacheEvidence, parseCacheArgs } from './evidenceCache';

const cfg = parseCacheArgs(process.argv.slice(2));
await cacheEvidence(cfg);
