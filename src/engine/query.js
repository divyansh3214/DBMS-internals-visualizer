// Connection Pool Simulator
export class ConnectionPool {
  constructor(maxSize = 4) {
    this.maxSize = maxSize;
    this.active = []; // { id, query, startTime }
    this.queue = [];  // { id, query, callback }
    this.clientIdCounter = 1;
  }

  request(query, onGranted) {
    const client = {
      id: `Client_${this.clientIdCounter++}`,
      query,
      timestamp: Date.now()
    };
    
    if (this.active.length < this.maxSize) {
      this.active.push(client);
      onGranted(client);
    } else {
      this.queue.push({ ...client, callback: onGranted });
    }
    return client.id;
  }

  release(clientId) {
    const idx = this.active.findIndex(c => c.id === clientId);
    if (idx !== -1) {
      this.active.splice(idx, 1);
      
      // Dispatch next from queue
      if (this.queue.length > 0) {
        const nextClient = this.queue.shift();
        const clientObj = {
          id: nextClient.id,
          query: nextClient.query,
          timestamp: Date.now()
        };
        this.active.push(clientObj);
        nextClient.callback(clientObj);
      }
    }
  }

  reset() {
    this.active = [];
    this.queue = [];
  }
}

// Simple Query Cache
export class QueryCache {
  constructor() {
    this.cache = new Map();
  }

  check(sql) {
    const cleanSql = sql.trim().toLowerCase().replace(/\s+/g, ' ');
    if (this.cache.has(cleanSql)) {
      return { hit: true, data: this.cache.get(cleanSql) };
    }
    return { hit: false };
  }

  set(sql, result) {
    const cleanSql = sql.trim().toLowerCase().replace(/\s+/g, ' ');
    this.cache.set(cleanSql, result);
  }

  clear() {
    this.cache.clear();
  }
}

// Physical Operators for Volcano Iterator Model
export class PhysicalOperator {
  constructor(name, children = []) {
    this.name = name;
    this.children = children;
    this.state = 'CLOSED'; // OPENED, CLOSED, EXHAUSTED
    this.rowCounter = 0;
  }

  open() {
    this.state = 'OPENED';
    this.rowCounter = 0;
    for (const child of this.children) {
      child.open();
    }
  }

  next() {
    // Virtual method returns { value: rowObj, done: boolean }
    return { value: null, done: true };
  }

  close() {
    this.state = 'CLOSED';
    for (const child of this.children) {
      child.close();
    }
  }
}

export class SeqScanOperator extends PhysicalOperator {
  constructor(tableName, rows) {
    super(`SeqScan(${tableName})`);
    this.rows = rows;
    this.index = 0;
  }

  open() {
    super.open();
    this.index = 0;
  }

  next() {
    if (this.index >= this.rows.length) {
      this.state = 'EXHAUSTED';
      return { value: null, done: true };
    }
    const row = this.rows[this.index++];
    this.rowCounter++;
    return { value: row, done: false };
  }
}

export class IndexScanOperator extends PhysicalOperator {
  constructor(tableName, indexName, rows, filterKey, filterVal) {
    super(`IndexScan(${tableName}.${indexName})`);
    // Simulate finding matching rows via B+ Tree index
    this.matchingRows = rows.filter(r => r[filterKey] === filterVal);
    this.index = 0;
  }

  open() {
    super.open();
    this.index = 0;
  }

  next() {
    if (this.index >= this.matchingRows.length) {
      this.state = 'EXHAUSTED';
      return { value: null, done: true };
    }
    const row = this.matchingRows[this.index++];
    this.rowCounter++;
    return { value: row, done: false };
  }
}

export class FilterOperator extends PhysicalOperator {
  constructor(child, predicateFn, predicateStr) {
    super(`Filter(${predicateStr})`, [child]);
    this.predicateFn = predicateFn;
  }

  next() {
    const child = this.children[0];
    while (true) {
      const { value, done } = child.next();
      if (done) {
        this.state = 'EXHAUSTED';
        return { value: null, done: true };
      }
      if (this.predicateFn(value)) {
        this.rowCounter++;
        return { value, done: false };
      }
    }
  }
}

export class HashJoinOperator extends PhysicalOperator {
  constructor(leftOuterChild, rightInnerChild, leftKey, rightKey) {
    super(`HashJoin(${leftKey} = ${rightKey})`, [leftOuterChild, rightInnerChild]);
    this.leftKey = leftKey;
    this.rightKey = rightKey;
    this.hashTable = {};
    this.joinedRows = [];
    this.index = 0;
  }

