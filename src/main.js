import './style.css';
import { initBackground, initBTreeScene, initQueryPlanScene, initReplicationScene, initOverviewScene, initShardingScene, updateBTree, updateQueryPlan, updateReplication, updateOverview, updateSharding, triggerShardPulse, setActiveScene, startAnimationLoop, handleResize as threeResize } from './three-scenes.js';
import { DashboardTracker } from './engine/dashboard.js';
import { BPlusTree } from './engine/btree.js';
import { ConnectionPool, QueryCache, QueryOptimizer, MOCK_DATABASE, setMockDatabase } from './engine/query.js';
import { Transaction, LockManager, WaitForGraph, WalManager } from './engine/concurrency.js';
import { BufferPoolManager } from './engine/buffer.js';
import { ShardingRouter } from './engine/sharding.js';
import { CqrsManager } from './engine/cqrs.js';
import { ReplicationManager } from './engine/replication.js';
import { DataAdapter } from './engine/dataAdapter.js';

// ----------------------------------------------------
// STATE INITIALIZATION
// ----------------------------------------------------
const tracker = new DashboardTracker();
const btree = new BPlusTree(3);
const connPool = new ConnectionPool(4);
const queryCache = new QueryCache();
const lockManager = new LockManager();
const waitForGraph = new WaitForGraph();
const wal = new WalManager();
const bufferPool = new BufferPoolManager(16);
const sharding = new ShardingRouter();
const cqrs = new CqrsManager();
const replication = new ReplicationManager();
const dataAdapter = new DataAdapter();

// Replication animation particles
let replParticles = []; // { fromX, fromY, toX, toY, progress, color }

// B+ Tree starts empty — populated by uploaded data

// Active Transaction state
const transactions = {
  T1: new Transaction('T1'),
  T2: new Transaction('T2'),
  T3: new Transaction('T3')
};

// Simulation settings
let isPlaying = true;
let simSpeed = 2; // 1: Slow, 2: Normal, 3: Fast, 4: High-Throughput, 5: Max Speed
let speedMultiplier = 1000; // time in ms between simulation events
let simTimer = null;
let currentScenario = 'default';
let activeTab = 'tab-query';
let activeBufferPolicy = 'Clock';
let uploadedDataStats = null; // Stores the stats from the last uploaded file

// ----------------------------------------------------
// DOM ELEMENTS REFERENCE
// ----------------------------------------------------
const dbStatusDot = document.getElementById('db-status-dot');
const dbStatusText = document.getElementById('db-status-text');
const tpsEl = document.getElementById('tps-rate');
const cacheHitEl = document.getElementById('cache-hit-ratio');
const lockConflictsEl = document.getElementById('lock-conflicts');
const clusterBalanceEl = document.getElementById('cluster-balance');
const btnTogglePlay = document.getElementById('btn-toggle-play');
const playIcon = document.getElementById('play-icon');
const playText = document.getElementById('play-text');
const btnResetEngine = document.getElementById('btn-reset-engine');
const speedSlider = document.getElementById('speed-slider');
const speedVal = document.getElementById('speed-val');
const logsBox = document.getElementById('console-logs-box');
const btnClearConsole = document.getElementById('btn-clear-console');

// Upload UI
const dbUploadZone = document.getElementById('db-upload-zone');
const dbFileInput = document.getElementById('db-file-input');
const btnBrowseFile = document.getElementById('btn-browse-file');
const uploadStatus = document.getElementById('upload-status');
const schemaPreview = document.getElementById('schema-preview');

// Canvases (lock canvas stays 2D; others replaced by Three.js containers)
const lockCanvas = document.getElementById('lock-canvas');

// Three.js 3D containers
const btree3d = document.getElementById('btree-3d');
const queryPlan3d = document.getElementById('queryplan-3d');
const replication3d = document.getElementById('replication-3d');
const overview3d = document.getElementById('overview-3d');
const sharding3d = document.getElementById('sharding-3d');
const bgParticles = document.getElementById('bg-particles');

// Forms & Inputs
const sqlInput = document.getElementById('sql-input');
const btnExplain = document.getElementById('btn-explain-query');
const btnRunQuery = document.getElementById('btn-run-query');
const checkUseIndex = document.getElementById('check-use-index');
const activeConnCount = document.getElementById('active-conn-count');
const connPoolVisual = document.getElementById('conn-pool-visual-list');
const connQueueCount = document.getElementById('conn-queue-count');
const cacheEntriesCount = document.getElementById('cache-entries-count');
const btnClearCache = document.getElementById('btn-clear-cache');

const btreeInputKey = document.getElementById('btree-input-key');
const btnBtreeInsert = document.getElementById('btn-btree-insert');
const btnBtreeSearch = document.getElementById('btn-btree-search');
const btnBtreeDelete = document.getElementById('btn-btree-delete');
const btreeTraceOutput = document.getElementById('btree-trace-output');

const walLogList = document.getElementById('wal-log-list');
const lockTableGrid = document.getElementById('lock-table-grid');

const bufferPoolGrid = document.getElementById('buffer-pool-grid');
const policyClock = document.getElementById('policy-clock');
const policyLru = document.getElementById('policy-lru');
const policyFifo = document.getElementById('policy-fifo');
const activePolicyLabel = document.getElementById('active-policy-label');
const bufferSweepLog = document.getElementById('buffer-sweep-log');

const shardStrategyRange = document.getElementById('shard-strategy-range');
const shardStrategyHash = document.getElementById('shard-strategy-hash');
const shardInsertKey = document.getElementById('shard-insert-key');
const shardInsertVal = document.getElementById('shard-insert-val');
const btnShardInsert = document.getElementById('btn-shard-insert');
const shardingRoutingLog = document.getElementById('sharding-routing-log');
const shardsNodesWrapper = document.getElementById('shards-nodes-wrapper');

const cqrsCommandUserId = document.getElementById('cqrs-command-userid');
const cqrsCommandField = document.getElementById('cqrs-command-field');
const cqrsCommandVal = document.getElementById('cqrs-command-val');
const btnCqrsCommand = document.getElementById('btn-cqrs-command');
const btnCqrsQuery = document.getElementById('btn-cqrs-query');
const cqrsLagSlider = document.getElementById('cqrs-lag-slider');
const cqrsLagVal = document.getElementById('cqrs-lag-val');
const cqrsPipelineLog = document.getElementById('cqrs-pipeline-log');
const cqrsSystemFlow = document.getElementById('cqrs-system-flow');

// Replication DOM
const replModeMs = document.getElementById('repl-mode-ms');
const replModeMp = document.getElementById('repl-mode-mp');
const replWriteNode = document.getElementById('repl-write-node');
const replWriteRecord = document.getElementById('repl-write-record');
const replWriteField = document.getElementById('repl-write-field');
const replWriteValue = document.getElementById('repl-write-value');
const btnReplWrite = document.getElementById('btn-repl-write');
const btnReplRead = document.getElementById('btn-repl-read');
const replNodeToggles = document.getElementById('repl-node-toggles');
const replLagSlider = document.getElementById('repl-lag-slider');
const replLagVal = document.getElementById('repl-lag-val');
const replWalLog = document.getElementById('repl-wal-log');
const btnScaleOut = document.getElementById('btn-scale-out');
const btnScaleIn = document.getElementById('btn-scale-in');
const scaleInfoText = document.getElementById('scale-info-text');

// Overview DOM
const overviewStatsRibbon = document.getElementById('overview-stats-ribbon');

// ----------------------------------------------------
// TELEMETRY & EVENT LOGGING HELPER
// ----------------------------------------------------
function logConsole(tag, text, type = 'engine') {
  const time = new Date().toLocaleTimeString();
  const entry = document.createElement('div');
  entry.className = 'log-entry';
  entry.innerHTML = `
    <span class="log-time">[${time}]</span>
    <span class="log-text log-tag-${type}">[${tag}] ${text}</span>
  `;
  logsBox.appendChild(entry);
  logsBox.scrollTop = logsBox.scrollHeight;
}

function checkUploaded(actionName) {
  if (!uploadedDataStats) {
    logConsole('SECURITY', `Blocked "${actionName}": Please upload a database file first!`, 'engine');
    return false;
  }
  return true;
}

function updateTelemetryDisplay() {
  tpsEl.textContent = tracker.tps.toFixed(1);
  cacheHitEl.textContent = tracker.getCacheHitRatio() + '%';
  lockConflictsEl.textContent = tracker.getLockConflictRate() + '%';
  clusterBalanceEl.textContent = tracker.getShardBalancing();
}

// ----------------------------------------------------
// TABS SWITCHING
// ----------------------------------------------------
const tabsNav = document.getElementById('tabs-navigation');
const tabButtons = tabsNav.querySelectorAll('.tab-btn');
const tabContents = document.querySelectorAll('.tab-content');

tabButtons.forEach(btn => {
  btn.addEventListener('click', () => {
    tabButtons.forEach(b => b.classList.remove('active'));
    tabContents.forEach(c => c.classList.remove('active'));
    
    btn.classList.add('active');
    const targetTab = btn.getAttribute('data-tab');
    document.getElementById(targetTab).classList.add('active');
    activeTab = targetTab;
    
    // Set Canvas Dimensions
    resizeCanvases();
    // Render immediate
    renderActiveTabVisuals();
  });
});

function resizeCanvases() {
  // Resize lock canvas (only remaining 2D canvas)
  if (lockCanvas && lockCanvas.parentElement) {
    lockCanvas.width = lockCanvas.parentElement.clientWidth;
    lockCanvas.height = lockCanvas.parentElement.clientHeight || 400;
  }
  // Resize Three.js scenes
  threeResize();
}
window.addEventListener('resize', () => {
  resizeCanvases();
  renderActiveTabVisuals();
});

// ----------------------------------------------------
// CANVAS DRAWING HELPERS
// ----------------------------------------------------

