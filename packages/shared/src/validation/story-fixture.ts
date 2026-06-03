import { z } from "zod";
import {
  BlockType,
  type BlockTypeValue,
  QuestionValidation,
} from "../forms/form-block";
import {
  ANSWERABLE_QUESTION_TYPES,
  responsePayloadItemSchema,
} from "../response-data";
import {
  FormAccessControlSchema,
  FormConfirmationSchema,
  FormNotificationsSchema,
} from "./notifications";
import { FormSettingsSchema, StoredLogicRuleSchema } from "./shared";

export const STORY_FIXTURE_PREFIX = "Codex Story QA";
export const STORY_FIXTURE_STORY_COUNT = 30;

const storyIdSchema = z
  .string()
  .regex(/^S(?:0[1-9]|[12][0-9]|30)$/, "Story id must be S01-S30");

const answerableQuestionTypes = new Set<string>(ANSWERABLE_QUESTION_TYPES);

export const StoryFixtureStructureSchema = z.object({
  version: z.number().int().min(1).default(1),
  settings: FormSettingsSchema,
  logic: z.array(StoredLogicRuleSchema).optional(),
  confirmation: FormConfirmationSchema.optional(),
  notifications: FormNotificationsSchema.optional(),
  access_control: FormAccessControlSchema.optional(),
});
export type StoryFixtureStructure = z.infer<typeof StoryFixtureStructureSchema>;

export const StoryFixtureBlockSchema = z.object({
  blockId: z.string().min(1).max(200),
  type: BlockType,
  title: z.string().min(1).max(200),
  description: z.string().max(1000).optional(),
  validation: QuestionValidation,
});
export type StoryFixtureBlock = z.infer<typeof StoryFixtureBlockSchema>;

export const StoryFixtureSchema = z.object({
  story: storyIdSchema,
  title: z.string().min(1).max(255),
  description: z.string().max(5000).optional(),
  verificationTargets: z.array(z.string().min(1)).min(1),
  blocks: z.array(StoryFixtureBlockSchema).min(1),
  structure: StoryFixtureStructureSchema,
  sampleResponses: z.array(responsePayloadItemSchema).optional(),
});
export type StoryFixture = z.infer<typeof StoryFixtureSchema>;

export const StoryFixtureSetSchema = z.object({
  prefix: z.string().min(STORY_FIXTURE_PREFIX.length),
  stories: z.array(StoryFixtureSchema).length(STORY_FIXTURE_STORY_COUNT),
});
export type StoryFixtureSet = z.infer<typeof StoryFixtureSetSchema>;

function addIssue(
  ctx: z.RefinementCtx,
  path: Array<string | number>,
  message: string,
) {
  ctx.addIssue({
    code: z.ZodIssueCode.custom,
    path,
    message,
  });
}

function collectExpectedStoryIds(): Set<string> {
  return new Set(
    Array.from(
      { length: STORY_FIXTURE_STORY_COUNT },
      (_, index) => `S${String(index + 1).padStart(2, "0")}`,
    ),
  );
}

function checkStoryIds(stories: StoryFixture[], ctx: z.RefinementCtx) {
  const expected = collectExpectedStoryIds();
  const seen = new Set<string>();

  stories.forEach((story, index) => {
    if (seen.has(story.story)) {
      addIssue(ctx, ["stories", index, "story"], "Duplicate story id");
      return;
    }
    seen.add(story.story);
    expected.delete(story.story);
  });

  for (const missing of expected) {
    addIssue(ctx, ["stories"], `Missing story id ${missing}`);
  }
}

function checkBlockContracts(
  story: StoryFixture,
  storyIndex: number,
  ctx: z.RefinementCtx,
) {
  const blockIds = new Set<string>();

  story.blocks.forEach((block, blockIndex) => {
    if (blockIds.has(block.blockId)) {
      addIssue(
        ctx,
        ["stories", storyIndex, "blocks", blockIndex, "blockId"],
        "Duplicate block id in story fixture",
      );
    }
    blockIds.add(block.blockId);

    if (block.validation.type !== block.type) {
      addIssue(
        ctx,
        ["stories", storyIndex, "blocks", blockIndex, "validation", "type"],
        `Validation type must match block type ${block.type}`,
      );
    }
  });

  return blockIds;
}

function checkLogicContracts(
  story: StoryFixture,
  storyIndex: number,
  blockIds: Set<string>,
  ctx: z.RefinementCtx,
) {
  story.structure.logic?.forEach((rule, ruleIndex) => {
    if (!blockIds.has(rule.sourceBlockId)) {
      addIssue(
        ctx,
        ["stories", storyIndex, "structure", "logic", ruleIndex],
        `Logic sourceBlockId ${rule.sourceBlockId} does not reference a fixture block`,
      );
    }
    const conditionField = rule.condition.field;
    if (!blockIds.has(conditionField)) {
      addIssue(
        ctx,
        [
          "stories",
          storyIndex,
          "structure",
          "logic",
          ruleIndex,
          "condition",
          "field",
        ],
        `Logic condition field ${conditionField} does not reference a fixture block`,
      );
    }
    const targetBlockId = rule.action.targetBlockId;
    if (targetBlockId && !blockIds.has(targetBlockId)) {
      addIssue(
        ctx,
        [
          "stories",
          storyIndex,
          "structure",
          "logic",
          ruleIndex,
          "action",
          "targetBlockId",
        ],
        `Logic targetBlockId ${targetBlockId} does not reference a fixture block`,
      );
    }
  });
}

