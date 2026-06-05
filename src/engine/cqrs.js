export class CqrsManager {
  constructor() {
    this.writeDB = {};
    this.readDB = {};
    this.eventQueue = [];
    this.syncDelay = 1500; // ms
    this.eventIdCounter = 1;

    // Seed database
    this.seed();
  }

  seed(customRows = null) {
    if (customRows && Array.isArray(customRows)) {
      this.writeDB = {};
      customRows.forEach((row, i) => {
        const id = String(row.id || row.user_id || row.order_id || `rec_${i + 1}`);
        const username = String(row.username || row.name || row.title || `user_${id}`);
        const level = row.level !== undefined ? row.level : (row.age !== undefined ? row.age : (row.amount !== undefined ? row.amount : 10));
        const status = String(row.status || row.role || 'Active');
        this.writeDB[id] = { id, username, level, status };
      });
    } else {
      this.writeDB = {};
    }

    // Deep copy to read DB initially
    this.readDB = JSON.parse(JSON.stringify(this.writeDB));
    this.eventQueue = [];
  }

  // COMMAND (Write path)
  executeCommand(userId, field, newValue) {
    const steps = [];
    const timestamp = Date.now();
    const eventId = `EVT_${this.eventIdCounter++}`;
    
    steps.push(`[Command Gateway] Received UpdateCommand: User: ${userId}, Set ${field} = "${newValue}"`);
    
    if (!this.writeDB[userId]) {
      steps.push(`[Write Model] Error: User ${userId} not found.`);
      return { success: false, steps };
    }

    const oldRecord = { ...this.writeDB[userId] };
    const expectedType = typeof oldRecord[field];
    let coercedValue = newValue;

    if (expectedType === 'number') {
      const parsed = Number(newValue);
      if (isNaN(parsed) || newValue === '') {
        steps.push(`[Command Gateway] Validation Error: Field "${field}" expects a numeric value, but received "${newValue}".`);
        return { success: false, steps };
      }
      coercedValue = parsed;
    }

    this.writeDB[userId][field] = coercedValue;
    
    steps.push(`[Write DB] COMMITTED: User ${userId} updated. Field ${field} changed from "${oldRecord[field]}" to "${coercedValue}".`);

    // Emit replication event
    const event = {
      id: eventId,
      type: 'USER_UPDATED',
      userId,
      field,
      oldValue: oldRecord[field],
      newValue: coercedValue,
      timestamp
    };
    
    this.eventQueue.push(event);
    steps.push(`[Event Broker] Emitted Event ${eventId} to replica topic. Awaiting consumer fetch...`);

    return {
      success: true,
      event,
      steps
    };
  }

  // QUERY (Read path)
  executeQuery(userId) {
    const steps = [];
    steps.push(`[Query Gateway] Received GetUserQuery: User ID: ${userId}`);
    
    const readVal = this.readDB[userId] ? { ...this.readDB[userId] } : null;
    const writeVal = this.writeDB[userId] ? { ...this.writeDB[userId] } : null;
    
    if (!readVal) {
      steps.push(`[Read DB] Result: User not found in read store.`);
      return { record: null, isStale: false, steps };
    }

    // Check if the read store is stale
    const isStale = JSON.stringify(readVal) !== JSON.stringify(writeVal);
    
    steps.push(`[Read DB] Read completed from denormalized Query store.`);
    steps.push(`[Read DB] Record fetched: ${JSON.stringify(readVal)}`);
    
    if (isStale) {
      steps.push(`[EVENTUAL CONSISTENCY ALERT] Stale data read! Read Store value differs from Master Write Store.`);
      steps.push(`[Master Write DB is]: ${JSON.stringify(writeVal)}`);
    } else {
      steps.push(`[Consistency Status] Strong Consistency: Read store matches write store.`);
    }

    return {
      record: readVal,
      isStale,
      steps
    };
  }

  // Synchronize events whose delay has expired
  syncNextEvent(now = Date.now()) {
    if (this.eventQueue.length === 0) return null;
    
    const event = this.eventQueue[0];
    if (now - event.timestamp >= this.syncDelay) {
      // Dequeue
      this.eventQueue.shift();
      
      // Apply to Read DB
      if (this.readDB[event.userId]) {
        this.readDB[event.userId][event.field] = event.newValue;
      }
      
      return {
        event,
        log: `[Read Database Sync] Consumed Event ${event.id}. Read DB updated: user ${event.userId}.${event.field} = "${event.newValue}"`
      };
    }
    
    return null;
  }

  reset() {
    this.seed();
  }
}
