import { describe, expect, it } from "vitest";
import {
  parseStoryFixtureSet,
  STORY_FIXTURE_PREFIX,
  STORY_FIXTURE_STORY_COUNT,
  type StoryFixture,
  type StoryFixtureSet,
} from "../validation/story-fixture";

function story(index: number): StoryFixture {
  const storyId = `S${String(index).padStart(2, "0")}`;
  const blockId = `${storyId.toLowerCase()}-short-text`;
  return {
    story: storyId,
    title: `${STORY_FIXTURE_PREFIX} 2026-06-04 ${storyId}`,
    description: `Fixture for ${storyId}`,
    verificationTargets: [`Target ${storyId}`],
    blocks: [
      {
        blockId,
        type: "short_text",
        title: `${storyId} answer`,
        validation: {
          type: "short_text",
          required: true,
          allowPatternMismatch: false,
        },
      },
    ],
    structure: {
      version: 1,
      settings: {
        allow_edit_responses: false,
      },
    },
    sampleResponses: [
      {
        question_id: blockId,
        question_type: "short_text",
        question_title: `${storyId} answer`,
        value: `sample ${storyId}`,
      },
    ],
  };
}

function fixtureSet(): StoryFixtureSet {
  return {
    prefix: `${STORY_FIXTURE_PREFIX} 2026-06-04`,
    stories: Array.from({ length: STORY_FIXTURE_STORY_COUNT }, (_, index) =>
      story(index + 1),
    ),
  };
}

describe("parseStoryFixtureSet", () => {
  it("accepts the complete S01-S30 fixture contract", () => {
    const parsed = parseStoryFixtureSet(fixtureSet());

    expect(parsed.stories).toHaveLength(30);
    expect(parsed.stories[0]?.story).toBe("S01");
    expect(parsed.stories[29]?.story).toBe("S30");
  });

  it("rejects missing story ids", () => {
    const fixture = fixtureSet();
    fixture.stories[0] = story(2);

    expect(() => parseStoryFixtureSet(fixture)).toThrow(/Missing story id S01/);
  });

  it("rejects fixture prefixes without a run marker", () => {
    const fixture = fixtureSet();
    fixture.prefix = STORY_FIXTURE_PREFIX;

    expect(() => parseStoryFixtureSet(fixture)).toThrow(/Too small/);
  });

  it("rejects block validation type mismatches", () => {
    const fixture = fixtureSet();
    const firstBlock = fixture.stories[0]?.blocks[0];
    if (!firstBlock) throw new Error("Expected fixture block");
    firstBlock.validation = {
      type: "long_text",
      required: true,
    };

    expect(() => parseStoryFixtureSet(fixture)).toThrow(
      /Validation type must match block type short_text/,
    );
  });

  it("rejects sample responses that reference missing blocks", () => {
    const fixture = fixtureSet();
    const firstStory = fixture.stories[0];
    if (!firstStory?.sampleResponses?.[0]) {
      throw new Error("Expected sample response");
    }
    firstStory.sampleResponses[0].question_id = "missing-block";

    expect(() => parseStoryFixtureSet(fixture)).toThrow(
      /Sample response references missing block missing-block/,
    );
  });

  it("rejects sample responses whose values do not match fixture option ids", () => {
    const fixture = fixtureSet();
    const firstStory = fixture.stories[0];
    if (!firstStory?.blocks[0] || !firstStory.sampleResponses?.[0]) {
      throw new Error("Expected fixture block and response");
    }
    const blockId = firstStory.blocks[0].blockId;
    firstStory.blocks[0] = {
      blockId,
      type: "radio",
      title: "Choice answer",
      validation: {
        type: "radio",
        required: true,
        allowOther: false,
        options: [
          { id: "choice_a", label: "Same label" },
          { id: "choice_b", label: "Same label" },
        ],
      },
    };
    firstStory.sampleResponses[0] = {
      question_id: blockId,
      question_type: "radio",
      question_title: "Choice answer",
      value: "opt_yes",
    };

    expect(() => parseStoryFixtureSet(fixture)).toThrow(
      /Sample response value opt_yes is not in option ids/,
    );
  });

  it("rejects duplicate block ids inside a story", () => {
    const fixture = fixtureSet();
    const firstStory = fixture.stories[0];
    const firstBlock = firstStory?.blocks[0];
    if (!firstStory || !firstBlock) {
      throw new Error("Expected fixture story and block");
    }
    firstStory.blocks.push({
      ...firstBlock,
      title: "Duplicate block id",
    });

    expect(() => parseStoryFixtureSet(fixture)).toThrow(
      /Duplicate block id in story fixture/,
    );
  });

  it("rejects grid sample responses whose row or column ids are not in the fixture", () => {
    const fixture = fixtureSet();
    const firstStory = fixture.stories[0];
    if (!firstStory?.blocks[0] || !firstStory.sampleResponses?.[0]) {
      throw new Error("Expected fixture block and response");
    }
    const blockId = firstStory.blocks[0].blockId;
    firstStory.blocks[0] = {
      blockId,
      type: "choice_grid",
      title: "Grid answer",
      validation: {
        type: "choice_grid",
        required: true,
        rows: [{ id: "row_a", label: "Row A" }],
        columns: [
          { id: "col_a", label: "Column A" },
          { id: "col_b", label: "Column B" },
        ],
      },
    };
    firstStory.sampleResponses[0] = {
      question_id: blockId,
      question_type: "choice_grid",
      question_title: "Grid answer",
      responses: {
        missing_row: "col_a",
        row_a: "missing_col",
      },
    };

    expect(() => parseStoryFixtureSet(fixture)).toThrow(
      /Sample response row missing_row is not in row ids/,
    );
    expect(() => parseStoryFixtureSet(fixture)).toThrow(
      /Sample response column missing_col is not in column ids/,
    );
  });

  it("rejects logic references that do not point at fixture blocks", () => {
    const fixture = fixtureSet();
    const firstStory = fixture.stories[0];
    if (!firstStory) throw new Error("Expected fixture story");
    firstStory.structure.logic = [
      {
        id: "rule-1",
        sourceBlockId: "missing-source",
        condition: {
          field: "missing-condition",
          operator: "equals",
          value: "yes",
        },
        action: {
          type: "show",
          targetBlockId: "missing-target",
        },
        priority: 0,
        isActive: true,
      },
    ];

    expect(() => parseStoryFixtureSet(fixture)).toThrow(
      /Logic sourceBlockId missing-source/,
    );
  });
});
