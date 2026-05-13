import { describe, expect, it } from "vitest";
import type { Block } from "../../../types/domain/form-block";
import {
  hasEmptyGridLabels,
  hasEmptyOptionLabels,
  isGridQuestion,
  validateBlocks,
} from "../block-validation";

const baseBlock = {
  id: "id-1",
  formId: "form-1",
  blockId: "block-1",
  category: "question" as const,
  order: 0,
  version: 1,
  isDeleted: false,
  createdAt: new Date(),
  updatedAt: new Date(),
  createdBy: "user-1",
  updatedBy: "user-1",
};

function makeRadioBlock(
  options: Array<{ id: string; label: string; value?: string }>,
): Block {
  return {
    ...baseBlock,
    type: "radio",
    title: "質問タイトル",
    validation: {
      type: "radio" as const,
      required: false,
      options: options.map((o) => ({ value: o.id, ...o })),
      allowOther: false,
    },
  } as Block;
}

function makeCheckboxBlock(
  options: Array<{ id: string; label: string; value?: string }>,
): Block {
  return {
    ...baseBlock,
    type: "checkbox",
    title: "質問タイトル",
    validation: {
      type: "checkbox" as const,
      required: false,
      options: options.map((o) => ({ value: o.id, ...o })),
      allowOther: false,
    },
  } as Block;
}

function makeDropdownBlock(
  options: Array<{ id: string; label: string; value?: string }>,
): Block {
  return {
    ...baseBlock,
    type: "dropdown",
    title: "質問タイトル",
    validation: {
      type: "dropdown" as const,
      required: false,
      options: options.map((o) => ({ value: o.id, ...o })),
      allowOther: false,
    },
  } as Block;
}

function makeChoiceGridBlock(
  rows: Array<{ id: string; label: string }>,
  columns: Array<{ id: string; label: string }>,
): Block {
  return {
    ...baseBlock,
    type: "choice_grid",
    title: "質問タイトル",
    validation: {
      type: "choice_grid" as const,
      required: false,
      rows,
      columns,
    },
  } as Block;
}

function makeCheckboxGridBlock(
  rows: Array<{ id: string; label: string }>,
  columns: Array<{ id: string; label: string }>,
): Block {
  return {
    ...baseBlock,
    type: "checkbox_grid",
    title: "質問タイトル",
    validation: {
      type: "checkbox_grid" as const,
      required: false,
      rows,
      columns,
    },
  } as Block;
}

describe("isGridQuestion", () => {
  it("choice_grid と checkbox_grid を true と判定する", () => {
    expect(isGridQuestion("choice_grid")).toBe(true);
    expect(isGridQuestion("checkbox_grid")).toBe(true);
  });

  it("グリッド型でないタイプは false を返す", () => {
    expect(isGridQuestion("radio")).toBe(false);
    expect(isGridQuestion("short_text")).toBe(false);
  });
});

describe("hasEmptyOptionLabels", () => {
  it("空ラベルのオプションがある場合 true を返す", () => {
    const block = makeRadioBlock([
      { id: "opt-1", label: "選択肢A" },
      { id: "opt-2", label: "" },
    ]);
    expect(hasEmptyOptionLabels(block)).toBe(true);
  });

  it("空白のみのラベルも空として扱う", () => {
    const block = makeRadioBlock([
      { id: "opt-1", label: "選択肢A" },
      { id: "opt-2", label: "  " },
    ]);
    expect(hasEmptyOptionLabels(block)).toBe(true);
  });

  it("すべてのオプションにラベルがある場合 false を返す", () => {
    const block = makeRadioBlock([
      { id: "opt-1", label: "選択肢A" },
      { id: "opt-2", label: "選択肢B" },
    ]);
    expect(hasEmptyOptionLabels(block)).toBe(false);
  });

  it("選択肢型でないブロックの場合 false を返す", () => {
    const block = {
      ...baseBlock,
      type: "short_text",
      title: "質問タイトル",
      validation: { type: "short_text" as const, required: false },
    } as Block;
    expect(hasEmptyOptionLabels(block)).toBe(false);
  });
});

