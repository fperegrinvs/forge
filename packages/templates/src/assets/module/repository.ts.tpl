import type { {{pascalName}} } from "../domain/types.js";

export interface {{pascalName}}Repository {
  findById(id: string): Promise<{{pascalName}} | undefined>;
  findAll(): Promise<{{pascalName}}[]>;
  save(entity: {{pascalName}}): Promise<{{pascalName}}>;
}

export class InMemory{{pascalName}}Repository implements {{pascalName}}Repository {
  private items = new Map<string, {{pascalName}}>();

  async findById(id: string): Promise<{{pascalName}} | undefined> {
    return this.items.get(id);
  }

  async findAll(): Promise<{{pascalName}}[]> {
    return [...this.items.values()];
  }

  async save(entity: {{pascalName}}): Promise<{{pascalName}}> {
    this.items.set(entity.id, entity);
    return entity;
  }
}
