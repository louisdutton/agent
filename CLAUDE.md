# Agent Mobile

A SolidJS frontend for managing AI agent sessions via mobile web interface.

## Development

The dev server runs persistently via systemd. Never kill or restart it.

## Tech Stack

- **SolidJS** - Reactive UI framework
- **Tailwind CSS v4** - Styling
- **Bun** - Runtime, bundler, and server

## Key Patterns

- **State**: SolidJS signals (`createSignal`, `createEffect`)
- **API**: REST endpoints with SSE streaming for real-time updates
- **Assistant**: Ephemeral high-level interface for servicing user queries; can manage threads or perform standalone tasks
- **Threads**: Persistent conversation sessions that can be managed by assistants or interacted with directly
- **Sessions**: JSONL transcript files
- **Speech-to-text**: External Whisper server (client configured via env)
