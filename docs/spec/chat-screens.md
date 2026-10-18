# Spec: chat screens (phase 2)

UI for docs/spec/{relationships,messaging,presence,media}.md. BRIEF §7.8 applies: every string
is a label, data, a unit, an action, or copy listed here.

## Layout

- Rail: home only until guilds (phase 3).
- Sidebar (glass): `Friends` row with the incoming-request count, `Direct messages` heading
  with a new-group button, then DMs and groups by latest activity (unread rows bold, badge with
  unread or mention count, red for mentions, "99+" past 99). User panel at the bottom: avatar
  with own status, display name, connection state; clicking opens the status menu.
- Content: the friends view at `/app`, a channel at `/app/channels/:id`.

## Friends view

Tabs `Online`, `All`, `Pending`, `Blocked`, each with a count. `Add friend` field (exact
username) with `Send request`. Rows: avatar (presence only for friends), private nickname or
display name, `@username`, icon actions with accessible names (message, remove, block,
accept, decline, cancel) and an `Unblock` button. No empty-state copy.

## Channel view

Header (glass): avatar or group icon, title (DM peer, group name, else member names), member
count for groups, density switch (`Cozy`, `Compact`, `Bubble` for DMs only), members popover
for groups (members with presence, friends to add, `Leave group`). Message history is a
virtualized log; day dividers show the localized date. Rows carry hover/focus actions (react,
reply, edit/delete own). Pending sends render in place with `Retry` / `Discard` on failure.
Typing line under the log. Composer (glass): reply bar, upload chips with progress and state,
attach button, editor, send.

## Approved longer copy

| Key | EN | Why |
|---|---|---|
| `chat.historyVisible` | "Added members can read the full history." | messaging.md requires saying so before adding |
| `chat.typingMany` | "{count} people typing" | data + unit |
| `chat.deletedMessage` | "Original message deleted" | reply placeholder state |
| `chat.editConflict` | "Message changed elsewhere" | error state |
| `social.cancel` | "Cancel request" | action |
| `presence.dnd` | "Do not disturb" | standard status name |
| `chatErrors.*` | error sentences | error messages are exempt (BRIEF §7.8) |

## Accessibility

Status is conveyed by shape and color (idle notch, dnd bar, offline ring) plus a title.
The history is a focusable `log` region; toolbars appear on focus as well as hover; radio
groups back the density and status choices; the mention list is a listbox with keyboard
selection (arrows, Enter/Tab). Reduced motion removes the typing bounce and reaction pop.

## Account and recovery lifecycle

Sign-out immediately clears private queries, pending uploads, blobs and drafts.
Requests and decoded responses belong to the account generation that started them;
late refreshes, JSON/blobs, pagination and mutation callbacks cannot populate a new
account's cache. Reconnect/focus resets history to one authoritative page so missed
edits, deletes and block changes do not leave old text visible. Periodic viewport
revalidation is bounded to twenty reads per five seconds and once per row per thirty
seconds. Channels and relationships load all cursor pages, including older entries.
