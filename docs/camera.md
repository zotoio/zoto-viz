# Camera and privacy

The webcam is a shared stream (`web/src/camera/livecam.ts`).

**Cam** in the header is a toggle (same switch as Settings → Privacy). **Off is the default.** Off stops tracks immediately. AI and dice cannot change it. The first On shows an in-page **Allow the camera** dialog (embedded browsers such as Cursor Simple Browser cannot present the usual permission chrome). On (Auto) starts the camera only for:

- live sky
- gaze steering (audio camera + gaze amount)
- live colour from the webcam

Sky cycle does not open the camera until a cycle pick is `live`.

**Mic** sits beside cam as a toggle (same switch as Settings → Privacy). Off is the OS master switch: it stops the pulse microphone, watchword listening, and hold-to-talk so the OS microphone light goes out. AI and dice cannot change it. Live traffic or the selected node still drive the pulse. On allows those streams; the pulse microphone starts only when drive is **mic** and something is modulated (sky, floor, camera, nodes, beat cycles). The first On shares the in-page Allow dialog with watchword listening. Settings → **Audio** has drive, sensitivity, modulate targets, and a live level / bass meter.

**Redact** (`R`) masks addresses and names for screenshots. Host and subnet allow/block lists live on Settings → **Privacy** and apply to every view.
