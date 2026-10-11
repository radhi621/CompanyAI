import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { openApiDocument } from "../src/docs/openapi";

const SRC = path.resolve(import.meta.dirname, "../src");

/** "METHOD /path" for every route the API registers, read from the route files. */
function registeredRoutes(): string[] {
  const index = readFileSync(path.join(SRC, "routes/index.ts"), "utf8");
  const mounts = new Map<string, string>();
  for (const [, prefix, routerName] of index.matchAll(/apiRouter\.use\("([^"]+)",\s*(\w+)\)/g)) {
    mounts.set(routerName, prefix);
  }

  const routes: string[] = [];
  const modulesDir = path.join(SRC, "modules");
  for (const moduleName of readdirSync(modulesDir)) {
    const dir = path.join(modulesDir, moduleName);
    for (const file of readdirSync(dir).filter((name) => name.endsWith(".routes.ts"))) {
      const source = readFileSync(path.join(dir, file), "utf8");
      for (const [, routerName, method, routePath] of source.matchAll(
        /(\w+)\.(get|post|put|patch|delete)\(\s*"([^"]*)"/g,
      )) {
        const prefix = mounts.get(routerName);
        if (prefix === undefined) {
          continue;
        }
        const fullPath = `${prefix}${routePath === "/" ? "" : routePath}`.replace(/:(\w+)/g, "{$1}");
        routes.push(`${method.toUpperCase()} ${fullPath}`);
      }
    }
  }
  return routes.sort();
}

function documentedRoutes(): string[] {
  return Object.entries(openApiDocument.paths)
    .flatMap(([docPath, operations]) => Object.keys(operations).map((method) => `${method.toUpperCase()} ${docPath}`))
    .sort();
}

describe("OpenAPI document", () => {
  it("documents every API route, and nothing that does not exist", () => {
    const registered = registeredRoutes();
    const documented = documentedRoutes().filter((route) => route !== "GET /health");

    expect(registered.length).toBeGreaterThan(40);
    expect(documented).toEqual(registered);
  });
});
