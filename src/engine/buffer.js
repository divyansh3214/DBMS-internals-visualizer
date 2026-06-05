export class BufferFrame {
  constructor(frameId) {
    this.frameId = frameId;
    this.pageId = null; // null if empty
    this.pinCount = 0;
    this.dirty = false;
    this.refBit = 0; // For Clock sweep
    this.lastAccessTime = 0; // For LRU
    this.loadTime = 0; // For FIFO
  }
}

export class BufferPoolManager {
  constructor(size = 16) {
    this.size = size;
    this.frames = Array.from({ length: size }, (_, i) => new BufferFrame(i));
    this.clockHand = 0;
    this.pageTable = {}; // pageId -> frameId
  }

  // Request a page: returns { frameId, status: 'HIT'|'MISS', evictedPageId: number|null, trace: [] }
  requestPage(pageId, isWrite = false, policy = 'Clock') {
    const trace = [];
    const now = Date.now();
    trace.push(`[Buffer Pool] Requested Page ${pageId} (${isWrite ? 'WRITE' : 'READ'})`);

    // Case 1: Page is already in buffer (HIT)
    if (pageId in this.pageTable) {
      const frameId = this.pageTable[pageId];
      const frame = this.frames[frameId];
      
      frame.pinCount++;
      frame.refBit = 1;
      frame.lastAccessTime = now;
      if (isWrite) {
        frame.dirty = true;
      }
      
      trace.push(`[Buffer Pool] CACHE HIT: Page ${pageId} found in Frame ${frameId}. Pin count incremented to ${frame.pinCount}.`);
      return { frameId, status: 'HIT', evictedPageId: null, trace };
    }

    // Case 2: Page is not in buffer (MISS)
    trace.push(`[Buffer Pool] CACHE MISS: Page ${pageId} not in memory. Accessing disk...`);

    // 2a. Look for an empty frame
    let targetFrameId = this.frames.findIndex(f => f.pageId === null);
    
    if (targetFrameId !== -1) {
      const frame = this.frames[targetFrameId];
      frame.pageId = pageId;
      frame.pinCount = 1;
      frame.refBit = 1;
      frame.dirty = isWrite;
      frame.lastAccessTime = now;
      frame.loadTime = now;
      this.pageTable[pageId] = targetFrameId;
      
      trace.push(`[Buffer Pool] Loaded Page ${pageId} into empty Frame ${targetFrameId}.`);
      return { frameId: targetFrameId, status: 'MISS', evictedPageId: null, trace };
    }

    // 2b. Buffer is full. Must evict a page.
    trace.push(`[Buffer Pool] Buffer full. Running eviction policy: ${policy}...`);
    const evictionResult = this.evict(policy, trace);

    if (evictionResult === null) {
      trace.push(`[Buffer Pool] ERROR: Out of buffer memory! All pages are currently pinned.`);
      return { frameId: -1, status: 'OUT_OF_MEM', evictedPageId: null, trace };
    }

    const { frameId: evictedFrameId, evictedPageId } = evictionResult;
    const frame = this.frames[evictedFrameId];
    
    // If evicted page is dirty, simulate write-back
    if (frame.dirty) {
      trace.push(`[Buffer Pool] EVICTING DIRTY PAGE ${evictedPageId} from Frame ${evictedFrameId}. Flushing dirty pages back to DISK...`);
    } else {
      trace.push(`[Buffer Pool] Evicting clean Page ${evictedPageId} from Frame ${evictedFrameId}.`);
    }

    // Unmap evicted page
    delete this.pageTable[evictedPageId];

    // Load new page
    frame.pageId = pageId;
    frame.pinCount = 1;
    frame.refBit = 1;
    frame.dirty = isWrite;
    frame.lastAccessTime = now;
    frame.loadTime = now;
    this.pageTable[pageId] = evictedFrameId;

    trace.push(`[Buffer Pool] Loaded Page ${pageId} into Frame ${evictedFrameId}.`);
    return { frameId: evictedFrameId, status: 'MISS', evictedPageId, trace };
  }

  // Evict page using selected policy. Returns { frameId, evictedPageId } or null
  evict(policy, trace) {
    if (policy === 'LRU') {
      let minTime = Infinity;
      let targetFrameIdx = -1;

      for (let i = 0; i < this.size; i++) {
        const frame = this.frames[i];
        if (frame.pinCount === 0 && frame.lastAccessTime < minTime) {
          minTime = frame.lastAccessTime;
          targetFrameIdx = i;
        }
      }

      if (targetFrameIdx !== -1) {
        const frame = this.frames[targetFrameIdx];
        const evictedPageId = frame.pageId;
        return { frameId: targetFrameIdx, evictedPageId };
      }
    } else if (policy === 'FIFO') {
      let minLoadTime = Infinity;
      let targetFrameIdx = -1;

      for (let i = 0; i < this.size; i++) {
        const frame = this.frames[i];
        if (frame.pinCount === 0 && frame.loadTime < minLoadTime) {
          minLoadTime = frame.loadTime;
          targetFrameIdx = i;
        }
      }

      if (targetFrameIdx !== -1) {
        const frame = this.frames[targetFrameIdx];
        const evictedPageId = frame.pageId;
        return { frameId: targetFrameIdx, evictedPageId };
      }
    } else {
      // Clock sweep eviction (Second Chance)
      let scans = 0;
      // Max scan iterations: size * 2. If no page can be unpinned, return null.
      while (scans < this.size * 2) {
        const idx = this.clockHand;
        const frame = this.frames[idx];
        
        trace.push(`[Clock Sweep] Checking Frame ${idx} (Page: ${frame.pageId}, Pin: ${frame.pinCount}, Ref: ${frame.refBit})`);

        if (frame.pinCount === 0) {
          if (frame.refBit === 1) {
            frame.refBit = 0;
            trace.push(`[Clock Sweep] Frame ${idx} has RefBit=1. Resetting RefBit to 0 (Second Chance)`);
          } else {
            // Found victim!
            trace.push(`[Clock Sweep] Victim found: Frame ${idx} has RefBit=0. Evicting Page ${frame.pageId}`);
            this.clockHand = (this.clockHand + 1) % this.size;
            return { frameId: idx, evictedPageId: frame.pageId };
          }
        } else {
          trace.push(`[Clock Sweep] Frame ${idx} is pinned (PinCount > 0). Skipping.`);
        }
        
        this.clockHand = (this.clockHand + 1) % this.size;
        scans++;
      }
    }

    return null; // All frames pinned
  }

  // Release a pin on page
  unpinPage(pageId) {
    if (pageId in this.pageTable) {
      const frameId = this.pageTable[pageId];
      const frame = this.frames[frameId];
      if (frame.pinCount > 0) {
        frame.pinCount--;
      }
    }
  }

  reset() {
    this.frames.forEach(f => {
      f.pageId = null;
      f.pinCount = 0;
      f.dirty = false;
      f.refBit = 0;
      f.lastAccessTime = 0;
      f.loadTime = 0;
    });
    this.clockHand = 0;
    this.pageTable = {};
  }
}
