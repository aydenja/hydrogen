import {Flags} from '@oclif/core';
import Command from '@shopify/cli-kit/node/base-command';
import {
  renderConfirmationPrompt,
  renderFatalError,
} from '@shopify/cli-kit/node/ui';
import {
  outputContent,
  outputInfo,
  outputSuccess,
  outputToken,
  outputWarn,
} from '@shopify/cli-kit/node/output';
import {fileExists, writeFile} from '@shopify/cli-kit/node/fs';
import {resolvePath} from '@shopify/cli-kit/node/path';

import {adminRequest, parseGid} from '../../../lib/graphql.js';
import {commonFlags} from '../../../lib/flags.js';
import {getHydrogenShop} from '../../../lib/shop.js';
import {getAdminSession} from '../../../lib/admin-session.js';
import {
  PullVariablesQuery,
  PullVariablesSchema,
} from '../../../lib/graphql/admin/pull-variables.js';
import {getConfig} from '../../../lib/shopify-config.js';
import {hydrogenStorefrontsUrl} from '../../../lib/admin-urls.js';

export default class Pull extends Command {
  static description =
    'Populate your .env with variables from your Hydrogen storefront.';

  static hidden = true;

  static flags = {
    path: commonFlags.path,
    shop: commonFlags.shop,
    force: commonFlags.force,
  };

  async run(): Promise<void> {
    const {flags} = await this.parse(Pull);
    await pullVariables(flags);
  }
}

interface Flags {
  force?: boolean;
  path?: string;
  shop?: string;
}

export async function pullVariables({force, path, shop: flagShop}: Flags) {
  const shop = await getHydrogenShop({path, shop: flagShop});
  const adminSession = await getAdminSession(shop);
  const actualPath = path ?? process.cwd();
  const {storefront: configStorefront} = await getConfig(actualPath);

  if (!configStorefront?.id) {
    renderFatalError({
      name: 'NoLinkedStorefrontError',
      type: 0,
      message: 'No linked Hydrogen storefront.',
      tryMessage:
        outputContent`In order to pull environment variables from a Hydrogen storefront on ${
          adminSession.storeFqdn
        } you must first run ${outputToken.genericShellCommand(
          `npx shopify hydrogen link`,
        )}.`.value,
    });
    return;
  }

  outputInfo(
    `Fetching Preview environment variables from ${configStorefront.title}...`,
  );
  const result: PullVariablesSchema = await adminRequest(
    PullVariablesQuery,
    adminSession,
    {
      id: configStorefront.id,
    },
  );

  const storefront = result.hydrogenStorefront;

  if (!storefront) {
    renderFatalError({
      name: 'NoStorefrontError',
      type: 0,
      message: outputContent`${outputToken.errorText(
        'Could not find Hydrogen storefront.',
      )}`.value,
      tryMessage: outputContent`${configStorefront.title} (ID: ${parseGid(
        configStorefront.id,
      )}) could not be found on ${
        adminSession.storeFqdn
      }. Ensure that the storefront exists and run ${outputToken.genericShellCommand(
        `npx shopify hydrogen link`,
      )} to create a new connection to it.\n\n${outputToken.link(
        'Hydrogen Storefronts Admin',
        hydrogenStorefrontsUrl(adminSession),
      )}`.value,
    });
    return;
  }

  if (!storefront.environmentVariables.length) {
    outputInfo(`No Preview environment variables found.`);
    return;
  }

  const dotEnvPath = resolvePath(actualPath, '.env');

  if ((await fileExists(dotEnvPath)) && !force) {
    const overwrite = await renderConfirmationPrompt({
      message:
        'Warning: .env file already exists. Do you want to overwrite it?',
    });

    if (!overwrite) {
      return;
    }
  }

  let hasSecretVariables = false;
  const contents =
    storefront.environmentVariables
      .map(({key, value, isSecret}) => {
        let line = `${key}="${value}"`;

        if (isSecret) {
          hasSecretVariables = true;
          line =
            `# ${key} is marked as secret and its value is hidden\n` + line;
        }

        return line;
      })
      .join('\n') + '\n';

  if (hasSecretVariables) {
    outputWarn(
      'Your Hydrogen storefront contains environment variables marked as secret \
and their values were not pulled.',
    );
  }

  await writeFile(dotEnvPath, contents);

  outputSuccess('Updated .env');
}
