# Camera and privacy

The webcam is a shared stream (`web/src/camera/livecam.ts`).

**Cam Auto / Off** in the header is global. **Off is the default.** Off stops tracks immediately. Auto starts the camera only for:

- live sky
- gaze steering (audio camera + gaze amount)
- live colour from the webcam

Sky cycle does not open the camera until a cycle pick is `live`.

Mic pulse (`web/src/audio/audio.ts`) is separate. Voice for the agent starts the mic only while Talk is held.

**Redact** (`R`) masks addresses and names for screenshots.
