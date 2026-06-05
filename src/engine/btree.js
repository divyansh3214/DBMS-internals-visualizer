export class BPlusTreeNode {
  constructor(isLeaf = false) {
    this.id = 'page_' + Math.random().toString(36).substr(2, 5).toUpperCase();
    this.isLeaf = isLeaf;
    this.keys = [];
    this.children = []; // Pointers to child nodes (if internal) or values (if leaf)
    this.parent = null;
    this.next = null; // Linked list pointer for leaves
    this.prev = null;
  }
}

export class BPlusTree {
  constructor(order = 3) {
    this.root = new BPlusTreeNode(true);
    this.order = order; // Max children = order. Max keys = order - 1.
  }

  // Find the leaf node that should contain key
  findLeaf(key, trace = []) {
    let curr = this.root;
    trace.push({ nodeId: curr.id, action: 'start', keys: [...curr.keys] });
    
    while (!curr.isLeaf) {
      let found = false;
      for (let i = 0; i < curr.keys.length; i++) {
        if (key < curr.keys[i]) {
          trace.push({
            nodeId: curr.id,
            action: 'traverse',
            decision: `key ${key} < node.keys[${i}] (${curr.keys[i]}), going down to child ${i}`,
            keys: [...curr.keys]
          });
          curr = curr.children[i];
          found = true;
          break;
        }
      }
      if (!found) {
        trace.push({
          nodeId: curr.id,
          action: 'traverse',
          decision: `key ${key} >= all keys, going down to rightmost child`,
          keys: [...curr.keys]
        });
        curr = curr.children[curr.children.length - 1];
      }
    }
    
    trace.push({ nodeId: curr.id, action: 'target_leaf', keys: [...curr.keys] });
    return { leaf: curr, trace };
  }

  search(key) {
    const { leaf, trace } = this.findLeaf(key);
    const index = leaf.keys.indexOf(key);
    const found = index !== -1;
    trace.push({
      nodeId: leaf.id,
      action: found ? 'found' : 'not_found',
      key: key,
      result: found ? `Found at index ${index}` : 'Not found in leaf'
    });
    return { found, val: found ? leaf.children[index] : null, trace };
  }

  insert(key, value) {
    const { leaf, trace } = this.findLeaf(key, []);
    
    // Find index to insert
    let idx = 0;
    while (idx < leaf.keys.length && leaf.keys[idx] < key) {
      idx++;
    }
    
    // Check duplicate
    if (leaf.keys[idx] === key) {
      trace.push({ action: 'duplicate', msg: `Key ${key} already exists. Update value.` });
      leaf.children[idx] = value;
      return trace;
    }

    leaf.keys.splice(idx, 0, key);
    leaf.children.splice(idx, 0, value);
    trace.push({ nodeId: leaf.id, action: 'insert_into_leaf', keys: [...leaf.keys] });

    if (leaf.keys.length >= this.order) {
      this.splitLeaf(leaf, trace);
    }
    return trace;
  }

  splitLeaf(leaf, trace) {
    trace.push({ nodeId: leaf.id, action: 'split_leaf_start', keys: [...leaf.keys] });
    const sibling = new BPlusTreeNode(true);
    
    // Distribute keys & children (values)
    const mid = Math.floor(this.order / 2);
    
    sibling.keys = leaf.keys.slice(mid);
    sibling.children = leaf.children.slice(mid);
    
    leaf.keys = leaf.keys.slice(0, mid);
    leaf.children = leaf.children.slice(0, mid);

    // Maintain linked list pointers
    sibling.next = leaf.next;
    if (sibling.next) {
      sibling.next.prev = sibling;
    }
    leaf.next = sibling;
    sibling.prev = leaf;

    sibling.parent = leaf.parent;
    trace.push({
      action: 'split_leaf_done',
      leafId: leaf.id,
      leafKeys: [...leaf.keys],
      siblingId: sibling.id,
      siblingKeys: [...sibling.keys],
      promotedKey: sibling.keys[0]
    });

    if (!leaf.parent) {
      // Create new root
      const newRoot = new BPlusTreeNode(false);
      newRoot.keys = [sibling.keys[0]];
      newRoot.children = [leaf, sibling];
      leaf.parent = newRoot;
      sibling.parent = newRoot;
      this.root = newRoot;
      trace.push({ nodeId: newRoot.id, action: 'new_root', keys: [...newRoot.keys] });
    } else {
      this.insertIntoParent(leaf, sibling.keys[0], sibling, trace);
    }
  }

