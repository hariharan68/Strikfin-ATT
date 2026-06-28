# Changelog

Format: `## vX.Y — Title (YYYY-MM-DD)`
Each entry lists the date, a one-line summary, and the primary files changed.

---

## v0.1 — Initial Documentation (2026-06-20)

Generated the first complete documentation set covering all layers of the platform as built.

**Files added:**
- `docs/README.md`
- `docs/ARCHITECTURE.md`
- `docs/DATABASE_SCHEMA.md`
- `docs/API_REFERENCE.md`
- `docs/ENGINES.md`
- `docs/AI_COPILOT_AND_DISCLOSURE.md`
- `docs/SETUP.md`
- `docs/ENVIRONMENT_VARIABLES.md`
- `docs/TESTING.md`
- `docs/CHANGELOG.md`
- `docs/ROADMAP.md`

**Platform state at this version:**
- Backend: FastAPI + SQLAlchemy async, PostgreSQL via asyncpg
- Engines: options_math, regime (7-state), synthesizer, short_covering
- Providers: mock (default) + Fyers (live)
- LLM: openai / anthropic / none (rule-based fallback)
- Frontend: React 19 + Vite 8 + Zustand + Tailwind CSS 4
- Auth: JWT + bcrypt + refresh token rotation
- Test suite: file stubs created, no test functions written yet
- Alembic migrations: configured but no version files generated

---

<!-- Add new entries above this line in reverse chronological order -->
<!-- Format:
## vX.Y — Short title (YYYY-MM-DD)

Summary of what changed and why.

**Files changed:** list key files
-->
