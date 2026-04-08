import { channel, MainChannel, RendererChannel } from './channel';

// Mock BrowserWindow
const mockSend = jest.fn();
const mockWindow = {
    webContents: { send: mockSend },
} as any;

// Mock IpcRenderer
const mockRendererOn = jest.fn();
const mockRendererRemoveListener = jest.fn();
const mockRendererInvoke = jest.fn();
const mockRenderer = {
    on: mockRendererOn,
    removeListener: mockRendererRemoveListener,
    invoke: mockRendererInvoke,
} as any;

beforeEach(() => {
    jest.clearAllMocks();
});

describe('channel()', () => {
    it('returns an object tagged with __type = "channel"', () => {
        const ch = channel<string>();
        expect((ch as any)['__type']).toBe('channel');
    });
});

describe('MainChannel', () => {
    it('send() forwards the event to webContents.send', async () => {
        const ch = new MainChannel<string>('test.channel', mockWindow);
        await ch.send('hello');
        expect(mockSend).toHaveBeenCalledWith('test.channel', 'hello');
    });

    it('send() notifies registered in-process listeners', async () => {
        const ch = new MainChannel<string>('test.channel', mockWindow);
        const listener = jest.fn().mockResolvedValue(undefined);
        ch.listen(listener);
        await ch.send('payload');
        expect(listener).toHaveBeenCalledWith('payload');
    });

    it('listen() returns a handle that removes the listener', async () => {
        const ch = new MainChannel<string>('test.channel', mockWindow);
        const listener = jest.fn().mockResolvedValue(undefined);
        const handle = ch.listen(listener);
        handle(); // remove
        await ch.send('payload');
        expect(listener).not.toHaveBeenCalled();
    });

    it('send() continues after a listener throws', async () => {
        const ch = new MainChannel<string>('test.channel', mockWindow);
        const bad = jest.fn().mockRejectedValue(new Error('boom'));
        const good = jest.fn().mockResolvedValue(undefined);
        ch.listen(bad);
        ch.listen(good);
        await ch.send('payload');
        expect(good).toHaveBeenCalled();
        expect(mockSend).toHaveBeenCalled();
    });
});

describe('RendererChannel', () => {
    it('send() calls ipcRenderer.invoke with channelSendEvent', async () => {
        mockRendererInvoke.mockResolvedValue(undefined);
        const ch = new RendererChannel<string>('test.channel', mockRenderer);
        await ch.send('hello');
        expect(mockRendererInvoke).toHaveBeenCalledWith('channelSendEvent', 'test.channel', 'hello');
    });

    it('listen() registers a renderer listener and returns a removal handle', () => {
        const ch = new RendererChannel<string>('test.channel', mockRenderer);
        const listener = jest.fn();
        const handle = ch.listen(listener);
        expect(mockRendererOn).toHaveBeenCalledWith('test.channel', expect.any(Function));
        handle();
        expect(mockRendererRemoveListener).toHaveBeenCalled();
    });
});