  insertIntoParent(left, key, right, trace) {
    const parent = left.parent;
    let idx = 0;
    while (idx < parent.keys.length && parent.keys[idx] < key) {
      idx++;
    }

    parent.keys.splice(idx, 0, key);
    parent.children.splice(idx + 1, 0, right);
    right.parent = parent;

    trace.push({ nodeId: parent.id, action: 'insert_parent', keys: [...parent.keys] });

    if (parent.keys.length >= this.order) {
      this.splitInternal(parent, trace);
    }
  }

  splitInternal(node, trace) {
    trace.push({ nodeId: node.id, action: 'split_internal_start', keys: [...node.keys] });
    const sibling = new BPlusTreeNode(false);
    
    const mid = Math.floor(node.keys.length / 2);
    const promotedKey = node.keys[mid];

    sibling.keys = node.keys.slice(mid + 1);
    sibling.children = node.children.slice(mid + 1);
    
    node.keys = node.keys.slice(0, mid);
    node.children = node.children.slice(0, mid + 1);

    // Update parent pointers for moved children
    for (let child of sibling.children) {
      child.parent = sibling;
    }

    sibling.parent = node.parent;

    trace.push({
      action: 'split_internal_done',
      nodeId: node.id,
      nodeKeys: [...node.keys],
      siblingId: sibling.id,
      siblingKeys: [...sibling.keys],
      promotedKey: promotedKey
    });

    if (!node.parent) {
      const newRoot = new BPlusTreeNode(false);
      newRoot.keys = [promotedKey];
      newRoot.children = [node, sibling];
      node.parent = newRoot;
      sibling.parent = newRoot;
      this.root = newRoot;
      trace.push({ nodeId: newRoot.id, action: 'new_root', keys: [...newRoot.keys] });
    } else {
      this.insertIntoParent(node, promotedKey, sibling, trace);
    }
  }

  // Basic delete implementation
  delete(key) {
    const { leaf, trace } = this.findLeaf(key);
    const idx = leaf.keys.indexOf(key);
    if (idx === -1) {
      trace.push({ action: 'delete_not_found', key });
      return trace;
    }

    leaf.keys.splice(idx, 1);
    leaf.children.splice(idx, 1);
    trace.push({ nodeId: leaf.id, action: 'delete_key', key, keys: [...leaf.keys] });

    // Underflow check: Order=3, Min keys in leaf = floor(3/2) = 1.
    // If root is leaf, it can have 0 keys.
    if (leaf !== this.root && leaf.keys.length < Math.floor(this.order / 2)) {
      this.handleUnderflow(leaf, trace);
    }
    return trace;
  }

