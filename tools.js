import { z } from "zod";
import * as dfd from "danfojs-node";

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
    server.registerTool("getEnvironment",
        {
            title: "Get Current Environment",
            description: `Get the current database environment. Returns the name of the currently active environment.`,
            inputSchema: {}
        },
        async () => {
            try {
                return {
                    content: [
                        {
                            type: "text",
                            text: `Current environment: ${database.currentPool}`
                        }
                    ]
                };
            } catch (error) {
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
                database.setEnvironment(environment);
                setTimeout(() => {
                    database.setEnvironment("default")
                }, 1000 * 60 * 10);
                return {
                    content: [
                        {
                            type: "text",
                            text: `Environment set to ${environment}`
                        }
                    ]
                };
            } catch (error) {
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
Results are limited to 1000 rows by default to prevent memory issues.`,
            inputSchema: {
                query: z.string().describe("The SQL query to execute (SELECT statements only). MUST include LIMIT clause. Example: 'SELECT * FROM users WHERE active = true LIMIT 10'"),
                limit: z.number().optional().describe("Maximum number of rows to return (default: 1000, max: 5000)")
            }
        },
        async ({ query, limit = 1000 }) => {
            try {
                if (!isReadOnlyQuery(query)) {
                    throw new Error("Only SELECT, WITH, and EXPLAIN queries are allowed for security reasons");
                }

                if (!hasLimitClause(query)) {
                    throw new Error("All queries must include a LIMIT clause for safety reasons");
                }

                if (limit > 5000) {
                    throw new Error("Limit cannot exceed 5000 rows for performance reasons");
                }

                const client = await database.pools[database.currentPool].connect();
                try {
                    const result = await client.query(query);

                    // Limit results for safety
                    const rows = result.rows.slice(0, limit);

                    return {
                        content: [
                            {
                                type: "text",
                                text: `Query executed successfully. Found ${result.rows.length} rows (showing ${rows.length}):\n\n${JSON.stringify(rows, null, 2)}`
                            }
                        ]
                    };
                } finally {
                    client.release();
                }
            } catch (error) {
                return {
                    content: [
                        {
                            type: "text",
                            text: `Error executing query: ${error.message}`
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
                if (!isReadOnlyQuery(query)) {
                    throw new Error("Only SELECT, WITH, and EXPLAIN queries are allowed for security reasons");
                }

                if (!hasLimitClause(query)) {
                    throw new Error("All queries must include a LIMIT clause for safety reasons");
                }

                if (limit > 5000) {
                    throw new Error("Limit cannot exceed 5000 rows for performance reasons");
                }

                const safetyCheck = isSafeAnalysisCode(code);
                if (!safetyCheck.safe) {
                    throw new Error(`Analysis code contains potentially dangerous patterns and is not allowed for security reasons. Blocked pattern: ${safetyCheck.blockedPattern}`);
                }

                const client = await database.pools[database.currentPool].connect();
                try {
                    const result = await client.query(query);
                    const rows = result.rows.slice(0, limit);

                    // Create a safe execution environment for the analysis code
                    // Using Function constructor with limited scope and danfojs access
                    const analysisFunction = new Function('data', 'dfd', `
          "use strict";
          ${code}
        `);

                    // Execute the analysis code with the query results and danfojs library
                    const analysisResult = analysisFunction(rows, dfd);

                    return {
                        content: [
                            {
                                type: "text",
                                text: `Analysis completed successfully.\n\nQuery returned ${result.rows.length} rows (analyzed ${rows.length}).\n\nAnalysis result:\n${JSON.stringify(analysisResult, null, 2)}`
                            }
                        ]
                    };
                } finally {
                    client.release();
                }
            } catch (error) {
                return {
                    content: [
                        {
                            type: "text",
                            text: `Error during analysis: ${error.message}`
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
                // First, use AI to generate a safe SQL query
                const queryGenerationPrompt = `Given this question about a database: "${question}"

Generate a safe SQL query that:
1. Only uses SELECT statements (no INSERT, UPDATE, DELETE)
2. Includes a LIMIT clause for safety
3. Uses appropriate table names and column names
4. Is optimized for performance

Return ONLY the SQL query, nothing else.`;

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
                    throw new Error("Unable to generate a safe SQL query for your question");
                }

                // Ensure the query has a LIMIT clause
                const queryWithLimit = generatedQuery.toLowerCase().includes('limit')
                    ? generatedQuery
                    : `${generatedQuery} LIMIT ${limit}`;

                const client = await database.pools[database.currentPool].connect();
                try {
                    const result = await client.query(queryWithLimit);
                    const rows = result.rows.slice(0, limit);

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
                if (!isReadOnlyQuery(query)) {
                    throw new Error("Only SELECT, WITH, and EXPLAIN queries are allowed for security reasons");
                }

                if (!hasLimitClause(query)) {
                    throw new Error("All queries must include a LIMIT clause for safety reasons");
                }

                if (limit > 5000) {
                    throw new Error("Limit cannot exceed 5000 rows for performance reasons");
                }

                const client = await database.pools[database.currentPool].connect();
                try {
                    const result = await client.query(query);
                    const rows = result.rows.slice(0, limit);

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
};
