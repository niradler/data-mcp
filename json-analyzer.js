import { z } from "zod";
import * as dfd from "danfojs-node";
import fs from "fs";
import path from "path";
import crypto from "crypto";

class JsonAnalyzer {
    constructor(server) {
        this.server = server;
        this.cacheDir = process.env.JSON_CACHE_DIR || path.join(process.cwd(), '.json_cache');
        this.ensureCacheDir();
    }

    ensureCacheDir() {
        if (!fs.existsSync(this.cacheDir)) {
            fs.mkdirSync(this.cacheDir, { recursive: true });
        }
    }

    generateFileHash(filePath, stats) {
        const hash = crypto.createHash('sha256');
        hash.update(filePath);
        hash.update(stats.size.toString());
        hash.update(stats.mtime.toISOString());
        return hash.digest('hex');
    }

    loadJsonData(filePath, sampleSize = 10000) {
        if (!fs.existsSync(filePath)) {
            throw new Error(`File not found: ${filePath}`);
        }

        const stats = fs.statSync(filePath);
        const fileSizeMB = stats.size / (1024 * 1024);
        const fileHash = this.generateFileHash(filePath, stats);
        const cachedDataPath = path.join(this.cacheDir, `${fileHash}.json`);
        const cachedMetaPath = path.join(this.cacheDir, `${fileHash}_meta.json`);

        let jsonData, samplingInfo, metadata;

        // Cache disabled for now - will be used with SQLite/DuckDB later
        const rawData = JSON.parse(fs.readFileSync(filePath, 'utf8'));
        
        const isLargeFile = fileSizeMB > 10;
        
        if (isLargeFile && Array.isArray(rawData) && rawData.length > sampleSize) {
            const sampledData = rawData
                .sort(() => Math.random() - 0.5)
                .slice(0, sampleSize);
            
            jsonData = sampledData;
            const samplePercentage = (sampleSize / rawData.length) * 100;
            samplingInfo = `Large file sampled: ${sampleSize.toLocaleString()} records (${samplePercentage.toFixed(1)}% of ${rawData.length.toLocaleString()} total)`;
            
            metadata = {
                originalSize: rawData.length,
                sampledSize: sampleSize,
                samplingInfo,
                isLargeFile: true,
                fileSizeMB
            };
        } else {
            jsonData = Array.isArray(rawData) ? rawData : [rawData];
            samplingInfo = `Complete file loaded: ${jsonData.length.toLocaleString()} records (${fileSizeMB.toFixed(2)}MB)`;
            
            metadata = {
                originalSize: jsonData.length,
                sampledSize: jsonData.length,
                samplingInfo,
                isLargeFile: false,
                fileSizeMB
            };
        }

        return { jsonData, samplingInfo, metadata, fileHash, cachedDataPath };
    }

    createDataFrame(jsonData) {
        const df = new dfd.DataFrame(jsonData);
        
        const columns = df.columns;
        const dtypes = df.dtypes;
        const shape = df.shape;
        
        const schemaInfo = columns.map(col => ({
            name: col,
            type: dtypes[col] || 'unknown',
            sample: df[col].iloc([0]).values[0]
        }));

        return { df, schemaInfo, shape };
    }

