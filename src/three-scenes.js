// ============================================================
// THREE.JS 3D SCENE MANAGER — DBMS SIMULATOR
// ============================================================
import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';

// Design system colors
const C = {
  cyan: 0x00f2fe, magenta: 0xff007f, green: 0x39ff14,
  orange: 0xff9f1c, red: 0xff003c, blue: 0x1f8eed,
  purple: 0x8a2be2, dark: 0x0a0e1a, nodeFill: 0x0d121f
};

// ============================================================
// UTILITIES
// ============================================================
function makeRenderer(container, opts = {}) {
  const w = container.clientWidth || 600;
  const h = container.clientHeight || 400;
  try {
    const r = new THREE.WebGLRenderer({ antialias: true, alpha: true, powerPreference: 'high-performance' });
    r.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    r.setSize(w, h);
    r.setClearColor(0x000000, 0);
    container.appendChild(r.domElement);
    r.domElement.style.borderRadius = '8px';
    // Handle WebGL context loss gracefully
    r.domElement.addEventListener('webglcontextlost', (e) => {
      e.preventDefault();
      console.warn('[DBMS] WebGL context lost on', container.id || 'canvas', '— will attempt restore');
    });
    r.domElement.addEventListener('webglcontextrestored', () => {
      console.info('[DBMS] WebGL context restored on', container.id || 'canvas');
    });
    return r;
  } catch (err) {
    console.error("WebGL context creation failed:", err);
    container.innerHTML = `
      <div style="display:flex; flex-direction:column; justify-content:center; align-items:center; height:100%; min-height:300px; color:var(--accent-orange); font-family:var(--font-mono); font-size:0.8rem; text-align:center; padding:20px; background:rgba(13,18,31,0.65); border:1px solid rgba(255,159,28,0.25); border-radius:8px; backdrop-filter:blur(8px);">
        <span style="font-size:1.1rem; font-weight:bold; margin-bottom:8px; color:var(--accent-orange);">⚠️ WebGL Context Exhausted</span>
        <span style="color:var(--text-secondary); line-height:1.4;">Vite Hot-Reload has accumulated too many WebGL contexts in browser memory.</span>
        <span style="margin-top:10px; padding:6px 12px; background:rgba(255,159,28,0.1); border:1px solid rgba(255,159,28,0.3); border-radius:4px; color:var(--accent-orange); font-weight:bold;">Please refresh your browser tab to restore 3D scenes.</span>
      </div>
    `;
    return {
      setSize: () => {},
      render: () => {},
      domElement: document.createElement('div')
    };
  }
}

function makeLabel(text, opts = {}) {
  const fs = opts.fontSize || 24;
  const color = opts.color || '#00f2fe';
  const c = document.createElement('canvas');
  const x = c.getContext('2d');
  x.font = `bold ${fs}px 'JetBrains Mono', monospace`;
  const tw = x.measureText(text).width;
  c.width = pow2(tw + 20);
  c.height = pow2(fs + 16);
  if (opts.bg) { x.fillStyle = opts.bg; x.fillRect(0, 0, c.width, c.height); }
  x.font = `bold ${fs}px 'JetBrains Mono', monospace`;
  x.fillStyle = color;
  x.textAlign = 'center';
  x.textBaseline = 'middle';
  x.fillText(text, c.width / 2, c.height / 2);
  const tex = new THREE.CanvasTexture(c);
  tex.minFilter = THREE.LinearFilter;
  const mat = new THREE.SpriteMaterial({ map: tex, transparent: true, depthTest: false });
  const s = new THREE.Sprite(mat);
  const sc = opts.scale || 1.2;
  s.scale.set(sc * (c.width / c.height), sc, 1);
  return s;
}

function pow2(n) { return Math.pow(2, Math.ceil(Math.log2(Math.max(n, 1)))); }

function edgeGlow(geo, color, opacity = 0.7) {
  const e = new THREE.EdgesGeometry(geo);
  return new THREE.LineSegments(e, new THREE.LineBasicMaterial({ color, transparent: true, opacity }));
}

function glowBox(w, h, d, fillColor, edgeColor) {
  const group = new THREE.Group();
  const geo = new THREE.BoxGeometry(w, h, d);
  const mesh = new THREE.Mesh(geo, new THREE.MeshBasicMaterial({
    color: fillColor, transparent: true, opacity: 0.3
  }));
  group.add(mesh);
  const edges = edgeGlow(geo, edgeColor, 0.9);
  group.add(edges);
  return group;
}

function makeLine(from, to, color, opacity = 0.4) {
  const geo = new THREE.BufferGeometry().setFromPoints([
    new THREE.Vector3(from.x, from.y, from.z),
    new THREE.Vector3(to.x, to.y, to.z)
  ]);
  return new THREE.Line(geo, new THREE.LineBasicMaterial({ color, transparent: true, opacity }));
}

