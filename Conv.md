# Audit project production readiness

> Review this entire project as a senior software engineer performing a production-readiness audit.
>
> First, inspect the repository structure, configuration files, documentation, source code, tests, dependencies, build scripts, and deployment setup. Do not modify any files yet.
>
> Evaluate the project for:
>
> 1. Architecture and code organization
> 2. Correctness and potential bugs
> 3. Security vulnerabilities and unsafe practices
> 4. Performance and scalability issues
> 5. Error handling, logging, and observability
> 6. Code quality, duplication, complexity, and maintainability
> 7. Type safety, validation, and edge cases
> 8. API design and data-flow consistency
> 9. Frontend usability, accessibility, responsiveness, and state management
> 10. Mobile-specific issues, where applicable
> 11. Backend authentication, authorization, database usage, and concurrency
> 12. Dependency risks, outdated packages, and unnecessary dependencies
> 13. Test coverage and missing high-value tests
> 14. Build, CI/CD, environment configuration, and deployment risks
> 15. Documentation quality and onboarding experience
> 16. Dead code, unused files, incomplete features, TODOs, and temporary workarounds
>
> Work systematically:
>
> * Start by mapping the repository and identifying its main applications, packages, services, entry points, and data flows.
> * Read the relevant files before reaching conclusions.
> * Trace important features end to end.
> * Check whether configuration examples match actual runtime usage.
> * Inspect both happy paths and failure paths.
> * Distinguish confirmed problems from possible risks.
> * Do not invent issues without evidence.
> * Reference exact file paths, functions, classes, components, or line ranges whenever possible.
> * Do not expose or reproduce secrets found in the repository. Only report their location and the type of secret.
> * Do not make broad refactors or changes unless I explicitly approve them.
>
> Produce a structured report containing:
>
> ## 1. Executive Summary
>
> Summarize the project’s overall health, the most serious risks, and whether it appears ready for production.
>
> ## 2. Project Map
>
> Describe the architecture, major modules, technologies, entry points, external integrations, and important data flows.
>
> ## 3. Critical Findings
>
> For every critical issue, include:
>
> * Severity: Critical, High, Medium, or Low
> * Category
> * File path and relevant symbol or line range
> * Evidence
> * Why it matters
> * A realistic failure or abuse scenario
> * Recommended fix
> * Estimated effort: Small, Medium, or Large
> * Confidence: Confirmed or Suspected
>
> ## 4. Findings by Area
>
> Group the remaining findings under:
>
> * Architecture
> * Security
> * Correctness
> * Performance
> * Frontend
> * Mobile
> * Backend
> * Database
> * APIs
> * Testing
> * Dependencies
> * DevOps and deployment
> * Documentation
> * Developer experience
>
> ## 5. Test Gap Analysis
>
> Identify the most important missing tests. Prioritize tests that protect authentication, payments, permissions, data integrity, external integrations, and core user journeys.
>
> ## 6. Recommended Action Plan
>
> Create a prioritized plan divided into:
>
> * Fix immediately
> * Fix before production
> * Improve soon
> * Optional cleanup
>
> For each task, include affected files, expected impact, dependencies, and estimated effort.
>
> ## 7. Quick Wins
>
> List small, low-risk improvements that provide meaningful value.
>
> ## 8. Open Questions
>
> List anything that cannot be verified from the repository alone.
>
> After completing the report, stop and wait for my approval before editing files.
>
> When I approve implementation, make changes in small, reviewable batches. For each batch:
>
> 1. Explain the planned changes.
> 2. List the files that will be modified.
> 3. Implement the smallest safe solution.
> 4. Add or update tests.
> 5. Run the relevant checks.
> 6. Report what passed, what failed, and any remaining risks.
> 7. Avoid unrelated formatting or refactoring.

<details><summary>26 previous messages</summary>