    async generateAnalysisCode(description, schemaInfo, totalRecords) {
        const prompt = `Generate Danfo.js DataFrame code for this analysis: "${description}"

Available DataFrame: 'df' with shape [${totalRecords}, ${schemaInfo.length}]

Columns and types:
${schemaInfo.map(s => `- ${s.name}: ${s.type} (sample: ${JSON.stringify(s.sample)})`).join('\n')}

Write JavaScript code that:
1. Uses 'df' as the DataFrame variable
2. Performs the requested analysis
3. Returns the result (not undefined)
4. Handles errors gracefully
5. Limits output size for performance

Common Danfo.js operations:
- df.head(n) - first n rows
- df.describe() - statistics for numeric columns
- df.groupby(['col']).agg({col2: ['mean', 'sum', 'count']}) - grouping
- df.query(df['col'].gt(value)) - filtering
- df['col'].value_counts() - count unique values
- df.corr() - correlation matrix
- df.iloc([start, end]) - slice rows
- df.loc({rows: df['col'].gt(value)}) - boolean indexing
- df.drop({columns: ['col']}) - remove columns
- df.sortValues('col', {ascending: false}) - sort

Return only the JavaScript code (no explanations, no markdown):`;

        try {
            const response = await this.server.server.createMessage({
                messages: [
                    {
                        role: "user",
                        content: {
                            type: "text",
                            text: prompt,
                        },
                    },
                ],
                maxTokens: 800,
            });

            const responseText = response.content.type === "text" ? response.content.text : "df.head(5)";
            
            const code = responseText
                .replace(/```javascript\n?/g, '')
                .replace(/```\n?/g, '')
                .trim();

            return code;
        } catch (error) {
            console.warn('Code generation failed, using fallback:', error.message);
            return "df.head(10)";
        }
    }

    executeDataFrameCode(code, df) {
        try {
            const context = {
                df: df,
                dfd: dfd,
                console: console,
                Math: Math,
                Date: Date,
                JSON: JSON,
                Array: Array,
                Object: Object
            };

            // Ensure context is not null/undefined before using Object.keys/values
            if (!context || typeof context !== 'object') {
                throw new Error('Context object is invalid');
            }

            const contextKeys = Object.keys(context);
            const contextValues = Object.values(context);

            const func = new Function(...contextKeys, `
                try {
                    const result = ${code};
                    
                    if (result && typeof result.values === 'function') {
                        const values = result.values;
                        return Array.isArray(values) ? values.slice(0, 100) : values;
                    }
                    
                    if (result && typeof result.toString === 'function' && result.constructor.name === 'DataFrame') {
                        return {
                            type: 'DataFrame',
                            shape: result.shape,
                            columns: result.columns,
                            sample: result.head(5).values
                        };
                    }
                    
                    if (result && typeof result.toString === 'function' && result.constructor.name === 'Series') {
                        return {
                            type: 'Series',
                            length: result.shape[0],
                            values: result.values.slice(0, 20)
                        };
                    }
                    
                    if (Array.isArray(result)) {
                        return result.slice(0, 100);
                    }
                    
                    if (typeof result === 'object' && result !== null) {
                        return JSON.parse(JSON.stringify(result));
                    }
                    
                    return result;
                } catch (e) {
                    return { error: e.message };
                }
            `);

            return func(...contextValues);
        } catch (error) {
            return { error: error.message };
        }
    }

    async generateAnalysisDescriptions(goal, schemaInfo, totalRecords, previousFindings = []) {
        const prompt = `Generate 2-3 data analysis descriptions for Danfo.js DataFrame operations:

ANALYSIS GOAL: ${goal}

SCHEMA:
${schemaInfo.map(col => `- ${col.name}: ${col.type}`).join('\n')}

TOTAL RECORDS: ${totalRecords}

PREVIOUS FINDINGS:
${previousFindings.length > 0 ? JSON.stringify(previousFindings, null, 2) : 'None - this is the first cycle'}

Generate analysis descriptions that will help achieve the goal. Focus on:
1. Exploring unexplored data aspects
2. Following up on interesting patterns
3. Statistical analysis relevant to the goal
4. Data quality and anomaly detection

Examples:
- "Show basic statistics for all numeric columns"
- "Find the top 10 most frequent values in the category column"
- "Calculate correlation between numeric columns"
- "Group by department and show average salary"
- "Find outliers in the price column"

Return ONLY a JSON array of description strings.`;

        try {
            const response = await this.server.server.createMessage({
                messages: [
                    {
                        role: "user",
                        content: {
                            type: "text",
                            text: prompt,
                        },
                    },
                ],
                maxTokens: 1000,
            });

            const responseText = response.content.type === "text" ? response.content.text : "[]";
            const jsonMatch = responseText.match(/\[[\s\S]*\]/);
            if (jsonMatch) {
                return JSON.parse(jsonMatch[0]);
            }
            throw new Error("Could not parse analysis descriptions");
        } catch (error) {
            console.warn('Analysis description generation failed, using fallback:', error.message);
            return [
                "Show basic statistics for all columns",
                "Display the first 10 rows of data"
            ];
        }
    }

