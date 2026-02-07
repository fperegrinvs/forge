import { z } from "zod";
import type { RouteRegistrar } from "../../shared/types.js";
import { CreateStarterInputSchema } from "./domain/types.js";

const StarterParams = z.object({
  id: z.string().uuid(),
});

// Routes default-export a RouteRegistrar (async Fastify plugin).
// Resolve services from request.diScope — never import service instances directly.
const routes: RouteRegistrar = async (app) => {
  app.get("/starter", async (request) => {
    const starterService = request.diScope.resolve("starterService");
    return starterService.list();
  });

  app.get("/starter/:id", async (request) => {
    const { id } = StarterParams.parse(request.params);
    const starterService = request.diScope.resolve("starterService");
    return starterService.getById(id);
  });

  app.post("/starter", async (request, reply) => {
    const body = CreateStarterInputSchema.parse(request.body);
    const starterService = request.diScope.resolve("starterService");
    const created = await starterService.create(body);
    return reply.code(201).send(created);
  });
};

export default routes;
