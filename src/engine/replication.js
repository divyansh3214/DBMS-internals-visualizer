// Replication Engine: Master-Slave & Multi-Primary

export class ReplicaNode {
  constructor(id, name, role = 'slave', region = 'us-east') {
    this.id = id;
    this.name = name;
    this.role = role; // 'master', 'slave', 'primary'
    this.region = region;
    this.status = 'ONLINE'; // 'ONLINE', 'SYNCING', 'LAG', 'OFFLINE', 'CONFLICT'
    this.data = {};
    this.walPosition = 0; // LSN position
    this.lag = 0; // replication lag in ms
    this.lastHeartbeat = Date.now();
    this.writeCount = 0;
    this.readCount = 0;
    this.conflictCount = 0;
  }
}

export class ReplicationManager {
  constructor() {
    this.mode = 'master-slave'; // 'master-slave' or 'multi-primary'
    this.nodes = [];
    this.walStream = []; // replication WAL events
    this.conflicts = []; // multi-primary conflicts
    this.eventIdCounter = 1;
    this.globalClock = 0;
    this.replicationLag = 800; // base replication lag in ms
    this.pendingReplications = []; // { event, targetNodeId, arrivalTime }

    this.seed();
  }

  seed(customRows = null) {
    this.nodes = [];
    this.walStream = [];
    this.conflicts = [];
    this.pendingReplications = [];
    this.eventIdCounter = 1;
    this.globalClock = 0;

    let seedData = {};
    if (customRows && Array.isArray(customRows)) {
      customRows.forEach((row, i) => {
        const id = String(row.id || row.user_id || row.order_id || `rec_${i + 1}`);
        const name = String(row.name || row.username || row.title || `Record ${id}`);
        const balance = row.balance !== undefined ? row.balance : (row.amount !== undefined ? row.amount : (row.age !== undefined ? row.age * 10 : 1000));
        const status = String(row.status || row.role || 'Active');
        seedData[id] = { id, name, balance, status };
      });
    } else {
      seedData = {};
    }

    if (this.mode === 'master-slave') {
      this.nodes = [
        new ReplicaNode('master', 'Primary Master', 'master', 'us-east'),
        new ReplicaNode('slave_1', 'Read Replica 1', 'slave', 'us-west'),
        new ReplicaNode('slave_2', 'Read Replica 2', 'slave', 'eu-central'),
        new ReplicaNode('slave_3', 'Read Replica 3', 'slave', 'ap-southeast')
      ];
    } else {
      this.nodes = [
        new ReplicaNode('primary_1', 'Primary Node A', 'primary', 'us-east'),
        new ReplicaNode('primary_2', 'Primary Node B', 'primary', 'eu-central'),
        new ReplicaNode('primary_3', 'Primary Node C', 'primary', 'ap-southeast')
      ];
    }

    // Populate all nodes with seed data
    this.nodes.forEach(node => {
      node.data = JSON.parse(JSON.stringify(seedData));
      node.walPosition = 0;
      node.lag = 0;
      node.writeCount = 0;
      node.readCount = 0;
      node.conflictCount = 0;
    });
  }

  switchMode(mode) {
    this.mode = mode;
    this.seed();
  }

