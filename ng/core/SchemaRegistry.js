export class SchemaRegistry {
  constructor() { this.schemas = new Map(); }
  register(name, validator) { this.schemas.set(name, validator); }
  validate(name, value) { const validator = this.schemas.get(name); if (!validator) throw new Error(`Unknown schema: ${name}`); return validator(value); }
}