// 1. Draw Arrow helper
function drawArrow(ctx, fromx, fromy, tox, toy, color = '#57606a', lineWidth = 1) {
  const headlen = 8;
  const angle = Math.atan2(toy - fromy, tox - fromx);
  ctx.strokeStyle = color;
  ctx.lineWidth = lineWidth;
  ctx.beginPath();
  ctx.moveTo(fromx, fromy);
  ctx.lineTo(tox, toy);
  ctx.stroke();

  ctx.beginPath();
  ctx.fillStyle = color;
  ctx.moveTo(tox, toy);
  ctx.lineTo(tox - headlen * Math.cos(angle - Math.PI / 6), toy - headlen * Math.sin(angle - Math.PI / 6));
  ctx.lineTo(tox - headlen * Math.cos(angle + Math.PI / 6), toy - headlen * Math.sin(angle + Math.PI / 6));
  ctx.fill();
}

// 2. Render Query Execution Tree (Volcano Model)
let queryAnimationStep = 0;
let queryAnimationTimer = null;
let queryActivePlan = null;
let flowRows = []; // array of floating dots: { x, y, targetX, targetY, val, progress }

function renderQueryPlan() {
  if (!queryActivePlan) {
    updateQueryPlan([]);
    return;
  }

  // Build plan nodes for Three.js
  const nodes = [];
  const ast = queryActivePlan.ast;
  const projFields = ast.fields ? ast.fields.map(f => f.split('.').pop()).join(', ') : '*';
  const whereLabel = ast.where && ast.where !== 'no filter' ? ast.where : null;

  if (ast.from.length >= 2 && ast.join) {
    const isIndex = checkUseIndex.checked;
    nodes.push({ type: 'Projection', label: `Projection(${projFields})` });
    nodes.push({ type: 'HashJoin', label: `HashJoin(${ast.join})` });
    nodes.push({ type: 'Filter', label: `Filter(${whereLabel || 'pass'})${isIndex ? ' via IndexScan' : ''}` });
    nodes.push({ type: 'SeqScan', label: `SeqScan(${ast.from[0]})` });
    nodes.push({ type: isIndex ? 'Sort' : 'SeqScan', label: isIndex ? `IndexScan(${ast.from[1]}.idx)` : `SeqScan(${ast.from[1]})` });
  } else {
    const tableName = ast.from[0] || 'table';
    nodes.push({ type: 'Projection', label: `Projection(${projFields})` });
    nodes.push({ type: 'Filter', label: `Filter(${whereLabel || 'pass'})` });
    nodes.push({ type: 'SeqScan', label: `SeqScan(${tableName})` });
  }

  updateQueryPlan(nodes);
}


function animateQueryPipelineFlow() {
  if (!queryActivePlan) return;
  
  // Volcano model output iteration
  queryActivePlan.root.open();
  flowRows = [];
  
  const pushRowFlow = () => {
    const { value, done } = queryActivePlan.root.next();
    if (!done && isPlaying) {
      tracker.recordTxStart();
      tracker.recordTxSuccess();
      updateTelemetryDisplay();
      logConsole('QUERY PIPELINE', `Operator next() yielded row: ${JSON.stringify(value)}`, 'query');
      setTimeout(pushRowFlow, 1000 / simSpeed);
    } else {
      queryActivePlan.root.close();
      logConsole('QUERY PIPELINE', `Iterator exhausted. Call to close() completed.`, 'query');
    }
  };

  pushRowFlow();
}


// 3. Render B+ Tree on Canvas
let highlightedNodeId = null;

function renderBTree() {
  updateBTree(btree.root);
}


// Play insertion tracing step by step
function animateBTreeTrace(trace) {
  let stepIdx = 0;
  
  const playStep = () => {
    if (stepIdx >= trace.length) {
      highlightedNodeId = null;
      renderBTree();
      return;
    }
    
    const step = trace[stepIdx];
    
    if (step.nodeId) {
      highlightedNodeId = step.nodeId;
      btreeTraceOutput.innerHTML += `<div style="margin-bottom: 4px; color:${step.action === 'target_leaf' ? '#39ff14' : '#fff'}">> [${step.action.toUpperCase()}] page: ${step.nodeId} (keys: ${step.keys.join(',')}) ${step.decision || ''}</div>`;
      btreeTraceOutput.scrollTop = btreeTraceOutput.scrollHeight;
      
      logConsole('INDEX MANAGER', `Traversing node ${step.nodeId} (keys: ${step.keys.join(',')})`, 'engine');
    } else if (step.action === 'split_leaf_done' || step.action === 'split_internal_done') {
      logConsole('INDEX MANAGER', `Split completed. Promoted key: ${step.promotedKey} to parent`, 'engine');
      btreeTraceOutput.innerHTML += `<div style="color:#ff007f">> [SPLIT] Promoted Key ${step.promotedKey} to Parent. Created sibling ${step.siblingId || step.siblingKeys}</div>`;
    } else if (step.action === 'new_root') {
      logConsole('INDEX MANAGER', `Tree height increased. New Root page: ${step.nodeId}`, 'engine');
      btreeTraceOutput.innerHTML += `<div style="color:#8a2be2">> [NEW ROOT] Node ${step.nodeId} created as root</div>`;
    }

    renderBTree();
    stepIdx++;
    setTimeout(playStep, 800 / simSpeed);
  };
  
  btreeTraceOutput.innerHTML = '';
  playStep();
}

