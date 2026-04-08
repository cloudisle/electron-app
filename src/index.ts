import { Channel, MainChannel, RendererChannel } from './channel';
import { BrowserWindow, IpcMain, IpcRenderer } from 'electron';
import { expose, initialize } from './api';

export interface Channels {
    [key: string]: Channel<unknown> | Channels;
}

export interface Apis {
    [key: string]: object | Apis;
}

export interface AppConfig {
    apis: Apis;
    channels: Channels;
}

export type Configurer<T> = (key: string, value: T) => T;

export interface ConfigureContext {
    configurer: Configurer<unknown>;
    predicate: (o: unknown) => boolean;
}

/**
 * Core application class that wires up APIs and channels for both the main
 * and renderer processes.
 *
 * Use the `app()` factory function rather than calling `App.create()` directly.
 */
export class App<T extends AppConfig> {
    static instance: App<AppConfig> | null = null;

    private initialized = false;
    private exposed = false;

    private constructor(private readonly config: T) {}

    /**
     * Called from the **main process** to:
     * 1. Register IPC handlers for every API method.
     * 2. Replace channel placeholders with `MainChannel` instances.
     * 3. Register a `channelSendEvent` IPC handler so the renderer can push
     *    events into main-process channels.
     *
     * @throws if called more than once.
     */
    public initialize(main: IpcMain, window: BrowserWindow): T {
        if (this.initialized) {
            throw new Error('App already initialized');
        }

        console.debug('Initializing App');

        this.configure('api', this.config.apis, {
            predicate: (o: unknown) => (o as Record<string, unknown>)['__type'] === 'api',
            configurer: (name: string, value: unknown) =>
                initialize(name, value as Record<string, unknown>, { main, window }),
        });

        this.configure('channels', this.config.channels, {
            predicate: (o: unknown) => (o as Record<string, unknown>)['__type'] === 'channel',
            configurer: (name: string) => new MainChannel(name, window),
        });

        main.handle('channelSendEvent', async (_e, name: string, event: unknown) => {
            console.debug(`Handling channelSendEvent for channel ${name} with event:`, event);

            const parts = name.split('.');
            // Skip the first segment ("channels") which is already the root key
            const channel = parts.reduce(
                (obj: Record<string, unknown>, key) => obj[key] as Record<string, unknown>,
                this.config as unknown as Record<string, unknown>,
            );

            if (channel && typeof (channel as Record<string, unknown>)['send'] === 'function') {
                await (channel as unknown as Channel<unknown>).send(event);
            } else {
                return Promise.reject(new Error(`No channel found for name ${name}`));
            }
        });

        this.initialized = true;

        return this.config;
    }

    /**
     * Called from the **preload script** (renderer context) to:
     * 1. Replace API placeholders with proxy objects that call the main process
     *    via `ipcRenderer.invoke`.
     * 2. Replace channel placeholders with `RendererChannel` instances.
     *
     * @throws if called more than once.
     */
    public expose(renderer: IpcRenderer): T {
        if (this.exposed) {
            throw new Error('App already exposed');
        }

        this.configure('api', this.config.apis, {
            predicate: (o: unknown) => (o as Record<string, unknown>)['__type'] === 'api',
            configurer: (name: string, value: unknown) =>
                expose(name, value as Record<string, unknown>, { renderer }),
        });

        this.configure('channels', this.config.channels, {
            predicate: (o: unknown) => (o as Record<string, unknown>)['__type'] === 'channel',
            configurer: (name: string) => {
                const rc = new RendererChannel(name, renderer);
                return {
                    send: (event: unknown) => rc.send(event),
                    listen: (listener: (event: unknown) => Promise<void>) => rc.listen(listener),
                };
            },
        });

        this.exposed = true;

        return this.config;
    }

    /** Returns the configured APIs sub-tree. */
    public get api(): T['apis'] {
        return this.config.apis;
    }

    /** Returns the configured channels sub-tree. */
    public get channels(): T['channels'] {
        return this.config.channels;
    }

    private configure(name: string, data: Record<string, unknown>, context: ConfigureContext) {
        const { configurer, predicate } = context;
        Object.keys(data).forEach((key) => {
            const identifier = `${name}.${key}`;
            const value = data[key];

            if (predicate(value)) {
                data[key] = configurer(identifier, value);
            } else if (value !== null && typeof value === 'object') {
                this.configure(identifier, value as Record<string, unknown>, context);
            } else {
                throw new Error(
                    `Initialization Error. ${identifier} must be an object or record`,
                );
            }
        });
    }

    /**
     * Creates a new `App` instance. Throws if one already exists.
     * Prefer using the `app()` factory which is idempotent.
     */
    public static create<T extends AppConfig>(config: T): App<T> {
        if (App.instance) {
            throw new Error('App instance already exists');
        }

        App.instance = new App(config);

        return App.instance as App<T>;
    }
}

/**
 * Returns the existing `App` singleton or creates a new one.
 *
 * @param config - Application configuration containing `apis` and `channels`.
 */
export function app<T extends AppConfig>(config: T): App<T> {
    if (App.instance) {
        return App.instance as App<T>;
    }

    return App.create(config);
}

export { api } from './api';
export { channel } from './channel';
