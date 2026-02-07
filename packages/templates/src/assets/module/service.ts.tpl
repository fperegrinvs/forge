import type { {{pascalName}}, Create{{pascalName}}Input } from "../domain/types.js";
import type { {{pascalName}}Repository } from "../infrastructure/{{name}}.repository.js";

export class {{pascalName}}Service {
  constructor(private readonly {{name}}Repository: {{pascalName}}Repository) {}

  async list(): Promise<{{pascalName}}[]> {
    return this.{{name}}Repository.findAll();
  }

  async getById(id: string): Promise<{{pascalName}} | undefined> {
    return this.{{name}}Repository.findById(id);
  }

  async create(input: Create{{pascalName}}Input): Promise<{{pascalName}}> {
    const entity: {{pascalName}} = {
      id: crypto.randomUUID(),
      createdAt: new Date(),
      ...input,
    };
    return this.{{name}}Repository.save(entity);
  }
}
