export class Transaction {
  constructor(id) {
    this.id = id; // e.g. 'T1', 'T2'
    this.status = 'ACTIVE'; // 'ACTIVE', 'BLOCKED', 'COMMITTED', 'ABORTED'
    this.heldLocks = []; // { resource, mode }
    this.waitingFor = null; // { resource, mode }
    this.history = []; // Operations performed
  }
}

export class LockManager {
  constructor() {
    this.locks = {
      A: { type: null, holders: [], waiters: [] }, // holders: [txId], waiters: [{txId, mode}]
      B: { type: null, holders: [], waiters: [] },
      C: { type: null, holders: [], waiters: [] },
      D: { type: null, holders: [], waiters: [] }
    };
  }

  // Returns { granted: boolean, steps: [] }
  acquire(txId, resource, mode) {
    const steps = [];
    // Dynamically create lock entry if resource is new
    if (!this.locks[resource]) {
      this.locks[resource] = { type: null, holders: [], waiters: [] };
    }
    const lock = this.locks[resource];
    steps.push(`[Lock Manager] ${txId} requests ${mode}-Lock on resource ${resource}`);

    // If lock is not held by anyone
    if (lock.type === null) {
      lock.type = mode;
      lock.holders.push(txId);
      steps.push(`[Lock Manager] Granted: ${txId} holds ${mode}-Lock on ${resource}`);
      return { granted: true, steps };
    }

    // Shared Lock Request
    if (mode === 'S') {
      if (lock.type === 'S') {
        // If there are no waiters before this request (avoid starvation)
        if (lock.waiters.length === 0) {
          if (!lock.holders.includes(txId)) {
            lock.holders.push(txId);
          }
          steps.push(`[Lock Manager] Granted: Shared Lock shared by ${txId} on ${resource}`);
          return { granted: true, steps };
        }
      }
      // If it's an X lock held by someone else, or S lock with waiting list
      steps.push(`[Lock Manager] Blocked: Resource ${resource} is locked by ${lock.holders.join(', ')}`);
      lock.waiters.push({ txId, mode });
      return { granted: false, steps };
    }

    // Exclusive Lock Request
    if (mode === 'X') {
      // If the only holder is this transaction itself (lock upgrade)
      if (lock.holders.length === 1 && lock.holders[0] === txId) {
        lock.type = 'X';
        steps.push(`[Lock Manager] Granted: Upgraded lock for ${txId} to X-Lock on ${resource}`);
        return { granted: true, steps };
      }
      
      steps.push(`[Lock Manager] Blocked: Resource ${resource} is locked by ${lock.holders.join(', ')}`);
      lock.waiters.push({ txId, mode });
      return { granted: false, steps };
    }

    return { granted: false, steps };
  }

  // Release lock held by txId on resource
  release(txId, resource) {
    const steps = [];
    if (!this.locks[resource]) return { steps };
    const lock = this.locks[resource];
    lock.holders = lock.holders.filter(id => id !== txId);
    steps.push(`[Lock Manager] ${txId} released lock on ${resource}`);

    if (lock.holders.length === 0) {
      lock.type = null;
      
      // Grant locks to waiters
      const grantedWaiters = [];
      while (lock.waiters.length > 0) {
        const nextWaiter = lock.waiters[0];
        
        if (lock.type === null) {
          lock.type = nextWaiter.mode;
          lock.holders.push(nextWaiter.txId);
          lock.waiters.shift();
          grantedWaiters.push(nextWaiter);
        } else if (lock.type === 'S' && nextWaiter.mode === 'S') {
          lock.holders.push(nextWaiter.txId);
          lock.waiters.shift();
          grantedWaiters.push(nextWaiter);
        } else {
          // X lock waiting or S lock blocked by X lock
          break;
        }
      }

      if (grantedWaiters.length > 0) {
        steps.push(`[Lock Manager] Unblocked and Granted lock on ${resource} to: ${grantedWaiters.map(w => `${w.txId} (${w.mode})`).join(', ')}`);
      }
    }
    return { steps };
  }