describe("hasEmptyGridLabels", () => {
  it("空ラベルの行がある場合 true を返す", () => {
    const block = makeChoiceGridBlock(
      [
        { id: "row-1", label: "行A" },
        { id: "row-2", label: "" },
      ],
      [
        { id: "col-1", label: "列A" },
        { id: "col-2", label: "列B" },
      ],
    );
    expect(hasEmptyGridLabels(block)).toBe(true);
  });

  it("空ラベルの列がある場合 true を返す", () => {
    const block = makeChoiceGridBlock(
      [{ id: "row-1", label: "行A" }],
      [
        { id: "col-1", label: "" },
        { id: "col-2", label: "列B" },
      ],
    );
    expect(hasEmptyGridLabels(block)).toBe(true);
  });

  it("空白のみのラベルも空として扱う", () => {
    const block = makeCheckboxGridBlock(
      [{ id: "row-1", label: "  " }],
      [{ id: "col-1", label: "列A" }],
    );
    expect(hasEmptyGridLabels(block)).toBe(true);
  });

  it("すべての行・列にラベルがある場合 false を返す", () => {
    const block = makeChoiceGridBlock(
      [{ id: "row-1", label: "行A" }],
      [
        { id: "col-1", label: "列A" },
        { id: "col-2", label: "列B" },
      ],
    );
    expect(hasEmptyGridLabels(block)).toBe(false);
  });

  it("グリッド型でないブロックの場合 false を返す", () => {
    const block = makeRadioBlock([
      { id: "opt-1", label: "選択肢A" },
      { id: "opt-2", label: "選択肢B" },
    ]);
    expect(hasEmptyGridLabels(block)).toBe(false);
  });
});