> I’ll perform this as a read-only audit and won’t edit, install, migrate, or deploy anything. I’ll first map the repo and read its project guidance, then trace the highest-risk flows (identity/tenant isolation, sessions, mutations, storage, tax/PDF/archive paths, web and mobile clients), inspect CI/deployment and dependencies, and finally cross-check tests against those flows.
>
> I’m using the Next.js, Expo data-fetching/UI, and Supabase guidance because those technologies are central to the codebase; their checklists will shape the audit criteria, not change the repository.
>
> <details><summary>Ran 12 commands</summary>
>
> - Ran `Get-Content -Raw PROJECT_SUMMARY.md
> Get-Content -Raw 'C:\Users\Amjad\.codex\plugins\cache\openai-curated-remote\vercel\1.0.0\skills\nextjs\SKILL.md'
> Get-Content -Raw 'C:\Users\Amjad\.codex\plugins\cache\openai-curated-remote\expo\1.0.2\skills\building-native-ui\SKILL.md'
> Get-Content -Raw 'C:\Users\Amjad\.codex\plugins\cache\openai-curated-remote\expo\1.0.2\skills\native-data-fetching\SKILL.md'
> Get-Content -Raw 'C:\Users\Amjad\.codex\plugins\cache\openai-curated-remote\supabase\1.0.0\skills\supabase\SKILL.md'`
> - Ran ``$paths = @('PROJECT_SUMMARY.md','C:\Users\Amjad\.codex\plugins\cache\openai-curated-remote\vercel\1.0.0\skills\nextjs\SKILL.md','C:\Users\Amjad\.codex\plugins\cache\openai-curated-remote\expo\1.0.2\skills\building-native-ui\SKILL.md','C:\Users\Amjad\.codex\plugins\cache\openai-curated-remote\expo\1.0.2\skills\native-data-fetching\SKILL.md','C:\Users\Amjad\.codex\plugins\cache\openai-curated-remote\supabase\1.0.0\skills\supabase\SKILL.md'); foreach ($path in $paths) { $lines = Get-Content -LiteralPath $path; Write-Output (('{0}`t{1}' -f $path, $lines.Count)) }``
> - Ran `Get-Content -LiteralPath PROJECT_SUMMARY.md | Select-Object -First 240`
> - Ran `Get-Content -LiteralPath PROJECT_SUMMARY.md | Select-Object -Skip 240 -First 240`
> - Ran `Get-Content -LiteralPath 'C:\Users\Amjad\.codex\plugins\cache\openai-curated-remote\vercel\1.0.0\skills\nextjs\SKILL.md' | Select-Object -First 250`
> - Ran `Get-Content -LiteralPath 'C:\Users\Amjad\.codex\plugins\cache\openai-curated-remote\vercel\1.0.0\skills\nextjs\SKILL.md' | Select-Object -Skip 250 -First 250`
> - Ran `Get-Content -LiteralPath 'C:\Users\Amjad\.codex\plugins\cache\openai-curated-remote\vercel\1.0.0\skills\nextjs\SKILL.md' | Select-Object -Skip 500 -First 245`
> - Ran `Get-Content -LiteralPath 'C:\Users\Amjad\.codex\plugins\cache\openai-curated-remote\expo\1.0.2\skills\building-native-ui\SKILL.md' | Select-Object -First 180`
> - Ran `Get-Content -LiteralPath 'C:\Users\Amjad\.codex\plugins\cache\openai-curated-remote\expo\1.0.2\skills\building-native-ui\SKILL.md' | Select-Object -Skip 180 -First 141`
> - Ran `Get-Content -LiteralPath 'C:\Users\Amjad\.codex\plugins\cache\openai-curated-remote\expo\1.0.2\skills\native-data-fetching\SKILL.md' | Select-Object -First 260`
> - Ran `Get-Content -LiteralPath 'C:\Users\Amjad\.codex\plugins\cache\openai-curated-remote\expo\1.0.2\skills\native-data-fetching\SKILL.md' | Select-Object -Skip 260 -First 247`
> - Ran `Get-Content -Raw -LiteralPath 'C:\Users\Amjad\.codex\plugins\cache\openai-curated-remote\supabase\1.0.0\skills\supabase\SKILL.md'`
>
> </details>
>
> The project summary already shows a substantial hardening effort, but it also contains statements that conflict with the newer repository guidance (for example, whether legacy website routes still exist). I’ll treat documentation as a hypothesis and verify each claimed boundary against code, migrations, and tests. The framework guidance also flags current patch-level security as something to verify rather than infer from major versions.
>
> <details><summary>Ran 13 commands, searched the web</summary>
>
> <details><summary>Searched the web</summary>
>
> - Searched the web for `https://supabase.com/changelog.md`
> - Searched the web for `site:supabase.com/changelog breaking change Supabase changelog 2026`
>
> </details>
>
> - Ran `$tracked = @(git ls-files); $top = Get-ChildItem -Force | Select-Object Name,Mode,Length; $groups = $tracked | ForEach-Object { if ($_ -match '/') { ($_ -split '/')[0] } else { '(root)' } } | Group-Object | Sort-Object Count -Descending | Select-Object Name,Count; $exts = $tracked | ForEach-Object { $ext = [IO.Path]::GetExtension($_); if ([string]::IsNullOrEmpty($ext)) { '(none)' } else { $ext.ToLowerInvariant() } } | Group-Object | Sort-Object Count -Descending | Select-Object -First 25 Name,Count; [pscustomobject]@{ status=@(git status --short); branch=(git branch --show-current); trackedCount=$tracked.Count; top=$top; topLevelTrackedCounts=$groups; extensionCounts=$exts } | ConvertTo-Json -Depth 5`
>
> - Ran `$tracked = @(git ls-files); $rows = foreach ($file in $tracked) { $parts = $file -split '/'; if ($parts.Count -ge 2) { [pscustomobject]@{Area=$parts[0]; Section=$parts[1]} } else { [pscustomobject]@{Area='(root)'; Section=$parts[0]} } }; $rows | Group-Object Area,Section | ForEach-Object { [pscustomobject]@{Area=$_.Group[0].Area; Section=$_.Group[0].Section; Files=$_.Count} } | Sort-Object Area,Section | Format-Table -AutoSize`
>
> - Ran `$paths = @(rg --files -g package.json -g '!node_modules'); foreach ($path in $paths) { Write-Output ('FILE: ' + $path); Get-Content -Raw -LiteralPath $path }`
>
> - Ran `$paths=@('.github/workflows/ci.yml','.github/workflows/cloudrun-deploy.yml','website/next.config.ts','website/tsconfig.json','website/eslint.config.mjs','website/postcss.config.mjs','website/proxy.ts','website/playwright.config.ts','website/.gitignore','phone_app/app.json','phone_app/eas.json','phone_app/tsconfig.json','phone_app/babel.config.js','phone_app/metro.config.js','phone_app/.gitignore','deno.json','supabase/config.toml','supabase/.gitignore','.gitignore','.dockerignore','cloudrun-api/tsconfig.json','cloudrun-api/Dockerfile','cloudrun-tax/tsconfig.json','cloudrun-tax/Dockerfile','cloudrun-pdf/tsconfig.json','cloudrun-pdf/Dockerfile','cloudrun-pdf/.dockerignore','cloudrun-archiver/tsconfig.json','cloudrun-archiver/Dockerfile','packages/contracts/tsconfig.json','packages/api-contracts/tsconfig.json','packages/db/tsconfig.json','packages/db/drizzle.config.ts'); foreach($path in $paths){ if(Test-Path -LiteralPath $path){ Write-Output ('FILE: '+$path); Get-Content -Raw -LiteralPath $path } else { Write-Output ('MISSING: '+$path) } }`
>
> - Ran ``$paths=@('.github/workflows/ci.yml','.github/workflows/cloudrun-deploy.yml','website/next.config.ts','website/tsconfig.json','website/eslint.config.mjs','website/postcss.config.mjs','website/proxy.ts','website/playwright.config.ts','phone_app/app.json','phone_app/eas.json','phone_app/tsconfig.json','phone_app/babel.config.js','phone_app/metro.config.js','deno.json','supabase/config.toml'); foreach($path in $paths){$c=(Get-Content -LiteralPath $path).Count; Write-Output ("$path`t$c") }``
>
> - Ran `Get-Content -Raw -LiteralPath .github/workflows/cloudrun-deploy.yml
> Get-Content -LiteralPath .github/workflows/ci.yml | Select-Object -Skip 260`
>
> - Ran `$paths=@('website/next.config.ts','website/tsconfig.json','website/eslint.config.mjs','website/postcss.config.mjs','website/proxy.ts','website/playwright.config.ts','phone_app/app.json','phone_app/eas.json','phone_app/tsconfig.json','phone_app/babel.config.js','phone_app/metro.config.js','deno.json'); foreach($path in $paths){Write-Output ('FILE: '+$path); Get-Content -Raw -LiteralPath $path}`
>
> - Ran `rg -n "^(project_id|\[api\]|\[db\]|\[db\.|\[auth\]|\[auth\.|\[storage\]|\[storage\.|\[functions\.|enabled =|port =|major_version|site_url|additional_redirect_urls|jwt_expiry|enable_refresh_token_rotation|refresh_token_reuse_interval|enable_signup|enable_confirmations|secure_password_change|deno_version|import_map|verify_jwt)" supabase/config.toml`
>
> - Ran `Get-Content -LiteralPath supabase/config.toml | Select-Object -First 180`
>
> - Ran `rg --files cloudrun-api/src | Sort-Object
> rg --files packages/db | Sort-Object
> rg --files packages/api-contracts | Sort-Object
> rg --files packages/contracts | Sort-Object
> rg --files supabase/functions supabase/handlers | Sort-Object`
>
> - Ran `$areas=@('cloudrun-api/src','website/src','phone_app','supabase','packages/db','cloudrun-pdf','cloudrun-archiver','cloudrun-tax/src'); $rows=foreach($area in $areas){$files=rg --files $area -g '*.ts' -g '*.tsx' -g '*.js' -g '*.mjs' -g '*.sql' -g '!**/node_modules/**' -g '!**/dist/**'; foreach($file in $files){$count=(Get-Content -LiteralPath $file).Count; [pscustomobject]@{Area=$area;Lines=$count;File=$file}}}; $rows | Sort-Object Lines -Descending | Select-Object -First 80 | Format-Table -AutoSize`
>
> - Ran `rg --files website/src/app | Sort-Object
> rg --files website/src/lib website/src/components website/src/hooks | Sort-Object
> rg --files website/tests | Sort-Object`
>
> - Ran `rg --files phone_app/app phone_app/components phone_app/contexts phone_app/hooks phone_app/lib phone_app/modules phone_app/navigation phone_app/utils phone_app/tests | Sort-Object`
>
> </details>
>
> The current tree is a large, staged transition rather than a clean baseline: 821 tracked files, with extensive staged additions/deletions across the API, migrations, website cutover, tax gateway, and mobile. I’ll audit the working tree exactly as it stands and call out where readiness depends on these staged changes being reviewed and landed together. So far, the architecture is deliberately layered, but the deployment workflow and native config handling already warrant close examination.
>
> <details><summary>Ran 34 commands</summary>
>
> - Ran `rg -n -i --glob '!**/node_modules/**' --glob '!**/dist/**' --glob '!**/package-lock.json' --glob '!**/*.lock' "TODO|FIXME|HACK|XXX|temporary|workaround|not implemented|not yet|placeholder|legacy|deprecated|stub|mock only" .
> rg -n --glob '!**/node_modules/**' --glob '!**/dist/**' --glob '*.{ts,tsx,mts,js,mjs}' "@ts-(nocheck|ignore|expect-error)|eslint-disable|\bas any\b|:\s*any\b|<any>|unknown as|as unknown as" website phone_app cloudrun-api cloudrun-tax cloudrun-pdf cloudrun-archiver packages supabase scripts`
> - Ran `rg -l "@ts-nocheck" phone_app website cloudrun-api cloudrun-tax cloudrun-pdf cloudrun-archiver packages supabase | Sort-Object
> rg -n "TODO|FIXME|HACK|XXX|NotAvailableScreen|not available|coming soon|501|not implemented" website/src phone_app cloudrun-api/src cloudrun-tax/src cloudrun-pdf cloudrun-archiver packages/db supabase --glob '!**/tests/**' --glob '!**/*.test.*'`
> - Ran `$patterns = [ordered]@{ private_key='-----BEGIN (RSA |EC |OPENSSH )?PRIVATE KEY-----'; google_api_key='AIza[0-9A-Za-z_-]{30,}'; supabase_secret='sb_secret_[0-9A-Za-z_-]{16,}'; jwt_token='eyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}'; aws_access_key='AKIA[0-9A-Z]{16}'; github_token='gh[pousr]_[A-Za-z0-9]{20,}'; generic_assignment='(?i)(api[_-]?key|client[_-]?secret|password|auth[_-]?token)\s*[:=]\s*["''][^"'']{8,}["'']' }; $findings=@(); foreach($path in @(git ls-files)){ if($path -match '(package-lock\.json|deno\.lock|\.png$|\.ico$)$'){continue}; try{$lines=Get-Content -LiteralPath $path -ErrorAction Stop}catch{continue}; for($i=0;$i -lt $lines.Count;$i++){foreach($entry in $patterns.GetEnumerator()){if($lines[$i] -match $entry.Value){$findings += [pscustomobject]@{Path=$path;Line=$i+1;Type=$entry.Key};break}}}; }; $findings | Sort-Object Path,Line | ConvertTo-Json -Depth 3`
> - Ran `rg -o --no-filename "process\.env\.[A-Z][A-Z0-9_]*|process\.env\[[\"'][A-Z][A-Z0-9_]*[\"']\]|Deno\.env\.get\([\"'][A-Z][A-Z0-9_]*[\"']\)" website phone_app cloudrun-api cloudrun-tax cloudrun-pdf cloudrun-archiver packages supabase --glob '*.{ts,tsx,js,mjs,mts}' | Sort-Object -Unique`
> - Ran `rg -o --no-filename 'process\.env\.[A-Z][A-Z0-9_]*' website phone_app cloudrun-api cloudrun-tax cloudrun-pdf cloudrun-archiver packages --glob '*.{ts,tsx,js,mjs,mts}' | Sort-Object -Unique
> rg -n 'Deno\.env\.get' supabase --glob '*.ts'`
> - Ran `$paths=@('cloudrun-api/src/app.ts','cloudrun-api/src/config.ts','cloudrun-api/src/runtime-config.ts','cloudrun-api/src/server.ts','cloudrun-api/src/services.ts','cloudrun-api/src/types.ts','cloudrun-api/src/index.ts'); foreach($path in $paths){Write-Output ('FILE: '+$path); Get-Content -Raw -LiteralPath $path}`
> - Ran `$paths=@('cloudrun-api/src/auth/authorization.ts','cloudrun-api/src/auth/errors.ts','cloudrun-api/src/auth/google-service-identity.ts','cloudrun-api/src/auth/index.ts','cloudrun-api/src/auth/mutation.ts','cloudrun-api/src/auth/request.ts','cloudrun-api/src/auth/supabase-jwt.ts','cloudrun-api/src/auth/supabase-user-client.ts','cloudrun-api/src/auth/supabase-web-auth-client.ts'); foreach($path in $paths){Write-Output ('FILE: '+$path); Get-Content -Raw -LiteralPath $path}`
> - Ran `$paths=@('cloudrun-api/src/database/runtime.ts','cloudrun-api/src/database/errors.ts','cloudrun-api/src/http/envelope.ts','cloudrun-api/src/http/errors.ts','cloudrun-api/src/http/handlers.ts','cloudrun-api/src/http/hooks.ts','cloudrun-api/src/http/logging.ts','cloudrun-api/src/tenancy/context.ts','cloudrun-api/src/idempotency/repository.ts','cloudrun-api/src/request-limits/repository.ts','cloudrun-api/src/storage/company-files.ts'); foreach($path in $paths){Write-Output ('FILE: '+$path); Get-Content -Raw -LiteralPath $path}`
> - Ran `$paths=@('cloudrun-api/src/http/envelope.ts','cloudrun-api/src/http/errors.ts','cloudrun-api/src/http/handlers.ts','cloudrun-api/src/http/hooks.ts','cloudrun-api/src/http/logging.ts','cloudrun-api/src/tenancy/context.ts'); foreach($path in $paths){Write-Output ('FILE: '+$path); Get-Content -Raw -LiteralPath $path}`
> - Ran `$paths=@('cloudrun-api/src/web-sessions/crypto.ts','cloudrun-api/src/web-sessions/repository.ts','cloudrun-api/src/web-sessions/service.ts','cloudrun-api/src/routes/web-sessions.ts','website/src/lib/auth/opaque-session.ts','website/src/lib/auth/opaque-session-route-core.ts','website/src/lib/auth/web-session-contract.ts','website/src/app/api/auth/web-session/route.ts','website/src/lib/dal/session.ts','website/src/lib/backend/transport.ts','website/src/lib/backend/transport-core.ts','website/src/lib/backend/web-session-client.ts'); foreach($path in $paths){Write-Output ('FILE: '+$path); Get-Content -Raw -LiteralPath $path}`
> - Ran `Get-Content -LiteralPath cloudrun-api/src/web-sessions/service.ts | Select-Object -First 240
> Get-Content -LiteralPath cloudrun-api/src/web-sessions/service.ts | Select-Object -Skip 240
> Get-Content -Raw -LiteralPath cloudrun-api/src/routes/web-sessions.ts
> Get-Content -Raw -LiteralPath website/src/lib/auth/opaque-session.ts`
> - Ran `rg -n "ALTER ROLE smart_job_api|statement_timeout|lock_timeout|idle_in_transaction|web_sessions|CREATE TABLE private.web_sessions|session_token_hash" packages/db/migrations/0006_api_security_foundation.sql`
> - Ran `Get-Content -Raw website/src/app/api/auth/login/route.ts
> Get-Content -Raw website/src/app/api/auth/logout/route.ts
> Get-Content -Raw website/src/app/login/page-client.tsx
> rg -n "handleOpaqueSession(Login|Logout|Read)|createSession" website/src/app/api/auth website/src/lib/auth`
> - Ran `$paths=@('website/src/app/api/auth/register/route.ts','website/src/app/api/auth/forgot-password/route.ts','website/src/app/api/auth/reset-password/route.ts','website/src/lib/auth/server-supabase.ts','website/src/lib/auth/password-recovery.ts','website/src/lib/auth/access-token.ts','website/src/app/auth/confirm/route.ts'); foreach($path in $paths){Write-Output ('FILE: '+$path); Get-Content -Raw -LiteralPath $path}`
> - Ran `rg -n "from [\"']@?/?.*access-token|verifyAccessToken\(|getSupabaseUserByUid\(" website/src website/tests --glob '*.{ts,tsx,mts}'`
> - Ran `rg -n 'access-token|verifyAccessToken|getSupabaseUserByUid' website/src website/tests`
> - Ran `rg -n "from ['\"]jose|SUPABASE_SERVICE_ROLE_KEY|NEXT_PUBLIC_SUPABASE" website/src website/tests website/README.md SETUP.md PROJECT_SUMMARY.md AGENTS.md`
> - Ran `rg -n 'jose|SUPABASE_SERVICE_ROLE_KEY|NEXT_PUBLIC_SUPABASE' website/src website/tests website/README.md SETUP.md PROJECT_SUMMARY.md AGENTS.md`
> - Ran `$paths=@('website/src/lib/contact/challenge.ts','website/src/lib/contact/contact-request-route-core.ts','website/src/app/api/contact/challenge/route.ts','website/src/app/api/contact/request/route.ts','cloudrun-api/src/routes/contact-requests.ts','cloudrun-api/src/contact-requests/context.ts','cloudrun-api/src/contact-requests/repository.ts'); foreach($path in $paths){Write-Output ('FILE: '+$path); Get-Content -Raw -LiteralPath $path}`
> - Ran `rg -n -C 8 "consume_api_contact_request_rate_limit|contact_rate|CONTACT_" packages/db/migrations/0017_api_upgrade_and_contact_requests.sql`
> - Ran `Get-Content packages/db/migrations/0017_api_upgrade_and_contact_requests.sql | Select-Object -Skip 457 -First 75`
> - Ran `(Get-Content packages/api-contracts/src/index.ts).Count
> (Get-Content packages/contracts/index.ts).Count
> rg -n '^export const .*Schema|^export type |^export interface |^export enum|^export const (Role|JobStatus|DocType|VAT|Tier)' packages/api-contracts/src/index.ts packages/contracts/index.ts`
> - Ran `rg -n 'Archive|TaxCallback|TaxApproval' packages/api-contracts/src/index.ts packages/api-contracts/tests/contracts.test.mts cloudrun-api/src/routes cloudrun-tax/src`
> - Ran `$paths=@('cloudrun-api/src/routes/job-creation.ts','cloudrun-api/src/jobs/creation-repository.ts','cloudrun-api/src/routes/job-completion.ts','cloudrun-api/src/jobs/completion-repository.ts','cloudrun-api/src/routes/job-mutations.ts','cloudrun-api/src/jobs/mutation-repository.ts','cloudrun-api/src/routes/jobs-read.ts','cloudrun-api/src/jobs/read-repository.ts'); foreach($path in $paths){Write-Output ('FILE: '+$path); Get-Content -Raw -LiteralPath $path}`
> - Ran `Get-Content packages/api-contracts/src/index.ts | Select-Object -Skip 395 -First 100
> Get-Content cloudrun-api/src/routes/job-mutations.ts | Select-Object -First 260`
> - Ran `rg -n -C 5 'CREATE OR REPLACE FUNCTION private.accept_api_job|status = ''finished''|JOB_NOT_ACCEPTABLE' packages/db/migrations/0021_api_job_mutations.sql`
> - Ran `Get-Content packages/db/migrations/0021_api_job_mutations.sql | Select-Object -Skip 445 -First 118
> rg -n 'acceptJob|/accept|accepted' phone_app website/src supabase/handlers/jobs.ts packages/db/jobs.ts | Select-Object -First 100`
> - Ran `Get-Content packages/db/jobs.ts | Select-Object -Skip 670 -First 95
> Get-Content supabase/handlers/jobs.ts | Select-Object -Skip 880 -First 90
> Get-Content packages/api-contracts/src/index.ts | Select-Object -Skip 930 -First 150`
> - Ran `rg -n -C 10 'p_status = ''finished''|apply_job_inventory_consumption_batch|p_parts|job_part' packages/db/migrations/0007_api_job_creation_and_storage.sql | Select-Object -First 220`
> - Ran `$paths=@('cloudrun-api/src/routes/clients-read.ts','cloudrun-api/src/clients/read-repository.ts','cloudrun-api/src/routes/clients-mutations.ts','cloudrun-api/src/clients/mutation-repository.ts'); foreach($path in $paths){Write-Output ('FILE: '+$path); Get-Content -Raw -LiteralPath $path}`
> - Ran `$paths=@('cloudrun-api/src/routes/inventory-read.ts','cloudrun-api/src/inventory/read-repository.ts','cloudrun-api/src/routes/inventory-mutations.ts','cloudrun-api/src/inventory/mutation-repository.ts'); foreach($path in $paths){Write-Output ('FILE: '+$path); Get-Content -Raw -LiteralPath $path}`
> - Ran `Get-Content cloudrun-api/src/inventory/read-repository.ts | Select-Object -Skip 300
> Get-Content cloudrun-api/src/routes/inventory-mutations.ts | Select-Object -First 190`
> - Ran `Get-Content cloudrun-api/src/routes/inventory-mutations.ts | Select-Object -Skip 190 -First 50
> Get-Content packages/api-contracts/src/index.ts | Select-Object -Skip 670 -First 175`
> - Ran `$paths=@('cloudrun-api/src/routes/workers-read.ts','cloudrun-api/src/workers/read-repository.ts','cloudrun-api/src/routes/workers-mutations.ts','cloudrun-api/src/workers/mutation-repository.ts','cloudrun-api/src/routes/invitations.ts','cloudrun-api/src/invitations/repository.ts','cloudrun-api/src/invitations/rate-limit-repository.ts'); foreach($path in $paths){Write-Output ('FILE: '+$path); Get-Content -Raw -LiteralPath $path}`
>
> </details>
>
> Context compaction
>
> Source: automatic
> Status: completed
>
> The first full pass has mapped the main architecture and already surfaced one confirmed data-integrity defect: accepting a job can finish it without consuming its recorded parts. I’m now validating the remaining high-risk paths—documents/PDF/tax, invitations, archives, deployment, and mobile offline/auth flows—before I rank findings.
>
> <details><summary>Ran 50 commands</summary>
>
> - Ran `rg --files cloudrun-api/src cloudrun-tax/src cloudrun-pdf/src cloudrun-archiver/src packages/api-contracts/src packages/db/src packages/db/migrations website/src phone_app | rg "(document|worker|invitat|archive|tax|pdf|notification|outbox|auth|session|storage|route|index|ManageJobs|CreateDocument|app\.json|eas\.json)$|\.ts$|\.tsx$"`
> - Ran `Get-ChildItem cloudrun-api,cloudrun-tax,cloudrun-pdf,cloudrun-archiver,packages\db -Force | Select-Object FullName,Name,Mode`
> - Ran `Get-ChildItem cloudrun-api\src -Recurse -File | Select-Object FullName | Sort-Object FullName`
> - Ran `rg -n "DOCUMENT_|documentTaskPublisher|registerDocument|dispatch|publish|DISPATCH|task" cloudrun-api/src/runtime-config.ts cloudrun-api/src/services.ts cloudrun-api/src/app.ts cloudrun-api/src/routes/documents-mutations.ts cloudrun-api/src/routes/internal-document-dispatch.ts cloudrun-api/src/documents/*.ts`
> - Ran `rg -n "DATABASE_URL|PUBSUB|SUPABASE|PORT|env|audience|allowed|express|app\.(post|get)|health|ready" cloudrun-pdf\*.ts cloudrun-pdf\routes\*.ts cloudrun-pdf\Dockerfile cloudrun-pdf\README.md`
> - Ran `rg -n "DATABASE_URL|ARCHIVE_|SUPABASE|env|cleanup|archive|concurr|page|timeout" cloudrun-archiver\*.ts cloudrun-archiver\Dockerfile cloudrun-archiver\package.json`
> - Ran `rg -n "DATABASE_URL|PUBSUB|SUPABASE|PORT|process\.env|audience|allowed|app\.(post|get)|health|ready" cloudrun-pdf`
> - Ran `rg -n "DATABASE_URL|ARCHIVE_|SUPABASE|process\.env|cleanup|archive|concurr|page|timeout" cloudrun-archiver`
> - Ran `rg -n "documentTaskPublisher|createPubSub|DOCUMENT_|publish|lease|pending|release|complete" cloudrun-api\src\documents cloudrun-api\src\services.ts cloudrun-api\src\runtime-config.ts`
> - Ran `$files = @('cloudrun-pdf/index.ts','cloudrun-pdf/persistence.ts','cloudrun-pdf/sql-store.ts','cloudrun-pdf/pubsub-auth.ts','.github/workflows/cloudrun-deploy.yml'); foreach ($f in $files) { Write-Output ('### ' + $f); $i=0; Get-Content $f | ForEach-Object { $i++; if (($f -eq 'cloudrun-pdf/index.ts' -and (($i -ge 40 -and $i -le 130) -or ($i -ge 620 -and $i -le 660))) -or ($f -eq 'cloudrun-pdf/persistence.ts') -or ($f -eq 'cloudrun-pdf/sql-store.ts' -and $i -le 80) -or ($f -eq 'cloudrun-pdf/pubsub-auth.ts' -and $i -le 145) -or ($f -eq '.github/workflows/cloudrun-deploy.yml' -and $i -ge 90 -and $i -le 215)) { '{0,4}: {1}' -f $i, $_ } } }`
> - Ran `$i=0; Get-Content .github\workflows\cloudrun-deploy.yml | ForEach-Object { $i++; if ($i -le 100) { '{0,4}: {1}' -f $i, $_ } }`
> - Ran `$i=0; Get-Content cloudrun-api\src\runtime-config.ts | ForEach-Object { $i++; if (($i -ge 55 -and $i -le 100) -or ($i -ge 375 -and $i -le 398)) { '{0,4}: {1}' -f $i, $_ } }; $i=0; Get-Content cloudrun-api\src\routes\documents-mutations.ts | ForEach-Object { $i++; if (($i -ge 130 -and $i -le 215) -or ($i -ge 245 -and $i -le 275)) { '{0,4}: {1}' -f $i, $_ } }; $i=0; Get-Content cloudrun-api\src\index.ts | ForEach-Object { $i++; if ($i -le 100) { '{0,4}: {1}' -f $i, $_ } }`
> - Ran `rg -n "createPubSubDocumentTaskPublisher|documentDispatch|documentTaskPublisher" cloudrun-api\src\server.ts cloudrun-api\src\*.ts; $i=0; Get-Content cloudrun-api\src\server.ts | ForEach-Object { $i++; if ($i -le 180) { '{0,4}: {1}' -f $i, $_ } }`
> - Ran `$i=0; Get-Content cloudrun-pdf\index.ts | ForEach-Object { $i++; if ($i -ge 120 -and $i -le 180) { '{0,4}: {1}' -f $i, $_ } }; rg -n "isSharedSqlStoreEnabled|getSharedSqlPool|connectSharedSqlClient|assertSafe" cloudrun-pdf\index.ts cloudrun-pdf\*.ts`
> - Ran `$i=0; Get-Content cloudrun-archiver\index.ts | ForEach-Object { $i++; if (($i -ge 112 -and $i -le 130) -or ($i -ge 600 -and $i -le 682)) { '{0,4}: {1}' -f $i, $_ } }; $i=0; Get-Content cloudrun-archiver\package.json | ForEach-Object { $i++; '{0,4}: {1}' -f $i, $_ }`
> - Ran `Get-ChildItem cloudrun-tax\src -File | Select-Object Name,Length; Get-ChildItem cloudrun-tax\src -Recurse -File | Select-Object FullName`
> - Ran `rg -n "process\.env|TAX_|MAIN_|AUDIENCE|HMAC|timeout|Abort|fetch|callback|approval|authenticate|authorization|rate|bodyLimit|requestTimeout" cloudrun-tax\src cloudrun-tax\README.md cloudrun-tax\tests`
> - Ran `rg -n "app\.(get|post|patch|delete)|role|manager|dev|worker|idempot|verified|company|version|rate|invite|email" cloudrun-api\src\routes\workers-read.ts cloudrun-api\src\routes\workers-mutations.ts cloudrun-api\src\workers cloudrun-api\src\tests\workers*`
> - Ran `rg -n "app\.(get|post|patch|delete)|role|manager|dev|worker|idempot|verified|company|rate|invite|email|code" cloudrun-api\src\routes\invitations.ts cloudrun-api\src\invitations packages\db\migrations\0012_hardened_api_invitations.sql`
> - Ran `rg -n "worker|member|invite|invitation" packages\api-contracts\src\index.ts | Select-Object -First 120`
> - Ran `rg -n "role|manager|dev|worker|idempot|verified|company|rate|invite|email|code|FOR UPDATE|pg_advisory|consume|redeem|hash" cloudrun-api\src\routes\invitations.ts cloudrun-api\src\invitations packages\db\migrations\0012_hardened_api_invitations.sql`
> - Ran `Get-ChildItem packages\db\migrations | Select-Object Name; rg -n "update_api_worker|disable_api_worker" packages\db\migrations`
> - Ran `$files=@('cloudrun-api/src/documents/dispatch.ts','cloudrun-api/src/documents/pubsub-publisher.ts','cloudrun-pdf/routes/preview.ts','cloudrun-pdf/routes/generate.ts','cloudrun-pdf/task-store.ts','cloudrun-pdf/access-store.ts','cloudrun-pdf/document-store.ts'); foreach($f in $files){Write-Output ('### '+$f); $i=0; Get-Content $f | ForEach-Object{$i++; '{0,4}: {1}' -f $i,$_}}`
> - Ran `rg -n "cloudrun-pdf|PDF.*DATABASE|SMART_JOB_PDF|DATABASE_URL|pdf role|smart_job_pdf|document_tasks" README.md SETUP.md DEPLOYMENT*.md architecture.md backend.md cloudrun-pdf\README.md packages\db\migrations .github\workflows`
> - Ran `$i=0; Get-Content cloudrun-pdf\index.ts | ForEach-Object { $i++; if (($i -ge 170 -and $i -le 430) -or ($i -ge 430 -and $i -le 620)) { '{0,4}: {1}' -f $i, $_ } }`
> - Ran `$i=0; Get-Content packages\db\migrations\0022_api_document_tasks.sql | ForEach-Object { $i++; if (($i -ge 330 -and $i -le 575) -or ($i -ge 575 -and $i -le 665)) { '{0,4}: {1}' -f $i, $_ } }`
> - Ran `rg -n "companyId.*[0-9]|companyId:|public_company_id|Requester company mismatch|processPreviewTask|processGenerateTask" cloudrun-api\src\tests\document* cloudrun-pdf\tests packages\db\tests | Select-Object -First 250`
> - Ran `rg -n "dispatch|companyId|request_payload|document task|preview|generate" cloudrun-api\src\tests\documents-mutations.integration.test.ts cloudrun-api\src\tests\documents-mutations.test.ts cloudrun-api\src\tests\document-dispatch.test.ts packages\db\tests\api-security-foundation.integration.test.mjs | Select-Object -First 300`
> - Ran `$i=0; Get-Content cloudrun-api\src\tests\documents-mutations.integration.test.ts | ForEach-Object { $i++; if ($i -ge 195 -and $i -le 250) { '{0,4}: {1}' -f $i, $_ } }`
> - Ran `$i=0; Get-Content cloudrun-pdf\htmlTemplate.ts | ForEach-Object { $i++; if ($i -le 120 -or ($i -ge 560 -and $i -le 683)) { '{0,4}: {1}' -f $i, $_ } }; rg -n "sanitize|escapeHtml|logo|href|src=|url\(" cloudrun-pdf\htmlTemplate.ts cloudrun-pdf\document-payload.ts`
> - Ran `rg -n "tax/approval|tax approval|TAX_WORKFLOW_REQUIRED|createTax|TaxInvoice|documentType.*305|DOC_TYPE\.TAX|approval-session" cloudrun-api cloudrun-tax website phone_app supabase packages | Select-Object -First 350`
> - Ran `$i=0; Get-Content phone_app\modules\documents\hooks\useTaxInvoiceSubmission.ts | ForEach-Object { $i++; if (($i -ge 80 -and $i -le 230) -or ($i -ge 350 -and $i -le 475)) { '{0,4}: {1}' -f $i, $_ } }; rg -n "call|invoke|function|Edge|api|fetch|tax" phone_app\modules\documents\hooks\useTaxInvoiceSubmission.ts`
> - Ran `$i=0; Get-Content phone_app\modules\documents\hooks\useTaxInvoiceSubmission.ts | ForEach-Object { $i++; if ($i -le 45) { '{0,4}: {1}' -f $i, $_ } }; rg -n "middleEastFunctions|httpsCallable" phone_app\firebase.ts phone_app\modules phone_app\contexts | Select-Object -First 100`
> - Ran `$i=0; Get-Content phone_app\firebase.ts | ForEach-Object { $i++; if (($i -ge 1 -and $i -le 155) -or ($i -ge 210 -and $i -le 300)) { '{0,4}: {1}' -f $i, $_ } }`
> - Ran `$i=0; Get-Content phone_app\firebase.ts | ForEach-Object { $i++; if ($i -ge 145 -and $i -le 210) { '{0,4}: {1}' -f $i, $_ } }`
> - Ran `$i=0; Get-Content supabase\handlers\tax.ts | ForEach-Object { $i++; if ($i -le 330) { '{0,4}: {1}' -f $i, $_ } }; Get-ChildItem supabase\functions\mutation-gateway-me-west1 -Recurse -File | Select-Object FullName`
> - Ran `$i=0; Get-Content supabase\handlers\tax.ts | ForEach-Object { $i++; if ($i -ge 329 -and $i -le 500) { '{0,4}: {1}' -f $i, $_ } }; $i=0; Get-Content cloudrun-tax\src\app.ts | ForEach-Object { $i++; if ($i -ge 205 -and $i -le 255) { '{0,4}: {1}' -f $i, $_ } }`
> - Ran `rg -n "documents_.*check|total_before_vat|vat_amount|total_with_vat|document_items.*check|quantity.*CHECK|unit_price" packages\db\migrations\0000_optimized_baseline.sql packages\db\schema.ts | Select-Object -First 120`
> - Ran `$i=0; Get-Content cloudrun-tax\src\contracts.ts | ForEach-Object { $i++; if ($i -le 85) { '{0,4}: {1}' -f $i, $_ } }; $i=0; Get-Content cloudrun-api\src\routes\internal-tax-callback.ts | ForEach-Object { $i++; if ($i -le 160) { '{0,4}: {1}' -f $i, $_ } }`
> - Ran `$i=0; Get-Content packages\db\archive.ts | ForEach-Object { $i++; if ($i -le 330) { '{0,4}: {1}' -f $i, $_ } }`
> - Ran `$i=0; Get-Content cloudrun-api\src\archives\read-repository.ts | ForEach-Object { $i++; if ($i -le 240) { '{0,4}: {1}' -f $i, $_ } }; $i=0; Get-Content cloudrun-api\src\routes\archives-read.ts | ForEach-Object { $i++; '{0,4}: {1}' -f $i, $_ }`
> - Ran `$i=0; Get-Content packages\db\migrations\0024_api_archive_retrieval.sql | ForEach-Object { $i++; '{0,4}: {1}' -f $i, $_ }`
> - Ran `$i=0; Get-Content cloudrun-archiver\index.ts | ForEach-Object { $i++; if (($i -ge 130 -and $i -le 340) -or ($i -ge 400 -and $i -le 600)) { '{0,4}: {1}' -f $i, $_ } }`
> - Ran `$i=0; Get-Content cloudrun-archiver\index.ts | ForEach-Object { $i++; if ($i -ge 334 -and $i -le 405) { '{0,4}: {1}' -f $i, $_ } }`
> - Ran `rg -n "SECURITY DEFINER" packages\db\migrations supabase | Measure-Object | Select-Object Count; rg -n -U "SECURITY DEFINER\r?\n(?!SET search_path)" packages\db\migrations supabase`
> - Ran `rg --pcre2 -n -U "SECURITY DEFINER\r?\n(?!SET search_path)" packages\db\migrations supabase`
> - Ran `$i=0; Get-Content .github\workflows\ci.yml | ForEach-Object { $i++; if ($i -ge 255 -and $i -le 330) { '{0,4}: {1}' -f $i, $_ } }`
> - Ran `Get-ChildItem packages\db\migrations\meta -File | Select-Object Name,Length; Get-Content packages\db\migrations\meta\_journal.json | Select-Object -Last 50`
> - Ran `rg -n 'api_push_devices|support_conversations|contact_requests|entity_version|archive_runs' packages\db\migrations\meta\0012_snapshot.json packages\db\schema.ts | Select-Object -First 120`
> - Ran `rg -n 'push_devices|tax_callback_events|dispatch_attempts|oauth_session_id' packages\db\migrations\meta\0012_snapshot.json packages\db\schema.ts`
>
> </details>
>
> Two release blockers are now confirmed in the document/tax pipeline. The deployed PDF worker configuration is incomplete enough that a fresh production revision cannot start, and the mobile “tax approval” path currently reserves and generates an invoice without ever calling the tax-authority gateway while the UI reports approval. I’m tracing the client-facing consequences and test gaps next.
>
> <details><summary>Ran 23 commands</summary>
>
> - Ran `Get-ChildItem website\src\app -Recurse -File | Select-Object FullName | Sort-Object FullName; Get-ChildItem website\src\components -Recurse -File | Select-Object FullName | Sort-Object FullName`
> - Ran `$files=@('website/src/app/layout.tsx','website/src/app/app/layout.tsx','website/src/components/layout/server-workspace-shell.tsx','website/src/components/ui/Modal.tsx','website/src/components/ui/DataTable.tsx','website/src/components/ui/Input.tsx','website/src/components/ui/Button.tsx','website/src/app/globals.css'); foreach($f in $files){Write-Output ('### '+$f); $i=0; Get-Content $f | ForEach-Object{$i++; if($i -le 260){'{0,4}: {1}' -f $i,$_}}}`
> - Ran `rg -n "useI18n|useTranslation|t\(" website\src\components\clients website\src\components\documents website\src\components\inventory website\src\components\jobs website\src\components\workers website\src\components\settings website\src\components\layout\server-workspace-shell.tsx website\src\app\app | Select-Object -First 200`
> - Ran `Get-ChildItem website\src\lib -Recurse -File | Select-Object FullName | Sort-Object FullName; rg -n "cache\(|unstable_cache|fetch\(|BACKEND_API|requireWebsiteRequestContext|viewer|workspaces|timeout" website\src\lib website\src\app\app | Select-Object -First 300`
> - Ran `rg -n "idempot|crypto\.randomUUID|randomUUID|csrf|Origin|router\.refresh|fetch\(" website\src\components\clients website\src\components\inventory website\src\components\documents website\src\components\workers website\src\lib\* -g "*.ts" -g "*.tsx" | Select-Object -First 350`
> - Ran `$files=@('website/src/components/documents/document-create-control.tsx','website/src/components/documents/document-mutation-model.ts','website/src/lib/document-task-poll.ts'); foreach($f in $files){Write-Output ('### '+$f); $i=0; Get-Content $f | ForEach-Object{$i++; if($i -le 330){'{0,4}: {1}' -f $i,$_}}}`
> - Ran `rg -n "redirect=|returnTo|safe.*redirect|startsWith\('/'\)|new URL" website\src\app\login website\src\lib\auth website\src\app\api\auth | Select-Object -First 200`
> - Ran `$i=0; Get-Content website\src\lib\auth\opaque-session.ts | ForEach-Object { $i++; if (($i -ge 1 -and $i -le 65) -or ($i -ge 150 -and $i -le 200)) { '{0,4}: {1}' -f $i, $_ } }; $i=0; Get-Content website\src\app\login\page-client.tsx | ForEach-Object { $i++; if ($i -ge 55 -and $i -le 95) { '{0,4}: {1}' -f $i, $_ } }`
> - Ran `rg -n "function safeOpaqueReturnPath|safeOpaqueReturnPath" website\src; $i=0; Get-Content website\src\lib\auth\client-session-reconciliation.ts | ForEach-Object { $i++; if ($i -le 120) { '{0,4}: {1}' -f $i, $_ } }`
> - Ran `$i=0; Get-Content website\src\app\login\page-client.tsx | ForEach-Object { $i++; if ($i -le 55) { '{0,4}: {1}' -f $i, $_ } }`
> - Ran `$files=@('website/src/app/api/auth/login/route.ts','website/src/app/api/auth/register/route.ts','website/src/app/api/auth/forgot-password/route.ts','website/src/app/api/auth/reset-password/route.ts','website/src/app/api/auth/logout/route.ts'); foreach($f in $files){Write-Output ('### '+$f); $i=0; Get-Content $f | ForEach-Object{$i++; '{0,4}: {1}' -f $i,$_}}`
> - Ran `$i=0; Get-Content website\src\lib\analytics.ts | ForEach-Object { $i++; '{0,4}: {1}' -f $i, $_ }; rg -n "analytics|Sentry|OpenTelemetry|otel|trace|metrics|instrumentation|web-vitals" website cloudrun-api cloudrun-tax cloudrun-pdf cloudrun-archiver | Select-Object -First 200`
> - Ran `Get-ChildItem phone_app\lib,phone_app\contexts,phone_app\modules\offline,phone_app\hooks,phone_app\services -Recurse -File -ErrorAction SilentlyContinue | Select-Object FullName | Sort-Object FullName`
> - Ran `$files=@('phone_app/lib/api/client.ts','phone_app/lib/auth/supabase-client.ts','phone_app/contexts/SessionContext.tsx','phone_app/contexts/TenantContext.tsx','phone_app/lib/query/client.ts','phone_app/lib/query/persistence.ts','phone_app/contexts/QueryProvider.tsx'); foreach($f in $files){Write-Output ('### '+$f); $i=0; Get-Content $f | ForEach-Object{$i++; '{0,4}: {1}' -f $i,$_}}`
> - Ran `$files=@('phone_app/contexts/NotificationContext.tsx','phone_app/lib/notifications/audience.ts','phone_app/lib/api/push-tokens.ts','phone_app/contexts/OutboxContext.tsx','phone_app/lib/outbox/processor.ts','phone_app/lib/outbox/database.ts','phone_app/lib/outbox/attachments.ts'); foreach($f in $files){Write-Output ('### '+$f); $i=0; Get-Content $f | ForEach-Object{$i++; '{0,4}: {1}' -f $i,$_}}`
> - Ran `$files=@('phone_app/contexts/SessionContext.tsx','phone_app/contexts/TenantContext.tsx','phone_app/lib/query/client.ts','phone_app/lib/query/persistence.ts','phone_app/contexts/QueryProvider.tsx'); foreach($f in $files){Write-Output ('### '+$f); $i=0; Get-Content $f | ForEach-Object{$i++; '{0,4}: {1}' -f $i,$_}}`
> - Ran `$i=0; Get-Content phone_app\contexts\NotificationContext.tsx | ForEach-Object { $i++; if ($i -le 650) { '{0,4}: {1}' -f $i, $_ } }`
> - Ran `rg -n "clearPush|clear.*token|registerPush|signOut|logout" phone_app | Select-Object -First 250`
> - Ran `$i=0; Get-Content phone_app\lib\outbox\processor.ts | ForEach-Object { $i++; '{0,4}: {1}' -f $i, $_ }; $i=0; Get-Content phone_app\contexts\OutboxContext.tsx | ForEach-Object { $i++; if ($i -le 520) { '{0,4}: {1}' -f $i, $_ } }`
> - Ran `rg -n "uploads/job-attachments/sessions|idempotency-key|mutationHeaders" cloudrun-api\src\routes\upload-sessions.ts; $i=0; Get-Content cloudrun-api\src\routes\upload-sessions.ts | ForEach-Object { $i++; if ($i -le 190) { '{0,4}: {1}' -f $i, $_ } }; rg -n "uploads/job-attachments/sessions" phone_app website cloudrun-api\src\tests | Select-Object -First 120`
> - Ran `rg -n "ensureUploadSession|idempotency|uploads/job|attachments" phone_app\tests\offline-outbox.test.mts phone_app\tests | Select-Object -First 220`
> - Ran `Get-ChildItem phone_app\tests -File | Where-Object {$_.Name -match 'outbox|offline|fill-job|lifecycle'} | Select-Object Name,Length; rg -n "requestApi|apiOutboxTransport|OutboxTransport|upload session|idempotencyKey" phone_app\tests | Select-Object -First 300`
> - Ran `$i=0; Get-Content phone_app\lib\outbox\upload.ts | ForEach-Object { $i++; '{0,4}: {1}' -f $i, $_ }; $i=0; Get-Content phone_app\lib\outbox\database.ts | ForEach-Object { $i++; if ($i -le 260) { '{0,4}: {1}' -f $i, $_ } }; $i=0; Get-Content phone_app\lib\outbox\sqlcipher.ts | ForEach-Object { $i++; '{0,4}: {1}' -f $i, $_ }`
>
> </details>
>
> Context compaction
>
> Source: automatic
> Status: completed
>
> The backend trace is now largely complete. I’m finishing the mobile/web failure paths, dependency posture, and test/deployment coverage next; I’m keeping confirmed defects separate from risks that depend on external infrastructure or runtime configuration.
>
> <details><summary>Ran 6 commands</summary>
>
> - Ran `rg -n --glob '!node_modules/**' --glob '!dist/**' --glob '!build/**' "TODO|FIXME|HACK|XXX|temporary|workaround|not implemented|501|throw new Error\(.*not" website/src phone_app cloudrun-api cloudrun-tax cloudrun-pdf cloudrun-archiver supabase packages | Select-Object -First 500`
> - Ran `$files = @(
>   'phone_app/modules/documents/hooks/useTaxInvoiceSubmission.ts',
>   'phone_app/modules/documents/screens/CreateDocument.tsx',
>   'phone_app/modules/documents/hooks/useDocumentTask.ts',
>   'phone_app/lib/outbox/processor.ts',
>   'phone_app/lib/api/client.ts'
> )
> foreach ($file in $files) {
>   Write-Output "FILE $file"
>   $lines = Get-Content -LiteralPath $file
>   for ($i=0; $i -lt $lines.Count; $i++) {
>     if (($file -like '*useTaxInvoiceSubmission*' -and $i -ge 350 -and $i -lt 465) -or
>         ($file -like '*CreateDocument*' -and $i -ge 830 -and $i -lt 905) -or
>         ($file -like '*useDocumentTask*') -or
>         ($file -like '*processor.ts' -and (($i -ge 85 -and $i -lt 145) -or ($i -ge 240 -and $i -lt 365))) -or
>         ($file -like '*client.ts' -and $i -ge 175 -and $i -lt 225)) {
>       '{0,5}: {1}' -f ($i + 1), $lines[$i]
>     }
>   }
> }`
> - Ran `rg --files phone_app | rg "DocumentTask|document-task|task"; rg -n "function useDocumentTask|const useDocumentTask|useDocumentTask" phone_app/modules phone_app/hooks phone_app/lib`
> - Ran `$file='phone_app/hooks/useDocumentTask.ts'; $lines=Get-Content -LiteralPath $file; for($i=0;$i -lt $lines.Count;$i++){ '{0,5}: {1}' -f ($i+1),$lines[$i] }; Write-Output 'POLL'; $file='phone_app/hooks/document-task-poll.ts'; $lines=Get-Content -LiteralPath $file; for($i=0;$i -lt $lines.Count;$i++){ '{0,5}: {1}' -f ($i+1),$lines[$i] }`
> - Ran `$files=@('phone_app/modules/documents/lib/document-action-keys.ts','website/src/components/documents/document-create-control.tsx','phone_app/modules/documents/lib/documents-api.ts'); foreach($file in $files){Write-Output "FILE $file";$lines=Get-Content -LiteralPath $file;for($i=0;$i -lt $lines.Count;$i++){'{0,5}: {1}' -f ($i+1),$lines[$i]}}`
> - Ran `$file='phone_app/firebase.ts'; $lines=Get-Content -LiteralPath $file; for($i=130;$i -lt [Math]::Min($lines.Count,225);$i++){'{0,5}: {1}' -f ($i+1),$lines[$i]}; Write-Output 'TAX HANDLER'; $file='supabase/handlers/tax.ts'; $lines=Get-Content -LiteralPath $file; foreach($range in @(@(1,120),@(120,320),@(320,345))){for($i=$range[0]-1;$i -lt [Math]::Min($lines.Count,$range[1]);$i++){'{0,5}: {1}' -f ($i+1),$lines[$i]}}`
>
> </details>
>
> The web/mobile document flow has a shared retry flaw: both clients discard the idempotency key as soon as a task is accepted, while their five-minute timeout tells users to retry. A slow or unreachable PDF worker can therefore turn a harmless retry into a second numbered document. I’m checking whether existing tests cover that lifecycle and whether any dependency advisories add release blockers.
>
> <details><summary>Ran 50 commands</summary>
>
> - Ran `rg --files -g package.json -g deno.json -g '*.lock' -g '!node_modules/**' | Sort-Object; Get-ChildItem -Path website,phone_app,cloudrun-api,cloudrun-tax,cloudrun-pdf,cloudrun-archiver,packages/contracts,packages/api-contracts,packages/db -Filter package.json | ForEach-Object { $p=Get-Content $_.FullName -Raw | ConvertFrom-Json; [pscustomobject]@{Path=$_.FullName.Substring((Get-Location).Path.Length+1); Name=$p.name; Version=$p.version; Node=$p.engines.node; Scripts=($p.scripts.PSObject.Properties.Name -join ', '); DepCount=@($p.dependencies.PSObject.Properties).Count; DevDepCount=@($p.devDependencies.PSObject.Properties).Count} } | Format-Table -AutoSize`
> - Ran `$raw = npm audit --omit=dev --json 2>$null
> try {
>   $data = $raw | ConvertFrom-Json
>   $meta = $data.metadata.vulnerabilities
>   [pscustomobject]@{
>     Package = 'website'
>     Info = $meta.info
>     Low = $meta.low
>     Moderate = $meta.moderate
>     High = $meta.high
>     Critical = $meta.critical
>     Total = $meta.total
>     AuditError = $data.error.code
>   } | ConvertTo-Json -Compress
>   foreach ($entry in $data.vulnerabilities.PSObject.Properties) {
>     $v = $entry.Value
>     if ($v.severity -in @('high','critical')) {
>       [pscustomobject]@{
>         Dependency = $entry.Name
>         Severity = $v.severity
>         Direct = $v.isDirect
>         Range = $v.range
>         FixAvailable = if ($v.fixAvailable -is [bool]) { $v.fixAvailable } else { $v.fixAvailable.version }
>         Via = (($v.via | ForEach-Object { if ($_ -is [string]) { $_ } else { "$($_.title) [$($_.url)]" } }) -join ' | ')
>       } | ConvertTo-Json -Compress
>     }
>   }
> } catch {
>   [pscustomobject]@{Package='website'; ParseError=$_.Exception.Message} | ConvertTo-Json -Compress
> }`
> - Ran `$raw = npm audit --omit=dev --json 2>$null
> try {
>   $data = $raw | ConvertFrom-Json
>   $meta = $data.metadata.vulnerabilities
>   [pscustomobject]@{
>     Package = 'phone_app'
>     Info = $meta.info
>     Low = $meta.low
>     Moderate = $meta.moderate
>     High = $meta.high
>     Critical = $meta.critical
>     Total = $meta.total
>     AuditError = $data.error.code
>   } | ConvertTo-Json -Compress
>   foreach ($entry in $data.vulnerabilities.PSObject.Properties) {
>     $v = $entry.Value
>     if ($v.severity -in @('high','critical')) {
>       [pscustomobject]@{
>         Dependency = $entry.Name
>         Severity = $v.severity
>         Direct = $v.isDirect
>         Range = $v.range
>         FixAvailable = if ($v.fixAvailable -is [bool]) { $v.fixAvailable } else { $v.fixAvailable.version }
>         Via = (($v.via | ForEach-Object { if ($_ -is [string]) { $_ } else { "$($_.title) [$($_.url)]" } }) -join ' | ')
>       } | ConvertTo-Json -Compress
>     }
>   }
> } catch {
>   [pscustomobject]@{Package='phone_app'; ParseError=$_.Exception.Message} | ConvertTo-Json -Compress
> }`
> - Ran `$raw = npm audit --omit=dev --json 2>$null
> try {
>   $data = $raw | ConvertFrom-Json
>   $meta = $data.metadata.vulnerabilities
>   [pscustomobject]@{
>     Package = 'cloudrun-api'
>     Info = $meta.info
>     Low = $meta.low
>     Moderate = $meta.moderate
>     High = $meta.high
>     Critical = $meta.critical
>     Total = $meta.total
>     AuditError = $data.error.code
>   } | ConvertTo-Json -Compress
>   foreach ($entry in $data.vulnerabilities.PSObject.Properties) {
>     $v = $entry.Value
>     if ($v.severity -in @('high','critical')) {
>       [pscustomobject]@{
>         Dependency = $entry.Name
>         Severity = $v.severity
>         Direct = $v.isDirect
>         Range = $v.range
>         FixAvailable = if ($v.fixAvailable -is [bool]) { $v.fixAvailable } else { $v.fixAvailable.version }
>         Via = (($v.via | ForEach-Object { if ($_ -is [string]) { $_ } else { "$($_.title) [$($_.url)]" } }) -join ' | ')
>       } | ConvertTo-Json -Compress
>     }
>   }
> } catch {
>   [pscustomobject]@{Package='cloudrun-api'; ParseError=$_.Exception.Message} | ConvertTo-Json -Compress
> }`
> - Ran `$raw = npm audit --omit=dev --json 2>$null
> try {
>   $data = $raw | ConvertFrom-Json
>   $meta = $data.metadata.vulnerabilities
>   [pscustomobject]@{
>     Package = 'cloudrun-tax'
>     Info = $meta.info
>     Low = $meta.low
>     Moderate = $meta.moderate
>     High = $meta.high
>     Critical = $meta.critical
>     Total = $meta.total
>     AuditError = $data.error.code
>   } | ConvertTo-Json -Compress
>   foreach ($entry in $data.vulnerabilities.PSObject.Properties) {
>     $v = $entry.Value
>     if ($v.severity -in @('high','critical')) {
>       [pscustomobject]@{
>         Dependency = $entry.Name
>         Severity = $v.severity
>         Direct = $v.isDirect
>         Range = $v.range
>         FixAvailable = if ($v.fixAvailable -is [bool]) { $v.fixAvailable } else { $v.fixAvailable.version }
>         Via = (($v.via | ForEach-Object { if ($_ -is [string]) { $_ } else { "$($_.title) [$($_.url)]" } }) -join ' | ')
>       } | ConvertTo-Json -Compress
>     }
>   }
> } catch {
>   [pscustomobject]@{Package='cloudrun-tax'; ParseError=$_.Exception.Message} | ConvertTo-Json -Compress
> }`
> - Ran `$raw = npm audit --omit=dev --json 2>$null
> try {
>   $data = $raw | ConvertFrom-Json
>   $meta = $data.metadata.vulnerabilities
>   [pscustomobject]@{
>     Package = 'cloudrun-pdf'
>     Info = $meta.info
>     Low = $meta.low
>     Moderate = $meta.moderate
>     High = $meta.high
>     Critical = $meta.critical
>     Total = $meta.total
>     AuditError = $data.error.code
>   } | ConvertTo-Json -Compress
>   foreach ($entry in $data.vulnerabilities.PSObject.Properties) {
>     $v = $entry.Value
>     if ($v.severity -in @('high','critical')) {
>       [pscustomobject]@{
>         Dependency = $entry.Name
>         Severity = $v.severity
>         Direct = $v.isDirect
>         Range = $v.range
>         FixAvailable = if ($v.fixAvailable -is [bool]) { $v.fixAvailable } else { $v.fixAvailable.version }
>         Via = (($v.via | ForEach-Object { if ($_ -is [string]) { $_ } else { "$($_.title) [$($_.url)]" } }) -join ' | ')
>       } | ConvertTo-Json -Compress
>     }
>   }
> } catch {
>   [pscustomobject]@{Package='cloudrun-pdf'; ParseError=$_.Exception.Message} | ConvertTo-Json -Compress
> }`
> - Ran `$raw = npm audit --omit=dev --json 2>$null
> try {
>   $data = $raw | ConvertFrom-Json
>   $meta = $data.metadata.vulnerabilities
>   [pscustomobject]@{
>     Package = 'cloudrun-archiver'
>     Info = $meta.info
>     Low = $meta.low
>     Moderate = $meta.moderate
>     High = $meta.high
>     Critical = $meta.critical
>     Total = $meta.total
>     AuditError = $data.error.code
>   } | ConvertTo-Json -Compress
>   foreach ($entry in $data.vulnerabilities.PSObject.Properties) {
>     $v = $entry.Value
>     if ($v.severity -in @('high','critical')) {
>       [pscustomobject]@{
>         Dependency = $entry.Name
>         Severity = $v.severity
>         Direct = $v.isDirect
>         Range = $v.range
>         FixAvailable = if ($v.fixAvailable -is [bool]) { $v.fixAvailable } else { $v.fixAvailable.version }
>         Via = (($v.via | ForEach-Object { if ($_ -is [string]) { $_ } else { "$($_.title) [$($_.url)]" } }) -join ' | ')
>       } | ConvertTo-Json -Compress
>     }
>   }
> } catch {
>   [pscustomobject]@{Package='cloudrun-archiver'; ParseError=$_.Exception.Message} | ConvertTo-Json -Compress
> }`
> - Ran `$raw = npm audit --omit=dev --json 2>$null
> try {
>   $data = $raw | ConvertFrom-Json
>   $meta = $data.metadata.vulnerabilities
>   [pscustomobject]@{
>     Package = 'packages/contracts'
>     Info = $meta.info
>     Low = $meta.low
>     Moderate = $meta.moderate
>     High = $meta.high
>     Critical = $meta.critical
>     Total = $meta.total
>     AuditError = $data.error.code
>   } | ConvertTo-Json -Compress
>   foreach ($entry in $data.vulnerabilities.PSObject.Properties) {
>     $v = $entry.Value
>     if ($v.severity -in @('high','critical')) {
>       [pscustomobject]@{
>         Dependency = $entry.Name
>         Severity = $v.severity
>         Direct = $v.isDirect
>         Range = $v.range
>         FixAvailable = if ($v.fixAvailable -is [bool]) { $v.fixAvailable } else { $v.fixAvailable.version }
>         Via = (($v.via | ForEach-Object { if ($_ -is [string]) { $_ } else { "$($_.title) [$($_.url)]" } }) -join ' | ')
>       } | ConvertTo-Json -Compress
>     }
>   }
> } catch {
>   [pscustomobject]@{Package='packages/contracts'; ParseError=$_.Exception.Message} | ConvertTo-Json -Compress
> }`
> - Ran `$raw = npm audit --omit=dev --json 2>$null
> try {
>   $data = $raw | ConvertFrom-Json
>   $meta = $data.metadata.vulnerabilities
>   [pscustomobject]@{
>     Package = 'packages/api-contracts'
>     Info = $meta.info
>     Low = $meta.low
>     Moderate = $meta.moderate
>     High = $meta.high
>     Critical = $meta.critical
>     Total = $meta.total
>     AuditError = $data.error.code
>   } | ConvertTo-Json -Compress
>   foreach ($entry in $data.vulnerabilities.PSObject.Properties) {
>     $v = $entry.Value
>     if ($v.severity -in @('high','critical')) {
>       [pscustomobject]@{
>         Dependency = $entry.Name
>         Severity = $v.severity
>         Direct = $v.isDirect
>         Range = $v.range
>         FixAvailable = if ($v.fixAvailable -is [bool]) { $v.fixAvailable } else { $v.fixAvailable.version }
>         Via = (($v.via | ForEach-Object { if ($_ -is [string]) { $_ } else { "$($_.title) [$($_.url)]" } }) -join ' | ')
>       } | ConvertTo-Json -Compress
>     }
>   }
> } catch {
>   [pscustomobject]@{Package='packages/api-contracts'; ParseError=$_.Exception.Message} | ConvertTo-Json -Compress
> }`
> - Ran `$raw = npm audit --omit=dev --json 2>$null
> try {
>   $data = $raw | ConvertFrom-Json
>   $meta = $data.metadata.vulnerabilities
>   [pscustomobject]@{
>     Package = 'packages/db'
>     Info = $meta.info
>     Low = $meta.low
>     Moderate = $meta.moderate
>     High = $meta.high
>     Critical = $meta.critical
>     Total = $meta.total
>     AuditError = $data.error.code
>   } | ConvertTo-Json -Compress
>   foreach ($entry in $data.vulnerabilities.PSObject.Properties) {
>     $v = $entry.Value
>     if ($v.severity -in @('high','critical')) {
>       [pscustomobject]@{
>         Dependency = $entry.Name
>         Severity = $v.severity
>         Direct = $v.isDirect
>         Range = $v.range
>         FixAvailable = if ($v.fixAvailable -is [bool]) { $v.fixAvailable } else { $v.fixAvailable.version }
>         Via = (($v.via | ForEach-Object { if ($_ -is [string]) { $_ } else { "$($_.title) [$($_.url)]" } }) -join ' | ')
>       } | ConvertTo-Json -Compress
>     }
>   }
> } catch {
>   [pscustomobject]@{Package='packages/db'; ParseError=$_.Exception.Message} | ConvertTo-Json -Compress
> }`
> - Ran `$raw = npm audit --omit=dev --json 2>$null
> try {
>   $data = $raw | ConvertFrom-Json
>   $meta = $data.metadata.vulnerabilities
>   [pscustomobject]@{
>     Info = $meta.info
>     Low = $meta.low
>     Moderate = $meta.moderate
>     High = $meta.high
>     Critical = $meta.critical
>     Total = $meta.total
>     AuditError = $data.error.code
>   } | ConvertTo-Json -Compress
>   foreach ($entry in $data.vulnerabilities.PSObject.Properties) {
>     $v = $entry.Value
>     if ($v.severity -in @('moderate','high','critical')) {
>       [pscustomobject]@{
>         Dependency = $entry.Name
>         Severity = $v.severity
>         Direct = $v.isDirect
>         Range = $v.range
>         FixAvailable = if ($v.fixAvailable -is [bool]) { $v.fixAvailable } else { $v.fixAvailable.version }
>         Via = (($v.via | ForEach-Object { if ($_ -is [string]) { $_ } else { "$($_.title) [$($_.url)]" } }) -join ' | ')
>       } | ConvertTo-Json -Compress
>     }
>   }
> } catch {
>   [pscustomobject]@{ParseError=$_.Exception.Message} | ConvertTo-Json -Compress
> }`
> - Ran `$raw = npm audit --omit=dev --json 2>$null
> try {
>   $data = $raw | ConvertFrom-Json
>   $meta = $data.metadata.vulnerabilities
>   [pscustomobject]@{
>     Info = $meta.info
>     Low = $meta.low
>     Moderate = $meta.moderate
>     High = $meta.high
>     Critical = $meta.critical
>     Total = $meta.total
>     AuditError = $data.error.code
>   } | ConvertTo-Json -Compress
>   foreach ($entry in $data.vulnerabilities.PSObject.Properties) {
>     $v = $entry.Value
>     if ($v.severity -in @('moderate','high','critical')) {
>       [pscustomobject]@{
>         Dependency = $entry.Name
>         Severity = $v.severity
>         Direct = $v.isDirect
>         Range = $v.range
>         FixAvailable = if ($v.fixAvailable -is [bool]) { $v.fixAvailable } else { $v.fixAvailable.version }
>         Via = (($v.via | ForEach-Object { if ($_ -is [string]) { $_ } else { "$($_.title) [$($_.url)]" } }) -join ' | ')
>       } | ConvertTo-Json -Compress
>     }
>   }
> } catch {
>   [pscustomobject]@{ParseError=$_.Exception.Message} | ConvertTo-Json -Compress
> }`
> - Ran `$raw = npm audit --omit=dev --json 2>$null
> try {
>   $data = $raw | ConvertFrom-Json
>   $meta = $data.metadata.vulnerabilities
>   [pscustomobject]@{
>     Info = $meta.info
>     Low = $meta.low
>     Moderate = $meta.moderate
>     High = $meta.high
>     Critical = $meta.critical
>     Total = $meta.total
>     AuditError = $data.error.code
>   } | ConvertTo-Json -Compress
>   foreach ($entry in $data.vulnerabilities.PSObject.Properties) {
>     $v = $entry.Value
>     if ($v.severity -in @('moderate','high','critical')) {
>       [pscustomobject]@{
>         Dependency = $entry.Name
>         Severity = $v.severity
>         Direct = $v.isDirect
>         Range = $v.range
>         FixAvailable = if ($v.fixAvailable -is [bool]) { $v.fixAvailable } else { $v.fixAvailable.version }
>         Via = (($v.via | ForEach-Object { if ($_ -is [string]) { $_ } else { "$($_.title) [$($_.url)]" } }) -join ' | ')
>       } | ConvertTo-Json -Compress
>     }
>   }
> } catch {
>   [pscustomobject]@{ParseError=$_.Exception.Message} | ConvertTo-Json -Compress
> }`
> - Ran `$raw = npm audit --omit=dev --json 2>$null
> try {
>   $data = $raw | ConvertFrom-Json
>   $meta = $data.metadata.vulnerabilities
>   [pscustomobject]@{
>     Info = $meta.info
>     Low = $meta.low
>     Moderate = $meta.moderate
>     High = $meta.high
>     Critical = $meta.critical
>     Total = $meta.total
>     AuditError = $data.error.code
>   } | ConvertTo-Json -Compress
>   foreach ($entry in $data.vulnerabilities.PSObject.Properties) {
>     $v = $entry.Value
>     if ($v.severity -in @('moderate','high','critical')) {
>       [pscustomobject]@{
>         Dependency = $entry.Name
>         Severity = $v.severity
>         Direct = $v.isDirect
>         Range = $v.range
>         FixAvailable = if ($v.fixAvailable -is [bool]) { $v.fixAvailable } else { $v.fixAvailable.version }
>         Via = (($v.via | ForEach-Object { if ($_ -is [string]) { $_ } else { "$($_.title) [$($_.url)]" } }) -join ' | ')
>       } | ConvertTo-Json -Compress
>     }
>   }
> } catch {
>   [pscustomobject]@{ParseError=$_.Exception.Message} | ConvertTo-Json -Compress
> }`
> - Ran `$raw = npm audit --omit=dev --json 2>$null
> try {
>   $data = $raw | ConvertFrom-Json
>   $meta = $data.metadata.vulnerabilities
>   [pscustomobject]@{
>     Info = $meta.info
>     Low = $meta.low
>     Moderate = $meta.moderate
>     High = $meta.high
>     Critical = $meta.critical
>     Total = $meta.total
>     AuditError = $data.error.code
>   } | ConvertTo-Json -Compress
>   foreach ($entry in $data.vulnerabilities.PSObject.Properties) {
>     $v = $entry.Value
>     if ($v.severity -in @('moderate','high','critical')) {
>       [pscustomobject]@{
>         Dependency = $entry.Name
>         Severity = $v.severity
>         Direct = $v.isDirect
>         Range = $v.range
>         FixAvailable = if ($v.fixAvailable -is [bool]) { $v.fixAvailable } else { $v.fixAvailable.version }
>         Via = (($v.via | ForEach-Object { if ($_ -is [string]) { $_ } else { "$($_.title) [$($_.url)]" } }) -join ' | ')
>       } | ConvertTo-Json -Compress
>     }
>   }
> } catch {
>   [pscustomobject]@{ParseError=$_.Exception.Message} | ConvertTo-Json -Compress
> }`
> - Ran `$raw = npm audit --omit=dev --json 2>$null
> try {
>   $data = $raw | ConvertFrom-Json
>   $meta = $data.metadata.vulnerabilities
>   [pscustomobject]@{
>     Info = $meta.info
>     Low = $meta.low
>     Moderate = $meta.moderate
>     High = $meta.high
>     Critical = $meta.critical
>     Total = $meta.total
>     AuditError = $data.error.code
>   } | ConvertTo-Json -Compress
>   foreach ($entry in $data.vulnerabilities.PSObject.Properties) {
>     $v = $entry.Value
>     if ($v.severity -in @('moderate','high','critical')) {
>       [pscustomobject]@{
>         Dependency = $entry.Name
>         Severity = $v.severity
>         Direct = $v.isDirect
>         Range = $v.range
>         FixAvailable = if ($v.fixAvailable -is [bool]) { $v.fixAvailable } else { $v.fixAvailable.version }
>         Via = (($v.via | ForEach-Object { if ($_ -is [string]) { $_ } else { "$($_.title) [$($_.url)]" } }) -join ' | ')
>       } | ConvertTo-Json -Compress
>     }
>   }
> } catch {
>   [pscustomobject]@{ParseError=$_.Exception.Message} | ConvertTo-Json -Compress
> }`
> - Ran `$raw = npm audit --omit=dev --json 2>$null
> try {
>   $data = $raw | ConvertFrom-Json
>   $meta = $data.metadata.vulnerabilities
>   [pscustomobject]@{
>     Info = $meta.info
>     Low = $meta.low
>     Moderate = $meta.moderate
>     High = $meta.high
>     Critical = $meta.critical
>     Total = $meta.total
>     AuditError = $data.error.code
>   } | ConvertTo-Json -Compress
>   foreach ($entry in $data.vulnerabilities.PSObject.Properties) {
>     $v = $entry.Value
>     if ($v.severity -in @('moderate','high','critical')) {
>       [pscustomobject]@{
>         Dependency = $entry.Name
>         Severity = $v.severity
>         Direct = $v.isDirect
>         Range = $v.range
>         FixAvailable = if ($v.fixAvailable -is [bool]) { $v.fixAvailable } else { $v.fixAvailable.version }
>         Via = (($v.via | ForEach-Object { if ($_ -is [string]) { $_ } else { "$($_.title) [$($_.url)]" } }) -join ' | ')
>       } | ConvertTo-Json -Compress
>     }
>   }
> } catch {
>   [pscustomobject]@{ParseError=$_.Exception.Message} | ConvertTo-Json -Compress
> }`
> - Ran `$raw = npm audit --omit=dev --json 2>$null
> try {
>   $data = $raw | ConvertFrom-Json
>   $meta = $data.metadata.vulnerabilities
>   [pscustomobject]@{
>     Info = $meta.info
>     Low = $meta.low
>     Moderate = $meta.moderate
>     High = $meta.high
>     Critical = $meta.critical
>     Total = $meta.total
>     AuditError = $data.error.code
>   } | ConvertTo-Json -Compress
>   foreach ($entry in $data.vulnerabilities.PSObject.Properties) {
>     $v = $entry.Value
>     if ($v.severity -in @('moderate','high','critical')) {
>       [pscustomobject]@{
>         Dependency = $entry.Name
>         Severity = $v.severity
>         Direct = $v.isDirect
>         Range = $v.range
>         FixAvailable = if ($v.fixAvailable -is [bool]) { $v.fixAvailable } else { $v.fixAvailable.version }
>         Via = (($v.via | ForEach-Object { if ($_ -is [string]) { $_ } else { "$($_.title) [$($_.url)]" } }) -join ' | ')
>       } | ConvertTo-Json -Compress
>     }
>   }
> } catch {
>   [pscustomobject]@{ParseError=$_.Exception.Message} | ConvertTo-Json -Compress
> }`
> - Ran `$raw = npm audit --omit=dev --json 2>$null
> try {
>   $data = $raw | ConvertFrom-Json
>   $meta = $data.metadata.vulnerabilities
>   [pscustomobject]@{
>     Info = $meta.info
>     Low = $meta.low
>     Moderate = $meta.moderate
>     High = $meta.high
>     Critical = $meta.critical
>     Total = $meta.total
>     AuditError = $data.error.code
>   } | ConvertTo-Json -Compress
>   foreach ($entry in $data.vulnerabilities.PSObject.Properties) {
>     $v = $entry.Value
>     if ($v.severity -in @('moderate','high','critical')) {
>       [pscustomobject]@{
>         Dependency = $entry.Name
>         Severity = $v.severity
>         Direct = $v.isDirect
>         Range = $v.range
>         FixAvailable = if ($v.fixAvailable -is [bool]) { $v.fixAvailable } else { $v.fixAvailable.version }
>         Via = (($v.via | ForEach-Object { if ($_ -is [string]) { $_ } else { "$($_.title) [$($_.url)]" } }) -join ' | ')
>       } | ConvertTo-Json -Compress
>     }
>   }
> } catch {
>   [pscustomobject]@{ParseError=$_.Exception.Message} | ConvertTo-Json -Compress
> }`
> - Ran `$files=@('website/package.json','phone_app/package.json','cloudrun-api/package.json','cloudrun-tax/package.json','cloudrun-pdf/package.json','cloudrun-archiver/package.json','packages/db/package.json'); foreach($file in $files){$p=Get-Content -LiteralPath $file -Raw|ConvertFrom-Json; Write-Output "FILE $file"; $p.dependencies.PSObject.Properties|Sort-Object Name|ForEach-Object{"  $($_.Name): $($_.Value)"}; if($file -match 'pdf|archiver|packages/db'){Write-Output 'DEV';$p.devDependencies.PSObject.Properties|Sort-Object Name|ForEach-Object{"  $($_.Name): $($_.Value)"}}}`
> - Ran `npm ls next postcss --all --depth=3`
> - Ran `npm ls expo uuid xcode --all --depth=6`
> - Ran `npm ls express qs basic-ftp get-uri uuid gaxios --all --depth=6`
> - Ran `npm ls @google-cloud/storage fast-xml-parser uuid gaxios retry-request teeny-request --all --depth=6`
> - Ran `npm ls drizzle-orm --all --depth=2`
> - Ran ``rg -n "identifier\(|sql\.identifier|sql\.raw|sql`|drizzle\(|from 'drizzle-orm'|from \"drizzle-orm\"" packages/db cloudrun-api cloudrun-archiver --glob '!dist/**' --glob '!node_modules/**'``
> - Ran `$files=@('cloudrun-pdf/package.json','cloudrun-archiver/package.json','website/package.json','phone_app/package.json','packages/db/package.json'); foreach($file in $files){$p=Get-Content -LiteralPath $file -Raw|ConvertFrom-Json; Write-Output "FILE $file"; $p.overrides|ConvertTo-Json -Depth 5; $p.scripts|ConvertTo-Json -Depth 3}`
> - Ran `rg -n "page\.|goto\(|setContent|fetch\(|logo|request|URL|image" cloudrun-pdf --glob '!dist/**' --glob '!node_modules/**' | Select-Object -First 300`
> - Ran `rg --files phone_app/components phone_app/modules phone_app/app | rg "(Button|Modal|Input|Layout|Navigation|Screen|Theme).*\.tsx$" | Select-Object -First 100; rg -n "export (function|const) .*Button|function .*Modal|<Modal|<Pressable|<TouchableOpacity" phone_app/components phone_app/modules phone_app/app --glob '*.tsx' | Select-Object -First 250`
> - Ran `$targets=@('phone_app/components/primitives/AppButton.tsx','phone_app/components/primitives/AppInput.tsx','phone_app/components/feedback/CustomAlert.tsx','phone_app/modules/jobs/screens/ManageJobs.tsx','phone_app/modules/inventory/screens/WorkerInventory.tsx','phone_app/modules/documents/screens/DocumentHistory.tsx'); foreach($file in $targets){Write-Output "FILE $file";$lines=Get-Content -LiteralPath $file;for($i=0;$i -lt $lines.Count;$i++){if(($file -like '*AppButton*') -or ($file -like '*AppInput*') -or ($file -like '*CustomAlert*' -and $i -ge 130 -and $i -lt 230) -or ($file -like '*ManageJobs*' -and (($i -ge 50 -and $i -lt 90) -or ($i -ge 450 -and $i -lt 485))) -or ($file -like '*WorkerInventory*' -and $i -ge 95 -and $i -lt 205) -or ($file -like '*DocumentHistory*' -and $i -ge 115 -and $i -lt 185)){'{0,5}: {1}' -f ($i+1),$lines[$i]}}}`
> - Ran `rg -n --glob '*.ts' --glob '*.tsx' "Ã|Â|â€|âœ|â|âš|ðŸ|×[A-Za-z]|Ù" phone_app website cloudrun-pdf cloudrun-archiver cloudrun-api cloudrun-tax packages supabase | Select-Object -First 400`
> - Ran `rg -l --glob '*.ts' --glob '*.tsx' "×|Ø|Ù|â|ðŸ|Â" phone_app | Sort-Object; rg -n --glob '*.ts' --glob '*.tsx' "×|Ø|Ù|â|ðŸ|Â" phone_app | Measure-Object | Select-Object -ExpandProperty Count`
> - Ran `$roots=@('phone_app/modules','phone_app/components','website/src','cloudrun-api/src','cloudrun-tax/src','cloudrun-pdf','cloudrun-archiver','packages/db','supabase/handlers'); foreach($root in $roots){Write-Output "ROOT $root"; Get-ChildItem -LiteralPath $root -Recurse -File -Include *.ts,*.tsx,*.js,*.mjs | Where-Object {$_.FullName -notmatch '\\(node_modules|dist)\\'} | ForEach-Object {[pscustomobject]@{Lines=(Get-Content -LiteralPath $_.FullName).Count; Path=$_.FullName.Substring((Get-Location).Path.Length+1)}} | Sort-Object Lines -Descending | Select-Object -First 8 | Format-Table -AutoSize}`
> - Ran `rg --files website/src/app website/src/lib website/src/components | Sort-Object | Select-Object -First 250; rg -n "use client|fetch\(|cookies\(|headers\(|Origin|csrf|revalidate|cache\(|unstable_cache|no-store|force-dynamic|redirect\(" website/src --glob '*.ts' --glob '*.tsx' | Select-Object -First 500`
> - Ran `$files=@('website/src/lib/dal/session.ts','website/src/lib/backend/transport-core.ts','cloudrun-api/src/web-sessions/service.ts','cloudrun-api/src/web-sessions/repository.ts','cloudrun-api/src/web-sessions/routes.ts'); foreach($file in $files){if(Test-Path -LiteralPath $file){Write-Output "FILE $file";$lines=Get-Content -LiteralPath $file;for($i=0;$i -lt $lines.Count;$i++){'{0,5}: {1}' -f ($i+1),$lines[$i]}}}`
> - Ran `$files=@('website/src/lib/auth/server-supabase.ts','website/src/app/api/auth/register/route.ts','website/src/app/api/auth/forgot-password/route.ts','website/src/app/api/auth/login/route.ts','website/src/lib/contact/challenge.ts','website/src/lib/contact/contact-request-route-core.ts','cloudrun-api/src/routes/contact-requests.ts','packages/db/migrations/0017_api_upgrade_and_contact_requests.sql'); foreach($file in $files){if(Test-Path -LiteralPath $file){Write-Output "FILE $file";$lines=Get-Content -LiteralPath $file;for($i=0;$i -lt $lines.Count;$i++){if($file -like '*0017*'){if(($i -ge 430 -and $i -lt 590)){'{0,5}: {1}' -f ($i+1),$lines[$i]}}else{'{0,5}: {1}' -f ($i+1),$lines[$i]}}}}`
> - Ran `$patterns=@('process\.env\.([A-Z][A-Z0-9_]*)','process\.env\[\s*["'']([A-Z][A-Z0-9_]*)["'']\s*\]','Deno\.env\.get\(["'']([A-Z][A-Z0-9_]*)["'']\)'); $roots=@('website','phone_app','cloudrun-api','cloudrun-tax','cloudrun-pdf','cloudrun-archiver','packages','supabase'); foreach($root in $roots){$vars=New-Object System.Collections.Generic.HashSet[string]; Get-ChildItem -LiteralPath $root -Recurse -File -Include *.ts,*.tsx,*.js,*.mjs | Where-Object {$_.FullName -notmatch '\\(node_modules|dist)\\'} | ForEach-Object {$text=[IO.File]::ReadAllText($_.FullName); foreach($pattern in $patterns){foreach($match in [regex]::Matches($text,$pattern)){[void]$vars.Add($match.Groups[1].Value)}}}; Write-Output "ROOT $root"; $vars|Sort-Object}`
> - Ran ``rg -n "^[A-Z][A-Z0-9_]+=?|`[A-Z][A-Z0-9_]+`|[A-Z][A-Z0-9_]+=" README.md SETUP.md PROJECT_SUMMARY.md backend.md architecture.md cloudrun-api/README.md cloudrun-tax/README.md cloudrun-pdf/README.md cloudrun-archiver/README.md website/README.md phone_app/README.md supabase/README.md 2>$null | Select-Object -First 600``
> - Ran `Get-ChildItem -LiteralPath cloudrun-pdf -Force | Select-Object Name,Length; Get-ChildItem -LiteralPath cloudrun-archiver -Force | Select-Object Name,Length; rg -n "cloudrun-pdf|cloudrun-archiver|CLOUD_RUN_SERVICE_URL|PUBSUB_ALLOWED_SERVICE_ACCOUNTS|ARCHIVE_BUCKET|SMART_JOB_PERSISTENCE_BACKEND|AWS_REGION|DOCUMENT_PUBSUB" README.md SETUP.md PROJECT_SUMMARY.md backend.md architecture.md .github/workflows/cloudrun-deploy.yml`
> - Ran `$file='SETUP.md'; $lines=Get-Content -LiteralPath $file; foreach($range in @(@(210,285),@(485,610))){for($i=$range[0]-1;$i -lt [Math]::Min($lines.Count,$range[1]);$i++){'{0,5}: {1}' -f ($i+1),$lines[$i]}}`
> - Ran `$file='cloudrun-archiver/index.ts'; $lines=Get-Content -LiteralPath $file; foreach($range in @(@(90,210),@(210,430),@(430,620))){for($i=$range[0]-1;$i -lt [Math]::Min($lines.Count,$range[1]);$i++){'{0,5}: {1}' -f ($i+1),$lines[$i]}}`
> - Ran `$file='packages/db/archive.ts'; $lines=Get-Content -LiteralPath $file; for($i=0;$i -lt $lines.Count;$i++){'{0,5}: {1}' -f ($i+1),$lines[$i]}; $file='cloudrun-archiver/index.ts'; $lines=Get-Content -LiteralPath $file; for($i=615;$i -lt [Math]::Min($lines.Count,683);$i++){'{0,5}: {1}' -f ($i+1),$lines[$i]}`
> - Ran `rg -n "job_part_usages|job_attachments|inventory_movements|documents.*job|REFERENCES public\.jobs|references\(\(\) => jobs" packages/db/schema.ts packages/db/migrations/0000_optimized_baseline.sql | Select-Object -First 250`
> - Ran `$roots=@('website','phone_app','cloudrun-api','cloudrun-tax','cloudrun-pdf','cloudrun-archiver','packages/contracts','packages/api-contracts','packages/db','supabase'); foreach($root in $roots){$files=Get-ChildItem -LiteralPath $root -Recurse -File -Include *.test.ts,*.test.tsx,*.test.mts,*.test.mjs,*.test.js,*.spec.ts,*.spec.tsx | Where-Object {$_.FullName -notmatch '\\(node_modules|dist)\\'}; $tests=0; foreach($file in $files){$text=[IO.File]::ReadAllText($file.FullName);$tests+=([regex]::Matches($text,'(?m)^\s*(test|it)\s*\(')).Count}; [pscustomobject]@{Root=$root;Files=$files.Count;TestBlocks=$tests;Lines=($files|ForEach-Object{(Get-Content -LiteralPath $_.FullName).Count}|Measure-Object -Sum).Sum}} | Format-Table -AutoSize; Write-Output 'FILES'; rg --files website phone_app cloudrun-api cloudrun-tax cloudrun-pdf cloudrun-archiver packages supabase | rg '(test|spec)\.(ts|tsx|mts|mjs|js)$' | Sort-Object`
> - Ran `$rows=@(); $roots=@('website','phone_app','cloudrun-api','cloudrun-tax','cloudrun-pdf','cloudrun-archiver','packages/contracts','packages/api-contracts','packages/db','supabase'); foreach($root in $roots){$files=Get-ChildItem -LiteralPath $root -Recurse -File -Include *.test.ts,*.test.tsx,*.test.mts,*.test.mjs,*.test.js,*.spec.ts,*.spec.tsx | Where-Object {$_.FullName -notmatch '\\(node_modules|dist)\\'}; $tests=0;$lineTotal=0; foreach($file in $files){$text=[IO.File]::ReadAllText($file.FullName);$tests+=([regex]::Matches($text,'(?m)^\s*(test|it)\s*\(')).Count;$lineTotal+=(Get-Content -LiteralPath $file.FullName).Count};$rows += [pscustomobject]@{Root=$root;Files=$files.Count;TestBlocks=$tests;Lines=$lineTotal}}; $rows|Format-Table -AutoSize; Write-Output 'FILES'; rg --files website phone_app cloudrun-api cloudrun-tax cloudrun-pdf cloudrun-archiver packages supabase | rg '(test|spec)\.(ts|tsx|mts|mjs|js)$' | Sort-Object`
> - Ran `$rows=@(); $all=@(); $roots=@('website','phone_app','cloudrun-api','cloudrun-tax','cloudrun-pdf','cloudrun-archiver','packages/contracts','packages/api-contracts','packages/db','supabase'); foreach($root in $roots){$files=Get-ChildItem -LiteralPath $root -Recurse -File | Where-Object {$_.Name -match '(test|spec)\.(ts|tsx|mts|mjs|js)$' -and $_.FullName -notmatch '[\\/](node_modules|dist|\.next|build|coverage)[\\/]'};$tests=0;$lineTotal=0; foreach($file in $files){$text=[IO.File]::ReadAllText($file.FullName);$tests+=([regex]::Matches($text,'(?m)^\s*(test|it)\s*\(')).Count;$lineTotal+=(Get-Content -LiteralPath $file.FullName).Count;$all += $file.FullName.Substring((Get-Location).Path.Length+1)};$rows += [pscustomobject]@{Root=$root;Files=$files.Count;TestBlocks=$tests;Lines=$lineTotal}}; $rows|Format-Table -AutoSize; Write-Output 'FILES'; $all|Sort-Object`
> - Ran `$file='.github/workflows/ci.yml'; $lines=Get-Content -LiteralPath $file; for($i=0;$i -lt $lines.Count;$i++){'{0,5}: {1}' -f ($i+1),$lines[$i]}`
> - Ran `$file='.github/workflows/cloudrun-deploy.yml'; $lines=Get-Content -LiteralPath $file; for($i=0;$i -lt $lines.Count;$i++){'{0,5}: {1}' -f ($i+1),$lines[$i]}`
> - Ran `$files=@('cloudrun-api/Dockerfile','cloudrun-tax/Dockerfile','cloudrun-pdf/Dockerfile','cloudrun-archiver/Dockerfile','.dockerignore','cloudrun-api/.dockerignore','cloudrun-tax/.dockerignore','cloudrun-pdf/.dockerignore','cloudrun-archiver/.dockerignore','phone_app/eas.json','phone_app/app.json'); foreach($file in $files){if(Test-Path -LiteralPath $file){Write-Output "FILE $file";$lines=Get-Content -LiteralPath $file;for($i=0;$i -lt $lines.Count;$i++){'{0,5}: {1}' -f ($i+1),$lines[$i]}}}`
> - Ran `git ls-files --stage -- phone_app/google-services.json phone_app/GoogleService-Info.plist; rg -n "google-services\.json|GoogleService-Info\.plist|\.env" .gitignore phone_app/.gitignore README.md SETUP.md PROJECT_SUMMARY.md AGENTS.md | Select-Object -First 100; git status --short -- phone_app/google-services.json phone_app/GoogleService-Info.plist`
>
> </details>
>
> The live lockfile audit found no critical advisories, but it did find production high-severity advisories in `@smart-job/db` and `cloudrun-pdf`. The PDF package also overrides two transitive packages to versions the audit flags, so this is a concrete release-maintenance issue rather than a generic “dependencies may be old” warning. I’m now separating reachable risk from scanner-only exposure and completing the secret/config hygiene pass.
>
> <details><summary>Ran 21 commands, searched the web</summary>
>
> - Ran `$checks=@(
>   @{Type='Private-key material';Pattern='-----BEGIN (RSA |EC |OPENSSH )?PRIVATE KEY-----'},
>   @{Type='Google API key-shaped value';Pattern='AIza[0-9A-Za-z_-]{30,}'},
>   @{Type='Supabase secret key-shaped value';Pattern='sb_secret_[0-9A-Za-z_-]+'},
>   @{Type='AWS access key-shaped value';Pattern='AKIA[0-9A-Z]{16}'},
>   @{Type='GitHub token-shaped value';Pattern='gh[pousr]_[0-9A-Za-z]{20,}'},
>   @{Type='Database URL with embedded credential';Pattern='postgres(ql)?://[^[:space:]@:/]+:[^[:space:]@]+@'}
> ); foreach($check in $checks){Write-Output "TYPE $($check.Type)"; git grep -Il -E -- $check.Pattern 2>$null | Where-Object {$_ -notmatch 'package-lock\.json$'} | Sort-Object -Unique}`
>
> - Ran `rg -n "BEGIN .*PRIVATE KEY|PRIVATE KEY" supabase/shared-edge-helpers.ts; git diff --check; node scripts/check-no-ts-nocheck.mjs; node scripts/check-js-syntax.mjs scripts`
>
> - Ran `Get-ChildItem -LiteralPath scripts -File | Select-Object Name,Length; $file='scripts/check-js-syntax.mjs'; $lines=Get-Content -LiteralPath $file; for($i=0;$i -lt $lines.Count;$i++){'{0,5}: {1}' -f ($i+1),$lines[$i]}`
>
> - Ran `node scripts/check-perf-budget.mjs`
>
> - Ran `$file='scripts/check-perf-budget.mjs'; $lines=Get-Content -LiteralPath $file; for($i=0;$i -lt $lines.Count;$i++){'{0,5}: {1}' -f ($i+1),$lines[$i]}`
>
> - Ran `npm test`
>
> - Ran `npm test`
>
> - Ran `npm test`
>
> - Ran `git status --short -- packages/api-contracts; git diff -- packages/api-contracts; git diff --cached --stat -- packages/api-contracts`
>
> - Ran `rg -n "document mutation idempotency|document composer|idempotency.*document|upload.*idempotency|job-attachments/sessions|StableDocumentActionKeys|complete\(" website/tests phone_app/tests cloudrun-api/src/tests packages/db/tests cloudrun-pdf/tests; rg -n "document-create-control|useDocumentTask|processor\.ts|create upload" website/tests phone_app/tests`
>
> - Ran `$files=@('website/tests/document-mutation-route.test.mts','website/tests/tenant-document-mutations-source.test.mts','phone_app/tests/documents-api-model.test.mts','phone_app/tests/document-task-poll.test.mts','phone_app/tests/mobile-foundation-source.test.mts','phone_app/tests/pending-work-source.test.mts'); foreach($file in $files){Write-Output "FILE $file";$lines=Get-Content -LiteralPath $file;for($i=0;$i -lt $lines.Count;$i++){if(($file -like '*document-mutation-route*' -and $i -ge 60 -and $i -lt 100) -or ($file -like '*tenant-document*') -or ($file -like '*documents-api-model*' -and $i -ge 115 -and $i -lt 215) -or ($file -like '*document-task-poll*') -or ($file -like '*mobile-foundation*') -or ($file -like '*pending-work-source*' -and $i -lt 70)){'{0,5}: {1}' -f ($i+1),$lines[$i]}}}`
>
> - Ran `$files=@('packages/db/migrations/0022_api_document_tasks.sql','cloudrun-api/src/documents/dispatch-repository.ts','cloudrun-api/src/documents/pubsub-publisher.ts','cloudrun-api/src/tests/document-dispatch.test.ts','cloudrun-pdf/access-store.ts','cloudrun-pdf/index.ts','cloudrun-pdf/tests/security-source.test.js'); foreach($file in $files){if(Test-Path -LiteralPath $file){Write-Output "FILE $file";$lines=Get-Content -LiteralPath $file;for($i=0;$i -lt $lines.Count;$i++){if(($file -like '*0022*' -and (($i -ge 350 -and $i -lt 410) -or ($i -ge 500 -and $i -lt 535))) -or ($file -like '*dispatch-repository*') -or ($file -like '*pubsub-publisher*') -or ($file -like '*document-dispatch.test*' -and $i -lt 150) -or ($file -like '*access-store*') -or ($file -like '*index.ts' -and (($i -ge 175 -and $i -lt 215) -or ($i -ge 345 -and $i -lt 380))) -or ($file -like '*security-source*')){'{0,5}: {1}' -f ($i+1),$lines[$i]}}}}`
>
> - Ran `$files=@('cloudrun-pdf/index.ts','cloudrun-pdf/persistence.ts','cloudrun-pdf/sql-store.ts','cloudrun-archiver/upload-cleanup.ts','cloudrun-api/src/runtime-config.ts','cloudrun-api/src/routes/documents-mutations.ts'); foreach($file in $files){Write-Output "FILE $file";$lines=Get-Content -LiteralPath $file;for($i=0;$i -lt $lines.Count;$i++){if(($file -like '*cloudrun-pdf/index*' -and (($i -ge 50 -and $i -lt 175) -or ($i -ge 640 -and $i -lt 680))) -or ($file -like '*persistence*') -or ($file -like '*sql-store*') -or ($file -like '*upload-cleanup*' -and $i -lt 120) -or ($file -like '*runtime-config*' -and (($i -ge 50 -and $i -lt 105) -or ($i -ge 365 -and $i -lt 405))) -or ($file -like '*documents-mutations*' -and $i -ge 120 -and $i -lt 165)){'{0,5}: {1}' -f ($i+1),$lines[$i]}}}`
>
> - Ran `$files=@('cloudrun-pdf/task-store.ts','cloudrun-pdf/index.ts','cloudrun-pdf/emailService.ts'); foreach($file in $files){Write-Output "FILE $file";$lines=Get-Content -LiteralPath $file;for($i=0;$i -lt $lines.Count;$i++){if(($file -like '*task-store*') -or ($file -like '*index.ts' -and $i -ge 475 -and $i -lt 615) -or ($file -like '*emailService*' -and (($i -ge 90 -and $i -lt 155) -or ($i -ge 350 -and $i -lt 415)))){'{0,5}: {1}' -f ($i+1),$lines[$i]}}}`
>
> - Ran `rg -n "Ã|Â|â€|âœ|â|âš|ðŸ|Ø|Ù|×" cloudrun-pdf cloudrun-archiver phone_app --glob '*.ts' --glob '*.tsx' --glob '*.js' --glob '!dist/**'`
>
> - Ran `rg -n "constructor|AWS_REGION|AWS_ACCESS_KEY_ID|AWS_SECRET_ACCESS_KEY|enabled" cloudrun-pdf/emailService.ts | Select-Object -First 80`
>
> - Ran `rg -n --glob '!node_modules/**' --glob '!dist/**' "tax/approval|TAX_APPROVAL|bind_api_tax_approval|process_api_tax_callback|taxAuthorityCallbackV1|getInvoiceApproval" . | Select-Object -First 400`
>
> - Ran `rg -n "taxApprovalUrl|TAX_APPROVAL_URL" supabase --glob '*.ts'; rg -n "authority|oauth|approval" supabase/handlers/tax.ts`
>
> - Ran `$files=@('cloudrun-pdf/routes/preview-route.ts','cloudrun-pdf/routes/generate-route.ts','cloudrun-pdf/pubsub-auth.ts','cloudrun-pdf/index.ts'); foreach($file in $files){if(Test-Path -LiteralPath $file){Write-Output "FILE $file";$lines=Get-Content -LiteralPath $file;for($i=0;$i -lt $lines.Count;$i++){if($file -notlike '*index.ts' -or $i -lt 52){'{0,5}: {1}' -f ($i+1),$lines[$i]}}}}`
>
> - Ran `Get-ChildItem cloudrun-pdf/routes -File | Select-Object Name; $files=Get-ChildItem cloudrun-pdf/routes -File; foreach($f in $files){Write-Output "FILE $($f.FullName.Substring((Get-Location).Path.Length+1))";$lines=Get-Content -LiteralPath $f.FullName;for($i=0;$i -lt $lines.Count;$i++){'{0,5}: {1}' -f ($i+1),$lines[$i]}}`
>
> - Ran `$file='cloudrun-pdf/browser-pool.ts'; $lines=Get-Content -LiteralPath $file; for($i=0;$i -lt $lines.Count;$i++){if($i -lt 75 -or $i -ge 160){'{0,5}: {1}' -f ($i+1),$lines[$i]}}`
>
> <details><summary>Searched the web</summary>
>
> - Searched the web for `site:github.com/advisories GHSA-gpj5-g38j-94v9 Drizzle ORM SQL injection identifier ...`
> - Searched the web for `https://github.com/advisories/GHSA-gpj5-g38j-94v9`
>
> </details>
>
> </details>
>
> Context compaction
>
> Source: automatic
> Status: completed
>
> The main release blockers are now clear. I’m doing a final evidence pass on the exact SQL, task-dispatch, deployment, and test-coverage references, then I’ll deliver the read-only audit with confirmed defects separated from conditional risks.
>
> <details><summary>Ran 34 commands</summary>
>
> - Ran `git status --short`
> - Ran `rg -n -C 3 'Tax Authority approved|getInvoiceApproval|status: "reserved"|NOT_IMPLEMENTED|not implemented' phone_app/modules/documents/hooks/useTaxInvoiceSubmission.ts phone_app/modules/documents/screens/CreateDocument.tsx supabase/handlers/tax.ts`
> - Ran `rg -n -C 3 'companyId.*payload|Requester company mismatch|String\(.*company|access\.companyId|task\.companyId' packages/db/migrations/0022_api_document_tasks.sql cloudrun-api/src/tests/document-dispatch.test.ts cloudrun-pdf/index.ts cloudrun-pdf/access-store.ts`
> - Ran `rg -n -C 2 'CLOUD_RUN_SERVICE_URL|PUBSUB_ALLOWED_SERVICE_ACCOUNTS|SMART_JOB_PERSISTENCE_BACKEND|ARCHIVE_BUCKET|DOCUMENT_PUBSUB_PROJECT_ID|DOCUMENT_PREVIEW_TOPIC|DOCUMENT_GENERATE_TOPIC' .github/workflows/cloudrun-deploy.yml cloudrun-pdf/index.ts cloudrun-pdf/persistence.ts cloudrun-archiver/index.ts cloudrun-api/src/runtime-config.ts cloudrun-api/src/routes/documents-mutations.ts`
> - Ran `rg -n -C 3 'accept_api_job|apply_job_inventory_consumption_batch|job_part_usages' packages/db/migrations/0021_api_job_mutations.sql packages/db/migrations/0007_api_job_creation_and_storage.sql packages/db/jobs.ts`
> - Ran `rg -n -C 3 'upload-sessions|Idempotency-Key|idempotencyKey' phone_app/lib/outbox/processor.ts cloudrun-api/src/routes/upload-sessions.ts`
> - Ran `rg -n -C 3 'actionKeys\.complete|stableKey|safely retry|try again|timed out|accepted' website/src/components/documents/document-create-control.tsx phone_app/hooks/useDocumentTask.ts phone_app/modules/documents/lib/document-action-keys.ts`
> - Ran `Get-ChildItem packages/db/migrations/meta | Select-Object Name; rg -n '0024|0012' packages/db/migrations/meta/_journal.json`
> - Ran `$content = Get-Content -LiteralPath 'packages/db/migrations/0022_api_document_tasks.sql'; for ($line = 350; $line -le [Math]::Min(535, $content.Count); $line++) { '{0}:{1}' -f $line, $content[$line - 1] }`
> - Ran `$content = Get-Content -LiteralPath '.github/workflows/cloudrun-deploy.yml'; for ($line = 45; $line -le [Math]::Min(220, $content.Count); $line++) { '{0}:{1}' -f $line, $content[$line - 1] }`
> - Ran `$content = Get-Content -LiteralPath 'packages/db/migrations/0021_api_job_mutations.sql'; for ($line = 445; $line -le [Math]::Min(540, $content.Count); $line++) { '{0}:{1}' -f $line, $content[$line - 1] }`
> - Ran `$content = Get-Content -LiteralPath 'supabase/handlers/tax.ts'; for ($line = 125; $line -le [Math]::Min(308, $content.Count); $line++) { '{0}:{1}' -f $line, $content[$line - 1] }`
> - Ran `$content = Get-Content -LiteralPath 'cloudrun-pdf/index.ts'; for ($line = 475; $line -le [Math]::Min(575, $content.Count); $line++) { '{0}:{1}' -f $line, $content[$line - 1] }`
> - Ran `$content = Get-Content -LiteralPath 'cloudrun-api/src/routes/upload-sessions.ts'; for ($line = 25; $line -le [Math]::Min(185, $content.Count); $line++) { '{0}:{1}' -f $line, $content[$line - 1] }`
> - Ran `$content = Get-Content -LiteralPath 'phone_app/lib/outbox/processor.ts'; for ($line = 90; $line -le [Math]::Min(135, $content.Count); $line++) { '{0}:{1}' -f $line, $content[$line - 1] }`
> - Ran `$content = Get-Content -LiteralPath 'cloudrun-api/src/tests/document-dispatch.test.ts'; for ($line = 30; $line -le [Math]::Min(140, $content.Count); $line++) { '{0}:{1}' -f $line, $content[$line - 1] }`
> - Ran `$content = Get-Content -LiteralPath '.github/workflows/cloudrun-deploy.yml'
> for ($line = 1; $line -le [Math]::Min(44, $content.Count); $line++) { '{0}:{1}' -f $line, $content[$line - 1] }
> for ($line = 154; $line -le [Math]::Min(180, $content.Count); $line++) { '{0}:{1}' -f $line, $content[$line - 1] }
> for ($line = 194; $line -le [Math]::Min(225, $content.Count); $line++) { '{0}:{1}' -f $line, $content[$line - 1] }
> for ($line = 226; $line -le [Math]::Min(270, $content.Count); $line++) { '{0}:{1}' -f $line, $content[$line - 1] }`
> - Ran `$content = Get-Content -LiteralPath 'packages/db/migrations/0021_api_job_mutations.sql'
> for ($line = 445; $line -le [Math]::Min(535, $content.Count); $line++) { '{0}:{1}' -f $line, $content[$line - 1] }`
> - Ran `$content = Get-Content -LiteralPath 'cloudrun-api/src/routes/documents-mutations.ts'
> for ($line = 120; $line -le [Math]::Min(160, $content.Count); $line++) { '{0}:{1}' -f $line, $content[$line - 1] }`
> - Ran `$content = Get-Content -LiteralPath 'cloudrun-pdf/task-store.ts'
> for ($line = 1; $line -le [Math]::Min(105, $content.Count); $line++) { '{0}:{1}' -f $line, $content[$line - 1] }`
> - Ran `$content = Get-Content -LiteralPath 'cloudrun-archiver/index.ts'
> for ($line = 145; $line -le [Math]::Min(195, $content.Count); $line++) { '{0}:{1}' -f $line, $content[$line - 1] }
> for ($line = 260; $line -le [Math]::Min(335, $content.Count); $line++) { '{0}:{1}' -f $line, $content[$line - 1] }
> for ($line = 445; $line -le [Math]::Min(480, $content.Count); $line++) { '{0}:{1}' -f $line, $content[$line - 1] }
> for ($line = 515; $line -le [Math]::Min(550, $content.Count); $line++) { '{0}:{1}' -f $line, $content[$line - 1] }`
> - Ran `$content = Get-Content -LiteralPath 'packages/db/archive.ts'
> for ($line = 90; $line -le [Math]::Min(165, $content.Count); $line++) { '{0}:{1}' -f $line, $content[$line - 1] }`
> - Ran `$content = Get-Content -LiteralPath 'scripts/check-js-syntax.mjs'
> for ($line = 1; $line -le [Math]::Min(60, $content.Count); $line++) { '{0}:{1}' -f $line, $content[$line - 1] }`
> - Ran `$content = Get-Content -LiteralPath 'scripts/check-perf-budget.mjs'
> for ($line = 80; $line -le [Math]::Min(145, $content.Count); $line++) { '{0}:{1}' -f $line, $content[$line - 1] }`
> - Ran `$content = Get-Content -LiteralPath 'cloudrun-pdf/index.ts'; for ($line = 140; $line -le [Math]::Min(212, $content.Count); $line++) { '{0}:{1}' -f $line, $content[$line - 1] }`
> - Ran `$content = Get-Content -LiteralPath 'cloudrun-pdf/index.ts'; for ($line = 340; $line -le [Math]::Min(378, $content.Count); $line++) { '{0}:{1}' -f $line, $content[$line - 1] }`
> - Ran `$content = Get-Content -LiteralPath 'cloudrun-pdf/task-store.ts'; for ($line = 105; $line -le [Math]::Min(190, $content.Count); $line++) { '{0}:{1}' -f $line, $content[$line - 1] }`
> - Ran `$content = Get-Content -LiteralPath 'cloudrun-pdf/emailService.ts'; for ($line = 65; $line -le [Math]::Min(135, $content.Count); $line++) { '{0}:{1}' -f $line, $content[$line - 1] }`
> - Ran `$content = Get-Content -LiteralPath 'cloudrun-api/src/runtime-config.ts'; for ($line = 360; $line -le [Math]::Min(398, $content.Count); $line++) { '{0}:{1}' -f $line, $content[$line - 1] }`
> - Ran `$content = Get-Content -LiteralPath 'cloudrun-api/src/app.ts'; for ($line = 150; $line -le [Math]::Min(230, $content.Count); $line++) { '{0}:{1}' -f $line, $content[$line - 1] }`
> - Ran `$content = Get-Content -LiteralPath '.github/workflows/ci.yml'; for ($line = 1; $line -le [Math]::Min(70, $content.Count); $line++) { '{0}:{1}' -f $line, $content[$line - 1] }`
> - Ran `$content = Get-Content -LiteralPath '.github/workflows/ci.yml'; for ($line = 220; $line -le [Math]::Min(340, $content.Count); $line++) { '{0}:{1}' -f $line, $content[$line - 1] }`
> - Ran `$content = Get-Content -LiteralPath 'packages/db/package.json'; for ($line = 1; $line -le [Math]::Min(70, $content.Count); $line++) { '{0}:{1}' -f $line, $content[$line - 1] }`
> - Ran `$content = Get-Content -LiteralPath 'cloudrun-pdf/package.json'; for ($line = 1; $line -le [Math]::Min(80, $content.Count); $line++) { '{0}:{1}' -f $line, $content[$line - 1] }`
>
> </details>
>
> The final evidence pass confirms these are not merely configuration hypotheses: the checked-in deploy workflow omits variables that the PDF and archiver processes require at module startup, and the API’s document dispatcher is intentionally optional, so accepted tasks can remain pending indefinitely. I’m now closing the audit around documentation drift, CI blind spots, and dependency reachability.
>
> <details><summary>Ran 28 commands</summary>
>
> - Ran `rg -n -C 2 'EXPO_PUBLIC_SUPABASE_ANON_KEY|EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY|EXPO_PUBLIC_BACKEND_API_BASE_URL|JWT_SECRET|CLOUD_RUN_SERVICE_URL|ARCHIVE_BUCKET|SMART_JOB_PERSISTENCE_BACKEND' SETUP.md phone_app/README.md website/README.md PROJECT_SUMMARY.md architecture.md backend.md`
> - Ran `rg -n -C 2 '/api/read-model|/api/callable|__session|client-side application|Firebase' website/README.md backend.md PROJECT_SUMMARY.md`
> - Ran `Get-ChildItem -Recurse -File -Include '.env.example','*.env.example' | ForEach-Object { $_.FullName }; git ls-files phone_app/google-services.json phone_app/GoogleService-Info.plist; rg -n 'google-services.json|GoogleService-Info.plist|\.env' .gitignore phone_app/.gitignore`
> - Ran `rg -n 'TODO|FIXME|HACK|XXX|not implemented|temporary|legacy|workaround|disabled until|not yet' --glob '!**/node_modules/**' --glob '!**/dist/**' --glob '!**/package-lock.json' --glob '!PLAN.md' --glob '!PROJECT_SUMMARY.md' .`
> - Ran `rg -n 'accessibilityRole|accessibilityLabel|accessibilityViewIsModal|aria-|role=|scope=' phone_app/components/feedback/CustomAlert.tsx phone_app/components/primitives/AppInput.tsx phone_app/modules/jobs/screens/ManageJobs.tsx phone_app/modules/inventory/screens/WorkerInventory.tsx website/src/components/ui/Modal.tsx website/src/components/ui/DataTable.tsx`
> - Ran `rg -n '"strict"' cloudrun-pdf/tsconfig.json cloudrun-archiver/tsconfig.json packages/db/tsconfig.json packages/contracts/tsconfig.json cloudrun-api/tsconfig.json cloudrun-tax/tsconfig.json packages/api-contracts/tsconfig.json website/tsconfig.json phone_app/tsconfig.json`
> - Ran `rg -n 'db_errors|access-token' --glob '!**/node_modules/**' --glob '!**/dist/**' .; git ls-files packages/db/db_errors.txt website/src/lib/auth/access-token.ts`
> - Ran `rg -n -C 2 'drizzle-orm|basic-ftp|postcss|uuid' packages/db/package-lock.json cloudrun-pdf/package-lock.json website/package-lock.json phone_app/package-lock.json | Select-Object -First 120`
> - Ran `$content = Get-Content -LiteralPath 'cloudrun-api/src/web-sessions/repository.ts'; for ($line = 60; $line -le [Math]::Min(95, $content.Count); $line++) { '{0}:{1}' -f $line, $content[$line - 1] }`
> - Ran `$content = Get-Content -LiteralPath 'cloudrun-api/src/web-sessions/service.ts'; for ($line = 175; $line -le [Math]::Min(255, $content.Count); $line++) { '{0}:{1}' -f $line, $content[$line - 1] }`
> - Ran `$content = Get-Content -LiteralPath 'cloudrun-api/src/web-sessions/service.ts'; for ($line = 360; $line -le [Math]::Min(390, $content.Count); $line++) { '{0}:{1}' -f $line, $content[$line - 1] }`
> - Ran `$content = Get-Content -LiteralPath 'website/src/lib/auth/server-supabase.ts'; for ($line = 35; $line -le [Math]::Min(145, $content.Count); $line++) { '{0}:{1}' -f $line, $content[$line - 1] }`
> - Ran `$content = Get-Content -LiteralPath 'website/src/lib/contact/challenge.ts'; for ($line = 1; $line -le [Math]::Min(45, $content.Count); $line++) { '{0}:{1}' -f $line, $content[$line - 1] }`
> - Ran `$content = Get-Content -LiteralPath 'cloudrun-api/src/routes/contact-requests.ts'; for ($line = 25; $line -le [Math]::Min(145, $content.Count); $line++) { '{0}:{1}' -f $line, $content[$line - 1] }`
> - Ran `$content = Get-Content -LiteralPath 'phone_app/lib/api/client.ts'; for ($line = 175; $line -le [Math]::Min(220, $content.Count); $line++) { '{0}:{1}' -f $line, $content[$line - 1] }`
> - Ran `$content = Get-Content -LiteralPath 'phone_app/firebase.ts'; for ($line = 155; $line -le [Math]::Min(215, $content.Count); $line++) { '{0}:{1}' -f $line, $content[$line - 1] }`
> - Ran `$content = Get-Content -LiteralPath 'website/src/components/ui/Modal.tsx'; for ($line = 1; $line -le [Math]::Min(75, $content.Count); $line++) { '{0}:{1}' -f $line, $content[$line - 1] }`
> - Ran `$content = Get-Content -LiteralPath 'phone_app/components/feedback/CustomAlert.tsx'; for ($line = 140; $line -le [Math]::Min(240, $content.Count); $line++) { '{0}:{1}' -f $line, $content[$line - 1] }`
> - Ran `$content = Get-Content -LiteralPath 'phone_app/components/primitives/AppInput.tsx'; for ($line = 60; $line -le [Math]::Min(135, $content.Count); $line++) { '{0}:{1}' -f $line, $content[$line - 1] }`
> - Ran `$content = Get-Content -LiteralPath 'cloudrun-api/src/system/routes.ts'; for ($line = 1; $line -le [Math]::Min(100, $content.Count); $line++) { '{0}:{1}' -f $line, $content[$line - 1] }`
> - Ran `rg --files cloudrun-api/src | rg 'system|health|readiness'`
> - Ran `rg -n -C 2 'strpos\(|ILIKE|lower\(' cloudrun-api/src packages/db --glob '*.ts' --glob '*.sql' | Select-Object -First 180`
> - Ran `rg -n -C 2 'DATABASE_MAX_CONNECTIONS|ARCHIVER_QUERY_PAGE_SIZE|ARCHIVER_COMPANY_CONCURRENCY|Number\(process\.env' cloudrun-api/src/runtime-config.ts cloudrun-archiver/index.ts`
> - Ran `rg -n -C 2 'readiness|SELECT 1|health' cloudrun-api/src cloudrun-pdf/index.ts cloudrun-tax/src --glob '*.ts' | Select-Object -First 160`
> - Ran `rg -n -C 2 'JSON\.parse\(|console\.(log|warn|error)' phone_app/modules phone_app/contexts phone_app/firebase.ts --glob '*.ts' --glob '*.tsx' | Select-Object -First 160`
> - Ran `rg --files cloudrun-api/src | rg 'system|health|readiness'`
> - Ran `rg -n -C 2 'SELECT 1|readinessCheck|/ready|/health' cloudrun-api/src --glob '*.ts'`
> - Ran `rg -n -C 2 'strpos\(' packages/db cloudrun-api/src --glob '*.ts' --glob '*.sql' | Select-Object -First 120`
>
> </details>
>
> The code-level review is complete. One last non-mutating validation pass is checking every TypeScript package plus website lint; I’m avoiding builds because several package scripts emit generated `dist` files, which would violate the requested read-only audit.
>
> <details><summary>Ran 14 commands</summary>
>
> - Ran `npm --prefix packages/contracts run typecheck`
> - Ran `npm --prefix packages/api-contracts run typecheck`
> - Ran `npm --prefix cloudrun-api run typecheck`
> - Ran `npm --prefix website run lint`
> - Ran `npm --prefix website run typecheck`
> - Ran `npm --prefix phone_app run typecheck`
> - Ran `npm --prefix cloudrun-pdf run typecheck`
> - Ran `npm --prefix cloudrun-tax run typecheck`
> - Ran `npm --prefix cloudrun-archiver run typecheck`
> - Ran `npm --prefix packages/db run typecheck`
> - Ran `deno --version`
> - Ran `$files = @(rg --files supabase -g '*.ts'); & deno check --config deno.json @files`
> - Ran `deno test --config deno.json --allow-read="C:\Users\Amjad\Desktop\ERP-System\supabase,C:\Users\Amjad\Desktop\ERP-System\packages\db\migrations" supabase/handlers/handlers-hardening.test.ts`
> - Ran `git status --short`
>
> </details>
>
> <details><summary>Plan</summary>
>
> Evidence validation and non-mutating checks are complete. The production-readiness report is ready; no source files were modified.
>
> - [x] Map repository structure, packages, entry points, configuration, and documentation
> - [x] Trace backend, database, authentication, authorization, and external-service flows
> - [x] Review website and mobile UX, state management, accessibility, and failure paths
> - [x] Assess tests, dependencies, CI/CD, deployment, documentation, and dead code
> - [x] Validate evidence, prioritize findings, and produce the structured audit report
>
> </details>
</details>