// 4. Render Transaction Wait-For Graph
function renderLockGraph() {
  const ctx = lockCanvas.getContext('2d');
  ctx.clearRect(0, 0, lockCanvas.width, lockCanvas.height);

  // Position nodes in a clean circle
  const nodes = {
    T1: { name: 'T1 (Admin)', x: lockCanvas.width / 4, y: lockCanvas.height / 2, color: '#1f8eed' },
    T2: { name: 'T2 (User_1)', x: lockCanvas.width / 2, y: lockCanvas.height / 4, color: '#ff9f1c' },
    T3: { name: 'T3 (User_2)', x: (3 * lockCanvas.width) / 4, y: lockCanvas.height / 2, color: '#8a2be2' }
  };

  // Re-build wait for graph
  waitForGraph.build(transactions, lockManager);
  const cycle = waitForGraph.findCycle();

  // Draw edges
  Object.entries(waitForGraph.adj).forEach(([fromNode, toNodes]) => {
    toNodes.forEach(toNode => {
      const fromPt = nodes[fromNode];
      const toPt = nodes[toNode];
      if (fromPt && toPt) {
        // Check if edge is in deadlock cycle
        const isInCycle = cycle && cycle.includes(fromNode) && cycle.includes(toNode);
        const edgeColor = isInCycle ? '#ff003c' : 'rgba(255, 255, 255, 0.15)';
        const edgeWidth = isInCycle ? 2.5 : 1.5;
        
        drawArrow(ctx, fromPt.x, fromPt.y, toPt.x, toPt.y, edgeColor, edgeWidth);
      }
    });
  });

  // Draw Nodes
  Object.entries(nodes).forEach(([txId, n]) => {
    const tx = transactions[txId];
    const isActive = tx.status === 'ACTIVE';
    const isBlocked = tx.status === 'BLOCKED';
    const isAborted = tx.status === 'ABORTED';
    
    // Draw outer glow border for nodes in cycle
    const isInCycle = cycle && cycle.includes(txId);
    
    ctx.fillStyle = 'rgba(13, 18, 31, 0.95)';
    ctx.strokeStyle = isInCycle ? '#ff003c' : (isBlocked ? '#ff9f1c' : '#39ff14');
    ctx.lineWidth = isInCycle ? 3 : 2;
    
    ctx.beginPath();
    ctx.arc(n.x, n.y, 35, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();

    // Title text
    ctx.fillStyle = '#f0f6fc';
    ctx.font = '10px Orbitron';
    ctx.textAlign = 'center';
    ctx.fillText(txId, n.x, n.y - 8);

    // Status text
    ctx.fillStyle = isBlocked ? '#ff9f1c' : (isAborted ? '#ff003c' : '#8b949e');
    ctx.font = '8px JetBrains Mono';
    ctx.fillText(tx.status, n.x, n.y + 6);

    // Held locks count
    ctx.fillStyle = '#00f2fe';
    ctx.font = '8px JetBrains Mono';
    ctx.fillText(`Locks: ${tx.heldLocks.length}`, n.x, n.y + 18);
  });

  if (cycle) {
    ctx.fillStyle = '#ff003c';
    ctx.font = '12px Orbitron';
    ctx.textAlign = 'center';
    ctx.fillText(`DEADLOCK DETECTED: [${cycle.join(' -> ')}]`, lockCanvas.width / 2, (7 * lockCanvas.height) / 8);
  }
}

// Dynamic updates to Transaction table
function updateLockTableGrid() {
  const tbody = lockTableGrid.querySelector('tbody');
  tbody.innerHTML = '';
  
  for (const [res, lock] of Object.entries(lockManager.locks)) {
    const tr = document.createElement('tr');
    tr.innerHTML = `
      <td><strong>${res}</strong></td>
      <td style="color:${lock.type === 'X' ? '#ff9f1c' : '#00f2fe'}">${lock.type || '-'}</td>
      <td>${lock.holders.join(', ') || '-'}</td>
      <td style="color:#ff9f1c">${lock.waiters.map(w => `${w.txId}(${w.mode})`).join(', ') || '-'}</td>
    `;
    tbody.appendChild(tr);
  }
}

// ----------------------------------------------------
// UI DATA BINDERS & TAB RENDERS
// ----------------------------------------------------
function renderActiveTabVisuals() {
  if (activeTab === 'tab-query') {
    setActiveScene('queryplan');
    renderQueryPlan();
  } else if (activeTab === 'tab-btree') {
    setActiveScene('btree');
    renderBTree();
  } else if (activeTab === 'tab-locks') {
    setActiveScene(null);
    renderLockGraph();
    updateLockTableGrid();
  } else if (activeTab === 'tab-buffer') {
    setActiveScene(null);
    renderBufferPool();
  } else if (activeTab === 'tab-sharding') {
    setActiveScene('sharding');
    renderShardingNodes();
  } else if (activeTab === 'tab-cqrs') {
    setActiveScene(null);
    renderCqrsFlow();
  } else if (activeTab === 'tab-replication') {
    setActiveScene('replication');
    renderReplicationTopology();
  } else if (activeTab === 'tab-overview') {
    setActiveScene('overview');
    renderSystemOverview();
  }
}

// Buffer pool grid DOM renderer
function renderBufferPool() {
  bufferPoolGrid.innerHTML = '';
  
  bufferPool.frames.forEach((frame, idx) => {
    const card = document.createElement('div');
    card.className = `buffer-frame-card`;
    
    // Highlight if clock hand is pointing here
    if (idx === bufferPool.clockHand && activeBufferPolicy === 'Clock') {
      card.classList.add('active-sweep');
    }

    card.innerHTML = `
      <div class="buffer-frame-header">Slot #${idx}</div>
      <div class="buffer-frame-row">
        <span>Page ID:</span>
        <span style="color:${frame.pageId !== null ? '#39ff14' : '#57606a'}">${frame.pageId !== null ? `Page ${frame.pageId}` : 'EMPTY'}</span>
      </div>
      <div class="buffer-frame-row">
        <span>Pin Count:</span>
        <span style="color:${frame.pinCount > 0 ? '#ff9f1c' : '#8b949e'}">${frame.pinCount}</span>
      </div>
      <div class="buffer-frame-row">
        <span>Dirty:</span>
        <span style="color:${frame.dirty ? '#ff007f' : '#8b949e'}">${frame.dirty ? 'DIRTY' : 'CLEAN'}</span>
      </div>
      <div class="buffer-frame-row">
        <span>Ref Bit:</span>
        <span style="color:${frame.refBit === 1 ? '#00f2fe' : '#8b949e'}">${frame.refBit}</span>
      </div>
    `;
    bufferPoolGrid.appendChild(card);
  });
}

// Sharding router layout renderer
function renderShardingNodes() {
  shardsNodesWrapper.innerHTML = '';
  const metrics = sharding.getMetrics();
  
  // Update Three.js 3D visualization
  const shardsList = Object.values(sharding.shards).map(shard => {
    return {
      id: shard.id,
      name: shard.name,
      keysLength: shard.keys.length
    };
  });
  updateSharding(shardsList);
  
  Object.values(sharding.shards).forEach(shard => {
    const data = metrics[shard.id];
    const card = document.createElement('div');
    card.className = `shard-node-card`;
    
    // Calculate percentage load based on capacity of 8
    const loadPercent = Math.min(100, Math.round((shard.keys.length / 8) * 100));
    
    card.innerHTML = `
      <div class="shard-node-header">
        <h4 class="shard-node-title">${shard.id} (${shard.name})</h4>
        <div class="shard-node-indicator" style="background: ${shard.keys.length > 8 ? 'var(--accent-orange)' : 'var(--accent-green)'}; box-shadow: 0 0 8px ${shard.keys.length > 8 ? 'var(--accent-orange)' : 'var(--accent-green)'}"></div>
      </div>
      <div style="font-size:0.75rem; font-family:var(--font-mono); margin-top:8px;">
        <div>Strategy: <strong>${sharding.strategy} sharding</strong></div>
        <div style="margin-top:4px;">Allocated Keys Count: <strong style="color:var(--accent-cyan);">${data.count}</strong> (${data.percentage}%)</div>
        <div style="margin-top:4px; font-size:0.65rem; color:var(--text-secondary); word-break:break-all;">Keys: [${data.keys.join(', ')}]</div>
      </div>
      <div>
        <div style="display:flex; justify-content:space-between; font-size:0.65rem; color:var(--text-secondary); margin-top:8px;">
          <span>Node Load</span>
          <span>${loadPercent}%</span>
        </div>
        <div class="progress-bar-container">
          <div class="progress-bar-fill" style="width: ${loadPercent}%;"></div>
        </div>
      </div>
    `;
    shardsNodesWrapper.appendChild(card);
  });
}

// CQRS workflow visuals renderer
function renderCqrsFlow() {
  cqrsSystemFlow.innerHTML = '';
  
  const wrapper = document.createElement('div');
  wrapper.style.display = 'flex';
  wrapper.style.flexDirection = 'column';
  wrapper.style.gap = '20px';
  wrapper.style.height = '100%';
  
  // Determine column keys dynamically from writeDB
  const writeRecords = Object.values(cqrs.writeDB);
  const allKeys = writeRecords.length > 0 ? Object.keys(writeRecords[0]) : ['id', 'username', 'level', 'status'];
  
  // Write side column vs Event Queue vs Read side column
  const mainRow = document.createElement('div');
  mainRow.className = 'cqrs-architecture-row';
  
  // Write Model Column
  const writeCol = document.createElement('div');
  writeCol.className = 'cqrs-db-box';
  writeCol.innerHTML = `
    <h4 class="cqrs-db-title">Transactional Write DB (Master)</h4>
    <div style="overflow-y:auto; flex:1; max-height:200px;">
      <table class="data-table">
        <thead>
          <tr>${allKeys.map(k => `<th>${k}</th>`).join('')}</tr>
        </thead>
        <tbody>
          ${writeRecords.map(u => `
            <tr>
              ${allKeys.map(k => {
                const val = u[k];
                const color = val === 'Active' ? '#39ff14' : (val === 'Offline' || val === 'Suspended' ? '#ff003c' : 'inherit');
                return `<td style="color:${color}">${val !== null && val !== undefined ? val : '-'}</td>`;
              }).join('')}
            </tr>
          `).join('')}
        </tbody>
      </table>
    </div>
  `;
  
  // Event queue
  const eventBusCol = document.createElement('div');
  eventBusCol.className = 'cqrs-event-bus';
  eventBusCol.innerHTML = `
    <h4 class="cqrs-bus-title">Kafka Log</h4>
    <div style="font-size:0.6rem; color:var(--text-muted); margin-bottom:8px;">Broker Queue</div>
    <div style="display:flex; flex-direction:column; gap:4px; max-height:160px; overflow-y:auto; width:100%;">
      ${cqrs.eventQueue.length === 0 ? '<div style="color:var(--text-muted);font-size:0.7rem;">Queue Empty</div>' : 
        cqrs.eventQueue.map(e => `
          <div class="event-ticker-bubble">${e.id}: sync ${e.userId}.${e.field}</div>
        `).join('')
      }
    </div>
  `;
  
  // Read side
  const readRecords = Object.values(cqrs.readDB);
  const readCol = document.createElement('div');
  readCol.className = 'cqrs-db-box';
  readCol.innerHTML = `
    <h4 class="cqrs-db-title">Query Read DB (Denormalized)</h4>
    <div style="overflow-y:auto; flex:1; max-height:200px;">
      <table class="data-table">
        <thead>
          <tr>${allKeys.map(k => `<th>${k}</th>`).join('')}</tr>
        </thead>
        <tbody>
          ${readRecords.map(u => {
            const isStale = JSON.stringify(u) !== JSON.stringify(cqrs.writeDB[u.id]);
            return `
              <tr style="${isStale ? 'background:rgba(255, 0, 127, 0.05); border:1px solid var(--accent-magenta);' : ''}">
                ${allKeys.map(k => {
                  const val = u[k];
                  const color = val === 'Active' ? '#39ff14' : (val === 'Offline' || val === 'Suspended' ? '#ff003c' : 'inherit');
                  return `<td style="color:${color}">${val !== null && val !== undefined ? val : '-'}${k === allKeys[allKeys.length - 1] && isStale ? ' <strong style="color:var(--accent-magenta); font-size:0.6rem;">[STALE]</strong>' : ''}</td>`;
                }).join('')}
              </tr>
            `;
          }).join('')}
        </tbody>
      </table>
    </div>
  `;

  mainRow.appendChild(writeCol);
  mainRow.appendChild(eventBusCol);
  mainRow.appendChild(readCol);
  
  wrapper.appendChild(mainRow);
  cqrsSystemFlow.appendChild(wrapper);
}

// ----------------------------------------------------
// REPLICATION TOPOLOGY RENDERER
// ----------------------------------------------------
function renderReplicationTopology() {
  const stats = replication.getNodeStats();
  updateReplication(stats);
  // Keep particle lifecycle for logic (spawned by spawnReplParticle)
  replParticles = replParticles.filter(p => {
    p.progress += 0.025 * simSpeed;
    return p.progress < 1;
  });
}



function updateReplNodeToggles() {
  replNodeToggles.innerHTML = '';
  replication.nodes.forEach(node => {
    const btn = document.createElement('button');
    btn.className = `btn ${node.status === 'OFFLINE' ? 'btn-danger' : ''}`;
    btn.style.fontSize = '0.7rem';
    btn.style.padding = '6px 10px';
    btn.innerHTML = `${node.name}: <strong>${node.status}</strong> ${node.role === 'slave' && node.status !== 'OFFLINE' ? '| <span style="color:var(--accent-green); cursor:pointer;" data-promote="'+node.id+'">Promote</span>' : ''}`;
    btn.addEventListener('click', () => {
      if (!checkUploaded('Toggle replication node')) return;
      const result = replication.toggleNodeStatus(node.id);
      logConsole('FAILOVER', result.msg, 'replication');
      updateReplNodeToggles();
      updateReplWriteNodeOptions();
      renderReplicationTopology();
    });
    replNodeToggles.appendChild(btn);

    // If slave, add promote button
    if (node.role === 'slave' && node.status !== 'OFFLINE' && replication.mode === 'master-slave') {
      const promBtn = document.createElement('button');
      promBtn.className = 'btn';
      promBtn.style.fontSize = '0.6rem';
      promBtn.style.padding = '4px 8px';
      promBtn.style.marginTop = '-4px';
      promBtn.textContent = `↑ Promote ${node.id} to Master`;
      promBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        if (!checkUploaded('Promote replica to master')) return;
        const result = replication.promoteSlave(node.id);
        logConsole('FAILOVER', result.msg, 'replication');
        updateReplNodeToggles();
        updateReplWriteNodeOptions();
        renderReplicationTopology();
      });
      replNodeToggles.appendChild(promBtn);
    }
  });
}

