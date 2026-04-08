import { App, app, AppConfig } from './index';
import { api } from './api';
import { channel } from './channel';

// Reset singleton between tests
beforeEach(() => {
    App.instance = null;
});

// Minimal mocks
const mockHandle = jest.fn();
const mockInvoke = jest.fn();
const mockSend = jest.fn();
const mockOn = jest.fn();
const mockRemoveListener = jest.fn();

const mockMain = { handle: mockHandle } as any;
const mockWindow = { webContents: { send: mockSend } } as any;
const mockRenderer = {
    invoke: mockInvoke,
    on: mockOn,
    removeListener: mockRemoveListener,
} as any;

class CounterApi {
    private count = 0;
    increment(): number {
        return ++this.count;
    }
    reset(): void {
        this.count = 0;
    }
}

function makeConfig(): AppConfig {
    return {
        apis: {
            counter: api(new CounterApi()),
        },
        channels: {
            events: {
                tick: channel<number>(),
            },
        },
    };
}

describe('app() factory', () => {
    it('creates and returns an App instance', () => {
        const instance = app(makeConfig());
        expect(instance).toBeInstanceOf(App);
    });

    it('returns the same singleton on subsequent calls', () => {
        const first = app(makeConfig());
        const second = app(makeConfig());
        expect(first).toBe(second);
    });
});

describe('App.initialize()', () => {
    it('registers IPC handlers for API methods', () => {
        const a = app(makeConfig());
        a.initialize(mockMain, mockWindow);
        const channels = mockHandle.mock.calls.map(([ch]) => ch);
        expect(channels).toContain('api.counter.increment');
        expect(channels).toContain('api.counter.reset');
    });

    it('registers channelSendEvent handler', () => {
        const a = app(makeConfig());
        a.initialize(mockMain, mockWindow);
        const channels = mockHandle.mock.calls.map(([ch]) => ch);
        expect(channels).toContain('channelSendEvent');
    });

    it('throws if initialized twice', () => {
        const a = app(makeConfig());
        a.initialize(mockMain, mockWindow);
        expect(() => a.initialize(mockMain, mockWindow)).toThrow('App already initialized');
    });

    it('replaces channel placeholders with MainChannel instances', () => {
        const cfg = makeConfig();
        const a = app(cfg);
        a.initialize(mockMain, mockWindow);
        const tick = (cfg.channels as any).events.tick;
        expect(typeof tick.send).toBe('function');
        expect(typeof tick.listen).toBe('function');
    });
});

describe('App.expose()', () => {
    it('replaces API placeholders with proxy objects', () => {
        const cfg = makeConfig();
        const a = app(cfg);
        a.expose(mockRenderer);
        const counter = (cfg.apis as any).counter;
        expect(typeof counter.increment).toBe('function');
    });

    it('throws if exposed twice', () => {
        const a = app(makeConfig());
        a.expose(mockRenderer);
        expect(() => a.expose(mockRenderer)).toThrow('App already exposed');
    });

    it('replaces channel placeholders with RendererChannel-backed objects', () => {
        const cfg = makeConfig();
        const a = app(cfg);
        a.expose(mockRenderer);
        const tick = (cfg.channels as any).events.tick;
        expect(typeof tick.send).toBe('function');
        expect(typeof tick.listen).toBe('function');
    });
});

describe('App.create()', () => {
    it('throws if called when an instance already exists', () => {
        App.create(makeConfig());
        expect(() => App.create(makeConfig())).toThrow('App instance already exists');
    });
});

describe('App getters', () => {
    it('api getter returns the apis sub-tree', () => {
        const cfg = makeConfig();
        const a = app(cfg);
        expect(a.api).toBe(cfg.apis);
    });

    it('channels getter returns the channels sub-tree', () => {
        const cfg = makeConfig();
        const a = app(cfg);
        expect(a.channels).toBe(cfg.channels);
    });
});
