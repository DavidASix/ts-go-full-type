import { UserVisibleError } from "../shared/errors";

export interface GraphLimits {
  readonly maxNodes: number;
  readonly maxTextBytes: number;
}
export const DEFAULT_GRAPH_LIMITS: GraphLimits = { maxNodes: 5_000, maxTextBytes: 2_000_000 };

/** A transaction charges allocations as they occur, before it publishes a branch. */
export class GraphBudget {
  public constructor(private readonly limits: GraphLimits, private nodes = 0, private bytes = 0) {}

  /**
   * Reject allocations that would exceed the visible graph node limit.
   */
  public assertCanAddNode(): void {
    if (this.nodes >= this.limits.maxNodes) {
      throw new UserVisibleError(`Expansion would exceed the ${this.limits.maxNodes.toLocaleString("en-US")}-node safety limit. The previous view was kept.`);
    }
  }
  /**
   * Reject a single type expression that exceeds the UTF-8 presentation budget.
   * @param text Compiler presentation or label charged to the graph budget.
   */
  public assertTextFits(text: string): void {
    if (this.bytes + Buffer.byteLength(text, "utf8") > this.limits.maxTextBytes) {
      throw new UserVisibleError("Expansion would exceed the graph text output safety limit. The previous view was kept.");
    }
  }
  /**
   * Charge presentation text against the graph byte budget before publishing it.
   * @param text Compiler presentation or label charged to the graph budget.
   */
  public addText(text: string): void {
    this.assertTextFits(text);
    this.bytes += Buffer.byteLength(text, "utf8");
  }
  /**
   * Charge a new graph node and its collapsed text against allocation limits.
   * @param text Compiler presentation or label charged to the graph budget.
   */
  public addNode(text: string): void {
    this.assertCanAddNode();
    this.addText(text);
    this.nodes += 1;
  }
}
