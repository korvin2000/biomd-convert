/**
 * Named destinations — `<a name>` / `<a id>` → `::anchor{#id}`.
 *
 * ## Rule contract
 *
 * **Invariant.** An `<a>` element carrying `name` or `id` is HTML's only way of
 * writing "this place has a name". The evidence is the attribute itself and
 * nothing else: no class, no id value, no filename, no title, no page is
 * consulted, and the identifier is copied character for character because
 * matching a `#…` link literally is the entire value of the construct. Nothing
 * here can be true of one document and false of another.
 *
 * **Recurrence.** Not applicable and not required, for the same reason
 * `rewriteTarget`'s markup guard states: a destination is a fact about one
 * element, declared outright by the author, not a shape inferred from repetition.
 * The design law in `CLAUDE.md` requires recurrence of *typographic* detectors,
 * which infer structure the source never states. This rule infers nothing.
 *
 * **False friends, each tested for non-firing.**
 *  - `<a href="#x">` — a *reference* to a destination, not a declaration of one.
 *    It already becomes a link and must not also become an anchor, or every
 *    document would define exactly the targets it fails to reach.
 *  - `id` on anything that is not an `<a>` — `xtra_shelechov.htm` writes
 *    `<table … id="table1">`, which FrontPage generated and no link mentions.
 *    Treating an editor's bookkeeping as a navigation target would put an
 *    invisible marker in front of most tables in the corpus and would make the
 *    rule's evidence "an attribute exists" rather than "the author named a
 *    place". The narrower reading is also the author's own: the request names
 *    `<a name>` and `<a id>`.
 *  - `<a name="2" href="#1">` — both at once, which is how `barrios` and
 *    `new_dyens` write a footnote marker. It is a destination *and* a link, so
 *    it produces both; choosing one would lose the other.
 *
 * **Duplicates.** `goya2` declares `name="4"` and `name="6"` twice each, 28
 * anchors for 26 destinations. A fragment names one place, so the first
 * declaration wins and the rest are recorded rather than emitted — the
 * alternative is a document whose validator reports two definitions of one
 * identifier and whose renderer picks between them unspecified.
 *
 * **Placement.** An anchor is a block, and its content is frequently not: the
 * `barrios` footnote marker sits inside a `<sup>` in the middle of a sentence.
 * The marker is therefore hoisted to just before the blocks that its nearest
 * enclosing source block produced — near enough that a jump lands on the right
 * paragraph, and outside every construct (a table cell, a nav item, a
 * blockquote) that could not hold a directive. Placement happens after all
 * grouping passes have run, so nothing that reads adjacency ever sees an anchor
 * between two blocks it was about to join. That ordering is load-bearing: an
 * anchor between an image and its caption line would otherwise unbind the
 * caption.
 */
import type { LadomNode } from "../ladom/index.js";
import { walkElements } from "../ladom/index.js";
import { isAnchorIdentifier } from "../biomd-ast/index.js";

/** One named destination declared by the source. */
export interface AnchorRecord {
  /** Fragment identifier, without the leading `#`. */
  identifier: string;
  /** Id of the `<a>` element that declared it. */
  nodeId: string;
  /**
   * Ids of that element and of every one of its ancestors.
   *
   * Containment is asked once per emitted block, so it has to be a set
   * membership test rather than a subtree walk: a page with 28 anchors and 2000
   * nodes would otherwise pay for a traversal at every block boundary.
   */
  scope: Set<string>;
  claimed: boolean;
}

/** A destination the source declared and this rule refused to emit. */
export interface RejectedAnchor {
  nodeId: string;
  identifier: string;
  reason: string;
}

export interface AnchorHarvest {
  anchors: AnchorRecord[];
  rejected: RejectedAnchor[];
}

/**
 * Attributes that declare a destination, in emission order.
 *
 * HTML 4 §12.2.3 puts `name` and `id` on `<a>` in one namespace and requires
 * them to be equal when both appear. When they are not — an authoring slip this
 * corpus is entirely capable of — both values are live destinations for a
 * browser, so both are emitted. Dropping one would break whichever link happened
 * to use it, and the cost of keeping it is one invisible line.
 */
const DESTINATION_ATTRIBUTES = ["id", "name"] as const;

