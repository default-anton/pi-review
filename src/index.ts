import type { ExtensionAPI, SessionEntry } from "@earendil-works/pi-coding-agent";

import { sendMessageInNewBranch } from "./lib/child-session.js";
import {
  extractConversation,
  extractLatestAssistantText,
  formatConversation,
} from "./lib/conversation-context.js";
import {
  DEFAULT_REVIEW_THINKING_LEVEL,
  loadReviewConfig,
  type ThinkingLevel,
} from "./lib/review-config.js";

const REVIEW_METADATA_TYPE = "pi-review";

type ReviewMetadata = {
  kind: "review";
  reviewedLeafId: string;
};

const REVIEW_INSTRUCTION = `Review the available work and context.

First identify the review surface: current diff, uncommitted changes, conversation context, stated task, requirements, and acceptance criteria. Review small, localized changes directly. For broad, cross-cutting, context-heavy, or high-risk changes, use subagents to improve coverage.

When using subagents:

1. Reconnaissance:
Delegate tightly scoped repo-local research on relevant pre-existing subsystems, invariants, interfaces, tests, edge cases, and risk areas. Reconnaissance subagents must not modify source, tests, config, docs, or generated files; they may only write concise markdown notes/reports in a temporary review area and return the note path plus a terse summary.

2. Focused review:
Delegate one or more scoped reviews using the review surface, relevant reconnaissance note paths, and the shared review backbone below. Include the shared review backbone in each focused review prompt. Scope by subsystem, changed area, risk dimension, acceptance criterion, cross-cutting impact, or hypothesis. Allow intentional overlap when risk justifies it, but avoid accidental duplicate work. Focused review subagents must not modify source, tests, config, docs, or generated files; they may only write temporary markdown notes/reports.

3. Adversarial validation:
Challenge each candidate finding against the actual code path and surrounding context. For broad, high-risk, subtle, or uncertain findings, delegate tightly scoped validators to try to disprove specific candidates using guards, call sites, defaults, tests, documented contracts, and relevant invariants. Validators must not modify source, tests, config, docs, or generated files; they may only write temporary markdown notes/reports. Drop false positives, duplicates, out-of-scope concerns, and unsupported assumptions. Keep only material findings with concrete affected behavior and an actionable fix.

Shared review backbone for you and focused review subagents:
Put your strict maintainer hat on.
Find concrete, high-confidence, material issues introduced by the work or revealed by the additional context.
Do not stop after the first few findings; keep reviewing until the assigned scope is checked.
Verify completeness against the stated task, requirements, and acceptance criteria; flag missing or partially implemented requirements as findings.
Focus on correctness, security, performance, operability, and maintainability.
Do not speculate; point to the affected behavior, invariant, or code path.
Prefer issues the author would likely fix before merge.
Assume existing interfaces and behavior should remain backward compatible unless the user or project instructions explicitly say otherwise.
If nothing material stands out in the assigned scope, say \`looks good\`; otherwise return numbered findings sorted by priority.
Use [P0] for certain severe breakage, data loss, or security issues; [P1] for likely user-facing breakage or major regressions; [P2] for limited-scope correctness, performance, or maintainability issues; [P3] for minor but real issues.
For each finding, include a [P0]-[P3] tag, location, a concise summary, a concise explanation of the affected behavior, invariant, or code path, and \`Recommendation:\` with the top specific, actionable fix, stated concisely.

After subagents return, read their notes/reports, deduplicate findings, resolve obvious conflicts, preserve legitimate findings, and synthesize the final review. Scale subagent count to context and risk, not file count. Do not fully re-review every subagent finding unless it is internally inconsistent, unsupported, or contradicted by other evidence. Do one final missed-issue pass over the overall review surface before answering. Do not expose orchestration details unless needed to understand a finding.

Final answer contract:
If nothing material stands out, say \`looks good\`; otherwise return numbered sections for findings, sorted by priority. Use the same [P0]-[P3] priority rubric and finding format from the shared review backbone.`;

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
  let reviewThinkingLevel = DEFAULT_REVIEW_THINKING_LEVEL;

  function restoreThinkingLevel(): void {
    if (!originalThinkingLevel) return;

    pi.setThinkingLevel(originalThinkingLevel);
    originalThinkingLevel = undefined;
  }

  pi.on("session_start", (_event, ctx) => {
    const config = loadReviewConfig(ctx.cwd);
    reviewThinkingLevel = config.thinkingLevel;

    for (const warning of config.warnings) {
      if (ctx.hasUI) {
        ctx.ui.notify(warning, "warning");
      } else {
        console.error(warning);
      }
    }
  });

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
      if (currentThinkingLevel !== reviewThinkingLevel) {
        originalThinkingLevel = currentThinkingLevel;
        pi.setThinkingLevel(reviewThinkingLevel);
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
