# FounderOps Planning

FounderOps owns planning state and projects selected task information to external collaboration surfaces without transferring domain ownership.

## Language

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