  // Master-Slave: Write goes to master, then replicates to slaves
  masterSlaveWrite(recordId, field, newValue) {
    const steps = [];
    const master = this.nodes.find(n => n.role === 'master');
    if (!master || master.status === 'OFFLINE') {
      steps.push({ type: 'error', msg: '[Master] Node OFFLINE. Write rejected. Failover required.' });
      return { success: false, steps };
    }

    const oldValue = master.data[recordId] ? master.data[recordId][field] : null;
    if (!master.data[recordId]) {
      steps.push({ type: 'error', msg: `[Master] Record ${recordId} not found.` });
      return { success: false, steps };
    }

    // Write to master
    master.data[recordId][field] = newValue;
    master.walPosition++;
    master.writeCount++;
    const eventId = `WAL_${this.eventIdCounter++}`;

    const walEntry = {
      id: eventId,
      lsn: master.walPosition,
      recordId,
      field,
      oldValue,
      newValue,
      sourceNode: master.id,
      timestamp: Date.now(),
      type: 'UPDATE'
    };
    this.walStream.push(walEntry);

    steps.push({ type: 'write', node: master.id, msg: `[Master ${master.name}] COMMITTED: ${recordId}.${field} = "${newValue}" (LSN: ${walEntry.lsn})` });
    steps.push({ type: 'wal', msg: `[WAL Stream] Event ${eventId} enqueued for async replication to ${this.nodes.length - 1} slave(s).` });

    // Queue replication to all slaves
    const slaves = this.nodes.filter(n => n.role === 'slave' && n.status !== 'OFFLINE');
    slaves.forEach(slave => {
      const arrivalTime = Date.now() + this.replicationLag + Math.floor(Math.random() * 400);
      this.pendingReplications.push({
        event: walEntry,
        targetNodeId: slave.id,
        arrivalTime
      });
      slave.status = 'SYNCING';
      slave.lag = arrivalTime - Date.now();
      steps.push({ type: 'replicate', node: slave.id, msg: `[Replication] Streaming to ${slave.name} (${slave.region}). Estimated lag: ${slave.lag}ms` });
    });

    return { success: true, walEntry, steps };
  }

  // Master-Slave: Read from a slave (or master)
  masterSlaveRead(recordId, preferredNode = null) {
    const steps = [];
    let target;

    if (preferredNode) {
      target = this.nodes.find(n => n.id === preferredNode);
    } else {
      // Load-balance reads across slaves
      const onlineSlaves = this.nodes.filter(n => n.role === 'slave' && n.status !== 'OFFLINE');
      if (onlineSlaves.length > 0) {
        target = onlineSlaves[Math.floor(Math.random() * onlineSlaves.length)];
      } else {
        target = this.nodes.find(n => n.role === 'master');
      }
    }

    if (!target) {
      steps.push({ type: 'error', msg: '[Router] No available node for read.' });
      return { success: false, steps };
    }

    target.readCount++;
    const record = target.data[recordId] ? { ...target.data[recordId] } : null;
    const masterRecord = this.nodes.find(n => n.role === 'master')?.data[recordId];
    const isStale = record && masterRecord && JSON.stringify(record) !== JSON.stringify(masterRecord);

    steps.push({ type: 'read', node: target.id, msg: `[${target.name}] READ ${recordId}: ${JSON.stringify(record)}` });
    if (isStale) {
      steps.push({ type: 'warning', msg: `[Consistency] STALE READ! Slave data differs from master. Replication lag in progress.` });
    } else {
      steps.push({ type: 'success', msg: `[Consistency] Data is consistent with master.` });
    }

    return { success: true, record, isStale, nodeUsed: target.id, steps };
  }

  // Multi-Primary: Write to any primary node
  multiPrimaryWrite(nodeId, recordId, field, newValue) {
    const steps = [];
    const node = this.nodes.find(n => n.id === nodeId);
    if (!node || node.status === 'OFFLINE') {
      steps.push({ type: 'error', msg: `[${nodeId}] Node OFFLINE. Write rejected.` });
      return { success: false, steps };
    }

    if (!node.data[recordId]) {
      steps.push({ type: 'error', msg: `[${node.name}] Record ${recordId} not found.` });
      return { success: false, steps };
    }

    const oldValue = node.data[recordId][field];
    node.data[recordId][field] = newValue;
    node.walPosition++;
    node.writeCount++;
    const eventId = `WAL_${this.eventIdCounter++}`;

    const walEntry = {
      id: eventId,
      lsn: node.walPosition,
      recordId,
      field,
      oldValue,
      newValue,
      sourceNode: node.id,
      timestamp: Date.now(),
      type: 'UPDATE'
    };
    this.walStream.push(walEntry);

    steps.push({ type: 'write', node: node.id, msg: `[${node.name}] COMMITTED locally: ${recordId}.${field} = "${newValue}" (LSN: ${walEntry.lsn})` });

    // Queue replication to all OTHER primary nodes
    const otherPrimaries = this.nodes.filter(n => n.id !== nodeId && n.status !== 'OFFLINE');
    otherPrimaries.forEach(peer => {
      const arrivalTime = Date.now() + this.replicationLag + Math.floor(Math.random() * 600);
      this.pendingReplications.push({
        event: walEntry,
        targetNodeId: peer.id,
        arrivalTime
      });
      peer.lag = Math.max(peer.lag, arrivalTime - Date.now());
      steps.push({ type: 'replicate', node: peer.id, msg: `[Replication] Streaming to ${peer.name} (${peer.region}). ETA: ${arrivalTime - Date.now()}ms` });
    });

    return { success: true, walEntry, steps };
  }

