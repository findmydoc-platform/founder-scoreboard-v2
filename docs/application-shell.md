# Application header and context

The application-shell feature owns one global composition for Planning workspaces, Profile, Administration, Releases and full-page Planning Items. Hosts supply an area label, optional supporting text and local controls or return navigation. Item and release titles stay in their content. `ApplicationContextBar` owns the common contextual layout; each workspace keeps its own selection, permissions and commands.

`ApplicationHeader` accepts the narrow `ApplicationHeaderProps` contract. It composes curated links, calendar, notifications, Help, GitHub and account in that order. The Standard header groups links, calendar, Help and GitHub in the phone `Mehr` menu. Navigation, area, notifications and account remain directly reachable. Focus is the only reduced variant and contains the area, exit and account controls. Leaving Focus restores the Standard controls and existing workspace state.

## Navigation

`ApplicationNavigation.navigate` performs an already approved departure. Hosts with a dirty editor also supply `requestNavigation(continueNavigation)`, using their existing discard decision. The common runtime requests that decision once. If the host approves, the runtime calls raw navigation once. Staying does not run the continuation. Account, Team, Help and Notification Center departures use this runtime.

Header notifications always resolve through `notificationTarget` to a full page. The discard decision precedes the seen command. Only a saved command continues navigation; rejected, unconfirmed or superseded results do not navigate or replay. Actual links preserve supported queries, anchors and native modified targets. Item cards and lists retain their own detail-panel workflow. Safe detail return handling remains with the host.

## Data lifetime and authority

The root `PlanningStateProvider` retains accepted data and in-flight operations across host changes. The header reuses that owner and its existing read and command ports. It does not add credential clients, pollers or an authorization policy. Independent slots retain loading, confirmed-empty, failed and denied states. Account replacement and session end clear protected data and reject delayed results. Server-rendered Release content is withheld when that authority ends.

`ApplicationHeaderLifecycle.calendarProfiles` is an optional independent protected calendar identity slot. Release calendar identities must never hydrate the full business profiles used by Team and Profile. Calendar dialog mounting and reads remain open-gated; the calendar action uses a regular import to avoid an expanded trigger with no mounted dialog. Publication, date, week, timezone and error semantics belong to the existing workweek module.

## Menus and help

Opening `Mehr` focuses its first item on the next animation frame. Keyboard navigation starts after that visible focus has entered the menu. Home, End, arrows and Escape retain their menu behavior. Dialogs opened from the menu receive focus and return it to the visible `Mehr` trigger on close. Account and notification dialogs retain their own focus return.

Help can resume an explicit tour through its supported Planning route. Explicit tour requests take priority over the automatic updates gallery. The existing tour coordinator reveals phone actions through `Mehr` and closes them when the tour ends. This contract does not add product updates or new tour content.

Credential verification and per-action authorization remain governed by [the credential contract](credential-verification.md). Item operations and type eligibility remain governed by [the Planning Item UI contract](planning-item-ui.md) and [the Task GitHub projection decision](adr/0001-deep-task-github-projection.md).
