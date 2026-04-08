# @cloudisle/electron-app

An opinionated npm package for scaffolding an Electron JS App. It provides a structured, type-safe framework for defining API classes in the **main process** and exposing them as async IPC proxies to the **renderer process**, along with a typed pub/sub channel system for real-time events.

---

## Table of Contents

- [Installation](#installation)
- [Core Concepts](#core-concepts)
- [Quick Start](#quick-start)
  - [Define your App](#1-define-your-app)
  - [Main Process](#2-main-process)
  - [Preload Script](#3-preload-script)
  - [Renderer](#4-renderer)
- [API Reference](#api-reference)
  - [`api(instance)`](#apiinstance)
  - [`channel<T>()`](#channelt)
  - [`app(config)`](#appconfig)
  - [`App.initialize(main, window)`](#appinitializemain-window)
  - [`App.expose(renderer)`](#appexposerenderer)
- [Channels](#channels)
  - [`MainChannel<T>`](#mainchannel)
  - [`RendererChannel<T>`](#rendererchannel)
- [GitHub Workflow — Auto-Release to npm](#github-workflow--auto-release-to-npm)
- [License](#license)

---

## Installation

```bash
npm install @cloudisle/electron-app
```

`electron` must be installed as a peer dependency in your project:

```bash
npm install electron
```

---

## Core Concepts

| Concept | What it does |
|---|---|
| **`api(instance)`** | Tags a class instance so the framework knows to wire it up via IPC. |
| **`channel<T>()`** | Creates a placeholder for a typed event channel. Replaced at runtime with a `MainChannel` or `RendererChannel`. |
| **`app(config)`** | Creates (or retrieves) the singleton `App` with your APIs and channels. |
| **`App.initialize()`** | Called in the **main process** — registers `ipcMain.handle` handlers for every API method and creates `MainChannel` instances. |
| **`App.expose()`** | Called in the **preload script** — replaces each API with an `ipcRenderer.invoke` proxy and creates `RendererChannel` instances. |

---

## Quick Start

### 1. Define your App

Create a shared `app.ts` file that is imported by both the main and preload entries:

```typescript
// src/app.ts
import { app, api, channel } from '@cloudisle/electron-app';

class GreeterApi {
    greet(name: string): string {
        return `Hello, ${name}!`;
    }
}

class CounterApi {
    private count = 0;

    increment(): number {
        return ++this.count;
    }

    reset(): void {
        this.count = 0;
    }
}

export default app({
    apis: {
        greeter: api(new GreeterApi()),
        counter: api(new CounterApi()),
    },
    channels: {
        notifications: {
            message: channel<{ text: string; level: 'info' | 'warn' | 'error' }>(),
        },
    },
});
```

### 2. Main Process

```typescript
// src/main/index.ts
import { app as electronApp, BrowserWindow, ipcMain } from 'electron';
import App from '../app';

electronApp.whenReady().then(() => {
    const win = new BrowserWindow({
        webPreferences: {
            preload: path.join(__dirname, '../preload/index.js'),
            contextIsolation: true,
            sandbox: false,
        },
    });

    // Wire up all IPC handlers and replace channel placeholders with MainChannels
    App.initialize(ipcMain, win);

    win.loadFile('index.html');
});
```

Once initialized you can use channels from the main process directly:

```typescript
import App from '../app';

// Push a notification to the renderer
await App.channels.notifications.message.send({ text: 'Build complete', level: 'info' });

// Listen for renderer-initiated channel events in-process
const remove = App.channels.notifications.message.listen(async (event) => {
    console.log('Received notification:', event);
});
// Call remove() when you no longer need the listener
```

### 3. Preload Script

```typescript
// src/preload/index.ts
import { contextBridge, ipcRenderer } from 'electron';
import { electronAPI } from '@electron-toolkit/preload';
import App from '../app';

// Replace APIs with IPC proxies and channels with RendererChannels
const config = App.expose(ipcRenderer);

if (process.contextIsolated) {
    contextBridge.exposeInMainWorld('electron', electronAPI);
    contextBridge.exposeInMainWorld('app', {
        platform: process.platform,
        api: config.apis,
        channels: config.channels,
    });
} else {
    (window as any).app = { api: config.apis, channels: config.channels };
}
```

### 4. Renderer

TypeScript typings flow through automatically because `app()` preserves the generic config shape:

```typescript
// src/renderer/index.ts
declare const window: Window & {
    app: {
        api: {
            greeter: { greet(name: string): Promise<string> };
            counter: { increment(): Promise<number>; reset(): Promise<void> };
        };
        channels: {
            notifications: {
                message: {
                    send(event: { text: string; level: string }): Promise<void>;
                    listen(listener: (event: { text: string; level: string }) => Promise<void>): () => void;
                };
            };
        };
    };
};

// Call a main-process API method
const greeting = await window.app.api.greeter.greet('World');
console.log(greeting); // "Hello, World!"

// Subscribe to a channel from the renderer
const unsubscribe = window.app.channels.notifications.message.listen(async (msg) => {
    console.log(`[${msg.level}] ${msg.text}`);
});

// Send an event from the renderer to the main process
await window.app.channels.notifications.message.send({ text: 'Hello from renderer', level: 'info' });
```

---

## API Reference

### `api(instance)`

Tags a class instance as an API endpoint. The framework inspects the class prototype to register IPC handlers for every non-constructor method.

```typescript
import { api } from '@cloudisle/electron-app';

class MyApi {
    doSomething(arg: string): string { return arg.toUpperCase(); }
}

const myApi = api(new MyApi());
```

> The `api()` function is a no-op at runtime beyond adding a `__type` marker — it is safe to call anywhere.

---

### `channel<T>()`

Creates a typed placeholder channel. Must be used inside the `channels` tree of your app config.

```typescript
import { channel } from '@cloudisle/electron-app';

interface LogEntry {
    message: string;
    timestamp: number;
}

const logChannel = channel<LogEntry>();
```

After `App.initialize()` / `App.expose()`, the placeholder is replaced with a fully functional `MainChannel` or `RendererChannel` respectively.

---

### `app(config)`

Returns the existing `App` singleton or creates a new one. Idempotent — safe to call in both the main and preload entry files (which share the same module graph).

```typescript
import { app } from '@cloudisle/electron-app';

const myApp = app({
    apis: { /* ... */ },
    channels: { /* ... */ },
});
```

---

### `App.initialize(main, window)`

Called **once** in the main process after the `BrowserWindow` is created.

- Registers `ipcMain.handle` for every method on every tagged `api` instance.
- If the api object exposes a `setBrowserWindow(window)` method, it is called automatically.
- If the api object exposes an `initialize()` method, it is called automatically.
- Replaces channel placeholders with `MainChannel` instances.
- Registers a `channelSendEvent` IPC handler so the renderer can push events into main-process channels.

```typescript
App.initialize(ipcMain, browserWindow);
```

---

### `App.expose(renderer)`

Called **once** in the preload script.

- Replaces each `api` placeholder with a plain object that proxies calls via `ipcRenderer.invoke`.
- Replaces channel placeholders with `RendererChannel`-backed objects.

```typescript
const config = App.expose(ipcRenderer);
```

---

## Channels

Channels provide a typed pub/sub mechanism across process boundaries.

### `MainChannel<T>`

Lives in the main process. Created automatically by `App.initialize()`.

| Method | Description |
|---|---|
| `send(event: T)` | Notifies all registered in-process listeners, then sends the event to the renderer via `webContents.send`. |
| `listen(listener)` | Registers an in-process listener. Returns a handle; call it to unsubscribe. |

### `RendererChannel<T>`

Lives in the renderer (preload) context. Created automatically by `App.expose()`.

| Method | Description |
|---|---|
| `send(event: T)` | Sends the event to the main process via `ipcRenderer.invoke('channelSendEvent', ...)`. The main process then notifies its listeners and forwards the event back to the renderer. |
| `listen(listener)` | Subscribes to events forwarded by the main process. Returns a handle; call it to unsubscribe. |

---

## GitHub Workflow — Auto-Release to npm

The repository ships with a GitHub Actions workflow (`.github/workflows/release.yml`) that automatically:

1. Runs lint, tests, and build.
2. Bumps the **minor version** in `package.json`.
3. Commits and tags the version bump.
4. Publishes the package to the npm registry.

This workflow triggers on every push to `main`.

### Required Secrets

| Secret | Description |
|---|---|
| `NPM_TOKEN` | A publish-scoped npm access token. Set it in **Settings → Secrets → Actions** of your GitHub repository. |

---

## License

MIT
