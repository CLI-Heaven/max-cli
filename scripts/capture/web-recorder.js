// Records what a real web.max.ru tab sends, from its first frame. How to use it:
// docs/dev/capture/recording.md. Paste into the DevTools console of the page
// https://web.max.ru/_app/immutable/none.html (a same-origin 404, so the app is not running yet).
//
// Filtering happens here, inside the page: the socket carries the token, message text and phone
// numbers, and none of that may leave the tab. Every frame keeps its header; payloads are kept
// only for telemetry (5), ping (1) and INIT (6), with ids replaced by placeholders and free text by
// "<text>". Every other request keeps only its key names and value types.
;(async () => {
  if (window.__cap) return "already recording"
  if (!location.pathname.endsWith("/none.html")) {
    return "open https://web.max.ru/_app/immutable/none.html first — the app must not be running yet"
  }

  const cap = { t0: Date.now(), frames: [], ids: new Map(), sent: new Map(), sockets: new Set() }
  window.__cap = cap
  const now = () => Date.now() - cap.t0

  const lz4 = (src) => {
    const dst = []
    let pos = 0
    while (pos < src.length) {
      const token = src[pos++]
      let lit = token >> 4
      if (lit === 15) {
        let b
        do {
          b = src[pos++]
          lit += b
        } while (b === 255 && pos < src.length)
      }
      for (let i = 0; i < lit; i++) dst.push(src[pos++])
      if (pos >= src.length) break
      const offset = src[pos] | (src[pos + 1] << 8)
      pos += 2
      let match = (token & 15) + 4
      if ((token & 15) === 15) {
        let b
        do {
          b = src[pos++]
          match += b
        } while (b === 255 && pos < src.length)
      }
      const start = dst.length - offset
      for (let i = 0; i < match; i++) dst.push(dst[start + i])
    }
    return new Uint8Array(dst)
  }

  const msgpack = (u8) => {
    const dv = new DataView(u8.buffer, u8.byteOffset, u8.byteLength)
    const td = new TextDecoder()
    let p = 0
    const take = (n) => {
      const at = p
      p += n
      return at
    }
    const str = (n) => td.decode(u8.subarray(take(n), p))
    const skip = (n, value) => {
      take(n)
      return value
    }
    const bin = (n) => skip(n, { bytes: n })
    const arr = (n) => Array.from({ length: n }, () => read())
    const map = (n) => {
      const o = {}
      for (let i = 0; i < n; i++) {
        const k = read()
        o[String(k)] = read()
      }
      return o
    }
    const read = () => {
      const b = u8[p++]
      if (b <= 0x7f) return b
      if (b >= 0xe0) return b - 256
      if ((b & 0xf0) === 0x80) return map(b & 15)
      if ((b & 0xf0) === 0x90) return arr(b & 15)
      if ((b & 0xe0) === 0xa0) return str(b & 31)
      switch (b) {
        case 0xc0:
          return null
        case 0xc2:
          return false
        case 0xc3:
          return true
        case 0xc4:
          return bin(u8[p++])
        case 0xc5:
          return bin(dv.getUint16(take(2)))
        case 0xc6:
          return bin(dv.getUint32(take(4)))
        case 0xc7:
          return bin(u8[take(2)])
        case 0xc8:
          return bin(dv.getUint16(take(3)))
        case 0xc9:
          return bin(dv.getUint32(take(5)))
        case 0xca:
          return dv.getFloat32(take(4))
        case 0xcb:
          return dv.getFloat64(take(8))
        case 0xcc:
          return u8[p++]
        case 0xcd:
          return dv.getUint16(take(2))
        case 0xce:
          return dv.getUint32(take(4))
        case 0xcf:
          return Number(dv.getBigUint64(take(8)))
        case 0xd0:
          return dv.getInt8(p++)
        case 0xd1:
          return dv.getInt16(take(2))
        case 0xd2:
          return dv.getInt32(take(4))
        case 0xd3:
          return Number(dv.getBigInt64(take(8)))
        case 0xd4:
          return skip(2, { ext: 1 })
        case 0xd5:
          return skip(3, { ext: 2 })
        case 0xd6:
          return skip(5, { ext: 4 })
        case 0xd7:
          return skip(9, { ext: 8 })
        case 0xd8:
          return skip(17, { ext: 16 })
        case 0xd9:
          return str(u8[p++])
        case 0xda:
          return str(dv.getUint16(take(2)))
        case 0xdb:
          return str(dv.getUint32(take(4)))
        case 0xdc:
          return arr(dv.getUint16(take(2)))
        case 0xdd:
          return arr(dv.getUint32(take(4)))
        case 0xde:
          return map(dv.getUint16(take(2)))
        case 0xdf:
          return map(dv.getUint32(take(4)))
      }
      throw new Error(`msgpack byte ${b}`)
    }
    return read()
  }

  const SECRET = /token|phone|text|name|link|url|password|hash|avatar|description|title|query|key/i
  const ID = /(^|_)id$|Id$|^mt_instanceid$/
  const KEPT_IDS = new Set(["action_id", "actionId", "sessionId"])
  const ENUM = /^[A-Za-z0-9_.:/ -]{1,40}$/
  // The reads a tab sends right after LOGIN (MAX-51, MAX-52): their answers' key names and sync numbers.
  const AFTER_LOGIN = new Set([27, 53, 163, 208, 209, 272, 302])
  const EPOCH_MS = (v) => typeof v === "number" && v > 1e12 && v < 1e13

  const placeholder = (v) => {
    const k = String(v)
    if (!cap.ids.has(k)) cap.ids.set(k, `<id-${cap.ids.size + 1}>`)
    return cap.ids.get(k)
  }
  const relative = (v) => {
    const d = v - cap.t0
    return d >= 0 ? `t0+${d}` : `t0${d}`
  }
  const clean = (v, k = "") => {
    if (v === null || typeof v === "boolean") return v
    if (SECRET.test(k)) return "<redacted>"
    if (ID.test(k) && !KEPT_IDS.has(k)) return placeholder(v)
    if (EPOCH_MS(v)) return relative(v)
    if (typeof v === "number") return v
    if (typeof v === "string") return ENUM.test(v) ? v : "<text>"
    if (Array.isArray(v)) return v.map((x) => clean(x, k))
    if (typeof v === "object") return Object.fromEntries(Object.entries(v).map(([kk, vv]) => [kk, clean(vv, kk)]))
    return `<${typeof v}>`
  }
  const shape = (v) => {
    if (!v || typeof v !== "object" || Array.isArray(v)) return v === undefined ? undefined : typeof v
    return Object.fromEntries(
      Object.entries(v).map(([k, x]) => {
        if (typeof x === "boolean" && !SECRET.test(k)) return [k, x]
        if (typeof x === "number" && !SECRET.test(k) && !ID.test(k)) return [k, EPOCH_MS(x) ? relative(x) : x]
        if (k === "type" && typeof x === "string" && ENUM.test(x)) return [k, x]
        return [k, Array.isArray(x) ? "array" : typeof x]
      }),
    )
  }

  // A push's structure for MAX-34 (edits, reactions, typing): every key at every level, values only
  // as types — except booleans, enum-like `type`/`status`/`_type`, and times as t0+N. Arrays keep
  // their first element's structure and their length. Text, names, links and ids never survive.
  const ENUM_KEYS = new Set(["type", "_type", "status", "event"])
  const structure = (v, k = "", depth = 0) => {
    if (v === null || typeof v === "boolean") return v
    if (SECRET.test(k)) return "<redacted>"
    if (ID.test(k) && !KEPT_IDS.has(k)) return "id"
    if (EPOCH_MS(v)) return relative(v)
    if (typeof v === "number") return "number"
    if (typeof v === "string") return ENUM_KEYS.has(k) && ENUM.test(v) ? v : "string"
    if (depth > 5) return typeof v
    if (Array.isArray(v)) return v.length === 0 ? [] : [`length ${v.length}`, structure(v[0], k, depth + 1)]
    if (typeof v === "object") {
      return Object.fromEntries(Object.entries(v).map(([kk, vv]) => [kk, structure(vv, kk, depth + 1)]))
    }
    return typeof v
  }

  const parse = (data) => {
    if (typeof data === "string") return { format: "text", length: data.length }
    const u8 =
      data instanceof ArrayBuffer
        ? new Uint8Array(data)
        : ArrayBuffer.isView(data)
          ? new Uint8Array(data.buffer, data.byteOffset, data.byteLength)
          : null
    if (!u8 || u8.length < 10) return { format: "unknown" }
    const dv = new DataView(u8.buffer, u8.byteOffset, u8.byteLength)
    const packed = dv.getUint32(6)
    const header = {
      ver: u8[0],
      cmd: u8[1],
      seq: dv.getUint16(2),
      opcode: dv.getUint16(4),
      flags: packed >>> 24,
      length: packed & 0xffffff,
    }
    let body = u8.subarray(10, 10 + header.length)
    try {
      if (header.flags >= 1 && header.flags <= 0x7f) {
        body = lz4(body)
        header.unpacked = body.length
      } else if (header.flags) {
        return { ...header, undecoded: `flags ${header.flags}` }
      }
      if (body.length) header.payload = msgpack(body)
    } catch (error) {
      header.undecoded = String(error.message || error)
    }
    return header
  }

  const record = (dir, data) => {
    try {
      const { payload, ...header } = parse(data)
      const frame = { t: now(), dir, ...header }
      if (dir === "out") {
        cap.sent.set(header.seq, header.opcode)
        if (header.opcode === 5 || header.opcode === 1) frame.payload = clean(payload)
        else if (header.opcode === 6) {
          const { userAgent, ...rest } = payload || {}
          frame.payload = { userAgent: clean(userAgent), ...clean(rest) }
        } else frame.payload = shape(payload)
      } else {
        const answers = header.cmd !== 0 ? cap.sent.get(header.seq) : undefined
        if (answers !== undefined) frame.answers = answers
        if (answers === 5 || answers === 1) frame.payload = clean(payload)
        else if (answers === 6 || answers === 19 || AFTER_LOGIN.has(answers)) frame.payload = shape(payload)
        else if (header.cmd === 0 && header.opcode !== 1) frame.payload = structure(payload)
      }
      cap.frames.push(frame)
    } catch (error) {
      cap.frames.push({ t: now(), dir, failed: String(error) })
    }
  }

  const Original = WebSocket
  window.WebSocket = new Proxy(Original, {
    construct(target, args) {
      const socket = Reflect.construct(target, args)
      const url = new URL(String(args[0]))
      if (/oneme|max\.ru/.test(url.host)) {
        cap.sockets.add(socket)
        cap.frames.push({ t: now(), socket: `${url.protocol}//${url.host}${url.pathname}` })
        socket.addEventListener("message", (event) => record("in", event.data))
        socket.addEventListener("close", (event) => cap.frames.push({ t: now(), closed: event.code }))
      }
      return socket
    },
  })
  const send = Original.prototype.send
  Original.prototype.send = function (data) {
    if (cap.sockets.has(this)) record("out", data)
    return send.call(this, data)
  }

  cap.dump = (label = "web") => {
    const meta = {
      cassette: label,
      recorded: new Date(cap.t0).toISOString().slice(0, 10),
      recorder: "scripts/capture/web-recorder.js",
      times: "t is ms since the recorder started; epoch-ms values are written as t0+N",
      userAgent: navigator.userAgent,
    }
    const lines = [meta, ...cap.frames].map((line) => JSON.stringify(line)).join("\n")
    const link = document.createElement("a")
    link.href = URL.createObjectURL(new Blob([`${lines}\n`], { type: "application/jsonl" }))
    link.download = `${meta.recorded}-${label}.jsonl`
    link.click()
    return `${cap.frames.length} lines → ${link.download}`
  }

  const visibility = () => cap.frames.push({ t: now(), hidden: document.hidden })
  const html = await (await fetch("/", { cache: "no-store" })).text()
  history.replaceState(null, "", "/")
  document.open()
  document.write(html)
  document.close()
  document.addEventListener("visibilitychange", visibility)
  window.addEventListener("blur", () => cap.frames.push({ t: now(), focus: false }))
  window.addEventListener("focus", () => cap.frames.push({ t: now(), focus: true }))
  visibility()
  return "recording — when done, run __cap.dump('label')"
})()