function makeParticleStream(from, to, color, count = 20) {
  const positions = new Float32Array(count * 3);
  for (let i = 0; i < count; i++) {
    const t = i / count;
    positions[i * 3] = from.x + (to.x - from.x) * t + (Math.random() - 0.5) * 0.2;
    positions[i * 3 + 1] = from.y + (to.y - from.y) * t;
    positions[i * 3 + 2] = from.z + (to.z - from.z) * t + (Math.random() - 0.5) * 0.2;
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  return new THREE.Points(geo, new THREE.PointsMaterial({
    color, size: 0.08, transparent: true, opacity: 0.8,
    blending: THREE.AdditiveBlending, depthWrite: false
  }));
}

// ============================================================
// 1. BACKGROUND PARTICLE FIELD
// ============================================================
let bgScene, bgCamera, bgRenderer, bgPoints, bgAnimId;

export function initBackground(container) {
  bgScene = new THREE.Scene();
  bgCamera = new THREE.PerspectiveCamera(60, window.innerWidth / window.innerHeight, 0.1, 1000);
  bgCamera.position.z = 50;
  bgRenderer = makeRenderer(container);
  const el = bgRenderer.domElement;
  el.style.position = 'fixed'; el.style.top = '0'; el.style.left = '0';
  el.style.width = '100%'; el.style.height = '100%';
  el.style.zIndex = '-1'; el.style.pointerEvents = 'none';

  const N = 2500;
  const pos = new Float32Array(N * 3), col = new Float32Array(N * 3);
  const palette = [[0,0.95,1],[0.54,0.17,0.89],[1,0,0.5],[0.22,1,0.08]];
  for (let i = 0; i < N; i++) {
    const r = 30 + Math.random() * 70;
    const th = Math.random() * Math.PI * 2;
    const ph = Math.acos(2 * Math.random() - 1);
    pos[i*3] = r*Math.sin(ph)*Math.cos(th);
    pos[i*3+1] = r*Math.sin(ph)*Math.sin(th);
    pos[i*3+2] = r*Math.cos(ph);
    const c = palette[Math.floor(Math.random() * palette.length)];
    col[i*3]=c[0]; col[i*3+1]=c[1]; col[i*3+2]=c[2];
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  geo.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
  bgPoints = new THREE.Points(geo, new THREE.PointsMaterial({
    size: 0.15, vertexColors: true, transparent: true, opacity: 0.45,
    blending: THREE.AdditiveBlending, depthWrite: false, sizeAttenuation: true
  }));
  bgScene.add(bgPoints);
  (function loop() { bgAnimId = requestAnimationFrame(loop); bgPoints.rotation.y += 0.00025; bgPoints.rotation.x += 0.0001; bgRenderer.render(bgScene, bgCamera); })();
}

// ============================================================
// 2. B+ TREE 3D SCENE
// ============================================================
const btreeState = { scene: null, camera: null, renderer: null, controls: null, group: null, container: null };

export function initBTreeScene(container) {
  btreeState.container = container;
  btreeState.scene = new THREE.Scene();
  btreeState.camera = new THREE.PerspectiveCamera(50, container.clientWidth / Math.max(container.clientHeight, 1), 0.1, 200);
  btreeState.camera.position.set(0, 5, 18);
  btreeState.renderer = makeRenderer(container);
  btreeState.controls = new OrbitControls(btreeState.camera, btreeState.renderer.domElement);
  btreeState.controls.enableDamping = true; btreeState.controls.dampingFactor = 0.08;
  btreeState.controls.autoRotate = true; btreeState.controls.autoRotateSpeed = 0.4;
  btreeState.group = new THREE.Group();
  btreeState.scene.add(btreeState.group);
  // Ambient grid floor
  const gridHelper = new THREE.GridHelper(30, 30, 0x0a1628, 0x0a1628);
  gridHelper.position.y = -4;
  btreeState.scene.add(gridHelper);

  // Raycasting for hover detection on B+ tree nodes
  const raycaster = new THREE.Raycaster();
  const mouse = new THREE.Vector2();
  let hoveredNodeData = null;

  function onMouseMove(event) {
    const rect = container.getBoundingClientRect();
    mouse.x = ((event.clientX - rect.left) / rect.width) * 2 - 1;
    mouse.y = -((event.clientY - rect.top) / rect.height) * 2 + 1;

    raycaster.setFromCamera(mouse, btreeState.camera);
    const intersects = raycaster.intersectObjects(btreeState.group.children, true);
    
    let foundNode = null;
    if (intersects.length > 0) {
      for (const hit of intersects) {
        // Walk up to find a group with btreeNodeRef
        let obj = hit.object;
        while (obj && !obj.userData.btreeNodeRef) {
          obj = obj.parent;
        }
        if (obj && obj.userData.btreeNodeRef) {
          foundNode = obj.userData.btreeNodeRef;
          break;
        }
      }
    }

    if (foundNode !== hoveredNodeData) {
      hoveredNodeData = foundNode;
      const customEvent = new CustomEvent('btree-hover', { 
        detail: { 
          node: foundNode,
          mouseX: event.clientX,
          mouseY: event.clientY
        } 
      });
      container.dispatchEvent(customEvent);
    }
  }

  container.addEventListener('mousemove', onMouseMove);
}

export function updateBTree(root) {
  if (!btreeState.group || !root) return;
  // Clear old
  while (btreeState.group.children.length) {
    const child = btreeState.group.children[0];
    btreeState.group.remove(child);
  }
  // BFS traverse the tree
  const levels = [];
  const queue = [{ node: root, level: 0, parentPos: null }];
  const nodePositions = new Map();
  while (queue.length > 0) {
    const { node, level } = queue.shift();
    if (!levels[level]) levels[level] = [];
    levels[level].push(node);
    if (!node.isLeaf && node.children) {
      for (const child of node.children) {
        queue.push({ node: child, level: level + 1 });
      }
    }
  }
  // Layout positions
  const levelSpacing = 3.5;
  const totalHeight = (levels.length - 1) * levelSpacing;
  for (let l = 0; l < levels.length; l++) {
    const nodes = levels[l];
    const count = nodes.length;
    const maxSpread = Math.max(12, count * 3.5);
    const spacing = maxSpread / (count + 1);
    for (let i = 0; i < count; i++) {
      const x = (i + 1) * spacing - maxSpread / 2;
      const y = totalHeight / 2 - l * levelSpacing;
      const z = 0;
      nodePositions.set(nodes[i], { x, y, z });
    }
  }
  // Create 3D objects
  for (let l = 0; l < levels.length; l++) {
    for (const node of levels[l]) {
      const pos = nodePositions.get(node);
      const keysStr = node.keys.join(' | ');
      const boxW = Math.max(2, node.keys.length * 1.2);
      const isLeaf = node.isLeaf;
      const edgeColor = isLeaf ? C.magenta : C.cyan;
      const fillColor = C.nodeFill;
      const box = glowBox(boxW, 0.8, 0.5, fillColor, edgeColor);
      box.position.set(pos.x, pos.y, pos.z);
      // Store reference to the B+ tree node data for raycasting hover lookup
      box.userData.btreeNodeRef = node;
      btreeState.group.add(box);
      // Key label
      const label = makeLabel(keysStr, { color: isLeaf ? '#ff007f' : '#00f2fe', fontSize: 18, scale: 0.8 });
      label.position.set(pos.x, pos.y, pos.z + 0.5);
      label.userData.btreeNodeRef = node;
      btreeState.group.add(label);
      // Type label
      const typeLabel = makeLabel(isLeaf ? 'LEAF' : 'INTERNAL', { color: '#57606a', fontSize: 12, scale: 0.5 });
      typeLabel.position.set(pos.x, pos.y - 0.6, pos.z + 0.3);
      typeLabel.userData.btreeNodeRef = node;
      btreeState.group.add(typeLabel);
      // Connections to children
      if (!node.isLeaf && node.children) {
        for (const child of node.children) {
          const childPos = nodePositions.get(child);
          if (childPos) {
            const line = makeLine(pos, childPos, edgeColor, 0.35);
            btreeState.group.add(line);
            // Particle stream
            const stream = makeParticleStream(pos, childPos, edgeColor, 8);
            btreeState.group.add(stream);
          }
        }
      }
    }
  }
}

// ============================================================
// 3. QUERY PLAN 3D SCENE
// ============================================================
const qpState = { scene: null, camera: null, renderer: null, controls: null, group: null, container: null, particles: [] };

export function initQueryPlanScene(container) {
  qpState.container = container;
  qpState.scene = new THREE.Scene();
  qpState.camera = new THREE.PerspectiveCamera(50, container.clientWidth / Math.max(container.clientHeight, 1), 0.1, 200);
  qpState.camera.position.set(0, 2, 14);
  qpState.renderer = makeRenderer(container);
  qpState.controls = new OrbitControls(qpState.camera, qpState.renderer.domElement);
  qpState.controls.enableDamping = true; qpState.controls.dampingFactor = 0.08;
  qpState.controls.autoRotate = true; qpState.controls.autoRotateSpeed = 0.3;
  qpState.group = new THREE.Group();
  qpState.scene.add(qpState.group);
  const grid = new THREE.GridHelper(20, 20, 0x0a1628, 0x0a1628);
  grid.position.y = -5;
  qpState.scene.add(grid);
}

export function updateQueryPlan(planNodes) {
  if (!qpState.group) return;
  while (qpState.group.children.length) qpState.group.remove(qpState.group.children[0]);
  qpState.particles = [];
  if (!planNodes || planNodes.length === 0) return;

  const colorMap = {
    'SeqScan': C.cyan, 'Filter': C.orange, 'HashJoin': C.magenta,
    'Projection': C.green, 'Sort': C.purple, 'Aggregate': C.blue
  };
  const spacing = 3;
  const totalH = (planNodes.length - 1) * spacing;

  for (let i = 0; i < planNodes.length; i++) {
    const n = planNodes[i];
    const y = -totalH / 2 + i * spacing;
    const nodeColor = colorMap[n.type] || C.cyan;
    const box = glowBox(4, 1, 0.6, C.nodeFill, nodeColor);
    box.position.set(0, y, 0);
    qpState.group.add(box);

    const label = makeLabel(n.label || n.type, { color: '#' + new THREE.Color(nodeColor).getHexString(), fontSize: 18, scale: 0.9 });
    label.position.set(0, y, 0.6);
    qpState.group.add(label);

    // Connection to next operator
    if (i < planNodes.length - 1) {
      const nextY = -totalH / 2 + (i + 1) * spacing;
      const from = { x: 0, y: y + 0.6, z: 0 };
      const to = { x: 0, y: nextY - 0.6, z: 0 };
      const line = makeLine(from, to, nodeColor, 0.3);
      qpState.group.add(line);
      // Flowing particles
      const stream = makeParticleStream(from, to, nodeColor, 15);
      qpState.group.add(stream);
      qpState.particles.push({ points: stream, from, to, color: nodeColor });
    }
  }
}

// ============================================================
// 4. REPLICATION TOPOLOGY 3D SCENE
// ============================================================
const replState = { scene: null, camera: null, renderer: null, controls: null, group: null, container: null, beams: [] };

export function initReplicationScene(container) {
  replState.container = container;
  replState.scene = new THREE.Scene();
  replState.camera = new THREE.PerspectiveCamera(50, container.clientWidth / Math.max(container.clientHeight, 1), 0.1, 200);
  replState.camera.position.set(0, 8, 16);
  replState.renderer = makeRenderer(container);
  replState.controls = new OrbitControls(replState.camera, replState.renderer.domElement);
  replState.controls.enableDamping = true; replState.controls.dampingFactor = 0.08;
  replState.controls.autoRotate = true; replState.controls.autoRotateSpeed = 0.6;
  replState.group = new THREE.Group();
  replState.scene.add(replState.group);
  // Floor ring
  const ringGeo = new THREE.RingGeometry(5.5, 6, 64);
  const ringMat = new THREE.MeshBasicMaterial({ color: C.cyan, transparent: true, opacity: 0.06, side: THREE.DoubleSide });
  const ring = new THREE.Mesh(ringGeo, ringMat);
  ring.rotation.x = -Math.PI / 2;
  ring.position.y = -2;
  replState.scene.add(ring);
}

export function updateReplication(nodeStats) {
  if (!replState.group) return;
  while (replState.group.children.length) replState.group.remove(replState.group.children[0]);
  replState.beams = [];
  if (!nodeStats || nodeStats.length === 0) return;

  const radius = 6;
  const nodePositions = [];

  for (let i = 0; i < nodeStats.length; i++) {
    const n = nodeStats[i];
    const angle = (i / nodeStats.length) * Math.PI * 2 - Math.PI / 2;
    const x = Math.cos(angle) * radius;
    const z = Math.sin(angle) * radius;
    const y = 0;

    const isMaster = n.role === 'master';
    const isOffline = n.status === 'offline';
    const nodeColor = isMaster ? C.green : (n.role === 'primary' ? C.purple : C.cyan);
    const nodeSize = isMaster ? 1.0 : 0.7;

    // Sphere
    const sphereGeo = new THREE.SphereGeometry(nodeSize, 32, 32);
    const sphereMat = new THREE.MeshBasicMaterial({
      color: isOffline ? C.red : nodeColor,
      transparent: true,
      opacity: isOffline ? 0.25 : 0.5,
      wireframe: false
    });
    const sphere = new THREE.Mesh(sphereGeo, sphereMat);
    sphere.position.set(x, y, z);
    replState.group.add(sphere);

    // Wireframe overlay
    const wireGeo = new THREE.SphereGeometry(nodeSize * 1.05, 16, 16);
    const wireMat = new THREE.MeshBasicMaterial({
      color: isOffline ? C.red : nodeColor,
      wireframe: true, transparent: true,
      opacity: isOffline ? 0.15 : 0.35
    });
    const wire = new THREE.Mesh(wireGeo, wireMat);
    wire.position.set(x, y, z);
    replState.group.add(wire);

    // Label
    const roleTxt = n.role ? n.role.toUpperCase() : 'NODE';
    const nameTxt = n.name || `Node ${i}`;
    const label = makeLabel(`${roleTxt}: ${nameTxt}`, {
      color: isOffline ? '#ff003c' : '#' + new THREE.Color(nodeColor).getHexString(),
      fontSize: 14, scale: 0.7
    });
    label.position.set(x, y + nodeSize + 0.6, z);
    replState.group.add(label);

    // Status label
    const statusLabel = makeLabel(n.status || 'online', {
      color: isOffline ? '#ff003c' : '#8b949e', fontSize: 11, scale: 0.45
    });
    statusLabel.position.set(x, y - nodeSize - 0.5, z);
    replState.group.add(statusLabel);

    nodePositions.push({ x, y, z, role: n.role, status: n.status, color: nodeColor });
  }

  // Connection beams from master/primary to all others
  for (let i = 0; i < nodePositions.length; i++) {
    const from = nodePositions[i];
    if (from.role !== 'master' && from.role !== 'primary') continue;
    for (let j = 0; j < nodePositions.length; j++) {
      if (i === j) continue;
      const to = nodePositions[j];
      if (to.status === 'offline') continue;
      const line = makeLine(from, to, from.color, 0.15);
      replState.group.add(line);
      const stream = makeParticleStream(from, to, from.color, 12);
      replState.group.add(stream);
      replState.beams.push({ points: stream, from, to });
    }
  }
}

// ============================================================
// 6. SHARDING NODES 3D SCENE
// ============================================================
const shardState = { scene: null, camera: null, renderer: null, controls: null, group: null, container: null, shards: [], pulses: [], hoveredShardId: null };

export function initShardingScene(container) {
  shardState.container = container;
  shardState.scene = new THREE.Scene();
  shardState.camera = new THREE.PerspectiveCamera(50, container.clientWidth / Math.max(container.clientHeight, 1), 0.1, 200);
  shardState.camera.position.set(0, 4, 15);
  shardState.renderer = makeRenderer(container);
  shardState.controls = new OrbitControls(shardState.camera, shardState.renderer.domElement);
  shardState.controls.enableDamping = true; shardState.controls.dampingFactor = 0.08;
  shardState.controls.autoRotate = true; shardState.controls.autoRotateSpeed = 0.4;
  shardState.group = new THREE.Group();
  shardState.scene.add(shardState.group);
  const grid = new THREE.GridHelper(20, 20, 0x0a1628, 0x0a1628);
  grid.position.y = -4;
  shardState.scene.add(grid);

  // Raycasting for hovering detection on shard cylinder nodes
  const raycaster = new THREE.Raycaster();
  const mouse = new THREE.Vector2();

  function onMouseMove(event) {
    const rect = container.getBoundingClientRect();
    mouse.x = ((event.clientX - rect.left) / rect.width) * 2 - 1;
    mouse.y = -((event.clientY - rect.top) / rect.height) * 2 + 1;

    raycaster.setFromCamera(mouse, shardState.camera);
    const intersects = raycaster.intersectObjects(shardState.group.children, true);
    
    let activeId = null;
    if (intersects.length > 0) {
      const foundIntersect = intersects.find(inst => 
        shardState.shards.some(s => s.mesh === inst.object || s.wire === inst.object)
      );
      if (foundIntersect) {
        const matched = shardState.shards.find(s => s.mesh === foundIntersect.object || s.wire === foundIntersect.object);
        if (matched) {
          activeId = matched.id;
        }
      }
    }

    if (shardState.hoveredShardId !== activeId) {
      shardState.hoveredShardId = activeId;
      const customEvent = new CustomEvent('shard-hover', { detail: { shardId: activeId } });
      container.dispatchEvent(customEvent);
    }
  }

  container.addEventListener('mousemove', onMouseMove);
}

export function updateSharding(shardsList) {
  if (!shardState.group) return;
  while (shardState.group.children.length) shardState.group.remove(shardState.group.children[0]);
  shardState.shards = [];
  shardState.pulses = [];
  if (!shardsList || shardsList.length === 0) return;

  const count = shardsList.length;
  // Position nodes horizontally or in a slight arc
  const yRouter = 3;
  const yShard = -2;
  const spread = Math.max(10, (count - 1) * 3.5);
  
  // Router Proxy geometry (Octahedron)
  const routerGeo = new THREE.OctahedronGeometry(1.0, 0);
  const routerMat = new THREE.MeshBasicMaterial({ color: C.cyan, transparent: true, opacity: 0.35 });
  const routerNode = new THREE.Mesh(routerGeo, routerMat);
  routerNode.position.set(0, yRouter, 0);
  shardState.group.add(routerNode);
  
  const routerWire = new THREE.Mesh(routerGeo, new THREE.MeshBasicMaterial({ color: C.cyan, wireframe: true, transparent: true, opacity: 0.7 }));
  routerWire.position.set(0, yRouter, 0);
  shardState.group.add(routerWire);
  
  const routerLabel = makeLabel('QUERY PROXY ROUTER', { color: '#00f2fe', fontSize: 14, scale: 0.7 });
  routerLabel.position.set(0, yRouter + 1.5, 0);
  shardState.group.add(routerLabel);

  // Draw each shard server cylinder/rack
  for (let i = 0; i < count; i++) {
    const s = shardsList[i];
    const x = count > 1 ? -spread / 2 + (i / (count - 1)) * spread : 0;
    const z = 0;
    
    // Shard load color
    const isOverloaded = s.keysLength > 8;
    const shardColor = isOverloaded ? C.orange : (s.id === 'Shard_A' ? C.cyan : (s.id === 'Shard_B' ? C.purple : (s.id === 'Shard_C' ? C.magenta : C.green)));
    
    // Cylinder geometry representing database server
    const serverGeo = new THREE.CylinderGeometry(0.7, 0.7, 2.0, 16);
    const serverMat = new THREE.MeshBasicMaterial({ color: shardColor, transparent: true, opacity: 0.3 });
    const serverMesh = new THREE.Mesh(serverGeo, serverMat);
    serverMesh.position.set(x, yShard, z);
    shardState.group.add(serverMesh);
    
    const serverWire = new THREE.Mesh(serverGeo, new THREE.MeshBasicMaterial({ color: shardColor, wireframe: true, transparent: true, opacity: 0.6 }));
    serverWire.position.set(x, yShard, z);
    shardState.group.add(serverWire);
    
    // Shard name and keys count sprite labels
    const label = makeLabel(`${s.id}: ${s.name}`, { color: '#' + new THREE.Color(shardColor).getHexString(), fontSize: 12, scale: 0.6 });
    label.position.set(x, yShard + 1.6, z);
    shardState.group.add(label);
    
    const countLabel = makeLabel(`${s.keysLength} keys (${Math.min(100, Math.round(s.keysLength * 12))}% load)`, { color: '#8b949e', fontSize: 10, scale: 0.45 });
    countLabel.position.set(x, yShard - 1.5, z);
    shardState.group.add(countLabel);
    
    // Cable connection line from proxy to server
    const from = { x: 0, y: yRouter - 1.0, z: 0 };
    const to = { x, y: yShard + 1.0, z };
    const line = makeLine(from, to, shardColor, 0.2);
    shardState.group.add(line);
    
    shardState.shards.push({
      id: s.id,
      pos: new THREE.Vector3(x, yShard, z),
      color: shardColor,
      mesh: serverMesh,
      wire: serverWire
    });
  }
}

export function triggerShardPulse(targetShardId, color = 0x00f2fe) {
  const target = shardState.shards.find(s => s.id === targetShardId);
  if (!target) return;
  
  const from = new THREE.Vector3(0, 2, 0); // below router proxy
  const to = new THREE.Vector3(target.pos.x, target.pos.y + 1, target.pos.z);
  
  const stream = makeParticleStream(from, to, color, 12);
  shardState.group.add(stream);
  shardState.pulses.push({ points: stream, from, to, progress: 0 });
}

// ============================================================
// 5. SYSTEM OVERVIEW 3D SCENE
// ============================================================
const ovState = { scene: null, camera: null, renderer: null, controls: null, group: null, container: null, subsystems: [] };

export function initOverviewScene(container) {
  ovState.container = container;
  ovState.scene = new THREE.Scene();
  ovState.camera = new THREE.PerspectiveCamera(50, container.clientWidth / Math.max(container.clientHeight, 1), 0.1, 200);
  ovState.camera.position.set(0, 8, 18);
  ovState.renderer = makeRenderer(container);
  ovState.controls = new OrbitControls(ovState.camera, ovState.renderer.domElement);
  ovState.controls.enableDamping = true; ovState.controls.dampingFactor = 0.08;
  ovState.controls.autoRotate = true; ovState.controls.autoRotateSpeed = 0.8;
  ovState.group = new THREE.Group();
  ovState.scene.add(ovState.group);
}

export function updateOverview(tracker) {
  if (!ovState.group) return;
  while (ovState.group.children.length) ovState.group.remove(ovState.group.children[0]);
  ovState.subsystems = [];

  // Central hub
  const hubGeo = new THREE.IcosahedronGeometry(1.5, 1);
  const hubMat = new THREE.MeshBasicMaterial({ color: C.cyan, transparent: true, opacity: 0.3 });
  const hub = new THREE.Mesh(hubGeo, hubMat);
  ovState.group.add(hub);
  const hubWire = new THREE.Mesh(
    new THREE.IcosahedronGeometry(1.6, 1),
    new THREE.MeshBasicMaterial({ color: C.cyan, wireframe: true, transparent: true, opacity: 0.5 })
  );
  ovState.group.add(hubWire);
  const hubLabel = makeLabel('DBMS ENGINE', { color: '#00f2fe', fontSize: 16, scale: 0.8 });
  hubLabel.position.set(0, 2.5, 0);
  ovState.group.add(hubLabel);

  // Subsystem nodes
  const subs = [
    { name: 'B+ Tree Index', color: C.cyan, icon: '🌲' },
    { name: 'Buffer Pool', color: C.magenta, icon: '💾' },
    { name: 'Lock Manager', color: C.orange, icon: '🔒' },
    { name: 'Sharding', color: C.purple, icon: '🔀' },
    { name: 'CQRS', color: C.green, icon: '📡' },
    { name: 'Replication', color: C.blue, icon: '🔄' }
  ];

  const radius = 7;
  for (let i = 0; i < subs.length; i++) {
    const angle = (i / subs.length) * Math.PI * 2 - Math.PI / 2;
    const x = Math.cos(angle) * radius;
    const z = Math.sin(angle) * radius;
    const sub = subs[i];

    // Node sphere
    const nodeGeo = new THREE.OctahedronGeometry(0.8, 0);
    const nodeMat = new THREE.MeshBasicMaterial({ color: sub.color, transparent: true, opacity: 0.35 });
    const node = new THREE.Mesh(nodeGeo, nodeMat);
    node.position.set(x, 0, z);
    ovState.group.add(node);

    const nodeWire = new THREE.Mesh(
      new THREE.OctahedronGeometry(0.9, 0),
      new THREE.MeshBasicMaterial({ color: sub.color, wireframe: true, transparent: true, opacity: 0.5 })
    );
    nodeWire.position.set(x, 0, z);
    ovState.group.add(nodeWire);
    ovState.subsystems.push({ mesh: node, wire: nodeWire, baseY: 0 });

    // Label
    const label = makeLabel(sub.name, {
      color: '#' + new THREE.Color(sub.color).getHexString(), fontSize: 14, scale: 0.65
    });
    label.position.set(x, 1.8, z);
    ovState.group.add(label);

    // Connection to hub
    const line = makeLine({ x: 0, y: 0, z: 0 }, { x, y: 0, z }, sub.color, 0.2);
    ovState.group.add(line);
    const stream = makeParticleStream({ x: 0, y: 0, z: 0 }, { x, y: 0, z }, sub.color, 10);
    ovState.group.add(stream);
  }

  // Stats labels
  if (tracker) {
    const statsData = [
      { label: `TXN: ${tracker.txCount || 0}`, y: -3 },
      { label: `HIT: ${tracker.bufferHitRate ? tracker.bufferHitRate.toFixed(0) : 0}%`, y: -3.8 }
    ];
    for (const s of statsData) {
      const sl = makeLabel(s.label, { color: '#8b949e', fontSize: 12, scale: 0.5 });
      sl.position.set(0, s.y, 0);
      ovState.group.add(sl);
    }
  }
}

// ============================================================
// ANIMATION LOOP & SCENE MANAGEMENT
// ============================================================
let activeScene = null;
let mainAnimId = null;
let clock = new THREE.Clock();

export function setActiveScene(name) {
  activeScene = name;
}

function animateScenes() {
  mainAnimId = requestAnimationFrame(animateScenes);
  const t = clock.getElapsedTime();

  // B+ Tree
  if (activeScene === 'btree' && btreeState.renderer) {
    btreeState.controls.update();
    // Gentle float on nodes
    if (btreeState.group) {
      btreeState.group.children.forEach((child, i) => {
        if (child.isGroup) child.position.y += Math.sin(t * 1.5 + i * 0.3) * 0.001;
      });
    }
    btreeState.renderer.render(btreeState.scene, btreeState.camera);
  }

  // Query Plan
  if (activeScene === 'queryplan' && qpState.renderer) {
    qpState.controls.update();
    // Animate particle streams upward
    qpState.particles.forEach(p => {
      const positions = p.points.geometry.attributes.position;
      for (let i = 0; i < positions.count; i++) {
        let y = positions.getY(i);
        y += 0.02;
        if (y > p.to.y) y = p.from.y;
        positions.setY(i, y);
        positions.setX(i, positions.getX(i) + (Math.random() - 0.5) * 0.01);
      }
      positions.needsUpdate = true;
    });
    qpState.renderer.render(qpState.scene, qpState.camera);
  }

  // Replication
  if (activeScene === 'replication' && replState.renderer) {
    replState.controls.update();
    // Animate replication beams
    replState.beams.forEach(b => {
      const positions = b.points.geometry.attributes.position;
      for (let i = 0; i < positions.count; i++) {
        const dx = b.to.x - b.from.x;
        const dz = b.to.z - b.from.z;
        const len = Math.sqrt(dx * dx + dz * dz);
        let px = positions.getX(i) + (dx / len) * 0.03;
        let pz = positions.getZ(i) + (dz / len) * 0.03;
        // Reset if past destination
        const distNow = Math.sqrt((px - b.from.x) ** 2 + (pz - b.from.z) ** 2);
        if (distNow > len) { px = b.from.x + (Math.random() - 0.5) * 0.3; pz = b.from.z + (Math.random() - 0.5) * 0.3; }
        positions.setX(i, px);
        positions.setZ(i, pz);
      }
      positions.needsUpdate = true;
    });
    // Gentle sphere rotation
    replState.group.children.forEach(child => {
      if (child.isMesh && child.geometry.type === 'SphereGeometry') {
        child.rotation.y += 0.003;
      }
    });
    replState.renderer.render(replState.scene, replState.camera);
  }

  // System Overview
  if (activeScene === 'overview' && ovState.renderer) {
    ovState.controls.update();
    // Float subsystems
    ovState.subsystems.forEach((s, i) => {
      s.mesh.position.y = s.baseY + Math.sin(t * 1.2 + i * 1.0) * 0.3;
      s.wire.position.y = s.mesh.position.y;
      s.mesh.rotation.y += 0.008;
      s.wire.rotation.y += 0.008;
    });
    // Hub rotation
    ovState.group.children.forEach(child => {
      if (child.isMesh && child.geometry.type === 'IcosahedronGeometry') {
        child.rotation.y += 0.004;
        child.rotation.x += 0.002;
      }
    });
    ovState.renderer.render(ovState.scene, ovState.camera);
  }

  // Sharding Nodes
  if (activeScene === 'sharding' && shardState.renderer) {
    shardState.controls.update();
    shardState.pulses = shardState.pulses.filter(p => {
      p.progress += 0.04;
      const positions = p.points.geometry.attributes.position;
      for (let i = 0; i < positions.count; i++) {
        const t = (i / positions.count) * 0.2 + p.progress;
        if (t < 1) {
          const cx = p.from.x + (p.to.x - p.from.x) * t;
          const cy = p.from.y + (p.to.y - p.from.y) * t;
          const cz = p.from.z + (p.to.z - p.from.z) * t;
          positions.setXYZ(i, cx + (Math.random()-0.5)*0.1, cy, cz + (Math.random()-0.5)*0.1);
        } else {
          positions.setXYZ(i, p.to.x, p.to.y, p.to.z);
        }
      }
      positions.needsUpdate = true;
      if (p.progress >= 1.2) {
        shardState.group.remove(p.points);
        return false;
      }
      return true;
    });
    // Smoothly animate cylinder scale and opacity based on hover state
    shardState.shards.forEach(s => {
      const isHovered = s.id === shardState.hoveredShardId;
      const targetScale = isHovered ? 1.25 : 1.0;
      const targetOpacity = isHovered ? 0.75 : 0.3;
      const targetWireOpacity = isHovered ? 0.95 : 0.6;
      
      if (s.mesh) {
        s.mesh.scale.set(targetScale, targetScale, targetScale);
        s.mesh.material.opacity += (targetOpacity - s.mesh.material.opacity) * 0.15;
      }
      if (s.wire) {
        s.wire.scale.set(targetScale, targetScale, targetScale);
        s.wire.material.opacity += (targetWireOpacity - s.wire.material.opacity) * 0.15;
      }
    });

    shardState.group.children.forEach(child => {
      if (child.isMesh && child.geometry.type === 'CylinderGeometry') {
        child.rotation.y += 0.005;
      }
      if (child.isMesh && child.geometry.type === 'OctahedronGeometry') {
        child.rotation.y += 0.002;
        child.rotation.z += 0.001;
      }
    });
    shardState.renderer.render(shardState.scene, shardState.camera);
  }
}

export function startAnimationLoop() {
  if (mainAnimId) cancelAnimationFrame(mainAnimId);
  animateScenes();
}

export function handleResize() {
  const w = window.innerWidth, h = window.innerHeight;
  if (bgRenderer) { bgCamera.aspect = w / h; bgCamera.updateProjectionMatrix(); bgRenderer.setSize(w, h); }

  const resizeScene = (state) => {
    if (state.renderer && state.container) {
      const cw = state.container.clientWidth || 1;
      const ch = state.container.clientHeight || 1;
      state.camera.aspect = cw / ch;
      state.camera.updateProjectionMatrix();
      state.renderer.setSize(cw, ch);
    }
  };
  resizeScene(btreeState);
  resizeScene(qpState);
  resizeScene(replState);
  resizeScene(ovState);
  resizeScene(shardState);
}

window.addEventListener('resize', handleResize);
