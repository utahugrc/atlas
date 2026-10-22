import { SecretManagerServiceClient } from '@google-cloud/secret-manager';
import type { ConfigEnv, Plugin } from 'vite';

export interface GoogleSecretsOptions {
  /** Map of environment variable name to Secret Manager secret ID. */
  secrets: Record<string, string>;
  /**
   * Google Cloud project that holds the secrets. Falls back to GOOGLE_CLOUD_PROJECT and then to
   * Google auth project detection (ADC credentials / active gcloud project).
   */
  projectId?: string | ((env: ConfigEnv) => string | undefined);
  /** Modes where secrets must already be in the environment and are never fetched. */
  requireEnvInModes?: string[];
  /** Secret version to read. */
  version?: string;
}

export default function googleSecrets({
  secrets,
  projectId,
  requireEnvInModes = ['production'],
  version = 'latest',
}: GoogleSecretsOptions): Plugin {
  return {
    name: 'ugrc:google-secrets',
    enforce: 'pre',
    apply: (_, env) => env.mode !== 'test' && !env.isPreview && !process.env.VITEST,
    async config(_, env) {
      const missing = Object.entries(secrets).filter(([variable]) => !process.env[variable]);

      if (missing.length === 0) {
        return;
      }

      const names = missing.map(([variable]) => variable).join(', ');

      if (requireEnvInModes.includes(env.mode)) {
        throw new Error(
          `[google-secrets] ${names} must be set in the environment for "${env.mode}" builds; ` +
            'secrets are not fetched from Secret Manager in this mode.',
        );
      }

      const client = new SecretManagerServiceClient();

      try {
        const configured = typeof projectId === 'function' ? projectId(env) : projectId;
        const [project, source] = configured
          ? [configured, 'plugin option']
          : process.env.GOOGLE_CLOUD_PROJECT
            ? [process.env.GOOGLE_CLOUD_PROJECT, 'GOOGLE_CLOUD_PROJECT']
            : [await client.getProjectId().catch(() => undefined), 'Google auth detection'];

        if (!project) {
          throw new Error(
            '[google-secrets] Unable to determine the Google Cloud project. Pass `projectId`, set ' +
              'GOOGLE_CLOUD_PROJECT, or run `gcloud config set project <id>`.',
          );
        }

        const values = await Promise.all(
          missing.map(async ([variable, secretId]) => {
            const name = `projects/${project}/secrets/${secretId}/versions/${version}`;
            const [secretVersion] = await client.accessSecretVersion({ name }).catch((error: unknown) => {
              throw new Error(
                `[google-secrets] Unable to access secret "${secretId}" in project "${project}" (from ${source}).`,
                { cause: error },
              );
            });
            const data = secretVersion.payload?.data;
            const value = data ? Buffer.from(data).toString('utf8') : undefined;

            if (!value) {
              throw new Error(`[google-secrets] Secret "${secretId}" in project "${project}" has no payload.`);
            }

            return [variable, value] as const;
          }),
        );

        for (const [variable, value] of values) {
          process.env[variable] = value;
        }
      } finally {
        await client.close();
      }
    },
  };
}
