# Agent Mobile

A simple SolidJS frontend for managing Agent sessions via mobile web interface.

## Development

The dev server runs persistently via systemd. Never kill or restart it.

## Tech Stack

- **SolidJS** - Reactive UI framework
- **Tailwind CSS v4** - Styling
- **Bun** - Runtime, bundler, and server
- **Claude Agent SDK** - AI integration

## Codebase Layout

- `src/server.ts` - Bun HTTP server entry point
- `src/server/api.ts` - All REST API routes
- `src/server/claude.ts` - Claude SDK integration and streaming
- `src/server/session.ts` - Session state management
- `src/client/client.tsx` - Client entry point
- `src/client/app.tsx` - Main UI component (state, chat, layout)
- `src/client/audio.ts` - Audio recording and TTS
- `src/client/markdown.tsx` - Markdown rendering
- `src/client/git.tsx` - Git status/diff UI
- `src/client/tools.tsx` - Tool call display components
- `src/client/session-manager.tsx` - Session switching UI
- `src/client/gestures.ts` - Touch gesture handling

## Key Patterns

- **State**: SolidJS signals (`createSignal`, `createEffect`)
- **API**: REST endpoints with SSE streaming for chat responses
- **Sessions**: JSONL transcript files stored in `~/.claude/projects/`
- **External services**: Whisper transcription at `localhost:9371`, Kokoro TTS at `localhost:9372`
