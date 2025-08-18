import pino from 'pino';
import fs from 'fs';
import path from 'path';

const logDir = '/Users/nir/Documents/projects/os/data-mcp-js/logs';
const errorLogPath = path.join(logDir, 'error.log');
const combinedLogPath = path.join(logDir, 'combined.log');

if (!fs.existsSync(logDir)) {
    fs.mkdirSync(logDir, { recursive: true });
}

const createLogger = (name = 'data-mcp') => {
    const baseConfig = {
        name,
        level: process.env.LOG_LEVEL || 'info',
        timestamp: pino.stdTimeFunctions.isoTime,
        formatters: {
            level: (label) => ({ level: label }),
            log: (object) => object
        }
    };

    const logger = pino(baseConfig, pino.multistream([
        { stream: pino.transport({ target: 'pino/file', options: { destination: errorLogPath } }), level: 'error' },
        { stream: pino.transport({ target: 'pino/file', options: { destination: combinedLogPath } }), level: 'info' }
    ]));

    return logger;
};

const logger = createLogger();

export const createChildLogger = (name) => {
    return logger.child({ component: name });
};

export default logger; 