function updateReplWriteNodeOptions() {
  replWriteNode.innerHTML = '';
  if (replication.mode === 'master-slave') {
    const master = replication.nodes.find(n => n.role === 'master');
    const opt = document.createElement('option');
    opt.value = master ? master.id : 'auto';
    opt.textContent = master ? `${master.name} (Master)` : 'No Master';
    replWriteNode.appendChild(opt);
  } else {
    replication.nodes.forEach(n => {
      const opt = document.createElement('option');
      opt.value = n.id;
      opt.textContent = `${n.name} (${n.region})`;
      replWriteNode.appendChild(opt);
    });
  }
}

function addReplWalEntry(text, color = '#8b949e') {
  const div = document.createElement('div');
  div.className = 'repl-wal-entry new-entry';
  div.innerHTML = `<span style="color:${color}">${text}</span>`;
  replWalLog.appendChild(div);
  replWalLog.scrollTop = replWalLog.scrollHeight;
  // Keep max 40 entries
  while (replWalLog.children.length > 40) replWalLog.removeChild(replWalLog.firstChild);
}

// Spawn particles for replication animation
function spawnReplParticle(fromNodeIdx, toNodeIdx, color = '#00f2fe') {
  // Safe placeholder: 3D scene handles replication beams automatically
}

// ----------------------------------------------------
// SYSTEM OVERVIEW RENDERER
// ----------------------------------------------------
let overviewAnimFrame = 0;

function renderSystemOverview() {
  // Stats ribbon
  const btreeNodeCount = countBTreeNodes(btree.root);
  const bufferUsed = bufferPool.frames.filter(f => f.pageId !== null).length;
  const replNodes = replication.nodes.filter(n => n.status !== 'OFFLINE').length;
  const totalReplNodes = replication.nodes.length;
  const shardTotal = Object.values(sharding.shards).reduce((s, sh) => s + sh.keys.length, 0);
  const walEntries = wal.logs.length;
  const cqrsPending = cqrs.eventQueue.length;

  overviewStatsRibbon.innerHTML = `
    <div class="overview-stat-cell">
      <div class="overview-stat-title">TPS</div>
      <div class="overview-stat-num" style="color:var(--accent-cyan)">${tracker.tps.toFixed(1)}</div>
    </div>
    <div class="overview-stat-cell">
      <div class="overview-stat-title">B+ Tree Nodes</div>
      <div class="overview-stat-num" style="color:var(--accent-green)">${btreeNodeCount}</div>
    </div>
    <div class="overview-stat-cell">
      <div class="overview-stat-title">Buffer Usage</div>
      <div class="overview-stat-num" style="color:var(--accent-magenta)">${bufferUsed}/16</div>
    </div>
    <div class="overview-stat-cell">
      <div class="overview-stat-title">Replica Nodes</div>
      <div class="overview-stat-num" style="color:var(--accent-purple)">${replNodes}/${totalReplNodes}</div>
    </div>
    <div class="overview-stat-cell">
      <div class="overview-stat-title">Shard Records</div>
      <div class="overview-stat-num" style="color:var(--accent-orange)">${shardTotal}</div>
    </div>
    <div class="overview-stat-cell">
      <div class="overview-stat-title">WAL Entries</div>
      <div class="overview-stat-num" style="color:var(--accent-blue)">${walEntries}</div>
    </div>
  `;

  // Use the Three.js overview update function
  updateOverview({
    txCount: tracker.txSuccess + tracker.txAbort,
    bufferHitRate: tracker.getCacheHitRatio()
  });
}

function countBTreeNodes(node) {
  if (!node) return 0;
  let count = 1;
  if (!node.isLeaf && node.children) {
    for (const child of node.children) {
      count += countBTreeNodes(child);
    }
  }
  return count;
}

// ----------------------------------------------------
// SCENARIO AND INTERACTIVE CONTROL BINDINGS
// ----------------------------------------------------

// Speed control slider
speedSlider.addEventListener('input', (e) => {
  simSpeed = parseInt(e.target.value);
  
  let label = '1x';
  if (simSpeed === 1) { label = '0.5x'; speedMultiplier = 1800; }
  else if (simSpeed === 2) { label = '1x'; speedMultiplier = 1000; }
  else if (simSpeed === 3) { label = '2x'; speedMultiplier = 500; }
  else if (simSpeed === 4) { label = '5x'; speedMultiplier = 200; }
  else if (simSpeed === 5) { label = '10x'; speedMultiplier = 80; }
  
  speedVal.textContent = label;
  logConsole('SIMULATOR', `Simulation engine speed updated to ${label}`, 'engine');
});

// Explain query / Execute Query buttons
btnExplain.addEventListener('click', () => {
  if (!checkUploaded('Explain Query')) return;
  const sql = sqlInput.value;
  try {
    const isIndex = checkUseIndex.checked;
    queryActivePlan = QueryOptimizer.createPlan(sql, isIndex);
    
    // Draw AST and optimizer logs
    logConsole('SQL OPTIMIZER', `Parsed AST generated: ${JSON.stringify(queryActivePlan.ast)}`, 'query');
    logConsole('SQL OPTIMIZER', `Logical Optimization completed. Pushed filters down. Created Physical Plan tree.`, 'query');
    
    renderActiveTabVisuals();
  } catch (err) {
    logConsole('SQL ERROR', err.message, 'query');
  }
});

btnRunQuery.addEventListener('click', () => {
  if (!checkUploaded('Run Query')) return;
  const sql = sqlInput.value;
  try {
    const isIndex = checkUseIndex.checked;
    
    // Check cache
    const cacheCheck = queryCache.check(sql);
    if (cacheCheck.hit) {
      logConsole('QUERY CACHE', `CACHE HIT: Returning cached result set. Execution skipped!`, 'query');
      tracker.recordBufferHit();
      updateTelemetryDisplay();
      return;
    }
    
    queryActivePlan = QueryOptimizer.createPlan(sql, isIndex);
    logConsole('QUERY EXECUTOR', `Dispatching plan run inside Database Engine. Connection reserved.`, 'query');
    
    // Queue inside connection pool
    connPool.request(sql, (client) => {
      logConsole('CONNECTION POOL', `Connection granted for ${client.id} to run query.`, 'query');
      
      // Update pool visuals
      updateConnectionPoolUI();
      
      // Animate flowing lines
      animateQueryPipelineFlow();
      
      // Release client connection after duration
      setTimeout(() => {
        connPool.release(client.id);
        updateConnectionPoolUI();
        
        // Populate cache
        queryCache.set(sql, { status: 'Executed' });
        cacheEntriesCount.textContent = queryCache.cache.size;
      }, 3000 / simSpeed);
    });
    
    updateConnectionPoolUI();
  } catch (err) {
    logConsole('SQL ERROR', err.message, 'query');
  }
});

function updateConnectionPoolUI() {
  activeConnCount.textContent = `${connPool.active.length}/${connPool.maxSize}`;
  connQueueCount.textContent = `${connPool.queue.length} waiting`;
  
  connPoolVisual.innerHTML = '';
  connPool.active.forEach(c => {
    const indicator = document.createElement('div');
    indicator.style.background = 'var(--accent-green)';
    indicator.style.color = 'var(--bg-primary)';
    indicator.style.fontSize = '0.65rem';
    indicator.style.padding = '4px 8px';
    indicator.style.borderRadius = '4px';
    indicator.style.fontFamily = 'var(--font-mono)';
    indicator.textContent = c.id;
    connPoolVisual.appendChild(indicator);
  });
  
  connPool.queue.forEach(c => {
    const indicator = document.createElement('div');
    indicator.style.background = 'var(--accent-orange)';
    indicator.style.color = 'var(--bg-primary)';
    indicator.style.fontSize = '0.65rem';
    indicator.style.padding = '4px 8px';
    indicator.style.borderRadius = '4px';
    indicator.style.fontFamily = 'var(--font-mono)';
    indicator.textContent = c.id;
    connPoolVisual.appendChild(indicator);
  });
}

btnClearCache.addEventListener('click', () => {
  queryCache.clear();
  cacheEntriesCount.textContent = 0;
  logConsole('QUERY CACHE', `Query results cache wiped.`, 'query');
});

// B+ Tree playground bindings
btnBtreeInsert.addEventListener('click', () => {
  if (!checkUploaded('B+ Tree Insert')) return;
  const key = parseInt(btreeInputKey.value);
  if (isNaN(key)) return;
  
  btreeTraceOutput.innerHTML = `Inserting key ${key}...<br>`;
  const trace = btree.insert(key, `val_${key}`);
  animateBTreeTrace(trace);
  
  logConsole('INDEX MANAGER', `Inserting Key: ${key} to B+ Tree Index`, 'engine');
});

btnBtreeSearch.addEventListener('click', () => {
  if (!checkUploaded('B+ Tree Search')) return;
  const key = parseInt(btreeInputKey.value);
  if (isNaN(key)) return;
  
  btreeTraceOutput.innerHTML = `Searching key ${key}...<br>`;
  const { found, trace } = btree.search(key);
  animateBTreeTrace(trace);
  
  logConsole('INDEX MANAGER', `Searching Key: ${key} in B+ Tree Index (Found: ${found})`, 'engine');
});

