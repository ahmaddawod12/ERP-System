declare module 'pg' {
  export class Pool {
    constructor(options?: any);
    connect(): Promise<any>;
    query(queryText: string, values?: unknown[]): Promise<any>;
    end(): Promise<void>;
  }

  export type QueryResult = any;
  export type PoolClient = any;
}
