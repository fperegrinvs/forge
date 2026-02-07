import type { FastifyInstance } from "fastify";

export type RouteRegistrar = (app: FastifyInstance) => Promise<void>;
