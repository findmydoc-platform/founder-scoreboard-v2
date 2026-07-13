# FounderOps Intake Authoring Protocol

## Mandatory two-step interaction

Never commit from the user's initial task request. The first response must be a structured chat draft, even when the user initially says "create", "submit", or "add".

The non-writing sequence is:

1. Load live team context.
2. Interpret the user's natural-language request.
3. For a Deliverable, complete the Initiative placement assessment below.
4. Build a complete task brief at the appropriate abstraction level.
5. Run the read-only API preview.
6. Present the normalized draft and any material questions in chat.

Commit only after a later user message explicitly approves the shown draft. Treat phrases such as "passt, mach", "ist okay, anlegen", or an equivalent unambiguous instruction as approval only after the structured draft has been shown.

If the user only answers questions, present the revised structured draft and wait. If a later message both answers the questions and explicitly approves creation, incorporate the answers, run preview again internally, and commit.

## Required chat draft

Use the user's language. Present every draft in this order:

1. **Understanding**
   - goal and business context,
   - intended abstraction level: strategic, operational, or technical,
   - proposed API item type.
2. **Placement**
   - API item: `initiative`, `deliverable`, or `sub_issue`,
   - approval state: proposed for Initiative or Deliverable, inherited for Sub-Issue,
   - Epic / Milestone,
   - recommended Initiative and a short fit explanation for a Deliverable,
   - equally plausible Initiative alternatives when a choice is required,
   - parent Deliverable for a Sub-Issue,
   - proposed owner,
   - Initiative RACI when drafting an Initiative,
   - status, priority, Sprint, and score relevance.
3. **Task content**, using separate title-and-text sections:
   - Title,
   - Problem Statement,
   - Intended Outcome,
   - Scope & Constraints,
   - Acceptance Criteria,
   - Evidence Required,
   - Definition of Done.
4. **API field mapping**
   - show which content maps to `title`, `problemStatement`, `intendedOutcome`, `scopeConstraints`, `acceptanceCriteria`, `evidenceRequired`, `definitionOfDone`, `itemType`, `ownerId`, `packageId`, `milestoneId`, `parentTaskId`, `accountableProfileId`, `responsibleProfileIds`, `consultedProfileIds`, `informedProfileIds`, `priority`, `githubRepo`, and optional fields.
5. **Assumptions and questions**, if any.
6. **Approval instruction**, asking the user to approve or correct the draft.

Do not expose raw IDs when a human-readable title or name is available. Show IDs only when needed to disambiguate equal names.

## Initiative placement

Apply this section to every new Deliverable. Do not run a separate Initiative selection for a Sub-Issue because it inherits placement from its parent Deliverable.

1. Exclude every Initiative with `approvalStatus = rejected`.
2. Assess every remaining Initiative against the requested Deliverable using its title, `goal`, `scopeConstraints`, `successCriteria`, Milestone, Accountable, and Responsible people. Do not select by title alone.
3. Recommend the single best-fitting Initiative and explain the fit in one or two concrete sentences.
4. If multiple Initiatives are equally plausible, show the candidates with their distinct fit and ask one compact placement question. Do not choose arbitrarily.
5. If none fits, explain the gap and prepare only a new Initiative draft. Do not include the requested Deliverable in the same payload.
6. After the user later approves and commits the new Initiative, reload context, place the Deliverable under the created Initiative, run a new preview, and require a separate later approval before committing it.

Treat `approvalStatus`, `goal`, `scopeConstraints`, and `successCriteria` as required Team Task Context fields. This skill intentionally has no compatibility path for the older, smaller Initiative context.

## Question policy

Ask questions about both placement and content. Do not hide real semantic ambiguity behind generic prose.

Ask when different plausible answers would materially change one or more of:

- the actual problem or current state,
- the intended finished outcome,
- analysis versus decision versus concept versus execution,
- scope, exclusions, or binding constraints,
- acceptance criteria or evidence,
- task type, parent Deliverable, Initiative, Milestone, owner, or deadline,
- the meaning of an ambiguous person, product, customer group, document, or deliverable reference.

Bundle questions into one compact round by default, normally one to three questions. For light ambiguity, state the preferred assumption and ask for correction. Ask further rounds only when the user requests more questions or a remaining major ambiguity prevents a truthful draft or safe placement.

Do not ask merely to fill optional fields. Infer or omit dates, hours, workstream, description, and non-binding implementation detail when they do not change the task's meaning.

## Abstraction and technical detail

Match the user's intended planning level:

- Keep Initiatives high-level, outcome-led, and implementation-neutral.
- Keep proposed Deliverables concrete enough to review without inventing a technical solution.
- Make Sub-Issues technical only when the parent work or requested outcome requires technical execution detail.
- Ask technical questions only when technology is part of the goal or a binding constraint, such as an API contract, security requirement, privacy rule, platform limitation, or compatibility boundary.

Keep solutions and implementation steps out of Problem Statement. Put binding technical constraints in Scope & Constraints. Keep Acceptance Criteria measurable and owner-controllable. Keep Definition of Done separate from issue-specific Acceptance Criteria.

## Defaults and fixed behavior

- `initiative`: CEO or Deputy only; starts `proposed`; requires Milestone, Accountable, and Responsible.
- `deliverable`: CEO, Deputy, or Founder; exact non-rejected Initiative required; starts `proposed`.
- `sub_issue`: exact parent Deliverable required; every contributor may use any Deliverable; no own approval status.
- Sub-Issues inherit Initiative and Epic / Milestone from the parent.
- Never put a new Initiative and its Deliverable in one batch. Never put a new Deliverable and its Sub-Issue in one batch.
- All intake items receive no Sprint assignment. Deliverables remain score-neutral until approved and assigned to a Sprint.
- Default priority is `P2` unless context supports another value.
- Maximum batch size is 30.
- `definitionOfDone` must be text. `acceptanceCriteria` may be text or a string array.
- Deliverables always use `findmydoc-platform/management`; only Sub-Issues may select an allowed technical `githubRepo`.
- Never approve items or write scores, final reviews, Sprint configuration, or GitHub sync through this intake.

## Completion response

After a successful commit, return every created task to the user as a clickable FounderOps link. For each task include at least its title and URL; include type and status when useful. Never summarize a multi-task batch with only one link or only the batch ID.

Use the `itemLinks` array emitted by `scripts/founderops-intake.mjs`. Deliverables and Sub-Issues link to their task page; Initiatives link to the Projects workspace.