btnBtreeDelete.addEventListener('click', () => {
  if (!checkUploaded('B+ Tree Delete')) return;
  const key = parseInt(btreeInputKey.value);
  if (isNaN(key)) return;
  
  btreeTraceOutput.innerHTML = `Deleting key ${key}...<br>`;
  const trace = btree.delete(key);
  animateBTreeTrace(trace);
  
  logConsole('INDEX MANAGER', `Deleting Key: ${key} from B+ Tree Index`, 'engine');
});

// Buffer page cache algorithm switch
policyClock.addEventListener('click', () => {
  activeBufferPolicy = 'Clock';
  updateBufferPolicyUI();
});
policyLru.addEventListener('click', () => {
  activeBufferPolicy = 'LRU';
  updateBufferPolicyUI();
});
policyFifo.addEventListener('click', () => {
  activeBufferPolicy = 'FIFO';
  updateBufferPolicyUI();
});

function updateBufferPolicyUI() {
  [policyClock, policyLru, policyFifo].forEach(btn => btn.classList.remove('btn-primary'));
  activePolicyLabel.textContent = `Active Policy: ${activeBufferPolicy.toUpperCase()}`;
  
  if (activeBufferPolicy === 'Clock') policyClock.classList.add('btn-primary');
  if (activeBufferPolicy === 'LRU') policyLru.classList.add('btn-primary');
  if (activeBufferPolicy === 'FIFO') policyFifo.classList.add('btn-primary');
  
  logConsole('BUFFER POOL', `Eviction policy changed to ${activeBufferPolicy}`, 'buffer');
  renderBufferPool();
}

// Sharding actions
shardStrategyRange.addEventListener('click', () => {
  sharding.strategy = 'Range';
  shardStrategyRange.classList.add('btn-primary');
  shardStrategyHash.classList.remove('btn-primary');
  shardingRoutingLog.innerHTML = 'Strategy changed to Range Partitioning.<br>';
  logConsole('QUERY PROXY', 'Routing strategy configured to RANGE.', 'sharding');
  renderShardingNodes();
});

shardStrategyHash.addEventListener('click', () => {
  sharding.strategy = 'Hash';
  shardStrategyHash.classList.add('btn-primary');
  shardStrategyRange.classList.remove('btn-primary');
  shardingRoutingLog.innerHTML = 'Strategy changed to Hash Partitioning.<br>';
  logConsole('QUERY PROXY', 'Routing strategy configured to HASH.', 'sharding');
  renderShardingNodes();
});

btnShardInsert.addEventListener('click', () => {
  if (!checkUploaded('Shard Insert')) return;
  const key = parseInt(shardInsertKey.value);
  const val = shardInsertVal.value;
  if (isNaN(key) || !val) return;
  
  const result = sharding.insert(key, val);
  const { target, steps, autoSharded, rebalanceLogs } = result;
  
  // Trigger 3D pulse
  triggerShardPulse(target, sharding.strategy === 'Range' ? 0x00f2fe : 0x8a2be2);
  
  // Highlight target shard card
  const cards = shardsNodesWrapper.querySelectorAll('.shard-node-card');
  const shardIdx = Object.keys(sharding.shards).indexOf(target);
  if (shardIdx !== -1 && cards[shardIdx]) {
    cards[shardIdx].classList.add('active-route');
    setTimeout(() => cards[shardIdx].classList.remove('active-route'), 1200);
  }

  if (sharding.shards[target].queries === undefined) {
    sharding.shards[target].queries = 0;
  }
  sharding.shards[target].queries++;

  let trackerShard = tracker.shards.find(s => s.id === target);
  if (!trackerShard) {
    trackerShard = { id: target, load: 0, queries: 0 };
    tracker.shards.push(trackerShard);
  }
  trackerShard.queries += 2;
  
  updateTelemetryDisplay();
  
  shardingRoutingLog.innerHTML = steps.map(s => `>> ${s}`).join('<br>') + '<br>';
  if (autoSharded) {
    shardingRoutingLog.innerHTML += `<div style="color:var(--accent-orange); margin-top:8px;">${rebalanceLogs.map(l => `>> ${l}`).join('<br>')}</div>`;
    rebalanceLogs.forEach(l => logConsole('AUTO-SHARD', l, 'sharding'));
  }
  shardingRoutingLog.scrollTop = shardingRoutingLog.scrollHeight;
  
  logConsole('SHARD ROUTER', `Routed Write Key ${key} to shard ${target}`, 'sharding');
  renderShardingNodes();
});

// CQRS Actions
btnCqrsCommand.addEventListener('click', () => {
  if (!checkUploaded('CQRS Write Command')) return;
  const userId = cqrsCommandUserId.value;
  const field = cqrsCommandField.value;
  const val = cqrsCommandVal.value;
  if (!val) return;
  
  const { success, event, steps } = cqrs.executeCommand(userId, field, val);
  
  cqrsPipelineLog.innerHTML = steps.map(s => `>> ${s}`).join('<br>') + '<br>';
  if (success) {
    logConsole('COMMAND GATEWAY', `Write Command committed: user ${userId}.${field} = "${event.newValue}"`, 'cqrs');
    renderCqrsFlow();
  } else {
    logConsole('COMMAND GATEWAY', `Command failed: validation error on user ${userId}.${field}`, 'cqrs');
  }
});

btnCqrsQuery.addEventListener('click', () => {
  if (!checkUploaded('CQRS Read Query')) return;
  const userId = cqrsCommandUserId.value;
  const { record, isStale, steps } = cqrs.executeQuery(userId);
  
  tracker.cqrsTotalReads++;
  if (isStale) {
    tracker.cqrsStaleReads++;
    logConsole('EVENTUAL CONSISTENCY', `STALE READ DETECTED: Read returned stale value from Read Model cache!`, 'cqrs');
  } else {
    logConsole('QUERY GATEWAY', `Read success: strongly consistent value returned from Read DB.`, 'cqrs');
  }
  
  cqrsPipelineLog.innerHTML = steps.map(s => `>> ${s}`).join('<br>') + '<br>';
  renderCqrsFlow();
});

cqrsLagSlider.addEventListener('input', (e) => {
  const lag = parseInt(e.target.value);
  cqrs.syncDelay = lag;
  cqrsLagVal.textContent = `${lag}ms`;
  logConsole('EVENT BUS', `Message synchronization lag adjusted to ${lag}ms`, 'cqrs');
});

// Play/Pause and Reset
btnTogglePlay.addEventListener('click', () => {
  isPlaying = !isPlaying;
  if (isPlaying) {
    playIcon.textContent = '■';
    playText.textContent = 'Pause Engine';
    logConsole('SYSTEM', 'Simulator engine running.', 'engine');
  } else {
    playIcon.textContent = '▶';
    playText.textContent = 'Resume Engine';
    logConsole('SYSTEM', 'Simulator engine paused.', 'engine');
  }
});

btnResetEngine.addEventListener('click', () => {
  tracker.reset();
  btree.reset();
  connPool.reset();
  queryCache.clear();
  lockManager.reset();
  wal.reset();
  bufferPool.reset();
  
  // Re-seed from uploaded data if available, otherwise stay empty
  if (uploadedDataStats) {
    dataAdapter.distribute({ btree, sharding, cqrs, replication, querySetCallback: setMockDatabase });
    refreshUploadedDataUI(uploadedDataStats);
  } else {
    sharding.seed();
    cqrs.seed();
    replication.seed();
  }
  
  // Re-seed transactions
  transactions.T1 = new Transaction('T1');
  transactions.T2 = new Transaction('T2');
  transactions.T3 = new Transaction('T3');
  
  replication.reset();
  replParticles = [];

  // UI
  updateTelemetryDisplay();
  walLogList.innerHTML = '<div style="color:var(--text-muted); text-align:center;">--- WAL EMULATION RE-SEEDED ---</div>';
  btreeTraceOutput.innerHTML = 'Awaiting index playground actions...';
  shardingRoutingLog.innerHTML = 'Awaiting sharding router proxy inserts...';
  cqrsPipelineLog.innerHTML = 'Awaiting CQRS commands or read queries...';
  replWalLog.innerHTML = '<div style="color:var(--text-muted); text-align:center;">--- WAL Stream ---</div>';
  
  updateReplNodeToggles();
  updateReplWriteNodeOptions();
  updateScaleInfo();
  
  logConsole('SYSTEM', 'All database simulator subsystems re-seeded and reset.', 'engine');
  renderActiveTabVisuals();
});

btnClearConsole.addEventListener('click', () => {
  logsBox.innerHTML = '';
});

// ----------------------------------------------------
// PRESET SCENARIO ROUTERS
// ----------------------------------------------------
const scenarios = ['scenario-default', 'scenario-btree', 'scenario-deadlock', 'scenario-eviction', 'scenario-sharding', 'scenario-cqrs', 'scenario-replication', 'scenario-overview'];

scenarios.forEach(id => {
  const card = document.getElementById(id);
  card.addEventListener('click', () => {
    scenarios.forEach(s => document.getElementById(s).classList.remove('active'));
    card.classList.add('active');
    
    currentScenario = id.replace('scenario-', '');
    logConsole('SIMULATOR', `Active workload preset scenario changed to: ${currentScenario.toUpperCase()}`, 'engine');
    
    // Auto switch active tabs for context relevance
    if (currentScenario === 'btree') {
      triggerTabSwitch('tab-btree');
    } else if (currentScenario === 'deadlock') {
      triggerTabSwitch('tab-locks');
      triggerDeadlockScenario();
    } else if (currentScenario === 'eviction') {
      triggerTabSwitch('tab-buffer');
    } else if (currentScenario === 'sharding') {
      triggerTabSwitch('tab-sharding');
    } else if (currentScenario === 'cqrs') {
      triggerTabSwitch('tab-cqrs');
    } else if (currentScenario === 'replication') {
      triggerTabSwitch('tab-replication');
    } else if (currentScenario === 'overview') {
      triggerTabSwitch('tab-overview');
    } else {
      triggerTabSwitch('tab-query');
    }
  });
});

