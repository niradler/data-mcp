#!/usr/bin/env node

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import pg from "pg";
import { registerTools } from "./tools.js";
import { registerPrompts } from "./prompts.js";
import logger, { createChildLogger } from "./logger.js";

const { Pool } = pg;

// Create an MCP server
const server = new McpServer({
    name: "postgres-mcp",
    version: "1.0.0"
});

class Database {
    currentPool = "default";
    pools = {
        "default": new Pool({
            connectionString: process.env.DATABASE_URL,
            max: 10, // Maximum number of clients in the pool
            idleTimeoutMillis: 30000, // Close idle clients after 30 seconds
            connectionTimeoutMillis: 2000, // Return an error after 2 seconds if connection could not be established
            maxUses: 7500, // Close (and replace) a connection after it has been used 7500 times
        }),
        "dev": new Pool({
            connectionString: process.env.DEV_DATABASE_URL,
            max: 10, // Maximum number of clients in the pool
            idleTimeoutMillis: 30000, // Close idle clients after 30 seconds
            connectionTimeoutMillis: 2000, // Return an error after 2 seconds if connection could not be established
            maxUses: 7500, // Close (and replace) a connection after it has been used 7500 times
        }),
        "prod": new Pool({
            connectionString: process.env.PROD_DATABASE_URL,
            max: 10, // Maximum number of clients in the pool
            idleTimeoutMillis: 30000, // Close idle clients after 30 seconds
            connectionTimeoutMillis: 2000, // Return an error after 2 seconds if connection could not be established
            maxUses: 7500, // Close (and replace) a connection after it has been used 7500 times
        }),
    }
    
    constructor() {
        this.logger = createChildLogger('Database');
        this.logger.info('Database class initialized');
    }

    async setEnvironment(environment) {
        try {
            this.logger.info(`Attempting to set environment to: ${environment}`);
            if (this.pools[environment]) {
                this.currentPool = environment;
                this.logger.info(`Environment set to: ${environment}`);
                await this.healthCheck();
            } else {
                const error = `Environment ${environment} not found`;
                this.logger.error(error);
                throw new Error(error);
            }
        } catch (error) {
            this.logger.error(`Failed to set environment to ${environment}: ${error.message}`);
            throw error;
        }
    }

    async query(query) {
        try {
            this.logger.info(`Executing query on ${this.currentPool} environment`, { query });
            const client = await this.pools[this.currentPool].connect();
            const result = await client.query(query);
            this.logger.info(`Query executed successfully`, { 
                rowCount: result.rowCount,
                environment: this.currentPool 
            });
            return result;
        } catch (error) {
            this.logger.error(`Query execution failed`, { 
                error: error.message,
                query,
                environment: this.currentPool 
            });
            throw error;
        }
    }

    async healthCheck() {
        try {
            this.logger.info(`Performing health check on ${this.currentPool} environment`);
            const client = await this.pools[this.currentPool].connect();
            await client.query('SELECT 1');
            client.release();
            this.logger.info(`Health check passed for ${this.currentPool} environment`);
            return { healthy: true, environment: this.currentPool, message: 'Connection successful' };
        } catch (error) {
            this.logger.error(`Health check failed for ${this.currentPool} environment`, { error: error.message });
            return { 
                healthy: false, 
                environment: this.currentPool, 
                message: 'Connection failed',
                error: error.message 
            };
        }
    }
}
const database = new Database();

logger.info('Starting MCP server initialization');

// Register tools and prompts
registerTools(server, database);
registerPrompts(server);

logger.info('MCP server initialization completed');

// Graceful shutdown handling
process.on('SIGINT', async () => {
    logger.info('Received SIGINT, shutting down gracefully...');
    try {
        await database.pools[database.currentPool].end();
        logger.info('PostgreSQL connection pool closed successfully');
    } catch (error) {
        logger.error('Error closing database pool during shutdown', { error: error.message });
    }
    process.exit(0);
});

process.on('SIGTERM', async () => {
    logger.info('Received SIGTERM, shutting down gracefully...');
    try {
        await database.pools[database.currentPool].end();
        logger.info('PostgreSQL connection pool closed successfully');
    } catch (error) {
        logger.error('Error closing database pool during shutdown', { error: error.message });
    }
    process.exit(0);
});

// Start receiving messages on stdin and sending messages on stdout
logger.info('Starting MCP server transport');
const transport = new StdioServerTransport();
await server.connect(transport);
logger.info('MCP server transport started successfully');