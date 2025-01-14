import { IHandler, IUpdate, IWebhookConfig } from '../../types';
import { error } from '../../logger';
import { Handler } from './Handler';
import { Api } from '../Api';

import { IncomingMessage, ServerResponse } from 'http';
import * as http from 'http';

export class Webhook {
  api: Api = new Api(this.token, this.cachePath);
  server: http.Server;

  handler: Handler = new Handler(
    this.token,
    this.handlers,
    this.logging,
    this.fileLogging,
    this.fileLoggingLimit,
    this.cachePath,
  );

  constructor(
    private readonly token: string,
    private readonly handlers: IHandler[],
    private readonly config?: IWebhookConfig | null,
    private readonly logging?: boolean,
    private readonly fileLogging?: boolean,
    private readonly fileLoggingLimit?: number,
    private readonly cachePath?: string,
  ) {
    if (!this.token) throw error(`You can't run bot without token`);
    this.api.setWebhook(this.config);

    this.server = http
      .createServer(async (req: IncomingMessage, res: ServerResponse): Promise<void> => {
        try {
          let data: string = '';
          req.on('data', (chunk: string): any => (data += chunk));

          req.on('end', async (): Promise<any> => {
            try {
              const update: IUpdate = JSON.parse(data.toString());
              await this.handler.handleUpdate(update);
              res.end('ok');
            } catch (e: any) {
              console.error(e);
            }
          });
        } catch (e: any) {
          throw error(e);
        }
      })
      .listen(config.port || 80);
  }
}
