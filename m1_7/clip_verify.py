"""
CLIP verification of detected offences (local inference).

Why this exists
---------------
The geometric detectors answer "did a measurement cross a threshold". They
cannot answer "does this look like the thing we are claiming". Reviewing the
stills by eye showed exactly that gap: a raised wrist that was a man resting
his head on his hand, a head-yaw change that was someone leaning down over
their own desk. Both are unmistakable in the image and invisible to the
geometry.

CLIP scores an image against candidate captions, so it can separate those
cases. It is used to *annotate* findings with a second opinion, never to
delete them — suppressing evidence without an audit trail is a worse failure
mode for a surveillance tool than showing too much.

Two limits are enforced rather than hoped for:

  * The subject is cropped out of the frame first. Sent a whole exam hall,
    CLIP describes the room, not the person the offence is about.
  * Crops below a minimum size are skipped and marked "unjudgeable". Measured
    on this footage, subjects at the back of the room are ~60px tall and their
    head direction cannot be resolved by any model — returning a confident
    verdict there would launder a guess into evidence.

Runs locally rather than against a hosted API. That was not the original
plan: HuggingFace's free serverless inference no longer serves CLIP at all —
querying their API for models servable for zero-shot image classification via
the hf-inference provider returns a single pet-breed classifier. Locally there
is no token, no rate limit, no network dependency, and the result is
deterministic, which matters for something that annotates evidence.

The model (~600MB) downloads once on first run and is cached thereafter.

Usage:
    python m1_7/clip_verify.py --pipeline-dir pipeline_out/<job>
"""

import argparse
import json
import sys
from pathlib import Path

import cv2

# ViT-B/32 rather than the larger variants: ~600MB, a few hundred ms per crop
# on CPU, and the distinctions being drawn here (hand at face vs hand raised)
# are coarse enough that the extra capacity buys little.
CLIP_MODEL = "openai/clip-vit-base-patch32"

# Crop padding around the subject box, as a fraction of its size. A little
# context helps — "reaching toward someone" is unreadable if the neighbour is
# cropped out — but too much reintroduces the whole-room problem.
CROP_PAD = 0.35

# Below this the crop carries too few pixels for a verdict to mean anything.
MIN_CROP_PIXELS = 80 * 80

# CLIP always returns a ranking, even when it has no real preference: with four
# candidate captions, chance is 0.25, and one finding here came back 0.29 vs
# 0.28 — a coin flip that would otherwise have been recorded as a verdict. A
# result is only reported when the top caption clears chance by a margin AND
# beats the runner-up; otherwise the honest answer is that the model cannot
# tell either.
MIN_TOP_SCORE = 0.45
MIN_MARGIN = 0.15

# Candidate captions per offence type. The first entry is the offence itself;
# the rest are the innocent explanations actually observed in this footage, so
# CLIP is choosing between real alternatives rather than being asked to confirm
# a single suggestion.
CANDIDATES = {
    # NOTE: these captions are not tunable in any principled way. Rewording
    # this list — adding a plausible "invigilator supervising" option, which
    # ought to have helped, since one high-confidence hit was exactly that —
    # moved the same nine images from 4 supported / 2 contradicted to
    # 7 supported / 1 contradicted, and flipped a verdict that eyeball review
    # had confirmed was correct. The scores track phrasing at least as much as
    # image content, which is why nothing here may gate evidence automatically.
    "head_turn": [
        "a person turning their head to look at another person's desk",
        "a person looking down at their own desk",
        "a person facing forward at their own computer",
        "a person standing still",
    ],
    "hand_gesture": [
        "a person raising their hand to signal to someone",
        "a person resting their head on their hand",
        "a person typing or writing at a desk",
        "a person touching their face",
    ],
    "prohibited_object": [
        "a hand holding a mobile phone",
        "a mobile phone on a desk",
        "a computer keyboard or monitor",
        "a piece of paper on a desk",
        "part of a person's body",
    ],
    "object_exchange": [
        "two people passing an object between them",
        "two people sitting near each other working",
    ],
    "loitering": [
        "a person standing beside someone else's desk",
        "a person walking past",
        "a person seated at a desk",
    ],
    "crowd_disturbance": [
        "several people moving around a room",
        "people sitting still at desks",
    ],
}

# The captions above that mean "this is not an offence".
INNOCENT_PREFIXES = (
    "a person looking down at their own desk",
    "a person facing forward",
    "a person standing still",
    "a person resting their head",
    "a person typing",
    "a person touching their face",
    "a computer keyboard",
    "a piece of paper on a desk",
    "part of a person",
    "two people sitting near each other",
    "a person walking past",
    "a person seated at a desk",
    "people sitting still",
)


def crop_subject(frame_path: Path, bbox, out_path: Path):
    """Crop the subject with padding. Returns (ok, pixel_count)."""
    img = cv2.imread(str(frame_path))
    if img is None:
        return False, 0

    h, w = img.shape[:2]
    x1, y1, x2, y2 = [int(v) for v in bbox]
    bw, bh = x2 - x1, y2 - y1
    if bw <= 0 or bh <= 0:
        return False, 0

    px, py = int(bw * CROP_PAD), int(bh * CROP_PAD)
    x1 = max(0, x1 - px)
    y1 = max(0, y1 - py)
    x2 = min(w, x2 + px)
    y2 = min(h, y2 + py)

    crop = img[y1:y2, x1:x2]
    if crop.size == 0:
        return False, 0

    # Upscale small crops: CLIP expects ~224px input, and feeding it a 60px
    # thumbnail wastes the request. This does not add information, which is
    # why MIN_CROP_PIXELS still applies to the original size.
    pixels = crop.shape[0] * crop.shape[1]
    if crop.shape[0] < 224:
        scale = 224 / crop.shape[0]
        crop = cv2.resize(crop, None, fx=scale, fy=scale, interpolation=cv2.INTER_CUBIC)

    cv2.imwrite(str(out_path), crop)
    return True, pixels