## 1. Executive Summary

**Production verdict: No-go.** The project has a strong security and data-integrity foundation, but the current working tree is not production-ready.

I found:

- **1 Critical release blocker**
- **8 High-priority findings**
- Several Medium operational, scalability, accessibility, dependency, and maintainability risks

The most serious problems are deterministic, not theoretical:

1. Mobile can tell users that a tax invoice was approved even though the active Edge handler only reserves the invoice and never calls the Tax Authority.
2. Cloud API document tasks carry numeric company IDs, while the PDF service compares them against strings, causing every such task to fail authorization.
3. The checked-in deployment workflow omits mandatory PDF and archiver environment variables, so those workloads cannot start successfully.
4. The API deployment disables document dispatch by omitting optional Pub/Sub settings while still returning accepted task responses.
5. Accepting a pending job marks it finished without consuming its recorded parts.
6. Offline job attachments cannot create upload sessions because the client omits the required idempotency header.
7. Website and mobile document clients discard stable idempotency keys before processing finishes, allowing retries to create duplicate numbered documents.

Positive aspects include:

- Strong Supabase JWT validation, exact issuer/audience checks, and Google service-identity verification.
- Opaque website sessions, exact-origin CSRF protection, and no browser exposure of Supabase credentials.
- Tenant and role authority frequently re-derived in SQL.
- Atomic invitation, registration, job creation/completion, and inventory helpers.
- Entity versions, SQL counters, bounded cursor pagination, and tenant-scoped mobile caches.
- Broad typechecking and a meaningful database integration-test foundation.