  open() {
    super.open();
    this.hashTable = {};
    this.joinedRows = [];
    this.index = 0;

    // 1. Build Phase: Read inner relation (right child) and build hash table
    const innerRelation = this.children[1];
    while (true) {
      const { value, done } = innerRelation.next();
      if (done) break;
      const keyVal = value[this.rightKey];
      if (!this.hashTable[keyVal]) {
        this.hashTable[keyVal] = [];
      }
      this.hashTable[keyVal].push(value);
    }

    // 2. Probe Phase: Read outer relation (left child) and probe hash table
    const outerRelation = this.children[0];
    while (true) {
      const { value, done } = outerRelation.next();
      if (done) break;
      const keyVal = value[this.leftKey];
      const matches = this.hashTable[keyVal];
      if (matches) {
        for (const match of matches) {
          this.joinedRows.push({ ...value, ...match });
        }
      }
    }
  }

  next() {
    if (this.index >= this.joinedRows.length) {
      this.state = 'EXHAUSTED';
      return { value: null, done: true };
    }
    const row = this.joinedRows[this.index++];
    this.rowCounter++;
    return { value: row, done: false };
  }
}

export class ProjectOperator extends PhysicalOperator {
  constructor(child, projectFields) {
    super(`Projection(${projectFields.join(', ')})`, [child]);
    this.projectFields = projectFields;
  }

  next() {
    const child = this.children[0];
    const { value, done } = child.next();
    if (done) {
      this.state = 'EXHAUSTED';
      return { value: null, done: true };
    }
    
    // Project fields
    const projected = {};
    for (const field of this.projectFields) {
      projected[field] = value[field];
    }
    this.rowCounter++;
    return { value: projected, done: false };
  }
}

// Global engine mock database — starts empty, populated by uploaded file
export let MOCK_DATABASE = {};

export function setMockDatabase(db) {
  MOCK_DATABASE = db;
}

