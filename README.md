# Data MCP (Model Context Protocol) Server

A powerful PostgreSQL data engineering assistant built with the Model Context Protocol (MCP). This server provides comprehensive database analysis, data profiling, performance optimization, and AI-powered insights through a secure, read-only interface.

## 🚀 Features

### Core Capabilities
- **Database Schema Exploration**: Analyze table structures, relationships, and constraints
- **Data Profiling**: Statistical analysis of data distribution, quality, and patterns
- **Performance Optimization**: Query analysis, index recommendations, and performance insights
- **Data Quality Assessment**: Null value analysis, duplicate detection, and data completeness
- **Environment Management**: Switch between development, production, and default environments
- **AI-Powered Insights**: Natural language data analysis and intelligent reporting

### Security Features
- **Read-Only Access**: Only SELECT, WITH, and EXPLAIN queries allowed
- **Query Limits**: Automatic LIMIT clause enforcement (max 5000 rows)
- **Sandboxed Analysis**: Safe JavaScript execution environment
- **Environment Reset**: Automatic environment reset after 10 minutes
- **Connection Pooling**: Efficient database connection management

## 📦 Installation

### Prerequisites
- Node.js 18+ 
- PostgreSQL database
- npm

### Setup

1. **Clone the repository**
   ```bash
   git clone <repository-url>
   cd data-mcp-js
   ```

2. **Install dependencies**
   ```bash
   npm install
   ```

3. **Configure environment variables**
   ```bash
   # Required
   export DATABASE_URL="postgresql://username:password@localhost:5432/database"
   
   # Optional (for multi-environment support)
   export DEV_DATABASE_URL="postgresql://username:password@localhost:5432/dev_database"
   export PROD_DATABASE_URL="postgresql://username:password@localhost:5432/prod_database"
   ```

4. **Run the server**
   ```bash
   node index.js
   ```

## 🛠️ Usage

### MCP Integration

This server implements the Model Context Protocol and can be integrated with MCP-compatible clients. The server provides:

#### Tools
- `query`: Execute read-only PostgreSQL queries
- `analyze`: Process query results with advanced statistical analysis
- `getEnvironment`: Check current database environment
- `setEnvironment`: Switch between environments
- `dataInsights`: Natural language data analysis
- `dataReport`: Generate AI-powered reports

#### Prompts
- `dataEngineeringTask`: Comprehensive data engineering workflows
- `dataEngineerExpert`: Expert data engineering guidance

### Example Workflows

#### 1. Database Schema Analysis
```sql
-- Get table structure
SELECT column_name, data_type, is_nullable 
FROM information_schema.columns 
WHERE table_name = 'users' 
ORDER BY ordinal_position 
LIMIT 100;
```

#### 2. Data Quality Assessment
```sql
-- Analyze null values and data distribution
SELECT 
    column_name,
    COUNT(*) as total_rows,
    COUNT(CASE WHEN column_value IS NULL THEN 1 END) as null_count,
    COUNT(DISTINCT column_value) as distinct_count
FROM (
    SELECT 'email' as column_name, email as column_value FROM users LIMIT 1000
) t
GROUP BY column_name
LIMIT 100;
```

#### 3. Performance Analysis
```sql
-- Get index statistics
SELECT 
    schemaname,
    tablename,
    attname,
    n_distinct,
    correlation
FROM pg_stats 
WHERE schemaname = 'public' 
ORDER BY n_distinct DESC 
LIMIT 100;
```

### Advanced Analysis with danfojs

The server includes powerful data analysis capabilities using the danfojs library:

```javascript
// Example analysis code
const df = dfd.DataFrame(data);
const analysis = {
    total_rows: df.shape[0],
    null_analysis: df.isna().sum().toJSON(),
    data_types: df.dtypes,
    summary_stats: df.describe().toJSON(),
    correlation_matrix: df.corr().toJSON()
};
return analysis;
```

## 🔧 Configuration

### Environment Variables

| Variable | Description | Required |
|----------|-------------|----------|
| `DATABASE_URL` | Default database connection string | Yes |
| `DEV_DATABASE_URL` | Development database connection | No |
| `PROD_DATABASE_URL` | Production database connection | No |

### Connection Pool Settings

The server uses connection pooling with the following defaults:
- **Max connections**: 10 per environment
- **Idle timeout**: 30 seconds
- **Connection timeout**: 2 seconds
- **Max uses per connection**: 7500

