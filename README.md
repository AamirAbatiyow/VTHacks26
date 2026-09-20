# Vocally

Real-time conversational speech-coaching application with streaming
ElevenLabs STT/TTS, Gemini responses, and ONNX speech-pattern analysis.

## Deploy

The repository root is the Fly.io deployment context. After creating the app
and setting its secrets once, deploy the complete frontend and backend from
this directory:

```bash
fly deploy
```

The root `Dockerfile` builds `conversational-ai/client` and
`conversational-ai/server` into one image. Express serves the React build,
HTTP endpoints, and `/ws` from the same Fly origin. See
`conversational-ai/README.md` for first-time app creation and secret setup.