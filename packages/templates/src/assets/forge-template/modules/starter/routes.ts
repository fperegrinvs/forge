import type { RouteRegistrar } from "../../shared/types.js";

const routes: RouteRegistrar = async (app) => {
  app.get("/starter", async () => ({ ok: true }));
};

export default routes;
