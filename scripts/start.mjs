import { loadEnvironment } from "./env.mjs";

loadEnvironment();

process.env.NODE_ENV = process.env.NODE_ENV || "production";
process.env.HOSTNAME = process.env.BIND_HOST || "0.0.0.0";
process.env.PORT = process.env.PORT || "3000";

await import("../.next/standalone/server.js");
