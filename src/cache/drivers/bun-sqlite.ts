import type { CacheDatabase, SqlValue } from "../driver.js"

interface BunStatement {
  run(...parameters: SqlValue[]): { changes: number }
  get(...parameters: SqlValue[]): unknown
  all(...parameters: SqlValue[]): unknown[]
}

interface BunDatabase {
  exec(sql: string): void
  query(sql: string): BunStatement
  close(): void
}

/**
 * The specifier is a variable on purpose: written inline, TypeScript tries to resolve `bun:sqlite`
 * and fails, because Bun's types are not installed and would only be right for one of the two
 * runtimes anyway. The import is reached only under Bun, so Node never evaluates it.
 */
export const openWithBunSqlite = async (path: string): Promise<CacheDatabase> => {
  const specifier = "bun:sqlite"
  const { Database } = (await import(specifier)) as { Database: new (path: string) => BunDatabase }
  const database = new Database(path)

  return {
    exec: (sql) => database.exec(sql),
    prepare: (sql) => {
      const statement = database.query(sql)
      return {
        run: (...parameters: SqlValue[]) => ({ changes: Number(statement.run(...parameters).changes) }),
        get: (...parameters: SqlValue[]) => statement.get(...parameters) as Record<string, unknown> | undefined,
        all: (...parameters: SqlValue[]) => statement.all(...parameters) as Record<string, unknown>[],
      }
    },
    close: () => database.close(),
  }
}