## 🛡️ Security

### Query Restrictions
- Only `SELECT`, `WITH`, and `EXPLAIN` statements allowed
- All queries must include a `LIMIT` clause
- Maximum result limit: 5000 rows
- Automatic query validation and sanitization

### Code Execution Safety
- Sandboxed JavaScript execution environment
- Blocked dangerous patterns (eval, process.env, etc.)
- Read-only database access
- Automatic environment reset for security

## 📊 Supported Analysis Types

### Data Engineering Tasks
- **profile_table**: Comprehensive table schema and data analysis
- **analyze_schema**: Database schema exploration and documentation
- **check_data_quality**: Data quality assessment and validation
- **optimize_query**: Performance analysis and query optimization
- **explore_dependencies**: Data lineage and relationship analysis
- **get_environment**: Environment information
- **set_environment**: Environment switching
- **data_insights**: Natural language data analysis
- **generate_report**: AI-powered comprehensive reports

### Output Formats
- **detailed**: Comprehensive analysis with full details
- **summary**: High-level overview and key insights
- **actionable**: Focus on recommendations and next steps
- **technical**: Detailed technical specifications
- **visual**: Chart and visualization recommendations
- **json**: Structured JSON output
- **csv**: CSV format for data export

## 🤖 AI-Powered Features

### Natural Language Analysis
Ask questions in plain English:
- "What are the top customers by revenue?"
- "Show me sales trends for the last 30 days"
- "Which products have the highest return rate?"

### Intelligent Reporting
- **Executive Reports**: Business insights and KPIs
- **Performance Reports**: Query optimization recommendations
- **Trend Reports**: Time-series analysis and patterns
- **Comparative Reports**: Benchmark analysis
- **Custom Reports**: Tailored to specific requirements

## 📈 Performance Optimization

### Query Optimization
- Index usage analysis
- Query performance statistics
- Bottleneck identification
- Optimization recommendations

### Data Quality Metrics
- Null value analysis
- Data completeness scores
- Cardinality analysis
- Duplicate detection
- Outlier identification

## 🔄 Environment Management

### Multi-Environment Support
- **default**: Primary database environment
- **dev**: Development environment
- **prod**: Production environment

### Safety Features
- Automatic environment reset after 5 minutes
- Environment validation
- Connection pool isolation

## 📝 Examples

### Basic Table Analysis
```javascript
// Query to get table structure
const query = `
    SELECT column_name, data_type, is_nullable 
    FROM information_schema.columns 
    WHERE table_name = 'users' 
    ORDER BY ordinal_position 
    LIMIT 100
`;

// Analysis code
const df = dfd.DataFrame(data);
const profile = {
    total_columns: df.shape[0],
    data_types: df.groupby("data_type").count().toJSON(),
    nullable_columns: df.query("is_nullable === 'YES'").shape[0]
};
```

### Data Quality Assessment
```javascript
// Query for data quality analysis
const query = `
    SELECT 
        column_name,
        COUNT(*) as total_rows,
        COUNT(CASE WHEN column_value IS NULL THEN 1 END) as null_count,
        COUNT(DISTINCT column_value) as distinct_count
    FROM (
        SELECT 'email' as column_name, email as column_value FROM users LIMIT 1000
    ) t
    GROUP BY column_name
    LIMIT 100
`;

// Analysis code
const df = dfd.DataFrame(data);
const quality_metrics = {
    total_columns_analyzed: df.shape[0],
    columns_with_nulls: df.query("null_count > 0").shape[0],
    data_completeness: df.apply(row => (row.total_rows - row.null_count) / row.total_rows).mean()
};
```

## 🚀 Getting Started

1. **Set up your database connection**
2. **Configure environment variables**
3. **Start the server**
4. **Connect your MCP client**
5. **Start analyzing your data!**

## 📚 Dependencies

- `@modelcontextprotocol/sdk`: MCP server implementation
- `danfojs-node`: Advanced data analysis and manipulation
- `pg`: PostgreSQL client for Node.js
- `zod`: Schema validation

## 🤝 Contributing

1. Fork the repository
2. Create a feature branch
3. Make your changes
4. Add tests if applicable
5. Submit a pull request

## 📄 License

ISC License - see LICENSE file for details

## 🆘 Support

For issues and questions:
1. Check the documentation
2. Review existing issues
3. Create a new issue with detailed information

---

**Built with ❤️ for data engineers and analysts** 
