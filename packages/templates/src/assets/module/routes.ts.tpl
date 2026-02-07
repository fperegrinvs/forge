import type { RouteRegistrar } from "../../shared/types.js";

const routes: RouteRegistrar = async (app) => {
  app.get("/{{name}}", async () => ({ module: "{{name}}" }));
};

export default routes;
