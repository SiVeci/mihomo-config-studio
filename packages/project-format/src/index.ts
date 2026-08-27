export type { ProjectFormatErrorCode, ZipEntry } from './zip.js';
export { ProjectFormatError, readZip, writeZip } from './zip.js';

export type {
  McsProject,
  McsProjManifest,
  McsProjQuarantine,
  McsProjQuarantinedField,
  McsProjSchemaLock,
  SensitivityFinding,
  SensitivityKind,
} from './mcsproj.js';
export {
  MCSPROJ_FORMAT_VERSION,
  describeSensitivity,
  readMcsproj,
  writeMcsproj,
} from './mcsproj.js';
