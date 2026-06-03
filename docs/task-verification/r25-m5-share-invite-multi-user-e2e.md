# R25-M5 share invite multi-user regression

## Automated coverage

| Area | Status | Evidence |
| --- | --- | --- |
| owner/editor/viewer/respondent fixtures | ✅ | `apps/api/src/__tests__/forms-share-permissions-r23.test.ts` |
| VIEWER cannot edit form structure | ✅ | `R25-M5 multi-user share and invitation regression` |
| VIEWER cannot manage responses | ✅ | `R25-M5 multi-user share and invitation regression` |
| EDITOR can edit structure and create invitations | ✅ | `R25-M5 multi-user share and invitation regression` |
| EDITOR cannot run owner-only permission changes | ✅ | `R25-M5 multi-user share and invitation regression` |
| Invitation accept from a separate user session | ✅ | `R25-M5 multi-user share and invitation regression` |
| Deleted share-link re-access stays unavailable | ✅ | `R25-M5 multi-user share and invitation regression` |
| Expired share-link service classification | ✅ | `permission-service.test.ts`, route boundary regression in `forms-share-permissions-r23.test.ts` |
| Permission downgrade after re-access | ✅ | `R25-M5 multi-user share and invitation regression` |
| Permission removal/downgrade SSE access revoke | ✅ | `permission-service-remove.test.ts`, `permission-service-update-role.test.ts`, `forms-sse-subscribers.test.ts` |
| Failure copy distinguishes insufficient permission/expired/deleted | ✅ | `share-link-manager.test.tsx` |

## Manual QA / follow-up

- Full browser E2E across two real sessions remains manual because this slice intentionally avoids adding a new E2E runner.
- Existing SSE tests cover access-revoke disconnect behavior. Concurrent editor unpublished-change conflict UX should be verified manually with two editor sessions until a dedicated collaborative editing E2E harness exists.
- The public shared-link route currently maps expired and deleted links to the same 404 response for token secrecy. The service layer still distinguishes the causes internally; user-facing public-link copy remains intentionally generic unless a follow-up changes that privacy contract.
