import { formatPath, type ConfigPath } from './path.js';

export type YamlEngineErrorCode =
  | 'YAML_LIMIT_EXCEEDED'
  | 'YAML_PARSE_FAILED'
  | 'YAML_PATH_NOT_FOUND'
  | 'YAML_PATH_NOT_SCALAR'
  | 'YAML_INVALID_OPERATION';

/**
 * Errors thrown by the engine never embed configuration values: messages are
 * built from paths and codes only, so they stay safe to log (NFR-SEC-03).
 */
export class YamlEngineError extends Error {
  readonly code: YamlEngineErrorCode;
  readonly path: ConfigPath | undefined;

  constructor(code: YamlEngineErrorCode, message: string, path?: ConfigPath) {
    super(message);
    this.name = 'YamlEngineError';
    this.code = code;
    this.path = path;
  }
}

export function pathNotFound(path: ConfigPath): YamlEngineError {
  return new YamlEngineError('YAML_PATH_NOT_FOUND', `No node exists at ${formatPath(path)}`, path);
}

export function pathNotScalar(path: ConfigPath): YamlEngineError {
  return new YamlEngineError(
    'YAML_PATH_NOT_SCALAR',
    `Node at ${formatPath(path)} is not a scalar`,
    path,
  );
}