_model = None
_processor = None


def load_clip():
    """Load CLIP once. First call downloads ~600MB, then it is cached."""
    global _model, _processor
    if _model is None:
        from transformers import CLIPModel, CLIPProcessor
        print(f"loading {CLIP_MODEL} (first run downloads ~600MB)...", file=sys.stderr)
        _model = CLIPModel.from_pretrained(CLIP_MODEL)
        _processor = CLIPProcessor.from_pretrained(CLIP_MODEL)
        _model.eval()
    return _model, _processor


def query_clip(image_path: Path, labels):
    """Zero-shot classify one crop. Returns [{label, score}] sorted desc."""
    import torch
    from PIL import Image

    model, processor = load_clip()
    image = Image.open(image_path).convert("RGB")
    inputs = processor(text=labels, images=image, return_tensors="pt", padding=True)

    with torch.no_grad():
        out = model(**inputs)
        # Softmax over the candidate captions: the useful quantity is which
        # caption fits best, not the raw similarity magnitude.
        probs = out.logits_per_image.softmax(dim=1)[0]

    scored = [{"label": l, "score": float(p)} for l, p in zip(labels, probs)]
    scored.sort(key=lambda r: -r["score"])
    return scored


def verdict_for(top_label: str) -> str:
    return "contradicted" if top_label.startswith(INNOCENT_PREFIXES) else "supported"


def main():
    ap = argparse.ArgumentParser(description="CLIP-verify detected offences.")
    ap.add_argument("--pipeline-dir", required=True)
    ap.add_argument("--min-pixels", type=int, default=MIN_CROP_PIXELS)
    args = ap.parse_args()

    root = Path(args.pipeline_dir)
    enriched_path = root / "backend_output" / "enriched_events.json"
    if not enriched_path.exists():
        sys.exit(f"Not found: {enriched_path}")

    data = json.loads(enriched_path.read_text())
    frames_dir = root / "frames"
    crops_dir = root / "backend_output" / "clip_crops"
    crops_dir.mkdir(parents=True, exist_ok=True)

    video_id = data.get("video_id", "")
    checked = supported = contradicted = skipped = 0

    for event in data.get("events", []):
        for off in (event.get("offences") or []):
            otype = off.get("type")
            labels = CANDIDATES.get(otype)
            bbox = off.get("bbox")

            if not labels or not bbox or len(bbox) != 4:
                off["clip"] = {"verdict": "unjudgeable", "reason": "no subject crop available"}
                skipped += 1
                continue

            # Frames are named <videoID>__f<7 digits>__t<ts>.jpg.
            matches = list(frames_dir.glob(f"{video_id}__f{off['frameIdx']:07d}__t*.jpg"))
            if not matches:
                off["clip"] = {"verdict": "unjudgeable", "reason": "source frame missing"}
                skipped += 1
                continue

            crop_path = crops_dir / f"{otype}_{off.get('trackId','na')}_f{off['frameIdx']:07d}.jpg"
            ok, pixels = crop_subject(matches[0], bbox, crop_path)
            if not ok:
                off["clip"] = {"verdict": "unjudgeable", "reason": "crop failed"}
                skipped += 1
                continue

            if pixels < args.min_pixels:
                off["clip"] = {
                    "verdict": "unjudgeable",
                    "reason": f"subject too small ({pixels}px < {args.min_pixels}px)",
                }
                skipped += 1
                print(f"  {otype:18s} {off.get('trackId','-'):9s} SKIP  subject {pixels}px")
                continue

            try:
                result = query_clip(crop_path, labels)
            except Exception as e:
                off["clip"] = {"verdict": "unjudgeable", "reason": f"inference failed: {e}"}
                skipped += 1
                continue

            top = result[0]
            margin = top["score"] - (result[1]["score"] if len(result) > 1 else 0.0)

            if top["score"] < MIN_TOP_SCORE or margin < MIN_MARGIN:
                off["clip"] = {
                    "verdict": "unjudgeable",
                    "reason": f"no clear preference (top {top['score']:.2f}, margin {margin:.2f})",
                    "topLabel": top["label"],
                    "allScores": [
                        {"label": r["label"], "score": round(float(r["score"]), 4)} for r in result
                    ],
                    "crop": str(crop_path).replace("\\", "/"),
                }
                skipped += 1
                print(f"  {otype:18s} {off.get('trackId','-'):9s} UNCERTAIN    "
                      f"top={top['score']:.2f} margin={margin:.2f}")
                continue

            v = verdict_for(top["label"])
            off["clip"] = {
                "verdict": v,
                "topLabel": top["label"],
                "topScore": round(float(top["score"]), 4),
                "margin": round(float(margin), 4),
                "allScores": [
                    {"label": r["label"], "score": round(float(r["score"]), 4)} for r in result
                ],
                "crop": str(crop_path).replace("\\", "/"),
            }
            checked += 1
            if v == "supported":
                supported += 1
            else:
                contradicted += 1
            print(f"  {otype:18s} {off.get('trackId','-'):9s} {v.upper():12s} "
                  f"{top['score']:.2f}  \"{top['label'][:52]}\"")

    enriched_path.write_text(json.dumps(data, indent=2))

    print()
    print(json.dumps({
        "checked": checked,
        "supported": supported,
        "contradicted": contradicted,
        "skipped_unjudgeable": skipped,
        "written": str(enriched_path),
    }, indent=2))


if __name__ == "__main__":
    main()