function triggerTabSwitch(tabId) {
  tabButtons.forEach(btn => {
    if (btn.getAttribute('data-tab') === tabId) {
      btn.click();
    }
  });
}

// Deadlock Scenario Setup
function triggerDeadlockScenario() {
  // Reset locks and transactional wait states
  lockManager.reset();
  wal.reset();
  transactions.T1 = new Transaction('T1');
  transactions.T2 = new Transaction('T2');
  transactions.T3 = new Transaction('T3');
  
  logConsole('DEADLOCK DEMO', 'Beginning lock deadlock sequence configuration...', 'lock');
  
  const keys = Object.keys(cqrs.writeDB);
  const resA = keys.length > 0 ? keys[0] : 'A';
  const resB = keys.length > 1 ? keys[1] : 'B';

  // Step 1: T1 acquires X-lock on resA, T2 acquires X-lock on resB
  setTimeout(() => {
    if (!isPlaying) return;
    const r1 = lockManager.acquire('T1', resA, 'X');
    transactions.T1.status = 'ACTIVE';
    transactions.T1.heldLocks.push({ resource: resA, mode: 'X' });
    wal.append('T1', 'START');
    wal.append('T1', 'UPDATE', { resource: resA, oldVal: 10, newVal: 20 });
    r1.steps.forEach(s => logConsole('LOCK MGR', s, 'lock'));
    updateWALUI();
    renderActiveTabVisuals();
  }, 1000);

  setTimeout(() => {
    if (!isPlaying) return;
    const r2 = lockManager.acquire('T2', resB, 'X');
    transactions.T2.status = 'ACTIVE';
    transactions.T2.heldLocks.push({ resource: resB, mode: 'X' });
    wal.append('T2', 'START');
    wal.append('T2', 'UPDATE', { resource: resB, oldVal: 50, newVal: 60 });
    r2.steps.forEach(s => logConsole('LOCK MGR', s, 'lock'));
    updateWALUI();
    renderActiveTabVisuals();
  }, 2000);

  // Step 2: T1 requests X-lock on resB (blocked by T2), T2 requests X-lock on resA (blocked by T1)
  setTimeout(() => {
    if (!isPlaying) return;
    logConsole('DEADLOCK DEMO', `T1 requests lock on ${resB}, occupied by T2`, 'lock');
    const r3 = lockManager.acquire('T1', resB, 'X');
    if (!r3.granted) {
      transactions.T1.status = 'BLOCKED';
      transactions.T1.waitingFor = { resource: resB, mode: 'X' };
      tracker.recordLockRequest(true);
    }
    r3.steps.forEach(s => logConsole('LOCK MGR', s, 'lock'));
    renderActiveTabVisuals();
  }, 3500);

  setTimeout(() => {
    if (!isPlaying) return;
    logConsole('DEADLOCK DEMO', `T2 requests lock on ${resA}, occupied by T1. Deadlock loop complete.`, 'lock');
    const r4 = lockManager.acquire('T2', resA, 'X');
    if (!r4.granted) {
      transactions.T2.status = 'BLOCKED';
      transactions.T2.waitingFor = { resource: resA, mode: 'X' };
      tracker.recordLockRequest(true);
    }
    r4.steps.forEach(s => logConsole('LOCK MGR', s, 'lock'));
    
    // Cycle check!
    waitForGraph.build(transactions, lockManager);
    const cycle = waitForGraph.findCycle();
    
    if (cycle) {
      logConsole('CYCLE DETECTOR', `Deadlock cycle found: ${cycle.join(' -> ')}`, 'lock');
      
      // Abort the younger transaction: T2 (highest lexicographical ID)
      setTimeout(() => {
        logConsole('CYCLE DETECTOR', `Aborting transaction T2 to break cycle (lock rollback)...`, 'lock');
        
        // Release T2 locks
        const { releasedResources, steps: relSteps } = lockManager.releaseAll('T2');
        relSteps.forEach(s => logConsole('LOCK MGR', s, 'lock'));
        
        transactions.T2.status = 'ABORTED';
        transactions.T2.heldLocks = [];
        transactions.T2.waitingFor = null;
        tracker.recordTxAbort();
        
        wal.append('T2', 'ABORT');
        updateWALUI();

        // Check if T1 gets unblocked!
        // Unpin T1 which was waiting for B
        const t1LockCheck = lockManager.locks.B;
        if (t1LockCheck.holders.includes('T1')) {
          transactions.T1.status = 'ACTIVE';
          transactions.T1.heldLocks.push({ resource: 'B', mode: 'X' });
          transactions.T1.waitingFor = null;
          
          logConsole('LOCK MGR', `T1 has been unblocked and granted X-Lock on B!`, 'lock');
          wal.append('T1', 'UPDATE', { resource: 'B', oldVal: 100, newVal: 120 });
          
          // Commit T1 shortly
          setTimeout(() => {
            logConsole('LOCK MGR', `T1 transaction completed successfully. Committing...`, 'lock');
            lockManager.releaseAll('T1');
            transactions.T1.status = 'COMMITTED';
            wal.append('T1', 'COMMIT');
            tracker.recordTxSuccess();
            updateWALUI();
            renderActiveTabVisuals();
          }, 2000);
        }
        
        updateTelemetryDisplay();
        renderActiveTabVisuals();
      }, 2500);
    }
    
    updateTelemetryDisplay();
    renderActiveTabVisuals();
  }, 5000);
}

function updateWALUI() {
  walLogList.innerHTML = '';
  wal.logs.forEach(entry => {
    const formatted = wal.getFormattedLog(entry);
    const div = document.createElement('div');
    
    let color = '#fff';
    if (entry.type === 'START') color = '#1f8eed';
    else if (entry.type === 'COMMIT') color = '#39ff14';
    else if (entry.type === 'ABORT') color = '#ff003c';
    else if (entry.type === 'UPDATE') color = '#ff9f1c';
    
    div.style.color = color;
    div.textContent = formatted;
    walLogList.appendChild(div);
  });
  walLogList.scrollTop = walLogList.scrollHeight;
}

// ----------------------------------------------------
// SIMULATION ENGINE LOGICAL LOOP
// ----------------------------------------------------
function startSimulationLoop() {
  const tickSim = () => {
    if (isPlaying) {
      tracker.tick();
      updateTelemetryDisplay();
      
      // Perform automated actions depending on active preset scenarios
      if (currentScenario === 'default' || currentScenario === 'overview') {
        runRandomWorkload();
      } else if (currentScenario === 'eviction') {
        runThrashingWorkload();
      } else if (currentScenario === 'sharding') {
        runShardingWorkload();
      } else if (currentScenario === 'cqrs') {
        runCqrsWorkload();
      } else if (currentScenario === 'replication') {
        runReplicationWorkload();
      }

      // Process CQRS background syncs
      const syncResult = cqrs.syncNextEvent();
      if (syncResult) {
        logConsole('EVENT BUS REPLICA', syncResult.log, 'cqrs');
        renderCqrsFlow();
      }

      // Process replication background syncs
      const replCompleted = replication.processPendingReplications();
      replCompleted.forEach(entry => {
        const color = entry.type === 'conflict' ? '#ff003c' : (entry.type === 'synced' ? '#39ff14' : '#8b949e');
        addReplWalEntry(entry.msg, color);
        logConsole('REPL SYNC', entry.msg, 'replication');
      });
      
      renderActiveTabVisuals();
    }
    
    simTimer = setTimeout(tickSim, speedMultiplier);
  };
  
  tickSim();
}

// 1. Default standard workload
function runRandomWorkload() {
  // Guard: skip entirely if no data is loaded
  if (!uploadedDataStats) return;
  
  const roll = Math.random();
  tracker.recordTxStart();
  
  if (roll < 0.4) {
    // Page cache request (dynamically bounds to uploaded data size)
    const maxPages = window.uploadedDatasetMaxPages || 30;
    const randomPage = Math.floor(Math.random() * maxPages) + 1;
    const isWrite = Math.random() < 0.3;
    const { status, evictedPageId, trace } = bufferPool.requestPage(randomPage, isWrite, activeBufferPolicy);
    
    if (status === 'HIT') tracker.recordBufferHit();
    else tracker.recordBufferMiss();
    
    // Evict or release pins occasionally
    bufferPool.unpinPage(randomPage);
    
    // Log details
    if (activeTab === 'tab-buffer') {
      bufferSweepLog.innerHTML = trace.map(s => `>> ${s}`).join('<br>') + '<br>';
      bufferSweepLog.scrollTop = bufferSweepLog.scrollHeight;
    }
  } else if (roll < 0.7) {
    // B+ Tree insertion — use keys from uploaded data range
    const maxKey = uploadedDataStats.primaryRowsCount || 100;
    const key = Math.floor(Math.random() * maxKey) + 1;
    btree.insert(key, `val_${key}`);
    logConsole('BG ENGINE', `Auto-inserted key ${key} to B+ Tree index.`, 'engine');
  } else {
    // Shard insert — use data from uploaded records
    const maxKey = uploadedDataStats.primaryRowsCount || 100;
    const key = Math.floor(Math.random() * maxKey) + 1;
    const cqrsRecords = Object.values(cqrs.writeDB);
    const randomRecord = cqrsRecords.length > 0 ? cqrsRecords[Math.floor(Math.random() * cqrsRecords.length)] : null;
    const name = randomRecord ? (randomRecord.username || randomRecord.name || `rec_${key}`) : `rec_${key}`;
    sharding.insert(key, name);
    sharding.shards[Object.keys(sharding.shards)[key % 3]].queries++;
  }
}

