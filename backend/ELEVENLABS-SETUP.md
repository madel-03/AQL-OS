# ElevenLabs Arabic voice

Selected voice ID: XgwA88S7GusfDYlhZ3jt

Publish backend to Render. Add these environment variables:
- ARABIC_TTS_PROVIDER=elevenlabs
- ELEVENLABS_VOICE_ID=XgwA88S7GusfDYlhZ3jt
- ELEVENLABS_API_KEY: create a restricted Text to Speech API key in ElevenLabs, paste only into Render. Never commit it or put it in frontend env.
- Optional ELEVENLABS_MODEL=eleven_flash_v2_5

Arabic TTS uses the selected voice when the provider switch is set. English keeps the existing Edge path. Existing Arabic Edge voice dropdown choices do not select ElevenLabs voices while this server switch is enabled; the ElevenLabs voice is server-wide. To return to the old Arabic voices, set ARABIC_TTS_PROVIDER=edge and redeploy.

Add the selected voice to your ElevenLabs account. Voice Library voices may require a paid plan for API usage even if website previews play on a free account. Quota or access failures return a clear server error. Existing client browser speech fallback may still play when the remote request fails; hearing audio alone does not prove ElevenLabs was used. Confirm the /api/tts JSON provider field is elevenlabs during verification.

Text is sent to ElevenLabs only for Arabic speech requests when enabled. No API key is sent to browsers. Audio is cached in server memory for up to 24 distinct text/model/voice requests; no audio files are saved. Speed 1.03, stability 0.5, similarity 0.75 are initial settings, not a guarantee of perceived quality.

Validation: node --test eleven-speech.test.js verifies request configuration, server-side key, caching and safe errors with a mocked provider. Real selected-voice synthesis was not tested because no ElevenLabs key is configured for this task.
