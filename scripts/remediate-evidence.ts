import { parseRemediationArgs, runEvidenceRemediation } from './evidenceRemediation';

try {
  runEvidenceRemediation(parseRemediationArgs(process.argv.slice(2)));
} catch (error) {
  console.error(error instanceof Error ? error.stack ?? error.message : String(error));
  process.exitCode = 1;
}
