declare module 'pg' {
  export interface QueryResultRow {
    [column: string]: unknown;
  }

  export interface QueryResult<Row extends QueryResultRow = QueryResultRow> {
    rows: Row[];
    rowCount: number | null;
  }

  export interface PoolClient {
    query<Row extends QueryResultRow = QueryResultRow>(
      queryText: string,
      values?: unknown[],
    ): Promise<QueryResult<Row>>;
    release(): void;
  }

  export class Pool {
    constructor(options?: any);
    connect(): Promise<PoolClient>;
    query<Row extends QueryResultRow = QueryResultRow>(
      queryText: string,
      values?: unknown[],
    ): Promise<QueryResult<Row>>;
    end(): Promise<void>;
  }
}
