import {
  MiddlewareFunction,
  ControllerClass,
  ServiceClass,
  ConfigTypes,
  IRunConfig,
  IHandler,
  IUser,
  ModuleFunction,
  ScopeClass,
  ViewFunction,
  viewStore,
} from '.';

import { clear, error, info, success } from './logger';
import { Api } from './classes';

import { Polling } from './classes/Launch/Polling';
import { Webhook } from './classes/Launch/Webhook';
import { ScopeController } from './classes/Scope/ScopeController';
import { scopeStore } from './classes/Scope/ScopeStore';

// clear console
clear();

export class NestGram {
  scope: ScopeController = new ScopeController();
  handlers: IHandler[] = [];
  info: IUser;

  api: Api = new Api(this.token, this.runConfig.cachePath);
  polling?: Polling;
  webhook?: Webhook;

  /**
   * Creates new bot
   * @param token Token for running bot that you can get in {@link https://t.me/BotFather}
   * @param module Entry module
   * @param config Config for getting updates {@link ConfigTypes}
   * @param runConfig Run config {@link IRunConfig}
   * */
  constructor(
    private readonly token: string,
    private readonly module?: any,
    private readonly config?: ConfigTypes,
    private readonly runConfig: IRunConfig = {
      port: 80,
      runType: 'polling',
      logging: true,
      fileLogging: true,
      fileLoggingLimit: 20,
    },
  ) {
    // log if logging is on
    if (runConfig.logging) info('Bot initialized');

    // setup default values
    if (!runConfig.port) runConfig.port = 80;
    if (!runConfig.runType) runConfig.runType = 'polling';
    if (!runConfig.fileLoggingLimit) runConfig.fileLoggingLimit = 20;
    if (typeof runConfig.logging !== 'boolean') runConfig.logging = true;
    if (typeof runConfig.fileLogging !== 'boolean') runConfig.fileLogging = true;

    // if user set module call entry
    if (module) this.setupEntry(module);
  }

  static async getServices(Module: any): Promise<ServiceClass[]> {
    const modules: ModuleFunction[] = Reflect.getMetadata('modules', Module) || [];
    const compiledModules: any[] = [];

    for (const module of modules) {
      let result: any[] | void;
      let err: any;

      try {
        result = await module();
      } catch (e: any) {
        // @ts-ignore
        result = module();
        err = e;
      }

      if (result) {
        try {
          compiledModules.push(...result);
        } catch (e: any) {
          throw new Error(err);
        }
      }
    }

    let services: ServiceClass[] = Reflect.getMetadata('services', Module);
    services = services.map((Service: any): typeof ServiceClass => {
      return new Service(...compiledModules);
    });

    return services;
  }

  private async setupImports(Module: any): Promise<void> {
    const controllers: ControllerClass[] = Reflect.getMetadata('controllers', Module);
    const services: ServiceClass[] = await NestGram.getServices(Module);

    const scopes: ScopeClass[] = Reflect.getMetadata('scopes', Module);
    if (scopes && scopes.length) scopeStore.importScopes(Module);

    const views: ViewFunction[] = Reflect.getMetadata('views', Module);
    if (views && views.length) viewStore.importViews(Module);

    if (controllers || scopes)
      (controllers || scopes).forEach((Controller: any): void => {
        const controller: (ControllerClass | ScopeClass) & { __proto__: any } = new Controller(
          ...services,
        );

        const globalMiddlewares: MiddlewareFunction[] =
          Reflect.getMetadata('middlewares', Module) || [];

        let methodKeys: (string | symbol)[] = Reflect.ownKeys(controller.__proto__);
        methodKeys = methodKeys.filter((key: string | symbol): boolean => typeof key === 'string');
        methodKeys = methodKeys.filter((key: string): boolean => key !== 'constructor');

        methodKeys.forEach((methodKey: string): void => {
          const middlewares: MiddlewareFunction[] =
            Reflect.getMetadata('middlewares', controller[methodKey]) || [];

          this.handlers.push({
            controller,
            methodKey,
            middlewares: [...globalMiddlewares, ...middlewares],
            ...((scopes || []).includes(Controller)
              ? { scope: controller.constructor.name.replace('Scope', '').toLowerCase() }
              : {}),
          });
        });

        const apiKey: string | undefined = Reflect.getMetadata('getApi', controller, 'api');
        if (apiKey) controller[apiKey] = this.api;
      });
  }

  private setupModule(Module: any): void {
    const imports: any[] | undefined = Reflect.getMetadata('imports', Module); // get imports in module
    if (imports) imports.forEach((ImportModule: any) => this.setupModule(ImportModule)); // import all
    this.setupImports(Module); // setup entry module
  }

  private setupEntry(Module: any): void {
    // setup entry module
    this.setupModule(Module);

    // log that module configured if logging is on
    if (this.runConfig.logging) info('Entry module configured');
  }

  /**
   * Use an API class with a different token
   * @param token Bot token you want to get property class
   * */
  to(token: string): Api {
    return new Api(token, this.runConfig.cachePath);
  }

  /**
   * Starts bot using Long Polling or Webhooks
   * @return bot username
   * */
  async start(): Promise<string> {
    // log that bot starting if logging is on
    if (this.runConfig.logging) info('Starting bot...');

    // return error if user didn't set token
    if (!this.token) throw error(`You can't run bot without token`);

    // fetch bot info
    this.info = await this.api.getMe();

    if (this.runConfig.runType === 'polling') {
      // delete webhook
      await this.api.deleteWebhook(this.runConfig);

      // create polling for handling updates
      this.polling = new Polling(
        this.token,
        this.handlers,
        this.config,
        this.runConfig.logging,
        this.runConfig.fileLogging,
        this.runConfig.fileLoggingLimit,
        this.runConfig.cachePath,
      );

      // start polling
      this.polling.start();
    } else if (this.runConfig.runType === 'webhook') {
      // return an error if the user has not provided a webhook url
      if (!('url' in this.config))
        throw error('If you want to use webhooks, you need to pass webhook url in config');

      // start server and save webhook
      this.webhook = new Webhook(
        this.token,
        this.handlers,
        this.config,
        this.runConfig.logging,
        this.runConfig.fileLogging,
        this.runConfig.fileLoggingLimit,
        this.runConfig.cachePath,
      );
    }

    // log that bot started
    success('Bot started on', `@${this.info.username}`.gray);

    // return bot.username
    return this.info.username;
  }
}
