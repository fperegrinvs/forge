import type { Starter, CreateStarterInput } from "../domain/types.js";
import type { StarterRepository } from "../infrastructure/starter.repository.js";

// Services use constructor injection — parameter names must match awilix registration keys.
// No decorators needed; awilix CLASSIC mode resolves by parameter name.
export class StarterService {
  constructor(private readonly starterRepository: StarterRepository) {}

  async list(): Promise<Starter[]> {
    return this.starterRepository.findAll();
  }

  async getById(id: string): Promise<Starter | undefined> {
    return this.starterRepository.findById(id);
  }

  async create(input: CreateStarterInput): Promise<Starter> {
    const starter: Starter = {
      id: crypto.randomUUID(),
      createdAt: new Date(),
      ...input,
    };
    return this.starterRepository.save(starter);
  }
}
