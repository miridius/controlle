# Bead Spec Guide: E2E Acceptance Criteria

When filing beads for polecats, describe the **observable end-to-end outcome**,
not the implementation mechanism. Polecats choose the implementation; your job is
to define what "done" looks like from the user's perspective.

## The Rule

> Acceptance criteria describe what a user (or system) should **observe**, not
> how the code achieves it.

### Bad (implementation detail)

```
Send with MarkdownV2 parse mode, fallback to plain text on 400 errors.
```

### Good (E2E outcome)

```
Claude GFM output (bold, code blocks, inline code, links) must render as
formatted text in Telegram. Unsupported formatting degrades gracefully
(no raw escape characters visible to the user).
```

The bad version locks the polecat into a specific Telegram API strategy. The good
version lets them pick the best approach while making success unambiguous.

## Writing Acceptance Criteria

Use the `--acceptance` flag when creating beads:

```bash
bd create --title "Add retry on nudge failure" \
  --description "Nudge delivery sometimes fails transiently..." \
  --acceptance "$(cat <<'EOF'
- [ ] A transient nudge failure (exit code 1) retries up to 3 times
- [ ] The final message is delivered to the agent's session
- [ ] If all retries fail, an error message appears in the Telegram topic
- [ ] No duplicate nudges are delivered on success
EOF
)"
```

### Checklist Format

Acceptance criteria use markdown checkboxes. The `bd` tool tracks completion:

```
- [ ] Criterion not yet verified
- [x] Criterion verified
```

Polecats can check items as they verify each one. `bd show` displays progress,
and `HasUncheckedCriteria()` gates completion.

## Template

When filing any bead for a polecat, include this structure:

```
Title: <verb> <what changes> <where>

Description:
  <Context: why this matters, what's broken or missing>
  <Scope: which files/modules are likely involved>

Acceptance criteria (E2E):
  - [ ] <What the user/system observes when this works>
  - [ ] <Edge case or failure mode that must be handled>
  - [ ] <What must NOT happen (regression guard)>
```

## Examples

### Bug fix

```bash
bd create --type bug \
  --title "Agent-log messages truncated mid-emoji" \
  --description "When agent output contains multi-byte emoji sequences near the 4000-char truncation boundary, the message is split mid-character, causing Telegram API to reject it." \
  --acceptance "$(cat <<'EOF'
- [ ] Agent messages containing emoji render correctly in Telegram
- [ ] Truncation at the 4000-char limit never splits a multi-byte character
- [ ] Truncated messages end with [...truncated] suffix
EOF
)"
```

### Feature

```bash
bd create --type feature \
  --title "Show escalation severity in topic title" \
  --description "Escalation messages in Telegram don't indicate severity visually. Operators need to scan the message body to determine urgency." \
  --acceptance "$(cat <<'EOF'
- [ ] CRITICAL escalations display a red icon before the message
- [ ] HIGH escalations display an orange icon
- [ ] MEDIUM/LOW use yellow/blue respectively
- [ ] Icons are visible in Telegram's topic preview (not just inline)
EOF
)"
```

### Refactor

```bash
bd create --type task \
  --title "Extract channel routing to config-driven dispatch" \
  --description "Channel handlers are hardcoded in telegram.ts switch statement. Adding a new channel requires modifying the router." \
  --acceptance "$(cat <<'EOF'
- [ ] New channels can be added by editing gateway.config.json only
- [ ] Existing channel behavior is unchanged (all existing tests pass)
- [ ] Invalid channel config produces a clear startup error, not a runtime crash
EOF
)"
```

## Anti-Patterns

| Anti-pattern | Problem | Fix |
|---|---|---|
| "Use library X" | Prescribes implementation | Describe the capability needed |
| "Refactor function Y" | Describes the change, not the outcome | Describe what improves |
| "Add error handling" | Too vague to verify | Specify which errors, what the user sees |
| "Make it faster" | Not measurable | Specify latency target or benchmark |
| No acceptance criteria | Polecat guesses what "done" means | Always include at least one criterion |