// Optimizer & Planner
export class QueryOptimizer {
  static createPlan(sql, useIndex = false) {
    const cleanSql = sql.trim().toLowerCase().replace(/\s+/g, ' ');
    
    // Check if it is a join query
    if (cleanSql.includes('select') && cleanSql.includes('join')) {
      // Regex for JOIN: SELECT cols FROM table1 JOIN table2 ON table1.col1 = table2.col2 WHERE filter
      const joinRegex = /select\s+(.+?)\s+from\s+(\w+)\s+join\s+(\w+)\s+on\s+(\w+)\.(\w+)\s*=\s*(\w+)\.(\w+)(?:\s+where\s+(.+?))?$/i;
      const match = cleanSql.match(joinRegex);
      
      let leftTableName = 'users';
      let rightTableName = 'orders';
      let leftJoinKey = 'id';
      let rightJoinKey = 'user_id';
      let fields = ['name', 'amount'];
      let whereStr = null;
      
      if (match) {
        fields = match[1].split(',').map(f => f.trim().split('.').pop());
        leftTableName = match[2];
        rightTableName = match[3];
        // Match join keys
        const t1 = match[4];
        const k1 = match[5];
        const t2 = match[6];
        const k2 = match[7];
        if (t1 === leftTableName) {
          leftJoinKey = k1;
          rightJoinKey = k2;
        } else {
          leftJoinKey = k2;
          rightJoinKey = k1;
        }
        whereStr = match[8];
      } else {
        // Fallback where condition if simple text match
        const whereMatch = cleanSql.match(/where\s+(.+?)$/i);
        if (whereMatch) {
          whereStr = whereMatch[1];
        }
      }
      
      // Resolve table records
      const leftTable = MOCK_DATABASE[leftTableName] || MOCK_DATABASE.users || [];
      const rightTable = MOCK_DATABASE[rightTableName] || MOCK_DATABASE.orders || [];
      
      const leftScan = new SeqScanOperator(leftTableName, leftTable);
      
      let rightScan;
      if (useIndex) {
        // Mock using index on the join/filter key
        let indexKey = rightJoinKey;
        let indexVal = rightTable.length > 0 ? rightTable[0][indexKey] : 0;
        rightScan = new IndexScanOperator(rightTableName, `idx_${indexKey}`, rightTable, indexKey, indexVal);
      } else {
        rightScan = new SeqScanOperator(rightTableName, rightTable);
      }
      
      // Parse where filter if present
      let filterOp = rightScan;
      let filterDesc = 'no filter';
      if (whereStr) {
        const filterMatch = whereStr.match(/(\w+)\s*([<>=!]+)\s*(.+)/);
        if (filterMatch) {
          const col = filterMatch[1].trim();
          const op = filterMatch[2].trim();
          let val = filterMatch[3].trim().replace(/^["']|["']$/g, '');
          if (!isNaN(val) && val !== '') val = Number(val);
          
          filterDesc = `${col} ${op} ${val}`;
          filterOp = new FilterOperator(rightScan, (row) => {
            const rowVal = row[col];
            if (rowVal === undefined) return false;
            if (op === '=') return rowVal == val;
            if (op === '>') return rowVal > val;
            if (op === '<') return rowVal < val;
            if (op === '>=') return rowVal >= val;
            if (op === '<=') return rowVal <= val;
            if (op === '!=') return rowVal != val;
            return true;
          }, filterDesc);
        }
      } else {
        // Default filter logic if no where clause parsed
        const firstCol = rightTable.length > 0 ? Object.keys(rightTable[0]).find(k => typeof rightTable[0][k] === 'number') : null;
        if (firstCol) {
          filterDesc = `${firstCol} > 0`;
          filterOp = new FilterOperator(rightScan, (row) => row[firstCol] > 0, filterDesc);
        }
      }
      
      const join = new HashJoinOperator(leftScan, filterOp, leftJoinKey, rightJoinKey);
      
      // Make sure all projected fields exist in joined schemas, or fallback to key fields
      const availableFields = [];
      if (leftTable.length > 0) Object.keys(leftTable[0]).forEach(k => availableFields.push(k));
      if (rightTable.length > 0) Object.keys(rightTable[0]).forEach(k => availableFields.push(k));
      const cleanFields = fields.filter(f => availableFields.includes(f));
      const finalFields = cleanFields.length > 0 ? cleanFields : (availableFields.slice(0, 3));
      
      const project = new ProjectOperator(join, finalFields);
      
      return {
        root: project,
        ast: {
          type: 'SelectStatement',
          fields: finalFields.map(f => `${leftTableName}.${f}`),
          from: [leftTableName, rightTableName],
          join: `${leftTableName}.${leftJoinKey} = ${rightTableName}.${rightJoinKey}`,
          where: filterDesc
        }
      };
    } else if (cleanSql.includes('select')) {
      // Single table query: SELECT cols FROM table WHERE filter
      const selectRegex = /select\s+(.+?)\s+from\s+(\w+)(?:\s+where\s+(.+?))?$/i;
      const match = cleanSql.match(selectRegex);
      
      let tableName = 'users';
      let fields = ['name', 'age', 'role'];
      let whereStr = null;
      
      if (match) {
        fields = match[1].split(',').map(f => f.trim());
        tableName = match[2];
        whereStr = match[3];
      }
      
      const tableData = MOCK_DATABASE[tableName] || Object.values(MOCK_DATABASE)[0] || [];
      const scan = new SeqScanOperator(tableName, tableData);
      
      let filterOp = scan;
      let filterDesc = 'no filter';
      if (whereStr) {
        const filterMatch = whereStr.match(/(\w+)\s*([<>=!]+)\s*(.+)/);
        if (filterMatch) {
          const col = filterMatch[1].trim();
          const op = filterMatch[2].trim();
          let val = filterMatch[3].trim().replace(/^["']|["']$/g, '');
          if (!isNaN(val) && val !== '') val = Number(val);
          
          filterDesc = `${col} ${op} ${val}`;
          filterOp = new FilterOperator(scan, (row) => {
            const rowVal = row[col];
            if (rowVal === undefined) return false;
            if (op === '=') return rowVal == val;
            if (op === '>') return rowVal > val;
            if (op === '<') return rowVal < val;
            if (op === '>=') return rowVal >= val;
            if (op === '<=') return rowVal <= val;
            if (op === '!=') return rowVal != val;
            return true;
          }, filterDesc);
        }
      }
      
      const availableFields = tableData.length > 0 ? Object.keys(tableData[0]) : [];
      let finalFields = fields.filter(f => availableFields.includes(f) || f === '*');
      if (finalFields.includes('*') || finalFields.length === 0) {
        finalFields = availableFields.slice(0, 4);
      }
      
      const project = new ProjectOperator(filterOp, finalFields);
      
      return {
        root: project,
        ast: {
          type: 'SelectStatement',
          fields: finalFields,
          from: [tableName],
          where: filterDesc
        }
      };
    } else if (cleanSql.includes('insert')) {
      // INSERT INTO table VALUES (...)
      const insertRegex = /insert\s+into\s+(\w+)\s*(?:\((.+?)\))?\s*values\s*\((.+?)\)/i;
      const match = cleanSql.match(insertRegex);
      
      let tableName = 'users';
      let values = [6, 'Frank', 27];
      if (match) {
        tableName = match[1];
        values = match[3].split(',').map(v => {
          v = v.trim().replace(/^["']|["']$/g, '');
          return !isNaN(v) && v !== '' ? Number(v) : v;
        });
      }
      
      return {
        root: null,
        ast: {
          type: 'InsertStatement',
          table: tableName,
          values: values
        }
      };
    }
    
    throw new Error('Unsupported SQL command in simulator.');
  }
}