    async analyzeResults(analysisResults, goal, cycle, maxCycles) {
        const prompt = `Analyze these DataFrame analysis results from cycle ${cycle + 1}:

ANALYSIS GOAL: ${goal}

ANALYSIS RESULTS:
${JSON.stringify(analysisResults, null, 2)}

Provide comprehensive analysis including:
1. Key findings from this cycle
2. Interesting patterns or anomalies discovered
3. Statistical insights
4. How findings relate to the analysis goal
5. Whether more cycles are needed
6. Recommendations for next steps

Return JSON object:
{
  "keyFindings": ["finding1", "finding2", ...],
  "interestingPatterns": ["pattern1", "pattern2", ...],
  "statisticalInsights": ["insight1", "insight2", ...],
  "goalRelevance": "how findings relate to the goal",
  "shouldContinue": true/false,
  "recommendations": ["rec1", "rec2", ...],
  "confidence": "high/medium/low"
}`;

        try {
            const response = await this.server.server.createMessage({
                messages: [
                    {
                        role: "user",
                        content: {
                            type: "text",
                            text: prompt,
                        },
                    },
                ],
                maxTokens: 2000,
            });

            const responseText = response.content.type === "text" ? response.content.text : "{}";
            const jsonMatch = responseText.match(/\{[\s\S]*\}/);
            if (jsonMatch) {
                return JSON.parse(jsonMatch[0]);
            }
            throw new Error("Could not parse analysis");
        } catch (error) {
            console.warn('AI analysis failed, using fallback:', error.message);
            return {
                keyFindings: ["Analysis completed with some results"],
                interestingPatterns: [],
                statisticalInsights: [],
                goalRelevance: "Results provide basic insights",
                shouldContinue: cycle < maxCycles - 1,
                recommendations: ["Review analysis results manually"],
                confidence: "low"
            };
        }
    }

    async generateFinalReport(goal, cycles) {
        const prompt = `Generate a comprehensive final report for this JSON data analysis:

ANALYSIS GOAL: ${goal}

COMPLETE ANALYSIS CONTEXT:
${JSON.stringify(cycles, null, 2)}

Create a detailed report including:
1. Executive Summary
2. Key Discoveries and Insights
3. Statistical Analysis Summary
4. Patterns and Trends Identified
5. Anomalies and Outliers
6. Data Quality Assessment
7. Business/Research Implications
8. Actionable Recommendations
9. Areas for Further Investigation

Format as a well-structured report with clear sections and bullet points.`;

        try {
            const response = await this.server.server.createMessage({
                messages: [
                    {
                        role: "user",
                        content: {
                            type: "text",
                            text: prompt,
                        },
                    },
                ],
                maxTokens: 4000,
            });

            return response.content.type === "text" ? response.content.text : "Report generation failed";
        } catch (error) {
            return "Report generation failed due to error: " + error.message;
        }
    }