describe("validateBlocks", () => {
  it("空ラベルの選択肢がある場合バリデーションエラーになる", () => {
    const blocks = [
      makeRadioBlock([
        { id: "opt-1", label: "選択肢A" },
        { id: "opt-2", label: "" },
      ]),
    ];
    const result = validateBlocks(blocks);
    expect(result.isValid).toBe(false);
    expect(result.errors).toContain(
      "選択肢のラベルが空のブロックがあります。すべての選択肢にラベルを入力してください。",
    );
  });

  it("空ラベルのグリッド行・列がある場合バリデーションエラーになる", () => {
    const blocks = [
      makeChoiceGridBlock(
        [{ id: "row-1", label: "" }],
        [
          { id: "col-1", label: "列A" },
          { id: "col-2", label: "列B" },
        ],
      ),
    ];
    const result = validateBlocks(blocks);
    expect(result.isValid).toBe(false);
    expect(result.errors).toContain(
      "グリッドの行または列のラベルが空のブロックがあります。すべての行・列にラベルを入力してください。",
    );
  });

  it("checkbox/dropdown でも空ラベルを検出する", () => {
    const blocks = [
      makeCheckboxBlock([{ id: "opt-1", label: "" }]),
      makeDropdownBlock([
        { id: "opt-1", label: "A" },
        { id: "opt-2", label: "" },
      ]),
    ];
    const result = validateBlocks(blocks);
    expect(result.isValid).toBe(false);
    expect(result.errors).toContain(
      "選択肢のラベルが空のブロックがあります。すべての選択肢にラベルを入力してください。",
    );
  });

  it("checkbox_grid でも空ラベルを検出する", () => {
    const blocks = [
      makeCheckboxGridBlock(
        [{ id: "row-1", label: "行A" }],
        [{ id: "col-1", label: "" }],
      ),
    ];
    const result = validateBlocks(blocks);
    expect(result.isValid).toBe(false);
    expect(result.errors).toContain(
      "グリッドの行または列のラベルが空のブロックがあります。すべての行・列にラベルを入力してください。",
    );
  });

  it("正常なラベルを持つブロックではバリデーションが成功する", () => {
    const blocks = [
      makeRadioBlock([
        { id: "opt-1", label: "選択肢A" },
        { id: "opt-2", label: "選択肢B" },
      ]),
      makeChoiceGridBlock(
        [{ id: "row-1", label: "行A" }],
        [
          { id: "col-1", label: "列A" },
          { id: "col-2", label: "列B" },
        ],
      ),
    ];
    const result = validateBlocks(blocks);
    expect(result.isValid).toBe(true);
    expect(result.errors).toHaveLength(0);
  });

  it("グリッド型ブロックで行が空配列の場合バリデーションエラーになる", () => {
    const blocks = [
      makeChoiceGridBlock(
        [],
        [
          { id: "col-1", label: "列A" },
          { id: "col-2", label: "列B" },
        ],
      ),
    ];
    const result = validateBlocks(blocks);
    expect(result.isValid).toBe(false);
    expect(result.errors).toContain(
      "グリッド型のブロックには最低1つの行と必要数の列が必要です。",
    );
  });

  it("choice_grid で列が2未満の場合バリデーションエラーになる", () => {
    const blocks = [
      makeChoiceGridBlock(
        [{ id: "row-1", label: "行A" }],
        [{ id: "col-1", label: "列A" }],
      ),
    ];
    const result = validateBlocks(blocks);
    expect(result.isValid).toBe(false);
    expect(result.errors).toContain(
      "グリッド型のブロックには最低1つの行と必要数の列が必要です。",
    );
  });

  it("checkbox_grid で列が1つあればバリデーション成功する", () => {
    const blocks = [
      makeCheckboxGridBlock(
        [{ id: "row-1", label: "行A" }],
        [{ id: "col-1", label: "列A" }],
      ),
    ];
    const result = validateBlocks(blocks);
    expect(result.isValid).toBe(true);
    expect(result.errors).toHaveLength(0);
  });

  it("選択肢数不足と空ラベルが同時にある場合、数不足エラーのみ出る", () => {
    const blocks = [makeRadioBlock([{ id: "opt-1", label: "" }])];
    const result = validateBlocks(blocks);
    expect(result.isValid).toBe(false);
    expect(result.errors).toContain(
      "選択肢型のブロックには最低2つの選択肢が必要です。",
    );
    expect(result.errors).not.toContain(
      "選択肢のラベルが空のブロックがあります。すべての選択肢にラベルを入力してください。",
    );
  });

  it("checkboxで選択肢数不足の場合、checkbox専用の数不足エラーのみ出る", () => {
    const blocks = [makeCheckboxBlock([])];
    const result = validateBlocks(blocks);
    expect(result.isValid).toBe(false);
    expect(result.errors).toContain(
      "チェックボックスのブロックには最低1つの選択肢が必要です。",
    );
    expect(result.errors).not.toContain(
      "選択肢のラベルが空のブロックがあります。すべての選択肢にラベルを入力してください。",
    );
  });

  it("グリッド列数不足と空ラベルが同時にある場合、数不足エラーのみ出る", () => {
    const blocks = [
      makeChoiceGridBlock(
        [{ id: "row-1", label: "行A" }],
        [{ id: "col-1", label: "" }],
      ),
    ];
    const result = validateBlocks(blocks);
    expect(result.isValid).toBe(false);
    expect(result.errors).toContain(
      "グリッド型のブロックには最低1つの行と必要数の列が必要です。",
    );
    expect(result.errors).not.toContain(
      "グリッドの行または列のラベルが空のブロックがあります。すべての行・列にラベルを入力してください。",
    );
  });

  it("削除済みブロックの空ラベルは無視する", () => {
    const blocks = [
      {
        ...makeRadioBlock([{ id: "opt-1", label: "" }]),
        isDeleted: true,
      } as Block,
    ];
    const result = validateBlocks(blocks);
    expect(result.isValid).toBe(true);
    expect(result.errors).toHaveLength(0);
  });
});
