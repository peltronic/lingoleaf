# LingoLeaf glossary

Short definitions of ideas the app uses. Meant for orientation, not implementation detail.

---

## Selection

Text the learner highlights on a page before saving. It might be a single word, a sentence, or anything in between.

---

## Surface word

One French piece in reading order after the rough cut-up step: the kind of unit you would feed into a “what does this word mean?” step one at a time. Often matches one dictionary word; sometimes it is a short form that still behaves as one unit in French (for example forms with an apostrophe inside).

---

## Phrase chunk

Several surface words treated as **one** learnable unit—what you might save as a single card because it behaves as a fixed expression, a tight verb phrase, or similar. The app can **group** adjacent surface words into a chunk so the learner does not have to memorize it as separate cards.

---

## Vocab row

One entry in the learner’s vocabulary: the French side, a place for the English gloss, and a sense of whether the gloss is still loading. Before anything is stored permanently, the app can build the same *shape* of row as a draft; after saving, the same idea is a row in the saved list with stable identity and time.

A **vocab row** is always that same kind of record; only the **French text** on the row changes shape—from one surface word to a short phrase when chunks are merged.

---

## Single-word vocab row

A vocab row whose French text is **exactly one** surface word (no spaces inside that text). This is the usual starting point right after cutting a selection into pieces.

---

## Merged vocab row

A vocab row whose French text can contain **spaces**—several surface words joined into one line of French the learner saves as a single unit.

---

## Grouping (merge)

The step where the app asks, in effect: “Should the next few surface words be **one** card or **separate** cards?” Grouping follows rules about window size and not repeating the same chunk; an optional smart step can suggest larger spans when they act like one expression.

---

## Translation gloss

The English wording shown (or filled in later) for a vocab row—the answer to “what does this French mean?”

---

## Saved list

The learner’s collection of saved French items and their glosses, with links back to pages where they appeared.

---

## Local assistant

The idea that help with grouping and translation can come from **AI running on the learner’s own machine**, rather than from a distant server—so privacy and setup stay under their control.
