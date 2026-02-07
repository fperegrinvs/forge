import type { Starter } from "../domain/types.js";

// Repository interface — the domain contract that infrastructure implements.
// Services depend on this interface, not on the concrete implementation.
export interface StarterRepository {
  findById(id: string): Promise<Starter | undefined>;
  findAll(): Promise<Starter[]>;
  save(starter: Starter): Promise<Starter>;
}

// In-memory implementation for development and testing.
// Replace with a persistent adapter (SQLite, Postgres, etc.) for production.
export class InMemoryStarterRepository implements StarterRepository {
  private items = new Map<string, Starter>();

  async findById(id: string): Promise<Starter | undefined> {
    return this.items.get(id);
  }

  async findAll(): Promise<Starter[]> {
    return [...this.items.values()];
  }

  async save(starter: Starter): Promise<Starter> {
    this.items.set(starter.id, starter);
    return starter;
  }
}
