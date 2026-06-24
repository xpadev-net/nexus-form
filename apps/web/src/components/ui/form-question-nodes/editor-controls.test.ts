import { describe, expect, it } from "vitest";
import { getBlockValueOptions } from "./editor-controls";

describe("getBlockValueOptions", () => {
  it("allowOther が有効な選択式質問に other 値を候補として含める", () => {
    expect(
      getBlockValueOptions("radio", {
        options: [{ id: "red", label: "赤" }],
        allowOther: true,
        otherLabel: "自由入力",
      }),
    ).toEqual([
      { value: "red", label: "赤" },
      { value: "other", label: "自由入力" },
    ]);
  });

  it("otherLabel が空の場合は既定ラベルで other 値を候補化する", () => {
    expect(
      getBlockValueOptions("dropdown", {
        options: [{ id: "small", label: "小" }],
        allowOther: true,
        otherLabel: " ",
      }),
    ).toEqual([
      { value: "small", label: "小" },
      { value: "other", label: "その他" },
    ]);
  });

  it("linear_scale の小数 step は丸めた数値候補にする", () => {
    expect(
      getBlockValueOptions("linear_scale", {
        min: 0,
        max: 0.3,
        step: 0.1,
      }),
    ).toEqual([
      { value: 0, label: "0" },
      { value: 0.1, label: "0.1" },
      { value: 0.2, label: "0.2" },
      { value: 0.3, label: "0.3" },
    ]);
  });
});
