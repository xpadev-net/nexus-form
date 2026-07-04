# Coding Agent Lessons

## 2026-07-05: Confirm all-of vs any-of semantics for multi-token validation

- tags: telemetry, validation, assumptions
- symptom: Telemetry investigation explained why v6 could be consumed before a 403, but did not challenge whether requiring both v4 and v6 tokens to match the submit IP was the intended behavior.
- root cause: Treated multiple telemetry tokens as cumulative requirements instead of alternative address-family evidence.
- fix: Update the implementation and tests so public form submission is allowed when at least one submitted telemetry token matches the submit-time IP, is unused, and is unexpired.
- prevention: When investigating security token failures with multiple submitted candidates, explicitly identify whether the contract is all-of, any-of, or quorum before calling behavior correct.

## 2026-07-05: Define post-authorization handling for non-matching token candidates

- tags: telemetry, replay-prevention, validation
- symptom: The any-match telemetry fix allowed submit when one v4/v6 token matched, but left the non-matching submitted token candidate unused.
- root cause: Focused on authorization semantics and did not separately define post-authorization replay prevention for other submitted candidates.
- fix: After at least one current-IP token authorizes submit, consume remaining submitted unused/unexpired token rows too.
- prevention: For multi-candidate one-time tokens, specify both authorization criteria and candidate burn/retention behavior before finalizing the implementation.
