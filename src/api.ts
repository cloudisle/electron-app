import { BrowserWindow, IpcMain, IpcRenderer } from 'electron';

/**
 * Marks an object as an API instance to be handled by the framework.
 * Returns the object with a `__type` marker so `initialize`/`expose` can detect it.
 *
 * @param o - Any object (typically a class instance) whose methods should be exposed via IPC.
 * @returns The same object, tagged with `__type: "api"`.
 */
export function api<T>(o: T): T {
    (o as Record<string, unknown>)['__type'] = 'api';
    return o;
}

export interface InitContext {
    main: IpcMain;
    window: BrowserWindow;
}

export interface RenderContext {
    renderer: IpcRenderer;
}

/**
 * Registers IPC handlers on the main process for every method of `api`.
 * Optionally calls `setBrowserWindow(window)` and `initialize()` on the api
 * object if those methods exist.
 *
 * @param identifier - Dot-separated namespace prefix used to form IPC channel names.
 * @param api        - The API object whose methods will be handled.
 * @param context    - Provides `IpcMain` and the `BrowserWindow` instance.
 * @returns The original api object.
 */
export function initialize(identifier: string, api: Record<string, unknown>, context: InitContext) {
    const { main, window } = context;

    if (typeof (api as Record<string, unknown>)['setBrowserWindow'] === 'function') {
        (api['setBrowserWindow'] as (w: BrowserWindow) => void)(window);
    }

    if (typeof (api as Record<string, unknown>)['initialize'] === 'function') {
        (api['initialize'] as () => void)();
    }

    Object.getOwnPropertyNames(Object.getPrototypeOf(api))
        .filter((key) => typeof api[key] === 'function' && key !== 'constructor')
        .forEach((method) => {
            main.handle(`${identifier}.${method}`, (_e, ...args) => {
                console.debug(`Handling ${identifier}.${method}: ${JSON.stringify(args)}`);
                return (api[method] as (...a: unknown[]) => unknown)(...args);
            });
        });

    return api;
}

/**
 * Builds a plain object on the renderer side that proxies every method of `api`
 * through `ipcRenderer.invoke`, so the renderer can call main-process methods
 * as if they were local async functions.
 *
 * @param identifier - Dot-separated namespace prefix used to form IPC channel names.
 * @param api        - The API object whose method signatures are mirrored.
 * @param context    - Provides the `IpcRenderer` instance.
 * @returns A plain object with the same method names, each returning a Promise.
 */
export function expose(identifier: string, api: Record<string, unknown>, context: RenderContext) {
    const { renderer } = context;

    const obj: Record<string, (...args: unknown[]) => Promise<unknown>> = {};

    Object.getOwnPropertyNames(Object.getPrototypeOf(api))
        .filter((key) => typeof api[key] === 'function' && key !== 'constructor')
        .forEach((method) => {
            obj[method] = (...args: unknown[]) =>
                renderer.invoke(`${identifier}.${method}`, ...args);
        });

    return obj;
}
