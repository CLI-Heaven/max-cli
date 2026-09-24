import qrcode from "qrcode-generator"

const QUIET_ZONE = 4
// Dark modules on a light ground whatever the terminal's theme: a phone camera reads an inverted
// code unreliably, so the colours are forced even under NO_COLOR.
const BLACK_ON_WHITE = "\x1b[30;107m"
const RESET = "\x1b[0m"

/**
 * A QR code as text, two modules per character cell with half blocks, so it fits a terminal
 * without being twice as tall as it is wide. `width` is in columns, for deciding whether it fits.
 */
export const terminalQr = (link: string): { text: string; width: number } => {
  const code = qrcode(0, "M")
  code.addData(link)
  code.make()

  const count = code.getModuleCount()
  const size = count + QUIET_ZONE * 2
  const dark = (row: number, col: number) => {
    const r = row - QUIET_ZONE
    const c = col - QUIET_ZONE
    return r >= 0 && c >= 0 && r < count && c < count && code.isDark(r, c)
  }

  const lines: string[] = []
  for (let row = 0; row < size; row += 2) {
    let line = ""
    for (let col = 0; col < size; col++) {
      const top = dark(row, col)
      const bottom = row + 1 < size && dark(row + 1, col)
      line += top && bottom ? "█" : top ? "▀" : bottom ? "▄" : " "
    }
    lines.push(`${BLACK_ON_WHITE}${line}${RESET}`)
  }
  return { text: lines.join("\n"), width: size }
}
