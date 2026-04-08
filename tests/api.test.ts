import { api, initialize, expose } from '../src/api';

// Minimal mocks for Electron types
const mockHandle = jest.fn();
const mockInvoke = jest.fn();

const mockMain = { handle: mockHandle } as any;
const mockWindow = {} as any;
const mockRenderer = { invoke: mockInvoke } as any;

class SampleApi {
    greet(name: string): string {
        return `Hello, ${name}!`;
    }

    add(a: number, b: number): number {
        return a + b;
    }
}

beforeEach(() => {
    jest.clearAllMocks();
});

describe('api()', () => {
    it('tags the object with __type = "api"', () => {
        const instance = new SampleApi();
        const tagged = api(instance);
        expect((tagged as any)['__type']).toBe('api');
    });

    it('returns the same object reference', () => {
        const instance = new SampleApi();
        const tagged = api(instance);
        expect(tagged).toBe(instance);
    });
});

describe('initialize()', () => {
    it('registers IPC handlers for each method', () => {
        const instance = api(new SampleApi());
        initialize('myApi', instance as any, { main: mockMain, window: mockWindow });

        expect(mockHandle).toHaveBeenCalledWith(
            'myApi.greet',
            expect.any(Function),
        );
        expect(mockHandle).toHaveBeenCalledWith(
            'myApi.add',
            expect.any(Function),
        );
    });

    it('calls setBrowserWindow on the api if present', () => {
        const setBrowserWindow = jest.fn();
        const instance = api({ ...new SampleApi(), setBrowserWindow }) as any;
        Object.setPrototypeOf(instance, SampleApi.prototype);
        initialize('myApi', instance, { main: mockMain, window: mockWindow });
        expect(setBrowserWindow).toHaveBeenCalledWith(mockWindow);
    });

    it('calls initialize() on the api if present', () => {
        const initFn = jest.fn();
        const instance = api({ ...new SampleApi(), initialize: initFn }) as any;
        Object.setPrototypeOf(instance, SampleApi.prototype);
        initialize('myApi', instance, { main: mockMain, window: mockWindow });
        expect(initFn).toHaveBeenCalled();
    });

    it('IPC handler invokes the underlying method with args', async () => {
        const instance = api(new SampleApi());
        initialize('myApi', instance as any, { main: mockMain, window: mockWindow });

        // Find the handler registered for 'myApi.greet'
        const call = mockHandle.mock.calls.find(([ch]) => ch === 'myApi.greet');
        expect(call).toBeDefined();
        const handler = call![1];
        const result = await handler({} /* event */, 'World');
        expect(result).toBe('Hello, World!');
    });
});

describe('expose()', () => {
    it('returns a plain object with the same method names', () => {
        const instance = api(new SampleApi());
        const proxy = expose('myApi', instance as any, { renderer: mockRenderer });
        expect(typeof proxy['greet']).toBe('function');
        expect(typeof proxy['add']).toBe('function');
    });

    it('each proxy method calls ipcRenderer.invoke with correct channel and args', async () => {
        mockInvoke.mockResolvedValue('Hello, World!');
        const instance = api(new SampleApi());
        const proxy = expose('myApi', instance as any, { renderer: mockRenderer });

        await proxy['greet']('World');
        expect(mockInvoke).toHaveBeenCalledWith('myApi.greet', 'World');
    });
});
