---
change_id: recipe-import-from-external-links
title: Import a recipe draft from a pasted TikTok or aniagotuje.pl link
status: implemented
created: 2026-10-14
updated: 2026-10-15
archived_at: null
---

## Notes

Let users import a recipe by pasting a TikTok or aniagotuje.pl link; app
fetches/transcribes and pre-fills a recipe draft for review before saving.

Sprint 2, item 1 (frontend half). Backend contract lives in the sibling
repo HomeCraftApi, `context/changes/recipe-import-from-external-links/plan.md`
(status: planned, not yet implemented):

- `POST /recipes/imports` body `{url}` -> 202 `{id, status:"pending", draft:null, error:null, updated_at}`, 422 on bad url.
- `GET /recipes/imports/{id}` -> `{id, status:"pending"|"ready"|"failed", draft: {title, ingredients:[{name,amount}], steps:[...], prep_minutes, servings} | null, error: string|null, updated_at}`. 404 if not found/wrong household.
- Flow: paste-link input -> POST -> poll GET every 2-3s while pending -> on
  ready, prefill the existing recipe-creation form with draft (still calls
  existing `POST /recipes` to actually save) -> on failed, show error, let
  user resubmit.

This change is blocked on that backend contract shipping — plan accordingly.

## Completion (2026-10-15)

Backend shipped, frontend implemented (commits `eea702c`, `61c3efb`),
deployed to prod. Status field was stale (left at `new`) — correcting
here; actual implementation progress is tracked in `plan.md`.
