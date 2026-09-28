## Deploy
- Vercel Git integration is active: every commit that lands on `master`
  auto-deploys to Production. Merging to master IS a production deploy.
- NEVER run `vercel`, `vercel --prod`, or `npx vercel` in any form.
  CLI deploys race the git deploy and caused a site revert.
- Preview deployments are disabled (Ignored Build Step: only production).
- A deployment in Vercel without a commit SHA means someone used the CLI —
  stop and report.

## Database migrations
- Migrations in supabase/migrations/ are applied manually by the owner in
  the production Supabase SQL editor, and must be applied and verified
  BEFORE merging the PR that depends on them (lesson from 007, 2026-09-28).
- Never run SQL against production from a local session. Treat any hosted
  supabase.co URL in .env.local as production.

## Branches
- One task = one branch = one PR into master. Never commit directly to master.
- Do not merge your own PR.
- wip/* branches are unreviewed parking branches — never merge them as-is.
