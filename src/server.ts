import { createServer } from 'http'
import { parse } from 'url'
import { AsyncLocalStorage } from 'async_hooks'
import { randomUUID } from 'crypto'

if (!(globalThis as any).AsyncLocalStorage) {
    (globalThis as any).AsyncLocalStorage = AsyncLocalStorage;
}

const next = require('next') as typeof import('next').default
import socketIoServer from './socket-io.server'
import initializeWebsocket from './websocket.server'
import quickStackService from './server/services/qs.service'
import { CommandExecutorUtils } from './server/utils/command-executor.utils'
import dataAccess from './server/adapter/db.client'
import { FancyConsoleUtils } from './shared/utils/fancy-console.utils'
import { Constants } from './shared/utils/constants'
import backupService from './server/services/standalone-services/backup.service'
import maintenanceService from './server/services/standalone-services/maintenance.service'
import passwordChangeService from './server/services/standalone-services/password-change.service'
import appLogsService from './server/services/standalone-services/app-logs.service'
import buildWatchService from './server/services/standalone-services/build-watch.service'
import buildPodLogWatchService from './server/services/standalone-services/build-pod-log-watch.service'
import deploymentEventWatchService from './server/services/standalone-services/deployment-event-watch.service'
import { ParamService } from './server/services/param.service'

declare global {
    var quickStackInitKey: string | undefined;
}

// Source: https://nextjs.org/docs/app/building-your-application/configuring/custom-server


const port = parseInt(process.env.PORT || '3000', 10)
const dev = process.env.NODE_ENV !== 'production'

console.log(`NODE_ENV=${process.env.NODE_ENV}`);
if (process.env.NODE_ENV === 'production') {
    console.log(`KUBERNETES_SERVICE_HOST=${process.env.KUBERNETES_SERVICE_HOST}`);
    console.log(`KUBERNETES_SERVICE_PORT=${process.env.KUBERNETES_SERVICE_PORT}`);
}

async function setupQuickStack() {
    console.log('Setting up QuickStack...');
    await quickStackService.initializeQuickStack();
}

async function initializeNextJs() {

    globalThis.quickStackInitKey = randomUUID();
    console.log('Init key generated.');

    FancyConsoleUtils.printQuickStack();
    if (process.env.NODE_ENV === 'production') {
        // update database
        console.log('Running db migration...');
        await CommandExecutorUtils.runCommand('npx prisma migrate deploy');

        if (process.env.K3S_JOIN_TOKEN && process.env.K3S_JOIN_TOKEN.trim()) {
            console.log('Saving K3S_JOIN_TOKEN to database...');
            await dataAccess.client.parameter.upsert({
                where: {
                    name: Constants.K3S_JOIN_TOKEN
                },
                create: {
                    name: Constants.K3S_JOIN_TOKEN,
                    value: process.env.K3S_JOIN_TOKEN
                },
                update: {
                    value: process.env.K3S_JOIN_TOKEN
                }
            });
        }
    }

    await backupService.registerAllBackups();
    maintenanceService.configureMaintenanceCronJobs();
    appLogsService.configureCronJobs();

    const app = next({ dev });
    const handle = app.getRequestHandler();

    app.prepare().then(() => {

        const server = createServer((req, res) => {
            const parsedUrl = parse(req.url!, true)
            handle(req, res, parsedUrl)
        });

        socketIoServer.initialize(server);
        initializeWebsocket(server);
        server.listen(port, () => {
            console.log(
                `> Server listening at http://localhost:${port} as ${dev ? 'development' : process.env.NODE_ENV
                }`
            );
            Promise.all([
                buildWatchService.startWatch(),
                buildPodLogWatchService.startWatch(),
                deploymentEventWatchService.startWatch(),
                dataAccess.client.parameter.upsert({
                    where: { name: ParamService.QS_INSTANCE_ID },
                    create: { name: ParamService.QS_INSTANCE_ID, value: randomUUID() },
                    update: {},
                }),
            ]).then(([, , , instanceId]) => {
                console.log('Initialized services successfully for instanceId:', instanceId.value);
            }).catch((err) => console.error('Failed to initialize watch services; background watch functionality may be unavailable:', err));
        });
    }).catch((err) => console.error(
        'Failed to initialize watch services via init route; background watch functionality may be unavailable:',
        err
    ));
}

if (process.env.NODE_ENV === 'production' && process.env.START_MODE === 'setup') {
    setupQuickStack();
} else if (process.env.NODE_ENV === 'production' && process.env.START_MODE === 'reset-password') {
    passwordChangeService.changeAdminPasswordAndPrintNewPassword();
} else {
    initializeNextJs();
}