### Audit validation

Passed during this review:

- Typecheck: all ten Node/TypeScript packages
- Website lint
- Website tests: **170/170**
- Mobile tests: **110/110**
- API contract tests: **32/32**
- Supabase hardening tests: **17/17**
- Deno check across all Edge files
- `git diff --check`
- `@ts-nocheck` policy guard

Not run:

- Full package/service builds
- Docker runtime smoke tests
- Local Supabase integration suite
- Playwright or Maestro E2E suites
- Expo Doctor
- Live Tax Authority, Pub/Sub, Storage, SES, Cloud Run, or production database validation

No tracked source files were modified. The API-contract test command rebuilt its ignored `dist` output as part of its declared test script; Git status remained unchanged. The audit reflects the current working tree, including its pre-existing staged changes.

---

## 2. Project Map

| Area | Technology and entry points | Responsibility |
|---|---|---|
| Website | Next.js 16 App Router, React 19, `website/src/app`, `website/proxy.ts` | Marketing, authentication, opaque-session BFF, tenant-explicit ERP UI |
| Mobile | Expo 57, React Native 0.86, Expo Router | Field workflows, Cloud API reads/writes, retained Edge operations, offline outbox |
| Main API | Fastify 5, `cloudrun-api/src/server.ts`, `cloudrun-api/src/app.ts` | Versioned HTTP API, opaque web sessions, tenant routing, SQL RPCs |
| Tax gateway | Fastify, `cloudrun-tax/src/server.ts`, `cloudrun-tax/src/app.ts` | Tax Authority OAuth, approval requests, callbacks |
| PDF service | Express/Puppeteer, `cloudrun-pdf/index.ts` | PDF previews, generated documents, private Storage, SES email |
| Archiver | Node batch, `cloudrun-archiver/index.ts` | Monthly SQL extraction, GCS archives, checksum verification, deletion |
| Edge compatibility layer | `supabase/functions/**/index.ts`, `supabase/handlers/**` | Mobile operations not yet migrated to Cloud API |
| Shared contracts | `packages/contracts`, `packages/api-contracts` | Canonical enums and Zod HTTP contracts |
| Database | `packages/db/schema.ts`, `packages/db/migrations` | Drizzle schema, private RPCs, permissions, idempotency, counters |

### Important data flows

- **Website:** Browser → Next.js server/BFF → opaque session cookie → Cloud API → PostgreSQL/Supabase Auth and Storage.
- **Mobile:** Expo app → Supabase bearer token → Cloud API for migrated slices; Edge mutation gateway for remaining slices.
- **Offline jobs:** SQLCipher outbox → signed upload session → encrypted attachment upload → job create/complete API.
- **Documents:** SQL creates a task → Cloud API dispatches through Pub/Sub → private PDF service → PostgreSQL + private Storage → optional SES email.
- **Tax:** Mobile currently calls Edge `getInvoiceApproval`; a separate Cloud Run tax approval/callback implementation exists but is not connected to that mobile path.
- **Archives:** Cloud Run Job → paginated SQL reads → streamed JSON archive → GCS checksum verification → source-row deletion → archive metadata API.

The principal architectural risk is the partially completed migration between Edge/Firebase-era paths and the new Cloud API. Shared contracts exist, but the two execution paths have already diverged in tax, document dispatch, error handling, and deployment.

---

## 3. Critical Findings

### C1. The active tax workflow reports approval without Tax Authority approval

- **Severity:** Critical
- **Category:** Correctness, compliance, data integrity
- **Location:**
  - `getInvoiceApproval` in [supabase/handlers/tax.ts:105](./supabase/handlers/tax.ts:105), lines 105–308
  - [useTaxInvoiceSubmission.ts:381](./phone_app/modules/documents/hooks/useTaxInvoiceSubmission.ts:381), lines 381–445
  - [CreateDocument.tsx:856](./phone_app/modules/documents/screens/CreateDocument.tsx:856), lines 844–895
  - Unconnected authority route in [cloudrun-tax/src/app.ts:210](./cloudrun-tax/src/app.ts:210)
- **Evidence:** The Edge handler inserts a document and reservation, creates a PDF task, and returns `status: "reserved"` at lines 285–293. It never calls the Tax Authority. Despite that, it records idempotency metadata with `status: "approved"` at lines 295–305. Both mobile callers announce “Tax Authority approved.” The Edge callback handler still returns HTTP 501 at line 332.
- **Why it matters:** A tax document can be presented, generated, and potentially emailed as approved without an authority confirmation number or accepted authority state.
- **Failure scenario:** A business submits a VAT invoice. The app displays approval, the PDF task runs, and the customer receives the invoice. The database still has only a reservation, and the Tax Authority has never seen the request.
- **Recommended fix:** Disable the approval claim immediately. Route submission through the Cloud Run tax service, bind the outbound correlation ID atomically, and treat `reserved`, `submitted`, `approved`, `rejected`, and callback failure as explicit states. Generate the final tax PDF only after an authoritative approval callback. Move reservation/document/task creation into a transactional SQL RPC and validate positive bounded decimal quantities/prices.
- **Estimated effort:** Large
- **Confidence:** Confirmed

### H1. Cloud API document tasks fail PDF tenant validation

- **Severity:** High
- **Category:** API consistency, correctness
- **Location:**
  - Dispatch payloads in [0022_api_document_tasks.sql:380](./packages/db/migrations/0022_api_document_tasks.sql:380) and line 514
  - PDF profile mapping in [access-store.ts:52](./cloudrun-pdf/access-store.ts:52), lines 52–65
  - Comparisons in [cloudrun-pdf/index.ts:195](./cloudrun-pdf/index.ts:195) and line 361
- **Evidence:** SQL emits `companyId` as a JSON number. API tests explicitly preserve `companyId: 77` in [document-dispatch.test.ts:118](./cloudrun-api/src/tests/document-dispatch.test.ts:118). The PDF access store returns `companyId` as `String(public_company_id)`, then uses strict comparison against the numeric payload.
- **Why it matters:** Every preview or generation task dispatched by the new Cloud API reaches `Requester company mismatch`.
- **Failure scenario:** The API accepts a document and publishes it successfully, but PDF processing always fails, leaving the document pending or failed.
- **Recommended fix:** Define one canonical company-ID representation in the shared task contract and normalize at the consumer boundary. Add a SQL → dispatcher → Pub/Sub decoder → PDF authorization integration test.
- **Estimated effort:** Small
- **Confidence:** Confirmed

### H2. Checked-in deployments cannot start the PDF service or archiver

- **Severity:** High
- **Category:** DevOps, configuration
- **Location:**
  - PDF deployment at [cloudrun-deploy.yml:162](./.github/workflows/cloudrun-deploy.yml:162)
  - PDF startup guards at [cloudrun-pdf/index.ts:75](./cloudrun-pdf/index.ts:75) and [cloudrun-pdf/index.ts:148](./cloudrun-pdf/index.ts:148)
  - Archiver deployment at [cloudrun-deploy.yml:206](./.github/workflows/cloudrun-deploy.yml:206)
  - Archiver startup at [cloudrun-archiver/index.ts:116](./cloudrun-archiver/index.ts:116)
- **Evidence:** The PDF workflow omits `DATABASE_URL`, `SMART_JOB_PERSISTENCE_BACKEND`, `CLOUD_RUN_SERVICE_URL`, and `PUBSUB_ALLOWED_SERVICE_ACCOUNTS`, all required by startup checks. The archiver workflow omits mandatory `ARCHIVE_BUCKET`.
- **Why it matters:** Fresh PDF revisions fail before listening; the Cloud Run Job fails during module loading.
- **Failure scenario:** A deployment reports an image push but produces no ready PDF revision, while scheduled archive executions immediately terminate.
- **Recommended fix:** Introduce validated per-service deployment manifests containing every required variable and secret. Add container startup smoke tests using production-mode configuration before deployment.
- **Estimated effort:** Small to Medium
- **Confidence:** Confirmed

### H3. API deployment silently disables document dispatch

- **Severity:** High
- **Category:** Backend, asynchronous processing
- **Location:**
  - API deployment environment at [cloudrun-deploy.yml:54](./.github/workflows/cloudrun-deploy.yml:54)
  - Optional settings in [runtime-config.ts:66](./cloudrun-api/src/runtime-config.ts:66)
  - Silent no-op in [documents-mutations.ts:135](./cloudrun-api/src/routes/documents-mutations.ts:135)
- **Evidence:** The deployment omits all three `DOCUMENT_PUBSUB_*` settings. Runtime configuration treats dispatch as optional, and `bestEffortDispatch` returns silently when no publisher exists. Mutation routes still return accepted task responses.
- **Why it matters:** Users receive a valid-looking task ID for work that has no processing path.
- **Failure scenario:** All document tasks accumulate as pending, clients time out, and retries begin creating duplicate documents.
- **Recommended fix:** Require document dispatch configuration in production when document routes are enabled. Provision topics, subscriptions, OIDC audience, service accounts, and retry/dead-letter policy through versioned infrastructure. Include dispatch capability in readiness.
- **Estimated effort:** Medium
- **Confidence:** Confirmed for repository behavior; external manually provisioned infrastructure is unknown

### H4. Accepting a pending job does not consume its parts

- **Severity:** High
- **Category:** Database correctness, inventory integrity
- **Location:** `private.accept_api_job` in [0021_api_job_mutations.sql:445](./packages/db/migrations/0021_api_job_mutations.sql:445), lines 445–535
- **Evidence:** The function locks the job, changes its status to `finished`, and bumps `jobs_version`. It does not read `job_part_usages` or call `apply_job_inventory_consumption_batch`. By comparison, initial finished-job creation calls that helper in [0007_api_job_creation_and_storage.sql:575](./packages/db/migrations/0007_api_job_creation_and_storage.sql:575).
- **Why it matters:** Inventory is overstated after jobs with pre-recorded parts are accepted.
- **Failure scenario:** A technician records parts on a pending job. A manager accepts it. The job finishes, but all company/member balances remain unchanged.
- **Recommended fix:** Extend the acceptance transaction to load the canonical part usages and consume them through the existing batch helper before status finalization. Add rollback, insufficient-stock, replay, stale-version, and concurrent-acceptance tests.
- **Estimated effort:** Medium
- **Confidence:** Confirmed

### H5. Offline attachments cannot create upload sessions

- **Severity:** High
- **Category:** Mobile, API integration
- **Location:**
  - Mobile request in [phone_app/lib/outbox/processor.ts:96](./phone_app/lib/outbox/processor.ts:96), lines 96–124
  - API header requirement in [upload-sessions.ts:38](./cloudrun-api/src/routes/upload-sessions.ts:38), used at line 174
- **Evidence:** The outbox POST omits `idempotencyKey`, while the API requires an `idempotency-key` header of 8–128 characters.
- **Why it matters:** Every queued job operation containing attachments fails before upload.
- **Failure scenario:** A technician completes a job offline with photos. Connectivity returns, but Pending Work can never reconcile the operation.
- **Recommended fix:** Derive a stable upload-session key from the outbox operation and attachment manifest, persist it with the operation, and pass it on every retry.
- **Estimated effort:** Small
- **Confidence:** Confirmed

### H6. Document retries can create duplicate numbered records

- **Severity:** High
- **Category:** Idempotency, frontend state
- **Location:**
  - Website at [document-create-control.tsx:194](./website/src/components/documents/document-create-control.tsx:194), especially lines 199–208
  - Website timeout at line 135
  - Mobile at [useDocumentTask.ts:279](./phone_app/hooks/useDocumentTask.ts:279), especially lines 282–289 and 317–324
  - Mobile timeout at line 151
- **Evidence:** Both clients clear/complete the stable action key immediately after task acceptance, not after terminal completion. Timeout messages explicitly instruct the user to retry.
- **Why it matters:** Retrying after a lost polling response creates a new idempotency key and therefore a new numbered document.
- **Failure scenario:** The server accepts and generates a document, but the result poll fails. The user retries and receives a second invoice/receipt number.
- **Recommended fix:** Persist the action key and accepted task identity until a terminal server result is reconciled. Retry polling/recovery with the existing task rather than creating a new mutation.
- **Estimated effort:** Medium
- **Confidence:** Confirmed

### H7. Deployment is not tied to tested artifacts or database migrations

- **Severity:** High
- **Category:** Release engineering
- **Location:** [cloudrun-deploy.yml:1](./.github/workflows/cloudrun-deploy.yml:1)
- **Evidence:** The manual workflow builds the selected checkout under an arbitrary supplied image tag. It has no CI-result gate, migration phase, schema compatibility check, smoke test, traffic promotion, digest verification, or rollback step. The API deploys before dependent services.
- **Why it matters:** Application code can be deployed before its RPCs, grants, tables, or callbacks exist.
- **Failure scenario:** A revision expects migration 0024, but production remains at 0022. Readiness still succeeds because it runs only `SELECT 1`.
- **Recommended fix:** Build once after CI, promote the immutable image digest, run migration preflight and backward-compatible migrations, test readiness plus representative RPCs, and promote traffic gradually with an explicit rollback target.
- **Estimated effort:** Large
- **Confidence:** Confirmed

### H8. Database package contains a high-severity vulnerable Drizzle version

