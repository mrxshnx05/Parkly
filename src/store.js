const fs = require('node:fs');
const path = require('node:path');
const { initialState } = require('./seed');

class JsonStore {
  constructor(filePath) {
    this.filePath = filePath;
    this.state = null;
    this.writeQueue = Promise.resolve();
  }

  async init() {
    try {
      const raw = await fs.promises.readFile(this.filePath, 'utf8');
      const parsed = JSON.parse(raw);
      if (!parsed || !Array.isArray(parsed.users) || !Array.isArray(parsed.spaces) || !Array.isArray(parsed.bookings)) throw new Error('Malformed store');
      this.state = parsed;
    } catch (error) {
      if (error.code !== 'ENOENT') throw error;
      this.state = initialState();
      await this.persist();
    }
    return this;
  }

  snapshot() {
    return structuredClone(this.state);
  }

  async transaction(mutator) {
    const operation = this.writeQueue.then(async () => {
      const draft = structuredClone(this.state);
      const result = await mutator(draft);
      draft.updatedAt = new Date().toISOString();
      this.state = draft;
      await this.persist();
      return structuredClone(result);
    });
    this.writeQueue = operation.catch(() => undefined);
    return operation;
  }

  async persist() {
    const directory = path.dirname(this.filePath);
    await fs.promises.mkdir(directory, { recursive: true });
    const temporaryPath = `${this.filePath}.${process.pid}.${Date.now()}.tmp`;
    await fs.promises.writeFile(temporaryPath, JSON.stringify(this.state, null, 2), { encoding: 'utf8', mode: 0o600 });
    await fs.promises.rename(temporaryPath, this.filePath);
  }
}

module.exports = { JsonStore };
