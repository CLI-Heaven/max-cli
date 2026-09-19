import { Command } from "commander"
import { resolveOutput } from "../output.js"
import { SessionStore } from "../session/store.js"

/**
 * Local only, for now: it forgets the token and the device identity on this machine.
 *
 * It does **not** yet send LOGOUT (opcode 20), which would end the session on MAX's side too. That
 * distinction is in the output rather than glossed over: a forgotten token that is still live
 * elsewhere is a different thing from a revoked one.
 */
export const logoutCommand = (): Command =>
  new Command("logout").description("forget the stored session for this profile").action(function (this: Command) {
    const options = this.optsWithGlobals()
    const { renderer } = resolveOutput(options)
    const store = new SessionStore({ profile: options.profile })
    const had = store.forget()

    renderer.result({ profile: store.profile, forgotten: had, revokedOnServer: false })
    if (had) renderer.success(`forgot the session for "${store.profile}" on this machine`)
    else renderer.note(`there was no session for "${store.profile}"`)
  })