  // Release all locks for a transaction
  releaseAll(txId) {
    const releasedResources = [];
    const steps = [];
    
    for (const [resource, lock] of Object.entries(this.locks)) {
      // Remove from waiters if any
      lock.waiters = lock.waiters.filter(w => w.txId !== txId);
      
      if (lock.holders.includes(txId)) {
        const { steps: relSteps } = this.release(txId, resource);
        steps.push(...relSteps);
        releasedResources.push(resource);
      }
    }

    return { releasedResources, steps };
  }

  reset() {
    // Clear all locks — keep default resources but also wipe any dynamically added ones
    this.locks = {
      A: { type: null, holders: [], waiters: [] },
      B: { type: null, holders: [], waiters: [] },
      C: { type: null, holders: [], waiters: [] },
      D: { type: null, holders: [], waiters: [] }
    };
  }
}

// Deadlock Wait-For Graph
export class WaitForGraph {
  constructor() {
    this.adj = {}; // txId -> [txIds]
  }

  build(transactions, lockManager) {
    this.adj = {};
    
    // Initialize graph nodes
    for (const txId of Object.keys(transactions)) {
      this.adj[txId] = [];
    }

    // Add dependency edges: if Tx A is waiting for a lock on Resource R,
    // draw a directed edge from Tx A to all transactions currently holding a lock on R.
    for (const [resName, lock] of Object.entries(lockManager.locks)) {
      for (const waiter of lock.waiters) {
        if (!this.adj[waiter.txId]) this.adj[waiter.txId] = [];
        
        for (const holder of lock.holders) {
          if (waiter.txId !== holder && !this.adj[waiter.txId].includes(holder)) {
            this.adj[waiter.txId].push(holder);
          }
        }
      }
    }
  }

  // Detect cycle using DFS
  findCycle() {
    const visited = {};
    const recStack = {};
    const path = [];

    const dfs = (node) => {
      visited[node] = true;
      recStack[node] = true;
      path.push(node);

      for (const neighbor of (this.adj[node] || [])) {
        if (!visited[neighbor]) {
          if (dfs(neighbor)) return true;
        } else if (recStack[neighbor]) {
          path.push(neighbor);
          return true;
        }
      }

      recStack[node] = false;
      path.pop();
      return false;
    };

    for (const node of Object.keys(this.adj)) {
      if (!visited[node]) {
        if (dfs(node)) {
          // Trim the path to isolate the cycle:
          // e.g. path is ['T1', 'T2', 'T3', 'T2'] -> cycle is ['T2', 'T3', 'T2']
          const startIdx = path.indexOf(path[path.length - 1]);
          return path.slice(startIdx);
        }
      }
    }

    return null;
  }
}

// Write-Ahead Log Manager
export class WalManager {
  constructor() {
    this.logs = [];
    this.lsnCounter = 1001; // Log Sequence Number starts at 1001
  }

  append(txId, type, details = {}) {
    const lsn = this.lsnCounter++;
    const entry = {
      lsn,
      txId,
      type, // 'START', 'UPDATE', 'COMMIT', 'ABORT'
      resource: details.resource || null,
      oldVal: details.oldVal !== undefined ? details.oldVal : null,
      newVal: details.newVal !== undefined ? details.newVal : null,
      timestamp: Date.now()
    };
    
    this.logs.push(entry);
    return entry;
  }

  getFormattedLog(entry) {
    if (entry.type === 'START') {
      return `<LSN:${entry.lsn}, ${entry.txId}, START>`;
    }
    if (entry.type === 'COMMIT') {
      return `<LSN:${entry.lsn}, ${entry.txId}, COMMIT>`;
    }
    if (entry.type === 'ABORT') {
      return `<LSN:${entry.lsn}, ${entry.txId}, ABORT>`;
    }
    if (entry.type === 'UPDATE') {
      return `<LSN:${entry.lsn}, ${entry.txId}, ${entry.resource}, old:${entry.oldVal}, new:${entry.newVal}>`;
    }
    return '';
  }

  reset() {
    this.logs = [];
    this.lsnCounter = 1001;
  }
}
