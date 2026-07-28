# NPM audit exceptions

The canonical, machine-enforced register is
[`npm-audit-exceptions.json`](./npm-audit-exceptions.json). Exceptions are
allowed only when npm offers no compatible fix, the vulnerable behavior is not
reachable in this repository, and compensating controls are documented.
High- and critical-severity findings and vulnerabilities in direct dependencies
cannot be excepted; they must be fixed before the audit gate passes.
Low findings are reported by npm but do not require a register entry. Only an
unreachable transitive Moderate finding may receive a time-bounded exception.

Every entry has an owner and a review date no more than 30 days after it was
recorded. `node scripts/check-npm-audit.mjs` performs a live audit of every
independent package, permits only exact advisory IDs in the register, follows
their transitive dependency chain, and fails for expired, unused, malformed,
or newly introduced findings.

Do not use `npm audit fix --force`. Remove an exception as soon as a supported
upstream version is available, then rerun the package's tests, typecheck, build,
and platform validation.
