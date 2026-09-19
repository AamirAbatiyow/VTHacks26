# Vocally water-garden framework

The onboarding screen follows the original sketch: a quiet centered question and input, the original wordmark at the upper left, progress at the lower left, and Continue at the lower right. Powder blue water, broad sage lily pads, and an ivory lotus frame an open center.

## Components

- `src/components/ProfileSetup.tsx` contains five editable steps: name, needs, age, interests, and practice target. Back/Continue preserves each answer; finishing opens the personalized dashboard.
- `src/components/Dashboard.tsx`, `Dashboard.css`, and `DashboardFlower.tsx` integrate the standalone `dashboard-concept` into the React app. The flow is intro → profile setup → dashboard → speech practice, with a return button from practice. The dashboard carries the onboarding name and passes the complete profile into practice. Its four cards open accessible native dialogs for challenges, milestones, recorded practice time, and streaks. Activity starts empty and is saved in browser storage; practice minutes are entered manually. Dashboard styles are scoped to avoid affecting onboarding and conversation controls.
- `src/components/NeedsQuestion.tsx` and `NeedsQuestion.css` implement the second screen: six general descriptions with multiple selection, an exclusive “still figuring it out” option, and a freeform description. These values travel as `practiceGoals` and `needsDescription` through the editable practice controls into the conversation prompt. The server bounds and validates these fields. They are self-reported preferences, never diagnoses.
- `src/components/WaterGarden.tsx` and `WaterGarden.css` contain the illustration, automatic slow water highlights, and interactive lily pads. The `active` prop starts motion while setup is shown. Click, tap, or keyboard-activate a visible lily pad to create expanding rings around it. Reduced-motion styling softens the movement while keeping the requested automatic water. There is no playback button.
- `src/components/VocallyWordmark.tsx` reuses the original custom lettering in the garden palette.
- `src/styles.css` controls typography, the centered layout, and responsive spacing. Small screens can scroll naturally when the keyboard or viewport reduces available height.

The existing intro precedes setup. Run the client with `npm run dev:client` from `conversational-ai`, then click the intro or press Space. Onboarding does not require backend credentials or microphone access.

## Illustration

Asset: `src/assets/water-garden-illustration.png`.

Generated with the built-in image-generation tool, using the original sketch for composition and the original Vocally intro for the sculpted paper-cut style. The form, text, controls, and animation are real application elements layered over the illustration.

Style generation prompt:

Use case: style-transfer. EDIT IMAGE 1, the water-garden background. Image 2 is a STYLE REFERENCE: the user's original Vocally design with sculptural layered swooshing ribbons and a soft dimensional paper-cut look. Image 3 is a COMPOSITION REFERENCE: the user's pencil sketch (rotate mentally counterclockwise into landscape: brand top left, main question and text field at center, long leaves at upper-right and far-left, lotus lower-right, progress lower-left, continue lower-right). Transform image 1 AWAY FROM painted watercolor botanical realism and INTO the smooth sculptural abstract paper-cut aesthetic of image 2. Keep the landscape 16:10 background, broad open CENTER (x28%-69%, y15%-75%) in very pale blue-white for real UI to overlay. Create large flowing water ribbons wrapping around the far LEFT edge and sweeping across the BOTTOM edge, with layered sweeping contours, long tapered wave curves, soft sculptural shadows and beautiful broad blue surfaces. Long gently curling stylized leaves frame top-right and a few very large simple leaves at far-left; one large elegant STYLIZED LOTUS lower-right (around x85%, y73%) formed of sculpted ivory and palest sage petals, minimal smooth geometry and NO realistic veins. Preserve the sketch's arrangement while echoing the original Vocally image's thick ribbons, cut-out flowing silhouettes, sweeping negative space and soft 3D depth. COLOR is pastel blue and green: powder-blue water #c4e0e9, mist-blue #dcecf1, sage and mint leaves #adc8b2, ivory lotus #f6f7ea. Pale green-blue shadowing only. Avoid tan, brown and saturated teal. Make the outer forms clear, graphic and sculptural, not faint or washed out. Keep central area calm and nearly blank with the lightest blue-white. Avoid adding extra lotus buds, detailed scenery or distant plants. This is only an edge-to-edge background ASSET, not a UI screenshot: NO text, logo, letters, typography, controls, boxes, buttons, border, watermark or people.

Final lily-pad revision prompt:

Use case: precise-object-edit. Edit the supplied sculpted pastel water-garden website background. Change ONLY the foliage: ALL long pointed willow/reed leaves at upper-right and far-left must be replaced with unmistakable LILY PADS. Lily pads are broad, nearly circular or oval floating sage-green disks, each with a clear triangular V-shaped notch cut from its rim toward the center, a slightly curled smooth edge, and very subtle radial contours. NO long pointed leaves, NO hanging vines, NO reeds, NO grass, NO stems hanging from above. At UPPER RIGHT: one large broad circular lily pad partly cropped by the top and right edges, with its V-shaped notch opening toward the central lower-left, plus one small overlapping pad. At FAR LEFT: two broad oval lily pads partly cropped by the left edge, one upper-left and one mid-left, tilted in perspective with clear notches. Keep the same graceful sculpted layered paper-cut / soft 3D style, matching the original shapes' footprint as much as possible. Preserve precisely: the broad nearly blank pale blue-white CENTER for a centered HTML form; all powder-blue flowing water ribbons and contours down the left and across the bottom; the large ivory lotus at LOWER RIGHT; the original pastel blue and sage-green palette; landscape aspect ratio and composition. Any leaves directly supporting the lotus should also read as broad circular lily pads, not pointed foliage. The water ribbons remain smooth, sweeping and dimensional. No text, logo, letters, UI, buttons, frame, people, or additional decorations.

## Optional facial expression camera

Speech practice includes `FacialExpressions.tsx`. Click **Enable camera** to load
[Human 3.3.6](https://github.com/vladmandic/human) from the pinned jsDelivr URL,
then grant browser camera permission. Use HTTPS or localhost. Initial loading
requires internet access to `cdn.jsdelivr.net`; blocked downloads display an
error without affecting speech practice. The runtime and model weights are
loaded on demand rather than included in the production bundle.

`src/vision/expressionModel.ts` enables only the face detector and expression
classifier; identity embeddings, demographic inference, mesh, body, and hand
models are disabled. Video frames stay in browser memory. No frames or results
are sent to the server or saved by this feature. Model files may be cached by
the library. Inference is serialized and paced at one request per 500 ms after
the previous request completes, using a 320-pixel analysis input.

Results are labeled **expression estimates**, not mood measurements. The model
outputs neutral/happy/sad/angry/fear/disgust/surprise classes. No face, multiple
faces, weak detections, or ambiguous predictions produce no attributed label.
The 0.6 score floor and 0.15 winning margin are display heuristics, not measured
accuracy or calibrated probabilities. Expressions are not forwarded to the
conversation prompt as facts about the user.

Stopping, hiding the tab, or leaving practice releases camera tracks. Pending
permission responses and inference results cannot restart a stopped session.
Speech microphone capture is independent (the camera request uses audio:false).

Validation: client production build and typecheck; six scoring tests via
`node --import tsx --test client/src/vision/expressions.test.ts` from
`conversational-ai`. Live browser/model/camera testing is still required because
this development environment cannot download the runtime or open a camera test.
Manual checks: allow/deny camera permission, cancel during loading, stop and
restart, leave practice during inference, hide the tab, disconnect the camera,
show no face/two faces, and block the CDN. Check that the camera indicator turns
off on every exit and that stale labels disappear.
