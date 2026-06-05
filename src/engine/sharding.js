export class ShardingRouter {
  constructor() {
    this.strategy = 'Range'; // 'Range' or 'Hash'
    this.shards = {
      Shard_A: { id: 'Shard_A', name: 'Asia-East Node', keys: [], records: [] },
      Shard_B: { id: 'Shard_B', name: 'US-West Node', keys: [], records: [] },
      Shard_C: { id: 'Shard_C', name: 'Europe-Central Node', keys: [], records: [] }
    };
    
    this.boundaries = [
      { shard: 'Shard_A', max: 33 },
      { shard: 'Shard_B', max: 66 },
      { shard: 'Shard_C', max: Infinity }
    ];

    // Seed initial records
    this.seed();
  }

  seed(customRows = null) {
    this.shards = {
      Shard_A: { id: 'Shard_A', name: 'Asia-East Node', keys: [], records: [] },
      Shard_B: { id: 'Shard_B', name: 'US-West Node', keys: [], records: [] },
      Shard_C: { id: 'Shard_C', name: 'Europe-Central Node', keys: [], records: [] }
    };
    
    this.boundaries = [
      { shard: 'Shard_A', max: 33 },
      { shard: 'Shard_B', max: 66 },
      { shard: 'Shard_C', max: Infinity }
    ];

    let seedData = [];
    if (customRows && Array.isArray(customRows)) {
      customRows.forEach((row, i) => {
        // extract numeric key, or fallback
        const id = parseInt(row.id || row.user_id || row.order_id, 10) || (i + 1) * 10;
        const name = String(row.name || row.username || row.title || `val_${id}`);
        seedData.push({ id, name });
      });
    } else {
      seedData = [];
    }

    for (const item of seedData) {
      this.insert(item.id, item.name);
    }
  }

  getRoute(key) {
    const steps = [];
    let target = 'Shard_A';
    
    if (this.strategy === 'Range') {
      steps.push(`Evaluating range partitioning for key: ${key}`);
      const sorted = [...this.boundaries].sort((a, b) => a.max - b.max);
      const matched = sorted.find(b => key <= b.max);
      target = matched ? matched.shard : sorted[sorted.length - 1].shard;
      
      const idx = sorted.findIndex(b => b.shard === target);
      const min = idx === 0 ? 0 : sorted[idx - 1].max + 1;
      const maxStr = target === sorted[sorted.length - 1].shard ? 'Infinity' : sorted[idx].max;
      steps.push(`Key ${key} falls in range [${min} - ${maxStr}]. Routing to ${target}.`);
    } else {
      // Hash Sharding
      const shardNames = Object.keys(this.shards);
      const modulo = shardNames.length;
      const hashVal = (key * 13) % 100; // Hashing function
      const shardIdx = hashVal % modulo;
      steps.push(`Applying hash function: hash(${key}) = (${key} * 13) % 100 = ${hashVal}`);
      
      target = shardNames[shardIdx];
      steps.push(`Hash value ${hashVal} % ${modulo} = ${shardIdx}. Routing to ${target}.`);
    }

    return { target, steps };
  }

  insert(key, value) {
    const { target, steps } = this.getRoute(key);
    let autoSharded = false;
    const rebalanceLogs = [];
    
    // Check duplicates
    if (!this.shards[target].keys.includes(key)) {
      this.shards[target].keys.push(key);
      this.shards[target].records.push({ id: key, name: value });
      this.shards[target].keys.sort((a, b) => a - b);
      this.shards[target].records.sort((a, b) => a.id - b.id);
    }

    // Auto-sharding: trigger split if target shard exceeds 8 keys
    if (this.shards[target].keys.length > 8) {
      autoSharded = true;
      rebalanceLogs.push(`[Auto-Sharding] Shard ${target} capacity exceeded (${this.shards[target].keys.length} keys > 8). Initiating shard split!`);
      
      const shardNames = Object.keys(this.shards);
      const nextIdx = shardNames.length;
      const nextChar = String.fromCharCode(65 + nextIdx); // D, E, F...
      const nextId = `Shard_${nextChar}`;
      const presets = [
        { name: 'Asia-West Node' },
        { name: 'Africa-Central Node' },
        { name: 'South-America Node' },
        { name: 'Australia-East Node' },
        { name: 'North-America East Node' }
      ];
      const preset = presets[nextIdx - 3] || { name: `Global Node ${nextChar}` };
      
      this.shards[nextId] = {
        id: nextId,
        name: preset.name,
        keys: [],
        records: []
      };
      
      rebalanceLogs.push(`[Auto-Sharding] Provisioned new Shard Node: ${nextId} (${preset.name})`);

      if (this.strategy === 'Range') {
        // Find midpoint key of overloaded shard
        const keys = this.shards[target].keys;
        const midIdx = Math.floor(keys.length / 2);
        const splitKey = keys[midIdx];
        
        // Find overloaded boundary
        const boundaryObj = this.boundaries.find(b => b.shard === target);
        const oldMax = boundaryObj.max;
        
        // Insert new boundary: split range
        this.boundaries.push({ shard: nextId, max: splitKey });
        
        rebalanceLogs.push(`[Auto-Sharding] Split range for ${target}. Created range boundary max = ${splitKey} for ${nextId}.`);

        // Re-distribute existing records from target
        const originalRecords = [...this.shards[target].records];
        
        this.shards[target].keys = [];
        this.shards[target].records = [];
        
        originalRecords.forEach(r => {
          const { target: newDest } = this.getRoute(r.id);
          this.shards[newDest].keys.push(r.id);
          this.shards[newDest].records.push(r);
        });
        
        // Sort keys and records
        Object.keys(this.shards).forEach(id => {
          this.shards[id].keys.sort((a, b) => a - b);
          this.shards[id].records.sort((a, b) => a.id - b.id);
        });

        rebalanceLogs.push(`[Auto-Sharding] Rebalanced range keys. Moved ${this.shards[nextId].keys.length} keys to ${nextId}.`);
      } else {
        // Hash sharding: increase divisor and re-hash all
        rebalanceLogs.push(`[Auto-Sharding] Hashing modulo divisor increased to ${nextIdx + 1}. Starting cluster-wide rehashing...`);
        
        const allRecords = [];
        Object.values(this.shards).forEach(shard => {
          allRecords.push(...shard.records);
          shard.keys = [];
          shard.records = [];
        });
        
        allRecords.forEach(r => {
          const { target: newDest } = this.getRoute(r.id);
          this.shards[newDest].keys.push(r.id);
          this.shards[newDest].records.push(r);
        });
        
        Object.keys(this.shards).forEach(id => {
          this.shards[id].keys.sort((a, b) => a - b);
          this.shards[id].records.sort((a, b) => a.id - b.id);
        });
        
        rebalanceLogs.push(`[Auto-Sharding] Rehashing completed. Distributed keys across all ${nextIdx + 1} nodes.`);
      }
    }
    
    return { target, steps, status: 'Success', autoSharded, rebalanceLogs };
  }

  query(key) {
    const { target, steps } = this.getRoute(key);
    const idx = this.shards[target].keys.indexOf(key);
    const record = idx !== -1 ? this.shards[target].records[idx] : null;
    
    if (record) {
      steps.push(`Record found on Shard ${target}: ${JSON.stringify(record)}`);
    } else {
      steps.push(`Key ${key} not found on Shard ${target}.`);
    }

    return { target, record, steps };
  }

  getMetrics() {
    const totalKeys = Object.values(this.shards).reduce((sum, s) => sum + s.keys.length, 0);
    const distributions = {};
    
    for (const [sId, shard] of Object.entries(this.shards)) {
      distributions[sId] = {
        name: shard.name,
        count: shard.keys.length,
        percentage: totalKeys > 0 ? Math.round((shard.keys.length / totalKeys) * 100) : 0,
        keys: [...shard.keys]
      };
    }

    return distributions;
  }

  reset() {
    this.seed();
  }
}
