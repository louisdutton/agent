# Agent Mobile

A SolidJS frontend for managing an AI assistant via mobile web interface.

## Development

The dev server runs persistently via systemd. Never kill or restart it.

## Tech Stack

- **SolidJS** - Reactive UI framework
- **Tailwind CSS v4** - Styling
- **Bun** - Runtime, bundler, and server

## Architecture

**Assistant**
- Persistent orchestrator with evolving memory
- Learns from corrections to avoid repeating mistakes
- Open-ended conversation interface
- Manages triggers and spawns tasks

**Tasks**
- Discrete work units with terminal criteria
- Only receive context necessary for their purpose
- Triggered: manually, event/webhook, or schedule
- Do not manage their own memory

**Memory**
- Owned and managed exclusively by the assistant
- Stores corrections, preferences, learned patterns
- Referenced before acting; updated after task outcomes

## Key Patterns

- **State**: SolidJS signals (`createSignal`, `createEffect`)
- **API**: REST endpoints with SSE streaming for real-time updates
- **Speech-to-text**: External Whisper server (client configured via env)
