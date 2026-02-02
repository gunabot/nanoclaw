# NanoClaw Linux Fork

Fork of gavrielc/nanoclaw adapted for:
- Linux (Ubuntu 24.04)
- Codex CLI (alongside Claude)
- Discord (alongside WhatsApp)

## Development Approach
Each capability is implemented then extracted into a skill:
1. Implement feature
2. Create `/add-<feature>` skill that teaches how to add it

## Phases
- [ ] Phase 1: Linux base (strip macOS, run on host)
- [ ] Phase 2: `/setup-linux` skill
- [ ] Phase 3: Codex CLI integration
- [ ] Phase 4: `/add-codex` skill  
- [ ] Phase 5: Discord integration
- [ ] Phase 6: `/add-discord` skill
