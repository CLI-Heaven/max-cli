import { DatabaseSync } from "node:sqlite"
import type { CacheDatabase, SqlValue } from "../driver.js"

/**
 * ⚠ On Node 22 the import itself prints `ExperimentalWarning: SQLite is an experimental feature`
 * to stderr. Node 24 is silent. Left alone deliberately (`NEED-59`): suppressing warnings
 * process-wide to hide one line costs more than it saves.
 */
export const openWithNodeSqlite = (path: string): CacheDatabase => {
  const database = new DatabaseSync(path)

  return {
    exec: (sql) => database.exec(sql),
    prepare: (sql) => {
      const statement = database.prepare(sql)
      return {
        run: (...parameters: SqlValue[]) => ({ changes: Number(statement.run(...parameters).changes) }),
        get: (...parameters: SqlValue[]) => statement.get(...parameters) as Record<string, unknown> | undefined,
        all: (...parameters: SqlValue[]) => statement.all(...parameters) as Record<string, unknown>[],
      }
    },
    close: () => database.close(),
  }
}
