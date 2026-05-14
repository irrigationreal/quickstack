import { parseSseJsonMessages } from './pods-status-polling.service';

const appStatus = {
    appId: 'app-1',
    appName: 'App 1',
    projectId: 'proj-1',
    projectName: 'Project 1',
    replicas: 1,
    readyReplicas: 1,
    deploymentStatus: 'Deployed',
} as const;

describe('parseSseJsonMessages', () => {
    it('buffers incomplete SSE messages until the frame delimiter arrives', () => {
        const payload = `data: ${JSON.stringify([appStatus])}\n\n`;
        const first = parseSseJsonMessages('', payload.slice(0, 20));

        expect(first.messages).toEqual([]);
        expect(first.buffer).toBe(payload.slice(0, 20));

        const second = parseSseJsonMessages(first.buffer, payload.slice(20));
        expect(second.messages).toEqual([[appStatus]]);
        expect(second.buffer).toBe('');
    });

    it('parses multiple SSE messages delivered in one chunk', () => {
        const updatedStatus = { ...appStatus, readyReplicas: 0 };

        const result = parseSseJsonMessages('', `data: ${JSON.stringify([appStatus])}\n\ndata: ${JSON.stringify(updatedStatus)}\n\n`);

        expect(result.messages).toEqual([[appStatus], updatedStatus]);
        expect(result.buffer).toBe('');
    });
});
