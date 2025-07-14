import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import pg from "pg";
import { registerTools } from "./tools.js";
import { registerPrompts } from "./prompts.js";

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

    }

    setEnvironment(environment) {
        if (this.pools[environment]) {
            this.currentPool = environment;
        } else {
            throw new Error(`Environment ${environment} not found`);
        }
    }

    async query(query) {
        const client = await this.pools[this.currentPool].connect();
        const result = await client.query(query);
        return result.rows;
    }
}
const database = new Database();

// Register tools and prompts
registerTools(server, database);
registerPrompts(server);

// Graceful shutdown handling
process.on('SIGINT', async () => {
    console.log('Shutting down PostgreSQL connection pool...');
    await database.pools[database.currentPool].end();
    process.exit(0);
});

process.on('SIGTERM', async () => {
    console.log('Shutting down PostgreSQL connection pool...');
    await database.pools[database.currentPool].end();
    process.exit(0);
});

// Start receiving messages on stdin and sending messages on stdout
const transport = new StdioServerTransport();
await server.connect(transport);