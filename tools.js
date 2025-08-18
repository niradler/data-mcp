import { z } from "zod";
import * as dfd from "danfojs-node";
import { createChildLogger } from "./logger.js";

// Security: Only allow SELECT queries for read-only access
const isReadOnlyQuery = (query) => {
    const trimmedQuery = query.trim().toLowerCase();
    return trimmedQuery.startsWith('select') ||
        trimmedQuery.startsWith('with') ||
        trimmedQuery.startsWith('explain');
};

// Check if query has a LIMIT clause for safety
const hasLimitClause = (query) => {
    const trimmedQuery = query.trim().toLowerCase();
    return trimmedQuery.includes('limit');
};

// Enhanced security: Block potentially dangerous code patterns
const isSafeAnalysisCode = (code) => {
    const dangerousPatterns = [
        { pattern: /process\.env/, name: "process.env access" },
        { pattern: /require\(/, name: "require() function" },
        { pattern: /import\s+/, name: "import statements" },
        { pattern: /eval\(/, name: "eval() function" },
        { pattern: /Function\(/, name: "Function constructor" },
        { pattern: /setTimeout\(/, name: "setTimeout() function" },
        { pattern: /setInterval\(/, name: "setInterval() function" },
        { pattern: /global\./, name: "global object access" },
        { pattern: /window\./, name: "window object access" },
        { pattern: /document\./, name: "document object access" },
        { pattern: /fetch\(/, name: "fetch() function" },
        { pattern: /XMLHttpRequest/, name: "XMLHttpRequest" },
        { pattern: /http/, name: "http is not allowed" },
        { pattern: /\.query\(/, name: "query() method calls" },
        { pattern: /\.connect\(/, name: "connect() method calls" },
        { pattern: /\.pool/, name: "pool property access" },
        { pattern: /pg\./, name: "pg module access" },
        { pattern: /postgres/, name: "postgres references" },
        { pattern: /database/, name: "database references" },
        { pattern: /readCSV/, name: "readCSV is not allowed" },
        { pattern: /password/, name: "password is not allowed" },
    ];

    for (const { pattern, name } of dangerousPatterns) {
        if (pattern.test(code)) {
            return { safe: false, blockedPattern: name };
        }
    }

    return { safe: true };
};

export const registerTools = (server, database) => {
    const logger = createChildLogger('Tools');
    logger.info('Registering tools with server');
    server.registerTool("getEnvironment",
        {
            title: "Get Current Environment",
            description: `Get the current database environment. Returns the name of the currently active environment.`,
            inputSchema: {}
        },
        async () => {
            try {
                logger.info('getEnvironment tool called');
                const result = {
                    content: [
                        {
                            type: "text",
                            text: `Current environment: ${database.currentPool}`
                        }
                    ]
                };
                logger.info('getEnvironment tool completed successfully', { environment: database.currentPool });
                return result;
            } catch (error) {
                logger.error('getEnvironment tool failed', { error: error.message });
                return {
                    content: [
                        {
                            type: "text",
                            text: `Error getting environment: ${error.message}`
                        }
                    ]
                };
            }
        }
    );

    server.registerTool("setEnvironment",
        {
            title: "Set Environment",
            description: `Set the environment for the database, we support multiple environments for the same database. 
The default environment is 'default'. 
The dev environment is for development and the prod environment is for production. 
You can use this tool to switch between environments.

Note: The environment will be reset to 'default' after 10 minutes to prevent accidental changes.
`,
            inputSchema: {
                environment: z.string().describe("The environment to set the database to. Example: 'default', 'dev', 'prod'")
            }
        },
        async ({ environment }) => {
            try {
                logger.info('setEnvironment tool called', { environment });
                await database.setEnvironment(environment);
                setTimeout(() => {
                    database.setEnvironment("default").catch(error => {
                        logger.error("Error resetting environment to default", { error: error.message });
                    });
                }, 1000 * 60 * 10);
                logger.info('setEnvironment tool completed successfully', { environment });
                return {
                    content: [
                        {
                            type: "text",
                            text: `Environment set to ${environment}`
                        }
                    ]
                };
            } catch (error) {
                logger.error('setEnvironment tool failed', { environment, error: error.message });
                return {
                    content: [
                        {
                            type: "text",
                            text: `Error setting environment: ${error.message}`
                        }
                    ]
                };
            }
        }
    );

    server.registerTool("query",
        {
            title: "PostgreSQL Query",
            description: `Execute read-only PostgreSQL queries and return results as structured JSON. 
Supports SELECT, WITH, and EXPLAIN statements only for security. 
ALL QUERIES MUST INCLUDE A LIMIT CLAUSE for safety. 
Results are limited to 100 rows by default to prevent memory issues.

Required parameters:
- query: The SQL query to execute (SELECT statements only, MUST include LIMIT clause)

Example: {"query": "SELECT * FROM users WHERE active = true LIMIT 10"}`,
            inputSchema: {
                query: z.string().describe("The SQL query to execute (SELECT statements only). MUST include LIMIT clause. Example: 'SELECT * FROM users WHERE active = true LIMIT 10'"),
                limit: z.number().optional().describe("Maximum number of rows to return (default: 100, max: 5000)")
            }
        },
        async ({ query, limit = 100 }) => {
            try {
                logger.info('query tool called', { query, limit });
                
                if (!query) {
                    const error = "Query parameter is required. Please provide a SQL query with LIMIT clause. Example: 'SELECT * FROM users LIMIT 10'";
                    logger.error('query tool validation failed', { error });
                    throw new Error(error);
                }

                if (!isReadOnlyQuery(query)) {
                    const error = "Only SELECT, WITH, and EXPLAIN queries are allowed for security reasons";
                    logger.error('query tool security check failed', { query, error });
                    throw new Error(error);
                }

                if (!hasLimitClause(query)) {
                    const error = "All queries must include a LIMIT clause for safety reasons";
                    logger.error('query tool limit check failed', { query, error });
                    throw new Error(error);
                }

                if (limit > 5000) {
                    const error = "Limit cannot exceed 5000 rows for performance reasons";
                    logger.error('query tool limit validation failed', { limit, error });
                    throw new Error(error);
                }

                const client = await database.pools[database.currentPool].connect();
                try {
                    const result = await client.query(query);

                    // Handle no results
                    if (!result || !result.rows) {
                        logger.warn('query tool returned no data structure', { query });
                        return {
                            content: [
                                {
                                    type: "text",
                                    text: "Query executed successfully but returned no data structure."
                                }
                            ]
                        };
                    }

                    // Handle empty results
                    if (result.rows.length === 0) {
                        logger.info('query tool returned no rows', { query });
                        return {
                            content: [
                                {
                                    type: "text",
                                    text: `Query executed successfully but returned no rows.\n\nQuery: ${query}\n\nThis usually means:\n- No data matches your WHERE conditions\n- The table is empty\n- The LIMIT clause is too restrictive`
                                }
                            ]
                        };
                    }

                    // Limit results for safety
                    const rows = result.rows.slice(0, limit);
                    const totalRows = result.rows.length;
                    const displayedRows = rows.length;

                    logger.info('query tool completed successfully', { 
                        query, 
                        totalRows, 
                        displayedRows, 
                        limit 
                    });

                    let resultText = `Query executed successfully.\n\n`;
                    resultText += `Query: ${query}\n`;
                    resultText += `Total rows found: ${totalRows}\n`;
                    resultText += `Rows displayed: ${displayedRows}`;
                    
                    if (totalRows > displayedRows) {
                        resultText += ` (limited by max ${limit} rows)`;
                    }
                    
                    resultText += `\n\nResults:\n${JSON.stringify(rows, null, 2)}`;

                    return {
                        content: [
                            {
                                type: "text",
                                text: resultText
                            }
                        ]
                    };
                } finally {
                    client.release();
                }
            } catch (error) {
                logger.error('query tool failed', { 
                    query, 
                    limit, 
                    error: error.message,
                    errorCode: error.code,
                    stack: error.stack 
                });
                
                let errorMessage = `Error executing query: ${error.message}`;
                
                // Provide more specific error messages for common database errors
                if (error.code) {
                    switch (error.code) {
                        case '42P01': // undefined_table
                            errorMessage = `Table not found: ${error.message}\n\nThis usually means:\n- The table name is misspelled\n- The table doesn't exist in the current schema\n- You need to specify the schema name (e.g., 'public.table_name')`;
                            break;
                        case '42703': // undefined_column
                            errorMessage = `Column not found: ${error.message}\n\nThis usually means:\n- The column name is misspelled\n- The column doesn't exist in the table\n- You need to check the table structure`;
                            break;
                        case '42601': // syntax_error
                            errorMessage = `SQL syntax error: ${error.message}\n\nPlease check:\n- SQL syntax is correct\n- All parentheses are properly closed\n- Keywords are spelled correctly`;
                            break;
                        case '23505': // unique_violation
                            errorMessage = `Unique constraint violation: ${error.message}`;
                            break;
                        case '23503': // foreign_key_violation
                            errorMessage = `Foreign key constraint violation: ${error.message}`;
                            break;
                        case '28P01': // invalid_password
                        case '28000': // invalid_authorization_specification
                            errorMessage = `Authentication error: ${error.message}\n\nPlease check your database connection credentials.`;
                            break;
                        case '3D000': // invalid_catalog_name
                            errorMessage = `Database not found: ${error.message}\n\nPlease check the database name in your connection string.`;
                            break;
                        case '42P07': // duplicate_table
                            errorMessage = `Table already exists: ${error.message}`;
                            break;
                        default:
                            errorMessage = `Database error (${error.code}): ${error.message}`;
                    }
                }
                
                // Add query context to the error
                errorMessage += `\n\nQuery: ${query}\n\n ${error.stack}`;
                
                return {
                    content: [
                        {
                            type: "text",
                            text: errorMessage,
                        }
                    ]
                };
            }
        }
    );

    server.registerTool("analyze",
        {
            title: "PostgreSQL Query Analysis",
            description: `Execute a PostgreSQL query and analyze the results using safe JavaScript code. 
ALL QUERIES MUST INCLUDE A LIMIT CLAUSE for safety. 
The analysis code runs in a sandboxed environment with access to the query results and the danfojs library for data manipulation. 
Use the 'data' variable to access the results array and 'dfd' for advanced data operations like filtering, grouping, and statistical analysis. 
Perfect for data aggregation, filtering, transformation, and statistical analysis. 

Usage Examples:
- Basic count: 'return data.length;'
- Basic map: 'return data.map(row => row.name);'
- DataFrame operations: 'return dfd.DataFrame(data).describe();'
- Filtering: 'return dfd.DataFrame(data).query("age > 25");'
- Grouping: 'return dfd.DataFrame(data).groupby("category").sum();'
- Statistical analysis: 'return dfd.DataFrame(data).corr();'

Note: For security reasons, the following code patterns are not allowed: 
- system access (process.env, global)
- code execution (eval, Function, require, import) 
- timers (setTimeout, setInterval)
- network requests (fetch, XMLHttpRequest)
- database operations (query, connect, pool, pg).`,
            inputSchema: {
                query: z.string().describe("The SQL query to execute (SELECT statements only). MUST include LIMIT clause. Example: 'SELECT * FROM sales WHERE date >= CURRENT_DATE - INTERVAL 30 days LIMIT 100'"),
                code: z.string().describe("JavaScript code to analyze the query results. Use 'data' variable to access results array and 'dfd' for data operations. Examples: 'return data.length;' or 'return dfd.DataFrame(data).describe();'"),
                limit: z.number().optional().describe("Maximum number of rows to return (default: 1000, max: 5000)")
            }
        },
        async ({ query, code, limit = 1000 }) => {
            try {
                logger.info('analyze tool called', { query, limit, codeLength: code.length });
                
                if (!isReadOnlyQuery(query)) {
                    const error = "Only SELECT, WITH, and EXPLAIN queries are allowed for security reasons";
                    logger.error('analyze tool security check failed', { query, error });
                    throw new Error(error);
                }

                if (!hasLimitClause(query)) {
                    const error = "All queries must include a LIMIT clause for safety reasons";
                    logger.error('analyze tool limit check failed', { query, error });
                    throw new Error(error);
                }

                if (limit > 5000) {
                    const error = "Limit cannot exceed 5000 rows for performance reasons";
                    logger.error('analyze tool limit validation failed', { limit, error });
                    throw new Error(error);
                }

                const safetyCheck = isSafeAnalysisCode(code);
                if (!safetyCheck.safe) {
                    const error = `Analysis code contains potentially dangerous patterns and is not allowed for security reasons. Blocked pattern: ${safetyCheck.blockedPattern}`;
                    logger.error('analyze tool code safety check failed', { blockedPattern: safetyCheck.blockedPattern, error });
                    throw new Error(error);
                }

                const client = await database.pools[database.currentPool].connect();
                try {
                    const result = await client.query(query);

                    // Handle no results
                    if (!result || !result.rows) {
                        logger.warn('analyze tool returned no data structure', { query });
                        return {
                            content: [
                                {
                                    type: "text",
                                    text: "Query executed successfully but returned no data structure for analysis."
                                }
                            ]
                        };
                    }

                    // Handle empty results
                    if (result.rows.length === 0) {
                        logger.info('analyze tool returned no rows', { query });
                        return {
                            content: [
                                {
                                    type: "text",
                                    text: `Analysis cannot proceed - query returned no rows.\n\nQuery: ${query}\n\nThis usually means:\n- No data matches your WHERE conditions\n- The table is empty\n- The LIMIT clause is too restrictive\n\nPlease modify your query to return data for analysis.`
                                }
                            ]
                        };
                    }

                    const rows = result.rows.slice(0, limit);
                    const totalRows = result.rows.length;
                    const analyzedRows = rows.length;

                    logger.info('analyze tool executing analysis code', { 
                        totalRows, 
                        analyzedRows, 
                        codeLength: code.length 
                    });

                    // Create a safe execution environment for the analysis code
                    // Using Function constructor with limited scope and danfojs access
                    const analysisFunction = new Function('data', 'dfd', `
          "use strict";
          ${code}
        `);

                    // Execute the analysis code with the query results and danfojs library
                    const analysisResult = analysisFunction(rows, dfd);

                    logger.info('analyze tool completed successfully', { 
                        query, 
                        totalRows, 
                        analyzedRows, 
                        resultType: typeof analysisResult 
                    });

                    let resultText = `Analysis completed successfully.\n\n`;
                    resultText += `Query: ${query}\n`;
                    resultText += `Total rows returned: ${totalRows}\n`;
                    resultText += `Rows analyzed: ${analyzedRows}`;
                    
                    if (totalRows > analyzedRows) {
                        resultText += ` (limited by max ${limit} rows)`;
                    }
                    
                    resultText += `\n\nAnalysis result:\n${JSON.stringify(analysisResult, null, 2)}`;

                    return {
                        content: [
                            {
                                type: "text",
                                text: resultText
                            }
                        ]
                    };
                } finally {
                    client.release();
                }
            } catch (error) {
                logger.error('analyze tool failed', { 
                    query, 
                    code, 
                    limit, 
                    error: error.message,
                    errorCode: error.code,
                    stack: error.stack 
                });
                
                let errorMessage = `Error during analysis: ${error.message}`;
                
                // Provide more specific error messages for common database errors
                if (error.code) {
                    switch (error.code) {
                        case '42P01': // undefined_table
                            errorMessage = `Table not found: ${error.message}\n\nThis usually means:\n- The table name is misspelled\n- The table doesn't exist in the current schema\n- You need to specify the schema name (e.g., 'public.table_name')`;
                            break;
                        case '42703': // undefined_column
                            errorMessage = `Column not found: ${error.message}\n\nThis usually means:\n- The column name is misspelled\n- The column doesn't exist in the table\n- You need to check the table structure`;
                            break;
                        case '42601': // syntax_error
                            errorMessage = `SQL syntax error: ${error.message}\n\nPlease check:\n- SQL syntax is correct\n- All parentheses are properly closed\n- Keywords are spelled correctly`;
                            break;
                        case '28P01': // invalid_password
                        case '28000': // invalid_authorization_specification
                            errorMessage = `Authentication error: ${error.message}\n\nPlease check your database connection credentials.`;
                            break;
                        case '3D000': // invalid_catalog_name
                            errorMessage = `Database not found: ${error.message}\n\nPlease check the database name in your connection string.`;
                            break;
                        default:
                            errorMessage = `Database error (${error.code}): ${error.message}`;
                    }
                }
                
                // Add context to the error
                errorMessage += `\n\nQuery: ${query}\nAnalysis code: ${code}`;
                
                return {
                    content: [
                        {
                            type: "text",
                            text: errorMessage
                        }
                    ]
                };
            }
        }
    );



    server.registerTool("dataInsights",
        {
            title: "Natural Language Data Insights",
            description: `Ask questions about your data in natural language and get intelligent answers.
This tool combines SQL querying with AI reasoning to provide insights.

Examples:
- "What are the top 10 customers by revenue?"
- "Show me sales trends for the last 30 days"
- "Which products have the highest return rate?"
- "What's the average order value by customer segment?"

The AI will:
1. Generate appropriate SQL queries
2. Execute the queries safely
3. Analyze the results
4. Provide insights and recommendations`,
            inputSchema: {
                question: z.string().describe("Your question about the data in natural language"),
                limit: z.number().optional().describe("Maximum number of rows to return (default: 1000, max: 5000)")
            }
        },
        async ({ question, limit = 1000 }) => {
            try {
                logger.info('dataInsights tool called', { question, limit });
                
                // First, use AI to generate a safe SQL query
                const queryGenerationPrompt = `Given this question about a database: "${question}"

Generate a safe SQL query that:
1. Only uses SELECT statements (no INSERT, UPDATE, DELETE)
2. Includes a LIMIT clause for safety
3. Uses appropriate table names and column names
4. Is optimized for performance

Return ONLY the SQL query, nothing else.`;

                logger.info('dataInsights tool generating SQL query', { question });
                const queryResponse = await server.server.createMessage({
                    messages: [
                        {
                            role: "user",
                            content: {
                                type: "text",
                                text: queryGenerationPrompt,
                            },
                        },
                    ],
                    maxTokens: 1000,
                });

                const generatedQuery = queryResponse.content.type === "text" ? queryResponse.content.text.trim() : null;

                if (!generatedQuery || !isReadOnlyQuery(generatedQuery)) {
                    const error = "Unable to generate a safe SQL query for your question";
                    logger.error('dataInsights tool failed to generate safe query', { question, generatedQuery, error });
                    throw new Error(error);
                }

                logger.info('dataInsights tool generated query', { generatedQuery });

                // Ensure the query has a LIMIT clause
                const queryWithLimit = generatedQuery.toLowerCase().includes('limit')
                    ? generatedQuery
                    : `${generatedQuery} LIMIT ${limit}`;

                const client = await database.pools[database.currentPool].connect();
                try {
                    const result = await client.query(queryWithLimit);
                    const rows = result.rows.slice(0, limit);

                    logger.info('dataInsights tool executed query', { 
                        queryWithLimit, 
                        rowCount: result.rows.length,
                        limitedRows: rows.length 
                    });

                    // Use AI to analyze the results and answer the original question
                    const analysisPrompt = `Original Question: "${question}"

Query executed: ${queryWithLimit}
Results: ${JSON.stringify(rows, null, 2)}

Please provide a comprehensive answer to the original question based on this data. Include:
1. Direct answer to the question
2. Key insights from the data
3. Relevant statistics and metrics
4. Any notable patterns or trends
5. Business implications

Format your response clearly and professionally.`;

                    logger.info('dataInsights tool generating analysis', { question });
                    const analysisResponse = await server.server.createMessage({
                        messages: [
                            {
                                role: "user",
                                content: {
                                    type: "text",
                                    text: analysisPrompt,
                                },
                            },
                        ],
                        maxTokens: 2000,
                    });

                    logger.info('dataInsights tool completed successfully', { question });
                    return {
                        content: [
                            {
                                type: "text",
                                text: analysisResponse.content.type === "text" ? analysisResponse.content.text : "Unable to generate insights"
                            }
                        ]
                    };
                } finally {
                    client.release();
                }
            } catch (error) {
                logger.error('dataInsights tool failed', { 
                    question, 
                    limit, 
                    error: error.message,
                    stack: error.stack 
                });
                return {
                    content: [
                        {
                            type: "text",
                            text: `Error generating insights: ${error.message}`
                        }
                    ]
                };
            }
        }
    );

    server.registerTool("dataReport",
        {
            title: "Generate Data Report",
            description: `Generate comprehensive reports from your data using AI.
This tool creates professional reports with insights, visualizations descriptions, and recommendations.

Report types:
- Executive Summary: High-level business insights
- Performance Analysis: Metrics and KPIs
- Trend Analysis: Time-based patterns and forecasts
- Comparative Analysis: Benchmarks and comparisons
- Custom: Specify your own report focus`,
            inputSchema: {
                query: z.string().describe("The SQL query to execute (SELECT statements only). MUST include LIMIT clause."),
                reportType: z.enum(["executive", "performance", "trend", "comparative", "custom"]).describe("Type of report to generate"),
                customFocus: z.string().optional().describe("Custom focus area for the report (required if reportType is 'custom')"),
                limit: z.number().optional().describe("Maximum number of rows to return (default: 1000, max: 5000)")
            }
        },
        async ({ query, reportType, customFocus, limit = 1000 }) => {
            try {
                logger.info('dataReport tool called', { query, reportType, customFocus, limit });
                
                if (!isReadOnlyQuery(query)) {
                    const error = "Only SELECT, WITH, and EXPLAIN queries are allowed for security reasons";
                    logger.error('dataReport tool security check failed', { query, error });
                    throw new Error(error);
                }

                if (!hasLimitClause(query)) {
                    const error = "All queries must include a LIMIT clause for safety reasons";
                    logger.error('dataReport tool limit check failed', { query, error });
                    throw new Error(error);
                }

                if (limit > 5000) {
                    const error = "Limit cannot exceed 5000 rows for performance reasons";
                    logger.error('dataReport tool limit validation failed', { limit, error });
                    throw new Error(error);
                }

                const client = await database.pools[database.currentPool].connect();
                try {
                    const result = await client.query(query);
                    const rows = result.rows.slice(0, limit);

                    logger.info('dataReport tool executed query', { 
                        query, 
                        rowCount: result.rows.length,
                        limitedRows: rows.length,
                        reportType 
                    });

                    const reportPrompts = {
                        executive: "Create an executive summary report focusing on high-level business insights, key metrics, and strategic recommendations.",
                        performance: "Create a performance analysis report with detailed metrics, KPIs, benchmarks, and performance trends.",
                        trend: "Create a trend analysis report identifying patterns, seasonal variations, growth trends, and forecasting insights.",
                        comparative: "Create a comparative analysis report with benchmarks, competitive analysis, and relative performance metrics.",
                        custom: `Create a custom report focusing on: ${customFocus}`
                    };

                    const reportPrompt = `Generate a professional ${reportType} report based on this data:

Query: ${query}
Data: ${JSON.stringify(rows, null, 2)}

${reportPrompts[reportType]}

Structure the report with:
1. Executive Summary
2. Key Findings
3. Detailed Analysis
4. Recommendations
5. Next Steps

Use professional business language and include specific data points and insights.`;

                    logger.info('dataReport tool generating report', { reportType, customFocus });
                    const response = await server.server.createMessage({
                        messages: [
                            {
                                role: "user",
                                content: {
                                    type: "text",
                                    text: reportPrompt,
                                },
                            },
                        ],
                        maxTokens: 3000,
                    });

                    logger.info('dataReport tool completed successfully', { reportType });
                    return {
                        content: [
                            {
                                type: "text",
                                text: response.content.type === "text" ? response.content.text : "Unable to generate report"
                            }
                        ]
                    };
                } finally {
                    client.release();
                }
            } catch (error) {
                logger.error('dataReport tool failed', { 
                    query, 
                    reportType, 
                    customFocus, 
                    limit, 
                    error: error.message,
                    stack: error.stack 
                });
                return {
                    content: [
                        {
                            type: "text",
                            text: `Error generating report: ${error.message}`
                        }
                    ]
                };
            }
        }
    );

    server.registerTool("healthCheck",
        {
            title: "Database Health Check",
            description: `Check the health and connectivity of the current database environment.
This tool tests the database connection by executing a simple query and returns detailed health information.

Returns information about:
- Connection status (healthy/unhealthy)
- Current environment
- Error details if connection fails
- Connection pool status`,
            inputSchema: {}
        },
        async () => {
            try {
                logger.info('healthCheck tool called');
                const healthResult = await database.healthCheck();
                
                logger.info('healthCheck tool completed', { 
                    healthy: healthResult.healthy,
                    environment: healthResult.environment,
                    message: healthResult.message 
                });
                
                let resultText = `Database Health Check Results:\n\n`;
                resultText += `Status: ${healthResult.healthy ? '✅ Healthy' : '❌ Unhealthy'}\n`;
                resultText += `Environment: ${healthResult.environment}\n`;
                resultText += `Message: ${healthResult.message}\n`;
                
                if (!healthResult.healthy && healthResult.error) {
                    resultText += `\nError Details:\n${healthResult.error}\n`;
                }
                
                if (healthResult.healthy) {
                    resultText += `\n✅ Database connection is working properly.\n`;
                    resultText += `✅ Connection pool is responsive.\n`;
                    resultText += `✅ Environment '${healthResult.environment}' is active.\n`;
                } else {
                    resultText += `\n❌ Database connection issues detected.\n`;
                    resultText += `❌ Please check your connection string and credentials.\n`;
                    resultText += `❌ Verify the database server is running and accessible.\n`;
                }

                return {
                    content: [
                        {
                            type: "text",
                            text: resultText
                        }
                    ]
                };
            } catch (error) {
                logger.error('healthCheck tool failed', { 
                    error: error.message,
                    stack: error.stack 
                });
                return {
                    content: [
                        {
                            type: "text",
                            text: `Error performing health check: ${error.message}`
                        }
                    ]
                };
            }
        }
    );


};
