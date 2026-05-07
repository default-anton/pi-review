import type { ExtensionAPI, SessionEntry } from "@mariozechner/pi-coding-agent";

import { sendMessageInNewBranch } from "./lib/child-session.js";
import {
  extractConversation,
  extractLatestAssistantText,
  formatConversation,
} from "./lib/conversation-context.js";

const REVIEW_THINKING_LEVEL = "high";
const REVIEW_METADATA_TYPE = "pi-review";

type ThinkingLevel = ReturnType<ExtensionAPI["getThinkingLevel"]>;
type ReviewMetadata = {
  kind: "review";
  reviewedLeafId: string;
};

const REVIEW_INSTRUCTION = `Review the available work and context.
Put your strict maintainer hat on.
Find concrete, high-confidence, material issues introduced by the work or revealed by the additional context.
Do not stop after the first few findings; keep reviewing until you have checked the full diff/context, then do one final pass specifically for issues you may have missed.
Verify completeness against the stated task, requirements, and acceptance criteria; flag missing or partially implemented requirements as findings.
Focus on correctness, security, performance, operability, and maintainability.
Do not speculate; point to the affected behavior, invariant, or code path.
Prefer issues the author would likely fix before merge.
Assume existing interfaces and behavior should remain backward compatible unless the user or project instructions explicitly say otherwise.
If nothing material stands out, say \`looks good\`; otherwise return numbered sections for findings, sorted by priority.
Use [P0] for certain severe breakage, data loss, or security issues; [P1] for likely user-facing breakage or major regressions; [P2] for limited-scope correctness, performance, or maintainability issues; [P3] for minor but real issues.
For each finding, include a [P0]-[P3] tag, location, a concise summary, a concise explanation of the affected behavior, invariant, or code path, and \`Recommendation:\` with the top specific, actionable fix, stated concisely.`;

function buildReviewInstruction(args: string): string {
  const focusText = args.trim();
  if (!focusText) {
    return REVIEW_INSTRUCTION;
  }

  return [REVIEW_INSTRUCTION, "Additional review context:", focusText].join("\n\n");
}

function buildReviewMessage(args: string, conversationXml?: string): string {
  const reviewInstruction = buildReviewInstruction(args);
  if (!conversationXml) {
    return reviewInstruction;
  }

  return [
    "Conversation context copied from the current branch (user + assistant messages only; thinking and tool calls removed):",
    "",
    "````xml",
    conversationXml,
    "````",
    "",
    reviewInstruction,
  ].join("\n");
}

function isReviewMetadata(data: unknown): data is ReviewMetadata {
  return (
    !!data &&
    typeof data === "object" &&
    "kind" in data &&
    data.kind === "review" &&
    "reviewedLeafId" in data &&
    typeof data.reviewedLeafId === "string"
  );
}

function findReviewMetadata(branch: SessionEntry[]): ReviewMetadata | undefined {
  for (const entry of [...branch].reverse()) {
    if (entry.type !== "custom" || entry.customType !== REVIEW_METADATA_TYPE) continue;
    if (isReviewMetadata(entry.data)) return entry.data;
  }

  return undefined;
}

function buildReviewBackEditorText(reviewReport: string): string {
  return [
    "<review_findings>",
    reviewReport.trim(),
    "</review_findings>",
  ].join("\n");
}

export default function reviewExtension(pi: ExtensionAPI) {
  let originalThinkingLevel: ThinkingLevel | undefined;

  function restoreThinkingLevel(): void {
    if (!originalThinkingLevel) return;

    pi.setThinkingLevel(originalThinkingLevel);
    originalThinkingLevel = undefined;
  }

  pi.on("agent_end", () => {
    restoreThinkingLevel();
  });

  pi.registerCommand("review", {
    description: "Review current work in new branch (optional focus text)",
    handler: async (args, ctx) => {
      if (!ctx.isIdle()) {
        await ctx.waitForIdle();
      }

      const branch = ctx.sessionManager.getBranch();
      const reviewedLeafId = ctx.sessionManager.getLeafId();
      const extractedConversation = extractConversation(branch);
      const conversationXml =
        extractedConversation.length === 0 ? undefined : formatConversation(extractedConversation);
      const reviewMessage = buildReviewMessage(args, conversationXml);

      const currentThinkingLevel = pi.getThinkingLevel();
      if (currentThinkingLevel !== REVIEW_THINKING_LEVEL) {
        originalThinkingLevel = currentThinkingLevel;
        pi.setThinkingLevel(REVIEW_THINKING_LEVEL);
      }

      let started = false;
      try {
        started = await sendMessageInNewBranch(pi, ctx, branch, reviewMessage, "review", () => {
          if (!reviewedLeafId) return;
          pi.appendEntry(REVIEW_METADATA_TYPE, { kind: "review", reviewedLeafId });
        });
      } finally {
        if (!started) restoreThinkingLevel();
      }
      if (!started) return;

      if (ctx.hasUI) {
        ctx.ui.setEditorText("");
      }
    },
  });

  pi.registerCommand("review-back", {
    description: "Return to reviewed branch with review findings in the editor",
    handler: async (_args, ctx) => {
      if (!ctx.isIdle()) {
        await ctx.waitForIdle();
      }

      if (!ctx.hasUI) return;

      const branch = ctx.sessionManager.getBranch();
      const metadata = findReviewMetadata(branch);
      if (!metadata) {
        ctx.ui.notify("No review branch metadata found", "warning");
        return;
      }

      const reviewReport = extractLatestAssistantText(branch);
      if (!reviewReport) {
        ctx.ui.notify("No assistant review report found", "warning");
        return;
      }

      const result = await ctx.navigateTree(metadata.reviewedLeafId, { summarize: false });
      if (result.cancelled) {
        ctx.ui.notify("Return to reviewed branch cancelled", "info");
        return;
      }

      ctx.ui.setEditorText(buildReviewBackEditorText(reviewReport));
      ctx.ui.notify("Returned to reviewed branch", "info");
    },
  });
}