// 2. Cache Thrashing Scenario
function runThrashingWorkload() {
  if (!uploadedDataStats) return;
  // Requests a sequence of pages that exceeds buffer pool size (16)
  const maxPages = window.uploadedDatasetMaxPages || 22;
  const page = (Math.floor(Date.now() / 1500) % Math.max(22, maxPages)) + 1;
  const { status, trace } = bufferPool.requestPage(page, false, activeBufferPolicy);
  
  if (status === 'HIT') tracker.recordBufferHit();
  else tracker.recordBufferMiss();
  
  bufferPool.unpinPage(page);
  
  bufferSweepLog.innerHTML = trace.map(s => `>> ${s}`).join('<br>') + '<br>';
  bufferSweepLog.scrollTop = bufferSweepLog.scrollHeight;
}

// 3. Shard Balancing Scenario
function runShardingWorkload() {
  // Guard: skip if no data is loaded
  if (!uploadedDataStats) return;
  
  const maxKey = uploadedDataStats.primaryRowsCount || 100;
  const key = Math.floor(Math.random() * maxKey) + 1;
  const cqrsRecords = Object.values(cqrs.writeDB);
  const randomRecord = cqrsRecords.length > 0 ? cqrsRecords[Math.floor(Math.random() * cqrsRecords.length)] : null;
  const val = randomRecord ? (randomRecord.username || randomRecord.name || `value_${key}`) : `value_${key}`;
  
  const result = sharding.insert(key, val);
  const { target, steps, autoSharded, rebalanceLogs } = result;
  
  if (sharding.shards[target].queries === undefined) {
    sharding.shards[target].queries = 0;
  }
  sharding.shards[target].queries += 5;

  let trackerShard = tracker.shards.find(s => s.id === target);
  if (!trackerShard) {
    trackerShard = { id: target, load: 0, queries: 0 };
    tracker.shards.push(trackerShard);
  }
  trackerShard.queries += 5;

  if (activeTab === 'tab-sharding') {
    triggerShardPulse(target, sharding.strategy === 'Range' ? 0x00f2fe : 0x8a2be2);
  }
  
  shardingRoutingLog.innerHTML = steps.map(s => `>> ${s}`).join('<br>') + '<br>';
  if (autoSharded) {
    shardingRoutingLog.innerHTML += `<div style="color:var(--accent-orange); margin-top:8px;">${rebalanceLogs.map(l => `>> ${l}`).join('<br>')}</div>`;
    rebalanceLogs.forEach(l => logConsole('AUTO-SHARD', l, 'sharding'));
  }
  shardingRoutingLog.scrollTop = shardingRoutingLog.scrollHeight;

  if (activeTab === 'tab-sharding' || autoSharded) {
    renderShardingNodes();
  }
}

// 4. CQRS Consistency gap workload
function runCqrsWorkload() {
  if (!uploadedDataStats) return;
  const userIds = Object.keys(cqrs.writeDB);
  if (userIds.length === 0) return;

  const user = userIds[Math.floor(Math.random() * userIds.length)];
  
  // Pick a random mutable field from the record
  const record = cqrs.writeDB[user];
  const fields = Object.keys(record).filter(k => k !== 'id' && k !== 'username');
  if (fields.length === 0) return;
  const field = fields[Math.floor(Math.random() * fields.length)];
  
  let newValue;
  if (typeof record[field] === 'number') {
    newValue = Math.floor(Math.random() * 90) + 10;
  } else {
    newValue = ['Active', 'Offline', 'Suspended'][Math.floor(Math.random() * 3)];
  }
  
  // 1. Dispatch update command
  const cmd = cqrs.executeCommand(user, field, newValue);
  cqrsPipelineLog.innerHTML = cmd.steps.map(s => `>> ${s}`).join('<br>') + '<br>';
  
  // 2. Query Read model immediately (shows consistency lag)
  setTimeout(() => {
    const q = cqrs.executeQuery(user);
    tracker.cqrsTotalReads++;
    if (q.isStale) {
      tracker.cqrsStaleReads++;
      cqrsPipelineLog.innerHTML += `<div style="color:var(--accent-magenta); font-weight:700;">>> [CONSISTENCY LAG] Eventual consistency gap! Read returned stale data.</div>`;
    }
    cqrsPipelineLog.scrollTop = cqrsPipelineLog.scrollHeight;
  }, 100);
}

// 5. Replication Scenario workload
function runReplicationWorkload() {
  if (!uploadedDataStats) return;
  const masterNode = replication.nodes.find(n => n.role === 'master') || replication.nodes[0];
  if (!masterNode || !masterNode.data) return;
  const records = Object.keys(masterNode.data);
  if (records.length === 0) return;
  const record = records[Math.floor(Math.random() * records.length)];
  
  // Pick a mutable field dynamically
  const recData = masterNode.data[record];
  const fields = Object.keys(recData).filter(k => k !== 'id' && k !== 'name');
  if (fields.length === 0) return;
  const field = fields[Math.floor(Math.random() * fields.length)];
  
  let newValue;
  if (typeof recData[field] === 'number') {
    newValue = Math.floor(Math.random() * 5000) + 100;
  } else {
    newValue = ['Active', 'Suspended', 'Offline'][Math.floor(Math.random() * 3)];
  }

  if (replication.mode === 'master-slave') {
    const result = replication.masterSlaveWrite(record, field, newValue);
    if (result.success) {
      result.steps.forEach(s => addReplWalEntry(s.msg, s.type === 'write' ? '#39ff14' : (s.type === 'replicate' ? '#00f2fe' : '#8b949e')));
      // Spawn particles from master (idx 0) to each slave
      for (let i = 1; i < replication.nodes.length; i++) {
        if (replication.nodes[i].status !== 'OFFLINE') {
          spawnReplParticle(0, i, '#00f2fe');
        }
      }
    }
  } else {
    // Multi-primary: random node writes
    const onlineNodes = replication.nodes.filter(n => n.status !== 'OFFLINE');
    if (onlineNodes.length > 0) {
      const writer = onlineNodes[Math.floor(Math.random() * onlineNodes.length)];
      const result = replication.multiPrimaryWrite(writer.id, record, field, newValue);
      if (result.success) {
        result.steps.forEach(s => addReplWalEntry(s.msg, s.type === 'write' ? '#8a2be2' : (s.type === 'replicate' ? '#00f2fe' : '#8b949e')));
        const writerIdx = replication.nodes.indexOf(writer);
        replication.nodes.forEach((n, idx) => {
          if (idx !== writerIdx && n.status !== 'OFFLINE') spawnReplParticle(writerIdx, idx, '#8a2be2');
        });
      }
    }
  }
}

// Canvas animation ticking thread
function startVisualAnimationTick() {
  // Initialize Three.js 3D scenes
  if (bgParticles) initBackground(bgParticles);
  if (btree3d) initBTreeScene(btree3d);
  if (queryPlan3d) initQueryPlanScene(queryPlan3d);
  if (replication3d) initReplicationScene(replication3d);
  if (overview3d) initOverviewScene(overview3d);
  if (sharding3d) initShardingScene(sharding3d);
  startAnimationLoop();
  setActiveScene('queryplan');

  const drawTick = () => {
    renderActiveTabVisuals();
    requestAnimationFrame(drawTick);
  };
  requestAnimationFrame(drawTick);
}

// ----------------------------------------------------
// REPLICATION EVENT BINDINGS
// ----------------------------------------------------
replModeMs.addEventListener('click', () => {
  replication.switchMode('master-slave');
  replModeMs.classList.add('btn-primary');
  replModeMp.classList.remove('btn-primary');
  replParticles = [];
  replWalLog.innerHTML = '<div style="color:var(--text-muted); text-align:center;">--- Mode: MASTER-SLAVE ---</div>';
  updateReplNodeToggles();
  updateReplWriteNodeOptions();
  logConsole('REPLICATION', 'Switched to Master-Slave replication mode.', 'replication');
  renderReplicationTopology();
  updateScaleInfo();
});

replModeMp.addEventListener('click', () => {
  replication.switchMode('multi-primary');
  replModeMp.classList.add('btn-primary');
  replModeMs.classList.remove('btn-primary');
  replParticles = [];
  replWalLog.innerHTML = '<div style="color:var(--text-muted); text-align:center;">--- Mode: MULTI-PRIMARY ---</div>';
  updateReplNodeToggles();
  updateReplWriteNodeOptions();
  logConsole('REPLICATION', 'Switched to Multi-Primary replication mode.', 'replication');
  renderReplicationTopology();
  updateScaleInfo();
});

btnReplWrite.addEventListener('click', () => {
  if (!checkUploaded('Replication Write')) return;
  const nodeId = replWriteNode.value;
  const recordId = replWriteRecord.value;
  const field = replWriteField.value;
  let value = replWriteValue.value;
  if (!value) return;
  if (field === 'balance') value = parseInt(value) || 0;

  let result;
  if (replication.mode === 'master-slave') {
    result = replication.masterSlaveWrite(recordId, field, value);
  } else {
    result = replication.multiPrimaryWrite(nodeId, recordId, field, value);
  }

  if (result.success) {
    result.steps.forEach(s => {
      const color = s.type === 'write' ? '#39ff14' : (s.type === 'replicate' ? '#00f2fe' : (s.type === 'wal' ? '#8a2be2' : '#8b949e'));
      addReplWalEntry(s.msg, color);
    });
    // Spawn particles
    if (replication.mode === 'master-slave') {
      for (let i = 1; i < replication.nodes.length; i++) {
        if (replication.nodes[i].status !== 'OFFLINE') spawnReplParticle(0, i, '#00f2fe');
      }
    } else {
      const writerIdx = replication.nodes.findIndex(n => n.id === nodeId);
      replication.nodes.forEach((n, idx) => {
        if (idx !== writerIdx && n.status !== 'OFFLINE') spawnReplParticle(writerIdx, idx, '#8a2be2');
      });
    }
    logConsole('REPL WRITE', `Write to ${recordId}.${field} dispatched.`, 'replication');
  } else {
    result.steps.forEach(s => addReplWalEntry(s.msg, '#ff003c'));
  }
  renderReplicationTopology();
});