  handleUnderflow(node, trace) {
    trace.push({ nodeId: node.id, action: 'underflow', keys: [...node.keys] });
    
    const parent = node.parent;
    const siblingIdx = parent.children.indexOf(node);
    
    // Try borrow from left sibling
    if (siblingIdx > 0) {
      const leftSibling = parent.children[siblingIdx - 1];
      const minKeys = Math.floor(this.order / 2);
      if (leftSibling.keys.length > minKeys) {
        trace.push({ action: 'borrow_left', node: node.id, sibling: leftSibling.id });
        if (node.isLeaf) {
          // Borrow last key of left sibling
          const key = leftSibling.keys.pop();
          const val = leftSibling.children.pop();
          node.keys.unshift(key);
          node.children.unshift(val);
          // Update parent's key at index siblingIdx - 1 to be the new first key of node
          parent.keys[siblingIdx - 1] = node.keys[0];
        } else {
          // Borrow from internal left sibling
          const key = leftSibling.keys.pop();
          const child = leftSibling.children.pop();
          const parentKey = parent.keys[siblingIdx - 1];
          
          node.keys.unshift(parentKey);
          node.children.unshift(child);
          child.parent = node;
          
          parent.keys[siblingIdx - 1] = key;
        }
        return;
      }
    }

    // Try borrow from right sibling
    if (siblingIdx < parent.children.length - 1) {
      const rightSibling = parent.children[siblingIdx + 1];
      const minKeys = Math.floor(this.order / 2);
      if (rightSibling.keys.length > minKeys) {
        trace.push({ action: 'borrow_right', node: node.id, sibling: rightSibling.id });
        if (node.isLeaf) {
          // Borrow first key of right sibling
          const key = rightSibling.keys.shift();
          const val = rightSibling.children.shift();
          node.keys.push(key);
          node.children.push(val);
          // Update parent's key at index siblingIdx to be the new first key of right sibling
          parent.keys[siblingIdx] = rightSibling.keys[0];
        } else {
          // Borrow from internal right sibling
          const key = rightSibling.keys.shift();
          const child = rightSibling.children.shift();
          const parentKey = parent.keys[siblingIdx];
          
          node.keys.push(parentKey);
          node.children.push(child);
          child.parent = node;
          
          parent.keys[siblingIdx] = key;
        }
        return;
      }
    }

    // Merge siblings
    if (siblingIdx > 0) {
      // Merge node into left sibling
      const leftSibling = parent.children[siblingIdx - 1];
      trace.push({ action: 'merge_left', left: leftSibling.id, right: node.id });
      this.merge(leftSibling, node, parent, siblingIdx - 1, trace);
    } else {
      // Merge right sibling into node
      const rightSibling = parent.children[siblingIdx + 1];
      trace.push({ action: 'merge_right', left: node.id, right: rightSibling.id });
      this.merge(node, rightSibling, parent, siblingIdx, trace);
    }
  }

  merge(left, right, parent, parentIdx, trace) {
    if (left.isLeaf) {
      left.keys = left.keys.concat(right.keys);
      left.children = left.children.concat(right.children);
      left.next = right.next;
      if (right.next) {
        right.next.prev = left;
      }
    } else {
      // Internal node merge: pull down parent key
      const parentKey = parent.keys[parentIdx];
      left.keys.push(parentKey);
      left.keys = left.keys.concat(right.keys);
      left.children = left.children.concat(right.children);
      for (let child of right.children) {
        child.parent = left;
      }
    }

    // Remove key and child pointer from parent
    parent.keys.splice(parentIdx, 1);
    parent.children.splice(parentIdx + 1, 1);

    if (parent === this.root && parent.keys.length === 0) {
      // Root became empty, left becomes new root
      left.parent = null;
      this.root = left;
      trace.push({ action: 'new_root', nodeId: left.id });
    } else if (parent !== this.root && parent.keys.length < Math.floor(this.order / 2)) {
      this.handleUnderflow(parent, trace);
    }
  }

  // Calculate coordinates for visual layout of tree
  getVisualLayout(canvasWidth, startY = 60, nodeSpacingY = 80) {
    const layout = [];
    const levels = {};
    
    const traverse = (node, depth) => {
      if (!levels[depth]) levels[depth] = [];
      levels[depth].push(node);
      if (!node.isLeaf) {
        for (let child of node.children) {
          traverse(child, depth + 1);
        }
      }
    };
    
    traverse(this.root, 0);
    
    // Position nodes level by level
    const maxDepth = Math.max(...Object.keys(levels).map(Number));
    
    for (let depth = maxDepth; depth >= 0; depth--) {
      const nodes = levels[depth];
      const count = nodes.length;
      
      if (depth === maxDepth) {
        // Position leaf nodes evenly across canvas
        const segment = canvasWidth / (count + 1);
        nodes.forEach((node, idx) => {
          node.x = segment * (idx + 1);
          node.y = startY + depth * nodeSpacingY;
          layout.push(node);
        });
      } else {
        // Internal nodes are centered above their children
        nodes.forEach((node) => {
          let childSumX = 0;
          node.children.forEach(c => {
            childSumX += c.x;
          });
          node.x = childSumX / node.children.length;
          node.y = startY + depth * nodeSpacingY;
          layout.push(node);
        });
      }
    }
    
    return layout;
  }

  reset() {
    this.root = new BPlusTreeNode(true);
  }
}
