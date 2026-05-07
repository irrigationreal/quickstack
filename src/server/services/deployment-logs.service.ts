import fsPromises from 'fs/promises';
import fs from 'fs';
import { PathUtils } from '../utils/path.utils';
import { FsUtils } from '../utils/fs.utils';
import { ServiceException } from '@/shared/model/service.exception.model';

class DeploymentLogService {

    async writeLogs(deploymentId: string, logMessage: string, addDate = true, addNewLine = true) {
        try {
            const now = new Date();
            const logFilePath = PathUtils.appDeploymentLogFile(deploymentId);

            const logText = [];
            if (addDate) {
                logText.push(`[${now.toISOString()}]: `);
            }
            logText.push(logMessage);
            if (addNewLine) {
                logText.push('\n');
            }

            await fsPromises.appendFile(logFilePath, logText.join(''), {
                encoding: 'utf-8'
            });

        } catch (ex) {
            console.error(`Error writing logs for deployment ${deploymentId}: ${ex}`);
        }
    }

    async catchErrosAndLog<TReturnType>(deploymentId: string, fn: () => Promise<TReturnType>): Promise<TReturnType> {
        try {
            await FsUtils.createDirIfNotExistsAsync(PathUtils.deploymentLogsPath, true);
            return await fn();
        } catch (ex) {
            console.error(`Error in deployment ${deploymentId}: ${(ex as any)?.message}`, ex);
            this.writeLogs(deploymentId, `[Error]: ${(ex as any)?.message}`);
            throw ex;
        }
    }

    async getAppIdForDeploymentId(deploymentId: string) {
        await FsUtils.createDirIfNotExistsAsync(PathUtils.deploymentLogsPath, true);
        const logFilePath = PathUtils.appDeploymentLogFile(deploymentId);
        if (!await FsUtils.fileExists(logFilePath)) {
            throw new ServiceException(`No deployment log found for deployment ${deploymentId}.`);
        }

        const file = await fsPromises.open(logFilePath, 'r');
        const buffer = Buffer.alloc(4096);
        let bytesRead = 0;
        try {
            const readResult = await file.read(buffer, 0, buffer.length, 0);
            bytesRead = readResult.bytesRead;
        } finally {
            await file.close();
        }

        const logHeader = buffer.subarray(0, bytesRead).toString('utf-8');
        const appId = logHeader.match(/^\s*App:\s*(\S+)\s*$/m)?.[1];
        if (!appId) {
            throw new ServiceException(`Unable to determine the app for deployment ${deploymentId}.`);
        }
        return appId;
    }

    async getLogsStream(deploymentId: string, streamedData: (data: string) => void) {
        await FsUtils.createDirIfNotExistsAsync(PathUtils.deploymentLogsPath, true);
        const logFilePath = PathUtils.appDeploymentLogFile(deploymentId);

        if (!await FsUtils.fileExists(logFilePath)) {
            streamedData(`The log file for deployment ${deploymentId} does not exist.`);
            console.error(`Build Log file ${logFilePath} does not exist`);
            return undefined;
        }

        let bytesRead = 0;

        const readFileFromLastCheckpoint = () => new Promise<void>((resolve) => {
            // Create a new read stream starting from the current end of the file
            const newStream = fs.createReadStream(logFilePath, {
                encoding: 'utf8',
                start: bytesRead,
                flags: 'r'
            });

            newStream.on('data', (chunk: string) => {
                streamedData(chunk);
            });

            // Update the read stream pointer
            newStream.on('end', () => {
                bytesRead += newStream.bytesRead;
                newStream.close();
                resolve();
            });

            newStream.on('error', (err) => {
                console.error(`Error reading log file ${logFilePath}: ${err}`, err);
                newStream.close();
                resolve();
            });
        });

        const readerQueue: Promise<void>[] = [readFileFromLastCheckpoint()];

        // Watch for changes in the file and read new lines when the file is updated
        const watcher = fs.watch(logFilePath, async (eventType) => {
            if (eventType === 'change') {
                // wait for all the previous read operations to finish
                await Promise.all([
                    ...readerQueue
                ]);

                const promise = readFileFromLastCheckpoint();
                readerQueue.push(promise);
            }
        });

        return () => {
            watcher.close();
        }
    }

}

const deploymentLogService = new DeploymentLogService();
export default deploymentLogService;


export const dlog = async (deploymentId: string, data: string, addDate = true, addNewLine = true) => {
    await deploymentLogService.writeLogs(deploymentId, data, addDate, addNewLine);
}