  // Process pending replications whose arrival time has passed
  processPendingReplications(now = Date.now()) {
    const completed = [];

    this.pendingReplications = this.pendingReplications.filter(pending => {
      if (now >= pending.arrivalTime) {
        const target = this.nodes.find(n => n.id === pending.targetNodeId);
        if (target && target.status !== 'OFFLINE') {
          const event = pending.event;

          // Conflict detection for multi-primary
          if (this.mode === 'multi-primary') {
            const currentValue = target.data[event.recordId]?.[event.field];
            // Conflict if the target already has a different value than what we expect
            if (currentValue !== event.oldValue && currentValue !== event.newValue) {
              const conflict = {
                id: `CONFLICT_${this.conflicts.length + 1}`,
                eventId: event.id,
                recordId: event.recordId,
                field: event.field,
                sourceNode: event.sourceNode,
                targetNode: target.id,
                sourceValue: event.newValue,
                targetValue: currentValue,
                resolution: 'LAST_WRITE_WINS',
                timestamp: now
              };
              this.conflicts.push(conflict);
              target.conflictCount++;
              target.status = 'CONFLICT';

              completed.push({
                type: 'conflict',
                node: target.id,
                msg: `[CONFLICT] on ${target.name}: Record ${event.recordId}.${event.field} — local="${currentValue}" vs incoming="${event.newValue}". Resolved via LAST_WRITE_WINS.`
              });

              // Last-write-wins: apply the incoming write
              target.data[event.recordId][event.field] = event.newValue;
              target.walPosition = Math.max(target.walPosition, event.lsn);

              // Reset conflict status after brief delay
              setTimeout(() => { if (target.status === 'CONFLICT') target.status = 'ONLINE'; }, 2000);
            } else {
              // No conflict, apply normally
              target.data[event.recordId][event.field] = event.newValue;
              target.walPosition = Math.max(target.walPosition, event.lsn);
              target.status = 'ONLINE';
              target.lag = 0;

              completed.push({
                type: 'synced',
                node: target.id,
                msg: `[Sync] ${target.name} applied ${event.id}: ${event.recordId}.${event.field} = "${event.newValue}" (LSN: ${event.lsn})`
              });
            }
          } else {
            // Master-slave: just apply
            target.data[event.recordId][event.field] = event.newValue;
            target.walPosition = Math.max(target.walPosition, event.lsn);
            target.status = 'ONLINE';
            target.lag = 0;

            completed.push({
              type: 'synced',
              node: target.id,
              msg: `[Sync] ${target.name} applied ${event.id}: ${event.recordId}.${event.field} = "${event.newValue}" (LSN: ${event.lsn})`
            });
          }
        }
        return false; // remove from pending
      }
      return true; // keep in pending
    });

    return completed;
  }

  // Toggle a node online/offline
  toggleNodeStatus(nodeId) {
    const node = this.nodes.find(n => n.id === nodeId);
    if (node) {
      if (node.status === 'OFFLINE') {
        node.status = 'ONLINE';
        node.lastHeartbeat = Date.now();
        return { msg: `[Failover] ${node.name} brought ONLINE.`, status: 'ONLINE' };
      } else {
        node.status = 'OFFLINE';
        // Remove pending replications for this node
        this.pendingReplications = this.pendingReplications.filter(p => p.targetNodeId !== nodeId);
        return { msg: `[Failover] ${node.name} taken OFFLINE. Pending replications cleared.`, status: 'OFFLINE' };
      }
    }
    return { msg: 'Node not found.', status: 'unknown' };
  }