function checkSampleResponses(
  story: StoryFixture,
  storyIndex: number,
  blockIds: Set<string>,
  ctx: z.RefinementCtx,
) {
  const blocksById = new Map(
    story.blocks.map((block) => [block.blockId, block]),
  );

  story.sampleResponses?.forEach((response, responseIndex) => {
    if (!blockIds.has(response.question_id)) {
      addIssue(
        ctx,
        ["stories", storyIndex, "sampleResponses", responseIndex],
        `Sample response references missing block ${response.question_id}`,
      );
      return;
    }

    const block = blocksById.get(response.question_id);
    if (!block) return;
    if (!answerableQuestionTypes.has(block.type)) {
      addIssue(
        ctx,
        ["stories", storyIndex, "sampleResponses", responseIndex],
        `Sample response references non-answerable block ${response.question_id}`,
      );
    }
    if (response.question_type !== block.type) {
      addIssue(
        ctx,
        ["stories", storyIndex, "sampleResponses", responseIndex],
        `Sample response type ${response.question_type} does not match block type ${block.type}`,
      );
    }
    checkSampleResponseValues(storyIndex, responseIndex, block, response, ctx);
  });
}

function checkSampleResponseValues(
  storyIndex: number,
  responseIndex: number,
  block: StoryFixtureBlock,
  response: z.infer<typeof responsePayloadItemSchema>,
  ctx: z.RefinementCtx,
) {
  if (block.type === "radio" || block.type === "dropdown") {
    checkScalarOptionValue(storyIndex, responseIndex, block, response, ctx);
    return;
  }
  if (block.type === "checkbox") {
    checkCheckboxOptionValues(storyIndex, responseIndex, block, response, ctx);
    return;
  }
  if (block.type === "choice_grid" || block.type === "checkbox_grid") {
    checkGridValues(storyIndex, responseIndex, block, response, ctx);
  }
}

function checkScalarOptionValue(
  storyIndex: number,
  responseIndex: number,
  block: StoryFixtureBlock,
  response: z.infer<typeof responsePayloadItemSchema>,
  ctx: z.RefinementCtx,
) {
  if (!("options" in block.validation)) return;
  const optionIds = new Set(
    block.validation.options.map((option) => option.id),
  );
  if (typeof response.value !== "string") {
    addIssue(
      ctx,
      ["stories", storyIndex, "sampleResponses", responseIndex, "value"],
      `Sample response for ${block.blockId} must use a string option id`,
    );
    return;
  }
  if (!optionIds.has(response.value)) {
    addIssue(
      ctx,
      ["stories", storyIndex, "sampleResponses", responseIndex, "value"],
      `Sample response value ${response.value} is not in option ids for ${block.blockId}`,
    );
  }
}

function checkCheckboxOptionValues(
  storyIndex: number,
  responseIndex: number,
  block: StoryFixtureBlock,
  response: z.infer<typeof responsePayloadItemSchema>,
  ctx: z.RefinementCtx,
) {
  if (!("options" in block.validation)) return;
  const optionIds = new Set(
    block.validation.options.map((option) => option.id),
  );
  const values = response.values ?? [];
  values.forEach((value, valueIndex) => {
    if (typeof value !== "string" || !optionIds.has(value)) {
      addIssue(
        ctx,
        [
          "stories",
          storyIndex,
          "sampleResponses",
          responseIndex,
          "values",
          valueIndex,
        ],
        `Sample response value ${String(value)} is not in option ids for ${block.blockId}`,
      );
    }
  });
}

function checkGridValues(
  storyIndex: number,
  responseIndex: number,
  block: StoryFixtureBlock,
  response: z.infer<typeof responsePayloadItemSchema>,
  ctx: z.RefinementCtx,
) {
  if (!("rows" in block.validation) || !("columns" in block.validation)) return;
  const rowIds = new Set(block.validation.rows.map((row) => row.id));
  const columnIds = new Set(
    block.validation.columns.map((column) => column.id),
  );
  for (const [rowId, value] of Object.entries(response.responses ?? {})) {
    if (!rowIds.has(rowId)) {
      addIssue(
        ctx,
        ["stories", storyIndex, "sampleResponses", responseIndex, "responses"],
        `Sample response row ${rowId} is not in row ids for ${block.blockId}`,
      );
    }
    const values = Array.isArray(value) ? value : [value];
    values.forEach((columnId) => {
      if (!columnIds.has(columnId)) {
        addIssue(
          ctx,
          [
            "stories",
            storyIndex,
            "sampleResponses",
            responseIndex,
            "responses",
          ],
          `Sample response column ${columnId} is not in column ids for ${block.blockId}`,
        );
      }
    });
  }
}

function checkFixtureSetContracts(
  fixtureSet: StoryFixtureSet,
  ctx: z.RefinementCtx,
) {
  if (!fixtureSet.prefix.startsWith(STORY_FIXTURE_PREFIX)) {
    addIssue(
      ctx,
      ["prefix"],
      `Fixture prefix must start with ${STORY_FIXTURE_PREFIX}`,
    );
  }

  checkStoryIds(fixtureSet.stories, ctx);

  fixtureSet.stories.forEach((story, storyIndex) => {
    if (!story.title.startsWith(fixtureSet.prefix)) {
      addIssue(
        ctx,
        ["stories", storyIndex, "title"],
        "Story title must start with fixture prefix",
      );
    }
    const blockIds = checkBlockContracts(story, storyIndex, ctx);
    checkLogicContracts(story, storyIndex, blockIds, ctx);
    checkSampleResponses(story, storyIndex, blockIds, ctx);
  });
}

export const ValidatedStoryFixtureSetSchema = StoryFixtureSetSchema.superRefine(
  checkFixtureSetContracts,
);

export function parseStoryFixtureSet(input: unknown): StoryFixtureSet {
  return ValidatedStoryFixtureSetSchema.parse(input);
}

export function isAnswerableFixtureBlockType(type: BlockTypeValue): boolean {
  return answerableQuestionTypes.has(type);
}
