import { z } from "zod";
import { completable } from "@modelcontextprotocol/sdk/server/completable.js";

export const registerPrompts = (server) => {
    server.registerPrompt("dataEngineeringTask",
        {
            title: "Data Engineering Assistant complete task",
            description: `A comprehensive data engineering assistant that helps with database analysis, data profiling, schema exploration, data quality assessment, performance optimization, and AI-powered insights. 
            
This prompt provides structured guidance for common data engineering tasks including:
- Database schema exploration and documentation
- Data profiling and statistical analysis
- Data quality assessment and validation
- Performance analysis and query optimization
- Data lineage and dependency tracking
- Environment management and switching
- Natural language data insights
- AI-generated comprehensive reports

The assistant leverages PostgreSQL queries, data analysis tools, and AI capabilities to provide actionable insights for data engineering workflows.`,
            argsSchema: {
                task: completable(
                    z.string().describe("The specific data engineering task to perform"),
                    (value) => {
                        const tasks = [
                            "profile_table",
                            "analyze_schema", 
                            "check_data_quality",
                            "optimize_query",
                            "explore_dependencies",
                            "get_environment",
                            "set_environment",
                            "data_insights",
                            "generate_report"
                        ];
                        return tasks.filter(task => task.toLowerCase().includes(value.toLowerCase()));
                    }
                ),
                table_name: completable(
                    z.string().optional().describe("The table name to analyze (required for table-specific tasks)"),
                    async (value, context) => {
                        try {
                            if (!value) return [];
                            
                            const schema = context?.arguments?.schema_name || "public";
                            const query = `
                                SELECT table_name 
                                FROM information_schema.tables 
                                WHERE table_schema = '${schema}' 
                                AND table_name ILIKE '%${value}%'
                                ORDER BY table_name 
                                LIMIT 10
                            `;
                            
                            const result = await server.tools.get("query").handler({ query });
                            if (result.content && result.content[0] && result.content[0].text) {
                                const data = JSON.parse(result.content[0].text);
                                return data.map(row => row.table_name);
                            }
                            return [];
                        } catch (error) {
                            return [];
                        }
                    }
                ),
                schema_name: completable(
                    z.string().optional().describe("The schema name (defaults to 'public' if not specified)"),
                    async (value) => {
                        try {
                            if (!value) return ["public", "information_schema", "pg_catalog"];
                            
                            const query = `
                                SELECT schema_name 
                                FROM information_schema.schemata 
                                WHERE schema_name ILIKE '%${value}%'
                                ORDER BY schema_name
                                LIMIT 10
                            `;
                            
                            const result = await server.tools.get("query").handler({ query });
                            if (result.content && result.content[0] && result.content[0].text) {
                                const data = JSON.parse(result.content[0].text);
                                return data.map(row => row.schema_name);
                            }
                            return ["public", "information_schema", "pg_catalog"];
                        } catch (error) {
                            return ["public", "information_schema", "pg_catalog"];
                        }
                    }
                ),
                focus_area: completable(
                    z.string().optional().describe("Specific focus area for the analysis"),
                    (value) => {
                        const areas = [
                            "performance",
                            "quality", 
                            "structure",
                            "relationships",
                            "indexes",
                            "constraints",
                            "data_types",
                            "null_values",
                            "duplicates",
                            "outliers"
                        ];
                        return areas.filter(area => area.toLowerCase().includes(value.toLowerCase()));
                    }
                ),
                output_format: completable(
                    z.string().optional().describe("Desired output format"),
                    (value) => {
                        const formats = [
                            "detailed",
                            "summary", 
                            "actionable",
                            "technical",
                            "visual",
                            "json",
                            "csv"
                        ];
                        return formats.filter(format => format.toLowerCase().includes(value.toLowerCase()));
                    }
                ),
                environment: completable(
                    z.string().optional().describe("Database environment to use"),
                    (value) => {
                        const environments = [
                            "default",
                            "dev",
                            "prod"
                        ];
                        return environments.filter(env => env.toLowerCase().includes(value.toLowerCase()));
                    }
                ),
                question: completable(
                    z.string().optional().describe("Natural language question for data insights"),
                    (value) => {
                        if (!value) return [];
                        return ["What are the top customers by revenue?", "Show me sales trends for the last 30 days", "Which products have the highest return rate?"];
                    }
                ),
                report_type: completable(
                    z.string().optional().describe("Type of report to generate"),
                    (value) => {
                        const types = [
                            "executive",
                            "performance", 
                            "trend",
                            "comparative",
                            "custom"
                        ];
                        return types.filter(type => type.toLowerCase().includes(value.toLowerCase()));
                    }
                )
            }
        },
        async ({ task, table_name, schema_name = "public", focus_area, output_format = "detailed", environment, question, report_type }) => {
            try {
                let analysisQuery = "";
                let analysisCode = "";
                let description = "";

                switch (task) {
                    case "profile_table":
                        if (!table_name) {
                            throw new Error("Table name is required for table profiling");
                        }
                        analysisQuery = `
                            SELECT 
                                column_name,
                                data_type,
                                is_nullable,
                                column_default,
                                character_maximum_length,
                                numeric_precision,
                                numeric_scale
                            FROM information_schema.columns 
                            WHERE table_schema = '${schema_name}' 
                            AND table_name = '${table_name}'
                            ORDER BY ordinal_position
                            LIMIT 100
                        `;
                        analysisCode = `
                            const df = dfd.DataFrame(data);
                            const profile = {
                                total_columns: df.shape[1],
                                data_types: df.groupby("data_type").count().toJSON(),
                                nullable_columns: df.query("is_nullable === 'YES'").shape[0],
                                default_values: df.query("column_default IS NOT NULL").shape[0],
                                text_columns: df.query("data_type LIKE '%char%' OR data_type LIKE '%text%'").shape[0],
                                numeric_columns: df.query("data_type LIKE '%int%' OR data_type LIKE '%decimal%' OR data_type LIKE '%numeric%' OR data_type LIKE '%float%'").shape[0],
                                date_columns: df.query("data_type LIKE '%date%' OR data_type LIKE '%time%'").shape[0]
                            };
                            return profile;
                        `;
                        description = `Table schema profiling for ${schema_name}.${table_name}`;
                        break;

                    case "analyze_schema":
                        analysisQuery = `
                            SELECT 
                                table_schema,
                                table_name,
                                table_type,
                                (SELECT COUNT(*) FROM information_schema.columns c 
                                 WHERE c.table_schema = t.table_schema AND c.table_name = t.table_name) as column_count
                            FROM information_schema.tables t
                            WHERE table_schema = '${schema_name}'
                            ORDER BY table_name
                            LIMIT 100
                        `;
                        analysisCode = `
                            const df = dfd.DataFrame(data);
                            const schema_analysis = {
                                total_tables: df.shape[0],
                                table_types: df.groupby("table_type").count().toJSON(),
                                avg_columns_per_table: df.describe().loc["mean"]["column_count"],
                                max_columns: df.describe().loc["max"]["column_count"],
                                min_columns: df.describe().loc["min"]["column_count"],
                                tables_by_type: df.groupby("table_type").count().toJSON()
                            };
                            return schema_analysis;
                        `;
                        description = `Schema analysis for ${schema_name}`;
                        break;

                    case "check_data_quality":
                        if (!table_name) {
                            throw new Error("Table name is required for data quality assessment");
                        }
                        analysisQuery = `
                            SELECT 
                                column_name,
                                data_type,
                                COUNT(*) as total_rows,
                                COUNT(CASE WHEN column_value IS NULL THEN 1 END) as null_count,
                                COUNT(DISTINCT column_value) as distinct_count,
                                CASE 
                                    WHEN data_type LIKE '%char%' OR data_type LIKE '%text%' THEN
                                        AVG(LENGTH(column_value::text))
                                    WHEN data_type LIKE '%int%' OR data_type LIKE '%decimal%' OR data_type LIKE '%numeric%' OR data_type LIKE '%float%' THEN
                                        AVG(column_value::numeric)
                                    ELSE NULL
                                END as avg_value
                            FROM (
                                SELECT 
                                    c.column_name,
                                    c.data_type,
                                    CASE 
                                        WHEN c.data_type LIKE '%char%' OR c.data_type LIKE '%text%' THEN
                                            CAST(t.* AS text)
                                        ELSE t.*
                                    END as column_value
                                FROM information_schema.columns c
                                CROSS JOIN LATERAL (
                                    SELECT * FROM ${schema_name}.${table_name} LIMIT 1000
                                ) t
                            ) subquery
                            GROUP BY column_name, data_type
                            LIMIT 100
                        `;
                        analysisCode = `
                            const df = dfd.DataFrame(data);
                            const quality_metrics = {
                                total_columns_analyzed: df.shape[0],
                                columns_with_nulls: df.query("null_count > 0").shape[0],
                                high_cardinality_columns: df.query("distinct_count > total_rows * 0.8").shape[0],
                                low_cardinality_columns: df.query("distinct_count < total_rows * 0.1").shape[0],
                                data_completeness: df.apply(row => (row.total_rows - row.null_count) / row.total_rows).mean(),
                                avg_distinct_ratio: df.apply(row => row.distinct_count / row.total_rows).mean()
                            };
                            return quality_metrics;
                        `;
                        description = `Data quality assessment for ${schema_name}.${table_name}`;
                        break;

                    case "optimize_query":
                        analysisQuery = `
                            SELECT 
                                schemaname,
                                tablename,
                                attname,
                                n_distinct,
                                correlation,
                                most_common_vals,
                                most_common_freqs
                            FROM pg_stats 
                            WHERE schemaname = '${schema_name}'
                            ${table_name ? `AND tablename = '${table_name}'` : ''}
                            ORDER BY n_distinct DESC
                            LIMIT 100
                        `;
                        analysisCode = `
                            const df = dfd.DataFrame(data);
                            const optimization_insights = {
                                total_statistics: df.shape[0],
                                high_selectivity_columns: df.query("n_distinct > 100").shape[0],
                                low_selectivity_columns: df.query("n_distinct < 10").shape[0],
                                avg_distinct_values: df.describe().loc["mean"]["n_distinct"],
                                columns_with_correlation: df.query("correlation IS NOT NULL").shape[0],
                                index_candidates: df.query("n_distinct > 50 AND correlation IS NOT NULL").shape[0]
                            };
                            return optimization_insights;
                        `;
                        description = `Query optimization analysis for ${schema_name}${table_name ? '.' + table_name : ''}`;
                        break;

                    case "explore_dependencies":
                        analysisQuery = `
                            SELECT 
                                tc.table_schema,
                                tc.table_name,
                                kcu.column_name,
                                ccu.table_schema AS foreign_table_schema,
                                ccu.table_name AS foreign_table_name,
                                ccu.column_name AS foreign_column_name
                            FROM information_schema.table_constraints AS tc 
                            JOIN information_schema.key_column_usage AS kcu
                                ON tc.constraint_name = kcu.constraint_name
                                AND tc.table_schema = kcu.table_schema
                            JOIN information_schema.constraint_column_usage AS ccu
                                ON ccu.constraint_name = tc.constraint_name
                                AND ccu.table_schema = tc.table_schema
                            WHERE tc.constraint_type = 'FOREIGN KEY'
                            AND tc.table_schema = '${schema_name}'
                            ${table_name ? `AND tc.table_name = '${table_name}'` : ''}
                            ORDER BY tc.table_name, kcu.column_name
                            LIMIT 100
                        `;
                        analysisCode = `
                            const df = dfd.DataFrame(data);
                            const dependency_analysis = {
                                total_foreign_keys: df.shape[0],
                                tables_with_fks: df.groupby("table_name").count().shape[0],
                                tables_referenced_by_fks: df.groupby("foreign_table_name").count().shape[0],
                                most_referenced_tables: df.groupby("foreign_table_name").count().sortValues("count", {ascending: false}).head(5).toJSON(),
                                tables_with_most_fks: df.groupby("table_name").count().sortValues("count", {ascending: false}).head(5).toJSON()
                            };
                            return dependency_analysis;
                        `;
                        description = `Dependency analysis for ${schema_name}${table_name ? '.' + table_name : ''}`;
                        break;

                    case "get_environment":
                        const envResult = await server.tools.get("getEnvironment").handler({});
                        return {
                            messages: [{
                                role: "assistant",
                                content: {
                                    type: "text",
                                    text: `## Environment Information\n\n${envResult.content[0].text}`
                                }
                            }]
                        };

                    case "set_environment":
                        if (!environment) {
                            throw new Error("Environment parameter is required for setting environment");
                        }
                        const setEnvResult = await server.tools.get("setEnvironment").handler({ environment });
                        return {
                            messages: [{
                                role: "assistant",
                                content: {
                                    type: "text",
                                    text: `## Environment Updated\n\n${setEnvResult.content[0].text}`
                                }
                            }]
                        };

                    case "data_insights":
                        if (!question) {
                            throw new Error("Question parameter is required for data insights");
                        }
                        const insightsResult = await server.tools.get("dataInsights").handler({ question });
                        return {
                            messages: [{
                                role: "assistant",
                                content: {
                                    type: "text",
                                    text: `## Data Insights: ${question}\n\n${insightsResult.content[0].text}`
                                }
                            }]
                        };

                    case "generate_report":
                        if (!table_name) {
                            throw new Error("Table name is required for report generation");
                        }
                        if (!report_type) {
                            throw new Error("Report type is required for report generation");
                        }
                        
                        const reportQuery = `SELECT * FROM ${schema_name}.${table_name} LIMIT 1000`;
                        const reportResult = await server.tools.get("dataReport").handler({ 
                            query: reportQuery, 
                            reportType: report_type 
                        });
                        return {
                            messages: [{
                                role: "assistant",
                                content: {
                                    type: "text",
                                    text: `## ${report_type.charAt(0).toUpperCase() + report_type.slice(1)} Report: ${schema_name}.${table_name}\n\n${reportResult.content[0].text}`
                                }
                            }]
                        };

                    default:
                        throw new Error(`Unknown task: ${task}. Supported tasks: profile_table, analyze_schema, check_data_quality, optimize_query, explore_dependencies, get_environment, set_environment, data_insights, generate_report`);
                }

                // Execute the analysis using the existing analyze tool
                const analysisResult = await server.tools.get("analyze").handler({
                    query: analysisQuery,
                    code: analysisCode,
                    limit: 5000
                });

                return {
                    messages: [{
                        role: "assistant",
                        content: {
                            type: "text",
                            text: `## Data Engineering Analysis: ${description}\n\n${analysisResult.content[0].text}`
                        }
                    }]
                };

            } catch (error) {
                return {
                    messages: [{
                        role: "assistant",
                        content: {
                            type: "text",
                            text: `Error in data engineering analysis: ${error.message}`
                        }
                    }]
                };
            }
        }
    );

    server.registerPrompt("dataEngineerExpert",
        {
            title: "Data Engineering Introduction",
            description: `Expert data engineer specializing in PostgreSQL analysis, data profiling, and performance optimization.`,
            argsSchema: {
                expertise_area: completable(
                    z.string().optional().describe("Specific area of expertise to focus on"),
                    (value) => {
                        const areas = [
                            "database_schema",
                            "data_profiling",
                            "performance_optimization",
                            "data_quality",
                            "query_optimization",
                            "index_analysis",
                            "data_modeling"
                        ];
                        return areas.filter(area => area.toLowerCase().includes(value.toLowerCase()));
                    }
                ),
                complexity_level: completable(
                    z.string().optional().describe("Complexity level of the explanation"),
                    (value) => {
                        const levels = [
                            "beginner",
                            "intermediate", 
                            "advanced",
                            "expert"
                        ];
                        return levels.filter(level => level.toLowerCase().includes(value.toLowerCase()));
                    }
                )
            }
        },
        async ({ expertise_area, complexity_level }) => {
            const expertiseText = expertise_area ? ` with focus on ${expertise_area.replace(/_/g, ' ')}` : '';
            const complexityText = complexity_level ? ` (${complexity_level} level)` : '';
            
            return {
                messages: [{
                    role: "assistant",
                    content: {
                        type: "text",
                        text: `👋 Hello! I'm your expert data engineering assistant${expertiseText}${complexityText}. I have deep expertise in PostgreSQL, data modeling, and data quality analysis.

I can help you with comprehensive database analysis, optimization, and data engineering tasks. Here are real-world examples of what I can do:

**🔍 Database Analysis Examples:**

**Schema Exploration:**
\`\`\`sql
-- Get table structure and constraints
SELECT column_name, data_type, is_nullable, column_default
FROM information_schema.columns 
WHERE table_name = 'users' 
ORDER BY ordinal_position;
\`\`\`

**Data Profiling:**
\`\`\`sql
-- Analyze data distribution and quality
SELECT 
    column_name,
    COUNT(*) as total_rows,
    COUNT(CASE WHEN column_value IS NULL THEN 1 END) as null_count,
    COUNT(DISTINCT column_value) as distinct_count,
    AVG(LENGTH(column_value::text)) as avg_length
FROM (
    SELECT 'email' as column_name, email as column_value FROM users LIMIT 1000
    UNION ALL
    SELECT 'name' as column_name, name as column_value FROM users LIMIT 1000
) t
GROUP BY column_name;
\`\`\`

**📊 Data Quality & Profiling Examples:**

**Null Value Analysis with danfojs:**
\`\`\`sql
-- Query to get null value statistics
SELECT 
    column_name,
    COUNT(*) as total_rows,
    COUNT(CASE WHEN column_value IS NULL THEN 1 END) as null_count,
    ROUND(COUNT(CASE WHEN column_value IS NULL THEN 1 END) * 100.0 / COUNT(*), 2) as null_percentage
FROM (
    SELECT 'email' as column_name, email as column_value FROM users
    UNION ALL
    SELECT 'phone' as column_name, phone as column_value FROM users
) t
GROUP BY column_name;
\`\`\`

\`\`\`javascript
// Analyze null values with danfojs
const df = dfd.DataFrame(data);
const nullAnalysis = {
    total_columns: df.shape[0],
    columns_with_nulls: df.query("null_count > 0").shape[0],
    avg_null_percentage: df.describe().loc["mean"]["null_percentage"],
    high_null_columns: df.query("null_percentage > 10").toJSON(),
    data_completeness_score: (100 - df.describe().loc["mean"]["null_percentage"])
};
return nullAnalysis;
\`\`\`

**Data Distribution Analysis with danfojs:**
\`\`\`sql
-- Query to get value distribution
SELECT 
    column_name,
    COUNT(DISTINCT column_value) as distinct_values,
    COUNT(*) as total_rows,
    ROUND(COUNT(DISTINCT column_value) * 100.0 / COUNT(*), 2) as cardinality_percentage
FROM (
    SELECT 'status' as column_name, status as column_value FROM orders
    UNION ALL
    SELECT 'category' as column_name, category as column_value FROM products
) t
GROUP BY column_name;
\`\`\`

\`\`\`javascript
// Analyze distribution patterns with danfojs
const df = dfd.DataFrame(data);
const distributionAnalysis = {
    total_columns: df.shape[0],
    high_cardinality_columns: df.query("cardinality_percentage > 80").shape[0],
    low_cardinality_columns: df.query("cardinality_percentage < 10").shape[0],
    avg_cardinality: df.describe().loc["mean"]["cardinality_percentage"],
    cardinality_distribution: df.groupby("cardinality_percentage").count().toJSON(),
    optimization_opportunities: df.query("cardinality_percentage BETWEEN 10 AND 50").toJSON()
};
return distributionAnalysis;
\`\`\`

**⚡ Performance & Optimization Examples:**

**Index Analysis with danfojs:**
\`\`\`sql
-- Query to get index statistics
SELECT 
    schemaname,
    tablename,
    attname,
    n_distinct,
    correlation,
    most_common_vals,
    most_common_freqs
FROM pg_stats 
WHERE schemaname = 'public' 
AND tablename = 'users'
ORDER BY n_distinct DESC;
\`\`\`

\`\`\`javascript
// Analyze index opportunities with danfojs
const df = dfd.DataFrame(data);
const indexAnalysis = {
    total_columns: df.shape[0],
    high_selectivity_columns: df.query("n_distinct > 100").shape[0],
    low_selectivity_columns: df.query("n_distinct < 10").shape[0],
    avg_distinct_values: df.describe().loc["mean"]["n_distinct"],
    columns_with_correlation: df.query("correlation IS NOT NULL").shape[0],
    index_candidates: df.query("n_distinct > 50 AND correlation IS NOT NULL").toJSON(),
    correlation_analysis: df.describe().loc["mean"]["correlation"]
};
return indexAnalysis;
\`\`\`

**Query Performance Analysis with danfojs:**
\`\`\`sql
-- Query to get performance statistics
SELECT 
    query,
    calls,
    total_time,
    mean_time,
    rows
FROM pg_stat_statements 
WHERE query LIKE '%users%'
ORDER BY total_time DESC
LIMIT 10;
\`\`\`

\`\`\`javascript
// Analyze query performance with danfojs
const df = dfd.DataFrame(data);
const performanceAnalysis = {
    total_queries: df.shape[0],
    avg_execution_time: df.describe().loc["mean"]["mean_time"],
    slowest_queries: df.sortValues("total_time", {ascending: false}).head(3).toJSON(),
    most_frequent_queries: df.sortValues("calls", {ascending: false}).head(3).toJSON(),
    performance_bottlenecks: df.query("mean_time > 100").toJSON(),
    total_execution_time: df.describe().loc["sum"]["total_time"]
};
return performanceAnalysis;
\`\`\`

**🤖 AI-Powered Capabilities:**

**Natural Language Data Insights:**
- Ask questions in plain English: "What are the top customers by revenue?"
- Get intelligent analysis and insights automatically
- No need to write complex SQL queries

**Environment Management:**
- Switch between different database environments (dev, prod, default)
- Manage multiple database connections safely
- Automatic environment reset for security

**AI-Generated Reports:**
- Executive summaries with business insights
- Performance analysis with KPIs and trends
- Comparative analysis with benchmarks
- Custom reports tailored to your needs

**Available Tools I Can Use:**
- **Query Tool**: Execute safe, read-only PostgreSQL queries with automatic limits
- **Analyze Tool**: Process results with advanced statistical analysis using danfojs
- **Environment Management**: Switch between different database environments
- **Data Insights**: Natural language questions with AI-powered analysis
- **Data Reports**: AI-generated comprehensive reports
- **Structured Workflows**: Use predefined data engineering patterns

Just tell me what you'd like to analyze or investigate, and I'll use the appropriate tools to help you! For example:
- "Help me understand our database schema"
- "Check data quality in our main tables"
- "Find performance issues in our queries"
- "What are our top performing products?"
- "Generate an executive report on our sales data"

What would you like to work on today? 🚀`
                    }
                }]
            };
        }
    );
};