  // Promote a slave to master (master-slave failover)
  promoteSlave(slaveId) {
    if (this.mode !== 'master-slave') return { success: false, msg: 'Only available in master-slave mode.' };
    const slave = this.nodes.find(n => n.id === slaveId && n.role === 'slave');
    const master = this.nodes.find(n => n.role === 'master');

    if (!slave) return { success: false, msg: 'Slave not found.' };

    // Demote current master
    if (master) {
      master.role = 'slave';
      master.status = 'OFFLINE';
    }

    // Promote slave
    slave.role = 'master';
    slave.status = 'ONLINE';

    return {
      success: true,
      msg: `[Failover] ${slave.name} PROMOTED to Master. Old master demoted and taken offline.`,
      newMasterId: slave.id
    };
  }

  scaleOut() {
    const regions = ['us-west', 'eu-central', 'ap-southeast', 'us-east', 'ap-northeast', 'sa-east', 'af-south', 'ca-central'];
    const occupied = this.nodes.map(n => n.region);
    const region = regions.find(r => !occupied.includes(r)) || regions[Math.floor(Math.random() * regions.length)];

    let id, name, role;
    if (this.mode === 'master-slave') {
      const slaveIndex = this.nodes.filter(n => n.role === 'slave').length + 1;
      id = `slave_${Date.now()}`;
      name = `Read Replica ${slaveIndex}`;
      role = 'slave';
    } else {
      const primaryIndex = this.nodes.filter(n => n.role === 'primary').length + 1;
      id = `primary_${Date.now()}`;
      name = `Primary Node ${String.fromCharCode(65 + primaryIndex - 1)}`;
      role = 'primary';
    }

    // Copy data from an online node
    let dataSrc = null;
    if (this.mode === 'master-slave') {
      dataSrc = this.nodes.find(n => n.role === 'master' && n.status !== 'OFFLINE');
    } else {
      dataSrc = this.nodes.find(n => n.role === 'primary' && n.status !== 'OFFLINE');
    }
    if (!dataSrc) dataSrc = this.nodes.find(n => n.status !== 'OFFLINE') || this.nodes[0];

    const newNode = new ReplicaNode(id, name, role, region);
    if (dataSrc) {
      newNode.data = JSON.parse(JSON.stringify(dataSrc.data));
      newNode.walPosition = dataSrc.walPosition;
    }
    newNode.status = 'ONLINE';

    this.nodes.push(newNode);

    return {
      success: true,
      node: newNode,
      msg: `[Scaling] Scale Out: Added Replica Node "${name}" in region ${region.toUpperCase()}.`
    };
  }

  scaleIn() {
    let candidate = null;
    if (this.mode === 'master-slave') {
      const slaves = this.nodes.filter(n => n.role === 'slave');
      if (slaves.length === 0) {
        return {
          success: false,
          msg: `[Scaling] Scale In failed: Cannot remove the Primary Master node!`
        };
      }
      candidate = slaves[slaves.length - 1];
    } else {
      const primaries = this.nodes.filter(n => n.role === 'primary');
      if (primaries.length <= 1) {
        return {
          success: false,
          msg: `[Scaling] Scale In failed: A minimum of 1 Primary Node is required!`
        };
      }
      candidate = primaries[primaries.length - 1];
    }

    // Remove candidate
    this.nodes = this.nodes.filter(n => n.id !== candidate.id);
    
    // Clear pending replications for removed node
    this.pendingReplications = this.pendingReplications.filter(p => p.targetNodeId !== candidate.id);

    return {
      success: true,
      nodeId: candidate.id,
      msg: `[Scaling] Scale In: Removed node "${candidate.name}" in region ${candidate.region.toUpperCase()}.`
    };
  }

  getNodeStats() {
    return this.nodes.map(n => ({
      id: n.id,
      name: n.name,
      role: n.role,
      region: n.region,
      status: n.status,
      walPosition: n.walPosition,
      lag: n.lag,
      writes: n.writeCount,
      reads: n.readCount,
      conflicts: n.conflictCount,
      recordCount: Object.keys(n.data).length,
      pendingReplications: this.pendingReplications.filter(p => p.targetNodeId === n.id).length
    }));
  }

  reset() {
    this.seed();
  }
}
