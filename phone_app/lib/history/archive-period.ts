import { mmkvHelpers } from '../../contexts/mmkv-storage';
import { downloadArchiveRun, fetchArchivePeriodRuns } from '../api/archives';
import {
  loadArchivePeriod as loadArchivePeriodModel,
  type ArchivePeriodDependencies,
} from './archive-period-model';

export {
  archiveManifestFingerprint,
  type ArchivePeriodCache,
  type ArchivePeriodDependencies,
  type HistoricalArchiveRecord,
} from './archive-period-model';

const defaultDependencies: ArchivePeriodDependencies = {
  listRuns: fetchArchivePeriodRuns,
  downloadRun: downloadArchiveRun,
  readCache: (key) => mmkvHelpers.getObject(key),
  writeCache: (key, value) => mmkvHelpers.setObject(key, value),
};

export function loadArchivePeriod(
  input: Omit<Parameters<typeof loadArchivePeriodModel>[0], 'dependencies'> & {
    readonly dependencies?: ArchivePeriodDependencies;
  },
) {
  return loadArchivePeriodModel({
    ...input,
    dependencies: input.dependencies ?? defaultDependencies,
  });
}
