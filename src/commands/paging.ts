import type { Renderer, RenderFormat, Streams } from "@leemour/cli-core"
import type { Command } from "commander"
import type { Settings } from "../config.js"
import type { Page } from "../domain/models.js"

/**
 * The three flags every listing shares, so no command invents its own spelling of them.
 *
 * ⚠ **None of them gets a `default`.** With one, commander reports the flag as always given and a
 * configured `limit` could never win it; the number lives once, in `resolveSettings`.
 */
export const withPaging = (command: Command): Command =>
  command
    .option("--limit <n>", "how many to show", (value) => Number.parseInt(value, 10))
    .option("--page <n>", "which page, starting at 1", (value) => Number.parseInt(value, 10))
    .option("--all", "every row, no paging")

/**
 * Which rows to ask the store for. `--all` means no limit, which the store reads as "everything".
 *
 * ⚠ **A page number over a live list can repeat or skip a row.** The order is most-recent-first,
 * so a message arriving between page one and page two pushes somebody across the boundary. Every
 * CLI that pages this way has this; it is in `--help` rather than engineered away.
 */
export const window = ({ limit, page, all }: Settings): { limit?: number; offset: number } =>
  all ? { offset: 0 } : { limit, offset: (page - 1) * limit }

/**
 * **One shape for every listing**, and the caller never has to work out which one it got.
 *
 * In the machine modes stdout carries the envelope. For a person it carries the table it always
 * did, and the line about there being another page goes to **stderr** as a note — stdout is data
 * in every mode, and a pager's hint is not data.
 *
 * It is a helper each command calls rather than something inside `renderer.result`, because
 * `account show` and `session start` are not lists and keep answering a bare object.
 */
export const renderPage = <T>(
  {
    renderer,
    format,
    settings,
    streams,
  }: { renderer: Renderer; format: RenderFormat; settings: Settings; streams: Streams },
  { items, hasMore }: Page<T>,
  view?: (items: T[]) => string,
  /** What to type for the rest, when the listing is not paged by `--page`. */
  more?: (items: T[]) => string,
): void => {
  if (format !== "pretty") {
    renderer.result({
      items,
      page: settings.all ? 1 : settings.page,
      limit: settings.all ? items.length : settings.limit,
      hasMore: settings.all ? false : hasMore,
    })
    return
  }

  if (view) streams.data(view(items))
  else renderer.result(items)
  if (!settings.all && hasMore)
    renderer.note(more ? more(items) : `page ${settings.page} of more — \`--page ${settings.page + 1}\` for the next`)
}
