export class DashboardTracker {
  constructor() {
    this.tps = 0;
    this.txSuccess = 0;
    this.txAbort = 0;
    
    this.bufferHits = 0;
    this.bufferMisses = 0;
    
    this.lockRequests = 0;
    this.lockConflicts = 0;

    this.shards = [
      { id: 'Shard_A', load: 0, queries: 0 },
      { id: 'Shard_B', load: 0, queries: 0 },
      { id: 'Shard_C', load: 0, queries: 0 }
    ];

    this.cqrsDelay = 1000; // ms
    this.cqrsStaleReads = 0;
    this.cqrsTotalReads = 0;

    // History for sparklines/graphs
    this.history = {
      tps: Array(20).fill(0),
      hitRatio: Array(20).fill(100),
      conflictRate: Array(20).fill(0),
      tpsHistoryLimit: 20
    };

    this.lastTickTime = Date.now();
    this.tickTxCounter = 0;
  }

  recordTxStart() {
    this.tickTxCounter++;
  }

  recordTxSuccess() {
    this.txSuccess++;
  }

  recordTxAbort() {
    this.txAbort++;
  }

  recordBufferHit() {
    this.bufferHits++;
  }

  recordBufferMiss() {
    this.bufferMisses++;
  }

  recordLockRequest(isConflict) {
    this.lockRequests++;
    if (isConflict) {
      this.lockConflicts++;
    }
  }

  getCacheHitRatio() {
    const total = this.bufferHits + this.bufferMisses;
    if (total === 0) return 100;
    return Math.round((this.bufferHits / total) * 100);
  }

  getLockConflictRate() {
    if (this.lockRequests === 0) return 0;
    return Math.round((this.lockConflicts / this.lockRequests) * 100);
  }

  getShardBalancing() {
    const totalQ = this.shards.reduce((sum, s) => sum + s.queries, 0);
    if (totalQ === 0) return 'BALANCED';
    
    const ratios = this.shards.map(s => s.queries / totalQ);
    const maxRatio = Math.max(...ratios);
    const minRatio = Math.min(...ratios);
    
    const diff = maxRatio - minRatio;
    if (diff < 0.15) return 'OPTIMAL';
    if (diff < 0.40) return 'BALANCED';
    return 'IMBALANCED';
  }

  tick() {
    const now = Date.now();
    const elapsedSec = (now - this.lastTickTime) / 1000;
    this.lastTickTime = now;
    
    // Calculate current TPS
    this.tps = Math.round((this.tickTxCounter / (elapsedSec || 1)) * 10) / 10;
    this.tickTxCounter = 0;

    // Push into history arrays
    this.history.tps.push(this.tps);
    if (this.history.tps.length > this.history.tpsHistoryLimit) {
      this.history.tps.shift();
    }

    const hitRatio = this.getCacheHitRatio();
    this.history.hitRatio.push(hitRatio);
    if (this.history.hitRatio.length > this.history.tpsHistoryLimit) {
      this.history.hitRatio.shift();
    }

    const conflictRate = this.getLockConflictRate();
    this.history.conflictRate.push(conflictRate);
    if (this.history.conflictRate.length > this.history.tpsHistoryLimit) {
      this.history.conflictRate.shift();
    }
    
    // Decay query counters slowly to keep loads dynamic
    this.shards.forEach(s => {
      s.queries = Math.max(0, s.queries - 1);
      s.load = Math.min(100, Math.round(s.queries * 15));
    });
  }

  reset() {
    this.tps = 0;
    this.txSuccess = 0;
    this.txAbort = 0;
    this.bufferHits = 0;
    this.bufferMisses = 0;
    this.lockRequests = 0;
    this.lockConflicts = 0;
    this.cqrsStaleReads = 0;
    this.cqrsTotalReads = 0;
    this.shards.forEach(s => {
      s.queries = 0;
      s.load = 0;
    });
    this.history.tps.fill(0);
    this.history.hitRatio.fill(100);
    this.history.conflictRate.fill(0);
    this.lastTickTime = Date.now();
    this.tickTxCounter = 0;
  }
}
