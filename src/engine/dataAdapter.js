/**
 * Central parser and adaptor for database files (SQL, JSON, CSV).
 * Normalizes all inputs into tables and rows, and distributes
 * the data to seed various engine subsystems.
 */

export class DataAdapter {
  constructor() {
    this.normalizedData = {
      tables: {}
    };
  }

  /**
   * Detects the file format based on extension or signature.
   */
  detectFormat(fileName, content) {
    const ext = fileName.split('.').pop().toLowerCase();
    if (ext === 'sql') return 'sql';
    if (ext === 'json') return 'json';
    if (ext === 'csv') return 'csv';

    // Fallback detection by content signature
    const cleanContent = content.trim();
    if (cleanContent.startsWith('[') || cleanContent.startsWith('{')) {
      return 'json';
    }
    if (cleanContent.toUpperCase().includes('INSERT INTO') || cleanContent.toUpperCase().includes('CREATE TABLE')) {
      return 'sql';
    }
    if (cleanContent.split('\n')[0].includes(',')) {
      return 'csv';
    }
    return 'unknown';
  }

  /**
   * Parses SQL file content (handles CREATE TABLE and INSERT INTO).
   */
  parseSQL(content) {
    const tables = {};
    // Normalize lines, strip comments
    const lines = content
      .split('\n')
      .map(line => line.replace(/--.*$/, '').trim())
      .filter(line => line.length > 0);
    
    const fullSql = lines.join(' ');
    
    // 1. Parse CREATE TABLE statements: CREATE TABLE name ( col type, ... )
    const createTableRegex = /CREATE\s+TABLE\s+(\w+)\s*\(([^)]+)\)/gi;
    let match;
    while ((match = createTableRegex.exec(fullSql)) !== null) {
      const tableName = match[1];
      const colsDef = match[2];
      const columns = colsDef.split(',').map(c => {
        const parts = c.trim().split(/\s+/);
        return parts[0].replace(/[`"]/g, ''); // strip backticks
      }).filter(name => !['PRIMARY', 'KEY', 'UNIQUE', 'FOREIGN', 'CONSTRAINT'].includes(name.toUpperCase()));

      tables[tableName] = {
        columns,
        rows: []
      };
    }

    // 2. Parse INSERT INTO statements
    // Matches: INSERT INTO table (c1, c2) VALUES (v1, v2), (v3, v4)
    // Or: INSERT INTO table VALUES (v1, v2)
    const insertRegex = /INSERT\s+INTO\s+(\w+)\s*(?:\(([^)]+)\))?\s*VALUES\s*(.+?)(?:;|$)/gi;
    let insertMatch;
    
    // We parse value tuples: e.g., (1, 'Alice', 24), (2, 'Bob', 30)
    while ((insertMatch = insertRegex.exec(fullSql)) !== null) {
      const tableName = insertMatch[1];
      const colListStr = insertMatch[2];
      const valuesBlock = insertMatch[3];
      
      // If table wasn't created via CREATE TABLE, create it dynamically
      if (!tables[tableName]) {
        tables[tableName] = {
          columns: [],
          rows: []
        };
      }

      // Parse columns if specified
      let specifiedCols = [];
      if (colListStr) {
        specifiedCols = colListStr.split(',').map(c => c.trim().replace(/[`"]/g, ''));
      }

      // Split multiple tuples: (v1, v2), (v3, v4)
      // Be careful about nested commas in strings, we can match tuples by split of "),(" or regex
      const tupleRegex = /\(([^)]+)\)/g;
      let tupleMatch;
      while ((tupleMatch = tupleRegex.exec(valuesBlock)) !== null) {
        const valuesStr = tupleMatch[1];
        // Parse individual values split by comma, respecting quoted strings
        const values = this.splitCSVLine(valuesStr).map(v => {
          v = v.trim();
          if ((v.startsWith("'") && v.endsWith("'")) || (v.startsWith('"') && v.endsWith('"'))) {
            return v.substring(1, v.length - 1);
          }
          if (v.toLowerCase() === 'null') return null;
          if (!isNaN(v) && v !== '') return Number(v);
          return v;
        });

        // If table has no columns defined yet, create columns based on count: col_1, col_2...
        if (tables[tableName].columns.length === 0) {
          if (specifiedCols.length > 0) {
            tables[tableName].columns = specifiedCols;
          } else {
            tables[tableName].columns = values.map((_, i) => `col_${i + 1}`);
          }
        }

        const columns = tables[tableName].columns;
        const row = {};
        columns.forEach((col, idx) => {
          row[col] = values[idx] !== undefined ? values[idx] : null;
        });
        
        tables[tableName].rows.push(row);
      }
    }

    return tables;
  }

  /**
   * Parses JSON file content.
   */
  parseJSON(content, defaultTableName = 'json_data') {
    const data = JSON.parse(content);
    const tables = {};

    if (Array.isArray(data)) {
      // It's a single table
      tables[defaultTableName] = this.normalizeJsonArray(data);
    } else if (typeof data === 'object' && data !== null) {
      // Check if it's database dump format { tableName: [rows], ... }
      let hasArrays = false;
      for (const [key, value] of Object.entries(data)) {
        if (Array.isArray(value)) {
          tables[key] = this.normalizeJsonArray(value);
          hasArrays = true;
        }
      }
      if (!hasArrays) {
        // It's a single record/object, wrap in array
        tables[defaultTableName] = this.normalizeJsonArray([data]);
      }
    } else {
      throw new Error("Invalid JSON structure: expected array or key-value arrays.");
    }

    return tables;
  }

  /**
   * Helper to normalize an array of JSON objects.
   */
  normalizeJsonArray(arr) {
    if (arr.length === 0) {
      return { columns: [], rows: [] };
    }
    // Collect all unique keys from all objects
    const colsSet = new Set();
    arr.forEach(obj => {
      if (typeof obj === 'object' && obj !== null) {
        Object.keys(obj).forEach(k => colsSet.add(k));
      }
    });
    const columns = Array.from(colsSet);
    const rows = arr.map(obj => {
      const row = {};
      columns.forEach(col => {
        row[col] = obj[col] !== undefined ? obj[col] : null;
      });
      return row;
    });
    return { columns, rows };
  }

  /**
   * Parses CSV file content.
   */
  parseCSV(content, tableName = 'csv_data') {
    const lines = content.split(/\r?\n/).filter(l => l.trim().length > 0);
    if (lines.length === 0) {
      return { [tableName]: { columns: [], rows: [] } };
    }

    const columns = this.splitCSVLine(lines[0]).map(c => c.trim().replace(/^["']|["']$/g, ''));
    const rows = [];

    for (let i = 1; i < lines.length; i++) {
      const vals = this.splitCSVLine(lines[i]).map(v => {
        v = v.trim();
        if ((v.startsWith("'") && v.endsWith("'")) || (v.startsWith('"') && v.endsWith('"'))) {
          v = v.substring(1, v.length - 1);
        }
        if (!isNaN(v) && v !== '') return Number(v);
        return v;
      });

      const row = {};
      columns.forEach((col, idx) => {
        row[col] = vals[idx] !== undefined ? vals[idx] : null;
      });
      rows.push(row);
    }

    return {
      [tableName]: { columns, rows }
    };
  }

  /**
   * CSV line splitter supporting quoted comma escaping
   */
  splitCSVLine(line) {
    const result = [];
    let curVal = '';
    let inQuotes = false;
    
    for (let i = 0; i < line.length; i++) {
      const char = line[i];
      if (char === '"' || char === "'") {
        inQuotes = !inQuotes;
      } else if (char === ',' && !inQuotes) {
        result.push(curVal);
        curVal = '';
      } else {
        curVal += char;
      }
    }
    result.push(curVal);
    return result;
  }

  /**
   * Parses database files and sets normalized tables.
   */
  parseFile(fileName, content) {
    const format = this.detectFormat(fileName, content);
    const baseName = fileName.split('/').pop().split('\\').pop().split('.')[0];
    
    let parsedTables = {};
    if (format === 'sql') {
      parsedTables = this.parseSQL(content);
    } else if (format === 'json') {
      parsedTables = this.parseJSON(content, baseName);
    } else if (format === 'csv') {
      parsedTables = this.parseCSV(content, baseName);
    } else {
      throw new Error(`Unsupported file format for file: ${fileName}`);
    }

    // Verify we have some valid rows
    let totalRows = 0;
    for (const [tName, table] of Object.entries(parsedTables)) {
      totalRows += table.rows.length;
    }

    if (totalRows === 0) {
      throw new Error("No database rows parsed. Please make sure the file contains data records.");
    }

    this.normalizedData.tables = parsedTables;
    return parsedTables;
  }

  /**
   * Seeds all DBMS simulator engine subsystems with the parsed dataset.
   */
  distribute(engines, currentSchema = null) {
    const { btree, sharding, cqrs, replication, querySetCallback } = engines;
    const tables = this.normalizedData.tables;
    const tableNames = Object.keys(tables);

    if (tableNames.length === 0) return false;

    // Determine primary table name
    // Prefer "users" if it exists, or the first table with rows
    let primaryTable = tableNames.find(name => name.toLowerCase() === 'users') || tableNames[0];
    
    // Find a second table (e.g. "orders") or create a synthetic orders table
    let secondaryTable = tableNames.find(name => name !== primaryTable && name.toLowerCase() === 'orders') || 
                         tableNames.find(name => name !== primaryTable);

    const primaryRows = tables[primaryTable].rows;
    const primaryCols = tables[primaryTable].columns;

    // 1. Update Global Mock Database references
    const newMockDB = {};
    tableNames.forEach(tName => {
      newMockDB[tName] = tables[tName].rows;
    });

    // If only one table, mock an empty orders table to keep join queries working
    if (!newMockDB.orders) {
      if (secondaryTable) {
        newMockDB.orders = tables[secondaryTable].rows;
      } else {
        newMockDB.orders = [];
      }
    }
    if (!newMockDB.users) {
      newMockDB.users = primaryRows;
    }

    querySetCallback(newMockDB);

    // 2. Re-seed B+ Tree
    // Extract first numeric column as key. Fallback to indexing keys (10, 20...)
    btree.reset();
    
    // Find the first column in primaryTable that has numeric values
    let keyCol = primaryCols.find(col => {
      return primaryRows.some(row => typeof row[col] === 'number');
    }) || primaryCols[0]; // fallback to first column

    primaryRows.slice(0, 10).forEach((row, idx) => {
      let key = parseInt(row[keyCol], 10);
      if (isNaN(key)) {
        key = (idx + 1) * 10; // synthetic key
      }
      btree.insert(key, `val_${key}`);
    });

    // 3. Re-seed Sharding
    // We shard using the keyCol or primary numeric ID
    sharding.shards.Shard_A.keys = [];
    shardsClear(sharding);
    
    const shardSeedData = primaryRows.map((row, idx) => {
      let id = parseInt(row[keyCol], 10);
      if (isNaN(id)) id = (idx + 1) * 10;
      const nameCol = primaryCols.find(c => c !== keyCol && typeof row[c] === 'string') || primaryCols[0];
      return { id, name: String(row[nameCol] || `rec_${id}`) };
    });

    shardSeedData.forEach(item => {
      sharding.insert(item.id, item.name);
    });

    // 4. Re-seed CQRS
    cqrs.seed(primaryRows);

    // 5. Re-seed Replication
    replication.seed(primaryRows);

    return {
      primaryTable,
      secondaryTable: secondaryTable || 'None',
      tablesList: tableNames,
      primaryRowsCount: primaryRows.length
    };
  }
}

function shardsClear(sharding) {
  Object.values(sharding.shards).forEach(shard => {
    shard.keys = [];
    shard.records = [];
  });
}
