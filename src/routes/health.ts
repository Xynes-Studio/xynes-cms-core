import { Hono } from "hono";
import {
  type HealthControllerDeps,
  createGetHealth,
  getHealth,
} from "../controllers/health.controller";

export function createHealthRoute(deps: HealthControllerDeps = {}) {
  const healthRoute = new Hono();
  healthRoute.get("/health", createGetHealth(deps));
  return healthRoute;
}

const healthRoute = new Hono();
healthRoute.get("/health", getHealth);

export default healthRoute;
