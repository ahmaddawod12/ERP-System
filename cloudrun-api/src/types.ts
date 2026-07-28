export interface ServiceConfig {
  readonly host: string;
  readonly port: number;
  readonly logLevel: "silent" | "fatal" | "error" | "warn" | "info" | "debug" | "trace";
  readonly requestTimeoutMs: number;
}
