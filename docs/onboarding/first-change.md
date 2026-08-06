# First change brief: environment-doctor clarification

Improve one instruction in `docs/environment-doctor.md` that you verified while setting up this repository.

## Why this is a safe first change

- The target file exists in this repository.
- The scope is documentation only; it does not change data contracts or permissions.
- The CLI behavior is covered by `tests/dayone-cli.test.mjs`.
- The change should remove a real ambiguity you encountered, not invent product behavior.

## Evidence for review

1. Start from the latest `main` branch.
2. Create `docs/onboarding-improvement` (or an equivalent clearly named branch).
3. Make one focused clarification in `docs/environment-doctor.md`.
4. Run `node --test tests/dayone-cli.test.mjs` and `npm run lint`.
5. Include the commands and results in the pull request description.

There is no pre-created issue or feature flag for this exercise. Completion is a user acknowledgement; the submitted pull request link is stored but its GitHub state is not queried.
