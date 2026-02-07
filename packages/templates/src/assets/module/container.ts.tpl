import { asClass, type AwilixContainer } from "awilix";
import { {{pascalName}}Service } from "./services/{{name}}.service.js";
import { InMemory{{pascalName}}Repository } from "./infrastructure/{{name}}.repository.js";

export function register{{pascalName}}Module(container: AwilixContainer): void {
  container.register({
    {{name}}Service: asClass({{pascalName}}Service).scoped(),
    {{name}}Repository: asClass(InMemory{{pascalName}}Repository).scoped(),
  });
}
