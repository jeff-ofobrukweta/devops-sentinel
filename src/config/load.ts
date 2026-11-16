import type { SentinelConfig } from '../types.js';
import { errorMessage } from '../util/async.js';
import { ConfigError, type ConfigInput, mergeInputs } from './input.js';
import { configFromArgs, configFromEnv, configFromFile } from './sources.js';
import { validateConfig } from './validate.js';

export type CliRequest =
  | { kind: 'help' }
  | { kind: 'version' }
  | { kind: 'run'; config: SentinelConfig; printConfig: boolean };

export interface LoadOptions {
  argv: string[];
  env: Record<string, string | undefined>;
  readFile: (path: string) => string;
}

/** Precedence, lowest to highest: defaults → config file → environment → CLI flags. */
export function resolveCli({ argv, env, readFile }: LoadOptions): CliRequest {
  const args = configFromArgs(argv);
  if (args.help) return { kind: 'help' };
  if (args.version) return { kind: 'version' };

  const configPath = args.configPath ?? env.SENTINEL_CONFIG;
  let fileInput: ConfigInput = {};
  if (configPath) {
    let text: string;
    try {
      text = readFile(configPath);
    } catch (error) {
      throw new ConfigError([`cannot read config file ${configPath}: ${errorMessage(error)}`]);
    }
    fileInput = configFromFile(text, configPath);
  }

  const config = validateConfig(mergeInputs(fileInput, configFromEnv(env), args.input));
  return { kind: 'run', config, printConfig: args.printConfig };
}
