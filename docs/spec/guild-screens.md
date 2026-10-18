# Spec: initial guild screens (phase 3)

Servers appear in a scrollable rail beside Home. Each server's initials have its full name
as an accessible label and tooltip. Create server opens a named modal with a required name
(1–100 characters). Selecting a server replaces direct messages with its visible channel list.
Categories group their children; voice, text and announcement channels have distinct icons.
The direct-message routes and composer remain available from Home.

The header links to a server summary and exposes Rename server only with MANAGE_GUILD.
Create channel requires MANAGE_CHANNELS. Its modal supplies name, type, category and topic.
Channel details expose Edit channel using the channel's effective MANAGE_CHANNELS bit.
Server owners cannot leave; other members confirm Leave server in a modal. All permissions
shown in the client are hints; the API authorizes every request again.

Forms retain values and announce failures, disable submission while pending, and return
focus to their trigger on close. Every modal uses a native dialog for keyboard focus trapping
and Escape. Account generation checks prevent a completed mutation from navigating a later
login. Gateway invalidations and periodic recovery refresh server and channel state.

This first slice exposes server/channel management. Channel text and voice show the explicit
states `Messaging unavailable` and `Voice unavailable` until their corresponding services
are integrated. The screens do not present an inactive composer or a voice-connect action.

`guilds.memberCount` is approved longer copy: its ICU plural expression represents a count
and unit (`1 member`, `2 members`) rather than a control label. All other labels are short.