- **Severity:** High
- **Category:** Dependencies, SQL safety
- **Location:** [packages/db/package-lock.json:952](./packages/db/package-lock.json:952)
- **Evidence:** Installed `drizzle-orm` is 0.44.7. The official advisory affects versions below 0.45.2 when untrusted runtime values reach identifiers or aliases. No current dynamic `sql.identifier()` or untrusted alias construction was found. [Official GitHub advisory](https://github.com/advisories/GHSA-gpj5-g38j-94v9).
- **Why it matters:** A future or overlooked dynamic identifier path could turn input into SQL syntax rather than a parameter.
- **Failure scenario:** Search/report functionality later accepts a caller-selected column or alias and feeds it into an affected Drizzle identifier path.
- **Recommended fix:** Upgrade to at least 0.45.2, rebuild all database consumers, and rerun the local Supabase integration suite.
- **Estimated effort:** Small
- **Confidence:** Confirmed vulnerable dependency; suspected current exploitability

---

## 4. Findings by Area

### Architecture

- **Medium, Confirmed:** Edge and Cloud API paths coexist without one authoritative feature-state map. Tax is the clearest divergence, but error envelopes, task dispatch, and deployment ownership also differ.
- **Medium, Confirmed:** The PDF consumer claims only task status/timestamp in [task-store.ts:25](./cloudrun-pdf/task-store.ts:25), then trusts tenant, user, type, and document fields from Pub/Sub. It should load and compare the canonical task row before processing.
- **Medium, Confirmed:** `strict` is disabled in `cloudrun-pdf`, `cloudrun-archiver`, `packages/db`, and `packages/contracts`. The ignored email completion fields are a concrete consequence.
- **Medium, Confirmed:** Several mobile screens exceed 1,000 lines, including `CreateDocument.tsx`, `ClientBook.tsx`, `FillJob.tsx`, and `Userjob.tsx`, coupling transport, validation, presentation, and state transitions.

### Security

- **Medium, Confirmed:** The contact challenge is always “3 + 4” in [challenge.ts:18](./website/src/lib/contact/challenge.ts:18). Signing the answer prevents tampering but does not impede automation.
- **Medium, Suspected:** Public registration and password-recovery calls in [server-supabase.ts:46](./website/src/lib/auth/server-supabase.ts:46) have no application timeout, response-size cap, or app-level throttling and surface upstream error text. Supabase-side controls may mitigate this but are not visible here.
- **Medium, Confirmed:** Contact throttling is keyed only by submitted email in [contact-requests.ts:33](./cloudrun-api/src/routes/contact-requests.ts:33). Bots can rotate addresses.
- **Medium, Confirmed:** `phone_app/google-services.json` and `phone_app/GoogleService-Info.plist` are tracked despite both ignore files and project policy saying otherwise. They contain client configuration/API-key-shaped identifiers. These are not server secrets, but restrictions and quota exposure should be verified.
- **Low, Confirmed:** Chromium runs with `--no-sandbox`. Input escaping reduces exposure, but a browser exploit would have less containment.
- **Positive:** No committed private key, service-role secret, database password, or signing secret was found in the scoped secret-pattern review.

### Correctness

- **Medium, Confirmed:** PDF finalizes Storage/SQL, sends SES, then marks the task complete in [cloudrun-pdf/index.ts:485](./cloudrun-pdf/index.ts:485). A crash after SES but before line 558 permits stale-task retry and duplicate email.
- **Medium, Confirmed:** Email result fields passed at lines 564–567 are not represented or persisted by `TaskCompletionOptions` in [task-store.ts:13](./cloudrun-pdf/task-store.ts:13).
- **Medium, Confirmed:** Empty archive months are permanently recorded as complete at [cloudrun-archiver/index.ts:470](./cloudrun-archiver/index.ts:470) and line 540. Late-arriving historical rows will never be archived.
- **Medium, Confirmed:** The tax Edge handler converts invalid/non-finite line numerics to zero at [tax.ts:143](./supabase/handlers/tax.ts:143), with no positive-value or upper-bound validation.
- **Medium, Confirmed:** The PDF deployment provides no AWS credentials. Email is disabled in [emailService.ts:77](./cloudrun-pdf/emailService.ts:77), and failures are swallowed after document generation.

### Performance

- **Medium, Suspected at scale:** Jobs, documents, and inventory use case-insensitive substring `strpos` searches, for example [jobs/read-repository.ts:308](./cloudrun-api/src/jobs/read-repository.ts:308). Ordinary B-tree indexes cannot efficiently serve these predicates.
- **Medium, Confirmed design risk:** Every web-session resolution locks the session row `FOR UPDATE` in [repository.ts:70](./cloudrun-api/src/web-sessions/repository.ts:70). Refresh holds the lock while calling Supabase, serializing concurrent browser requests.
- **Medium, Suspected at scale:** The archiver streams JSON correctly but retains every source ID in memory at [cloudrun-archiver/index.ts:275](./cloudrun-archiver/index.ts:275), then deletes all IDs in one `IN` operation in [packages/db/archive.ts:108](./packages/db/archive.ts:108).
- **Low, Confirmed:** Mobile API preparation restores the SecureStore session before and after token refresh for each identity-bound request in [client.ts:190](./phone_app/lib/api/client.ts:190).
- **Low, Confirmed:** Offline upload decrypts a whole attachment into memory. The 10 MB limit bounds this but can still produce memory pressure on older devices.

### Frontend

- **Medium, Confirmed:** The shared web modal has dialog semantics and Escape support but lacks focus capture, focus trap, focus restoration, background inertness, and scroll locking in [Modal.tsx:15](./website/src/components/ui/Modal.tsx:15).
- **Low, Confirmed:** Data-table headers do not declare column scope, and no global skip-navigation link was found.
- **Medium, Confirmed:** The ERP shell and document composer contain hard-coded English/date/number presentation while marketing pages support localization and RTL.
- **Low, Confirmed:** Production analytics in `website/src/lib/analytics.ts` is effectively a no-op, limiting product and failure visibility.

### Mobile

- **Medium, Confirmed:** Several interactive `TouchableOpacity` controls lack role, label, state, or hint semantics, including actions in `ManageJobs.tsx`, `WorkerInventory.tsx`, and `DocumentHistory.tsx`.
- **Medium, Confirmed:** `CustomAlert` lacks modal/alert accessibility semantics in [CustomAlert.tsx:151](./phone_app/components/feedback/CustomAlert.tsx:151).
- **Medium, Confirmed:** `AppInput` does not derive an accessibility label from its visible label or announce validation errors in [AppInput.tsx:70](./phone_app/components/primitives/AppInput.tsx:70).
- **Medium, Confirmed:** `CreateDocument.tsx` contains visible mojibake, including [line 998](./phone_app/modules/documents/screens/CreateDocument.tsx:998), alongside corrupted log messages.
- **Medium, Confirmed:** The retained Edge wrapper has no request timeout and converts structured backend failures into plain `Error` at [phone_app/firebase.ts:168](./phone_app/firebase.ts:168). Callers checking backend error codes cannot work reliably.
- **Low, Confirmed:** `app.json` forces portrait and light appearance despite tablet support and an application theme system.
- **Low, Confirmed:** The company inventory picker remains intentionally disabled; the scoped transfer UI is incomplete.
- **Positive:** Auth tokens use SecureStore, MMKV-owned data avoids AsyncStorage, the outbox is encrypted, and notification payloads are tenant/user checked.

### Backend

- **Medium, Confirmed:** API readiness only runs `SELECT 1` in [database/runtime.ts:243](./cloudrun-api/src/database/runtime.ts:243). It cannot detect missing migrations, revoked RPC grants, Storage configuration, or Pub/Sub failure.
- **Medium, Confirmed:** Public Supabase Auth fetches have no bounded timeout, unlike the Cloud API BFF client.
- **Medium, Confirmed:** PDF task finalization accepts Pub/Sub payload identity rather than binding it against canonical task type/tenant/user/document fields.
- **Positive:** Authenticated SQL transactions set user context and transaction-local limits; the runtime verifies it connected as `smart_job_api`; internal tax routes use Google service identity.

### Database

- **Medium, Confirmed:** The migration journal reaches 0024, but Drizzle snapshots stop at `0012_snapshot.json`. Future `db:generate` runs can infer duplicate or destructive changes.
- **Medium, Suspected:** Archive manifests have no database/advisory lock or GCS generation precondition in [cloudrun-archiver/index.ts:154](./cloudrun-archiver/index.ts:154). Overlapping executions can overwrite manifest state.
- **Medium, Suspected at scale:** Large archive deletions are not chunked.
- **Low, Confirmed:** `packages/db/db_errors.txt` is a tracked stale compile artifact.
- **Positive:** Sequential IDs use SQL counters; entity versions and row locks protect concurrent mutations; high-risk operations generally use private transactional RPCs.

### APIs

- **High:** Numeric/string tenant mismatch, upload-session header mismatch, and task retry idempotency are cross-layer contract failures described above.
- **Medium, Confirmed:** Edge error adaptation discards stable error codes, while Cloud API consumers use typed `ApiClientError`.
- **Medium, Confirmed:** Legacy Edge and Cloud API document/tax operations expose different states and guarantees under similar user-facing names.
- **Positive:** New Cloud API endpoints use Zod schemas, consistent envelopes, bounded cursors, versioned mutation contracts, and explicit tenant paths.

### Testing

- **Medium, Confirmed:** Many tests are source-regex characterization tests. They verify the presence of code patterns but not semantic interoperability; the numeric company-ID failure passed all current tests.
- **Medium, Confirmed:** Website E2E is conditional on `RUN_WEBSITE_E2E` in [ci.yml:302](./.github/workflows/ci.yml:302) and currently covers only one Chromium auth specification.
- **Medium, Confirmed:** Maestro flows exist but are not run in CI.
- **Medium, Confirmed:** The `packages_db` CI job does not run `npm test`; its new archive unit test is therefore omitted. The integration job runs only the single integration entry point.
- **Medium, Confirmed:** No coverage thresholds, mutation testing, dependency audit gate, or end-to-end document task test exists.
- **Low, Confirmed:** CI does not run `supabase db lint`.

### Dependencies

Current `npm audit` results on July 18, 2026:

| Package | Result | Assessment |
|---|---:|---|
| `cloudrun-api`, `cloudrun-tax`, contracts packages | 0 | Clean |
| `packages/db` | 1 High | Direct Drizzle exposure; fix promptly |
| `cloudrun-pdf` | 2 High, 5 Moderate | High issues are transitive `basic-ftp`; current FTP reachability appears low |
| `cloudrun-archiver` | 6 Moderate | Transitive storage/tooling chain |
| `website` | 2 Moderate | Nested Next.js PostCSS 8.4.31 |
| `phone_app` | 16 Moderate | Mostly Expo/xcode/uuid transitive dependencies |

Additional observations:

- `cloudrun-pdf/package.json` explicitly overrides `basic-ftp` to vulnerable 5.2.2 at [line 34](./cloudrun-pdf/package.json:34). It should move to 5.3.0 or newer. The advisory requires interaction with a malicious FTP server, and no application FTP route was found. [Official advisory](https://github.com/advisories/GHSA-rp42-5vxx-qpwr).
- Website PostCSS exposure requires attacker-controlled CSS stringification; that surface was not found. [Official PostCSS advisory](https://github.com/postcss/postcss/security/advisories/GHSA-qx2v-qp2m-jg93).
- Expo audit fixes suggested by npm include incompatible downgrades. Resolve through the Expo-supported dependency graph rather than applying `npm audit fix --force`.
- CI does not currently enforce an audit policy or documented exception process.

### DevOps and deployment

- **Medium, Confirmed:** `check-js-syntax.mjs` accepts only `.js` at [line 27](./scripts/check-js-syntax.mjs:27). All repository scripts are `.mjs`; the CI guard reported “Checked JS syntax for 0 files.”
- **Medium, Confirmed:** The performance-budget script references removed files at [check-perf-budget.mjs:88](./scripts/check-perf-budget.mjs:88), stale Edge paths at line 113, and always exits zero at line 138.
- **Medium, Suspected operational risk:** The Edge deployment workflow was removed even though mobile still calls Edge handlers. An external/manual deployment mechanism was not found.
- **Medium, Confirmed:** No migration execution exists in the Cloud Run deployment workflow.
- **Medium, Confirmed:** No SBOM, image vulnerability scan, provenance/signing, secret scanner, or SAST job exists.
- **Low, Confirmed:** GitHub Actions use mutable major tags instead of commit SHAs.
- **Low, Confirmed:** Node container bases use mutable `node:22-slim` tags, and EAS dev iOS uses `latest`.
- **Positive:** CI uses Node 22, `npm ci`, concurrency cancellation, typecheck/test/build stages, isolated Supabase integration, and Docker builds.

### Documentation

- **Medium, Confirmed:** No `.env.example` files exist despite the ignore configuration explicitly allowing them.
- **Medium, Confirmed:** [SETUP.md:210](./SETUP.md:210) documents obsolete `EXPO_PUBLIC_SUPABASE_ANON_KEY` and omits the publishable key and Cloud API base URL documented correctly in `phone_app/README.md`.
- **Medium, Confirmed:** The Edge environment block omits `JWT_SECRET`, although the prose later says it is required.
- **Medium, Confirmed:** [website/README.md:107](./website/README.md:107) still documents removed `__session`, `__session_access`, `/api/callable`, and `/api/read-model` paths.
- **Medium, Confirmed:** [backend.md:235](./backend.md:235) similarly describes the removed split-cookie proxy architecture.
- **Medium, Confirmed:** `PROJECT_SUMMARY.md` says deployment/IAM and tax approval are implemented while later sections still list cutover and deployment work as outstanding.
- **Medium, Confirmed:** PDF and archiver lack focused runtime/deployment READMEs listing their exact mandatory settings.
- **Positive:** `AGENTS.md` is detailed and contains valuable security, build-order, and architectural invariants.

### Developer experience

- **Medium, Confirmed:** There is no root workspace by design, but repeated per-package installation/build orchestration makes clean setup and CI drift more likely.
- **Medium, Confirmed:** Disabled strict mode and large mixed-responsibility files slow safe refactoring.
- **Medium, Confirmed:** Direct `console.*` usage remains throughout mobile code despite the documented logger convention.
- **Low, Confirmed:** Dormant `website/src/lib/auth/access-token.ts` is imported only by its test and documents an earlier session model.
- **Low, Confirmed:** Stale documentation, migration snapshots, generated error artifacts, and vacuous guards increase onboarding uncertainty.

---

## 5. Test Gap Analysis

| Priority | Missing test | What it must protect |
|---|---|---|
| P0 | Full tax approval state-machine test | Reservation, outbound approval, correlation binding, callback, rejection, replay conflict, and no “approved” UI before confirmation |
| P0 | Document pipeline contract test | SQL payload → dispatcher → Pub/Sub decoding → PDF tenant authorization → Storage/task completion |
| P0 | Job acceptance inventory integration | Exact-once part consumption, insufficient stock rollback, stale version, concurrent managers, idempotent replay |
| P0 | Offline attachment reconciliation | Stable upload-session header, signed uploads, retry, app restart, job finalization, staged-file retention |
| P0 | Accepted-task retry recovery | Poll timeout/network loss must reuse the task and idempotency key without allocating a second document number |
| P0 | Production container/config smoke tests | PDF and archiver must start with deploy-workflow configuration; missing required settings must fail in CI |
| P1 | Full authorization matrix | Every role × tenant × entitlement across jobs, clients, inventory, documents, archives, invitations, and internal routes |
| P1 | Web-session concurrency and rotation | Concurrent page loads, refresh lock, revoke race, key rotation, absolute expiry |
| P1 | Archive resilience | Overlapping jobs, late historical inserts, manifest write conflict, checksum mismatch, large batches, delete retry |
| P1 | PDF at-least-once email handling | Crash after SES, duplicate Pub/Sub delivery, durable email state, sender misconfiguration |
| P1 | Public auth/contact abuse | Enumeration behavior, rate limits, challenge automation, timeout, oversized upstream response |
| P1 | Storage authorization | Cross-tenant object paths, expired upload sessions, wrong hash/size/MIME, replayed signed URLs |
| P2 | Accessibility automation | Website axe checks plus mobile screen-reader role/label/state checks |
| P2 | Performance tests | Representative tenant row counts, search query plans, cursor stability, session contention |
| P2 | Dependency-policy tests | Audit allowlist with expiry, lockfile checks, SBOM/image scan |

No payment processor or charge-creation path was found. Payment transaction tests are therefore not currently applicable, but subscription entitlement and upgrade authorization remain high-value coverage.

---

## 6. Recommended Action Plan

### Fix immediately

1. **Stop false tax approval and connect the authoritative flow**
   - Files: `supabase/handlers/tax.ts`, mobile tax callers, `cloudrun-tax`, API callback routes, tax migrations.
   - Impact: Prevents legally invalid approval claims and inconsistent tax records.
   - Dependencies: Tax Authority sandbox/production credentials, agreed state machine, migration approval.
   - Effort: Large.

2. **Normalize document task company IDs**
   - Files: `0022_api_document_tasks.sql` or PDF boundary, shared API contracts, dispatcher/PDF tests.
   - Impact: Restores preview and generation processing.
   - Dependencies: None beyond contract agreement.
   - Effort: Small.

3. **Make document infrastructure mandatory and fix deploy settings**
   - Files: `cloudrun-deploy.yml`, API runtime config, PDF/archiver config.
   - Impact: Workloads start and accepted tasks have a processing route.
   - Dependencies: Pub/Sub topics, subscriptions, OIDC/IAM, Secret Manager entries, archive bucket.
   - Effort: Medium.

4. **Pass a stable upload-session idempotency key**
   - Files: `phone_app/lib/outbox/processor.ts` and outbox tests.
   - Impact: Restores offline completion with attachments.
   - Dependencies: None.
   - Effort: Small.

5. **Consume inventory during job acceptance**
   - Files: new database migration, integration tests, possibly API error mapping.
   - Impact: Prevents inventory/accounting drift.
   - Dependencies: Explicit schema-migration approval and local Supabase test database.
   - Effort: Medium.

6. **Keep document action keys until terminal reconciliation**
   - Files: website document control, mobile document hook/action-key store, lifecycle tests.
   - Impact: Prevents duplicate numbered documents.
   - Dependencies: Defined task-recovery UX.
   - Effort: Medium.

7. **Upgrade Drizzle and remove the vulnerable PDF override**
   - Files: `packages/db/package*.json`, `cloudrun-pdf/package*.json`.
   - Impact: Removes known high-severity package exposures.
   - Dependencies: Full package and integration validation.
   - Effort: Small to Medium.

### Fix before production

- Gate deployment on tested immutable image digests and a migration phase.
- Add full document/tax/outbox integration tests and make website/mobile E2E mandatory.
- Bind PDF messages to canonical task-row identity.
- Make email delivery a durable idempotent side effect or explicitly remove it from the synchronous completion contract.
- Add archive locking, generation preconditions, chunked deletion, and late-data handling.
- Reconcile Drizzle snapshots through migration 0024.
- Establish production metrics, traces, error reporting, alerts, dashboards, and SLOs.
- Remove tracked native Firebase configs from version control and verify key restrictions/rotation.
- Restore a documented Edge deployment path until all mobile Edge callers are removed.
- Add realistic readiness checks and post-deployment smoke tests.

### Improve soon

- Enable strict TypeScript incrementally in PDF, archiver, database, and contracts.
- Split oversized mobile screens into transport, state-machine, form, and view components.
- Replace direct mobile console logging with the project logger.
- Fix mobile mojibake, accessibility semantics, and website focus management.
- Profile substring searches with realistic data, then introduce justified trigram/search indexes.
- Bound public Supabase Auth requests and strengthen abuse controls.
- Update architecture/setup documentation and add sanitized environment examples.
- Add dependency, secret, image, and source security gates to CI.

### Optional cleanup

- Remove `packages/db/db_errors.txt` and dormant legacy auth code after verification.
- Update syntax/performance guard scripts.
- Pin GitHub Actions and container bases by digest.
- Consolidate repeated package bootstrap commands into a versioned script or composite action.
- Remove Edge/Firebase compatibility code only after telemetry proves no released client depends on it.

---

## 7. Quick Wins

- Normalize `companyId` before PDF authorization comparison.
- Add the outbox upload-session idempotency key.
- Make missing document Pub/Sub configuration fatal in production.
- Add `ARCHIVE_BUCKET` and mandatory PDF variables to the deploy workflow.
- Preserve document idempotency state after acceptance.
- Extend the syntax guard to `.mjs`.
- Remove stale paths from the performance-budget script.
- Add column scopes and basic modal focus restoration.
- Fix the visible mojibake strings.
- Add sanitized `.env.example` files.
- Run `packages/db npm test`, Maestro, Playwright, and `supabase db lint` in CI.
- Delete the stale database compile-error artifact.

---

## 8. Open Questions

1. Are Pub/Sub topics, push subscriptions, dead-letter topics, and IAM bindings provisioned outside this repository?
2. Is there an external scheduler draining pending document tasks when request-time dispatch is disabled?
3. What is the legally approved Tax Authority state machine, and may a PDF be generated before final confirmation?
4. Are Cloud Run environments currently supplying mandatory variables outside the checked-in workflow?
5. Are database migrations applied manually, and what rollback/compatibility process is used?
6. What are current production row counts, query plans, pooler settings, backup/PITR configuration, and RPO/RTO targets?
7. Are Supabase Auth CAPTCHA, rate limits, SMTP, password policy, and breached-password checks enabled?
8. Are the tracked Firebase client keys restricted by bundle/package ID, API allowlist, and quota?
9. Is SES delivery required product behavior, and is the account out of sandbox with verified sender domains?
10. What monitoring, alerting, on-call ownership, SLOs, and incident-response procedures exist?
11. Can archive runs overlap, and how should late-arriving historical records and retention/legal holds be handled?
12. Are production secrets versioned with an overlap/rotation strategy, particularly web-session encryption keys?
13. Are repository branch protections and deployment environment approvals configured externally?
14. Which released mobile versions still depend on each remaining Edge function?

No files have been edited. I’ll wait for approval before implementing any remediation.

> create plan to fix all issues you found and to make it production enviroment

<details><summary>21 previous messages</summary>

> I’ll turn the audit into a staged production program rather than one oversized patch. I’m using the Supabase, Next.js, and Expo data-flow guidance because the highest-risk fixes cross SQL migrations, the website BFF, and mobile offline/API behavior; first I’m rechecking the current release boundaries so the plan can specify safe batches and rollout gates.
>
> <details><summary>Ran 16 commands</summary>
>
> - Ran `Get-Content -Raw -LiteralPath 'C:\Users\Amjad\.codex\plugins\cache\openai-curated-remote\supabase\1.0.0\skills\supabase\SKILL.md'`
> - Ran `Get-Content -Raw -LiteralPath 'C:\Users\Amjad\.codex\plugins\cache\openai-curated-remote\vercel\1.0.0\skills\nextjs\SKILL.md'`
> - Ran `Get-Content -Raw -LiteralPath 'C:\Users\Amjad\.codex\plugins\cache\openai-curated-remote\expo\1.0.2\skills\native-data-fetching\SKILL.md'`
> - Ran `(Get-Content -LiteralPath 'C:\Users\Amjad\.codex\plugins\cache\openai-curated-remote\supabase\1.0.0\skills\supabase\SKILL.md').Count`
> - Ran `(Get-Content -LiteralPath 'C:\Users\Amjad\.codex\plugins\cache\openai-curated-remote\vercel\1.0.0\skills\nextjs\SKILL.md').Count`
> - Ran `(Get-Content -LiteralPath 'C:\Users\Amjad\.codex\plugins\cache\openai-curated-remote\expo\1.0.2\skills\native-data-fetching\SKILL.md').Count`
> - Ran `$x=Get-Content -LiteralPath 'C:\Users\Amjad\.codex\plugins\cache\openai-curated-remote\vercel\1.0.0\skills\nextjs\SKILL.md'; $x[0..249]`
> - Ran `$x=Get-Content -LiteralPath 'C:\Users\Amjad\.codex\plugins\cache\openai-curated-remote\vercel\1.0.0\skills\nextjs\SKILL.md'; $x[250..499]`
> - Ran `$x=Get-Content -LiteralPath 'C:\Users\Amjad\.codex\plugins\cache\openai-curated-remote\vercel\1.0.0\skills\nextjs\SKILL.md'; $x[500..744]`
> - Ran `rg --files -g 'Dockerfile*' -g '*.tf' -g 'terraform*' -g 'pulumi*' -g 'vercel.json' -g 'app.yaml' -g 'cloudbuild*.yaml' -g '.github/workflows/*.yml' -g '.github/workflows/*.yaml' -g 'eas.json' -g 'supabase/config.toml' | Sort-Object`
> - Ran `rg -n -C 2 'production|staging|Cloud Run|Vercel|website deploy|domain|rollout|migration|maintenance|downtime' SETUP.md architecture.md PROJECT_SUMMARY.md website/README.md cloudrun-api/README.md cloudrun-tax/README.md phone_app/README.md .github/workflows --glob '*.md' --glob '*.yml' | Select-Object -First 260`
> - Ran `rg -n -C 2 'SES|email delivery|sendDocumentEmail|client email|approval|confirmation|tax authority' README.md SETUP.md architecture.md PROJECT_SUMMARY.md cloudrun-pdf cloudrun-tax phone_app/modules/documents --glob '*.md' --glob '*.ts' --glob '*.tsx' --glob '*.js' | Select-Object -First 260`
> - Ran `Get-ChildItem .github/workflows -File | Select-Object Name,Length; Get-ChildItem packages/db/migrations -File -Filter '*.sql' | Sort-Object Name | Select-Object -Last 8 -ExpandProperty Name`
> - Ran `Get-ChildItem .github/workflows -File | Select-Object -ExpandProperty FullName; rg --files | rg '(^|/)(Dockerfile[^/]*|vercel\.json|eas\.json|config\.toml|.*\.tf|cloudbuild.*\.ya?ml)$'`
> - Ran `Get-ChildItem -Recurse -File | Where-Object { $_.Name -like 'Dockerfile*' -or $_.Extension -eq '.tf' -or $_.Name -in @('vercel.json','eas.json','config.toml') -or $_.Name -like 'cloudbuild*.yml' -or $_.Name -like 'cloudbuild*.yaml' } | Where-Object { $_.FullName -notmatch '\\node_modules\\|\\.next\\|\\dist\\' } | ForEach-Object { $_.FullName }`
> - Ran `Get-ChildItem packages/db/migrations -File -Filter '*.sql' | Sort-Object Name | Select-Object -Last 10 -ExpandProperty Name`
>
> </details>
>
> The repository confirms there is no infrastructure-as-code layer and no website deployment workflow; only the four Cloud Run workloads have a manual deploy workflow. Three product/operations choices now materially change the plan’s architecture and rollout.
>
> User input response
>
> - Which production hosting model should the plan standardize on?
>   - All GCP
> - What should the production plan do with mobile’s remaining Supabase Edge operations?
>   - Cut over fully (Recommended)
> - How should tax invoicing be handled while the authority integration is certified?
>   - Gate until certified (Recommended)
>
> That locks the target architecture: website and services on GCP, all mobile business operations moved to the Cloud API, and tax code completed but production-gated until certification. I need to pin down the migration context because a greenfield launch and a live-user cutover require different database, mobile, and rollback mechanics.
>
> User input response
>
> - What production state must this plan assume today?
>   - No live production (Recommended)
> - How should cloud and database environments be isolated?
>   - Separate projects (Recommended)
> - When may the legacy Edge endpoints be retired after the Cloud API mobile release?
>   - Adoption gate (Recommended)
>
> Because this is a greenfield launch, the plan can establish clean environment isolation and avoid compatibility compromises in the database. The remaining choices determine the operational stack and whether document completion must include customer email delivery.
>
> User input response
>
> - How should production infrastructure be defined and reviewed?
>   - Terraform (Recommended)
> - Which production observability stack should the plan use?
>   - Google + Crashlytics (Recommended)
> - What should happen to generated-document email delivery?
>   - Keep SES durable (Recommended)
>
> The Supabase guidance requires verifying current platform capabilities before locking a production topology. I’m checking the official region and platform documentation now; this will determine whether the main API should stay in Israel or colocate with the hosted database while the tax gateway remains in `me-west1`.
>
> <details><summary>Searched the web</summary>
>
> <details><summary>Searched the web</summary>
>
> - Searched the web for `https://supabase.com/changelog.md`
> - Searched the web for `site:supabase.com/docs guides platform regions Supabase available regions ...`
>
> </details>
>
> </details>
>
> Official Supabase documentation confirms hosted projects currently run in one primary AWS region; there is no Israel region. For a new production environment, the main latency tradeoff is therefore whether database-heavy Cloud Run services sit near Frankfurt or remain in Israel. I also need exact availability and mobile-retirement gates so the rollout section is enforceable.
>
> User input response
>
> - Which regional topology should the production plan use?
>   - Frankfurt data plane (Recommended)
> - What launch availability/cost posture should the plan target?
>   - Balanced 99.9% (Recommended)
> - What exact gate should retire the legacy Edge business endpoints?
>   - 99% + 30 days (Recommended)
>
> The production topology is now fixed: Frankfurt data plane, isolated dev/staging/prod projects, 99.9% posture, and a measured Edge retirement. The Expo networking guidance now drives a route-by-route inventory of remaining mobile Edge calls so “full cutover” is concrete rather than a vague cleanup milestone.
>
> <details><summary>Ran 18 commands</summary>
>
> - Ran `rg -n "httpsCallable\(|callProtectedGatewayOperation\(|operation:\s*['\"]|getMutationGatewayTarget\(" phone_app --glob '*.ts' --glob '*.tsx' | Select-Object -First 500`
> - Ran `Get-Content -Raw supabase/handlers/index.ts; Get-Content -Raw phone_app/firebase.ts`
> - Ran `rg -n "register[A-Za-z]+Routes|app\.(get|post|patch|delete)\(" cloudrun-api/src --glob '*.ts' --glob '!**/tests/**' | Select-Object -First 500`
> - Ran `Get-Content -Raw website/next.config.ts; Get-Content -Raw website/package.json; Get-Content -Raw phone_app/eas.json; Get-Content -Raw phone_app/app.json`
> - Ran `rg -n 'httpsCallable\(|callProtectedGatewayOperation\(|getMutationGatewayTarget\(' phone_app --glob '*.ts' --glob '*.tsx'`
> - Ran `Get-Content -Raw supabase/handlers/index.ts`
> - Ran `$x=Get-Content phone_app/firebase.ts; for($i=1;$i -le $x.Count;$i++){ '{0}:{1}' -f $i,$x[$i-1] }`
> - Ran `rg -n 'register[A-Za-z]+Routes|app\.(get|post|patch|delete)\(' cloudrun-api/src --glob '*.ts' --glob '!**/tests/**'`
> - Ran ``rg -n '"/(api|internal)/[^"`]+' cloudrun-api/src/routes --glob '*.ts'``
> - Ran `rg -n 'EXPO_PUBLIC_EDGE_FUNCTIONS_BASE_URL|functions/v1|mutation-gateway|read-model|fetchArchiveMonthV1|createJobFileDownloadUrlV1|createInviteV1|joinCompanyV1|requestUpgradeV1|listUpgradeRequestsV1|moderateUpgradeRequestV1' phone_app --glob '*.ts' --glob '*.tsx' --glob '*.json'`
> - Ran `Get-Content -Raw phone_app/utils/read-model.ts; Get-Content -Raw phone_app/contexts/cache-fetchers.ts`
> - Ran `rg -n 'fetchDocumentById|fetchAllRecentJobs|fetchDataFromBackend\(' phone_app --glob '*.ts' --glob '*.tsx'`
> - Ran `$x=Get-Content phone_app/contexts/CacheContext.tsx; for($i=1028;$i -le 1078;$i++){ '{0}:{1}' -f $i,$x[$i-1] }`
> - Ran `rg -n '\.fetchDocumentById|fetchDocumentById\(' phone_app --glob '*.ts' --glob '*.tsx' | Where-Object { $_ -notmatch 'cache-fetchers|CacheContext.tsx' }`
> - Ran `Get-Content -Raw -LiteralPath 'website/next.config.ts'`
> - Ran `Get-Content -Raw -LiteralPath 'website/package.json'`
> - Ran `Get-Content -Raw -LiteralPath 'phone_app/eas.json'`
> - Ran `Get-Content -Raw -LiteralPath 'phone_app/app.json'`
>
> </details>
>
> The remaining mobile Edge inventory is now concrete: most operations already have Cloud API equivalents; the missing production slices are tax submission, archive-object retrieval, job-attachment download, and removal of legacy cache-version mutations. The next decisions set the security and disaster-recovery baseline for Terraform and operations.
>
> User input response
>
> - How much authority should Terraform have?
>   - Resources in projects (Recommended)
> - Which launch compliance baseline should the plan target?
>   - Israel + GDPR-ready (Recommended)
> - What recovery objectives should production use?
>   - RPO 15m / RTO 4h (Recommended)
>
> <details><summary>Ran 16 commands</summary>
>
> - Ran `$x=Get-Content -LiteralPath 'cloudrun-tax/src/contracts.ts'; for($i=1;$i -le [Math]::Min(260,$x.Count);$i++){ '{0}:{1}' -f $i,$x[$i-1] }`
> - Ran `$x=Get-Content -LiteralPath 'cloudrun-tax/src/app.ts'; for($i=180;$i -le [Math]::Min(260,$x.Count);$i++){ '{0}:{1}' -f $i,$x[$i-1] }`
> - Ran `$x=Get-Content -LiteralPath 'cloudrun-api/src/routes/internal-tax-callback.ts'; for($i=1;$i -le [Math]::Min(190,$x.Count);$i++){ '{0}:{1}' -f $i,$x[$i-1] }`
> - Ran `$x=Get-Content -LiteralPath 'packages/db/migrations/0023_api_tax_callback_processing.sql'; for($i=1;$i -le [Math]::Min(260,$x.Count);$i++){ '{0}:{1}' -f $i,$x[$i-1] }`
> - Ran `$x=Get-Content -LiteralPath 'packages/api-contracts/src/index.ts'; for($i=1450;$i -le [Math]::Min(1750,$x.Count);$i++){ '{0}:{1}' -f $i,$x[$i-1] }`
> - Ran `rg -n 'Document.*Schema|Tax.*Schema|Archive.*Schema|JobAttachment.*Schema' packages/api-contracts/src/index.ts | Select-Object -First 240`
> - Ran `$x=Get-Content packages/api-contracts/src/index.ts; for($i=1080;$i -le 1295;$i++){ '{0}:{1}' -f $i,$x[$i-1] }`
> - Ran `rg -n 'smart_job_(pdf|archiver)|CREATE ROLE|CREATE USER|cloudrun-pdf|archiver' packages/db/migrations cloudrun-pdf cloudrun-archiver --glob '*.sql' --glob '*.ts' --glob '*.js' | Select-Object -First 240`
> - Ran `Get-Content -Raw phone_app/modules/documents/lib/document-action-keys.ts; rg -n 'documentMutationKey|pending\.current' website/src/components/documents website/src/lib --glob '*.ts' --glob '*.tsx'`
> - Ran `Get-Content -Raw phone_app/modules/jobs/lib/job-file-utils.ts; rg -n 'storage\(\)|@react-native-firebase/storage|storage\.' phone_app --glob '*.ts' --glob '*.tsx'`
> - Ran `rg -n 'attachment|photo|signature' packages/api-contracts/src/index.ts cloudrun-api/src/jobs cloudrun-api/src/routes/jobs-read.ts packages/db/migrations/0007_api_job_creation_and_storage.sql | Select-Object -First 240`
> - Ran `rg -n 'Job.*SummarySchema|Job.*Attachment|attachments:' packages/api-contracts/src/index.ts | Select-Object -First 180`
> - Ran `Get-Content -Raw phone_app/modules/jobs/lib/jobs-api.ts; $x=Get-Content packages/api-contracts/src/index.ts; for($i=430;$i -le 490;$i++){ '{0}:{1}' -f $i,$x[$i-1] }`
> - Ran `rg -n 'Archive' packages/api-contracts/src/index.ts cloudrun-api/src/archives/read-repository.ts cloudrun-api/src/routes/archives-read.ts`
> - Ran `Get-Content -Raw phone_app/contexts/use-cache-version-actions.ts; rg -n 'createInviteV1|joinCompanyV1|requestUpgradeV1|listUpgradeRequestsV1|moderateUpgradeRequestV1' phone_app --glob '*.ts' --glob '*.tsx'`
> - Ran `rg -n 'updateProfile\(|updateInventory\(|incrementCacheVersion\(' phone_app --glob '*.ts' --glob '*.tsx' | Where-Object { $_ -notmatch 'use-cache-version-actions.ts' }`
>
> </details>
>
> One database-maintenance detail affects the sequence: Drizzle’s metadata snapshots stop at 0012 while SQL migrations continue through 0024. I’m checking the installed CLI’s supported generation modes so the plan can prescribe a safe metadata reconciliation instead of guessing at a command.
>
> <details><summary>Ran 4 commands</summary>
>
> - Ran `npm --prefix packages/db exec drizzle-kit generate -- --help`
> - Ran `Get-Content -Raw packages/db/drizzle.config.ts`
> - Ran `rg --files packages/db | rg 'drizzle|config'`
> - Ran `Get-Content -Raw packages/db/drizzle.config.js`
>
> </details>
>
> Plan
>
> # Smart-Job ERP Production Remediation and Launch Plan
>
> ## Summary
>
> Bring the current greenfield repository to production on:
>
> - GCP `europe-west3` for website, API, PDF, email worker, and archiver.
> - GCP `me-west1` for the Tax Authority gateway.
> - Separate dev, staging, and production GCP/Supabase/Firebase projects.
> - Supabase `eu-central-1`, colocated as closely as possible with the GCP data plane, per the [available-region documentation](https://supabase.com/docs/guides/platform/regions).
> - Terraform-managed project resources, with projects, billing links, and the Terraform state bucket bootstrapped manually.
> - Cloud Logging/Monitoring/Trace/Error Reporting plus Firebase Crashlytics.
> - AWS SES retained behind a durable email-delivery workflow.
> - Tax submission implemented but production-disabled until certification.
> - 99.9% service target, RPO 15 minutes, RTO 4 hours.
> - Full Cloud API mobile cutover; legacy Edge endpoints retire after 99% adoption and 30 consecutive days without business traffic.
>
> Estimated implementation: **12–16 engineer-weeks**, excluding app-store review, Tax Authority certification, DNS ownership, and legal review. Each numbered batch lands separately and must leave CI green.
>
> ## Implementation Batches
>
> ### 0. Immediate release blockers
>
> - Add a fail-closed `TAX_SUBMISSION_MODE=disabled|sandbox|production`; production defaults to `disabled`. Mobile and web show “Tax submission unavailable/pending certification” and never claim approval from the legacy reservation handler.
> - Normalize document-task company IDs immediately and add a cross-service regression test covering SQL payload → API publisher → PDF authorization.
> - Pass a stable upload-session idempotency key from offline operations, derived as `<operation-idempotency-key>:attachments`, and preserve it across retries/restarts.
> - Persist accepted document task ID, fingerprint, and idempotency key in website session storage and mobile MMKV. Clear only on terminal reconciliation or explicit user discard; timeout resumes polling rather than creating a new task.
> - Upgrade Drizzle to `>=0.45.2` and `basic-ftp` to `>=5.3.0`; update supported dependency patches without forced Expo downgrades.
> - Acceptance gate: the six Critical/High deterministic failures from the audit have regression tests before further feature work.
>
> ### 1. Database correctness and migration metadata
>
> - Generate the next sequential custom Drizzle migration as a no-op metadata baseline representing the schema after migration 0024; verify its snapshot against a clean database built from migrations 0001–0024.
> - Add the following subsequent expand-only migrations:
>   - Job acceptance consumes recorded parts through `apply_job_inventory_consumption_batch` before status finalization.
>   - PDF, email, and archiver receive dedicated least-privilege login roles with only private RPC access; passwords remain out-of-band.
>   - Document email deliveries, tax submissions, and archive-run leases receive durable tables/state machines.
> - Never grant runtime roles direct write access to public ERP tables.
> - Test every migration from a blank hosted-compatible Postgres 17 database and as an upgrade from 0024. Explicitly grant only required Data API access because new Supabase projects no longer automatically expose new public tables by default, as documented in the [2026 platform change](https://supabase.com/changelog/45702-developer-update-may-2026).
> - Run integration permission matrices for `anon`, `authenticated`, `service_role`, `smart_job_api`, PDF, email, and archiver roles.
>
> ### 2. Reliable document and email pipeline
>
> - Add a shared `DocumentDispatchMessageSchema` containing only `taskId`; Pub/Sub messages no longer carry trusted tenant/user/document data.
> - Replace PDF’s status-only task claim with a private RPC that atomically claims and returns canonical task type, tenant, user, document, and request payload. Every completion/failure RPC verifies the lease token and canonical identifiers.
> - Make Pub/Sub configuration mandatory in production. Provision preview/generate topics, authenticated push subscriptions, dead-letter topics, bounded retries, and a scheduled database-outbox drain.
> - Final PDF completion atomically stores the generated object, marks the document generated, and creates an email-delivery row when a validated recipient exists.
> - Create a small `cloudrun-email` service. It receives only `deliveryId`, claims the canonical delivery, sends via SES, and records `queued|sending|sent|failed|delivery_unknown`.
> - Retry only definite pre-send or provider-rejected transient failures. A crash/timeout after SES submission becomes `delivery_unknown` and requires an explicit manager/dev retry, preventing automatic duplicate customer mail.
> - Remove SES and email state handling from `cloudrun-pdf`.
> - Preserve `emailSent` for compatibility while adding `emailDeliveryStatus` to document responses.
>
> ### 3. Authoritative tax workflow
>
> - Add `POST /api/v1/companies/{companyId}/tax-invoices`, requiring verified identity and `Idempotency-Key`. The request contains only strict `DocumentDataInput`; document type 305 is implicit.
> - Implement one private SQL RPC that validates positive bounded decimal amounts, allocates the `doc_305` counter, inserts document/items/reservation, and creates a durable tax-submission outbox record atomically.
> - Add `submitted` to the tax-authority status enum and shared contract. User-visible states become `reserved`, `submitted`, `approved`, `rejected`, and `failed`; only `approved` may display an approval claim or confirmation number.
> - Add an internal, Google-identity-protected tax-submission drain. It claims submissions, calls `cloudrun-tax` with a stable correlation ID, and processes immediate results through the same idempotent result function used by callbacks.
> - Verify during certification whether the authority guarantees correlation-ID idempotency. Ambiguous timeouts remain `submission_unknown` and require reconciliation rather than blind retry.
> - An approved result atomically records the confirmation number and enqueues PDF generation. Rejected/failed submissions never generate a final tax invoice PDF.
> - Remove `getInvoiceApproval` and the 501 Edge callback after mobile cutover.
> - Production enablement requires: sandbox contract tests, callback replay/conflict tests, authority idempotency verification, security review, accounting/legal sign-off, and a controlled production canary.
>
> ### 4. Complete mobile Cloud API cutover
>
> - Add the missing API surfaces:
>   - `GET /api/v1/companies/{companyId}/jobs/{jobId}` returning parts and attachment metadata.
>   - `GET /api/v1/companies/{companyId}/jobs/{jobId}/attachments/{attachmentId}/download`.
>   - `GET /api/v1/companies/{companyId}/archives/{archiveRunId}/download`.
>   - `GET /api/v1/companies/{companyId}/documents/{documentId}` for authoritative document/tax/email state.
> - Move online job attachments to the existing signed Supabase upload-session protocol; remove direct Firebase Storage upload/delete calls.
> - Replace remaining Edge calls for job create/update/accept/delete, preview, tax, archives, invitations, and upgrades with typed Cloud API clients.
> - Delete the unused `updateCacheV1`/`updateInventoryV1` version hook; server mutations remain the sole source of sync-version changes.
> - Split the Firebase compatibility file into Supabase auth transport and Firebase Messaging/Crashlytics modules. Remove callable and Storage exports plus `@react-native-firebase/storage`; retain FCM.
> - Centralize request deadlines, cancellation, typed error parsing, single-flight token refresh, retry policy, and tenant-scoped React Query invalidation.
> - Remove dead cache-fetcher stubs and migrate consumers to bounded cursor queries rather than full-collection drains.
> - Ship the new binary through staged store rollout. Keep a compatibility Edge deployment until 99% of active installations use the new API version and legacy business traffic is zero for 30 days; then remove Edge code, deploy secrets, and `EXPO_PUBLIC_EDGE_FUNCTIONS_BASE_URL`.
>
> ### 5. Archive, performance, session, and abuse hardening
>
> - Replace mutable per-company GCS manifests with leased database archive runs. Store snapshot time, segment, checksum, GCS generation, counts, and lease expiry.
> - Use advisory locking plus GCS `ifGenerationMatch` preconditions. Allow later segments for late-arriving historical rows; an empty run never permanently closes a month.
> - Store a verified companion ID manifest and delete source rows in bounded 500-row chunks. Resume from the verified object after worker loss.
> - Bound archive page size and company concurrency; use one task, 60-minute timeout, and two retries initially.
> - Profile a synthetic large tenant before indexing. Where thresholds fail, add generated normalized search text plus `pg_trgm` GIN indexes for jobs/documents and a trigram index for inventory names. Targets: list p95 under 300 ms and search p95 under 500 ms at 100k jobs/50k documents.
> - Resolve web sessions without a write lock when tokens are safely valid; acquire and recheck under `FOR UPDATE` only inside the refresh window.
> - Replace fixed contact arithmetic with server-verified reCAPTCHA Enterprise. Apply Cloud Armor IP throttles to auth/contact routes, generic account-recovery responses, bounded upstream response reads, and request deadlines.
> - Strengthen readiness to verify expected schema version, required RPC privileges, mandatory publisher configuration, and initialized storage clients; keep liveness dependency-free.
> - Keep Chromium inside Cloud Run’s sandboxed runtime, prohibit arbitrary navigation/URLs, run non-root, and document `--no-sandbox` as a reviewed compensating-control exception.
>
> ### 6. Web/mobile quality and maintainability
>
> - Website:
>   - Add focus capture/trap/restore, background inertness, and scroll locking to modal behavior.
>   - Add skip navigation, table header scopes, accessible error announcements, RTL-aware formatting, and consistent `Intl` dates/currency.
>   - Add AbortController deadlines to server Auth calls.
>   - Implement consent-aware GA4 without PII or remove the no-op analytics abstraction.
> - Mobile:
>   - Add modal/alert semantics, labels/hints/states for shared inputs and controls, and screen-reader announcements for errors.
>   - Correct all mojibake with verified UTF-8 Hebrew/Arabic fixtures.
>   - Set automatic light/dark appearance and responsive tablet/landscape layout.
>   - Replace direct console calls with the project logger and redact identifiers.
>   - Decompose the oversized document, client, job, and inventory screens into state-machine/API, form, and presentation modules without changing behavior.
> - Enable strict TypeScript one package at a time: contracts, database, archiver, PDF, then new email service. Remove `any` from public boundaries before enabling each package.
> - Remove stale `db_errors.txt` and dormant legacy website token code after usage verification.
>
> ### 7. Dependencies, CI, and documentation
>
> - Resolve npm audit findings through supported patch upgrades. For Expo-only transitive findings without compatible fixes, record a time-limited risk exception with owner, reachability, compensating controls, and 30-day review date; never use `--force`.
> - Fix syntax checking to include `.mjs`; rewrite the performance guard against current paths and make verified checks blocking.
> - CI must run:
>   - Every unit test, typecheck, lint, build, Deno check/test, database unit/integration test, and `supabase db lint`.
>   - Mandatory Playwright core journeys and Maestro login/tenant/job/offline flows.
>   - CodeQL, secret scanning, lockfile audit, Terraform validate/tflint/security scan, SBOM generation, and container vulnerability scanning.
> - Pin GitHub Actions and container bases by immutable digest. Sign container images with keyless provenance.
> - Replace source-regex-only protection for critical paths with behavioral integration tests.
> - Update existing READMEs, `SETUP.md`, architecture documents, and project summary to the final architecture. Add sanitized per-package environment examples plus concise deployment, rollback, backup restore, secret rotation, DLQ replay, tax reconciliation, email-unknown, archive restore, and mobile-rollout runbooks.
>
> ### 8. Terraform production platform and delivery pipeline
>
> - Add shared Terraform modules and explicit `infra/environments/{dev,staging,prod}` roots with separate state keys.
> - Pre-create project/billing links and a versioned encrypted GCS Terraform state bucket. Terraform owns APIs, Artifact Registry, IAM, VPC/NAT/static egress, Cloud DNS records, managed certificates, load balancer, Cloud Armor, Cloud Run, Pub/Sub, Scheduler, archive/backup buckets, monitoring, and GitHub Workload Identity Federation.
> - Terraform creates Secret Manager containers and IAM only; secret values never enter Terraform state. Supabase, SES, session keys, and signing material are populated out-of-band.
> - Deploy:
>   - Next.js standalone non-root Cloud Run image, min 1.
>   - Main API min 1.
>   - Tax gateway min 1 in `me-west1`.
>   - PDF/email workers min 0 with durable queues.
>   - Archiver as a single-task Cloud Run Job.
>   - Cap aggregate maximum database pools at 70% of the Supabase connection limit.
> - Put website/API/tax callback domains behind the external HTTPS load balancer and Cloud Armor. Keep PDF/email/internal drains private to authenticated Google service identities.
> - Use a dedicated migration Cloud Run Job with the owner/migrator secret. Runtime services never receive migration credentials.
> - CI builds each image once, scans/signs it, and promotes the same digest through staging and production.
> - Deployment sequence: expand-only migration → no-traffic revision → readiness/smoke → 10% traffic → 50% → 100%. Production requires GitHub environment approval.
> - The website uses a parameterized Cloud Run domain, exact production `WEBSITE_ORIGIN`, opaque secure cookies, and the server-only API origin.
>
> ## Public Interfaces and Data Models
>
> - Add shared schemas for:
>   - Tax invoice creation/accepted status and `submitted` authority state.
>   - Canonical document dispatch messages.
>   - Job detail, attachment metadata, and signed download access.
>   - Archive page/download access.
>   - Email delivery status.
>   - Bootstrap capability `taxSubmissionMode`.
> - Add public routes:
>   - Tax invoice submission and document detail/status.
>   - Job detail and exact attachment download.
>   - Archive run download.
>   - Idempotent manual retry for `failed|delivery_unknown` document email, restricted to authorized document roles.
> - Add internal routes:
>   - Tax submission drain.
>   - Document/email outbox drains.
>   - Existing tax callback/session binding remains Google-identity protected.
> - Pub/Sub payloads contain opaque IDs only. Consumers load canonical tenant/user/request state from private SQL RPCs.
> - Preserve existing v1 fields during the mobile adoption window; additions are backward-compatible. Remove legacy Edge paths only after the retirement gate.
>
> ## Verification and Launch Gates
>
> - Critical behavioral tests:
>   - Tax never reports approval or generates a final PDF before confirmed authority acceptance.
>   - Callback and immediate approval replays are idempotent; conflicting payloads fail.
>   - Document tasks authorize numeric/string company representations identically.
>   - Accepted-task timeout/reload resumes the same task and never allocates another number.
>   - Job acceptance consumes parts exactly once under concurrency and rolls back on insufficient stock.
>   - Offline and online attachments survive retry/restart and remain tenant-scoped.
>   - SES duplicate delivery is prevented; ambiguous delivery becomes manual-review state.
>   - Archive overlap, late data, checksum failure, worker loss, and large deletion batches recover safely.
> - Security tests:
>   - Full role × tenant × entitlement matrix.
>   - Cross-tenant attachment/document/archive denial.
>   - Runtime-role grant snapshots.
>   - Auth/contact enumeration, CAPTCHA, rate-limit, timeout, and oversized-response behavior.
>   - No secrets in client bundles, logs, images, Terraform state, or repository.
> - Quality gates:
>   - WCAG 2.2 AA automated checks for website core journeys and manual keyboard/screen-reader review.
>   - VoiceOver/TalkBack smoke tests for login, navigation, forms, alerts, job completion, and Pending Work.
>   - No Critical/High dependency or image vulnerability at release; exceptions allowed only for unreachable Moderate transitive issues with expiry.
> - Operational gates:
>   - Seven-day staging soak with production-like configuration.
>   - Load tests meet 99.9% SLO/error-budget and latency targets.
>   - Document queue, email queue, tax submissions, callbacks, archive failures, DB pool saturation, and session-refresh failures have dashboards and alerts.
>   - Quarterly restore drill proves RPO 15 minutes/RTO 4 hours.
>   - Production mobile rollout: 10% for 24 hours, 50% for 48 hours, then 100% if crash-free sessions and API error budget remain healthy.
>   - Tax remains `disabled` in production at platform launch.
>
> ## Assumptions and Fixed Defaults
>
> - There is no live production customer data; the first production database is created cleanly from migrations.
> - GCP projects and billing links are supplied before Terraform execution.
> - Supabase production uses a paid tier supporting the selected PITR/recovery posture.
> - FCM and Crashlytics remain; Firebase Auth, Functions, Firestore, and Storage are not production business-data paths.
> - AWS SES is configured in an EU region with verified domain, DKIM/SPF/DMARC, production sending access, bounce/complaint handling, and no credentials in source.
> - Legal counsel supplies final tax/document retention periods and privacy wording; launch is blocked until those values are configured and documented.
> - No payment processing is introduced.
> - The repository remains intentionally package-by-package with no root npm workspace.
> - Database migrations are expand-only during launch; application rollback uses the prior signed image digest, while database recovery uses forward fixes or PITR rather than destructive down migrations.
>
> Plan implementation
>
> Status: completed
> # Smart-Job ERP Production Remediation and Launch Plan
>
> ## Summary
>
> Bring the current greenfield repository to production on:
>
> - GCP `europe-west3` for website, API, PDF, email worker, and archiver.
> - GCP `me-west1` for the Tax Authority gateway.
> - Separate dev, staging, and production GCP/Supabase/Firebase projects.
> - Supabase `eu-central-1`, colocated as closely as possible with the GCP data plane, per the [available-region documentation](https://supabase.com/docs/guides/platform/regions).
> - Terraform-managed project resources, with projects, billing links, and the Terraform state bucket bootstrapped manually.
> - Cloud Logging/Monitoring/Trace/Error Reporting plus Firebase Crashlytics.
> - AWS SES retained behind a durable email-delivery workflow.
> - Tax submission implemented but production-disabled until certification.
> - 99.9% service target, RPO 15 minutes, RTO 4 hours.
> - Full Cloud API mobile cutover; legacy Edge endpoints retire after 99% adoption and 30 consecutive days without business traffic.
>
> Estimated implementation: **12–16 engineer-weeks**, excluding app-store review, Tax Authority certification, DNS ownership, and legal review. Each numbered batch lands separately and must leave CI green.
>
> ## Implementation Batches
>
> ### 0. Immediate release blockers
>
> - Add a fail-closed `TAX_SUBMISSION_MODE=disabled|sandbox|production`; production defaults to `disabled`. Mobile and web show “Tax submission unavailable/pending certification” and never claim approval from the legacy reservation handler.
> - Normalize document-task company IDs immediately and add a cross-service regression test covering SQL payload → API publisher → PDF authorization.
> - Pass a stable upload-session idempotency key from offline operations, derived as `<operation-idempotency-key>:attachments`, and preserve it across retries/restarts.
> - Persist accepted document task ID, fingerprint, and idempotency key in website session storage and mobile MMKV. Clear only on terminal reconciliation or explicit user discard; timeout resumes polling rather than creating a new task.
> - Upgrade Drizzle to `>=0.45.2` and `basic-ftp` to `>=5.3.0`; update supported dependency patches without forced Expo downgrades.
> - Acceptance gate: the six Critical/High deterministic failures from the audit have regression tests before further feature work.
>
> ### 1. Database correctness and migration metadata
>
> - Generate the next sequential custom Drizzle migration as a no-op metadata baseline representing the schema after migration 0024; verify its snapshot against a clean database built from migrations 0001–0024.
> - Add the following subsequent expand-only migrations:
>   - Job acceptance consumes recorded parts through `apply_job_inventory_consumption_batch` before status finalization.
>   - PDF, email, and archiver receive dedicated least-privilege login roles with only private RPC access; passwords remain out-of-band.
>   - Document email deliveries, tax submissions, and archive-run leases receive durable tables/state machines.
> - Never grant runtime roles direct write access to public ERP tables.
> - Test every migration from a blank hosted-compatible Postgres 17 database and as an upgrade from 0024. Explicitly grant only required Data API access because new Supabase projects no longer automatically expose new public tables by default, as documented in the [2026 platform change](https://supabase.com/changelog/45702-developer-update-may-2026).
> - Run integration permission matrices for `anon`, `authenticated`, `service_role`, `smart_job_api`, PDF, email, and archiver roles.
>
> ### 2. Reliable document and email pipeline
>
> - Add a shared `DocumentDispatchMessageSchema` containing only `taskId`; Pub/Sub messages no longer carry trusted tenant/user/document data.
> - Replace PDF’s status-only task claim with a private RPC that atomically claims and returns canonical task type, tenant, user, document, and request payload. Every completion/failure RPC verifies the lease token and canonical identifiers.
> - Make Pub/Sub configuration mandatory in production. Provision preview/generate topics, authenticated push subscriptions, dead-letter topics, bounded retries, and a scheduled database-outbox drain.
> - Final PDF completion atomically stores the generated object, marks the document generated, and creates an email-delivery row when a validated recipient exists.
> - Create a small `cloudrun-email` service. It receives only `deliveryId`, claims the canonical delivery, sends via SES, and records `queued|sending|sent|failed|delivery_unknown`.
> - Retry only definite pre-send or provider-rejected transient failures. A crash/timeout after SES submission becomes `delivery_unknown` and requires an explicit manager/dev retry, preventing automatic duplicate customer mail.
> - Remove SES and email state handling from `cloudrun-pdf`.
> - Preserve `emailSent` for compatibility while adding `emailDeliveryStatus` to document responses.
>
> ### 3. Authoritative tax workflow
>
> - Add `POST /api/v1/companies/{companyId}/tax-invoices`, requiring verified identity and `Idempotency-Key`. The request contains only strict `DocumentDataInput`; document type 305 is implicit.
> - Implement one private SQL RPC that validates positive bounded decimal amounts, allocates the `doc_305` counter, inserts document/items/reservation, and creates a durable tax-submission outbox record atomically.
> - Add `submitted` to the tax-authority status enum and shared contract. User-visible states become `reserved`, `submitted`, `approved`, `rejected`, and `failed`; only `approved` may display an approval claim or confirmation number.
> - Add an internal, Google-identity-protected tax-submission drain. It claims submissions, calls `cloudrun-tax` with a stable correlation ID, and processes immediate results through the same idempotent result function used by callbacks.
> - Verify during certification whether the authority guarantees correlation-ID idempotency. Ambiguous timeouts remain `submission_unknown` and require reconciliation rather than blind retry.
> - An approved result atomically records the confirmation number and enqueues PDF generation. Rejected/failed submissions never generate a final tax invoice PDF.
> - Remove `getInvoiceApproval` and the 501 Edge callback after mobile cutover.
> - Production enablement requires: sandbox contract tests, callback replay/conflict tests, authority idempotency verification, security review, accounting/legal sign-off, and a controlled production canary.
>
> ### 4. Complete mobile Cloud API cutover
>
> - Add the missing API surfaces:
>   - `GET /api/v1/companies/{companyId}/jobs/{jobId}` returning parts and attachment metadata.
>   - `GET /api/v1/companies/{companyId}/jobs/{jobId}/attachments/{attachmentId}/download`.
>   - `GET /api/v1/companies/{companyId}/archives/{archiveRunId}/download`.
>   - `GET /api/v1/companies/{companyId}/documents/{documentId}` for authoritative document/tax/email state.
> - Move online job attachments to the existing signed Supabase upload-session protocol; remove direct Firebase Storage upload/delete calls.
> - Replace remaining Edge calls for job create/update/accept/delete, preview, tax, archives, invitations, and upgrades with typed Cloud API clients.
> - Delete the unused `updateCacheV1`/`updateInventoryV1` version hook; server mutations remain the sole source of sync-version changes.
> - Split the Firebase compatibility file into Supabase auth transport and Firebase Messaging/Crashlytics modules. Remove callable and Storage exports plus `@react-native-firebase/storage`; retain FCM.
> - Centralize request deadlines, cancellation, typed error parsing, single-flight token refresh, retry policy, and tenant-scoped React Query invalidation.
> - Remove dead cache-fetcher stubs and migrate consumers to bounded cursor queries rather than full-collection drains.
> - Ship the new binary through staged store rollout. Keep a compatibility Edge deployment until 99% of active installations use the new API version and legacy business traffic is zero for 30 days; then remove Edge code, deploy secrets, and `EXPO_PUBLIC_EDGE_FUNCTIONS_BASE_URL`.
>
> ### 5. Archive, performance, session, and abuse hardening
>
> - Replace mutable per-company GCS manifests with leased database archive runs. Store snapshot time, segment, checksum, GCS generation, counts, and lease expiry.
> - Use advisory locking plus GCS `ifGenerationMatch` preconditions. Allow later segments for late-arriving historical rows; an empty run never permanently closes a month.
> - Store a verified companion ID manifest and delete source rows in bounded 500-row chunks. Resume from the verified object after worker loss.
> - Bound archive page size and company concurrency; use one task, 60-minute timeout, and two retries initially.
> - Profile a synthetic large tenant before indexing. Where thresholds fail, add generated normalized search text plus `pg_trgm` GIN indexes for jobs/documents and a trigram index for inventory names. Targets: list p95 under 300 ms and search p95 under 500 ms at 100k jobs/50k documents.
> - Resolve web sessions without a write lock when tokens are safely valid; acquire and recheck under `FOR UPDATE` only inside the refresh window.
> - Replace fixed contact arithmetic with server-verified reCAPTCHA Enterprise. Apply Cloud Armor IP throttles to auth/contact routes, generic account-recovery responses, bounded upstream response reads, and request deadlines.
> - Strengthen readiness to verify expected schema version, required RPC privileges, mandatory publisher configuration, and initialized storage clients; keep liveness dependency-free.
> - Keep Chromium inside Cloud Run’s sandboxed runtime, prohibit arbitrary navigation/URLs, run non-root, and document `--no-sandbox` as a reviewed compensating-control exception.
>
> ### 6. Web/mobile quality and maintainability
>
> - Website:
>   - Add focus capture/trap/restore, background inertness, and scroll locking to modal behavior.
>   - Add skip navigation, table header scopes, accessible error announcements, RTL-aware formatting, and consistent `Intl` dates/currency.
>   - Add AbortController deadlines to server Auth calls.
>   - Implement consent-aware GA4 without PII or remove the no-op analytics abstraction.
> - Mobile:
>   - Add modal/alert semantics, labels/hints/states for shared inputs and controls, and screen-reader announcements for errors.
>   - Correct all mojibake with verified UTF-8 Hebrew/Arabic fixtures.
>   - Set automatic light/dark appearance and responsive tablet/landscape layout.
>   - Replace direct console calls with the project logger and redact identifiers.
>   - Decompose the oversized document, client, job, and inventory screens into state-machine/API, form, and presentation modules without changing behavior.
> - Enable strict TypeScript one package at a time: contracts, database, archiver, PDF, then new email service. Remove `any` from public boundaries before enabling each package.
> - Remove stale `db_errors.txt` and dormant legacy website token code after usage verification.
>
> ### 7. Dependencies, CI, and documentation
>
> - Resolve npm audit findings through supported patch upgrades. For Expo-only transitive findings without compatible fixes, record a time-limited risk exception with owner, reachability, compensating controls, and 30-day review date; never use `--force`.
> - Fix syntax checking to include `.mjs`; rewrite the performance guard against current paths and make verified checks blocking.
> - CI must run:
>   - Every unit test, typecheck, lint, build, Deno check/test, database unit/integration test, and `supabase db lint`.
>   - Mandatory Playwright core journeys and Maestro login/tenant/job/offline flows.
>   - CodeQL, secret scanning, lockfile audit, Terraform validate/tflint/security scan, SBOM generation, and container vulnerability scanning.
> - Pin GitHub Actions and container bases by immutable digest. Sign container images with keyless provenance.
> - Replace source-regex-only protection for critical paths with behavioral integration tests.
> - Update existing READMEs, `SETUP.md`, architecture documents, and project summary to the final architecture. Add sanitized per-package environment examples plus concise deployment, rollback, backup restore, secret rotation, DLQ replay, tax reconciliation, email-unknown, archive restore, and mobile-rollout runbooks.
>
> ### 8. Terraform production platform and delivery pipeline
>
> - Add shared Terraform modules and explicit `infra/environments/{dev,staging,prod}` roots with separate state keys.
> - Pre-create project/billing links and a versioned encrypted GCS Terraform state bucket. Terraform owns APIs, Artifact Registry, IAM, VPC/NAT/static egress, Cloud DNS records, managed certificates, load balancer, Cloud Armor, Cloud Run, Pub/Sub, Scheduler, archive/backup buckets, monitoring, and GitHub Workload Identity Federation.
> - Terraform creates Secret Manager containers and IAM only; secret values never enter Terraform state. Supabase, SES, session keys, and signing material are populated out-of-band.
> - Deploy:
>   - Next.js standalone non-root Cloud Run image, min 1.
>   - Main API min 1.
>   - Tax gateway min 1 in `me-west1`.
>   - PDF/email workers min 0 with durable queues.
>   - Archiver as a single-task Cloud Run Job.
>   - Cap aggregate maximum database pools at 70% of the Supabase connection limit.
> - Put website/API/tax callback domains behind the external HTTPS load balancer and Cloud Armor. Keep PDF/email/internal drains private to authenticated Google service identities.
> - Use a dedicated migration Cloud Run Job with the owner/migrator secret. Runtime services never receive migration credentials.
> - CI builds each image once, scans/signs it, and promotes the same digest through staging and production.
> - Deployment sequence: expand-only migration → no-traffic revision → readiness/smoke → 10% traffic → 50% → 100%. Production requires GitHub environment approval.
> - The website uses a parameterized Cloud Run domain, exact production `WEBSITE_ORIGIN`, opaque secure cookies, and the server-only API origin.
>
> ## Public Interfaces and Data Models
>
> - Add shared schemas for:
>   - Tax invoice creation/accepted status and `submitted` authority state.
>   - Canonical document dispatch messages.
>   - Job detail, attachment metadata, and signed download access.
>   - Archive page/download access.
>   - Email delivery status.
>   - Bootstrap capability `taxSubmissionMode`.
> - Add public routes:
>   - Tax invoice submission and document detail/status.
>   - Job detail and exact attachment download.
>   - Archive run download.
>   - Idempotent manual retry for `failed|delivery_unknown` document email, restricted to authorized document roles.
> - Add internal routes:
>   - Tax submission drain.
>   - Document/email outbox drains.
>   - Existing tax callback/session binding remains Google-identity protected.
> - Pub/Sub payloads contain opaque IDs only. Consumers load canonical tenant/user/request state from private SQL RPCs.
> - Preserve existing v1 fields during the mobile adoption window; additions are backward-compatible. Remove legacy Edge paths only after the retirement gate.
>
> ## Verification and Launch Gates
>
> - Critical behavioral tests:
>   - Tax never reports approval or generates a final PDF before confirmed authority acceptance.
>   - Callback and immediate approval replays are idempotent; conflicting payloads fail.
>   - Document tasks authorize numeric/string company representations identically.
>   - Accepted-task timeout/reload resumes the same task and never allocates another number.
>   - Job acceptance consumes parts exactly once under concurrency and rolls back on insufficient stock.
>   - Offline and online attachments survive retry/restart and remain tenant-scoped.
>   - SES duplicate delivery is prevented; ambiguous delivery becomes manual-review state.
>   - Archive overlap, late data, checksum failure, worker loss, and large deletion batches recover safely.
> - Security tests:
>   - Full role × tenant × entitlement matrix.
>   - Cross-tenant attachment/document/archive denial.
>   - Runtime-role grant snapshots.
>   - Auth/contact enumeration, CAPTCHA, rate-limit, timeout, and oversized-response behavior.
>   - No secrets in client bundles, logs, images, Terraform state, or repository.
> - Quality gates:
>   - WCAG 2.2 AA automated checks for website core journeys and manual keyboard/screen-reader review.
>   - VoiceOver/TalkBack smoke tests for login, navigation, forms, alerts, job completion, and Pending Work.
>   - No Critical/High dependency or image vulnerability at release; exceptions allowed only for unreachable Moderate transitive issues with expiry.
> - Operational gates:
>   - Seven-day staging soak with production-like configuration.
>   - Load tests meet 99.9% SLO/error-budget and latency targets.
>   - Document queue, email queue, tax submissions, callbacks, archive failures, DB pool saturation, and session-refresh failures have dashboards and alerts.
>   - Quarterly restore drill proves RPO 15 minutes/RTO 4 hours.
>   - Production mobile rollout: 10% for 24 hours, 50% for 48 hours, then 100% if crash-free sessions and API error budget remain healthy.
>   - Tax remains `disabled` in production at platform launch.
>
> ## Assumptions and Fixed Defaults
>
> - There is no live production customer data; the first production database is created cleanly from migrations.
> - GCP projects and billing links are supplied before Terraform execution.
> - Supabase production uses a paid tier supporting the selected PITR/recovery posture.
> - FCM and Crashlytics remain; Firebase Auth, Functions, Firestore, and Storage are not production business-data paths.
> - AWS SES is configured in an EU region with verified domain, DKIM/SPF/DMARC, production sending access, bounce/complaint handling, and no credentials in source.
> - Legal counsel supplies final tax/document retention periods and privacy wording; launch is blocked until those values are configured and documented.
> - No payment processing is introduced.
> - The repository remains intentionally package-by-package with no root npm workspace.
> - Database migrations are expand-only during launch; application rollback uses the prior signed image digest, while database recovery uses forward fixes or PITR rather than destructive down migrations.
</details>

> PLEASE IMPLEMENT THIS PLAN:
> # Smart-Job ERP Production Remediation and Launch Plan
>
> ## Summary
>
> Bring the current greenfield repository to production on:
>
> - GCP `europe-west3` for website, API, PDF, email worker, and archiver.
> - GCP `me-west1` for the Tax Authority gateway.
> - Separate dev, staging, and production GCP/Supabase/Firebase projects.
> - Supabase `eu-central-1`, colocated as closely as possible with the GCP data plane, per the [available-region documentation](https://supabase.com/docs/guides/platform/regions).
> - Terraform-managed project resources, with projects, billing links, and the Terraform state bucket bootstrapped manually.
> - Cloud Logging/Monitoring/Trace/Error Reporting plus Firebase Crashlytics.
> - AWS SES retained behind a durable email-delivery workflow.
> - Tax submission implemented but production-disabled until certification.
> - 99.9% service target, RPO 15 minutes, RTO 4 hours.
> - Full Cloud API mobile cutover; legacy Edge endpoints retire after 99% adoption and 30 consecutive days without business traffic.
>
> Estimated implementation: **12–16 engineer-weeks**, excluding app-store review, Tax Authority certification, DNS ownership, and legal review. Each numbered batch lands separately and must leave CI green.
>
> ## Implementation Batches
>
> ### 0. Immediate release blockers
>
> - Add a fail-closed `TAX_SUBMISSION_MODE=disabled|sandbox|production`; production defaults to `disabled`. Mobile and web show “Tax submission unavailable/pending certification” and never claim approval from the legacy reservation handler.
> - Normalize document-task company IDs immediately and add a cross-service regression test covering SQL payload → API publisher → PDF authorization.
> - Pass a stable upload-session idempotency key from offline operations, derived as `<operation-idempotency-key>:attachments`, and preserve it across retries/restarts.
> - Persist accepted document task ID, fingerprint, and idempotency key in website session storage and mobile MMKV. Clear only on terminal reconciliation or explicit user discard; timeout resumes polling rather than creating a new task.
> - Upgrade Drizzle to `>=0.45.2` and `basic-ftp` to `>=5.3.0`; update supported dependency patches without forced Expo downgrades.
> - Acceptance gate: the six Critical/High deterministic failures from the audit have regression tests before further feature work.
>
> ### 1. Database correctness and migration metadata
>
> - Generate the next sequential custom Drizzle migration as a no-op metadata baseline representing the schema after migration 0024; verify its snapshot against a clean database built from migrations 0001–0024.
> - Add the following subsequent expand-only migrations:
>   - Job acceptance consumes recorded parts through `apply_job_inventory_consumption_batch` before status finalization.
>   - PDF, email, and archiver receive dedicated least-privilege login roles with only private RPC access; passwords remain out-of-band.
>   - Document email deliveries, tax submissions, and archive-run leases receive durable tables/state machines.
> - Never grant runtime roles direct write access to public ERP tables.
> - Test every migration from a blank hosted-compatible Postgres 17 database and as an upgrade from 0024. Explicitly grant only required Data API access because new Supabase projects no longer automatically expose new public tables by default, as documented in the [2026 platform change](https://supabase.com/changelog/45702-developer-update-may-2026).
> - Run integration permission matrices for `anon`, `authenticated`, `service_role`, `smart_job_api`, PDF, email, and archiver roles.
>
> ### 2. Reliable document and email pipeline
>
> - Add a shared `DocumentDispatchMessageSchema` containing only `taskId`; Pub/Sub messages no longer carry trusted tenant/user/document data.
> - Replace PDF’s status-only task claim with a private RPC that atomically claims and returns canonical task type, tenant, user, document, and request payload. Every completion/failure RPC verifies the lease token and canonical identifiers.
> - Make Pub/Sub configuration mandatory in production. Provision preview/generate topics, authenticated push subscriptions, dead-letter topics, bounded retries, and a scheduled database-outbox drain.
> - Final PDF completion atomically stores the generated object, marks the document generated, and creates an email-delivery row when a validated recipient exists.
> - Create a small `cloudrun-email` service. It receives only `deliveryId`, claims the canonical delivery, sends via SES, and records `queued|sending|sent|failed|delivery_unknown`.
> - Retry only definite pre-send or provider-rejected transient failures. A crash/timeout after SES submission becomes `delivery_unknown` and requires an explicit manager/dev retry, preventing automatic duplicate customer mail.
> - Remove SES and email state handling from `cloudrun-pdf`.
> - Preserve `emailSent` for compatibility while adding `emailDeliveryStatus` to document responses.
>
> ### 3. Authoritative tax workflow
>
> - Add `POST /api/v1/companies/{companyId}/tax-invoices`, requiring verified identity and `Idempotency-Key`. The request contains only strict `DocumentDataInput`; document type 305 is implicit.
> - Implement one private SQL RPC that validates positive bounded decimal amounts, allocates the `doc_305` counter, inserts document/items/reservation, and creates a durable tax-submission outbox record atomically.
> - Add `submitted` to the tax-authority status enum and shared contract. User-visible states become `reserved`, `submitted`, `approved`, `rejected`, and `failed`; only `approved` may display an approval claim or confirmation number.
> - Add an internal, Google-identity-protected tax-submission drain. It claims submissions, calls `cloudrun-tax` with a stable correlation ID, and processes immediate results through the same idempotent result function used by callbacks.
> - Verify during certification whether the authority guarantees correlation-ID idempotency. Ambiguous timeouts remain `submission_unknown` and require reconciliation rather than blind retry.
> - An approved result atomically records the confirmation number and enqueues PDF generation. Rejected/failed submissions never generate a final tax invoice PDF.
> - Remove `getInvoiceApproval` and the 501 Edge callback after mobile cutover.
> - Production enablement requires: sandbox contract tests, callback replay/conflict tests, authority idempotency verification, security review, accounting/legal sign-off, and a controlled production canary.
>
> ### 4. Complete mobile Cloud API cutover
>
> - Add the missing API surfaces:
>   - `GET /api/v1/companies/{companyId}/jobs/{jobId}` returning parts and attachment metadata.
>   - `GET /api/v1/companies/{companyId}/jobs/{jobId}/attachments/{attachmentId}/download`.
>   - `GET /api/v1/companies/{companyId}/archives/{archiveRunId}/download`.
>   - `GET /api/v1/companies/{companyId}/documents/{documentId}` for authoritative document/tax/email state.
> - Move online job attachments to the existing signed Supabase upload-session protocol; remove direct Firebase Storage upload/delete calls.
> - Replace remaining Edge calls for job create/update/accept/delete, preview, tax, archives, invitations, and upgrades with typed Cloud API clients.
> - Delete the unused `updateCacheV1`/`updateInventoryV1` version hook; server mutations remain the sole source of sync-version changes.
> - Split the Firebase compatibility file into Supabase auth transport and Firebase Messaging/Crashlytics modules. Remove callable and Storage exports plus `@react-native-firebase/storage`; retain FCM.
> - Centralize request deadlines, cancellation, typed error parsing, single-flight token refresh, retry policy, and tenant-scoped React Query invalidation.
> - Remove dead cache-fetcher stubs and migrate consumers to bounded cursor queries rather than full-collection drains.
> - Ship the new binary through staged store rollout. Keep a compatibility Edge deployment until 99% of active installations use the new API version and legacy business traffic is zero for 30 days; then remove Edge code, deploy secrets, and `EXPO_PUBLIC_EDGE_FUNCTIONS_BASE_URL`.
>
> ### 5. Archive, performance, session, and abuse hardening
>
> - Replace mutable per-company GCS manifests with leased database archive runs. Store snapshot time, segment, checksum, GCS generation, counts, and lease expiry.
> - Use advisory locking plus GCS `ifGenerationMatch` preconditions. Allow later segments for late-arriving historical rows; an empty run never permanently closes a month.
> - Store a verified companion ID manifest and delete source rows in bounded 500-row chunks. Resume from the verified object after worker loss.
> - Bound archive page size and company concurrency; use one task, 60-minute timeout, and two retries initially.
> - Profile a synthetic large tenant before indexing. Where thresholds fail, add generated normalized search text plus `pg_trgm` GIN indexes for jobs/documents and a trigram index for inventory names. Targets: list p95 under 300 ms and search p95 under 500 ms at 100k jobs/50k documents.
> - Resolve web sessions without a write lock when tokens are safely valid; acquire and recheck under `FOR UPDATE` only inside the refresh window.
> - Replace fixed contact arithmetic with server-verified reCAPTCHA Enterprise. Apply Cloud Armor IP throttles to auth/contact routes, generic account-recovery responses, bounded upstream response reads, and request deadlines.
> - Strengthen readiness to verify expected schema version, required RPC privileges, mandatory publisher configuration, and initialized storage clients; keep liveness dependency-free.
> - Keep Chromium inside Cloud Run’s sandboxed runtime, prohibit arbitrary navigation/URLs, run non-root, and document `--no-sandbox` as a reviewed compensating-control exception.
>
> ### 6. Web/mobile quality and maintainability
>
> - Website:
>   - Add focus capture/trap/restore, background inertness, and scroll locking to modal behavior.
>   - Add skip navigation, table header scopes, accessible error announcements, RTL-aware formatting, and consistent `Intl` dates/currency.
>   - Add AbortController deadlines to server Auth calls.
>   - Implement consent-aware GA4 without PII or remove the no-op analytics abstraction.
> - Mobile:
>   - Add modal/alert semantics, labels/hints/states for shared inputs and controls, and screen-reader announcements for errors.
>   - Correct all mojibake with verified UTF-8 Hebrew/Arabic fixtures.
>   - Set automatic light/dark appearance and responsive tablet/landscape layout.
>   - Replace direct console calls with the project logger and redact identifiers.
>   - Decompose the oversized document, client, job, and inventory screens into state-machine/API, form, and presentation modules without changing behavior.
> - Enable strict TypeScript one package at a time: contracts, database, archiver, PDF, then new email service. Remove `any` from public boundaries before enabling each package.
> - Remove stale `db_errors.txt` and dormant legacy website token code after usage verification.
>
> ### 7. Dependencies, CI, and documentation
>
> - Resolve npm audit findings through supported patch upgrades. For Expo-only transitive findings without compatible fixes, record a time-limited risk exception with owner, reachability, compensating controls, and 30-day review date; never use `--force`.
> - Fix syntax checking to include `.mjs`; rewrite the performance guard against current paths and make verified checks blocking.
> - CI must run:
>   - Every unit test, typecheck, lint, build, Deno check/test, database unit/integration test, and `supabase db lint`.
>   - Mandatory Playwright core journeys and Maestro login/tenant/job/offline flows.
>   - CodeQL, secret scanning, lockfile audit, Terraform validate/tflint/security scan, SBOM generation, and container vulnerability scanning.
> - Pin GitHub Actions and container bases by immutable digest. Sign container images with keyless provenance.
> - Replace source-regex-only protection for critical paths with behavioral integration tests.
> - Update existing READMEs, `SETUP.md`, architecture documents, and project summary to the final architecture. Add sanitized per-package environment examples plus concise deployment, rollback, backup restore, secret rotation, DLQ replay, tax reconciliation, email-unknown, archive restore, and mobile-rollout runbooks.
>
> ### 8. Terraform production platform and delivery pipeline
>
> - Add shared Terraform modules and explicit `infra/environments/{dev,staging,prod}` roots with separate state keys.
> - Pre-create project/billing links and a versioned encrypted GCS Terraform state bucket. Terraform owns APIs, Artifact Registry, IAM, VPC/NAT/static egress, Cloud DNS records, managed certificates, load balancer, Cloud Armor, Cloud Run, Pub/Sub, Scheduler, archive/backup buckets, monitoring, and GitHub Workload Identity Federation.
> - Terraform creates Secret Manager containers and IAM only; secret values never enter Terraform state. Supabase, SES, session keys, and signing material are populated out-of-band.
> - Deploy:
>   - Next.js standalone non-root Cloud Run image, min 1.
>   - Main API min 1.
>   - Tax gateway min 1 in `me-west1`.
>   - PDF/email workers min 0 with durable queues.
>   - Archiver as a single-task Cloud Run Job.
>   - Cap aggregate maximum database pools at 70% of the Supabase connection limit.
> - Put website/API/tax callback domains behind the external HTTPS load balancer and Cloud Armor. Keep PDF/email/internal drains private to authenticated Google service identities.
> - Use a dedicated migration Cloud Run Job with the owner/migrator secret. Runtime services never receive migration credentials.
> - CI builds each image once, scans/signs it, and promotes the same digest through staging and production.
> - Deployment sequence: expand-only migration → no-traffic revision → readiness/smoke → 10% traffic → 50% → 100%. Production requires GitHub environment approval.
> - The website uses a parameterized Cloud Run domain, exact production `WEBSITE_ORIGIN`, opaque secure cookies, and the server-only API origin.
>
> ## Public Interfaces and Data Models
>
> - Add shared schemas for:
>   - Tax invoice creation/accepted status and `submitted` authority state.
>   - Canonical document dispatch messages.
>   - Job detail, attachment metadata, and signed download access.
>   - Archive page/download access.
>   - Email delivery status.
>   - Bootstrap capability `taxSubmissionMode`.
> - Add public routes:
>   - Tax invoice submission and document detail/status.
>   - Job detail and exact attachment download.
>   - Archive run download.
>   - Idempotent manual retry for `failed|delivery_unknown` document email, restricted to authorized document roles.
> - Add internal routes:
>   - Tax submission drain.
>   - Document/email outbox drains.
>   - Existing tax callback/session binding remains Google-identity protected.
> - Pub/Sub payloads contain opaque IDs only. Consumers load canonical tenant/user/request state from private SQL RPCs.
> - Preserve existing v1 fields during the mobile adoption window; additions are backward-compatible. Remove legacy Edge paths only after the retirement gate.
>
> ## Verification and Launch Gates
>
> - Critical behavioral tests:
>   - Tax never reports approval or generates a final PDF before confirmed authority acceptance.
>   - Callback and immediate approval replays are idempotent; conflicting payloads fail.
>   - Document tasks authorize numeric/string company representations identically.
>   - Accepted-task timeout/reload resumes the same task and never allocates another number.
>   - Job acceptance consumes parts exactly once under concurrency and rolls back on insufficient stock.
>   - Offline and online attachments survive retry/restart and remain tenant-scoped.
>   - SES duplicate delivery is prevented; ambiguous delivery becomes manual-review state.
>   - Archive overlap, late data, checksum failure, worker loss, and large deletion batches recover safely.
> - Security tests:
>   - Full role × tenant × entitlement matrix.
>   - Cross-tenant attachment/document/archive denial.
>   - Runtime-role grant snapshots.
>   - Auth/contact enumeration, CAPTCHA, rate-limit, timeout, and oversized-response behavior.
>   - No secrets in client bundles, logs, images, Terraform state, or repository.
> - Quality gates:
>   - WCAG 2.2 AA automated checks for website core journeys and manual keyboard/screen-reader review.
>   - VoiceOver/TalkBack smoke tests for login, navigation, forms, alerts, job completion, and Pending Work.
>   - No Critical/High dependency or image vulnerability at release; exceptions allowed only for unreachable Moderate transitive issues with expiry.
> - Operational gates:
>   - Seven-day staging soak with production-like configuration.
>   - Load tests meet 99.9% SLO/error-budget and latency targets.
>   - Document queue, email queue, tax submissions, callbacks, archive failures, DB pool saturation, and session-refresh failures have dashboards and alerts.
>   - Quarterly restore drill proves RPO 15 minutes/RTO 4 hours.
>   - Production mobile rollout: 10% for 24 hours, 50% for 48 hours, then 100% if crash-free sessions and API error budget remain healthy.
>   - Tax remains `disabled` in production at platform launch.
>
> ## Assumptions and Fixed Defaults
>
> - There is no live production customer data; the first production database is created cleanly from migrations.
> - GCP projects and billing links are supplied before Terraform execution.
> - Supabase production uses a paid tier supporting the selected PITR/recovery posture.
> - FCM and Crashlytics remain; Firebase Auth, Functions, Firestore, and Storage are not production business-data paths.
> - AWS SES is configured in an EU region with verified domain, DKIM/SPF/DMARC, production sending access, bounce/complaint handling, and no credentials in source.
> - Legal counsel supplies final tax/document retention periods and privacy wording; launch is blocked until those values are configured and documented.
> - No payment processing is introduced.
> - The repository remains intentionally package-by-package with no root npm workspace.
> - Database migrations are expand-only during launch; application rollback uses the prior signed image digest, while database recovery uses forward fixes or PITR rather than destructive down migrations.

<details><summary>34 previous messages</summary>

> I’m starting with Batch 0 only, as requested by the original “small, reviewable batches” rule. This batch will: fail-close tax submission, fix document tenant-ID normalization, repair offline upload idempotency, preserve accepted document-task identity through retries, and remove the two direct high-severity dependency exposures. I’ll touch only those paths plus focused regression tests, then run the relevant package checks before moving to the next batch.
>
> Context compaction
>
> Source: automatic
> Status: completed
>
> I’m using the Supabase, Next.js, and Expo data-fetching guidance because this batch changes an Edge configuration gate, a Next.js client-side retry path, and mobile API retry behavior. I’ll keep those changes within the existing security and state-management conventions.
>
> <details><summary>Ran 11 commands, searched the web</summary>
>
> - Ran `Get-Content -Raw -LiteralPath 'C:\Users\Amjad\.codex\plugins\cache\openai-curated-remote\vercel\1.0.0\skills\nextjs\SKILL.md'`
>
> - Ran `Get-Content -Raw -LiteralPath 'C:\Users\Amjad\.codex\plugins\cache\openai-curated-remote\expo\1.0.2\skills\native-data-fetching\SKILL.md'`
>
> - Ran `Get-Content -Raw -LiteralPath 'C:\Users\Amjad\.codex\plugins\cache\openai-curated-remote\supabase\1.0.0\skills\supabase\SKILL.md'`
>
> - Ran `(Get-Content -LiteralPath 'C:\Users\Amjad\.codex\plugins\cache\openai-curated-remote\vercel\1.0.0\skills\nextjs\SKILL.md').Count`
>
> - Ran `(Get-Content -LiteralPath 'C:\Users\Amjad\.codex\plugins\cache\openai-curated-remote\supabase\1.0.0\skills\supabase\SKILL.md').Count`
>
> - Ran `(Get-Content -LiteralPath 'C:\Users\Amjad\.codex\plugins\cache\openai-curated-remote\expo\1.0.2\skills\native-data-fetching\SKILL.md').Count`
>
> - Ran `$lines = Get-Content -LiteralPath 'C:\Users\Amjad\.codex\plugins\cache\openai-curated-remote\vercel\1.0.0\skills\nextjs\SKILL.md'; $lines[0..249]`
>
> - Ran `$lines = Get-Content -LiteralPath 'C:\Users\Amjad\.codex\plugins\cache\openai-curated-remote\vercel\1.0.0\skills\nextjs\SKILL.md'; $lines[250..499]`
>
> - Ran `$lines = Get-Content -LiteralPath 'C:\Users\Amjad\.codex\plugins\cache\openai-curated-remote\vercel\1.0.0\skills\nextjs\SKILL.md'; $lines[500..744]`
>
> - Ran `$lines = Get-Content -LiteralPath 'C:\Users\Amjad\.codex\plugins\cache\openai-curated-remote\expo\1.0.2\skills\native-data-fetching\SKILL.md'; $lines[0..249]`
>
> - Ran `$lines = Get-Content -LiteralPath 'C:\Users\Amjad\.codex\plugins\cache\openai-curated-remote\expo\1.0.2\skills\native-data-fetching\SKILL.md'; $lines[250..506]`
>
> <details><summary>Searched the web</summary>
>
> - Searched the web for `https://supabase.com/changelog.md`
> - Searched the web for `site:supabase.com/changelog breaking change edge functions environment variables 2026 ...`
>
> </details>
>
> </details>
>
> The guidance confirms the gate belongs in server-side Edge configuration, with any Expo environment value used only for user messaging—not authorization. I’m now tracing the exact retry and persistence paths so the fix resumes accepted work instead of allocating a second document task.
>
> <details><summary>Ran 106 commands</summary>
>
> - Ran `rg -n "TAX_|Deno\.env|getEnv|Environment|env:" supabase/shared-edge-helpers.ts supabase/handlers supabase/functions supabase/*.ts`
> - Ran `rg -n -C 5 "getInvoiceApproval|Tax Authority|tax authority|approved|reserved" phone_app/modules/documents phone_app/screens/CreateDocument.tsx supabase/handlers/tax.ts`
> - Ran `rg -n -C 5 "pending|taskId|poll|timeout|actionKeys|sessionStorage|MMKV" website/src/components/documents/document-create-control.tsx phone_app/hooks/useDocumentTask.ts phone_app/modules/documents/lib/document-action-keys.ts`
> - Ran `rg -n -C 5 "idempotencyKey|upload.*session|job-attachments|operation" phone_app/lib/outbox/processor.ts phone_app/lib/outbox phone_app/tests`
> - Ran `rg -n -C 5 "companyId|requesterProfile|previewDocument|generateDocument" cloudrun-pdf/index.ts cloudrun-pdf/access-store.ts cloudrun-pdf/tests cloudrun-api/src cloudrun-api/tests`
> - Ran `rg -n "createMMKV|MMKV|sessionStorage|localStorage" phone_app website/src | Select-Object -First 250`
> - Ran `Get-Content -Raw packages/db/package.json; Get-Content -Raw cloudrun-pdf/package.json; Get-Content -Raw cloudrun-pdf/tsconfig.json; Get-ChildItem cloudrun-pdf/tests; git status --short`
> - Ran `rg -n -C 5 "getInvoiceApproval|Tax Authority|tax authority|approved|reserved" phone_app/modules/documents phone_app/screens/CreateDocument.tsx supabase/handlers/tax.ts`
> - Ran `rg -n -C 5 "pending|taskId|poll|timeout|actionKeys|sessionStorage|MMKV" website/src/components/documents/document-create-control.tsx phone_app/hooks/useDocumentTask.ts phone_app/modules/documents/lib/document-action-keys.ts`
> - Ran `rg -n -C 5 "idempotencyKey|upload.*session|job-attachments|operation" phone_app/lib/outbox/processor.ts phone_app/lib/outbox phone_app/tests`
> - Ran `rg -n -C 5 "companyId|requesterProfile|previewDocument|generateDocument" cloudrun-pdf/index.ts cloudrun-pdf/access-store.ts cloudrun-pdf/tests cloudrun-api/src cloudrun-api/tests`
> - Ran `rg -n "createMMKV|MMKV|sessionStorage|localStorage" phone_app website/src`
> - Ran `git status --short`
> - Ran `Get-Content -Raw packages/db/package.json`
> - Ran `Get-Content -Raw cloudrun-pdf/package.json`
> - Ran `Get-ChildItem cloudrun-pdf/tests | Select-Object Name,Length`
> - Ran `rg -n "type EdgeFunctionContext|interface EdgeFunctionContext|export type EdgeFunctionContext|export interface EdgeFunctionContext" supabase`
> - Ran `$lines=Get-Content supabase/shared-edge-helpers.ts; $lines[0..85]`
> - Ran `$lines=Get-Content supabase/functions/mutation-gateway-me-west1/index.ts; $lines[0..130]`
> - Ran `rg -n "getInvoiceApproval|mutation-gateway-me-west1|tax submission|TAX_SUBMISSION_MODE" supabase/handlers/*.test.ts supabase/**/*.test.ts`
> - Ran `$lines=Get-Content supabase/handlers/tax.ts; $lines[0..345]`
> - Ran `$lines=Get-Content supabase/handlers/handlers-hardening.test.ts; $lines[0..140]`
> - Ran `$lines=Get-Content supabase/handlers/handlers-hardening.test.ts; $start=[Math]::Max(0,$lines.Count-180); $lines[$start..($lines.Count-1)]`
> - Ran `$lines=Get-Content supabase/shared-edge-helpers.ts; $lines[285..335]`
> - Ran `Get-Content -Raw deno.json`
> - Ran `rg -n -C 4 "supabase_edge|deno test|deno check" .github/workflows/ci.yml`
> - Ran `rg --files cloudrun-tax | Sort-Object`
> - Ran `rg -n -C 5 "NODE_ENV|TAX_|config|approval|callback" cloudrun-tax/src cloudrun-tax/tests cloudrun-tax/README.md`
> - Ran `Get-Content -Raw cloudrun-tax/package.json`
> - Ran `$lines=Get-Content cloudrun-tax/src/app.ts; $lines[140..270]`
> - Ran `Get-Content -Raw cloudrun-tax/src/config.ts`
> - Ran `Get-Content -Raw cloudrun-tax/tests/config.test.ts`
> - Ran `$lines=Get-Content cloudrun-tax/tests/app.test.ts; $lines[0..95]`
> - Ran `rg -n -C 6 "POST /api/v1/tax/approval|approval" cloudrun-tax/tests/app.test.ts`
> - Ran `Get-Content -Raw cloudrun-tax/src/runtime.ts`
> - Ran `Get-Content -Raw cloudrun-tax/src/errors.ts`
> - Ran `$lines=Get-Content cloudrun-tax/README.md; $lines[30..90]`
> - Ran `$lines=Get-Content cloudrun-tax/tests/app.test.ts; $lines[420..535]`
> - Ran `$lines=Get-Content cloudrun-pdf/index.ts; $lines[0..115]`
> - Ran `$lines=Get-Content cloudrun-pdf/index.ts; $lines[145..260]`
> - Ran `$lines=Get-Content cloudrun-pdf/index.ts; $lines[320..455]`
> - Ran `$lines=Get-Content cloudrun-pdf/access-store.ts; $lines[0..125]`
> - Ran `Get-Content -Raw cloudrun-pdf/tests/process-generate-hardening.test.js`
> - Ran `Get-Content -Raw cloudrun-pdf/tests/security-source.test.js`
> - Ran `rg -n -C 8 "document.*task|publisher|companyId: 77|preview.*topic|generate.*topic" cloudrun-api/src/tests cloudrun-api/src`
> - Ran `Get-Content -Raw cloudrun-pdf/tsconfig.json`
> - Ran `Get-Content -Raw cloudrun-pdf/tests/security-source.test.js`
> - Ran `Get-Content -Raw cloudrun-api/src/document-task-publisher.ts`
> - Ran `$lines=Get-Content cloudrun-api/src/tests/documents-mutations.test.ts; $lines[120..205]`
> - Ran `rg -n -C 10 "jsonb_build_object\(|companyId" packages/db/migrations/0022_api_document_tasks.sql`
> - Ran `rg --files cloudrun-api/src | rg "document|publish|outbox"`
> - Ran `rg -n "publishPreview|publishGenerate|DocumentTaskPublisher|request_payload|dispatchPayload|PubSub" cloudrun-api/src`
> - Ran `rg -n "getUserProfileForCompany\(|resolveSqlCompanyStorageContext\(|resolveSqlDocumentStorageContext\(" cloudrun-pdf/index.ts`
> - Ran `Get-Content -Raw cloudrun-api/src/tests/document-dispatch.test.ts`
> - Ran `Get-Content -Raw cloudrun-api/src/documents/dispatch.ts`
> - Ran `Get-Content -Raw cloudrun-api/src/documents/pubsub-publisher.ts`
> - Ran `Get-Content -Raw phone_app/lib/outbox/processor.ts`
> - Ran `rg -n -C 8 "interface.*Outbox|type.*Outbox|idempotencyKey|operationId|job\.create_finished|attachments" phone_app/lib/outbox`
> - Ran `rg -n -C 6 "createUpload|upload.*session|Idempotency-Key|idempotencyKey" phone_app/lib phone_app/modules | Select-Object -First 400`
> - Ran `rg -n -C 6 "processor|upload.*session|idempotency-key|attachments" phone_app/tests/*.test.mts`
> - Ran `$lines=Get-Content cloudrun-api/src/routes/upload-sessions.ts; $lines[0..225]`
> - Ran `rg --files phone_app/tests | rg "outbox|offline|job"`
> - Ran `rg -n -C 5 "apiOutboxTransport|synchronizeOutbox|UPLOAD_SESSION|job-attachments/sessions|idempotencyKey" phone_app/tests`
> - Ran `$lines=Get-Content phone_app/lib/outbox/database.ts; $lines[0..75]`
> - Ran `rg -n -C 8 "export async function requestApi|idempotencyKey" phone_app/lib/api/client.ts`
> - Ran `Get-Content -Raw phone_app/tests/finished-job-outbox-model.test.mts`
> - Ran `Get-Content -Raw phone_app/tests/outbox-policy.test.mts`
> - Ran `Get-Content -Raw phone_app/tsconfig.json`
> - Ran `Get-Content -Raw phone_app/package.json`
> - Ran `Get-Content -Raw phone_app/modules/documents/lib/document-action-keys.ts`
> - Ran `$lines=Get-Content phone_app/hooks/useDocumentTask.ts; $lines[0..190]`
> - Ran `$lines=Get-Content phone_app/hooks/useDocumentTask.ts; $lines[191..380]`
> - Ran `$lines=Get-Content website/src/components/documents/document-create-control.tsx; $lines[0..180]`
> - Ran `$lines=Get-Content website/src/components/documents/document-create-control.tsx; $lines[181..380]`
> - Ran `Get-Content -Raw phone_app/modules/documents/lib/documents-api.ts`
> - Ran `rg -n -C 6 "createDocument|document-tasks|pollDocument|taskId|idempotencyKey" website/src/components/documents website/src/lib website/src/app/api`
> - Ran `$lines=Get-Content website/src/components/documents/document-create-control.tsx; $lines[130..275]`
> - Ran `$lines=Get-Content website/src/components/documents/document-create-control.tsx; $lines[276..($lines.Count-1)]`
> - Ran `Get-Content -Raw website/src/components/documents/document-mutation-model.ts`
> - Ran `rg -n -C 5 "DocumentCreateControl|document-create-control|documentMutationKey|PendingDocumentMutation" website/tests website/src/**/*.test.*`
> - Ran `Get-Content -Raw phone_app/tests/documents-api-model.test.mts`
> - Ran `Get-Content -Raw phone_app/contexts/mmkv-storage.ts`
> - Ran `rg -n -C 4 "setMmkvScope" phone_app`
> - Ran `rg -n -C 4 "useDocumentTask\(|\.reset\(|resetTask|resetDocument" phone_app/modules phone_app/screens phone_app/components phone_app/hooks | Select-Object -First 400`
> - Ran `rg -n "new StableDocumentActionKeys|StableDocumentActionKeys" phone_app`
> - Ran `rg -n -C 4 "resetTask" phone_app/modules/documents/screens/CreateDocument.tsx`
> - Ran `rg -n -C 5 "setMmkvScope" phone_app`
> - Ran `rg -n "StableDocumentActionKeys" phone_app`
> - Ran `$lines=Get-Content phone_app/modules/documents/screens/CreateDocument.tsx; $lines[540..625]`
> - Ran `$lines=Get-Content phone_app/modules/documents/hooks/useTaxInvoiceSubmission.ts; $lines[90..190]`
> - Ran `rg -n -C 4 "useTaxInvoiceSubmission|handleSubmitInvoice|getInvoiceApproval|Tax Authority" phone_app/modules/documents/screens/CreateDocument.tsx`
> - Ran `$lines=Get-Content phone_app/modules/documents/hooks/useTaxInvoiceSubmission.ts; $lines[0..105]`
> - Ran `$lines=Get-Content phone_app/modules/documents/hooks/useTaxInvoiceSubmission.ts; $lines[320..510]`
> - Ran `rg -n -C 4 "TaxApprovalResponseData|PendingTaxInvoice|confirmationNumber" phone_app/modules/documents`
> - Ran `$lines=Get-Content phone_app/modules/documents/screens/CreateDocument.tsx; $lines[730..930]`
> - Ran `rg -n "middleEastFunctions|httpsCallable|generateUuid" phone_app/modules/documents/screens/CreateDocument.tsx`
> - Ran `$lines=Get-Content phone_app/modules/documents/screens/CreateDocument.tsx; $lines[0..90]`
> - Ran `rg -n "middleEastFunctions|httpsCallable|generateUuid" phone_app/modules/documents/hooks/useTaxInvoiceSubmission.ts`
> - Ran `rg -n -C 5 "tax invoice|Tax invoice|Tax Authority|tax-authority" website/src`
> - Ran `rg -n "useTaxInvoiceSubmission" phone_app --glob '!modules/documents/hooks/useTaxInvoiceSubmission.ts'`
> - Ran `rg -n -C 4 "pendingTaxInvoice|handleSubmitInvoice|previewLoading" phone_app/modules/documents/screens/GenerateTaxInvoice.tsx`
> - Ran `$lines=Get-Content phone_app/modules/documents/screens/CreateDocument.tsx; $lines[800..930]`
> - Ran `rg -n "pendingTaxInvoice" phone_app`
> - Ran `rg -n "showSuccessMessage|showWarningMessage|showInfoMessage|showErrorMessage|showValidationError|listenToTask" phone_app/modules/documents/hooks/useTaxInvoiceSubmission.ts`
> - Ran `rg -n "showSuccessMessage|listenToTask|generateUuid|middleEastFunctions|httpsCallable" phone_app/modules/documents/screens/CreateDocument.tsx`
> - Ran `rg -n "AlertButton" phone_app/modules/documents/hooks/useTaxInvoiceSubmission.ts`
>
> </details>
>
> The tax path has two independent risks: the legacy Edge handler mutates data without contacting the authority, and the Cloud Run gateway can submit whenever credentials exist. I’m disabling the legacy handler outright and adding a validated mode gate to the gateway; callbacks remain available for eventual reconciliation, while outbound approval is blocked by default.
>
> <details><summary>Created 3 files, edited 19 files, ran 10 commands</summary>
>
> - Wrote `./supabase/handlers/handlers-hardening.test.ts` (+18 -9)
> - Wrote `./supabase/handlers/tax.ts` (+35 -0)
> - Wrote `./supabase/shared-edge-helpers.ts` (+16 -5)
> - Wrote `./cloudrun-tax/src/app.ts` (+8 -1)
> - Wrote `./cloudrun-tax/src/config.ts` (+10 -2)
> - Wrote `./cloudrun-tax/src/errors.ts` (+9 -0)
> - Wrote `./cloudrun-tax/tests/config.test.ts` (+18 -3)
> - Wrote `./cloudrun-tax/tests/app.test.ts` (+6 -1)
> - Wrote `./cloudrun-tax/tests/app.test.ts` (+40 -1)
> - Wrote `./cloudrun-tax/README.md` (+7 -4)
> - Ran `$lines=Get-Content phone_app/modules/documents/screens/CreateDocument.tsx; $lines[803..925]`
> - Wrote `./phone_app/modules/documents/lib/tax-submission-status.ts` (+4 -0)
> - Wrote `./phone_app/modules/documents/screens/CreateDocument.tsx` (+15 -126)
> - Ran `$lines=Get-Content phone_app/modules/documents/hooks/useTaxInvoiceSubmission.ts; $lines[100..200]`
> - Wrote `./phone_app/modules/documents/hooks/useTaxInvoiceSubmission.ts` (+18 -35)
> - Ran `$bytes = [System.IO.File]::ReadAllBytes((Resolve-Path 'phone_app/modules/documents/hooks/useTaxInvoiceSubmission.ts')); [Convert]::ToBase64String($bytes)`
> - Ran `$bytes = [System.IO.File]::ReadAllBytes((Resolve-Path 'phone_app/modules/documents/hooks/useTaxInvoiceSubmission.ts')); [Convert]::ToBase64String($bytes)`
> - Ran `$text = [System.IO.File]::ReadAllText((Resolve-Path 'phone_app/modules/documents/hooks/useTaxInvoiceSubmission.ts'), [System.Text.Encoding]::UTF8); ConvertTo-Json $text -Compress`
> - Wrote `./phone_app/modules/documents/hooks/useTaxInvoiceSubmission.ts` (+262 -0)
> - Ran `$lines=Get-Content phone_app/modules/documents/screens/GenerateTaxInvoice.tsx; $lines[815..850]`
> - Wrote `./phone_app/modules/documents/screens/GenerateTaxInvoice.tsx` (+3 -4)
> - Ran `rg -n -C 3 "TAX_AUTH_URL|TAX_TOKEN_URL|Tax invoice approval|getInvoiceApproval|tax-authority workflow" AGENTS.md SETUP.md PROJECT_SUMMARY.md README.md phone_app/README.md supabase/README.md cloudrun-tax/README.md website/src/lib/docs.ts website/src/lib/documents/document-mutation-route-core.ts website/src/components/documents/document-create-control.tsx`
> - Ran `rg -n "getInvoiceApproval|Tax Authority Approved|Tax invoice approved|middleEastFunctions" phone_app/modules/documents`
> - Ran `$lines=Get-Content phone_app/modules/documents/hooks/useTaxInvoiceSubmission.ts; $lines[0..130]`
> - Ran `rg -n "taxSubmissionMode|TAX_SUBMISSION_MODE|Production requires" cloudrun-tax/src cloudrun-tax/tests`
> - Wrote `./AGENTS.md` (+3 -2)
> - Wrote `./PROJECT_SUMMARY.md` (+1 -0)
> - Wrote `./README.md` (+2 -2)
> - Wrote `./SETUP.md` (+3 -2)
> - Wrote `./phone_app/README.md` (+2 -1)
> - Wrote `./website/src/components/documents/document-create-control.tsx` (+5 -6)
> - Wrote `./website/src/lib/docs.ts` (+1 -1)
> - Wrote `./website/src/lib/documents/document-mutation-route-core.ts` (+4 -4)
>
> </details>
>
> The tenant-ID failure is a representation mismatch, not an authorization-policy gap: Postgres emits a numeric public ID, Pub/Sub preserves it as a number, and the PDF SQL profile returns a string. I’m canonicalizing both values to one validated decimal form before any profile or storage lookup, then testing the JSON round trip and cross-tenant rejection.
>
> <details><summary>Created 3 files, edited 10 files, ran 3 commands</summary>
>
> - Wrote `./cloudrun-pdf/access-store.ts` (+7 -5)
> - Wrote `./cloudrun-pdf/company-id.ts` (+17 -0)
> - Wrote `./cloudrun-pdf/index.ts` (+19 -16)
> - Wrote `./cloudrun-pdf/tests/company-id.test.js` (+22 -0)
> - Wrote `./cloudrun-pdf/tests/security-source.test.js` (+4 -2)
> - Wrote `./cloudrun-pdf/tsconfig.json` (+1 -0)
> - Wrote `./phone_app/lib/outbox/idempotency.ts` (+10 -0)
> - Wrote `./phone_app/lib/outbox/processor.ts` (+2 -0)
> - Wrote `./phone_app/tests/outbox-policy.test.mts` (+15 -0)
> - Ran `$lines=Get-Content website/tests/document-mutation-route.test.mts; $lines[0..125]`
> - Wrote `./website/src/components/documents/document-mutation-model.ts` (+74 -1)
> - Wrote `./website/src/components/documents/document-create-control.tsx` (+71 -5)
> - Wrote `./website/src/components/documents/document-create-control.tsx` (+7 -7)
> - Ran `rg -n -C 5 "TAX_WORKFLOW_REQUIRED|TAX_SUBMISSION|documentType: 305|tax" website/tests/document-mutation-route.test.mts website/tests`
> - Ran `Get-Content -Raw website/tests/tenant-document-mutations-source.test.mts`
> - Wrote `./website/tests/document-mutation-route.test.mts` (+40 -4)
> - Wrote `./website/tests/tenant-document-mutations-source.test.mts` (+6 -3)
>
> </details>
>
> For accepted document tasks, I’m persisting only opaque task metadata—not auth tokens or document contents. Website state is scoped to the tab and tenant via `sessionStorage`; mobile uses a separate MMKV database keyed by user, tenant, and action so ordinary cache clearing cannot erase an in-flight task.
>
> <details><summary>Created 2 files, edited 3 files, ran 2 commands</summary>
>
> - Wrote `./phone_app/modules/documents/lib/document-action-keys.ts` (+4 -0)
> - Wrote `./phone_app/modules/documents/lib/document-task-attempt.ts` (+41 -0)
> - Wrote `./phone_app/modules/documents/lib/document-task-persistence.ts` (+56 -0)
> - Wrote `./phone_app/hooks/useDocumentTask.ts` (+7 -5)
> - Wrote `./phone_app/hooks/useDocumentTask.ts` (+48 -15)
> - Ran `$lines=Get-Content phone_app/hooks/useDocumentTask.ts; $lines[250..385]`
> - Wrote `./phone_app/hooks/useDocumentTask.ts` (+58 -2)
> - Ran `$lines=Get-Content phone_app/hooks/useDocumentTask.ts; $lines[385..455]`
> - Wrote `./phone_app/hooks/useDocumentTask.ts` (+13 -6)
> - Wrote `./phone_app/tests/documents-api-model.test.mts` (+58 -1)
>
> </details>
>
> Batch 0 behavior is now wired: outbound tax calls are blocked by default, the legacy reservation handler has no mutation code, numeric/string tenant IDs are canonicalized, upload sessions derive a stable retry key, and accepted document tasks persist across reloads/restarts. I’m doing a first compile/test pass now before touching lockfiles, so dependency updates don’t obscure code regressions.
>
> <details><summary>Edited a file, ran 7 commands</summary>
>
> - Ran `npm run typecheck`
> - Ran `npm run typecheck`
> - Ran `npm run typecheck`
> - Ran `npm run typecheck`
> - Ran `deno check --config deno.json supabase/shared-edge-helpers.ts supabase/functions/mutation-gateway-me-west1/index.ts supabase/handlers/tax.ts`
> - Wrote `./cloudrun-pdf/package.json` (+1 -1)
> - Ran `npm install "drizzle-orm@^0.45.2" --save`
> - Ran `npm install`
>
> </details>
>
> The two targeted packages are upgraded, but npm still reports two high-severity findings in the PDF package and four moderate findings in the DB toolchain. I’m inspecting reachability and available non-breaking fixes now; I won’t use `--force` or disturb the pinned Expo stack.
>
> <details><summary>Edited a file, ran 24 commands</summary>
>
> - Ran `npm audit --json`
> - Ran `npm audit --json`
> - Ran `npm ls drizzle-orm basic-ftp`
> - Ran `npm audit fix --dry-run --json`
> - Ran `npm view qs version`
> - Ran `npm view basic-ftp version`
> - Ran `npm view express@4 version --json`
> - Ran `npm view google-auth-library version`
> - Ran `npm view basic-ftp@5 version --json`
> - Ran `npm view google-auth-library@9 version --json`
> - Ran `npm view gaxios@6 version --json`
> - Ran `npm explain basic-ftp`
> - Ran `npm explain uuid`
> - Wrote `./cloudrun-pdf/package.json` (+3 -3)
> - Ran `npm install`
> - Ran `npm ls drizzle-orm drizzle-kit`
> - Ran `npm ls basic-ftp express qs`
> - Ran `npm audit --omit=dev --audit-level=high`
> - Ran `npm audit --omit=dev --audit-level=high`
> - Ran `npm audit fix --dry-run --json`
> - Ran `git status --short`
> - Ran `git diff --stat`
> - Ran `git diff --check`
> - Ran `rg -n "getInvoiceApproval|Tax Authority Approved|Tax invoice approved" phone_app/modules/documents website/src supabase/handlers/tax.ts`
> - Ran `rg -n '"drizzle-orm"|"basic-ftp"|"express"|"qs"' packages/db/package.json cloudrun-pdf/package.json packages/db/package-lock.json cloudrun-pdf/package-lock.json | Select-Object -First 40`
>
> </details>
>
> Context compaction
>
> Source: automatic
> Status: completed
>
> Batch 0 is implemented; I’m at the verification boundary now. I’ll re-check the exact diff, then run the package, Deno, lint, build, and repository guard suites. I’ll fix only regressions caused by this batch and stop before the migration/schema work in Batch 1.
>
> <details><summary>Edited 3 files, ran 13 commands</summary>
>
> - Ran `git status --short; git diff --check; git diff --stat`
> - Ran `$targets = @('packages/db/package.json','packages/db/package-lock.json','phone_app/modules/documents/hooks/useTaxInvoiceSubmission.ts','phone_app/lib/outbox/processor.ts'); foreach ($target in $targets) { Write-Output "=== $target"; git diff -- $target }`
> - Ran `rg -n "getInvoiceApproval|Tax Authority Approved|Tax invoice approved|confirmationNumber.*Pending callback|TAX_SUBMISSION_MODE|attachmentUploadSessionIdempotencyKey|readPersistedDocumentTaskAttempt|persistDocumentTaskAttempt" phone_app website supabase cloudrun-tax cloudrun-pdf; git diff -- cloudrun-pdf/company-id.ts cloudrun-pdf/access-store.ts cloudrun-pdf/index.ts cloudrun-pdf/tests/company-id.test.js; git diff -- phone_app/hooks/useDocumentTask.ts phone_app/modules/documents/lib/document-task-attempt.ts phone_app/modules/documents/lib/document-task-persistence.ts; git diff -- website/src/components/documents/document-create-control.tsx website/src/components/documents/document-mutation-model.ts`
> - Ran `rg -n -C 6 "function documentMutationKey|export function documentMutationKey|const previewPending|const generatePending|const actionKeys" website/src/components/documents/document-mutation-model.ts website/src/components/documents/document-create-control.tsx phone_app/hooks/useDocumentTask.ts; Get-Content cloudrun-pdf/company-id.ts; Get-Content cloudrun-pdf/tests/company-id.test.js; Get-Content phone_app/modules/documents/lib/document-task-attempt.ts; Get-Content phone_app/modules/documents/lib/document-task-persistence.ts; Get-Content phone_app/lib/outbox/idempotency.ts`
> - Ran `$path='cloudrun-pdf/index.ts'; $lines=Get-Content $path; foreach($start in @(170,320)){ $end=$start+250; Write-Output "=== $start"; for($i=$start;$i -le [Math]::Min($end,$lines.Count);$i++){ if($lines[$i-1] -match 'companyId|normalizedCompanyId'){ '{0,5}: {1}' -f $i,$lines[$i-1] } } }; rg -n "companyId" cloudrun-pdf/*.ts cloudrun-pdf/*.js`
> - Ran `rg -n "document.*publish|publish.*document|Pub/Sub|PubSub|DocumentTask|taskId.*companyId|company_id" cloudrun-api/src cloudrun-api/tests packages/api-contracts/src packages/db/src | Select-Object -First 250`
> - Ran `Get-Content cloudrun-api/src/tests/document-dispatch.test.ts; Get-Content cloudrun-api/src/documents/pubsub-publisher.ts; Get-Content cloudrun-api/src/documents/dispatch.ts | Select-Object -First 230`
> - Ran `$path='phone_app/modules/documents/hooks/useTaxInvoiceSubmission.ts'; $lines=Get-Content $path; for($i=175;$i -le 230;$i++){ '{0,4}:>{1}<' -f $i,$lines[$i-1] }; $path='packages/db/package.json'; $lines=Get-Content $path; for($i=1;$i -le $lines.Count;$i++){ '{0,4}:>{1}<' -f $i,$lines[$i-1] }`
> - Ran `git config --get core.autocrlf; git config --get core.whitespace; rg --files -g '.editorconfig' -g '.gitattributes'; if (Test-Path .gitattributes) { Get-Content .gitattributes }; if (Test-Path .editorconfig) { Get-Content .editorconfig }`
> - Wrote `./packages/db/package-lock.json` (+4 -4)
> - Wrote `./packages/db/package.json` (+2 -2)
> - Wrote `./phone_app/modules/documents/hooks/useTaxInvoiceSubmission.ts` (+6 -7)
> - Wrote `./packages/db/package-lock.json` (+4 -4)
> - Wrote `./packages/db/package.json` (+2 -2)
> - Ran `git diff --check; git diff -- packages/db/package.json packages/db/package-lock.json`
> - Wrote `./packages/db/package.json` (+7 -7)
> - Wrote `./packages/db/package.json` (+6 -6)
> - Ran `git diff --check; git diff -- packages/db/package.json`
> - Ran `Get-Content phone_app/modules/documents/lib/document-action-keys.ts; $path='phone_app/hooks/useDocumentTask.ts'; $lines=Get-Content $path; for($i=65;$i -le 460;$i++){ if($i -le 130 -or $i -ge 250){ '{0,4}: {1}' -f $i,$lines[$i-1] } }`
> - Ran `rg -n -C 5 "function safeJsonParse|export const safeJsonParse|export function safeJsonParse" phone_app/utils phone_app; rg -n "createMMKV" phone_app | Select-Object -First 30; rg -n "clearAll|delete.*MMKV|smart-job-document-tasks" phone_app`
>
> </details>
>
> The static review is clean enough to begin execution checks. One important detail is now covered on both sides of the dispatch boundary: the API test exercises numeric SQL payload serialization into Pub/Sub, and the PDF worker test verifies that the decoded numeric tenant authorizes identically to the SQL string form while rejecting cross-tenant values.
>
> <details><summary>Ran 4 commands</summary>
>
> - Ran `npm test`
> - Ran `npm test`
> - Ran `npm test`
> - Ran `npm test`
>
> </details>
>
> The first verification pass found one test-only regression: TypeScript compiles the new helper call into a CommonJS wrapper, so the source-policy regex no longer matches even though the runtime normalization is present and the behavioral tests pass. I’m tightening that test to assert the imported helper and normalized data flow without depending on compiler output syntax, then I’ll rerun all four suites.
>
> <details><summary>Edited a file, ran 5 commands</summary>
>
> - Ran `Get-Content cloudrun-pdf/tests/security-source.test.js`
> - Wrote `./cloudrun-pdf/tests/security-source.test.js` (+2 -2)
> - Ran `npm test`
> - Ran `npm test`
> - Ran `npm test`
> - Ran `npm test`
>
> </details>
>
> All four changed application suites now pass: Tax 33/33, PDF 18 passed with 3 environment-dependent skips, Website 171/171, and Mobile 112/112. I’m moving to the broader gates now—shared package builds, Cloud API dispatch tests, database tests, lint/build, Expo Doctor, and full Deno validation.
>
> <details><summary>Ran 12 commands</summary>
>
> - Ran `npm run build`
> - Ran `npm run build`
> - Ran `npm run build`
> - Ran `npm test`
> - Ran `npm test`
> - Ran `npm run typecheck`
> - Ran `npm run lint`
> - Ran `npm run build`
> - Ran `npm run doctor`
> - Ran `npm run typecheck`
> - Ran `deno test --config deno.json --allow-read="C:\Users\Amjad\Desktop\ERP-System\supabase,C:\Users\Amjad\Desktop\ERP-System\packages\db\migrations" supabase/handlers/handlers-hardening.test.ts`
> - Ran `$edgeFiles = @('supabase/shared-edge-helpers.ts') + (Get-ChildItem supabase/functions,supabase/handlers -Recurse -Filter *.ts | ForEach-Object { $_.FullName }); deno check --config deno.json $edgeFiles`
>
> </details>
>
> Three broader checks need follow-up:
>
> - The website build is blocked only by a missing local Windows SWC optional binary; TypeScript and lint are green. I’ll repair the local install and rerun the standard build before considering any script change.
> - Expo Doctor correctly found 21 supported SDK 57 patch updates. Batch 0 explicitly calls for supported patches, so I’m using the Expo upgrade guidance now while preserving the pinned React/React DOM 19.2.3 renderer pair.
> - The Deno tests pass 18/18; the full-check command itself flattened PowerShell’s file array into one path, so I’ll rerun it with correct argument expansion.
>
> <details><summary>Ran 3 commands</summary>
>
> - Ran `Get-Content -Raw 'C:\Users\Amjad\.codex\plugins\cache\openai-curated-remote\expo\1.0.2\skills\upgrading-expo\SKILL.md'`
> - Ran `Get-Content phone_app/package.json; Get-ChildItem phone_app -Force | Where-Object { $_.Name -in @('ios','android','patches','babel.config.js','metro.config.js','app.json','app.config.js','app.config.ts') } | Select-Object Name,Mode; rg -n '"react"|"react-dom"|"react-native"|react-native-worklets|sdkVersion|reactCompiler|expo.install' phone_app/package.json phone_app/app.json phone_app/app.config.* phone_app/babel.config.* phone_app/metro.config.*`
> - Ran `npx expo install --fix`
>
> </details>
>
> Expo is applying only SDK 57-compatible patch releases; the install is still running. The project uses Continuous Native Generation (no checked-in `ios/` or `android/` folders), so no native regeneration is appropriate in this batch, and the pinned React renderer pair remains untouched.
>
> <details><summary>Ran 9 commands</summary>
>
> - Ran `git diff -- phone_app/package.json; npm ls expo expo-build-properties expo-camera expo-constants expo-router expo-updates react react-dom react-native --depth=0`
> - Ran `npm ls next @next/swc-win32-x64-msvc --depth=0; npm config get omit; npm config get optional; rg -n 'node_modules/@next/swc-win32-x64-msvc|"@next/swc-win32-x64-msvc"' package-lock.json`
> - Ran `Test-Path node_modules/@next/swc-win32-x64-msvc; Get-ChildItem Env: | Where-Object { $_.Name -match 'NPM_CONFIG_(OMIT|OPTIONAL)' } | Format-Table -AutoSize`
> - Ran `npm ci`
> - Ran `Test-Path node_modules/@next/swc-win32-x64-msvc; npm run build`
> - Ran `npm run doctor`
> - Ran `npm run typecheck`
> - Ran `npm test`
> - Ran `$edgeFiles = @('supabase/shared-edge-helpers.ts') + (Get-ChildItem supabase/functions,supabase/handlers -Recurse -Filter *.ts | ForEach-Object { $_.FullName }); & deno check --config deno.json @edgeFiles`
>
> </details>
>
> The environment issues are resolved without changing build scripts: a clean website install restored the native SWC package and the standard production build now passes. Expo SDK 57 patches are installed, Expo Doctor is 20/20, React/React DOM remain 19.2.3, and the full Deno graph now checks successfully. I’m running final repository guards and vulnerability summaries next.
>
> <details><summary>Edited 2 files, ran 21 commands</summary>
>
> - Ran `npm run typecheck`
> - Ran `node scripts/check-no-ts-nocheck.mjs`
> - Ran `node scripts/check-js-syntax.mjs scripts`
> - Ran `node scripts/check-perf-budget.mjs`
> - Ran `npm test`
> - Ran `function Write-AuditSummary([string]$label, [string[]]$auditArgs) {
>   $raw = & npm audit @auditArgs --json 2>$null | Out-String
>   $audit = $raw | ConvertFrom-Json
>   $counts = $audit.metadata.vulnerabilities
>   Write-Output "$label total=$($counts.total) critical=$($counts.critical) high=$($counts.high) moderate=$($counts.moderate) low=$($counts.low)"
>   if ($audit.vulnerabilities) {
>     $audit.vulnerabilities.PSObject.Properties |
>       Where-Object { $_.Value.severity -in @('critical','high','moderate') } |
>       ForEach-Object { Write-Output "  $($_.Name):$($_.Value.severity)" }
>   }
> }
> Write-AuditSummary 'production' @('--omit=dev')
> Write-AuditSummary 'full' @()
> exit 0`
> - Ran `function Write-AuditSummary([string]$label, [string[]]$auditArgs) {
>   $raw = & npm audit @auditArgs --json 2>$null | Out-String
>   $audit = $raw | ConvertFrom-Json
>   $counts = $audit.metadata.vulnerabilities
>   Write-Output "$label total=$($counts.total) critical=$($counts.critical) high=$($counts.high) moderate=$($counts.moderate) low=$($counts.low)"
>   if ($audit.vulnerabilities) {
>     $audit.vulnerabilities.PSObject.Properties |
>       Where-Object { $_.Value.severity -in @('critical','high','moderate') } |
>       ForEach-Object { Write-Output "  $($_.Name):$($_.Value.severity)" }
>   }
> }
> Write-AuditSummary 'production' @('--omit=dev')
> Write-AuditSummary 'full' @()
> exit 0`
> - Ran `function Write-AuditSummary([string]$label, [string[]]$auditArgs) {
>   $raw = & npm audit @auditArgs --json 2>$null | Out-String
>   $audit = $raw | ConvertFrom-Json
>   $counts = $audit.metadata.vulnerabilities
>   Write-Output "$label total=$($counts.total) critical=$($counts.critical) high=$($counts.high) moderate=$($counts.moderate) low=$($counts.low)"
>   if ($audit.vulnerabilities) {
>     $audit.vulnerabilities.PSObject.Properties |
>       Where-Object { $_.Value.severity -in @('critical','high','moderate') } |
>       ForEach-Object { Write-Output "  $($_.Name):$($_.Value.severity)" }
>   }
> }
> Write-AuditSummary 'production' @('--omit=dev')
> Write-AuditSummary 'full' @()
> exit 0`
> - Ran `function Write-AuditSummary([string]$label, [string[]]$auditArgs) {
>   $raw = & npm audit @auditArgs --json 2>$null | Out-String
>   $audit = $raw | ConvertFrom-Json
>   $counts = $audit.metadata.vulnerabilities
>   Write-Output "$label total=$($counts.total) critical=$($counts.critical) high=$($counts.high) moderate=$($counts.moderate) low=$($counts.low)"
>   if ($audit.vulnerabilities) {
>     $audit.vulnerabilities.PSObject.Properties |
>       Where-Object { $_.Value.severity -in @('critical','high','moderate') } |
>       ForEach-Object { Write-Output "  $($_.Name):$($_.Value.severity)" }
>   }
> }
> Write-AuditSummary 'production' @('--omit=dev')
> Write-AuditSummary 'full' @()
> exit 0`
> - Ran `function Write-AuditSummary([string]$label, [string[]]$auditArgs) {
>   $raw = & npm audit @auditArgs --json 2>$null | Out-String
>   $audit = $raw | ConvertFrom-Json
>   $counts = $audit.metadata.vulnerabilities
>   Write-Output "$label total=$($counts.total) critical=$($counts.critical) high=$($counts.high) moderate=$($counts.moderate) low=$($counts.low)"
>   if ($audit.vulnerabilities) {
>     $audit.vulnerabilities.PSObject.Properties |
>       Where-Object { $_.Value.severity -in @('critical','high','moderate') } |
>       ForEach-Object { Write-Output "  $($_.Name):$($_.Value.severity)" }
>   }
> }
> Write-AuditSummary 'production' @('--omit=dev')
> Write-AuditSummary 'full' @()
> exit 0`
> - Ran `Get-Content package.json; npm outdated`
> - Ran `$raw = npm audit --json 2>$null | Out-String; $audit = $raw | ConvertFrom-Json; foreach ($name in @('next','postcss')) { $item = $audit.vulnerabilities.$name; Write-Output "=== $name"; $item | Select-Object name,severity,isDirect,range,fixAvailable,nodes,via | ConvertTo-Json -Depth 8 }; exit 0`
> - Ran `npm ls postcss --all`
> - Ran `git status --short; git diff --check; git diff --stat; git diff -- phone_app/package.json phone_app/package-lock.json cloudrun-pdf/package.json packages/db/package.json`
> - Ran `git diff -- cloudrun-tax/src/config.ts cloudrun-tax/src/app.ts cloudrun-tax/src/errors.ts supabase/shared-edge-helpers.ts supabase/handlers/tax.ts website/src/lib/documents/document-mutation-route-core.ts phone_app/modules/documents/screens/CreateDocument.tsx phone_app/modules/documents/hooks/useTaxInvoiceSubmission.ts`
> - Ran `rg -n "selectedJobs|selectedPriceProposal|customerCity|customerId" phone_app/modules/documents/hooks/useTaxInvoiceSubmission.ts; rg -n "selectedJobs|selectedPriceProposal" phone_app/modules/documents/screens/GenerateTaxInvoice.tsx; rg -n "TAX_SUBMISSION_UNAVAILABLE" phone_app website cloudrun-tax supabase`
> - Ran `$path='phone_app/hooks/useDocumentTask.ts'; $lines=Get-Content $path; for($i=128;$i -le 266;$i++){ '{0,4}: {1}' -f $i,$lines[$i-1] }`
> - Wrote `./phone_app/hooks/useDocumentTask.ts` (+3 -4)
> - Ran `$path='phone_app/tests/documents-api-model.test.mts'; $lines=Get-Content $path; for($i=115;$i -le 180;$i++){ '{0,4}: {1}' -f $i,$lines[$i-1] }; $path='website/tests/document-mutation-route.test.mts'; $lines=Get-Content $path; for($i=1;$i -le $lines.Count;$i++){ if($i -ge 120 -and $i -le 220){ '{0,4}: {1}' -f $i,$lines[$i-1] } }`
> - Ran `rg -n -C 8 "accepted mobile document|PersistedDocumentTaskAttempt|StableDocumentActionKeys" phone_app/tests/documents-api-model.test.mts; rg -n -C 4 "sessionStorage|clearAttempt|same task|persist" website/tests/tenant-document-mutations-source.test.mts`
> - Wrote `./cloudrun-pdf/tests/company-id.test.js` (+9 -2)
> - Ran `npm test`
> - Ran `npm test`
>
> </details>
>
> The final code-level gates are green. Before closing the batch, I’m doing one reproducibility check with a clean mobile `npm ci` (the CI install path), then a final Expo Doctor/typecheck and diff/secret hygiene pass. This verifies that the updated lockfile—not just the current `node_modules`—is sufficient.
>
> <details><summary>Ran 5 commands</summary>
>
> - Ran `npm ci`
> - Ran `npm run doctor`
> - Ran `npm run typecheck`
> - Ran `npm test`
> - Ran ``$diff = git diff --no-color --unified=0 -- . ':(exclude)**/package-lock.json'; $added = ($diff | Where-Object { $_ -like '+*' -and $_ -notlike '+++*' }) -join "`n"; $patterns = [ordered]@{ 'AWS access key'='AKIA[0-9A-Z]{16}'; 'Supabase secret value'='sb_secret_[A-Za-z0-9_-]{16,}'; 'Google API key'='AIza[0-9A-Za-z_-]{30,}'; 'Private key block'='-----BEGIN [A-Z ]*PRIVATE KEY-----' }; $matches = @(); foreach ($entry in $patterns.GetEnumerator()) { if ($added -match $entry.Value) { $matches += $entry.Key } }; if ($matches.Count -eq 0) { Write-Output 'Changed-line credential scan: no credential-value patterns found.' } else { Write-Output ('Changed-line credential scan flagged types: ' + ($matches -join ', ')) }; git diff --check; Write-Output '=== changed files'; git status --short; Write-Output '=== summary'; git diff --stat``
>
> </details>
>
> <details><summary>Plan</summary>
>
> Batch 0 is implemented and verified. Tax submission fails closed, tenant IDs normalize across dispatch/worker boundaries, upload/document retries are stable across restarts, supported dependency patches are installed, and all relevant checks pass. Schema/migration work remains intentionally deferred to Batch 1.
>
> - [x] Inspect Batch 0 code paths and existing tests
> - [x] Add fail-closed tax mode and truthful web/mobile behavior
> - [x] Normalize PDF document-task tenant IDs across service boundaries
> - [x] Persist upload/document idempotency and accepted task state
> - [x] Apply supported dependency security and Expo patch updates
> - [x] Run package, Deno, build, lint, audit, and repository checks
>
> </details>
</details>

## Batch 0 complete

The immediate release blockers are remediated, but the project is not yet production-ready; Batches 1–8 remain.

Implemented:

- Tax submission now fails closed by default with `TAX_SUBMISSION_MODE=disabled`.
- Legacy tax reservation no longer allocates numbers, creates documents, dispatches PDFs, or claims approval.
- Web and mobile display “pending certification” messaging.
- PDF authorization canonicalizes numeric/string company IDs.
- Offline attachment sessions reuse `<operation-key>:attachments`.
- Accepted document tasks persist in website session storage and mobile MMKV, surviving timeout/restart.
- Drizzle upgraded to `0.45.2`; `basic-ftp` to `5.3.1`; supported Expo 57 patches applied without changing React 19.2.3.
- Documentation and environment requirements updated. Edge configuration follows [Supabase’s environment-variable guidance](https://supabase.com/docs/guides/functions/secrets).

### Review areas

- Tax: [cloudrun-tax](/C:/Users/Amjad/Desktop/ERP-System/cloudrun-tax), [tax.ts](/C:/Users/Amjad/Desktop/ERP-System/supabase/handlers/tax.ts), [shared-edge-helpers.ts](/C:/Users/Amjad/Desktop/ERP-System/supabase/shared-edge-helpers.ts)
- PDF tenancy: [company-id.ts](/C:/Users/Amjad/Desktop/ERP-System/cloudrun-pdf/company-id.ts), [access-store.ts](/C:/Users/Amjad/Desktop/ERP-System/cloudrun-pdf/access-store.ts), [index.ts](/C:/Users/Amjad/Desktop/ERP-System/cloudrun-pdf/index.ts)
- Mobile persistence: [useDocumentTask.ts](/C:/Users/Amjad/Desktop/ERP-System/phone_app/hooks/useDocumentTask.ts), [document-task-persistence.ts](/C:/Users/Amjad/Desktop/ERP-System/phone_app/modules/documents/lib/document-task-persistence.ts), [idempotency.ts](/C:/Users/Amjad/Desktop/ERP-System/phone_app/lib/outbox/idempotency.ts)
- Website persistence: [document-create-control.tsx](/C:/Users/Amjad/Desktop/ERP-System/website/src/components/documents/document-create-control.tsx), [document-mutation-model.ts](/C:/Users/Amjad/Desktop/ERP-System/website/src/components/documents/document-mutation-model.ts)
- Dependencies: `package.json` and lockfiles in `cloudrun-pdf`, `packages/db`, and `phone_app`
- Documentation: [README.md](/C:/Users/Amjad/Desktop/ERP-System/README.md), [SETUP.md](/C:/Users/Amjad/Desktop/ERP-System/SETUP.md), [PROJECT_SUMMARY.md](/C:/Users/Amjad/Desktop/ERP-System/PROJECT_SUMMARY.md), [AGENTS.md](/C:/Users/Amjad/Desktop/ERP-System/AGENTS.md)

### Verification

All runnable checks passed:

- Tax: 33/33 tests
- PDF: 18 passed, 3 local-integration skips
- Website: 171/171 tests, typecheck, lint, production build
- Mobile: 112/112 tests, typecheck, Expo Doctor 20/20, clean `npm ci`
- Cloud API: 160 passed, 14 database-integration skips
- API contracts: 32/32
- Database: build/typecheck and 2 tests passed; 1 integration skip
- Deno: full check plus 18/18 hardening tests
- Repository guards, performance budget, diff whitespace, and changed-line credential scan passed

Remaining risks:

- Database and Storage integration suites require the isolated Supabase environment.
- No Critical/High npm findings remain in touched packages. Moderate findings remain: mobile 16, website 2, PDF 2, and four development-only DB-toolchain findings. These require Batch 7 remediation or documented exceptions.
- The JavaScript syntax guard still checks zero files—an existing Batch 7 issue.
- Tax submission remains intentionally disabled.

No files were staged or committed. I stopped before Batch 1 because it introduces migrations and runtime database roles.

> You implemented batch 0 only in the plan?

Yes—only Batch 0 is implemented. The repository is not production-ready yet.

I stopped because your workflow required small, separately verified batches, and Batch 1 introduces database migrations and runtime roles. The remaining Batches 1–8 are untouched.

I can continue with Batch 1 next, then proceed sequentially through the remaining batches with a verification report after each.

> can i deploy everything locally like in Docker Desktop containers and when im ready then to deploy to Cloud Run?

<details><summary>2 previous messages</summary>

> Yes, that development model is viable, but I want to distinguish what the repository can already run in containers from what still depends on managed services. I’m checking the current Dockerfiles, local Supabase configuration, service environment contracts, and any Compose setup. I’m also applying the Supabase workflow guidance because the local database/Auth/Storage stack is central to this setup.
>
> <details><summary>Ran 13 commands, searched the web</summary>
>
> - Ran `Get-Content -Raw 'C:\Users\Amjad\.codex\plugins\cache\openai-curated-remote\supabase\1.0.0\skills\supabase\SKILL.md'`
>
> <details><summary>Searched the web</summary>
>
> - Searched the web for `https://supabase.com/changelog.md`
> - Searched the web for `site:supabase.com/docs local development Supabase CLI Docker Desktop start ...`
>
> </details>
>
> - Ran `$files = rg --files | Where-Object { $_ -match '(^|/|\\)(Dockerfile|docker-compose|compose|cloudbuild|service\.ya?ml|app\.ya?ml|config\.toml|\.env\.example|README\.md|SETUP\.md)$|Dockerfile|compose\.ya?ml|\.dockerignore$' }; $files | Sort-Object; Write-Output '=== package scripts'; rg -n '"(dev|start|build|test|docker|serve|migrate)[^"]*"\s*:' website/package.json phone_app/package.json cloudrun-*/package.json packages/*/package.json; Write-Output '=== ports and service deps'; rg -n 'PORT|DATABASE_URL|SUPABASE_URL|BACKEND_API_BASE_URL|CLOUDRUN_|PUBSUB|AWS_|SES|TAX_' cloudrun-*/Dockerfile cloudrun-*/package.json supabase/config.toml SETUP.md 2>$null | Select-Object -First 300`
>
> - Ran `Write-Output '=== cloudrun-api/Dockerfile'; Get-Content cloudrun-api/Dockerfile; Write-Output '=== cloudrun-tax/Dockerfile'; Get-Content cloudrun-tax/Dockerfile; Write-Output '=== cloudrun-pdf/Dockerfile'; Get-Content cloudrun-pdf/Dockerfile; Write-Output '=== cloudrun-archiver/Dockerfile'; Get-Content cloudrun-archiver/Dockerfile; Write-Output '=== package scripts'; $packageFiles = @('website/package.json','phone_app/package.json','cloudrun-api/package.json','cloudrun-tax/package.json','cloudrun-pdf/package.json','cloudrun-archiver/package.json','packages/contracts/package.json','packages/api-contracts/package.json','packages/db/package.json'); foreach ($file in $packageFiles) { Write-Output "--- $file"; $json = Get-Content -Raw $file | ConvertFrom-Json; $json.scripts | ConvertTo-Json -Compress }; Write-Output '=== CI image build'; rg -n -C 8 'cloudrun_images|docker build|Dockerfile' .github/workflows/ci.yml`
>
> - Ran `$path='SETUP.md'; $lines=Get-Content $path; foreach($range in @(@(360,510),@(225,290),@(500,570))){ Write-Output "=== SETUP $($range[0])-$($range[1])"; for($i=$range[0];$i -le [Math]::Min($range[1],$lines.Count);$i++){ '{0,4}: {1}' -f $i,$lines[$i-1] } }; Write-Output '=== API document dispatch config'; rg -n -C 8 'documentDispatch|PUBSUB|documentTaskPublisher|dispatchPendingDocumentTasks' cloudrun-api/src/runtime-config.ts cloudrun-api/src/server.ts cloudrun-api/src/routes/documents-mutations.ts cloudrun-api/src/routes/internal-document-dispatch.ts; Write-Output '=== external service use'; rg -n 'AWS|SES|GCS|GOOGLE|PUBSUB|SUPABASE|DATABASE_URL|CLOUD_RUN|TAX_' cloudrun-archiver/src cloudrun-pdf/*.ts cloudrun-tax/src cloudrun-api/src/runtime-config.ts 2>$null | Select-Object -First 400`
>
> - Ran `supabase --version; supabase status; docker version --format '{{.Server.Version}}'; docker compose version`
>
> - Ran `Write-Output '=== archiver files'; rg --files cloudrun-archiver; Write-Output '=== archiver integrations'; rg -n 'Storage|GCS|bucket|SUPABASE|DATABASE|manifest|GOOGLE|AUTH|fetch\(' cloudrun-archiver; Write-Output '=== PDF integrations'; rg -n 'SUPABASE|DATABASE|PUBSUB|GCP_|GOOGLE_|EMAIL|AWS|SES|CLOUD_RUN|fetch\(' cloudrun-pdf -g '!dist/**' -g '!node_modules/**'; Write-Output '=== website runtime config'; rg -n 'SUPABASE|BACKEND_API|WEBSITE_ORIGIN|SESSION|PORT|HOST' website/src website/next.config.* website/package.json 2>$null | Select-Object -First 250`
>
> - Ran `$path='cloudrun-archiver/index.ts'; $lines=Get-Content $path; for($i=1;$i -le 150;$i++){ '{0,4}: {1}' -f $i,$lines[$i-1] }; Write-Output '=== env usage'; rg -n 'process\.env|new Storage|initializeApp|firebase|firestore|readModel|fetchArchive|recordArchiveRun' cloudrun-archiver/index.ts cloudrun-archiver/archive-month.ts; Write-Output '=== package'; Get-Content cloudrun-archiver/package.json`
>
> - Ran `$path='cloudrun-api/src/runtime-config.ts'; $lines=Get-Content $path; foreach($range in @(@(180,240),@(270,350))){ for($i=$range[0];$i -le $range[1];$i++){ '{0,4}: {1}' -f $i,$lines[$i-1] } }; Write-Output '=== website loopback config'; Get-Content website/src/lib/backend/config.ts; Write-Output '=== PDF loopback config'; $path='cloudrun-pdf/company-file-storage.ts'; $lines=Get-Content $path; for($i=145;$i -le 205;$i++){ '{0,4}: {1}' -f $i,$lines[$i-1] }`
>
> - Ran `Get-Content packages/db/config.ts 2>$null; rg -n 'DATABASE_SSL_MODE|sslMode|rejectUnauthorized|loopback|DATABASE_URL' packages/db cloudrun-archiver -g '!dist/**' -g '!node_modules/**'; rg -n 'NODE_ENV.*production|IS_PRODUCTION|CLOUD_RUN_SERVICE_URL|PUBSUB_ALLOWED' cloudrun-pdf/index.ts cloudrun-tax/src/config.ts`
>
> - Ran ``Write-Output '=== missing planned surfaces'; foreach($path in @('cloudrun-email','infra','docker-compose.yml','compose.yml','website/Dockerfile')) { Write-Output "$path`t$(Test-Path $path)" }; Write-Output '=== top-level dirs'; Get-ChildItem -Directory | Select-Object -ExpandProperty Name | Sort-Object; Write-Output '=== compose references'; rg -n 'docker compose|docker-compose|compose\.ya?ml|fake-gcs|pubsub emulator|STORAGE_EMULATOR_HOST|PUBSUB_EMULATOR_HOST|mailpit|localstack' . -g '!**/node_modules/**' -g '!**/dist/**' -g '!**/package-lock.json'``
>
> - Ran `Get-ChildItem website -Filter 'next.config.*' | ForEach-Object { Write-Output "=== $($_.FullName)"; Get-Content $_.FullName }; rg -n 'output.*standalone' website`
>
> - Ran `rg -n -C 5 'smart_job_api.*password|CREATE ROLE smart_job_api|ALTER ROLE smart_job_api|runtime password|local.*smart_job_api|DATABASE_URL.*smart_job_api' SETUP.md packages/db/migrations cloudrun-api/README.md PROJECT_SUMMARY.md -g '*.sql' -g '*.md' | Select-Object -First 250`
>
> - Ran `rg -n -C 5 'EXPO_PUBLIC_BACKEND_API_BASE_URL|BACKEND_API_BASE_URL|loopback|https:' phone_app/lib phone_app/modules phone_app/firebase.ts -g '*.ts' -g '*.tsx' | Select-Object -First 250`
>
> <details><summary>Searched the web</summary>
>
> - Searched the web for `site:cloud.google.com/run/docs container contract PORT Cloud Run container local Docker ...`
>
> </details>
>
> </details>
</details>

Yes—you can develop and test almost the entire platform locally with Docker Desktop, then promote the same service images to Cloud Run. However, the repository is not yet fully wired for a one-command local deployment.

| Component | Current local-container status |
|---|---|
| Supabase DB/Auth/Storage/Edge | Ready through `supabase start` |
| API, Tax, PDF, Archiver | Dockerfiles exist and build |
| Website | Missing production Dockerfile and standalone output |
| Email worker | Not implemented yet |
| Pub/Sub, GCS, SES | No local emulators/adapters configured |
| Mobile app | Runs on device/emulator through Expo, not inside Docker |
| Compose environment | Missing |
| Terraform/Cloud Run delivery | Not implemented |

The four existing images are built by [CI](/C:/Users/Amjad/Desktop/ERP-System/.github/workflows/ci.yml:243), but there is no `compose.yml`. The current container networking also needs adjustment: the [API runtime](/C:/Users/Amjad/Desktop/ERP-System/cloudrun-api/src/runtime-config.ts:180), [PDF storage client](/C:/Users/Amjad/Desktop/ERP-System/cloudrun-pdf/company-file-storage.ts:162), and [website backend client](/C:/Users/Amjad/Desktop/ERP-System/website/src/lib/backend/config.ts:1) allow insecure local connections only to loopback addresses. In Compose, services normally communicate using names such as `api` or `supabase`, so either local TLS or a tightly development-gated container-network exception is required.

### Recommended local architecture

```text
Docker Desktop
├── Supabase CLI stack
│   ├── PostgreSQL
│   ├── Auth
│   ├── Storage
│   ├── Edge Runtime
│   └── Studio/Inbucket
├── website
├── cloudrun-api
├── cloudrun-tax (TAX_SUBMISSION_MODE=disabled)
├── cloudrun-pdf
├── cloudrun-archiver (one-shot Compose profile)
├── Pub/Sub emulator/adapter
├── GCS emulator or dedicated development bucket
└── Mailpit/LocalStack for email testing

Outside Docker
└── Expo development client / Android emulator / iOS simulator
```

Supabase officially supports this local Docker workflow, including Postgres, Auth, Storage, and Edge Functions, but warns that it is development-only and must never be exposed publicly because it lacks production hardening such as TLS and rate limiting. [Supabase local-development documentation](https://supabase.com/docs/guides/local-development), [workflow warning](https://supabase.com/docs/guides/local-development/cli-workflows).

### Safe promotion path

1. Develop against Docker Desktop.
2. Recreate the database repeatedly from `packages/db/migrations`.
3. Run integration and end-to-end tests locally.
4. Build Linux `amd64` images in CI.
5. Scan and sign each image.
6. Push images to Artifact Registry.
7. Promote the same digest through staging and production.
8. Deploy the archiver as a Cloud Run Job; deploy HTTP applications as Cloud Run services.
9. Populate production secrets through Secret Manager, never from local `.env` files.
10. Create the production Supabase database from migrations—not by copying local Docker volumes.

Cloud Run explicitly supports locally tested Docker images, provided they satisfy its container contract, including Linux `amd64`, listening on `0.0.0.0:$PORT`, and exiting correctly for jobs. [Local Cloud Run testing](https://docs.cloud.google.com/run/docs/testing/local), [container contract](https://docs.cloud.google.com/run/docs/container-contract).

I recommend adding a dedicated “Local Platform” batch before Batch 1 containing:

- `compose.local.yml`
- Website standalone non-root Dockerfile
- Sanitized local environment examples
- Shared Docker network with the Supabase CLI stack
- Local-only Pub/Sub/identity adapter
- GCS and email emulation
- Database-role bootstrap
- Health checks and one-command startup/reset scripts
- Explicit safeguards preventing local configuration from being used in production

Docker Desktop is currently installed but its daemon is not running on this machine.

> so should i start wit Batch 1 or what?\

Start with Batch 1 now.

A full Compose environment should come after Batch 3 because:

- Batch 1 creates the required database roles and durable tables.
- Batch 2 creates the missing email worker.
- Batch 3 completes the tax service topology.
- Building Compose before those would cause significant rework.

Recommended sequence:

1. Batch 1 — database migrations, roles, permissions, integration matrices.
2. Batch 2 — durable PDF/email pipeline.
3. Batch 3 — authoritative tax workflow.
4. Local Platform checkpoint — Compose, website container, emulators, health checks, and one-command startup.
5. Continue Batches 4–8.

Batch 1 will use the existing Supabase Docker Desktop stack for clean-database and upgrade testing. Docker Desktop must be running first.

Reply “start Batch 1” and I’ll implement it as the next isolated, reviewable batch.

> Perfect start with Batch 1,2,3 , if have any questions you can ask about the plan

<details><summary>3 previous messages</summary>

> Context compaction
>
> Source: automatic
> Status: completed
>
> I’m starting Batches 1–3 in sequence and will keep each one reviewable: database foundations first, then the durable PDF/email pipeline, then the authoritative tax workflow. I’ll use the Supabase and Postgres guidance because these batches change migrations, roles, RPCs, and local database verification; I’ll pause only if a missing external decision truly blocks a safe implementation.
>
> <details><summary>Ran 13 commands, searched the web</summary>
>
> - Ran `Get-Content -Raw 'C:\Users\Amjad\.codex\plugins\cache\openai-curated-remote\supabase\1.0.0\skills\supabase\SKILL.md'`
>
> - Ran `Get-Content -Raw 'C:\Users\Amjad\.codex\plugins\cache\openai-curated-remote\supabase\1.0.0\skills\supabase-postgres-best-practices\SKILL.md'`
>
> - Ran `Get-ChildItem -Name 'C:\Users\Amjad\.codex\plugins\cache\openai-curated-remote\supabase\1.0.0\skills\supabase-postgres-best-practices\references'`
>
> - Ran `Get-Content -Raw 'C:\Users\Amjad\.codex\plugins\cache\openai-curated-remote\supabase\1.0.0\skills\supabase-postgres-best-practices\references\security-privileges.md'`
>
> - Ran `Get-Content -Raw 'C:\Users\Amjad\.codex\plugins\cache\openai-curated-remote\supabase\1.0.0\skills\supabase-postgres-best-practices\references\security-rls-basics.md'`
>
> - Ran `Get-Content -Raw 'C:\Users\Amjad\.codex\plugins\cache\openai-curated-remote\supabase\1.0.0\skills\supabase-postgres-best-practices\references\security-rls-performance.md'`
>
> - Ran `Get-Content -Raw 'C:\Users\Amjad\.codex\plugins\cache\openai-curated-remote\supabase\1.0.0\skills\supabase-postgres-best-practices\references\schema-constraints.md'`
>
> - Ran `Get-Content -Raw 'C:\Users\Amjad\.codex\plugins\cache\openai-curated-remote\supabase\1.0.0\skills\supabase-postgres-best-practices\references\schema-data-types.md'`
>
> - Ran `Get-Content -Raw 'C:\Users\Amjad\.codex\plugins\cache\openai-curated-remote\supabase\1.0.0\skills\supabase-postgres-best-practices\references\schema-foreign-key-indexes.md'`
>
> - Ran `Get-Content -Raw 'C:\Users\Amjad\.codex\plugins\cache\openai-curated-remote\supabase\1.0.0\skills\supabase-postgres-best-practices\references\lock-short-transactions.md'`
>
> - Ran `Get-Content -Raw 'C:\Users\Amjad\.codex\plugins\cache\openai-curated-remote\supabase\1.0.0\skills\supabase-postgres-best-practices\references\lock-deadlock-prevention.md'`
>
> - Ran `Get-Content -Raw 'C:\Users\Amjad\.codex\plugins\cache\openai-curated-remote\supabase\1.0.0\skills\supabase-postgres-best-practices\references\lock-skip-locked.md'`
>
> - Ran `Get-Content -Raw 'C:\Users\Amjad\.codex\plugins\cache\openai-curated-remote\supabase\1.0.0\skills\supabase-postgres-best-practices\references\lock-advisory.md'`
>
> <details><summary>Searched the web</summary>
>
> - Searched the web for `site:supabase.com/changelog.md breaking-change database roles Data API migrations 2026 Supabase ...`
> - Searched the web for `https://supabase.com/changelog.md`
> - Searched the web for `site:supabase.com/changelog "breaking-change" "2026" Supabase database API grants`
>
> </details>
>
> </details>
</details>
