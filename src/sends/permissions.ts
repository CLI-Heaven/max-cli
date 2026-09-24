import type { AccountAction, SendKind } from "./journal.js"

/**
 * What a profile may be allowed to do (`CLI-37`, `NEED-251`). One name per thing the owner would
 * recognise, so `sessions` — which logs the owner out of their phone — never rides along with
 * adding a contact. There is no `*`: "everything" is not setting `allow` at all, and a wildcard
 * would switch on `delete` without anyone naming it.
 */
export const PERMISSIONS = [
  "send",
  "forward",
  "reaction",
  "edit",
  "pin",
  "read",
  "delete",
  "groups",
  "contacts",
  "profile",
  "folders",
  "sessions",
] as const

export type Permission = (typeof PERMISSIONS)[number]

const ACCOUNT: Record<AccountAction, Permission> = {
  "contact-add": "contacts",
  "contact-remove": "contacts",
  "contact-import": "contacts",
  profile: "profile",
  "folder-create": "folders",
  "folder-update": "folders",
  "folder-delete": "folders",
  "sessions-end": "sessions",
}

export const permissionFor = (kind: SendKind, action?: string): Permission => {
  switch (kind) {
    case "message":
      return "send"
    case "chat":
      return "groups"
    case "account": {
      const permission = ACCOUNT[action as AccountAction]
      if (!permission) throw new Error(`an account change without a known action: ${action}`)
      return permission
    }
    default:
      return kind
  }
}
