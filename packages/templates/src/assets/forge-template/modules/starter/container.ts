import { asClass, type AwilixContainer } from "awilix";
import { StarterService } from "./services/starter.service.js";
import { InMemoryStarterRepository } from "./infrastructure/starter.repository.js";

// Each module exports a register function called from the composition root.
// Use asClass().scoped() for request-scoped services.
export function registerStarterModule(container: AwilixContainer): void {
  container.register({
    starterService: asClass(StarterService).scoped(),
    starterRepository: asClass(InMemoryStarterRepository).scoped(),
  });
}
