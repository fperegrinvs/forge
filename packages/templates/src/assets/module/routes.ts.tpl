import { z } from "zod";
import type { RouteRegistrar } from "../../shared/types.js";
import { Create{{pascalName}}InputSchema } from "./domain/types.js";

const {{pascalName}}Params = z.object({
  id: z.string().uuid(),
});

const routes: RouteRegistrar = async (app) => {
  app.get("/{{name}}", async (request) => {
    const service = request.diScope.resolve("{{name}}Service");
    return service.list();
  });

  app.get("/{{name}}/:id", async (request) => {
    const { id } = {{pascalName}}Params.parse(request.params);
    const service = request.diScope.resolve("{{name}}Service");
    return service.getById(id);
  });

  app.post("/{{name}}", async (request, reply) => {
    const body = Create{{pascalName}}InputSchema.parse(request.body);
    const service = request.diScope.resolve("{{name}}Service");
    const created = await service.create(body);
    return reply.code(201).send(created);
  });
};

export default routes;