btnReplRead.addEventListener('click', () => {
  if (!checkUploaded('Replication Read')) return;
  const recordId = replWriteRecord.value;
  const result = replication.masterSlaveRead(recordId);
  result.steps.forEach(s => {
    const color = s.type === 'warning' ? '#ff9f1c' : (s.type === 'success' ? '#39ff14' : '#8b949e');
    addReplWalEntry(s.msg, color);
  });
  logConsole('REPL READ', `Read ${recordId} from ${result.nodeUsed || 'N/A'}`, 'replication');
});

replLagSlider.addEventListener('input', (e) => {
  const lag = parseInt(e.target.value);
  replication.replicationLag = lag;
  replLagVal.textContent = `${lag}ms`;
  logConsole('REPLICATION', `Base replication lag set to ${lag}ms`, 'replication');
});

function updateScaleInfo() {
  if (scaleInfoText) {
    scaleInfoText.textContent = `Current: ${replication.nodes.length} nodes`;
  }
}

btnScaleOut.addEventListener('click', () => {
  if (!checkUploaded('Scale Out Replica')) return;
  const result = replication.scaleOut();
  if (result.success) {
    logConsole('SCALING', result.msg, 'replication');
    addReplWalEntry(result.msg, '#39ff14');
    updateReplNodeToggles();
    updateReplWriteNodeOptions();
    renderReplicationTopology();
    updateScaleInfo();
  }
});

btnScaleIn.addEventListener('click', () => {
  if (!checkUploaded('Scale In Replica')) return;
  const result = replication.scaleIn();
  if (result.success) {
    logConsole('SCALING', result.msg, 'replication');
    addReplWalEntry(result.msg, '#ff003c');
    updateReplNodeToggles();
    updateReplWriteNodeOptions();
    renderReplicationTopology();
    updateScaleInfo();
  } else {
    logConsole('SCALING_ERROR', result.msg, 'replication');
    addReplWalEntry(result.msg, '#ff9f1c');
  }
});

// ----------------------------------------------------
// DATABASE UPLOAD LOGIC
// ----------------------------------------------------
function handleFileUpload(file) {
  if (!file) return;
  uploadStatus.innerHTML = `<span style="color:var(--accent-cyan);">Reading ${file.name}...</span>`;
  
  const reader = new FileReader();
  reader.onload = (e) => {
    try {
      const content = e.target.result;
      const parsedTables = dataAdapter.parseFile(file.name, content);
      
      // Update UI schema preview
      schemaPreview.style.display = 'block';
      let previewHtml = `<div style="margin-bottom:6px; color:var(--accent-green);">✓ Parsed ${Object.keys(parsedTables).length} tables</div>`;
      for (const [tName, table] of Object.entries(parsedTables)) {
        previewHtml += `<div style="margin-bottom:4px;"><strong>${tName}</strong> (${table.rows.length} rows)</div>`;
        previewHtml += `<div>${table.columns.map(c => `<span class="schema-table-tag">${c}</span>`).join('')}</div>`;
      }
      schemaPreview.innerHTML = previewHtml;
      
      // Distribute to engines
      const engines = {
        btree,
        sharding,
        cqrs,
        replication,
        querySetCallback: setMockDatabase
      };
      
      const stats = dataAdapter.distribute(engines);
      
      if (stats) {
        uploadedDataStats = stats; // Store for reset
        dbStatusDot.style.background = '#39ff14';
        dbStatusDot.style.boxShadow = '0 0 10px #39ff14';
        dbStatusText.textContent = `Online // ${file.name}`;
        uploadStatus.innerHTML = `<span style="color:var(--accent-green);">Successfully seeded subsystems!</span>`;
        logConsole('DATA_ADAPTER', `Distributed ${stats.tablesList.join(', ')} to all subsystems. Primary table: ${stats.primaryTable}.`, 'engine');
        
        // Re-render current tab
        renderActiveTabVisuals();
        
        // Refresh dropdowns with new data
        refreshUploadedDataUI(stats);
      }
      
    } catch (err) {
      console.error(err);
      uploadStatus.innerHTML = `<span style="color:var(--accent-red);">Error: ${err.message}</span>`;
    }
  };
  reader.readAsText(file);
}

dbUploadZone.addEventListener('dragover', (e) => {
  e.preventDefault();
  dbUploadZone.classList.add('dragover');
});

dbUploadZone.addEventListener('dragleave', (e) => {
  e.preventDefault();
  dbUploadZone.classList.remove('dragover');
});

dbUploadZone.addEventListener('drop', (e) => {
  e.preventDefault();
  dbUploadZone.classList.remove('dragover');
  if (e.dataTransfer.files && e.dataTransfer.files.length > 0) {
    handleFileUpload(e.dataTransfer.files[0]);
  }
});

btnBrowseFile.addEventListener('click', () => {
  dbFileInput.click();
});

dbFileInput.addEventListener('change', (e) => {
  if (e.target.files && e.target.files.length > 0) {
    handleFileUpload(e.target.files[0]);
  }
});


function refreshUploadedDataUI(stats) {
  if (stats) {
    // Update SQL input window with a proper query for the uploaded data
    const sqlInput = document.getElementById('sql-input');
    if (sqlInput) {
      if (stats.secondaryTable && stats.secondaryTable !== 'None') {
        // Build a JOIN query using the uploaded table names and their actual columns
        const db = MOCK_DATABASE;
        const pCols = db[stats.primaryTable] && db[stats.primaryTable].length > 0 ? Object.keys(db[stats.primaryTable][0]) : [];
        const sCols = db[stats.secondaryTable] && db[stats.secondaryTable].length > 0 ? Object.keys(db[stats.secondaryTable][0]) : [];
        // Find a plausible join key: a column in the secondary table whose name contains the primary table name or 'id'
        const joinKey = sCols.find(c => c.includes(stats.primaryTable.replace(/s$/, '')) && c.includes('id')) || sCols.find(c => c.includes('_id')) || 'id';
        const leftKey = pCols.find(c => c === 'id') || pCols[0] || 'id';
        const selectCols = [...pCols.slice(0, 2), ...sCols.filter(c => !c.includes('id')).slice(0, 2)];
        sqlInput.value = `SELECT ${selectCols.join(', ')} FROM ${stats.primaryTable} JOIN ${stats.secondaryTable} ON ${leftKey} = ${joinKey} WHERE ${sCols.find(c => typeof (db[stats.secondaryTable][0] || {})[c] === 'number') || selectCols[selectCols.length-1]} > 100`;
      } else {
        sqlInput.value = `SELECT * FROM ${stats.primaryTable}`;
      }
    }
    
    // Scale the Buffer Pool requests bounds
    window.uploadedDatasetMaxPages = Math.max(1, Math.ceil(stats.primaryRowsCount / 10));
  }

  // Dynamically rebuild CQRS dropdown options from cqrs.writeDB
  cqrsCommandUserId.innerHTML = '';
  const cqrsFields = new Set();
  Object.values(cqrs.writeDB).forEach(record => {
    const opt = document.createElement('option');
    opt.value = record.id;
    const label = record.username || record.name || record.id;
    opt.textContent = `${record.id} (${label})`;
    cqrsCommandUserId.appendChild(opt);
    Object.keys(record).forEach(k => { if (k !== 'id' && k !== 'username') cqrsFields.add(k); });
  });

  // Rebuild CQRS field selector
  cqrsCommandField.innerHTML = '';
  cqrsFields.forEach(field => {
    const opt = document.createElement('option');
    opt.value = field;
    opt.textContent = field;
    cqrsCommandField.appendChild(opt);
  });

  // Dynamically rebuild Replication record dropdown from replication node data
  replWriteRecord.innerHTML = '';
  const masterNode = replication.nodes.find(n => n.role === 'master') || replication.nodes[0];
  if (masterNode && masterNode.data) {
    Object.entries(masterNode.data).forEach(([id, record]) => {
      const opt = document.createElement('option');
      opt.value = id;
      opt.textContent = `${id} (${record.name || id})`;
      replWriteRecord.appendChild(opt);
    });
  }

  // Rebuild Replication field selector from the record schema
  replWriteField.innerHTML = '';
  if (masterNode && masterNode.data) {
    const firstRecord = Object.values(masterNode.data)[0];
    if (firstRecord) {
      Object.keys(firstRecord).forEach(key => {
        if (key !== 'id' && key !== 'name') {
          const opt = document.createElement('option');
          opt.value = key;
          opt.textContent = key;
          replWriteField.appendChild(opt);
        }
      });
    }
  }

  // Rebuild replication node toggles and write node options
  updateReplNodeToggles();
  updateReplWriteNodeOptions();
  updateScaleInfo();
}

// ----------------------------------------------------
// INITIALIZATION KICKSTART
// ----------------------------------------------------
if (sharding3d) {
  sharding3d.addEventListener('shard-hover', (event) => {
    const hoverShardId = event.detail.shardId;
    const cards = shardsNodesWrapper.querySelectorAll('.shard-node-card');
    const shardKeys = Object.keys(sharding.shards);
    shardKeys.forEach((id, idx) => {
      if (cards[idx]) {
        if (id === hoverShardId) {
          cards[idx].classList.add('hovered-from-3d');
        } else {
          cards[idx].classList.remove('hovered-from-3d');
        }
      }
    });
  });
}

resizeCanvases();
updateTelemetryDisplay();
updateBufferPolicyUI();
updateReplNodeToggles();
updateReplWriteNodeOptions();
updateScaleInfo();
startSimulationLoop();
startVisualAnimationTick();

logConsole('BOOTLOADER', 'NEXUS Database engine visualization cluster is ONLINE.', 'engine');
