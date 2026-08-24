"""
Score the detector against evaluation/ground_truth.json.

Run: python evaluation/score.py

Two kinds of human input feed this, and keeping them apart is the point:

  annotations   - what is visible in the clip, sampled every 2s, recorded
                  without reference to what the detector said.
  adjudications - a verdict on one SPECIFIC detection, reached by re-extracting
                  that exact frame at native resolution and looking at it.

An earlier version of this script scored any detection falling outside an
annotated interval as a false positive. That was wrong: the annotations sample
every 2s and describe the clip, not the detector's claims, so "no annotation
covers it" means unadjudicated, not incorrect. Unadjudicated detections are now
counted separately and excluded from precision.

On accuracy: it is computable here but degenerate - negatives outnumber
positives by roughly 700:1, so a detector that flags nothing scores ~99.9%.
The figure is printed alongside that do-nothing baseline so the comparison is
visible rather than asserted.
"""
import json, io, glob, os

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
PEOPLE_PER_CLIP = 10  # approximate candidates visible; only used for the accuracy illustration

CLIP_TO_JOB = {
    "Seat No. 12": ("1787453007974_Seat_No_12", "12"),
    "01.Candidate": ("1787454172703_01", "01"),
    "02.Candidate": ("1787454175652_02", "02"),
}


def load_gt():
    with io.open(os.path.join(ROOT, "evaluation", "ground_truth.json"), encoding="utf-8") as f:
        return json.load(f)


GT = load_gt()


def job_and_tag(clip_name):
    for prefix, (job, tag) in CLIP_TO_JOB.items():
        if clip_name.startswith(prefix):
            m = glob.glob(os.path.join(ROOT, "pipeline_out", job + "*"))
            return (m[0] if m else None), tag
    return None, None


def detections(job_dir):
    path = os.path.join(job_dir, "backend_output", "enriched_events.json")
    if not os.path.exists(path):
        return []
    with io.open(path, encoding="utf-8") as f:
        data = json.load(f)
    out = []
    for ev in data.get("events", []):
        for off in ev.get("offences") or []:
            out.append({
                "type": off.get("type"),
                "start": float(off.get("startSec", 0)),
                "end": float(off.get("endSec", 0)),
                "track": off.get("trackId"),
                "suppressed": bool(off.get("suppressed")),
            })
    return out


def overlaps(a0, a1, b0, b1):
    return a0 <= b1 and b0 <= a1


def is_genuine(verdict):
    return not verdict.lower().startswith("not an offence")


def verdict_for(tag, det):
    for v in GT.get("_adjudications", {}).get("verdicts", []):
        if v["clip"] == tag and v["type"] == det["type"] and abs(v["atSec"] - det["start"]) < 0.5:
            return v["verdict"]
    return None


def main():
    rows = []
    TP = FP = FN = AMB = UNJ = 0
    total_seconds = 0

    for clip in GT["clips"]:
        job, tag = job_and_tag(clip["clip"])
        if not job:
            print("  ! no pipeline output for %s - skipped" % clip["clip"][:40])
            continue

        dets = [d for d in detections(job) if not d["suppressed"]]
        genuine = [a for a in clip.get("annotations", []) if is_genuine(a["verdict"])]
        total_seconds += clip.get("durationSec", 0)

        tp = fp = amb = unj = 0
        for d in dets:
            v = verdict_for(tag, d)
            if v == "true positive":
                tp += 1
            elif v == "false positive":
                fp += 1
            elif v == "ambiguous":
                amb += 1
            else:
                unj += 1

        missed = [a for a in genuine
                  if not any(overlaps(d["start"], d["end"], a["fromSec"], a["toSec"]) for d in dets)]

        TP += tp; FP += fp; FN += len(missed); AMB += amb; UNJ += unj
        rows.append((clip["clip"][:42], clip.get("durationSec", 0), len(dets),
                     len(genuine), tp, fp, len(missed), amb, unj))

    extra = GT.get("_real_events_the_detector_missed") or []
    FN += len(extra)

    print("\n%-42s %5s %4s %5s %3s %3s %3s %4s %4s"
          % ("clip", "secs", "det", "real", "TP", "FP", "FN", "amb", "unj"))
    print("-" * 88)
    for r in rows:
        print("%-42s %5s %4d %5d %3d %3d %3d %4d %4d" % r)
    print("-" * 88)
    print("%-42s %5d %4d %5s %3d %3d %3d %4d %4d"
          % ("TOTAL", total_seconds, TP + FP + AMB + UNJ, "", TP, FP, FN, AMB, UNJ))
    if extra:
        print("\n(+%d misses from _real_events_the_detector_missed, folded into FN)" % len(extra))
    if UNJ:
        print("(%d detections have no recorded verdict and are excluded from precision)" % UNJ)

    prec = TP / (TP + FP) if (TP + FP) else 0.0
    rec = TP / (TP + FN) if (TP + FN) else 0.0
    f1 = 2 * prec * rec / (prec + rec) if (prec + rec) else 0.0

    print("\n  precision  %.3f   (%d of %d adjudicated findings were real)" % (prec, TP, TP + FP))
    print("  recall     %.3f   (%d of %d known real events were caught)" % (rec, TP, TP + FN))
    print("  F1         %.3f" % f1)

    print("\n  --- on accuracy ---")
    person_seconds = total_seconds * PEOPLE_PER_CLIP
    positives = TP + FN
    tn = person_seconds - positives - FP
    acc = (TP + tn) / float(person_seconds) if person_seconds else 0.0
    baseline = (person_seconds - positives) / float(person_seconds) if person_seconds else 0.0
    spec = tn / float(tn + FP) if (tn + FP) else 0.0
    print("  unit: person-second. %d observed, %d of them real events (%.2f%%)."
          % (person_seconds, positives, 100.0 * positives / person_seconds))
    print("  accuracy             %.4f" % acc)
    print("  do-nothing baseline  %.4f   <- flagging NOTHING scores this" % baseline)
    print("  difference           %.2f percentage points" % ((acc - baseline) * 100))
    print("  Accuracy is therefore not informative on this task; it is dominated")
    print("  by true negatives. Precision and recall above are the real numbers.")
    print("\n  balanced accuracy    %.3f   (mean of recall %.3f and specificity %.3f)"
          % ((rec + spec) / 2, rec, spec))


if __name__ == "__main__":
    main()