export function harvestAnchors(root: LadomNode): AnchorHarvest {
  const anchors: AnchorRecord[] = [];
  const rejected: RejectedAnchor[] = [];
  const seen = new Set<string>();

  for (const el of walkElements(root)) {
    if (el.tag !== "a") continue;
    for (const attribute of DESTINATION_ATTRIBUTES) {
      const raw = el.attrs[attribute];
      if (raw === undefined) continue;
      const identifier = raw.trim();
      if (identifier === "") {
        rejected.push({ nodeId: el.id, identifier: raw, reason: `empty ${attribute} attribute` });
        continue;
      }
      if (!isAnchorIdentifier(identifier)) {
        // Not repaired. A sanitized identifier stops matching the `#…` that was
        // supposed to reach it, and a marker that silently points at nothing is
        // worse than an absent one, which the validator can still see.
        rejected.push({
          nodeId: el.id,
          identifier,
          reason: `${attribute} value cannot be written as a {#…} identifier`,
        });
        continue;
      }
      if (seen.has(identifier)) {
        rejected.push({ nodeId: el.id, identifier, reason: "identifier already declared earlier in the document" });
        continue;
      }
      seen.add(identifier);
      anchors.push({ identifier, nodeId: el.id, scope: scopeOf(el), claimed: false });
    }
  }

  return { anchors, rejected };
}

function scopeOf(el: LadomNode): Set<string> {
  const ids = new Set<string>();
  for (let node: LadomNode | null = el; node !== null; node = node.parent) ids.add(node.id);
  return ids;
}

/**
 * Which emitted block each destination attaches to.
 *
 * Claiming is first-come, and the traversal order makes that mean "deepest
 * wins": the innermost container to lower a region asks first, so an anchor
 * inside a paragraph inside a cell attaches to the paragraph and not to the
 * cell. Whatever no inner container claimed is swept by the element above it,
 * which is what hoists an anchor out of a Markdown table cell — a place no
 * directive can go — to just before the table.
 */
export class AnchorRegistry {
  private readonly records: AnchorRecord[];
  private readonly byNode = new Map<string, string[]>();

  constructor(harvest: AnchorHarvest) {
    this.records = harvest.anchors;
    for (const record of this.records) {
      const list = this.byNode.get(record.nodeId);
      if (list) list.push(record.identifier);
      else this.byNode.set(record.nodeId, [record.identifier]);
    }
  }

  /** Identifiers this element declared, claimed or not. Source order. */
  declaredBy(nodeId: string): readonly string[] {
    return this.byNode.get(nodeId) ?? [];
  }

  /** Claim every unclaimed destination inside `node`'s subtree. Source order. */
  claimIn(node: LadomNode): string[] {
    return this.take((record) => record.scope.has(node.id));
  }

  /** The same, for a run of sibling nodes that will become one set of blocks. */
  claimInRun(nodes: readonly LadomNode[]): string[] {
    if (nodes.length === 0) return [];
    const ids = new Set(nodes.map((n) => n.id));
    return this.take((record) => {
      for (const id of ids) if (record.scope.has(id)) return true;
      return false;
    });
  }

  /**
   * Give claimed identifiers back.
   *
   * Called when the region that was going to carry them emitted no block at all
   * — a run of nothing but spacer images, say. The destination is not lost yet:
   * an ancestor sweeps it, and only if no ancestor produces anything either does
   * it become a recorded drop.
   */
  release(identifiers: readonly string[]): void {
    const give = new Set(identifiers);
    for (const record of this.records) if (give.has(record.identifier)) record.claimed = false;
  }

  /** Destinations no emitted region ever claimed. */
  unclaimed(): readonly AnchorRecord[] {
    return this.records.filter((record) => !record.claimed);
  }

  /**
   * Which destinations are spoken for, for the speculative-emission snapshot.
   *
   * Structure recovery converts a region, inspects the result and sometimes
   * throws it away for a different shape. A claim taken by the attempt that lost
   * has to be given back, or the destination is attached to a block that never
   * reaches the document and is silently absent from the one that does — which
   * is exactly what happened on the first run of this rule: `barrios` marked
   * both its footnote anchors, placed both, and emitted neither.
   */
  claims(): boolean[] {
    return this.records.map((record) => record.claimed);
  }

  restore(claims: readonly boolean[]): void {
    this.records.forEach((record, index) => {
      record.claimed = claims[index] ?? record.claimed;
    });
  }

  private take(predicate: (record: AnchorRecord) => boolean): string[] {
    const out: string[] = [];
    for (const record of this.records) {
      if (record.claimed || !predicate(record)) continue;
      record.claimed = true;
      out.push(record.identifier);
    }
    return out;
  }
}
