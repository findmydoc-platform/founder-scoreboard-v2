# FounderOps Planning

FounderOps owns planning state and projects selected task information to external collaboration surfaces without transferring domain ownership.

## Language

**Planning Item**:
One element in the FounderOps planning hierarchy. Every Planning Item is exactly one Epic, Initiative, Deliverable, or Sub-Issue.
_Avoid_: Task as the generic hierarchy term, Package, Milestone

**Epic**:
A strategic planning container at the root of the hierarchy. It has no parent and no approval, Review, Sprint, RACI, or GitHub projection state.
_Avoid_: Milestone

**Initiative**:
A strategic Planning Item that may belong to an Epic. It owns strategy, RACI, and approval state.
_Avoid_: Package

**Deliverable**:
An approval-aware Planning Item that may belong to an Initiative. It owns Review, Sprint, an optional Fixed Date, and GitHub projection state. Its assigned Sprint defines its execution period.
_Avoid_: generic Task when the hierarchy type matters

**Sprint**:
A time container that defines the execution period of its assigned Deliverables. It is not a hierarchy parent; an unassigned Deliverable has no execution period.
_Avoid_: parent, Deliverable date range

**Fixed Date**:
An optional single calendar date on a Deliverable. It is separate from the Sprint period and never contains a Sprint name or relative time expression.
_Avoid_: Deadline text, target period, Sprint label

**Sub-Issue**:
A Planning Item below one approved Deliverable. It can have a GitHub projection but does not own approval, Review, Sprint, or RACI state.
_Avoid_: child Task when the hierarchy type matters

**GitHub projection**:
The one-way representation of FounderOps task state in GitHub. FounderOps and Supabase remain authoritative.
_Avoid_: GitHub sync as source of truth, replication

**Issue projection**:
The GitHub Issue representation of one FounderOps Deliverable or Sub-Issue, including its marker, brief, labels, state, ownership, and assignee.
_Avoid_: issue export, issue mirror

**Project projection**:
The GitHub Project membership and native field representation attached to an Issue projection.
_Avoid_: project sync, board copy

**Dependency projection**:
The native GitHub `blocked by` representation of FounderOps `blocked_by` and `blocks` relationships. `relates_to` is not part of this projection.
_Avoid_: relationship export, dependency copy

**Comment delivery**:
The independent, author-attributed delivery of a FounderOps comment to an existing Issue projection.
_Avoid_: comment projection, sync comment
