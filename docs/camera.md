# Camera and privacy

The webcam is a shared stream (`web/src/camera/livecam.ts`).

**Cam** in the header is a toggle (same as dream / feed). **Off is the default.** Off stops tracks immediately. On (Auto) starts the camera only for:

- live sky
- gaze steering (audio camera + gaze amount)
- live colour from the webcam

Sky cycle does not open the camera until a cycle pick is `live`.

**Mic** sits beside cam as a toggle. On starts the pulse microphone only when drive is **mic** and something is modulated (sky, floor, camera, nodes, beat cycles). Off never starts it — live traffic or the selected node still drive the pulse. Voice for the agent is separate (watchword / Talk). Settings → **Audio** has drive, sensitivity, modulate targets, and a live level / bass meter.

**Redact** (`R`) masks addresses and names for screenshots. Host and subnet allow/block lists live on Settings → **Privacy** and apply to every view.