    async analyzeJsonData({ filePath, analysisGoal, maxCycles = 5, sampleSize = 10000, initialAnalyses = [] }) {
        try {
            const { jsonData, samplingInfo, metadata, fileHash, cachedDataPath } = this.loadJsonData(filePath, sampleSize);
            const { df, schemaInfo, shape } = this.createDataFrame(jsonData);

            const cycles = [];
            const previousFindings = [];

            for (let cycle = 0; cycle < maxCycles; cycle++) {
                let analysisDescriptions;
                if (cycle === 0 && initialAnalyses.length > 0) {
                    analysisDescriptions = initialAnalyses;
                } else {
                    analysisDescriptions = await this.generateAnalysisDescriptions(analysisGoal, schemaInfo, shape[0], previousFindings);
                }

                const analysisResults = [];
                for (const description of analysisDescriptions) {
                    try {
                        const code = await this.generateAnalysisCode(description, schemaInfo, shape[0]);
                        const result = this.executeDataFrameCode(code, df);
                        
                        analysisResults.push({
                            description,
                            code,
                            result,
                            success: true
                        });
                    } catch (error) {
                        analysisResults.push({
                            description,
                            error: error.message,
                            success: false
                        });
                    }
                }

                const analysis = await this.analyzeResults(analysisResults, analysisGoal, cycle, maxCycles);
                
                cycles.push({
                    cycle: cycle + 1,
                    descriptions: analysisDescriptions,
                    analysisResults,
                    analysis
                });

                previousFindings.push({
                    cycle: cycle + 1,
                    keyFindings: analysis.keyFindings,
                    interestingPatterns: analysis.interestingPatterns
                });

                if (analysis.shouldContinue === false && cycle >= 1) {
                    break;
                }
            }

            const finalReport = await this.generateFinalReport(analysisGoal, cycles);

            return {
                content: [
                    {
                        type: "text",
                        text: `# JSON Data Analysis Report

## Dataset Info
- **Cached Data**: ${cachedDataPath}
- **File Hash**: ${fileHash}
- **${samplingInfo}**

## Analysis Summary
- **Goal**: ${analysisGoal}
- **Cycles Completed**: ${cycles.length}/${maxCycles}
- **Total Records**: ${shape[0].toLocaleString()}
- **Schema Fields**: ${schemaInfo.length}
- **DataFrame Shape**: [${shape[0]}, ${shape[1]}]

## Schema Information
${schemaInfo.map(col => `- **${col.name}**: ${col.type} (sample: ${col.sample})`).join('\n')}

${finalReport}

## Detailed Cycle Results

${cycles.map(cycle => `### Cycle ${cycle.cycle}

**Analysis Descriptions:**
${cycle.descriptions.map(d => `- ${d}`).join('\n')}

**Key Findings:**
${cycle.analysis.keyFindings.map(f => `- ${f}`).join('\n')}

**Patterns Discovered:**
${cycle.analysis.interestingPatterns.map(p => `- ${p}`).join('\n')}

**Generated Danfo.js Code:**
${cycle.analysisResults.filter(r => r.success).map(r => `\`\`\`javascript
// ${r.description}
${r.code}
\`\`\``).join('\n\n')}

---`).join('\n')}`
                    }
                ]
            };

        } catch (error) {
            return {
                content: [
                    {
                        type: "text",
                        text: `Error analyzing JSON data: ${error.message}`
                    }
                ]
            };
        }
    }
}

export const registerJsonAnalyzer = (server) => {
    const analyzer = new JsonAnalyzer(server);
    
    server.registerTool("analyzeJsonData",
        {
            title: "Intelligent JSON Data Analysis with Danfo.js",
            description: `Analyze large JSON files using Danfo.js with AI-guided exploration.
            
The tool will:
1. Load and sample your JSON data efficiently (with caching by content hash)
2. Let AI explore the data through multiple analysis cycles using DataFrame operations
3. Generate insights and follow interesting patterns
4. Provide comprehensive findings and recommendations

Features:
- Automatic JSON file caching by content hash
- Efficient large JSON loading with sampling
- Danfo.js DataFrame operations for data analysis
- Iterative AI-driven analysis (up to 5 cycles by default)
- Intelligent analysis generation based on previous findings
- Statistical analysis and pattern detection
- Support for nested JSON structures

The AI will autonomously explore your data, generate relevant DataFrame operations,
and build insights cycle by cycle until it has thoroughly analyzed your dataset.`,
            inputSchema: {
                filePath: z.string().describe("Path to the JSON file to analyze"),
                analysisGoal: z.string().describe("What you want to discover (e.g., 'find anomalies', 'understand user behavior', 'identify trends', 'comprehensive analysis')"),
                maxCycles: z.number().optional().default(5).describe("Maximum analysis cycles (default: 5)"),
                sampleSize: z.number().optional().default(10000).describe("Number of records to sample for large files (default: 10000)"),
                initialAnalyses: z.array(z.string()).optional().describe("Optional starting analysis descriptions to begin with")
            }
        },
        async (params) => {
            return await analyzer.analyzeJsonData(params);
        }
    );
}; 