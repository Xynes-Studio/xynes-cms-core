import { Hono } from "hono";
import {
  createGetHealth,
  getHealth,
  type HealthControllerDeps,
} from "../controllers/health.controller";

export function createHealthRoute(deps: HealthControllerDeps = {}) {
  const healthRoute = new Hono();
  healthRoute.get("/health", createGetHealth(deps));
  return healthRoute;
}

const healthRoute = new Hono();
healthRoute.get("/health", getHealth);

export default healthRoute;
