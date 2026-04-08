import { BrowserWindow, IpcRenderer, IpcRendererEvent } from 'electron';
import { randomUUID } from 'crypto';

export type ChannelListener<T> = (event: T) => Promise<void>;
export type Handle = () => void;

/**
 * A typed, bidirectional event channel between the main and renderer processes.
 */
export interface Channel<T> {
    send(event: T): Promise<void>;
    listen(listener: ChannelListener<T>): Handle;
}

/**
 * Creates a placeholder `Channel` marker object.
 * The framework replaces it with a concrete `MainChannel` or `RendererChannel`
 * during `App.initialize()` / `App.expose()`.
 *
 * @returns A placeholder `Channel<T>` tagged with `__type: "channel"`.
 */
export function channel<T>(): Channel<T> {
    return {
        __type: 'channel',
        send: () => Promise.resolve(),
        listen: () => () => undefined,
    } as unknown as Channel<T>;
}

/**
 * Renderer-side channel implementation.
 * - `send` forwards an event to the main process via `ipcRenderer.invoke`.
 * - `listen` subscribes to events forwarded from the main process.
 */
export class RendererChannel<T> implements Channel<T> {
    constructor(
        private readonly name: string,
        private readonly renderer: IpcRenderer,
    ) {}

    async send(event: T): Promise<void> {
        console.debug(`Sending event to ${this.name}: ${JSON.stringify(event)}`);
        await this.renderer.invoke('channelSendEvent', this.name, event);
    }

    listen(listener: ChannelListener<T>): Handle {
        const handler = async (_e: IpcRendererEvent, data: T) => listener(data);
        this.renderer.on(this.name, handler);
        return () => this.renderer.removeListener(this.name, handler);
    }
}

/**
 * Main-process channel implementation.
 * - `send` notifies all registered in-process listeners and then pushes the
 *   event to the renderer window via `webContents.send`.
 * - `listen` registers an in-process listener and returns a removal handle.
 */
export class MainChannel<T> implements Channel<T> {
    private readonly listeners: Record<string, ChannelListener<T>> = {};

    constructor(
        private readonly name: string,
        private readonly window: BrowserWindow,
    ) {}

    async send(event: T): Promise<void> {
        console.debug(`Sending event to ${this.name}: ${JSON.stringify(event)}`);

        for (const id of Object.keys(this.listeners)) {
            try {
                await this.listeners[id](event);
            } catch (e) {
                console.error('Unhandled error for listener', id, e);
            }
        }

        this.window.webContents.send(this.name, event);
    }

    listen(listener: ChannelListener<T>): Handle {
        const id = randomUUID();
        this.listeners[id] = listener;
        return () => {
            delete this.listeners[id];
        };
    }
}
